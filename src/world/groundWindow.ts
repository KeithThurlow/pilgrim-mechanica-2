// The true ground around the focus, sampled for the detail patch (src/world/detailPatch.ts): a fine grid of heights
// (DuneField.height at every patch vertex, 25 cm apart by default) and a coarse grid on the chunks' own vertices
// (height, normal and colour exactly as a chunk builds them), so the patch can match the chunks at its edge.
// Pure CPU, no drawing, so it can be checked headless.
//
// Both grids are toroidal: a world grid index i is stored at i mod size, so following the focus only computes the
// rows and columns that come into view. Changed ground (the convoy road, craters) is refilled through invalidate().
//
// The window stores a lead of `pad` coarse cells round what the patch draws, filled ahead under the budget, so rows
// are ready before they come into view (Keith 2026-10-31: walking north by the convoy, the top of the patch showed
// rows of ground from the far side of the window, metres off, while the plough's refills held the queue). Anything the
// lead hasn't reached when it comes into view is filled that frame, whatever the budget. Refills of changed ground
// wait on the budget behind the lead, merged per row so the plough's overlapping boxes sample each row once.
import * as THREE from "three/webgpu";
import type { DuneField, GroundSample } from "./terrain";
import { groundColour } from "./groundColour";

interface Run { fine: boolean; j: number; i0: number; i1: number }

export class GroundWindow {
  /** Coarse step (the chunks' vertex spacing, m), fine steps per coarse step, and the fine step. */
  readonly step: number;
  readonly sub: number;
  readonly fine: number;
  /** Coarse cells across the drawn window (even), fine cells across, and the storage sizes (vertices, lead included). */
  readonly nc: number;
  readonly nf: number;
  readonly mc: number;
  readonly mf: number;
  /** Coarse cells stored ahead of the drawn window on every side (filled under the budget before they're drawn). */
  readonly pad: number;
  /** Coarse world index of the drawn window's first vertex (x, z); it spans [gx, gx + nc], storage [gx - pad, gx + nc + pad]. */
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
  readonly stats = { ms: 0, fineSamples: 0, coarseSamples: 0, viewSamples: 0 };
  private valid = false;
  private full = false;
  private queue: Run[] = [];
  /** Rows of ground already in view that changed: fine and coarse world row -> the span to refill (merged). */
  private dirtyFine = new Map<number, [number, number]>();
  private dirtyCoarse = new Map<number, [number, number]>();
  private s: GroundSample = { h: 0, crest: 0, flat: 0 };
  private nn = [0, 1, 0];
  private col = new THREE.Color();
  private got = new Float32Array(7);
  /**
   * Where the coarse grid can be copied from instead of sampled: the chunks' own vertex at coarse world index (i, j)
   * (h, normal, colour into out), false when there is none. A coarse sample costs about eight fine ones.
   */
  coarseSource: ((i: number, j: number, out: Float32Array) => boolean) | null = null;

  /** Fine steps per coarse step and coarse cells across, for a coverage, spacing and coarse step. */
  static shape(coverage: number, spacing: number, step: number) {
    return { sub: Math.max(1, Math.round(step / Math.max(0.01, spacing))), nc: Math.max(4, 2 * Math.round(coverage / step / 2)) };
  }

