// The weapons lab's firing range (labs/weapons): a flattened stretch of desert ahead of the start with one long dune
// across it to shoot over, and where the targets stand: a line of cutouts across the range (broadside, for the
// salvo's snap and the rail's pierce from the side), a column of cutouts running away from the mech (for the rail
// beam and a salvo straight up the line), a row of steel posts (some sliding), and a cluster of cutouts behind the
// dune that only the mortar can reach. Pure: a ground modifier (src/world/terrain.ts) and a list of spots.
import type { Param } from "../core/tweaks";
import type { GroundModifier, ModifierSample } from "../world/terrain";
import type { DummySpot } from "./dummies";

export const RANGE_DEFAULTS = {
  rangeFlat: 1,
  rangeHalfWidth: 70,
  rangeDepth: 110,
  ridgeZ: 56,
  ridgeHeight: 7,
  ridgeWidth: 5,
  lineZ: 22,
  lineCount: 9,
  lineGap: 2.6,
  columnX: -18,
  columnCount: 6,
  columnGap: 3.2,
  postsZ: 32,
  behindZ: 66,
  behindCount: 6,
};
export type RangeValues = typeof RANGE_DEFAULTS;

const G = "Firing range";
export const RANGE_PARAMS: Param[] = [
  { key: "rangeFlat", label: "Flatten the range (0-1)", min: 0, max: 1, step: 0.05, group: G, onRelease: true },
  { key: "rangeHalfWidth", label: "Range half-width (m)", min: 20, max: 150, step: 1, group: G, onRelease: true },
  { key: "rangeDepth", label: "Range depth (m)", min: 40, max: 200, step: 1, group: G, onRelease: true },
  { key: "ridgeZ", label: "Dune: distance (m)", min: 20, max: 150, step: 1, group: G, onRelease: true },
  { key: "ridgeHeight", label: "Dune: height (m)", min: 0, max: 20, step: 0.5, group: G, onRelease: true },
  { key: "ridgeWidth", label: "Dune: width (m)", min: 1, max: 20, step: 0.5, group: G, onRelease: true },
  { key: "lineZ", label: "Line: distance (m)", min: 8, max: 80, step: 1, group: G, onRelease: true },
  { key: "lineCount", label: "Line: cutouts", min: 0, max: 20, step: 1, group: G, onRelease: true },
  { key: "lineGap", label: "Line: spacing (m)", min: 1, max: 8, step: 0.1, group: G, onRelease: true },
  { key: "columnX", label: "Column: off to the side (m)", min: -40, max: 40, step: 1, group: G, onRelease: true },
  { key: "columnCount", label: "Column: cutouts", min: 0, max: 20, step: 1, group: G, onRelease: true },
  { key: "columnGap", label: "Column: spacing (m)", min: 1, max: 8, step: 0.1, group: G, onRelease: true },
  { key: "postsZ", label: "Steel posts: distance (m)", min: 8, max: 80, step: 1, group: G, onRelease: true },
  { key: "behindZ", label: "Behind the dune: distance (m)", min: 20, max: 160, step: 1, group: G, onRelease: true },
  { key: "behindCount", label: "Behind the dune: cutouts", min: 0, max: 16, step: 1, group: G, onRelease: true },
];

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The range's ground: flat (riding the swell) inside its box, fading out over 25 m, with the dune across it. */
export class RangeGround implements GroundModifier {
  constructor(public v: RangeValues) {}
  at(x: number, z: number, out: ModifierSample): boolean {
    const v = this.v;
    const fade = 25;
    const wx = 1 - smooth(v.rangeHalfWidth, v.rangeHalfWidth + fade, Math.abs(x));
    const wz = smooth(-30 - fade, -30, z) * (1 - smooth(v.rangeDepth, v.rangeDepth + fade, z));
    const w = wx * wz * v.rangeFlat;
    if (w <= 0) return false;
    const dz = (z - v.ridgeZ) / Math.max(0.5, v.ridgeWidth);
    out.w = w;
    out.berm = v.ridgeHeight * Math.exp(-dz * dz) * wx;
    out.lift = 0;
    out.rough = 0.35;
    return true;
  }
}

/** Every target spot on the range, from the sliders. */
export function rangeSpots(v: RangeValues): DummySpot[] {
  const out: DummySpot[] = [];
  const nl = Math.round(v.lineCount);
  for (let i = 0; i < nl; i++) out.push({ x: (i - (nl - 1) / 2) * v.lineGap, z: v.lineZ, light: true });
  const nc = Math.round(v.columnCount);
  for (let i = 0; i < nc; i++) out.push({ x: v.columnX, z: v.lineZ - 4 + i * v.columnGap, light: true });
  for (const [x, mover] of [[14, false], [8, true], [2, false]] as const) out.push({ x, z: v.postsZ, mover });
  const nb = Math.round(v.behindCount);
  for (let i = 0; i < nb; i++) { const a = i * 2.4; out.push({ x: Math.cos(a) * (1 + i * 0.8), z: v.behindZ + Math.sin(a) * (1 + i * 0.8), light: true }); }
  return out;
}
