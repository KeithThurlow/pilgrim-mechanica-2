// Night light rules (src/world/nightLights.ts, Keith 2026-10-29): nothing lit or drawn at noon, the real-light pools
// made once and never resized through a whole day (so shaders don't recompile), real lights within their caps, the
// nearest robot eye gets a real red spot, headlights land ahead of a vehicle on the ground, the headlamp's shadow map
// is not drawn in the day. Prints the cost of a night update with a big swarm and a column of trucks. Light clustering
// (2026-10-31): close short lights merge into one, far ones stay apart, the curve and soft cap hold, a full rocket
// barrage never takes more real lights than the pools, and a noon barrage lights nothing.
import * as THREE from "three/webgpu";
import { NightLights } from "../src/world/nightLights";
import { LOOK_DEFAULTS } from "../src/world/look";
import { skyAt } from "../src/world/daynight";
import { CarBody } from "../src/vehicles/carBody";
import { CarSim, carValues } from "../src/vehicles/car";
import { LAMP_ROBOT, type LampEmit } from "../src/world/lamps";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { clusterLights, clusterPower, type ClusterOpts, type LightCluster, type LightReq } from "../src/world/lightCluster";

let fails = 0;
const fail = (m: string) => { fails++; console.log("FAIL", m); };
const V = { ...LOOK_DEFAULTS, dayCycle: 1 };
const FLAT = { height: () => 0, normal: (_x: number, _z: number, out: number[] = [0, 1, 0]) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; } };

const scene = new THREE.Scene();
const lights = new NightLights(V);
lights.ground = FLAT;
scene.add(lights.group);

// A column of trucks heading +Z, the first at the origin.
const trucks: CarBody[] = [];
for (let i = 0; i < 20; i++) {
  const b = new CarBody(i % 3 === 0 ? "warRig" : "technical"), sim = new CarSim(carValues(b.kind), FLAT);
  sim.reset(i % 2 ? 6 : -6, -i * 12, 0);
  b.update(sim, 0, 0);
  scene.add(b.root);
  trucks.push(b);
}
// A swarm of robot eyes: 300 in a ring, the nearest at 12 m.
const swarm = new THREE.Group();
let N = 300;
swarm.userData.lampSource = (emit: LampEmit) => {
  for (let i = 0; i < N; i++) {
    const a = i * 2.4, r = 12 + i * 0.4;
    emit(LAMP_ROBOT, Math.sin(a) * r, 0.6, Math.cos(a) * r, -Math.sin(a), 0, -Math.cos(a), true, 0, 1);
  }
};
scene.add(swarm);

const focus = new THREE.Vector3(0, 0, 0);
const real = () => [...lights.group.children].filter((o) => (o as THREE.Light).isLight && (o as THREE.Light).intensity > 0) as THREE.Light[];
let builds0 = -1, maxLit = 0;
const marks: string[] = [];
for (let m = 0; m <= 24 * 60; m += 5) {
  const h = (12 + m / 60) % 24, night = skyAt(h, V).grade.night;
  lights.update(1 / 60, night, focus);
  if (lights.builds > 0 && builds0 < 0) builds0 = lights.builds;
  const c = lights.draw.counts, lit = real();
  maxLit = Math.max(maxLit, lit.length);
  if (night === 0 && (c.glows || c.pools || c.beams || lit.length)) fail(`${h.toFixed(2)}h: day yet ${c.glows} glows, ${c.pools} pools, ${c.beams} beams, ${lit.length} lights`);
  if (night === 0 && lights.pools.headlamp?.shadow.autoUpdate) fail(`${h.toFixed(2)}h: headlamp shadow drawn in the day`);
  if (lit.length > V.nightLightCap + V.nightSpotCap + 1) fail(`${h.toFixed(2)}h: ${lit.length} real lights over the caps`);
  if ([0, 6 * 60, 12 * 60].includes(m)) marks.push(`${h.toFixed(1)}h night ${night.toFixed(2)}: ${c.glows} glows, ${c.pools} pools, ${c.beams} beams, ${lit.length} real lights`);
}
if (lights.builds !== 1) fail(`real-light pools made ${lights.builds} times through a day (want 1)`);
const { points, spots } = lights.pools;
if (points !== V.nightLightCap || spots !== V.nightSpotCap) fail(`pools ${points}/${spots}, caps ${V.nightLightCap}/${V.nightSpotCap}`);

