// Dash timing probe (Keith 2026-10-31: "Dash doesn't feel fast enough in its start and stop"): a tapped dash on the
// flat from standing and walking, every way: time from the press to peak speed, from the peak back to the walk's pace,
// and the ground it covers. Numbers only. Run: npx tsx tools/dash-probe.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";

const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;

interface DashTiming { peak: number; tPeak: number; t90: number; tBack: number; dist: number; sp: number[] }

/** A tapped dash (Space down holdS seconds) along dir, from standing or walking forward, with the stick as given. */
function tapDash(walk: boolean, dir: [number, number], stick: "dash" | "walk" | "none", holdS = 0.08): DashTiming {
  const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
  const d = new Dash({ ...DASH_DEFAULTS }); const b = new Bound({ ...BOUND_DEFAULTS });
  for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: walk ? 1 : 0, sprint: false });
  d.start(dir[0], dir[1]); s.dash(d.dirX, d.dirZ);
  let t = 0, px = s.pos.x, pz = s.pos.z, peak = 0, tPeak = 0, t90 = -1, tBack = -1;
  const sp: number[] = [];
  const l = Math.hypot(...dir);
  const cmd = stick === "dash" ? { x: dir[0] / l, z: dir[1] / l } : stick === "walk" ? { x: 0, z: walk ? 1 : 0 } : { x: 0, z: 0 };
  while (t < 3) {
    b.update(dt, t < holdS, s, d); d.update(dt, 0);
    s.push.set(0, 0, 0);
    const was = s.dashing;
    s.update(dt, { ...cmd, sprint: false });
    if (was && !s.dashing) d.cut();
    t += dt;
    const spd = Math.hypot(s.pos.x - px, s.pos.z - pz) / dt; px = s.pos.x; pz = s.pos.z;
    sp.push(spd);
    if (spd > peak) { peak = spd; tPeak = t; }
  }
  const target = Math.hypot(cmd.x, cmd.z) * v.walkSpeed;
  for (let i = 0; i < sp.length; i++) if (t90 < 0 && sp[i] >= 0.9 * peak) t90 = (i + 1) * dt;
  for (let i = Math.round(tPeak / dt); i < sp.length; i++) if (sp[i] <= target + 0.5) { tBack = (i + 1) * dt; break; }
  let dist = 0; for (let i = 0; i < (tBack > 0 ? Math.round(tBack / dt) : sp.length); i++) dist += sp[i] * dt;
  return { peak, tPeak, t90, tBack, dist, sp };
}

{
  const runs: [string, boolean, [number, number], "dash" | "walk" | "none"][] = [
    ["stand, fwd, stick along", false, [0, 1], "dash"],
    ["stand, fwd, stick off", false, [0, 1], "none"],
    ["stand, side, stick along", false, [1, 0], "dash"],
    ["walk, fwd, stick along", true, [0, 1], "dash"],
    ["walk, side, stick along", true, [1, 0], "dash"],
    ["walk, side, stick walks on", true, [1, 0], "walk"],
    ["walk, back, stick along", true, [0, -1], "dash"],
  ];
  for (const [label, walk, dir, stick] of runs) {
    const r = tapDash(walk, dir, stick);
    const row = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.2, 1.5, 2].map((q) => r.sp[Math.round(q / dt) - 1].toFixed(1)).join(" ");
    console.log(`${label.padEnd(27)} peak ${r.peak.toFixed(1)} at ${r.tPeak.toFixed(2)} s (90% by ${r.t90.toFixed(2)}) · back to walk ${(r.tBack - r.tPeak).toFixed(2)} s after (t ${r.tBack.toFixed(2)}) · ${r.dist.toFixed(1)} m · m/s at .05 .1 .2 .3 .5 .7 .9 1.2 1.5 2: ${row}`);
  }
}
