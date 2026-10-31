// Headless convoy check: the flattened road is a pure function of position (same heights in any order, continuous
// across the edge blend, no slopes steeper than the dunes'), platforms stay on the ground and upright for 5 minutes
// of driving (with heading changes); a mech keeping pace in crane range is picked up, swings, and is set on the deck's
// set-down pad standing; one that walks out of range before the cradle connects is not; walking on the deck while the
// convoy rolls, turns and speeds up keeps it on the platform (never past the edge, planted feet on the deck plane, legs
// in reach, no sliding when standing); parking settles it in a bay and holds it there, E stands it up; walking onto a
// launch pad has the crane drop it from a few metres onto the sand beside the convoy, falling at the convoy's
// velocity and landing feet on the sand (stepping off first cancels); pick-up and launch each take under 15 s (Keith
// 2026-10-25: quick); the swing is bounded and dies down. The train: each car rides on the route (its middle near its line's
// path) and the gaps between cars stay open through turns, in one line and in two; footbridges stay high enough to walk
// under and don't overstretch; a mech walks across the train through a gap without being thrown about; escorts never
// drive into a platform or the mech and hold their station band most of the time; the pipes are the same every time
// and stay out of the furniture; the tracks and wheels leave ruts and dust at a sane rate. The plough (1b): the road only
// behind its blade, berms that hold the sand it cut, the same ground from the same clock, no cliffs, a mech walks over.
// Run: npm test (or npx tsx tools/convoy-check.ts).
import * as THREE from "three";
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS, type GroundSample } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS, type Platform } from "../src/convoy/platform";
import { Crane, CRANE_DEFAULTS } from "../src/convoy/crane";
import { CraneCarry, CARRY_DEFAULTS } from "../src/convoy/carry";
import { DECK_DEFAULTS, deckLayout, walkToSpot } from "../src/convoy/deck";
import { TRAIN_DEFAULTS, bridgeSpans, REACH_MAX, REACH_MIN, type Span } from "../src/convoy/train";
import { TRACK_DEFAULTS, trackPods, treadAt, treadLength } from "../src/convoy/tracks";
import { PIPE_DEFAULTS, generatePipes } from "../src/convoy/pipes";
import { furniture, furnBox } from "../src/convoy/furniture";
import { ConvoyTrail, TRAIL_DEFAULTS } from "../src/convoy/trail";
import { EscortGroup, ESCORT_DEFAULTS, rectGap } from "../src/convoy/escort";
import { CONVOY_LAYOUT } from "../src/convoy/platform";
import { deckOutline, outside } from "../src/convoy/outline";
import { Defence, DEFENCE_DEFAULTS } from "../src/convoy/defence";

const DT = 1 / 120;
const problems: string[] = [];
const fail = (s: string) => { problems.push(s); console.log("  FAIL " + s); };
const D2R = Math.PI / 180;

function world(over: Partial<typeof ROUTE_DEFAULTS & typeof TRAIN_DEFAULTS & typeof ESCORT_DEFAULTS> = {}) {
  const V = {
    ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS, ...WALKER_DEFAULTS,
    ...TRAIN_DEFAULTS, ...TRACK_DEFAULTS, ...PIPE_DEFAULTS, ...TRAIL_DEFAULTS, ...ESCORT_DEFAULTS, ...LEG_TYPES.rampart.values, ...over,
  };
  const field = new DuneField(V);
  const route = new ConvoyRoute(V, 13, -40);
  field.modifier = route;
  const convoy = new Convoy(route, V, field);
  convoy.reset(13, -40);
  const cranes = convoy.bays.map((b) => new Crane(V, b));
  const crane = cranes[0];
  const carry = new CraneCarry(V, cranes, field);
  const sim = new WalkerSim(V, field);
  return { V, field, route, convoy, crane, cranes, carry, sim };
}
type World = ReturnType<typeof world>;

/** One 120 Hz step, as the lab does it: convoy, carry, then (unless held) ride the deck, walk, keep on / push out. */
function tick(w: World, cmd: MoveCommand) {
  w.convoy.update(DT);
  const c = w.carry.update(DT, w.sim, cmd);
  w.carry.ride(w.sim);
  if (c) {
    w.sim.update(DT, c);
    w.carry.keep(w.sim);
    if (!w.carry.ground.onDeck) for (const p of w.convoy.platforms) { const o = p.pushOut(w.sim.pos.x, w.sim.pos.z, 2); if (o) { w.sim.pos.x = o.x; w.sim.pos.z = o.z; } }
  }
}

/** Slope (degrees) of the ground at (x, z). */
const slope = (f: DuneField, x: number, z: number) => Math.acos(f.normal(x, z, [0, 1, 0], 0.25)[1]) / D2R;

// 1. The road: pure, continuous, no cliffs.
{
  console.log("-- road");
  const w = world();
  // A minute of road, swinging onto a new heading halfway (a replan).
  const drive = (x: World) => { for (let i = 0; i < 120 * 60; i++) { if (i === 120 * 30) x.V.convoyHeading = 60; x.convoy.update(DT); } };
  drive(w);
  const { route, field, V } = w;
  const plain = new DuneField({ ...V });
  const twin = world();
  drive(twin);
  const pts: [number, number][] = [];
  for (let s = -300; s < route.s + 140; s += 6) for (let side = -60; side <= 60; side += 3.3) {
    const p = route.offsetAt(s, side);
    pts.push([p.x, p.z]);
  }
  const first = pts.map(([x, z]) => field.height(x, z));
  // Same answers in reverse and shuffled order, and from a second route built the same way.
  const rev = [...pts.keys()].reverse();
  let mismatch = 0;
  for (const i of rev) if (field.height(pts[i][0], pts[i][1]) !== first[i]) mismatch++;
  for (let k = 0; k < pts.length; k++) { const i = (k * 7919) % pts.length; if (twin.field.height(pts[i][0], pts[i][1]) !== first[i]) mismatch++; }
  if (mismatch) fail(`road height differs between calls (${mismatch} samples)`);
  let finite = true;
  for (const h of first) if (!Number.isFinite(h)) finite = false;
  if (!finite) fail("non-finite road height");

  // Across the road: fine steps from the centre out past the blend; no jumps, no slopes steeper than the dunes have.
  let maxStep = 0, maxEdgeSlope = 0, maxFloorSlope = 0, maxDuneSlope = 0;
  // Out past the berms the plough's wake throws up.
  const reach = route.wake.reach() + 5;
  // The floor is flat only behind the blade's cut edge (ahead of it the dunes are untouched).
  const cutBehind = route.blade - route.tipLag - V.bladeRamp;
  for (let s = -200; s < route.s + 100; s += 9.7) for (const dir of [1, -1]) {
    let prev = NaN;
    for (let d = 0; d <= reach + 10; d += 0.1) {
      const p = route.offsetAt(s, dir * d), h = field.height(p.x, p.z);
      if (Number.isFinite(prev)) maxStep = Math.max(maxStep, Math.abs(h - prev));
      prev = h;
      if (Math.abs(d % 1) < 0.05) {
        const sl = slope(field, p.x, p.z);
        if (d < V.routeHalfWidth - 6) { if (s < cutBehind) maxFloorSlope = Math.max(maxFloorSlope, sl); }
        else maxEdgeSlope = Math.max(maxEdgeSlope, sl);
        maxDuneSlope = Math.max(maxDuneSlope, slope(plain, p.x, p.z));
      }
    }
  }
  // Steepest plain dune anywhere nearby, for reference.
  for (let z = -400; z < 400; z += 2.3) for (let x = -400; x < 400; x += 2.3) maxDuneSlope = Math.max(maxDuneSlope, slope(plain, x, z));
  console.log(`  ${route.count} route points · biggest 0.1 m step ${maxStep.toFixed(3)} m · floor up to ${maxFloorSlope.toFixed(1)}° · edges up to ${maxEdgeSlope.toFixed(1)}° · dunes up to ${maxDuneSlope.toFixed(1)}°`);
  // A jump: a step between samples 0.1 m apart bigger than the steepest dune slope allows.
  const allowed = 0.1 * Math.tan(maxDuneSlope * D2R) + 0.02;
  if (maxStep > allowed) fail(`road height jumps ${maxStep.toFixed(2)} m between samples 0.1 m apart (dunes allow ${allowed.toFixed(2)})`);
  // The plough's berms can sit on a cut face a few degrees steeper than any dune here; the terrain's own limit (75°, terrain-check) still holds.
  if (maxEdgeSlope > Math.max(maxDuneSlope, 75)) fail(`road edges reach ${maxEdgeSlope.toFixed(0)}°, steeper than the dunes' ${maxDuneSlope.toFixed(0)}° and the terrain limit`);
  if (maxFloorSlope > 12) fail(`road floor tilts up to ${maxFloorSlope.toFixed(1)}°`);

  // Cost: height lookups with the road on.
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 200000; i++) { const [x, z] = pts[i % pts.length]; acc += field.height(x + 0.01 * i % 3, z); }
  const t1 = performance.now();
  for (let i = 0; i < 200000; i++) { const [x, z] = pts[i % pts.length]; acc += plain.height(x + 0.01 * i % 3, z); }
  const t2 = performance.now();
  console.log(`  height() on the road ${((t1 - t0) / 200).toFixed(2)} µs vs plain ${((t2 - t1) / 200).toFixed(2)} µs`);
  void acc;
}

