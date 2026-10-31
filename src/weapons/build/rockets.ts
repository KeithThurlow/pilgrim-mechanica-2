// Clip-fed rocket launchers (Keith 2026-10-31: "they should feel like they're fed by a clip ... we want them to look
// like something that launches rockets"). One builder, three weapons:
// - rocket-pod-hull: a 2 x 2 clip of rockets hung under a spine beam on the hull mount (in place of an arm).
// - rocket-pod-shoulder: a 1 x 3 clip on a shoulder cradle.
// - missile-pod-arm: a 2 x 4 clip of small missiles held in the arm (the channelled battery).
// The clip is a box of tubes with open mouths: each loaded tube shows its warhead's bright tip (Missile_n, hidden once
// fired, so the mouth goes dark); on a reload the empty clip drops out of the cradle (Clip slides down) and a full one
// rises into it. The arsenal drives both from the magazine (src/weapons/modelSwap.ts `clip`).
// Moving: Recoil (the cradle and clip kick back), Clip (slide down, the swap), Missile_n (riding the clip).
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, prism, hazard, stencilDigits, boltRow, lamp, type V3 } from "../kit";
import { trunnion } from "./common";
import type { ModelDef } from "../parts";

interface ClipOpts {
  cols: number; rows: number;
  /** Bore radius (m) and the tube pitch (centre to centre). */
  bore: number; pitch: number;
  /** Clip length (m), from z0 forward. */
  len: number; z0: number;
  /** How it hangs: under a spine on a hull mount, on a shoulder cradle, or held in an arm's grip. */
  hang: "hull" | "shoulder" | "arm";
  /** How far the clip drops on a swap (m). */
  drop: number;
}

/** The clip: a box of tubes with mouths front and back, a hazard band and its count stencilled on the outboard side. */
function clip(B: Build, C: Piece, o: ClipOpts, cy: number): { hw: number; hh: number } {
  const wall = o.bore * 0.32, hw = (o.cols * o.pitch) / 2 + wall * 0.6, hh = (o.rows * o.pitch) / 2 + wall * 0.6;
  const z1 = o.z0 + o.len, sd = B.sd;
  loftZ(C, [[o.z0, octRing(hw * 0.96, hh * 0.96, wall * 0.8)], [o.z0 + 0.05, octRing(hw, hh, wall)], [z1 - 0.05, octRing(hw, hh, wall)], [z1, octRing(hw * 0.97, hh * 0.97, wall * 0.8)]], "plating", { y0: cy });
  // Reinforcing bands round the clip and a hazard band near the front.
  for (const z of [o.z0 + o.len * 0.18, o.z0 + o.len * 0.62]) loftZ(C, [[z, octRing(hw + 0.015, hh + 0.015, wall)], [z + 0.07, octRing(hw + 0.015, hh + 0.015, wall)]], "secondary", { y0: cy });
  hazard(C, v(sd * (hw + 0.004), cy, z1 - o.len * 0.14), B.read, Y(), Math.min(0.3, o.len * 0.2), hh * 1.2, 5, "trim", "dark");
  stencilDigits(C, v(sd * (hw + 0.004), cy + hh * 0.35, o.z0 + o.len * 0.4), B.read, Y(), Math.min(0.14, hh * 0.5), String(o.cols * o.rows));
  boltRow(C, v(0, cy + hh + 0.002, o.z0 + 0.12), v(0, cy + hh + 0.002, z1 - 0.12), 4, Y(), 0.016);
  // Tube mouths: a collar proud of the face and a dark bore (seen empty once the rocket's gone); dark backs too.
  for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
    const x = (c - (o.cols - 1) / 2) * o.pitch, y = cy + ((o.rows - 1) / 2 - r) * o.pitch;
    lathe(C, v(x, y, z1 - 0.02), Z(), [[0, o.bore], [0, o.bore + wall * 0.8], [0.06, o.bore + wall * 0.8], [0.07, o.bore + wall * 0.5], [0.07, o.bore]], "mechanical", { n: 12, ring: true });
    lathe(C, v(x, y, z1 + 0.01), Z(), [[0, 0], [0, o.bore], [0.004, o.bore], [0.004, 0]], "dark", { n: 12 });
    lathe(C, v(x, y, o.z0 - 0.004), Z().negate(), [[0, 0], [0, o.bore * 0.9], [0.004, o.bore * 0.9], [0.004, 0]], "dark", { n: 10 });
  }
  return { hw, hh };
}

