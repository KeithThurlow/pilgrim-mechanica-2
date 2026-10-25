// Headless war band check: a band rolls in over the tall dunes and works a stationary mech. Fails on: NaN; a live
// vehicle tipped more than 60° off the ground under it (it should never flip while driving); nobody firing; nobody making a gun run
// (coming inside 14 m); most of the band not circling in its band; a killed vehicle not settling above the sand;
// no next band after the first is beaten; a vehicle driving into the mech (centres inside 3.5 m). Run: npm test (or npx tsx tools/warband-check.ts).
import * as THREE from "three/webgpu";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { DustSim, DUST_DEFAULTS } from "../src/fx/dust";
import { Warband, WARBAND_DEFAULTS } from "../src/combat/warband";
import type { Battlefield, Hittable } from "../src/game/battlefield";
import type { MechUnit } from "../src/game/mechUnit";

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
const dt = 1 / 60;
let nan = 0, flipped = 0, closest = Infinity, inBand = 0, samples = 0;
for (let i = 0; i < 60 * 60; i++) {
  wb.update(dt, player);
  bf.dust.update(dt);
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
if (v.bandTanks > 0 && lobs === 0) problems.push("the tank never lobbed a shell");
if (closest > 14) problems.push(`no gun run came inside 14 m (closest ${closest.toFixed(1)} m)`);
if (closest < 3.5) problems.push(`a vehicle drove into the mech (${closest.toFixed(1)} m between centres)`);
if (bandShare < 0.35) problems.push(`only ${(bandShare * 100).toFixed(0)}% of circling samples were in their band`);
if (below) problems.push(`${below} wrecks ended under the sand`);
if (wb.waves <= firstWave) problems.push("no next band after the first was beaten");
console.log(`band of ${v.bandTechnicals + v.bandTrucks + v.bandSixWheelers + v.bandWarRigs + v.bandTanks} (technicals, gun trucks, six-wheelers, War Rig, tank): ${shots} rounds fired in 60 s · closest pass ${closest.toFixed(1)} m · circling in band ${(bandShare * 100).toFixed(0)}% · wrecks settled ${settled} · bands ${wb.waves} · tank shells ${lobs}`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("warband check failed"); }
console.log("warband check passed");
