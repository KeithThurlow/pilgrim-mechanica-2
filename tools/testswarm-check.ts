// The test swarm (src/game/testSwarm.ts; Keith 2026-11-04, measuring clear). Must hold: the pen lays out the count it's
// given, the same every time for a seed, at its density (a blob's bodies inside the radius n/ρ/π gives, none
// overlapping); useful damage is capped at each body's health (overkill counted apart); a blast on k bodies in one
// step is k bodies per impact; a cleared wave records its time and stands up after the pause; a trickle stands each
// up on its own; and the model's swarm (swarmModel) on the Fodder tier at the swarm's own speed is the profile's Area A.
import * as THREE from "three/webgpu";
import { TestSwarm, TEST_SWARM_DEFAULTS, TEST_SWARM_TIERS, testSwarmLayout } from "../src/game/testSwarm";
import { focusArea, swarmModel } from "../src/items/weaponScaling";
import { makeItem } from "../src/items/generate";
import { targets } from "../src/items/balanceModel";

const fails: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
const flat = { height: () => 0 };
const out: string[] = [];

// Layouts: every tier and shape.
for (const tier of TEST_SWARM_TIERS) {
  const v = { ...TEST_SWARM_DEFAULTS, ...tier.set };
  const a = testSwarmLayout(v), b = testSwarmLayout(v);
  must(a.length === v.tsCount, `${tier.id}: ${a.length} bodies, wanted ${v.tsCount}`);
  must(JSON.stringify(a) === JSON.stringify(b), `${tier.id}: layout not the same for the same seed`);
  let gap = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) gap = Math.min(gap, Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z));
  must(gap >= 2 * v.tsRadius * 0.99, `${tier.id}: bodies overlap (closest ${gap.toFixed(2)} m, radius ${v.tsRadius})`);
  if (v.tsShape === 0) {
    const R = Math.sqrt(v.tsCount / v.tsDensity / Math.PI);
    must(a.every((p) => Math.hypot(p.x, p.z) <= R + 1e-6), `${tier.id}: a body outside the pen's radius ${R.toFixed(1)}`);
  }
  out.push(`${tier.id}: ${a.length} bodies, closest ${gap.toFixed(2)} m`);
}

// Accounting: one body of 12 hp hit for 20: 12 useful, 8 overkill, a kill.
const V = { ...TEST_SWARM_DEFAULTS, tsCount: 10, tsRespawn: 0, tsPause: 1 };
const sw = new TestSwarm(V, { x: 0, z: 0 });
const dir = new THREE.Vector3(0, 0, 1), at = new THREE.Vector3();
sw.update(1 / 120, flat);
sw.bodies[0].damage(20, at, dir);
let st = sw.stats();
must(st.kills === 1 && Math.abs(st.overkill - 0.4) < 1e-6, `overkill: ${st.kills} kills, ${st.overkill} overkill (wanted 1 and 0.4)`);
must(Math.abs(st.hps * Math.max(0.1, Math.min(V.tsWindow, st.since)) - 12) < 1e-6, `useful damage not capped at the body's 12 hp`);

// A blast on the pen's centre wide enough for all of it, in one step: bodies per impact = the bodies hurt.
sw.reset();
sw.update(1 / 120, flat);
at.set(sw.cx, 0.5, sw.cz);
let hurt = 0;
for (const b of sw.bodies) hurt += b.splash(at, 4, 5, dir);
st = sw.stats();
must(hurt > 1 && Math.abs(st.perImpact - hurt) < 1e-6, `blast: ${hurt} bodies hurt but ${st.perImpact} per impact`);

// Clear the wave: its time is recorded, and it stands up after the pause.
sw.reset();
for (let i = 0; i < 120; i++) sw.update(1 / 120, flat); // a second in
for (const b of sw.bodies) b.damage(1000, at, dir);
st = sw.stats();
must(st.clears.length === 1 && Math.abs(st.clears[0] - 1) < 0.02, `wave clear time ${st.clears[0]} (wanted 1 s)`);
must(st.up === 0, "bodies still up after the wave was killed");
for (let i = 0; i < 0.9 * 120; i++) sw.update(1 / 120, flat);
must(sw.stats().up === 0, "the wave stood up before the pause");
for (let i = 0; i < 0.2 * 120; i++) sw.update(1 / 120, flat);
must(sw.stats().up === sw.bodies.length, "the wave didn't stand up after the pause");

// A trickle: each stands up on its own.
V.tsRespawn = 2;
sw.reset();
sw.bodies[0].damage(1000, at, dir);
for (let i = 0; i < 1.9 * 120; i++) sw.update(1 / 120, flat);
must(!sw.bodies[0].alive && sw.stats().clears.length === 0, "trickle: up too soon, or a wave recorded");
for (let i = 0; i < 0.2 * 120; i++) sw.update(1 / 120, flat);
must(sw.bodies[0].alive, "trickle: didn't stand up");

// The model's pen: Fodder at the swarm's own speed is the profile's Area A.
const swarmT = targets().find((t) => t.id === "swarm")!;
const f = TEST_SWARM_TIERS[0].set;
for (const id of ["mg-medium", "flak-medium", "rail-medium", "sh-mortar", "shotgun-light"]) {
  const item = makeItem(id);
  const area = focusArea(item).area;
  const m = swarmModel(item, { n: f.tsCount!, hp: f.tsHp!, armour: f.tsArmour!, r: swarmT.r, rho: f.tsDensity!, dist: swarmT.dist, speed: swarmT.speed });
  must(Math.abs(m.area - area) <= 1e-6 * Math.max(1, area), `${id}: model pen ${m.area.toFixed(1)} hp/s, profile Area ${area.toFixed(1)}`);
  const still = swarmModel(item, { n: f.tsCount!, hp: f.tsHp!, armour: f.tsArmour!, r: f.tsRadius!, rho: f.tsDensity!, dist: 25 });
  out.push(`${id}: Area ${area.toFixed(0)} hp/s moving; pen standing ${still.area.toFixed(0)} hp/s, C ${still.crowd.toFixed(1)}, clear ${still.clear.toFixed(1)} s`);
}

console.log(out.join("\n"));
if (fails.length) { console.error("testswarm-check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("testswarm-check: ok");
