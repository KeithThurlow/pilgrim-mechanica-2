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
import { LAMP_ROBOT, FAM_PLAYER, FAM_BANDIT, FAM_ROBOT, type LampEmit } from "../src/world/lamps";
import { ROBOT_DEFAULTS } from "../src/combat/robots";
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

// Enemy fire (Keith 2026-10-31): a war band and a robot pack shooting back at midnight (gun flashes, shells in flight,
// blasts, the shells' landing rings, a line telegraph) clusters like the player's and never exceeds the pools.
{
  const builds = lights.builds;
  const fight = (t: number) => {
    for (let i = 0; i < 40; i++) { const a = i * 0.9, d = 15 + (i * 3.7 + t * 9) % 35; lights.gun(Math.sin(a) * d, 2, Math.cos(a) * d, i % 4 ? 0.35 : 1.3, i % 2 ? FAM_BANDIT : FAM_ROBOT); }
    for (let i = 0; i < 14; i++) { const a = i * 0.45, d = 20 + i * 2; lights.rocket(Math.sin(a) * d, 6, Math.cos(a) * d, 0, -0.3, -1, 0.8, i % 2 ? FAM_BANDIT : FAM_ROBOT); }
    for (let i = 0; i < 14; i++) lights.telegraph((i - 7) * 4, 0, 10 + (i % 3) * 6, 3.5, (t * 2 + i / 14) % 1, i % 2 ? FAM_BANDIT : FAM_ROBOT);
    lights.telegraphLine(-20, 30, 20, 34, 3, 0.5, FAM_PLAYER);
  };
  for (let i = 0; i < 12; i++) lights.flash((i - 6) * 5, 1, 25, 3, i % 2 ? FAM_BANDIT : FAM_ROBOT);
  fight(0);
  lights.update(1 / 60, mid, focus);
  const es = { ...lights.stats }, eLit = real().length;
  if (es.requests < 80) fail(`enemy fire: only ${es.requests} light requests`);
  if (es.clusters >= es.requests / 2) fail(`enemy fire: ${es.requests} requests merged only to ${es.clusters}`);
  if (es.real > V.nightLightCap) fail(`enemy fire: ${es.real} real points (pool ${V.nightLightCap})`);
  if (eLit > V.nightLightCap + V.nightSpotCap + 1) fail(`enemy fire: ${eLit} real lights over the caps`);
  for (let i = 0; i < 120; i++) { fight(i / 60); lights.update(1 / 60, mid, focus); if (real().length > V.nightLightCap + V.nightSpotCap + 1) { fail("enemy fire: over the caps mid-fight"); break; } }
  if (lights.builds !== builds) fail(`enemy fire rebuilt the pools (${lights.builds - builds} builds)`);
  console.log(`enemy fire at midnight: ${es.requests} light requests -> ${es.clusters} merged -> ${es.real} real points; ${eLit} real lights in all`);
}

// Colour-coded: one lone flash of each side lights its own colour (robots red, bandits red-orange, the player's warm).
{
  const tint = (fam: number) => {
    const L = new NightLights({ ...V });
    L.ground = FLAT;
    new THREE.Scene().add(L.group);
    L.gun(0, 2, 10, 1, fam);
    L.update(1 / 60, mid, focus);
    const l = L.group.children.find((o) => (o as THREE.PointLight).isPointLight && (o as THREE.PointLight).intensity > 0) as THREE.PointLight | undefined;
    return l ? l.color : null;
  };
  const r = tint(FAM_ROBOT), b = tint(FAM_BANDIT), p = tint(FAM_PLAYER);
  if (!r || !b || !p) fail("a lone gun flash got no real light");
  else {
    const gr = (c: THREE.Color) => c.g / Math.max(1e-3, c.r);
    if (gr(r) > 0.12) fail(`robot fire isn't red (g/r ${gr(r).toFixed(2)})`);
    if (!(gr(b) > gr(r) && gr(b) < gr(p))) fail(`bandit fire doesn't sit between robot red and the player's warm (g/r ${gr(r).toFixed(2)} < ${gr(b).toFixed(2)} < ${gr(p).toFixed(2)})`);
    console.log(`fire colours (g/r): robots ${gr(r).toFixed(2)}, bandits ${gr(b).toFixed(2)}, player ${gr(p).toFixed(2)}`);
  }
}

