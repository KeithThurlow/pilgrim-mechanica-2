// Headless helipad airlift check (src/convoy/airlift.ts, Keith 2026-11-01), with the real convoy, crane carry and walker:
// - too little in the bank: refused, nothing paid, the mech stays aboard;
// - a paid trip out: the flat fee once, then the bank ticks down by heliPerKm per km flown (within a scrap), never
//   below zero; the feet never come near the sand while carried; let go on H, the walker lands itself, the
//   expedition starts once (launched) and the mech walks free near where it was let go;
// - the bank running dry mid-flight drops the mech where it is, the bank at 0, never negative;
// - on real dunes the carried feet stay over the sand all the way out.
// Run: npm test (or npx tsx tools/airlift-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS } from "../src/convoy/platform";
import { Crane, CRANE_DEFAULTS } from "../src/convoy/crane";
import { CraneCarry, CARRY_DEFAULTS } from "../src/convoy/carry";
import { DECK_DEFAULTS } from "../src/convoy/deck";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { Airlift, AIRLIFT_DEFAULTS, type AirliftCommand } from "../src/convoy/airlift";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Expedition, EXPEDITION_DEFAULTS } from "../src/expedition/expedition";

const V = {
  ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS, ...TRAIN_DEFAULTS,
  ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...EXPEDITION_DEFAULTS, ...AIRLIFT_DEFAULTS,
};
const FLAT = { ...V, height: 0, swell: 0, bumps: 0 };
const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 40) console.log("  FAIL " + s); problems.push(s); };
const DT = 1 / 120;

function world(vals: typeof V) {
  const field = new DuneField(vals);
  const route = new ConvoyRoute(vals, 0, 0);
  field.modifier = route;
  const convoy = new Convoy(route, vals, field);
  convoy.reset(0, 0);
  const cranes = convoy.bays.map((b) => new Crane(vals, b));
  const carry = new CraneCarry(vals, cranes, field);
  const sim = new WalkerSim(vals, field);
  const lift = new Airlift(vals, convoy.bays[0], field);
  const exp = new Expedition(vals);
  // On the helipad, aboard the lead bay.
  const lead = convoy.bays[0];
  carry.putAboard(sim, cranes[0], lift.padLocal());
  let minClear = Infinity;
  const events: string[] = [];
  const tick = (cmd: AirliftCommand, bank: { scrap: number }) => {
    convoy.update(DT);
    const c = carry.update(DT, sim, { x: 0, z: 0, sprint: false });
    carry.ride(sim);
    const held = lift.step(DT, sim, carry, cmd, bank, true);
    if (c && !held) { sim.update(DT, c); carry.keep(sim); }
    if (lift.state === "fly") for (const f of sim.feet) minClear = Math.min(minClear, f.pos.y - field.height(f.pos.x, f.pos.z));
    const ev = exp.follow(carry.state, carry.attached, true);
    if (ev) events.push(ev);
  };
  // Out to the left of the convoy.
  const side = { x: Math.cos(lead.heading), z: -Math.sin(lead.heading) };
  return { field, convoy, carry, sim, lift, exp, tick, side, events, clear: () => minClear };
}

// ---- 1. refused: not enough in the bank ----
{
  const w = world(FLAT);
  const bank = { scrap: V.heliBase - 1 };
  for (let t = 0; t < 3; t += DT) w.tick({ x: 0, z: 0, call: true }, bank);
  const ev = w.lift.events.map((e) => e.type).join();
  if (ev !== "refused") fail(`short bank: events ${ev}`);
  if (bank.scrap !== V.heliBase - 1) fail(`short bank: paid ${V.heliBase - 1 - bank.scrap}`);
  if (w.carry.state !== "aboard") fail(`short bank: mech ${w.carry.state}`);
  console.log(`refused with ${bank.scrap} in the bank (fee ${V.heliBase}): nothing paid, still aboard`);
}

