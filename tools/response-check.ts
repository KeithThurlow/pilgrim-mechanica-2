// Walk response check (Keith 2026-10-31: "you need to actually move in the direction you press. Turn times are making
// it feel bad"). The walk is twin-stick: the body's velocity goes where WASD points within a fraction of a second, the
// legs turn after it and never gate it. Must: reach 90% of walk speed from rest, after a 90° change and after a 180°
// reversal within the limits below; stop quickly; and through a run of hard direction changes (strafes, reversals,
// zig-zags) keep the legs in reach, the feet out of the ground, planted feet from sliding far and the feet from crossing
// over. Rampart legs and the lightest and heaviest leg items, flat ground.
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const base = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const dt = 1 / 120;
const problems: string[] = [];
const verbose = false;

/** Limits (s) for 90% of walk speed in the new direction, and for a stop to 10%. */
const LIMIT = { start: 0.3, turn90: 0.3, turn180: 0.45, stop: 0.25 };

const cmdOf = (deg: number, sprint = false): MoveCommand => ({ x: Math.sin(deg * Math.PI / 180), z: Math.cos(deg * Math.PI / 180), sprint });

/** Seconds until the velocity along `deg` reaches 90% of walk speed (or the speed falls to 10%, for a stop). */
function timeTo(sim: WalkerSim, cmd: MoveCommand, stop = false, max = 4) {
  const ux = cmd.x, uz = cmd.z, ws = sim.v.walkSpeed;
  for (let i = 1; i <= max * 120; i++) {
    sim.update(dt, cmd);
    const along = sim.vel.x * ux + sim.vel.z * uz, sp = Math.hypot(sim.vel.x, sim.vel.z);
    if (stop ? sp <= 0.1 * ws : along >= 0.9 * ws) return i * dt;
  }
  return Infinity;
}

function walking(v: typeof base, deg = 0, seconds = 2) {
  const sim = new WalkerSim({ ...v }, flat);
  sim.reset(0, 0, deg * Math.PI / 180);
  for (let i = 0; i < seconds * 120; i++) sim.update(dt, cmdOf(deg));
  return sim;
}

function response(name: string, v: typeof base) {
  const rest = new WalkerSim({ ...v }, flat); rest.reset(0, 0, 0);
  for (let i = 0; i < 120; i++) rest.update(dt, { x: 0, z: 0, sprint: false });
  const start = timeTo(rest, cmdOf(0));
  const turn90 = timeTo(walking(v), cmdOf(90));
  const turn180 = timeTo(walking(v), cmdOf(180));
  const stop = timeTo(walking(v), { x: 0, z: 0, sprint: false }, true);
  return { name, start, turn90, turn180, stop };
}

const fmt = (s: number) => (isFinite(s) ? s.toFixed(2) : "never");
const rows = [
  response("rampart", base),
  response("light legs (accel 3.8)", { ...base, accel: 3.8, walkSpeed: 7.2 }),
  response("heavy legs (accel 2.2)", { ...base, accel: 2.2, walkSpeed: 5 }),
];
for (const r of rows) {
  console.log(`  ${r.name}: start ${fmt(r.start)} s, 90° ${fmt(r.turn90)} s, 180° ${fmt(r.turn180)} s, stop ${fmt(r.stop)} s`);
  // The heaviest legs may be a share slower (the weight slider), never more than half again.
  const k = r.name.startsWith("heavy") ? 1.5 : 1;
  for (const key of ["start", "turn90", "turn180", "stop"] as const) {
    if (r[key] > LIMIT[key] * k) problems.push(`${r.name}: ${key} took ${fmt(r[key])} s (limit ${(LIMIT[key] * k).toFixed(2)})`);
  }
}

// Hard direction changes: the gait keeps up. A seeded run of stick directions held 0.25-0.9 s each.
function scramble(v: typeof base, seed: number, seconds: number, face?: number) {
  const sim = walking(v, 0, 1);
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const over0 = sim.stats.overreach;
  let under = 0, slideMax = 0, cross = 0, t = 0, deg = 0, hold = 0;
  const prev = sim.feet.map((f) => f.planted.clone());
  const wasSwing = sim.feet.map((f) => f.swinging);
  for (let i = 0; i < seconds * 120; i++) {
    if (t >= hold) { deg = [90, -90, 180, 135, -135, 45][Math.floor(rnd() * 6)] + deg; hold = 0.25 + rnd() * 0.65; t = 0; }
    const stopNow = rnd() < 0.002;
    sim.update(dt, stopNow ? { x: 0, z: 0, sprint: false, face } : { ...cmdOf(deg), face });
    t += dt;
    sim.feet.forEach((f, k) => {
      if (f.pos.y < flat.height(f.pos.x, f.pos.z) - 0.03) under++;
      // A planted foot that was planted last frame too: how far its spot moved (a slide).
      if (!f.swinging && !wasSwing[k]) slideMax = Math.max(slideMax, Math.hypot(f.planted.x - prev[k].x, f.planted.z - prev[k].z) / dt);
      prev[k].copy(f.planted); wasSwing[k] = f.swinging;
    });
    // Crossed over: the left foot (side +1) to the right of the right foot, across the hips' line.
    const lx = Math.cos(sim.heading), lz = -Math.sin(sim.heading);
    const [a, b] = sim.feet;
    const sep = ((a.pos.x - b.pos.x) * lx + (a.pos.z - b.pos.z) * lz) * a.side;
    if (sep < -0.1) cross++;
  }
  return { over: sim.stats.overreach - over0, under, slideMax, cross };
}
// Crossed feet come with any hard turn (the legs swing round over planted feet for a moment): before the twin-stick
// walk this scramble crossed them 250-590 frames in 3600; keep it under a tenth of the time.
for (const [name, v] of [["rampart", base], ["heavy legs", { ...base, accel: 2.2, walkSpeed: 5 }]] as const) {
  for (const face of [undefined, 0]) for (const seed of [1, 7, 42]) {
    const r = scramble(v, seed, 30, face);
    const tag = `scramble ${name}${face === undefined ? "" : " (torso fixed, backsteps)"} seed ${seed}`;
    if (verbose || seed === 1) console.log(`  ${tag}: out of reach ${r.over} frames, under ${r.under}, planted slide max ${r.slideMax.toFixed(2)} m/s, crossed ${r.cross} frames`);
    if (r.over > 30) problems.push(`${tag}: legs out of reach ${r.over} frames`);
    if (r.under > 0) problems.push(`${tag}: a foot under the sand ${r.under} frames`);
    if (r.slideMax > 0.5) problems.push(`${tag}: a planted foot slid at ${r.slideMax.toFixed(2)} m/s`);
    if (r.cross > 360) problems.push(`${tag}: feet crossed over ${r.cross} frames`);
  }
}

if (problems.length) {
  console.log("response-check: FAIL");
  for (const p of problems) console.log("  - " + p);
  throw new Error("response check failed");
}
console.log("response-check: ok");
