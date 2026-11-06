// A way round the cars for anything walking beside the convoy (Keith 2026-11-06: the guardian mechs "won't path around
// things": they walked straight at a threat across the train and stood pressed against a car). Pure: if the straight
// line to the goal runs through a car's footprint, the next point to make for is round that car's nearer end on
// this side (then through the gap between cars, or past the train's end), else the goal itself. Cheap: a slab test
// per car, nothing kept between calls, so it is the same on any peer.
import type { Platform } from "./platform";

/** Clearance (m) past the footprint the line must keep, and how far out round a corner the detour point sits. */
export const DETOUR_CLEAR = 1, DETOUR_ROUND = 3;

type Car = Pick<Platform, "toLocal" | "toWorld" | "halfW" | "spec" | "pushOut">;

const la = { x: 0, z: 0 }, lb = { x: 0, z: 0 }, w = { x: 0, y: 0, z: 0 };

/**
 * Where a body of radius r at (ax, az) heading for (bx, bz) should make for now: `out` set to the goal, or to a point
 * round the first car in the way. Returns true when it is a detour.
 */
export function detour(cars: readonly Car[], ax: number, az: number, bx: number, bz: number, r: number, out: { x: number; z: number }): boolean {
  // A goal inside a car (a threat just beyond it): the nearest spot outside it instead.
  for (const c of cars) { const o = c.pushOut(bx, bz, r + DETOUR_CLEAR + 0.1); if (o) { bx = o.x; bz = o.z; } }
  out.x = bx; out.z = bz;
  let best = Infinity, hit: Car | null = null;
  for (const c of cars) {
    c.toLocal(ax, az, la); c.toLocal(bx, bz, lb);
    const hw = c.halfW + r + DETOUR_CLEAR, hl = c.spec.length / 2 + r + DETOUR_CLEAR;
    // Slab test of the segment a→b against the box.
    let t0 = 0, t1 = 1;
    const dx = lb.x - la.x, dz = lb.z - la.z;
    if (Math.abs(dx) < 1e-9) { if (Math.abs(la.x) > hw) continue; } else {
      let u = (-hw - la.x) / dx, v = (hw - la.x) / dx; if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (Math.abs(la.z) > hl) continue; } else {
      let u = (-hl - la.z) / dz, v = (hl - la.z) / dz; if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) continue;
    }
    if (t0 < best) { best = t0; hit = c; }
  }
  if (!hit) return false;
  hit.toLocal(ax, az, la); hit.toLocal(bx, bz, lb);
  const half = hit.spec.length / 2, side = hit.halfW + r + DETOUR_ROUND, end = half + r + DETOUR_ROUND;
  let px: number, pz: number;
  if (Math.abs(la.z) <= half + r + DETOUR_CLEAR) {
    // Beside it: along this side to the end nearer the way to the goal.
    const sx = Math.sign(la.x) || 1;
    const ez = Math.abs(la.z - end) + Math.abs(lb.z - end) <= Math.abs(la.z + end) + Math.abs(lb.z + end) ? end : -end;
    px = sx * side; pz = ez;
  } else {
    // Past its end (in the gap, or beyond the train): round the corner onto the goal's side.
    px = (Math.sign(lb.x) || 1) * side; pz = Math.sign(la.z) * end;
  }
  hit.toWorld(px, 0, pz, w);
  out.x = w.x; out.z = w.z;
  return true;
}
