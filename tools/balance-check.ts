// Balance rules (docs/proposal-balance.md, Keith 2026-10-31) that must never break: the armour floor holds and pierce
// scales (src/game/armour.ts) through the hit adapters; a magazine empties and reloads, a split shot costs its rounds
// (src/weapons/magazine.ts, in the gun sim too); Protocols stack by multiplying (src/items/protocols.ts) and the item
// card's DPS follows them (src/items/dps.ts); the level curve scales robots as it does items (src/items/level.ts).
// The numbers themselves are the balance sheet's (tools/balance-sheet.ts --check).
import * as THREE from "three/webgpu";
import { armourHit, ARMOUR_DEFAULTS } from "../src/game/armour";
import { RobotSwarm, ROBOT_DEFAULTS, MID, BIG, PART_BODY } from "../src/combat/robots";
import { RobotTarget } from "../src/combat/robotTarget";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { newMag, magTake, magStep, magReady, sustainedRate } from "../src/weapons/magazine";
import { UpperSim, UPPER_DEFAULTS } from "../src/mech/upper";
import { makeItem, protocolItem } from "../src/items/generate";
import { PROTOCOL_BY_ID, shotProtocolsOf } from "../src/items/protocols";
import { effectiveStats } from "../src/items/loadout";
import { itemDpsPair, itemCadence } from "../src/items/dps";
import { levelPower } from "../src/items/level";

const fails: string[] = [];
const must = (ok: boolean, m: string) => { if (!ok) fails.push(m); };
const close = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
const F = ARMOUR_DEFAULTS.armourFloor;

// ---- Armour: the floor holds, pierce scales ----
for (const d of [1, 5, 12, 50, 450]) for (const A of [0, 3, 8, 10, 20, 100]) {
  let last = -1;
  for (const ap of [0, 0.25, 0.5, 0.9, 1]) {
    const x = armourHit(d, A, ap, F);
    must(x >= F * d - 1e-9, `armour floor: ${d} through ${A} at pierce ${ap} kept ${x} (< ${F * d})`);
    must(x <= d + 1e-9, `armour: ${d} through ${A} came out bigger (${x})`);
    must(x >= last - 1e-9, `pierce: more pierce kept less (${d} through ${A}: ${last} then ${x} at ${ap})`);
    last = x;
  }
  must(armourHit(d, A, 1, F) === d, `full pierce lost damage (${d} through ${A})`);
  must(armourHit(d, 0, 0, F) === d, `no armour lost damage (${d})`);
}
must(close(armourHit(12, 8, 0.1, F), 12 - 8 * 0.9), "a minigun round on a mech's hull isn't 12 − 8 × 0.9");
must(armourHit(1.4, 8, undefined, F) === 1.4, "a hit with no pierce (a bite) paid armour");

// ---- Through an adapter: a cutter (armour 3) and an excavator (10) take a round and a blast by the rule ----
{
  const field = new DuneField({ ...TERRAIN_DEFAULTS });
  const v = { ...ROBOT_DEFAULTS };
  const sw = new RobotSwarm(v, field, 3);
  const t = new RobotTarget(sw, 3);
  const [c] = sw.spawn(1, 0, 20, 0.1, { mid: 1, big: 0 });
  const [e] = sw.spawn(1, 40, 20, 0.1, { mid: 0, big: 1 });
  must(sw.kind[c] === MID && sw.kind[e] === BIG, "couldn't spawn a cutter and an excavator");
  const at = new THREE.Vector3(), dir = new THREE.Vector3(0, 0, 1);
  // (hp is Float32: compare to 1e-3.)
  const hit = (i: number, d: number, ap?: number) => { const h0 = sw.hp[i]; t.pick(i * 4 + PART_BODY); t.damage(d, at, dir, ap); return Math.round((h0 - sw.hp[i]) * 1000) / 1000; };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  must(hit(c, 12, 0.1) === r3(12 - v.robotMidArmour * 0.9), `a minigun round on a cutter took ${hit(c, 12, 0.1)} (want 12 − 3 × 0.9)`);
  must(hit(e, 9, 0) === r3(F * 9), "a light minigun round on an excavator didn't fall to the floor");
  must(hit(e, 450, 0.9) === r3(450 - v.robotBigArmour * 0.1), "a rail slug on an excavator lost more than its pierce allows");
  must(hit(e, 50, undefined) === 50, "a hit with no pierce paid the excavator's armour");
  // A blast at the excavator's body: its share, then armour by the blast's pierce.
  const h0 = sw.hp[e];
  at.set(sw.px[e], sw.hubY[e], sw.pz[e]);
  t.splash(at, 4, 300, dir, { blast: true, pierce: 0.6 });
  must(close(h0 - sw.hp[e], armourHit(300 * v.robotBigBlast, v.robotBigArmour, 0.6, F), 1e-3), `a rocket's blast on the excavator took ${h0 - sw.hp[e]}`);
  // The level curve: a robot at power 2 spawns with twice the health.
  const [p2] = sw.spawn(1, -40, 20, 0.1, { mid: 1, big: 0 }, 2);
  must(close(sw.hp[p2], 2 * v.robotMidHp) && sw.power[p2] === 2, "a robot spawned at power 2 doesn't have twice the health");
  must(close(levelPower(11, 0.075), 1.75), "levelPower(11) isn't 1.75");
}

