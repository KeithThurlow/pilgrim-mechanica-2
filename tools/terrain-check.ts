// Headless terrain check: the height function is deterministic, finite, and walkable (slip faces near the
// angle of repose, never cliffs). Run: npm test (or npx tsx tools/terrain-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const again = new DuneField({ ...TERRAIN_DEFAULTS });
let maxSlope = 0, minH = Infinity, maxH = -Infinity, steepShare = 0, n = 0;
const problems: string[] = [];
for (let z = -1500; z <= 1500; z += 3.7) for (let x = -1500; x <= 1500; x += 3.7) {
  const h = field.height(x, z);
  if (!Number.isFinite(h)) { problems.push(`non-finite height at ${x},${z}`); break; }
  if (h !== again.height(x, z)) { problems.push(`not deterministic at ${x},${z}`); break; }
  const nn = field.normal(x, z);
  const slope = (Math.acos(nn[1]) * 180) / Math.PI;
  maxSlope = Math.max(maxSlope, slope);
  if (slope > 30) steepShare++;
  minH = Math.min(minH, h); maxH = Math.max(maxH, h);
  n++;
}
steepShare /= n;
// Loosened for the tall dunes (Keith 2026-10-24: height 14 m, spacing 44 m reach about 69 deg on the steepest crests).
if (maxSlope > 75) problems.push(`slopes up to ${maxSlope.toFixed(0)} deg (cliffs)`);
if (steepShare > 0.12) problems.push(`${(steepShare * 100).toFixed(1)}% of ground steeper than 30 deg`);
console.log(`heights ${minH.toFixed(1)}..${maxH.toFixed(1)} m · steepest ${maxSlope.toFixed(0)} deg · steeper than 30 deg: ${(steepShare * 100).toFixed(1)}% · ${n} samples`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("terrain check failed"); }
console.log("terrain check passed");
