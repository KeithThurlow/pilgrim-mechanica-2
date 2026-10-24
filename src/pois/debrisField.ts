// Tier 2, Stop: a debris field. Something broke up overhead and came down here: a levelled pad of churned sand
// strewn with chunks, plates and struts, and a few heaps worth stripping (each heap a section, so you can bank one
// and go). 4-8 spots in 2-3 heaps.
import type { Param } from "../core/tweaks";
import type { PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite } from "./site";

export const DEBRIS_DEFAULTS = { debrisSpotsMin: 4, debrisSpotsMax: 8, debrisClutter: 60, debrisValue: 18, debrisTime: 3 };
export type DebrisValues = typeof DEBRIS_DEFAULTS & { debrisPad: number };
const G = "POI: debris field";
export const DEBRIS_PARAMS: Param[] = [
  { key: "debrisPad", label: "Pad radius (m)", min: 0, max: 30, step: 0.5, group: G, tip: "Flattened ground it lies on (0: on the dunes as they are)", onRelease: true },
  { key: "debrisSpotsMin", label: "Spots (fewest)", min: 1, max: 12, step: 1, group: G, onRelease: true },
  { key: "debrisSpotsMax", label: "Spots (most)", min: 1, max: 16, step: 1, group: G, onRelease: true },
  { key: "debrisClutter", label: "Loose debris", min: 0, max: 120, step: 1, group: G, tip: "Pieces strewn about that aren't worth stripping", onRelease: true },
  { key: "debrisValue", label: "Scrap per spot", min: 1, max: 200, step: 1, group: G, onRelease: true },
  { key: "debrisTime", label: "Strip time (s)", min: 0.5, max: 20, step: 0.1, group: G, onRelease: true },
];

const NAMES = ["torn section", "spill", "tangle", "heap"];

export function buildDebrisField(p: PoiPlacement, v: DebrisValues): PoiSite {
  const b = new SiteBuilder(p);
  const R = Math.max(10, v.debrisPad + 4);
  const lo = Math.max(1, Math.round(Math.min(v.debrisSpotsMin, v.debrisSpotsMax))), hi = Math.max(lo, Math.round(v.debrisSpotsMax));
  const total = b.int(lo, hi);
  const nHeaps = Math.min(total, total >= 6 ? 3 : 2);
  // Heaps spread round the field; spots dealt out between them.
  const a0 = b.r() * 6.28;
  for (let c = 0; c < nHeaps; c++) {
    const a = a0 + (c / nHeaps) * Math.PI * 2 + b.jit(0.4), d = R * b.range(0.35, 0.6);
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const sec = b.section(NAMES[c % NAMES.length]);
    const n = Math.floor(total / nHeaps) + (c < total % nHeaps ? 1 : 0);
    // The heap: a big bent panel, a beam across it, chunks piled.
    b.prop("box", cx, cz, 0.3, [b.range(3, 5), 0.18, b.range(2, 3.5)], b.one(["hull", "rust"] as const), b.r() * 6.28, b.jit(0.35), b.jit(0.35));
    b.prop("rib", cx + b.jit(1), cz + b.jit(1), 0.5, [0.3, 0.45, b.range(3, 5)], "dark", b.r() * 6.28, b.jit(0.3), b.jit(0.3));
    for (let i = 0; i < n; i++) {
      const sa = (i / Math.max(1, n)) * Math.PI * 2 + b.jit(0.5), sd = n > 1 ? b.range(2.2, 3.5) : 0.5;
      const sx = cx + Math.cos(sa) * sd, sz = cz + Math.sin(sa) * sd;
      b.prop("box", sx, sz, 0.35, [b.range(1, 1.8), b.range(0.5, 0.9), b.range(0.8, 1.5)], b.one(["steel", "dark", "olive"] as const), b.r() * 6.28, b.jit(0.4), b.jit(0.4));
      b.spot(sec, sx, sz, 0.7, v.debrisValue * b.range(0.7, 1.3), v.debrisTime * b.range(0.8, 1.2), b.one(["housing", "conduit", "plating", "actuator"] as const));
    }
  }
  // Scars where pieces came in, and clutter across the whole field.
  for (let i = 0; i < 3; i++) {
    const a = b.r() * 6.28, d = R * b.range(0.2, 0.7);
    b.prop("disc", Math.cos(a) * d, Math.sin(a) * d, 0, [1.2, 0, b.range(4, 8)], "rut", a);
  }
  b.debris(Math.round(v.debrisClutter), 1, R);
  return b.done();
}
