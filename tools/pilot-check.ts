// Headless pilot check (docs/proposal-pilot.md): one focused run of the rules that must never break.
// - On the convoy: the pilot walks a lap (deck, stair up the tail tower, across the footbridge, onto the next car's cab
//   roof and down its stair, and back) again and again for two and a half minutes while the convoy turns hard and
//   changes speed, then wanders at random: he never ends up on the sand, never sinks into a deck or a bridge, never
//   falls, and no NaN.
// - Getting back in needs range (holding F far from the mech does nothing); hopping out needs a fresh press and is
//   refused where the lab says no.
// - The parked mech stays put: knelt on the dunes for a minute, its body and feet don't drift.
// - The pilot on foot is what the robots go for when he's nearer; they kill him, and the expedition is over with the
//   at-risk loot lost (the bank kept).
// Run: npm test (or npx tsx tools/pilot-check.ts).
import * as THREE from "three/webgpu";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS, type Platform } from "../src/convoy/platform";
import { CRANE_DEFAULTS } from "../src/convoy/crane";
import { CARRY_DEFAULTS } from "../src/convoy/carry";
import { DECK_DEFAULTS } from "../src/convoy/deck";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { outside } from "../src/convoy/outline";
import { ConvoyWalkways, WALKWAY_DEFAULTS, platformFrame, deckPlane } from "../src/convoy/walkways";
import { Walkable } from "../src/world/walkable";
import { PilotSim, PILOT_DEFAULTS } from "../src/pilot/pilot";
import { Mount, MOUNT_DEFAULTS } from "../src/pilot/mount";
import { PilotUnit, Quarry, QUARRY_DEFAULTS } from "../src/pilot/quarry";
import { RobotSwarm, ROBOT_DEFAULTS, DOWN, SMALL } from "../src/combat/robots";
import { Expedition, EXPEDITION_DEFAULTS } from "../src/expedition/expedition";
import type { MechUnit } from "../src/game/mechUnit";

const DT = 1 / 120;
const problems: string[] = [];
const fail = (s: string) => { problems.push(s); console.log("  FAIL " + s); };

// 1. Walking the moving convoy.
{
  console.log("-- walking the convoy");
  const V = {
    ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS, ...WALKER_DEFAULTS,
    ...TRAIN_DEFAULTS, ...WALKWAY_DEFAULTS, ...PILOT_DEFAULTS,
  };
  const field = new DuneField(V);
  const route = new ConvoyRoute(V, 13, -40);
  field.modifier = route;
  const convoy = new Convoy(route, V, field);
  convoy.reset(13, -40);
  const walk = new Walkable(field);
  const ways = new ConvoyWalkways(convoy, walk, V);
  ways.update();
  const ps = convoy.platforms, lead = ps[0], next = ps[1];
  const pilot = new PilotSim(V, walk);
  const at = (p: Platform, x: number, z: number) => platformFrame(p).toWorld(x, z, { x: 0, z: 0 });
  { const w = at(lead, 2.5, -14); pilot.place(w.x, deckPlane(lead, w.x, w.z), w.z, lead.heading); }
  if (!pilot.on) fail("placed on the lead deck but standing on the sand");

  // The lap: deck, up the tail stair, the landing, across the bridge, the next car's nose landing, its cab roof, down its stair, its deck; and back.
  const nh = next.spec.length / 2;
  const out: [Platform, number, number][] = [
    [lead, 2.5, -14], [lead, 4.6, -19], [lead, 0.9, -19], [lead, 0, -19], [next, 0, nh - 1], [next, 0, nh - 2.6], [next, 0, nh - 3.7], [next, 0, nh - 7.6], [next, 2, nh - 8.5],
  ];
  const lap = [...out, ...out.slice(0, -1).reverse()];
  let k = 0, laps = 0, wait = 0, worstWait = 0, onBridge = 0, maxUp = 0, onSand = 0, sank = 0, falls = 0, nan = 0, evicted = 0, wanderSteps = 0;
  let lastOn = pilot.on;
  const T = 150, WANDER = 60;
  let wstick = { x: 0, z: 0 }, wclock = 0;
  for (let i = 0; i < Math.round((T + WANDER) / DT); i++) {
    const t = i * DT;
    if (Math.abs(t - 20) < DT / 2) V.convoyHeading = 60;
    if (Math.abs(t - 60) < DT / 2) { V.convoyHeading = -60; V.convoySpeed = 6; }
    if (Math.abs(t - 100) < DT / 2) { V.convoyHeading = 150; V.convoySpeed = 3; }
    if (Math.abs(t - 160) < DT / 2) V.convoyHeading = 40;
    convoy.update(DT);
    ways.update();
    const wasOn = pilot.on;
    pilot.ride();
    if (wasOn?.off) evicted++;
    let stick = { x: 0, z: 0 }, run = false;
    if (t < T) {
      const [p, x, z] = lap[k], w = at(p, x, z), dx = w.x - pilot.pos.x, dz = w.z - pilot.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.25) { k = (k + 1) % lap.length; if (k === 0) laps++; worstWait = Math.max(worstWait, wait); wait = 0; }
      else { stick = { x: dx / d, z: dz / d }; wait += DT; run = d > 3; }
    } else {
      // Wander: a new random direction every 1.5 s, running half the time.
      wclock -= DT;
      if (wclock <= 0) { const a = Math.random() * Math.PI * 2; wstick = { x: Math.sin(a), z: Math.cos(a) }; wclock = 1.5; }
      stick = wstick; run = Math.sin(t) > 0; wanderSteps++;
    }
    pilot.step(DT, stick, run);
    const pos = pilot.pos;
    if (![pos.x, pos.y, pos.z].every(Number.isFinite)) { nan++; break; }
    if (!pilot.on) onSand++;
    if (pilot.vy !== 0) falls++;
    if (pilot.on?.name.startsWith("footbridge")) onBridge++;
    // Never below the deck of the car he's over.
    for (const p of ps) {
      const l = p.toLocal(pos.x, pos.z);
      if (outside(p.outline, l.x, l.z) < -0.2) {
        const dk = deckPlane(p, pos.x, pos.z);
        if (pos.y < dk - 0.05) sank++;
        maxUp = Math.max(maxUp, pos.y - dk);
      }
    }
    if (pilot.on !== lastOn) lastOn = pilot.on;
  }
  console.log(`  ${laps} laps in ${T} s (worst wait at one point ${worstWait.toFixed(1)} s), ${(onBridge * DT).toFixed(1)} s on footbridges, highest ${maxUp.toFixed(2)} m above a deck, ${(wanderSteps * DT).toFixed(0)} s wandering, evicted from a lifted bridge ${evicted}×, steps blocked ${pilot.blocked}`);
  if (nan) fail("NaN in the pilot's position");
  if (onSand) fail(`on the sand for ${(onSand * DT).toFixed(2)} s (walked off a deck or bridge)`);
  if (sank) fail(`below a deck's top for ${sank} steps`);
  if (falls) fail(`falling for ${falls} steps`);
  if (laps < 2) fail(`only ${laps} laps (stuck: a wall, a lifted bridge or a stair he can't climb)`);
  if (onBridge * DT < 2) fail("never walked a footbridge");
  if (maxUp < V.bridgeRise - 0.2) fail(`never got up to the landings (${maxUp.toFixed(2)} m)`);
}

