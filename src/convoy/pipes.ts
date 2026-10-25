// Procedural pipe runs that make the convoy's platforms look technical (Keith 2026-10-24). Pure, seeded, no rendering:
// the same platform and seed give the same pipes every load; pipesDraw.ts turns them into one merged mesh.
//
// The idea comes from the old project's Blender greebler and crash-wreck dresser (tools/blender/buildings/greeble.py,
// wrecks/crash_dress.py, stock.py pipe_run), not its code:
// - pipes come in bundles of mixed sizes laid side by side, every other one lifted off the surface a little;
// - a bracket strap ties the bundle back to its wall every metre or so, a flange ring every few metres, now and then
//   a valve;
// - risers run up a wall from a junction box (or straight off the deck) and turn over the top edge onto the roof with
//   an elbow;
// - long runs follow the walls (here the chassis skirts and the deck edge), broken into lengths with gaps;
// - cross runs link one machine to another, low along the deck or up and over;
// - every run is tried at a few spots until its box clears what's already placed (furniture and earlier runs);
// - pipes are drawn thicker than life (pipeScale) so they read from the game camera.
// Frame: the platform's local frame (x left, y up, z forward), y = 0 on the ground plane.
import type { Param } from "../core/tweaks";
import { outside, sideSpan, type Outline } from "./outline";
import type { Box } from "./furniture";

export const PIPE_DEFAULTS = {
  pipeDensity: 1,
  pipeSeed: 7,
  pipeScale: 1.7,
};
export type PipeValues = typeof PIPE_DEFAULTS;

export const PIPE_PARAMS: Param[] = [
  { key: "pipeDensity", label: "Pipe density", min: 0, max: 3, step: 0.05, group: "Pipes", tip: "How many pipe runs the platforms get (0 = none)", onRelease: true },
  { key: "pipeSeed", label: "Pipe seed", min: 1, max: 99, step: 1, group: "Pipes", tip: "A different layout of the same rules", onRelease: true },
  { key: "pipeScale", label: "Pipe thickness ×", min: 0.5, max: 3, step: 0.05, group: "Pipes", tip: "Pipes are drawn thicker than life so they read from the game camera", onRelease: true },
];

export type V3 = [number, number, number];
/** One straight length of pipe. tone: 0 steel, 1 rust, 2 dark, 3 ochre (the drawer picks the colours). */
export interface PipeTube { a: V3; b: V3; r: number; tone: number }
/** A fitting: a strap across a bundle (`w` wide), a flange ring, a valve, a junction box, an elbow at a bend. */
export interface PipeBit { kind: "bracket" | "flange" | "valve" | "box" | "elbow"; at: V3; axis: V3; across: V3; size: number; w: number }
export interface PipeSet { tubes: PipeTube[]; bits: PipeBit[]; runs: number; boxes: Box[] }

/** What the generator needs to know about a platform. */
export interface PipeSite {
  length: number;
  width: number;
  /** Deck top above the ground plane. */
  deck: number;
  /** Things to run pipes up (walls) and round. */
  mounts: Box[];
  /** Things to keep pipes out of (rails' gaps, landing towers, vehicles). */
  keepOut: Box[];
  /** People and the mech walk the deck: no runs across it, only along its edges and up walls. */
  walkable: boolean;
  /** Index in the convoy, mixed into the seed. */
  index: number;
  /** The deck's outline when its corners are cut: edge runs keep to the straight sides, risers to inside it. */
  outline?: Outline;
}

/** Pipe radii (m) before pipeScale. */
const SIZES = [0.045, 0.07, 0.1, 0.14];
/** Pipe centre off the wall (m, before scale). */
const OFF = 0.12;

/** mulberry32: a small seeded random. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function overlaps(a: Box, b: Box, pad = 0) {
  return Math.abs(a.x - b.x) < a.hx + b.hx + pad && Math.abs(a.y - b.y) < a.hy + b.hy + pad && Math.abs(a.z - b.z) < a.hz + b.hz + pad;
}

/** The box round a polyline, widened by r sideways (and up and down). */
function runBox(pts: V3[], r: number): Box {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2 + r, hy: (y1 - y0) / 2 + r, hz: (z1 - z0) / 2 + r };
}

/** Lays pipe runs on one platform, keeping track of what's taken. */
class Layer {
  readonly set: PipeSet = { tubes: [], bits: [], runs: 0, boxes: [] };
  constructor(readonly site: PipeSite, readonly v: PipeValues, readonly rand: () => number) {}

