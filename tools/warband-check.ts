// Headless war band check: a band rolls in over the tall dunes and works a stationary mech. Fails on: NaN; a live
// vehicle tipped more than 60° off the ground under it (it should never flip while driving); nobody firing; nobody making a gun run
// (coming inside 14 m); most of the band not circling in its band; a killed vehicle not settling above the sand;
// no next band after the first is beaten; a vehicle driving into the mech (centres inside 3.5 m). Then (Keith 2026-10-29)
// no tanks in a war band (a turret truck instead), and the party bus: it drops bandits into the infantry swarm in
// waves, never has more of its own alive than its cap, gives each a stable id, and drops nobody once it's destroyed.
// Run: npm test (or npx tsx tools/warband-check.ts).
import * as THREE from "three/webgpu";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { DustSim, DUST_DEFAULTS } from "../src/fx/dust";
import { Warband, WARBAND_DEFAULTS } from "../src/combat/warband";
import type { Battlefield, Hittable } from "../src/game/battlefield";
import type { MechUnit } from "../src/game/mechUnit";
import { InfantrySwarm, INFANTRY_DEFAULTS, DEAD } from "../src/combat/infantry";
import { columnKinds } from "../src/expedition/warColumns";

// Repeatable: the war band's randomness (spawn spread, circling side, gun spread) from a seeded generator.
let seed = 12345;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const field = new DuneField({ ...TERRAIN_DEFAULTS });
let shots = 0, lobs = 0;
const targets: Hittable[] = [];
// A stand-in battlefield: real ground and dust, rounds counted, marks and sound ignored.
const bf = {
  field,
  targets,
  dust: new DustSim({ ...DUST_DEFAULTS }, field),
  marks: { rut() {}, crater() {}, print() {} },
  sfx: { play() {} },
  fire() { shots++; return null; },
  lob() { shots++; lobs++; return null; },
  gunFx: { shot() {} },
  canSee() { return true; },
  dent() { return false; },
} as unknown as Battlefield;
const pelvis = new THREE.Vector3(0, field.height(0, 0) + 3, 0);
const player = { sim: { pelvis, pos: pelvis.clone().setY(field.height(0, 0)), vel: new THREE.Vector3() }, alive: true } as unknown as MechUnit;

