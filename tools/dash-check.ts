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
const dv = { ...DASH_DEFAULTS, dashSlope: 0 }; // distance on the dunes measured without the slope's pull
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
  const want = dv.dashDistance + (dv.dashCarry * dv.dashCarry) / (2 * dv.slideFriction); // the shove, then the glide out
  if (Math.abs(along - want) > want * 0.15) problems.push(`a dash covered ${along.toFixed(1)} m of ${want.toFixed(1)}`);
}
// Charges: spend them all, the next is refused, then they come back.
for (let i = 0; i < 120 * 10; i++) step({ x: 0, z: 0, sprint: false });
let went = 0;
for (let k = 0; k < 4; k++) { if (dash.start(1, 0)) went++; while (dash.active || dash.since < dv.dashGap) step({ x: 0, z: 0, sprint: false }); }
if (went !== dv.dashCharges) problems.push(`${went} dashes went from full charges (expected ${dv.dashCharges})`);
for (let i = 0; i < 120 * (dv.dashRecharge * dv.dashCharges + 0.5); i++) step({ x: 0, z: 0, sprint: false });
if (dash.charges !== dv.dashCharges) problems.push(`charges came back to ${dash.charges} of ${dv.dashCharges}`);

// Slope (Keith 2026-10-25: slides work better downhill): on a tilted plane a dash goes further down than up.
function onSlope(dirZ: number) {
  const g = 0.25; // rises along +z
  const plane = { height: (_x: number, z: number) => g * z, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { const l = Math.hypot(g, 1); o[0] = 0; o[1] = 1 / l; o[2] = -g / l; return o; } };
  const s2 = new WalkerSim(v, plane);
  s2.reset(0, 0, 0);
  const d2 = new Dash({ ...DASH_DEFAULTS });
  for (let i = 0; i < 60; i++) s2.update(dt, { x: 0, z: 0, sprint: false });
  const z0 = s2.pos.z;
  d2.start(0, dirZ);
  let t = 0;
  while ((d2.active || t < 0.1) && t < 20) {
    d2.update(dt, d2.dirZ > 0 ? g : -g);
    s2.push.set(d2.vx, 0, d2.vz); s2.crouch = d2.crouch;
    s2.update(dt, { x: 0, z: 0, sprint: false });
    t += dt;
  }
  return Math.abs(s2.pos.z - z0);
}
const up = onSlope(1), down = onSlope(-1);
if (!(down > up * 1.3)) problems.push(`downhill dash ${down.toFixed(1)} m not clearly longer than uphill ${up.toFixed(1)} m`);

// Walls (Keith 2026-10-26: dashing at a steep wall flung the mech so high it died landing): running at a 40-60° face
// 2 or 8 m high and dashing at its foot (the shove's peak hits the face), the hips never rise more than WALL_RISE over
// standing above the ground under them, and nothing lands hard. Before the fix the worst case rose 354 m.
const WALL_RISE = 2.5;
let wallWorst = 0, wallWorstAt = "";
for (const H of [2, 8]) for (const deg of [40, 50, 60]) for (const before of [0.5, 2]) {
  const k = Math.tan((deg * Math.PI) / 180);
  const h = (_x: number, z: number) => Math.min(H, Math.max(0, (z - 30) * k));
  const wall = { height: h, normal: (x: number, z: number, o: number[] = [0, 0, 0]) => { const e = 0.05, dz = (h(x, z + e) - h(x, z - e)) / (2 * e), l = Math.hypot(dz, 1); o[0] = 0; o[1] = 1 / l; o[2] = -dz / l; return o; } };
  const s3 = new WalkerSim(v, wall);
  s3.reset(0, 0, 0);
  const d3 = new Dash({ ...DASH_DEFAULTS });
  let rise = 0, worst = 0, went = false;
  s3.onLand = (l) => { worst = Math.max(worst, l.impact); };
  for (let i = 0; i < 120 * 8; i++) {
    if (!went && s3.pos.z > 30 - before) went = d3.start(0, 1);
    const gz = (h(0, s3.pos.z + 2) - h(0, s3.pos.z - 2)) / 4;
    d3.update(dt, gz);
    s3.push.set(d3.vx, 0, d3.vz); s3.crouch = d3.crouch;
    s3.update(dt, { x: 0, z: 1, sprint: true });
    rise = Math.max(rise, s3.pelvis.y - h(0, s3.pos.z) - v.hipHeight);
    if (!Number.isFinite(s3.pelvis.y)) { problems.push(`NaN dashing into a ${deg}° wall`); break; }
  }
  const what = `${H} m at ${deg}°, dash ${before} m out`;
  if (rise > wallWorst) { wallWorst = rise; wallWorstAt = what; }
  if (rise > WALL_RISE) problems.push(`dashing into a wall (${what}) rose ${rise.toFixed(1)} m over standing (limit ${WALL_RISE})`);
  if (worst >= v.landHard) problems.push(`dashing into a wall (${what}) landed at ${worst.toFixed(1)} m/s`);
}
const wallRises = [`worst ${wallWorst.toFixed(1)} m (${wallWorstAt})`];

const misses = sim.stats.overreach / Math.max(1, sim.stats.frames);
if (nan) problems.push(`${nan} NaN frames`);
if (worstFoot > 0.05) problems.push(`a skidding foot left the sand by ${worstFoot.toFixed(2)} m`);
if (misses > 0.15) problems.push(`legs out of reach ${(misses * 100).toFixed(1)}% of frames`);
console.log(`dash on a 14° slope: up ${up.toFixed(1)} m, down ${down.toFixed(1)} m · into walls, hips over standing at most: ${wallRises.join(", ")}`);
console.log(`dash: covered ${covered.map((c) => c.toFixed(1)).join(", ")} m (of ${dv.dashDistance}) · skidding feet within ${worstFoot.toFixed(3)} m of the sand · reach misses ${(misses * 100).toFixed(2)}% · charges ${went}/${dv.dashCharges}`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("dash check failed"); }
console.log("dash check passed");