// 1b. The plough (Keith 2026-10-26): the road exists only behind its blade (a pure function of the convoy clock);
// ahead of it the dunes are untouched, behind it the road floor. The sand cut goes into berms beside the road: their
// cross-section matches the sand moved (roughly: lumps and the smear along the route), bigger where more was cut,
// never cliffs, and a mech walks off the road over the biggest one.
{
  console.log("-- plough and wake");
  const w = world();
  // 40 s of driving, swinging onto a new heading halfway (a replan must not move the road behind the blade).
  for (let i = 0; i < 120 * 40; i++) { if (i === 120 * 20) w.V.convoyHeading = 35; w.convoy.update(DT); }
  const { route, field, V } = w;
  const plain = new DuneField({ ...V });
  const hw = V.routeHalfWidth, tan = route.tipLag / hw, side = V.routeHalfWidth + V.routeBlend;
  const gs: GroundSample = { h: 0, crest: 0, flat: 0 };
  // Ahead of the cut edge: exactly the untouched dunes. Behind it, on the floor: the road surface.
  let aheadOff = 0, aheadN = 0, floorOff = 0, floorN = 0;
  for (let s = route.blade - 120; s < route.blade + 60; s += 1.3) for (let d = -side; d <= side; d += 1.7) {
    const p = route.offsetAt(s, d), lag = Math.min(Math.abs(d), hw) * tan;
    if (s > route.blade - lag + 1.5) { aheadOff = Math.max(aheadOff, Math.abs(field.height(p.x, p.z) - plain.height(p.x, p.z))); aheadN++; }
    else if (s < route.blade - route.tipLag - V.bladeRamp - 0.5 && Math.abs(d) < hw - 0.5) {
      plain.sample(p.x, p.z, gs, true);
      const floor = (gs.swell ?? 0) + V.routeLift + (gs.bumps ?? 0) * V.routeRough;
      floorOff = Math.max(floorOff, Math.abs(field.height(p.x, p.z) - floor)); floorN++;
    }
  }
  console.log(`  blade ${(route.blade - route.s).toFixed(0)} m ahead of the head, tips trail ${route.tipLag.toFixed(1)} m · ahead of the blade off the plain dunes by ${aheadOff.toFixed(6)} m (${aheadN} samples) · behind it off the road floor by ${floorOff.toFixed(6)} m (${floorN})`);
  if (aheadOff > 1e-9) fail(`ground ahead of the plough's blade differs from the untouched dunes by ${aheadOff.toFixed(3)} m`);
  if (floorOff > 1e-6) fail(`road behind the blade is off its floor by ${floorOff.toFixed(3)} m`);
  if (aheadN < 100 || floorN < 100) fail("too few samples ahead of or behind the blade");

  // Berm cross-sections from the height function's own berm term, against the sand the wake says it moved; the
  // wake's measure of the cut against the cut read off the heights.
  const smp = { w: 0, berm: 0, lift: 0, rough: 0 };
  const bermArea = (s: number) => {
    let a = 0;
    for (const dir of [1, -1]) for (let d = hw; d <= route.wake.reach() + 2; d += 0.25) {
      const p = route.offsetAt(s, dir * d);
      if (route.at(p.x, p.z, smp)) a += smp.berm * 0.25;
    }
    return a;
  };
  const cutFromHeights = (s: number) => {
    let a = 0;
    for (const dir of [1, -1]) for (let d = 0.5; d < side; d += 1) {
      const p = route.offsetAt(s, dir * d);
      const berm = route.at(p.x, p.z, smp) ? smp.berm : 0;
      a += plain.height(p.x, p.z) - (field.height(p.x, p.z) - berm);
    }
    return a;
  };
  const end = route.blade - route.tipLag - V.bermGrow - V.bermCarry - 4;
  const stations: { s: number; cut: number; moved: number; berm: number }[] = [];
  let measureOff = 0;
  for (let s = -380; s < end; s += 2) {
    const [L, R] = route.wake.netAt(s);
    const st = { s, cut: Math.max(0, L) + Math.max(0, R), moved: route.wake.moved(s), berm: bermArea(s) };
    stations.push(st);
    if (stations.length % 9 === 0) measureOff = Math.max(measureOff, Math.abs(cutFromHeights(s) - (L + R)) / Math.max(20, Math.abs(L + R)));
  }
  // Windows of 40 m: berm volume against the sand moved.
  let worstWin = 0, totMoved = 0, totBerm = 0;
  for (let i = 0; i + 20 <= stations.length; i += 20) {
    let m = 0, b = 0;
    for (let j = i; j < i + 20; j++) { m += stations[j].moved; b += stations[j].berm; }
    totMoved += m; totBerm += b;
    if (m > 400) worstWin = Math.max(worstWin, Math.abs(b - m) / m);
  }
  // Bigger berms where more is cut: correlation across stations.
  const n = stations.length, mc = stations.reduce((a, q) => a + q.cut, 0) / n, mb = stations.reduce((a, q) => a + q.berm, 0) / n;
  let cov = 0, vc = 0, vb = 0;
  for (const q of stations) { cov += (q.cut - mc) * (q.berm - mb); vc += (q.cut - mc) ** 2; vb += (q.berm - mb) ** 2; }
  const corr = cov / Math.sqrt(vc * vb || 1);
  const big = stations.reduce((a, q) => (q.berm > a.berm ? q : a), stations[0]);
  console.log(`  ${n} stations · berms ${totBerm.toFixed(0)} m³ vs sand moved ${totMoved.toFixed(0)} m³ (worst 40 m window off by ${(worstWin * 100).toFixed(0)}%) · the wake's cut vs the heights' off by ${(measureOff * 100).toFixed(1)}% · berm vs cut correlation ${corr.toFixed(2)} · biggest berm section ${big.berm.toFixed(0)} m² at ${big.s} m (cut there ${big.cut.toFixed(0)} m²)`);
  if (Math.abs(totBerm - totMoved) / totMoved > 0.08) fail(`berm volume ${totBerm.toFixed(0)} m³ is not the sand moved (${totMoved.toFixed(0)} m³)`);
  if (worstWin > 0.3) fail(`a 40 m stretch of berm is off the sand moved by ${(worstWin * 100).toFixed(0)}%`);
  if (measureOff > 0.03) fail(`the wake's cut differs from the cut read off the heights by ${(measureOff * 100).toFixed(1)}%`);
  if (corr < 0.6) fail(`berms don't follow the cut (correlation ${corr.toFixed(2)})`);
  if (big.berm < 60) fail(`the biggest berm is only ${big.berm.toFixed(0)} m² across: no walls where crests were cut`);

  // The same clock gives the same ground: a second convoy jumped straight to this clock (laying the route without
  // driving), its ground asked in another order.
  // (The steering changes at the same clock: drive to the swing, take it, then jump the rest.)
  const twin = world();
  for (let i = 0; i <= 120 * 20; i++) { if (i === 120 * 20) twin.V.convoyHeading = 35; twin.convoy.update(DT); }
  twin.convoy.jump(route.s);
  let differ = 0, asked = 0;
  for (let s = route.blade + 40; s > -300; s -= 3.1) for (let d = -side - 30; d <= side + 30; d += 4.3) {
    const p = route.offsetAt(s, d);
    if (twin.field.height(p.x, p.z) !== field.height(p.x, p.z)) differ++;
    asked++;
  }
  console.log(`  same clock, jumped instead of driven: ${differ} of ${asked} heights differ`);
  if (differ) fail(`the same convoy clock gave different ground (${differ} of ${asked} samples)`);

  // No cliffs at the berms: slopes across them (the dunes' own included) within the terrain's limit (terrain-check),
  // unless the dune under them was already that steep (a berm dumped on a slip face may add a degree or two there).
  let worstSlope = 0, plainThere = 0, worstAdded = 0, worstBermSlope = 0;
  for (let s = -380; s < end; s += 3.7) for (const dir of [1, -1]) for (let d = hw; d < route.wake.reach() + 3; d += 0.7) {
    const p = route.offsetAt(s, dir * d);
    const sl = slope(field, p.x, p.z), ps = slope(plain, p.x, p.z);
    if (sl > worstSlope) { worstSlope = sl; plainThere = ps; }
    if (sl > 75) worstAdded = Math.max(worstAdded, sl - ps);
    // The berm alone: its rise over a metre.
    const q = route.offsetAt(s, dir * (d + 1));
    const b0 = route.at(p.x, p.z, smp) ? smp.berm : 0, b1 = route.at(q.x, q.z, smp) ? smp.berm : 0;
    worstBermSlope = Math.max(worstBermSlope, Math.atan(Math.abs(b1 - b0)) / D2R);
  }
  console.log(`  steepest ground across the berms ${worstSlope.toFixed(0)}° (the dunes there ${plainThere.toFixed(0)}°; terrain limit 75°) · steepest berm face alone ${worstBermSlope.toFixed(0)}°`);
  if (worstAdded > 3) fail(`the berms make cliffs past 75° (${worstAdded.toFixed(0)}° steeper than the dunes there)`);
  if (worstBermSlope > 45) fail(`a berm face alone is ${worstBermSlope.toFixed(0)}°`);

  // A mech walks off the road over the biggest berm (well behind the convoy) and out the far side.
  const [bl] = [route.wake.berm(big.s, 1, { h: 0, w: 0, c: 0 })];
  const br = route.wake.berm(big.s, -1, { h: 0, w: 0, c: 0 });
  const out = bl.h * bl.w >= br.h * br.w ? 1 : -1, b = out > 0 ? bl : br;
  const start = route.offsetAt(big.s, out * (hw - 12));
  const sim = new WalkerSim(w.V, field);
  const dir = { x: Math.cos(start.heading) * out, z: -Math.sin(start.heading) * out };
  sim.reset(start.x, start.z, Math.atan2(dir.x, dir.z));
  const goal = b.c + b.w + 6;
  let reached = -1, under = 0, overreach = 0;
  for (let i = 0; i < 120 * 30 && reached < 0; i++) {
    sim.update(DT, { x: dir.x, z: dir.z, sprint: false });
    for (const f of sim.feet) if (f.pos.y < field.height(f.pos.x, f.pos.z) - 0.05) under++;
    overreach = sim.stats.overreach;
    const along = (sim.pos.x - start.x) * dir.x + (sim.pos.z - start.z) * dir.z;
    if (hw - 12 + along > goal) reached = i * DT;
  }
  console.log(`  mech over a ${b.h.toFixed(1)} m berm (${(2 * b.w).toFixed(0)} m wide): ${reached >= 0 ? `out past it in ${reached.toFixed(1)} s` : "stuck"} · feet under the sand ${under} frames · overreach ${overreach}`);
  if (reached < 0) fail(`a mech couldn't walk off the road over a ${b.h.toFixed(1)} m berm`);
  if (under > 0) fail(`feet went through the berm ${under} times`);
}

