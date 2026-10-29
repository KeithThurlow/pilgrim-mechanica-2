// Night light rules (src/world/nightLights.ts, Keith 2026-10-29): nothing lit or drawn at noon, the real-light pools
// made once and never resized through a whole day (so shaders don't recompile), real lights within their caps, the
// nearest robot eye gets a real red spot, headlights land ahead of a vehicle on the ground, the headlamp's shadow map
// is not drawn in the day. Prints the cost of a night update with a big swarm and a column of trucks.
import * as THREE from "three/webgpu";
import { NightLights } from "../src/world/nightLights";
import { LOOK_DEFAULTS } from "../src/world/look";
import { skyAt } from "../src/world/daynight";
import { CarBody } from "../src/vehicles/carBody";
import { CarSim, carValues } from "../src/vehicles/car";
import { LAMP_ROBOT, type LampEmit } from "../src/world/lamps";

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
const N = 300;
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

// Cost of a night update: 300 eyes, 20 trucks.
const T = 200, t0 = performance.now();
for (let i = 0; i < T; i++) lights.update(1 / 60, mid, focus);
const ms = (performance.now() - t0) / T;
const c = lights.draw.counts;
console.log(marks.join("\n"));
console.log(`night update: ${ms.toFixed(3)} ms (300 robot eyes, 20 trucks; ${c.glows} glows, ${c.pools} pools, ${c.beams} beams, max ${maxLit} real lights)`);
if (fails) throw new Error(`nightlights check: ${fails} failed`);
console.log("night lights ok");
