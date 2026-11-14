// The ground read from a grid (src/world/groundGrid.ts): how far it sits from the exact ground, that a change shows
// when announced (and by itself after the time to live), and that a mech walking on it keeps its feet on the exact
// ground. Run: npx tsx tools/groundgrid-check.ts
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { GroundGrid } from "../src/world/groundGrid";

let failed = false;
const fail = (m: string) => { failed = true; console.log("  FAIL " + m); };
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// 1. Accuracy on the dunes: exact on nodes, close between them.
{
  const field = new DuneField({ ...TERRAIN_DEFAULTS }), grid = new GroundGrid(field);
  let worst = 0, sum = 0;
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * 600, z = (rnd() - 0.5) * 600;
    const d = Math.abs(grid.height(x, z) - field.heightExact(x, z));
    if (d > worst) worst = d;
    sum += d;
  }
  for (let i = 0; i < 2000; i++) {
    const x = Math.round((rnd() - 0.5) * 600) * 0.5, z = Math.round((rnd() - 0.5) * 600) * 0.5;
    if (grid.height(x, z) !== field.heightExact(x, z)) { fail(`a read on a node should be exact (${x}, ${z})`); break; }
  }
  console.log(`grid against the exact dunes over ${n} points: mean ${(sum / n * 1000).toFixed(1)} mm, worst ${(worst * 1000).toFixed(0)} mm`);
  if (worst > 0.15) fail(`worst ${worst.toFixed(3)} m off the exact ground (limit 0.15: the sharpest crests)`);
  if (sum / n > 0.008) fail(`mean ${(sum / n).toFixed(4)} m off (limit 0.008)`);
}

// 2. Changes: a dent appears. Announced, it shows at once; unannounced, within the time to live; clear() too.
{
  const field = new DuneField({ ...TERRAIN_DEFAULTS }), grid = new GroundGrid(field, 0.5, 30);
  field.grid = grid; field.gridReads = true;
  let depth = 0;
  field.dents = { at: (x, z) => (Math.hypot(x - 10, z - 10) < 6 ? -depth : 0) };
  const probe = () => { let w = 0; for (let i = 0; i < 400; i++) { const x = 2 + rnd() * 16, z = 2 + rnd() * 16; if (Math.abs(Math.hypot(x - 10, z - 10) - 6) < 1) continue; w = Math.max(w, Math.abs(field.height(x, z) - field.heightExact(x, z))); } return w; };
  probe();
  depth = 2;
  if (probe() < 1) fail("the unannounced dent should not show yet (is the grid on?)");
  grid.invalidate(4, 4, 16, 16);
  let w = probe();
  if (w > 0.08) fail(`after invalidate the dent should show: ${w.toFixed(2)} m off`);
  depth = 4;
  for (let i = 0; i < 30; i++) grid.tick();
  w = probe();
  if (w > 0.08) fail(`after the time to live the deeper dent should show: ${w.toFixed(2)} m off`);
  depth = 0; grid.clear();
  if (probe() > 0.08) fail("after clear() the ground should be the dunes again");
  // A huge box clears everything rather than walking it.
  depth = 3; grid.invalidate(-1e5, -1e5, 1e5, 1e5);
  let deep = 0; for (let i = 0; i < 50; i++) deep = Math.max(deep, field.heightExact(10, 10) - field.height(10, 10));
  if (Math.abs(deep) > 1e-9) fail("a huge invalidate should forget everything");
  field.gridReads = false;
  if (field.height(3.3, 4.4) !== field.heightExact(3.3, 4.4)) fail("with gridReads off, height is the exact ground");
  field.gridReads = true; field.grid = null;
  if (field.height(3.3, 4.4) !== field.heightExact(3.3, 4.4)) fail("with no grid, height is the exact ground");
}

// 3. A mech walking on the grid's ground: feet on the exact ground, the same walk.
{
  const run = (onGrid: boolean) => {
    const field = new DuneField({ ...TERRAIN_DEFAULTS });
    const grid = new GroundGrid(field);
    if (onGrid) { field.grid = grid; field.gridReads = true; }
    const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, field);
    sim.reset(13, -40, 0.3);
    const dt = 1 / 120;
    let under = 0, over = 0, steps = 0;
    const was = sim.feet.map(() => false);
    for (let i = 0; i < 60 * 120; i++) {
      if (i % 4 === 0) grid.tick();
      const a = i * dt * 0.15;
      sim.update(dt, { x: Math.sin(a) * 0.5, z: Math.cos(a) * 0.5, sprint: i > 30 * 120 });
      sim.feet.forEach((f, k) => {
        const g = field.heightExact(f.pos.x, f.pos.z);
        if (f.pos.y < g - 0.08) under++;
        if (!f.swinging && f.pos.y > g + 0.12) over++;
        if (f.swinging && !was[k]) steps++;
        was[k] = f.swinging;
      });
    }
    return { under, over, steps, x: sim.pos.x, z: sim.pos.z, stats: grid.takeStats() };
  };
  const a = run(false), b = run(true);
  console.log(`walker 60 s: exact ground ${a.steps} steps to ${a.x.toFixed(1)}, ${a.z.toFixed(1)}; on the grid ${b.steps} steps to ${b.x.toFixed(1)}, ${b.z.toFixed(1)}, ${b.stats.reads} reads from ${b.stats.made} heights; feet under ${a.under} / ${b.under}, planted over ${a.over} / ${b.over}`);
  if (b.under > a.under) fail(`feet more than 8 cm under the exact ground for ${b.under} foot-steps of the sim`);
  if (b.over > a.over * 1.1 + 20) fail(`planted feet more than 12 cm over the exact ground for ${b.over} foot-steps of the sim (${a.over} on the exact ground)`);
  if (Math.abs(a.steps - b.steps) > a.steps * 0.05) fail(`step count ${b.steps} against ${a.steps}`);
  if (Math.hypot(a.x - b.x, a.z - b.z) > 3) fail(`the walk ended ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)} m from the exact one`);
  if (b.stats.made > b.stats.reads * 0.2) fail(`the grid worked out ${b.stats.made} heights for ${b.stats.reads} reads: not saving`);
}
if (failed) { console.log("groundgrid: problems"); process.exit(1); }
console.log("groundgrid: ok");
