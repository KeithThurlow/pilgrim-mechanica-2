// Sheet hits (Keith 2026-10-26): from the high camera a shot is a line on the ground and the player can't judge
// height, so direct fire (the minigun's rounds, the rail's slug, the autocannon's shells) is resolved as a vertical
// sheet along that line. Anything whose footprint (its hit circle, widened by the sheet's half-width) the line passes
// through, and whose height reaches into the band from a little under the ground up to the sheet's top, is in the
// sheet. Height decides nothing else; a robot still takes the hit on the part the line crosses (its body when the line
// crosses the whole robot).
//
// Penetration (Keith 2026-10-26): every shot carries a budget in metres of "steel equivalent". A body costs the chord
// the line cuts through its footprint circle times its material's density; the ground costs the length along the line
// where it rises above the shot's own flight line (the sheet's top when it has none), times the sand's density. Walking the hits in order along the line, each cost
// is taken off the budget; the shot stops inside whatever it can't pay for. Damage keeps a share by the budget left.
//
// Pure: no drawing. The battlefield gathers the hits (src/game/battlefield.ts: sheetHits, penetrate) and draws them.
// Host-owned when networked (it decides damage).
import type { Param } from "../core/tweaks";

/** What a body is made of, for its penetration cost per metre of chord. */
export type PenMaterial = "flesh" | "scrapper" | "cutter" | "excavator" | "vehicle" | "steel";

export const PEN_DEFAULTS = {
  penFlesh: 0.45,
  penScrapper: 0.5,
  penCutter: 0.8,
  penExcavator: 1,
  penVehicle: 1.5,
  penSteel: 4,
  penSand: 3,
  penCurve: 0.5,
  sheetUnder: 0.6,
  sheetStep: 0.5,
};
export type PenValues = typeof PEN_DEFAULTS;

const G = "Penetration";
export const PEN_PARAMS: Param[] = [
  { key: "penFlesh", label: "Bandits, pilots, cutouts (per m)", min: 0, max: 6, step: 0.05, group: G, tip: "Cost of a body to a shot's penetration budget: the chord the shot cuts through it (m) × this" },
  { key: "penScrapper", label: "Scrappers (per m)", min: 0, max: 6, step: 0.05, group: G },
  { key: "penCutter", label: "Cutters (per m)", min: 0, max: 6, step: 0.05, group: G },
  { key: "penExcavator", label: "Excavators, body and legs (per m)", min: 0, max: 6, step: 0.05, group: G },
  { key: "penVehicle", label: "Vehicles, mechs, steel posts (per m)", min: 0, max: 10, step: 0.05, group: G },
  { key: "penSteel", label: "Wrecks and steel (per m)", min: 0, max: 20, step: 0.1, group: G },
  { key: "penSand", label: "Sand above the sheet (per m)", min: 0, max: 20, step: 0.1, group: G, tip: "Ground that rises above the shot's flight line (the rail's slug height) costs this per metre along the line: a rail punches through a dune lip, not a dune" },
  { key: "penCurve", label: "Damage kept by budget left (curve)", min: 0, max: 3, step: 0.05, group: G, tip: "A body takes damage × (budget left as the shot reaches it / full budget) ^ this. 0: full damage to everything it reaches; 1: in proportion" },
  { key: "sheetUnder", label: "Sheet reaches under the ground (m)", min: 0, max: 3, step: 0.05, group: G, tip: "The band's bottom: this far under the ground along the line (things lying low, in hollows)" },
  { key: "sheetStep", label: "Ground sampled every (m)", min: 0.2, max: 2, step: 0.05, group: G, tip: "How finely the line samples the ground for the sheet's top and the shot's landing" },
];

export function penDensity(v: PenValues, m: PenMaterial): number {
  switch (m) {
    case "flesh": return v.penFlesh;
    case "scrapper": return v.penScrapper;
    case "cutter": return v.penCutter;
    case "excavator": return v.penExcavator;
    case "vehicle": return v.penVehicle;
    default: return v.penSteel;
  }
}

/**
 * One sheet: a vertical slab from (ox, oz) along the flat unit direction (dx, dz) for len metres, half wide on each
 * side, from ground - under up to top(along). Shots that sweep (a flying shell) test one sheet per step, `from` along.
 */
export interface Sheet {
  ox: number; oz: number; dx: number; dz: number;
  /** Test from this far along (m) to len. */
  from: number;
  len: number;
  half: number;
  under: number;
  /** The sheet's top at a distance along (world y). */
  top(along: number): number;
  /** The height the shot itself flies at (world y): ground above it costs penetration. The sheet's top when absent (a
   *  tall sheet that reaches up for excavators would otherwise let the slug through everything but dune crests). */
  line?(along: number): number;
  /** The ground's height (world y). */
  ground(x: number, z: number): number;
}

/** One body in a sheet. `key` is the target's own (which unit and part); `at` is a point in the body on the line. */
export interface SheetHit<T = unknown> {
  target: T;
  key: number;
  /** Where the line enters its footprint (m along). */
  along: number;
  /** Chord cut through its footprint (m). */
  chord: number;
  material: PenMaterial;
  x: number; y: number; z: number;
  /** For targets tested by rays (no sheet of their own): the ray to re-run before applying the hit. */
  ray?: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; dist: number };
}

/**
 * Where the line passes a circle of radius r at (cx, cz): its along and across offsets. In the sheet when
 * |across| <= r + half. The chord through the real circle is scaled from the widened one, so a dead-centre line cuts
 * 2r and a graze at the sheet's edge almost nothing (never quite 0: 10% of 2r).
 */
