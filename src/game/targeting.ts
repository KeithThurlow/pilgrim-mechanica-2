// Soft-lock targeting (pure): which enemy the guns take when you aim near it. Keith 2026-10-24: "cast a ray out
// there, and then actually we shoot enemies that are closest to the ray, unless where the cursor is there is actually
// an enemy closer to the cursor"; guns go for centre mass, so height takes care of itself.
//
// 1. Under the cursor: an enemy whose centre of mass lies within its radius + `lockCursor` of the camera's cursor ray
//    (so a tall walker's body counts even when the cursor is over its feet). Closest to that ray wins.
// 2. Otherwise along the line of fire: from the mech through the cursor's ground point, on out to gun range. An enemy
//    within `lockWidth` + a widening cone (`lockCone`) of that line counts; closest to the line wins (a little bias to
//    nearer ones).
// The last target is kept while it still qualifies unless another is clearly better (`lockSticky`).
import type { Param } from "../core/tweaks";

export const TARGET_DEFAULTS = {
  autoLock: 1,
  lockCursor: 1.5,
  lockWidth: 2,
  lockCone: 6,
  lockSticky: 0.4,
  lockLead: 0.12,
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

/** One enemy the guns could take: its centre of mass, a body radius, and a key that stays the same while it lives. */
/** vx, vz: its ground velocity (m/s), when it moves, so the guns can lead it. */
export interface TargetCandidate { x: number; y: number; z: number; r: number; key: unknown; vx?: number; vz?: number }

export interface Vec3 { x: number; y: number; z: number }

export interface LockQuery {
  /** The camera's cursor ray (origin, unit direction). */
  rayO: Vec3; rayD: Vec3;
  /** Where the line of fire starts (the mech) and the cursor's ground point it passes through. */
  from: Vec3; cursor: Vec3;
  range: number;
}

export interface Lock { target: TargetCandidate; how: "cursor" | "line" }

export class Targeting {
  last: unknown = null;

  pick(cands: readonly TargetCandidate[], q: LockQuery, v: TargetValues): Lock | null {
    if (!v.autoLock) { this.last = null; return null; }
    const sticky = 1 - v.lockSticky * 0.6;
    // 1. Under the cursor.
    let best: TargetCandidate | null = null, bestS = Infinity;
    for (const c of cands) {
      const ox = c.x - q.rayO.x, oy = c.y - q.rayO.y, oz = c.z - q.rayO.z;
      const t = ox * q.rayD.x + oy * q.rayD.y + oz * q.rayD.z;
      if (t <= 0) continue;
      const dx = ox - q.rayD.x * t, dy = oy - q.rayD.y * t, dz = oz - q.rayD.z * t;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > c.r + v.lockCursor) continue;
      if (Math.hypot(c.x - q.from.x, c.z - q.from.z) > q.range) continue;
      const s = (d / (c.r + v.lockCursor + 1e-3)) * (c.key === this.last ? sticky : 1);
      if (s < bestS) { bestS = s; best = c; }
    }
    if (best) { this.last = best.key; return { target: best, how: "cursor" }; }
    // 2. Along the line of fire (flat).
    let ux = q.cursor.x - q.from.x, uz = q.cursor.z - q.from.z;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-3) { this.last = null; return null; }
    ux /= ul; uz /= ul;
    const tanCone = Math.tan((v.lockCone * Math.PI) / 180);
    for (const c of cands) {
      const ox = c.x - q.from.x, oz = c.z - q.from.z;
      const t = ox * ux + oz * uz;
      if (t <= 0 || t > q.range) continue;
      const d = Math.abs(ox * uz - oz * ux);
      const allow = c.r + v.lockWidth + t * tanCone;
      if (d > allow) continue;
      const s = (d / allow + t / q.range * 0.15) * (c.key === this.last ? sticky : 1);
      if (s < bestS) { bestS = s; best = c; }
    }
    this.last = best ? best.key : null;
    return best ? { target: best, how: "line" } : null;
  }
}
