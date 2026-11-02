// Headless hover legs check (src/mech/hover.ts, Keith 2026-11-02): fly the walker on hover legs over the dunes and fail
// on what must never happen: feet or hips in the sand, legs out of reach of the hanging feet, nothing finite, a stop
// that never comes; and the loadout rule: heavy hulls refused on hover legs, hover legs refused under a heavy hull.
// Prints the feel numbers (top speed, time to it, coast to a stop, dash distance, ride height, bob).
// Run: npm test (or npx tsx tools/hover-check.ts).
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { defaultLoadout, fit, fitProblem, resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";
import { BASE_BY_ID } from "../src/items/bases";

let failed = false;
const must = (ok: boolean, msg: string) => { if (!ok) { failed = true; console.log("  FAIL " + msg); } };

// ---- The flight ----
const legs = BASE_BY_ID["legs-hover"];
const stat = (k: string) => legs.stats[k].base;
const values = { ...WALKER_DEFAULTS, ...LEG_TYPES[legs.look].values, walkSpeed: stat("walkSpeed"), sprintSpeed: stat("sprintSpeed"), turnRate: stat("turnRate"), hover: 1 };
const dt = 1 / 120;
const field = new DuneField({ ...TERRAIN_DEFAULTS });
const reach = values.femur + values.shin + values.cannon + values.ankleHeight + 0.05;

interface Seg { s: number; x: number; z: number; run?: boolean; boost?: boolean; dash?: [number, number] }
function fly(name: string, segs: Seg[], at: [number, number] = [13, -40]) {
  const sim = new WalkerSim({ ...values }, field);
  sim.reset(at[0], at[1], 0.3);
  let t = 0, minClear = Infinity, maxClear = -Infinity, under = 0, nan = 0, stretch = 0, top = 0;
  const log: { t: number; speed: number; x: number; z: number }[] = [];
  for (const g of segs) {
    if (g.dash) sim.dash(g.dash[0], g.dash[1]);
    for (let i = 0; i < g.s / dt; i++, t += dt) {
      sim.bound = !!g.boost;
      sim.update(dt, { x: g.x, z: g.z, sprint: !!g.run });
      const gy = field.height(sim.pos.x, sim.pos.z), clear = sim.pelvis.y - gy;
      if (t > 1.5) { minClear = Math.min(minClear, clear); maxClear = Math.max(maxClear, clear); }
      top = Math.max(top, sim.speed);
      for (const f of sim.feet) {
        if (!Number.isFinite(f.pos.y) || !Number.isFinite(f.pose.knee.y)) nan++;
        if (f.pos.y < field.height(f.pos.x, f.pos.z) - 0.01) under++;
        if (f.pose.hip.distanceTo(f.pos) > reach) stretch++;
      }
      log.push({ t, speed: sim.speed, x: sim.pos.x, z: sim.pos.z });
    }
  }
  must(sim.hovering, `${name}: not hovering`);
  must(nan === 0, `${name}: ${nan} non-finite frames`);
  must(under === 0, `${name}: ${under} foot-frames under the sand`);
  must(stretch === 0, `${name}: ${stretch} foot-frames out of the leg's reach`);
  must(minClear >= values.hipHeight * 0.75 - 1e-6, `${name}: hips ${minClear.toFixed(2)} m over the sand (floor ${(values.hipHeight * 0.75).toFixed(2)})`);
  return { sim, log, minClear, maxClear, top };
}

const H = values.hipHeight;
console.log(`-- hover legs (${legs.look} legs; walk ${values.walkSpeed} m/s, run ${values.sprintSpeed}, boost ${Math.max(values.sprintSpeed, values.boundTop)})`);
{
  // Off from a stand, across the dunes, then let go.
  const r = fly("cruise", [{ s: 12, x: 0.3, z: 1 }, { s: 10, x: 0, z: 0 }]);
  const to90 = r.log.find((l) => l.speed > values.walkSpeed * 0.9)?.t ?? NaN;
  const letGo = r.log.findIndex((l) => l.t >= 12);
  const stop = r.log.slice(letGo).find((l) => l.speed < 0.1);
  const coast = stop ? Math.hypot(stop.x - r.log[letGo].x, stop.z - r.log[letGo].z) : NaN;
  console.log(`  walk: 90% of speed in ${to90.toFixed(2)} s; let go: stops in ${stop ? (stop.t - 12).toFixed(2) : "never"} s over ${coast.toFixed(1)} m`);
  console.log(`  hips ride ${(r.minClear - H).toFixed(2)}..${(r.maxClear - H).toFixed(2)} m above standing height over the dunes (lift ${values.hoverLift}, bob ±${values.hoverBob})`);
  must(!!stop, "cruise: never comes to a stop after letting go");
  must(to90 < 3, `cruise: ${to90.toFixed(2)} s to walk speed (too sluggish)`);
}
{
  // Reversal at the run: how wide it drifts.
  const r = fly("reverse", [{ s: 5, x: 1, z: 0, run: true }, { s: 5, x: -1, z: 0, run: true }]);
  const i = r.log.findIndex((l) => l.t >= 5);
  let far = 0;
  for (const l of r.log.slice(i)) far = Math.max(far, l.x - r.log[i].x);
  console.log(`  run ${r.log[i].speed.toFixed(1)} m/s reversed: drifts on ${far.toFixed(1)} m before coming back`);
}
{
  // A dash then held into the boost.
  const r = fly("dash", [{ s: 1, x: 0, z: 0 }, { s: 1.2, x: 0, z: 0, dash: [0, 1] }]);
  const a = r.log.findIndex((l) => l.t >= 1), b = r.log.length - 1;
  console.log(`  dash from a stand: ${Math.hypot(r.log[b].x - r.log[a].x, r.log[b].z - r.log[a].z).toFixed(1)} m in 1.2 s, peak ${r.top.toFixed(1)} m/s`);
  const bo = fly("boost", [{ s: 0.5, x: 0, z: 1, boost: true, dash: [0, 1] }, { s: 6, x: 0, z: 1, boost: true }]);
  console.log(`  boost: ${bo.top.toFixed(1)} m/s at the top`);
  must(bo.top > values.sprintSpeed, "boost: never past the run speed");
}
{
  // A drop (a crane letting go) is caught by the drive, not landed on.
  const sim = new WalkerSim({ ...values }, field);
  sim.reset(13, -40, 0.3);
  sim.update(dt, { x: 0, z: 0, sprint: false });
  // Thrown 12 m/s up (a blast under it): it rises, sinks back softly and rides on.
  sim.launch(0, 12, 0);
  let lands = 0, high = 0, fall = 0;
  sim.onLand = () => lands++;
  for (let i = 0; i < 8 / dt; i++) {
    const y0 = sim.pelvis.y;
    sim.update(dt, { x: 0, z: 0, sprint: false });
    high = Math.max(high, sim.pelvis.y - field.height(sim.pos.x, sim.pos.z) - H);
    fall = Math.max(fall, (y0 - sim.pelvis.y) / dt);
  }
  const settled = sim.pelvis.y - field.height(sim.pos.x, sim.pos.z) - H;
  console.log(`  thrown up 12 m/s: rises ${high.toFixed(1)} m, sinks at most ${fall.toFixed(1)} m/s, rides ${settled.toFixed(2)} m up after 8 s`);
  must(lands === 0, "drop: landed instead of hovering");
  must(high > 3, "drop: the launch didn't throw it");
  must(Math.abs(settled - values.hoverLift) < values.hoverBob + 0.3, "drop: never settled back onto the cushion");
  // Hover switched off: it drops and walks.
  sim.v.hover = 0;
  for (let i = 0; i < 4 / dt; i++) sim.update(dt, { x: 0, z: 1, sprint: false });
  must(!sim.hovering && sim.stats.steps > 0, "hover off: never walked again");
}

// ---- The loadout rule ----
{
  const lo = defaultLoadout();
  const hover = makeItem("legs-hover");
  must(!!fitProblem(lo, "legs", hover), "hover legs fitted under the Rampart hull");
  const salv = { ...defaultLoadout(), hull: makeItem("hull-salvager") };
  must(!fitProblem(salv, "legs", hover), "hover legs refused under the Salvager hull");
  fit(lo, "hull", makeItem("hull-cuirass"));
  must(!fitProblem(lo, "legs", hover), "hover legs refused under the Cuirass hull");
  fit(lo, "legs", hover);
  for (const h of ["hull-rampart", "hull-siege"]) must(!!fitProblem(lo, "hull", makeItem(h)), `${h} fitted on hover legs`);
  must(resolve(lo).values.hover === 1, "hover legs don't resolve to the hover drive");
  must(resolve(defaultLoadout()).values.hover === 0, "Rampart legs resolve to the hover drive");
  console.log(`  fit: ${fitProblem(defaultLoadout(), "legs", hover)}`);
}

if (failed) { console.log("hover check FAILED"); process.exit(1); }
console.log("hover check ok");
