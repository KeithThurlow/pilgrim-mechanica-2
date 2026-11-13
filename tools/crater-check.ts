// Crater check (Keith 2026-10-25: blasts dent real, walkable ground; outposts and the road can't be dug out):
// - deterministic: two layers given the same blasts give the same heights, in any order of asking;
// - continuous: after 200 blasts in loose sand the ground stays within the dunes' own limit (0.26 m between samples
//   0.1 m apart, as the biome check) and the craters alone never jump (0.15 m);
// - walkable: after stacked blasts no point is steeper than the wall limit unless the ground was already that steep,
//   and then no steeper than it was (slopes over 0.5 m; the fit is on a 0.5 m lattice, so 0.1% of points may run up
//   to 4 degrees over on sharp dune creases);
// - protected: POI pads, the convoy road and protect() circles keep their exact heights after blasts on and round them;
// - bare rock barely changes; stacked blasts saturate; craters slump back and are dropped when healed;
// - cost of height() with 500 craters around against none;
// - patching: the chunks' queued, cached patch (flushPatches, the combat labs) gives the same ground as patching each box
//   at once (patchArea) and as chunks built fresh, through blasts, slumping and healing, and costs less.
// Run: npm test (or npx tsx tools/crater-check.ts).
import { DuneField, TERRAIN_DEFAULTS, type GroundSample } from "../src/world/terrain";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { POI_DEFAULTS, PoiField } from "../src/world/pois";
import { PoiPads, rawGround } from "../src/world/poiPads";
import { addModifier } from "../src/world/modifiers";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { TerrainStreamer, STREAM_DEFAULTS } from "../src/world/chunks";
import { GroundWindow } from "../src/world/groundWindow";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };
const R2D = 180 / Math.PI;
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function world(extra: Record<string, number> = {}) {
  const v = { ...TERRAIN_DEFAULTS, ...CRATER_DEFAULTS, ...extra };
  const field = new DuneField(v);
  const craters = new CraterLayer(v, field);
  field.dents = craters;
  return { v, field, craters };
}
const slopeDeg = (f: DuneField, x: number, z: number, e = 0.5) => {
  const gx = (f.height(x + e, z) - f.height(x - e, z)) / (2 * e), gz = (f.height(x, z + e) - f.height(x, z - e)) / (2 * e);
  return Math.atan(Math.hypot(gx, gz)) * R2D;
};

// A soft patch: the dunes' default ground round the origin (loose desert sand).
const blasts: [number, number, number][] = [];
for (let i = 0; i < 200; i++) blasts.push([(rnd() - 0.5) * 60, (rnd() - 0.5) * 60, 2 + rnd() * 6]);

// ---- 1. deterministic ----
{
  const a = world(), b = world();
  for (const [x, z, r] of blasts) { a.craters.blast(x, z, r); b.craters.blast(x, z, r); }
  const pts: [number, number][] = [];
  for (let i = 0; i < 4000; i++) pts.push([(rnd() - 0.5) * 80, (rnd() - 0.5) * 80]);
  const ha = pts.map(([x, z]) => a.field.height(x, z));
  const hb = [...pts].reverse().map(([x, z]) => b.field.height(x, z)).reverse();
  const bad = ha.filter((h, i) => h !== hb[i]).length;
  if (bad) fail(`${bad} heights differ between two layers given the same blasts (asked in reverse)`);
  const again = pts.map(([x, z]) => a.field.height(x, z));
  if (again.some((h, i) => h !== ha[i])) fail("heights change when asked twice");
  console.log(`determinism: ${pts.length} points, same in any order · ${a.craters.count} craters kept`);
}

