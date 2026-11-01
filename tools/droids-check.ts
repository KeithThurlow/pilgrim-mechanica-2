// Headless humanoid robot check (src/combat/droids.ts): two squads stride at a standing mech over the tall dunes.
// Fails on NaN, robots off the ground or inside the mech, robots piled on each other, nobody firing, any burst whose
// first pulse wasn't told by the red laser (lock seen in the frames before it), anyone fleeing after half are killed,
// rounds passing through them (published Light), a ray at head height missing, or a slow update.
// Run: npm test (or npx tsx tools/droids-check.ts).
import { DroidSwarm, DROID_DEFAULTS } from "../src/combat/droids";
import { FIRING, FLEEING, DEAD } from "../src/combat/infantry";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { FLAG, type Register } from "../src/game/register";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const sw = new DroidSwarm({ ...DROID_DEFAULTS }, field, 5);
const target = { x: 0, y: field.height(0, 0) + 3, z: 0, radius: 2.5 };
const dt = 1 / 120;
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };

sw.spawn(6, 70, 10, 8);
sw.spawn(6, -40, 60, 8);
let shots = 0, nan = 0, off = 0, inside = 0, piled = 0, fled = 0, untold = 0, bursts = 0, ms = 0, firingMax = 0;
const lockSeen = new Float32Array(sw.hi + 64).fill(-1);
const lastShot = new Float32Array(sw.hi + 64).fill(-99);
const steps = 40 * 120;
let t = 0;
for (let s = 0; s < steps; s++) {
  t += dt;
  // Half of them killed at 25 s: the rest must stand.
  if (s === 25 * 120) { let k = 0; for (let i = 0; i < sw.hi && k < 6; i++) if (sw.state[i] < DEAD) { sw.damage(i, 1e4, 1, 0); k++; } }
  for (let i = 0; i < sw.hi; i++) {
    if (sw.state[i] >= DEAD) continue;
    if (sw.lock(i, Math.hypot(target.x - sw.px[i], target.z - sw.pz[i])) > 0) lockSeen[i] = t;
  }
  const t0 = performance.now();
  sw.update(dt, target, (_fx, _fy, _fz, _tx, _ty, _tz, i) => {
    shots++;
    // A burst's first pulse: more than a round gap since the last one.
    if (t - lastShot[i] > sw.v.roundInterval * 2) { bursts++; if (t - lockSeen[i] > 0.05) untold++; }
    lastShot[i] = t;
  });
  ms += performance.now() - t0;
  let firing = 0;
  for (let i = 0; i < sw.hi; i++) {
    const st = sw.state[i];
    if (st >= DEAD) continue;
    if (!Number.isFinite(sw.px[i] + sw.py[i] + sw.pz[i] + sw.heading[i])) { nan++; continue; }
    if (Math.abs(sw.py[i] - field.height(sw.px[i], sw.pz[i])) > 0.1) off++;
    if (Math.hypot(sw.px[i] - target.x, sw.pz[i] - target.z) < target.radius) inside++;
    if (st === FLEEING) fled++;
    if (st === FIRING) firing++;
    for (let j = i + 1; j < sw.hi; j++) if (sw.state[j] < DEAD && Math.hypot(sw.px[i] - sw.px[j], sw.pz[i] - sw.pz[j]) < sw.v.bodyGap * 0.6) piled++;
  }
  firingMax = Math.max(firingMax, firing);
}
const per = ms / steps;
console.log(`droids: ${shots} pulses in ${bursts} bursts (${untold} untold), most firing at once ${firingMax}, ${sw.count} left, ${per.toFixed(3)} ms/step`);
if (nan) fail(`${nan} NaN robot-frames`);
if (off) fail(`${off} robot-frames off the ground`);
if (inside) fail(`${inside} robot-frames inside the mech`);
if (piled) fail(`${piled} pairs piled closer than 0.6 × the body gap`);
if (fled) fail(`${fled} robot-frames fleeing (they never break)`);
if (bursts < 10) fail(`only ${bursts} bursts in 40 s`);
if (untold) fail(`${untold} bursts without the red laser first`);
if (firingMax < 8) fail(`at most ${firingMax} of 12 ever in the firing band`);
if (per > 0.2) fail(`update ${per.toFixed(3)} ms a step`);

// Solid in the register (rounds stop on them), and hit at head height.
let light = 0, put = 0;
const reg = { put: (..._a: unknown[]) => { put++; if ((_a[4] as number) & FLAG.Light) light++; } } as unknown as Register;
sw.publish(reg, 3);
if (!put) fail("nothing published");
if (light) fail(`${light} published as Light (rounds would pass through)`);
let i0 = -1;
for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DEAD) { i0 = i; break; }
if (i0 >= 0) {
  const y = sw.py[i0] + sw.d.droidHeight * 0.9;
  const h = sw.hitRay(sw.px[i0] - 20, y, sw.pz[i0], 1, 0, 0, 40);
  if (!h || h.index !== i0) fail("a ray at 90% of the height missed the robot");
}

if (failed) process.exit(1);
console.log("droids-check: ok");
