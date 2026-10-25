// Blast craters as real ground (Keith 2026-10-25): rockets, shells and blown-up vehicles dent the sand, and feet,
// wheels, chunks and AI all walk on the dent, because it is a layer inside the one height function. DuneField adds
// it after its modifiers (src/world/terrain.ts, `dents`).
//
// Pure given its stored data. The craters are kept as a list ({x, z, radius, depth, rim, born}) and, what heights
// are read from, a sparse lattice every 0.5 m in 16 m tiles holding the sand moved (u) and the softness there
// (1 - hardness). The layer's height is bilinear between lattice nodes of
//   soft * sat(G * u)
// where sat() saturates stacked blasts (deep toward a cap, rims toward a share of it) and G is one global slump factor
// that decays with time, so all craters slump back together without touching the lattice each frame.
//
// A crater is a bowl with a raised rim whose volume roughly balances the bowl. When one is added it is fitted on the
// lattice, the same nodes heights are read from: the bowl and rim are laid, then sand slides from any step steeper
// than the wall limit (or than it already was) to the lower node, as loose sand slumps to its angle of repose, so on a
// slope the uphill wall slides into the bowl. Whatever that can't settle makes the whole crater shallower.
//
// Hardness: bare rock, rocky sand and shallows sand resist by their sliders; protected zones (the field's modifiers:
// POI pads, the convoy road; and protect() circles for outposts) are fully hard plus a margin, then soften over the
// same again, so they never change height and there is no cliff at their edge.
import type { Param } from "../core/tweaks";
import type { DuneField, GroundSample } from "./terrain";

export const CRATER_DEFAULTS = {
  craterRadiusShare: 0.7,
  craterDepthShare: 0.3,
  craterRim: 0.8,
  craterMaxDepth: 1.5,
  craterMaxStack: 2.5,
  craterWall: 30,
  craterSlump: 180,
  craterMax: 200,
  hardRock: 0.95,
  hardRockySand: 0.6,
  hardShallows: 0.15,
  protectMargin: 4,
};
export type CraterValues = typeof CRATER_DEFAULTS;

const G = "Craters";
export const CRATER_PARAMS: Param[] = [
  { key: "craterRadiusShare", label: "Crater radius (share of blast)", min: 0, max: 1.5, step: 0.01, group: G, tip: "Bowl radius as a share of the blast radius (0: blasts leave no dent)" },
  { key: "craterDepthShare", label: "Depth (share of radius)", min: 0, max: 0.6, step: 0.01, group: G, tip: "Bowl depth per metre of crater radius, before the limits below" },
  { key: "craterRim", label: "Rim (share of the bowl)", min: 0, max: 1.5, step: 0.01, group: G, tip: "Sand thrown up into the rim: 1 balances the bowl's volume" },
  { key: "craterMaxDepth", label: "Max depth (m)", min: 0.1, max: 4, step: 0.05, group: G, tip: "Deepest a single crater digs" },
  { key: "craterMaxStack", label: "Max stacked depth (m)", min: 0.2, max: 6, step: 0.05, group: G, tip: "Blasts on blasts saturate toward this depth instead of digging a pit" },
  { key: "craterWall", label: "Steepest wall (°)", min: 10, max: 45, step: 0.5, group: G, tip: "Sand slides until no crater wall is steeper than this (or than the ground already was); the dunes' slip faces sit near 30°, raider wheels give up at 32-34°" },
  { key: "craterSlump", label: "Slump time (s)", min: 10, max: 1200, step: 5, group: G, tip: "Sand slides back in: craters are 95% healed after this long" },
  { key: "craterMax", label: "Max craters", min: 10, max: 600, step: 10, group: G, tip: "Past this the oldest heal over a few seconds" },
  { key: "hardRock", label: "Hardness: bare rock", min: 0, max: 1, step: 0.01, group: G, tip: "0 dents like loose sand, 1 can't be dented" },
  { key: "hardRockySand", label: "Hardness: rocky sand", min: 0, max: 1, step: 0.01, group: G },
  { key: "hardShallows", label: "Hardness: shallows sand", min: 0, max: 1, step: 0.01, group: G },
  { key: "protectMargin", label: "Protected margin (m)", min: 0, max: 20, step: 0.5, group: G, tip: "Outposts, POI pads and the convoy road never dent; this far round them still doesn't, then it softens over the same again" },
];

