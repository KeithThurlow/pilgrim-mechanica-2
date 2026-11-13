// The terrain chunks' ground maths without the meshes (src/world/chunks.ts draws them): a chunk's vertices (height,
// normal, colour) and the vertices of a changed box, as plain typed arrays. Pure given the field, so the sim worker
// (src/sim/worker.ts) fills them from its copy of the ground and the main thread only copies them into geometry.
import { Color } from "three";
import { NORMAL_E, type DuneField, type GroundSample } from "./terrain";
import { groundColour } from "./groundColour";

/** One ground vertex at (x, z): the sample into s, the normal into nn, the colour into tmp (as the chunks build it). */
export function groundVertex(field: DuneField, x: number, z: number, s: GroundSample, nn: number[], tmp: Color) {
  field.sample(x, z, s);
  field.normal(x, z, nn);
  groundColour(field, x, z, s, tmp);
}

/**
 * The patch cache (perf, Keith 2026-11-01; shared with the sim worker 2026-11-13): per chunk vertex, the ground under
 * the dents (the sample and the eight heights the normal and the colour's wide normal read), so a patch after only the
 * dents changed (craters, their slump) reads the crater lattice instead of the dunes and every modifier again.
 */
const BASE_N = 14, WIDE_E = 2;
export const newPatchBase = (n: number) => new Float32Array((n + 1) * (n + 1) * BASE_N).fill(NaN);
const sb: GroundSample = { h: 0, crest: 0, flat: 0 }, wideN = [0, 1, 0];
function unit(out: number[], x: number, y: number, z: number) { const l = Math.hypot(x, y, z); out[0] = x / l; out[1] = y / l; out[2] = z / l; }

/**
 * One ground vertex as groundVertex works it out, from a chunk's patch cache B (vertex i) plus the dents read now: the
 * same sums in the same order, so the same ground (to float32 rounding of the cached heights). The cache fills on
 * first use; drop it when the ground under the dents changes (the convoy's road, a POI's pad).
 */
export function groundVertexCached(f: DuneField, B: Float32Array, i: number, x: number, z: number, s: GroundSample, nn: number[], tmp: Color) {
  const E = NORMAL_E, o = i * BASE_N;
  if (B[o] !== B[o]) {
    const dents = f.dents;
    f.dents = null;
    const q = f.sample(x, z, sb);
    B[o] = q.h; B[o + 9] = q.crest; B[o + 10] = q.flat; B[o + 11] = q.wr ?? 0; B[o + 12] = q.ws ?? 0; B[o + 13] = q.rock ?? 0;
    B[o + 1] = f.height(x + E, z); B[o + 2] = f.height(x - E, z); B[o + 3] = f.height(x, z + E); B[o + 4] = f.height(x, z - E);
    B[o + 5] = f.height(x + WIDE_E, z); B[o + 6] = f.height(x - WIDE_E, z); B[o + 7] = f.height(x, z + WIDE_E); B[o + 8] = f.height(x, z - WIDE_E);
    f.dents = dents;
  }
  const D = f.dents, at = (px: number, pz: number) => (D ? D.at(px, pz) : 0);
  s.h = B[o] + at(x, z); s.crest = B[o + 9]; s.flat = B[o + 10]; s.wr = B[o + 11]; s.ws = B[o + 12]; s.rock = B[o + 13];
  unit(nn, -((B[o + 1] + at(x + E, z)) - (B[o + 2] + at(x - E, z))), 2 * E, -((B[o + 3] + at(x, z + E)) - (B[o + 4] + at(x, z - E))));
  unit(wideN, -((B[o + 5] + at(x + WIDE_E, z)) - (B[o + 6] + at(x - WIDE_E, z))), 2 * WIDE_E, -((B[o + 7] + at(x, z + WIDE_E)) - (B[o + 8] + at(x, z - WIDE_E))));
  groundColour(f, x, z, s, tmp, wideN);
}

/**
 * The sim worker's patch caches, one per chunk it has patched after a dents-only change (the main thread keeps its own
 * on each loaded chunk, for ?noworker). Dropped as the main thread drops its: a chunk's cache when the chunk is built
 * again or a patch that isn't dents-only touches it, all of them on a new epoch. The least lately used go past `max`
 * chunks (about 240 KB each at 64 segments).
 */
export class PatchCache {
  private map = new Map<string, Float32Array>();
  private epoch = -1;
  constructor(private max = 64) {}

