// Headless check of the big walkers' weak points (Keith 2026-11-06; src/combat/robotWeakPoints.ts): rounds at each
// leg hit that leg (and only it), a leg shot through breaks (its shin no longer hittable, the walker slower), two gone
// fell it and its reactor goes up as it tips; a round from the mech's height at the reactor strikes the reactor (not
// the disc in front of it), counts more than a body hit, and a kill through it goes up at once, standing (an airburst
// at full height); a round at the body's centre never strikes the reactor; blasts at the feet wear the legs; the
// cursor's ray on a leg or the reactor gives the guns that part's point. Run: npm test (or npx tsx tools/robotweak-check.ts).
import * as THREE from "three/webgpu";
import { RobotSwarm, ROBOT_DEFAULTS, DEAD, BIG, PART_BODY, PART_CORE, robotCentre } from "../src/combat/robots";
import { RobotTarget } from "../src/combat/robotTarget";
import { WALK_LEGS, type V3 } from "../src/combat/robotLegs";
import { BIG_CORE_Y } from "../src/combat/robotWeakPoints";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { makeSheet } from "../src/game/sheetFire";
import { PEN_DEFAULTS, type SheetHit } from "../src/game/sheet";
import { MECH_DEFAULTS } from "../src/game/mechUnit";
import { railSheet } from "../src/weapons/rail";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const dt = 1 / 120;
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const v3 = (): V3 => ({ x: 0, y: 0, z: 0 });
const hip = v3(), knee = v3(), tip = v3(), foot = v3();
const far = { x: 900, y: 0, z: 900, radius: 2 };
const big = (seed: number, o: Partial<typeof ROBOT_DEFAULTS> = {}) => {
  const sw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotQuadShare: 0, robotBigShare: 1, robotPulseFirst: 99, robotBeamFirst: 99, ...o }, field, seed);
  sw.spawn(1, 40, 40, 0);
  sw.update(dt, far, () => {});
  if (sw.kind[0] !== BIG) fail("spawned something other than a big one");
  return sw;
};
const at = new THREE.Vector3(), dir = new THREE.Vector3();
/** A round from 20 m off, at the mech's gun height (4 m up), straight at (x, y, z), through the battlefield's target. */
function shoot(sw: RobotSwarm, t: RobotTarget, x: number, y: number, z: number, dmg: number, side = 1) {
  const ox = x + 20 * side, oz = z + 3, oy = field.height(ox, oz) + 4;
  const o = new THREE.Vector3(ox, oy, oz), d = new THREE.Vector3(x - ox, y - oy, z - oz).normalize();
  const dist = t.hitRay(o, d, 200);
  if (dist < 0) return null;
  const h = sw.hitRay(ox, oy, oz, d.x, d.y, d.z, 200);
  at.copy(o).addScaledVector(d, dist); dir.copy(d);
  t.damage(dmg, at, dir);
  return h;
}
const mid = (a: V3, b: V3, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

// Each leg: a round at its shin hits that leg.
{
  const sw = big(3), t = new RobotTarget(sw, 3);
  let wrong = 0;
  for (let g = 0; g < WALK_LEGS; g++) {
    sw.legPose(0, g, hip, knee, tip, foot);
    const p = mid(knee, tip, 0.7);
    const side = p.x >= sw.px[0] ? 1 : -1;
    const h = shoot(sw, t, p.x, p.y, p.z, 0, side);
    if (!h || h.legNo !== g) wrong++;
  }
  console.log(`legs: ${WALK_LEGS - wrong} of ${WALK_LEGS} rounds at a shin hit that leg`);
  if (wrong) fail(`${wrong} rounds at a shin didn't hit that leg`);
}

// A leg shot through: broken, its shin gone, slower; a second fells it and the reactor goes up as it falls.
{
  const sw = big(4), t = new RobotTarget(sw, 3), v = sw.v;
  const legHp = sw.legHp[0], hp0 = sw.hp[0];
  let lost = 0, fellEvent = false;
  sw.onLegLost = (e) => { lost++; fellEvent ||= e.fell; };
  sw.legPose(0, 0, hip, knee, tip, foot);
  const p = mid(knee, tip, 0.7), side = p.x >= sw.px[0] ? 1 : -1;
  let rounds = 0;
  while (!(sw.legLost[0] & 1) && rounds < 500 && sw.state[0] < DEAD) { shoot(sw, t, p.x, p.y, p.z, 40, side); rounds++; }
  const bodyLoss = (hp0 - sw.hp[0]) / hp0;
  console.log(`leg 0: ${Math.round(legHp)} hp, shot through in ${rounds} rounds of 40; the walker lost ${(bodyLoss * 100).toFixed(0)}% of its health`);
  if (!(sw.legLost[0] & 1) || lost !== 1) fail("leg 0 wasn't shot through");
  if (sw.state[0] >= DEAD) fail("one leg gone killed it");
  // Its shin is gone: the same round now passes (or hits something else).
  const h = sw.hitRay(p.x + 20 * side, p.y, p.z + 3, -20 * side, 0, -3, 200);
  if (h && h.legNo === 0 && h.part !== PART_BODY) fail("a round still hit leg 0's shin after it broke");
  // Slower: walk it at the mech for 6 s against an untouched one.
  const walk = (s: RobotSwarm) => { const x0 = s.px[0], z0 = s.pz[0], m = { x: s.px[0] + 200, y: 0, z: s.pz[0], radius: 2 }; for (let k = 0; k < 6 * 120; k++) s.update(dt, m, () => {}); return Math.hypot(s.px[0] - x0, s.pz[0] - z0); };
  const limp = walk(sw), sound = walk(big(4));
  console.log(`      limping it walked ${limp.toFixed(1)} m in 6 s, a sound one ${sound.toFixed(1)} m (want about ×${v.robotBigLegSlow})`);
  if (!(limp < sound * (v.robotBigLegSlow + 0.15))) fail("a walker with a leg gone isn't slower");
  // A second leg: it falls, and its reactor queues to go up as it tips.
  sw.legPose(0, 2, hip, knee, tip, foot);
  const p2 = mid(knee, tip, 0.7), s2 = p2.x >= sw.px[0] ? 1 : -1;
  rounds = 0;
  while (sw.state[0] < DEAD && rounds < 500) { shoot(sw, t, p2.x, p2.y, p2.z, 40, s2); rounds++; }
  console.log(`      a second leg: down after ${rounds} more rounds (${lost} legs lost${fellEvent ? ", it fell" : ""}), ${sw.cores.length} reactor counting down`);
  if (sw.state[0] < DEAD) fail("two legs gone didn't fell it");
  if (!fellEvent) fail("the leg-lost event didn't say it fell");
  if (sw.cores.length !== 1 || sw.cores[0].delay !== v.robotBigDeathDelay) fail("a walker felled by its legs didn't queue its tipping reactor");
}

// The reactor: hit from the mech's height (through the disc's rim), more than the body, and a kill through it goes up
// at once while still standing.
{
  const sw = big(5), t = new RobotTarget(sw, 3), v = sw.v;
  const cy = sw.hubY[0] + sw.size[0] * BIG_CORE_Y;
  const h0 = sw.hp[0];
  const h = shoot(sw, t, sw.px[0], cy, sw.pz[0], 50);
  const coreTook = h0 - sw.hp[0];
  const c = v3(); robotCentre(sw, 0, c);
  const h1 = sw.hp[0];
  const hb = shoot(sw, t, c.x, c.y, c.z, 50);
  const bodyTook = h1 - sw.hp[0];
  console.log(`reactor: a round at it from 4 m up ${h ? (h.part === PART_CORE ? "hits the reactor" : `hits part ${h.part}`) : "misses"} (${coreTook.toFixed(1)} damage), at the body's centre ${hb ? (hb.part === PART_CORE ? "hits the reactor" : "hits the body") : "misses"} (${bodyTook.toFixed(1)})`);
  if (!h || h.part !== PART_CORE) fail("a round at the reactor from the mech's height didn't hit it");
  if (!hb || hb.part === PART_CORE) fail("a round at the body's centre struck the reactor");
  if (!(coreTook > bodyTook * 1.5)) fail("a reactor hit doesn't count much more than a body hit");
  // Rounds from every side at the body's centre never touch the reactor.
  let grazed = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, R = 10 + (k % 4) * 12;
    const ox = c.x + Math.sin(a) * R, oz = c.z + Math.cos(a) * R, oy = field.height(ox, oz) + 4;
    const r = sw.hitRay(ox, oy, oz, c.x - ox, c.y - oy, c.z - oz, 200);
    if (r && r.part === PART_CORE) grazed++;
  }
  if (grazed) fail(`${grazed} of 24 rounds at the body's centre struck the reactor`);
  // Kill through it: goes up within the breach time, high up.
  let blastT = -1, air = 0, time = 0;
  sw.onDeathBlast = (e) => { if (blastT < 0) { blastT = time; air = e.hubY - e.at.y; } };
  while (sw.state[0] < DEAD) shoot(sw, t, sw.px[0], cy, sw.pz[0], 400);
  for (let s = 0; s < 3 * 120 && blastT < 0; s++) { sw.update(dt, far, () => {}); time += dt; }
  const standing = sw.heightOf(0);
  console.log(`      killed through it: went up after ${blastT.toFixed(2)} s, ${air.toFixed(1)} m up (standing ${standing.toFixed(1)} m)`);
  if (blastT < 0) fail("a kill through the reactor never went up");
  else {
    if (blastT > v.robotBigCoreBreach + 0.05) fail("a breached reactor took longer than the breach time");
    if (air < standing * 0.85) fail("a breached reactor went up after it had fallen, not standing");
  }
}