// ---- 2. continuous; 3. walkable after stacked blasts ----
{
  const plain = world(), w = world();
  for (const [x, z, r] of blasts) w.craters.blast(x, z, r);
  // Stack a few more on the same spots.
  for (let k = 0; k < 6; k++) for (const [x, z] of [[0, 0], [8, 3], [-10, -12]]) w.craters.blast(x + rnd(), z + rnd(), 6);
  let worstLayer = 0, worstAll = 0, deepest = 0;
  for (let line = 0; line < 40; line++) {
    for (const axis of [0, 1]) {
      const c = -40 + line * 2;
      let pw = 0, pp = 0;
      for (let t = -40; t <= 40; t += 0.1) {
        const x = axis ? c : t, z = axis ? t : c;
        const hw = w.field.height(x, z), hp = plain.field.height(x, z);
        if (t > -40) {
          worstLayer = Math.max(worstLayer, Math.abs((hw - hp) - (pw - pp)));
          worstAll = Math.max(worstAll, Math.abs(hw - pw));
        }
        deepest = Math.min(deepest, hw - hp);
        pw = hw; pp = hp;
      }
    }
  }
  // The layer alone can step more than its own walls where it fills a steep dune face back toward the limit; a
  // seam or jump would show as far more.
  if (worstLayer > 0.15) fail(`craters make a ${worstLayer.toFixed(3)} m step between samples 0.1 m apart`);
  if (worstAll > 0.26) fail(`the ground steps ${worstAll.toFixed(3)} m between samples 0.1 m apart`);
  if (-deepest > w.v.craterMaxStack + 1e-6) fail(`stacked craters ${(-deepest).toFixed(2)} m deep (cap ${w.v.craterMaxStack})`);
  // Slopes: steeper than the wall limit only where the dunes already were, and then no steeper (2 degrees slack for
  // the 0.5 m grid the limit is fitted on).
  let worst = 0, worstWhere = "", over = 0, n = 0, steepest = 0;
  for (let z = -45; z <= 45; z += 0.37) for (let x = -45; x <= 45; x += 0.37) {
    const a = slopeDeg(w.field, x, z), b = slopeDeg(plain.field, x, z);
    steepest = Math.max(steepest, a);
    n++;
    const excess = a - Math.max(w.v.craterWall, b);
    if (excess > worst) { worst = excess; worstWhere = `${x.toFixed(1)},${z.toFixed(1)} (${a.toFixed(1)} deg, was ${b.toFixed(1)})`; }
    if (excess > 2) over++;
  }
  // Fitted on a 0.5 m lattice: a few points on sharp dune creases between nodes may run a little over.
  if (worst > 4 || over > n * 0.001) fail(`${over}/${n} points steeper than max(${w.v.craterWall} deg, before) by over 2 deg; worst +${worst.toFixed(1)} at ${worstWhere}`);
  console.log(`continuity: biggest crater step ${worstLayer.toFixed(3)} m, ground step ${worstAll.toFixed(3)} m per 0.1 m · deepest ${(-deepest).toFixed(2)} m (stack cap ${w.v.craterMaxStack}) · walls: worst +${worst.toFixed(2)} deg past max(limit, before) over ${n} points, steepest ${steepest.toFixed(0)} deg`);
}

