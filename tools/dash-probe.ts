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

// Keith 2026-10-31 ("drifty afterwards... more grip at the dash so you can exit out of it easier"): after a tapped dash
// with the stick across it (or back): seconds from the hold's end until the motion is the stick's walk (within 0.5 m/s),
// and the most speed across the stick 0.15 s or more after the hold's end. And Space held this long: sprint or not.
{
  const hold = Math.max(0.005, v.dashRise) + v.dashHold;
  const runs: [string, boolean, number, { x: number; z: number }][] = [
    ["stand, dash fwd, stick right throughout", false, 0, { x: -1, z: 0 }],
    ["walk, dash fwd, stick right from 0.2 s", true, 0.2, { x: -1, z: 0 }],
    ["walk, dash fwd, stick back from 0.2 s", true, 0.2, { x: 0, z: -1 }],
  ];
  for (const [label, walk, stickAt, after] of runs) {
    const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
    const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
    for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: walk ? 1 : 0, sprint: false });
    d.start(0, 1); s.dash(d.dirX, d.dirZ);
    let under = -1, slide = 0;
    for (let t = 0; t < 2; t += dt) {
      b.update(dt, t < 0.08, s, d); d.update(dt, 0); s.push.set(0, 0, 0);
      const c = t < stickAt ? { x: 0, z: 1 } : after;
      s.update(dt, { ...c, sprint: false });
      const mx = s.vel.x + s.skid.x, mz = s.vel.z + s.skid.z;
      const off = Math.hypot(mx - c.x * v.walkSpeed, mz - c.z * v.walkSpeed);
      if (t >= hold && off < 0.5) { if (under < 0) under = t - hold; } else under = -1;
      if (t >= hold + 0.15) slide = Math.max(slide, Math.abs(mx * -c.z + mz * c.x));
    }
    console.log(`${label.padEnd(40)} under the stick ${under.toFixed(2)} s after the hold's end (${hold.toFixed(3)} s) · across the stick from +0.15 s: ${slide.toFixed(2)} m/s`);
  }
  for (const held of [0.1, 0.2, 0.3, 0.35, 0.5]) {
    const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
    const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
    d.start(0, 1); s.dash(d.dirX, d.dirZ);
    let on = -1;
    for (let t = 0; t < 1; t += dt) { b.update(dt, t < held, s, d); d.update(dt, 0); s.push.set(0, 0, 0); s.update(dt, { x: 0, z: 1, sprint: false }); if (b.on && on < 0) on = t; }
    console.log(`Space held ${held.toFixed(2)} s: ${on < 0 ? "tapped dash (hard stop)" : `sprint from ${on.toFixed(3)} s`}`);
  }
}
