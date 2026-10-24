// Ragdoll layouts for the death physics (parts in the body's own frame: origin at the feet, facing +Z, +X left).
import type { PartSpec, JointSpec } from "./deaths";
import { BIG, type RobotSwarm } from "../combat/robots";
import {
  HUB_R, HUB_H, HUB_Y, S_THIGH, S_SHIN, SMALL_LEGS, BIG_LEGS, B_BODY_H, B_THIGH, B_SHIN, bigHip, bigBend, solveKnee, smallLegs, type V3,
} from "../combat/robotLegs";

const SKIN = 0xb08060, DARK = 0x3a3128;

/** A bandit (1.8 m): pelvis, torso, head, thighs, shins, upper arms, forearms. Knees and elbows are hinges. */
export const BANDIT_PARTS = (cloth: number): PartSpec[] => [
  { half: [0.17, 0.1, 0.1], at: [0, 0.95, 0], color: DARK },          // 0 pelvis
  { half: [0.19, 0.25, 0.11], at: [0, 1.3, 0], color: cloth },        // 1 torso
  { half: [0.11, 0.11, 0.11], at: [0, 1.68, 0], color: SKIN },        // 2 head
  { half: [0.07, 0.22, 0.07], at: [0.1, 0.66, 0], color: DARK },      // 3 thigh L
  { half: [0.07, 0.22, 0.07], at: [-0.1, 0.66, 0], color: DARK },     // 4 thigh R
  { half: [0.06, 0.22, 0.06], at: [0.1, 0.22, 0], color: DARK },      // 5 shin L
  { half: [0.06, 0.22, 0.06], at: [-0.1, 0.22, 0], color: DARK },     // 6 shin R
  { half: [0.055, 0.16, 0.055], at: [0.26, 1.37, 0], color: cloth },  // 7 upper arm L
  { half: [0.055, 0.16, 0.055], at: [-0.26, 1.37, 0], color: cloth }, // 8 upper arm R
  { half: [0.05, 0.15, 0.05], at: [0.26, 1.06, 0], color: SKIN },     // 9 forearm L
  { half: [0.05, 0.15, 0.05], at: [-0.26, 1.06, 0], color: SKIN },    // 10 forearm R
];
export const BANDIT_JOINTS: JointSpec[] = [
  { a: 0, b: 1, at: [0, 1.05, 0] },
  { a: 1, b: 2, at: [0, 1.56, 0] },
  { a: 0, b: 3, at: [0.1, 0.88, 0] },
  { a: 0, b: 4, at: [-0.1, 0.88, 0] },
  { a: 3, b: 5, at: [0.1, 0.44, 0], hinge: [1, 0, 0], limits: [-0.05, 2.4] },
  { a: 4, b: 6, at: [-0.1, 0.44, 0], hinge: [1, 0, 0], limits: [-0.05, 2.4] },
  { a: 1, b: 7, at: [0.26, 1.53, 0] },
  { a: 1, b: 8, at: [-0.26, 1.53, 0] },
  { a: 7, b: 9, at: [0.26, 1.21, 0], hinge: [1, 0, 0], limits: [-2.4, 0.05] },
  { a: 8, b: 10, at: [-0.26, 1.21, 0], hinge: [1, 0, 0], limits: [-2.4, 0.05] },
];


/** A part as a box along a segment from a to b (body frame), thickness t (full width). */
function segPart(a: number[], b: number[], t: number, color: number, mass?: number): PartSpec {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-3;
  // Rotation taking +Y onto the segment.
  const nx = dx / len, ny = dy / len, nz = dz / len;
  let q: [number, number, number, number] = [nz, 0, -nx, 1 + ny];
  if (1 + ny < 1e-6) q = [1, 0, 0, 0];
  const ql = Math.hypot(...q);
  q = [q[0] / ql, q[1] / ql, q[2] / ql, q[3] / ql];
  return { half: [t / 2, len / 2, t / 2], at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], color, mass, rot: q };
}