// 2. Five minutes of driving with heading changes and a speed change: platforms on the ground and upright.
{
  console.log("-- platforms, 5 minutes");
  const w = world();
  const frames = 300 * 120;
  let worstGap = 0, nan = false, worstOnRoad = 1;
  for (let i = 0; i < frames; i++) {
    const t = i * DT;
    if (Math.abs(t - 60) < DT / 2) w.V.convoyHeading = 75;
    if (Math.abs(t - 120) < DT / 2) { w.V.convoyHeading = -60; w.V.convoySpeed = 6; }
    if (Math.abs(t - 200) < DT / 2) { w.V.convoyHeading = 150; w.V.convoySpeed = 3; }
    w.convoy.update(DT);
    if (i % 12 !== 0) continue;
    for (const p of w.convoy.platforms) {
      if (!Number.isFinite(p.x + p.y + p.z + p.up.y)) nan = true;
      // Ride height against the ground under its supports.
      let mean = 0;
      for (const [lx, lz] of p.supports) { const q = p.toWorld(lx, 0, lz); mean += w.field.height(q.x, q.z); }
      mean /= p.supports.length;
      worstGap = Math.max(worstGap, Math.abs(p.y - mean));
      // The road is only the train's width (Keith 2026-10-26): every car's footprint (tracks included) on its floor.
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0]]) {
        const q = p.toWorld(sx * p.halfW, 0, sz * p.spec.length / 2);
        worstOnRoad = Math.min(worstOnRoad, w.route.corridor(q.x, q.z));
      }
    }
  }
  // The road against the train: its width no more than a few metres past the widest car's footprint.
  const widest = Math.max(...w.convoy.platforms.map((p: Platform) => 2 * p.halfW));
  console.log(`  road ${(2 * w.V.routeHalfWidth).toFixed(0)} m wide (widest car with its tracks ${widest.toFixed(0)} m) · least road under a car's corner ${(worstOnRoad * 100).toFixed(0)}% (1 = on the floor)`);
  if (2 * w.V.routeHalfWidth > widest + 6) fail(`the road (${2 * w.V.routeHalfWidth} m) is much wider than the train (${widest.toFixed(0)} m)`);
  if (worstOnRoad < 0.85) fail(`a car's corner rode ${(worstOnRoad * 100).toFixed(0)}% on the road: off its edge`);
  const tilt = Math.max(...w.convoy.platforms.map((p: Platform) => p.maxTilt));
  const upright = Math.min(...w.convoy.platforms.map((p: Platform) => p.up.y));
  console.log(`  travelled ${w.convoy.bay.travelled.toFixed(0)} m · worst tilt ${tilt.toFixed(1)}° · worst ride gap ${worstGap.toFixed(2)} m · road ${w.route.count} points`);
  if (nan) fail("platform position went non-finite");
  if (tilt > 15) fail(`a platform tilted ${tilt.toFixed(1)}° (should ride the flattened road)`);
  if (upright < Math.cos(20 * D2R)) fail("a platform ended tipped over");
  if (worstGap > 1.2) fail(`a platform rode ${worstGap.toFixed(2)} m off the ground under it`);
}

/** Place the mech standing beside the bay platform: side metres left, ahead metres forward of the crane. */
function place(w: World, side: number, ahead: number) {
  for (let i = 0; i < 120; i++) w.convoy.update(DT);
  for (const c of w.cranes) { c.place(); c.calm(); }
  const p = w.convoy.bay, at = p.toWorld(side, 0, w.V.craneMount + ahead);
  w.sim.reset(at.x, at.z, p.heading);
  w.carry.state = "walking"; w.carry.armed = true;
}

/** Keep pace with the convoy (the stick along its heading at its speed). */
const pace = (w: World): MoveCommand => {
  const p = w.convoy.bay, k = p.speed / w.V.walkSpeed;
  return { x: p.fwd.x * k, z: p.fwd.z * k, sprint: false };
};
const still: MoveCommand = { x: 0, z: 0, sprint: false };

/** Deck-local position of the mech's middle, its hips above the deck, and whether it's inside the deck. */
function onDeck(w: World) {
  const p = w.convoy.bay, l = p.toLocal(w.sim.pos.x, w.sim.pos.z);
  const deckY = w.carry.ground.deckHeight(w.sim.pos.x, w.sim.pos.z);
  const inside = Math.abs(l.x) <= p.spec.width / 2 - w.V.deckMechRadius + 0.05 && Math.abs(l.z) <= p.spec.length / 2 - w.V.deckMechRadius + 0.05;
  return { l, hips: w.sim.pelvis.y - deckY, inside };
}

/** Pick the mech up from the sand and set it on the deck; returns the time it took, or NaN. */
function pickUp(w: World, label = "") {
  place(w, 15, 6);
  let t = 0, peak = 0;
  const seen: string[] = [];
  for (; t < 150 && w.carry.state !== "aboard"; t += DT) {
    tick(w, w.carry.state === "walking" || w.carry.state === "inRange" || w.carry.state === "pickup" ? pace(w) : still);
    if (seen[seen.length - 1] !== w.carry.state) seen.push(w.carry.state);
    if (w.carry.attached) peak = Math.max(peak, w.crane.swingOffset);
  }
  if (label) console.log(`  ${label}${seen.join(" > ")} · ${t.toFixed(1)} s · biggest swing while carried ${peak.toFixed(2)} m`);
  return w.carry.state === "aboard" ? t : NaN;
}

