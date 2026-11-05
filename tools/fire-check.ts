// Fire (Keith 2026-11-05: flamers, the napalm launcher, burning, metal that heats up): things that must never happen.
// - Damage types: fire does × fire vs flesh on people and × fire vs metal on machines; other types stay at ×1.
// - A burn deals its damage per second (× the type) for its time and stops; flesh never heats.
// - Metal heats while it burns, keeps cooking (heat² × heatDps) after the flames are out, cools and is dropped when
//   cold; heatOf reads it per unit; a dead target stops at once.
// - A pool burns what stands in it (and sets it alight), never what stands outside it; a pool on a pool merges; pools
//   end on time.
// - The items: the flamer is held (Light), the inferno on the hull (Medium), both carry their burn; the napalm launcher
//   is a shoulder launcher; quick picks resolve to them.
// Run: npm test (or npx tsx tools/fire-check.ts).
import * as THREE from "three/webgpu";
import type { Hittable } from "../src/game/battlefield";
import { Burns } from "../src/game/burn";
import { FirePools } from "../src/game/firePools";
import { typeMul, DAMAGE_TYPE_DEFAULTS as DT } from "../src/game/damageType";
import { FIRE_DEFAULTS as F } from "../src/weapons/fire/fireTuning";
import { BASE_BY_ID, SHOULDER_FAMILY } from "../src/items/bases";
import { loadoutFor } from "../src/items/weaponPick";
import { resolve } from "../src/items/loadout";

const fails: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

class Ball implements Hittable {
  team = 2; alive = true; taken = 0;
  constructor(public x: number, public y: number, public z: number, public surface: "flesh" | "metal", public r = 0.6) {}
  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const ox = o.x - this.x, oy = o.y - this.y, oz = o.z - this.z;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - this.r * this.r;
    const h = b * b - c;
    if (h < 0) return -1;
    const t = -b - Math.sqrt(h);
    return t >= 0 && t <= maxDist ? t : -1;
  }
  damage(a: number) { this.taken += a; }
}
const run = (b: Burns, s: number, dt = 1 / 60) => { for (let t = 0; t < s - 1e-9; t += dt) b.step(dt); };
const V = { burnTick: 0.25, burnMax: 64, heatRise: F.heatRise, heatCool: F.heatCool, heatDps: F.heatDps, ...DT };

// ---- Damage types ----
must(typeMul("fire", "flesh", DT) === DT.fireVsFlesh && typeMul("fire", "metal", DT) === DT.fireVsMetal, "fire's multipliers aren't the sliders'");
must(typeMul("kinetic", "flesh", DT) === 1 && typeMul("explosive", "metal", DT) === 1 && typeMul("energy", "creature", DT) === 1, "a non-thermal type isn't ×1");
must(DT.fireVsFlesh > 1 && DT.fireVsMetal < 1, "fire should favour flesh over metal by default");

// ---- Flesh: burns for its time, × fire vs flesh, never heats ----
let fleshTaken = 0, metalBurn = 0, metalAfter = 0, peak = 0, cooledBy = 0;
{
  const b = new Ball(0, 1, 0, "flesh"), burns = new Burns(V);
  burns.ignite(b, -1, 2, 20, 0, 1, 0);
  run(burns, 3);
  fleshTaken = b.taken;
  must(near(b.taken, 20 * 2 * DT.fireVsFlesh, 20 * DT.fireVsFlesh * 0.3), `flesh burning 2 s at 20/s took ${b.taken.toFixed(1)} (want ${(40 * DT.fireVsFlesh).toFixed(0)})`);
  must(burns.list.length === 0, "a flesh burn outlived its time");
  must(burns.heatOf(b) === 0, "flesh heated up");
}
// ---- Metal: heats, cooks after, cools, is dropped; heatOf per unit ----
{
  const b = new Ball(0, 1, 0, "metal"), burns = new Burns(V);
  const k = 4 * 7 + 1;
  (b as Hittable).unitOf = (key: number) => key >> 2;
  burns.ignite(b, k, 3, 20, 0, 1, 0);
  run(burns, 3);
  metalBurn = b.taken;
  peak = burns.heatOf(b, 7);
  must(near(peak, Math.min(1, F.heatRise * 3), 0.05), `metal after 3 s burning has heat ${peak.toFixed(2)} (want ${Math.min(1, F.heatRise * 3).toFixed(2)})`);
  must(burns.heatOf(b, 6) === 0, "heat leaked to another unit");
  must(b.taken > 20 * 3 * DT.fireVsMetal, `metal took no cooking on top of its burn (${b.taken.toFixed(0)})`);
  const at = b.taken;
  run(burns, 2);
  metalAfter = b.taken - at;
  must(metalAfter > 1, "hot metal stopped taking damage when the flames went out");
  must(burns.heatOf(b, 7) < peak, "metal didn't cool once the flames were out");
  let t = 0;
  while (burns.list.length && t < 60) { run(burns, 0.5); t += 0.5; }
  cooledBy = t + 2;
  must(burns.list.length === 0, "cold metal was never dropped");
  const cold = b.taken;
  run(burns, 2);
  must(b.taken === cold, "cold metal kept taking damage");
  // A dead target stops at once, hot or not.
  burns.ignite(b, k, 3, 20, 0, 1, 0);
  run(burns, 2);
  b.alive = false;
  burns.step(0.1);
  must(burns.list.length === 0, "a dead target kept burning or cooling");
}