/**
 * Robot i's ragdoll in its pose as it died, in its own frame (origin on the sand under it, facing +Z): the hub (small,
 * four legs) or the high hood (tripods, three long legs), each leg a thigh and a shin on loose joints. A tripod falls
 * from its full height, legs and all.
 */
export function robotRagdoll(sw: RobotSwarm, i: number, body: number, leg: number): { parts: PartSpec[]; joints: JointSpec[] } {
  const S = sw.size[i], h = sw.heading[i], ox = sw.px[i], oy = sw.py[i], oz = sw.pz[i];
  const sh = Math.sin(h), ch = Math.cos(h);
  // World to the body's own frame (yaw undone).
  const toLocal = (x: number, y: number, z: number) => { const dx = x - ox, dz = z - oz; return [dx * ch - dz * sh, y - oy, dx * sh + dz * ch]; };
  const parts: PartSpec[] = [], joints: JointSpec[] = [];
  const hip: V3 = { x: 0, y: 0, z: 0 }, knee: V3 = { x: 0, y: 0, z: 0 }, foot: V3 = { x: 0, y: 0, z: 0 }, bend: V3 = { x: 0, y: 0, z: 0 };
  if (sw.kind[i] === BIG) {
    const H = sw.hubY[i] - oy;
    parts.push({ half: [0.45 * S, B_BODY_H * 0.4 * S, 0.5 * S], at: [0, H, 0], color: body, mass: 900 });
    for (let k = 0; k < BIG_LEGS; k++) {
      const f = i * BIG_LEGS + k;
      bigHip(ox, sw.hubY[i], oz, S, h, k, hip);
      foot.x = sw.footX[f]; foot.y = sw.footY[f]; foot.z = sw.footZ[f];
      bigBend(h, k, bend);
      solveKnee(hip, foot, B_THIGH * H, B_SHIN * H, bend.x, bend.y, bend.z, knee);
      const a = toLocal(hip.x, hip.y, hip.z), kn = toLocal(knee.x, knee.y, knee.z), ft = toLocal(foot.x, foot.y, foot.z);
      const thigh = parts.length;
      parts.push(segPart(a, kn, 0.1 * S, leg, 500), segPart(kn, ft, 0.08 * S, leg, 500));
      joints.push({ a: 0, b: thigh, at: a as [number, number, number] }, { a: thigh, b: thigh + 1, at: kn as [number, number, number] });
    }
    return { parts, joints };
  }
  // Small: the standing pose on flat sand.
  parts.push({ half: [HUB_R * 0.85 * S, HUB_H * 0.5 * S, HUB_R * 0.85 * S], at: [0, HUB_Y * S, 0], color: body, mass: 900 });
  const hips = new Float32Array(12), feet = new Float32Array(12);
  smallLegs(0, 0, 0, S, 0, 0, 0, 0, 0, 0, 0, 0, 0, hips, feet);
  for (let k = 0; k < SMALL_LEGS; k++) {
    hip.x = hips[k * 3]; hip.y = hips[k * 3 + 1]; hip.z = hips[k * 3 + 2];
    foot.x = feet[k * 3]; foot.y = feet[k * 3 + 1]; foot.z = feet[k * 3 + 2];
    const r = Math.hypot(hip.x, hip.z) || 1;
    solveKnee(hip, foot, S_THIGH * S, S_SHIN * S, (hip.x / r) * 0.6, 1, (hip.z / r) * 0.6, knee);
    const a = [hip.x, hip.y, hip.z], kn = [knee.x, knee.y, knee.z], ft = [foot.x, foot.y, foot.z];
    const thigh = parts.length;
    parts.push(segPart(a, kn, 0.075 * S, leg), segPart(kn, ft, 0.06 * S, leg));
    joints.push({ a: 0, b: thigh, at: a as [number, number, number] }, { a: thigh, b: thigh + 1, at: kn as [number, number, number] });
  }
  return { parts, joints };
}