// The player's rounds as sheets (src/game/sheet.ts): one aimed at the reactor strikes it, one at the body the body.
{
  const sw = big(8), t = new RobotTarget(sw, 3), M = MECH_DEFAULTS;
  const cy = sw.hubY[0] + sw.size[0] * BIG_CORE_Y, c = v3(); robotCentre(sw, 0, c);
  const sheetAt = (x: number, y: number, z: number) => {
    const ox = x + 20, oz = z + 3, muzzle = new THREE.Vector3(ox, field.height(ox, oz) + 4, oz);
    const aim = new THREE.Vector3(x, y, z), d = aim.clone().sub(muzzle).normalize();
    const sh = makeSheet(field, muzzle, d, 60, { half: M.roundSheetHalf * 1.5, height: M.roundSheetHeight, line: M.roundLine, pen: 1e4, aim }, PEN_DEFAULTS);
    const out: SheetHit<unknown>[] = [];
    t.sheet(sh, out as never);
    return out.length ? out[0].key & 3 : -1;
  };
  const pc = sheetAt(sw.px[0], cy, sw.pz[0]), pb = sheetAt(c.x, c.y, c.z);
  console.log(`sheets: a round at the reactor strikes part ${pc}, at the body part ${pb} (reactor ${PART_CORE}, body ${PART_BODY})`);
  if (pc !== PART_CORE) fail("a round (sheet) at the reactor didn't strike it");
  if (pb !== PART_BODY) fail("a round (sheet) at the body's centre didn't strike the body");
}

