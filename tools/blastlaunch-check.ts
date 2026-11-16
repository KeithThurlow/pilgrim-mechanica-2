// Blast launch check (Keith 2026-11-16: explosions should make humanoids and robots fly; src/game/blastLaunch.ts).
// Must: a blast kill throws a bandit and a scrapper out from the blast and up, harder near the centre; heavier kinds are
// thrown less; a light survivor near a blast is knocked down (bandits slide out, scrappers fly) but the far edge of a
// small blast knocks nobody; a blast staggers more than its damage alone; the ragdoll a launch makes leaves the ground;
// switched off, a blast kill falls as any other.
import * as THREE from "three/webgpu";
import { BLAST_LAUNCH_DEFAULTS, blastKick } from "../src/game/blastLaunch";
import { InfantrySwarm, INFANTRY_DEFAULTS, DOWN as B_DOWN } from "../src/combat/infantry";
import { InfantryTarget } from "../src/combat/infantryTarget";
import { RobotSwarm, ROBOT_DEFAULTS, FLUNG, DEAD } from "../src/combat/robots";
import { RobotTarget } from "../src/combat/robotTarget";
import { DeathPhysics, DEATH_DEFAULTS, initPhysics } from "../src/physics/deaths";
import { BANDIT_PARTS, BANDIT_JOINTS } from "../src/physics/bodies";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const problems: string[] = [];
const fail = (m: string) => problems.push(m);
const down = new THREE.Vector3(0, -1, 0);
const L = BLAST_LAUNCH_DEFAULTS;

// The rule.
{
  const k = { out: 0, up: 0 };
  const c = blastKick(0, 6, 1, L, k).up, e = blastKick(5.9, 6, 1, L, k).up, h = blastKick(0, 6, 0.35, L, k).up;
  if (!(c > e && e > 0)) fail(`the throw doesn't fall off to the edge (${c.toFixed(1)} → ${e.toFixed(1)})`);
  if (!(h < c * 0.5)) fail(`a heavy kind is thrown nearly as hard (${h.toFixed(1)} vs ${c.toFixed(1)})`);
  if (blastKick(7, 6, 1, L, k).up !== 0) fail("thrown from past the edge");
  if (blastKick(0, 6, 1, { ...L, blastLaunchOn: 0 }, k).up !== 0) fail("thrown while off");
  console.log(`  rule: a 6 m blast throws a light kill ${c.toFixed(1)} m/s up at the centre, ${e.toFixed(1)} at the edge`);
}

// Bandits: one 1 m from a Nova Lance sized blast (6 m, 220) dies flying; one 5.5 m out from a small blast lives,
// knocked flat and sliding away; one at the edge of a small blast stands.
function bandits(hp: number, xs: number[]) {
  const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS, hp }, field, 3);
  for (const x of xs) { const [i] = sw.spawn(1, x, 0, 0); sw.px[i] = x; sw.pz[i] = 0; sw.py[i] = 0; }
  const deaths: { i: number; nx: number; speed: number; up: number }[] = [];
  sw.onDeath = (i, nx, _nz, speed) => deaths.push({ i, nx, speed, up: sw.deathUp[i] });
  return { sw, t: new InfantryTarget(sw, 2), deaths };
}
{
  const { sw, t, deaths } = bandits(12, [1, 4]);
  t.splash(new THREE.Vector3(0, 0.2, 0), 6, 220, down, { blast: true });
  if (deaths.length !== 2) fail(`bandits: ${deaths.length} of 2 killed by a 220 blast`);
  const [a, b] = deaths;
  if (a && !(a.nx > 0.9 && a.speed > 5 && a.up > 6)) fail(`bandits: the near kill isn't thrown out and up (dir ${a.nx.toFixed(2)}, out ${a.speed.toFixed(1)}, up ${a.up.toFixed(1)})`);
  if (a && b && !(b.up < a.up)) fail("bandits: the far kill is thrown as hard as the near one");
  console.log(`  bandits killed by a lance burst: 1 m out ${a?.speed.toFixed(1)} out, ${a?.up.toFixed(1)} up; 4 m out ${b?.speed.toFixed(1)}, ${b?.up.toFixed(1)}`);
  if (sw.launched !== 2) fail(`bandits: launched counts ${sw.launched}`);
}
{
  const { sw, t } = bandits(400, [1.5, 3.9]);
  t.splash(new THREE.Vector3(0, 0.2, 0), 4, 30, down, { blast: true });
  if (sw.state[0] !== B_DOWN || !(sw.vx[0] > 1)) fail(`bandits: a survivor near a blast isn't knocked down and out (state ${sw.state[0]}, vx ${sw.vx[0].toFixed(2)})`);
  if (sw.state[1] === B_DOWN) fail("bandits: the edge of a small blast knocked one flat");
  console.log(`  bandit survivor 1.5 m from a 4 m blast: knocked, sliding ${sw.vx[0].toFixed(1)} m/s; at 3.9 m: ${sw.state[1] === B_DOWN ? "knocked" : "standing"}`);
}
{
  // Staggers: a blast's 30 into a 400 bandit (poise 0.45 × 400 = 180) staggers only with the blast's extra.
  const { sw, t } = bandits(400, [2]);
  const P = { ...INFANTRY_DEFAULTS, hp: 400, blastKnock: 0, blastPoise: 6 };
  sw.v = P;
  t.splash(new THREE.Vector3(0, 0.2, 0), 4, 50, down, { blast: true });
  if (!(sw.stun[0] > 0)) fail("bandits: blastPoise didn't stagger");
  const off = bandits(400, [2]);
  off.sw.v = { ...P, blastPoise: 1 };
  off.t.splash(new THREE.Vector3(0, 0.2, 0), 4, 50, down, { blast: true });
  if (off.sw.stun[0] > 0) fail("bandits: the blast staggered without its extra");
}
{
  const { sw, t, deaths } = bandits(12, [1]);
  sw.v = { ...sw.v, blastLaunchOn: 0 };
  t.splash(new THREE.Vector3(0, 0.2, 0), 6, 220, down, { blast: true });
  if (!deaths[0] || deaths[0].up !== 0) fail("bandits: off, a blast kill still went up");
}