// 3. Pick-up: a mech keeping pace in range is picked up, swings, and is set on the set-down pad, then walks again.
{
  console.log("-- pick-up");
  const w = world();
  const t = pickUp(w, "states ");
  const p = w.convoy.bay, d = onDeck(w);
  console.log(`  set down at (${d.l.x.toFixed(2)}, ${d.l.z.toFixed(2)}) local (pad at 0, ${w.V.craneSetDown}) · hips ${d.hips.toFixed(2)} m above the deck · swing at set-down ${w.crane.swingOffset.toFixed(2)} m`);
  if (!Number.isFinite(t)) fail(`mech in range not set on the deck (ended ${w.carry.state})`);
  if (t > 15) fail(`pick-up took ${t.toFixed(1)} s (want under 15)`);
  if (Math.hypot(d.l.x, d.l.z - w.V.craneSetDown) > 0.5) fail(`set down ${Math.hypot(d.l.x, d.l.z - w.V.craneSetDown).toFixed(2)} m off the set-down pad`);
  if (Math.abs(d.hips - w.V.hipHeight) > 0.25) fail("not standing on the deck after set-down");
  if (w.crane.maxSwing < 0.05) fail("the load never swung (rope rigid?)");
  if (w.crane.maxSwing > 4) fail(`the load swung ${w.crane.maxSwing.toFixed(1)} m out`);
  if (w.sim.ground !== w.carry.ground || !w.carry.ground.onDeck) fail("walker not on the deck ground after set-down");
  void p;
}

// 3b. The rear mech bay (Keith 2026-10-25): a mech beside it is picked up by its own crane (the nearer one), set on
// its set-down pad, and launched again from its launch pad.
{
  console.log("-- rear mech bay");
  const w = world();
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  for (const c of w.cranes) { c.place(); c.calm(); }
  const rear = w.convoy.bays[1], rc = w.cranes[1];
  if (!rear || rear === w.convoy.bay) fail("no rear mech bay");
  else {
    const at = rear.toWorld(15, 0, rc.mount - 6);
    w.sim.reset(at.x, at.z, rear.heading);
    Object.assign(w.carry, { state: "walking", armed: true });
    let t = 0;
    for (; t < 60 && w.carry.state !== "aboard"; t += DT) {
      const k = rear.speed / w.V.walkSpeed;
      tick(w, ["walking", "inRange", "pickup"].includes(w.carry.state) ? { x: rear.fwd.x * k, z: rear.fwd.z * k, sprint: false } : still);
    }
    const l = rear.toLocal(w.sim.pos.x, w.sim.pos.z), setZ = w.V.craneSetDown * rear.craneEnd;
    const off = Math.hypot(l.x, l.z - setZ);
    console.log(`  picked up by the ${w.carry.crane.platform.spec.name} crane in ${t.toFixed(1)} s · set down ${off.toFixed(2)} m off its pad · front crane slew ${(w.cranes[0].slew / D2R).toFixed(0)}° (stowed)`);
    if (w.carry.state !== "aboard") fail(`rear bay pick-up didn't finish (state ${w.carry.state})`);
    if (w.carry.crane !== rc) fail("the front crane came for a mech beside the rear bay");
    if (off > 0.5) fail(`set down ${off.toFixed(2)} m off the rear bay's pad`);
    if (t > 15) fail(`rear pick-up took ${t.toFixed(1)} s`);
    // Launch from its left pad.
    const pad = deckLayout(rear, w.V).spots.find((s) => s.kind === "launch" && s.side === 1)!;
    let u = 0;
    for (; u < 60 && w.carry.state !== "landing"; u += DT) tick(w, w.carry.state === "aboard" ? walkToSpot(w.sim, rear, pad.x, pad.z, 0.5) : still);
    const ll = rear.toLocal(w.sim.pos.x, w.sim.pos.z);
    console.log(`  launched off the rear bay after ${u.toFixed(1)} s, landed ${ll.x.toFixed(1)} m beside it`);
    if (w.carry.state !== "landing") fail(`rear launch didn't land (state ${w.carry.state})`);
    else if (ll.x < rear.spec.width / 2 + 2) fail("rear launch landed on or against the platform");
  }
}

// 4. Walking out of range before the cradle connects: no pick-up.
{
  console.log("-- walk away");
  const w = world();
  place(w, 15, 6);
  let reaching = false, carried = false, t = 0;
  for (; t < 40; t += DT) {
    if (w.carry.state === "pickup") reaching = true;
    const p = w.convoy.bay;
    // Once the crane comes, sprint straight out to the side.
    tick(w, reaching ? { x: p.left.x, z: p.left.z, sprint: true } : pace(w));
    if (w.carry.attached || w.carry.state === "lifting" || w.carry.state === "aboard") carried = true;
  }
  console.log(`  crane came: ${reaching} · picked up: ${carried} · aborts ${w.carry.aborts} · ended ${w.carry.state} ${w.carry.distance(w.sim).toFixed(0)} m from the crane`);
  if (!reaching) fail("crane never started for the mech");
  if (carried) fail("mech that walked out of range was picked up");
  if (w.carry.aborts < 1) fail("pick-up not aborted");
}

// 5. Walking on the deck while the convoy rolls and turns: stays on the platform, feet on the deck and in reach,
// doesn't slide when standing, can't walk off the edge.
{
  console.log("-- walking on the deck");
  const w = world();
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  w.crane.place(); w.crane.calm();
  w.carry.putAboard(w.sim);
  const p = w.convoy.bay, half = p.spec.width / 2;
  // Back up the lane it came down before the last leg: straight from (3, -14) to (0, 2) runs into the round block on
  // the centre line, and the walker has no path-finding (at 6 m/s it came to rest dead behind it, 2026-10-26).
  const route: [number, number][] = [[-5, 6], [5, 6], [5, -2], [-4, -2], [-4, 14], [-6, 8], [3, -2], [3, -14], [3, -2], [0, 2]];
  let worstOut = 0, worstHips = 0, worstFoot = 0, nan = false, frames = 0, offDeckFeet = 0, minHips = Infinity, maxHips = -Infinity;
  const r0 = w.sim.stats.overreach;
  const watch = () => {
    frames++;
    const d = onDeck(w);
    if (!Number.isFinite(w.sim.pelvis.x + w.sim.pelvis.y + w.sim.pelvis.z)) nan = true;
    worstOut = Math.max(worstOut, Math.abs(d.l.x) - (half - w.V.deckMechRadius), Math.abs(d.l.z) - (p.spec.length / 2 - w.V.deckMechRadius));
    minHips = Math.min(minHips, d.hips); maxHips = Math.max(maxHips, d.hips);
    worstHips = Math.max(worstHips, Math.abs(d.hips - w.V.hipHeight));
    for (const f of w.sim.feet) {
      if (f.swinging) continue;
      worstFoot = Math.max(worstFoot, Math.abs(f.planted.y - w.carry.ground.deckHeight(f.planted.x, f.planted.z)));
      if (!w.carry.ground.over(f.planted.x, f.planted.z)) offDeckFeet++;
    }
  };
  let t = 0, wp = 0;
  // Turn the convoy partway round and change its speed while walking.
  for (; t < 120 && wp < route.length; t += DT) {
    if (Math.abs(t - 10) < DT / 2) w.V.convoyHeading = 70;
    if (Math.abs(t - 30) < DT / 2) w.V.convoySpeed = 6;
    const [x, z] = route[wp];
    const c = walkToSpot(w.sim, p, x, z, 0.6);
    if (c.x === 0 && c.z === 0) wp++;
    tick(w, c);
    watch();
  }
  // Walk hard into the rail on each side, and off the back.
  for (const dir of [[1, 0], [-1, 0], [0, -1]]) {
    for (let i = 0; i < 120 * 6; i++, t += DT) {
      tick(w, { x: p.left.x * dir[0] + p.fwd.x * dir[1], z: p.left.z * dir[0] + p.fwd.z * dir[1], sprint: true });
      watch();
    }
  }
  // Stand still for ten seconds: no sliding on the deck.
  for (let i = 0; i < 240; i++) { tick(w, still); watch(); }
  const a = onDeck(w).l;
  for (let i = 0; i < 1200; i++) { tick(w, still); watch(); }
  const b = onDeck(w).l, slide = Math.hypot(b.x - a.x, b.z - a.z);
  const over = w.sim.stats.overreach - r0;
  console.log(`  waypoints ${wp}/${route.length} in ${t.toFixed(0)} s · past the edge by ${Math.max(0, worstOut).toFixed(2)} m · hips ${minHips.toFixed(2)}-${maxHips.toFixed(2)} m over the deck · planted feet off the deck plane ${worstFoot.toFixed(3)} m · feet off the deck ${offDeckFeet} · overreach ${over}/${frames} frames · slid ${slide.toFixed(3)} m standing 10 s · ${w.carry.state}`);
  if (nan) fail("walker went non-finite on the deck");
  if (wp < route.length) fail(`only reached ${wp} of ${route.length} deck waypoints`);
  if (worstOut > 0.05) fail(`walked ${worstOut.toFixed(2)} m past the deck's edge`);
  // Was 0.7. Keith 2026-10-27 (d29b825) lengthened the Rampart's stride (stridePerSpeed 1.5, strideMax 7.05): walking at 3-4 m/s
// the steps outreach the legs for a moment (both feet planted far apart) and the hips sag up to ~0.8 m for ~0.1 s. The same
// sag shows on flat ground (probe: 2.54-3.12 m), so it is the stride, not deck riding. Still catches the hips collapsing.
if (worstHips > 1.0) fail(`hips ${worstHips.toFixed(2)} m off their height over the deck`);
  if (worstFoot > 0.15) fail(`planted feet ${worstFoot.toFixed(2)} m off the deck`);
  if (offDeckFeet > 0) fail(`feet planted off the deck ${offDeckFeet} times`);
  if (over > frames * 0.02) fail(`legs overreached ${over} of ${frames} frames on the moving deck`);
  if (slide > 0.15) fail(`slid ${slide.toFixed(2)} m standing on the moving deck`);
  if (w.carry.state !== "aboard") fail(`left the deck walking (state ${w.carry.state})`);
}

