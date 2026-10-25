// Streams terrain chunks around a focus point (the convoy, the player) with no load screens:
// nearest missing chunks first, a few per frame inside a time budget, far chunks dropped.
// Chunks at the same resolution share edge vertices exactly, so there are no seams.
import * as THREE from "three/webgpu";
import { vertexColor, positionWorld, uniform, mx_noise_float, vec3, vec4, float, sin, smoothstep, clamp, cameraPosition, attribute, time, abs, max } from "three/tsl";
import type { Param } from "../core/tweaks";
import type { DuneField, GroundSample } from "./terrain";
import { groundColour, WATER_COLOURS, smooth } from "./groundColour";

export const STREAM_DEFAULTS = {
  chunkSize: 64,
  segments: 64,
  radius: 5,
  budgetMs: 4,
  facets: 0,
  sandGrain: 0.5,
  sandSpecks: 0.45,
  sandRipples: 0.25,
};
export type StreamValues = typeof STREAM_DEFAULTS;

export const STREAM_PARAMS: Param[] = [
  { key: "radius", label: "View radius (chunks)", min: 1, max: 12, step: 1, group: "Streaming" },
  { key: "chunkSize", label: "Chunk size (m)", min: 16, max: 256, step: 16, group: "Streaming", onRelease: true },
  { key: "segments", label: "Grid per chunk", min: 8, max: 128, step: 4, group: "Streaming", tip: "Vertices per chunk side; chunk size / grid = metres per vertex", onRelease: true },
  { key: "budgetMs", label: "Build budget (ms/frame)", min: 0.5, max: 16, step: 0.5, group: "Streaming", tip: "Time per frame spent building new chunks" },
  { key: "facets", label: "Faceted look", min: 0, max: 1, step: 1, group: "Look" },
  { key: "sandGrain", label: "Sand grain", min: 0, max: 1, step: 0.01, group: "Sand surface", tip: "Soft mottling across the sand" },
  { key: "sandSpecks", label: "Specks", min: 0, max: 1, step: 0.01, group: "Sand surface", tip: "Tiny dark grains and pebbles, as in Keith's reference video" },
  { key: "sandRipples", label: "Wind ripples", min: 0, max: 1, step: 0.01, group: "Sand surface", tip: "Fine ripples across the wind" },
];

interface Chunk { mesh: THREE.Mesh; water: THREE.Mesh | null; cx: number; cz: number }

