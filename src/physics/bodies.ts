// Ragdoll layouts for the death physics (parts in the body's own frame: origin at the feet, facing +Z, +X left).
import type { PartSpec, JointSpec } from "./deaths";

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

/**
 * A quadruped robot of body length s (m): a body and four legs of thigh and shin, hips loose, knees
 * hinged. Measurements follow the robot drawer's.
 */
export const ROBOT_PARTS = (s: number, body: number, leg: number): PartSpec[] => {
  const parts: PartSpec[] = [{ half: [0.25 * s, 0.15 * s, 0.5 * s], at: [0, 0.5 * s, 0], color: body, mass: 900 }];
  for (const [x, z] of [[0.28, 0.36], [-0.28, 0.36], [0.28, -0.36], [-0.28, -0.36]]) {
    parts.push({ half: [0.04 * s, 0.17 * s, 0.04 * s], at: [x * s, 0.36 * s, z * s], color: leg });
    parts.push({ half: [0.035 * s, 0.18 * s, 0.035 * s], at: [x * s, 0.1 * s, z * s], color: leg });
  }
  return parts;
};
export const ROBOT_JOINTS = (s: number): JointSpec[] => {
  const j: JointSpec[] = [];
  [[0.28, 0.36], [-0.28, 0.36], [0.28, -0.36], [-0.28, -0.36]].forEach(([x, z], k) => {
    const thigh = 1 + k * 2, shin = 2 + k * 2;
    j.push({ a: 0, b: thigh, at: [x * s, 0.5 * s, z * s] });
    j.push({ a: thigh, b: shin, at: [x * s, 0.2 * s, z * s], hinge: [1, 0, 0], limits: [-2, 2] });
  });
  return j;
};
