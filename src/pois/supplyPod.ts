// Tier 1, Glance: a crashed supply pod, nose down and half buried at the end of the furrow it dug, scorched sand round
// it, its drogue chute trailing, the hatch blown off and a crate or two thrown out. One section: the pod's sealed hold
// (slow) and the loose crates (quick). No pad: it lies where it fell.
import type { Param } from "../core/tweaks";
import type { PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite } from "./site";

export const POD_DEFAULTS = { podLength: 5, podValue: 60, podTime: 5, podCrateValue: 12 };
export type PodValues = typeof POD_DEFAULTS;
const G = "POI: supply pod";
export const POD_PARAMS: Param[] = [
  { key: "podLength", label: "Pod length (m)", min: 2, max: 12, step: 0.1, group: G, onRelease: true },
  { key: "podValue", label: "Scrap in the hold", min: 1, max: 300, step: 1, group: G, onRelease: true },
  { key: "podTime", label: "Hold strip time (s)", min: 0.5, max: 30, step: 0.1, group: G, onRelease: true },
  { key: "podCrateValue", label: "Scrap per crate", min: 1, max: 100, step: 1, group: G, onRelease: true },
];

export function buildSupplyPod(p: PoiPlacement, v: PodValues): PoiSite {
  const b = new SiteBuilder(p);
  const L = v.podLength, R = L * 0.24, dive = b.range(0.45, 0.8);
  // It came in along +z: the furrow it dug lies behind it (local -z), the scorch round it.
  b.prop("disc", 0, -L * 1.5, -0.02, [R * 1.2, 0, L * 1.5], "rut");
  b.prop("disc", 0, 0, 0, [L * 0.75, 0, L * 0.85], "scorch");
  // The shell: a capsule along its local y, pitched so the nose points down into the sand ahead (+z), tail up behind.
  const tilt = Math.PI / 2 - dive, cy = 0.4;
  const tail = (d: number): [number, number] => [-Math.sin(tilt) * d, cy + Math.cos(tilt) * d]; // (local z, y) along the axis
  b.prop("pod", 0, 0, cy, [R, L, R], "hull", 0, -tilt, b.jit(0.15));
  const [rz, ry] = tail(L * 0.36);
  b.prop("cyl", 0, rz, ry, [R * 1.1, L * 0.1, R * 1.1], "burnt", 0, -tilt, 0);
  const [fz, fy] = tail(L * 0.42);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    b.prop("box", Math.cos(a) * R * 1.05, fz, fy + Math.sin(a) * R * 0.8, [0.08, L * 0.22, R * 0.9], "hazard", a, -tilt, 0);
  }
  // The hatch, blown off and lying beside it.
  b.prop("box", R * 2.4, 0.6, 0.1, [R * 1.4, 0.12, R * 1.8], "hull", 0.7, 0.2, 0.15);
  // The drogue chute trailing behind on the sand, its lines back to the tail.
  b.prop("cloth", b.jit(1), -L * 1.6, 0.05, [L * 0.8, 0.05, L * 1.2], "cloth", b.jit(0.4), 0.04, 0);
  b.prop("cyl", 0, -L * 0.85, 0.4, [0.03, L * 1.1, 0.03], "dark", 0, Math.PI / 2 - 0.15, 0);
  const sec = b.section("pod");
  b.spot(sec, R * 1.5, 0, 1.2, v.podValue * b.range(0.85, 1.2), v.podTime, "sealed hold");
  const crates = b.int(0, 2);
  for (let i = 0; i < crates; i++) {
    const cx = b.range(2.5, 4) * (i ? -1 : 1) * R * 1.5, cz = b.range(-1, 2.5);
    b.prop("box", cx, cz, 0.35, [1.1, 0.8, 0.8], i ? "olive" : "hazard", b.r() * 6.28, b.jit(0.2), b.jit(0.3));
    b.spot(sec, cx, cz, 0.6, v.podCrateValue * b.range(0.8, 1.2), v.podTime * 0.3, "crate");
  }
  b.debris(b.int(4, 7), L * 0.8, L * 1.8, ["hull", "burnt", "steel"]);
  return b.done();
}
