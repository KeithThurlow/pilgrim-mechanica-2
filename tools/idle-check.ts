// Idle flex check (Keith 2026-10-26): with a pilot in and standing still, the legs flex in place now and then. Must:
// flex only with the idle flag; wait at least the first wait (less its randomness); take the set number of steps;
// keep the feet on the spot (no walking off), above the sand and in reach; end with both feet down; and stop the
// moment a move comes in. Rampart legs on flat ground.
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const dt = 1 / 120;
const problems: string[] = [];
const still: MoveCommand = { x: 0, z: 0, sprint: false };

function stand(idle: boolean, seconds: number) {
  const sim = new WalkerSim({ ...v }, flat);
  sim.reset(0, 0, 0);
  for (let i = 0; i < 120 * 2; i++) sim.update(dt, { x: 0, z: 1, sprint: false });
  for (let i = 0; i < 120 * 3; i++) sim.update(dt, still); // stop and settle
  const home = sim.pos.clone();
  let lifts = 0, flexes = 0, firstAt = -1, drift = 0, under = 0, inFlex = false, stepsThis = 0;
  const steps: number[] = [];
  const was = sim.feet.map((f) => f.swinging);
  const misses0 = sim.stats.overreach;
  for (let i = 0; i < 120 * seconds; i++) {
    sim.update(dt, { ...still, idle });
    const t = i * dt;
    if (sim.idleLeft > 0 && !inFlex) { inFlex = true; flexes++; stepsThis = 0; if (firstAt < 0) firstAt = t; }
    sim.feet.forEach((f, k) => {
      if (f.swinging && !was[k]) { lifts++; stepsThis++; }
      was[k] = f.swinging;
      if (f.pos.y < flat.height(f.pos.x, f.pos.z) - 0.02) under++;
    });
    if (inFlex && sim.idleLeft === 0 && !sim.feet[0].swinging && !sim.feet[1].swinging) { inFlex = false; steps.push(stepsThis); }
    drift = Math.max(drift, Math.hypot(sim.pos.x - home.x, sim.pos.z - home.z));
  }
  return { sim, lifts, flexes, firstAt, drift, under, steps, misses: sim.stats.overreach - misses0 };
}

// No pilot: never flexes.
const empty = stand(false, 90);
if (empty.lifts > 0) problems.push(`an empty mech stepped ${empty.lifts} times standing still`);

// A pilot in: flexes after the first wait, again later, each the set number of steps, on the spot.
const p = stand(true, 90);
const minFirst = v.idleAfter * (1 - v.idleJitter) - 0.1;
if (p.flexes < 2) problems.push(`only ${p.flexes} flexes in 90 s standing with a pilot (first after ${v.idleAfter} s, then every ${v.idleEvery} s)`);
if (p.firstAt >= 0 && p.firstAt < minFirst) problems.push(`the first flex came after ${p.firstAt.toFixed(1)} s (at least ${minFirst.toFixed(1)})`);
if (p.steps.some((n) => n !== Math.round(v.idleSteps))) problems.push(`flexes took ${p.steps.join(", ")} steps (want ${Math.round(v.idleSteps)} each)`);
if (p.drift > 0.3) problems.push(`the body wandered ${p.drift.toFixed(2)} m while flexing`);
if (p.under > 0) problems.push(`a foot went under the sand ${p.under} frames while flexing`);
if (p.misses > 0) problems.push(`legs out of reach ${p.misses} frames while flexing`);
if (p.sim.feet.some((f) => f.swinging) && p.sim.idleLeft === 0) problems.push("a flex ended with a foot still in the air");

// A move stops it at once: start a flex, then push the stick.
{
  const sim = new WalkerSim({ ...v, idleAfter: 1, idleJitter: 0 }, flat);
  sim.reset(0, 0, 0);
  let t = 0;
  while (sim.idleLeft === 0 && t < 10) { sim.update(dt, { ...still, idle: true }); t += dt; }
  if (sim.idleLeft === 0) problems.push("no flex started within 10 s at a 1 s wait");
  sim.update(dt, { x: 0, z: 1, sprint: false, idle: true });
  if (sim.idleLeft !== 0 || sim.idleK >= 1) problems.push("a move didn't stop the flex");
}

console.log(`idle: no pilot ${empty.lifts} steps in 90 s · pilot ${p.flexes} flexes (first at ${p.firstAt.toFixed(1)} s, steps ${p.steps.join("/")}) · drift ${p.drift.toFixed(2)} m · under ${p.under} · out of reach ${p.misses}`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("idle check failed"); }
console.log("idle check passed");
