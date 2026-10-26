// The plough's wake (Keith 2026-10-26): the sand the convoy's plough cuts off the dunes is thrown to the sides as
// berms, so the walls beside the road follow how much material was moved: big over a dune crest, next to nothing
// across a flat. Pure maths, no rendering; owned by the host like the route (it is a pure function of the route's
// polyline and the original ground, so every peer gets the same berms from the same clock).
//
// Stations every STATION metres along the route. At each one, across the road on each side, the cut is the
// cross-section area the road takes off the original dunes: the integral of w (d) * (dune - floor) out to the end of
// the edge blend, positive where the blade cuts, negative where the floor fills a trough (fill takes material and
// makes the berm smaller). The net is smeared along the route over bermCarry metres (the blade carries its load a
// little way before it spills), clamped at zero, a share moved to the outside of a curve (the blade throws it that
// way), and varied with seeded noise along the length (lumps). Each side's area A becomes one berm with a smooth
// (1 - u^2)^2 profile of half-width W and height H: area = 16/15 H W, W = bermSpread * H, so the area is conserved
// and the steepest face is about 1.54 H / W (35 degrees at the default spread). It sits bermOut beyond the road edge.
// Stations are worked out lazily and cached; the cache is forgotten past a replan and on slider changes.
import type { Param } from "../core/tweaks";
import { Noise2 } from "../world/noise";
import type { GroundSample } from "../world/terrain";

export const WAKE_DEFAULTS = {
  ploughGap: 12,
  bladeSweep: 24,
  bladeRamp: 4,
  bermGrow: 8,
  bermSpread: 2.2,
  bermOut: 8,
  bermCurve: 0.6,
  bermLumps: 0.35,
  bermCarry: 6,
  ploughPatchEvery: 3,
};
export type WakeValues = typeof WAKE_DEFAULTS;

export const WAKE_PARAMS: Param[] = [
  { key: "ploughGap", label: "Ahead of the lead car (m)", min: 2, max: 60, step: 0.5, group: "Plough", tip: "Gap from the lead car's nose to the plough's tail. The road starts at the plough's blade; ahead of it the dunes are untouched" },
  { key: "bladeSweep", label: "Blade sweep (°)", min: 0, max: 45, step: 0.5, group: "Plough", tip: "The V of the blade: its wing tips trail the middle by half-width × tan(sweep)", onRelease: true },
  { key: "bladeRamp", label: "Cut edge (m)", min: 1, max: 12, step: 0.1, group: "Plough", tip: "Length behind the blade over which the dune comes down to the road floor (the face the blade leaves)", onRelease: true },
  { key: "ploughPatchEvery", label: "Ground patched every (m)", min: 1, max: 12, step: 0.5, group: "Plough", tip: "The chunks behind the blade are patched in a strip this long at a time (more = fewer, bigger patches)" },
  { key: "bermSpread", label: "Berm spread (width ÷ height)", min: 1.6, max: 8, step: 0.05, group: "Wake", tip: "Wider, lower berms or narrow steep walls for the same sand. The steepest face is about 1.54 ÷ this (35° at 2.2, about sand's angle of repose)", onRelease: true },
  { key: "bermOut", label: "Berm out from the road (m)", min: 0, max: 20, step: 0.5, group: "Wake", tip: "Gap from the road's edge to the berm's inner foot", onRelease: true },
  { key: "bermCurve", label: "Outside of curves", min: 0, max: 1, step: 0.01, group: "Wake", tip: "Share of the inside berm thrown to the outside in a full turn (the blade throws it outward)", onRelease: true },
  { key: "bermLumps", label: "Lumpiness", min: 0, max: 1, step: 0.01, group: "Wake", tip: "Seeded variation along the berms: height, width and how far out", onRelease: true },
  { key: "bermCarry", label: "Carried along (m)", min: 0, max: 60, step: 1, group: "Wake", tip: "How far the blade carries its load before spilling: the cut is smeared along the route over this", onRelease: true },
  { key: "bermGrow", label: "Berm rises behind the tips (m)", min: 1, max: 30, step: 0.5, group: "Wake", tip: "The berm grows to full height over this distance behind each blade tip", onRelease: true },
];

/** Station spacing along the route (m). */
export const STATION = 2;
/** Widest a berm's half-width goes (m); past it the berm gets steeper instead (keeps the road's lookup reach bounded). */
export const BERM_W_MAX = 22;
/** Curvature (rad/m) of a full turn for the outside bias (about the convoy's top turn rate at its speed). */
const K_FULL = 0.01;
/** Lump length along the berm (m). */
const LUMP = 13;
/** Cross-section sample spacing (m). */
const DX = 1;

