// Headless allies check (src/summon/allies.ts): the summoner's turret companions and scrap swarm, on the robots' own
// sim, over the tall dunes, with a stand-in battlefield (a real register; rounds and rockets counted, bites real).
// 1. follow: the mech walks a straight line at 6 m/s: companions and scrappers keep up (inside the leash, near on
//    average), stand still once at their spots, and never shoot or bite with nothing to fight.
// 2. engage: robots 14 m ahead: the companions fire rounds and rockets, the swarm bites, robots die.
// 3. send: robots 45 m off (past the guard ring): the swarm sent there reaches them and kills some; recalled, it comes
//    home.
// 4. sprint: the mech runs at 16 m/s: they keep up. 5. hurt: biting robots turn on the swarm and kill some.
// Fails on NaN, falling behind, shooting at nothing, no fire on foes, no kills, a send that never arrives or a swarm
// that never comes home. Prints the numbers. Run: npm test (or npx tsx tools/allies-check.ts).
import * as THREE from "three/webgpu";
import { Allies, ALLY_DEFAULTS, aggroOnAllies } from "../src/summon/allies";
import { splashBlast } from "../src/game/splash";
import { RobotSwarm, ROBOT_DEFAULTS, DEAD } from "../src/combat/robots";
import { RobotTarget } from "../src/combat/robotTarget";
import { Register } from "../src/game/register";
import { enemiesOf } from "../src/game/targeting";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import type { Battlefield, Hittable } from "../src/game/battlefield";
import type { MechUnit } from "../src/game/mechUnit";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const dt = 1 / 60;

// Anything not stood in for is a no-op (dust, marks, sounds).
const noop: unknown = new Proxy(function () {}, { get: () => noop, apply: () => undefined });

function stage() {
  const V = { ...ROBOT_DEFAULTS, ...ALLY_DEFAULTS, compCount: 2, swarmRebuild: 1.5 };
  const register = new Register();
  const counts = { fire: 0, lob: 0 };
  const targets: Hittable[] = [];
  const bf = new Proxy({ register, targets, lookGround: null, canSee: () => true,
    fire: () => { counts.fire++; return 0; }, lob: () => { counts.lob++; return null; } }, {
    get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop),
  }) as unknown as Battlefield;
  const owner = { team: 1, alive: true, lock: null, cursor: null,
    sim: { pos: new THREE.Vector3(0, 0, 0), pelvis: new THREE.Vector3(0, 3, 0), vel: new THREE.Vector3(), heading: 0 } };
  const enemy = new RobotSwarm({ ...ROBOT_DEFAULTS }, field, 4);
  const et = new RobotTarget(enemy, 3);
  targets.push(et);
  register.add(et);
  const allies = new Allies(bf, new THREE.Group(), V, field, owner as unknown as MechUnit, enemiesOf(1));
  const place = (x: number, z: number) => { owner.sim.pos.set(x, field.height(x, z), z); owner.sim.pelvis.set(x, owner.sim.pos.y + 3, z); };
  place(0, 0);
  return { V, register, counts, owner, enemy, et, allies, place, targets };
}

function spread(s: ReturnType<typeof stage>) {
  const sw = s.allies.sw, P = s.owner.sim.pos;
  let worst = 0, sum = 0, n = 0, nan = 0;
  for (let i = 0; i < sw.hi; i++) {
    if (sw.state[i] >= DEAD) continue;
    if (!Number.isFinite(sw.px[i] + sw.pz[i] + sw.hubY[i])) { nan++; continue; }
    const d = Math.hypot(sw.px[i] - P.x, sw.pz[i] - P.z);
    worst = Math.max(worst, d); sum += d; n++;
  }
  return { worst, mean: n ? sum / n : 0, n, nan };
}

// 1. Follow.
{
  const s = stage();
  let worst = 0, meanSum = 0, samples = 0, nan = 0;
  for (let t = 0; t < 40; t += dt) {
    if (t > 10) { const z = (t - 10) * 6; s.place(0, z); s.owner.sim.vel.set(0, 0, 6); }
    s.register.rebuild();
    s.allies.update(dt);
    if (t > 12) { const r = spread(s); worst = Math.max(worst, r.worst); meanSum += r.mean; samples++; nan += r.nan; }
  }
  const mean = meanSum / Math.max(1, samples);
  console.log(`follow: companions ${s.allies.companions}, scrappers ${s.allies.scrappers}, mean from the mech ${mean.toFixed(1)} m, worst ${worst.toFixed(1)} m, rounds ${s.counts.fire}, rockets ${s.counts.lob}`);
  if (nan) fail("follow: NaN");
  if (s.allies.companions !== s.V.compCount) fail("follow: companions missing");
  if (s.allies.scrappers !== s.V.swarmCount) fail("follow: scrappers missing");
  if (worst > s.V.compLeash) fail("follow: an ally fell past the leash");
  if (mean > 14) fail("follow: allies trailing too far on average");
  if (s.counts.fire || s.counts.lob) fail("follow: shooting at nothing");
}

