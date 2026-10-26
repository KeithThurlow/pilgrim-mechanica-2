// Crater check (Keith 2026-10-25: blasts dent real, walkable ground; outposts and the road can't be dug out):
// - deterministic: two layers given the same blasts give the same heights, in any order of asking;
// - continuous: after 200 blasts in loose sand the ground stays within the dunes' own limit (0.26 m between samples
//   0.1 m apart, as the biome check) and the craters alone never jump (0.15 m);
// - walkable: after stacked blasts no point is steeper than the wall limit unless the ground was already that steep,
//   and then no steeper than it was (slopes over 0.5 m; the fit is on a 0.5 m lattice, so 0.1% of points may run up
//   to 4 degrees over on sharp dune creases);
// - protected: POI pads, the convoy road and protect() circles keep their exact heights after blasts on and round them;
// - bare rock barely changes; stacked blasts saturate; craters slump back and are dropped when healed;
// - cost of height() with 500 craters around against none.
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

if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("crater check failed"); }
console.log("crater check passed");