// 2. Getting out and back in.
{
  console.log("-- mounting");
  const m = new Mount({ ...MOUNT_DEFAULTS });
  const run = (s: number, hold: boolean, inRange: boolean, blockOut: string | null = null) => { for (let i = 0; i < s / DT; i++) m.update(DT, { hold, blockOut, knelt: m.kneel >= 0.98, inRange }); };
  run(2, true, false, "not here");
  if (m.state !== "in") fail(`hopped out where the lab said no (${m.state})`);
  run(0.2, false, false);
  run(MOUNT_DEFAULTS.pilotHold + 0.05, true, false);
  if (m.state === "in") fail("holding F didn't start getting out");
  run(3, true, false);
  if (m.state !== "out") fail(`not out after the kneel and the climb (${m.state})`);
  run(3, true, false);
  if (m.state !== "out") fail("climbed straight back in on the same press");
  run(0.2, false, false);
  run(3, true, false);
  if (m.state !== "out") fail("got back in from out of range");
  if (m.why !== "too far from your mech") fail(`no reason shown out of range (${m.why})`);
  run(0.2, false, true);
  run(MOUNT_DEFAULTS.pilotHold + MOUNT_DEFAULTS.pilotClimbTime + 0.1, true, true);
  if (m.state !== "in") fail(`didn't get back in within range (${m.state})`);
  console.log(`  out of range: stays out; in range: back in after ${(MOUNT_DEFAULTS.pilotHold + MOUNT_DEFAULTS.pilotClimbTime).toFixed(1)} s`);
}

