// Tier 2, Stop: a dead vehicle convoy. Two to four raider vehicles caught in a line and burnt out where they stopped,
// ruts running in behind them, a few knocked askew or onto their side, bits strewn about. Levelled along the line (a
// capsule pad). Each vehicle is a section: strip one and go, or stay for all.
import type { Param } from "../core/tweaks";
import type { CarKind } from "../vehicles/car";
import type { PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite } from "./site";

export const CONVOY_WRECK_DEFAULTS = { deadMin: 2, deadMax: 4, deadGap: 11, deadValue: 28, deadTime: 3.5, deadTipped: 0.3 };
export type ConvoyWreckValues = typeof CONVOY_WRECK_DEFAULTS & { convoyPad: number; convoyPadHalf: number };
const G = "POI: dead convoy";
export const CONVOY_WRECK_PARAMS: Param[] = [
  { key: "deadMin", label: "Vehicles (fewest)", min: 1, max: 6, step: 1, group: G, onRelease: true },
  { key: "deadMax", label: "Vehicles (most)", min: 1, max: 6, step: 1, group: G, onRelease: true },
  { key: "deadGap", label: "Gap along the line (m)", min: 6, max: 20, step: 0.5, group: G, onRelease: true },
  { key: "deadTipped", label: "Share tipped over", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "convoyPad", label: "Pad half-width (m)", min: 0, max: 20, step: 0.5, group: G, tip: "Flattened strip the line sits on (0: on the dunes as they are)", onRelease: true },
  { key: "convoyPadHalf", label: "Pad half-length (m)", min: 0, max: 40, step: 0.5, group: G, onRelease: true },
  { key: "deadValue", label: "Scrap per spot", min: 1, max: 200, step: 1, group: G, onRelease: true },
  { key: "deadTime", label: "Strip time (s)", min: 0.5, max: 20, step: 0.1, group: G, onRelease: true },
];

const KINDS: CarKind[] = ["technical", "technical", "gunTruck", "sixWheeler"];
const NAME: Partial<Record<CarKind, string>> = { technical: "pickup", gunTruck: "gun truck", sixWheeler: "six-wheeler" };

export function buildDeadConvoy(p: PoiPlacement, v: ConvoyWreckValues): PoiSite {
  const b = new SiteBuilder(p);
  const lo = Math.max(1, Math.round(Math.min(v.deadMin, v.deadMax))), hi = Math.max(lo, Math.round(v.deadMax));
  const n = b.int(lo, hi);
  const span = (n - 1) * v.deadGap;
  // Ruts running in behind the line (local -z), one pair, fading out.
  for (const s of [-1, 1]) b.prop("disc", s * 1.1, -span / 2 - 14, -0.02, [0.35, 0, 16], "rut", b.jit(0.03));
  for (let i = 0; i < n; i++) {
    const lz = -span / 2 + i * v.deadGap + b.jit(1.5), lx = b.jit(1.8);
    const kind = b.one(KINDS);
    const tipped = b.r() < v.deadTipped;
    const yaw = b.jit(0.5) + (b.r() < 0.15 ? Math.PI : 0);
    const sec = b.section(`${NAME[kind] ?? kind} ${i + 1}`);
    b.vehicle(kind, lx, lz, yaw, sec, tipped ? b.jit(0.1) : b.jit(0.06), tipped ? (b.r() < 0.5 ? 1.5 : -1.5) : b.jit(0.08), tipped ? -0.2 : 0.3);
    b.prop("disc", lx, lz, 0, [3, 0, 4], "scorch", yaw);
    // Spots: the engine bay, and on bigger ones the gun mount too. Local to the vehicle: forward along its yaw.
    const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
    const side = tipped ? 2 : 1.7;
    b.spot(sec, lx + fx * 1.8 + sx * side, lz + fz * 1.8 + sz * side, 1, v.deadValue * b.range(0.8, 1.2), v.deadTime, "engine bay");
    if (kind !== "technical" || b.r() < 0.4) {
      b.spot(sec, lx - fx * 1.6 - sx * side, lz - fz * 1.6 - sz * side, 1.4, v.deadValue * b.range(0.7, 1.1), v.deadTime * 1.2, "gun mount");
    }
    // A wheel and a panel thrown off.
    b.prop("cyl", lx + b.jit(4), lz + b.jit(4), 0.2, [0.55, 0.4, 0.55], "dark", b.r() * 6.28, Math.PI / 2 + b.jit(0.3), 0);
    b.prop("box", lx + b.jit(5), lz + b.jit(5), 0.05, [1.6, 0.08, 1], "burnt", b.r() * 6.28, b.jit(0.2), b.jit(0.2));
  }
  b.debris(b.int(8, 14), 3, Math.max(10, span * 0.6 + 6), ["burnt", "dark", "rust"]);
  return b.done();
}
