// The true ground around the focus, sampled for the detail patch (src/world/detailPatch.ts): a fine grid of heights
// (DuneField.height at every patch vertex, 25 cm apart by default) and a coarse grid on the chunks' own vertices
// (height, normal and colour exactly as a chunk builds them), so the patch can match the chunks at its edge.
// Pure CPU, no drawing, so it can be checked headless.
//
// Both grids are toroidal: a world grid index i is stored at i mod size, so following the focus only computes the
// rows and columns that come into view. Changed ground (the convoy road, craters) is refilled through invalidate().
import * as THREE from "three/webgpu";
import type { DuneField, GroundSample } from "./terrain";
import { groundColour } from "./groundColour";

interface Run { fine: boolean; j: number; i0: number; i1: number }

export class GroundWindow {
  /** Coarse step (the chunks' vertex spacing, m), fine steps per coarse step, and the fine step. */
  readonly step: number;
  readonly sub: number;
  readonly fine: number;
  /** Coarse cells across the window (even), fine cells across, and the storage sizes (vertices). */
  readonly nc: number;
  readonly nf: number;
  readonly mc: number;
  readonly mf: number;
  /** Coarse world index of the window's first vertex (x, z); the window spans [gc0, gc0 + nc]. */
  gx = 0; gz = 0;
  /** Fine heights (mf × mf). */
  readonly fineH: Float32Array;
  /** Coarse (mc × mc): height, normal x, y, z. */
  readonly coarse: Float32Array;
  /** Coarse (mc × mc): colour r, g, b (linear), 1. */
  readonly colour: Float32Array;
  /** Bumped whenever any sample changes (the patch re-uploads). */
  version = 0;
  /** False while a whole-window fill is still in progress (after a jump or a full rebuild): don't draw yet. */
  ready = false;
  readonly stats = { ms: 0, fineSamples: 0, coarseSamples: 0 };
  private valid = false;
  private full = false;
  private queue: Run[] = [];
  private s: GroundSample = { h: 0, crest: 0, flat: 0 };
  private nn = [0, 1, 0];
  private col = new THREE.Color();

  /** Fine steps per coarse step and coarse cells across, for a coverage, spacing and coarse step. */
  static shape(coverage: number, spacing: number, step: number) {
    return { sub: Math.max(1, Math.round(step / Math.max(0.01, spacing))), nc: Math.max(4, 2 * Math.round(coverage / step / 2)) };
  }

  constructor(readonly field: DuneField, coverage: number, spacing: number, step: number) {
    this.step = step;
    const sh = GroundWindow.shape(coverage, spacing, step);
    this.sub = sh.sub;
    this.fine = step / this.sub;
    this.nc = sh.nc;
    this.nf = this.nc * this.sub;
    this.mc = this.nc + 1;
    this.mf = this.nf + 1;
    this.fineH = new Float32Array(this.mf * this.mf);
    this.coarse = new Float32Array(this.mc * this.mc * 4);
    this.colour = new Float32Array(this.mc * this.mc * 4);
  }

  /** World bounds of the window (x0, z0, x1, z1). */
  bounds(): [number, number, number, number] {
    const s = this.step;
    return [this.gx * s, this.gz * s, (this.gx + this.nc) * s, (this.gz + this.nc) * s];
  }

  /** Move the window to centre on (x, z) and fill what came into view, within budgetMs (a jump fills over frames). */
  follow(x: number, z: number, budgetMs = 4) {
    const half = this.nc / 2;
    const gx = Math.round(x / this.step) - half, gz = Math.round(z / this.step) - half;
    if (!this.valid || Math.abs(gx - this.gx) >= this.nc || Math.abs(gz - this.gz) >= this.nc) {
      this.gx = gx; this.gz = gz;
      this.refillAll();
    } else if (gx !== this.gx || gz !== this.gz) {
      const ox = this.gx, oz = this.gz;
      this.gx = gx; this.gz = gz;
      // New columns (every row of the new window), then new rows (the full width).
      const c0 = gx > ox ? ox + this.nc + 1 : gx, c1 = gx > ox ? gx + this.nc : ox - 1;
      const r0 = gz > oz ? oz + this.nc + 1 : gz, r1 = gz > oz ? gz + this.nc : oz - 1;
      if (gx !== ox) for (let j = gz; j <= gz + this.nc; j++) this.addCoarse(j, c0, c1);
      if (gz !== oz) for (let j = r0; j <= r1; j++) this.addCoarse(j, gx, gx + this.nc);
      const S = this.sub;
      if (gx !== ox) for (let j = gz * S; j <= (gz + this.nc) * S; j++) this.queue.push({ fine: true, j, i0: c0 * S - (gx > ox ? S - 1 : 0), i1: c1 * S + (gx > ox ? 0 : S - 1) });
      if (gz !== oz) for (let j = r0 * S - (gz > oz ? S - 1 : 0); j <= r1 * S + (gz > oz ? 0 : S - 1); j++) this.queue.push({ fine: true, j, i0: gx * S, i1: (gx + this.nc) * S });
    }
    this.work(budgetMs);
  }

