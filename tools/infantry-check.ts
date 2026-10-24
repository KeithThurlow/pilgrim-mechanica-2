// Headless bandit swarm check: 400 bandits rush a stationary mech over the tall dunes. Fails on NaN, bandits off
// the ground, bandits inside the mech, bandits piled on each other, nobody shooting, a slow update, morale that never
// breaks, and stomps that neither kill nor knock down (or leave them down for good).
// Run: npm test (or npx tsx tools/infantry-check.ts).
import { InfantrySwarm, INFANTRY_DEFAULTS, ADVANCE, FIRING, FLEEING, DOWN, DEAD } from "../src/combat/infantry";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const swarm = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, field, 7);
const target = { x: 0, y: field.height(0, 0) + 3, z: 0, radius: 2.5 };
const dt = 1 / 120;
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };

swarm.spawn(400, 60, 0, 14);
let shots = 0, nan = 0, offGround = 0, maxOff = 0, inside = 0, crowdedWorst = 0, ms = 0;
const steps = 30 * 120;
const live = (s: number) => s < DEAD;

function crowded(): number {
  // Share of live bandits with another live one closer than 0.25 m (via the swarm's hash).
  let n = 0, liveN = 0;
  for (let i = 0; i < swarm.hi; i++) {
    if (!live(swarm.state[i])) continue;
    liveN++;
    let close = false;
    swarm.near(swarm.px[i], swarm.pz[i], 0.25, (j) => {
      if (j !== i && Math.hypot(swarm.px[i] - swarm.px[j], swarm.pz[i] - swarm.pz[j]) < 0.25) close = true;
    });
    if (close) n++;
  }
  return liveN ? n / liveN : 0;
}

for (let s = 0; s < steps; s++) {
  const t0 = performance.now();
  swarm.update(dt, target, () => { shots++; });
  ms += performance.now() - t0;
  for (let i = 0; i < swarm.hi; i++) {
    if (!live(swarm.state[i])) continue;
    const x = swarm.px[i], y = swarm.py[i], z = swarm.pz[i];
    if (!Number.isFinite(x + y + z + swarm.vx[i] + swarm.vz[i] + swarm.heading[i])) { nan++; continue; }
    const off = Math.abs(y - field.height(x, z));
    maxOff = Math.max(maxOff, off);
    if (off > 0.1) offGround++;
    if (Math.hypot(x - target.x, z - target.z) < target.radius) inside++;
  }
  if (s % 60 === 59) crowdedWorst = Math.max(crowdedWorst, crowded());
}
const per = ms / steps;
const states = [0, 0, 0, 0, 0];
for (let i = 0; i < swarm.hi; i++) if (swarm.state[i] <= DEAD) states[swarm.state[i]]++;
let minD = Infinity, maxD = 0;
for (let i = 0; i < swarm.hi; i++) if (swarm.state[i] === FIRING) {
  const d = Math.hypot(swarm.px[i] - target.x, swarm.pz[i] - target.z); minD = Math.min(minD, d); maxD = Math.max(maxD, d);
}
console.log(`rush: 400 bandits, 30 s: ${per.toFixed(3)} ms/step, ${shots} rounds fired, states advance ${states[ADVANCE]} firing ${states[FIRING]} (at ${minD.toFixed(1)}-${maxD.toFixed(1)} m) fleeing ${states[FLEEING]}`);
console.log(`      max off ground ${maxOff.toFixed(4)} m, worst crowding ${(crowdedWorst * 100).toFixed(2)}% within 0.25 m`);
if (nan) fail(`${nan} NaN samples`);
if (offGround) fail(`${offGround} samples more than 0.1 m off the ground (max ${maxOff.toFixed(3)})`);
if (inside) fail(`${inside} samples of a live bandit inside the mech's radius`);
if (crowdedWorst > 0.05) fail(`crowding ${(crowdedWorst * 100).toFixed(1)}% > 5%`);
if (shots === 0) fail("nobody fired");
if (per > 2) fail(`update too slow: ${per.toFixed(3)} ms per step > 2`);

// Morale: gun down 60% fast (2 s), then see who runs.
const liveIdx: number[] = [];
for (let i = 0; i < swarm.hi; i++) if (live(swarm.state[i])) liveIdx.push(i);
const toKill = Math.floor(liveIdx.length * 0.6);
for (let k = liveIdx.length - 1; k > 0; k--) { const j = (k * 7919 + 13) % (k + 1); [liveIdx[k], liveIdx[j]] = [liveIdx[j], liveIdx[k]]; }
let killed = 0;
for (let s = 0; s < 240; s++) {
  const until = Math.round((toKill * (s + 1)) / 240);
  for (; killed < until; killed++) {
    const i = liveIdx[killed];
    swarm.damage(i, 1000, swarm.px[i] - target.x, swarm.pz[i] - target.z);
  }
  swarm.update(dt, target, () => {});
}
let fleeing = 0;
for (let i = 0; i < swarm.hi; i++) if (swarm.state[i] === FLEEING) fleeing++;
console.log(`morale: killed ${killed}, ${swarm.count} left, ${fleeing} fleeing`);
if (fleeing === 0) fail("nobody fled after losing 60%");

// Stomp: a fresh group right next to a foot.
const stompSwarm = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, field, 3);
stompSwarm.spawn(30, 20, 20, 4);
const far = { x: 200, y: 0, z: 200, radius: 2.5 };
stompSwarm.update(dt, far, () => {});
stompSwarm.stomp(20, 20, 3);
let dead = 0, down = 0;
const downIdx: number[] = [];
for (let i = 0; i < stompSwarm.hi; i++) {
  if (stompSwarm.state[i] === DEAD) dead++;
  if (stompSwarm.state[i] === DOWN) { down++; downIdx.push(i); }
}
for (let s = 0; s < 3 * 120; s++) stompSwarm.update(dt, far, () => {});
const stillDown = downIdx.filter((i) => stompSwarm.state[i] === DOWN).length;
console.log(`stomp: ${dead} killed, ${down} knocked down, ${stillDown} still down after 3 s`);
if (dead === 0) fail("stomp killed nobody");
if (down === 0) fail("stomp knocked nobody down");
if (stillDown > 0) fail("downed bandits didn't get up");

// Rays: a ray at a standing bandit's chest hits it.
let hits = 0, tries = 0;
for (let i = 0; i < stompSwarm.hi && tries < 10; i++) {
  if (stompSwarm.state[i] >= DOWN) continue;
  tries++;
  const ox = stompSwarm.px[i] + 10, oy = stompSwarm.py[i] + 3, oz = stompSwarm.pz[i];
  const r = stompSwarm.hitRay(ox, oy, oz, -10, -2, 0, 50);
  if (r) hits++;
}
console.log(`rays: ${hits}/${tries} aimed rays hit a bandit`);
if (tries && hits < tries) fail("aimed rays missed");

if (failed) throw new Error("infantry check failed");
console.log("infantry check passed");
