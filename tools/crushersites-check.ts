// Headless check of the crushers in the expedition (src/expedition/crusherSites.ts) against stand-ins for the salvage
// sites and the swarm camps: about crusherSiteChance of the salvage sites have one (never fortresses, hubs or rock); one
// stands up at its site when the mech is near; with nobody to hunt it eats the site's spots (marked done); it streams out
// far off and comes back with its health; killed, it stays dead, wakes camps round it, and calls a swarm to the wreck
// when its seeded roll says so (never with the chance at 0); off, none.
// Run: npm test (or npx tsx tools/crushersites-check.ts).
import * as THREE from "three/webgpu";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { CrusherSites, CRUSHER_SITE_DEFAULTS, crusherSiteKind, idShare } from "../src/expedition/crusherSites";
import type { SwarmCamps } from "../src/expedition/swarmCamps";
import type { FieldSites } from "../src/expedition/sites";
import type { Battlefield } from "../src/game/battlefield";
import type { MechUnit } from "../src/game/mechUnit";
import type { Prey } from "../src/pilot/quarry";
import type { PoiPlacement } from "../src/world/pois";
import type { SpotState } from "../src/pois/salvage";

let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const field = new DuneField({ ...TERRAIN_DEFAULTS });
const any: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : any), apply: () => any });
// Anything else the death blast touches (novas, craters, lights...) answers as a no-op.
const bf = new Proxy({ targets: [], register: { add() {} }, canSee: () => true, gunFx: any, sfx: any, dust: any, blast() {}, blastOwn: () => 0 } as Record<PropertyKey, unknown>,
  { get: (t, k) => (k in t ? t[k] : any) }) as unknown as Battlefield;
const v = { ...CRUSHER_SITE_DEFAULTS };

// 1. How common: the share of 2000 site ids with a crusher.
{
  let n = 0;
  for (let k = 0; k < 2000; k++) if (idShare(`1:${k}:${k * 7 % 13}`) < v.crusherSiteChance) n++;
  const share = n / 2000;
  console.log(`sites with a crusher: ${(share * 100).toFixed(1)}% (chance ${v.crusherSiteChance})`);
  if (Math.abs(share - v.crusherSiteChance) > 0.05) fail(`share ${share.toFixed(3)} far from ${v.crusherSiteChance}`);
  const kinds = ["fortress", "hub", "outcrop", "wreckPart", "debrisField"].map((kind) => crusherSiteKind({ kind } as PoiPlacement));
  if (kinds.join() !== "false,false,false,true,true") fail(`site kinds ${kinds.join()}`);
}

// A site whose roll gives it a crusher and calls a swarm when it's killed; one that gives it a crusher but no call.
const pick = (call: boolean) => { for (let k = 0; ; k++) { const id = `2:${k}:0`; if (idShare(id) < v.crusherSiteChance && (idShare(id, 31) < v.crusherCall) === call) return id; } };
const mkPoi = (id: string, x: number, z: number) => ({ id, kind: "debrisField", tier: 2, x, z, yaw: 0, seed: 1, pad: null, level: 2, reach: 30 }) as PoiPlacement;
let pois = [mkPoi(pick(true), 200, 0)];
const spots: SpotState[] = [];
for (let k = 0; k < 4; k++) spots.push({ id: `s${k}`, section: 0, x: 200 + (k - 1.5) * 8, z: (k % 2) * 8, h: 0.5, value: 20, time: 3, label: "plate", poi: pois[0].id, progress: 0, done: false } as SpotState);
const sites = { poisIn: () => pois, salvage: { spots } } as unknown as FieldSites;
const groups: { id: string; n: number; x: number; z: number; goal?: { x: number; z: number } }[] = [];
let noise = 0;
const swarms = {
  noise() { noise++; },
  addGroup(id: string, n: number, x: number, z: number, _s?: unknown, _h?: number, goal?: { x: number; z: number }) { groups.push({ id, n, x, z, goal }); },
} as unknown as SwarmCamps;
const at = new THREE.Vector3(0, field.height(0, 0) + 3, 0);
const mechUnit = { sim: { pos: at, carry() {} }, alive: true, shoveFrom() {} } as unknown as MechUnit;
const cs = new CrusherSites(v, bf, new THREE.Scene(), field, mechUnit, sites, swarms);
const mech = { x: 0, z: 0 };
const prey = { kind: "mech", alive: true, at, radius: 2.5, unit: { damage() {} }, sim: { pelvis: at, pos: at, vel: new THREE.Vector3() } } as unknown as Prey;
const step = (s: number, hunting = false) => { for (let k = 0; k < s * 60; k++) cs.update(1 / 60, hunting, mech, prey); };

