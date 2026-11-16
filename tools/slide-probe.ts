// Grip probe (Keith 2026-11-16: "movement can still feel a little funky... not enough grip"): numbers for how far the
// Rampart slides when it stops, turns and lets go, walking, on the Shift run, sprinting and after a dash, on the flat.
// Numbers only. Run: npx tsx tools/slide-probe.ts [key:value,...] (walker values overridden, e.g. boundGrip:1)
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";

const over: Record<string, number> = {};
for (const kv of (process.argv[2] ?? "").split(",").filter(Boolean)) { const [k, x] = kv.split(":"); over[k] = Number(x); }
const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...over };
const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;

class Rig {
  s = new WalkerSim({ ...v }, flat as never); d = new Dash({ ...DASH_DEFAULTS, ...over }); b = new Bound({ ...BOUND_DEFAULTS, ...over });
  t = 0; slideMax = 0;
  constructor() { this.s.reset(0, 0, 0); }
  step(cmd: MoveCommand, space = false) {
    this.b.update(dt, space, this.s, this.d); this.d.update(dt, 0);
    this.s.push.set(0, 0, 0);
    const was = this.s.dashing;
    this.s.update(dt, cmd);
    if (was && !this.s.dashing) this.d.cut();
    this.t += dt;
    for (const f of this.s.feet) this.slideMax = Math.max(this.slideMax, Math.hypot(f.slide.x, f.slide.z));
  }
  get speed() { return Math.hypot(this.s.vel.x + this.s.skid.x, this.s.vel.z + this.s.skid.z); }
  run(sec: number, cmd: MoveCommand, space = false) { for (let i = 0; i < sec / dt; i++) this.step(cmd, space); }
  /** Until speed ≤ to (or max s): seconds and ground covered. */
  until(cmd: MoveCommand, to: number, space = false, max = 6) {
    const x0 = this.s.pos.x, z0 = this.s.pos.z, t0 = this.t; this.slideMax = 0;
    while (this.t - t0 < max) { this.step(cmd, space); if (this.speed <= to) break; }
    return `${(this.t - t0).toFixed(2)} s, ${Math.hypot(this.s.pos.x - x0, this.s.pos.z - z0).toFixed(1)} m, feet slide ≤${this.slideMax.toFixed(1)} m/s`;
  }
  sprint(sec = 3) { this.run(0.5, W); this.d.start(0, 1); this.s.dash(this.d.dirX, this.d.dirZ); this.run(sec, W, true); }
}
const W: MoveCommand = { x: 0, z: 1, sprint: false }, WS: MoveCommand = { ...W, sprint: true }, NONE: MoveCommand = { x: 0, z: 0, sprint: false };
const R: MoveCommand = { x: 1, z: 0, sprint: false }, BACK: MoveCommand = { x: 0, z: -1, sprint: false };

/** A turn at speed: time until the velocity points within 10° of the new way, and how far it carried on the old way. */
function turn(r: Rig, cmd: MoveCommand, space: boolean) {
  const z0 = r.s.pos.z, t0 = r.t; let zMax = z0; r.slideMax = 0;
  while (r.t - t0 < 6) {
    r.step(cmd, space);
    zMax = Math.max(zMax, r.s.pos.z);
    const vx = r.s.vel.x + r.s.skid.x, vz = r.s.vel.z + r.s.skid.z, sp = Math.hypot(vx, vz);
    if (sp > 0.5 && (vx * cmd.x + vz * cmd.z) / sp > Math.cos(10 * Math.PI / 180)) break;
  }
  return `${(r.t - t0).toFixed(2)} s, carried on ${(zMax - z0).toFixed(1)} m, feet slide ≤${r.slideMax.toFixed(1)} m/s`;
}

const rows: [string, () => string][] = [
  ["walk, let go: stop", () => { const r = new Rig(); r.run(2, W); return `${r.speed.toFixed(1)} m/s → ` + r.until(NONE, 0.3); }],
  ["shift run, let go: stop", () => { const r = new Rig(); r.run(2, WS); return `${r.speed.toFixed(1)} m/s → ` + r.until(NONE, 0.3); }],
  ["shift run, off shift: to walk", () => { const r = new Rig(); r.run(2, WS); return r.until(W, v.walkSpeed + 0.2); }],
  ["walk, 90° right", () => { const r = new Rig(); r.run(2, W); return turn(r, R, false); }],
  ["sprint, let go all: stop", () => { const r = new Rig(); r.sprint(); return `${r.speed.toFixed(1)} m/s → ` + r.until(NONE, 0.3); }],
  ["sprint, off space W held: walk", () => { const r = new Rig(); r.sprint(); return r.until(W, v.walkSpeed + 0.2); }],
  ["sprint, 90° right (space held)", () => { const r = new Rig(); r.sprint(); return turn(r, R, true); }],
  ["sprint, 90° right (space off)", () => { const r = new Rig(); r.sprint(); return turn(r, R, false); }],
  ["sprint, reverse (space off)", () => { const r = new Rig(); r.sprint(); return turn(r, BACK, false); }],
  ["dash tap, let go: stop", () => { const r = new Rig(); r.run(1, W); r.d.start(0, 1); r.s.dash(0, 1); r.run(0.06, W, true); return r.until(NONE, 0.3); }],
];
for (const [label, f] of rows) console.log(`${label.padEnd(32)} ${f()}`);
if (process.env.TRACE) {
  const r = new Rig(); r.run(0.5, W); r.d.start(0, 1); r.s.dash(0, 1);
  const out: string[] = [];
  for (let i = 0; i < 6 / dt; i++) { r.step(W, true); if (i % 30 === 29) out.push(`${r.t.toFixed(1)}:${r.speed.toFixed(1)}${r.s.running ? "" : "w"}`); }
  console.log("sprint speed:", out.join(" "), "boundTop", v.boundTop);
}
