// Weapon traits check (src/items/traits.ts, Keith 2026-11-04): every weapon has one delivery trait and only known
// traits; Keith's calls hold (the lance takes area and split Protocols but not chain; the arc caster and the orb chain;
// swords and rails stay as they are); and every Protocol that fits by trait and changes how a shot behaves does
// something in the balance model for that weapon (a fit the sim can't carry out shows up as no change).
//   npx tsx tools/traits-check.ts
import { TRAIT_BY_ID, WEAPON_TRAITS } from "../src/items/traits";
import { BASE_BY_ID } from "../src/items/bases";
import { PROTOCOLS, protocolFits } from "../src/items/protocols";
import { MODELLED, focusArea, itemWith } from "../src/items/weaponScaling";
import { reseed } from "../src/items/balanceModel";

let failed = 0;
const fail = (m: string) => { failed++; console.error("FAIL traits: " + m); };
const DELIVERY = ["rounds", "shells", "rockets", "slug", "bolt", "beam", "blade"];
const fits = (base: string) => PROTOCOLS.filter((p) => protocolFits(p, BASE_BY_ID[base].tags)).map((p) => p.id);

for (const [base, ts] of Object.entries(WEAPON_TRAITS)) {
  if (!BASE_BY_ID[base]) { fail(`${base} has traits but no base`); continue; }
  for (const t of ts) if (!TRAIT_BY_ID[t]) fail(`${base}: unknown trait ${t}`);
  const d = ts.filter((t) => DELIVERY.includes(t));
  if (d.length !== 1) fail(`${base}: ${d.length} delivery traits (${d.join(", ")})`);
}
for (const id of MODELLED) if (!WEAPON_TRAITS[id]) fail(`${id} has no traits`);

const want = (base: string, yes: string[], no: string[]) => {
  const f = fits(base);
  for (const p of yes) if (!f.includes(p)) fail(`${base} should fit ${p}`);
  for (const p of no) if (f.includes(p)) fail(`${base} should not fit ${p}`);
};
want("lance-medium", ["splitter", "wideBore"], ["arcLink"]);
want("arc-medium", ["arcLink"], []);
want("orb-medium", ["arcLink"], []);
const MELEE = ["honedEdge", "longHaft", "quickHands", "cleaver"];
for (const b of ["sword-light", "sword-heavy", "sword-short"]) want(b, MELEE, PROTOCOLS.map((p) => p.id).filter((id) => !MELEE.includes(id) && !(b === "sword-heavy" && ["hardenedCore", "shatterPoint"].includes(id))));
want("sword-heavy", ["hardenedCore", "shatterPoint"], []);
want("laser-medium", ["prism", "efficiencyCoil", "focusLens"], ["ricochet"]);
want("rail-medium", ["hardenedCore", "shatterPoint", "overcharge"], []);
want("plasma-medium", ["accelerator"], []);
want("mg-medium", PROTOCOLS.filter((p) => p.shot && p.id !== "prism").map((p) => p.id), ["prism"]);

// Every Protocol that fits a weapon changes one of its own stats (effectiveStats skips stats an item hasn't got), or
// how its shots behave, and moves the model's focus or area.
let pairs = 0;
for (const base of MODELLED) {
  reseed(); const b0 = focusArea(itemWith(base, []));
  for (const p of PROTOCOLS) {
    if (!protocolFits(p, BASE_BY_ID[base].tags)) continue;
    const stats = BASE_BY_ID[base].stats;
    if (!p.shot && !p.cost && !p.mods.some((m) => m.scope === "item" && m.stat in stats)) fail(`${p.id} fits ${base} but none of its stats are the weapon's`);
    reseed(); const b1 = focusArea(itemWith(base, [p.id]));
    pairs++;
    if (Math.abs(b1.focus - b0.focus) < 1e-6 && Math.abs(b1.area - b0.area) < 1e-6) fail(`${p.id} fits ${base} but changes nothing`);
  }
}
console.log(`traits: ${Object.keys(WEAPON_TRAITS).length} weapons, ${pairs} Protocol fits all do something`);
for (const base of ["lance-medium", "plasma-medium", "orb-medium", "arc-medium", "rail-medium", "sniper-medium", "sword-short"])
  console.log(`  ${base}: ${WEAPON_TRAITS[base].join(" ")} | fits ${fits(base).join(" ") || "-"}`);
if (failed) { console.error(`traits check: ${failed} failure(s)`); (globalThis as unknown as { process: { exit(c: number): never } }).process.exit(1); }
console.log("traits check passed");
