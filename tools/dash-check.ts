// Headless dash check (Keith 2026-10-24: Space dodges or lunges the way WASD points, on charges). On the dunes, while
// walking and standing: a dash covers about its distance the way it was sent, planted feet stay on the sand while they
// skid, nothing goes NaN, legs stay within reach about as often as walking does, charges run out and come back.
// Run: npm test (or npx tsx tools/dash-check.ts).
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { DuneField } from "../src/world/terrain";
import { TERRAIN_DEFAULTS } from "../src/world/terrain";

const problems: string[] = [];
const field = new DuneField({ ...TERRAIN_DEFAULTS });
field.update();
const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const dv = { ...DASH_DEFAULTS };
const sim = new WalkerSim(v, field);
const dash = new Dash(dv);
sim.reset(5, 5, 0);
const dt = 1 / 120;
let worstFoot = 0, nan = 0, frames = 0;
const covered: number[] = [];

function step(cmd: { x: number; z: number; sprint: boolean }) {
  dash.update(dt);
  sim.push.set(dash.vx, 0, dash.vz);
  sim.crouch = dash.crouch;
  sim.update(dt, cmd);
  frames++;
  for (const f of sim.feet) {
    if (!Number.isFinite(f.pos.x + f.pos.y + f.pos.z + f.pose.knee.x)) nan++;
    if (!f.swinging && dash.active) worstFoot = Math.max(worstFoot, Math.abs(f.planted.y - field.height(f.planted.x, f.planted.z)));
  }
}

// Five dashes in different directions, some while walking, some standing.
const dirs: [number, number, boolean][] = [[1, 0, false], [0, 1, true], [-1, 1, true], [0, -1, false], [1, 1, true]];
for (const [dx, dz, walking] of dirs) {
  for (let i = 0; i < 120 * 4; i++) step({ x: walking ? 0 : 0, z: walking ? 1 : 0, sprint: false }); // let charges come back
  const x0 = sim.pos.x, z0 = sim.pos.z;
  if (!dash.start(dx, dz)) problems.push(`a dash didn't start with ${dash.charges} charges`);
  const l = Math.hypot(dx, dz);
  // Measure the shove alone: walking adds its own speed, so subtract the walk's travel.
  let walk = 0;
  while (dash.active) { const h = sim.heading; step({ x: 0, z: walking ? 1 : 0, sprint: false }); walk += sim.speed * dt * ((Math.sin(h) * dx + Math.cos(h) * dz) / l); }
  const along = ((sim.pos.x - x0) * dx + (sim.pos.z - z0) * dz) / l - walk;
  covered.push(along);
  if (Math.abs(along - dv.dashDistance) > dv.dashDistance * 0.15) problems.push(`a dash covered ${along.toFixed(1)} m of ${dv.dashDistance}`);
}
// Charges: spend them all, the next is refused, then they come back.
for (let i = 0; i < 120 * 10; i++) step({ x: 0, z: 0, sprint: false });
let went = 0;
for (let k = 0; k < 4; k++) { if (dash.start(1, 0)) went++; while (dash.active || dash.since < dv.dashGap) step({ x: 0, z: 0, sprint: false }); }
if (went !== dv.dashCharges) problems.push(`${went} dashes went from full charges (expected ${dv.dashCharges})`);
for (let i = 0; i < 120 * (dv.dashRecharge * dv.dashCharges + 0.5); i++) step({ x: 0, z: 0, sprint: false });
if (dash.charges !== dv.dashCharges) problems.push(`charges came back to ${dash.charges} of ${dv.dashCharges}`);

const misses = sim.stats.overreach / Math.max(1, sim.stats.frames);
if (nan) problems.push(`${nan} NaN frames`);
if (worstFoot > 0.05) problems.push(`a skidding foot left the sand by ${worstFoot.toFixed(2)} m`);
if (misses > 0.15) problems.push(`legs out of reach ${(misses * 100).toFixed(1)}% of frames`);
console.log(`dash: covered ${covered.map((c) => c.toFixed(1)).join(", ")} m (of ${dv.dashDistance}) · skidding feet within ${worstFoot.toFixed(3)} m of the sand · reach misses ${(misses * 100).toFixed(2)}% · charges ${went}/${dv.dashCharges}`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("dash check failed"); }
console.log("dash check passed");