// Midnight: the nearest robot eye (12 m, at a = 0: (0, 0.6, 12)) has a red spot on it; headlights land ahead on the ground.
const mid = skyAt(0, V).grade.night;
lights.update(1 / 60, mid, focus);
const spotsLit = real().filter((l) => (l as THREE.SpotLight).isSpotLight && l !== lights.pools.headlamp) as THREE.SpotLight[];
const near = spotsLit.find((s) => s.position.distanceTo(new THREE.Vector3(0, 0.6, 12)) < 0.01);
if (!near) fail("the nearest robot eye has no real light");
else if (!(near.color.r > 0.9 && near.color.g < 0.2)) fail(`robot spot not red (${near.color.getHexString()})`);
const pools = lights.draw.pools, mtx = new THREE.Matrix4(), p = new THREE.Vector3();
let ahead = 0;
for (let i = 0; i < pools.count; i++) {
  pools.getMatrixAt(i, mtx); p.setFromMatrixPosition(mtx);
  if (Math.abs(p.y - 0.12) > 0.01) { fail(`pool ${i} off the ground at y ${p.y.toFixed(2)}`); break; }
  if (Math.abs(p.x + 6) < 1.5 && p.z > V.vehReach && p.z < V.vehReach + 8) ahead++;
}
if (ahead < 2) fail(`the lead truck's headlights: ${ahead} pools ahead of it on the ground`);
// A wreck goes dark.
trucks[0].setWrecked(true);
lights.update(1 / 60, mid, focus);
let still = 0;
for (let i = 0; i < pools.count; i++) { pools.getMatrixAt(i, mtx); p.setFromMatrixPosition(mtx); if (Math.abs(p.x + 6) < 1.5 && p.z > V.vehReach && p.z < V.vehReach + 8) still++; }
if (still > ahead - 2) fail(`a wreck still lights its pools (${ahead} before, ${still} after)`);

// Cost of a night update: 300 eyes, 20 trucks, beams landing on the real dunes.
lights.ground = new DuneField({ ...TERRAIN_DEFAULTS });
for (let i = 0; i < 50; i++) lights.update(1 / 60, mid, focus);
const cost = () => { const T = 300, t0 = performance.now(); for (let i = 0; i < T; i++) lights.update(1 / 60, mid, focus); return (performance.now() - t0) / T; };
const ms = cost();
N = 100;
const ms100 = cost();
N = 300;
const c = lights.draw.counts;
console.log(marks.join("\n"));
console.log(`night update on dunes: ${ms.toFixed(2)} ms (100 eyes: ${ms100.toFixed(2)} ms) (300 robot eyes, 20 trucks; ${c.glows} glows, ${c.pools} pools, ${c.beams} beams, max ${maxLit} real lights)`);

// ---- Light clustering (Keith 2026-10-31): short lights close together merge into one brighter light ----
const O: ClusterOpts = { radius: 8, curve: 0.5, cap: 4000, grow: 0.6 };
const W = new THREE.Color(1, 1, 1);
const mk = (x: number, z: number, power: number, range = 10): LightReq => ({ x, y: 2, z, power, range, r: W.r, g: W.g, b: W.b });
const out: LightCluster[] = [];
{
  // Ten within 2 m: one light, at their centre, sqrt(10) times as bright, reach grown.
  const reqs = Array.from({ length: 10 }, (_, i) => mk(Math.cos(i) * 2, Math.sin(i) * 2, 100));
  const nc = clusterLights(reqs, reqs.length, O, out);
  if (nc !== 1) fail(`10 close requests made ${nc} lights (want 1)`);
  else {
    const want = 100 * Math.sqrt(10);
    if (Math.abs(out[0].power - want) > want * 0.01) fail(`10 close requests: power ${out[0].power.toFixed(0)} (want ~${want.toFixed(0)}, the sqrt curve)`);
    if (out[0].n !== 10) fail(`cluster holds ${out[0].n} (want 10)`);
    if (!(out[0].range > 10 && out[0].range <= 30)) fail(`cluster reach ${out[0].range.toFixed(1)} (want grown past 10, at most 3x)`);
  }
  // Brightness-weighted centre: 300 at x 0, 100 at x 4 -> x 1.
  clusterLights([mk(0, 0, 300), mk(4, 0, 100)], 2, O, out);
  if (Math.abs(out[0].x - 1) > 1e-6) fail(`weighted centre at x ${out[0].x.toFixed(3)} (want 1)`);
  // Far apart: each its own.
  const far = Array.from({ length: 5 }, (_, i) => mk(i * 50, 0, 100));
  if (clusterLights(far, far.length, O, out) !== 5) fail("5 requests 50 m apart did not stay 5 lights");
  // Radius 0: never merge.
  if (clusterLights(far.map((q) => ({ ...q, x: q.x / 100 })), 5, { ...O, radius: 0 }, out) !== 5) fail("merge radius 0 still merged");
  // The curve: 1 is the plain sum, 0 only the brightest; the cap is soft (never reached, rising with the count).
  if (Math.abs(clusterPower(1000, 100, { ...O, curve: 1, cap: 0 }) - 1000) > 1e-6) fail("curve 1 is not the plain sum");
  if (Math.abs(clusterPower(1000, 100, { ...O, curve: 0, cap: 0 }) - 100) > 1e-6) fail("curve 0 is not the brightest");
  let prev = 0;
  for (const count of [1, 5, 20, 100, 1000]) {
    const reqs = Array.from({ length: count }, () => mk(0, 0, 1000));
    clusterLights(reqs, count, O, out);
    const pw = out[0].power;
    if (pw >= O.cap) fail(`${count} blasts in one spot reach the cap (${pw.toFixed(0)} >= ${O.cap})`);
    if (pw <= prev) fail(`${count} blasts no brighter than fewer (${pw.toFixed(0)} <= ${prev.toFixed(0)})`);
    if (count === 1 && Math.abs(pw - 1000) > 15) fail(`one blast dimmed by the cap to ${pw.toFixed(0)}`);
    prev = pw;
  }
}