  constructor(readonly field: DuneField, coverage: number, spacing: number, step: number, pad = 0) {
    this.step = step;
    this.pad = Math.max(0, Math.round(pad));
    const sh = GroundWindow.shape(coverage, spacing, step);
    this.sub = sh.sub;
    this.fine = step / this.sub;
    this.nc = sh.nc;
    this.nf = this.nc * this.sub;
    this.mc = this.nc + 1 + 2 * this.pad;
    this.mf = this.nf + 1 + 2 * this.pad * this.sub;
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
    // The very first fill happens at once (a start-up hitch, like the chunks' fill), so the patch is there from frame one.
    if (!this.valid) budgetMs = 1e9;
    const half = this.nc / 2, P = this.pad, W = this.nc + 2 * P;
    const gx = Math.round(x / this.step) - half, gz = Math.round(z / this.step) - half;
    this.stats.viewSamples = 0;
    if (!this.valid || Math.abs(gx - this.gx) >= W || Math.abs(gz - this.gz) >= W) {
      this.gx = gx; this.gz = gz;
      this.refillAll();
    } else if (gx !== this.gx || gz !== this.gz) {
      const ox = this.gx, oz = this.gz;
      this.gx = gx; this.gz = gz;
      // New stored columns (every stored row), then new stored rows (the full stored width), queued ahead of the rest.
      const c0 = gx > ox ? ox + this.nc + P + 1 : gx - P, c1 = gx > ox ? gx + this.nc + P : ox - P - 1;
      const r0 = gz > oz ? oz + this.nc + P + 1 : gz - P, r1 = gz > oz ? gz + this.nc + P : oz - P - 1;
      const S = this.sub, lead: Run[] = [];
      if (gx !== ox) for (let j = gz - P; j <= gz + this.nc + P; j++) lead.push({ fine: false, j, i0: c0, i1: c1 });
      if (gz !== oz) for (let j = r0; j <= r1; j++) lead.push({ fine: false, j, i0: gx - P, i1: gx + this.nc + P });
      if (gx !== ox) for (let j = (gz - P) * S; j <= (gz + this.nc + P) * S; j++) lead.push({ fine: true, j, i0: c0 * S - (gx > ox ? S - 1 : 0), i1: c1 * S + (gx > ox ? 0 : S - 1) });
      if (gz !== oz) for (let j = r0 * S - (gz > oz ? S - 1 : 0); j <= r1 * S + (gz > oz ? 0 : S - 1); j++) lead.push({ fine: true, j, i0: (gx - P) * S, i1: (gx + this.nc + P) * S });
      this.queue.unshift(...lead);
      // Whatever is drawn now and not filled yet is filled now (it would show the far side of the old window).
      if (!this.full) this.fillDrawn();
    }
    this.work(budgetMs);
  }

  /** Fill every queued run that reaches into the drawn window, at once. */
  private fillDrawn() {
    const S = this.sub, gx = this.gx, gz = this.gz, nc = this.nc;
    let n = 0, k = 0;
    for (const r of this.queue) {
      const m = r.fine ? S : 1;
      if (r.j >= gz * m && r.j <= (gz + nc) * m && r.i1 >= gx * m && r.i0 <= (gx + nc) * m) n += r.fine ? this.fillFine(r) : this.fillCoarse(r);
      else this.queue[k++] = r;
    }
    this.queue.length = k;
    if (n) this.version++;
    this.stats.viewSamples = n;
  }

  /** The ground changed in a box (null: everywhere): refill what of it is in the window. */
  invalidate(box: [number, number, number, number] | null) {
    if (!box) { if (this.valid) this.refillAll(); return; }
    const s = this.step, S = this.sub, P = this.pad;
    const ci0 = Math.max(this.gx - P, Math.floor(box[0] / s)), ci1 = Math.min(this.gx + this.nc + P, Math.ceil(box[2] / s));
    const cj0 = Math.max(this.gz - P, Math.floor(box[1] / s)), cj1 = Math.min(this.gz + this.nc + P, Math.ceil(box[3] / s));
    if (ci0 > ci1 || cj0 > cj1) return;
    if (this.full) {
      // A whole-window fill is under way: rows it hasn't reached yet pick the change up anyway, but refill the box too.
      for (let j = cj0; j <= cj1; j++) this.addCoarse(j, ci0, ci1);
      for (let j = cj0 * S; j <= cj1 * S; j++) this.queue.push({ fine: true, j, i0: ci0 * S, i1: ci1 * S });
      return;
    }
    for (let j = cj0; j <= cj1; j++) merge(this.dirtyCoarse, j, ci0, ci1);
    for (let j = cj0 * S; j <= cj1 * S; j++) merge(this.dirtyFine, j, ci0 * S, ci1 * S);
  }