// ---- 4. protected zones keep their exact heights ----
{
  const v = { ...TERRAIN_DEFAULTS, ...CRATER_DEFAULTS, ...POI_DEFAULTS, ...ROUTE_DEFAULTS, convoyWander: 0 };
  const build = () => {
    const field = new DuneField(v);
    const pois = new PoiField(v, rawGround(field));
    const pads = new PoiPads(pois);
    // A hand-placed pad off the road, and the road along +Z through the origin.
    pois.extra.push(pois.placeAt("hand:0", "debrisField", 120, 40, 0.3, 7));
    pads.reindex();
    const route = new ConvoyRoute(v, 0, 0);
    // The road exists behind the plough's blade: move the convoy clock on so it runs past the test points.
    route.jump(200);
    addModifier(field, route);
    addModifier(field, pads);
    const craters = new CraterLayer(v, field);
    field.dents = craters;
    craters.protect(-90, 60, 15);
    return { field, craters, pad: pois.extra[0].pad! };
  };
  const a = build(), pad = a.pad;
  // Open sand is told cheaply (GroundModifier.noFloor, perf 2026-11-13): never where a floor is within the margin, and
  // the hardness is the same with the shortcut as without, round the road, the pads and far out among the generated POIs.
  {
    const plain = build();
    (plain.field.modifier as unknown as { noFloor?: unknown }).noFloor = undefined;
    const m = a.field.modifier!, M = v.protectMargin;
    let n = 0, open = 0, wrong = 0, differ = 0;
    const one = (x: number, z: number) => {
      const p0 = plain.craters.protectedAt(x, z), p1 = a.craters.protectedAt(x, z);
      n++;
      if (p0 !== p1) differ++;
      if (m.noFloor!(x, z, M + 1e-3)) { open++; if (p0 !== 0) wrong++; }
    };
    for (let i = 0; i < 6000; i++) one((rnd() - 0.5) * 2 * (v.routeHalfWidth + v.routeBlend + 40), (rnd() - 0.5) * 500);
    for (let i = 0; i < 3000; i++) { const a2 = rnd() * 6.283, r = rnd() * (pad.r + 60); one(pad.x + Math.cos(a2) * r, pad.z + Math.sin(a2) * r); }
    for (let i = 0; i < 20000; i++) one((rnd() - 0.5) * 4000, (rnd() - 0.5) * 4000);
    const far: [number, number][] = [];
    for (let i = 0; i < 20000; i++) far.push([(rnd() - 0.5) * 300, (rnd() - 0.5) * 300]);
    const time = (c: CraterLayer) => { const t = performance.now(); for (const [x, z] of far) c.hardness(x, z); return ((performance.now() - t) / far.length) * 1000; };
    time(plain.craters); time(a.craters);
    const us0 = time(plain.craters), us1 = time(a.craters);
    console.log(`open sand: ${n} points, ${open} told open (${wrong} of them protected), hardness differs at ${differ}; a hardness read within 150 m of the road ${us0.toFixed(2)} µs without the shortcut, ${us1.toFixed(2)} µs with`);
    if (wrong) fail(`${wrong} points told open sand are protected`);
    if (differ) fail(`the protection differs at ${differ} of ${n} points with the open-sand shortcut`);
    if (open < n * 0.3 || open > n * 0.98) fail(`${open} of ${n} points told open: the test points don't cover both`);
  }
  // Points inside: the road floor (|x| < half-width), the pad's floor, the protected circle.
  const inside: [number, number][] = [];
  for (let i = 0; i < 600; i++) inside.push([(rnd() - 0.5) * 2 * (v.routeHalfWidth - 0.5), (rnd() - 0.5) * 160]);
  for (let i = 0; i < 300; i++) { const a2 = rnd() * 6.283, r = Math.sqrt(rnd()) * pad.r; inside.push([pad.x + Math.cos(a2) * r, pad.z + Math.sin(a2) * r]); }
  for (let i = 0; i < 300; i++) { const a2 = rnd() * 6.283, r = Math.sqrt(rnd()) * 15; inside.push([-90 + Math.cos(a2) * r, 60 + Math.sin(a2) * r]); }
  const before = inside.map(([x, z]) => a.field.height(x, z));
  // Blasts on them, along their edges and round them.
  let dug = 0;
  const near: [number, number][] = [];
  for (let i = 0; i < 120; i++) near.push([(rnd() - 0.5) * 2 * (v.routeHalfWidth + v.routeBlend + 12), (rnd() - 0.5) * 160]);
  for (let i = 0; i < 60; i++) { const a2 = rnd() * 6.283, r = rnd() * (pad.r + 20); near.push([pad.x + Math.cos(a2) * r, pad.z + Math.sin(a2) * r]); }
  for (let i = 0; i < 60; i++) { const a2 = rnd() * 6.283, r = rnd() * 35; near.push([-90 + Math.cos(a2) * r, 60 + Math.sin(a2) * r]); }
  for (const [x, z] of near) if (a.craters.blast(x, z, 6)) dug++;
  const after = inside.map(([x, z]) => a.field.height(x, z));
  const moved = after.filter((h, i) => h !== before[i]).length;
  if (moved) fail(`${moved}/${inside.length} protected heights changed after ${near.length} blasts round them`);
  // Outside the protection the same blasts do dent (the test isn't passing because nothing dug).
  const out = world();
  let outDug = 0;
  for (let i = 0; i < 20; i++) { const x = 300 + i * 9, z = -200; const h0 = out.field.height(x, z); out.craters.blast(x, z, 6); if (out.field.height(x, z) < h0 - 0.2) outDug++; }
  if (outDug < 15) fail(`only ${outDug}/20 blasts dug on open sand`);
  // The edge is soft: no cliff where the protection ends.
  let edge = 0;
  for (let z = -60; z <= 60; z += 0.5) for (let x = -(v.routeHalfWidth + v.routeBlend + 15); x <= v.routeHalfWidth + v.routeBlend + 15; x += 0.25) {
    edge = Math.max(edge, Math.abs(a.field.height(x + 0.1, z) - a.field.height(x, z)));
  }
  if (edge > 0.26) fail(`a ${edge.toFixed(2)} m step per 0.1 m across the road's protected edge`);
  console.log(`protected: ${inside.length} points on the road, a pad and an outpost circle unchanged after ${near.length} blasts round them (${dug} left a dent outside) · biggest step across the road edge ${edge.toFixed(3)} m per 0.1 m · ${outDug}/20 dug on open sand`);
}

