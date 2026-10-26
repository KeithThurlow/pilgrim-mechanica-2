// Soft-lock targeting (pure): which enemy the guns take when you aim near it. Keith 2026-10-24: "cast a ray out
// there, and then actually we shoot enemies that are closest to the ray, unless where the cursor is there is actually
// an enemy closer to the cursor"; guns go for centre mass, so height takes care of itself.
//
// 1. Under the cursor: an enemy whose centre of mass lies within its radius + `lockCursor` of the camera's cursor ray,
//    or a tall walker whose footprint (its planted feet, + `lockCursor`) holds the cursor's ground point: its body is
//    the target either way, never its feet (Keith 2026-10-26). Closest to that ray wins.
// 2. Otherwise along the line of fire: from the mech through the cursor's ground point, on out to gun range. An enemy
//    within `lockWidth` + a widening cone (`lockCone`) of that line counts; closest to the line wins (a little bias to
//    nearer ones).
// The last target is kept while it still qualifies unless another is clearly better (`lockSticky`).
// The candidates come from the register (src/game/register.ts; docs/proposal-register.md step 2): no lab writes a list.
import type { Param } from "../core/tweaks";
import { FLAG, RayHits, viewOf, type Filter, type Register } from "./register";

export const TARGET_DEFAULTS = {
  autoLock: 1,
  lockCursor: 1.5,
  lockWidth: 2,
  lockCone: 6,
  lockSticky: 0.4,
  lockLead: 0.12,
  /** Not a slider: degrees a fitted sensor head adds to `lockCone` (src/items/loadout.ts resolve, sensorLock). */
  sensorLock: 0,
};
export type TargetValues = typeof TARGET_DEFAULTS;

export const TARGET_PARAMS: Param[] = [
  { key: "autoLock", label: "Soft lock on (0/1)", min: 0, max: 1, step: 1, group: "Targeting" },
  { key: "lockCursor", label: "Under cursor: reach past the body (m)", min: 0, max: 6, step: 0.1, group: "Targeting" },
  { key: "lockWidth", label: "Line of fire: width (m)", min: 0, max: 10, step: 0.1, group: "Targeting" },
  { key: "lockCone", label: "Line of fire: widening (deg)", min: 0, max: 30, step: 0.5, group: "Targeting" },
  { key: "lockLead", label: "Lead a moving target (s)", min: 0, max: 0.6, step: 0.01, group: "Targeting", tip: "Aim this far ahead of a locked target's motion: the guns trail their aim a little as they track (about 1 / gun tracking), so leading by that much puts the rounds on it" },
  { key: "lockSticky", label: "Keep the last target (0-1)", min: 0, max: 1, step: 0.05, group: "Targeting" },
];

/** One enemy the guns could take: its centre of mass, a body radius, and a key that stays the same while it lives
 *  (the register's id). vx, vz: its ground velocity (m/s), so the guns can lead it. foot: a tall walker's footprint (m,
 *  flat from under its body to its farthest planted foot): a cursor on the sand inside it is on the walker, and the
 *  lock takes its body (Keith 2026-10-26: hard to target the tall walkers). Made from a register entry (viewOf). */
export interface TargetCandidate { x: number; y: number; z: number; r: number; key: unknown; vx?: number; vz?: number; foot?: number }

export interface Vec3 { x: number; y: number; z: number }

export interface LockQuery {
  /** The camera's cursor ray (origin, unit direction). */
  rayO: Vec3; rayD: Vec3;
  /** Where the line of fire starts (the mech) and the cursor's ground point it passes through. */
  from: Vec3; cursor: Vec3;
  range: number;
}

export interface Lock { target: TargetCandidate; how: "cursor" | "line" }

/** Who the player's guns may take: anything hittable not on the player's team (a register filter). */
export const enemiesOf = (team: number): Filter => ({ all: FLAG.Hittable, notTeam: team });

/**
 * The soft lock over the register: the grid hands back the few things near the cursor ray's shadow on the ground,
 * round the cursor (footprints) and in the line of fire; the rules above run on those only.
 */
export class Targeting {
  /** The last target's id (sticky). */
  last: unknown = null;
  private cand: number[] = [];
  private feet: number[] = [];
  private hits = new RayHits();

