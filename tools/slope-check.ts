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
  let n = 0, thighUp = 0, speed = 0, cogAhead = 0, misses = 0;
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
  }
  return { speed: speed / n, thigh: thighUp / n * 2, cogAhead: cogAhead / n, overreach: sim.stats.overreach / Math.max(1, sim.stats.frames), misses };
}

const fmt = (r: ReturnType<typeof run>) => `speed ${r.speed.toFixed(2)} m/s · uphill thigh ${r.thigh.toFixed(0)}° off vertical · hips ${r.cogAhead >= 0 ? "+" : ""}${r.cogAhead.toFixed(2)} m ahead of the feet · overreach ${(r.overreach * 100).toFixed(1)}%`;
const problems: string[] = [];
// The fold is measured at a slow walk (4 m/s): at the full walk (6 m/s since 2026-10-26) the long stride swings the
// thigh off vertical by itself, which hides the fold in the average.
const flat = run(0, 0), side = run(0.35, 0, { walkSpeed: 4 }), sideOff = run(0.35, 0, { walkSpeed: 4, thighFold: 0, thighSplay: 0 });
const up = run(0, 0.3), down = run(0, -0.3), downOff = run(0, -0.3, { downhillPlant: 0, downhillSitBack: 0, downhillCrouch: 0, downhillLevel: 1 });
console.log(`flat             ${fmt(flat)}`);
console.log(`side slope 19°   ${fmt(side)}`);
console.log(`  without fold   ${fmt(sideOff)}`);
console.log(`uphill 17°       ${fmt(up)}`);
console.log(`downhill 17°     ${fmt(down)}`);
console.log(`  old stance     ${fmt(downOff)}`);
if (side.thigh < sideOff.thigh + 8) problems.push("the uphill leg's thigh doesn't fold forward on a side slope");
if (up.speed > flat.speed * 0.9) problems.push("no slowdown uphill");
if (down.speed < flat.speed * 0.95) problems.push("slows down downhill");
// The body leans over its feet while moving (Keith 2026-10-24): downhill no less than on the flat, and never behind them.
if (down.cogAhead < Math.min(0.1, flat.cogAhead - 0.15)) problems.push("downhill the hips sit back behind the feet");
if (flat.cogAhead < 0.25) problems.push("walking, the hips aren't forward over the feet");
for (const [name, r] of [["side", side], ["up", up], ["down", down]] as const) if (r.misses) problems.push(`${name}: leg solve failed`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("slope check failed"); }
console.log("slope check passed");