/** Which sliders change hardness (re-read it after they change). */
export const HARDNESS_KEYS = ["hardRock", "hardRockySand", "hardShallows", "protectMargin"];

export interface Crater {
  x: number; z: number; radius: number;
  /** Deepest point when made (m), after fitting. */
  depth: number;
  /** Rim amplitude (share of depth). */
  rim: number;
  /** Layer time when made (s). */
  born: number;
  /** The slump factor when made (its depth now is depth * G / g0). */
  g0: number;
  /** Half-size of its square footprint (m). */
  reach: number;
  /** Over the count limit: healing over a few seconds. */
  dying: number;
}

/** Lattice spacing (m) and nodes per tile side (a 16 m tile). */
const STEP = 0.5, T = 32, TILE = STEP * T;
/** Hardness is read every metre (17 x 17 per tile) and interpolated onto the nodes. */
const HL = 17;
interface Tile {
  tx: number; tz: number;
  /** Sand moved at each node (divided by the slump factor when written). */
  u: Float32Array;
  /** 1 - hardness at each node. */
  soft: Float32Array;
  /** Largest |u| (an upper bound), for redraws and pruning. */
  maxU: number;
  /** Amplitude the chunks were last drawn at. */
  drawn: number;
}

/** Rim bump: centred at 1.1 radii, half-width 0.5 radii; the bowl and rim reach 1.6 radii. */
const RIM_C = 1.1, RIM_W = 0.5, REACH = RIM_C + RIM_W;
/** Positive (rim) stacking saturates at this share of the max stacked depth. */
const RIM_STACK = 0.4;

/** Unit bowl and rim: the profile at rho = distance / radius for rim amplitude a. */
export function craterProfile(rho: number, a: number): number {
  let h = 0;
  if (rho < 1) { const u = 1 - rho * rho; h = -u * u; }
  const q = (rho - RIM_C) / RIM_W;
  if (q > -1 && q < 1) { const u = 1 - q * q; h += a * u * u; }
  return h;
}

// Volumes (per unit depth and radius squared): bowl pi/3; rim from a numeric integral. Rim share 1 balances them.
const RIM_VOL = (() => {
  let s = 0; const N = 2000;
  for (let i = 0; i < N; i++) { const r = RIM_C - RIM_W + ((i + 0.5) / N) * 2 * RIM_W, q = (r - RIM_C) / RIM_W, u = 1 - q * q; s += u * u * r * ((2 * RIM_W) / N); }
  return 2 * Math.PI * s;
})();
const BOWL_VOL = Math.PI / 3;
/** Rim amplitude (share of depth) for a rim slider value. */
export const rimAmp = (share: number) => (share * BOWL_VOL) / RIM_VOL;

/** Steepest |d profile / d rho| for rim amplitude a (numeric). */
function profileSlope(a: number) {
  let m = 0, prev = craterProfile(0, a);
  for (let i = 1; i <= 160; i++) { const r = (i / 160) * REACH, h = craterProfile(r, a); m = Math.max(m, Math.abs(h - prev) / (REACH / 160)); prev = h; }
  return m;
}

const smooth = (a: number, b: number, x: number) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const tkey = (tx: number, tz: number) => (tx + 32768) * 65536 + (tz + 32768);
/** Neighbour offsets (straight and diagonal) as (di, dj) and their lengths. */
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const NL = NB.map(([a, b]) => Math.hypot(a, b) * STEP);
/** Neighbours already visited in a forward (row by row) sweep, and in a backward one. */
const BACK_SET = NB.map(([a, b], n) => (b < 0 || (b === 0 && a < 0) ? n : -1)).filter((n) => n >= 0);
const FWD_SET = NB.map(([a, b], n) => (b > 0 || (b === 0 && a > 0) ? n : -1)).filter((n) => n >= 0);

