// Part kinds: what the game needs from a generated part of each kind. Sizes and sockets are read from the Rampart
// (public/models/rampart.glb: its Part_* meshes and joint empties), never hardcoded, so a generated hull fills the
// space the Rampart's hull does and its sockets land where the game hangs things. Only single-piece kinds so far;
// legs (cut at the joints, Thigh/Shin/Cannon/Foot) come once these work (docs/proposal-partgen.md).
import { readFileSync } from "node:fs";
import { readGlb } from "./glb";

export type V3 = [number, number, number];
export interface Kind {
  id: string;
  label: string;
  /** Box the part is fitted into (metres: x across, y up, z front). */
  box: V3;
  /** Triangle budget after simplifying. */
  tris: number;
  /** Mesh name in the output GLB. */
  part: string;
  /** Material name (the paint section the game tints). */
  material: string;
  /** Sockets as fractions of the fitted box (0..1 on each axis, x from right to left, y bottom to top, z back to front). */
  sockets: Record<string, V3>;
  /** Hint for the concept prompt. */
  prompt: string;
}

const box = (lo: number[], hi: number[]): V3 => [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];

/** Bounds of the named meshes of a GLB, and its empties. */
function measure(path: string) {
  const g = readGlb(new Uint8Array(readFileSync(path)));
  const bounds = (prefix: string) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of g.meshes) if (m.name === prefix) for (let i = 0; i < m.pos.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], m.pos[i]); hi[i % 3] = Math.max(hi[i % 3], m.pos[i]);
    }
    if (!isFinite(lo[0])) throw new Error(`partgen: ${path} has no mesh ${prefix}`);
    return { lo, hi };
  };
  return { bounds, empties: g.empties };
}

/** Fraction of a point inside bounds. */
const frac = (p: number[], b: { lo: number[]; hi: number[] }): V3 =>
  [0, 1, 2].map((c) => (p[c] - b.lo[c]) / (b.hi[c] - b.lo[c] || 1)) as V3;

export function loadKinds(rampartPath: string): Record<string, Kind> {
  const r = measure(rampartPath);
  const torso = r.bounds("Part_Torso"), pod = r.bounds("Part_Pod_R");
  const arm = (name: string): V3 => {
    const p = r.empties.get(name);
    return p ? frac(p, torso) : [name.endsWith("L") ? 1 : 0, 0.5, 0.5];
  };
  return {
    hull: {
      id: "hull", label: "Hull", box: box(torso.lo, torso.hi), tris: 8000, part: "Part_Torso", material: "Paint_Hull",
      sockets: { Waist: [0.5, 0, 0.5], UpperArm_L: arm("UpperArm_L"), UpperArm_R: arm("UpperArm_R"), Shoulder_L: [0.8, 1, 0.45], Shoulder_R: [0.2, 1, 0.45] },
      prompt: "armoured cockpit hull of a bipedal walking mech, no legs, no arms, boxy industrial plating",
    },
    shoulder: {
      id: "shoulder", label: "Shoulder pod", box: box(pod.lo, pod.hi), tris: 3000, part: "Part_Pod", material: "Paint_Pod",
      sockets: { Mount: [0.5, 0, 0.5], Muzzle_0: [0.5, 0.5, 1] },
      prompt: "shoulder-mounted weapon pod for a mech, boxy launcher housing",
    },
    wreck: {
      id: "wreck", label: "Wreck", box: [7, 3.5, 5], tris: 6000, part: "Part_Wreck", material: "Paint_Wreck",
      sockets: { Strip_0: [0.5, 1, 0.5] },
      prompt: "rusted wrecked machine half buried, salvage, scrap metal",
    },
  };
}
