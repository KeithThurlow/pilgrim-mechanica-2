// Streams terrain chunks around a focus point (the convoy, the player) with no load screens:
// nearest missing chunks first, a few per frame inside a time budget, far chunks dropped.
// Chunks at the same resolution share edge vertices exactly, so there are no seams.
import * as THREE from "three/webgpu";
import { vertexColor, positionWorld, uniform, mx_noise_float, vec3, float, sin, smoothstep, clamp, cameraPosition } from "three/tsl";
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
};

interface Chunk { mesh: THREE.Mesh; cx: number; cz: number }

export class TerrainStreamer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardNodeMaterial;
  private uGrain = uniform(0.5);
  private uSpecks = uniform(0.45);
  private uRipples = uniform(0.35);
  private uWind = uniform(new THREE.Vector2(1, 0));
  readonly stats = { loaded: 0, built: 0, buildMs: 0, pending: 0 };
  private chunks = new Map<string, Chunk>();
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
      tmp.lerp(C.flat, s.flat * 0.25);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
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
    return { mesh, cx, cz };
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
    this.group.remove(c.mesh);
    // The index is shared, so only drop the per-chunk attributes.
    const g = c.mesh.geometry;
    g.setIndex(null);
    g.dispose();
  }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
