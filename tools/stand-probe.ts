// Standing probe (Keith 2026-11-16: the standing stance looked off): after a walk and a stop, then standing a while,
// the hips' height, each foot's place from the hips (m: +x left, +z ahead) and the joint heights. Numbers only.
// Run: npx tsx tools/stand-probe.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { MECH_DEFAULTS } from "../src/game/mechUnit";

const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;
// As the labs build it: the walker's values, then the mech's (which used to carry the dash's own dashCrouch over it).
const v = { ...WALKER_DEFAULTS, ...MECH_DEFAULTS, ...LEG_TYPES.rampart.values };
const s = new WalkerSim(v as never, flat as never); s.reset(0, 0, 0);
const at = (label: string) => {
  const p = s.pelvis, f = s.feet.map((f) => `(${(f.pos.x - p.x).toFixed(2)}, ${(f.pos.z - p.z).toFixed(2)})`).join(" ");
  const k = s.feet.map((f) => `knee ${f.pose.knee.y.toFixed(2)} hock ${f.pose.hock.y.toFixed(2)}`).join(" | ");
  console.log(`${label.padEnd(16)} hips ${p.y.toFixed(2)} | feet ${f} | ${k}`);
};
for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: 0, sprint: false });
at("fresh, 2 s");
for (let i = 0; i < 360; i++) s.update(dt, { x: 0, z: 1, sprint: false });
for (let i = 0; i < 360; i++) s.update(dt, { x: 0, z: 0, sprint: false });
at("walk, stop 3 s");
for (let i = 0; i < 1200; i++) s.update(dt, { x: 0, z: 0, sprint: false });
at("stood 13 s");
// A tapped dash, then standing.
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";
{
  const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
  d.start(0, 1); s.dash(d.dirX, d.dirZ);
  for (let i = 0; i < 1200; i++) {
    const t = i * dt;
    b.update(dt, t < 0.08, s, d); d.update(dt, 0); s.push.set(0, 0, 0);
    const was = s.dashing; s.update(dt, { x: 0, z: 0, sprint: false }); if (was && !s.dashing) d.cut();
    if (i === 60 || i === 120 || i === 240 || i === 1199) at(`dash tap +${(t + dt).toFixed(1)} s`);
  }
}
console.log(`dashCrouch the walker sees: ${v.dashCrouch}`);