// 6. Parking: walk into a bay, E settles it, it rides parked, E stands it up and it walks again.
{
  console.log("-- parking");
  const w = world();
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  w.crane.place(); w.crane.calm();
  w.carry.putAboard(w.sim);
  const p = w.convoy.bay, bay = deckLayout(p, w.V).spots.find((s) => s.kind === "park")!;
  // E outside a bay does nothing.
  if (w.carry.togglePark(w.sim)) fail("parked outside a parking bay");
  let t = 0;
  for (; t < 30; t += DT) { const c = walkToSpot(w.sim, p, bay.x, bay.z, 0.4); if (c.x === 0 && c.z === 0) break; tick(w, c); }
  for (let i = 0; i < 120; i++) tick(w, still);
  if (!w.carry.togglePark(w.sim)) fail("couldn't park in the bay");
  for (let i = 0; i < Math.round((w.V.deckParkTime + 0.5) / DT); i++) tick(w, { x: 1, z: 0, sprint: true });
  const d0 = onDeck(w);
  for (let i = 0; i < 1200; i++) tick(w, { x: 1, z: 0, sprint: true }); // the stick does nothing while parked
  const d1 = onDeck(w);
  const drift = Math.hypot(d1.l.x - d0.l.x, d1.l.z - d0.l.z);
  console.log(`  ${w.carry.label} · in the bay at (${d1.l.x.toFixed(2)}, ${d1.l.z.toFixed(2)}) · hips ${d1.hips.toFixed(2)} m over the deck · moved ${drift.toFixed(3)} m in 10 s parked`);
  if (w.carry.state !== "parked") fail(`not parked (state ${w.carry.state})`);
  if (Math.abs(d1.hips - (w.V.hipHeight - w.V.deckCrouch)) > 0.15) fail("didn't settle to the park crouch");
  if (drift > 0.05) fail(`a parked mech moved ${drift.toFixed(2)} m on the deck`);
  if (!w.carry.label.includes("hold F to climb out")) fail("HUD doesn't say the pilot can climb out");
  w.carry.togglePark(w.sim);
  for (let i = 0; i < Math.round((w.V.deckRiseTime + 0.3) / DT); i++) tick(w, still);
  if (w.carry.state !== "aboard") fail(`didn't stand up (state ${w.carry.state})`);
  const before = onDeck(w).l;
  for (let i = 0; i < 360; i++) tick(w, { x: p.fwd.x, z: p.fwd.z, sprint: false });
  const after = onDeck(w).l;
  console.log(`  stood up and walked ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m along the deck · parks ${w.carry.parks}`);
  if (Math.hypot(after.x - before.x, after.z - before.z) < 2) fail("didn't walk after standing up");
}

// 7. Launch: walk onto a launch pad, the crane takes the mech out over that side and lets go on the sand at the
// convoy's velocity; stepping off the pad first cancels.
for (const speed of [ROUTE_DEFAULTS.convoySpeed, 4, 6]) {
  console.log(`-- launch at ${speed} m/s`);
  const w = world({ convoySpeed: speed });
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  w.crane.place(); w.crane.calm();
  w.carry.putAboard(w.sim);
  const p = w.convoy.bay, side = speed === 6 ? -1 : 1;
  const pad = deckLayout(p, w.V).spots.find((s) => s.kind === "launch" && s.side === side)!;
  let t = 0, peak = 0, onPadAt = NaN, letGoAt = NaN, dropFeet = NaN, minFeet = Infinity, landed = 0;
  const seen: string[] = [];
  for (; t < 150 && w.carry.state !== "landing"; t += DT) {
    tick(w, w.carry.state === "aboard" ? walkToSpot(w.sim, p, pad.x, pad.z, 0.5) : still);
    if (!Number.isFinite(onPadAt) && w.carry.spot?.kind === "launch") onPadAt = t;
    if (seen[seen.length - 1] !== w.carry.state) seen.push(w.carry.state);
    if (w.carry.attached) peak = Math.max(peak, w.crane.swingOffset);
    if (w.carry.state === "falling") {
      // Lowest foot over the sand while falling (never through it).
      const lowest = Math.min(...w.sim.feet.map((f) => f.pos.y - w.field.height(f.pos.x, f.pos.z)));
      if (!Number.isFinite(letGoAt)) { letGoAt = t; dropFeet = lowest; }
      minFeet = Math.min(minFeet, lowest);
      // Falling with the convoy, not left behind.
      const dv = Math.hypot(w.carry.fall.vx - p.vel.x, w.carry.fall.vz - p.vel.z);
      if (dv > 0.3) { fail(`falling ${dv.toFixed(2)} m/s off the convoy's velocity`); break; }
    }
    if (!Number.isFinite(w.sim.pelvis.y + w.crane.cradle.x)) { fail("non-finite during launch"); break; }
  }
  if (w.carry.state !== "landing") { fail(`launch didn't land (state ${w.carry.state}, phase ${w.carry.phase})`); continue; }
  // The frame after touchdown: both feet planted on the sand.
  let worstFoot = 0;
  // Planted spots exactly on the sand. (The walker takes its first step in the touchdown frame, so the foot about to
  // lift may already be rolling up off its heel: its sole within a heel roll of the sand, or swinging.)
  let worstSole = 0;
  for (const f of w.sim.feet) {
    worstFoot = Math.max(worstFoot, Math.abs(f.planted.y - w.field.height(f.planted.x, f.planted.z)));
    if (!f.swinging) worstSole = Math.max(worstSole, Math.abs(f.pos.y - w.field.height(f.pos.x, f.pos.z)));
  }
  if (worstSole > 0.15) fail(`a planted foot ${worstSole.toFixed(2)} m off the sand after touchdown`);
  tick(w, still);
  for (const f of w.sim.feet) if (!f.swinging) worstFoot = Math.max(worstFoot, Math.abs(f.planted.y - w.field.height(f.planted.x, f.planted.z)));
  landed = w.carry.lastLanding.speed;
  // The whole ground motion (the walk and any skid; 2026-10-31: the skid was left out, and with the crane's swing in the
  // fall a landing could skid across at up to 1 m/s for a third of a second unseen), the frame after touchdown and 0.1 s
  // into the forced follow.
  const motion = () => Math.hypot(w.sim.vel.x + w.sim.skid.x - p.vel.x, w.sim.vel.z + w.sim.skid.z - p.vel.z);
  const dv0 = motion();
  let dv = dv0;
  const l = p.toLocal(w.sim.pos.x, w.sim.pos.z);
  const launchTime = letGoAt - onPadAt;
  console.log(`  ${seen.join(" > ")} · ${launchTime.toFixed(1)} s from the pad to letting go · fell ${dropFeet.toFixed(2)} m in ${w.carry.lastLanding.time.toFixed(2)} s, hit at ${landed.toFixed(1)} m/s, ${l.x.toFixed(1)} m beside the platform · planted feet off the sand after touchdown ${worstFoot.toFixed(3)} m (soles ${worstSole.toFixed(2)}) · velocity off by ${dv0.toFixed(2)} m/s · biggest swing ${peak.toFixed(2)} m`);
  if (!(launchTime < 15)) fail(`launch took ${launchTime.toFixed(1)} s from the pad (want under 15)`);
  if (Math.abs(dropFeet - w.V.craneDropHeight) > 0.6) fail(`let go with the feet ${dropFeet.toFixed(2)} m over the sand (slider ${w.V.craneDropHeight})`);
  if (minFeet < -0.05) fail(`feet ${(-minFeet).toFixed(2)} m into the sand while falling`);
  if (worstFoot > 0.02) fail(`planted feet ${worstFoot.toFixed(3)} m off the sand after touchdown`);
  if (l.x * side < p.spec.width / 2 + 2) fail("set down on or against the platform, or on the wrong side");
  if (w.carry.ground.onDeck) fail("still on the deck ground after launch");
  for (const q of w.convoy.platforms) if (q.pushOut(w.sim.pos.x, w.sim.pos.z, 1.5)) fail(`launched into the ${q.spec.name} platform`);
  // Forced follow: keeps pace with the platform; the landing crouch springs back up.
  const start = { ...l };
  let worst = 0, lowHips = Infinity;
  for (let i = 0; i < Math.round(w.V.craneFollow / DT) - 2; i++) {
    tick(w, { x: -1, z: 0, sprint: false }); // the stick is ignored until the follow ends
    const n = p.toLocal(w.sim.pos.x, w.sim.pos.z);
    worst = Math.max(worst, Math.hypot(n.x - start.x, n.z - start.z));
    lowHips = Math.min(lowHips, w.sim.pelvis.y - w.field.height(w.sim.pos.x, w.sim.pos.z));
    if (i === Math.round(0.1 / DT)) dv = motion();
    if (!Number.isFinite(w.sim.pelvis.x + w.sim.pelvis.y + w.sim.pelvis.z)) { fail("non-finite after touchdown"); break; }
  }
  if (dv > 0.3) fail(`landed: ${dv.toFixed(2)} m/s off the convoy's velocity 0.1 s after touchdown`);
  const g = w.field.height(w.sim.pos.x, w.sim.pos.z), hips = w.sim.pelvis.y - g;
  const dv2 = Math.hypot(w.sim.vel.x - p.vel.x, w.sim.vel.z - p.vel.z);
  console.log(`  landing crouch to ${lowHips.toFixed(2)} m, hips back to ${hips.toFixed(2)} m · drifted ${worst.toFixed(2)} m from its spot beside the platform over the forced follow · velocity off by ${dv2.toFixed(2)} m/s (${w.carry.state})`);
  if (lowHips > w.V.hipHeight - 0.2) fail("no landing crouch");
  if (Math.abs(hips - w.V.hipHeight) > 0.3) fail(`hips ${hips.toFixed(2)} m over the sand after the follow (not standing back up)`);
  if (worst > 2) fail(`fell ${worst.toFixed(1)} m behind or aside during the forced follow`);
  if (dv2 > 0.3) fail(`${dv2.toFixed(2)} m/s off the convoy's velocity after the follow`);
  for (let i = 0; i < 60; i++) tick(w, still);
  if ((w.carry.state as string) !== "walking") fail(`control didn't come back (state ${w.carry.state})`);
  if (w.sim.stats.overreach > 60) fail(`legs overreached ${w.sim.stats.overreach} frames`);
}
{
  console.log("-- launch cancelled");
  const w = world();
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  w.crane.place(); w.crane.calm();
  w.carry.putAboard(w.sim);
  const p = w.convoy.bay, pad = deckLayout(p, w.V).spots.find((s) => s.kind === "launch")!;
  let t = 0;
  for (; t < 40 && w.carry.state !== "launching"; t += DT) tick(w, walkToSpot(w.sim, p, pad.x, pad.z, 0.5));
  if (w.carry.state !== "launching") fail("standing on the launch pad didn't call the crane");
  for (let i = 0; i < 120; i++) tick(w, still);
  for (let i = 0; i < 120 * 4; i++) tick(w, walkToSpot(w.sim, p, 0, -2, 0.5));
  console.log(`  crane called after ${t.toFixed(1)} s on the pad · stepped off: ${w.carry.state}, aborts ${w.carry.aborts}`);
  if (w.carry.state !== "aboard" || w.carry.aborts < 1 || w.carry.attached) fail(`stepping off the pad didn't cancel (state ${w.carry.state})`);
}

