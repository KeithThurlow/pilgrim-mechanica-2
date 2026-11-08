// The game clock (src/core/clock.ts; docs/architecture-review.md stage 1). Checks:
// 1. Fixed mode: over any run of frame times the ticks run add up to the real time (to under one tick), at most
//    maxTicks a frame, alpha in 0..1, a long stall drops time instead of spiralling, rate groups fire one tick in n.
// 2. Frame-rate independence: a robot camp fight (spawns, hits, a moving target) driven through a fixed 60 Hz clock
//    gives the same swarm, bit for bit, whether the page draws at 30, 60, 144 or 240 fps or a jittery mix (review
//    finding F1; the old frame-locked clock is gone, Keith 2026-11-07).
// Run: npm test (or npx tsx tools/clock-check.ts).
import { Clock } from "../src/core/clock";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { RobotSwarm, ROBOT_DEFAULTS, type RobotTarget } from "../src/combat/robots";
import { TRAMPLE_DEFAULTS } from "../src/combat/trample";
import { packRobots } from "../src/sim/robotsRemote";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };

// Frame-time sequences (s): steady rates and a jittery mix with the odd hitch.
function frames(kind: string, total: number): number[] {
  const out: number[] = [];
  let seed = 99, t = 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  while (t < total) {
    const f = kind === "jitter" ? (rnd() < 0.02 ? 0.09 : 1 / (40 + rnd() * 200)) : 1 / Number(kind);
    out.push(f); t += f;
  }
  return out;
}

// 1. The clock alone.
{
  for (const kind of ["30", "60", "144", "240", "jitter"]) {
    const c = new Clock(60);
    let real = 0, ticks = 0, worst = 0;
    for (const f of frames(kind, 20)) {
      const n = c.run(f, () => {});
      real += f; ticks += n; worst = Math.max(worst, n);
      if (c.alpha < 0 || c.alpha > 1) fail(`${kind}: alpha ${c.alpha}`);
    }
    const lost = real - c.dropped - ticks / 60;
    if (lost < -1e-6 || lost >= 1 / 60 + 1e-6) fail(`${kind}: ticks ${ticks} for ${real.toFixed(3)} s (${c.dropped.toFixed(3)} dropped): off by ${lost}`);
    if (worst > c.maxTicks) fail(`${kind}: ${worst} ticks in one frame`);
    console.log(`  clock ${kind.padStart(6)} fps: ${ticks} ticks for ${real.toFixed(2)} s, most in a frame ${worst}, dropped ${c.dropped.toFixed(2)} s`);
  }
  const c = new Clock(60);
  const n = c.run(2, () => {});
  if (n !== c.maxTicks || c.dropped < 1.9) fail(`a 2 s stall ran ${n} ticks, dropped ${c.dropped}`);
  let hits = 0;
  for (let i = 0; i < 120; i++) c.run(1 / 60, () => { if (c.every(4, 1)) hits++; });
  if (hits !== 30) fail(`every(4) fired ${hits} times in 120 ticks`);
  if (new Clock().hz !== 30) fail("the default clock should be 30 Hz");
}

// 2. A fight driven through the clock.
function fight(hz: number, kind: string, seconds: number, stopAt = Infinity): { hash: string; ticks: number } {
  const V = { ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROBOT_DEFAULTS, ...TRAMPLE_DEFAULTS };
  const field = new DuneField(V);
  const sw = new RobotSwarm(V, field, 7);
  const clock = new Clock(hz);
  let seed = 5;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let time = 0;
  const tick = (dt: number) => {
    if (clock.tick >= stopAt) return;
    // Commands keyed to the tick number, as a host would apply them.
    const k = clock.tick;
    const base: RobotTarget = { x: 30 * Math.sin(time * 0.2), y: 0, z: 30 * Math.cos(time * 0.2), radius: 2 };
    base.y = field.height(base.x, base.z) + 2.5;
    if (k === 3) sw.spawn(60, 25, 20, 12, { mid: 0.15, big: 0.05, bigMin: 1 });
    if (k % 9 === 0 && sw.hi) sw.damage(Math.floor(rnd() * sw.hi), 30, 1, 0);
    sw.update(dt, base, () => {});
    time += dt;
  };
  for (const f of frames(kind, seconds * 2)) { clock.run(f, tick); if (clock.tick >= stopAt || (stopAt === Infinity && time >= seconds)) break; }
  const s = packRobots(sw);
  let h = 2166136261;
  for (const key of Object.keys(s.arrays).sort()) {
    const a = s.arrays[key] as unknown as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) { h = Math.imul(h ^ Math.round((a[i] || 0) * 1e6), 16777619) >>> 0; }
  }
  return { hash: `${s.hi}:${h.toString(16)}`, ticks: clock.tick };
}

{
  const ref = fight(60, "60", 12);
  for (const kind of ["30", "144", "240", "jitter"]) {
    // Same number of ticks: run the frames until the clock reaches the reference's tick count.
    const r = fight(60, kind, 12, ref.ticks);
    if (r.hash !== ref.hash) fail(`fixed 60 Hz at ${kind} fps: swarm ${r.hash} vs ${ref.hash} at 60 fps`);
    else console.log(`  fixed 60 Hz, drawn at ${kind.padStart(6)} fps: same swarm (${r.hash}) after ${r.ticks} ticks`);
  }
}

if (problems.length) { console.log(`clock: ${problems.length} problem(s)`); process.exit(1); }
console.log("clock: ok");