// The rail (Keith 2026-11-07): flat as ever at the sand or the body, but aimed up at the reactor it climbs to it.
{
  const sw = big(9), t = new RobotTarget(sw, 3), W = WEAPON_DEFAULTS;
  const cy = sw.hubY[0] + sw.size[0] * BIG_CORE_Y, c = v3(); robotCentre(sw, 0, c);
  const st = { damage: 100, charge: 1, cooldown: 1, range: W.railRange, pen: 1e4 };
  const railAt = (x: number, y: number, z: number, dist = 30) => {
    const ox = x + dist, oz = z + 3, muzzle = new THREE.Vector3(ox, field.height(ox, oz) + 4, oz);
    const aim = { x, y, z }, d = new THREE.Vector3(x - ox, 0, z - oz).normalize();
    const sh = makeSheet(field, muzzle, d, W.railRange, railSheet(W, st, aim), PEN_DEFAULTS);
    const out: SheetHit<unknown>[] = [];
    t.sheet(sh, out as never);
    return { part: out.length ? out[0].key & 3 : -1, lineAtAim: sh.line!(Math.hypot(x - ox, z - oz)) - field.height(x, z) };
  };
  const core = railAt(sw.px[0], cy, sw.pz[0]), body = railAt(c.x, c.y, c.z), sand = railAt(c.x, field.height(c.x, c.z) + 1, c.z);
  const coreFar = railAt(sw.px[0], cy, sw.pz[0], 60);
  console.log(`rail: at the reactor strikes part ${core.part} (slug ${core.lineAtAim.toFixed(1)} m up there; from 60 m part ${coreFar.part}), at the body part ${body.part}, at the sand the slug flies ${sand.lineAtAim.toFixed(1)} m up`);
  if (core.part !== PART_CORE || coreFar.part !== PART_CORE) fail("the rail aimed at the reactor didn't strike it");
  if (body.part !== PART_BODY) fail("the rail aimed at the body didn't strike the body");
  if (Math.abs(sand.lineAtAim - W.railSlugHeight) > 0.01) fail("the rail aimed at the sand no longer flies flat at its slug height");
}

