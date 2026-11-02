// Headless summoner gear check (Keith 2026-11-02: "the backpack provides your core summons ... drone summons come out
// of your shoulders, and ... the swarms come out of there too ... when you get picked up, your summons ... walk along
// beside the convoy until they time out ... once you hop off the convoy, you can resummon them").
// 1. items: the replica bay, drone rack and swarm hive resolve into the summons' counts (src/items/loadout.ts
//    Resolved.summons); a plain mech brings none; a hive won't go on the pack mount; they all have the summon grid size.
// 2. out: with the gear on, the drones, swarm and replicas come out, the replicas one at a time `repBuild` s apart.
// 3. dismissed (picked up): drones and swarm gone at once, the replicas walk on for `sumLinger` s, then gone.
// 4. summoned again (back on the sand): they all come back.
// Run: npm test (or npx tsx tools/summongear-check.ts).
import * as THREE from "three/webgpu";
import { resolve, defaultLoadout, fitProblem } from "../src/items/loadout";
import { loadoutFor } from "../src/items/weaponPick";
import { makeItem, rollItem, LOOT_DEFAULTS } from "../src/items/generate";
import { gridClassOf } from "../src/items/gridSize";
import { Summons, SUMMON_DEFAULTS } from "../src/summon/summons";
import { applyGear, isSwarmKey } from "../src/summon/gear";
import { MECH_DEFAULTS, type MechUnit } from "../src/game/mechUnit";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { UPPER_DEFAULTS } from "../src/mech/upper";
import { DUST_DEFAULTS } from "../src/fx/dust";
import { ToonLook, TOON_DEFAULTS } from "../src/look/toon";
import { ROBOT_DEFAULTS } from "../src/combat/robots";
import { Register } from "../src/game/register";
import { Solids } from "../src/game/solids";
import { enemiesOf } from "../src/game/targeting";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import type { Battlefield, Hittable } from "../src/game/battlefield";

let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };

// 1. Items.
const r = resolve(loadoutFor({ left: "minigun", right: "minigun", k1: "drones", k2: "hive", k3: "replicas" }));
const bare = resolve(defaultLoadout());
console.log(`items: replicas ${r.summons.replicas} (one every ${r.summons.replicaBuild.toFixed(1)} s), drones ${r.summons.drones}, scrappers ${r.summons.scrappers}, swarm keys ${r.summons.swarmKeys.join(",")}; plain mech ${bare.summons.replicas}/${bare.summons.drones}/${bare.summons.scrappers}`);
if (r.summons.replicas < 1 || r.summons.drones < 1 || r.summons.scrappers < 1) fail("items: summoner gear brings nothing");
if (!isSwarmKey(r, 2) || isSwarmKey(r, 1)) fail("items: the hive's key should be 2 only");
if (bare.summons.replicas || bare.summons.drones || bare.summons.scrappers) fail("items: a plain mech brings summons");
if (!fitProblem(defaultLoadout(), "pack", makeItem("sh-hive", "common", "t"))) fail("items: a hive fits on the pack mount");
if (fitProblem(defaultLoadout(), "shoulderL", makeItem("sh-drones", "common", "t"))) fail("items: a drone rack won't go on a shoulder");
for (const b of ["pack-replica", "sh-drones", "sh-hive"]) if (gridClassOf({ kind: "pack", base: b }) !== "summon") fail(`items: ${b} isn't summon sized`);
// Rolled ones: rarer rolls stay sane.
for (const rarity of ["common", "rare", "legendary"] as const) for (const base of ["pack-replica", "sh-drones", "sh-hive"]) for (const level of [1, 10]) for (let seed = 1; seed < 30; seed++) {
  const st = rollItem(seed, LOOT_DEFAULTS, { base, rarity, level }).stats;
  const n = st.replicas ?? st.drones ?? st.scrappers;
  if (!(n >= 1 && n <= 40 && st.summonRebuild > 0 && (st.replicaBuild ?? 1) > 0)) { fail(`items: a ${rarity} ${base} rolled ${JSON.stringify(st)}`); break; }
}