export function sheetCircle(s: Sheet, cx: number, cz: number, r: number): { along: number; across: number; chord: number } | null {
  const qx = cx - s.ox, qz = cz - s.oz;
  const c = qx * s.dx + qz * s.dz, across = Math.abs(qx * s.dz - qz * s.dx);
  const R = r + s.half;
  if (across > R) return null;
  const halfW = Math.sqrt(R * R - across * across);
  const enter = c - halfW * (r / R);
  if (c + halfW < s.from || enter > s.len) return null;
  const chord = Math.max(0.2 * r, 2 * halfW * (r / Math.max(1e-6, R)));
  return { along: Math.max(s.from, enter), across, chord };
}

/** Is a vertical span y0..y1 inside the band at a point along the line (x, z on the line)? */
export function inBand(s: Sheet, along: number, x: number, z: number, y0: number, y1: number): boolean {
  return y1 >= s.ground(x, z) - s.under && y0 <= s.top(along);
}

/**
 * Where a straight segment (a leg bone) comes closest to the sheet's line in plan: the distance along the line, how far
 * across, and the height of the bone there. Null when it's outside the tested stretch.
 */
export function sheetSegment(s: Sheet, ax: number, ay: number, az: number, bx: number, by: number, bz: number): { along: number; across: number; y: number } | null {
  // Bone in the line's frame: u along, w across.
  const ua = (ax - s.ox) * s.dx + (az - s.oz) * s.dz, wa = (ax - s.ox) * s.dz - (az - s.oz) * s.dx;
  const ub = (bx - s.ox) * s.dx + (bz - s.oz) * s.dz, wb = (bx - s.ox) * s.dz - (bz - s.oz) * s.dx;
  // The point of the bone nearest the line (|w| smallest): where w changes sign, else the nearer end.
  let k: number;
  if ((wa <= 0 && wb >= 0) || (wa >= 0 && wb <= 0)) k = Math.abs(wa - wb) < 1e-9 ? 0 : wa / (wa - wb);
  else k = Math.abs(wa) < Math.abs(wb) ? 0 : 1;
  const u = ua + (ub - ua) * k, w = wa + (wb - wa) * k;
  if (u < s.from || u > s.len) return null;
  return { along: u, across: Math.abs(w), y: ay + (by - ay) * k };
}

/** A stretch of the line where the ground rises above the sheet's top: [a, b] m along. */
export interface GroundRise { a: number; b: number }

/** Every stretch of [from, to] where the ground is above the shot's line (else the top), sampled every `step` m. */
export function groundRises(s: Sheet, to: number, step: number, out: GroundRise[] = []): GroundRise[] {
  out.length = 0;
  let open = -1;
  const n = Math.max(1, Math.ceil((to - s.from) / step));
  for (let i = 0; i <= n; i++) {
    const t = Math.min(to, s.from + i * step);
    const over = s.ground(s.ox + s.dx * t, s.oz + s.dz * t) > (s.line ? s.line(t) : s.top(t));
    if (over && open < 0) open = t;
    else if (!over && open >= 0) { out.push({ a: open, b: t }); open = -1; }
  }
  if (open >= 0) out.push({ a: open, b: to });
  return out;
}

/** A hit the shot paid for (or stopped in), with the damage share it carried there. */
export interface PenStep<T = unknown> { hit: SheetHit<T>; share: number; stopped: boolean }

export interface PenResult<T = unknown> {
  /** Bodies reached, in order along the line. */
  steps: PenStep<T>[];
  /** How far along the shot got (m): inside the body or ground it stopped in, else the sheet's end. */
  end: number;
  /** Stopped in the ground (a dune) rather than a body or the end. */
  inGround: boolean;
  /** Budget left at the end (m). */
  left: number;
}

/**
 * Walk the bodies and ground rises in order along the line, paying each one's cost from the budget. A body the shot
 * reaches is hit (with share = (budget left / budget)^curve) even if it can't pay to pass; the shot stops inside it,
 * part way in by what was left. Ground stops it the same way.
 */
export function penetrate<T>(hits: SheetHit<T>[], rises: GroundRise[], budget: number, len: number, v: PenValues): PenResult<T> {
  hits.sort((a, b) => a.along - b.along);
  const steps: PenStep<T>[] = [];
  let left = Math.max(0, budget), r = 0;
  const share = () => (budget > 0 ? Math.pow(Math.max(0, left / budget), v.penCurve) : 1);
  for (const h of hits) {
    // Ground before this body?
    while (r < rises.length && rises[r].a <= h.along) {
      const g = rises[r++], cost = (g.b - g.a) * v.penSand;
      if (cost >= left) return { steps, end: g.a + left / Math.max(1e-6, v.penSand), inGround: true, left: 0 };
      left -= cost;
    }
    const cost = h.chord * penDensity(v, h.material);
    if (cost >= left) {
      steps.push({ hit: h, share: share(), stopped: true });
      return { steps, end: h.along + h.chord * (left / Math.max(1e-6, cost)), inGround: false, left: 0 };
    }
    steps.push({ hit: h, share: share(), stopped: false });
    left -= cost;
  }
  while (r < rises.length) {
    const g = rises[r++], cost = (g.b - g.a) * v.penSand;
    if (cost >= left) return { steps, end: g.a + left / Math.max(1e-6, v.penSand), inGround: true, left: 0 };
    left -= cost;
  }
  return { steps, end: len, inGround: false, left };
}
