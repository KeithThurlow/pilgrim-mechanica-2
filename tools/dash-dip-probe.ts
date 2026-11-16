// Dash crouch probe (Keith 2026-11-16: the mech dips into the dash, stands back up into the sprint): hip height below
// the standing walk over a tapped dash and a held one (into the sprint), forward and sideways. Numbers only.
// Run: npx tsx tools/dash-dip-probe.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";

const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;

export function dipTrace(hold: number, dir: [number, number], over = 1.6) {
  const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
  const d = new Dash({ ...DASH_DEFAULTS }); const b = new Bound({ ...BOUND_DEFAULTS });
  for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: 1, sprint: false });
  const ref = (s as unknown as { bodyY: { x: number } }).bodyY.x;
  d.start(dir[0], dir[1]); s.dash(d.dirX, d.dirZ);
  const l = Math.hypot(...dir), cmd = { x: dir[0] / l, z: dir[1] / l, sprint: false };
  const out: { t: number; dip: number; sp: number }[] = [];
  let t = 0, px = s.pos.x, pz = s.pos.z;
  while (t < over) {
    b.update(dt, t < hold, s, d); d.update(dt, 0); s.push.set(0, 0, 0);
    const was = s.dashing; s.update(dt, cmd); if (was && !s.dashing) d.cut();
    t += dt;
    const sp = Math.hypot(s.pos.x - px, s.pos.z - pz) / dt; px = s.pos.x; pz = s.pos.z;
    out.push({ t, dip: ref - (s as unknown as { bodyY: { x: number } }).bodyY.x, sp });
  }
  return out;
}

if (process.argv[1]?.endsWith("dash-dip-probe.ts")) {
  for (const [name, hold, dir] of [["tap fwd", 0.08, [0, 1]], ["tap side", 0.08, [1, 0]], ["hold fwd (sprint)", 9, [0, 1]]] as [string, number, [number, number]][]) {
    const tr = dipTrace(hold, dir);
    const row = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1.0, 1.3, 1.6].map((T) => { const r = tr[Math.round(T / dt) - 1]; return `${T}:${r.dip.toFixed(2)}/${r.sp.toFixed(0)}`; });
    const mx = tr.reduce((a, r) => (r.dip > a.dip ? r : a));
    console.log(`${name.padEnd(18)} max dip ${mx.dip.toFixed(2)} m at ${mx.t.toFixed(2)} s | t:dip/speed ${row.join(" ")}`);
  }
}
