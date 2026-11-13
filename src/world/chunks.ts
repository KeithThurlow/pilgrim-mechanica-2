// Streams terrain chunks around a focus point (the convoy, the player) with no load screens:
// nearest missing chunks first, a few per frame inside a time budget, far chunks dropped.
// Chunks at the same resolution share edge vertices exactly, so there are no seams.
import * as THREE from "three/webgpu";
import { vertexColor, positionWorld, uniform, mx_noise_float, vec3, vec4, float, sin, smoothstep, clamp, cameraPosition, attribute, time, abs, max } from "three/tsl";
import type { Param } from "../core/tweaks";
import type { DuneField, GroundSample } from "./terrain";
import { WATER_COLOURS, smooth } from "./groundColour";
import { chunkArrays, fillChunkRows, groundVertex, groundVertexCached, newPatchBase, type ChunkArrays, type PatchBlock } from "./chunkFill";

export const STREAM_DEFAULTS = {
  chunkSize: 64,
  segments: 64,
  radius: 5,
  budgetMs: 4,
  facets: 0,
  sandGrain: 0.5,
  sandSpecks: 0.45,
  sandRipples: 0.25,
  shadowTerrain: 1,
  shadowSpacing: 4,
  shadowSink: 0.3,
  workerBuilds: 8,
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
  { key: "shadowTerrain", label: "Dune shadows from a coarse copy (0/1)", min: 0, max: 1, step: 1, group: "Performance", tip: "1: a coarse copy of the ground, never drawn, casts the dune shadows, and the drawn ground (chunks and the fine dent patch) only catches them (perf pass 1: the patch alone put 295k triangles in the shadow pass). 0: the drawn ground casts, as before" },
  { key: "shadowSpacing", label: "Shadow ground spacing (m)", min: 1, max: 16, step: 1, group: "Performance", onRelease: true, tip: "Vertex spacing of the coarse shadow copy (rounded to divide the chunk grid). Dune shadows are metres across; craters want 2-4 m" },
  { key: "shadowSink", label: "Shadow ground sunk (m)", min: 0, max: 2, step: 0.05, group: "Performance", tip: "The coarse copy sits this much lower, so where it would poke through the drawn ground (in hollows) it can't shade it with acne" },
  { key: "workerBuilds", label: "Chunks out at the sim worker", min: 1, max: 32, step: 1, group: "Performance", tip: "With the sim worker on (not ?noworker), how many chunk builds can be out at once (nearest first). Chunks near the focus are still built at once on the main thread when missing" },
];

/** Objects on this layer are drawn only into the sun's shadow map (the camera doesn't see it; src/world/look.ts lets the shadow camera). */
export const SHADOW_ONLY_LAYER = 3;
/** Patching: how far round a changed box the vertices are redone (m: normals read the ground 2 m round), and the grid
 *  queued patches merge on (m). Not feel: the ground looks the same either way. */
export const PATCH_PAD = 2.5;
const PATCH_CELL = 4;

interface Chunk {
  mesh: THREE.Mesh; water: THREE.Mesh | null; shadow: THREE.Mesh | null; cx: number; cz: number;
  /** The patch cache (flushPatches): per vertex, the ground without the dents at the points a vertex reads, filled as
   *  vertices are first patched (NaN: not yet). Dents are added on last (DuneField.sample), so a patch only re-reads them. */
  base?: Float32Array;
}
/**
 * A chunk being built over several frames (perf, Keith 2026-11-06: one chunk was ~25 ms on his PC, a dropped frame
 * whenever the convoy lab streamed one in). Rows are filled under the frame budget; j is the next row to fill. A patch
 * or rebuild over rows already filled winds j back to the first row it touched, so the finished chunk is the same as
 * one built in a single go.
 */
interface Building extends ChunkArrays { cx: number; cz: number; j: number; frames: number }

