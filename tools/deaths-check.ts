// Headless death-physics check: the physics floor matches the dune height function (bodies come to rest on the sand,
// not floating or sunk, anywhere on the patch), a ragdoll thrown along a direction lands that way and settles, the
// cap freezes the oldest, and bodies are cleared at the end. Run: npm test (or npx tsx tools/deaths-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { DeathPhysics, DEATH_DEFAULTS, initPhysics } from "../src/physics/deaths";
import { BANDIT_PARTS, BANDIT_JOINTS, robotRagdoll } from "../src/physics/bodies";
import { RobotSwarm, ROBOT_DEFAULTS, BIG, MID, SMALL } from "../src/combat/robots";
import { BIG_SPEC, MID_SPEC } from "../src/combat/robotLegs";

await initPhysics();
const field = new DuneField({ ...TERRAIN_DEFAULTS });
const v = { ...DEATH_DEFAULTS, liveFor: 20, maxRagdolls: 200, bodyStays: 60 };
const phys = new DeathPhysics(v, field);
phys.follow(0, 0);
const problems: string[] = [];

// Floor: small boxes dropped across the patch must rest on the sand.
let worst = 0;
const drops: { x: number; z: number; d: ReturnType<DeathPhysics["ragdoll"]> }[] = [];
for (let i = 0; i < 25; i++) {
  const x = -40 + (i % 5) * 20, z = -40 + Math.floor(i / 5) * 20;
  const d = phys.ragdoll([{ half: [0.3, 0.3, 0.3], at: [0, 0.3, 0], color: 0 }], [], x, field.height(x, z) + 1.5, z, 0, { x: 0, y: 0, z: 0 }, 0, 0, 0);
  drops.push({ x, z, d });
}
for (let i = 0; i < 60 * 6; i++) phys.step(1 / 60);
for (const { d } of drops) {
  const p = d.pos[0], g = field.height(p.x, p.z);
  // A cube on a slope rests with its centre between its half size and its half diagonal above the sand.
  const off = p.y - g;
  worst = Math.max(worst, Math.abs(off - 0.3));
  if (!Number.isFinite(p.y)) problems.push("NaN in a box");
  if (off < 0.1 || off > 0.75) problems.push(`box at ${p.x.toFixed(0)},${p.z.toFixed(0)} rests ${off.toFixed(2)} m above the sand`);
}

// A bandit ragdoll on flat ground thrown along +X lands on +X and settles.
const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const p2 = new DeathPhysics(v, flat);
p2.follow(0, 0);
const rd = p2.ragdoll(BANDIT_PARTS(0x885533), BANDIT_JOINTS, 0, 0, 0, 0, { x: 0, y: 0, z: 0 }, 1, 0, 6);
for (let i = 0; i < 60 * 5; i++) p2.step(1 / 60);
const torso = rd.pos[1];
if (!(torso.x > 0.5)) problems.push(`ragdoll thrown along +X ended at x=${torso.x.toFixed(2)}`);
if (torso.y > 0.6 || torso.y < -0.05) problems.push(`ragdoll torso not lying on the ground (y=${torso.y.toFixed(2)})`);
const spread = Math.max(...rd.pos.map((p) => p.distanceTo(torso)));
if (spread > 1.6) problems.push(`ragdoll came apart (a part ${spread.toFixed(2)} m from the torso)`);

