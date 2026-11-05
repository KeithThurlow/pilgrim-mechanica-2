// Chill and the freeze rays (Keith 2026-11-05: "an endothermic weapon ... that slowed enemies down and slowly froze
// them"): things that must never happen.
// - Chill builds per hit, slows the target by chillSlow × chill, ebbs at chillDecay and lets go (pace back to 1).
// - At full chill it freezes solid (pace 0) for freezeTime, thaws to thawTo and can't refreeze within freezeGrace.
// - Cold damage is coldDps × chill (× the type) per second; frozen, the full coldDps.
// - Fire thaws the frozen; cold on hot metal is thermal shock: shockDamage × heat at once, and the heat is gone.
// - The items: the Frost thrower is held (Light), the Cryo projector on the hull (Medium), both chill; picks resolve.
// Run: npm test (or npx tsx tools/chill-check.ts).
import * as THREE from "three/webgpu";
import type { Hittable } from "../src/game/battlefield";
import { Chills, CHILL_DEFAULTS as C } from "../src/game/chill";
import { Burns } from "../src/game/burn";
import { DAMAGE_TYPE_DEFAULTS as DT } from "../src/game/damageType";
import { FIRE_DEFAULTS as F } from "../src/weapons/fire/fireTuning";
import { BASE_BY_ID } from "../src/items/bases";
import { loadoutFor } from "../src/items/weaponPick";
import { resolve } from "../src/items/loadout";

const fails: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

class Ball implements Hittable {
  team = 2; alive = true; taken = 0; pace = 1;
  constructor(public surface: "flesh" | "metal") {}
  hitRay(_o: THREE.Vector3, _d: THREE.Vector3, _m: number) { return -1; }
  damage(a: number) { this.taken += a; }
  slow(_key: number, k: number) { this.pace = k; }
}
const V = { ...C, ...DT, coldVsMetal: 1, coldVsFlesh: 1 };
const run = (c: Chills, s: number, dt = 1 / 60) => { for (let t = 0; t < s - 1e-9; t += dt) c.step(dt); };

// ---- Slow, ebb, let go ----
let paceAtHalf = 0, coldIn1s = 0, frozeAt = 0, thawPace = 0;
{
  const b = new Ball("metal"), ch = new Chills(V);
  ch.hit(b, -1, 0.5, 40, 0, 1, 0);
  ch.step(1 / 60);
  paceAtHalf = b.pace;
  must(near(b.pace, 1 - C.chillSlow * 0.5, 0.02), `half chill paced ${b.pace.toFixed(2)} (want ${(1 - C.chillSlow * 0.5).toFixed(2)})`);
  const t0 = b.taken; run(ch, 1); coldIn1s = b.taken - t0;
  // About 40 × average chill over the second (0.5 ebbing at chillDecay).
  const avg = 0.5 - C.chillDecay * 0.5;
  must(near(coldIn1s, 40 * avg, 40 * 0.15), `cold damage over 1 s at ~${avg.toFixed(2)} chill was ${coldIn1s.toFixed(1)} (want ~${(40 * avg).toFixed(0)})`);
  run(ch, 0.5 / C.chillDecay + 1);
  must(ch.list.length === 0 && b.pace === 1, `chill didn't ebb away and let go (pace ${b.pace})`);
}
// ---- Freeze, thaw, grace ----
{
  const b = new Ball("flesh"), ch = new Chills(V);
  let n = 0;
  while (ch.freezes === 0 && n < 200) { ch.hit(b, -1, 0.05, 20, 0, 1, 0); ch.step(1 / 30); n++; }
  frozeAt = n;
  must(ch.freezes === 1 && b.pace === 0, `didn't freeze solid (freezes ${ch.freezes}, pace ${b.pace})`);
  must(ch.frozen(b) && ch.chillOf(b) === 2, "frozen isn't reported as 2");
  run(ch, C.freezeTime + 0.05);
  thawPace = b.pace;
  must(!ch.frozen(b) && near(b.pace, 1 - C.chillSlow * C.thawTo, 0.05), `after freezeTime it should thaw to ${C.thawTo} chill (pace ${b.pace.toFixed(2)})`);
  for (let k = 0; k < 30; k++) ch.hit(b, -1, 0.1, 20, 0, 1, 0);
  must(ch.freezes === 1, "refroze inside the grace");
}
// ---- Fire thaws the frozen ----
{
  const b = new Ball("flesh"), ch = new Chills(V);
  ch.hit(b, -1, 1, 20, 0, 1, 0); ch.step(1 / 60);
  must(ch.frozen(b), "full chill in one hit didn't freeze");
  ch.thaw(b, -1); ch.step(1 / 60);
  must(!ch.frozen(b) && b.pace > 0, "fire didn't thaw the frozen");
}
// ---- Thermal shock ----
let shock = 0;
{
  const b = new Ball("metal");
  const burns = new Burns({ burnTick: 0.25, burnMax: 64, heatRise: F.heatRise, heatCool: F.heatCool, heatDps: F.heatDps, ...DT });
  const ch = new Chills(V);
  ch.heatAt = (t, k) => burns.heatAtKey(t, k); ch.quench = (t, k) => burns.quench(t, k);
  burns.ignite(b, -1, 3, 20, 0, 1, 0);
  for (let t = 0; t < 2.5; t += 1 / 60) burns.step(1 / 60);
  const heat = burns.heatAtKey(b, -1), t0 = b.taken;
  ch.hit(b, -1, 0.05, 20, 0, 1, 0);
  shock = b.taken - t0;
  must(heat > 0.25 && near(shock, C.shockDamage * heat, 1), `thermal shock on heat ${heat.toFixed(2)} did ${shock.toFixed(1)} (want ${(C.shockDamage * heat).toFixed(0)})`);
  must(burns.heatAtKey(b, -1) === 0 && ch.shocks === 1, "the shock didn't take the heat");
  const b2 = new Ball("metal"), t1 = 0; ch.hit(b2, -1, 0.05, 20, 0, 1, 0);
  must(b2.taken === t1, "cold metal took a thermal shock");
}
// ---- Items and picks ----
{
  const fr = BASE_BY_ID["frost-light"], cr = BASE_BY_ID["cryo-medium"];
  must(fr?.size === "L" && fr.cls === "frost" && (fr.stats.chill?.base ?? 0) > 0 && (fr.stats.coldDps?.base ?? 0) > 0, "the Frost thrower isn't a held weapon that chills");
  must(cr?.size === "M" && cr.cls === "cryo" && (cr.stats.chill?.base ?? 0) > 0, "the Cryo projector isn't a hull weapon that chills");
  const r = resolve(loadoutFor({ left: "frost", right: "cryo", k1: "none", k2: "none", k3: "pack" }));
  must(r.guns.left?.cls === "frost" && !!r.guns.left.light && (r.guns.left.chill ?? 0) > 0, `?left=frost resolved to ${r.guns.left?.cls}`);
  must(r.guns.right?.cls === "cryo" && !r.guns.right.light && (r.guns.right.coldDps ?? 0) > 0, `?right=cryo resolved to ${r.guns.right?.cls}`);
}

console.log(`chill: half chill pace ${paceAtHalf.toFixed(2)}, cold 1 s @40 → ${coldIn1s.toFixed(0)} · froze after ${frozeAt} hits of 0.05, thawed pace ${thawPace.toFixed(2)} · shock ${shock.toFixed(0)}`);
if (fails.length) { console.error("chill check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("chill check passed");
