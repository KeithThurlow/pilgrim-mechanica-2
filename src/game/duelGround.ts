// The duel lab's arena (pure): a circle of desert flattened toward a floor (gentle dunes left at `duelDunes`), with a
// few cover drifts on it: sand banked steep against a big steel wreck (the wreck stand-ins, scaled up), so rounds stop
// in the sand or spark off the steel, and the walkers can't climb the faces (steeper than the walker's wall grade).
// Where the drifts go is seeded (`duelCoverSeed`); the two starts are kept clear. The line-of-sight test the rival's
// AI uses reads the same height function plus each wreck's height on top.
import type { Param } from "../core/tweaks";
import type { GroundModifier, ModifierSample } from "../world/terrain";
import { rng } from "../items/generate";

export const DUEL_GROUND_DEFAULTS = {
  duelRadius: 80,
  duelDunes: 0.2,
  duelCover: 6,
  duelCoverSeed: 4,
  duelCoverHeight: 3.2,
  duelCoverLength: 12,
  duelCoverWidth: 5,
  duelWreckScale: 1.7,
  duelStart: 34,
};
export type DuelGroundValues = typeof DUEL_GROUND_DEFAULTS;

const G = "Duel arena";
export const DUEL_GROUND_PARAMS: Param[] = [
  { key: "duelRadius", label: "Arena radius (m)", min: 40, max: 160, step: 1, group: G, onRelease: true, tip: "The flattened circle; the rival keeps inside it" },
  { key: "duelDunes", label: "Dunes kept (0 flat, 1 full)", min: 0, max: 1, step: 0.05, group: G, onRelease: true },
  { key: "duelCover", label: "Cover drifts", min: 0, max: 12, step: 1, group: G, onRelease: true, tip: "Sand banked against a steel wreck: blocks shots and sight, too steep to walk up" },
  { key: "duelCoverSeed", label: "Cover layout seed", min: 1, max: 99, step: 1, group: G, onRelease: true },
  { key: "duelCoverHeight", label: "Drift height (m)", min: 1, max: 8, step: 0.1, group: G, onRelease: true },
  { key: "duelCoverLength", label: "Drift length (m)", min: 4, max: 30, step: 0.5, group: G, onRelease: true },
  { key: "duelCoverWidth", label: "Drift width (m)", min: 2, max: 12, step: 0.5, group: G, onRelease: true },
  { key: "duelWreckScale", label: "Wreck size (× stand-in)", min: 0.5, max: 3, step: 0.05, group: G, onRelease: true },
  { key: "duelStart", label: "Start distance from the middle (m)", min: 10, max: 70, step: 1, group: G, tip: "Each round: you at -this on Z, the rival at +this, facing each other" },
];

/** A cover drift: centre, heading of its long axis, half length and half width, sand height, steel on top. */
export interface CoverSpot { x: number; z: number; yaw: number; hl: number; hw: number; h: number; steel: number }

/** The wreck stand-in's height (a hulk: its steel box and the rusted block on it) at scale 1. */
const HULK_TOP = 2.3;

export function coverSpots(v: DuelGroundValues): CoverSpot[] {
  const r = rng(Math.round(v.duelCoverSeed) * 977 + 5);
  const out: CoverSpot[] = [];
  const n = Math.round(v.duelCover), reach = Math.min(v.duelRadius - 12, 50);
  for (let tries = 0; out.length < n && tries < 200; tries++) {
    const a = r() * Math.PI * 2, d = 10 + r() * (reach - 10);
    const x = Math.sin(a) * d, z = Math.cos(a) * d;
    // Keep the starts and the line straight between them near the start clear, and drifts apart.
    if (Math.hypot(x, z - v.duelStart) < 14 || Math.hypot(x, z + v.duelStart) < 14) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < v.duelCoverLength + 6)) continue;
    const len = v.duelCoverLength * (0.75 + r() * 0.5);
    out.push({ x, z, yaw: r() * Math.PI, hl: len / 2, hw: v.duelCoverWidth / 2, h: v.duelCoverHeight, steel: HULK_TOP * v.duelWreckScale * 0.8 });
  }
  return out;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How far outside a drift's box (x, z) is (m; negative inside), in its own frame. */
function boxDist(c: CoverSpot, x: number, z: number) {
  const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const u = Math.abs(dx * cs - dz * sn) - c.hl, w = Math.abs(dx * sn + dz * cs) - c.hw;
  return Math.max(u, w) > 0 ? Math.hypot(Math.max(u, 0), Math.max(w, 0)) : Math.max(u, w);
}

/** The arena's ground: flattened inside duelRadius (fading over 25 m), the drifts on top (steep faces: ~1.2 m wide). */
export class DuelGround implements GroundModifier {
  spots: CoverSpot[];
  constructor(public v: DuelGroundValues) { this.spots = coverSpots(v); }
  rebuild() { this.spots = coverSpots(this.v); }
  at(x: number, z: number, out: ModifierSample): boolean {
    const v = this.v, d = Math.hypot(x, z);
    const w = (1 - smooth(v.duelRadius, v.duelRadius + 25, d)) * (1 - v.duelDunes);
    let berm = 0;
    for (const c of this.spots) {
      const e = boxDist(c, x, z);
      if (e < 1.4) berm = Math.max(berm, c.h * (1 - smooth(-0.2, 1.4, e)));
    }
    if (w <= 0 && berm <= 0) return false;
    out.w = Math.max(0, w); out.berm = berm; out.lift = 0; out.rough = 0.4;
    return true;
  }
}

/** The steel on top of a drift at (x, z) (m; 0 off its wrecks): the sight test adds it to the ground. */
export function steelAt(spots: readonly CoverSpot[], x: number, z: number) {
  for (const c of spots) if (boxDist(c, x, z) < -0.6) return c.steel;
  return 0;
}

/**
 * Can a mech at a see one at b? The line between their hulls (eye metres over the ground at each end) against the
 * ground plus the wrecks every 2.5 m. Cheap: about 20-40 height reads.
 */
export function lineOfSight(height: (x: number, z: number) => number, spots: readonly CoverSpot[], ax: number, az: number, bx: number, bz: number, eye = 3.6): boolean {
  const ya = height(ax, az) + eye, yb = height(bx, bz) + eye;
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(L / 2.5));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    if (height(x, z) + steelAt(spots, x, z) > ya + (yb - ya) * t) return false;
  }
  return true;
}

/** The wreck stand-ins for the drifts (src/world/wrecks.ts spots): a big hulk sunk into each. */
export const wreckSpots = (spots: readonly CoverSpot[], v: DuelGroundValues) =>
  spots.map((c) => ({ x: c.x, z: c.z, yaw: c.yaw + Math.PI / 2, kind: "hulk" as const, scale: v.duelWreckScale * Math.min(1.4, c.hl / 6), sink: 0.6 }));
