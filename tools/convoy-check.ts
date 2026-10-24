// Headless convoy check: the flattened road is a pure function of position (same heights in any order, continuous
// across the edge blend, no slopes steeper than the dunes'), platforms stay on the ground and upright for 5 minutes
// of driving (with heading changes); a mech keeping pace in crane range is picked up, swings, and is set on the deck's
// set-down pad standing; one that walks out of range before the cradle connects is not; walking on the deck while the
// convoy rolls, turns and speeds up keeps it on the platform (never past the edge, planted feet on the deck plane, legs
// in reach, no sliding when standing); parking settles it in a bay and holds it there, E stands it up; walking onto a
// launch pad has the crane put it on the sand beside the convoy at the convoy's velocity (stepping off first
// cancels); the swing is bounded and dies down. Run: npm test (or npx tsx tools/convoy-check.ts).
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS, type Platform } from "../src/convoy/platform";
import { Crane, CRANE_DEFAULTS } from "../src/convoy/crane";
import { CraneCarry, CARRY_DEFAULTS } from "../src/convoy/carry";
import { DECK_DEFAULTS, deckLayout, walkToSpot } from "../src/convoy/deck";

const DT = 1 / 120;
const problems: string[] = [];
const fail = (s: string) => { problems.push(s); console.log("  FAIL " + s); };
const D2R = Math.PI / 180;

function world(over: Partial<typeof ROUTE_DEFAULTS> = {}) {
  const V = { ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS, ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...over };
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
  w.crane.calm();
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
  if (Math.hypot(d.l.x, d.l.z - w.V.craneSetDown) > 0.5) fail(`set down ${Math.hypot(d.l.x, d.l.z - w.V.craneSetDown).toFixed(2)} m off the set-down pad`);
  if (Math.abs(d.hips - w.V.hipHeight) > 0.25) fail("not standing on the deck after set-down");
  if (w.crane.maxSwing < 0.05) fail("the load never swung (rope rigid?)");
  if (w.crane.maxSwing > 4) fail(`the load swung ${w.crane.maxSwing.toFixed(1)} m out`);
  if (w.sim.ground !== w.carry.ground || !w.carry.ground.onDeck) fail("walker not on the deck ground after set-down");
  void p;
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
  const route: [number, number][] = [[-5, 6], [5, 6], [5, -2], [-4, -2], [-4, 14], [-6, 8], [3, -2], [3, -14], [0, 2]];
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
  if (worstHips > 0.7) fail(`hips ${worstHips.toFixed(2)} m off their height over the deck`);
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
  if (!w.carry.label.includes("pilot can climb out")) fail("HUD doesn't say the pilot can climb out");
  w.carry.togglePark(w.sim);
  for (let i = 0; i < Math.round((w.V.deckParkTime + 0.3) / DT); i++) tick(w, still);
  if (w.carry.state !== "aboard") fail(`didn't stand up (state ${w.carry.state})`);
  const before = onDeck(w).l;
  for (let i = 0; i < 360; i++) tick(w, { x: p.fwd.x, z: p.fwd.z, sprint: false });
  const after = onDeck(w).l;
  console.log(`  stood up and walked ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m along the deck · parks ${w.carry.parks}`);
  if (Math.hypot(after.x - before.x, after.z - before.z) < 2) fail("didn't walk after standing up");
}

// 7. Launch: walk onto a launch pad, the crane takes the mech out over that side and lets go on the sand at the
// convoy's velocity; stepping off the pad first cancels.
for (const speed of [4, 6]) {
  console.log(`-- launch at ${speed} m/s`);
  const w = world({ convoySpeed: speed });
  for (let i = 0; i < 240; i++) w.convoy.update(DT);
  w.crane.place(); w.crane.calm();
  w.carry.putAboard(w.sim);
  const p = w.convoy.bay, side = speed === 4 ? 1 : -1;
  const pad = deckLayout(p, w.V).spots.find((s) => s.kind === "launch" && s.side === side)!;
  let t = 0, peak = 0;
  const seen: string[] = [];
  for (; t < 150 && w.carry.state !== "landing"; t += DT) {
    tick(w, w.carry.state === "aboard" ? walkToSpot(w.sim, p, pad.x, pad.z, 0.5) : still);
    if (seen[seen.length - 1] !== w.carry.state) seen.push(w.carry.state);
    if (w.carry.attached) peak = Math.max(peak, w.crane.swingOffset);
    if (!Number.isFinite(w.sim.pelvis.y + w.crane.cradle.x)) { fail("non-finite during launch"); break; }
  }
  if (w.carry.state !== "landing") { fail(`launch didn't release (state ${w.carry.state}, phase ${w.carry.phase})`); continue; }
  const g = w.field.height(w.sim.pos.x, w.sim.pos.z);
  const dv = Math.hypot(w.sim.vel.x - p.vel.x, w.sim.vel.z - p.vel.z);
  const l = p.toLocal(w.sim.pos.x, w.sim.pos.z);
  console.log(`  ${seen.join(" > ")} · released after ${t.toFixed(1)} s at ${l.x.toFixed(1)} m beside the platform · hips ${(w.sim.pelvis.y - g).toFixed(2)} m over the sand · velocity off by ${dv.toFixed(2)} m/s · biggest swing ${peak.toFixed(2)} m`);
  if (Math.abs(w.sim.pelvis.y - g - w.V.hipHeight) > 0.3) fail("not set down on the sand");
  if (l.x * side < p.spec.width / 2 + 2) fail("set down on or against the platform, or on the wrong side");
  if (dv > 0.3) fail(`released at ${dv.toFixed(2)} m/s off the convoy's velocity`);
  if (w.carry.ground.onDeck) fail("still on the deck ground after launch");
  for (const q of w.convoy.platforms) if (q.pushOut(w.sim.pos.x, w.sim.pos.z, 1.5)) fail(`launched into the ${q.spec.name} platform`);
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

if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("convoy check failed"); }
console.log("convoy check passed");