// ---- 2. a paid trip 600 m out ----
{
  const w = world(FLAT);
  const bank = { scrap: 500 };
  const OUT = 600;
  let t = 0, minBank = Infinity, flown = 0;
  while (w.lift.state !== "leave" && t < 120) {
    w.tick(Airlift.autopilot(w.lift, OUT, w.side), bank);
    minBank = Math.min(minBank, bank.scrap);
    t += DT;
  }
  const dropped = w.lift.events.find((e) => e.type === "dropped");
  if (!dropped || dropped.type !== "dropped") fail(`trip: never dropped (state ${w.lift.state} after ${t.toFixed(0)} s)`);
  else {
    flown = dropped.km;
    const want = V.heliBase + flown * V.heliPerKm, paid = 500 - bank.scrap;
    if (Math.abs(paid - want) > 1.01) fail(`trip: paid ${paid}, expected ${want.toFixed(1)} (${V.heliBase} + ${flown.toFixed(3)} km × ${V.heliPerKm})`);
    if (paid !== dropped.paid) fail(`trip: event says ${dropped.paid} paid, bank lost ${paid}`);
  }
  if (w.clear() < 1) fail(`trip: carried feet came within ${w.clear().toFixed(2)} m of the sand`);
  // Let the walker land and walk free.
  for (let k = 0; k < 6 / DT && w.carry.state !== "walking"; k++) { w.tick({ x: 0, z: 0, call: false }, bank); t += DT; }
  if (w.carry.state !== "walking") fail(`trip: after the drop the mech is ${w.carry.state}`);
  if (w.events.join() !== "launched") fail(`trip: expedition events ${w.events.join()}`);
  if (w.exp.state !== "out") fail(`trip: expedition ${w.exp.state}`);
  const off = Math.hypot(w.sim.pos.x - w.lift.dropAt.x, w.sim.pos.z - w.lift.dropAt.z);
  if (off > 6) fail(`trip: landed ${off.toFixed(1)} m from where it was let go`);
  const lead = w.convoy.bays[0], fromConvoy = Math.hypot(w.sim.pos.x - lead.x, w.sim.pos.z - lead.z);
  if (fromConvoy < OUT - 80) fail(`trip: only ${fromConvoy.toFixed(0)} m from the convoy`);
  if (minBank < 0) fail(`trip: bank went to ${minBank}`);
  console.log(`trip: ${flown.toFixed(2)} km flown in ${t.toFixed(1)} s, landed at ${w.carry.lastLanding.speed.toFixed(1)} m/s, paid ${500 - bank.scrap} (${V.heliBase} + ${V.heliPerKm}/km), feet at least ${w.clear().toFixed(1)} m over the sand, landed ${off.toFixed(1)} m from the drop, ${fromConvoy.toFixed(0)} m from the lead bay, expedition ${w.exp.state}`);
}

// ---- 3. the bank runs dry mid-flight ----
{
  const w = world(FLAT);
  const bank = { scrap: V.heliBase + 5 };
  let t = 0, minBank = Infinity;
  while (w.lift.state !== "leave" && t < 120) { w.tick(Airlift.autopilot(w.lift, 5000, w.side), bank); minBank = Math.min(minBank, bank.scrap); t += DT; }
  const types = w.lift.events.map((e) => e.type).join();
  if (types !== "called,dry,dropped") fail(`dry: events ${types}`);
  if (bank.scrap < 0 || minBank < 0) fail(`dry: bank went to ${minBank}`);
  if (bank.scrap >= 1) fail(`dry: dropped with ${bank.scrap} left`);
  for (let k = 0; k < 6 / DT && w.carry.state !== "walking"; k++) w.tick({ x: 0, z: 0, call: false }, bank);
  if (w.exp.state !== "out") fail(`dry: expedition ${w.exp.state}`);
  console.log(`dry: ${V.heliBase + 5} in the bank bought ${(w.lift.km * 1000).toFixed(0)} m, dropped there, bank ${bank.scrap}`);
}

// ---- 4. on real dunes the carried feet stay clear ----
{
  const w = world(V);
  const bank = { scrap: 2000 };
  let t = 0;
  while (w.lift.state !== "leave" && t < 200) { w.tick(Airlift.autopilot(w.lift, 1500, w.side), bank); t += DT; }
  if (w.lift.state !== "leave") fail(`dunes: never dropped (${w.lift.state})`);
  if (w.clear() < 1) fail(`dunes: carried feet came within ${w.clear().toFixed(2)} m of the sand`);
  for (let k = 0; k < 6 / DT && w.carry.state !== "walking"; k++) w.tick({ x: 0, z: 0, call: false }, bank);
  if (w.carry.state !== "walking") fail(`dunes: after the drop the mech is ${w.carry.state}`);
  console.log(`dunes: 1.5 km out, feet at least ${w.clear().toFixed(1)} m over the sand, mech ${w.carry.state}`);
}

if (problems.length) { console.log(`airlift check: ${problems.length} problem(s)`); process.exit(1); }
console.log("airlift check: ok");