export class TerrainStreamer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardNodeMaterial;
  /** Water over the shallows (chunks with shallows below the water level get a water sheet). */
  readonly waterMaterial: THREE.MeshStandardNodeMaterial;
  private uClear = uniform(0.3);
  private uDeep = uniform(0.85);
  private uGrain = uniform(0.5);
  private uSpecks = uniform(0.45);
  private uRipples = uniform(0.35);
  private uWind = uniform(new THREE.Vector2(1, 0));
  readonly stats = { loaded: 0, built: 0, buildMs: 0, pending: 0, patched: 0 };
  private chunks = new Map<string, Chunk>();
  /**
   * A hole the chunks leave for the detail patch (src/world/detailPatch.ts): (x0, z0, x1, z1) in world metres, empty
   * while x1 <= x0. Chunk fragments inside it are dropped, in the shadow pass too, so the patch draws that ground alone.
   */
  readonly hole = uniform(new THREE.Vector4(0, 0, 0, 0));
  /** The per-pixel sand shading (mottling, specks, ripples) as a factor, shared with the detail patch. */
  readonly shadeNode: THREE.Node<"float">;
  /** Called with the box whenever ground is rebuilt or patched (rebuildArea, patchArea), or null for rebuildAll. */
  readonly onRebuild: ((box: [number, number, number, number] | null) => void)[] = [];
  private c3 = new THREE.Color();
  private c4 = new THREE.Color();
  private dirty = new Set<string>();
  private index: THREE.BufferAttribute | null = null;
  private indexSegments = -1;

  constructor(private field: DuneField, public v: StreamValues) {
    // Sand surface in the shader, per pixel (the vertex colours carry only the broad dune shading): soft mottling,
    // sparse dark specks and faint ripples across the wind. Nothing per vertex, so no triangles show.
    this.material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 }); // colours come in through colorNode
    const xz = positionWorld.xz;
    const mott = mx_noise_float(vec3(xz.mul(0.35), float(1.7))).mul(0.5).add(mx_noise_float(vec3(xz.mul(1.3), float(4.1))).mul(0.25));
    const speckN = mx_noise_float(vec3(xz.mul(5.5), float(9.3)));
    const speck = smoothstep(0.55, 0.75, speckN).mul(this.uSpecks).mul(0.35);
    const across = xz.dot(this.uWind);
    const warp = mx_noise_float(vec3(xz.mul(0.12), float(2.2))).mul(4);
    // Ripples fade out with distance: from the game camera they would shimmer into stripes (Keith 2026-10-24, banding).
    const near = float(1).sub(smoothstep(8, 22, positionWorld.distance(cameraPosition)));
    const ripple = sin(across.mul(9).add(warp)).mul(this.uRipples).mul(0.035).mul(near);
    const shade = clamp(float(1).add(mott.mul(this.uGrain).mul(0.12)).add(ripple).sub(speck), 0.5, 1.3);
    this.shadeNode = shade;
    this.material.colorNode = vertexColor().mul(shade);
    // Outside the patch's hole (a hair inside its edge, so no pixel cracks open along the seam).
    const hc = vec4(this.hole);
    const mid = hc.xy.add(hc.zw).mul(0.5), halfW = hc.zw.sub(hc.xy).mul(0.5).sub(0.02);
    const dd = abs(xz.sub(mid)).sub(halfW);
    this.material.maskNode = max(dd.x, dd.y).greaterThan(0).or(hc.z.lessThanEqual(hc.x));
    this.group.name = "terrain";

    // Water: colour per vertex (depth tint and foam), opacity from depth; a slow shimmer of small ripples.
    this.waterMaterial = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.12, metalness: 0 });
    const depth = attribute<"float">("depth"), fade = attribute<"float">("fade");
    const shimmer = mx_noise_float(vec3(xz.mul(0.6), time.mul(0.35))).mul(0.06).add(mx_noise_float(vec3(xz.mul(2.1), time.mul(0.8))).mul(0.03));
    this.waterMaterial.colorNode = vertexColor().mul(float(1).add(shimmer));
    this.waterMaterial.opacityNode = clamp(this.uClear.add(this.uDeep.sub(this.uClear).mul(smoothstep(0, 1.2, depth))).add(float(1).sub(smoothstep(0, 0.06, depth)).mul(0.3)), 0, 1).mul(fade);
  }

  /** Drop every chunk (after the terrain shape or grid changes); they stream back in nearest first. */
  rebuildAll() {
    for (const c of this.chunks.values()) this.dispose(c);
    this.chunks.clear();
    this.dirty.clear();
    for (const f of this.onRebuild) f(null);
  }

  /**
   * Rebuild the loaded chunks overlapping a box (after the ground changed there, e.g. the convoy's road extending).
   * They're rebuilt in place, nearest first under the frame budget, so no holes show while they wait.
   */
  rebuildArea(x0: number, z0: number, x1: number, z1: number) {
    const s = this.v.chunkSize;
    const a = Math.floor(Math.min(x0, x1) / s), b = Math.floor(Math.max(x0, x1) / s);
    const c = Math.floor(Math.min(z0, z1) / s), d = Math.floor(Math.max(z0, z1) / s);
    for (let cz = c; cz <= d; cz++) for (let cx = a; cx <= b; cx++) {
      const k = cx + "," + cz;
      if (this.chunks.has(k)) this.dirty.add(k);
    }
    for (const f of this.onRebuild) f([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
  }

  setFacets(on: boolean) {
    if (this.material.flatShading !== on) { this.material.flatShading = on; this.material.needsUpdate = true; }
  }

  update(fx: number, fz: number) {
    this.setFacets(this.v.facets > 0.5);
    this.uGrain.value = this.v.sandGrain; this.uSpecks.value = this.v.sandSpecks; this.uRipples.value = this.v.sandRipples;
    const sh = this.field.shallows;
    if (sh) { this.uClear.value = sh.v.waterClear; this.uDeep.value = sh.v.waterDeep; }
    const [wx, wz] = this.field.wind();
    this.uWind.value.set(wx, wz);
    const size = this.v.chunkSize, r = this.v.radius;
    const ccx = Math.floor(fx / size), ccz = Math.floor(fz / size);

    for (const [k, c] of this.chunks) {
      if (Math.hypot(c.cx - ccx, c.cz - ccz) > r + 1.5) { this.dispose(c); this.chunks.delete(k); }
    }

    const missing: [number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > r + 0.5) continue;
      const cx = ccx + dx, cz = ccz + dz;
      if (!this.chunks.has(cx + "," + cz)) missing.push([d, cx, cz]);
    }
    missing.sort((a, b) => a[0] - b[0]);

    const t0 = performance.now();
    let built = 0;
    for (const [, cx, cz] of missing) {
      // Always build the nearest one, so the ground under the focus is never missing.
      if (built > 0 && performance.now() - t0 > this.v.budgetMs) break;
      this.chunks.set(cx + "," + cz, this.build(cx, cz));
      built++;
    }
    // Chunks whose ground changed: rebuilt in place, nearest first, at least one a frame.
    if (this.dirty.size) {
      const order = [...this.dirty].map((k) => { const c = this.chunks.get(k); return { k, c, d: c ? Math.hypot(c.cx - ccx, c.cz - ccz) : 0 }; });
      order.sort((p, q) => p.d - q.d);
      let redone = 0;
      for (const { k, c } of order) {
        if (redone > 0 && performance.now() - t0 > this.v.budgetMs) break;
        this.dirty.delete(k);
        if (!c) continue;
        const fresh = this.build(c.cx, c.cz);
        this.dispose(c);
        this.chunks.set(k, fresh);
        redone++;
      }
      built += redone;
    }
    this.stats.built = built;
    this.stats.buildMs = performance.now() - t0;
    this.stats.loaded = this.chunks.size;
    this.stats.pending = missing.length - built + this.dirty.size;
  }

  /** Build every chunk within the radius now (for tests and first frames). */
  fill(fx: number, fz: number) {
    const b = this.v.budgetMs;
    this.v.budgetMs = 1e9;
    this.update(fx, fz);
    this.v.budgetMs = b;
  }

  /** One ground vertex at (x, z): the sample into s, the normal into nn, the colour into tmp. */
  private vertex(x: number, z: number, s: GroundSample, nn: number[], tmp: THREE.Color) {
    this.field.sample(x, z, s);
    this.field.normal(x, z, nn);
    groundColour(this.field, x, z, s, tmp);
  }

  /**
   * Update the loaded chunks' vertices inside a box in place (after the ground changed there, e.g. a crater): heights,
   * normals, colours and the water sheet's depth. Much cheaper than rebuilding whole chunks; a chunk that now needs a
   * water sheet it didn't have is queued for a rebuild instead. Returns the vertices touched.
   */
  patchArea(x0: number, z0: number, x1: number, z1: number): number {
    const size = this.v.chunkSize, n = Math.round(this.v.segments), step = size / n, row = n + 1;
    // Normals and the colour's wide normal read the ground 2 m round each vertex.
    x0 -= 2.5; z0 -= 2.5; x1 += 2.5; z1 += 2.5;
    for (const f of this.onRebuild) f([x0, z0, x1, z1]);
    const a = Math.floor(x0 / size), b = Math.floor(x1 / size), c = Math.floor(z0 / size), d = Math.floor(z1 / size);
    const s: GroundSample = { h: 0, crest: 0, flat: 0 }, nn = [0, 1, 0], tmp = this.c4;
    const water = this.field.waterLevel;
    let count = 0;
    for (let cz = c; cz <= d; cz++) for (let cx = a; cx <= b; cx++) {
      const key = cx + "," + cz, ch = this.chunks.get(key);
      if (!ch || this.dirty.has(key)) continue;
      const ox = cx * size, oz = cz * size;
      const k0 = Math.max(0, Math.ceil((x0 - ox) / step)), k1 = Math.min(n, Math.floor((x1 - ox) / step));
      const j0 = Math.max(0, Math.ceil((z0 - oz) / step)), j1 = Math.min(n, Math.floor((z1 - oz) / step));
      if (k0 > k1 || j0 > j1) continue;
      const g = ch.mesh.geometry;
      const P = g.getAttribute("position") as THREE.BufferAttribute, Nm = g.getAttribute("normal") as THREE.BufferAttribute, Cl = g.getAttribute("color") as THREE.BufferAttribute;
      const pos = P.array as Float32Array, nor = Nm.array as Float32Array, col = Cl.array as Float32Array;
      const wg = ch.water?.geometry;
      let needWater = false;
      for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const i = j * row + k;
        this.vertex(ox + k * step, oz + j * step, s, nn, tmp);
        pos[i * 3 + 1] = s.h;
        nor[i * 3] = nn[0]; nor[i * 3 + 1] = nn[1]; nor[i * 3 + 2] = nn[2];
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        const ws = s.ws ?? 0;
        if (water !== null && ws > 0) {
          if (wg) this.waterVertex(wg, i, water, ws, s.h);
          else if (s.h - water < 0.3) needWater = true;
        }
        count++;
      }
      P.needsUpdate = true; Nm.needsUpdate = true; Cl.needsUpdate = true;
      g.computeBoundingSphere();
      if (wg) for (const k of ["color", "depth", "fade"]) (wg.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
      if (needWater) this.dirty.add(key);
    }
    this.stats.patched += count;
    return count;
  }

  /** One water vertex: depth from the ground under it, the tint by depth and foam, faded where the shallows end. */
  private waterVertex(g: THREE.BufferGeometry, i: number, water: number, ws: number, h: number) {
    const col = (g.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
    const dep = (g.getAttribute("depth") as THREE.BufferAttribute).array as Float32Array;
    const fade = (g.getAttribute("fade") as THREE.BufferAttribute).array as Float32Array;
    const t = this.c3;
    const d = water - h;
    dep[i] = Math.max(0, d);
    t.copy(WATER_COLOURS.shallow).lerp(WATER_COLOURS.deep, smooth(0, 1.4, d));
    t.lerp(WATER_COLOURS.foam, (1 - smooth(0, 0.06, d)) * 0.45);
    col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
    // Fade out where the shallows end (no water in desert troughs) and just above the shore (the foam line).
    fade[i] = smooth(0.15, 0.6, ws) * (d > -0.05 ? 1 : 0);
  }

  private build(cx: number, cz: number): Chunk {
    const n = Math.round(this.v.segments), size = this.v.chunkSize, step = size / n, row = n + 1;
    const count = row * row;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const ox = cx * size, oz = cz * size;
    const s: GroundSample = { h: 0, crest: 0, flat: 0 };
    const nn = [0, 1, 0];
    const tmp = new THREE.Color();
    const water = this.field.waterLevel;
    let maxWs = 0;
    const wsA = water !== null ? new Float32Array(count) : null;
    const hs = new Float32Array(count);
    for (let j = 0, i = 0; j < row; j++) for (let k = 0; k < row; k++, i++) {
      const x = ox + k * step, z = oz + j * step;
      this.vertex(x, z, s, nn, tmp);
      pos[i * 3] = k * step; pos[i * 3 + 1] = s.h; pos[i * 3 + 2] = j * step;
      nor[i * 3] = nn[0]; nor[i * 3 + 1] = nn[1]; nor[i * 3 + 2] = nn[2];
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      const ws = s.ws ?? 0;
      if (water !== null && ws > 0 && s.h - water < 0.3) maxWs = Math.max(maxWs, ws);
      if (wsA) wsA[i] = ws;
      hs[i] = s.h;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(this.sharedIndex(n));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    // Dunes cast shadows too (Keith 2026-10-24: a low sun should throw dune shadows), inside the sun's shadow box.
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    const waterMesh = water !== null && maxWs > 0 && wsA ? this.buildWater(ox, oz, n, step, water, wsA, hs) : null;
    return { mesh, water: waterMesh, cx, cz };
  }

  /** A water sheet over the chunk at the water level: depth from the ground under each vertex, faded by the shallows' weight. */
  private buildWater(ox: number, oz: number, n: number, step: number, water: number, wsA: Float32Array, hs: Float32Array) {
    const row = n + 1, count = row * row;
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), dep = new Float32Array(count), fade = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("depth", new THREE.BufferAttribute(dep, 1));
    g.setAttribute("fade", new THREE.BufferAttribute(fade, 1));
    for (let i = 0; i < count; i++) {
      const k = i % row, j = Math.floor(i / row);
      pos[i * 3] = k * step; pos[i * 3 + 1] = water; pos[i * 3 + 2] = j * step;
      this.waterVertex(g, i, water, wsA[i], hs[i]);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3).map((_, q) => (q % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(this.sharedIndex(n));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.waterMaterial);
    m.position.set(ox, 0, oz);
    m.renderOrder = 1;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.group.add(m);
    return m;
  }

  private sharedIndex(n: number) {
    if (this.index && this.indexSegments === n) return this.index;
    const row = n + 1, idx = new (row * row > 65535 ? Uint32Array : Uint16Array)(n * n * 6);
    let p = 0;
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const a = j * row + k, b = a + 1, c = a + row, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    this.index = new THREE.BufferAttribute(idx, 1);
    this.indexSegments = n;
    return this.index;
  }

  private dispose(c: Chunk) {
    if (c.water) { this.group.remove(c.water); c.water.geometry.setIndex(null); c.water.geometry.dispose(); }
    this.group.remove(c.mesh);
    // The index is shared, so only drop the per-chunk attributes.
    const g = c.mesh.geometry;
    g.setIndex(null);
    g.dispose();
  }
}