// 8. The swing: an empty cradle slewed hard swings, stays bounded and dies down; carried through a whole pick-up and
// launch it never runs away.
{
  console.log("-- swing");
  const w = world();
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  w.crane.place(); w.crane.calm();
  const cr = w.crane, a = cr.relLocal(-15, w.V.craneMount);
  cr.aim(a.slew, a.radius, cr.base.y - 6);
  let t = 0, peak = 0;
  for (; t < 60 && !(cr.settled() && t > 3); t += DT) { w.convoy.update(DT); cr.step(DT); peak = Math.max(peak, cr.swingOffset); }
  const atStop = cr.swingOffset;
  for (let i = 0; i < 120 * 40; i++) { w.convoy.update(DT); cr.step(DT); }
  const later = cr.swingOffset + cr.swingSpeed * 0.5;
  console.log(`  slew done in ${t.toFixed(1)} s · peak swing ${peak.toFixed(2)} m · at the stop ${atStop.toFixed(2)} m · 40 s later ${later.toFixed(3)} m`);
  if (peak < 0.1) fail("slewing the crane didn't swing the cradle");
  if (peak > 4) fail(`the cradle swung ${peak.toFixed(1)} m out`);
  if (later > Math.max(0.1, peak * 0.25)) fail(`the swing didn't die down (${later.toFixed(2)} m after 40 s)`);
  if (!Number.isFinite(cr.cradle.x + cr.cradle.y + cr.cradle.z)) fail("cradle went non-finite");
}


/** Corners of a platform's footprint in world x/z. */
function corners(p: Platform): [number, number][] {
  const out: [number, number][] = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) { const w = p.toWorld(sx * p.spec.width / 2, 0, sz * p.spec.length / 2); out.push([w.x, w.z]); }
  return out;
}
/** Clear distance between two platforms' footprints (0 if they overlap): vertex-to-rectangle both ways. */
function footGap(a: Platform, b: Platform) {
  let d = Infinity;
  for (const [x, z] of corners(a)) d = Math.min(d, rectGap(b, x, z));
  for (const [x, z] of corners(b)) d = Math.min(d, rectGap(a, x, z));
  return Math.max(0, d);
}
/** Distance from a platform's middle to its line's path along the route (searching near its station). */
function offPath(w: World, p: Platform) {
  let best = Infinity;
  for (let d = -p.spec.length / 2; d <= p.spec.length / 2; d += 0.25) {
    const q = w.route.offsetAt(w.route.s + p.along + d, p.side);
    best = Math.min(best, Math.hypot(q.x - p.x, q.z - p.z));
  }
  return best;
}

// 9. The train: five minutes of driving with turns and speed changes, in one line and in two.
for (const lanes of [1, 2]) {
  console.log(`-- train, ${lanes === 1 ? "one line" : "two lines"}`);
  const w = world({ trainLanes: lanes, bridgeCount: lanes === 1 ? 1 : 2 });
  const { V } = w;
  let worstPath = 0, worstGap = Infinity, worstClear = Infinity, nan = false, worstSide = Infinity, down = 0, spansSeen = 0;
  const stretch = [Infinity, 0];
  const frames = 300 * 120;
  let spans: Span[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i * DT;
    if (Math.abs(t - 40) < DT / 2) V.convoyHeading = 80;
    if (Math.abs(t - 110) < DT / 2) { V.convoyHeading = -70; V.convoySpeed = 6; V.convoyTurn = 4; }
    if (Math.abs(t - 200) < DT / 2) { V.convoyHeading = 120; V.convoySpeed = 3; }
    w.convoy.update(DT);
    if (i % 30 !== 0) continue;
    const ps = w.convoy.platforms;
    for (const p of ps) {
      if (!Number.isFinite(p.x + p.y + p.z + p.heading)) nan = true;
      worstPath = Math.max(worstPath, offPath(w, p));
      if (p.follows >= 0) worstGap = Math.min(worstGap, footGap(ps[p.follows], p));
    }
    // Two lines: cars side by side stay apart too.
    if (lanes === 2) for (let a = 1; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) if (ps[a].lane !== ps[b].lane) worstSide = Math.min(worstSide, footGap(ps[a], ps[b]));
    spans = bridgeSpans(ps, V, spans);
    for (const s of spans) {
      spansSeen++;
      if (s.lifted) continue;
      down++;
      const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z);
      stretch[0] = Math.min(stretch[0], len / s.rest); stretch[1] = Math.max(stretch[1], len / s.rest);
      // Underside over the sand along the span (the gangway's stringers hang 0.4 m under the walkway).
      for (let k = 0; k <= 10; k++) {
        const f = k / 10, x = s.a.x + (s.b.x - s.a.x) * f, y = s.a.y + (s.b.y - s.a.y) * f, z = s.a.z + (s.b.z - s.a.z) * f;
        worstClear = Math.min(worstClear, y - 0.4 - w.field.height(x, z));
      }
    }
  }
  console.log(`  ${w.convoy.platforms.length} cars over ${w.convoy.length.toFixed(0)} m · middles off their path up to ${worstPath.toFixed(2)} m · narrowest gap ${worstGap.toFixed(2)} m (slider ${V.trainGap})${lanes === 2 ? ` · lines apart ${worstSide.toFixed(2)} m` : ""} · bridges down ${((down / Math.max(1, spansSeen)) * 100).toFixed(0)}% of the time at ${(stretch[0] * 100).toFixed(0)}-${(stretch[1] * 100).toFixed(0)}% of rest, lowest ${worstClear.toFixed(2)} m over the sand`);
  if (nan) fail("a car went non-finite");
  if (worstPath > 1.5) fail(`a car's middle strayed ${worstPath.toFixed(2)} m off its line's path`);
  if (worstGap < V.trainGap - 0.75) fail(`the gap between cars closed to ${worstGap.toFixed(2)} m (slider ${V.trainGap})`);
  if (lanes === 2 && worstSide < 3) fail(`cars in the two lines came within ${worstSide.toFixed(2)} m`);
  if (worstClear < 5.2) fail(`a footbridge hung ${worstClear.toFixed(2)} m over the sand (the mech is 4.4 m to the hood)`);
  if (stretch[1] > REACH_MAX + 0.01 || stretch[0] < REACH_MIN - 0.01) fail(`a lowered footbridge stretched to ${(stretch[1] * 100).toFixed(0)}% or squeezed to ${(stretch[0] * 100).toFixed(0)}%`);
  if (down / Math.max(1, spansSeen) < 0.7) fail(`footbridges down only ${((down / spansSeen) * 100).toFixed(0)}% of the time`);
}