export class CraterLayer {
  readonly list: Crater[] = [];
  /** Generic protected circles (future bandit outposts): never dented, plus the margin. */
  readonly protects: { x: number; z: number; r: number }[] = [];
  /** Layer clock (s). */
  time = 0;
  /** Global slump factor: every crater's sand is scaled by it (1 when made, decaying with time). */
  slump = 1;
  private tiles = new Map<number, Tile>();
  private busy = false;
  private s: GroundSample = { h: 0, crest: 0, flat: 0 };
  private ms = { w: 0, berm: 0, lift: 0, rough: 0 };
  readonly stats = { addMs: 0, scale: 1, sweeps: 0, tiles: 0 };

  constructor(public v: CraterValues, readonly field: DuneField) {}

  get count() { return this.list.length; }

  /** The layer's height change at (x, z): what DuneField adds after its modifiers. */
  at(x: number, z: number): number {
    if (this.busy || this.tiles.size === 0) return 0;
    const fx = x / STEP, fz = z / STEP, ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = Math.floor(ix / T), tz = Math.floor(iz / T);
    const lx = ix - tx * T, lz = iz - tz * T;
    let a: number, b: number, c: number, d: number;
    if (lx < T - 1 && lz < T - 1) {
      // All four nodes in one tile (the usual case).
      const t = this.tiles.get(tkey(tx, tz));
      if (!t) return 0;
      const i = lz * T + lx, u = t.u;
      if (u[i] === 0 && u[i + 1] === 0 && u[i + T] === 0 && u[i + T + 1] === 0) return 0;
      a = this.nodeH(t, i); b = this.nodeH(t, i + 1); c = this.nodeH(t, i + T); d = this.nodeH(t, i + T + 1);
    } else {
      a = this.node(ix, iz); b = this.node(ix + 1, iz); c = this.node(ix, iz + 1); d = this.node(ix + 1, iz + 1);
    }
    if (a === 0 && b === 0 && c === 0 && d === 0) return 0;
    const sx = fx - ix, sz = fz - iz;
    return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
  }

  /** Height change at lattice node (ix, iz). */
  private node(ix: number, iz: number): number {
    const tx = Math.floor(ix / T), tz = Math.floor(iz / T);
    const t = this.tiles.get(tkey(tx, tz));
    return t ? this.nodeH(t, (iz - tz * T) * T + (ix - tx * T)) : 0;
  }

  private nodeH(t: Tile, i: number) {
    const u = t.u[i];
    if (u === 0) return 0;
    const s = t.soft[i];
    return s === 0 ? 0 : s * this.sat(u * this.slump);
  }

  /** Stacked blasts saturate: deep toward craterMaxStack, rims toward a share of it. Never steepens (|sat'| <= 1). */
  sat(u: number) {
    const M = Math.max(0.05, this.v.craterMaxStack);
    if (u < 0) return -M * Math.tanh(-u / M);
    const P = M * RIM_STACK;
    return P * Math.tanh(u / P);
  }

  /** The inverse of sat(), clamped just inside its range. */
  satInv(y: number) {
    const M = Math.max(0.05, this.v.craterMaxStack);
    if (y < 0) return -M * Math.atanh(Math.min(0.995, -y / M));
    const P = M * RIM_STACK;
    return P * Math.atanh(Math.min(0.995, y / P));
  }

  /**
   * 0 (loose sand) .. 1 (can't be dented): bare rock, rocky sand, shallows sand, and protected zones (the field's
   * modifiers: POI pads and the convoy road; and `protect()` circles) fully hard plus the margin. Pure.
   */
  hardness(x: number, z: number): number {
    const v = this.v, f = this.field;
    const was = this.busy;
    this.busy = true;
    const s = f.sample(x, z, this.s);
    this.busy = was;
    const wr = s.wr ?? 0, ws = s.ws ?? 0, rock = s.rock ?? 0;
    let h = Math.max(wr * v.hardRockySand + ws * v.hardShallows, rock * v.hardRock);
    if (h < 1) h = Math.max(h, this.protectedAt(x, z));
    return Math.min(1, Math.max(0, h));
  }

