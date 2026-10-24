// Ragdoll layouts for the death physics (parts in the body's own frame: origin at the feet, facing +Z, +X left).
import type { PartSpec, JointSpec } from "./deaths";
import { BIG, SMALL, type RobotSwarm } from "../combat/robots";
import {
  HUB_R, HUB_H, HUB_Y, S_THIGH, S_SHIN, SMALL_LEGS, WALK_LEGS, BIG_BODY_H, MID_BODY_H, solveKnee, smallLegs, type V3,
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
 * Robot i's ragdoll in its pose as it died, in its own frame (origin on the sand under it, facing +Z), each joint
 * loose: a small one's hub and four legs (thigh and shin); a medium one's chassis and four legs; a big one's high
 * chassis and four arm legs as boom, stick and bucket, falling from its full height.
 */
export function robotRagdoll(sw: RobotSwarm, i: number, body: number, leg: number): { parts: PartSpec[]; joints: JointSpec[] } {
  const S = sw.size[i], h = sw.heading[i], ox = sw.px[i], oy = sw.py[i], oz = sw.pz[i];
  const sh = Math.sin(h), ch = Math.cos(h);
  // World to the body's own frame (yaw undone).
  const toLocal = (p: V3): [number, number, number] => { const dx = p.x - ox, dz = p.z - oz; return [dx * ch - dz * sh, p.y - oy, dx * sh + dz * ch]; };
  const parts: PartSpec[] = [], joints: JointSpec[] = [];
  const hip: V3 = { x: 0, y: 0, z: 0 }, knee: V3 = { x: 0, y: 0, z: 0 }, tip: V3 = { x: 0, y: 0, z: 0 }, foot: V3 = { x: 0, y: 0, z: 0 };
  const kind = sw.kind[i];
  if (kind !== SMALL) {
    const big = kind === BIG, H = sw.hubY[i] - oy;
    parts.push(big
      ? { half: [0.38 * S, BIG_BODY_H * 0.5 * S, 0.45 * S], at: [0, H, 0], color: body, mass: 900 }
      : { half: [0.3 * S, MID_BODY_H * 0.5 * S, 0.4 * S], at: [0, H, 0], color: body, mass: 900 });
    for (let k = 0; k < WALK_LEGS; k++) {
      sw.legPose(i, k, hip, knee, tip, foot);
      const a = toLocal(hip), kn = toLocal(knee), tp = toLocal(tip), ft = toLocal(foot);
      const first = parts.length;
      parts.push(segPart(a, kn, (big ? 0.13 : 0.07) * S, leg, 500), segPart(kn, tp, (big ? 0.1 : 0.055) * S, leg, 500));
      joints.push({ a: 0, b: first, at: a }, { a: first, b: first + 1, at: kn });
      if (big) {
        // The bucket: a squat block from the stick's end down to the sand.
        parts.push(segPart(tp, ft, 0.26 * S, 0x4a4840, 700));
        joints.push({ a: first + 1, b: first + 2, at: tp });
      }
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
    const a: [number, number, number] = [hip.x, hip.y, hip.z], kn: [number, number, number] = [knee.x, knee.y, knee.z], ft = [foot.x, foot.y, foot.z];
    const thigh = parts.length;
    parts.push(segPart(a, kn, 0.075 * S, leg), segPart(kn, ft, 0.06 * S, leg));
    joints.push({ a: 0, b: thigh, at: a }, { a: thigh, b: thigh + 1, at: kn });
  }
  return { parts, joints };
}