// ---- 5. bare rock barely changes ----
{
  const w = world({ ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, biomeOnly: 1 } as Record<string, number>);
  const s: GroundSample = { h: 0, crest: 0, flat: 0 };
  let found = 0, worst = 0, sandWorst = 0;
  for (let i = 0; i < 4000 && found < 25; i++) {
    const x = (rnd() - 0.5) * 2000, z = (rnd() - 0.5) * 2000;
    w.field.sample(x, z, s);
    if ((s.rock ?? 0) < 0.97) continue;
    // Rock all round the blast too.
    let all = true;
    for (let k = 0; k < 8 && all; k++) { w.field.sample(x + Math.cos(k) * 4, z + Math.sin(k) * 4, s); if ((s.rock ?? 0) < 0.9) all = false; }
    if (!all) continue;
    found++;
    const h0 = w.field.height(x, z);
    w.craters.blast(x, z, 6);
    worst = Math.max(worst, Math.abs(w.field.height(x, z) - h0));
  }
  const sand = world();
  const h0 = sand.field.height(500, 500);
  sand.craters.blast(500, 500, 6);
  sandWorst = h0 - sand.field.height(500, 500);
  if (found < 5) fail(`only ${found} bare rock spots found to test`);
  if (worst > 0.1 * sandWorst + 0.02) fail(`a blast on bare rock dents it ${worst.toFixed(2)} m (sand ${sandWorst.toFixed(2)} m)`);
  console.log(`rock: ${found} blasts on bare rock dent it at most ${worst.toFixed(3)} m (the same blast digs ${sandWorst.toFixed(2)} m into sand)`);
}

// ---- 6. slumping ----
{
  const w = world();
  const x = 200, z = 100, h0 = w.field.height(x, z);
  w.craters.blast(x, z, 6);
  const d0 = h0 - w.field.height(x, z);
  for (let t = 0; t < w.v.craterSlump; t += 1 / 30) w.craters.update(1 / 30);
  const d1 = h0 - w.field.height(x, z);
  for (let t = 0; t < w.v.craterSlump; t += 1 / 30) w.craters.update(1 / 30);
  if (d1 > d0 * 0.06) fail(`after ${w.v.craterSlump} s a crater is still ${((d1 / d0) * 100).toFixed(0)}% deep`);
  if (w.craters.count) fail(`${w.craters.count} healed craters still stored`);
  if (w.field.height(x, z) !== h0) fail("a healed crater left the ground changed");
  // Count limit: past it the oldest heal over a few seconds.
  const c = world({ craterMax: 20 });
  for (let i = 0; i < 40; i++) c.craters.blast(i * 20, 0, 4);
  for (let t = 0; t < 10; t += 1 / 30) c.craters.update(1 / 30);
  if (c.craters.count > 20) fail(`${c.craters.count} craters kept with a limit of 20`);
  console.log(`slump: ${d0.toFixed(2)} m deep, ${((d1 / d0) * 100).toFixed(1)}% left after ${w.v.craterSlump} s, gone after twice that · 40 blasts with a limit of 20 keep ${c.craters.count}`);
}

