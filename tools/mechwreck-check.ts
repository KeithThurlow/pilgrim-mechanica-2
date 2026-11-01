// Headless check of a destroyed mech's ragdoll (src/physics/mechWreck.ts, DeathPhysics.heavy): a Rampart-sized walker
// killed standing, walking and sprinting, on flat sand and dunes. It must go down (the hull ends lower), fall the way
// it was pushed or was going, stay in one piece (joints together), keep its shape far better than a limp ragdoll,
// never sink into the sand, thud when it lands, and come to rest. Prints the numbers. Run: npx tsx tools/mechwreck-check.ts
import { Quaternion, Vector3 } from "three";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { DeathPhysics, DEATH_DEFAULTS, initPhysics, type Dead } from "../src/physics/deaths";
import { MECH_WRECK_DEFAULTS, mechWreckSpec, mechWreckThrow, mechWreckThuds, BODY, type MechPose, type MechWreckValues } from "../src/physics/mechWreck";

await initPhysics();
const problems: string[] = [];

function poseOf(sim: WalkerSim): MechPose {
  const up = new Vector3(0, 0.55, 0).applyQuaternion(sim.pelvisQ);
  return {
    pelvis: sim.pelvis.clone(), pelvisQ: sim.pelvisQ.clone(),
    hull: sim.pelvis.clone().add(up), hullQ: sim.hullQ.clone(),
    hullBox: { centre: { x: 0, y: 0.85, z: 0 }, half: { x: 1.35, y: 0.85, z: 1.15 } },
    legs: sim.feet.map((f) => ({ hip: f.pose.hip.clone(), knee: f.pose.knee.clone(), hock: f.pose.hock.clone(), ankle: f.pose.ankle.clone(), foot: f.pose.foot.clone(), footQ: f.pose.footQ.clone() })),
    vel: sim.vel.clone(),
  };
}

/** Mean bend (degrees) of every joint away from its pose at death. */
function bend(d: Dead, rest: Quaternion[], pairs: [number, number][]) {
  let sum = 0;
  pairs.forEach(([a, b], i) => {
    const rel = d.quat[a].clone().invert().multiply(d.quat[b]);
    sum += (rel.angleTo(rest[i]) * 180) / Math.PI;
  });
  return sum / pairs.length;
}

