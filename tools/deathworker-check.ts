// Death physics in the sim worker (src/sim/deathsRemote.ts): the convoy lab's path run headless. The view's calls go
// through the ground's stream, structured-cloned as postMessage does, into a GroundMirror that holds the worker's Rapier
// world; its answers come back a frame late. Cosmetic (the spins are Math.random), so not bit for bit; checked instead:
// thrown bodies come back moving and settle on the sand, the view's poses are the worker's, what an owner sets straight
// after making a body (kept, its kind) reaches the worker, a mech wreck's thuds come back, a removed body leaves both
// sides, and faded bodies leave the view's list. Run: npm test (or npx tsx tools/deathworker-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";
import { DeathPhysics, DEATH_DEFAULTS, initPhysics, type Dead } from "../src/physics/deaths";
import { BANDIT_PARTS, BANDIT_JOINTS } from "../src/physics/bodies";
import { MECH_WRECK_DEFAULTS, mechWreckSpec, mechWreckThrow, mechWreckThuds, type MechPose } from "../src/physics/mechWreck";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { GroundRecorder, type GroundEvent } from "../src/sim/groundEvents";
import { GroundMirror } from "../src/sim/groundMirror";
import { DeathsView } from "../src/sim/deathsRemote";
import { Quaternion, Vector3 } from "three";

{ let seed = 777; Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
await initPhysics();
const problems: string[] = [];

const V = { ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...CRATER_DEFAULTS, ...DEATH_DEFAULTS, ...MECH_WRECK_DEFAULTS, liveFor: 4, bodyStays: 5 };
const field = new DuneField(V);
const route = new ConvoyRoute(V, 0, 0);
field.modifier = route;
const craters = new CraterLayer(V, field);
field.dents = craters;
const rec = new GroundRecorder({ V, field, route, craters, routeAt: [0, 0] });
const mirror = new GroundMirror(structuredClone(rec.init));
const phys = new DeathPhysics(V, field);
const view = new DeathsView(phys, rec);
const X = 60, Z = 40;
phys.follow(X, Z);

// Ten bandits thrown about, a piece of raider debris (kept and turned into a vehicle by its owner after making it,
// as raiderDeath does), a mech wreck and a vehicle wreck.
const bandits: Dead[] = [];
for (let i = 0; i < 10; i++) {
  const x = X + (i % 5) * 3, z = Z + Math.floor(i / 5) * 3;
  bandits.push(phys.ragdoll(BANDIT_PARTS(0x885533), BANDIT_JOINTS, x, field.height(x, z), z, 0, { x: 0, y: 0, z: 0 }, 1, 0, 5));
}
const debris = phys.ragdoll([{ half: [0.4, 0.3, 0.6], at: [0, 0, 0], color: 0, mass: 500 }], [], X - 6, field.height(X - 6, Z) + 2, Z, 0, { x: 2, y: 4, z: 0 }, 0, 0, 0);
debris.kind = "vehicle";
debris.keep = true;
if (debris.pending) debris.pending.ang[0] = { x: 6, y: 1, z: -5 };

const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, field);
sim.reset(X + 10, Z - 10, 0);
for (let t = 0; t < 2; t += 1 / 120) sim.update(1 / 120, { x: 0, z: 0, sprint: false });
const up = new Vector3(0, 0.55, 0).applyQuaternion(sim.pelvisQ);
const pose: MechPose = {
  pelvis: sim.pelvis.clone(), pelvisQ: sim.pelvisQ.clone(), hull: sim.pelvis.clone().add(up), hullQ: sim.hullQ.clone(),
  hullBox: { centre: { x: 0, y: 0.85, z: 0 }, half: { x: 1.35, y: 0.85, z: 1.15 } },
  legs: sim.feet.map((f) => ({ hip: f.pose.hip.clone(), knee: f.pose.knee.clone(), hock: f.pose.hock.clone(), ankle: f.pose.ankle.clone(), foot: f.pose.foot.clone(), footQ: f.pose.footQ.clone() })),
  vel: sim.vel.clone(),
};
const { parts, joints } = mechWreckSpec(pose, V.mechBendLimit);
const thr = mechWreckThrow(parts, pose, V, 1, 0, 7, field.height(sim.pos.x, sim.pos.z));
const mech = phys.heavy(parts, joints, thr.lin, thr.ang, { damping: V.mechWreckDamping, moveFor: V.mechMoveFor, hold: V, thud: mechWreckThuds(parts) });
const wx = X + 4, wz = Z + 12;
const truck = phys.wreck([1, 0.6, 2], { half: [0.8, 0.5, 0.7], at: [0, 1, 0.8] }, new Vector3(wx, field.height(wx, wz) + 1.5, wz), new Quaternion(), new Vector3(0, 3, 4), 1, 0, 3, 2);

