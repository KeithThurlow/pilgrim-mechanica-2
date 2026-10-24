// The shallows' ground (Keith 2026-10-25: low water land with small rocks and outcrops popping up out of it, fun to
// cross): a nearly flat floor a little under a still water level, long sandbars just breaking the surface, and rock
// outcrops standing out of the water. Pure, like the dunes. Heights are absolute (the water is level everywhere).
import type { Param } from "../core/tweaks";
import { Noise2, smoothstep } from "./noise";

export const SHALLOWS_DEFAULTS = {
  waterLevel: -1.5,
  shallowDepth: 0.9,
  barHeight: 0.5,
  barShare: 0.16,
  barScale: 90,
  outcropShare: 0.1,
  outcropHeight: 5,
  outcropScale: 40,
  waterClear: 0.3,
  waterDeep: 0.85,
};
export type ShallowsValues = typeof SHALLOWS_DEFAULTS;

const G = "Shallows";
export const SHALLOWS_PARAMS: Param[] = [
  { key: "waterLevel", label: "Water level (m)", min: -10, max: 5, step: 0.05, group: G, onRelease: true },
  { key: "shallowDepth", label: "Depth (m)", min: 0.1, max: 3, step: 0.05, group: G, tip: "Deepest water over the floor; the mech's knee is about 1.5 m up", onRelease: true },
  { key: "barHeight", label: "Sandbars above water (m)", min: 0, max: 2, step: 0.05, group: G, onRelease: true },
  { key: "barShare", label: "Sandbar share", min: 0, max: 0.8, step: 0.01, group: G, onRelease: true },
  { key: "barScale", label: "Sandbar scale (m)", min: 20, max: 400, step: 5, group: G, onRelease: true },
  { key: "outcropShare", label: "Outcrop share", min: 0, max: 0.5, step: 0.005, group: G, onRelease: true },
  { key: "outcropHeight", label: "Outcrop height (m)", min: 0, max: 15, step: 0.1, group: G, onRelease: true },
  { key: "waterClear", label: "Water at the shore (opacity)", min: 0, max: 1, step: 0.01, group: G },
  { key: "waterDeep", label: "Water at depth (opacity)", min: 0, max: 1, step: 0.01, group: G },
  { key: "outcropScale", label: "Outcrop scale (m)", min: 8, max: 200, step: 1, group: G, onRelease: true },
];

export interface ShallowsSample { h: number; /** 0..1 how much of this is outcrop rock */ rock: number }

export class ShallowsGround {
  private n: Noise2;
  private seed = -1;
  constructor(public v: ShallowsValues, seed: number) { this.n = new Noise2(seed * 17 + 9); this.seed = seed; }
  reseed(seed: number) { if (seed !== this.seed) { this.n = new Noise2(seed * 17 + 9); this.seed = seed; } }

  sample(x: number, z: number, out: ShallowsSample = { h: 0, rock: 0 }): ShallowsSample {
    const v = this.v, n = this.n;
    const W = v.waterLevel;
    // The floor: gently uneven, never deeper than shallowDepth.
    let h = W - v.shallowDepth * (0.55 + 0.45 * (n.fbm(x / 60 + 3.3, z / 60 - 1.1, 3) * 0.5 + 0.5));
    // Sandbars: long ridged streaks rising just out of the water.
    if (v.barShare > 0) {
      const r = 1 - Math.abs(n.fbm(x / v.barScale - 5.5, z / (v.barScale * 0.45) + 2.5, 3));
      const b = smoothstep(1 - v.barShare, 1, r);
      h += (W + v.barHeight - h) * b;
    }
    // Outcrops: sparse rock knuckles standing out of the water, steep sided, rough topped.
    let rock = 0;
    if (v.outcropShare > 0) {
      const o = n.fbm(x / v.outcropScale + 41.7, z / v.outcropScale - 13.1, 3) * 0.5 + 0.5;
      const k = smoothstep(1 - v.outcropShare * 2.4, 1 - v.outcropShare * 1.7, o);
      if (k > 0) {
        // Rise from the floor (no lip where an outcrop starts), steepening to a rough top.
        const top = W + v.outcropHeight * (0.6 + 0.4 * n.fbm(x / 7, z / 7, 2));
        const nh = h + (top - h) * k * k * (3 - 2 * k);
        if (nh > h) { rock = smoothstep(0.1, 0.5, k); h = nh; }
      }
    }
    out.h = h; out.rock = rock;
    return out;
  }
}
