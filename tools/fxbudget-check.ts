// The effects budget (src/fx/budget.ts): things that must never happen.
// - The local player's own effects, and anything within fxNear of their mech, are never thinned or trimmed, at any
//   pressure.
// - Far requests keep about fxFarKeep of themselves with no pressure, and fewer under pressure, evenly (no clumps).
// - Under pressure the extras go first: the main part (rank 0) always stays.
// - Many hits in one cell in one frame become one effect, n^fxMergeCount bigger in puffs; your own are never merged.
// - Budget off: everything as asked.
// Run: npm test (or npx tsx tools/fxbudget-check.ts).
import * as THREE from "three/webgpu";
import { FxBudget, FX_BUDGET_DEFAULTS, RANK } from "../src/fx/budget";
import { DustSim, DUST_DEFAULTS } from "../src/fx/dust";
import { MinigunFx, MINIGUN_FX_DEFAULTS } from "../src/fx/minigun";

const problems: string[] = [];
const flat = { height: () => 0, normal: (_x: number, _z: number, out: number[]) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; } };

// ---- The gate alone ----
const v = { ...FX_BUDGET_DEFAULTS };
const b = new FxBudget(v);
b.own = { x: 0, z: 0 };
const share = (x: number, z: number, n = 2000) => { let k = 0; for (let i = 0; i < n; i++) if (b.admit(x, z)) k++; return k / n; };
const far = share(200, 0);
if (Math.abs(far - v.fxFarKeep) > 0.03) problems.push(`far share ${far.toFixed(3)} with no pressure (want ${v.fxFarKeep})`);
if (share(5, 5) !== 1) problems.push("a request near your mech was thinned");
// Evenly spread: no run of more than ceil(1/keep)+1 dropped requests in a row.
{ let run = 0, worst = 0; for (let i = 0; i < 500; i++) { if (b.admit(200, 0)) run = 0; else worst = Math.max(worst, ++run); }
  if (worst > Math.ceil(1 / v.fxFarKeep) + 1) problems.push(`${worst} far requests dropped in a row (clumped)`); }
// Pressure: four times the dust budget for a few frames.
for (let f = 0; f < 6; f++) { b.spawned = v.fxDustPerFrame * 4; b.frame(0); }
const farP = share(200, 0);
if (farP > v.fxFarKeep / 2) problems.push(`under pressure ${b.pressure.toFixed(2)} the far share is still ${farP.toFixed(3)}`);
if (share(5, 5) !== 1) problems.push("under pressure a request near your mech was thinned");
let ownKept = 0; for (let i = 0; i < 500; i++) if (b.admit(300, 300, true)) ownKept++;
if (ownKept !== 500) problems.push(`your own effects far away: ${ownKept}/500 kept`);
b.admit(300, 300, true);
if (b.part(RANK.smoke) !== 1) problems.push("your own effect's smoke was trimmed");
b.admit(40, 0); // near the focus, not local: trimmed
if (b.part(RANK.main) !== 1) problems.push("the main part was trimmed");
if (b.part(RANK.smoke) > 0.01) problems.push(`smoke kept ${b.part(RANK.smoke).toFixed(2)} at pressure ${b.pressure.toFixed(2)}`);
const pressureHigh = b.pressure;
v.fxBudget = 0;
if (share(200, 0) !== 1) problems.push("budget off still thins");
v.fxBudget = 1;

// ---- Through the dust: a stomp by your mech is whole under pressure; far ones aren't ----
const dv = { ...DUST_DEFAULTS };
const dust = new DustSim(dv, flat as never);
dust.budget = b;
const before = (b.spawned = 0);
for (let i = 0; i < 20; i++) dust.stomp(2, 0, 2, 1);
const near = b.spawned - before;
const want = 20 * (dv.stompCloud + dv.stompClump);
if (near !== want) problems.push(`your stomps spawned ${near} puffs (want ${want})`);
b.spawned = 0;
for (let i = 0; i < 20; i++) dust.stomp(200, 0, 0, 1);
const farPuffs = b.spawned;
if (farPuffs > want * 0.5) problems.push(`far stomps under pressure spawned ${farPuffs} of ${want}`);

// ---- Merging: 20 rounds into one cell in one frame, not yours ----
const mv = { ...MINIGUN_FX_DEFAULTS, fxThinFrom: 1000, fxThinTo: 2000 };
const fx = new MinigunFx(flat as never, mv);
const calls: number[] = [];
fx.onSandHit = (_at, _d, _k, n) => calls.push(n);
const muzzle = new THREE.Vector3(0, 3, -20), d = new THREE.Vector3(0, 0, 1);
for (let i = 0; i < 20; i++) fx.shot(5, muzzle, d, new THREE.Vector3(0.2 + i * 0.02, 0, 0.3), null, null, "sand");
for (let t = 0; t < 30 && fx.hits.sand < 20; t++) { fx.update(1 / 30); fx.budget.frame(0); }
if (fx.hits.sand !== 20) problems.push(`${fx.hits.sand} of 20 rounds counted`);
if (calls.length !== 1) problems.push(`20 hits in one cell made ${calls.length} effects (want 1)`);
else if (Math.abs(calls[0] - Math.pow(20, mv.fxMergeCount)) > 1e-6) problems.push(`merged effect stands for ${calls[0].toFixed(2)} (want ${Math.pow(20, mv.fxMergeCount).toFixed(2)})`);
const mergedInto = calls.length;
// Yours: never merged.
calls.length = 0;
for (let i = 0; i < 20; i++) fx.shot(0, muzzle, d, new THREE.Vector3(0.2 + i * 0.02, 0, 0.3), null, null, "sand", undefined, 1, 1, true);
for (let t = 0; t < 30 && calls.length < 20; t++) { fx.update(1 / 30); fx.budget.frame(0); }
if (calls.length !== 20 || calls.some((n) => n !== 1)) problems.push(`your 20 hits made ${calls.length} effects (want 20 whole ones)`);

console.log(`effects budget: far share ${far.toFixed(2)} (${(farP).toFixed(3)} at pressure ${pressureHigh.toFixed(1)}) · your stomps ${near}/${want} · far stomps ${farPuffs}/${want} · 20 hits merged into ${mergedInto} · yours ${calls.length} whole`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("effects budget check failed"); }
console.log("effects budget check passed");
