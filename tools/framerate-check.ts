// Frame rate check (Keith 2026-11-06: "traversal feels like the legs drag behind... might be frame rate"). The game steps
// the walker at up to 1/120 s, as many steps as the frame needs (ceil(frame × 120), src/game/mechUnit.ts); the frame is
// capped at 1/20 s (src/core/app.ts). Must: the same walk over the dunes (walk, Shift run, a turn, a shove, a jump) at
// 20, 30, 60 and 144 fps ends up in the same place, on the same gait, with the planted feet the same distance behind.
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const base = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const T = 14;

function run(fps: number) {
  const sim = new WalkerSim({ ...base }, field); sim.reset(0, 0, 0);
  const fd = 1 / fps, sub = Math.max(1, Math.ceil(fd * 120));
  let t = 0, lagSum = 0, n = 0, maxLag = 0, shoved = false, jumped = false;
  while (t < T - 1e-9) {
    const cmd: MoveCommand = { x: t > 6 ? 0.7 : 0, z: t > 6 ? 0.7 : 1, sprint: t > 3 };
    if (!shoved && t >= 8) { shoved = true; sim.skid.x += 14; }
    if (!jumped && t >= 10.5) { jumped = true; sim.launch(sim.vel.x, 5, sim.vel.z); }
    for (let i = 0; i < sub; i++) sim.update(fd / sub, cmd);
    t += fd;
    const hx = Math.sin(sim.heading), hz = Math.cos(sim.heading);
    for (const f of sim.feet) if (!f.swinging && !sim.airborne) {
      const lag = -((f.pos.x - sim.pos.x) * hx + (f.pos.z - sim.pos.z) * hz);
      lagSum += lag; n++; maxLag = Math.max(maxLag, lag);
    }
  }
  return { fps, x: sim.pos.x, z: sim.pos.z, y: sim.pelvis.y, lag: lagSum / n, maxLag, landings: sim.stats.landings };
}

const rows = [144, 60, 30, 20].map(run), ref = rows[0];
const problems: string[] = [];
for (const r of rows) {
  const off = Math.hypot(r.x - ref.x, r.z - ref.z);
  console.log(`  ${r.fps} fps: at ${r.x.toFixed(1)}, ${r.z.toFixed(1)} (${off.toFixed(2)} m off 144), feet behind ${r.lag.toFixed(2)} m (most ${r.maxLag.toFixed(2)}), landings ${r.landings}`);
  // A frame ends between steps: about a frame's travel (8.5 m/s × 1/20 s) of difference is the sampling, not drift.
  if (off > 1) problems.push(`${r.fps} fps ends ${off.toFixed(2)} m from 144 fps`);
  if (Math.abs(r.lag - ref.lag) > 0.1) problems.push(`${r.fps} fps: planted feet ${r.lag.toFixed(2)} m behind, 144 fps ${ref.lag.toFixed(2)}`);
  if (Math.abs(r.y - ref.y) > 0.3) problems.push(`${r.fps} fps: hips at ${r.y.toFixed(2)}, 144 fps ${ref.y.toFixed(2)}`);
  if (r.landings !== ref.landings) problems.push(`${r.fps} fps: ${r.landings} landings, 144 fps ${ref.landings}`);
}
if (problems.length) { for (const p of problems) console.error("FAIL " + p); process.exit(1); }
console.log("framerate-check: ok");
