// Part kinds: what the game needs from a generated part of each kind, by the asset contract in docs/asset-list.md
// (Keith 2026-10-26: per-mount triangle budgets at three levels of detail; node, socket and material names).
// Sizes are measured from the models already in the game, never hardcoded: a hull fills the Rampart's hull
// (`Part_Torso` in rampart.glb), a hull weapon its right minigun pod (the contract's Medium reference), a shoulder
// weapon the W1 shoulder rocket launcher. Only single-piece kinds so far; legs (cut at the joints) come later.
import { readFileSync } from "node:fs";
import { readGlb } from "./glb";

export type V3 = [number, number, number];
export interface Kind {
  id: string;
  label: string;
  /** Box the part is fitted into (metres: x across, y up, z front). */
  box: V3;
  /** Triangle budgets: full, simpler (-lod1), simplest (-lod2); docs/asset-list.md. */
  tris: [number, number, number];
  /** Mesh name in the output GLB. */
  part: string;
  /** Material name (one per part; the paint section the game tints). */
  material: string;
  /** Sockets as fractions of the fitted box (0..1 on each axis: x right (-X) to left (+X), y bottom to top, z back to front). */
  sockets: Record<string, V3>;
  /** Hint for the concept prompt. */
  prompt: string;
}

const size = (b: { lo: number[]; hi: number[] }): V3 => [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];

/** Bounds of a GLB's meshes (all, or the one named), and its empties. */
function measure(path: string) {
  const g = readGlb(new Uint8Array(readFileSync(path)));
  const bounds = (name?: string) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of g.meshes) if (!name || m.name === name) for (let i = 0; i < m.pos.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], m.pos[i]); hi[i % 3] = Math.max(hi[i % 3], m.pos[i]);
    }
    if (!isFinite(lo[0])) throw new Error(`partgen: ${path} has no mesh ${name}`);
    return { lo, hi };
  };
  return { bounds, empties: g.empties };
}

const frac = (p: number[], b: { lo: number[]; hi: number[] }): V3 =>
  [0, 1, 2].map((c) => (p[c] - b.lo[c]) / (b.hi[c] - b.lo[c] || 1)) as V3;

export function loadKinds(models = "public/models"): Record<string, Kind> {
  const r = measure(`${models}/rampart.glb`);
  const torso = r.bounds("Part_Torso"), pod = r.bounds("Part_Pod_R");
  const shoulder = measure(`${models}/weapons/rocket-launcher-shoulder.glb`).bounds("Body");
  const arm = (name: string, side: number): V3 => {
    const p = r.empties.get(name);
    return p ? frac(p, torso) : [side > 0 ? 1 : 0, 0.5, 0.5];
  };
  return {
    hull: {
      id: "hull", label: "Hull", box: size(torso), tris: [6500, 2200, 700], part: "Part_Torso", material: "Paint_plating",
      sockets: {
        Waist: [0.5, 0, 0.5], HullMount_L: arm("UpperArm_L", 1), HullMount_R: arm("UpperArm_R", -1),
        Sensor_Front: [0.5, 0.8, 1], Sensor_Top: [0.5, 1, 0.5], Pack: [0.5, 0.75, 0], Waist_L: [0.85, 0.1, 0.4], Waist_R: [0.15, 0.1, 0.4],
      },
      prompt: "a single detached armoured torso shell of a giant robot, boxy angular industrial plating, small armoured cockpit visor at the front, flat underside, resting on the ground",
    },
    hullweapon: {
      id: "hullweapon", label: "Hull weapon (M)", box: size(pod), tris: [5000, 1700, 550], part: "Body", material: "Paint_plating",
      sockets: { Mount: [0.5, 0.5, 0.3], Muzzle_0: [0.5, 0.5, 1] },
      prompt: "a single heavy cannon pod, boxy armoured gun housing with one thick barrel pointing forward, resting on the ground",
    },
    shoulder: {
      id: "shoulder", label: "Shoulder weapon", box: size(shoulder), tris: [2000, 700, 250], part: "Body", material: "Paint_plating",
      sockets: { Mount: [0.5, 0, 0.5], Muzzle_0: [0.5, 0.6, 1] },
      prompt: "a single compact missile launcher box, boxy armoured housing with a grid of missile tubes on its front face, resting on the ground",
    },
    wreck: {
      id: "wreck", label: "Wreck (big POI piece)", box: [7, 3.5, 5], tris: [25000, 8000, 2500], part: "Part_Wreck", material: "Paint_plating",
      sockets: { Strip_0: [0.5, 1, 0.5] },
      prompt: "rusted wrecked machine half buried, salvage, scrap metal",
    },
  };
}
