// A downed strider's ragdoll (src/physics/deaths.ts): the chest, the disc head and each leg's thigh, shin and cannon in
// the pose it died in, in its own frame (origin on the sand under it, facing +Z after its torso's yaw is undone).
// Cosmetic.
import type { PartSpec, JointSpec } from "../physics/deaths";
import { segPart } from "../physics/bodies";
import { STRIDER_FRAME, type Strider } from "./strider";
import { STRIDER_PALETTE } from "./striderBody";

type V = { x: number; y: number; z: number };

export function striderRagdoll(s: Strider, groundY: number): { parts: PartSpec[]; joints: JointSpec[]; x: number; y: number; z: number; yaw: number } {
  const S = s.S, F = STRIDER_FRAME, P = STRIDER_PALETTE;
  const o = s.pos(), yaw = s.face, sh = Math.sin(yaw), ch = Math.cos(yaw);
  o.y = groundY;
  // World (sim metres × S) to the frame with the yaw undone.
  const loc = (p: V, k = S): [number, number, number] => { const dx = p.x * k - o.x, dz = p.z * k - o.z; return [dx * ch - dz * sh, p.y * k - o.y, dx * sh + dz * ch]; };
  const parts: PartSpec[] = [], joints: JointSpec[] = [];
  const low = s.up(F.chestLow), top = s.up(F.chestTop), head = s.head();
  parts.push(segPart(loc(low, 1), loc(top, 1), F.chestR * 2 * S, P.plate, 3000));
  parts.push({ half: [F.headR * S, F.headH * 0.5 * S, F.headR * S], at: loc(head, 1), color: P.plate, mass: 900 });
  joints.push({ a: 0, b: 1, at: loc(top, 1) });
  const pelvis = s.up(0);
  for (const f of s.sim.feet) {
    const p = f.pose, k = parts.length;
    parts.push(segPart(loc(p.hip), loc(p.knee), 0.3 * S, P.plate, 700), segPart(loc(p.knee), loc(p.hock), 0.2 * S, P.plateDim, 500), segPart(loc(p.hock), loc(p.toe), 0.14 * S, P.dark, 400));
    joints.push({ a: 0, b: k, at: loc(pelvis, 1) }, { a: k, b: k + 1, at: loc(p.knee) }, { a: k + 1, b: k + 2, at: loc(p.hock) });
  }
  // The arms, shoulder to hand, hung off the chest.
  for (const side of [1, -1] as const) {
    const a = s.shoulder(side), b = s.hand(side), k = parts.length;
    parts.push(segPart(loc(a, 1), loc(b, 1), 0.24 * S, P.plate, 400));
    joints.push({ a: 0, b: k, at: loc(a, 1) });
  }
  return { parts, joints, x: o.x, y: o.y, z: o.z, yaw };
}