  /** How protected (x, z) is: 1 inside a protected zone or within the margin of one, easing to 0 over the margin again. */
  protectedAt(x: number, z: number): number {
    const M = Math.max(0, this.v.protectMargin);
    let p = 0;
    for (const c of this.protects) {
      const d = Math.hypot(x - c.x, z - c.z);
      p = Math.max(p, 1 - smooth(c.r + M, c.r + 2 * M + 1e-3, d));
      if (p >= 1) return 1;
    }
    const m = this.field.modifier;
    if (m) {
      // A modifier's floor (pad, road) is protected and its own blend eases out; then dilated by the margin: the
      // strongest of the point and rings at the margin and half of it.
      const w = (px: number, pz: number) => (m.at(px, pz, this.ms) ? smooth(0, 0.25, this.ms.w) : 0);
      p = Math.max(p, w(x, z));
      if (M > 0) for (let k = 0; k < 8 && p < 1; k++) {
        const a = (k * Math.PI) / 4, cx = Math.cos(a), cz = Math.sin(a);
        p = Math.max(p, w(x + cx * M, z + cz * M), w(x + cx * M * 0.5, z + cz * M * 0.5));
      }
    }
    return p;
  }

  /** Protect a circle from denting (an outpost's gate and yard). Re-reads the hardness round it. */
  protect(x: number, z: number, radius: number) {
    this.protects.push({ x, z, r: radius });
    const R = radius + 2 * this.v.protectMargin + 1;
    this.invalidate(x - R, z - R, x + R, z + R);
  }

