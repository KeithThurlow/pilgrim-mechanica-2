// Stagger check (Keith 2026-11-15: "getting hit by a sword should really stagger enemies ... including us";
// src/game/poise.ts). Must: a sword cut staggers every enemy kind and a mech; a lone minigun round staggers nothing
// heavier than a bandit; a stream of rounds staggers a cutter; a staggered robot starts no attack and a charge not yet
// loosed breaks off; grace stops a second stagger straight after; a bandit staggered fires no shots.
import { POISE_DEFAULTS, Poise } from "../src/game/poise";
import { RobotSwarm, ROBOT_DEFAULTS, BIG, MID, DEAD } from "../src/combat/robots";
import { InfantrySwarm, INFANTRY_DEFAULTS } from "../src/combat/infantry";
import { Crushers, CRUSHER_DEFAULTS, SUCK } from "../src/combat/crusher";
import { Striders, STRIDER_DEFAULTS } from "../src/combat/strider";
import { MECH_DEFAULTS } from "../src/game/mechUnit";
import { SWORD_DEFAULTS } from "../src/weapons/sword";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const P = POISE_DEFAULTS;
const problems: string[] = [];
const fail = (m: string) => problems.push(m);
const SWORD = SWORD_DEFAULTS.swordDamage, CUT = SWORD * P.swordPoise, ROUND = MECH_DEFAULTS.roundDamage;
const dt = 1 / 30;

// The rule itself.
{
  const p = new Poise();
  if (p.hit(ROUND, 100, P) > 0) fail("one small hit staggered a 100 poise");
  for (let k = 0; k < 20; k++) p.tick(0.1, P);
  if (p.build[0] > ROUND * 0.2) fail(`the build didn't fade (${p.build[0].toFixed(1)} after 2 s)`);
  const t = p.hit(150, 100, P);
  if (!(t >= P.staggerTime)) fail(`150 into a 100 poise: no stagger (${t})`);
  if (p.hit(500, 100, P) > 0) fail("staggered again while staggered");
  for (let s = 0; s < t + 0.05; s += 0.05) p.tick(0.05, P);
  if (p.hit(500, 100, P) > 0) fail("staggered again inside the grace");
  console.log(`  rule: 150 into 100 staggers ${t.toFixed(2)} s, grace ${P.staggerGrace} s`);
}

// Robots: the sword on every walker kind; rounds.
const far = { x: 300, y: 0, z: 300, radius: 2 };
function robot(kind: "cutter" | "quad" | "big"): RobotSwarm {
  const sw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotQuadShare: kind === "quad" ? 1 : 0, robotBigShare: kind === "big" ? 1 : 0, robotMidShare: kind === "big" ? 0 : 1 }, field, 5);
  sw.spawn(1, 0, 0, 0);
  sw.update(dt, far, () => {});
  return sw;
}
for (const kind of ["cutter", "quad", "big"] as const) {
  const sw = robot(kind);
  sw.damage(0, ROUND, 1, 0);
  if (sw.stun[0] > 0) fail(`${kind}: one round staggered it`);
  const hp = sw.hp[0];
  // The sword: its damage (unless it kills) plus the extra.
  sw.poise(0, CUT - SWORD, 1, 0);
  const killed = sw.damage(0, Math.min(SWORD, hp - 1), 1, 0);
  if (killed || !(sw.stun[0] > 0)) fail(`${kind}: a sword cut didn't stagger it (stun ${sw.stun[0].toFixed(2)}, health ${hp})`);
  const x0 = sw.px[0];
  for (let k = 0; k < 10; k++) sw.update(dt, far, () => {});
  const pushed = sw.px[0] - x0;
  console.log(`  ${kind}: health ${hp.toFixed(0)}, stagger ${sw.stun[0].toFixed(2)} s left after 0.33 s, shoved ${pushed.toFixed(2)} m`);
  if (!(pushed > 0.05)) fail(`${kind}: not shoved along the hit (${pushed.toFixed(3)} m)`);
}
{
  // A stream of rounds (the minigun's rate) staggers a cutter.
  const sw = robot("cutter");
  let at = -1;
  for (let k = 0; k < 60 && at < 0; k++) { sw.damage(0, ROUND, 1, 0); if (k % 2) sw.update(dt, far, () => {}); if (sw.stun[0] > 0) at = k + 1; }
  console.log(`  cutter under rounds: staggered after ${at} rounds`);
  if (at < 0) fail("a stream of rounds never staggered a cutter");
}
{
  // An excavator charging its beam: a stagger breaks it off and it starts nothing while staggered.
  const sw = robot("big");
  const near = { x: 0, y: 2, z: 40, radius: 2 };
  sw.primeAttacks(0, 0, 999);
  let charging = false;
  for (let k = 0; k < 900 && !charging; k++) { sw.update(dt, near, () => {}); charging = sw.beamT[0] >= 0; }
  if (!charging) fail("the excavator never started its beam");
  else {
    sw.poise(0, CUT - SWORD, 0, 1); sw.damage(0, SWORD, 0, 1);
    if (sw.beamT[0] >= 0) fail("a stagger didn't break off the excavator's charging beam");
    let started = false;
    sw.primeAttacks(0, 0, 0);
    while (sw.stun[0] > 0 && sw.state[0] < DEAD) { sw.update(dt, near, () => {}); if (sw.stun[0] > 0 && (sw.beamT[0] >= 0 || sw.pulseT[0] >= 0)) started = true; }
    if (started) fail("a staggered excavator started an attack");
  }
  if (sw.kind[0] !== BIG) fail("not an excavator");
}
{
  const sw = robot("cutter");
  if (sw.kind[0] !== MID) fail("not a cutter");
}