  get k() { return this.v.pipeScale; }

  /** Is this run's box clear of the furniture (except `own`, the wall it hangs on) and the runs already laid? */
  clear(b: Box, own: Box[] = [], pad = 0.05) {
    for (const m of this.site.mounts) if (!own.includes(m) && overlaps(b, m, pad)) return false;
    for (const m of this.site.keepOut) if (overlaps(b, m, pad)) return false;
    for (const m of this.set.boxes) if (overlaps(b, m, pad)) return false;
    return true;
  }

  /** A bundle's sizes (indices into SIZES), biggest first. */
  sizes(max: number): number[] {
    const n = 1 + Math.floor(this.rand() * max);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(Math.min(3, Math.floor(this.rand() * (i === 0 ? 4 : 3))));
    return out.sort((a, b) => b - a);
  }

  /** Room a bundle of these sizes takes either side of its centre line. */
  half(sizes: number[]) { return ((sizes.length - 1) / 2) * this.spread(sizes) + SIZES[sizes[0]] * this.k; }
  spread(sizes: number[]) { return (SIZES[sizes[0]] * 2 + 0.08) * this.k; }

  /**
   * Lay a bundle along a polyline. `across`: the axis the pipes sit side by side on (in the surface); `lift`: out of
   * the surface (every other pipe is lifted a little, and the straps sit just under the bundle).
   */
  bundle(pts: V3[], sizes: number[], across: V3, lift: V3, opts: { brackets?: boolean; flanges?: boolean; valves?: boolean } = {}) {
    const k = this.k, sp = this.spread(sizes), n = sizes.length, tone = Math.floor(this.rand() * 4);
    for (let j = 0; j < n; j++) {
      const off = add(add([0, 0, 0], across, (j - (n - 1) / 2) * sp), lift, 0.45 * sp * (j % 2));
      const r = SIZES[sizes[j]] * k;
      const q = pts.map((p) => add(p, off));
      for (let i = 0; i < q.length - 1; i++) this.set.tubes.push({ a: q[i], b: q[i + 1], r, tone: (tone + (j === 1 ? 1 : 0)) % 4 });
      // Elbows at the bends.
      for (let i = 1; i < q.length - 1; i++) this.set.bits.push({ kind: "elbow", at: q[i], axis: unit(sub(q[i + 1], q[i])), across, size: r * 1.25, w: 0 });
    }
    const w = (n - 1) * sp + 2 * SIZES[sizes[0]] * k + 0.1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], d = sub(pts[i + 1], a), L = len(d), dir = unit(d);
      if (opts.brackets !== false) for (let s = 0.6; s < L - 0.3; s += 1 + this.rand() * 0.4) {
        this.set.bits.push({ kind: "bracket", at: add(add(a, dir, s), lift, -SIZES[sizes[0]] * k), axis: dir, across, size: 0.05 * k, w });
      }
      if (opts.flanges !== false) for (let s = 1.3; s < L - 0.6; s += 2.6) {
        for (let j = 0; j < n; j++) {
          const off = add(add([0, 0, 0], across, (j - (n - 1) / 2) * sp), lift, 0.45 * sp * (j % 2));
          this.set.bits.push({ kind: "flange", at: add(add(a, dir, s), off), axis: dir, across, size: SIZES[sizes[j]] * k * 1.45, w: 0.06 * k });
        }
      }
      if (opts.valves && L > 2.5 && this.rand() < 0.35) {
        this.set.bits.push({ kind: "valve", at: add(add(a, dir, L * (0.3 + this.rand() * 0.4)), across, -((n - 1) / 2) * sp), axis: dir, across: lift, size: SIZES[sizes[0]] * k, w: 0 });
      }
    }
    const b = runBox(pts, this.half(sizes) + 0.1);
    this.set.boxes.push(b);
    this.set.runs++;
  }

  /** The straight stretch of the long sides (z from, to), `end` m in from the ends or the corner cuts. */
  private span(end: number): [number, number] {
    const L = this.site.length;
    if (!this.site.outline) return [-L / 2 + end, L / 2 - end];
    const [a, b] = sideSpan(this.site.outline);
    return [Math.max(-L / 2 + end, a + 0.3), Math.min(L / 2 - end, b - 0.3)];
  }

  /** A point (x, z) at least m in from the deck's edge. */
  private onDeck(x: number, z: number, m: number) {
    if (this.site.outline) return outside(this.site.outline, x, z) < -m;
    return Math.abs(x) + m <= this.site.width / 2 && Math.abs(z) + m <= this.site.length / 2;
  }

  /** Bundles along the outside of both chassis skirts, broken into lengths with gaps. */
  skirts() {
    const { width: W, deck: D } = this.site;
    const p = Math.min(0.95, 0.3 + 0.35 * this.v.pipeDensity);
    const [zLo, zHi] = this.span(1.5);
    for (const sx of [1, -1]) {
      let z = zHi - this.rand() * 2;
      while (z > zLo + 1.5) {
        const run = 4 + this.rand() * 7, z1 = Math.max(zLo, z - run);
        if (this.rand() < p) {
          const sizes = this.sizes(3), off = (SIZES[sizes[0]] + OFF) * this.k;
          const x = sx * (W / 2 - 0.15 + off), y = D - 0.65;
          const a: V3 = [x, y, z], b: V3 = [x, y, z1];
          // Each end turns into the skirt.
          const ia: V3 = [sx * (W / 2 - 0.2), y, z], ib: V3 = [sx * (W / 2 - 0.2), y, z1];
          this.bundle([ia, a, b, ib], sizes, [0, 1, 0], [sx, 0, 0], { valves: true });
        }
        z = z1 - 1 - this.rand() * 3;
      }
    }
  }

  /** Bundles along the deck inside the rails, where they clear the furniture. */
  deckEdges() {
    const { width: W, deck: D } = this.site;
    const p = Math.min(0.9, 0.15 + 0.3 * this.v.pipeDensity);
    const [zLo, zHi] = this.span(1);
    for (const sx of [1, -1]) {
      let z = zHi - 3 - this.rand() * 2;
      while (z > zLo + 1) {
        const run = 3 + this.rand() * 6, z1 = Math.max(zLo, z - run);
        if (this.rand() < p) {
          const sizes = this.sizes(2), h = this.half(sizes);
          const x = sx * (W / 2 - 0.35 - h), y = D + SIZES[sizes[0]] * this.k + 0.12;
          const pts: V3[] = [[x, y, z], [x, y, z1]];
          if (this.clear(runBox(pts, h + 0.05))) this.bundle(pts, sizes, [sx, 0, 0], [0, 1, 0], { flanges: true });
        }
        z = z1 - 1.5 - this.rand() * 3;
      }
    }
  }

  /** Risers up the walls of huts, cabs, containers and machines, over the top edge onto the roof. */
  risers() {
    const mounts = this.site.mounts.filter((m) => m.hy * 2 > 1);
    const n = Math.round(this.v.pipeDensity * (1 + mounts.length * 0.7));
    const D = this.site.deck;
    for (let i = 0; i < n && mounts.length; i++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const m = mounts[Math.floor(this.rand() * mounts.length)];
        // A face: +x, -x, +z, -z; the wall normal and the axis along the wall.
        const f = Math.floor(this.rand() * 4);
        const nrm: V3 = f === 0 ? [1, 0, 0] : f === 1 ? [-1, 0, 0] : f === 2 ? [0, 0, 1] : [0, 0, -1];
        const along: V3 = f < 2 ? [0, 0, 1] : [1, 0, 0];
        const wallHalf = f < 2 ? m.hz : m.hx, faceOff = f < 2 ? m.hx : m.hz;
        const sizes = this.sizes(3), h = this.half(sizes), off = (SIZES[sizes[0]] + OFF) * this.k;
        if (wallHalf < h + 0.3) continue;
        const u = (this.rand() * 2 - 1) * (wallHalf - h - 0.2);
        const base = add(add([m.x, 0, m.z], nrm, faceOff + off), along, u);
        // Only faces that look onto the deck (not out past the platform's edge).
        if (!this.onDeck(base[0], base[2], h + 0.25)) continue;
        const top = m.y + m.hy;
        const box = this.rand() < 0.5;
        const y0 = box ? D + 0.9 : D;
        const yTop = top + off;
        const a: V3 = [base[0], y0, base[2]], b: V3 = [base[0], yTop, base[2]];
        // Over the edge and onto the roof (back across the face by off, then on 0.6 m).
        const c = add(b, nrm, -(off + Math.min(0.7, (f < 2 ? m.hx : m.hz)))) as V3;
        const pts = [a, b, c];
        if (!this.clear(runBox([a, b], h + 0.05), [m]) || !this.clear(runBox([b, c], h + 0.05), [m])) continue;
        if (box) {
          const jb: V3 = [base[0], D + 0.45, base[2]];
          this.set.bits.push({ kind: "box", at: jb, axis: nrm, across: along, size: 0.32 * this.k, w: Math.max(0.5, 2 * h + 0.2) });
        }
        this.bundle(pts, sizes, along, nrm, { valves: !box });
        break;
      }
    }
  }

  /** Runs from one machine to another: low along the deck, or up and over. None across a deck people walk. */
  crossRuns() {
    const ms = this.site.mounts;
    if (ms.length < 2 || this.site.walkable) return;
    const n = Math.round(this.v.pipeDensity * 2);
    const D = this.site.deck;
    for (let i = 0; i < n; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const A = ms[Math.floor(this.rand() * ms.length)], B = ms[Math.floor(this.rand() * ms.length)];
        if (A === B) continue;
        const dx = B.x - A.x, dz = B.z - A.z;
        if (Math.hypot(dx, dz) > 16) continue;
        const sizes = this.sizes(2), h = this.half(sizes), off = (SIZES[sizes[0]] + OFF) * this.k + h;
        // Leave A on the face toward B along the bigger axis, arrive on B's face toward A.
        const alongX = Math.abs(dx) > Math.abs(dz);
        const sa = alongX ? Math.sign(dx) : Math.sign(dz);
        const pa: V3 = alongX ? [A.x + sa * (A.hx + off), 0, A.z + (this.rand() - 0.5) * A.hz] : [A.x + (this.rand() - 0.5) * A.hx, 0, A.z + sa * (A.hz + off)];
        const pb: V3 = alongX ? [B.x - sa * (B.hx + off), 0, B.z + (this.rand() - 0.5) * B.hz] : [B.x + (this.rand() - 0.5) * B.hx, 0, B.z - sa * (B.hz + off)];
        // B must lie beyond A's face the way the run leaves it (not stacked on it or overlapping it).
        if ((alongX ? pb[0] - pa[0] : pb[2] - pa[2]) * sa < 0.5) continue;
        if ([pa, pb].some((q) => !this.onDeck(q[0], q[2], h + 0.3))) continue;
        const low = Math.min(A.y + A.hy, B.y + B.hy) - D;
        const over = this.rand() < 0.4;
        let pts: V3[];
        if (!over) {
          const y = D + Math.max(0.35, Math.min(low - 0.3, 0.5 + this.rand() * 0.8));
          // An L: out from A, then across to B.
          const corner: V3 = alongX ? [pb[0], y, pa[2]] : [pa[0], y, pb[2]];
          pts = [[pa[0], y, pa[2]], corner, [pb[0], y, pb[2]]];
          if (Math.hypot(corner[0] - pb[0], corner[2] - pb[2]) < 0.3) pts = [[pa[0], y, pa[2]], [pb[0], y, pb[2]]];
        } else {
          // Up out of A, over at the taller one's roof plus a margin, down into B.
          const ya = D + Math.min(low, 1.2) - 0.2, top = Math.max(A.y + A.hy, B.y + B.hy) + 0.7 + h;
          pts = [[pa[0], ya, pa[2]], [pa[0], top, pa[2]], [pb[0], top, pb[2]], [pb[0], ya, pb[2]]];
        }
        let ok = true;
        for (let s = 0; s < pts.length - 1 && ok; s++) if (!this.clear(runBox([pts[s], pts[s + 1]], h + 0.05), [A, B])) ok = false;
        if (!ok) continue;
        // Side by side across the run's main direction, in the horizontal.
        const d = unit(sub(pts[pts.length - 1], pts[0]));
        this.bundle(pts, sizes, unit([-d[2], 0, d[0]]), [0, 1, 0], { valves: true });
        // Posts holding up a long low run.
        if (!over) for (let s = 0; s < pts.length - 1; s++) {
          const a = pts[s], dd = sub(pts[s + 1], a), L = len(dd);
          for (let t = 1.8; t < L - 0.8; t += 2.6) {
            const q = add(a, unit(dd), t);
            this.set.tubes.push({ a: [q[0], D, q[2]], b: [q[0], q[1] - SIZES[sizes[0]] * this.k, q[2]], r: 0.05 * this.k, tone: 2 });
          }
        }
        break;
      }
    }
  }
}

/** All the pipe runs on one platform. */
export function generatePipes(site: PipeSite, v: PipeValues): PipeSet {
  const L = new Layer(site, v, rng(Math.round(v.pipeSeed) * 7919 + site.index * 1013 + 17));
  if (v.pipeDensity <= 0) return L.set;
  L.skirts();
  L.risers();
  L.crossRuns();
  L.deckEdges();
  return L.set;
}
