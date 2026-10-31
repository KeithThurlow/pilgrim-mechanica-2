// Grip probe (Keith 2026-10-31: "as the velocity of the mech reduces, the traction returns"): the lateral response (how
// fast the motion across the stick is taken away, m/s²) against time and speed after a dash, after letting go of a
// sprint and during the sprint. On the flat, the Rampart. Run: npx tsx tools/grip-probe.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";

const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...JSON.parse((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.GRIP_SET ?? "{}") };
const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;
type Cmd = { x: number; z: number; space: boolean };

/** Lateral response samples: t (s from the mark), ground speed, motion across the stick, its fall rate (m/s²). */
export function gripTrace(script: (t: number) => Cmd, mark: number, len: number) {
  const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
  const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
  for (let i = 0; i < 240; i++) s.update(dt, { x: 0, z: 1, sprint: false });
  const out: { t: number; speed: number; across: number; resp: number; inDash: boolean; running: boolean }[] = [];
  let space = false, prevAcross = 0;
  for (let t = 0; t < mark + len; t += dt) {
    const c = script(t);
    if (c.space && !space && d.start(0, 1)) s.dash(d.dirX, d.dirZ);
    space = c.space;
    b.update(dt, c.space, s, d); d.update(dt, 0);
    s.push.set(0, 0, 0);
    const was = s.inDash;
    s.update(dt, { x: c.x, z: c.z, sprint: false });
    if (was && !s.inDash && !b.on) d.cut();
    const l = Math.hypot(c.x, c.z) || 1, mx = s.vel.x + s.skid.x, mz = s.vel.z + s.skid.z;
    // Across the stick; with the stick off, the whole motion (the stop).
    const across = Math.hypot(c.x, c.z) < 0.05 ? Math.hypot(mx, mz) : Math.abs((mx * -c.z + mz * c.x) / l);
    if (t >= mark) out.push({ t: t - mark, speed: Math.hypot(mx, mz), across, resp: (prevAcross - across) / dt, inDash: s.inDash, running: s.running });
    prevAcross = across;
  }
  return out;
}

function table(label: string, rows: ReturnType<typeof gripTrace>) {
  console.log(label);
  // Averages over 0.05 s windows, while there's motion across the stick to take away.
  const W = Math.round(0.05 / dt);
  const line: string[] = [];
  for (let i = 1; i + W <= rows.length; i += W) {
    const w = rows.slice(i, i + W);
    if (w[0].across < 0.3) break;
    const r = w.reduce((a, x) => a + x.resp, 0) / W;
    line.push(`${w[0].t.toFixed(2)}s ${w[0].speed.toFixed(1)}m/s ${r.toFixed(0)}`);
  }
  console.log("  " + (line.length ? line.join(" | ") : "(nothing across the stick)"));
}

const ahead: Cmd = { x: 0, z: 1, space: false }, right: Cmd = { x: 1, z: 0, space: false };
// A tapped dash ahead; the stick turned right at the press, mid-hold, at the start of the stop, and as it ends.
for (const at of [0.3, 0.5, 0.65]) table(`dash ahead (tap), stick right from ${at} s (t from then, speed, lateral m/s²):`,
  gripTrace((t) => (t < 0.08 ? { ...ahead, space: true } : t < at ? ahead : right), at, 1.5));
// A sprint: dash held 2.5 s, then let go of Space with the stick turned right at once, or held ahead 0.3 s first.
table("sprint 2.5 s, let go with the stick right:", gripTrace((t) => (t < 2.5 ? { ...ahead, space: true } : right), 2.5, 2));
table("sprint 2.5 s, let go, stick ahead 0.3 s then right:", gripTrace((t) => (t < 2.5 ? { ...ahead, space: true } : t < 2.8 ? ahead : right), 2.8, 2));
table("sprint 2.5 s, let go and the stick off:", gripTrace((t) => (t < 2.5 ? { ...ahead, space: true } : { x: 0, z: 0, space: false }), 2.5, 2));
{
  // The run-on: let go of Space with the stick held ahead: time and ground until the walk's speed.
  const r = gripTrace((t) => (t < 2.5 ? { ...ahead, space: true } : ahead), 2.5, 4);
  const i = r.findIndex((x) => x.speed <= 6.05);
  const m = r.slice(0, i < 0 ? r.length : i).reduce((a, x) => a + x.speed * dt, 0);
  console.log(`run-on, let go with the stick ahead: from ${r[0].speed.toFixed(1)} m/s to the walk in ${i < 0 ? "never" : (i * dt).toFixed(2) + " s"}, ${m.toFixed(1)} m`);
}
// During the sprint: held, the stick turned right after 2 s (sideways pull = speed × the run line's turn rate).
{
  const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
  const d = new Dash({ ...DASH_DEFAULTS }), b = new Bound({ ...BOUND_DEFAULTS });
  if (d.start(0, 1)) s.dash(0, 1);
  const out: string[] = [];
  let prev = 0;
  for (let t = 0; t < 4.5; t += dt) {
    b.update(dt, true, s, d); d.update(dt, 0); s.push.set(0, 0, 0);
    const c = t < 2 ? { x: 0, z: 1 } : { x: Math.sin(t * 3), z: Math.cos(t * 3) };
    s.update(dt, { ...c, sprint: false });
    const course = Math.atan2(s.vel.x, s.vel.z), sp = Math.hypot(s.vel.x, s.vel.z);
    if (t > 2 && Math.round(t / dt) % 24 === 0) out.push(`${sp.toFixed(1)}m/s ${(Math.abs(((course - prev + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) / dt * sp).toFixed(1)}`);
    prev = course;
  }
  console.log("during the sprint, stick circling (speed, sideways pull m/s²):\n  " + out.join(" | "));
}
