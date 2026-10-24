// Biome check (Keith 2026-10-25: blend one biome into the next; rocky ground always walkable). On a map with small
// regions so borders are close: weights add up to 1 and are the same in any order; no height jumps anywhere, borders
// included (the biggest step between samples 0.1 m apart); rocky slopes walkable; shallows never deeper than the mech's
// knee; and what height() costs against plain dunes. Run: npm test (or npx tsx tools/biome-check.ts).
import { DuneField, TERRAIN_DEFAULTS, type GroundSample } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";

const problems: string[] = [];
const vals = { ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, biomeSize: 700, biomeBlend: 200 };
const f = new DuneField(vals);
const g = new DuneField({ ...vals });
const KNEE = 1.5;

// Weights and determinism.
let worstSum = 0, mismatch = 0;
const seen = [0, 0, 0];
for (let i = 0; i < 20000; i++) {
  const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 6000, z = (Math.sin(i * 78.233) * 12345.678 % 1) * 6000;
  const w = f.biomes!.weights(x, z);
  worstSum = Math.max(worstSum, Math.abs(w.desert + w.rocky + w.shallows - 1));
  if (w.desert > 0.99) seen[0]++; if (w.rocky > 0.99) seen[1]++; if (w.shallows > 0.99) seen[2]++;
  if (Math.abs(f.height(x, z) - g.height(x, z)) > 1e-9) mismatch++;
}
if (worstSum > 1e-6) problems.push(`weights off 1 by ${worstSum}`);
if (mismatch) problems.push(`${mismatch} heights differ between two fields`);
for (let k = 0; k < 3; k++) if (!seen[k]) problems.push(`no ${["desert", "rocky", "shallows"][k]} region found`);

// Jumps and slopes on a grid of transects (both axes), 0.1 m steps.
let worstStep = 0, worstAt = "", rockySteep = 0, rockyN = 0, deep = 0, shallowN = 0, borderN = 0;
const water = vals.waterLevel;
const s: GroundSample = { h: 0, crest: 0, flat: 0 };
for (let line = 0; line < 30; line++) {
  const z0 = -3000 + line * 200;
  let prev = f.height(-3000, z0);
  for (let x = -3000 + 0.1; x < 3000; x += 0.1) {
    const h = f.height(x, z0);
    const d = Math.abs(h - prev);
    if (d > worstStep) { worstStep = d; worstAt = `${x.toFixed(1)}, ${z0}`; }
    prev = h;
    if (Math.round(x * 10) % 20 === 0) {
      f.sample(x, z0, s);
      const wr = s.wr ?? 0, ws = s.ws ?? 0;
      if (wr > 0.01 && wr < 0.99 || ws > 0.01 && ws < 0.99) borderN++;
      if (wr > 0.99) {
        rockyN++;
        const n = f.normal(x, z0);
        if (Math.acos(n[1]) * 180 / Math.PI > 45) rockySteep++;
      }
      if (ws > 0.99) { shallowN++; if (water - s.h > KNEE) deep++; }
    }
  }
}
const steepShare = rockySteep / Math.max(1, rockyN);
// The dunes' own limit: a 0.1 m step on a 66 degree slip face is ~0.23 m.
if (worstStep > 0.26) problems.push(`a ${worstStep.toFixed(2)} m step between samples 0.1 m apart at ${worstAt}`);
if (steepShare > 0.03) problems.push(`${(steepShare * 100).toFixed(1)}% of rocky ground steeper than 45 deg`);
if (deep) problems.push(`${deep} shallows samples deeper than the knee (${KNEE} m)`);
if (!borderN) problems.push("no border samples crossed");

// Cost against plain dunes.
const plain = new DuneField({ ...TERRAIN_DEFAULTS });
const big = new DuneField({ ...vals, biomeSize: 5000 });
const time = (fn: (x: number, z: number) => number) => { const t = performance.now(); let a = 0; for (let i = 0; i < 200000; i++) a += fn(i * 0.37, i * 0.21); return (performance.now() - t) / 200 + a * 0; };
const tPlain = time((x, z) => plain.height(x, z)), tBio = time((x, z) => big.height(x, z));

console.log(`biomes: weights sum within ${worstSum.toExponential(1)} · regions desert ${seen[0]} rocky ${seen[1]} shallows ${seen[2]} · biggest 0.1 m step ${worstStep.toFixed(3)} m · rocky steeper than 45 deg ${(steepShare * 100).toFixed(2)}% · shallows deeper than the knee ${deep}/${shallowN} · border samples ${borderN} · height() ${tPlain.toFixed(2)} vs ${tBio.toFixed(2)} µs`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("biome check failed"); }
console.log("biome check passed");
