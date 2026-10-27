// Headless dash check (Keith 2026-10-24: Space dodges or lunges the way WASD points, on charges; 2026-10-27: the dash
// as footwork, src/mech/dashSteps.ts). On the dunes, while walking and standing: a dash goes the way it was sent,
// planted feet stay on the sand, nothing goes NaN, legs stay within reach about as often as walking does, charges run
// out and come back. On the flat from standing, walking and the Shift run, every way and every point in the step: the
// hips never drop far, both feet are never up in the steps, the feet never splay across the dash, and the hips face the
// dash at the hand-over.
// Run: npm test (or npx tsx tools/dash-check.ts).
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { DuneField } from "../src/world/terrain";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";
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
// Ground a dash covers the way it was sent, the steps and the short sprint after them (Keith 2026-10-27: "a burst of
// speed for a distance of like 25-30m"): about dashRun, within this share.
const DASH_RUN_OFF = 0.4; // the dunes' slopes stretch and shorten it

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
  // The steps and the short sprint after them (the stick held the way of the dash, as a player does), until the walk.
  let t = 0;
  do { step({ x: dx / l, z: dz / l, sprint: false }); t += dt; } while ((sim.dashing || sim.running || t < 0.1) && t < 4);
  while (dash.active) step({ x: 0, z: 0, sprint: false });
  const along = ((sim.pos.x - x0) * dx + (sim.pos.z - z0) * dz) / l;
  covered.push(along);
  if (Math.abs(along - v.dashRun) > v.dashRun * DASH_RUN_OFF) problems.push(`a dash covered ${along.toFixed(1)} m the way it was sent (about ${v.dashRun})`);
}
// Charges: spend them all, the next is refused, then they come back.
for (let i = 0; i < 120 * 10; i++) step({ x: 0, z: 0, sprint: false });
// Each attempt waits for the last dash to end; since Keith's longer dash (1.05 s and its glide, 2026-10-26) a charge can
// recharge during the sequence, so the expectation counts the recharges that fit between the first dash and each attempt
// (the check used to assume none would).
let went = 0, expected = 0, t0 = -1, clockT = 0;
for (let k = 0; k < 4; k++) {
  const ok = dash.start(1, 0);
  if (t0 < 0) t0 = clockT;
  // Charges available at this attempt: the full set, plus one per recharge since the first dash, less the ones spent.
  if (went < dv.dashCharges + Math.floor((clockT - t0) / dv.dashRecharge + 1e-6)) expected++;
  if (ok) went++;
  while (dash.active || dash.since < dv.dashGap) { step({ x: 0, z: 0, sprint: false }); clockT += dt; }
}
if (went !== expected || went < dv.dashCharges) problems.push(`${went} dashes went from full charges (expected ${expected}: ${dv.dashCharges} charges and the recharges in between)`);
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
// 1.15 since the dash became footwork and a short sprint (2026-10-27): the old glide that carried far downhill is gone.
if (!(down > up * 1.15)) problems.push(`downhill dash ${down.toFixed(1)} m not clearly longer than uphill ${up.toFixed(1)} m`);

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

// The dash as a push-off (Keith 2026-10-26 18:28: "some weird splits"): from every point in the step cycle and in every
// direction, the feet never end up further apart than SPREAD, and once the slide has stopped the mech is back in its gait
// with its feet under it within RECOVER seconds. On the flat, walking and standing.
const SPREAD = v.dashSpreadMax + 0.15, RECOVER = 0.6, RUN_BY = 0.8;
/** How far apart the feet are across the dash (along it a running stride is long; across it would be the splits). */
const across = (s: WalkerSim, dx: number, dz: number) => { const l = Math.hypot(dx, dz), [a, b] = s.feet; return Math.abs(((a.pos.x - b.pos.x) * -dz + (a.pos.z - b.pos.z) * dx) / l); };
const flatG = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
let spreadWorst = 0, spreadAt = "", recoverWorst = 0, dashes = 0;
for (const walking of [true, false]) for (let ph = 0; ph < 8; ph++) for (const [ddx, ddz, name] of [[0, 1, "ahead"], [1, 0, "left"], [-1, 0, "right"], [0, -1, "back"], [0.7, 0.7, "diagonal"]] as const) {
  const s4 = new WalkerSim(v, flatG);
  s4.reset(0, 0, 0);
  const d4 = new Dash({ ...DASH_DEFAULTS });
  const cmd = { x: 0, z: walking ? 1 : 0, sprint: false };
  // Walk (or stand) into the cycle, a different share of a step each time.
  for (let i = 0; i < 240 + ph * 9; i++) s4.update(dt, cmd);
  d4.start(ddx, ddz);
  let t = 0, glideEnd = -1, back = -1, worst = 0;
  while (t < 4) {
    d4.update(dt, 0);
    s4.push.set(d4.vx, 0, d4.vz); s4.crouch = d4.crouch;
    s4.update(dt, cmd);
    t += dt;
    const [a, b] = s4.feet;
    if (s4.dashing) worst = Math.max(worst, across(s4, ddx, ddz));
    if (glideEnd < 0 && !d4.active) glideEnd = t;
    if (glideEnd >= 0 && back < 0 && !s4.dashing) back = t - glideEnd;
    if (!Number.isFinite(s4.pelvis.y + a.pose.knee.x + b.pose.knee.x)) { problems.push(`NaN in a dash ${name}`); break; }
  }
  dashes++;
  const what = `${walking ? "walking" : "standing"}, ${ph}/8 into the step, dash ${name}`;
  if (worst > spreadWorst) { spreadWorst = worst; spreadAt = what; }
  recoverWorst = Math.max(recoverWorst, back < 0 ? 99 : back);
  if (worst > SPREAD) problems.push(`${what}: feet ${worst.toFixed(2)} m apart across the dash (limit ${SPREAD.toFixed(2)})`);
  if (back < 0 || back > RECOVER) problems.push(`${what}: not back in its gait ${RECOVER} s after the slide (${back < 0 ? "never" : back.toFixed(2) + " s"})`);
}
console.log(`dash from ${dashes} points in the step and directions: feet at most ${spreadWorst.toFixed(2)} m apart across it (${spreadAt}) · back in its gait at most ${recoverWorst.toFixed(2)} s after the slide`);