/**
 * Where chunk vertices are worked out off the main thread (the sim worker, src/sim/host.ts). Requests go in order with
 * the ground's changes, so each answer is the ground as it was when asked; answers come back through takeBuild and
 * takePatch in the same order.
 */
export interface TerrainRemote {
  build(req: { epoch: number; seq: number; cx: number; cz: number; n: number; size: number; water: boolean }): void;
  patch(req: { epoch: number; box: [number, number, number, number]; dentsOnly: boolean; n: number; size: number }): void;
}
/** A chunk built remotely. */
export interface BuildResult extends ChunkArrays { epoch: number; seq: number; cx: number; cz: number; n: number; size: number }
export interface PatchResult { epoch: number; box: [number, number, number, number]; dentsOnly: boolean; n: number; size: number; blocks: PatchBlock[] }
/** Chunks this close to the focus (chunk units) are always finished in the frame they're asked for, as are builds
 *  that have run this many frames (so a patched-over build can't starve). */
const BUILD_NOW_RADIUS = 1.5, BUILD_MAX_FRAMES = 30;
/** More chunks missing than this (a jump: the lab's start, a drop far out) and the first one a frame is built whole, as
 *  before (the ground catches up in a few seconds of slow frames rather than showing holes for longer); walking on
 *  brings in about a dozen at a time, built a few rows a frame. */