// ---- 7. cost ----
{
  const none = world(), many = world({ craterMax: 600 });
  let added = 0, addMs = 0;
  for (let i = 0; i < 500; i++) { const r = many.craters.blast((rnd() - 0.5) * 120, (rnd() - 0.5) * 120, 2 + rnd() * 5); if (r) { added++; addMs += many.craters.stats.addMs; } }
  const time = (f: DuneField) => { const t = performance.now(); let a = 0; for (let i = 0; i < 200000; i++) a += f.height(((i * 0.37) % 120) - 60, ((i * 0.21) % 120) - 60); return (performance.now() - t) / 200 + a * 0; };
  time(none.field); time(many.field);
  const t0 = time(none.field), t1 = time(many.field);
  console.log(`cost: height() ${t0.toFixed(2)} µs plain vs ${t1.toFixed(2)} µs among ${many.craters.count} craters (${added} added, ${(addMs / Math.max(1, added)).toFixed(2)} ms each to fit)`);
  if (t1 > t0 * 2 + 0.5) fail(`height() among 500 craters costs ${t1.toFixed(2)} µs against ${t0.toFixed(2)}`);
}

// ---- 8. chunk patching ----
{
  const { v, field, craters } = world({ craterMax: 40 });
  const sv = { ...v, ...STREAM_DEFAULTS, radius: 1 };
  const queued = new TerrainStreamer(field, sv), direct = new TerrainStreamer(field, sv);
  queued.fill(0, 0); direct.fill(0, 0);
  // The detail patch's window, told of the queued patches as the labs wire it (dents only: it keeps the dunes).
  const win = new GroundWindow(field, 60, 0.25, 1);
  win.follow(0, 0); win.fillNow();
  queued.onRebuild.push((box, dentsOnly) => win.invalidate(box, dentsOnly));
  let qMs = 0, dMs = 0;
  // The direct one patches the same boxes, one by one, when the queued one flushes.
  const boxes: number[][] = [];
  const changed = (x0: number, z0: number, x1: number, z1: number) => {
    const t = performance.now(); queued.queuePatch(x0, z0, x1, z1); qMs += performance.now() - t;
    boxes.push([x0, z0, x1, z1]);
  };
  const flush = () => {
    let t = performance.now(); queued.flushPatches(); qMs += performance.now() - t;
    t = performance.now(); for (const b of boxes.splice(0)) direct.patchArea(b[0], b[1], b[2], b[3]); dMs += performance.now() - t;
  };
  // Trenches of overlapping craters (as a robot beam digs), more than the count so the oldest heal, then slumping.
  for (let round = 0; round < 12; round++) {
    const x0 = (rnd() - 0.5) * 60, z0 = (rnd() - 0.5) * 60, a = rnd() * Math.PI * 2;
    for (let k = 0; k < 8; k++) { const b = craters.blast(x0 + Math.sin(a) * k * 1.2, z0 + Math.cos(a) * k * 1.2, 1.5); if (b) changed(b[0], b[1], b[2], b[3]); }
    flush();
    for (let f = 0; f < 30; f++) { craters.update(1 / 30, changed); flush(); }
  }
  // Both trail the true ground only by slumps too small to redraw yet (3 cm); the queued one, redoing whole 4 m cells,
  // never trails it more. Redrawn everywhere, the cached patch matches chunks built fresh.
  const fresh = new TerrainStreamer(field, sv);
  fresh.fill(0, 0);
  const a = new Float32Array(7), b = new Float32Array(7), c = new Float32Array(7);
  let worstQ = 0, worstD = 0, worstF = 0, n = 0;
  for (let j = -55; j <= 55; j++) for (let i = -55; i <= 55; i++) {
    if (!queued.vertexAt(i, j, a) || !direct.vertexAt(i, j, b) || !fresh.vertexAt(i, j, c)) continue;
    n++;
    for (let k = 0; k < 7; k++) { worstQ = Math.max(worstQ, Math.abs(a[k] - c[k])); worstD = Math.max(worstD, Math.abs(b[k] - c[k])); }
  }
  win.fillNow();
  const truth = new GroundWindow(field, 60, 0.25, 1);
  truth.follow(0, 0); truth.fillNow();
  let worstW = 0, dug = 0;
  for (let j = -110; j <= 110; j++) for (let i = -110; i <= 110; i++) {
    worstW = Math.max(worstW, Math.abs(win.fineAt(i, j) - truth.fineAt(i, j)));
    dug = Math.max(dug, Math.abs(craters.at(i * 0.25, j * 0.25)));
  }
  console.log(`detail window after dents-only refills: ${worstW.toExponential(1)} off one filled fresh (dents up to ${dug.toFixed(2)} m)`);
  if (dug < 0.2) fail(`the detail window check saw dents of only ${dug} m`);
  if (worstW > 1e-4) fail(`the detail window's dents-only refill is ${worstW} off a fresh fill`);
  queued.queuePatch(-60, -60, 60, 60); queued.flushPatches();
  for (let j = -55; j <= 55; j++) for (let i = -55; i <= 55; i++) {
    if (!queued.vertexAt(i, j, a) || !fresh.vertexAt(i, j, c)) continue;
    for (let k = 0; k < 7; k++) worstF = Math.max(worstF, Math.abs(a[k] - c[k]));
  }
  console.log(`patching: ${n} vertices off the true ground by ${worstQ.toExponential(1)} queued, ${worstD.toExponential(1)} at once; all redrawn, ${worstF.toExponential(1)} off fresh chunks; ${qMs.toFixed(0)} ms queued and cached vs ${dMs.toFixed(0)} ms at once`);
  if (n < 10000) fail(`patching compared only ${n} vertices`);
  if (worstQ > worstD + 1e-5) fail(`queued patching trails the ground by ${worstQ}, patching at once by ${worstD}`);
  if (worstF > 1e-4) fail(`queued patching differs from fresh chunks by ${worstF}`);
  if (qMs > dMs) fail(`queued patching (${qMs.toFixed(0)} ms) costs more than patching at once (${dMs.toFixed(0)} ms)`);
}