const v = { ...WARBAND_DEFAULTS, bandMechs: 0 };
const wb = new Warband(bf, v, null);
const riders = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, field, 3);
wb.riders = riders;
let capBreaks = 0, dropsSeen = 0, maxOwn = 0;
const riderIds = new Set<string>();
wb.onDrop = (bus, slots) => { dropsSeen++; if (bus.kind !== "partyBus") capBreaks++; void slots; };
const dt = 1 / 60;
let nan = 0, flipped = 0, closest = Infinity, inBand = 0, samples = 0;
for (let i = 0; i < 60 * 60; i++) {
  wb.update(dt, player);
  bf.dust.update(dt);
  riders.update(dt, { x: pelvis.x, y: pelvis.y, z: pelvis.z, radius: 3 }, () => {});
  // Shoot a rider now and then, so the bus has room to top up.
  if (i % 240 === 0) for (let k = 0; k < riders.hi; k++) if (riders.state[k] < DEAD) { riders.damage(k, 1e3, 1, 0); break; }
  for (const r of wb.raiders) if (r.crew) {
    const own = r.crew.alive(riders);
    maxOwn = Math.max(maxOwn, own);
    if (own > v.busCap) capBreaks++;
    for (const id of r.crew.ids) riderIds.add(id);
  }
  for (const r of wb.raiders) {
    const p = r.sim.pos;
    if (!Number.isFinite(p.x + p.y + p.z)) nan++;
    if (!r.alive) continue;
    // Flipped: the body's up more than 60° off the ground's up (a steep dune face itself doesn't count).
    const n = field.normal(p.x, p.z, [0, 1, 0]);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(r.sim.quat);
    if (up.x * n[0] + up.y * n[1] + up.z * n[2] < 0.5) flipped++;
    const d = Math.hypot(p.x - pelvis.x, p.z - pelvis.z);
    if (i > 60 * 20) {
      closest = Math.min(closest, d);
      samples++;
      if (r.mode === "circle" && Math.abs(d - r.radius) < 12) inBand++;
    }
  }
}
const bandShare = inBand / Math.max(1, samples);
const kindsSeen = new Set(wb.raiders.map((r) => r.kind));
const bus = wb.raiders.find((r) => r.kind === "partyBus");
const busId = bus?.id ?? "";
// Destroy the bus: no more drops from it, ever.
const droppedBefore = bus?.crew?.dropped ?? 0, spawnedBefore = riders.count;
bus?.damage(1e6, undefined, new THREE.Vector3(1, 0, 0));
for (let i = 0; i < 60 * 30; i++) { wb.update(dt, player); riders.update(dt, { x: pelvis.x, y: pelvis.y, z: pelvis.z, radius: 3 }, () => {}); }
const droppedAfter = bus?.crew?.dropped ?? 0;
const footAfter = riders.count;
// Columns on the map: never a tank; the heavy end of a deep one is a turret truck.
let colTanks = 0, colTurret = 0, colBus = 0;
for (let k = 0; k < 200; k++) {
  let q = k * 7 + 1;
  const ks = columnKinds(3 + (k % 6), (k % 10) / 9, 0.5, () => { q = (q * 16807) % 2147483647; return q / 2147483647; }, 4);
  colTanks += ks.filter((x) => x === "tank").length; colTurret += ks.filter((x) => x === "turretTruck").length; colBus += ks.filter((x) => x === "partyBus").length;
}
// Kill the band: wrecks blow up, tumble and settle on the sand; then the next band comes.
const firstWave = wb.waves;
for (const r of wb.raiders) r.damage(1e6, undefined, new THREE.Vector3(1, 0, 0));
let settled = 0, below = 0;
for (let i = 0; i < 60 * 15; i++) wb.update(dt, player);
for (const r of wb.raiders.filter((x) => !x.alive)) {
  if (!r.tumbling) settled++;
  if (r.sim.pos.y < field.height(r.sim.pos.x, r.sim.pos.z) - 0.05) below++;
}
const problems: string[] = [];
if (nan) problems.push(`${nan} NaN positions`);
if (flipped) problems.push(`${flipped} frames with a live vehicle past 60° of roll or pitch`);
if (shots === 0) problems.push("nobody fired");
if (v.bandTurretTrucks > 0 && lobs === 0) problems.push("the turret truck never lobbed a shell");
if (kindsSeen.has("tank")) problems.push("a war band fielded a tank");
if (!kindsSeen.has("turretTruck")) problems.push("no turret truck in the band");
if (!bus) problems.push("no party bus in the band");
if (!dropsSeen || droppedBefore === 0) problems.push("the party bus never dropped anyone");
if (capBreaks) problems.push(`the bus had more than ${v.busCap} of its bandits alive (${capBreaks} samples)`);
if (footAfter > spawnedBefore) problems.push(`bandits on foot rose from ${spawnedBefore} to ${footAfter} after the bus died`);
if (droppedAfter !== droppedBefore) problems.push(`a destroyed bus dropped ${droppedAfter - droppedBefore} more`);
if (riderIds.size !== droppedBefore || ![...riderIds].every((id) => id.startsWith(busId + "/b"))) problems.push("bus riders' ids not unique or not under the bus's id");
if (colTanks) problems.push(`${colTanks} tanks in map columns`);
if (!colTurret || !colBus) problems.push(`map columns: ${colTurret} turret trucks, ${colBus} buses (want some of each)`);
if (closest > 14) problems.push(`no gun run came inside 14 m (closest ${closest.toFixed(1)} m)`);
if (closest < 3.5) problems.push(`a vehicle drove into the mech (${closest.toFixed(1)} m between centres)`);
if (bandShare < 0.35) problems.push(`only ${(bandShare * 100).toFixed(0)}% of circling samples were in their band`);
if (below) problems.push(`${below} wrecks ended under the sand`);
if (wb.waves <= firstWave) problems.push("no next band after the first was beaten");
console.log(`band of ${v.bandTechnicals + v.bandTrucks + v.bandSixWheelers + v.bandWarRigs + v.bandTurretTrucks + v.bandBuses} (technicals, gun trucks, six-wheelers, War Rig, turret truck, party bus): ${shots} rounds fired in 60 s · closest pass ${closest.toFixed(1)} m · circling in band ${(bandShare * 100).toFixed(0)}% · wrecks settled ${settled} · bands ${wb.waves} · turret shells ${lobs}`);
console.log(`party bus ${busId}: ${bus?.crew?.waves ?? 0} drops, ${droppedBefore} bandits (most of its own alive at once ${maxOwn}, cap ${v.busCap}), after it was destroyed ${droppedAfter - droppedBefore} more (on foot ${spawnedBefore} then ${footAfter} 30 s later); map columns: ${colTurret} turret trucks, ${colBus} buses, ${colTanks} tanks`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("warband check failed"); }
console.log("warband check passed");
