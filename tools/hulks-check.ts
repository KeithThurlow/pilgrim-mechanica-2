// Headless check of mech salvage (src/expedition/hulks.ts; Keith 2026-11-16, the old project's targeted salvage):
// - the first pull off a hulk always comes off for parts at or under your level, and never under pullFirstMin above it;
// - each later pull is less likely than the one before (same part); chances stay within pullMin..1; on foot is better;
// - rolls are seeded: the same hulk id and pulls give the same outcome every time;
// - a failed pull jams it: nothing more comes off, nearest() skips it, and it pays scrap for the parts left;
// - a hulk is made once per id, never with arms (they come with the hull), and a pull stops when the puller walks off;
// - over many rolled rival loadouts a level over yours: the first pull lands 90%+, later ones less and less often.
// Run: npm test (or npx tsx tools/hulks-check.ts).
import { Hulks, HULK_DEFAULTS, pullChance, hulkParts } from "../src/expedition/hulks";
import { rollRivalLoadout } from "../src/combat/rivalKit";
import { LOOT_DEFAULTS, makeItem } from "../src/items/generate";
import { LOADOUT_DEFAULTS } from "../src/items/loadout";
import type { Item } from "../src/items/item";

const fails: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) fails.push(what); };
const v = { ...HULK_DEFAULTS };
const lv = { ...LOOT_DEFAULTS, ...LOADOUT_DEFAULTS };
const fitted = (seed: number, level = 5) => Object.values(rollRivalLoadout(seed, lv, { level }));

// ---- The curve ----
const part = makeItem("legs-rampart", "legendary", "p");
part.level = 5;
must(pullChance(v, 0, part, { playerLevel: 5, onFoot: false }) === 1, "first pull at your level isn't sure");
must(pullChance(v, 0, part, { playerLevel: 9, onFoot: false }) === 1, "first pull under your level isn't sure");
const far = pullChance(v, 0, { ...part, level: 60 }, { playerLevel: 1, onFoot: false });
must(far >= v.pullFirstMin - 1e-9 && far < 1, `first pull far over your level: ${far}, not in [pullFirstMin, 1)`);
let prev = 2;
for (let n = 0; n < 8; n++) {
  const c = pullChance(v, n, part, { playerLevel: 5, onFoot: false });
  must(c >= v.pullMin - 1e-9 && c <= 1, `pull ${n + 1}: chance ${c} out of range`);
  must(c < prev || c === v.pullMin, `pull ${n + 1} (${c}) not below pull ${n} (${prev})`);
  must(pullChance(v, n, part, { playerLevel: 5, onFoot: true }) >= c, `pull ${n + 1} worse on foot`);
  prev = c;
}
const common = makeItem("sensor-visor", "common", "c");
common.level = 5;
must(pullChance(v, 1, common, { playerLevel: 5, onFoot: false }) > pullChance(v, 1, part, { playerLevel: 5, onFoot: false }), "a light common part isn't easier than a heavy legendary one");

// ---- Parts, ids, seeding, the jam ----
const f0 = fitted(11);
must(hulkParts(f0).every((i) => i.kind !== "arm"), "a hulk offers an arm");
const hs = new Hulks(v, 7);
const h = hs.add("m1", "Bandit mech", 0, 0, f0)!;
must(!!h && h.parts.length >= 3, `rolled rival gives ${h?.parts.length} parts`);
must(hs.add("m1", "Bandit mech", 0, 0, f0) === null, "the same mech made a second hulk");
const who = { x: 1, z: 0, onFoot: false };
// The first pull: sure.
hs.begin(h, h.parts[0], false);
for (let t = 0; t < 3; t += 0.1) hs.update(0.1, who, 5);
must(hs.events.length === 1 && hs.events[0].type === "pulled", "first pull didn't come off");
hs.events.length = 0;
// Walk off mid pull: it stops.
hs.begin(h, h.parts[0], false);
hs.update(0.1, who, 5);
hs.update(0.1, { x: 50, z: 0, onFoot: false }, 5);
must(!hs.pulling && hs.events.some((e) => e.type === "cancelled"), "walking off didn't stop the pull");
must(h.pulls === 1, "a cancelled pull counted");
hs.events.length = 0;
// Pull until it jams or is clean.
let guard = 0;
while (!h.jammed && h.parts.length && guard++ < 20) { hs.begin(h, h.parts[0], false); for (let t = 0; t < 3; t += 0.1) hs.update(0.1, who, 5); }
const jam = hs.events.find((e) => e.type === "jammed");
if (h.jammed) {
  must(!!jam && jam.type === "jammed" && (h.parts.length === 0 || jam.scrap > 0), "a jam with parts left paid no scrap");
  must(!hs.begin(h, h.parts[0] ?? f0[0]!, false), "a jammed hulk let a pull start");
  must(hs.nearest(0, 0, 50) === null, "nearest() offered a jammed hulk");
}
// Seeded: the same outcome twice.
const run = () => {
  const q = new Hulks(v, 99), k = q.add("seeded", "x", 0, 0, fitted(5))!, out: string[] = [];
  for (let i = 0; i < 6 && !k.jammed && k.parts.length; i++) { q.begin(k, k.parts[k.parts.length - 1], false); for (let t = 0; t < 3; t += 0.1) q.update(0.1, who, 5); }
  for (const e of q.events) out.push(e.type + (e.type !== "cancelled" ? ":" + e.item.id : ""));
  return out.join(",");
};
must(run() === run(), "pull rolls aren't seeded (two runs differ)");

// ---- Over many hulks at the defaults ----
const N = 400, landed = [0, 0, 0, 0, 0], tried = [0, 0, 0, 0, 0];
let parts = 0;
for (let s = 0; s < N; s++) {
  const q = new Hulks(v, s), k = q.add(`h${s}`, "x", 0, 0, fitted(1000 + s, 6))!;
  parts += k.parts.length;
  for (let n = 0; n < 5 && !k.jammed && k.parts.length; n++) {
    // Pull the best part left (most valuable first, as a player would).
    const it = k.parts.slice().sort((a: Item, b: Item) => b.weight - a.weight)[0];
    tried[n]++;
    q.begin(k, it, false);
    for (let t = 0; t < 3; t += 0.1) q.update(0.1, who, 5);
    if (q.events.some((e) => e.type === "pulled")) landed[n]++;
    q.events.length = 0;
  }
}
// Items roll round the mech's level (a level or so over yours here), so the first pull is near sure, not always.
must(landed[0] >= tried[0] * 0.9, `first pulls: only ${landed[0]}/${tried[0]} came off`);
must(landed[1] < landed[0] && landed[2] < landed[1], "later pulls don't land less often");
const share = landed.map((l, i) => (tried[i] ? `${Math.round((100 * l) / tried[i])}%` : "-"));
if (process.argv.includes("--verbose") || fails.length) console.log(`hulks: ${(parts / N).toFixed(1)} parts a hulk · pulls landed 1-5: ${share.join(" / ")}`);

if (fails.length) { console.error("hulks-check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("hulks-check ok");
