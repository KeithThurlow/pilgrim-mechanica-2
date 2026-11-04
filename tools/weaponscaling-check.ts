// Weapon scaling check (src/items/weaponScaling.ts): prints every modelled weapon's focus, area, crowd, reliability,
// reach, budget spend and Protocol ceilings, and fails if the numbers break their own rules: a profile not finite,
// a best build that gets worse with more sockets, a reliability over 1, or the profile disagreeing with the balance
// sheet's eDPS. The Spend ≤ 200 rule is printed, not enforced (Claude's proposal, open for Keith).
//   npx tsx tools/weaponscaling-check.ts
import { MODELLED, SCALING, bestBuilds, profileOf, reliabilityCurve, scaleClass, protocolsFor } from "../src/items/weaponScaling";
import { eDps, reseed, targets, wOf } from "../src/items/balanceModel";
import { makeItem } from "../src/items/generate";

let failed = 0;
const fail = (m: string) => { failed++; console.error("FAIL weaponscaling: " + m); };
const lp = (s: string | number, n: number) => String(s).padStart(n);
const f0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toString() : "-");

console.log("weapon               focus  set        area  crowd   rel  reach  F%   A%  spend  F-ceil A-ceil class   best area build");
const over: string[] = [];
for (const id of MODELLED) {
  const p = profileOf(makeItem(id));
  for (const [k, v] of Object.entries(p)) if (typeof v === "number" && !Number.isFinite(v) && k !== "speed") fail(`${id} ${k} = ${v}`);
  if (p.reliability > 1.001) fail(`${id} reliability ${p.reliability.toFixed(3)} over 1`);
  for (const r of reliabilityCurve(makeItem(id))) if (r.r > 1.001) fail(`${id} reliability at ${r.v} m/s is ${r.r.toFixed(3)}`);
  // Same numbers as the balance sheet where the sheet's 25 m swarm is in range.
  reseed();
  const w = wOf(makeItem(id)), sw = eDps(w, targets()[0]);
  if (w.range * 0.9 >= 25 && Math.abs(sw - p.area) > 1e-6 * Math.max(1, sw)) fail(`${id} area ${p.area} vs the sheet's ${sw}`);
  const sc = scaleClass(id);
  let line = "";
  if (protocolsFor(id).length) {
    for (const axis of ["focus", "area"] as const) {
      const b = bestBuilds(id, axis);
      for (let n = 1; n < b.length; n++) if (b[n][axis] < b[n - 1][axis] - 1e-9) fail(`${id} best ${axis} build drops at ${n} sockets`);
      if (axis === "area") line = b[SCALING.sockets].protos.join("+") || "-";
    }
  }
  if (p.spend > SCALING.spendCap) over.push(`${p.name} ${f0(p.spend)}`);
  console.log(p.name.padEnd(20) + lp(f0(p.focus), 6) + "  " + p.focusSet.padEnd(9) + lp(f0(p.area), 6) + lp(p.crowd.toFixed(1), 7) + lp(p.reliability.toFixed(2), 6) + lp(f0(p.reach), 6)
    + lp(f0(p.focusPct), 5) + lp(f0(p.areaPct), 5) + lp(f0(p.spend), 7) + lp(`×${sc.focusCeil.toFixed(2)}`, 7) + lp(`×${sc.areaCeil.toFixed(2)}`, 7) + "  " + sc.cls.padEnd(7) + " " + line);
}
// Keith 2026-11-04: lighter, faster hits read higher on the card but land less. The short sword has the highest raw
// (card) DPS of the swords, and its focus eDPS stays at or under the Buster's.
{
  const sw = ["sword-light", "sword-heavy", "sword-short"].map((id) => profileOf(makeItem(id)));
  const [, bus, sho] = sw;
  if (sho.card <= Math.max(sw[0].card, bus.card)) fail(`short sword card ${f0(sho.card)} not the swords' highest (${sw.map((p) => f0(p.card)).join(", ")})`);
  if (sho.focus > bus.focus) fail(`short sword focus ${f0(sho.focus)} over the Buster's ${f0(bus.focus)}`);
  console.log(`swords raw (card) / focus eDPS: ${sw.map((p) => `${p.name} ${f0(p.card)}/${f0(p.focus)}`).join(", ")}`);
}
console.log(`\nWARNING (not a failure; open for Keith): Spend = focus % + area % over ${SCALING.spendCap}: ${over.join(", ") || "none"}`);
if (failed) { console.error(`weaponscaling check: ${failed} failure(s)`); (globalThis as unknown as { process: { exit(c: number): never } }).process.exit(1); }
console.log("weaponscaling check passed");
