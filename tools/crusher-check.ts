// Headless crusher check (src/combat/crusher.ts): the heavy crab quad. Four runs over the tall dunes:
// 1. eat: no prey in reach, heaps of salvage round it: it walks to them and eats them, healing.
// 2. hunt: the prey stands still ahead: it closes, spins up, sucks the prey in (the pull applied) and grinds it.
// 3. escape: the prey sprints straight away from 8 m off the maw while it sucks: it must get clear.
// 4. pincers: the prey stands off to its side, inside the pincers' reach and outside the maw's cone: a snap that hits.
// Fails on NaN, legs out of reach, planted feet off the sand, the body sagging or floating, no footfalls, no eating or
// no heal, no suck or no grind, a pull that a sprint can't beat, no pincer hit, or two runs with the same seed
// differing. Prints the numbers. Run: npm test (or npx tsx tools/crusher-check.ts).
import { Crushers, CRUSHER_DEFAULTS, CRUSHER_SPEC, SUCK, type CrusherEvent, type CrusherFood } from "../src/combat/crusher";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const dt = 1 / 60;
const v = { ...CRUSHER_DEFAULTS };
const P = { x: 0, y: 0, z: 0 }, K = { x: 0, y: 0, z: 0 }, T = { x: 0, y: 0, z: 0 }, F = { x: 0, y: 0, z: 0 };

interface Stats { nan: number; reach: number; footOff: number; footWorst: number; low: number; high: number; falls: number; samples: number }
const stats: Stats = { nan: 0, reach: 0, footOff: 0, footWorst: 0, low: 1e9, high: 0, falls: 0, samples: 0 };

function watch(pack: Crushers) {
  const c = pack.list[0];
  if (!Number.isFinite(c.x + c.z + c.bodyY + c.heading)) { stats.nan++; return; }
  stats.samples++;
  const lift = c.bodyY - field.height(c.x, c.z);
  stats.low = Math.min(stats.low, lift); stats.high = Math.max(stats.high, lift);
  const L = (CRUSHER_SPEC.L1 + CRUSHER_SPEC.L2) * c.H;
  for (let k = 0; k < 4; k++) {
    c.leg(k, P, K, T, F);
    if (Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z) > L * 1.005) stats.reach++;
    if (c.stepT[k] < 0) {
      const off = Math.abs(c.footY[k] - field.height(c.footX[k], c.footZ[k]));
      stats.footWorst = Math.max(stats.footWorst, off);
      if (off > 0.3) stats.footOff++;
    }
  }
}

function eatRun(seed: number) {
  const pack = new Crushers(v, field, seed);
  const c = pack.spawn(60, 40, 0);
  const food: CrusherFood[] = [];
  for (let k = 0; k < 5; k++) { const a = k * 1.3, x = 60 + Math.sin(a) * (20 + k * 4), z = 40 + Math.cos(a) * (20 + k * 4); food.push({ id: k, x, y: field.height(x, z), z }); }
  const log: string[] = [];
  pack.onEvent = (e) => {
    if (e.type === "footfall") stats.falls++;
    if (e.type === "ate") { const i = food.findIndex((f) => f.id === e.food); if (i >= 0) food.splice(i, 1); }
    if (e.type !== "footfall") log.push(`${e.type}:${c.x.toFixed(3)}`);
  };
  pack.hit(c, 1500);
  const hp0 = c.health;
  const prey = { x: 900, y: 0, z: 900, vx: 0, vz: 0, alive: true };
  for (let t = 0; t < 60; t += dt) { pack.update(dt, prey, food); watch(pack); }
  return { pack, c, hp0, log, left: food.length };
}

const e1 = eatRun(3);
console.log(`eat: ${e1.pack.eaten} heaps eaten in 60 s (${e1.left} left) · health ${e1.hp0} → ${e1.c.health}`);
if (e1.pack.eaten < 2) fail(`only ${e1.pack.eaten} heaps eaten`);
if (e1.c.health <= e1.hp0) fail("eating didn't heal it");

