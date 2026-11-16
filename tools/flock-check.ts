// The small robots' flock (Keith 2026-11-16: "they don't seem to have a head ... don't swarm like a flock"). A pack of
// small runners comes in from 90 m at a still mech; measured while they run (before they reach it):
// - facing: how far a runner's head points off its run (must be small: they look where they go),
// - sweep: how far each run is off the straight line in; swing: how much the whole pack's way swings over time (the
//   weave: the flock sweeps as one, it doesn't beeline),
// - order: the pack's polarization, |mean of each runner's unit run| (1 all one way; must stay high: a flock),
// - spread: mean distance to the nearest neighbour (must stay above the hard gap: no pile-ups),
// - cost: the step's time with the flock on vs. the old values (crabbing, no cohesion, no weave), at 300 runners.
// Run: npm test (or npx tsx tools/flock-check.ts).
import { RobotSwarm, ROBOT_DEFAULTS, RUN, SMALL } from "../src/combat/robots";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };
const OLD = { robotRunTurn: 0, robotCarve: 0, robotCohesion: 0, robotWeave: 0, robotAlign: 0.35 };
const base = { robotQuadShare: 0, robotMidShare: 0, robotBigShare: 0, robotShooterShare: 0 };

function sd(a: number[]) { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); }

function run(over: Partial<typeof ROBOT_DEFAULTS>, n = 60, frames = 240) {
  const V = { ...ROBOT_DEFAULTS, ...base, ...over };
  const sw = new RobotSwarm(V, field, 17);
  sw.spawn(n, 0, 90, 10);
  const target = { x: 0, y: field.height(0, 0) + 2.5, z: 0, radius: 2 };
  const swing: number[] = [];
  let face = 0, sweep = 0, fn = 0, pol = 0, pn = 0, nn = 0, nnn = 0, ms = 0;
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    sw.update(1 / 30, target, () => {});
    ms += performance.now() - t0;
    if (f < 30) continue;
    let ux = 0, uz = 0, c = 0, gx = 0, gz = 0;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.kind[i] !== SMALL || sw.state[i] !== RUN) continue;
      const sp = Math.hypot(sw.vx[i], sw.vz[i]);
      if (sp < 2 || Math.hypot(sw.px[i], sw.pz[i]) < 20) continue;
      const vh = Math.atan2(sw.vx[i], sw.vz[i]);
      let d = vh - sw.heading[i]; d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      face += d; fn++;
      let w = vh - Math.atan2(-sw.px[i], -sw.pz[i]); sweep += Math.abs(Math.atan2(Math.sin(w), Math.cos(w)));
      ux += sw.vx[i] / sp; uz += sw.vz[i] / sp; gx += sw.px[i]; gz += sw.pz[i]; c++;
      let best = Infinity;
      for (let j = 0; j < sw.hi; j++) if (j !== i && sw.state[j] === RUN) best = Math.min(best, Math.hypot(sw.px[i] - sw.px[j], sw.pz[i] - sw.pz[j]));
      if (best < Infinity) { nn += best; nnn++; }
    }
    if (c > 5) {
      pol += Math.hypot(ux, uz) / c; pn++;
      // The pack's way vs. the line from its middle to the mech: the flock swinging as one.
      const w = Math.atan2(ux, uz) - Math.atan2(-gx / c, -gz / c);
      swing.push(Math.atan2(Math.sin(w), Math.cos(w)));
    }
  }
  return { face: fn ? (face / fn) * 180 / Math.PI : NaN, sweep: fn ? (sweep / fn) * 180 / Math.PI : NaN, order: pn ? pol / pn : NaN, spread: nnn ? nn / nnn : NaN, swing: sd(swing) * 180 / Math.PI, ms: ms / frames };
}

const now = run({}), old = run(OLD);
const f2 = (x: number) => x.toFixed(2);
console.log(`  flock now: head off its run ${f2(now.face)}°, run off the straight line in ${f2(now.sweep)}°, the pack's way swings ±${f2(now.swing)}°, order ${f2(now.order)}, nearest neighbour ${f2(now.spread)} m`);
console.log(`  old values: head off its run ${f2(old.face)}°, run off the straight line in ${f2(old.sweep)}°, the pack's way swings ±${f2(old.swing)}°, order ${f2(old.order)}, nearest neighbour ${f2(old.spread)} m`);
if (!(now.face < 20)) fail(`runners' heads point ${f2(now.face)}° off their run on average (want under 20°)`);
if (!(now.swing > old.swing + 3)) fail(`the pack's way swings ±${f2(now.swing)}°, the old ±${f2(old.swing)}° (want the weave to show)`);
if (!(now.order > 0.8)) fail(`the pack's order is ${f2(now.order)} (want over 0.8: a flock runs one way)`);
const gap = ROBOT_DEFAULTS.robotGap * ROBOT_DEFAULTS.robotSize * 2;
if (!(now.spread > gap)) fail(`nearest neighbour ${f2(now.spread)} m is under the hard gap ${f2(gap)} m (piled up)`);
// Cost at 300 (a big swarm), flock vs. old.
const bn = run({}, 300, 150), bo = run(OLD, 300, 150);
console.log(`  300 runners: ${bn.ms.toFixed(3)} ms a tick with the flock, ${bo.ms.toFixed(3)} ms with the old values`);
if (bn.ms > bo.ms * 1.5 + 0.2) fail(`the flock costs ${bn.ms.toFixed(3)} ms a tick vs ${bo.ms.toFixed(3)} (over 1.5×)`);

console.log(problems.length ? `flock-check: ${problems.length} problem(s)` : "flock-check: ok");
if (problems.length) process.exit(1);
