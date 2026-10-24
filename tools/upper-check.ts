// Headless gun check: the two hull guns work on their own. When the aim jumps sideways, one arm swings inward and
// the other outward (slower), so they come on target and start firing at different moments; both still fire, both
// stay inside their arcs, and each stops at an empty drum. Run: npm test (or npx tsx tools/upper-check.ts).
import { UpperSim, UPPER_DEFAULTS } from "../src/mech/upper";

const v = { ...UPPER_DEFAULTS, ammoPerGun: 400 };
const sim = new UpperSim(v);
sim.reset(0);
const shoulder = { x: 0, y: 4.3, z: 0 };
const dt = 1 / 120;
const first: Record<number, number> = {};
const counts: Record<number, number> = { 1: 0, [-1]: 0 };
let maxYaw = 0;
const problems: string[] = [];

// Settle facing forward with the barrels spun up, then jump the aim 25 degrees to the left and hold the trigger.
for (let i = 0; i < 240; i++) sim.update(dt, 0, shoulder, { x: 0, y: 0, z: 20 }, true);
for (const g of sim.guns) g.clock = 0;
const jumpAt = 240 * dt;
for (let i = 0; i < 2400; i++) {
  const t = jumpAt + i * dt;
  const aim = { x: Math.sin(0.44) * 20, y: 0, z: Math.cos(0.44) * 20 };
  for (const s of sim.update(dt, 0, shoulder, aim, true)) { counts[s]++; if (i > 0 && first[s] === undefined) first[s] = t; }
  for (const g of sim.guns) maxYaw = Math.max(maxYaw, Math.abs(g.yaw));
}
// Firing resumes per gun once each is back on target after the jump: look at when each gun's fire restarts.
sim.reset(0);
for (let i = 0; i < 240; i++) sim.update(dt, 0, shoulder, { x: 0, y: 0, z: 20 }, true);
const restart: Record<number, number> = {};
let wasFiring = { 1: true, [-1]: true } as Record<number, boolean>;
for (let i = 0; i < 600; i++) {
  sim.update(dt, 0, shoulder, { x: 12, y: 0, z: 20 }, true);
  for (const g of sim.guns) {
    if (wasFiring[g.side] && !g.firing) wasFiring[g.side] = false;
    if (!wasFiring[g.side] && g.firing && restart[g.side] === undefined) restart[g.side] = i * dt;
  }
}
// A target close in front, under the guns' depression limit (the cursor near the mech in the iso view), must still
// be fired on by both guns.
sim.reset(0);
const close: Record<number, number> = { 1: 0, [-1]: 0 };
for (let i = 0; i < 480; i++) for (const s of sim.update(dt, 0, shoulder, { x: 0, y: 0, z: 5 }, true)) close[s]++;
if (close[1] === 0 || close[-1] === 0) problems.push(`close target not fired on (L ${close[1]}, R ${close[-1]})`);
const gap = Math.abs((restart[1] ?? 99) - (restart[-1] ?? 99));
if (restart[1] === undefined || restart[-1] === undefined) problems.push("a gun never came back on target after the aim jumped");
else if (gap < 0.02) problems.push(`both guns came back on target together (${(gap * 1000).toFixed(0)} ms apart)`);
if (counts[1] === 0 || counts[-1] === 0) problems.push("a gun never fired");
if (counts[1] > v.ammoPerGun || counts[-1] > v.ammoPerGun) problems.push("a gun fired past an empty drum");
if (maxYaw > (v.podYawMax * Math.PI) / 180 + 1e-6) problems.push("a gun swung past its arc");
console.log(`close target: L ${close[1]} R ${close[-1]} rounds · rounds L ${counts[1]} R ${counts[-1]} (drum ${v.ammoPerGun}) · back on target after the jump: L ${(restart[1] ?? NaN).toFixed(2)} s, R ${(restart[-1] ?? NaN).toFixed(2)} s (${(gap * 1000).toFixed(0)} ms apart)`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("upper check failed"); }
console.log("upper check passed");