// Held through the dash (Keith: "if it's a long press... this actually becoming a run rather than a sliding dash"): the
// run takes over at the through-step (RUN_BY), no faster than dashIntoRun, and the run's footfalls alternate.
{
  const s5 = new WalkerSim(v, flatG);
  s5.reset(0, 0, 0);
  const d5 = new Dash({ ...DASH_DEFAULTS });
  const b5 = new Bound({ ...BOUND_DEFAULTS });
  for (let i = 0; i < 240; i++) s5.update(dt, { x: 0, z: 1, sprint: false });
  d5.start(0, 1);
  let t = 0, runAt = -1, fastest = 0, worst = 0;
  const falls: number[] = [];
  s5.onFootfall = (f) => { if (runAt >= 0) falls.push(f.side); };
  while (t < 3) {
    b5.update(dt, true, s5, d5);
    d5.update(dt, 0);
    s5.push.set(d5.vx, 0, d5.vz); s5.crouch = d5.crouch;
    s5.update(dt, { x: 0, z: 1, sprint: false });
    t += dt;
    if (runAt < 0 && s5.running) { runAt = t; fastest = s5.boundSpeed; }
    if (s5.dashing) worst = Math.max(worst, across(s5, 0, 1));
  }
  let repeats = 0;
  for (let i = 1; i < falls.length; i++) if (falls[i] === falls[i - 1]) repeats++;
  if (runAt < 0 || runAt > RUN_BY) problems.push(`held dash: the run started ${runAt < 0 ? "never" : `after ${runAt.toFixed(2)} s`}`);
  if (fastest > v.dashIntoRun + 0.5) problems.push(`held dash: the run started at ${fastest.toFixed(1)} m/s (most ${v.dashIntoRun})`);
  if (repeats > 1) problems.push(`held dash: ${repeats} footfalls by the same foot twice running`);
  if (worst > SPREAD) problems.push(`held dash: feet ${worst.toFixed(2)} m apart across it`);
  console.log(`held dash: running after ${runAt.toFixed(2)} s at ${fastest.toFixed(1)} m/s · ${falls.length} footfalls in the next ${(3 - runAt).toFixed(1)} s, ${repeats} repeats · feet at most ${worst.toFixed(2)} m apart`);
}

