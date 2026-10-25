// Headless check of the ground dents (src/fx/dentRule.ts, the CPU copy of the GPU pass) and of the detail patch's
// true-ground window (src/world/groundWindow.ts):
// - a print keeps its mass (berm volume about the depression's), relaxing without healing keeps it too, and it heals;
// - nothing ever goes NaN or past its clamps under random brushes;
// - the toroidal window: texels that scroll in are zeroed, and a dent stays where it was in the world;
// - the patch's ground matches DuneField.height (exactly at its vertices, within 2 cm between them) as it scrolls,
//   and its coarse grid is the chunks' (so the edge blend lands on them).
import { DentGrid, relaxRates, bermRatio, texelWorld, SURFACE_IDS, SET_RATES, type Brush, type RelaxRates } from "../src/fx/dentRule";
import { DENT_DEFAULTS } from "../src/fx/dents";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { GroundWindow } from "../src/world/groundWindow";

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };
const V = DENT_DEFAULTS;

function rates(texel: number, heal: boolean): RelaxRates[] {
  const f = (n: string) => ({
    depth: (V as Record<string, number>)[`dent${n}Depth`], berm: (V as Record<string, number>)[`dent${n}Berm`],
    soften: (V as Record<string, number>)[`dent${n}Soften`], slump: (V as Record<string, number>)[`dent${n}Slump`],
    life: heal ? (V as Record<string, number>)[`dent${n}Life`] : 0,
  });
  return [relaxRates(f("Sand"), texel), relaxRates(f("Dirt"), texel), relaxRates(f("Gravel"), texel), relaxRates(f("Snow"), texel), SET_RATES];
}
const brush = (x: number, z: number, r: number, yaw: number, elong: number, dep: number, share = 1, mode = 0): Brush => ({
  x, z, r, elong, sy: Math.sin(yaw), cy: Math.cos(yaw), dep, berm: dep * share * bermRatio(elong), comp: 0.6, surf: SURFACE_IDS.sand, seed: 0, mode,
});
const sumNet = (g: DentGrid) => { const v = g.volumes(); return v.berm - v.dep; };

// 1. One print keeps its mass.
{
  const g = new DentGrid(160, 16, rates(0.1, false));
  g.step(0, []);
  g.step(0.016, [brush(0.3, -0.2, 0.45, 0.4, 1.42, 0.1)]);
  const v = g.volumes();
  ok(Math.abs(v.berm - v.dep) / v.dep < 0.06, `print keeps its mass: depression ${(v.dep * 1000).toFixed(1)} l, berm ${(v.berm * 1000).toFixed(1)} l`);
  const r = brush(0, 0, 0.3, 1.1, 4, 0.06);
  const g2 = new DentGrid(160, 16, rates(0.1, false));
  g2.step(0, []); g2.step(0.016, [r]);
  const v2 = g2.volumes();
  ok(Math.abs(v2.berm - v2.dep) / v2.dep < 0.06, `rut (elongation 4) keeps its mass: ${(v2.dep * 1000).toFixed(1)} l vs ${(v2.berm * 1000).toFixed(1)} l`);

  // 2. Relaxing without healing keeps (berm - depression); the edges soften.
  const net0 = sumNet(g), dep0 = g.volumes().dep;
  let peak0 = 0;
  for (let i = 0; i < g.a.length; i += 4) peak0 = Math.max(peak0, g.a[i + 1]);
  for (let t = 0; t < 120; t += 0.1) g.step(0.1, []);
  let peak1 = 0;
  for (let i = 0; i < g.a.length; i += 4) peak1 = Math.max(peak1, g.a[i + 1]);
  const net1 = sumNet(g);
  ok(Math.abs(net1 - net0) < 0.03 * dep0, `2 min of relax keeps the net mass (${(net0 * 1000).toFixed(2)} → ${(net1 * 1000).toFixed(2)} l, depression ${(dep0 * 1000).toFixed(1)} l)`);
  ok(peak1 < peak0 * 0.97, `berm crest slumps (${(peak0 * 100).toFixed(1)} → ${(peak1 * 100).toFixed(1)} cm)`);
}