/** The rockets in the clip: a warhead tip proud of each mouth, bright so a loaded clip reads from the game camera. */
function rounds(B: Build, o: ClipOpts, cy: number) {
  const z1 = o.z0 + o.len;
  let i = 0;
  for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++, i++) {
    const x = (c - (o.cols - 1) / 2) * o.pitch, y = cy + ((o.rows - 1) / 2 - r) * o.pitch, rb = o.bore * 0.86;
    const M = B.piece(`Missile_${i}`, v(x, y, z1), "Clip");
    const tip = o.bore * 2.6;
    lathe(M, v(x, y, z1 - 0.08), Z(), [[0, 0], [0, rb], [0.08 + tip * 0.15, rb], [0.08 + tip * 0.2, rb * 1.02], [0.08 + tip * 0.55, rb * 0.72], [0.08 + tip * 0.85, rb * 0.3], [0.08 + tip, 0]], "trim",
      { n: 10, secs: ["trim", "detail", "detail", "trim", "trim", "trim"] });
    B.move({ node: `Missile_${i}`, kind: "slide", axis: [0, 0, 1], travel: 0.25 });
    B.socket(`Clip/Muzzle_${i}`, v(x, y, z1 + 0.1), Z());
  }
}

function clipLauncher(sd: 1 | -1, seed: number, o: ClipOpts): ModelDef {
  const B = new Build(seed, 1.2, sd), P = B.piece("Body");
  const R = B.piece("Recoil", v(), "Body");
  B.move({ node: "Recoil", kind: "slide", travel: 0.2 });
  // The clip hangs with its centre here; the cradle above it (hull, arm) or under it (shoulder).
  const cy = o.hang === "shoulder" ? 0.55 : 0;
  const C = B.piece("Clip", v(0, cy, 0), "Recoil");
  const { hw, hh } = clip(B, C, o, cy);
  rounds(B, o, cy);
  B.move({ node: "Clip", kind: "slide", axis: [0, -1, 0], travel: o.drop });
  const z1 = o.z0 + o.len;
  if (o.hang === "shoulder") {
    // A turntable and a cradle under the clip, cheeks either side to the trunnion.
    lathe(P, v(0, 0, 0), Y(), [[0, 0], [0, 0.32], [0.1, 0.32], [0.12, 0.26], [0.14, 0]], "mechanical", { n: 14 });
    loftZ(R, [[o.z0 + 0.1, octRing(hw + 0.06, 0.06, 0.02)], [z1 - 0.15, octRing(hw + 0.06, 0.06, 0.02)]], "secondary", { y0: cy - hh - 0.06 });
    for (const s of [1, -1]) prism(R, v(s * (hw + 0.05), 0.14, -0.1), v(s * (hw + 0.05), cy - hh * 0.3, 0.1), octRing(0.035, 0.12, 0.02), "mechanical", Z());
    prism(R, v(0, 0.14, -0.15), v(0, cy - hh - 0.08, -0.15), octRing(0.12, 0.08, 0.03), "plating", Z());
    // A sight box on the outboard side with the laser.
    loftZ(R, [[0.1, octRing(0.07, 0.07, 0.02)], [0.5, octRing(0.07, 0.07, 0.02)]], "dark", { x0: sd * (hw + 0.12), y0: cy + hh * 0.3 });
    lamp(R, v(sd * (hw + 0.12), cy + hh * 0.3 + 0.075, 0.2), Y(), 0.025);
    B.socket("Recoil/Laser", v(sd * (hw + 0.12), cy + hh * 0.3, 0.52), Z());
    B.socket("Recoil/Glow_0", v(sd * (hw + 0.12), cy + hh * 0.3 + 0.09, 0.2));
    B.socket("Mount", v());
    return B.def();
  }
  // Hull and arm: a spine beam over the clip with claws down its sides, a sight box on the spine.
  const k = o.hang === "arm" ? 0.7 : 1;
  const sy = cy + hh + 0.07 * k;
  loftZ(R, [[o.z0 - 0.15 * k, octRing(0.15 * k, 0.07 * k, 0.025 * k)], [z1 + 0.05, octRing(0.15 * k, 0.07 * k, 0.025 * k)], [z1 + 0.12 * k, octRing(0.12 * k, 0.05 * k, 0.02 * k)]], "secondary", { y0: sy });
  for (const z of [o.z0 + o.len * 0.25, o.z0 + o.len * 0.8]) for (const s of [1, -1]) {
    prism(R, v(s * (hw + 0.03 * k), sy + 0.02, z), v(s * (hw + 0.03 * k), cy + hh * 0.35, z), octRing(0.07 * k, 0.025 * k, 0.01), "mechanical", Z());
  }
  loftZ(R, [[o.z0 + o.len * 0.45, octRing(0.08 * k, 0.07 * k, 0.02)], [o.z0 + o.len * 0.75, octRing(0.08 * k, 0.07 * k, 0.02)]], "dark", { y0: sy + 0.13 * k });
  lamp(R, v(0, sy + 0.2 * k, o.z0 + o.len * 0.5), Y(), 0.025 * k);
  B.socket("Recoil/Laser", v(0, sy + 0.13 * k, o.z0 + o.len * 0.76), Z());
  B.socket("Recoil/Glow_0", v(0, sy + 0.22 * k, o.z0 + o.len * 0.5));
  plate(R, v(0, sy + 0.071 * k, o.z0 + o.len * 0.15), Z(), X(), 0.25 * k, 0.2 * k, 0.01, "trim");
  if (o.hang === "hull") {
    // The trunnion on the inboard side, onto the shoulder joint (Mount: the root goes there).
    const at: V3 = v(-sd * (hw + 0.04), cy + hh * 0.35, o.z0 + o.len * 0.3);
    prism(P, v(-sd * (hw + 0.02), sy, at.z), v(-sd * (hw + 0.02), at.y - 0.12, at.z), octRing(0.14, 0.04, 0.02), "plating", Z());
    trunnion(B, P, 0.14, 0.42, at);
    B.socket("Mount", at.clone().addScaledVector(v(-sd, 0, 0), 0.42));
  } else {
    // The grip block the hand closes on, under the clip's back half (the root: the side's pivot in the grip).
    prism(P, v(0, cy - hh - 0.02, o.z0 + 0.15), v(0, cy - hh - 0.02, o.z0 + 0.45), octRing(0.09, 0.08, 0.03), "dark");
    // A little outboard of the grip, so the pod clears the hull as the arm swings in.
    B.socket("Mount", v(-B.sd * 0.1, 0, o.z0 + 0.3));
  }
  return B.def();
}