const smooth = (x: number) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** What the wake reads: the route's geometry. */
export interface WakeRoute {
  offsetAt(s: number, side: number, out?: { x: number; z: number; heading: number }): { x: number; z: number; heading: number };
  pointAt(s: number, out?: { x: number; z: number; heading: number }): { x: number; z: number; heading: number };
}
/** The original ground (DuneField.sample with raw = true). */
export interface WakeGround { sample(x: number, z: number, out: GroundSample, raw: boolean): GroundSample; v: { seed: number } }
/** Road values the wake needs. */
export interface WakeRoad { routeHalfWidth: number; routeBlend: number; routeLift: number; routeRough: number }

/** One side's berm at a station: height, half-width, distance of its crest from the route line. */
export interface Berm { h: number; w: number; c: number }

export class Wake {
  /** Signed cut per side at each station (m² of cross-section: + cut, - fill); index k - k0. NaN: not worked out. */
  private rawL: number[] = [];
  private rawR: number[] = [];
  /** Final berms per station: [hL, wL, cL, hR, wR, cR]; NaN in hL: not worked out. */
  private fin: number[] = [];
  private k0 = 0;
  private noise: Noise2;
  private seed = -1;
  private gs: GroundSample = { h: 0, crest: 0, flat: 0 };
  private pt = { x: 0, z: 0, heading: 0 };
  /** Stations worked out (for the HUD and costs). */
  computed = 0;

  constructor(readonly route: WakeRoute, public v: WakeValues & WakeRoad, public ground: WakeGround | null = null) {
    this.noise = new Noise2(1);
  }

  /** Forget everything (sliders or the ground changed). */
  clear() { this.rawL = []; this.rawR = []; this.fin = []; }

  /** Forget the stations from distance s on (the route was replanned past s), and the berms that read them. */
  forget(s: number) {
    const J = this.carryStations();
    const from = Math.max(0, Math.floor(s / STATION) - this.k0 - J - 2);
    if (from < this.rawL.length) { this.rawL.length = from; this.rawR.length = from; }
    if (from * 6 < this.fin.length) this.fin.length = from * 6;
  }

  /** Start over: stations index from distance s0. */
  reset(s0: number) { this.k0 = Math.floor(s0 / STATION) - 2; this.clear(); }

  /** Biggest distance off the route line any berm reaches (m). */
  reach() { return this.v.routeHalfWidth + this.v.bermOut * (1 + 0.5 * this.v.bermLumps) + 2 * BERM_W_MAX + 1; }

  private carryStations() { return Math.max(0, Math.round(this.v.bermCarry / STATION)); }

  /** Signed cut (m²) at station k on each side, cached. */
  private raw(k: number): number {
    const i = k - this.k0;
    if (i < 0) return this.raw(this.k0);
    const c = this.rawL[i];
    if (c !== undefined && !Number.isNaN(c)) return c;
    const g = this.ground;
    let L = 0, R = 0;
    if (g) {
      const v = this.v, hw = v.routeHalfWidth, bl = Math.max(0.01, v.routeBlend), s = k * STATION;
      for (let d = DX / 2; d < hw + bl; d += DX) {
        const w = d <= hw ? 1 : 1 - smooth((d - hw) / bl);
        for (const side of [1, -1]) {
          const p = this.route.offsetAt(s, side * d, this.pt);
          // Raw: the dunes as they were (no modifier, no dents). Called from inside DuneField.sample's modifier step,
          // which is done with its scratch objects by then and never recurses past a raw sample.
          const gs = g.sample(p.x, p.z, this.gs, true);
          const floor = (gs.swell ?? 0) + v.routeLift + (gs.bumps ?? 0) * v.routeRough;
          const a = w * (gs.h - floor) * DX;
          if (side > 0) L += a; else R += a;
        }
      }
    }
    while (this.rawL.length < i) { this.rawL.push(NaN); this.rawR.push(NaN); }
    this.rawL[i] = L; this.rawR[i] = R;
    this.computed++;
    return L;
  }

  private rawSide(k: number, side: number) {
    this.raw(k);
    const i = Math.max(0, k - this.k0);
    return side > 0 ? this.rawL[i] : this.rawR[i];
  }

  /** Cut at a station before smearing (both sides, m², clamped at 0 each): what the blade is moving right there. */
  cutAt(s: number): number {
    const k = Math.round(s / STATION);
    return Math.max(0, this.rawSide(k, 1)) + Math.max(0, this.rawSide(k, -1));
  }
  /** Signed net cut per side at s (left, right), before smearing. */
  netAt(s: number): [number, number] { const k = Math.round(s / STATION); return [this.rawSide(k, 1), this.rawSide(k, -1)]; }

