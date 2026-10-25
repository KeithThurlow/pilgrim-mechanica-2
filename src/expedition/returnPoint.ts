// The return point (pure, docs/proposal-expedition.md): where the mech would meet the convoy if it headed back now at
// walking speed. Not where the convoy is: the convoy rolls on along its planned route (ConvoyRoute.ahead), so each
// crane is a point moving along the route at the convoy's speed, and the meeting is the first time t at which a mech
// walking straight at homeSpeed could be inside the crane's pick-up reach of where that crane will be at t:
//   |mech - crane(t)| - reach <= speed * t.
// Every crane is tried (front and rear bays); the soonest wins. The estimate shown ("Home 3:40") is that time plus
// homeMargin (the crane's own pick-up time, a few seconds of slack).
import type { Param } from "../core/tweaks";
import type { RoutePoint } from "../convoy/route";

export const RETURN_DEFAULTS = {
  homePace: 1,
  homeReach: 0.8,
  homeMargin: 15,
  homeHorizon: 1800,
};
export type ReturnValues = typeof RETURN_DEFAULTS;

const G = "Way home";
export const RETURN_PARAMS: Param[] = [
  { key: "homePace", label: "Estimate pace (× walk)", min: 0.5, max: 1.6, step: 0.01, group: G, tip: "The return estimate assumes the mech walks home at this share of its walk speed" },
  { key: "homeReach", label: "Meet within (× pick-up range)", min: 0, max: 1, step: 0.05, group: G, tip: "How far inside the crane's pick-up range the estimate aims to arrive" },
  { key: "homeMargin", label: "Margin (s)", min: 0, max: 90, step: 1, group: G, tip: "Added to the walking time: the crane's pick-up and some slack" },
  { key: "homeHorizon", label: "Look ahead (s)", min: 300, max: 3600, step: 30, group: G, tip: "Longest meeting time searched; past it the mech can't catch the convoy at walking pace" },
];

/** A crane as the return point sees it: how far along the route (from the convoy's head) and to the side it rides. */
export interface CraneTrack { along: number; side: number }

/** Each mech bay's crane as a track: the bay's place in the train plus the crane's mount along the deck. */
export function craneTracks(bays: { along: number; side: number; craneEnd: number }[], craneMount: number, out: CraneTrack[] = []): CraneTrack[] {
  out.length = 0;
  for (const b of bays) out.push({ along: b.along + craneMount * b.craneEnd, side: b.side });
  return out;
}

/** The route, as far as the return point needs it: where it will be at distance s, beside it by side. */
export interface RouteAhead { aheadOffset(s: number, side: number, out?: RoutePoint): RoutePoint; s: number }

export interface ReturnPoint {
  /** Where the meeting happens (where the crane will be). */
  x: number; z: number;
  /** Seconds of walking to get there (inside the reach), and the shown estimate (plus the margin). */
  walk: number;
  eta: number;
  /** Which crane (index into the list). */
  crane: number;
  /** False when no meeting inside the horizon (falling behind a convoy faster than the mech's pace). */
  reachable: boolean;
}

const tmp: RoutePoint = { x: 0, z: 0, heading: 0 };

/**
 * The return point for a mech at (x, z). speed: the mech's walk speed (m/s); convoySpeed (m/s); reach: the crane's
 * pick-up range (m).
 */
export function returnPoint(
  v: ReturnValues, route: RouteAhead, cranes: CraneTrack[], x: number, z: number,
  speed: number, convoySpeed: number, reach: number, out: ReturnPoint = { x: 0, z: 0, walk: 0, eta: 0, crane: 0, reachable: false },
): ReturnPoint {
  const w = Math.max(0.1, speed * v.homePace), r = reach * v.homeReach, H = v.homeHorizon;
  let bestT = Infinity, bestI = 0;
  for (let i = 0; i < cranes.length; i++) {
    const c = cranes[i];
    // g(t) = distance left over after walking t seconds: the first t where it drops to zero.
    const g = (t: number) => {
      route.aheadOffset(route.s + c.along + convoySpeed * t, c.side, tmp);
      return Math.hypot(tmp.x - x, tmp.z - z) - r - w * t;
    };
    if (g(0) <= 0) { bestT = 0; bestI = i; break; }
    // Step out until it changes sign (steps grow with t, the sign change can't be skipped: g falls at most w + vc per s).
    let a = 0, b = 0, found = false;
    for (let t = 2; t <= H && t < bestT; t += Math.max(2, t * 0.05)) {
      if (g(t) <= 0) { b = t; found = true; break; }
      a = t;
    }
    if (!found) continue;
    for (let k = 0; k < 24; k++) { const m = (a + b) / 2; if (g(m) <= 0) b = m; else a = m; }
    if (b < bestT) { bestT = b; bestI = i; }
  }
  out.reachable = Number.isFinite(bestT);
  const t = out.reachable ? bestT : H;
  const c = cranes[bestI] ?? { along: 0, side: 0 };
  route.aheadOffset(route.s + c.along + convoySpeed * t, c.side, tmp);
  out.x = tmp.x; out.z = tmp.z; out.crane = bestI;
  out.walk = t;
  out.eta = t + v.homeMargin;
  return out;
}

/** m:ss for the HUD. */
export function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
