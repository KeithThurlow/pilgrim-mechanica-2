// Stride probe (Keith 2026-11-16: the sprint looked like running on the spot): per foot, where it plants and lifts
// along the line of run relative to the hips (m, + ahead), the stride (plant to plant, same foot) and the stance's
// ground under the hips, for the walk and the sprint. Numbers only. Run: npx tsx tools/stride-probe.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Bound, BOUND_DEFAULTS } from "../src/mech/bound";

const flat = { height: () => 0, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dt = 1 / 120;
// SET="runSteps:1.5,runStepsTop:2" overrides values (for trying a change before it goes in).
const SET: Record<string, number> = Object.fromEntries((process.env.SET ?? "").split(",").filter(Boolean).map((p) => { const [k, x] = p.split(":"); return [k, Number(x)]; }));

export function strides(leg: string, sprint: boolean, secs = 6, from = 3) {
  const v = { ...WALKER_DEFAULTS, ...LEG_TYPES[leg].values, ...SET };
  const s = new WalkerSim(v, flat as never); s.reset(0, 0, 0);
  const d = new Dash({ ...DASH_DEFAULTS }); const b = new Bound({ ...BOUND_DEFAULTS });
  const cmd = { x: 0, z: 1, sprint: false };
  for (let i = 0; i < 120; i++) s.update(dt, cmd);
  if (sprint) { d.start(0, 1); s.dash(d.dirX, d.dirZ); }
  const was = s.feet.map(() => false), plantAt = s.feet.map(() => NaN), plantPos = s.feet.map(() => NaN);
  const rows: { plant: number; lift: number; stride: number; stanceRun: number; slip?: number }[] = [];
  let t = 0, maxBack = 0, maxFwd = 0, speed = 0, n = 0;
  while (t < secs) {
    if (sprint) { b.update(dt, true, s, d); d.update(dt, 0); }
    s.push.set(0, 0, 0);
    const w = s.dashing; s.update(dt, cmd); if (w && !s.dashing) d.cut();
    t += dt;
    s.feet.forEach((f, i) => {
      const planted = !f.swinging && f.bState === 0 && !(s as unknown as { airborne: boolean }).airborne;
      const rel = f.pos.z - s.pelvis.z;
      if (t > from) { maxBack = Math.min(maxBack, rel); maxFwd = Math.max(maxFwd, rel); }
      if (planted && !was[i]) { if (t > from && Number.isFinite(plantPos[i])) rows.push({ plant: rel, lift: NaN, stride: f.pos.z - plantPos[i], stanceRun: NaN, slip: NaN }); plantAt[i] = s.pelvis.z; plantPos[i] = f.pos.z; }
      if (!planted && was[i] && t > from && rows.length) { const r = rows[rows.length - 1]; r.lift = rel; r.stanceRun = s.pelvis.z - plantAt[i]; r.slip = f.pos.z - plantPos[i]; }
      was[i] = planted;
    });
    if (t > from) { speed += s.speed; n++; }
  }
  const avg = (k: keyof (typeof rows)[0]) => rows.filter((r) => Number.isFinite(r[k])).reduce((a, r, _, A) => a + r[k] / A.length, 0);
  return { speed: speed / n, plant: avg("plant"), lift: avg("lift"), stride: avg("stride"), stanceRun: avg("stanceRun"), slip: avg("slip" as never), maxBack, maxFwd, steps: rows.length, overreach: s.stats.overreach, cps: (s as unknown as { cpsNow: number }).cpsNow, duty: (s as unknown as { dutyNow: number }).dutyNow };
}

if (process.argv[1]?.endsWith("stride-probe.ts")) {
  for (const leg of ["rampart", "rampart-stilt", "rampart-siege"].filter((l) => LEG_TYPES[l])) for (const sp of [false, true]) {
    const r = strides(leg, sp);
    console.log(`${leg.padEnd(14)} ${sp ? "sprint" : "walk  "} ${r.speed.toFixed(1)} m/s | foot plants ${r.plant.toFixed(2)} lifts ${r.lift.toFixed(2)} (reach ${r.maxFwd.toFixed(2)} / ${r.maxBack.toFixed(2)}) | stride ${r.stride.toFixed(2)} m, hips over stance ${r.stanceRun.toFixed(2)} m, foot slides ${r.slip.toFixed(2)} m, ${r.steps} steps, cps ${r.cps.toFixed(2)} duty ${r.duty.toFixed(2)} overreach ${r.overreach}`);
  }
}