// 2-4. On a stand-in battlefield.
const field = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const noop: unknown = new Proxy(function () {}, { get: () => noop, apply: () => undefined });
const V = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...UPPER_DEFAULTS, ...DUST_DEFAULTS, ...MECH_DEFAULTS, ...ROBOT_DEFAULTS, ...SUMMON_DEFAULTS } as never as ConstructorParameters<typeof Summons>[2];
applyGear(V, r);
const register = new Register(), solids = new Solids(), targets: Hittable[] = [];
const bf = new Proxy({ register, targets, solids, field, v: V, lookGround: null, water: null, deaths: null, sinkSurface: null, nightLights: null,
  canSee: () => true, inWater: () => false, sinkDepth: () => 0, fire: () => 0, lob: () => null }, {
  get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop),
}) as unknown as Battlefield;
const owner = { team: 1, alive: true, lock: null, cursor: null, bound: { on: false },
  sim: { pos: new THREE.Vector3(0, 0, 0), pelvis: new THREE.Vector3(0, 3, 0), vel: new THREE.Vector3(), heading: 0 } };
const summons = new Summons(bf, new THREE.Group(), V, field, owner as unknown as MechUnit, enemiesOf(1), null, { look: new ToonLook({ ...TOON_DEFAULTS }) });
const dt = 1 / 30;
const run = (sec: number, each?: (t: number) => void) => { for (let t = 0; t < sec; t += dt) { register.rebuild(); summons.update(dt); solids.tick(dt); each?.(t); } };
const count = () => ({ drones: summons.drones.flying, scrappers: summons.allies.scrappers, replicas: summons.replicas!.units().length });

let firstRep = -1, secondRep = -1;
run(Math.max(30, V.repBuild * (r.summons.replicas + 1) + 2), (t) => {
  const n = summons.replicas!.units().length;
  if (n >= 1 && firstRep < 0) firstRep = t;
  if (n >= 2 && secondRep < 0) secondRep = t;
});
const out = count();
console.log(`out: drones ${out.drones}, scrappers ${out.scrappers}, replicas ${out.replicas} (first at ${firstRep.toFixed(1)} s, second at ${secondRep.toFixed(1)} s)`);
if (out.drones !== r.summons.drones) fail("out: drones missing");
if (out.scrappers !== r.summons.scrappers) fail("out: scrappers missing");
if (out.replicas !== r.summons.replicas) fail("out: replicas missing");
if (firstRep < V.repBuild - 0.1) fail("out: the first replica came out before its build time");
if (r.summons.replicas >= 2 && secondRep - firstRep < V.repBuild - 0.1) fail("out: two replicas came out at once");

summons.setActive(false);
run(1);
const off = count();
run(V.sumLinger + 1);
const gone = count();
console.log(`dismissed: after 1 s drones ${off.drones}, scrappers ${off.scrappers}, replicas ${off.replicas}; after ${V.sumLinger + 1} s replicas ${gone.replicas}`);
if (off.drones || off.scrappers) fail("dismissed: drones or swarm still out");
if (off.replicas !== r.summons.replicas) fail("dismissed: replicas went at once (they should walk on a while)");
if (gone.replicas) fail("dismissed: replicas never folded away");
if (V.droneCount !== r.summons.drones || V.swarmCount !== r.summons.scrappers || V.repCount !== r.summons.replicas) fail("dismissed: the counts weren't put back");

summons.setActive(true);
run(Math.max(40, V.repBuild * (r.summons.replicas + 1) + 2));
const back = count();
console.log(`summoned again: drones ${back.drones}, scrappers ${back.scrappers}, replicas ${back.replicas}`);
if (back.drones !== r.summons.drones || back.scrappers !== r.summons.scrappers || back.replicas !== r.summons.replicas) fail("summoned again: not all back");

if (failed) { console.log("summoner gear check FAILED"); process.exit(1); }
console.log("summoner gear check passed");