const CATCH_UP = 16;
/** Patch cache layout per vertex: h, h at ±e on x and z (normal), at ±2 m (the colour's wide normal), crest, flat, wr, ws, rock. */
/** out = (x, y, z) normalised, as DuneField.normal does it. */

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
  /**
   * Called with the box whenever ground is rebuilt or patched (rebuildArea, patchArea, flushPatches), or null for
   * rebuildAll. dentsOnly: only the dents changed there (flushPatches: craters).
   */
  readonly onRebuild: ((box: [number, number, number, number] | null, dentsOnly?: boolean) => void)[] = [];
  private c3 = new THREE.Color();
  private c4 = new THREE.Color();
  private dirty = new Set<string>();
  /** Chunks part built (missing ones and dirty ones being rebuilt), by key. */
  private building = new Map<string, Building>();
  /** Patching: chunks touched since the last finishPatch, those that now need a water sheet, cells queued by row. */
  private patched = new Map<string, Chunk>();
  private patchWater = new Set<string>();
  private patchRows = new Map<number, Set<number>>();
  private index: THREE.BufferAttribute | null = null;
  private indexSegments = -1;
  private shadowIndex: THREE.BufferAttribute | null = null;
  private shadowIndexN = -1;
  private shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  private shadowKey = "";
  /** Triangles in the coarse shadow copy and in the drawn chunks (for the perf notes). */
  readonly shadowStats = { proxyTris: 0, chunkTris: 0 };
  /** Bumped whenever a chunk is built, rebuilt or dropped (src/world/chunkGround.ts re-reads its cached chunk then). */
  version = 0;
  /**
   * Chunk vertices worked out elsewhere (the sim worker), or null: all here, as before. Chunks near the focus are still
   * built here at once when missing (the ground under the mech is never a hole).
   */
  remote: TerrainRemote | null = null;
  /** Remote builds asked for and not back yet, by key: the request's number, and whether its ground changed since. */
  private inflight = new Map<string, { seq: number; stale: boolean }>();
  private seq = 0;
  /** Bumped by rebuildAll: answers to older requests are dropped. */
  private epoch = 0;
  readonly remoteStats = { builds: 0, patches: 0, inflight: 0, applied: 0 };

  /** A loaded chunk's vertex positions and normals (local to its corner), or null when it isn't loaded. */
  chunkData(cx: number, cz: number): { pos: Float32Array; nor: Float32Array } | null {
    const c = this.chunks.get(cx + "," + cz);
    if (!c) return null;
    const g = c.mesh.geometry;
    return { pos: g.getAttribute("position").array as Float32Array, nor: g.getAttribute("normal").array as Float32Array };
  }

  /**
   * A loaded, up-to-date chunk vertex at coarse world index (i, j) (chunk grid units): height, normal and colour into
   * out (h, nx, ny, nz, r, g, b), as that chunk draws it. False when no such chunk is loaded or it waits on a rebuild.
   * The detail patch copies its edge grid from here instead of sampling the ground again (src/world/groundWindow.ts).
   */
  vertexAt(i: number, j: number, out: Float32Array): boolean {
    const n = Math.round(this.v.segments), cx = Math.floor(i / n), cz = Math.floor(j / n);
    const key = cx + "," + cz, c = this.chunks.get(key);
    if (!c || this.dirty.has(key) || this.inflight.has(key)) return false;
    const v = (j - cz * n) * (n + 1) + (i - cx * n), g = c.mesh.geometry;
    const pos = g.getAttribute("position").array, nor = g.getAttribute("normal").array, col = g.getAttribute("color").array;
    out[0] = pos[v * 3 + 1]; out[1] = nor[v * 3]; out[2] = nor[v * 3 + 1]; out[3] = nor[v * 3 + 2];
    out[4] = col[v * 3]; out[5] = col[v * 3 + 1]; out[6] = col[v * 3 + 2];
    return true;
  }

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
    // Outside the patch's hole. The chunks keep drawing half a metre into it: the patch's edge lies exactly on their
    // triangles but with more vertices (T-junctions), so a shared edge would open pixel cracks; the overlap hides them.
    const hc = vec4(this.hole);
    const mid = hc.xy.add(hc.zw).mul(0.5), halfW = hc.zw.sub(hc.xy).mul(0.5).sub(0.5);
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
    this.building.clear();
    this.inflight.clear();
    this.epoch++;
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
      const b = this.building.get(k);
      if (b) b.j = 0;
      const r = this.inflight.get(k);
      if (r) r.stale = true;
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
    // The coarse shadow copy: switched on or off, or a new spacing (rebuilt for every loaded chunk then).
    const sk = `${this.shadowOn}|${this.shadowStride()}`;
    if (sk !== this.shadowKey) {
      this.shadowKey = sk;
      for (const c of this.chunks.values()) this.makeShadow(c);
    }
    if (this.shadowOn) {
      const sink = this.v.shadowSink ?? 0.3;
      for (const c of this.chunks.values()) if (c.shadow) c.shadow.position.y = -sink, c.shadow.updateMatrix();
    }

    for (const [k, c] of this.chunks) {
      if (Math.hypot(c.cx - ccx, c.cz - ccz) > r + 1.5) { this.dispose(c); this.chunks.delete(k); this.dirty.delete(k); }
    }
    for (const [k, b] of this.building) if (Math.hypot(b.cx - ccx, b.cz - ccz) > r + 1.5) this.building.delete(k);
    for (const k of this.inflight.keys()) { const [x, z] = k.split(",").map(Number); if (Math.hypot(x - ccx, z - ccz) > r + 1.5) this.inflight.delete(k); }

    const missing: [number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > r + 0.5) continue;
      const cx = ccx + dx, cz = ccz + dz;
      if (!this.chunks.has(cx + "," + cz)) missing.push([d, cx, cz]);
    }
    missing.sort((a, b) => a[0] - b[0]);

    const t0 = performance.now(), end = t0 + this.v.budgetMs;
    let built = 0, worked = false;
    // Nearest first, rows under the budget (a chunk can take a few frames); one near the focus is always finished now,
    // so the ground under it is never missing, and the first one asked for always gets at least a row.
    const catchUp = missing.length > CATCH_UP;
    const remote = this.remote;
    for (const [d, cx, cz] of missing) {
      if (remote && d > BUILD_NOW_RADIUS) {
        // Asked of the worker (a few at a time, nearest first); the answer arrives through takeBuild.
        const k = cx + "," + cz;
        if (!this.inflight.has(k) && this.inflight.size < Math.max(1, Math.round(this.v.workerBuilds ?? 8))) this.ask(k, cx, cz);
        continue;
      }
      if (remote) this.inflight.delete(cx + "," + cz); // built here now: a late answer is dropped
      const now = d <= BUILD_NOW_RADIUS || (catchUp && !worked);
      if (worked && !now && performance.now() > end) break;
      const k = cx + "," + cz;
      const c = this.advance(k, cx, cz, now ? Infinity : end);
      worked = true;
      if (!c) continue;
      this.chunks.set(k, c);
      built++;
    }
    // Chunks whose ground changed: rebuilt in place (the old one draws until the new one is done), nearest first.
    if (this.dirty.size) {
      worked = false; // these get their row a frame too
      const order = [...this.dirty].map((k) => { const c = this.chunks.get(k); return { k, c, d: c ? Math.hypot(c.cx - ccx, c.cz - ccz) : 0 }; });
      order.sort((p, q) => p.d - q.d);
      for (const { k, c, d } of order) {
        if (remote) {
          // The old chunk draws until the worker's answer replaces it.
          if (!c) { this.dirty.delete(k); continue; }
          if (this.inflight.has(k) || this.inflight.size >= Math.max(1, Math.round(this.v.workerBuilds ?? 8))) continue;
          this.dirty.delete(k);
          this.ask(k, c.cx, c.cz);
          continue;
        }
        const now = d <= BUILD_NOW_RADIUS;
        if (worked && !now && performance.now() > end) break;
        if (!c) { this.dirty.delete(k); continue; }
        const fresh = this.advance(k, c.cx, c.cz, now ? Infinity : end);
        worked = true;
        if (!fresh) continue;
        this.dirty.delete(k);
        this.dispose(c);
        this.chunks.set(k, fresh);
        built++;
      }
    }
    this.stats.built = built;
    this.stats.buildMs = performance.now() - t0;
    this.stats.loaded = this.chunks.size;
    this.stats.pending = missing.length - built + this.dirty.size;
    this.remoteStats.inflight = this.inflight.size;
  }

  private ask(k: string, cx: number, cz: number) {
    const seq = ++this.seq;
    this.inflight.set(k, { seq, stale: false });
    this.remote!.build({ epoch: this.epoch, seq, cx, cz, n: Math.round(this.v.segments), size: this.v.chunkSize, water: this.field.waterLevel !== null });
    this.remoteStats.builds++;
  }

  /** A remotely built chunk is back: put it in (replacing the one it rebuilds), unless it was asked for long ago. */
  takeBuild(r: BuildResult) {
    const k = r.cx + "," + r.cz, ask = this.inflight.get(k);
    if (r.epoch !== this.epoch || !ask || ask.seq !== r.seq) return;
    this.inflight.delete(k);
    if (r.n !== Math.round(this.v.segments) || r.size !== this.v.chunkSize) return;
    const old = this.chunks.get(k);
    if (old) this.dispose(old);
    this.chunks.set(k, this.finishBuild({ ...r, j: r.n + 1, frames: 0 }));
    // Its ground changed while it was out (rebuildArea): again.
    if (ask.stale) this.dirty.add(k);
    this.remoteStats.applied++;
  }

  /** A remote patch is back: copy its vertices into the chunks loaded now, then tell the listeners (as patchBox does here). */
  takePatch(r: PatchResult) {
    if (r.epoch !== this.epoch || r.n !== Math.round(this.v.segments) || r.size !== this.v.chunkSize) return;
    const n = r.n, row = n + 1, water = this.field.waterLevel;
    for (const B of r.blocks) {
      const key = B.cx + "," + B.cz, ch = this.chunks.get(key);
      if (!ch) continue;
      ch.base = undefined;
      const g = ch.mesh.geometry;
      const pos = g.getAttribute("position").array as Float32Array, nor = g.getAttribute("normal").array as Float32Array, col = g.getAttribute("color").array as Float32Array;
      const wg = ch.water?.geometry;
      for (let j = B.j0, q = 0; j <= B.j1; j++) for (let k = B.k0; k <= B.k1; k++, q++) {
        const i = j * row + k, h = B.h[q];
        pos[i * 3 + 1] = h;
        nor[i * 3] = B.nor[q * 3]; nor[i * 3 + 1] = B.nor[q * 3 + 1]; nor[i * 3 + 2] = B.nor[q * 3 + 2];
        col[i * 3] = B.col[q * 3]; col[i * 3 + 1] = B.col[q * 3 + 1]; col[i * 3 + 2] = B.col[q * 3 + 2];
        const ws = B.ws[q];
        if (water !== null && ws > 0) {
          if (wg) this.waterVertex(wg, i, water, ws, h);
          else if (h - water < 0.3) this.patchWater.add(key);
        }
      }
      this.patched.set(key, ch);
      this.stats.patched += (B.k1 - B.k0 + 1) * (B.j1 - B.j0 + 1);
    }
    for (const f of this.onRebuild) f(r.box, r.dentsOnly);
    this.finishPatch();
    this.remoteStats.applied++;
  }

  /** Build every chunk within the radius now (for tests and first frames). */
  fill(fx: number, fz: number) {
    const b = this.v.budgetMs;
    this.v.budgetMs = 1e9;
    this.update(fx, fz);
    this.v.budgetMs = b;
  }

  /** One ground vertex from the chunk's patch cache plus the dents read now (src/world/chunkFill.ts groundVertexCached). */
  private vertexCached(ch: Chunk, i: number, x: number, z: number, s: GroundSample, nn: number[], tmp: THREE.Color) {
    const n = Math.round(this.v.segments);
    groundVertexCached(this.field, (ch.base ??= newPatchBase(n)), i, x, z, s, nn, tmp);
  }

  /** One ground vertex at (x, z): the sample into s, the normal into nn, the colour into tmp. */
  private vertex(x: number, z: number, s: GroundSample, nn: number[], tmp: THREE.Color) { groundVertex(this.field, x, z, s, nn, tmp); }

  /**
   * Update the loaded chunks' vertices inside a box in place (after the ground changed there, e.g. a crater): heights,
   * normals, colours and the water sheet's depth. Much cheaper than rebuilding whole chunks; a chunk that now needs a
   * water sheet it didn't have is queued for a rebuild instead. Returns the vertices touched. pad: how far round the box
   * to redo (normals and the colour's wide normal read the ground 2 m round each vertex).
   */
  patchArea(x0: number, z0: number, x1: number, z1: number, pad = PATCH_PAD): number {
    const count = this.patchBox(x0 - pad, z0 - pad, x1 + pad, z1 + pad);
    this.finishPatch();
    return count;
  }

  /**
   * Queue a changed box for flushPatches (perf, Keith 2026-11-01: the robots' trenches and slumping craters asked for
   * dozens of overlapping patches a frame, each redoing the same vertices and re-uploading the same chunks). The box,
   * padded as patchArea pads it, marks cells of a PATCH_CELL grid; the flush redoes each marked cell once.
   */
  queuePatch(x0: number, z0: number, x1: number, z1: number) {
    const C = PATCH_CELL;
    const a = Math.floor((x0 - PATCH_PAD) / C), b = Math.floor((x1 + PATCH_PAD) / C);
    const c = Math.floor((z0 - PATCH_PAD) / C), d = Math.floor((z1 + PATCH_PAD) / C);
    for (let iz = c; iz <= d; iz++) {
      let row = this.patchRows.get(iz);
      if (!row) { row = new Set(); this.patchRows.set(iz, row); }
      for (let ix = a; ix <= b; ix++) row.add(ix);
    }
  }

  /**
   * Patch every box queued since the last flush, each ground vertex once: runs of marked cells along each row, runs with
   * the same span on following rows joined into one rectangle, and each chunk finished (uploaded, bounds, shadow copy)
   * once. Cells are half-open, so a vertex on a shared edge is done by one of them only. Returns the vertices touched.
   */
  flushPatches(): number {
    if (!this.patchRows.size) return 0;
    const C = PATCH_CELL, eps = 1e-4;
    const rows = [...this.patchRows.keys()].sort((p, q) => p - q);
    // Open rectangles by span ("x0,x1" in cells): the first and last row they cover.
    let open = new Map<string, [number, number, number, number]>();
    let count = 0;
    const close = (r: [number, number, number, number]) => { count += this.patchBox(r[0] * C, r[2] * C, (r[1] + 1) * C - eps, (r[3] + 1) * C - eps, true); };
    for (const iz of rows) {
      const xs = [...this.patchRows.get(iz)!].sort((p, q) => p - q);
      const next = new Map<string, [number, number, number, number]>();
      for (let i = 0; i < xs.length;) {
        let j = i;
        while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
        const key = xs[i] + "," + xs[j], prev = open.get(key);
        if (prev && prev[3] === iz - 1) { prev[3] = iz; next.set(key, prev); open.delete(key); }
        else next.set(key, [xs[i], xs[j], iz, iz]);
        i = j + 1;
      }
      for (const r of open.values()) close(r);
      open = next;
    }
    for (const r of open.values()) close(r);
    this.patchRows.clear();
    this.finishPatch();
    return count;
  }

  /**
   * Redo the loaded chunks' vertices in a box (no padding); the chunks touched wait for finishPatch. cached: read the
   * ground under the dents from the chunk's patch cache (only when nothing but the dents changed since it was built:
   * craters, not the convoy's road; an uncached patch drops the chunk's cache, so the next cached one refills it).
   */
  private patchBox(x0: number, z0: number, x1: number, z1: number, cached = false): number {
    const size = this.v.chunkSize, n = Math.round(this.v.segments), step = size / n, row = n + 1;
    if (this.remote) {
      // To the worker; its answer (takePatch) copies the vertices in and tells the listeners then.
      this.remote.patch({ epoch: this.epoch, box: [x0, z0, x1, z1], dentsOnly: cached, n, size });
      this.remoteStats.patches++;
      return 0;
    }
    for (const f of this.onRebuild) f([x0, z0, x1, z1], cached);
    const a = Math.floor(x0 / size), b = Math.floor(x1 / size), c = Math.floor(z0 / size), d = Math.floor(z1 / size);
    const s: GroundSample = { h: 0, crest: 0, flat: 0 }, nn = [0, 1, 0], tmp = this.c4;
    const water = this.field.waterLevel;
    let count = 0;
    for (let cz = c; cz <= d; cz++) for (let cx = a; cx <= b; cx++) {
      const key = cx + "," + cz, ch = this.chunks.get(key);
      const bl = this.building.get(key);
      if (bl) {
        // Part built: rows from the first one this box touches are filled again.
        const j0 = Math.max(0, Math.ceil((z0 - cz * size) / step));
        if (j0 <= n && Math.ceil((x0 - cx * size) / step) <= n && Math.floor((x1 - cx * size) / step) >= 0 && Math.floor((z1 - cz * size) / step) >= 0) bl.j = Math.min(bl.j, j0);
      }
      if (!ch || this.dirty.has(key)) continue;
      const ox = cx * size, oz = cz * size;
      const k0 = Math.max(0, Math.ceil((x0 - ox) / step)), k1 = Math.min(n, Math.floor((x1 - ox) / step));
      const j0 = Math.max(0, Math.ceil((z0 - oz) / step)), j1 = Math.min(n, Math.floor((z1 - oz) / step));
      if (k0 > k1 || j0 > j1) continue;
      // Ground under the dents changed (the convoy's road): the patch cache no longer holds for this chunk.
      if (!cached) ch.base = undefined;
      const g = ch.mesh.geometry;
      const P = g.getAttribute("position") as THREE.BufferAttribute, Nm = g.getAttribute("normal") as THREE.BufferAttribute, Cl = g.getAttribute("color") as THREE.BufferAttribute;
      const pos = P.array as Float32Array, nor = Nm.array as Float32Array, col = Cl.array as Float32Array;
      const wg = ch.water?.geometry;
      for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const i = j * row + k;
        if (cached) this.vertexCached(ch, i, ox + k * step, oz + j * step, s, nn, tmp);
        else this.vertex(ox + k * step, oz + j * step, s, nn, tmp);
        pos[i * 3 + 1] = s.h;
        nor[i * 3] = nn[0]; nor[i * 3 + 1] = nn[1]; nor[i * 3 + 2] = nn[2];
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        const ws = s.ws ?? 0;
        if (water !== null && ws > 0) {
          if (wg) this.waterVertex(wg, i, water, ws, s.h);
          else if (s.h - water < 0.3) this.patchWater.add(key);
        }
        count++;
      }
      this.patched.set(key, ch);
    }
    this.stats.patched += count;
    return count;
  }

  /** Upload the chunks patched since the last call, once each: attributes, bounds, the shadow copy, the water sheet. */
  private finishPatch() {
    for (const [key, ch] of this.patched) {
      const g = ch.mesh.geometry;
      g.getAttribute("position").needsUpdate = true; g.getAttribute("normal").needsUpdate = true; g.getAttribute("color").needsUpdate = true;
      g.computeBoundingSphere();
      if (ch.shadow) this.makeShadow(ch);
      const wg = ch.water?.geometry;
      if (wg) for (const k of ["color", "depth", "fade"]) (wg.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
      if (this.patchWater.has(key)) this.dirty.add(key);
    }
    this.patched.clear();
    this.patchWater.clear();
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

  /** Carry on building chunk k until the deadline (performance.now() ms): the chunk when it's done, else null. */
  private advance(k: string, cx: number, cz: number, deadline: number): Chunk | null {
    let b = this.building.get(k);
    if (!b) { b = this.startBuild(cx, cz); this.building.set(k, b); }
    if (++b.frames > BUILD_MAX_FRAMES) deadline = Infinity;
    if (!this.fillRows(b, deadline)) return null;
    this.building.delete(k);
    return this.finishBuild(b);
  }

  private startBuild(cx: number, cz: number): Building {
    return { cx, cz, j: 0, frames: 0, ...chunkArrays(Math.round(this.v.segments), this.field.waterLevel !== null) };
  }

  /** Fill rows from b.j on, at least one, until the deadline; true when every row is filled. */
  private fillRows(b: Building, deadline: number): boolean {
    const n = Math.round(this.v.segments), size = this.v.chunkSize, row = n + 1;
    while (b.j < row) {
      fillChunkRows(this.field, b.cx, b.cz, n, size, b, b.j, b.j + 1);
      b.j++;
      if (b.j < row && performance.now() > deadline) return false;
    }
    return true;
  }

  private finishBuild(b: Building): Chunk {
    const n = Math.round(this.v.segments), size = this.v.chunkSize, step = size / n;
    const { cx, cz, pos, nor, col, hs, wsA } = b;
    const ox = cx * size, oz = cz * size;
    const water = this.field.waterLevel;
    let maxWs = 0;
    if (water !== null && wsA) for (let i = 0; i < hs.length; i++) { const ws = wsA[i]; if (ws > 0 && hs[i] - water < 0.3) maxWs = Math.max(maxWs, ws); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(this.sharedIndex(n));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    this.version++;
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    // Dunes cast shadows too (Keith 2026-10-24: a low sun should throw dune shadows), inside the sun's shadow box.
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    const waterMesh = water !== null && maxWs > 0 && wsA ? this.buildWater(ox, oz, n, step, water, wsA, hs) : null;
    const c: Chunk = { mesh, water: waterMesh, shadow: null, cx, cz };
    this.makeShadow(c);
    return c;
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

  private get shadowOn() { return (this.v.shadowTerrain ?? 0) > 0.5; }

  /** Every how many chunk vertices the shadow copy takes one: the spacing slider, rounded to divide the grid. */
  private shadowStride() {
    const n = Math.round(this.v.segments), step = this.v.chunkSize / n;
    let k = Math.max(1, Math.min(n, Math.round((this.v.shadowSpacing ?? 4) / step)));
    while (n % k) k--;
    return k;
  }

  /**
   * The chunk's coarse shadow copy (perf pass 1): every stride-th vertex of its grid, on SHADOW_ONLY_LAYER, so only the
   * sun's shadow map draws it; the chunk itself then only catches shadows. With the copy off, the chunk casts again.
   */
  private makeShadow(c: Chunk) {
    const on = this.shadowOn;
    c.mesh.castShadow = !on;
    if (!on) {
      if (c.shadow) { this.group.remove(c.shadow); c.shadow.geometry.setIndex(null); c.shadow.geometry.dispose(); c.shadow = null; }
      return;
    }
    const n = Math.round(this.v.segments), k = this.shadowStride(), m = n / k, row = n + 1, mr = m + 1;
    const src = c.mesh.geometry.getAttribute("position").array as Float32Array;
    let g = c.shadow?.geometry;
    let pos = g?.getAttribute("position")?.array as Float32Array | undefined;
    if (!g || !pos || pos.length !== mr * mr * 3) {
      if (c.shadow) { this.group.remove(c.shadow); c.shadow.geometry.setIndex(null); c.shadow.geometry.dispose(); }
      g = new THREE.BufferGeometry();
      pos = new Float32Array(mr * mr * 3);
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mr * mr * 3).map((_, q) => (q % 3 === 1 ? 1 : 0)), 3));
      g.setIndex(this.coarseIndex(m));
      const s = new THREE.Mesh(g, this.shadowMat);
      s.layers.set(SHADOW_ONLY_LAYER);
      s.castShadow = true; s.receiveShadow = false;
      s.position.set(c.mesh.position.x, -(this.v.shadowSink ?? 0.3), c.mesh.position.z);
      s.matrixAutoUpdate = false; s.updateMatrix();
      s.name = "terrain shadow copy";
      this.group.add(s);
      c.shadow = s;
    }
    for (let j = 0, i = 0; j <= m; j++) for (let q = 0; q <= m; q++, i++) {
      const v = (j * k) * row + q * k;
      pos[i * 3] = src[v * 3]; pos[i * 3 + 1] = src[v * 3 + 1]; pos[i * 3 + 2] = src[v * 3 + 2];
    }
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    g.computeBoundingSphere();
    this.shadowStats.proxyTris = m * m * 2;
    this.shadowStats.chunkTris = n * n * 2;
  }

  private coarseIndex(m: number) {
    if (this.shadowIndex && this.shadowIndexN === m) return this.shadowIndex;
    const row = m + 1, idx = new Uint16Array(m * m * 6);
    let p = 0;
    for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) {
      const a = j * row + k, b = a + 1, c = a + row, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    this.shadowIndex = new THREE.BufferAttribute(idx, 1);
    this.shadowIndexN = m;
    return this.shadowIndex;
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
    this.version++;
    if (c.shadow) { this.group.remove(c.shadow); c.shadow.geometry.setIndex(null); c.shadow.geometry.dispose(); c.shadow = null; }
    if (c.water) { this.group.remove(c.water); c.water.geometry.setIndex(null); c.water.geometry.dispose(); }
    this.group.remove(c.mesh);
    // The index is shared, so only drop the per-chunk attributes.
    const g = c.mesh.geometry;
    g.setIndex(null);
    g.dispose();
  }
}