// 2. Hunt: the prey stands 22 m ahead; the pull moves it.
{
  const pack = new Crushers(v, field, 5);
  const c = pack.spawn(0, 0, 0);
  const prey = { x: 1.5, y: 0, z: 26, vx: 0, vz: 0, alive: true };
  let firstSuck = -1, minMaw = 1e9, ground = 0;
  const M = { x: 0, y: 0, z: 0 };
  pack.onEvent = (e: CrusherEvent) => { if (e.type === "footfall") stats.falls++; if (e.type === "grind") ground += e.damage; };
  for (let t = 0; t < 25; t += dt) {
    prey.y = field.height(prey.x, prey.z) + 2;
    pack.update(dt, prey, []);
    watch(pack);
    if (c.mode === SUCK && firstSuck < 0) firstSuck = t;
    prey.x += c.pullX * dt; prey.z += c.pullZ * dt;
    c.maw(M);
    minMaw = Math.min(minMaw, Math.hypot(prey.x - M.x, prey.z - M.z));
  }
  console.log(`hunt: sucking from ${firstSuck.toFixed(1)} s · prey pulled to ${minMaw.toFixed(1)} m of the maw · ground ${ground.toFixed(0)} hp · sucks ${pack.sucks} · snaps ${pack.claws} (${pack.clawHits} hit)`);
  if (firstSuck < 0) fail("never sucked");
  if (minMaw > v.crusherGrindReach) fail(`prey never reached the lip (${minMaw.toFixed(1)} m)`);
  if (ground <= 0) fail("no grind damage");
  if (minMaw < 0.5) fail(`prey pulled through the maw (${minMaw.toFixed(2)} m)`);
}

// 3. Escape: sucking, the prey 8 m off the maw sprints straight away (8.5 m/s, the mech's sprint).
{
  const pack = new Crushers(v, field, 6);
  const c = pack.spawn(0, 0, 0);
  const M = c.maw();
  const prey = { x: M.x, y: 0, z: M.z + 8, vx: 0, vz: 8.5, alive: true };
  c.mode = SUCK; c.modeT = 0;
  let worst = 1e9, d = 0;
  for (let t = 0; t < v.crusherSuckTime; t += dt) {
    pack.update(dt, prey, []);
    prey.z += (8.5 + c.pullZ) * dt; prey.x += c.pullX * dt;
    c.maw(M); d = Math.hypot(prey.x - M.x, prey.z - M.z); worst = Math.min(worst, d);
  }
  console.log(`escape: a sprint from 8 m gets ${d.toFixed(1)} m clear in ${v.crusherSuckTime} s (closest ${worst.toFixed(1)} m)`);
  if (d < v.crusherSuckRange) fail(`a sprint didn't get out of the suck (${d.toFixed(1)} m)`);
}

// 4. Pincers: the prey 7 m off the front, 55° to its left (outside the cone), the maw resting.
{
  const pack = new Crushers(v, field, 7);
  const c = pack.spawn(0, 0, 0);
  const M = c.maw();
  const a = 55 * Math.PI / 180;
  const prey = { x: M.x + Math.sin(a) * 6, y: 0, z: M.z + Math.cos(a) * 6, vx: 0, vz: 0, alive: true };
  let hit = 0;
  pack.onEvent = (e) => { if (e.type === "claw" && e.hit) hit++; };
  // Keep it out of the suck to test the pincers alone.
  v.crusherSuckEvery = 1e9;
  (c as unknown as { suckClock: number }).suckClock = 1e9;
  for (let t = 0; t < 6; t += dt) { prey.y = field.height(prey.x, prey.z) + 2; pack.update(dt, prey, []); }
  v.crusherSuckEvery = CRUSHER_DEFAULTS.crusherSuckEvery;
  console.log(`pincers: ${pack.claws} snaps, ${hit} hit`);
  if (hit < 1) fail("no pincer hit on a prey beside the maw");
  // Kill: once.
  pack.hit(c, c.health + 1); pack.hit(c, 100);
  if (c.alive || pack.kills !== 1) fail(`kill: alive ${c.alive}, kills ${pack.kills}`);
}

console.log(`legs: body ${stats.low.toFixed(2)}–${stats.high.toFixed(2)} m over the sand (height ${v.crusherHeight}) · planted foot worst ${stats.footWorst.toFixed(2)} m · footfalls ${stats.falls}`);
if (stats.nan) fail("NaN");
if (stats.reach) fail(`legs out of reach on ${stats.reach} samples`);
if (stats.footOff > stats.samples * 4 * 0.01) fail(`planted feet off the sand on ${stats.footOff} samples (worst ${stats.footWorst.toFixed(2)} m)`);
if (stats.low < v.crusherHeight * 0.6) fail(`body sags to ${stats.low.toFixed(2)} m`);
if (stats.high > v.crusherHeight * 1.6) fail(`body floats at ${stats.high.toFixed(2)} m`);
if (stats.falls < 20) fail(`only ${stats.falls} footfalls`);
const e2 = eatRun(3);
{ const k = e1.log.findIndex((x, i) => x !== e2.log[i]); if (k >= 0 || e1.log.length !== e2.log.length) fail(`same seed differs at event ${k}`); }
if (failed) { console.log("crusher check FAILED"); process.exit(1); }
console.log("crusher check passed");