// 2. Stands up near the mech.
step(1);
if (cs.count !== 1) fail(`one site near: ${cs.count} crushers (want 1)`);
const c0 = cs.cf.pack.list[0];
// 3. Nobody to hunt: it eats the spots.
{ const pts: THREE.Vector3[] = []; cs.threats(0, 0, 600, pts); if (pts.length !== cs.count) fail(`turret threats ${pts.length}, crushers ${cs.count}`); }
step(40);
const eaten = spots.filter((s) => s.done).length;
console.log(`grazing 40 s: ${eaten}/4 spots eaten, crusher ${c0 ? Math.round(Math.hypot(c0.x - 200, c0.z)) : "-"} m from the site`);
if (eaten < 2) fail(`only ${eaten} spots eaten in 40 s`);
// 4. Far off it streams out; back, its health is remembered.
c0.health = 1234;
mech.x = 2000; at.x = 2000;
step(1);
if (cs.count) fail(`${cs.count} still up 2 km away`);
mech.x = 0; at.x = 0;
step(1);
const c1 = cs.cf.pack.list.find((c) => c.alive);
if (!c1 || Math.round(c1.health) !== 1234) fail(`came back with ${c1 ? Math.round(c1.health) : "none"} hp (left with 1234)`);
// 5. Killed: stays dead, wakes camps, calls a swarm headed for the wreck.
// Keith 2026-11-06: the call comes with its core going up, a moment after it falls (crusherDeathDelay).
if (c1) cs.cf.pack.hit(c1, 1e6);
step(Math.max(0, v.crusherDeathDelay - 0.3));
if (cs.calls || cs.cf.deathBlasts) fail("the swarm was called (or the core went up) before the death delay ran out");
step(1);
if (cs.cf.deathBlasts !== 1) fail(`${cs.cf.deathBlasts} death blasts from one kill (want 1)`);
const g = groups[0];
console.log(`kill: noise ${noise}, swarms called ${cs.calls}${g ? ` (${g.n} robots from ${Math.round(Math.hypot(g.x - c1!.x, g.z - c1!.z))} m, heading for the wreck ${g.goal ? Math.round(Math.hypot(g.goal.x - c1!.x, g.goal.z - c1!.z)) : "-"} m off)` : ""}`);
if (!noise) fail("the kill woke no camps");
if (cs.calls !== 1 || !g || !g.goal || Math.hypot(g.goal.x - c1!.x, g.goal.z - c1!.z) > 1) fail("the kill didn't call a swarm to the wreck");
step(15);
if (cs.cf.pack.alive) fail("a killed site's crusher came back");
// A site whose roll says no call: none.
pois = [mkPoi(pick(false), -200, 0)];
step(1);
const c2 = cs.cf.pack.list.find((c) => c.alive);
if (!c2) fail("no crusher at the second site");
else { cs.cf.pack.hit(c2, 1e6); step(v.crusherDeathDelay + 0.5); if (cs.calls !== 1) fail("a no-call site called a swarm"); }
// Off: none.
pois = [mkPoi(pick(true), 0, 200)];
v.crushersOn = 0;
step(1);
if (cs.count) fail(`${cs.count} crushers with them off`);
if (failed) { console.log("crusher sites check FAILED"); process.exit(1); }
console.log("crushersites-check: ok");