interface Case { name: string; flat: boolean; cmd: { x: number; z: number; sprint: boolean }; walk: number; dir: [number, number]; v?: Partial<MechWreckValues> }
const cases: Case[] = [
  { name: "standing, shot from -X", flat: true, cmd: { x: 0, z: 0, sprint: false }, walk: 2, dir: [1, 0] },
  { name: "walking +Z, shot from the side", flat: true, cmd: { x: 0, z: 1, sprint: false }, walk: 3, dir: [1, 0] },
  { name: "sprinting +Z", flat: true, cmd: { x: 0, z: 1, sprint: true }, walk: 4, dir: [0, 1] },
  { name: "walking on dunes", flat: false, cmd: { x: 0.6, z: 0.8, sprint: false }, walk: 4, dir: [-1, 0] },
  { name: "standing, limp (stiffness 0)", flat: true, cmd: { x: 0, z: 0, sprint: false }, walk: 2, dir: [1, 0], v: { mechPoseStiffness: 0, mechPoseDamping: 0 } },
];
const bends: Record<string, number> = {};
for (const c of cases) {
  const field = new DuneField(c.flat ? { ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 } : { ...TERRAIN_DEFAULTS });
  const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, field);
  sim.reset(13, -40, 0);
  for (let t = 0; t < c.walk; t += 1 / 120) sim.update(1 / 120, c.cmd);
  const v = { ...MECH_WRECK_DEFAULTS, ...c.v };
  const phys = new DeathPhysics({ ...DEATH_DEFAULTS }, field);
  phys.follow(sim.pos.x, sim.pos.z);
  const pose = poseOf(sim);
  const g0 = field.height(sim.pos.x, sim.pos.z);
  const { parts, joints } = mechWreckSpec(pose, v.mechBendLimit);
  const { lin, ang } = mechWreckThrow(parts, pose, v, c.dir[0], c.dir[1], 7, g0);
  const d = phys.heavy(parts, joints, lin, ang, { damping: v.mechWreckDamping, moveFor: v.mechMoveFor, hold: v, thud: mechWreckThuds(parts) });
  const pairs = joints.map((j) => [j.a, j.b] as [number, number]);
  const rest = pairs.map(([a, b]) => d.quat[a].clone().invert().multiply(d.quat[b]));
  const hull0 = d.pos[BODY].clone();
  let gap = 0, under = 0, nan = false, thuds = 0, hardest = 0, bend1 = 0, restAt = -1;
  for (let i = 0; i < 60 * 14; i++) {
    phys.step(1 / 60);
    const t = (i + 1) / 60;
    for (const im of d.thud?.impacts.splice(0) ?? []) { thuds++; hardest = Math.max(hardest, im.speed); }
    if (Math.abs(t - 1.5) < 1e-6) bend1 = bend(d, rest, pairs);
    if (!d.live && restAt < 0) restAt = t;
    // Joints together: each joint's point as seen from both its parts.
    for (const j of joints) {
      const pa = parts[j.a], pb = parts[j.b];
      // (Every body starts unturned, its box turned inside it.)
      const la = new Vector3(...j.at).sub(new Vector3(...pa.at)), lb = new Vector3(...j.at).sub(new Vector3(...pb.at));
      const wa = la.applyQuaternion(d.quat[j.a]).add(d.pos[j.a]), wb = lb.applyQuaternion(d.quat[j.b]).add(d.pos[j.b]);
      gap = Math.max(gap, wa.distanceTo(wb));
    }
    d.pos.forEach((p, k) => {
      if (!Number.isFinite(p.x + p.y + p.z)) nan = true;
      under = Math.max(under, field.height(p.x, p.z) - p.y - Math.min(...parts[k].half));
    });
  }
  const h = d.pos[BODY], drop = hull0.y - h.y;
  const moved = new Vector3(h.x - hull0.x, 0, h.z - hull0.z);
  const along = moved.x * c.dir[0] + moved.z * c.dir[1];
  const fwdTravel = moved.x * pose.vel.x + moved.z * pose.vel.z;
  bends[c.name] = bend1;
  console.log(`${c.name}: body ${(hull0.y - g0).toFixed(2)} → ${(h.y - field.height(h.x, h.z)).toFixed(2)} m over the sand, moved ${moved.length().toFixed(1)} m (${along.toFixed(1)} along the push), bend at 1.5 s ${bend1.toFixed(1)}°, ` +
    `joint gap ${gap.toFixed(2)} m, deepest ${under.toFixed(2)} m, thuds ${thuds} (hardest ${hardest.toFixed(1)} m/s), at rest ${restAt < 0 ? "no" : restAt.toFixed(1) + " s"}`);
  if (nan) problems.push(`${c.name}: NaN`);
  const tipped = new Vector3(0, 1, 0).applyQuaternion(d.quat[BODY]).y;
  if (drop < 1.2 && tipped > 0.5) problems.push(`${c.name}: didn't go down (body ${drop.toFixed(2)} m lower, up ${tipped.toFixed(2)})`);
  if (gap > 0.35) problems.push(`${c.name}: came apart (${gap.toFixed(2)} m at a joint)`);
  if (under > 0.3) problems.push(`${c.name}: a part ${under.toFixed(2)} m into the sand`);
  if (c.v?.mechPoseStiffness === undefined && thuds === 0) problems.push(`${c.name}: no thud`);
  if (!c.v && c.flat && c.cmd.x === 0 && c.cmd.z === 0 && along < 0.3) problems.push(`${c.name}: fell against its push (${along.toFixed(2)} m)`);
  if (c.cmd.sprint && fwdTravel <= 0) problems.push(`${c.name}: didn't carry on forward`);
  if (restAt < 0 && c.v?.mechPoseStiffness === undefined) problems.push(`${c.name}: never came to rest`);
}
const stiff = bends["standing, shot from -X"], limp = bends["standing, limp (stiffness 0)"];
console.log(`pose held: ${stiff.toFixed(1)}° bent vs limp ${limp.toFixed(1)}°`);
if (!(stiff < limp * 0.6)) problems.push(`the pose hold barely holds (${stiff.toFixed(1)}° vs limp ${limp.toFixed(1)}°)`);

if (problems.length) { console.error("mech wreck check FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
console.log("mech wreck check passed");
