// How far out from the convoy's road a place is, and what that means (pure, deterministic, a function of position
// and the route like the POIs, so every peer agrees; Keith 2026-10-27/28: the further out, the more enemies and the
// better the pay). Depth is the distance to the nearest point of the road: laid behind the convoy, planned ahead of
// it (ConvoyRoute.ahead). The road is a fixed property of the world, so a place has the same depth at any clock time.
// Only the stretch from DEPTH_BEHIND behind the convoy's head to DEPTH_AHEAD ahead of it is searched; the road is
// planned and laid as the convoy rolls, so a place's depth is final once it is inside that window.
// Danger is depth turned into a smooth 0..depthCap factor (0 until depthStart, 1 at depthFull) that camps, packs,
// raids and scrap read; the ring is its label for the HUD and the radar. The per-depth multipliers live next to the
// system they scale (camps.ts, threats.ts, salvage.ts), all in the "Depth" slider group.
import type { Param } from "../core/tweaks";
import type { ConvoyRoute } from "../convoy/route";

export const DEPTH_GROUP = "Depth";
export const DEPTH_DEFAULTS = {
  depthNear: 400, depthOut: 1000, depthDeep: 2000,
  depthStart: 150, depthFull: 2000, depthCap: 1.5,
  depthRings: 1,
  depthLive: 1,
  depthTrain: 130,
};
export type DepthValues = typeof DEPTH_DEFAULTS;
export const DEPTH_PARAMS: Param[] = [
  { key: "depthNear", label: "Near ring to (m)", min: 100, max: 1500, step: 10, group: DEPTH_GROUP, tip: "Distance from the road: Near up to here" },
  { key: "depthOut", label: "Out ring to (m)", min: 300, max: 3000, step: 10, group: DEPTH_GROUP },
  { key: "depthDeep", label: "Deep ring to (m); Far beyond", min: 500, max: 6000, step: 10, group: DEPTH_GROUP },
  { key: "depthStart", label: "Danger starts at (m)", min: 0, max: 1000, step: 10, group: DEPTH_GROUP, tip: "Inside this the sand is as it was before depth (danger 0)" },
  { key: "depthFull", label: "Danger 1 at (m)", min: 300, max: 6000, step: 10, group: DEPTH_GROUP, tip: "Every 'at full depth' multiplier below applies in full here" },
  { key: "depthCap", label: "Danger tops out at", min: 1, max: 3, step: 0.05, group: DEPTH_GROUP, tip: "Past full depth the multipliers keep growing, up to this many times the full effect" },
  { key: "depthRings", label: "Rings on the convoy radar (0/1)", min: 0, max: 1, step: 1, group: DEPTH_GROUP },
  { key: "depthLive", label: "Live depth from convoy (0-1)", min: 0, max: 1, step: 0.05, group: DEPTH_GROUP, tip: "For what happens live (roaming packs, raids, the salvage heat's answer): 1 measures depth from the convoy as it is now, 0 from the road. Camps and scrap are placed in the world, so they always use the road" },
  { key: "depthTrain", label: "Convoy length for depth (m)", min: 0, max: 400, step: 5, group: DEPTH_GROUP, tip: "Depth from the convoy is the distance to the stretch of road this long behind its head" },
];

export type Ring = "Near" | "Out" | "Deep" | "Far";
export const RING_NAMES: Ring[] = ["Near", "Out", "Deep", "Far"];
export type DangerFn = (x: number, z: number) => number;

const DEPTH_BEHIND = 2500, DEPTH_AHEAD = 5000, DEPTH_STEP = 50;
interface Line { key: string; xs: number[]; zs: number[] }
const lines = new WeakMap<ConvoyRoute, Line>();

function lineFor(route: ConvoyRoute): Line {
  const key = `${Math.floor(route.s / DEPTH_STEP)}|${route.count}|${Math.round(route.end)}`;
  let l = lines.get(route);
  if (l && l.key === key) return l;
  l = { key, xs: [], zs: [] };
  const p = { x: 0, z: 0, heading: 0 };
  for (let s = route.s - DEPTH_BEHIND; s <= route.s + DEPTH_AHEAD; s += DEPTH_STEP) { route.ahead(s, p); l.xs.push(p.x); l.zs.push(p.z); }
  lines.set(route, l);
  return l;
}

/** Distance (m) from (x, z) to the convoy's road, laid and planned. */
export function depthAt(route: ConvoyRoute, x: number, z: number): number {
  const { xs, zs } = lineFor(route);
  let best = Infinity;
  for (let i = 0; i + 1 < xs.length; i++) {
    const ax = xs[i], az = zs[i], bx = xs[i + 1] - ax, bz = zs[i + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1)));
    const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Distance (m) from (x, z) to the convoy as it is at clock s (the head's distance along the route; default now): to
 * the stretch of road the train fills, trainLen behind the head. Deterministic, since the convoy follows the clock.
 */
export function convoyDepth(route: ConvoyRoute, x: number, z: number, trainLen = 130, s = route.s): number {
  const a = route.ahead(s, { x: 0, z: 0, heading: 0 }), b = route.ahead(s - Math.max(0, trainLen), { x: 0, z: 0, heading: 0 });
  const bx = a.x - b.x, bz = a.z - b.z;
  const t = Math.max(0, Math.min(1, ((x - b.x) * bx + (z - b.z) * bz) / (bx * bx + bz * bz || 1)));
  return Math.hypot(x - b.x - bx * t, z - b.z - bz * t);
}

/** Danger from a depth: 0 until depthStart, 1 at depthFull, on past it up to depthCap. */
export function dangerOf(v: DepthValues, depth: number): number {
  const span = Math.max(1, v.depthFull - v.depthStart);
  return Math.max(0, Math.min(v.depthCap, (depth - v.depthStart) / span));
}

export function ringOf(v: DepthValues, depth: number): Ring {
  return depth < v.depthNear ? "Near" : depth < v.depthOut ? "Out" : depth < v.depthDeep ? "Deep" : "Far";
}

/** A multiplier that is 1 at danger 0 and `atFull` at danger 1 (and on, linearly, past it). */
export const scaled = (atFull: number, danger: number) => 1 + (atFull - 1) * danger;

/** The route's depth and danger as functions, with the last answer remembered (the HUD asks every frame). */
export class DepthField {
  private lx = NaN; private lz = NaN; private ld = 0;
  constructor(private route: ConvoyRoute, public v: DepthValues) {}
  depth(x: number, z: number): number {
    if (x !== this.lx || z !== this.lz) { this.ld = depthAt(this.route, x, z); this.lx = x; this.lz = z; }
    return this.ld;
  }
  /** Depth for what happens live: from the convoy now, the road, or a blend (depthLive). */
  liveDepth(x: number, z: number): number {
    const k = Math.max(0, Math.min(1, this.v.depthLive));
    const road = this.depth(x, z);
    return k > 0 ? road * (1 - k) + convoyDepth(this.route, x, z, this.v.depthTrain) * k : road;
  }
  liveDanger: DangerFn = (x, z) => dangerOf(this.v, this.liveDepth(x, z));
  danger: DangerFn = (x, z) => dangerOf(this.v, this.depth(x, z));
  ring(x: number, z: number): Ring { return ringOf(this.v, this.depth(x, z)); }
}