// Robots: scrappers (light), cutters, quads.
function robots(o: Partial<typeof ROBOT_DEFAULTS>, x: number) {
  const sw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotMidShare: 0, robotBigShare: 0, ...o }, field, 5);
  sw.spawn(1, x, 0, 0);
  sw.px[0] = x; sw.pz[0] = 0;
  sw.update(1 / 30, { x: 300, y: 0, z: 300, radius: 2 }, () => {});
  sw.px[0] = x; sw.pz[0] = 0;
  return { sw, t: new RobotTarget(sw, 3) };
}
{
  const { sw, t } = robots({}, 1);
  t.splash(new THREE.Vector3(0, 0.2, 0), 6, 220, down, { blast: true });
  if (sw.state[0] !== DEAD || !(sw.deathUp[0] > 6 && sw.deathFling[0] > 5 && sw.vx[0] > 5 && sw.vy[0] > 6)) fail(`scrapper: not thrown (up ${sw.deathUp[0].toFixed(1)}, vx ${sw.vx[0].toFixed(1)}, vy ${sw.vy[0].toFixed(1)})`);
  console.log(`  scrapper killed 1 m from a lance burst: ${sw.deathFling[0].toFixed(1)} out, ${sw.deathUp[0].toFixed(1)} up`);
}
{
  const { sw, t } = robots({ robotHp: 400 }, 1.5);
  t.splash(new THREE.Vector3(0, 0.2, 0), 4, 30, down, { blast: true });
  if (sw.state[0] !== FLUNG || !(sw.vy[0] > 1 && sw.vx[0] > 1)) fail(`scrapper: a survivor isn't flung (state ${sw.state[0]}, vy ${sw.vy[0].toFixed(2)})`);
  console.log(`  scrapper survivor 1.5 m from a 4 m blast: flung ${sw.vx[0].toFixed(1)} out, ${sw.vy[0].toFixed(1)} up`);
}
{
  const s = robots({}, 1), c = robots({ robotMidShare: 1, robotQuadShare: 0, robotMidHp: 5 }, 1), q = robots({ robotMidShare: 1, robotQuadShare: 1, robotQuadHp: 5 }, 1);
  for (const r of [s, c, q]) r.t.splash(new THREE.Vector3(0, 0.2, 0), 6, 400, down, { blast: true });
  const us = s.sw.deathUp[0], uc = c.sw.deathUp[0], uq = q.sw.deathUp[0];
  if (!(us > uc && uc > uq && uq > 0)) fail(`robots: heavier kinds aren't thrown less (scrapper ${us.toFixed(1)}, cutter ${uc.toFixed(1)}, quad ${uq.toFixed(1)})`);
  console.log(`  thrown up at 1 m: scrapper ${us.toFixed(1)}, cutter ${uc.toFixed(1)}, weapon quad ${uq.toFixed(1)} m/s`);
}

// The ragdoll a launch makes leaves the ground.
{
  await initPhysics();
  const phys = new DeathPhysics({ ...DEATH_DEFAULTS, ragdollsPerFrame: 60 }, field);
  phys.follow(0, 0);
  const a = phys.ragdoll(BANDIT_PARTS(0x886644), BANDIT_JOINTS, 0, 0, 0, 0, { x: 0, y: 0, z: 0 }, 1, 0, 10, 0, 11);
  const b = phys.ragdoll(BANDIT_PARTS(0x886644), BANDIT_JOINTS, 0, 0, 10, 0, { x: 0, y: 0, z: 0 }, 1, 0, 3, 0, 0);
  let topA = 0, topB = 0;
  for (let k = 0; k < 90; k++) {
    phys.step(1 / 60);
    topA = Math.max(topA, Math.min(...a.pos.map((p) => p.y)));
    topB = Math.max(topB, Math.min(...b.pos.map((p) => p.y)));
  }
  if (!(topA > 2)) fail(`ragdoll: a launched body's lowest part rose only ${topA.toFixed(2)} m`);
  if (!(a.pos[0].x > 3)) fail(`ragdoll: a launched body didn't fly out (${a.pos[0].x.toFixed(2)} m)`);
  const under = Math.min(...a.pos.map((p) => p.y));
  if (under < -0.5) fail(`ragdoll: a launched body went through the floor (${under.toFixed(2)} m)`);
  console.log(`  ragdoll thrown 10 out, 11 up: whole body ${topA.toFixed(1)} m clear at the top, ${a.pos[0].x.toFixed(1)} m out after 1.5 s; an ordinary kill: ${topB.toFixed(2)} m`);
}

if (problems.length) { console.log("blast launch check FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
console.log("blast launch check passed");
