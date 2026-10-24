// Tier 1, Glance: a rock outcrop with scrap caught in it. A cluster of weathered boulders on the dunes (no pad),
// a bent plate wedged between two of them and maybe a strut or a torn panel: one section, one or two quick spots.
import type { Param } from "../core/tweaks";
import type { PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite } from "./site";

export const OUTCROP_DEFAULTS = { outcropRocks: 6, outcropSize: 3.2, outcropValue: 22, outcropTime: 2.5 };
export type OutcropValues = typeof OUTCROP_DEFAULTS;
const G = "POI: outcrop";
export const OUTCROP_PARAMS: Param[] = [
  { key: "outcropRocks", label: "Rocks", min: 2, max: 14, step: 1, group: G, onRelease: true },
  { key: "outcropSize", label: "Rock size (m)", min: 1, max: 8, step: 0.1, group: G, onRelease: true },
  { key: "outcropValue", label: "Scrap per spot", min: 1, max: 200, step: 1, group: G, onRelease: true },
  { key: "outcropTime", label: "Strip time (s)", min: 0.5, max: 20, step: 0.1, group: G, onRelease: true },
];

export function buildOutcrop(p: PoiPlacement, v: OutcropValues): PoiSite {
  const b = new SiteBuilder(p);
  const n = Math.max(3, Math.round(v.outcropRocks * b.range(0.7, 1.3)));
  const S = v.outcropSize;
  // Boulders: a big one in the middle, the rest leaning round it, sunk into the sand.
  const rocks: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + b.jit(0.5), d = i === 0 ? 0 : S * b.range(0.8, 1.7);
    const s = S * (i === 0 ? 1.3 : b.range(0.5, 1));
    const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
    rocks.push([lx, lz, s]);
    b.prop("rock", lx, lz, s * 0.18, [s * b.range(0.9, 1.4), s * b.range(0.6, 1.1), s * b.range(0.8, 1.3)], i % 3 === 2 ? "rockDark" : "rock", b.r() * 6.28, b.jit(0.3), b.jit(0.3));
  }
  // Broken rock at the foot.
  for (let i = 0; i < n * 2; i++) {
    const a = b.r() * 6.28, d = S * b.range(1.5, 2.8), s = S * b.range(0.12, 0.3);
    b.prop("rock", Math.cos(a) * d, Math.sin(a) * d, 0, [s, s * 0.6, s * 0.9], "rock", b.r() * 6.28, b.jit(0.4), b.jit(0.4));
  }
  const sec = b.section("caught scrap");
  // The scrap: a bent plate wedged between the big rock and a neighbour, tilted up out of the sand.
  const [ax, az] = rocks[1];
  const mx = ax * 0.55, mz = az * 0.55, yaw = Math.atan2(ax, az);
  b.prop("box", mx, mz, 0.9, [S * 0.9, 0.12, S * 0.7], "rust", yaw, 0.9, b.jit(0.3));
  b.prop("box", mx + 0.4, mz - 0.3, 0.5, [S * 0.5, 0.1, S * 0.6], "hull", yaw + 0.6, -0.5, 0.4);
  b.spot(sec, mx, mz, 1, v.outcropValue * b.range(0.8, 1.2), v.outcropTime, "wedged plate");
  if (b.r() < 0.6) {
    const [cx, cz] = rocks[2];
    const sx = cx * 0.7, sz = cz * 0.7;
    b.prop("cyl", sx, sz, 0.6, [0.14, S * 1.1, 0.14], "steel", b.r() * 6.28, 1.2, 0.2);
    b.prop("box", sx + 0.3, sz, 0.3, [0.9, 0.5, 0.7], "dark", b.r() * 6.28, 0.3, 0.5);
    b.spot(sec, sx, sz, 0.6, v.outcropValue * b.range(0.5, 0.9), v.outcropTime * 0.8, "torn strut");
  }
  return b.done();
}