/** Hull rocket launcher: a 2 x 2 clip under a spine, the trunnion inboard. */
export const rocketPodHull = (sd: 1 | -1 = -1) => clipLauncher(sd, 21, { cols: 2, rows: 2, bore: 0.13, pitch: 0.36, len: 1.9, z0: -0.7, hang: "hull", drop: 1.6 });
/** Shoulder rocket: a 1 x 3 clip on a cradle. */
export const rocketPodShoulder = (sd: 1 | -1 = -1) => clipLauncher(sd, 22, { cols: 3, rows: 1, bore: 0.12, pitch: 0.33, len: 1.6, z0: -0.6, hang: "shoulder", drop: 1.2 });
/** Arm missile pod: a 2 x 4 clip of small missiles in the hand. */
export const missilePodArm = (sd: 1 | -1 = -1) => clipLauncher(sd, 23, { cols: 4, rows: 2, bore: 0.065, pitch: 0.17, len: 1.25, z0: -0.35, hang: "arm", drop: 1.1 });

/** The rocket in flight (Keith 2026-10-31: a rocket, not a giant cruise missile): slim, 1 m long, four tail fins. */
export function rocketThin(): ModelDef {
  const B = new Build(24, 0.5), M = B.piece("Body");
  const r = 0.07, L = 1.0;
  lathe(M, v(), Z(), [[0, 0], [0, r * 0.75], [0.04, r * 0.95], [L * 0.62, r], [L * 0.64, r * 1.05], [L * 0.8, r * 0.95], [L * 0.93, r * 0.5], [L, 0]], "dark",
    { n: 10, secs: ["mechanical", "dark", "dark", "detail", "trim", "trim", "trim"] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, d = v(Math.cos(a), Math.sin(a), 0);
    plate(M, v().addScaledVector(d, r * 1.6).addScaledVector(Z(), 0.1), Z(), d, 0.18, r * 1.4, 0.012, "secondary", { bevel: 0 });
  }
  B.socket("Glow_0", v(0, 0, -0.02), Z().negate());
  return B.def();
}