// Bandits: a non-lethal hit staggers one and it holds fire.
{
  const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS, hp: 40 }, field, 3);
  sw.spawn(1, 0, 20, 0);
  const tgt = { x: 0, y: 2, z: 0, radius: 2 };
  for (let k = 0; k < 90; k++) sw.update(dt, tgt, () => {});
  sw.damage(0, 25, 0, 1);
  if (!(sw.stun[0] > 0)) fail("a bandit took 25 of 40 and didn't stagger");
  let shots = 0;
  while (sw.stun[0] > 0) sw.update(dt, tgt, () => { shots++; });
  if (shots) fail(`a staggered bandit fired ${shots} shots`);
}

// Crusher and strider: the sword staggers; a crusher's suck breaks off.
{
  const pack = new Crushers({ ...CRUSHER_DEFAULTS }, field, 3);
  const c = pack.spawn(0, 0, 0);
  const prey = { x: 0, y: 1, z: 12, vx: 0, vz: 0, alive: true, radius: 2 };
  let sucking = false;
  for (let k = 0; k < 30 * 30 && !sucking; k++) { pack.update(dt, prey as never, []); sucking = c.mode === SUCK; }
  c.stagger(CUT - SWORD, 0, 1); pack.hit(c, SWORD, 0, 1);
  if (!c.poise.staggered) fail("a sword cut didn't stagger a crusher");
  if (sucking && c.mode === SUCK) fail("a stagger didn't break off the crusher's suck");
  console.log(`  crusher: ${sucking ? "sucking, " : ""}stagger ${c.poise.left.toFixed(2)} s`);
}
{
  const pack = new Striders({ ...STRIDER_DEFAULTS }, field, 3);
  const s = pack.spawn(0, 0, 0);
  pack.update(dt, null, () => true);
  s.stagger(CUT - SWORD, 1, 0); pack.hit(s, SWORD, 1, 0);
  if (!s.poise.staggered || !(s.sim.stagger > 0)) fail("a sword cut didn't stagger a strider");
  console.log(`  strider: stagger ${s.poise.left.toFixed(2)} s`);
}

// Mechs: a cut staggers one, a round doesn't (the threshold MechUnit uses).
{
  const p = new Poise(), poise = P.poiseMech * MECH_DEFAULTS.hull;
  if (p.hit(ROUND * 3, poise, P) > 0) fail("three rounds staggered a mech");
  p.clear();
  if (!(p.hit(CUT, poise, P) > 0)) fail(`a sword cut (${CUT}) didn't stagger a mech (poise ${poise})`);
  console.log(`  mech: poise ${poise} (sword cut counts ${CUT})`);
}

if (problems.length) { for (const m of problems) console.error("FAIL " + m); process.exit(1); }
console.log("stagger: ok");