  /** Rows waiting on the budget (whole-window fill runs plus changed rows). */
  get backlog() { return this.queue.length + this.dirtyFine.size + this.dirtyCoarse.size; }

  /** Fill everything now (tests, first frame). */
  fillNow() { this.work(1e9); }

  private refillAll() {
    this.valid = true;
    this.full = true;
    this.ready = false;
    this.queue.length = 0;
    this.dirtyFine.clear(); this.dirtyCoarse.clear();
    const P = this.pad, S = this.sub, x0 = this.gx - P, x1 = this.gx + this.nc + P, z0 = this.gz - P, z1 = this.gz + this.nc + P;
    for (let j = z0; j <= z1; j++) this.addCoarse(j, x0, x1);
    for (let j = z0 * S; j <= z1 * S; j++) this.queue.push({ fine: true, j, i0: x0 * S, i1: x1 * S });
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
    // Changed rows, coarse first (the patch's edge and the chunks' match), each row once with its merged span.
    for (const [map, fine] of [[this.dirtyCoarse, false], [this.dirtyFine, true]] as const) {
      for (const [j, sp] of map) {
        if (any && performance.now() - t0 > budgetMs) break;
        map.delete(j);
        any = true;
        const r = { fine, j, i0: sp[0], i1: sp[1] };
        if (fine) fs += this.fillFine(r); else cs += this.fillCoarse(r);
      }
    }
    if (any) this.version++;
    if (!this.queue.length && this.full) { this.full = false; }
    this.ready = this.valid && !this.full;
    this.stats.ms = performance.now() - t0;
    this.stats.fineSamples = fs;
    this.stats.coarseSamples = cs;
  }

  private fillFine(r: Run) {
    const S = this.sub, P = this.pad, lo = (this.gz - P) * S, hi = (this.gz + this.nc + P) * S;
    if (r.j < lo || r.j > hi) return 0;
    const i0 = Math.max(r.i0, (this.gx - P) * S), i1 = Math.min(r.i1, (this.gx + this.nc + P) * S);
    const m = this.mf, row = mod(r.j, m) * m, f = this.fine, z = r.j * f;
    for (let i = i0; i <= i1; i++) this.fineH[row + mod(i, m)] = this.field.height(i * f, z);
    return Math.max(0, i1 - i0 + 1);
  }

  private fillCoarse(r: Run) {
    const P = this.pad;
    if (r.j < this.gz - P || r.j > this.gz + this.nc + P) return 0;
    const i0 = Math.max(r.i0, this.gx - P), i1 = Math.min(r.i1, this.gx + this.nc + P);
    const m = this.mc, row = mod(r.j, m) * m, st = this.step, z = r.j * st;
    const { s, nn, col, got } = this, src = this.coarseSource;
    for (let i = i0; i <= i1; i++) {
      const x = i * st, o = (row + mod(i, m)) * 4;
      if (src && src(i, r.j, got)) {
        this.coarse[o] = got[0]; this.coarse[o + 1] = got[1]; this.coarse[o + 2] = got[2]; this.coarse[o + 3] = got[3];
        this.colour[o] = got[4]; this.colour[o + 1] = got[5]; this.colour[o + 2] = got[6]; this.colour[o + 3] = 1;
        continue;
      }
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

/** Widen row j's span in a dirty map to cover [i0, i1]. */
function merge(map: Map<number, [number, number]>, j: number, i0: number, i1: number) {
  const sp = map.get(j);
  if (sp) { if (i0 < sp[0]) sp[0] = i0; if (i1 > sp[1]) sp[1] = i1; } else map.set(j, [i0, i1]);
}

export const mod = (a: number, m: number) => ((a % m) + m) % m;