// ---- Magazines: empty, reload, split cost ----
{
  const m = newMag(10, 2);
  let shots = 0;
  while (magTake(m, 1)) shots++;
  must(shots === 10 && !magReady(m) && m.reloading > 0, `a 10-round magazine fired ${shots} shots then didn't reload`);
  magStep(m, 1.9);
  must(!magReady(m), "a 2 s reload finished early");
  magStep(m, 0.2);
  must(magReady(m) && m.left === 10 && m.reloads === 1, "a reload didn't fill the magazine");
  // A split shot of 3 costs 3: four shots from 10 (the last overdraws), then the reload.
  let split = 0;
  while (magTake(m, 3)) split++;
  must(split === 4, `split shots from a 10-round magazine: ${split} (want 4: 3 + 3 + 3 + the last overdrawn)`);
  // A cost Protocol (0.6 a round) stretches it.
  const c = newMag(12, 1);
  let cheap = 0;
  while (magTake(c, 1, 0.6)) cheap++;
  must(cheap === 20, `rounds at 0.6 each from 12: ${cheap} (want 20)`);
  must(close(sustainedRate(10, 1, 1, 0.1, 2), 10 / (0.9 + 2)), "sustainedRate isn't magazine / (shots' time + reload)");
}
// In the gun sim: a 30-round gun with a split of 3 fires 10 shots, reloads, fires again.
{
  const sim = new UpperSim({ ...UPPER_DEFAULTS });
  sim.reset(0);
  sim.guns[0].enabled = false;
  sim.guns[1].stats = { fireRate: 20, spinUp: 0.1, ammo: 30, reload: 1, arc: 30, track: 12, damage: 4.8, spread: 3, range: 45, pierce: 2, proto: { split: 3 } };
  sim.resupply();
  const times: number[] = [];
  for (let i = 0; i < 120 * 3; i++) for (const _s of sim.update(1 / 120, 0, { x: 0, y: 4.3, z: 0 }, { x: 0, y: 0, z: 20 }, true)) times.push(i / 120);
  const first = times.findIndex((t, k) => k > 0 && t - times[k - 1] > 0.5);
  must(first === 10, `a 30-round gun with split 3 fired ${first} shots before its reload (want 10)`);
  must(first > 0 && times[first] - times[first - 1] >= 0.95, "the reload gap was shorter than the reload");
  must(sim.guns[1].mag.reloads >= 1, "the gun's magazine never reloaded");
}

// ---- Protocols multiply; the card follows ----
{
  const it = makeItem("mg-medium", "legendary");
  const base = it.stats.damage;
  for (const id of ["overpressure", "splitter", "overclock"]) it.socketed.push(protocolItem(PROTOCOL_BY_ID[id], 1));
  must(close(effectiveStats(it).damage, base * 1.1 * 0.4 * 0.6), `damage Protocols don't multiply (${effectiveStats(it).damage})`);
  const sp = shotProtocolsOf(it.socketed)!;
  must(sp.split === 3 && sp.rate === 2, "split and rate don't stack");
  const cad = itemCadence(it)!;
  must(cad.rounds === 6, `a split × overclocked shot puts out ${cad.rounds} rounds (want 6)`);
  const pair = itemDpsPair(it)!;
  must(pair.withProtocols !== pair.base && pair.base > 0, "the card's DPS with Protocols didn't change");
  const plain = itemDpsPair(makeItem("mg-medium"))!;
  must(close(plain.base, plain.withProtocols), "a weapon with no Protocols shows two DPS");
}

if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); throw new Error("balance check failed"); }
console.log("balance: armour floor and pierce, adapters, magazines and split cost, multiplying Protocols, level curve as expected");
console.log("balance check passed");