// A full barrage into the swarm at midnight: 3 rocket launchers' worth plus split rockets and missiles in flight
// (120), 40 blasts and 16 launches, out to 60 m ahead; never more real lights than the pools, fewer lights than asked.
const barrage = (t: number) => {
  for (let i = 0; i < 120; i++) {
    const a = (i * 0.37) % 1.2 - 0.6, d = 8 + ((i * 7.3 + t * 55) % 52);
    lights.rocket(Math.sin(a) * d, 3 + (i % 5), Math.cos(a) * d, Math.sin(a), -0.05, Math.cos(a), i % 3 ? 0.6 : 1);
  }
};
for (let i = 0; i < 40; i++) { const a = (i * 0.61) % 1.2 - 0.6, d = 30 + (i * 3.1) % 30; lights.flash(Math.sin(a) * d, 1, Math.cos(a) * d, 2.2 + (i % 3)); }
for (let i = 0; i < 16; i++) lights.launch((i % 2 ? 1.5 : -1.5), 4, 0.5, i % 4 ? 0.5 : 1);
barrage(0);
lights.update(1 / 60, mid, focus);
const st = { ...lights.stats }, litNow = real().length;
if (st.requests < 150) fail(`barrage: only ${st.requests} light requests`);
if (st.clusters >= st.requests / 3) fail(`barrage: ${st.requests} requests merged only to ${st.clusters} lights`);
if (st.real > V.nightLightCap) fail(`barrage: ${st.real} real point lights (pool ${V.nightLightCap})`);
if (litNow > V.nightLightCap + V.nightSpotCap + 1) fail(`barrage: ${litNow} real lights over the caps`);
if (lights.builds !== 1) fail(`barrage rebuilt the pools (${lights.builds} builds)`);
const bc = lights.draw.counts;
let tB = 0, frames = 0;
for (let i = 0; i < 300; i++) {
  if (i % 20 === 0) for (let k = 0; k < 4; k++) lights.flash((k - 2) * 6, 1, 40 + (i % 60) / 3, 3);
  barrage(i / 60);
  const t0 = performance.now(); lights.update(1 / 60, mid, focus); tB += performance.now() - t0; frames++;
}
console.log(`barrage at midnight: ${st.requests} light requests -> ${st.clusters} merged -> ${st.real} real points (+ spots, headlamp: ${litNow} real lights); ${bc.glows} glows, ${bc.pools} pools, ${bc.beams} beams; night update ${(tB / frames).toFixed(2)} ms with the 300 eyes and 20 trucks`);

// By day (no day flash): a barrage makes no lights and no pools.
{
  const dayL = new NightLights({ ...V });
  dayL.ground = FLAT;
  for (let i = 0; i < 10; i++) dayL.flash(i * 3, 1, 20, 3);
  for (let i = 0; i < 30; i++) dayL.rocket(i, 3, 10, 0, 0, 1);
  dayL.update(1 / 60, 0, focus);
  if (dayL.builds !== 0 || dayL.lit !== 0 || dayL.draw.counts.glows) fail(`noon barrage: ${dayL.builds} pool builds, ${dayL.lit} lit, ${dayL.draw.counts.glows} glows (want none)`);
}
if (fails) throw new Error(`nightlights check: ${fails} failed`);
console.log("night lights ok");