// 2b. A furrow laid in short pieces (a dash, frame by frame) is one smooth trough: no rim ribs across its floor.
{
  const g = new DentGrid(200, 20, rates(0.1, false));
  g.step(0, []);
  for (let k = 0; k < 12; k++) g.step(0, [brush(-6 + k * 0.6 + 0.3, 0, 0.45, Math.PI / 2, 1 + 0.6 / 0.9, 0.12)]);
  let rib = 0, rim = 0;
  for (let i = 0; i < 200; i++) {
    const x = texelWorld(i, 200, 20, 0);
    if (x < -5 || x > 0.5) continue;
    rib = Math.max(rib, g.a[(100 * 200 + i) * 4 + 1]);
  }
  for (let i = 0; i < g.a.length; i += 4) rim = Math.max(rim, g.a[i + 1]);
  ok(rib < rim * 0.1, `furrow floor has no ribs (berm on its middle line ${(rib * 100).toFixed(2)} cm, rims ${(rim * 100).toFixed(1)} cm)`);
}

// 3. It heals: with the slow decay on, a print is mostly gone after a few time constants.
{
  const g = new DentGrid(160, 16, rates(0.1, true));
  g.step(0, []);
  g.step(0.016, [brush(0, 0, 0.45, 0, 1.42, 0.1)]);
  const d0 = g.volumes().dep;
  for (let t = 0; t < 60; t += 0.1) g.step(0.1, []);
  const d60 = g.volumes().dep;
  for (let t = 0; t < 400; t += 0.5) g.step(0.5, []);
  const d460 = g.volumes().dep;
  ok(d60 < d0 && d60 > d0 * 0.3, `a minute on sand: ${((d60 / d0) * 100).toFixed(0)}% of the print left (Keith: slumps back over a minute or two)`);
  ok(d460 < d0 * 0.05, `about 8 minutes: ${((d460 / d0) * 100).toFixed(1)}% left`);
}

// 4. Never NaN, never past its clamps, under random brushes and frame times.
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = new DentGrid(64, 8, rates(0.125, true), 0.6, 0.42, 0.3);
  let bad = 0, over = 0;
  for (let f = 0; f < 600; f++) {
    const bs: Brush[] = [];
    for (let k = 0; k < 4; k++) bs.push(brush((rnd() - 0.5) * 10, (rnd() - 0.5) * 10, 0.05 + rnd() * 2, rnd() * 7, 1 + rnd() * 6, rnd() * 0.8, rnd() * 1.5, rnd() < 0.5 ? 1 : 0));
    g.follow((rnd() - 0.5) * 2, (rnd() - 0.5) * 2);
    g.step(rnd() * 0.1, bs);
    for (let i = 0; i < g.a.length; i += 4) {
      if (!Number.isFinite(g.a[i]) || !Number.isFinite(g.a[i + 1]) || !Number.isFinite(g.a[i + 2])) bad++;
      if (g.a[i] > 0.6 + 1e-6 || g.a[i + 1] > 0.42 + 1e-6 || g.a[i] < 0 || g.a[i + 1] < 0) over++;
    }
  }
  ok(bad === 0, `no NaN in 600 random frames (${bad} bad texels)`);
  ok(over === 0, `clamps hold (${over} texels past them)`);
}

// 5. The toroidal window: scrolling zeroes new texels, and a dent stays where it was in the world.
{
  const n = 100, size = 10, g = new DentGrid(n, size, rates(0.1, false));
  g.follow(0, 0); g.step(0, []);
  g.step(0, [brush(1.2, -0.8, 0.5, 0, 1, 0.1)]);
  const deepest = () => {
    let best = -1, bi = 0, bj = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const d = g.a[(j * n + i) * 4]; if (d > best) { best = d; bi = i; bj = j; } }
    return { x: texelWorld(bi, n, size, g.cx), z: texelWorld(bj, n, size, g.cz), d: best };
  };
  const before = deepest();
  // Fill the whole window with a dent everywhere, then move 2.3 m: the texels that came in must be zero.
  g.step(0, [brush(0, 0, 20, 0, 1, 0.05)]);
  g.follow(2.3, -1.7); g.step(0, []);
  let fresh = 0, dirty = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const wx = texelWorld(i, n, size, g.cx), wz = texelWorld(j, n, size, g.cz);
    const wasIn = Math.abs(wx) <= size / 2 && Math.abs(wz) <= size / 2;
    if (!wasIn) { fresh++; if (g.a[(j * n + i) * 4] !== 0 || g.a[(j * n + i) * 4 + 1] !== 0) dirty++; }
  }
  ok(fresh > 0 && dirty === 0, `scrolled-in texels zeroed (${fresh} new, ${dirty} not zero)`);
  const g2 = new DentGrid(n, size, rates(0.1, false));
  g2.follow(0, 0); g2.step(0, []); g2.step(0, [brush(1.2, -0.8, 0.5, 0, 1, 0.1)]);
  g2.follow(3.1, 2.2); g2.step(0, []);
  let best = -1, bx = 0, bz = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const d = g2.a[(j * n + i) * 4]; if (d > best) { best = d; bx = texelWorld(i, n, size, g2.cx); bz = texelWorld(j, n, size, g2.cz); } }
  ok(Math.hypot(bx - before.x, bz - before.z) < 0.11 && Math.abs(best - before.d) < 1e-6, `dent stays put in the world after scrolling (${before.x.toFixed(2)}, ${before.z.toFixed(2)} → ${bx.toFixed(2)}, ${bz.toFixed(2)})`);
}