// A dying walker's core (Keith 2026-11-02: "a huge crater"): past the usual depth limit when asked, never past it otherwise.
{
  const { field, craters } = world({ height: 0, swell: 0, bumps: 0 });
  const x = 400, z = 400, g0 = field.height(x, z);
  craters.add(x, z, 16.5, 3.5, 3.5);
  craters.settle();
  const deep = g0 - field.height(x, z);
  const { field: f2, craters: c2 } = world({ height: 0, swell: 0, bumps: 0 });
  c2.add(x, z, 16.5, 3.5);
  c2.settle();
  const capped = f2.height(x, z) - f2.height(x, z) + (g0 - f2.height(x, z));
  console.log(`huge crater: 16.5 m radius, ${deep.toFixed(2)} m deep (the wall limit holds it there; usual depth limit ${capped.toFixed(2)} m)`);
  if (deep < capped + 0.5) problems.push(`a huge crater dug only ${deep.toFixed(2)} m`);
  if (capped > CRATER_DEFAULTS.craterMaxDepth + 0.05) problems.push(`a crater without a depth override went ${capped.toFixed(2)} m deep`);
}
// Big craters are fitted over ticks (Keith 2026-11-13: a dying walker's crater stalled the sim for 80 ms and more): the
// ground holds still until one lands, it lands the crater an at-once fit makes, a blast on top of it lands after it, a
// change under it (the plough's road) starts it over, and no tick does much more than the budget's work.
{
  const big: [number, number, number, number][] = [[400, 400, 23.8, 1.5], [460, 380, 16.5, 3.5], [300, 300, 18.7, 4.5]];
  const once = world({ craterStepNodes: 0 }), spread = world();
  const pts: [number, number][] = [];
  for (let i = 0; i < 4000; i++) pts.push([250 + rnd() * 260, 250 + rnd() * 200]);
  const before = pts.map(([x, z]) => spread.field.height(x, z));
  let ticks = 0, worstTicks = 0, held = true, landed = 0, reads = 0, worstReads = 0;
  const f = spread.field, height = f.height.bind(f);
  f.height = (x: number, z: number) => { reads++; return height(x, z); };
  for (const [x, z, r, d] of big) {
    once.craters.add(x, z, r, d, d);
    once.craters.blast(x + 3, z - 2, 6);
    const box = spread.craters.add(x, z, r, d, d);
    if (!box || !spread.craters.stats.deferred) fail(`a ${r} m crater was not spread over ticks`);
    // A small blast on it: waits behind it.
    spread.craters.blast(x + 3, z - 2, 6);
    if (spread.craters.pending !== 2) fail(`a blast on a crater on its way did not wait behind it (${spread.craters.pending} waiting)`);
    let n = 0;
    while (spread.craters.pending) {
      if (n === 1 && pts.some(([px, pz], i) => Math.abs(px - x) < 60 && height(px, pz) !== before[i])) held = false;
      reads = 0;
      spread.craters.update(0, () => landed++);
      worstReads = Math.max(worstReads, reads);
      n++; ticks++;
      if (n > 200) { fail("a spread crater never landed"); break; }
    }
    worstTicks = Math.max(worstTicks, n);
    for (let i = 0; i < pts.length; i++) before[i] = height(pts[i][0], pts[i][1]);
  }
  f.height = height;
  let worst = 0;
  for (const [x, z] of pts) worst = Math.max(worst, Math.abs(once.field.height(x, z) - spread.field.height(x, z)));
  // Started over by a change under it, then by more than it can ride out: finished at once.
  const again = world();
  again.craters.add(0, 0, 20, 1.5, 1.5);
  for (let k = 0; k < 3; k++) again.craters.update(0);
  again.craters.invalidate(-5, -5, 5, 5);
  let n2 = 0;
  while (again.craters.pending && n2 < 200) { again.craters.update(0); n2++; }
  for (let k = 0; k < 3; k++) again.craters.invalidate(-5, -5, 5, 5);
  const flat = world({ craterStepNodes: 0 });
  flat.craters.add(0, 0, 20, 1.5, 1.5);
  let offAgain = 0;
  for (let i = 0; i < 500; i++) { const x = (rnd() - 0.5) * 80, z = (rnd() - 0.5) * 80; offAgain = Math.max(offAgain, Math.abs(flat.field.height(x, z) - again.field.height(x, z))); }
  const rush = world();
  rush.craters.add(0, 0, 20, 1.5, 1.5);
  // (Changes between two ticks count once: the plough's cut comes as several boxes.)
  for (let k = 0; k < 3; k++) { rush.craters.update(0); for (let q = 0; q < 4; q++) rush.craters.invalidate(-5, -5, 5, 5); if (!rush.craters.pending) fail("a crater landed while the ground kept changing under it"); }
  rush.craters.update(0);
  console.log(`spread craters: ${big.length} big ones and a blast on each over ${ticks} ticks (${worstTicks} at most), ${landed} ground changes told, ${worst.toExponential(1)} m off fitting at once; at most ${worstReads} ground reads a tick; started over once: ${offAgain.toExponential(1)} m off, ${n2} more ticks; three times: ${rush.craters.pending ? "still waiting" : "finished on the next tick"}`);
  if (!held) fail("the ground moved before a spread crater landed");
  if (worst > 1e-6) fail(`spread craters differ from fitting at once by ${worst} m`);
  if (landed < big.length * 2) fail(`${landed} ground changes told for ${big.length * 2} craters landing`);
  if (worstTicks > 30) fail(`a spread crater took ${worstTicks} ticks to land`);
  if (worstReads > CRATER_DEFAULTS.craterStepNodes * 1.5) fail(`${worstReads} ground reads in one tick (budget ${CRATER_DEFAULTS.craterStepNodes})`);
  if (offAgain > 1e-6) fail(`a crater started over differs from fitting at once by ${offAgain} m`);
  if (rush.craters.pending) fail("a crater started over three times was not finished on the next tick");
}
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("crater check failed"); }
console.log("crater check passed");
