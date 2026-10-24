// Tier 1, Glance: one big broken piece lying alone: either a mech's leg torn off at the hip (thigh, shin, foot, rams)
// or a curved hull plate off a crashed ship, rib beams still bolted on, stuck in the sand at an angle. No pad.
// One section: a spot or two (the hip and knee actuators; the plate's rib bolts).
import type { Param } from "../core/tweaks";
import type { PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite } from "./site";

export const WRECK_PART_DEFAULTS = { wreckScale: 1.4, wreckPlateChance: 0.5, wreckValue: 34, wreckTime: 3.5 };
export type WreckPartValues = typeof WRECK_PART_DEFAULTS;
const G = "POI: wreck part";
export const WRECK_PART_PARAMS: Param[] = [
  { key: "wreckScale", label: "Size", min: 0.5, max: 3, step: 0.05, group: G, tip: "1 = a Rampart-sized leg; the hull plate scales with it", onRelease: true },
  { key: "wreckPlateChance", label: "Hull plate share", min: 0, max: 1, step: 0.01, group: G, tip: "Share that are a ship's hull plate rather than a mech leg", onRelease: true },
  { key: "wreckValue", label: "Scrap per spot", min: 1, max: 200, step: 1, group: G, onRelease: true },
  { key: "wreckTime", label: "Strip time (s)", min: 0.5, max: 20, step: 0.1, group: G, onRelease: true },
];

export function buildWreckPart(p: PoiPlacement, v: WreckPartValues): PoiSite {
  const b = new SiteBuilder(p);
  const k = v.wreckScale;
  const plate = b.r() < v.wreckPlateChance;
  const sec = b.section(plate ? "hull plate" : "mech leg");
  if (plate) {
    // A curved plate stood up on its edge out of the sand, two ribs across its back.
    const L = 9 * k, C = 7 * k, lean = b.range(0.35, 0.7);
    b.prop("arc", 0, 0, -0.6, [C, 0.22 * k, L], "hull", 0, 0, lean);
    for (const z of [-L * 0.3, L * 0.3]) b.prop("rib", -C * 0.22, z, C * 0.1, [0.45 * k, 0.6 * k, C * 0.9], "dark", Math.PI / 2, 0, lean * 0.6);
    // A torn corner lying in front.
    b.prop("box", C * 0.45, L * 0.45, 0.15, [2.4 * k, 0.12, 1.6 * k], "hull", 0.5, 0.25, 0.2);
    b.debris(b.int(6, 10), 3 * k, 9 * k, ["hull", "steel", "rust"]);
    b.spot(sec, -C * 0.3, -L * 0.3, 1.2, v.wreckValue * b.range(0.8, 1.2), v.wreckTime, "rib bolts");
    if (b.r() < 0.6) b.spot(sec, -C * 0.3, L * 0.3, 1.2, v.wreckValue * b.range(0.6, 1), v.wreckTime, "rib bolts");
  } else {
    // A mech leg lying on its side: torn hip socket, thigh, knee, shin and foot, two hydraulic rams.
    const T = 2.4 * k, Sh = 2.6 * k, kneeA = b.range(0.6, 1.4) * (b.r() < 0.5 ? 1 : -1);
    const hipX = -T * 0.5, kx = T * 0.5;
    b.prop("disc", 0, 0, 0, [T * 1.6, 0, T * 1.2], "scorch");
    b.prop("box", 0, 0, 0.45 * k, [T, 0.9 * k, 1.1 * k], "olive", Math.PI / 2, 0, 0.25);
    b.prop("box", hipX - 0.5 * k, 0, 0.55 * k, [1.2 * k, 1.2 * k, 1.2 * k], "dark", 0.4, 0.3, 0.6);
    b.prop("cyl", kx, 0, 0.5 * k, [0.55 * k, 1.2 * k, 0.55 * k], "steel", 0, Math.PI / 2, 0);
    const sx = kx + Math.cos(kneeA) * Sh * 0.5, sz = Math.sin(kneeA) * Sh * 0.5;
    b.prop("box", sx, sz, 0.4 * k, [0.8 * k, 0.7 * k, Sh], "olive", Math.PI / 2 - kneeA, 0, 0.3);
    const fx = kx + Math.cos(kneeA) * Sh, fz = Math.sin(kneeA) * Sh;
    b.prop("box", fx, fz, 0.3 * k, [1.6 * k, 0.5 * k, 1.1 * k], "dark", -kneeA, 0.2, 0.5);
    b.prop("cyl", 0, 0.55 * k, 0.95 * k, [0.16 * k, T * 0.8, 0.16 * k], "steel", Math.PI / 2, Math.PI / 2, 0);
    b.prop("cyl", sx, sz, 0.85 * k, [0.13 * k, Sh * 0.7, 0.13 * k], "steel", Math.PI / 2 - kneeA, Math.PI / 2, 0);
    b.debris(b.int(5, 9), 2.5 * k, 7 * k, ["olive", "steel", "dark"]);
    b.spot(sec, hipX - 0.5 * k, 0, 1, v.wreckValue * b.range(0.9, 1.3), v.wreckTime, "hip actuator");
    if (b.r() < 0.7) b.spot(sec, kx, 0, 0.8, v.wreckValue * b.range(0.6, 1), v.wreckTime * 0.8, "knee joint");
  }
  return b.done();
}
