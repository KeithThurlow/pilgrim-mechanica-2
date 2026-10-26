// A cheap ground for looks (perf pass 1, 2026-10-26): heights and normals read off the streamed chunks' own vertices,
// on the same triangles the chunks draw, instead of the full height function (about 6 µs a call: noise octaves, dune
// sets, the crater layer). About 30 times cheaper, and exactly the drawn surface, so dust shadows and small robots'
// feet sit on what you see. Where no chunk is loaded it falls back to the true ground.
// For drawing only: feet, rounds, physics and anything with rules keep DuneField (the ground is a function).
import type { Ground } from "../mech/walker";
import type { TerrainStreamer } from "./chunks";

export class ChunkGround implements Ground {
  private cx = NaN;
  private cz = NaN;
  private ver = -1;
  private pos: Float32Array | null = null;
  private nor: Float32Array | null = null;
  private n = 1;
  private step = 1;
  private size = 1;
  /** Calls answered from a chunk / by the true ground (for the perf notes). */
  readonly stats = { hits: 0, misses: 0 };

  constructor(readonly streamer: TerrainStreamer, readonly exact: Ground) {}

  /** Point the cache at the chunk holding (x, z); false when it isn't loaded. Leaves the local coordinates in lx, lz. */
  private lx = 0;
  private lz = 0;
  private find(x: number, z: number): boolean {
    const st = this.streamer, size = st.v.chunkSize;
    const cx = Math.floor(x / size), cz = Math.floor(z / size);
    if (cx !== this.cx || cz !== this.cz || st.version !== this.ver || size !== this.size) {
      const d = st.chunkData(cx, cz);
      this.cx = cx; this.cz = cz; this.ver = st.version; this.size = size;
      this.n = Math.round(st.v.segments); this.step = size / this.n;
      this.pos = d ? d.pos : null; this.nor = d ? d.nor : null;
      // A chunk built with another grid (the slider just moved) until it is rebuilt: don't read it.
      if (d && d.pos.length !== (this.n + 1) * (this.n + 1) * 3) this.pos = this.nor = null;
    }
    if (!this.pos) return false;
    this.lx = x - cx * size; this.lz = z - cz * size;
    return true;
  }

  // The triangle under the point (split like the chunks': diagonal from (k + 1, j) to (k, j + 1)): its three vertex
  // indices and weights.
  private ia = 0; private ib = 0; private ic = 0;
  private wa = 0; private wb = 0; private wc = 0;
  private tri() {
    const n = this.n, row = n + 1;
    const fx = this.lx / this.step, fz = this.lz / this.step;
    const k = Math.min(n - 1, Math.max(0, Math.floor(fx))), j = Math.min(n - 1, Math.max(0, Math.floor(fz)));
    const u = fx - k, v = fz - j;
    const a = j * row + k, b = a + 1, c = a + row;
    if (u + v <= 1) { this.ia = a; this.ib = b; this.ic = c; this.wa = 1 - u - v; this.wb = u; this.wc = v; }
    else { this.ia = c + 1; this.ib = c; this.ic = b; this.wa = u + v - 1; this.wb = 1 - u; this.wc = 1 - v; }
  }

  height(x: number, z: number): number {
    if (!this.find(x, z)) { this.stats.misses++; return this.exact.height(x, z); }
    this.stats.hits++;
    this.tri();
    const P = this.pos!;
    return P[this.ia * 3 + 1] * this.wa + P[this.ib * 3 + 1] * this.wb + P[this.ic * 3 + 1] * this.wc;
  }

  /** The chunks' smooth vertex normals, blended across the triangle. */
  normal(x: number, z: number, out: number[] = [0, 1, 0]): number[] {
    if (!this.find(x, z)) { this.stats.misses++; return this.exact.normal(x, z, out); }
    this.stats.hits++;
    this.tri();
    const N = this.nor!, a = this.ia * 3, b = this.ib * 3, c = this.ic * 3, wa = this.wa, wb = this.wb, wc = this.wc;
    const nx = N[a] * wa + N[b] * wb + N[c] * wc, ny = N[a + 1] * wa + N[b + 1] * wb + N[c + 1] * wc, nz = N[a + 2] * wa + N[b + 2] * wb + N[c + 2] * wc;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }
}
