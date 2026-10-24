// The biome map (Keith 2026-10-25: desert, a rocky desolate land and shallows; regions at least 5 km across). A pure
// function of position: the world is cut into warped Voronoi regions, each one biome, and near a border the weights of
// the regions either side blend over `biomeBlend` metres. Inside a region the weight is exactly 1, so nothing is mixed
// there. The ground (terrain.ts) blends each biome's own height function by these weights.
import type { Param } from "../core/tweaks";
import { Noise2, smoothstep } from "./noise";

export const BIOME_DEFAULTS = {
  biomeSize: 5000,
  biomeBlend: 300,
  biomeWarp: 0.3,
  biomeEdgeWiggle: 40,
  desertShare: 1,
  rockyShare: 1,
  shallowsShare: 0.7,
  /** -1: the biome map; 0, 1, 2: everywhere desert, rocky or shallows (for tuning one in the labs). */
  biomeOnly: -1,
};
export type BiomeValues = typeof BIOME_DEFAULTS;

const G = "Biome map";
export const BIOME_PARAMS: Param[] = [
  { key: "biomeSize", label: "Region size (m)", min: 300, max: 12000, step: 50, group: G, tip: "Typical width of one biome's region (Keith: at least 5 km). Shrink it in the lab to see borders up close", onRelease: true },
  { key: "biomeBlend", label: "Border width (m)", min: 10, max: 1500, step: 5, group: G, tip: "How wide the band is where one biome turns into the next", onRelease: true },
  { key: "biomeWarp", label: "Border warp", min: 0, max: 1, step: 0.01, group: G, tip: "How far borders wander from straight lines", onRelease: true },
  { key: "biomeEdgeWiggle", label: "Border wiggle (m)", min: 0, max: 200, step: 1, group: G, tip: "Small-scale raggedness along a border", onRelease: true },
  { key: "desertShare", label: "Desert share", min: 0, max: 3, step: 0.05, group: G, onRelease: true },
  { key: "rockyShare", label: "Rocky share", min: 0, max: 3, step: 0.05, group: G, onRelease: true },
  { key: "shallowsShare", label: "Shallows share", min: 0, max: 3, step: 0.05, group: G, onRelease: true },
  { key: "biomeOnly", label: "Only one biome (-1 map, 0 desert, 1 rocky, 2 shallows)", min: -1, max: 2, step: 1, group: G, onRelease: true },
];

export const DESERT = 0, ROCKY = 1, SHALLOWS = 2;
export const BIOME_NAMES = ["desert", "rocky", "shallows"] as const;

/** Weights of each biome at a point; they always add up to 1. */
export interface BiomeWeights { desert: number; rocky: number; shallows: number }

const hash = (i: number, j: number, s: number) => {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class BiomeMap {
  private n: Noise2;
  private seed = -1;
  private w = [0, 0, 0];
  private ds = new Float64Array(9);
  private ks = new Uint8Array(9);

  constructor(public v: BiomeValues, seed: number) { this.n = new Noise2(seed * 31 + 5); this.seed = seed; }

  reseed(seed: number) { if (seed !== this.seed) { this.n = new Noise2(seed * 31 + 5); this.seed = seed; } }

  /** Which biome a region (cell i, j) is, by the shares. */
  private kindOf(i: number, j: number) {
    const v = this.v, t = v.desertShare + v.rockyShare + v.shallowsShare;
    if (t <= 0) return DESERT;
    const r = hash(i, j, this.seed) * t;
    return r < v.desertShare ? DESERT : r < v.desertShare + v.rockyShare ? ROCKY : SHALLOWS;
  }

  weights(x: number, z: number, out: BiomeWeights = { desert: 0, rocky: 0, shallows: 0 }): BiomeWeights {
    const v = this.v;
    if (v.biomeOnly >= 0) {
      out.desert = v.biomeOnly === DESERT ? 1 : 0; out.rocky = v.biomeOnly === ROCKY ? 1 : 0; out.shallows = v.biomeOnly === SHALLOWS ? 1 : 0;
      return out;
    }
    const S = v.biomeSize, n = this.n;
    // Warp the lookup so borders wander, plus a fine wiggle so they're ragged up close.
    let px = x + v.biomeWarp * S * 0.5 * n.fbm(x / (S * 0.8) + 3.1, z / (S * 0.8) - 1.7, 2);
    let pz = z + v.biomeWarp * S * 0.5 * n.fbm(x / (S * 0.8) - 8.3, z / (S * 0.8) + 4.4, 2);
    if (v.biomeEdgeWiggle > 0) {
      px += v.biomeEdgeWiggle * n.fbm(x / 90 + 50.5, z / 90, 2);
      pz += v.biomeEdgeWiggle * n.fbm(x / 90, z / 90 - 70.2, 2);
    }
    const ci = Math.floor(px / S), cj = Math.floor(pz / S);
    // Nearest region centres (jittered grid), 3x3 around.
    let d1 = Infinity, m = 0;
    const ds = this.ds, ks = this.ks;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++, m++) {
      const cx = (i + 0.15 + 0.7 * hash(i, j, 11)) * S, cz = (j + 0.15 + 0.7 * hash(i, j, 23)) * S;
      const d = Math.hypot(px - cx, pz - cz);
      ds[m] = d; ks[m] = this.kindOf(i, j);
      if (d < d1) d1 = d;
    }
    // Each region weighs in by how close it is to being the nearest: 1 for the nearest, falling to 0 once it's
    // biomeBlend further away (the border band is about biomeBlend wide, half on each side).
    const w = this.w;
    w[0] = w[1] = w[2] = 0;
    let sum = 0;
    for (let k = 0; k < 9; k++) {
      const a = 1 - smoothstep(0, v.biomeBlend, ds[k] - d1);
      if (a <= 0) continue;
      w[ks[k]] += a; sum += a;
    }
    out.desert = w[0] / sum; out.rocky = w[1] / sum; out.shallows = w[2] / sum;
    return out;
  }
}