// 6. The patch's true ground: exact at its vertices, within 2 cm between, while it scrolls; coarse = the chunks' grid.
{
  const field = new DuneField({ ...TERRAIN_DEFAULTS });
  const w = new GroundWindow(field, 96, 0.25, 1);
  let t0 = performance.now();
  w.follow(13, -40); w.fillNow();
  const fullMs = performance.now() - t0;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const errs: number[] = [];
  let worstVertex = 0, worstCoarse = 0, chunkErr = 0;
  const probe = () => {
    const [x0, z0, x1, z1] = w.bounds();
    for (let k = 0; k < 400; k++) {
      const x = x0 + 1 + rnd() * (x1 - x0 - 2), z = z0 + 1 + rnd() * (z1 - z0 - 2);
      errs.push(Math.abs(w.heightAt(x, z) - field.height(x, z)));
      chunkErr = Math.max(chunkErr, Math.abs(w.chunkHeightAt(x, z) - field.height(x, z)));
      const i = Math.round(x / w.fine), j = Math.round(z / w.fine);
      worstVertex = Math.max(worstVertex, Math.abs(w.fineAt(i, j) - field.height(i * w.fine, j * w.fine)));
      const ci = Math.round(x / w.step), cj = Math.round(z / w.step);
      worstCoarse = Math.max(worstCoarse, Math.abs(w.chunkHeightAt(ci * w.step, cj * w.step) - field.height(ci * w.step, cj * w.step)));
    }
  };
  probe();
  // Walk 60 m diagonally in 0.13 m steps (like a frame at 4 m/s), timing the refill of what scrolls in.
  let ms = 0, metres = 0, rows = 0;
  for (let s = 0; s < 460; s++) {
    const gx = w.gx, gz = w.gz;
    t0 = performance.now();
    w.follow(13 + s * 0.13, -40 + s * 0.09); w.fillNow();
    ms += performance.now() - t0;
    rows += Math.abs(w.gx - gx) + Math.abs(w.gz - gz);
    metres = Math.hypot(s * 0.13, s * 0.09);
  }
  probe();
  errs.sort((a, b) => a - b);
  const p99 = errs[Math.floor(errs.length * 0.99)], max = errs[errs.length - 1];
  ok(worstVertex < 1e-4, `patch vertices are DuneField.height exactly (worst ${worstVertex.toExponential(1)} m), after scrolling ${metres.toFixed(0)} m`);
  ok(worstCoarse < 1e-4, `coarse grid is the chunks' vertices (worst ${worstCoarse.toExponential(1)} m)`);
  ok(p99 < 0.02, `between vertices within 2 cm: 99% under ${(p99 * 100).toFixed(2)} cm, worst ${(max * 100).toFixed(2)} cm (the chunks' 1 m grid: worst ${(chunkErr * 100).toFixed(1)} cm)`);
  console.log(`     window ${w.nf + 1}² fine + ${w.mc}² coarse samples; full fill ${fullMs.toFixed(0)} ms; scrolling ${(ms / Math.max(1, rows)).toFixed(2)} ms per 1 m row or column (${w.nf + 1} fine + ${w.mc} coarse samples)`);
}

console.log(fails ? `${fails} FAILED` : "dents ok");
if (fails) throw new Error("dents check failed");