// 10. Walking across the train through a gap: the mech gets to the other side and is never thrown by the push-out.
{
  console.log("-- walking through a gap");
  const w = world();
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  const ps = w.convoy.platforms, car = ps[2], lead = ps[car.follows];
  const mid = () => {
    const a = lead.toWorld(0, 0, -lead.spec.length / 2), b = car.toWorld(0, 0, car.spec.length / 2);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  };
  let m = mid();
  w.sim.reset(m.x + car.left.x * 18, m.z + car.left.z * 18, car.heading);
  let worstJump = 0, near = 0, t = 0, crossed = false;
  for (; t < 40; t += DT) {
    m = mid();
    const tx = m.x - car.left.x * 18, tz = m.z - car.left.z * 18;
    const dx = tx - w.sim.pos.x, dz = tz - w.sim.pos.z, d = Math.hypot(dx, dz) || 1;
    const k = car.speed / w.V.walkSpeed;
    const cmd = { x: (dx / d) * 0.85 + car.fwd.x * k, z: (dz / d) * 0.85 + car.fwd.z * k, sprint: true };
    const l = Math.hypot(cmd.x, cmd.z);
    if (l > 1) { cmd.x /= l; cmd.z /= l; }
    w.convoy.update(DT);
    w.sim.update(DT, cmd);
    const walked = { x: w.sim.pos.x, z: w.sim.pos.z };
    for (const p of ps) { const o = p.pushOut(w.sim.pos.x, w.sim.pos.z, 2); if (o) { w.sim.pos.x = o.x; w.sim.pos.z = o.z; } }
    worstJump = Math.max(worstJump, Math.hypot(w.sim.pos.x - walked.x, w.sim.pos.z - walked.z));
    for (const p of ps) if (rectGap(p, w.sim.pos.x, w.sim.pos.z) < 0.5) near++;
    if (car.toLocal(w.sim.pos.x, w.sim.pos.z).x < -(car.spec.width / 2 + 4)) { crossed = true; break; }
  }
  console.log(`  crossed: ${crossed} in ${t.toFixed(1)} s · biggest push-out in a step ${worstJump.toFixed(3)} m · frames within 0.5 m of a footprint ${near}`);
  if (!crossed) fail("the mech couldn't walk through the gap between cars");
  if (worstJump > 0.25) fail(`the push-out moved the mech ${worstJump.toFixed(2)} m in one step walking through a ${w.V.trainGap} m gap`);
}

// 11. Escorts: three minutes alongside a turning convoy, a mech walking beside the train and then standing in their way.
{
  console.log("-- escorts");
  const w = world();
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  const esc = new EscortGroup(w.V, w.convoy, w.field);
  esc.reset();
  const frames = 180 * 120;
  let onStation = 0, samples = 0, worstPlat = Infinity, worstPlough = Infinity, worstMech = Infinity, nan = false, flipped = 0;
  // Off the road (Keith 2026-10-26: the road is only the train's width; escorts meander over the dunes beside it),
  // never stuck (along-route progress over 10 s windows against the convoy's), never tipping.
  let offRoad = 0, leaning = 0, worstRoll = 0, worstPitch = 0, worstPace = Infinity, paceWho = "", worstUp = 1;
  const WIN = 10 * 120, lastS = esc.list.map((e) => e.s);
  let convoyS = w.route.s;
  const mech = { x: 0, z: 0 };
  const up = new THREE.Vector3();
  for (let i = 0; i < frames; i++) {
    const t = i * DT;
    if (Math.abs(t - 30) < DT / 2) w.V.convoyHeading = 60;
    if (Math.abs(t - 90) < DT / 2) { w.V.convoyHeading = -30; w.V.convoySpeed = 5.5; }
    w.convoy.update(DT);
    // The mech: beside the bay on the left for the first minute, then standing on the first escort's line ahead of
    // it, then on the second one's (the other side).
    if (t < 60) { const q = w.convoy.bay.toWorld(16, 0, 0); mech.x = q.x; mech.z = q.z; }
    else if (Math.abs(t - 60) < DT / 2 || Math.abs(t - 120) < DT / 2) {
      const e = esc.list[t < 100 ? 0 : 1];
      const q = w.route.offsetAt(e.s + 45, e.side * e.stationOut);
      mech.x = q.x; mech.z = q.z;
    }
    esc.update(DT, mech);
    if (i > 0 && i % WIN === 0) {
      const conv = w.route.s - convoyS;
      esc.list.forEach((e, k) => {
        const pace = (e.s - lastS[k]) / Math.max(1e-6, conv);
        if (pace < worstPace) { worstPace = pace; paceWho = `${k} (${e.kind}) at ${(i * DT).toFixed(0)} s`; }
        lastS[k] = e.s;
      });
      convoyS = w.route.s;
    }
    if (i % 12 !== 0) continue;
    for (const e of esc.list) {
      const s = e.sim;
      if (!Number.isFinite(s.pos.x + s.pos.y + s.pos.z)) nan = true;
      const uy = up.set(0, 1, 0).applyQuaternion(s.quat).y;
      worstUp = Math.min(worstUp, uy);
      // Tipped over: rolled to the car sim's stop (57°) or past 75° from upright (nose-down down a slip face, the way
      // dune drivers take one, can reach 60°). Leaning hard (over 40°) is allowed only for moments, cresting a face.
      if (uy < 0.26 || Math.abs(s.roll) > 55 * D2R) flipped++;
      if (Math.abs(s.roll) > 40 * D2R) leaning++;
      worstRoll = Math.max(worstRoll, Math.abs(s.roll)); worstPitch = Math.max(worstPitch, Math.abs(s.pitch));
      if (Math.abs(e.out) > w.V.routeHalfWidth + 2) offRoad++;
      for (const p of w.convoy.platforms) worstPlat = Math.min(worstPlat, rectGap(p, s.pos.x, s.pos.z, e.half * 0.6));
      worstPlough = Math.min(worstPlough, rectGap(w.convoy.plough, s.pos.x, s.pos.z, e.half * 0.6));
      worstMech = Math.min(worstMech, Math.hypot(s.pos.x - mech.x, s.pos.z - mech.z) - e.half * 0.6);
      samples++;
      if (Math.abs(Math.abs(e.out) - e.stationOut) <= w.V.escortBand + w.V.escortWeave && Math.sign(e.out) === e.side) onStation++;
    }
  }
  const share = onStation / Math.max(1, samples), off = offRoad / Math.max(1, samples);
  console.log(`  ${esc.list.length} escorts · on station ${(share * 100).toFixed(0)}% · off the road ${(off * 100).toFixed(0)}% · closest to a platform ${worstPlat.toFixed(2)} m · to the plough ${worstPlough.toFixed(2)} m · closest to the mech ${worstMech.toFixed(2)} m · flipped ${flipped}`);
  console.log(`  slowest 10 s: ${(worstPace * 100).toFixed(0)}% of the convoy's progress (escort ${paceWho}) · worst roll ${(worstRoll / D2R).toFixed(0)}°, over 40° ${((leaning / Math.max(1, samples)) * 100).toFixed(2)}% of the time · pitch ${(worstPitch / D2R).toFixed(0)}° · lowest up ${worstUp.toFixed(2)}`);
  if (off < 0.8) fail(`escorts off the road only ${(off * 100).toFixed(0)}% of the time (they should ride the dunes beside it)`);
  if (worstPace < 0.3) fail(`escort ${paceWho} made only ${(worstPace * 100).toFixed(0)}% of the convoy's progress in 10 s: stuck`);
  if (leaning / Math.max(1, samples) > 0.005) fail(`escorts leaned over 40° ${((leaning / samples) * 100).toFixed(2)}% of the time`);
  if (nan) fail("an escort went non-finite");
  if (worstPlat < 1) fail(`an escort came within ${worstPlat.toFixed(2)} m of a platform`);
  if (worstPlough < 1) fail(`an escort came within ${worstPlough.toFixed(2)} m of the plough`);
  if (worstMech < 3) fail(`an escort drove within ${worstMech.toFixed(2)} m of the mech`);
  if (share < 0.8) fail(`escorts on station only ${(share * 100).toFixed(0)}% of the time`);
  if (flipped) fail("an escort tipped over");
}

