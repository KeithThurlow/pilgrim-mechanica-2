import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";
const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;
const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: 1, sprint: false });
d.start(1, 0); s.dash(1, 0);
for (let t = 0; t < 0.8; t += dt) {
  b.update(dt, t < 0.08, s, d); d.update(dt, 0); s.push.set(0, 0, 0);
  const c = t < 0.2 ? { x: 1, z: 0 } : { x: 0, z: 1 };
  s.update(dt, { ...c, sprint: false });
  const i = Math.round(t / dt);
  if (i % 4 === 0) console.log(t.toFixed(3), s.dashing ? "D" : s.inDash ? "B" : s.running ? "R" : "W", (s.vel.x + s.skid.x).toFixed(2), (s.vel.z + s.skid.z).toFixed(2), "skid", s.skid.x.toFixed(2), s.skid.z.toFixed(2));
}