const start = bandits.map((d) => d.pos[1].clone());
let thuds = 0, moved = 0, maxBodies = 0, answered = 0;
const held: { poses: Float64Array; thuds: Float64Array }[] = [];
const dt = 1 / 60;
for (let f = 0; f < 60 * 16; f++) {
  phys.follow(X, Z);
  phys.step(dt);
  if (f === 60 * 2) for (const d of bandits.slice(0, 2)) phys.burst(d, X, field.height(X, Z), Z, 6, 8);
  if (f === 60 * 6) phys.remove(debris);
  mirror.apply(structuredClone(rec.take()) as GroundEvent[]);
  await Promise.resolve(); // the worker's Rapier comes up asynchronously
  const a = mirror.deaths?.frame();
  if (a) held.push(structuredClone({ poses: a.poses, thuds: a.thuds }));
  if (held.length > 1) { const m = held.shift()!; view.take(m.poses, m.thuds, 0); answered++; }
  for (const h of mech.thud?.impacts ?? []) { thuds++; void h; }
  if (mech.thud) mech.thud.impacts.length = 0;
  maxBodies = Math.max(maxBodies, view.stats.bodies);
  if (f === 60 * 1) for (let i = 0; i < bandits.length; i++) if (bandits[i].pos[1].distanceTo(start[i]) > 0.3) moved++;
  if (f === 60 * 3) {
    // Mid-flight, the view's poses are the worker's a frame back: compare after the next answer lands.
    const W = (mirror.deaths as unknown as { byId: Map<number, Dead> }).byId;
    const w = W.get(debris.id!);
    if (!w) problems.push("the debris isn't in the worker's world");
    else {
      if (!w.keep || w.kind !== "vehicle") problems.push(`the owner's settings didn't reach the worker (keep ${w.keep}, kind ${w.kind})`);
    }
  }
}
// Last answer in.
for (const m of held) view.take(m.poses, m.thuds, 0);
const W = (mirror.deaths as unknown as { byId: Map<number, Dead> }).byId;

if (answered < 60 * 15) problems.push(`only ${answered} answers`);
if (moved < 8) problems.push(`only ${moved} of 10 bandits moved in their first second`);
if (thuds < 1) problems.push("the mech wreck's thuds never came back");
if (W.has(debris.id!) || phys.dead.includes(debris)) problems.push("the removed debris is still there");
for (const d of bandits) {
  if (!d.done) problems.push(`bandit ${d.id} never faded (age ${d.age.toFixed(1)})`);
  if (phys.dead.includes(d)) problems.push(`bandit ${d.id} faded but is still in the view's list`);
}
if (!phys.dead.includes(mech) || mech.done) problems.push("the mech wreck (kept) left");
for (const d of [mech, truck]) {
  const w = W.get(d.id!);
  if (!w && !d.done) { problems.push(`body ${d.id} is gone from the worker but not the view`); continue; }
  if (w) for (let k = 0; k < d.pos.length; k++) if (d.pos[k].distanceTo(w.pos[k]) > 1e-6 || Math.abs(d.quat[k].dot(w.quat[k])) < 1 - 1e-6) { problems.push(`body ${d.id} part ${k}: view and worker differ by ${d.pos[k].distanceTo(w.pos[k]).toExponential(2)} m (live ${d.live}/${w.live})`); break; }
  if (d.live) problems.push(`body ${d.id} still moving after 16 s`);
}
const hull = mech.pos[0], g = field.height(hull.x, hull.z);
if (!(hull.y > g - 0.5 && hull.y < g + 4)) problems.push(`mech wreck's first part ${(hull.y - g).toFixed(2)} m off the sand`);
const t0 = truck.pos[0], tg = field.height(t0.x, t0.z);
if (!(t0.y > tg - 0.3 && t0.y < tg + 2)) problems.push(`truck wreck ${(t0.y - tg).toFixed(2)} m off the sand`);

console.log(`deathworker: ${answered} answers, ${moved}/10 thrown, ${thuds} thuds, up to ${maxBodies} bodies, mech wreck ${(hull.y - g).toFixed(2)} m, truck ${(t0.y - tg).toFixed(2)} m above the sand`);
if (problems.length) { for (const p of problems) console.log("  FAIL " + p); process.exit(1); }
console.log("deathworker: ok");