// Blasts at its feet wear the legs down.
{
  const sw = big(6), t = new RobotTarget(sw, 3);
  sw.legPose(0, 1, hip, knee, tip, foot);
  const l0 = sw.legHp[1];
  t.splash(new THREE.Vector3(foot.x, foot.y, foot.z), 3, 200, new THREE.Vector3(1, 0, 0), { blast: true });
  console.log(`blast: one of 200 at leg 1's foot took its leg from ${Math.round(l0)} to ${Math.round(sw.legHp[1])} hp`);
  if (!(sw.legHp[1] < l0)) fail("a blast at a foot didn't hurt that leg");
}

// The cursor's ray from above on a leg or the reactor gives that part's point to aim at; on the disc, the centre.
{
  const sw = big(7), t = new RobotTarget(sw, 3), out = v3();
  const cy = sw.hubY[0] + sw.size[0] * BIG_CORE_Y;
  const cam = (x: number, y: number, z: number) => { const ox = x, oy = y + 40, oz = z - 33, l = Math.hypot(x - ox, y - oy, z - oz); return t.aimPart(sw.uid[0], ox, oy, oz, (x - ox) / l, (y - oy) / l, (z - oz) / l, out); };
  const onCore = cam(sw.px[0], cy, sw.pz[0]);
  const coreOk = onCore && Math.abs(out.y - cy) < 0.01;
  sw.legPose(0, 3, hip, knee, tip, foot);
  const p = mid(knee, tip, 0.8);
  const onLeg = cam(p.x, p.y, p.z);
  const legOk = onLeg && Math.hypot(out.x - p.x, out.y - p.y, out.z - p.z) < 2.5;
  const c = v3(); robotCentre(sw, 0, c);
  const onDisc = cam(c.x + sw.size[0] * 0.3, sw.hubY[0], c.z);
  console.log(`aim: the cursor on the reactor ${coreOk ? "aims at it" : "doesn't"}, on a shin ${legOk ? "aims at it" : "doesn't"}, on the disc ${onDisc ? "aims at a part" : "aims at the centre"}`);
  if (!coreOk) fail("the cursor on the reactor didn't aim the guns at it");
  if (!legOk) fail("the cursor on a shin didn't aim the guns at it");
}

console.log(failed ? "robot weak points: FAILED" : "robot weak points: ok");
if (failed) process.exit(1);
