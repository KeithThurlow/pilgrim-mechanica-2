// The rocky biome's ground (Keith 2026-10-25: a rocky, desolate area; always walkable for now): broad eroded shelves
// stepping down in terraces with steep but walkable risers, wind-cut ridges, rough boulder-scale lumps, and sand
// lying flat in the hollows. Pure, like the dunes. Heights are relative to the shared swell.
import type { Param } from "../core/tweaks";
import { Noise2, smoothstep, lerp } from "./noise";

export const ROCK_DEFAULTS = {
  rockHeight: 22,
  rockScale: 170,
  rockStep: 3.2,
  rockFace: 0.22,
  rockTerrace: 0.8,
  rockRidge: 0.45,
  rockRough: 0.25,
  rockSand: 0.35,
};
export type RockValues = typeof ROCK_DEFAULTS;

const G = "Rocky ground";
export const ROCK_PARAMS: Param[] = [
  { key: "rockHeight", label: "Relief (m)", min: 0, max: 40, step: 0.5, group: G, onRelease: true },
  { key: "rockScale", label: "Shelf scale (m)", min: 40, max: 1000, step: 5, group: G, onRelease: true },
  { key: "rockStep", label: "Terrace step (m)", min: 0.5, max: 10, step: 0.1, group: G, onRelease: true },
  { key: "rockFace", label: "Riser share", min: 0.08, max: 1, step: 0.01, group: G, tip: "Share of each terrace that is the riser: smaller is steeper (kept walkable)", onRelease: true },
  { key: "rockTerrace", label: "Terracing", min: 0, max: 1, step: 0.01, group: G, tip: "0 smooth eroded rock, 1 sharp shelves", onRelease: true },
  { key: "rockRidge", label: "Ridges", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "rockRough", label: "Rough lumps (m)", min: 0, max: 2, step: 0.01, group: G, onRelease: true },
  { key: "rockSand", label: "Sand in the hollows", min: 0, max: 0.9, step: 0.01, group: G, tip: "Share of the relief filled with flat sand", onRelease: true },
];

export interface RockSample { h: number; /** 0 sand in a hollow .. 1 bare rock */ bare: number }

export class RockGround {
  private n: Noise2;
  private seed = -1;
  constructor(public v: RockValues, seed: number) { this.n = new Noise2(seed * 13 + 3); this.seed = seed; }
  reseed(seed: number) { if (seed !== this.seed) { this.n = new Noise2(seed * 13 + 3); this.seed = seed; } }

  /** The sand floor height in the hollows (relative to the swell). */
  sandLevel() { return this.v.rockHeight * this.v.rockSand; }

  sample(x: number, z: number, out: RockSample = { h: 0, bare: 1 }): RockSample {
    const v = this.v, n = this.n, S = v.rockScale, H = v.rockHeight;
    let base = (n.fbm(x / S + 11.3, z / S - 4.7, 4) * 0.5 + 0.5) * H;
    if (v.rockRidge > 0) {
      const r = 1 - Math.abs(n.fbm(x / (S * 0.55) - 21.1, z / (S * 0.55) + 9.9, 3));
      base += v.rockRidge * H * 0.35 * r * r * r;
    }
    if (v.rockTerrace > 0 && v.rockStep > 0.05) {
      const q = base / v.rockStep, k = Math.floor(q), f = q - k;
      base = lerp(base, (k + smoothstep(1 - v.rockFace, 1, f)) * v.rockStep, v.rockTerrace);
    }
    const h = base + v.rockRough * n.fbm(x / 9 + 2.2, z / 9 - 8.8, 2);
    const sand = this.sandLevel();
    out.h = Math.max(h, sand);
    out.bare = smoothstep(sand, sand + 0.6, h);
    return out;
  }
}