// 12. Pipes: the same every time, some on every platform, out of the furniture and on the platform.
{
  console.log("-- pipes");
  const V = { ...PIPE_DEFAULTS };
  let total = 0, inside = 0, off = 0, differ = 0, furnOff = 0;
  CONVOY_LAYOUT.forEach((spec, index) => {
    const D = spec.tracked ? PLATFORM_DEFAULTS.convoyBayDeck : PLATFORM_DEFAULTS.convoyDeckHeight;
    const { items } = furniture(spec, D);
    const ol = deckOutline(spec);
    const site = { length: spec.length, width: spec.width, deck: D, mounts: items.filter((f) => f.mount).map(furnBox), keepOut: items.filter((f) => !f.mount).map(furnBox), walkable: spec.kind === "bay", index, outline: ol };
    // Furniture stands on the cut-cornered deck.
    for (const f of items) { const b = furnBox(f); for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (outside(ol, b.x + sx * b.hx, b.z + sz * b.hz) > 0.05) furnOff++; }
    const a = generatePipes(site, V), b = generatePipes(site, V);
    if (JSON.stringify(a) !== JSON.stringify(b)) differ++;
    total += a.runs;
    if (a.runs === 0) fail(`no pipes on the ${spec.name}`);
    const boxes = items.map(furnBox);
    for (const t of a.tubes) for (let k = 0; k <= 8; k++) {
      const f = k / 8, x = t.a[0] + (t.b[0] - t.a[0]) * f, y = t.a[1] + (t.b[1] - t.a[1]) * f, z = t.a[2] + (t.b[2] - t.a[2]) * f;
      for (const bx of boxes) if (Math.abs(x - bx.x) < bx.hx - 0.06 && Math.abs(y - bx.y) < bx.hy - 0.06 && Math.abs(z - bx.z) < bx.hz - 0.06) inside++;
      if (outside(ol, x, z) > (y < D ? 1 : 0.2) || y < 0.5) off++;
    }
  });
  const none = generatePipes({ length: 24, width: 10, deck: 3.2, mounts: [], keepOut: [], walkable: false, index: 0 }, { ...V, pipeDensity: 0 });
  console.log(`  ${total} runs on ${CONVOY_LAYOUT.length} platforms · tube points inside furniture ${inside} · off the platform ${off} · differ between runs ${differ} · furniture corners off the deck outline ${furnOff}`);
  if (furnOff) fail(`${furnOff} furniture corners stand off the deck outline`);
  if (differ) fail("pipes differ between two runs with the same seed");
  if (inside) fail(`${inside} pipe points inside furniture`);
  if (off) fail(`${off} pipe points off the platform`);
  if (none.tubes.length) fail("pipes with density 0");
}

// 13. Tracks and the trail: tread loops close, the bottom run sits on the ground, ruts and dust at a sane rate.
{
  console.log("-- tracks and trail");
  const w = world();
  const bay = w.convoy.bay;
  for (const pod of trackPods(bay.spec, w.V)) {
    const L = treadLength(pod), a = treadAt(pod, 0), b = treadAt(pod, L);
    if (Math.hypot(a.y - b.y, a.z - b.z) > 1e-6) fail("tread loop doesn't close");
    if (Math.abs(treadAt(pod, (pod.z0 - pod.z1) / 2).y) > 1e-9) fail("tread bottom run not on the ground");
    if (pod.z0 > bay.spec.length / 2 || pod.z1 < -bay.spec.length / 2 || Math.abs(pod.x) + pod.w / 2 > bay.halfW + 1e-6) fail("a track pod sticks out of the platform's footprint");
  }
  let dust = 0, ruts = 0;
  const fx = {
    dust: {
      wheel: (_x: number, _y: number, _z: number, _vx: number, _vz: number, m: number, _s: number, acc: number) => { acc += m * 0.5; while (acc >= 1) { acc -= 1; dust++; } return acc; },
      surfaceAt: () => "sand" as const,
    },
    marks: { rut: () => { ruts++; } },
  };
  const trail = new ConvoyTrail(w.V, fx, w.field);
  const secs = 60;
  for (let i = 0; i < secs * 120; i++) { w.convoy.update(DT); if (i % 2 === 0) trail.update(w.convoy.platforms); }
  console.log(`  ${secs} s at ${w.V.convoySpeed} m/s: ${ruts} ruts (${(ruts / secs).toFixed(1)}/s), ${dust} dust puffs (${(dust / secs).toFixed(1)}/s)`);
  if (ruts < secs) fail("too few ruts behind the convoy");
  if (ruts / secs > 40) fail(`ruts at ${(ruts / secs).toFixed(0)} a second (the mark pool is 900)`);
  if (dust / secs > 250) fail(`dust at ${(dust / secs).toFixed(0)} puffs a second`);
  if (dust < secs) fail("no dust from the convoy");
}

// 14. Defences: turrets at the cut corners (outside the walkable deck) and a heavy one on each mech bay; idle they sweep
// about their rest bearing; given a threat they all come onto it at their turn rates, and the fire hook fires.
{
  console.log("-- defences");
  const w = world();
  const V = { ...DEFENCE_DEFAULTS };
  const def = new Defence(V, w.convoy.platforms);
  const twins = def.turrets.filter((t) => t.kind === "twin").length, heavies = def.turrets.length - twins;
  let onDeck = 0;
  for (const t of def.turrets) if (t.kind === "twin" && outside(t.platform.outline, t.x, t.z) < 0) onDeck++;
  // Idle for 30 s while the convoy drives.
  let worstIdle = 0, nan = false;
  for (let i = 0; i < 120 * 30; i++) {
    w.convoy.update(DT); def.target([]); def.update(DT);
    for (const t of def.turrets) {
      if (!Number.isFinite(t.yaw + t.pitch)) nan = true;
      const d = Math.abs(Math.atan2(Math.sin(t.yaw - t.rest), Math.cos(t.yaw - t.rest)));
      worstIdle = Math.max(worstIdle, d / D2R);
    }
  }
  // A threat 60 m off the left of the middle car, then swung to the right: time for all to come on.
  let shots = 0, tracking = 0;
  def.onFire = () => { shots++; };
  const onTarget = (side: number) => {
    let t = 0;
    for (; t < 10; t += DT) {
      w.convoy.update(DT);
      const mid = w.convoy.platforms[3], q = mid.toWorld(side * 60, 5, 0);
      def.target([q]); def.update(DT);
      // Every turret with it in range is on it (the far cars are out of range).
      if (t > DT && def.turrets.every((u) => !u.target || def.error(u)! < 3 * D2R)) break;
    }
    tracking = Math.max(tracking, def.turrets.filter((u) => u.target).length);
    return t;
  };
  const tl = onTarget(1), tr = onTarget(-1);
  console.log(`  ${twins} twin turrets, ${heavies} heavy · twins standing on the walkable deck ${onDeck} · idle sweep up to ${worstIdle.toFixed(0)}° off rest (slider ${V.defenceScan}) · all on a threat in ${tl.toFixed(1)} s, swung to the other side in ${tr.toFixed(1)} s · ${tracking} in range · ${shots} shots through the hook`);
  if (tracking < 6) fail(`only ${tracking} turrets took the threat`);
  if (twins !== w.convoy.platforms.length * V.defenceCount) fail(`expected ${w.convoy.platforms.length * V.defenceCount} twin turrets, got ${twins}`);
  if (heavies !== w.convoy.bays.length) fail(`expected a heavy turret on each of ${w.convoy.bays.length} mech bays, got ${heavies}`);
  if (onDeck) fail(`${onDeck} turrets stand on the walkable deck`);
  if (nan) fail("a turret went non-finite");
  if (worstIdle > V.defenceScan + 5) fail(`idle turret swung ${worstIdle.toFixed(0)}° off its rest`);
  if (tl >= 10 || tr >= 10) fail("turrets didn't all come onto the threat");
  if (tr > 180 / V.defenceHeavyTurn + 1.5) fail(`swinging round took ${tr.toFixed(1)} s (turn rates say under ${(180 / V.defenceHeavyTurn + 1.5).toFixed(1)})`);
  if (!shots) fail("the fire hook never fired");
}

if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("convoy check failed"); }
console.log("convoy check passed");
