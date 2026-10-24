// Dune-style crawler tracks on the big platforms (Keith 2026-10-24: "the longer side of the track is on the sand,
// and it's sort of a trapezoid shape"). Pure geometry, no rendering: where the track pods sit under a platform and
// the tread's path round each one.
//
// A pod's side profile is a trapezoid: the bottom run (long) on the sand, the top run (trackTop of it) above at
// trackHeight, the ends sloping in between. The tread is a loop of plates round that path; as the platform rolls,
// the plates on the bottom run stay still against the sand (they move back along the pod at the platform's speed)
// and the top run carries them forward. trackPods pods per side share the platform's length.
// The pods stand out trackOut past the deck's edges, so they read from the game camera above.
// Frame: the platform's local frame (x left, y up, z forward), y = 0 on the ground plane.
import type { Param } from "../core/tweaks";
import type { PlatformSpec } from "./platform";

export const TRACK_DEFAULTS = {
  trackPods: 2,
  trackTop: 0.62,
  trackHeight: 2.5,
  trackWidth: 2.6,
  trackPitch: 0.75,
  trackPodGap: 2,
  trackOut: 1.5,
};
export type TrackValues = typeof TRACK_DEFAULTS;

export const TRACK_PARAMS: Param[] = [
  { key: "trackPods", label: "Track pods per side", min: 1, max: 3, step: 1, group: "Tracks", tip: "Crawler units along each side of a tracked platform" },
  { key: "trackTop", label: "Top run / bottom run", min: 0.3, max: 1, step: 0.01, group: "Tracks", tip: "How much shorter the top of the track is than the run on the sand (1 = a box, lower = steeper sloping ends)" },
  { key: "trackHeight", label: "Track height (m)", min: 1.2, max: 3.2, step: 0.05, group: "Tracks" },
  { key: "trackWidth", label: "Track width (m)", min: 1.2, max: 3.6, step: 0.05, group: "Tracks", tip: "Also the width of the ruts they leave" },
  { key: "trackPitch", label: "Tread plate length (m)", min: 0.4, max: 1.5, step: 0.05, group: "Tracks" },
  { key: "trackPodGap", label: "Gap between pods (m)", min: 0.5, max: 8, step: 0.1, group: "Tracks" },
  { key: "trackOut", label: "Tracks stand out (m)", min: 0, max: 3, step: 0.05, group: "Tracks", tip: "How far the crawlers stick out past the deck's edges (seen from above); the platform's footprint grows with them" },
];

/** One crawler unit: lateral position, bottom run from z1 (rear) to z0 (front), top run inset by `slope` each end. */
export interface Pod {
  x: number;
  z0: number;
  z1: number;
  /** How far in from each end the top run starts (m). */
  slope: number;
  h: number;
  w: number;
}

/** Share of the platform's length the pods span. */
const SPAN = 0.94;

/** The pods under a tracked platform (none for wheeled ones), front to back on each side, left side first. */
export function trackPods(spec: PlatformSpec, v: TrackValues): Pod[] {
  if (!spec.tracked) return [];
  const n = Math.max(1, Math.round(v.trackPods));
  const total = spec.length * SPAN, gap = n > 1 ? Math.min(v.trackPodGap, total / n / 2) : 0;
  const len = (total - (n - 1) * gap) / n;
  const x = spec.width / 2 + Math.max(0, v.trackOut) - v.trackWidth / 2;
  const out: Pod[] = [];
  for (const sx of [1, -1]) for (let i = 0; i < n; i++) {
    const z0 = total / 2 - i * (len + gap), z1 = z0 - len;
    out.push({ x: sx * x, z0, z1, slope: (len * (1 - v.trackTop)) / 2, h: v.trackHeight, w: v.trackWidth });
  }
  return out;
}

/** Length of the tread loop round a pod (along the plates' centre line). */
export function treadLength(p: Pod) {
  const bottom = p.z0 - p.z1, top = bottom - 2 * p.slope, end = Math.hypot(p.slope, p.h);
  return bottom + top + 2 * end;
}

/**
 * A point on the tread loop at distance u (wrapped), and the way the loop runs there (unit y, z). The loop starts at
 * the front of the bottom run and runs backward along the sand, up the rear slope, forward along the top and down
 * the front slope, so u = travelled + offset puts the bottom plates still against the ground.
 */
export function treadAt(p: Pod, u: number, out = { y: 0, z: 0, ty: 0, tz: 0 }) {
  const L = treadLength(p);
  u = ((u % L) + L) % L;
  const bottom = p.z0 - p.z1, top = bottom - 2 * p.slope, end = Math.hypot(p.slope, p.h);
  if (u < bottom) { out.y = 0; out.z = p.z0 - u; out.ty = 0; out.tz = -1; return out; }
  u -= bottom;
  if (u < end) { const t = u / end; out.y = p.h * t; out.z = p.z1 + p.slope * t; out.ty = p.h / end; out.tz = p.slope / end; return out; }
  u -= end;
  if (u < top) { out.y = p.h; out.z = p.z1 + p.slope + u; out.ty = 0; out.tz = 1; return out; }
  u -= top;
  const t = u / end;
  out.y = p.h * (1 - t); out.z = p.z0 - p.slope * (1 - t); out.ty = -p.h / end; out.tz = p.slope / end;
  return out;
}
