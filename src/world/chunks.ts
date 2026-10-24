// Streams terrain chunks around a focus point (the convoy, the player) with no load screens:
// nearest missing chunks first, a few per frame inside a time budget, far chunks dropped.
// Chunks at the same resolution share edge vertices exactly, so there are no seams.
import * as THREE from "three/webgpu";
import { vertexColor, positionWorld, uniform, mx_noise_float, vec3, float, sin, smoothstep, clamp, cameraPosition, attribute, time } from "three/tsl";
import type { Param } from "../core/tweaks";
import type { DuneField, GroundSample } from "./terrain";

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

// Sand palette (sRGB): warm windward faces, darker slip faces, paler hardpan flats.
const C = {
  trough: new THREE.Color().setHex(0xc99467, THREE.SRGBColorSpace),
  windward: new THREE.Color().setHex(0xe6b780, THREE.SRGBColorSpace),
  crest: new THREE.Color().setHex(0xf3d3a2, THREE.SRGBColorSpace),
  slip: new THREE.Color().setHex(0xc4824f, THREE.SRGBColorSpace),
  flat: new THREE.Color().setHex(0xdcb98f, THREE.SRGBColorSpace),
  // Rocky land: sand in the hollows a little greyer; rock tops grey-brown, risers red-brown.
  rockSand: new THREE.Color().setHex(0xccb08a, THREE.SRGBColorSpace),
  rockTop: new THREE.Color().setHex(0xa38f7b, THREE.SRGBColorSpace),
  rockFace: new THREE.Color().setHex(0x7b5a48, THREE.SRGBColorSpace),
  // Shallows: wet sand at the waterline, the floor under the water.
  wet: new THREE.Color().setHex(0x9c8261, THREE.SRGBColorSpace),
  floor: new THREE.Color().setHex(0x7d7a5f, THREE.SRGBColorSpace),
  // Water: clear and pale at the shore, green-teal with depth, foam at the edge.
  waterShallow: new THREE.Color().setHex(0x9fbfae, THREE.SRGBColorSpace),
  waterDeep: new THREE.Color().setHex(0x3e6e6c, THREE.SRGBColorSpace),
  foam: new THREE.Color().setHex(0xeef2e8, THREE.SRGBColorSpace),
};

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
  readonly stats = { loaded: 0, built: 0, buildMs: 0, pending: 0 };
  private chunks = new Map<string, Chunk>();
  private c2 = new THREE.Color();
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
    this.material.colorNode = vertexColor().mul(shade);
    this.group.name = "terrain";

    // Water: colour per vertex (depth tint and foam), opacity from depth; a slow shimmer of small ripples.
    this.waterMaterial = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.12, metalness: 0 });
    const depth = attribute<"float">("depth"), fade = attribute<"float">("fade");
    const shimmer = mx_noise_float(vec3(xz.mul(0.6), time.mul(0.35))).mul(0.06).add(mx_noise_float(vec3(xz.mul(2.1), time.mul(0.8))).mul(0.03));
    this.waterMaterial.colorNode = vertexColor().mul(float(1).add(shimmer));
    this.waterMaterial.opacityNode = clamp(this.uClear.add(this.uDeep.sub(this.uClear).mul(smoothstep(0, 1.2, depth))).add(float(1).sub(smoothstep(0, 0.12, depth)).mul(0.5)), 0, 1).mul(fade);
  }

  /** Drop every chunk (after the terrain shape or grid changes); they stream back in nearest first. */
  rebuildAll() {
    for (const c of this.chunks.values()) this.dispose(c);
    this.chunks.clear();
    this.dirty.clear();
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

  private build(cx: number, cz: number): Chunk {
    const n = Math.round(this.v.segments), size = this.v.chunkSize, step = size / n, row = n + 1;
    const count = row * row;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const ox = cx * size, oz = cz * size;
    const s: GroundSample = { h: 0, crest: 0, flat: 0 };
    const nn = [0, 1, 0], wide = [0, 1, 0];
    const [wx, wz] = this.field.wind();
    const tmp = new THREE.Color();
    const water = this.field.waterLevel;
    let maxWs = 0;
    const wsA = water !== null ? new Float32Array(count) : null;
    const hs = new Float32Array(count);
    for (let j = 0, i = 0; j < row; j++) for (let k = 0; k < row; k++, i++) {
      const x = ox + k * step, z = oz + j * step;
      this.field.sample(x, z, s);
      this.field.normal(x, z, nn);
      pos[i * 3] = k * step; pos[i * 3 + 1] = s.h; pos[i * 3 + 2] = j * step;
      nor[i * 3] = nn[0]; nor[i * 3 + 1] = nn[1]; nor[i * 3 + 2] = nn[2];

      // Colour: trough to windward to crest by height on the dune, slip faces darker, flats paler.
      const cr = Math.pow(Math.min(1, s.crest), 0.8);
      tmp.copy(C.trough).lerp(C.windward, Math.min(1, cr * 1.6)).lerp(C.crest, Math.max(0, cr - 0.6) * 2);
      // Colour reads a wide normal (2 m) so the slip-face tint fades smoothly instead of following the grid.
      this.field.normal(x, z, wide, 2);
      const steep = 1 - wide[1], downwind = wide[0] * wx + wide[2] * wz;
      const slipK = smooth(0.12, 0.35, steep) * smooth(0.02, 0.2, downwind);
      tmp.lerp(C.slip, slipK * 0.75);
      tmp.lerp(C.flat, s.flat * 0.25 * (1 - (s.wr ?? 0)));
      // Biomes: rocky land's sand greyer, bare rock by steepness (tops grey, risers red-brown); shallows wet and dark.
      const wr = s.wr ?? 0, ws = s.ws ?? 0, rock = s.rock ?? 0;
      if (wr > 0) tmp.lerp(C.rockSand, wr * 0.6);
      if (rock > 0) tmp.lerp(this.c2.copy(C.rockTop).lerp(C.rockFace, smooth(0.15, 0.45, steep)), rock);
      if (water !== null && ws > 0) {
        const above = s.h - water;
        tmp.lerp(C.wet, ws * (1 - smooth(0.05, 0.8, above)) * (1 - rock * 0.7));
        tmp.lerp(C.floor, ws * smooth(0, 0.6, -above) * (1 - rock));
        if (above < 0.3) maxWs = Math.max(maxWs, ws);
      }
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
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
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = i % row, j = Math.floor(i / row);
      pos[i * 3] = k * step; pos[i * 3 + 1] = water; pos[i * 3 + 2] = j * step;
      const d = water - hs[i];
      dep[i] = Math.max(0, d);
      tmp.copy(C.waterShallow).lerp(C.waterDeep, smooth(0, 1.4, d));
      tmp.lerp(C.foam, (1 - smooth(0, 0.12, d)) * 0.7);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      // Fade out where the shallows end (no water in desert troughs) and just above the shore (the foam line).
      fade[i] = smooth(0.15, 0.6, wsA[i]) * (d > -0.05 ? 1 : 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3).map((_, q) => (q % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("depth", new THREE.BufferAttribute(dep, 1));
    g.setAttribute("fade", new THREE.BufferAttribute(fade, 1));
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

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