  /** The ground changed in a box (null: everywhere): refill what of it is in the window. */
  invalidate(box: [number, number, number, number] | null) {
    if (!box) { if (this.valid) this.refillAll(); return; }
    const s = this.step, S = this.sub;
    const ci0 = Math.max(this.gx, Math.floor(box[0] / s)), ci1 = Math.min(this.gx + this.nc, Math.ceil(box[2] / s));
    const cj0 = Math.max(this.gz, Math.floor(box[1] / s)), cj1 = Math.min(this.gz + this.nc, Math.ceil(box[3] / s));
    if (ci0 > ci1 || cj0 > cj1) return;
    for (let j = cj0; j <= cj1; j++) this.addCoarse(j, ci0, ci1);
    for (let j = cj0 * S; j <= cj1 * S; j++) this.queue.push({ fine: true, j, i0: ci0 * S, i1: ci1 * S });
  }

  /** Fill everything now (tests, first frame). */
  fillNow() { this.work(1e9); }

  private refillAll() {
    this.valid = true;
    this.full = true;
    this.ready = false;
    this.queue.length = 0;
    for (let j = this.gz; j <= this.gz + this.nc; j++) this.addCoarse(j, this.gx, this.gx + this.nc);
    for (let j = this.gz * this.sub; j <= (this.gz + this.nc) * this.sub; j++) this.queue.push({ fine: true, j, i0: this.gx * this.sub, i1: (this.gx + this.nc) * this.sub });
  }

  private addCoarse(j: number, i0: number, i1: number) { if (i1 >= i0) this.queue.push({ fine: false, j, i0, i1 }); }

  private work(budgetMs: number) {
    const t0 = performance.now();
    let any = false, fs = 0, cs = 0;
    while (this.queue.length) {
      if (any && performance.now() - t0 > budgetMs) break;
      const r = this.queue.shift()!;
      any = true;
      if (r.fine) fs += this.fillFine(r); else cs += this.fillCoarse(r);
    }
    if (any) this.version++;
    if (!this.queue.length && this.full) { this.full = false; }
    this.ready = this.valid && !this.full;
    this.stats.ms = performance.now() - t0;
    this.stats.fineSamples = fs;
    this.stats.coarseSamples = cs;
  }

  private fillFine(r: Run) {
    const S = this.sub, lo = this.gz * S, hi = (this.gz + this.nc) * S;
    if (r.j < lo || r.j > hi) return 0;
    const i0 = Math.max(r.i0, this.gx * S), i1 = Math.min(r.i1, (this.gx + this.nc) * S);
    const m = this.mf, row = mod(r.j, m) * m, f = this.fine, z = r.j * f;
    for (let i = i0; i <= i1; i++) this.fineH[row + mod(i, m)] = this.field.height(i * f, z);
    return Math.max(0, i1 - i0 + 1);
  }

  private fillCoarse(r: Run) {
    if (r.j < this.gz || r.j > this.gz + this.nc) return 0;
    const i0 = Math.max(r.i0, this.gx), i1 = Math.min(r.i1, this.gx + this.nc);
    const m = this.mc, row = mod(r.j, m) * m, st = this.step, z = r.j * st;
    const { s, nn, col } = this;
    for (let i = i0; i <= i1; i++) {
      const x = i * st, o = (row + mod(i, m)) * 4;
      this.field.sample(x, z, s);
      this.field.normal(x, z, nn);
      groundColour(this.field, x, z, s, col);
      this.coarse[o] = s.h; this.coarse[o + 1] = nn[0]; this.coarse[o + 2] = nn[1]; this.coarse[o + 3] = nn[2];
      this.colour[o] = col.r; this.colour[o + 1] = col.g; this.colour[o + 2] = col.b; this.colour[o + 3] = 1;
    }
    return Math.max(0, i1 - i0 + 1);
  }

  /** The fine height stored for fine world index (i, j) (for checks). */
  fineAt(i: number, j: number) { return this.fineH[mod(j, this.mf) * this.mf + mod(i, this.mf)]; }

  /** The patch's height at (x, z) away from its edge: bilinear between fine samples, as its triangles nearly draw it. */
  heightAt(x: number, z: number) {
    const f = this.fine, u = x / f, v = z / f, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    // The patch's triangles split each cell like the chunks (diagonal from (i+1, j) to (i, j+1)).
    const h00 = this.fineAt(i, j), h10 = this.fineAt(i + 1, j), h01 = this.fineAt(i, j + 1), h11 = this.fineAt(i + 1, j + 1);
    return a + b <= 1 ? h00 + a * (h10 - h00) + b * (h01 - h00) : h11 + (1 - a) * (h01 - h11) + (1 - b) * (h10 - h11);
  }

  /** How a chunk draws (x, z): its triangle between the coarse samples. */
  chunkHeightAt(x: number, z: number) {
    const s = this.step, u = x / s, v = z / s, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    const m = this.mc, at = (ii: number, jj: number) => this.coarse[(mod(jj, m) * m + mod(ii, m)) * 4];
    const h00 = at(i, j), h10 = at(i + 1, j), h01 = at(i, j + 1), h11 = at(i + 1, j + 1);
    return a + b <= 1 ? h00 + a * (h10 - h00) + b * (h01 - h00) : h11 + (1 - a) * (h01 - h11) + (1 - b) * (h10 - h11);
  }
}

export const mod = (a: number, m: number) => ((a % m) + m) % m;