// ---- Pools ----
let poolIn = 0;
{
  const flat = { height: () => 0 };
  const inside = new Ball(1, 1, 0.5, "flesh"), outside = new Ball(9, 1, 0, "flesh"), friend = new Ball(-1, 1, 0, "flesh");
  friend.team = 1;
  const targets: Hittable[] = [inside, outside, friend];
  const burns = new Burns(V);
  const pools = new FirePools(flat, targets, burns, { poolTick: 0.25, poolMax: 8, poolMerge: 0.6, ...DT });
  pools.add(1, 0, 0, 3, 2, 30, 4, 10);
  for (let t = 0; t < 1; t += 1 / 60) pools.step(1 / 60);
  poolIn = inside.taken;
  must(near(inside.taken, 30 * 1 * DT.fireVsFlesh, 30 * DT.fireVsFlesh * 0.3), `a body in a pool for 1 s took ${inside.taken.toFixed(1)} (want about ${(30 * DT.fireVsFlesh).toFixed(0)})`);
  must(outside.taken === 0, "a pool burnt a body outside it");
  must(friend.taken === 0, "a pool burnt its own side");
  must(burns.burning(inside) && !burns.burning(outside), "a pool didn't set what stands in it alight (or set what's outside)");
  pools.add(1, 1, 0, 3, 2, 30, 4, 10);
  must(pools.list.length === 1, `a pool on a pool made ${pools.list.length} (want one, merged)`);
  for (let t = 0; t < 2.2; t += 1 / 60) pools.step(1 / 60);
  must(pools.list.length === 0, "a pool outlived its time");
  pools.add(1, 0, 0, 3, 1, 30, 4, 10); pools.add(1, 20, 0, 3, 1, 30, 4, 10);
  must(pools.list.length === 2, "two pools apart merged");
}

// ---- Items and picks ----
{
  const fl = BASE_BY_ID["flamer-light"], inf = BASE_BY_ID["inferno-medium"], nap = BASE_BY_ID["sh-napalm"];
  must(fl?.size === "L" && fl.cls === "flamer" && (fl.stats.burnDps?.base ?? 0) > 0, "the flamer isn't a held weapon with a burn");
  must(inf?.size === "M" && inf.cls === "inferno" && (inf.stats.burnDps?.base ?? 0) > 0, "the inferno isn't a hull weapon with a burn");
  must(nap?.kind === "shoulder" && nap.shoulder === "napalm" && SHOULDER_FAMILY.napalm === "launcher" && (nap.stats.poolDps?.base ?? 0) > 0, "the napalm launcher isn't a shoulder launcher with pools");
  const r = resolve(loadoutFor({ left: "flamer", right: "inferno", k1: "napalm", k2: "none", k3: "napalm" }));
  must(r.guns.left?.cls === "flamer" && !!r.guns.left.light && (r.guns.left.burnDps ?? 0) > 0, `?left=flamer resolved to ${r.guns.left?.cls}`);
  must(r.guns.right?.cls === "inferno" && !r.guns.right.light, `?right=inferno resolved to ${r.guns.right?.cls}`);
  must(r.shoulders.some((x) => x.key === 1 && x.weapon === "napalm") && r.shoulders.some((x) => x.key === 3 && x.weapon === "napalm"), "?k1=napalm / ?k3=napalm didn't fit the napalm launcher");
}

console.log(`fire: flesh 2 s @20 → ${fleshTaken.toFixed(0)} · metal 3 s @20 → ${metalBurn.toFixed(0)} (heat ${peak.toFixed(2)}), cooks ${metalAfter.toFixed(0)} in the next 2 s, cold by ~${cooledBy.toFixed(1)} s · pool 1 s → ${poolIn.toFixed(0)}`);
if (fails.length) { console.error("fire check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("fire check passed");