// The steps (Keith 2026-10-27): from standing, walking and the Shift run, every way, at points through the step: the hips
// never more than HIP_DROP under standing height, never both feet up before the hand-over, the hips facing the dash
// within FACE degrees when it comes (by HAND_BY seconds), and no dip after it in the short sprint.
const HIP_DROP = 1.1, FACE = 10, HAND_BY = 1.3; // a cutback backpedals first
{
  let lowest = 9, lowestAt = "", bothWorst = 0, faceWorst = 0, handWorst = 0, n = 0;
  for (const pace of ["stand", "walk", "run"] as const) for (let ph = 0; ph < 6; ph++)
  for (const [ddx, ddz, name] of [[0, 1, "ahead"], [1, 0, "left"], [-1, 0, "right"], [0, -1, "back"], [0.7, 0.7, "diagonal"], [-0.7, -0.7, "back right"]] as const) {
    const s6 = new WalkerSim(v, flatG);
    s6.reset(0, 0, 0);
    const d6 = new Dash({ ...DASH_DEFAULTS });
    const move = { x: 0, z: pace === "stand" ? 0 : 1, sprint: pace === "run" };
    for (let i = 0; i < 300 + ph * 11; i++) s6.update(dt, move);
    d6.start(ddx, ddz);
    const l = Math.hypot(ddx, ddz), go = { x: ddx / l, z: ddz / l, sprint: pace === "run" };
    let t = 0, both = 0, low = 9, hand = -1, face = 0;
    while (t < 2.5) {
      d6.update(dt, 0);
      s6.push.set(d6.vx, 0, d6.vz);
      const was = s6.dashing;
      s6.update(dt, go);
      t += dt;
      if (s6.dashing && s6.feet[0].swinging && s6.feet[1].swinging) both++;
      if (was && !s6.dashing && hand < 0) { hand = t; face = Math.abs(Math.atan2(Math.sin(s6.heading - Math.atan2(ddx, ddz)), Math.cos(s6.heading - Math.atan2(ddx, ddz)))) * 180 / Math.PI; }
      if (!s6.airborne) low = Math.min(low, s6.pelvis.y);
    }
    n++;
    const what = `${pace}, ${ph}/6 into the step, dash ${name}`;
    if (low < lowest) { lowest = low; lowestAt = what; }
    bothWorst = Math.max(bothWorst, both); faceWorst = Math.max(faceWorst, face); handWorst = Math.max(handWorst, hand < 0 ? 99 : hand);
    if (low < v.hipHeight - HIP_DROP) problems.push(`${what}: hips down to ${low.toFixed(2)} m`);
    if (both > 0) problems.push(`${what}: both feet up for ${both} frames in the steps`);
    if (hand < 0 || hand > HAND_BY) problems.push(`${what}: ${hand < 0 ? "never handed over" : `handed over after ${hand.toFixed(2)} s`}`);
    else if (face > FACE) problems.push(`${what}: facing ${face.toFixed(0)}° off the dash at the hand-over`);
  }
  console.log(`dash steps from ${n} starts: hips at least ${lowest.toFixed(2)} m (${lowestAt}) · both feet up ${bothWorst} frames · handed over by ${handWorst.toFixed(2)} s, facing within ${faceWorst.toFixed(0)}°`);
}

// Reversing mid-dash (Keith 2026-10-27: the dash is "the one way you can change direction immediately"; a reverse dash
// sometimes didn't win): from points through a dash and its short sprint (up to the boost's peak), a dash straight back
// always goes the new way within TURN_BY, the hips never drop past HIP_DROP, and it runs off the new way.
const TURN_BY = 0.5;
{
  let worstTurn = 0, low = 9, fast = 0;
  for (const after of [0.2, 0.4, 0.6, 0.7, 0.9, 1.2, 1.6]) {
    const s7 = new WalkerSim(v, flatG);
    s7.reset(0, 0, 0);
    for (let i = 0; i < 240; i++) s7.update(dt, { x: 0, z: 1, sprint: false });
    s7.dash(0, 1);
    let t = 0, went = -1, turned = false, v0 = 0;
    for (; t < after + 2.5; t += dt) {
      if (!turned && t >= after) { v0 = s7.vel.z; turned = s7.dash(0, -1); if (!turned) { problems.push(`a dash back ${after} s into a dash was refused`); break; } }
      s7.update(dt, turned ? { x: 0, z: -1, sprint: false } : { x: 0, z: 1, sprint: false });
      if (turned) { if (went < 0 && s7.vel.z < 0) went = t - after; if (!s7.airborne) low = Math.min(low, s7.pelvis.y); }
    }
    fast = Math.max(fast, v0);
    if (turned && (went < 0 || went > TURN_BY)) problems.push(`a dash back ${after} s into a dash (at ${v0.toFixed(1)} m/s) went the new way ${went < 0 ? "never" : `after ${went.toFixed(2)} s`}`);
    if (turned) worstTurn = Math.max(worstTurn, went < 0 ? 99 : went);
  }
  if (low < v.hipHeight - HIP_DROP) problems.push(`dashing back mid-dash: hips down to ${low.toFixed(2)} m`);
  console.log(`dash back mid-dash (up to ${fast.toFixed(1)} m/s): the new way within ${worstTurn.toFixed(2)} s, hips at least ${low.toFixed(2)} m`);
}

const misses = sim.stats.overreach / Math.max(1, sim.stats.frames);
if (nan) problems.push(`${nan} NaN frames`);
if (worstFoot > 0.05) problems.push(`a skidding foot left the sand by ${worstFoot.toFixed(2)} m`);
if (misses > 0.15) problems.push(`legs out of reach ${(misses * 100).toFixed(1)}% of frames`);
console.log(`dash on a 14° slope: up ${up.toFixed(1)} m, down ${down.toFixed(1)} m · into walls, hips over standing at most: ${wallRises.join(", ")}`);
console.log(`dash: covered ${covered.map((c) => c.toFixed(1)).join(", ")} m the way it was sent (about ${v.dashRun}) · skidding feet within ${worstFoot.toFixed(3)} m of the sand · reach misses ${(misses * 100).toFixed(2)}% · charges ${went}/${dv.dashCharges}`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("dash check failed"); }
console.log("dash check passed");
