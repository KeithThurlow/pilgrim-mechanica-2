// Headless convoy check: the flattened road is a pure function of position (same heights in any order, continuous
// across the edge blend, no slopes steeper than the dunes'), platforms stay on the ground and upright for 5 minutes
// of driving (with heading changes), a mech standing in crane range is picked up and ends on the deck, a mech that
// walks out of range before the cradle connects is not, and a deploy puts the mech on the sand beside the convoy at
// the convoy's velocity, keeping pace through the forced follow. Run: npm test (or npx tsx tools/convoy-check.ts).
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS, type Platform } from "../src/convoy/platform";
import { Crane, CRANE_DEFAULTS } from "../src/convoy/crane";
import { CraneCarry, CARRY_DEFAULTS } from "../src/convoy/carry";

const DT = 1 / 120;
const problems: string[] = [];
const fail = (s: string) => { problems.push(s); console.log("  FAIL " + s); };
const D2R = Math.PI / 180;

function world(over: Partial<typeof ROUTE_DEFAULTS> = {}) {
  const V = { ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...over };
  const field = new DuneField(V);
  const route = new ConvoyRoute(V, 13, -40);
  field.modifier = route;
  const convoy = new Convoy(route, V, field);
  convoy.reset(13, -40);
  const crane = new Crane(V, convoy.bay);
  const carry = new CraneCarry(V, crane, field);
  const sim = new WalkerSim(V, field);
  return { V, field, route, convoy, crane, carry, sim };
}
type World = ReturnType<typeof world>;

