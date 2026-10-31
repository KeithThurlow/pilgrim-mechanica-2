// Drift probe (Keith 2026-10-31: "sometimes a drifting effect during the dash or during WASD that doesn't feel as good"):
// how long the body's velocity takes to come under the stick (within 0.5 m/s of stick × walk speed) after a tapped dash
// with the stick turned at various moments, and after quick WASD changes; the most skid seen. Run: npx tsx tools/drift-probe.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";

const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;
type Stick = (t: number) => { x: number; z: number };
function run(label: string, dashDir: [number, number] | null, stick: Stick, from = 0) {
  const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
  const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
  for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: 1, sprint: false });
  if (dashDir && d.start(dashDir[0], dashDir[1])) s.dash(d.dirX, d.dirZ);
  let t = 0, settled = -1, skidMax = 0, slideMax = 0;
  for (; t < 3; t += dt) {
    b.update(dt, dashDir !== null && t < 0.08, s, d); d.update(dt, 0);
    s.push.set(0, 0, 0);
    const c = stick(t), was = s.inDash;
    s.update(dt, { ...c, sprint: false });
    if (was && !s.inDash) d.cut();
    const wx = c.x * v.walkSpeed, wz = c.z * v.walkSpeed;
    const off = Math.hypot(s.vel.x + s.skid.x - wx, s.vel.z + s.skid.z - wz);
    if (t >= from) {
      skidMax = Math.max(skidMax, s.skid.length());
      // Sliding: the part of the motion across the stick, out of the dash.
      if (!s.inDash) slideMax = Math.max(slideMax, Math.abs((s.vel.x + s.skid.x) * -c.z + (s.vel.z + s.skid.z) * c.x));
    }
    if (t >= from && !s.inDash && off < 0.5) { if (settled < 0) settled = t; } else settled = -1;
  }
  console.log(`${label.padEnd(44)} under the stick from ${settled < 0 ? "never" : settled.toFixed(2) + " s"} · skid up to ${skidMax.toFixed(2)} m/s · across the stick out of the dash up to ${slideMax.toFixed(2)} m/s`);
}
run("dash right, stick right", [1, 0], () => ({ x: 1, z: 0 }));
run("dash right, stick up from 0.2 s", [1, 0], (t) => (t < 0.2 ? { x: 1, z: 0 } : { x: 0, z: 1 }));
run("dash right, stick up from 0.4 s", [1, 0], (t) => (t < 0.4 ? { x: 1, z: 0 } : { x: 0, z: 1 }));
run("dash right, stick down from 0.4 s", [1, 0], (t) => (t < 0.4 ? { x: 1, z: 0 } : { x: 0, z: -1 }));
run("dash right, stick let go", [1, 0], () => ({ x: 0, z: 0 }));
run("dash ahead, stick right from 0.3 s", [0, 1], (t) => (t < 0.3 ? { x: 0, z: 1 } : { x: 1, z: 0 }));
run("walk up, then right", null, () => ({ x: 1, z: 0 }));
run("walk up, right, down (0.25 s each)", null, (t) => (t < 0.25 ? { x: 1, z: 0 } : t < 0.5 ? { x: 0, z: -1 } : { x: -1, z: 0 }));