  pick(reg: Register, f: Filter, q: LockQuery, v: TargetValues): Lock | null {
    if (!v.autoLock) { this.last = null; return null; }
    const sticky = 1 - v.lockSticky * 0.6;
    // 1. Under the cursor: things near the cursor ray (by its shadow on the ground, out a little past the cursor where
    // the ray is already under the sand), and walkers whose footprint holds the cursor.
    let best = -1, bestS = Infinity;
    const hx = q.rayD.x, hz = q.rayD.z, hl = Math.hypot(hx, hz);
    const cand = this.cand, feet = this.feet;
    cand.length = 0;
    if (hl > 1e-4) {
      // A body within r + lockCursor of the 3D ray is within that of its shadow; past the cursor the ray sinks
      // `slope` m per m, so a body above the sand can only be near it for 2 * reach / slope more.
      const toCursor = ((q.cursor.x - q.rayO.x) * hx + (q.cursor.z - q.rayO.z) * hz) / hl;
      const slope = Math.max(0.2, -q.rayD.y / hl), reach = reg.maxR + v.lockCursor;
      reg.ray(q.rayO.x, q.rayO.z, hx, hz, Math.max(0, toCursor) + (2 * reach) / slope + 2, v.lockCursor, f, this.hits);
      for (let k = 0; k < this.hits.n; k++) cand.push(this.hits.e[k]);
    } else reg.near(q.cursor.x, q.cursor.z, v.lockCursor + reg.maxR, f, cand);
    reg.near(q.cursor.x, q.cursor.z, v.lockCursor, f, feet, true);
    const n = cand.length + feet.length;
    for (let k = 0; k < n; k++) {
      const e = k < cand.length ? cand[k] : feet[k - cand.length];
      const cx = reg.x[e], cy = reg.y[e], cz = reg.z[e], r = reg.r[e], foot = reg.foot[e];
      const ox = cx - q.rayO.x, oy = cy - q.rayO.y, oz = cz - q.rayO.z;
      const t = ox * q.rayD.x + oy * q.rayD.y + oz * q.rayD.z;
      if (t <= 0) continue;
      const dx = ox - q.rayD.x * t, dy = oy - q.rayD.y * t, dz = oz - q.rayD.z * t;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // A tall walker: the cursor anywhere on the sand among its feet counts too (a little behind a hit on a body).
      let s = d <= r + v.lockCursor ? d / (r + v.lockCursor + 1e-3) : Infinity;
      if (foot > 0) {
        const reachF = foot + v.lockCursor, fd = Math.hypot(q.cursor.x - cx, q.cursor.z - cz);
        if (fd <= reachF) s = Math.min(s, 0.5 + 0.5 * (fd / reachF));
      }
      if (s === Infinity) continue;
      if (Math.hypot(cx - q.from.x, cz - q.from.z) > q.range) continue;
      s *= reg.id[e] === this.last ? sticky : 1;
      if (s < bestS || (s === bestS && reg.id[e] < reg.id[best])) { bestS = s; best = e; }
    }
    if (best >= 0) { this.last = reg.id[best]; return { target: viewOf(reg, best), how: "cursor" }; }
    // 2. Along the line of fire (flat).
    let ux = q.cursor.x - q.from.x, uz = q.cursor.z - q.from.z;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-3) { this.last = null; return null; }
    ux /= ul; uz /= ul;
    // A fitted sensor head widens the cone (sensorLock).
    const cone = ((v.lockCone + (v.sensorLock ?? 0)) * Math.PI) / 180, tanCone = Math.tan(cone);
    reg.cone(q.from.x, q.from.z, ux, uz, q.range, v.lockWidth, cone, f, cand);
    for (const e of cand) {
      const ox = reg.x[e] - q.from.x, oz = reg.z[e] - q.from.z;
      const t = ox * ux + oz * uz;
      const d = Math.abs(ox * uz - oz * ux);
      const allow = reg.r[e] + v.lockWidth + t * tanCone;
      const s = (d / allow + (t / q.range) * 0.15) * (reg.id[e] === this.last ? sticky : 1);
      if (s < bestS || (s === bestS && reg.id[e] < reg.id[best])) { bestS = s; best = e; }
    }
    this.last = best >= 0 ? reg.id[best] : null;
    return best >= 0 ? { target: viewOf(reg, best), how: "line" } : null;
  }
}