function tick(w: World, cmd: MoveCommand) {
  w.convoy.update(DT);
  const c = w.carry.update(DT, w.sim, cmd);
  if (c) {
    w.sim.update(DT, c);
    for (const p of w.convoy.platforms) { const o = p.pushOut(w.sim.pos.x, w.sim.pos.z, 2); if (o) { w.sim.pos.x = o.x; w.sim.pos.z = o.z; } }
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
  const reach = V.routeHalfWidth + V.routeBlend;
  for (let s = -200; s < route.s + 100; s += 9.7) for (const dir of [1, -1]) {
    let prev = NaN;
    for (let d = 0; d <= reach + 10; d += 0.1) {
      const p = route.offsetAt(s, dir * d), h = field.height(p.x, p.z);
      if (Number.isFinite(prev)) maxStep = Math.max(maxStep, Math.abs(h - prev));
      prev = h;
      if (Math.abs(d % 1) < 0.05) {
        const sl = slope(field, p.x, p.z);
        if (d < V.routeHalfWidth - 6) maxFloorSlope = Math.max(maxFloorSlope, sl);
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
  if (maxEdgeSlope > maxDuneSlope) fail(`road edges reach ${maxEdgeSlope.toFixed(0)}°, steeper than the dunes' ${maxDuneSlope.toFixed(0)}°`);
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

// 2. Five minutes of driving with heading changes and a speed change: platforms on the ground and upright.
{
  console.log("-- platforms, 5 minutes");
  const w = world();
  const frames = 300 * 120;
  let worstGap = 0, nan = false;
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
    }
  }
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
  w.crane.place();
  const p = w.convoy.bay, at = p.toWorld(side, 0, w.V.craneMount + ahead);
  w.sim.reset(at.x, at.z, p.heading);
  w.carry.state = "walking"; w.carry.armed = true;
}

// 3. A mech standing in range is picked up and ends on the deck.
{
  console.log("-- pick-up");
  const w = world();
  place(w, 14, 20);
  const seen = new Set<string>();
  let t = 0;
  for (; t < 60 && w.carry.state !== "aboard"; t += DT) { tick(w, { x: 0, z: 0, sprint: false }); seen.add(w.carry.state); }
  const p = w.convoy.bay, l = p.toLocal(w.sim.pelvis.x, w.sim.pelvis.z), deckY = p.toWorld(0, p.deck, w.V.craneBaySlot).y;
  console.log(`  states ${[...seen].join(" > ")} · aboard after ${t.toFixed(1)} s · on deck at (${l.x.toFixed(2)}, ${l.z.toFixed(2)}) local, hips ${(w.sim.pelvis.y - deckY).toFixed(2)} m above the deck`);
  if (w.carry.state !== "aboard") fail(`mech in range not picked up (ended ${w.carry.state})`);
  if (Math.abs(l.x) > 1 || Math.abs(l.z - w.V.craneBaySlot) > 1) fail("mech not set down on the bay slot");
  if (Math.abs(w.sim.pelvis.y - deckY - w.V.hipHeight) > 0.2) fail("mech not standing on the deck");
  // Riding: ten seconds later still on the slot.
  for (let i = 0; i < 1200; i++) tick(w, { x: 1, z: 0, sprint: false });
  const l2 = p.toLocal(w.sim.pelvis.x, w.sim.pelvis.z);
  if (w.carry.state !== "aboard" || Math.abs(l2.z - w.V.craneBaySlot) > 1) fail("mech didn't ride the platform");
  for (const f of w.sim.feet) if (Math.abs(f.pos.y - p.toWorld(0, p.deck, w.V.craneBaySlot).y) > 0.3) fail("feet off the deck while aboard");
}

// 4. Walking out of range before the cradle connects: no pick-up.
{
  console.log("-- walk away");
  const w = world();
  place(w, 14, 20);
  let reaching = false, carried = false, t = 0;
  for (; t < 30; t += DT) {
    if (w.carry.state === "pickup") reaching = true;
    const p = w.convoy.bay;
    // Once the crane comes, sprint straight out to the side.
    const cmd = reaching ? { x: p.left.x, z: p.left.z, sprint: true } : { x: 0, z: 0, sprint: false };
    tick(w, cmd);
    if (w.carry.attached || w.carry.state === "lifting" || w.carry.state === "aboard") carried = true;
  }
  console.log(`  crane came: ${reaching} · picked up: ${carried} · aborts ${w.carry.aborts} · ended ${w.carry.state} ${w.carry.distance(w.sim).toFixed(0)} m from the crane`);
  if (!reaching) fail("crane never started for the mech");
  if (carried) fail("mech that walked out of range was picked up");
  if (w.carry.aborts < 1) fail("pick-up not aborted");
}

// 5. Deploy: lowered to the sand beside the convoy, released at its velocity, keeps pace through the forced follow.
for (const speed of [4, 6]) {
  console.log(`-- deploy at ${speed} m/s`);
  const w = world({ convoySpeed: speed });
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  w.crane.place();
  w.carry.putAboard(w.sim);
  w.carry.deploy(1);
  let t = 0;
  for (; t < 60 && w.carry.state === "deploying"; t += DT) tick(w, { x: 0, z: 0, sprint: false });
  const p = w.convoy.bay;
  if (w.carry.state !== "landing") { fail(`deploy didn't release (state ${w.carry.state})`); continue; }
  const g = w.field.height(w.sim.pos.x, w.sim.pos.z);
  const dv = Math.hypot(w.sim.vel.x - p.vel.x, w.sim.vel.z - p.vel.z);
  const l = p.toLocal(w.sim.pos.x, w.sim.pos.z);
  console.log(`  released after ${t.toFixed(1)} s at ${l.x.toFixed(1)} m beside the platform · hips ${(w.sim.pelvis.y - g).toFixed(2)} m over the sand · velocity off by ${dv.toFixed(2)} m/s`);
  if (Math.abs(w.sim.pelvis.y - g - w.V.hipHeight) > 0.3) fail("not set down on the sand");
  if (l.x < p.spec.width / 2 + 2) fail("set down on or against the platform");
  if (dv > 0.3) fail(`released at ${dv.toFixed(2)} m/s off the convoy's velocity`);
  for (const q of w.convoy.platforms) if (q.pushOut(w.sim.pos.x, w.sim.pos.z, 1.5)) fail(`deployed into the ${q.spec.name} platform`);
  // Forced follow: keeps pace with the platform.
  const start = { ...l };
  let worst = 0;
  for (let i = 0; i < Math.round(w.V.craneFollow / DT) - 1; i++) {
    tick(w, { x: -1, z: 0, sprint: false }); // the stick is ignored until the follow ends
    const n = p.toLocal(w.sim.pos.x, w.sim.pos.z);
    worst = Math.max(worst, Math.hypot(n.x - start.x, n.z - start.z));
  }
  console.log(`  drifted ${worst.toFixed(2)} m from its spot beside the platform over the forced follow (${w.carry.state})`);
  if (worst > 2) fail(`fell ${worst.toFixed(1)} m behind or aside during the forced follow`);
  for (let i = 0; i < 60; i++) tick(w, { x: 0, z: 0, sprint: false });
  if ((w.carry.state as string) !== "walking") fail(`control didn't come back (state ${w.carry.state})`);
  if (w.sim.stats.overreach > 30) fail(`legs overreached ${w.sim.stats.overreach} frames after release`);
}

if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("convoy check failed"); }
console.log("convoy check passed");