  /** The cache of chunk (cx, cz) at n segments, made if it isn't there. */
  base(cx: number, cz: number, n: number): Float32Array {
    const k = cx + "," + cz;
    let B = this.map.get(k);
    if (B && B.length !== (n + 1) * (n + 1) * BASE_N) B = undefined;
    if (B) this.map.delete(k);
    else {
      B = newPatchBase(n);
      if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(k, B);
    return B;
  }

  drop(cx: number, cz: number) { this.map.delete(cx + "," + cz); }

  /** A request's epoch: a new one (the ground rebuilt everywhere) drops every cache. */
  seen(epoch: number) { if (epoch !== this.epoch) { this.epoch = epoch; this.map.clear(); } }

  get size() { return this.map.size; }
}

/** A chunk's vertex arrays (local to its corner; (n + 1)² vertices). wsA: the shallows' weight, when there is water. */
export interface ChunkArrays {
  pos: Float32Array; nor: Float32Array; col: Float32Array; hs: Float32Array; wsA: Float32Array | null;
}

export function chunkArrays(n: number, water: boolean): ChunkArrays {
  const count = (n + 1) * (n + 1);
  return {
    pos: new Float32Array(count * 3), nor: new Float32Array(count * 3), col: new Float32Array(count * 3),
    hs: new Float32Array(count), wsA: water ? new Float32Array(count) : null,
  };
}

const s0: GroundSample = { h: 0, crest: 0, flat: 0 }, n0 = [0, 1, 0], c0 = new Color();

/** Fill rows [j0, j1) of chunk (cx, cz) (size m, n segments). */
export function fillChunkRows(field: DuneField, cx: number, cz: number, n: number, size: number, a: ChunkArrays, j0: number, j1: number) {
  const step = size / n, row = n + 1, ox = cx * size, oz = cz * size;
  const { pos, nor, col, hs, wsA } = a;
  for (let j = j0; j < j1; j++) {
    for (let k = 0, i = j * row; k < row; k++, i++) {
      groundVertex(field, ox + k * step, oz + j * step, s0, n0, c0);
      pos[i * 3] = k * step; pos[i * 3 + 1] = s0.h; pos[i * 3 + 2] = j * step;
      nor[i * 3] = n0[0]; nor[i * 3 + 1] = n0[1]; nor[i * 3 + 2] = n0[2];
      col[i * 3] = c0.r; col[i * 3 + 1] = c0.g; col[i * 3 + 2] = c0.b;
      if (wsA) wsA[i] = s0.ws ?? 0;
      hs[i] = s0.h;
    }
  }
}

/**
 * The vertices of chunk (cx, cz) inside a box, k0..k1 by j0..j1 (inclusive, local indices): per vertex h, the normal,
 * the colour and the shallows' weight.
 */
export interface PatchBlock {
  cx: number; cz: number; k0: number; k1: number; j0: number; j1: number;
  h: Float32Array; nor: Float32Array; col: Float32Array; ws: Float32Array;
}

/** Each chunk's vertex range a box (no padding) covers, as TerrainStreamer's patch walks them. */
export function patchRanges(x0: number, z0: number, x1: number, z1: number, n: number, size: number, fn: (cx: number, cz: number, k0: number, k1: number, j0: number, j1: number) => void) {
  const step = size / n;
  const a = Math.floor(x0 / size), b = Math.floor(x1 / size), c = Math.floor(z0 / size), d = Math.floor(z1 / size);
  for (let cz = c; cz <= d; cz++) for (let cx = a; cx <= b; cx++) {
    const ox = cx * size, oz = cz * size;
    const k0 = Math.max(0, Math.ceil((x0 - ox) / step)), k1 = Math.min(n, Math.floor((x1 - ox) / step));
    const j0 = Math.max(0, Math.ceil((z0 - oz) / step)), j1 = Math.min(n, Math.floor((z1 - oz) / step));
    if (k0 > k1 || j0 > j1) continue;
    fn(cx, cz, k0, k1, j0, j1);
  }
}

/**
 * The ground's vertices in a box, every chunk it covers (loaded or not: the caller copies what it has). cache: the sim
 * worker's patch caches, read when dentsOnly (only the dents changed in the box), dropped for the chunks touched when not.
 */
export function patchBlocks(field: DuneField, x0: number, z0: number, x1: number, z1: number, n: number, size: number, cache?: PatchCache, dentsOnly = false): PatchBlock[] {
  const out: PatchBlock[] = [], step = size / n;
  patchRanges(x0, z0, x1, z1, n, size, (cx, cz, k0, k1, j0, j1) => {
    const w = k1 - k0 + 1, m = w * (j1 - j0 + 1), ox = cx * size, oz = cz * size;
    // Only the dents changed: from the chunk's patch cache. Else the ground under them did: its cache no longer holds.
    const base = cache && dentsOnly ? cache.base(cx, cz, n) : null;
    if (cache && !dentsOnly) cache.drop(cx, cz);
    const B: PatchBlock = { cx, cz, k0, k1, j0, j1, h: new Float32Array(m), nor: new Float32Array(m * 3), col: new Float32Array(m * 3), ws: new Float32Array(m) };
    for (let j = j0, q = 0; j <= j1; j++) for (let k = k0; k <= k1; k++, q++) {
      if (base) groundVertexCached(field, base, j * (n + 1) + k, ox + k * step, oz + j * step, s0, n0, c0);
      else groundVertex(field, ox + k * step, oz + j * step, s0, n0, c0);
      B.h[q] = s0.h;
      B.nor[q * 3] = n0[0]; B.nor[q * 3 + 1] = n0[1]; B.nor[q * 3 + 2] = n0[2];
      B.col[q * 3] = c0.r; B.col[q * 3 + 1] = c0.g; B.col[q * 3 + 2] = c0.b;
      B.ws[q] = s0.ws ?? 0;
    }
    out.push(B);
  });
  return out;
}
