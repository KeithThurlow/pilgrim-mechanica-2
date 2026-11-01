// A destroyed mech's ragdoll (Keith 2026-11-01: "they should ragdoll less, like with more weight, than human ragdolls,
// and be a little more rigid in maintaining default pose"). Pure layout and numbers: the pelvis, the hull and each
// leg's thigh, shin, cannon and foot as boxes in the pose the mech died in, joined where the model's joints are; every
// leg joint is a hinge with a motor pulling back toward that pose (DeathPhysics.heavy), soft enough that it buckles and
// topples under its own weight as one heavy piece instead of flopping; then the power dies and it settles.
// Ownership: the death (MechUnit.alive) is host state; the wreck's fall is cosmetic, seeded from the mech's id so every
// peer's looks alike.
import { Quaternion, Vector3 } from "three";
import type { Param } from "../core/tweaks";
import type { HoldValues, JointSpec, PartSpec } from "./deaths";
import { segPart } from "./bodies";

export const MECH_WRECK_DEFAULTS = {
  mechWreckOn: 1,
  mechPoseStiffness: 1.5,
  mechPoseDamping: 0.3,
  mechBendLimit: 70,
  mechHoldFor: 0.8,
  mechHoldEnd: 0.35,
  mechFadeTime: 1.6,
  mechDeathPush: 2.5,
  mechDeathLift: 0.15,
  mechDeathSpin: 0.25,
  mechDeathSide: 0.5,
  mechMomentum: 1,
  mechWreckDamping: 1.2,
  mechMoveFor: 12,
  mechThud: 1,
};
export type MechWreckValues = typeof MECH_WRECK_DEFAULTS;
const _hold: HoldValues = MECH_WRECK_DEFAULTS; // the hold reads the sliders straight off the values
void _hold;

const G = "Mech wrecks";
export const MECH_WRECK_PARAMS: Param[] = [
  { key: "mechWreckOn", label: "Mechs fall when destroyed", min: 0, max: 1, step: 1, group: G, tip: "0: a destroyed mech just goes dark where it stands (as before)" },
  { key: "mechPoseStiffness", label: "Joint stiffness (× weight)", min: 0, max: 8, step: 0.05, group: G, tip: "How hard each joint pulls back to the pose it died in, per radian bent, × the whole mech's weight × 1 m: 0 flops like a bandit, high falls like a statue. Low, the knees buckle and it folds; high, it topples over stiff" },
  { key: "mechPoseDamping", label: "Joint damping (× weight)", min: 0, max: 3, step: 0.01, group: G, tip: "Resists joints moving at all: heavier, slower folding" },
  { key: "mechBendLimit", label: "Joint bend limit (°)", min: 5, max: 180, step: 1, group: G, tip: "No joint bends further than this from the pose it died in" },
  { key: "mechHoldFor", label: "Joints hold for (s)", min: 0, max: 6, step: 0.1, group: G, tip: "Then the power dies" },
  { key: "mechHoldEnd", label: "Hold left after (share)", min: 0, max: 1, step: 0.01, group: G, tip: "What's left of the pose hold once the power has died: seized joints" },
  { key: "mechFadeTime", label: "Power dies over (s)", min: 0.05, max: 6, step: 0.05, group: G },
  { key: "mechDeathPush", label: "Kill push (m/s)", min: 0, max: 12, step: 0.1, group: G, tip: "How hard the killing hit shoves the hull (the legs get less, so it tips over)" },
  { key: "mechDeathLift", label: "Kill lift (share)", min: 0, max: 1.5, step: 0.05, group: G },
  { key: "mechDeathSide", label: "Kill push off to a side (share)", min: 0, max: 2, step: 0.05, group: G, tip: "Part of the push goes to one side or the other (seeded), so it tips over instead of kneeling on a wide stance" },
  { key: "mechDeathSpin", label: "Kill spin (rad/s)", min: 0, max: 3, step: 0.05, group: G },
  { key: "mechMomentum", label: "Keeps its speed (share)", min: 0, max: 1.5, step: 0.05, group: G, tip: "A mech killed at a sprint carries on and tumbles" },
  { key: "mechWreckDamping", label: "Spin damping", min: 0, max: 8, step: 0.1, group: G, tip: "Higher: heavier, slower tumbling" },
  { key: "mechMoveFor", label: "Wreck moves for (s)", min: 2, max: 40, step: 1, group: G, tip: "Then it freezes where it lies (sooner once it's at rest)" },
  { key: "mechThud", label: "Thud shake ×", min: 0, max: 3, step: 0.05, group: G, tip: "Camera shake, dust and sound when the hull or pelvis slams into the sand" },
];

export type V3 = { x: number; y: number; z: number };
export type Q4 = { x: number; y: number; z: number; w: number };
/** A mech's pose at death, world space: the pelvis, the hull (its box in its own frame) and each leg's joints. */
export interface MechPose {
  pelvis: V3; pelvisQ: Q4;
  hull: V3; hullQ: Q4; hullBox: { centre: V3; half: V3 };
  legs: { hip: V3; knee: V3; hock: V3; ankle: V3; foot: V3; footQ: Q4 }[];
  /** The mech's velocity as it died. */
  vel: V3;
}

