// Knockback check (Keith 2026-11-06: "on explosions and getting knocked back, you can end up drifting too much"). A
// blast's shove (shoveFrom → WalkerSim.knock) skids the mech and the feet dig in at knockGrip; it used to get the
// sprint's low grip at that speed (a 22 m/s shove drifted 21 m). Must: big shoves still move it a few metres (it's felt)
// but settle within the limits below, standing or walking across the push; and crest jumps still happen on the dunes.
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const base = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const dt = 1 / 120;
const problems: string[] = [];
/** Blast speed (m/s) → most metres pushed, least metres pushed, most seconds to settle. */
const LIMIT: Record<number, [number, number, number]> = { 8: [2, 0.2, 0.5], 16: [5, 1.5, 0.8], 22: [8, 3, 1] };

for (const speed of [8, 16, 22]) for (const walk of [false, true]) {
  const sim = new WalkerSim({ ...base }, flat); sim.reset(0, 0, 0);
  const stick = { x: 0, z: walk ? 1 : 0, sprint: false };
  for (let i = 0; i < 240; i++) sim.update(dt, stick);
  const x0 = sim.pos.x;
  sim.knock(speed, 0);
  let settle = NaN;
  for (let t = dt; t < 6; t += dt) { sim.update(dt, stick); if (isNaN(settle) && Math.abs(sim.vel.x + sim.skid.x) < 0.5) settle = t; }
  const pushed = sim.pos.x - x0, [most, least, by] = LIMIT[speed];
  console.log(`  ${speed} m/s ${walk ? "walking" : "standing"}: pushed ${pushed.toFixed(1)} m, settled in ${settle.toFixed(2)} s`);
  if (pushed > most || pushed < least) problems.push(`${speed} m/s ${walk ? "walking" : "standing"}: pushed ${pushed.toFixed(1)} m (want ${least}-${most})`);
  if (!(settle <= by)) problems.push(`${speed} m/s: settles in ${settle.toFixed(2)} s (want under ${by})`);
}

// Jumps over the dunes: the Shift run at the sprint's top speed over the default dunes leaves the ground now and then.
{
  const dunes = new DuneField({ ...TERRAIN_DEFAULTS });
  const sim = new WalkerSim({ ...base, sprintSpeed: base.boundTop }, dunes); sim.reset(0, 0, 0);
  let air = 0;
  for (let i = 0; i < 40 * 120; i++) { sim.update(dt, { x: 0.3, z: 1, sprint: true }); if (sim.airborne) air += dt; }
  console.log(`  dunes at ${base.boundTop} m/s for 40 s: ${sim.stats.takeoffs} take-offs, ${air.toFixed(1)} s in the air`);
  if (sim.stats.takeoffs < 1) problems.push("no crest jumps on the dunes at the sprint's top speed");
}
if (problems.length) { for (const p of problems) console.error("FAIL " + p); process.exit(1); }
console.log("knock-check: ok");
