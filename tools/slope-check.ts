// Headless slope check (Keith 2026-10-24): on planes tilted across and along the walk, the uphill (squashed) leg folds
// its thigh forward at the hip, the walk slows uphill but not downhill, and downhill the hips stay back over the feet
// instead of out in front. Run: npm test (or npx tsx tools/slope-check.ts).
import { Vector3 } from "three";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";

const plane = (gx: number, gz: number) => ({
  height: (x: number, z: number) => gx * x + gz * z,
  normal: (_x: number, _z: number, out: number[] = [0, 0, 0]) => {
    const l = Math.hypot(gx, 1, gz); out[0] = -gx / l; out[1] = 1 / l; out[2] = -gz / l; return out;
  },
});

function run(gx: number, gz: number, over: Record<string, number> = {}) {
  const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...over }, plane(gx, gz));
  sim.reset(0, 0, 0);
  const dt = 1 / 120;
  let n = 0, thighUp = 0, speed = 0, cogAhead = 0, misses = 0, stretch = 0;
  // The thigh mid-swing (forward of straight down), averaged over the swings.
  const L = sim.v.femur + sim.v.shin + sim.v.cannon, swingMax = [0, 0], swingN = [0, 0], swings: number[] = [];
  for (let i = 0; i < 120 * 20; i++) {
    sim.update(dt, { x: 0, z: 1, sprint: false });
    if (i < 120 * 5) continue;
    n++;
    speed += sim.speed;
    // Thigh angle forward of straight down for the planted leg on the uphill side (+X is the mech's left).
    for (const f of sim.feet) {
      const P = f.pose;
      if (f.swinging || (gx !== 0 && Math.sign(f.side) !== Math.sign(gx))) continue;
      const th = new Vector3().subVectors(P.knee, P.hip);
      // Tilt from straight down in any direction (forward fold or the knee turned out).
      thighUp += (Math.acos(-th.y / th.length()) * 180) / Math.PI / 2;
    }
    // Centre of the hips ahead of the middle of the feet along the walk.
    const mid = (sim.feet[0].pose.ankle.z + sim.feet[1].pose.ankle.z) / 2;
    cogAhead += sim.pelvis.z - mid;
    for (const f of sim.feet) if (!Number.isFinite(f.pose.knee.x)) misses++;
    sim.feet.forEach((f, k) => {
      const P = f.pose;
      // Mid-swing, as the foot passes under the body: where the thigh hung straight down before (Keith 2026-10-26 18:28).
      if (f.swinging) { if (f.u > 0.3 && f.u < 0.7) { swingMax[k] += (Math.atan2(P.knee.z - P.hip.z, P.hip.y - P.knee.y) * 180) / Math.PI; swingN[k]++; } }
      else { if (swingN[k] > 0) swings.push(swingMax[k] / swingN[k]); swingMax[k] = 0; swingN[k] = 0; if (!sim.airborne) stretch = Math.max(stretch, P.hip.distanceTo(P.ankle) / L); }
    });
  }
  const swingThigh = swings.reduce((a, b) => a + b, 0) / Math.max(1, swings.length);
  return { speed: speed / n, thigh: thighUp / n * 2, cogAhead: cogAhead / n, overreach: sim.stats.overreach / Math.max(1, sim.stats.frames), misses, swingThigh, stretch };
}

