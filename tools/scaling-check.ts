// Scaling by distance (Keith 2026-10-31: item power ran ahead, enemy scaling wasn't noticeable). Prints what the sand
// is like at each distance from the road (danger, item and enemy power, camp sizes and excavators, bandit and war band
// sizes) and fails if the rules break: danger must be felt early, enemies must outgrow items, deep robot camps must hold
// excavators, bandits must grow from small groups into warbands, war bands must get longer.
import { DEPTH_DEFAULTS, dangerOf, scaled } from "../src/expedition/depth";
import { LOOT_DEFAULTS } from "../src/items/generate";
import { DROP_DEFAULTS } from "../src/expedition/drops";
import { levelPower, levelMul } from "../src/items/level";
import { CAMP_DEFAULTS, CampField } from "../src/expedition/camps";
import { BANDIT_DEFAULTS } from "../src/expedition/banditCamps";
import { COLUMN_DEFAULTS, WarColumns } from "../src/expedition/warColumns";
import { THREAT_DEFAULTS } from "../src/expedition/threats";

let failed = 0;
const fail = (m: string) => { failed++; console.error("FAIL scaling: " + m); };
const D = { ...DEPTH_DEFAULTS }, L = { ...LOOT_DEFAULTS }, DR = { ...DROP_DEFAULTS }, B = { ...BANDIT_DEFAULTS }, T = { ...THREAT_DEFAULTS };
const level = (m: number) => 1 + m / DR.levelMetres;

// Robot camps on a 40 km strip, depth = |x| (the road along z).
const cf = new CampField({ ...CAMP_DEFAULTS });
cf.start = { x: 1e7, z: 0 };
cf.danger = (x) => dangerOf(D, Math.abs(x));
const C = CAMP_DEFAULTS.campCell;
function campsAt(m0: number, m1: number) {
  let n = 0, size = 0, bigs = 0, cells = 0;
  for (let j = -40; j < 40; j++) for (let i = Math.floor(m0 / C); i < Math.ceil(m1 / C); i++) {
    cells++;
    const c = cf.camp(i, j);
    if (c && c.x >= m0 && c.x < m1) { n++; size += c.size; bigs += c.bigs; }
  }
  return { per: n / cells, size: size / Math.max(1, n), bigs: bigs / Math.max(1, n) };
}
function columnsAt(m: number) {
  const i = Math.floor(m / COLUMN_DEFAULTS.colCell);
  let n = 0, size = 0, bus = 0;
  for (let j = -60; j < 60; j++) {
    const c = WarColumns.initial({ ...COLUMN_DEFAULTS }, i, j, { x: 1e7, z: 0 }, (x) => dangerOf(D, Math.abs(x)));
    if (c) { n++; size += c.kinds.length; if (c.kinds.includes("partyBus")) bus++; }
  }
  return { size: size / Math.max(1, n), bus: bus / Math.max(1, n) };
}
const banditMean = (d: number) => (B.banditMin + (B.banditMax - B.banditMin) / 4) * scaled(B.banditSizeFar, d);

console.log("depth  danger  itemLv  item×  hull×  enemy×  camp size  excav  bandits  raid  column (bus)");
// (camps are sampled ±250 m round each depth and columns by their 800 m cell, so the near rows blur together)
const rows: Record<number, { d: number; item: number; enemy: number; camp: ReturnType<typeof campsAt>; band: number; col: ReturnType<typeof columnsAt> }> = {};
for (const m of [100, 300, 600, 900, 1500, 2500]) {
  const d = dangerOf(D, m), lv = level(m);
  const item = levelPower(lv, L.levelGrowth), hull = levelMul("hull", lv, L.levelGrowth), enemy = levelPower(lv, L.enemyGrowth);
  const camp = campsAt(Math.max(0, m - 250), m + 250), band = banditMean(d), col = columnsAt(m);
  const raid = Math.round(T.raidSize * scaled(T.raidSizeFar, d));
  rows[m] = { d, item, enemy, camp, band, col };
  console.log(`${String(m).padStart(5)}  ${d.toFixed(2).padStart(6)}  ${lv.toFixed(1).padStart(6)}  ${item.toFixed(2).padStart(5)}  ${hull.toFixed(2).padStart(5)}  ${enemy.toFixed(2).padStart(6)}  ${camp.size.toFixed(1).padStart(9)}  ${camp.bigs.toFixed(1).padStart(5)}  ${band.toFixed(1).padStart(7)}  ${String(raid).padStart(4)}  ${col.size.toFixed(1)} (${Math.round(col.bus * 100)}%)`);
}

if (!(rows[300].d >= 0.25)) fail(`danger at 300 m is ${rows[300].d.toFixed(2)}: scaling should be felt within a few hundred metres`);
if (!(rows[900].d >= 0.6)) fail(`danger at 900 m is ${rows[900].d.toFixed(2)}`);
for (const m of [600, 900, 1500, 2500]) if (!(rows[m].enemy > rows[m].item)) fail(`enemies don't outgrow items at ${m} m`);
if (!(rows[900].item <= 1.4)) fail(`items at 900 m are ×${rows[900].item.toFixed(2)}: too fast`);
if (!(rows[1500].camp.bigs >= 1)) fail(`camps round full depth hold ${rows[1500].camp.bigs.toFixed(1)} sure excavators, want 1+`);
if (!(rows[2500].camp.bigs >= 1.9)) fail(`camps past full depth hold ${rows[2500].camp.bigs.toFixed(1)} sure excavators, want 2`);
if (!(rows[100].camp.bigs === 0)) fail("camps by the road hold sure excavators");
if (!(rows[1500].camp.size > rows[100].camp.size * 1.6)) fail("robot camps don't grow with depth");
if (!(rows[100].band <= 6)) fail(`bandit groups by the road average ${rows[100].band.toFixed(1)}: should be small`);
if (!(rows[1500].band >= rows[100].band * 3)) fail("bandits don't grow into warbands");
if (!(rows[2500].col.size > rows[100].col.size * 1.8)) fail("war bands don't get longer with depth");
if (failed) process.exit(1);
console.log("scaling: ok");