// 2. Engage, and 3. send.
function pack(s: ReturnType<typeof stage>, x: number, z: number, n: number, mid = 0) {
  const made = s.enemy.spawn(n, x, z, 4, { mid, big: 0, quad: 0 });
  for (const i of made) s.enemy.hp[i] *= 4; // tougher, so the fight lasts
  return made;
}
{
  const s = stage();
  for (let t = 0; t < 30; t += dt) { s.register.rebuild(); s.allies.update(dt); }
  pack(s, 0, 14, 10, 0.3);
  const kills0 = s.et.kills;
  for (let t = 0; t < 20; t += dt) { s.register.rebuild(); s.allies.update(dt); }
  const kills = s.et.kills - kills0;
  console.log(`engage: rounds ${s.counts.fire}, rockets ${s.counts.lob}, swarm bites ${s.allies.sw.bites}, robots killed ${kills}/10`);
  if (s.counts.fire < 20) fail("engage: companions' minigun barely fired");
  if (s.counts.lob < 2) fail("engage: companions' rockets never fired");
  if (s.allies.sw.bites < 10) fail("engage: the swarm barely bit");
  if (kills < 3) fail("engage: too few robots killed");
}
{
  const s = stage();
  for (let t = 0; t < 30; t += dt) { s.register.rebuild(); s.allies.update(dt); }
  s.V.compCount = 0;
  pack(s, 30, 34, 8);
  s.allies.sendSwarm(30, 34);
  let arrived = -1;
  const kills0 = s.et.kills;
  for (let t = 0; t < 20; t += dt) {
    s.register.rebuild(); s.allies.update(dt);
    if (arrived < 0) {
      let there = 0;
      const sw = s.allies.sw;
      for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DEAD && sw.kind[i] === 0 && Math.hypot(sw.px[i] - 30, sw.pz[i] - 34) < 10) there++;
      if (there >= s.allies.scrappers * 0.5) arrived = t;
    }
  }
  const kills = s.et.kills - kills0;
  s.allies.recall();
  let home = -1;
  for (let t = 0; t < 20; t += dt) { s.register.rebuild(); s.allies.update(dt); if (home < 0 && spread(s).worst < 14) home = t; }
  console.log(`send: half there after ${arrived.toFixed(1)} s, robots killed ${kills}/8, home ${home.toFixed(1)} s after the recall, mode ${s.allies.mode}`);
  if (arrived < 0 || arrived > 8) fail("send: the swarm never reached the spot");
  if (kills < 2) fail("send: the swarm killed too few");
  if (home < 0) fail("send: the swarm never came home");
}

// 4. Sprint: the mech runs at 16 m/s (its sprint) for 12 s: the swarm and the companions stay with it.
{
  const s = stage();
  for (let t = 0; t < 25; t += dt) { s.register.rebuild(); s.allies.update(dt); }
  let worst = 0, meanSum = 0, samples = 0;
  for (let t = 0; t < 12; t += dt) {
    s.place(0, t * 16); s.owner.sim.vel.set(0, 0, 16);
    s.register.rebuild(); s.allies.update(dt);
    if (t > 3) { const r = spread(s); worst = Math.max(worst, r.worst); meanSum += r.mean; samples++; }
  }
  const mean = meanSum / Math.max(1, samples);
  console.log(`sprint: mean from the mech ${mean.toFixed(1)} m, worst ${worst.toFixed(1)} m (leash ${s.V.compLeash})`);
  if (worst > s.V.compLeash) fail("sprint: an ally fell past the leash");
  if (mean > 18) fail("sprint: allies trailing too far on average");
}

// 5. Enemies hurt allies: a pack of robots that bite, 12 m off the swarm out on a send, turn on it and kill some.
{
  const s = stage();
  s.V.compCount = 0;
  for (let t = 0; t < 30; t += dt) { s.register.rebuild(); s.allies.update(dt); }
  pack(s, 0, 40, 20);
  s.allies.sendSwarm(0, 40);
  const lost0 = s.allies.target.kills, down = new THREE.Vector3(0, -1, 0), at = new THREE.Vector3(), list: number[] = [];
  let enemyBites = 0;
  for (let t = 0; t < 15; t += dt) {
    s.register.rebuild();
    s.allies.update(dt);
    aggroOnAllies(s.enemy, s.allies, s.owner.sim.pos, s.V.allyAggro, s.V.allyAggroShare, list);
    s.enemy.update(dt, { x: 0, y: 3, z: 0, radius: 2 }, () => {}, (i, dmg) => {
      if (!s.enemy.hasT[i]) return;
      enemyBites++;
      splashBlast(s.targets, 3, at.set(s.enemy.px[i], s.enemy.py[i] + 0.4, s.enemy.pz[i]), 1.6, dmg, down);
    });
  }
  const lost = s.allies.target.kills - lost0;
  console.log(`hurt: enemy bites on allies ${enemyBites}, scrappers lost ${lost}`);
  if (enemyBites < 10) fail("hurt: enemies never turned on the swarm");
  if (lost < 1) fail("hurt: the swarm took no losses");
}

if (failed) { console.log("allies check FAILED"); process.exit(1); }
console.log("allies check passed");
