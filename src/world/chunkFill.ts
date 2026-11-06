// The terrain chunks' ground maths without the meshes (src/world/chunks.ts draws them): a chunk's vertices (height,
// normal, colour) and the vertices of a changed box, as plain typed arrays. Pure given the field, so the sim worker
// (src/sim/worker.ts) fills them from its copy of the ground and the main thread only copies them into geometry.
import { Color } from "three";
import type { DuneField, GroundSample } from "./terrain";
import { groundColour } from "./groundColour";

/** One ground vertex at (x, z): the sample into s, the normal into nn, the colour into tmp (as the chunks build it). */
export function groundVertex(field: DuneField, x: number, z: number, s: GroundSample, nn: number[], tmp: Color) {
  field.sample(x, z, s);
  field.normal(x, z, nn);
  groundColour(field, x, z, s, tmp);
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

/** The ground's vertices in a box, every chunk it covers (loaded or not: the caller copies what it has). */
export function patchBlocks(field: DuneField, x0: number, z0: number, x1: number, z1: number, n: number, size: number): PatchBlock[] {
  const out: PatchBlock[] = [], step = size / n;
  patchRanges(x0, z0, x1, z1, n, size, (cx, cz, k0, k1, j0, j1) => {
    const w = k1 - k0 + 1, m = w * (j1 - j0 + 1), ox = cx * size, oz = cz * size;
    const B: PatchBlock = { cx, cz, k0, k1, j0, j1, h: new Float32Array(m), nor: new Float32Array(m * 3), col: new Float32Array(m * 3), ws: new Float32Array(m) };
    for (let j = j0, q = 0; j <= j1; j++) for (let k = k0; k <= k1; k++, q++) {
      groundVertex(field, ox + k * step, oz + j * step, s0, n0, c0);
      B.h[q] = s0.h;
      B.nor[q * 3] = n0[0]; B.nor[q * 3 + 1] = n0[1]; B.nor[q * 3 + 2] = n0[2];
      B.col[q * 3] = c0.r; B.col[q * 3 + 1] = c0.g; B.col[q * 3 + 2] = c0.b;
      B.ws[q] = s0.ws ?? 0;
    }
    out.push(B);
  });
  return out;
}
