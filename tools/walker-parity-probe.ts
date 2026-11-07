// Prints a hash of every joint of the walker over a few runs and how many ground reads it made: for checking a
// speed-up in the walker leaves its poses bit-for-bit the same (run it before and after the change, compare the lines).
// npx tsx tools/walker-parity-probe.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const runs: { name: string; seconds: number; cmd: (t: number) => { x: number; z: number; sprint: boolean } }[] = [
  { name: "wander", seconds: 30, cmd: (t) => ({ x: Math.sin(t * 0.3), z: Math.cos(t * 0.21), sprint: false }) },
  { name: "sprint", seconds: 20, cmd: (t) => ({ x: Math.sin(t * 0.17), z: 1, sprint: true }) },
  { name: "start and stop", seconds: 20, cmd: (t) => (t % 6 < 3.5 ? { x: -0.6, z: 0.8, sprint: false } : { x: 0, z: 0, sprint: false }) },
  { name: "steep dunes", seconds: 30, cmd: (t) => ({ x: Math.cos(t * 0.11), z: Math.sin(t * 0.13), sprint: t % 10 > 6 }) },
];
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
let h = 2166136261;
const mix = (x: number) => { f64[0] = x; h = Math.imul(h ^ u32[0], 16777619); h = Math.imul(h ^ u32[1], 16777619); };
for (const leg of ["rampart", "standin"] as const) for (const r of runs) {
  const terrain = { ...TERRAIN_DEFAULTS };
  if (r.name === "steep dunes") { terrain.height *= 1.8; terrain.bumps *= 2; }
  const field = new DuneField(terrain);
  let reads = 0;
  const ground = { height: (x: number, z: number) => { reads++; return field.height(x, z); } };
  const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES[leg].values }, new Proxy(field, { get: (t, k) => (k === "height" ? ground.height : (t as never)[k]) }));
  sim.reset(13, -40, 0.3);
  h = 2166136261;
  const dt = 1 / 60, n = Math.round(r.seconds / dt);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    sim.update(dt, r.cmd(i * dt));
    mix(sim.pos.x); mix(sim.pos.y); mix(sim.pos.z); mix(sim.heading);
    for (const f of sim.feet) for (const p of [f.pose.hip, f.pose.knee, f.pose.hock, f.pose.ankle, f.pos]) { mix(p.x); mix(p.y); mix(p.z); }
  }
  console.log(`${leg} ${r.name}: hash ${(h >>> 0).toString(16)} · ${Math.round(reads / n)} ground reads a frame · ${((performance.now() - t0) / n).toFixed(3)} ms a frame`);
}