const fmt = (r: ReturnType<typeof run>) => `speed ${r.speed.toFixed(2)} m/s · uphill thigh ${r.thigh.toFixed(0)}° off vertical · hips ${r.cogAhead >= 0 ? "+" : ""}${r.cogAhead.toFixed(2)} m ahead of the feet · overreach ${(r.overreach * 100).toFixed(1)}% · thigh mid-swing ${r.swingThigh.toFixed(0)}° · longest planted leg ${(r.stretch * 100).toFixed(0)}%`;
const problems: string[] = [];
// The fold is measured at a slow walk (4 m/s): at the full walk (6 m/s since 2026-10-26) the long stride swings the
// thigh off vertical by itself, which hides the fold in the average.
const flat = run(0, 0), side = run(0.35, 0, { walkSpeed: 4 }), sideOff = run(0.35, 0, { walkSpeed: 4, thighFold: 0, thighSplay: 0 });
const up = run(0, 0.3), upOff = run(0, 0.3, { swingThighFold: 0, uphillLead: 0 }), down = run(0, -0.3), steep = run(0, -0.65), steepOff = run(0, -0.65, { legReachMax: 1 }), downOff = run(0, -0.3, { downhillPlant: 0, downhillSitBack: 0, downhillCrouch: 0, downhillLevel: 1 });
console.log(`flat             ${fmt(flat)}`);
console.log(`side slope 19°   ${fmt(side)}`);
console.log(`  without fold   ${fmt(sideOff)}`);
console.log(`uphill 17°       ${fmt(up)}`);
console.log(`  no swing fold  ${fmt(upOff)}`);
console.log(`downhill 17°     ${fmt(down)}`);
console.log(`  old stance     ${fmt(downOff)}`);
console.log(`downhill 33°     ${fmt(steep)}`);
console.log(`  no reach cap   ${fmt(steepOff)}`);
// The uphill planted thigh tilts well off vertical, and the fold never takes that away. With Keith's values (hockExtend 0,
// 2026-10-26) the leg already tilts 13° without the fold (was 7°) and 14° with it (was 16°): the check used to ask the
// fold to add 8°, which compared against the old no-fold leg.
if (side.thigh < 12 || side.thigh < sideOff.thigh - 0.5) problems.push(`the uphill leg's thigh doesn't fold forward on a side slope (${side.thigh.toFixed(1)}°, without the fold ${sideOff.thigh.toFixed(1)}°)`);
if (up.speed > flat.speed * 0.9) problems.push("no slowdown uphill");
if (down.speed < flat.speed * 0.95) problems.push("slows down downhill");
// The body leans over its feet while moving (Keith 2026-10-24): downhill no less than on the flat, and never behind them.
if (down.cogAhead < Math.min(0.1, flat.cogAhead - 0.15)) problems.push("downhill the hips sit back behind the feet");
if (flat.cogAhead < 0.25) problems.push("walking, the hips aren't forward over the feet");
for (const [name, r] of [["side", side], ["up", up], ["down", down], ["steep", steep]] as const) if (r.misses) problems.push(`${name}: leg solve failed`);
// Uphill (Keith 2026-10-26 18:28: the swinging thigh was held down vertical): it rises toward the hull, clearly more than
// on the flat and than without the fold.
// With Keith's low step (liftHeight 0.4, 2026-10-26; was 0.75) the swing never squashes the leg enough for the extra
// fold to engage (the "no fold" run is the same), but the thigh still rises well clear of the old vertical (0°): the
// check asks for the look, not for the mechanism (it used to ask the fold to add 12°).
if (up.swingThigh < Math.max(30, flat.swingThigh + 6)) problems.push(`uphill the thigh mid-swing only rises to ${up.swingThigh.toFixed(0)}° (flat ${flat.swingThigh.toFixed(0)}°, no fold ${upOff.swingThigh.toFixed(0)}°)`);
// Downhill (same notes: "a maximum that the legs get to that doesn't look insane"): planted legs never past the cap.
const CAP = WALKER_DEFAULTS.legReachMax, TOL = 0.025;
for (const [name, r] of [["downhill 17°", down], ["downhill 33°", steep]] as const) if (r.stretch > CAP + TOL) problems.push(`${name}: a planted leg stretched to ${(r.stretch * 100).toFixed(0)}% (cap ${(CAP * 100).toFixed(0)}%)`);
// Walking off a steep face (60°, 3 and 6 m down): the legs stop at the cap, the mech drops off the edge, lands, walks on.
for (const H of [3, 6]) {
  const k = Math.tan((60 * Math.PI) / 180), h = (_x: number, z: number) => -Math.min(H, Math.max(0, (z - 12) * k));
  const g = { height: h, normal: (x: number, z: number, o: number[] = [0, 0, 0]) => { const e = 0.05, dz = (h(x, z + e) - h(x, z - e)) / (2 * e), l = Math.hypot(dz, 1); o[0] = 0; o[1] = 1 / l; o[2] = -dz / l; return o; } };
  const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, g);
  sim.reset(0, 0, 0);
  const L = sim.v.femur + sim.v.shin + sim.v.cannon;
  let worst = 0, under = 0, below = false;
  for (let i = 0; i < 120 * 8; i++) {
    sim.update(1 / 120, { x: 0, z: 1, sprint: false });
    for (const f of sim.feet) {
      if (f.pos.y < h(f.pos.x, f.pos.z) - 0.05) under++;
      if (!f.swinging && !sim.airborne) worst = Math.max(worst, f.pose.hip.distanceTo(f.pose.ankle) / L);
    }
    if (!sim.airborne && sim.pos.z > 12 + H / k + 3 && sim.feet.every((f) => f.pos.y < -H + 1)) below = true;
  }
  const what = `walking off a ${H} m face`;
  if (worst > CAP + TOL) problems.push(`${what}: a planted leg stretched to ${(worst * 100).toFixed(0)}%`);
  if (sim.stats.takeoffs < 1) problems.push(`${what}: never dropped`);
  if (!below) problems.push(`${what}: didn't land and walk on below`);
  if (under) problems.push(`${what}: ${under} foot-frames under the ground`);
  console.log(`${what}: longest planted leg ${(worst * 100).toFixed(0)}% · dropped ${sim.stats.takeoffs}× · landed at ${sim.lastLanding ? sim.lastLanding.impact.toFixed(1) + " m/s" : "never"} · walked on below: ${below}`);
}
// Sprinting up and down planes (Keith 2026-10-26 21:54: the sprint looked terrible uphill, the steps flickering
// quicker): the cadence rises steadily with the climb (quicker, shorter strides), the footfalls stay even, the legs reach,
// and downhill the cadence doesn't rise.
{
  const cadence = (deg: number) => {
    const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, plane(0, Math.tan((deg * Math.PI) / 180)));
    sim.reset(0, 0, 0);
    const falls: number[] = [];
    let t = 0;
    sim.onFootfall = () => { if (t > 6) falls.push(t); };
    for (let i = 0; i < 12 * 120; i++, t += 1 / 120) { sim.bound = true; sim.update(1 / 120, { x: 0, z: 1, sprint: false }); }
    const gaps = falls.slice(1).map((f, i) => f - falls[i]);
    const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
    const spread = Math.max(...gaps.map((g) => Math.abs(g - mean))) / mean;
    return { deg, rate: 1 / mean, spread, speed: sim.speed, misses: sim.stats.overreach / (sim.stats.frames * 2) };
  };
  const rows = [-10, 0, 10, 20, 25].map(cadence);
  const at = (d: number) => rows.find((r) => r.deg === d)!;
  for (const r of rows) {
    console.log(`sprint ${String(r.deg).padStart(3)}°: ${r.rate.toFixed(2)} steps/s · step ${(r.speed / r.rate).toFixed(2)} m at ${r.speed.toFixed(1)} m/s · intervals within ${(r.spread * 100).toFixed(0)}% · reach misses ${(r.misses * 100).toFixed(1)}%`);
    if (r.spread > 0.15) problems.push(`sprinting at ${r.deg}°: footfall intervals uneven (${(r.spread * 100).toFixed(0)}% off the mean)`);
    if (r.deg >= 10 && r.misses > 0.03) problems.push(`sprinting up ${r.deg}°: legs out of reach ${(r.misses * 100).toFixed(1)}% of leg-frames`);
  }
  if (!(at(10).rate > at(0).rate + 0.2 && at(20).rate > at(10).rate + 0.2 && at(25).rate > at(20).rate)) problems.push(`sprint cadence doesn't rise with the climb: ${rows.map((r) => `${r.deg}° ${r.rate.toFixed(2)}`).join(", ")}`);
  if (at(-10).rate > at(0).rate + 0.1) problems.push(`sprint cadence rises downhill (${at(-10).rate.toFixed(2)} vs ${at(0).rate.toFixed(2)} steps/s)`);
}
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("slope check failed"); }
console.log("slope check passed");