// 3. The parked mech stays put (knelt on the dunes, nobody driving).
{
  console.log("-- parked mech");
  const V = { ...TERRAIN_DEFAULTS, ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
  const field = new DuneField(V);
  const sim = new WalkerSim(V, field);
  sim.reset(40, 37, 0.7);
  for (let i = 0; i < 120 * 3; i++) sim.update(DT, { x: 0, z: 0, sprint: false });
  const p0 = sim.pos.clone(), f0 = sim.feet.map((f) => f.planted.clone());
  let worst = 0;
  for (let i = 0; i < 120 * 60; i++) {
    const k = Math.min(1, i / 60);
    sim.crouch = k * MOUNT_DEFAULTS.pilotKneelDrop;
    sim.leanPitch = k * MOUNT_DEFAULTS.pilotKneelPitch * Math.PI / 180;
    sim.update(DT, { x: 0, z: 0, sprint: false });
    worst = Math.max(worst, Math.hypot(sim.pos.x - p0.x, sim.pos.z - p0.z), ...sim.feet.map((f, j) => f.planted.distanceTo(f0[j])));
  }
  const drop = V.hipHeight - (sim.pelvis.y - field.height(sim.pos.x, sim.pos.z));
  console.log(`  a minute knelt: drifted ${worst.toFixed(3)} m, hips down ${drop.toFixed(2)} m`);
  if (worst > 0.05) fail(`the parked mech drifted ${worst.toFixed(3)} m`);
  if (drop < MOUNT_DEFAULTS.pilotKneelDrop * 0.5) fail(`the mech didn't kneel (${drop.toFixed(2)} m)`);
}

// 4. Robots go for the pilot on foot; he dies; the expedition is over with the loot lost.
{
  console.log("-- the pilot killed");
  const V = { ...TERRAIN_DEFAULTS, ...ROBOT_DEFAULTS, ...PILOT_DEFAULTS, ...QUARRY_DEFAULTS, ...EXPEDITION_DEFAULTS };
  const field = new DuneField(V);
  const walk = new Walkable(field);
  const pilot = new PilotSim(V, walk);
  pilot.place(0, field.height(0, 0), 0, 0);
  const unit = new PilotUnit(pilot, V);
  unit.exposed = true;
  // A parked mech 25 m off (a stub: only what Quarry reads).
  const mechSim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, field);
  mechSim.reset(25, 0, 0);
  const mech = { alive: true, sim: mechSim, damage: () => { mechHits++; } } as unknown as MechUnit;
  let mechHits = 0;
  const quarry = new Quarry(mech, unit, V);
  const exp = new Expedition(V);
  exp.launch();
  exp.add({ kind: "scrap", amount: 40, label: "Supply pod" });
  exp.bank.scrap = 100;
  const sw = new RobotSwarm(V, field, 5);
  sw.spawn(10, -30, 10, 5);
  const up = new THREE.Vector3(0, -1, 0), at = new THREE.Vector3(), o = new THREE.Vector3(), d = new THREE.Vector3();
  let t = 0, pilotPicked = 0, frames = 0;
  while (t < 60 && pilot.alive) {
    t += DT; frames++;
    pilot.step(DT, { x: 0, z: 0 }, false);
    quarry.update();
    let cx = 0, cz = 0, n = 0;
    for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DOWN) { cx += sw.px[i]; cz += sw.pz[i]; n++; }
    const prey = quarry.pick(cx / Math.max(1, n), cz / Math.max(1, n));
    if (prey.kind === "pilot") pilotPicked++;
    sw.update(DT, { x: prey.at.x, y: prey.at.y, z: prey.at.z, radius: prey.radius, vx: prey.sim.vel.x, vz: prey.sim.vel.z, latchLow: prey.latchLow, latchHigh: prey.latchHigh },
      (fx, fy, fz, tx, ty, tz, kind) => {
        o.set(fx, fy, fz); d.set(tx - fx, ty - fy, tz - fz).normalize();
        if (unit.hitRay(o, d, 200) >= 0) unit.damage(kind === SMALL ? V.robotShotDamage : V.robotMidShotDamage);
      },
      (_i, damage) => prey.unit.damage(damage, at, up),
      (_i, damage) => prey.unit.damage(damage, at, up));
  }
  if (!pilot.alive) exp.pilotKilled();
  const lostScrap = exp.last?.scrap ?? 0;
  let homes = 0;
  for (let i = 0; i < 15 / DT; i++) if (exp.update(DT, false, false) === "home") homes++;
  console.log(`  went for the pilot ${((100 * pilotPicked) / Math.max(1, frames)).toFixed(0)}% of the time, killed after ${t.toFixed(1)} s (mech hit ${mechHits}×); run ended "${exp.last?.reason}", ${lostScrap} scrap lost, bank ${exp.bank.scrap}, home ${homes}×, now ${exp.state}`);
  if (pilot.alive) fail("the robots never killed the pilot in a minute");
  if (pilotPicked < frames * 0.9) fail("the robots didn't go for the nearer pilot");
  if (exp.last?.reason !== "pilot" || lostScrap !== 40 || exp.atRisk.length) fail(`the expedition didn't end with the loot lost (${JSON.stringify(exp.last)})`);
  if (exp.bank.scrap !== 100) fail("the bank was touched");
  if (homes !== 1 || exp.state !== "aboard") fail(`not home once (${homes}, ${exp.state})`);
}

if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("pilot check failed"); }
console.log("\npilot check passed");