  /**
   * After protected zones, hardness sliders or the ground's modifiers change in a box: re-read hardness there.
   * Returns the box of tiles touched (to redraw), or null.
   */
  invalidate(x0 = -Infinity, z0 = -Infinity, x1 = Infinity, z1 = Infinity): [number, number, number, number] | null {
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const t of this.tiles.values()) {
      const ox = t.tx * TILE, oz = t.tz * TILE;
      if (ox + TILE < x0 || ox > x1 || oz + TILE < z0 || oz > z1) continue;
      this.bakeSoft(t);
      bx0 = Math.min(bx0, ox); bz0 = Math.min(bz0, oz); bx1 = Math.max(bx1, ox + TILE); bz1 = Math.max(bz1, oz + TILE);
    }
    return bx0 <= bx1 ? [bx0, bz0, bx1, bz1] : null;
  }

  /** A blast of this radius at (x, z): a crater sized by the share sliders. Returns the box whose ground changed, or null. */
  blast(x: number, z: number, blastRadius: number): [number, number, number, number] | null {
    const v = this.v, r = blastRadius * v.craterRadiusShare;
    return this.add(x, z, r, r * v.craterDepthShare);
  }

  /**
   * Add a crater of radius r and depth d (limited by max depth and the wall limit, fitted to the ground, softness per
   * point on top). Returns the box whose ground changed (for the chunks), or null if nothing changed.
   */
  add(x: number, z: number, r: number, d: number): [number, number, number, number] | null {
    const t0 = performance.now();
    const v = this.v;
    this.stats.scale = 0;
    if (r < 0.3 || d <= 0.005) return null;
    const a = rimAmp(v.craterRim);
    const tanWall = Math.tan((Math.min(60, v.craterWall) * Math.PI) / 180);
    // On flat ground alone no wall steeper than the limit.
    d = Math.min(d, v.craterMaxDepth, (tanWall * r) / profileSlope(a));
    // Its footprint on the lattice, with room round it for slumped sand (the outer ring stays as it is).
    const R = r * REACH + 1.5;
    const i0 = Math.floor((x - R) / STEP), i1 = Math.ceil((x + R) / STEP), j0 = Math.floor((z - R) / STEP), j1 = Math.ceil((z + R) / STEP);
    // Fitted along the lattice's straight and diagonal steps; between nodes the slope can run up to ~8% steeper
    // than along them, so the steps are held that much under the limit.
    const depth = this.fit(x, z, r, d, a, tanWall / 1.08, i0, j0, i1 - i0 + 1, j1 - j0 + 1);
    this.stats.addMs = performance.now() - t0;
    if (depth < 0.01) return null;
    this.list.push({ x, z, radius: r, depth, rim: a, born: this.time, g0: this.slump, reach: R, dying: 0 });
    // Over the count: the oldest heal over a few seconds (dropping one at once would pop the ground under a foot).
    let over = this.list.length - Math.max(1, Math.round(v.craterMax));
    for (const o of this.list) if (o.dying) over--;
    for (const o of this.list) { if (over <= 0) break; if (!o.dying) { o.dying = 1; over--; } }
    this.stats.tiles = this.tiles.size;
    this.stats.addMs = performance.now() - t0;
    return [i0 * STEP, j0 * STEP, i1 * STEP, j1 * STEP];
  }

  /** Fit a crater on nodes [i0, i0 + nx) x [j0, j0 + nz) and write it; returns its deepest point (0: nothing written). */
  private fit(x: number, z: number, r: number, d: number, a: number, tanWall: number, i0: number, j0: number, nx: number, nz: number): number {
    const N = nx * nz;
    const base = new Float32Array(N), soft = new Float32Array(N), u0 = new Float32Array(N), mine = new Float32Array(N);
    const tl: Tile[] = new Array(N), ti = new Int32Array(N);
    this.busy = true;
    for (let j = 0, i = 0; j < nz; j++) for (let k = 0; k < nx; k++, i++) base[i] = this.field.height((i0 + k) * STEP, (j0 + j) * STEP);
    this.busy = false;
    const G0 = this.slump;
    for (let j = 0, i = 0; j < nz; j++) for (let k = 0; k < nx; k++, i++) {
      const ix = i0 + k, iz = j0 + j, tx = Math.floor(ix / T), tz = Math.floor(iz / T);
      const t = this.tile(tx, tz), q = (iz - tz * T) * T + (ix - tx * T);
      tl[i] = t; ti[i] = q;
      soft[i] = t.soft[q];
      u0[i] = t.u[q] * G0;
      const edge = j === 0 || k === 0 || j === nz - 1 || k === nx - 1;
      mine[i] = edge ? 0 : d * craterProfile(Math.hypot(ix * STEP - x, iz * STEP - z) / r, a);
    }
    const H = new Float32Array(N), H0 = new Float32Array(N);
    const fill = (out: Float32Array, s: number) => { for (let i = 0; i < N; i++) out[i] = base[i] + soft[i] * this.sat(u0[i] + s * mine[i]); };
    fill(H0, 0);
    const off = NB.map(([di, dj]) => dj * nx + di);
    // Allowed rise across each step: the wall limit, or what the step was before (bare ground or other craters).
    const allow = (i: number, q: number, n: number) => Math.max(tanWall * NL[n], Math.abs(H0[i] - H0[q]), Math.abs(base[i] - base[q])) + 1e-5;
    // Slump, first as sand slides: sweeps moving a share of each too-steep step's excess downhill (mass kept).
    let sweeps = 0;
    fill(H, 1);
    for (let it = 0; it < 12; it++) {
      let moved = 0;
      for (let j = 1; j < nz - 1; j++) for (let k = 1; k < nx - 1; k++) {
        const i = j * nx + k;
        if (soft[i] < 1e-3) continue;
        for (let n = 0; n < 8; n++) {
          const q = i + off[n];
          const ex = H[i] - H[q] - allow(i, q, n);
          if (ex <= 1e-4) continue;
          const qk = k + NB[n][0], qj = j + NB[n][1];
          if (qk > 0 && qj > 0 && qk < nx - 1 && qj < nz - 1 && soft[q] > 1e-3) {
            const m = (ex * 0.45) / Math.max(0.2, soft[i] + soft[q]);
            mine[i] -= m; mine[q] += m; H[i] -= m * soft[i]; H[q] += m * soft[q];
          } else {
            const m = (ex * 0.45) / Math.max(0.2, soft[i]);
            mine[i] -= m; H[i] -= m * soft[i];
          }
          moved++;
        }
      }
      sweeps = it + 1;
      if (!moved) break;
      fill(H, 1);
    }
    // Then settle what's left exactly: cut every node down to no more than its neighbours plus the allowed rise, then
    // fill every node up to no less than its neighbours minus it (two-way chamfer sweeps, as a distance transform;
    // the outer ring and hard nodes stay put). Back into sand moved through the inverse of sat().
    fill(H, 1);
    const free = new Uint8Array(N);
    for (let j = 1; j < nz - 1; j++) for (let k = 1; k < nx - 1; k++) { const i = j * nx + k; free[i] = soft[i] > 1e-3 ? 1 : 0; }
    const passes = (cut: boolean) => {
      for (let p = 0; p < 3; p++) for (const dir of [0, 1]) {
        const set = dir === 0 ? BACK_SET : FWD_SET;
        for (let jj = 1; jj < nz - 1; jj++) {
          const j = dir === 0 ? jj : nz - 1 - jj;
          for (let kk = 1; kk < nx - 1; kk++) {
            const k = dir === 0 ? kk : nx - 1 - kk, i = j * nx + k;
            if (!free[i]) continue;
            let h = H[i];
            for (const n of set) {
              const q = i + off[n], A = allow(i, q, n);
              h = cut ? Math.min(h, H[q] + A) : Math.max(h, H[q] - A);
            }
            H[i] = h;
          }
        }
      }
    };
    passes(true);
    passes(false);
    for (let i = 0; i < N; i++) if (free[i]) mine[i] = this.satInv((H[i] - base[i]) / soft[i]) - u0[i];
    this.stats.sweeps = sweeps;
    const steep = (s: number) => {
      fill(H, s);
      for (let j = 1; j < nz - 1; j++) for (let k = 1; k < nx - 1; k++) {
        const i = j * nx + k;
        for (let n = 0; n < 8; n++) { const q = i + off[n]; if (Math.abs(H[i] - H[q]) > allow(i, q, n) * 1.01) return true; }
      }
      return false;
    };
    let s = 1;
    if (steep(1)) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 7; it++) { const m = (lo + hi) / 2; if (steep(m)) hi = m; else lo = m; }
      s = lo;
    }
    this.stats.scale = s;
    let deep = 0;
    for (let i = 0; i < N; i++) deep = Math.min(deep, s * mine[i] * soft[i]);
    if (-deep < 0.01) return 0;
    for (let i = 0; i < N; i++) {
      if (mine[i] === 0) continue;
      const t = tl[i], q = ti[i];
      t.u[q] += (s * mine[i]) / G0;
      t.maxU = Math.max(t.maxU, Math.abs(t.u[q]));
      t.drawn = t.maxU * G0;
    }
    return -deep;
  }

  /**
   * Advance the layer clock: craters slump (sand slides back in), healed tiles and craters are dropped, the oldest past
   * the count heal fast. Calls changed() with each box whose ground moved enough to redraw (a few cm).
   */
  update(dt: number, changed?: (x0: number, z0: number, x1: number, z1: number) => void) {
    this.time += dt;
    if (!this.tiles.size && !this.list.length) return;
    const v = this.v;
    this.slump *= Math.exp((-3 * dt) / Math.max(1, v.craterSlump));
    const G0 = this.slump;
    // The oldest past the count: a smooth window over their footprint heals over about 3 s.
    const kDie = Math.exp((-3 * dt) / 3);
    for (const c of this.list) {
      if (!c.dying) continue;
      c.dying += dt;
      const i0 = Math.floor((c.x - c.reach) / STEP), i1 = Math.ceil((c.x + c.reach) / STEP), j0 = Math.floor((c.z - c.reach) / STEP), j1 = Math.ceil((c.z + c.reach) / STEP);
      for (let iz = j0; iz <= j1; iz++) for (let ix = i0; ix <= i1; ix++) {
        const tx = Math.floor(ix / T), tz = Math.floor(iz / T), t = this.tiles.get(tkey(tx, tz));
        if (!t) continue;
        const w = 1 - smooth(c.radius * REACH, c.reach, Math.hypot(ix * STEP - c.x, iz * STEP - c.z));
        if (w > 0) t.u[(iz - tz * T) * T + (ix - tx * T)] *= 1 - w * (1 - kDie);
      }
      if (c.dying > 0.5 && Math.floor((c.dying - dt) * 4) !== Math.floor(c.dying * 4)) changed?.(c.x - c.reach, c.z - c.reach, c.x + c.reach, c.z + c.reach);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.dying > 4 || (c.depth * G0) / c.g0 < 0.01) {
        if (c.dying) changed?.(c.x - c.reach, c.z - c.reach, c.x + c.reach, c.z + c.reach);
        this.list.splice(i, 1);
      }
    }
    for (const [k, t] of this.tiles) {
      const amp = t.maxU * G0;
      if (amp < 0.005 || (!this.list.length && t.maxU * G0 < 0.02)) {
        this.tiles.delete(k);
        changed?.(t.tx * TILE - STEP, t.tz * TILE - STEP, (t.tx + 1) * TILE + STEP, (t.tz + 1) * TILE + STEP);
      } else if (t.drawn - amp > 0.03) {
        t.drawn = amp;
        changed?.(t.tx * TILE - STEP, t.tz * TILE - STEP, (t.tx + 1) * TILE + STEP, (t.tz + 1) * TILE + STEP);
      }
    }
    // Keep the numbers in range: fold the slump factor into the lattice now and then.
    if (G0 < 1e-3) {
      for (const t of this.tiles.values()) { for (let i = 0; i < t.u.length; i++) t.u[i] *= G0; t.maxU *= G0; }
      for (const c of this.list) c.g0 /= G0;
      this.slump = 1;
    }
    this.stats.tiles = this.tiles.size;
  }

  /** Drop every crater (the ground back to itself); calls changed() for each tile's box. */
  clear(changed?: (x0: number, z0: number, x1: number, z1: number) => void) {
    for (const t of this.tiles.values()) changed?.(t.tx * TILE - STEP, t.tz * TILE - STEP, (t.tx + 1) * TILE + STEP, (t.tz + 1) * TILE + STEP);
    this.list.length = 0;
    this.tiles.clear();
    this.slump = 1;
  }

  private tile(tx: number, tz: number): Tile {
    const k = tkey(tx, tz);
    let t = this.tiles.get(k);
    if (!t) {
      t = { tx, tz, u: new Float32Array(T * T), soft: new Float32Array(T * T), maxU: 0, drawn: 0 };
      this.bakeSoft(t);
      this.tiles.set(k, t);
    }
    return t;
  }

  /** Softness on the tile's nodes: hardness read every metre, interpolated onto the 0.5 m nodes (exactly 0 where hard). */
  private bakeSoft(t: Tile) {
    const lat = new Float32Array(HL * HL), ox = t.tx * TILE, oz = t.tz * TILE;
    for (let q = 0, p = 0; q < HL; q++) for (let r = 0; r < HL; r++, p++) lat[p] = 1 - this.hardness(ox + r, oz + q);
    for (let j = 0, i = 0; j < T; j++) for (let k = 0; k < T; k++, i++) {
      const lx = k * STEP, lz = j * STEP, r = Math.floor(lx), q = Math.floor(lz), fx = lx - r, fz = lz - q, p = q * HL + r;
      const s00 = lat[p], s10 = lat[p + 1], s01 = lat[p + HL], s11 = lat[p + HL + 1];
      t.soft[i] = s00 === 0 && s10 === 0 && s01 === 0 && s11 === 0 ? 0 : (s00 * (1 - fx) + s10 * fx) * (1 - fz) + (s01 * (1 - fx) + s11 * fx) * fz;
    }
  }
}