  /** The berm on one side (+1 left, -1 right) at distance s, interpolated between stations. */
  berm(s: number, side: number, out: Berm): Berm {
    const f = s / STATION, k = Math.floor(f), t = f - k;
    const a = this.final(k, this.fa), b = this.final(k + 1, this.fb), o = side > 0 ? 0 : 3;
    out.h = a[o] + (b[o] - a[o]) * t;
    out.w = a[o + 1] + (b[o + 1] - a[o + 1]) * t;
    out.c = a[o + 2] + (b[o + 2] - a[o + 2]) * t;
    return out;
  }

  /** Cross-section area of the berm (m²) per side for a given station (16/15 H W). */
  bermArea(s: number, side: number) { const b = this.berm(s, side, { h: 0, w: 0, c: 0 }); return (16 / 15) * b.h * b.w; }

  /** The berm on one side at distance d off the route line, for a berm b (height above the ground under it). */
  static profile(b: Berm, d: number) {
    if (b.w <= 1e-6) return 0;
    const u = (d - b.c) / b.w;
    if (u <= -1 || u >= 1) return 0;
    const q = 1 - u * u;
    return b.h * q * q;
  }

  private sm: [number, number] = [0, 0];
  /**
   * Sand for the berms at station k, left and right (m² of cross-section): the signed cut smeared along the route
   * (triangle weights over bermCarry), nothing below zero, a share moved to the outside of a curve. Before the lumps.
   */
  private smeared(k: number): [number, number] {
    const J = this.carryStations();
    let L = 0, R = 0, sw = 0;
    for (let j = -J; j <= J; j++) {
      const w = J + 1 - Math.abs(j);
      L += w * this.rawSide(k + j, 1); R += w * this.rawSide(k + j, -1); sw += w;
    }
    let AL = Math.max(0, L / sw), AR = Math.max(0, R / sw);
    // The outside of a curve gets more: a left turn (heading rising) throws to the right.
    const s = k * STATION;
    const kappa = wrap(this.route.pointAt(s + 4, this.pt).heading - this.route.pointAt(s - 4, this.pt).heading) / 8;
    const f = this.v.bermCurve * Math.min(1, Math.abs(kappa) / K_FULL);
    if (kappa > 0) { const m = AL * f; AL -= m; AR += m; } else { const m = AR * f; AR -= m; AL += m; }
    this.sm[0] = AL; this.sm[1] = AR;
    return this.sm;
  }

  /** Sand going into the berms at distance s (both sides, m² of cross-section, before the lumps): for the check. */
  moved(s: number) { const [L, R] = this.smeared(Math.round(s / STATION)); return L + R; }

  private fa = [0, 0, 0, 0, 0, 0];
  private fb = [0, 0, 0, 0, 0, 0];
  private final(k: number, t: number[]): number[] {
    const i = k - this.k0;
    if (i < 0) return this.final(this.k0, t);
    const F = this.fin;
    if (i * 6 < F.length && !Number.isNaN(F[i * 6])) { for (let j = 0; j < 6; j++) t[j] = F[i * 6 + j]; return t; }
    const v = this.v;
    if (this.ground && this.ground.v.seed !== this.seed) { this.seed = this.ground.v.seed; this.noise = new Noise2(this.seed * 131 + 977); }
    const [AL, AR] = this.smeared(k);
    const s = k * STATION;
    while (F.length < i * 6) F.push(NaN);
    const n = this.noise, lump = v.bermLumps;
    for (const side of [1, -1]) {
      const salt = side > 0 ? 0 : 57.3;
      // Lumps: area, width and offset each on their own slow noise along the length.
      const n1 = n.get(s / LUMP + salt, 3.1), n2 = n.get(s / (LUMP * 1.7) + salt, 11.7), n3 = n.get(s / (LUMP * 2.3) + salt, 23.9);
      const A = (side > 0 ? AL : AR) * Math.max(0, 1 + lump * 1.2 * n1);
      const spread = Math.max(0.5, v.bermSpread);
      let h = Math.sqrt((A * 15) / (16 * spread));
      let w = spread * h * (1 + lump * 0.4 * n2);
      if (w > BERM_W_MAX) w = BERM_W_MAX;
      if (w < 0.5) w = 0.5;
      h = (A * 15) / (16 * w);
      const c = v.routeHalfWidth + v.bermOut * (1 + 0.5 * lump * n3) + w;
      const o = i * 6 + (side > 0 ? 0 : 3);
      F[o] = h; F[o + 1] = w; F[o + 2] = c;
    }
    for (let j = 0; j < 6; j++) t[j] = F[i * 6 + j];
    return t;
  }
}

/** The tan of the blade sweep (how far the tips trail the middle per metre out). */
export const sweepTan = (v: WakeValues) => Math.tan((Math.min(60, Math.max(0, v.bladeSweep)) * Math.PI) / 180);

export { wrap as wakeWrap };
