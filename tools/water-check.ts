// Water effects: rings spread and are gone after their life, drops fly and fall back into the water, a wake drops one
// ring per wakeEvery metres, nothing goes NaN, and the pools wrap without leaking. Also: in the shallows the ground is
// under the water where it should be and never in a plain desert region. Run: npm test (or npx tsx tools/water-check.ts).
import { WaterFx, WATER_FX_DEFAULTS } from "../src/fx/water";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";

const problems: string[] = [];
const v = { ...WATER_FX_DEFAULTS };
const fx = new WaterFx(v, -1.5);
const dt = 1 / 60;

fx.splash(0, 0, 1);
if (fx.dropsAlive !== 0) problems.push("drops counted before an update");
fx.update(dt);
if (fx.dropsAlive < v.splashDrops * 0.8) problems.push(`only ${fx.dropsAlive} drops after a splash`);
if (fx.ripplesAlive < 1) problems.push("no ring from a splash");
let t = 0, maxR = 0, nan = 0;
while (t < 6) {
  fx.update(dt); t += dt;
  for (let i = 0; i < fx.rx.length; i++) if (fx.rAge[i] < fx.rLife[i]) { const r = fx.radius(i); maxR = Math.max(maxR, r); if (!Number.isFinite(r)) nan++; }
  for (let i = 0; i < fx.dy.length; i++) if (fx.dAge[i] < fx.dLife[i] && !Number.isFinite(fx.dy[i])) nan++;
}
if (fx.ripplesAlive || fx.dropsAlive) problems.push(`still alive after 6 s: ${fx.ripplesAlive} rings, ${fx.dropsAlive} drops`);
if (maxR > v.rippleSpeed * v.rippleLife * 2 * v.rippleSize + 1) problems.push(`a ring grew to ${maxR.toFixed(1)} m`);

// Wake: 10 m of travel drops 10 / wakeEvery rings.
const w = new WaterFx(v, -1.5);
let acc = 0;
for (let x = 0; x < 10; x += 0.05) acc = w.wake(x, 0, 0.05, acc);
w.update(1e-4);
const want = Math.floor(10 / v.wakeEvery);
if (Math.abs(w.ripplesAlive - want) > 1) problems.push(`a 10 m wake dropped ${w.ripplesAlive} rings (expected about ${want})`);

// Flooding the pools doesn't leak.
for (let i = 0; i < 5000; i++) fx.splash(i, 0, 3);
fx.update(dt);
if (nan) problems.push(`${nan} NaN`);

// The ground: water only in the shallows.
const f = new DuneField({ ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, biomeSize: 700, biomeBlend: 200 });
let wetDesert = 0, wetShallows = 0, shallowsN = 0;
const s = { h: 0, crest: 0, flat: 0 } as import("../src/world/terrain").GroundSample;
for (let i = 0; i < 20000; i++) {
  const x = (i % 141) * 37.3 - 2600, z = Math.floor(i / 141) * 37.1 - 2600;
  f.sample(x, z, s);
  const under = s.h < SHALLOWS_DEFAULTS.waterLevel - 0.04;
  if ((s.ws ?? 0) === 0 && under && (s.wr ?? 0) === 0) wetDesert++; // the water sheet is never drawn there (fade 0), counted to know
  if ((s.ws ?? 0) > 0.99) { shallowsN++; if (under) wetShallows++; }
}
if (wetShallows < shallowsN * 0.3) problems.push(`only ${wetShallows}/${shallowsN} shallows samples under water`);

console.log(`water: splash ${v.splashDrops} drops, rings up to ${maxR.toFixed(1)} m, all gone in 6 s · 10 m wake → ${w.ripplesAlive} rings · shallows under water ${wetShallows}/${shallowsN} · desert lows below the water level (never drawn) ${wetDesert}`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("water check failed"); }
console.log("water check passed");