// Robot ragdolls (turned leg parts): a small one, a medium cutter and a big excavator each collapse in one piece and
// come to rest on the sand.
const rsw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotBigShare: 1 / 3, robotMidShare: 1 / 3 }, flat, 3);
rsw.spawn(3, 0, 0, 0.1);
rsw.update(1 / 120, { x: 300, y: 0, z: 300, radius: 2 }, () => {});
const robotNotes: string[] = [];
const seen = new Set<number>();
for (let i = 0; i < 3; i++) {
  const kind = rsw.kind[i], name = kind === BIG ? "excavator" : kind === MID ? "medium" : "small";
  seen.add(kind);
  const { parts, joints } = robotRagdoll(rsw, i, 0, 0);
  const pr = new DeathPhysics(v, flat);
  pr.follow(0, 0);
  const d = pr.ragdoll(parts, joints, rsw.px[i], rsw.py[i], rsw.pz[i], rsw.heading[i], { x: 0, y: 0, z: 0 }, 1, 0, kind === SMALL ? 3 : 1);
  // Turned parts start where they were laid out: one step must not tear the joints apart.
  const start = d.pos.map((p) => p.clone());
  pr.step(1 / 60);
  const jump = Math.max(...d.pos.map((p, k) => p.distanceTo(start[k])));
  for (let s = 0; s < 60 * 8; s++) pr.step(1 / 60);
  // Every part stays within a leg's length (all its bones end to end) of the body.
  const H = rsw.hubY[i] - rsw.py[i];
  const legLen = kind === BIG ? H * (BIG_SPEC.L1 + BIG_SPEC.L2 + BIG_SPEC.toe) + rsw.size[i] : kind === MID ? H * (MID_SPEC.L1 + MID_SPEC.L2) + rsw.size[i] : rsw.size[i];
  const hub = d.pos[0];
  const far = Math.max(...d.pos.map((p) => p.distanceTo(hub)));
  const low = Math.min(...d.pos.map((p) => p.y));
  robotNotes.push(`${name} (${parts.length} parts): first step moves parts ≤${jump.toFixed(2)} m, body at ${hub.y.toFixed(2)} m, parts within ${far.toFixed(1)} m`);
  if (d.pos.some((p) => !Number.isFinite(p.x + p.y + p.z))) problems.push(`NaN in a ${name} robot ragdoll`);
  if (jump > 0.3) problems.push(`${name} robot ragdoll jumped ${jump.toFixed(2)} m on its first step (joints misplaced)`);
  if (far > legLen) problems.push(`${name} robot ragdoll came apart (a part ${far.toFixed(1)} m from the body)`);
  if (low < -0.3) problems.push(`${name} robot ragdoll part ${low.toFixed(2)} m under the sand`);
  if (kind !== SMALL && hub.y > 3) problems.push(`${name} robot's body still ${hub.y.toFixed(1)} m up after 8 s`);
}
if (seen.size !== 3) problems.push(`robot ragdolls built for kinds ${[...seen].join(", ")}, not all three sizes`);
console.log("robots: " + robotNotes.join(" · "));

// Cap: past maxRagdolls the oldest freeze.
const p3 = new DeathPhysics({ ...v, maxRagdolls: 5 }, flat);
p3.follow(0, 0);
for (let i = 0; i < 9; i++) p3.ragdoll(BANDIT_PARTS(0), BANDIT_JOINTS, i * 3, 0, 0, 0, { x: 0, y: 0, z: 0 }, 0, 1, 2);
const t0 = performance.now();
for (let i = 0; i < 60; i++) p3.step(1 / 60);
const ms = (performance.now() - t0) / 60;
if (p3.liveCount > 5) problems.push(`${p3.liveCount} moving with a cap of 5`);
// Clearing.
const p4 = new DeathPhysics({ ...v, bodyStays: 1 }, flat);
p4.follow(0, 0);
p4.ragdoll(BANDIT_PARTS(0), BANDIT_JOINTS, 0, 0, 0, 0, { x: 0, y: 0, z: 0 }, 0, 1, 2);
for (let i = 0; i < 60 * 7; i++) p4.step(1 / 60);
if (p4.dead.length) problems.push("a body was never cleared");

console.log(`floor: boxes rest within ${worst.toFixed(2)} m of their resting height · ragdoll thrown +X lies at x=${torso.x.toFixed(2)}, torso ${torso.y.toFixed(2)} m up, parts within ${spread.toFixed(2)} m · cap 5 of 9 moving, ${ms.toFixed(2)} ms/step`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("deaths check failed"); }
console.log("deaths check passed");
