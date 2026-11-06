// Headless check of the fortress mechs' posts and strength (src/expedition/fortMechs.ts; Keith 2026-11-06):
// - posts: per fortress, the outer yard gets fortMechsOuter, a three-ring fortress's middle yard fortMechsMiddle, the
//   keep the warlord and fortFlankers flankers; each stands on open ground with room round it (nothing solid within
//   4 m), inside its own yard; ids unique; the same layout gives the same posts;
// - strength (the duel rules: beatable): each mech's hull × loadout DPS against a rival rolled at the player's level
//   (the duel lab's Recruit, the player's equal) averaged over seeds. Yard mechs and flankers must be no stronger than
//   that equal; the warlord at most 2.5 times it (with a Veteran's aim). Numbers, not a fight: the duel check runs the brain.
// Run: npm test (or npx tsx tools/fortmechs-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { POI_DEFAULTS, PoiField } from "../src/world/pois";
import { PoiPads, rawGround } from "../src/world/poiPads";
import { addModifier } from "../src/world/modifiers";
import { SITE_DEFAULTS } from "../src/pois/kinds";
import { SiegeWalls, regionOf, solidAt } from "../src/pois/fortressGround";
import { FORT_MECH_DEFAULTS, fortMechPosts } from "../src/expedition/fortMechPosts";
import { rollRivalLoadout, loadoutDps } from "../src/combat/rivalKit";
import { resolve, LOADOUT_DEFAULTS } from "../src/items/loadout";
import { LOOT_DEFAULTS } from "../src/items/generate";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";

const problems: string[] = [];
const fail = (m: string) => { problems.push(m); console.log("FAIL " + m); };
const V = { ...TERRAIN_DEFAULTS, ...POI_DEFAULTS, ...SITE_DEFAULTS, ...FORT_MECH_DEFAULTS };
const field = new DuneField(V);
const pois = new PoiField({ ...V, poiChance: 0, bigChance: 0 }, rawGround(field));
const pads = new PoiPads(pois); addModifier(field, pads);
const walls = new SiegeWalls(pois, V); addModifier(field, walls);
const none = new Set<string>();

// ---- posts ----
let threes = 0, total = 0;
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  pois.extra.length = 0;
  const p = pois.placeAt(`lab:${seed}`, "fortress", 0, 250, 0.4, seed * 7919 + 13);
  pois.extra.push(p); pads.reindex(); walls.reset();
  const L = walls.layout(p), keepK = L.rings.length - 1;
  const posts = fortMechPosts(L, V, p.seed);
  const again = fortMechPosts(L, V, p.seed);
  if (JSON.stringify(posts) !== JSON.stringify(again)) fail(`seed ${seed}: posts differ between two calls`);
  if (new Set(posts.map((q) => q.id)).size !== posts.length) fail(`seed ${seed}: post ids not unique`);
  const want = (k: number) => (k === 0 ? V.fortMechsOuter : k === 1 && keepK > 1 ? V.fortMechsMiddle : 0);
  for (let k = 0; k < keepK; k++) {
    const n = posts.filter((q) => q.role === "yard" && q.yard === k).length;
    if (n !== want(k)) fail(`seed ${seed}: yard ${k} has ${n} mechs (want ${want(k)})`);
  }
  if (keepK > 1) threes++;
  if (posts.filter((q) => q.role === "boss").length !== 1) fail(`seed ${seed}: not one warlord`);
  if (posts.filter((q) => q.role === "flank").length !== V.fortFlankers) fail(`seed ${seed}: ${posts.filter((q) => q.role === "flank").length} flankers`);
  for (const q of posts) {
    total++;
    if (regionOf(L, q.x, q.z) !== q.yard + 1) fail(`seed ${seed}: ${q.role} ${q.id} stands outside its yard ${q.yard} (region ${regionOf(L, q.x, q.z)})`);
    let blocked = solidAt(L, q.x, q.z, none);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (solidAt(L, q.x + Math.sin(a) * 4, q.z + Math.cos(a) * 4, none)) blocked = true; }
    if (blocked) fail(`seed ${seed}: ${q.role} ${q.id} has something solid within 4 m`);
    if (Math.hypot(q.x - q.arena.x, q.z - q.arena.z) > q.arena.r) fail(`seed ${seed}: ${q.role} ${q.id} starts outside its arena`);
  }
}
console.log(`posts: 8 fortresses (${threes} with three rings), ${total} mechs, each in its yard with 4 m of room · outer ${V.fortMechsOuter}, middle ${V.fortMechsMiddle}, keep the warlord + ${V.fortFlankers}`);

// ---- strength ----
const RV = { ...LOOT_DEFAULTS, ...LOADOUT_DEFAULTS, ...WEAPON_DEFAULTS, rivalBareDashCharges: 2 } as never;
const strength = (seed: number, level: number, hull: number) => {
  const lo = rollRivalLoadout(seed, RV, { level: Math.max(1, level) });
  const r = resolve(lo, { ...(RV as object), bareDashCharges: 2 } as never);
  return r.values.hull * hull * loadoutDps(lo);
};
const PLAYER = 5, N = 40;
const mean = (f: (s: number) => number) => { let t = 0; for (let s = 1; s <= N; s++) t += f(s * 7907 + 3); return t / N; };
const equal = mean((s) => strength(s, PLAYER, 1));
const posts0 = (() => {
  pois.extra.length = 0;
  const p = pois.placeAt("lab:3", "fortress", 0, 250, 0.4, 3 * 7919 + 13);
  pois.extra.push(p); pads.reindex(); walls.reset();
  return fortMechPosts(walls.layout(p), V, p.seed);
})();
const rows: string[] = [];
for (const role of ["yard", "flank", "boss"] as const) {
  for (const q of posts0.filter((x) => x.role === role).slice(0, role === "yard" ? 2 : 1)) {
    const k = mean((s) => strength(s, PLAYER + Math.round(q.up), q.hull)) / equal;
    rows.push(`${role}${role === "yard" ? " " + q.yard : ""} ${q.ai} items ${q.up >= 0 ? "+" : ""}${q.up} hull ×${q.hull.toFixed(2)}: ${k.toFixed(2)}`);
    if (role !== "boss" && k > 1.05) fail(`a ${role} mech is ${k.toFixed(2)}× the player's equal (want at most 1)`);
    if (role === "boss" && k > 2.5) fail(`the warlord is ${k.toFixed(2)}× the player's equal (want at most 2.5)`);
  }
}
console.log(`strength at level ${PLAYER} (hull × DPS vs a rival at your level, ${N} rolls): ${rows.join(" · ")}`);

if (problems.length) { console.log(`FAIL ${problems.length} problem(s)`); throw new Error("fortmechs check failed"); }
console.log("fortmechs check passed");