// The excavator beam's charge (held light, high priority) wins a real light over a field of blasts and deck lamps
// nearer the camera; the same light at blast priority does not.
{
  const charged = (prio: number) => {
    const L = new NightLights({ ...V });
    L.ground = FLAT;
    const sc = new THREE.Scene(); sc.add(L.group);
    const decks = Array.from({ length: 12 }, (_, i) => { const o = new THREE.Object3D(); o.position.set((i - 6) * 3, 3, 4); sc.add(o); return o; });
    L.addLamps(() => decks);
    for (let i = 0; i < 30; i++) L.flash((i % 6 - 3) * 10, 1, 5 + Math.floor(i / 6) * 10, 2.5);
    const u = 0.5, R = ROBOT_DEFAULTS, grow = Math.pow(u, R.robotBeamGrowth);
    L.hold(0, 10, 28, R.robotBeamLight * (0.12 + 0.88 * grow), 10 + 16 * grow, 0xff2a14, prio);
    L.update(1 / 60, mid, focus);
    return L.group.children.some((o) => (o as THREE.PointLight).isPointLight && (o as THREE.PointLight).intensity > 0 && o.position.distanceTo(new THREE.Vector3(0, 10, 28)) < 0.5);
  };
  if (!charged(ROBOT_DEFAULTS.robotBeamPrio)) fail("a charging beam didn't get a real light over the blasts and deck lamps");
  if (charged(1)) fail("the beam's charge got a real light without its priority (the test field isn't full)");
}

// Tracers (Keith 2026-10-31): two miniguns hosing (40 rounds/s each) and a bandit stream: only a share carry lights,
// a stream's lit tracers merge into a few bands, the pools are never exceeded; a heavier round lights brighter.
{
  const L = new NightLights({ ...V });
  L.ground = FLAT;
  new THREE.Scene().add(L.group);
  let maxLive = 0, maxReal = 0, maxReq = 0, maxCl = 0, sent = 0;
  for (let fr = 0; fr < 60; fr++) {
    for (let r = 0; r < 2; r++) for (let g = -1; g <= 1; g += 2) { L.tracer(g * 1.5, 3, 0, g * 3 + (fr % 7), 0.5, 45, 9, FAM_PLAYER); sent++; }
    L.tracer(30, 2, 40, 0, 2, 0, 6, FAM_BANDIT);
    L.update(1 / 60, mid, focus);
    maxLive = Math.max(maxLive, L.tracersLive); maxReal = Math.max(maxReal, L.stats.real);
    maxReq = Math.max(maxReq, L.stats.requests); maxCl = Math.max(maxCl, L.stats.clusters);
  }
  if (maxLive === 0) fail("tracers: none lit");
  if (maxLive > sent * V.tracerShare) fail(`tracers: ${maxLive} lit at once of ${sent} sent (share ${V.tracerShare})`);
  if (maxReal > V.nightLightCap) fail(`tracers: ${maxReal} real points (pool ${V.nightLightCap})`);
  if (maxCl >= maxReq) fail(`tracers: ${maxReq} requests never merged (${maxCl} clusters)`);
  const bright = (power: number) => {
    const M = new NightLights({ ...V }); M.ground = FLAT; new THREE.Scene().add(M.group);
    M.tracer(0, 3, 0, 0, 3, 60, power, FAM_PLAYER, false, true);
    M.update(1 / 60, mid, focus);
    return Math.max(0, ...M.group.children.filter((o) => (o as THREE.PointLight).isPointLight).map((o) => (o as THREE.PointLight).intensity));
  };
  const light = bright(9), heavy = bright(450);
  if (!(heavy > light * 2)) fail(`tracers: a rail-class round (${heavy.toFixed(0)}) not much brighter than a minigun round (${light.toFixed(0)})`);
  console.log(`tracers: ${sent} sent in 1 s -> at most ${maxLive} lit at once, ${maxReq} requests -> ${maxCl} clusters, ${maxReal} real points; light ${light.toFixed(0)} vs heavy ${heavy.toFixed(0)}`);
}

// Rockets light the ground under them (2026-10-31, Keith: they glowed but lit nothing): a missile 12 m up gets a real
// light that reaches the sand; a blast is far brighter than a rocket.
{
  const L = new NightLights({ ...V }); L.ground = FLAT; new THREE.Scene().add(L.group);
  L.rocket(0, 12, 20, 0, 0, 1, 0.6);
  L.update(1 / 60, mid, focus);
  const pl = L.group.children.find((o) => (o as THREE.PointLight).isPointLight && (o as THREE.PointLight).intensity > 0) as THREE.PointLight | undefined;
  if (!pl) fail("a lone missile got no real light");
  else if (pl.distance < 12 * 1.3) fail(`a missile 12 m up lights only ${pl.distance.toFixed(1)} m around it: the sand under it stays dark`);
  const M = new NightLights({ ...V }); M.ground = FLAT; new THREE.Scene().add(M.group);
  M.flash(0, 1, 20, 2.5);
  M.update(1 / 60, mid, focus);
  const bl = M.group.children.find((o) => (o as THREE.PointLight).isPointLight && (o as THREE.PointLight).intensity > 0) as THREE.PointLight | undefined;
  if (pl && bl && bl.intensity < pl.intensity * 4) fail(`a blast (${bl.intensity.toFixed(0)}) isn't much brighter than a rocket (${pl.intensity.toFixed(0)})`);
  if (pl && bl) console.log(`rocket light: missile 12 m up ${pl.intensity.toFixed(0)} cd to ${pl.distance.toFixed(1)} m; blast ${bl.intensity.toFixed(0)} cd to ${bl.distance.toFixed(1)} m`);
}

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
