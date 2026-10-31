// Lean probe (Keith 2026-10-31: "the mech could lean into it briefly when it changes direction"): the lean into a change
// of velocity (WalkerSim.accLean) at its peak, when, and how soon it's back under 1°, for a dash start and stop, a 180°
// WASD reversal, a 90° change and a sprint turn; plus the dash's rise (time to 90% and to full speed). The flat, the
// Rampart. Run: npx tsx tools/lean-probe.ts (LEAN_SET='{"leanPerAccel":0.1}' to try values).
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...JSON.parse(env.LEAN_SET ?? "{}") };
const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120, R2D = 180 / Math.PI;
type Cmd = { x: number; z: number; space: boolean };

function run(label: string, script: (t: number) => Cmd, mark: number, len: number) {
  const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
  const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
  for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: 1, sprint: false });
  let space = false, tot = 0, turnR = 0, peak = 0, peakT = 0, back = NaN, pP = 0, pR = 0, sp0 = 0, t90 = NaN, tFull = NaN;
  for (let t = 0; t < mark + len; t += dt) {
    const c = script(t);
    if (c.space && !space && d.start(c.x, c.z)) { s.dash(d.dirX, d.dirZ); sp0 = t; }
    space = c.space;
    b.update(dt, c.space, s, d); d.update(dt, 0);
    s.push.set(0, 0, 0);
    const was = s.inDash;
    s.update(dt, { x: c.x, z: c.z, sprint: false });
    if (was && !s.inDash && !b.on) d.cut();
    const speed = Math.hypot(s.vel.x + s.skid.x, s.vel.z + s.skid.z);
    if (label.startsWith("dash") && t < 0.3) {
      if (Number.isNaN(t90) && speed >= 0.9 * v.dashSpeedOut) t90 = t - sp0 + dt;
      if (Number.isNaN(tFull) && speed >= 0.995 * v.dashSpeedOut) tFull = t - sp0 + dt;
    }
    if (t < mark) continue;
    const m = Math.hypot(s.accLean.x, s.accLean.z) * R2D;
    tot = Math.max(tot, Math.hypot(s.bodyPitch, s.hullRoll) * R2D); turnR = Math.max(turnR, Math.abs(s.turnRoll) * R2D);
    if (m > peak) { peak = m; peakT = t - mark; pP = s.accPitch * R2D; pR = s.accRoll * R2D; back = NaN; }
    else if (Number.isNaN(back) && peak > 1 && m < 1) back = t - mark;
  }
  const rise = Number.isNaN(t90) ? "" : `  rise: 90% ${t90.toFixed(3)} s, full ${tFull.toFixed(3)} s`;
  console.log(`${label.padEnd(30)} peak ${peak.toFixed(1)}° at ${peakT.toFixed(2)} s (pitch ${pP.toFixed(1)}, roll ${pR.toFixed(1)}), under 1° by ${back.toFixed(2)} s; whole body ${tot.toFixed(1)}°${turnR > 0.5 ? `, turn roll ${turnR.toFixed(1)}°` : ""}${rise}`);
}

const ahead: Cmd = { x: 0, z: 1, space: false }, back: Cmd = { x: 0, z: -1, space: false }, right: Cmd = { x: -1, z: 0, space: false };
const tap = (c: Cmd): Cmd => ({ ...c, space: true });
run("dash ahead from the walk", (t) => (t < 0.08 ? tap(ahead) : ahead), 0, 0.4);
run("dash stop (tap, stick ahead)", (t) => (t < 0.08 ? tap(ahead) : ahead), 0.4, 0.8);
run("dash right from standing", (t) => (t < 0.08 ? tap(right) : { x: 0, z: 0, space: false }), 0, 0.4);
run("WASD 180° reversal", () => back, 0, 1);
run("WASD 90° change", () => right, 0, 1);
run("stop from the walk", () => ({ x: 0, z: 0, space: false }), 0, 1);
run("sprint turn 90° (2 s in)", (t) => (t < 2 ? tap(ahead) : tap(right)), 2, 1.5);
run("sprint let go", (t) => (t < 2 ? tap(ahead) : ahead), 2, 1.5);