/** Part indices: the body (pelvis and hull welded), then per leg the thigh, the shin and the lower leg (cannon and foot). */
export const BODY = 0;
export const legPart = (leg: number, k: 0 | 1 | 2) => 1 + leg * 3 + k;

const PLATE = 0x3b3531;
const arr = (p: V3): [number, number, number] => [p.x, p.y, p.z];
const rot = (q: Q4): [number, number, number, number] => [q.x, q.y, q.z, q.w];
function turn(q: Q4, v: V3): V3 {
  const r = new Vector3(v.x, v.y, v.z).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
  return { x: r.x, y: r.y, z: r.z };
}

/** The ragdoll's parts and joints (world space) from the pose at death. Densities make a top-heavy 40-odd tonnes. */
export function mechWreckSpec(pose: MechPose, limit = 70): { parts: PartSpec[]; joints: JointSpec[] } {
  // Few bodies on purpose: the pelvis and hull are one body, the cannon and foot another (seven in all), so the heavy
  // chain stays stable at the death world's few solver iterations; the model's pivots ride whichever part holds them.
  const parts: PartSpec[] = [], joints: JointSpec[] = [];
  const c = turn(pose.hullQ, pose.hullBox.centre), hb = pose.hullBox.half;
  parts.push({
    half: [0.55, 0.35, 0.45], at: arr(pose.pelvis), color: PLATE, mass: 3000, rot: rot(pose.pelvisQ),
    extra: [{ half: [hb.x, hb.y, hb.z], at: [pose.hull.x + c.x, pose.hull.y + c.y, pose.hull.z + c.z], rot: rot(pose.hullQ), mass: 900 }],
  });
  pose.legs.forEach((L) => {
    const k = parts.length;
    // Every leg joint is a hinge across the leg's plane (hip, knee, hock), like the walker's.
    const u = new Vector3(L.knee.x - L.hip.x, L.knee.y - L.hip.y, L.knee.z - L.hip.z), w = new Vector3(L.hock.x - L.knee.x, L.hock.y - L.knee.y, L.hock.z - L.knee.z);
    const n = u.cross(w);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0).applyQuaternion(new Quaternion(pose.pelvisQ.x, pose.pelvisQ.y, pose.pelvisQ.z, pose.pelvisQ.w));
    n.normalize();
    const hinge: [number, number, number] = [n.x, n.y, n.z], lim = (limit * Math.PI) / 180, limits: [number, number] = [-lim, lim];
    const cannon = segPart(arr(L.hock), arr(L.ankle), 0.4, PLATE, 3500);
    // The foot: a plate off the sole, reaching toward the toes, welded to the cannon.
    const f = turn(L.footQ, { x: 0, y: 0.15, z: 0.25 });
    cannon.extra = [{ half: [0.4, 0.15, 0.65], at: [L.foot.x + f.x, L.foot.y + f.y, L.foot.z + f.z], rot: rot(L.footQ), mass: 2500 }];
    parts.push(segPart(arr(L.hip), arr(L.knee), 0.6, PLATE, 3500), segPart(arr(L.knee), arr(L.hock), 0.5, PLATE, 3500), cannon);
    for (const [a, b, at] of [[BODY, k, L.hip], [k, k + 1, L.knee], [k + 1, k + 2, L.hock]] as const)
      joints.push({ a, b, at: arr(at), hinge, limits });
  });
  return { parts, joints };
}

/**
 * Each part's starting velocity: the mech's own (× mechMomentum, less toward the planted feet) plus the kill's push along (dirX, dirZ), most at the
 * hull and least at the feet so it tips rather than slides; and one shared spin, seeded.
 */
export function mechWreckThrow(parts: PartSpec[], pose: MechPose, v: MechWreckValues, dirX: number, dirZ: number, seed: number, groundY: number) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  // No mech dies balanced: part of the push goes off to one side (seeded), so a wide stance can't hold it up.
  const side = rnd() < 0 ? -1 : 1, off = v.mechDeathSide * side;
  const px = dirX - dirZ * off, pz = dirZ + dirX * off, pl = Math.hypot(px, pz) || 1;
  dirX = px / pl; dirZ = pz / pl;
  const top = Math.max(1, parts[BODY].at[1] + 1.5 - groundY);
  const lin = parts.map((p) => {
    const up = Math.min(1.2, Math.max(0, (p.at[1] - groundY) / top));
    const push = v.mechDeathPush * up ** 1.5;
    // The feet were planted (still): the speed is the hull's, so killed on the run it pitches over its feet.
    const keep = v.mechMomentum * (0.2 + 0.8 * up);
    return { x: pose.vel.x * keep + dirX * push, y: pose.vel.y * keep + push * v.mechDeathLift, z: pose.vel.z * keep + dirZ * push };
  });
  // Mostly a topple across the push (about the axis at right angles to it), a little twist.
  const sp = v.mechDeathSpin;
  const ang = { x: dirZ * sp + rnd() * sp, y: rnd() * sp * 0.6, z: -dirX * sp + rnd() * sp };
  return { lin, ang };
}

/** A string to a seed (the mech's uid and how many times it has died). */
export function seedOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Where a wreck thuds (the pelvis and the hull's middle): DeathPhysics reports these hitting the sand. */
export function mechWreckThuds(parts: PartSpec[]) {
  const hull = parts[BODY].extra![0];
  return [{ part: BODY, at: parts[BODY].at }, { part: BODY, at: hull.at }];
}
