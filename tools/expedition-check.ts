// Headless expedition check (docs/proposal-expedition.md):
// - banking happens only on a pick-up (nothing banks while out, aboard nothing goes at risk);
// - a called recovery, running out of fuel and a destroyed mech each lose the at-risk list but never the fitted gear
//   or the bank, and bring the mech home after the fade;
// - the return point is reachable in the estimated time on flat ground: a point walking straight at it at walk pace,
//   from ahead, beside and behind the convoy, arrives inside the crane's pick-up range of the crane it was told;
// - fuel never goes negative (random burns, dashes, sprints), and burns as the rates say;
// - out of fuel triggers a forced recovery;
// - the whole loop with the real walker and crane: launched by the crane, out, home to the return point, gripped:
//   banked once, only on the grip, inside the estimate;
// - the radar: linked inside the range edge only, the zoom fires one event per crossing and lands on each range,
//   unknown areas hide POIs and swarms from the convoy radar but not from the mech's own, mech radar only in range;
// - and it measures a typical out-and-back (launch, walk to the nearest POIs ahead, strip a stop or two, follow the
//   return point home) with the default tuning, reporting the time and the fuel, which must stay under 20 minutes;
// - packs and raids: the first fight within 75 s of the drop, about one a minute or two after, none while aboard.
// Run: npm test (or npx tsx tools/expedition-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS } from "../src/convoy/platform";
import { Crane, CRANE_DEFAULTS } from "../src/convoy/crane";
import { CraneCarry, CARRY_DEFAULTS } from "../src/convoy/carry";
import { DECK_DEFAULTS } from "../src/convoy/deck";
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { Expedition, EXPEDITION_DEFAULTS } from "../src/expedition/expedition";
import { Fuel, FUEL_DEFAULTS, burnRate, fuelWarning } from "../src/expedition/fuel";
import { returnPoint, craneTracks, clock, RETURN_DEFAULTS } from "../src/expedition/returnPoint";
import { RadarZoom, RADAR_DEFAULTS, linked, radarPicture, type RadarWorld } from "../src/expedition/radar";
import { CampField, CAMP_DEFAULTS } from "../src/expedition/camps";
import { depthAt, dangerOf, ringOf, DEPTH_DEFAULTS } from "../src/expedition/depth";
import { ThreatField, THREAT_DEFAULTS, type ThreatEvent } from "../src/expedition/threats";
import { POI_DEFAULTS, PoiField } from "../src/world/pois";
import { rawGround } from "../src/world/poiPads";
import { SITE_DEFAULTS, buildSite } from "../src/pois/kinds";
import { defaultLoadout } from "../src/items/loadout";
import { rollProtocol } from "../src/items/generate";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 40) console.log("  FAIL " + s); problems.push(s); };
const V = {
  ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS, ...TRAIN_DEFAULTS,
  ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...EXPEDITION_DEFAULTS, ...FUEL_DEFAULTS, ...RETURN_DEFAULTS, ...RADAR_DEFAULTS,
  ...CAMP_DEFAULTS, ...POI_DEFAULTS, ...SITE_DEFAULTS,
};
const FLAT = { ...V, height: 0, swell: 0, bumps: 0 };
const run = (e: Expedition, s: number, recall = false, empty = false) => {
  let home = 0;
  for (let t = 0; t < s; t += 1 / 60) if (e.update(1 / 60, recall, empty) === "home") home++;
  return home;
};

// ---- 1. banking only on pick-up ----
{
  const e = new Expedition(V);
  if (e.add({ kind: "scrap", amount: 5, label: "x" })) fail("loot went at risk while aboard");
  e.launch();
  e.add({ kind: "scrap", amount: 12, label: "Debris field" });
  e.add({ kind: "scrap", amount: 8, label: "Debris field" });
  e.add({ kind: "scrap", amount: 5, label: "Wreck part" });
  run(e, 30);
  if (e.bank.scrap !== 0) fail(`banked ${e.bank.scrap} without a pick-up`);
  if (e.scrapAtRisk !== 25 || e.atRisk.length !== 2) fail(`at risk ${e.scrapAtRisk} in ${e.atRisk.length} lines (want 25 in 2)`);
  if (!e.pickedUp()) fail("pick-up refused while out");
  if (e.bank.scrap !== 25 || e.atRisk.length !== 0 || e.state !== "aboard") fail(`after pick-up: bank ${e.bank.scrap}, ${e.atRisk.length} at risk, ${e.state}`);
  if (e.pickedUp()) fail("a second pick-up aboard banked again");
  console.log(`banking: 25 scrap at risk for 30 s, banked only by the pick-up (bank ${e.bank.scrap})`);
}

// ---- 2. recovery, fuel and destruction lose the at-risk list, never the fitted gear or the bank ----
for (const how of ["recalled", "fuel", "destroyed"] as const) {
  const e = new Expedition(V), lo = defaultLoadout(), before = JSON.stringify(lo);
  e.bank.scrap = 40;
  e.launch();
  e.add({ kind: "scrap", amount: 30, label: "Supply pod" });
  e.add({ kind: "item", item: rollProtocol(5), label: "Supply pod" });
  let homes = 0;
  if (how === "recalled") homes = run(e, 10, true);
  else if (how === "fuel") homes = run(e, 10, false, true);
  else { e.destroyed(); homes = run(e, 10); }
  if (e.atRisk.length) fail(`${how}: ${e.atRisk.length} lines still at risk`);
  if (e.bank.scrap !== 40 || e.bank.items.length) fail(`${how}: bank changed to ${e.bank.scrap} scrap, ${e.bank.items.length} items`);
  if (JSON.stringify(lo) !== before) fail(`${how}: the fitted gear changed`);
  if (homes !== 1) fail(`${how}: brought home ${homes} times (want once)`);
  if (e.state !== "aboard") fail(`${how}: ended ${e.state}, not aboard`);
  if (e.last?.reason !== how || e.last.scrap !== 30 || e.last.items !== 1) fail(`${how}: result ${JSON.stringify(e.last)}`);
}
{
  // The recall needs the key held the whole time.
  const e = new Expedition(V);
  e.launch();
  for (let t = 0; t < 10; t += 1 / 60) e.update(1 / 60, (t % 2) < V.recallHold * 0.66, false);
  if (e.state !== "out") fail("a recall key tapped (never held for the full time) recovered the mech");
  console.log("losing: recall, fuel and destruction each lose the at-risk list; fitted gear and the bank untouched; one trip home each");
}

// ---- 3. fuel never negative; rates; out of fuel forces recovery ----
{
  const f = new Fuel(V);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let minLeft = Infinity;
  for (let k = 0; k < 20000; k++) {
    const r = rnd();
    if (r < 0.05) f.dash();
    else if (r < 0.06) f.spend(rnd() * 500);
    else f.burn(rnd() * 3, { speed: rnd() * 22, walkSpeed: V.walkSpeed, sprintSpeed: V.sprintSpeed, bounding: rnd() < 0.2, stripping: rnd() < 0.2 });
    minLeft = Math.min(minLeft, f.left);
    if (f.left < 0 || !Number.isFinite(f.left)) { fail(`fuel went to ${f.left}`); break; }
  }
  if (f.burnt > f.capacity + 1e-6) fail(`burnt ${f.burnt} of a ${f.capacity} pack`);
  const b = (speed: number, o = {}) => burnRate(V, { speed, walkSpeed: V.walkSpeed, sprintSpeed: V.sprintSpeed, ...o });
  if (Math.abs(b(V.walkSpeed) - 1) > 1e-9) fail(`walking burns ${b(V.walkSpeed)} (want 1)`);
  if (Math.abs(b(0) - V.fuelIdle) > 1e-9) fail(`standing burns ${b(0)}`);
  if (Math.abs(b(V.sprintSpeed) - V.fuelSprint) > 1e-9) fail(`sprinting burns ${b(V.sprintSpeed)}`);
  // The sprint (Space held) burns per metre: more fuel per metre than walking, less time (Keith 2026-10-26: fuel use
  // goes up, but that can feel good).
  const per = (s: number) => b(s, { bounding: true }) / s;
  if (Math.abs(per(14) - V.fuelBound) > 1e-9) fail(`sprinting at 14 m/s burns ${per(14).toFixed(3)} s a metre (want ${V.fuelBound})`);
  if (!(per(14) > 1 / V.walkSpeed)) fail("the sprint is cheaper per metre than walking");
  // Fuel per metre: sprinting must cost more than walking (else nobody walks).
  if (!(b(V.sprintSpeed) / V.sprintSpeed > 1 / V.walkSpeed)) fail("sprinting is cheaper per metre than walking");
  // Warnings: comfortable well above, amber near, red under.
  if (fuelWarning(V, 600, 120) !== 0 || fuelWarning(V, 200, 120) !== 1 || fuelWarning(V, 130, 120) !== 2 || fuelWarning(V, 999, Infinity) !== 2) fail("fuel warning levels wrong");
  // Out of fuel out in the field: recovery, loot lost.
  const e = new Expedition(V), g = new Fuel(V);
  e.launch();
  e.add({ kind: "scrap", amount: 9, label: "x" });
  let t = 0;
  while (e.state === "out" && t < 3600) { g.burn(1 / 30, { speed: V.sprintSpeed, walkSpeed: V.walkSpeed, sprintSpeed: V.sprintSpeed }); e.update(1 / 30, false, g.empty); t += 1 / 30; }
  if (e.state !== "recovering" || e.last?.reason !== "fuel" || e.atRisk.length) fail(`out of fuel: ${e.state}, ${e.last?.reason}`);
  console.log(`fuel: never below 0 (lowest ${minLeft.toFixed(2)} s over 20000 random burns); sprinting dry ran out at ${(t / 60).toFixed(1)} min and forced a recovery`);
}

// ---- 4. the return point is reachable in the estimated time on flat ground ----
function convoyWorld() {
  const field = new DuneField(FLAT);
  const route = new ConvoyRoute(FLAT, 0, 0);
  field.modifier = route;
  const convoy = new Convoy(route, FLAT, field);
  convoy.reset(0, 0);
  return { field, route, convoy };
}
function cranePos(w: ReturnType<typeof convoyWorld>, i: number) {
  const p = w.convoy.bays[i];
  return p.toWorld(0, 0, V.craneMount * p.craneEnd);
}
const STEP = 1 / 20;
{
  const cases: [string, number, number][] = [
    ["beside 300 m", 300, 0], ["ahead 600 m", 80, 600], ["ahead-left 800 m", 500, 600], ["right 600 m", -600, 50],
    ["behind 200 m", 120, -380], ["behind 500 m", -150, -700], ["far 1200 m", 900, 800],
  ];
  const lines: string[] = [];
  for (const [name, side, fwd] of cases) {
    const w = convoyWorld();
    // Let it roll a minute first so the train has settled and the plan has started to wander.
    for (let t = 0; t < 60; t += STEP) w.convoy.update(STEP);
    const lead = w.convoy.bays[0];
    let x = lead.x + lead.left.x * side + lead.fwd.x * fwd, z = lead.z + lead.left.z * side + lead.fwd.z * fwd;
    const tracks = craneTracks(w.convoy.bays, V.craneMount);
    const rp = returnPoint(V, w.route, tracks, x, z, V.walkSpeed, V.convoySpeed, V.craneRange);
    if (!rp.reachable) { fail(`${name}: no meeting found`); continue; }
    const pace = V.walkSpeed * V.homePace;
    let t = 0;
    while (t < rp.walk - 1e-9) {
      const dt = Math.min(STEP, rp.walk - t);
      w.convoy.update(dt);
      const dx = rp.x - x, dz = rp.z - z, d = Math.hypot(dx, dz);
      const s = Math.min(d, pace * dt);
      if (d > 1e-6) { x += (dx / d) * s; z += (dz / d) * s; }
      t += dt;
    }
    const c = cranePos(w, rp.crane), miss = Math.hypot(c.x - x, c.z - z);
    if (miss > V.craneRange) fail(`${name}: arrived ${miss.toFixed(1)} m from the crane after ${rp.walk.toFixed(0)} s (range ${V.craneRange})`);
    const pointErr = Math.hypot(c.x - rp.x, c.z - rp.z);
    if (pointErr > 6) fail(`${name}: the crane ended ${pointErr.toFixed(1)} m from the predicted point`);
    lines.push(`${name}: home ${(rp.eta / 60).toFixed(1)} min via ${rp.crane ? "rear" : "front"} crane, arrived ${miss.toFixed(1)} m off it (prediction off ${pointErr.toFixed(1)} m)`);
  }
  console.log("return point:\n  " + lines.join("\n  "));
  // The forecast past the laid road is what gets laid.
  const real = new ConvoyRoute(FLAT, 0, 0), fc = real.ahead(real.s + 1500);
  for (let t = 0; t < 1500 / V.convoySpeed; t += 0.25) real.update(0.25);
  const at = real.pointAt(1500);
  const err = Math.hypot(at.x - fc.x, at.z - fc.z);
  if (err > 0.01) fail(`the route forecast 1.5 km ahead was off by ${err.toFixed(3)} m once laid`);
  console.log(`route forecast: 1.5 km ahead lands within ${err.toFixed(4)} m of the road laid there`);
}

// ---- 5. radar ----
{
  const world = (mx: number, mz: number): RadarWorld => ({
    mech: { x: mx, z: mz },
    convoy: [{ x: 0, z: 0, length: 40, width: 16, heading: 0 }],
    route: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
    home: { x: 0, z: 100 },
    pois: [{ id: "a", x: 300, z: 0, tier: 1 }, { id: "b", x: -600, z: 0, tier: 2 }, { id: "c", x: mx + 60, z: mz, tier: 1 }],
    blobs: [{ id: "s", x: 0, z: 800, guess: 20, awake: false }, { id: "h", x: -600, z: 40, guess: 20, awake: false }],
    unknown: [{ id: "f", x: -600, z: 0, r: 200 }],
    contacts: [{ id: 1, x: mx + 50, z: mz, kind: 0 }, { id: 2, x: mx + 400, z: mz, kind: 0 }],
  });
  if (!linked(V, world(0, V.convoyLink - 5), false) || linked(V, world(0, V.convoyLink + 5), false) || !linked(V, world(0, 5000), true)) fail("link edge wrong");
  const c = radarPicture(V, world(100, 0), "convoy");
  const ids = c.blips.map((b) => b.id);
  if (!ids.includes("a") || ids.includes("b")) fail(`convoy radar POIs ${ids} (want a, not b in the unknown area)`);
  if (c.blobs.length !== 1 || c.blobs[0].id !== "s") fail(`convoy radar blobs ${c.blobs.map((b) => b.id)} (the one in fog must hide)`);
  if (c.blips.some((b) => b.kind === "robot")) fail("convoy radar shows single robots");
  if (c.fog.length !== 1) fail("unknown area not on the convoy radar");
  const m = radarPicture(V, world(-500, 0), "mech");
  const mids = m.blips.map((b) => b.id);
  if (!mids.includes("b") || !mids.includes("r1") || mids.includes("r2") || mids.includes("a")) fail(`mech radar ${mids} (want b and r1 only near: inside fog it still sees)`);
  if (m.blobs.length || m.fog.length) fail("mech radar shows convoy knowledge");
  const z = new RadarZoom(V);
  const evs: string[] = [];
  const at = (s: number, link: boolean) => { for (let t = 0; t < s; t += 1 / 60) { const e = z.update(1 / 60, link); if (e) evs.push(e); } };
  at(2, true); at(3, false);
  if (Math.abs(z.range - V.mechRadar) > 1e-6) fail(`zoomed in to ${z.range}`);
  at(0.5, true);
  const mid = z.range;
  at(1, true);
  if (Math.abs(z.range - V.convoyRadar) > 1e-6) fail(`zoomed out to ${z.range}`);
  if (evs.join(",") !== "in,out") fail(`zoom events ${evs}`);
  if (!(mid > V.mechRadar && mid < V.convoyRadar)) fail("no zoom in between");
  console.log(`radar: link edge ${V.convoyLink} m, convoy ${V.convoyRadar} m / mech ${V.mechRadar} m, fog hides from the convoy radar only, zoom events ${evs.join(", ")}`);
}

// ---- 6. the whole loop with the real walker and crane (flat ground): launched by the crane, out, back to the return
// point, picked up: banked once, on the grip, and home inside the estimate ----
{
  const DT = 1 / 120;
  const w = convoyWorld();
  const cranes = w.convoy.bays.map((b) => new Crane(FLAT, b));
  const carry = new CraneCarry(FLAT, cranes, w.field);
  const sim = new WalkerSim(FLAT, w.field);
  const e = new Expedition(V);
  const tick = (cmd: MoveCommand) => {
    w.convoy.update(DT);
    const c = carry.update(DT, sim, cmd);
    carry.ride(sim);
    if (c) {
      sim.update(DT, c);
      carry.keep(sim);
      if (!carry.ground.onDeck) for (const p of w.convoy.platforms) { const o = p.pushOut(sim.pos.x, sim.pos.z, 2); if (o) { sim.pos.x = o.x; sim.pos.z = o.z; } }
    }
    return e.follow(carry.state, carry.attached, true);
  };
  const lead = w.convoy.bays[0];
  sim.reset(lead.x, lead.z, lead.heading);
  carry.putAboard(sim, cranes[0]);
  const still = { x: 0, z: 0, sprint: false };
  const events: string[] = [];
  let t = 0;
  carry.deploy(sim, 1);
  while (carry.state !== "walking" && t < 60) { const ev = tick(still); if (ev) events.push(ev); t += DT; }
  if (events.join() !== "launched") fail(`launch: events ${events}`);
  // Out: 200 m to the left of the convoy and a bit ahead, picking things up.
  const goal = lead.toWorld(220, 0, 120);
  while (Math.hypot(goal.x - sim.pos.x, goal.z - sim.pos.z) > 5 && t < 400) {
    const dx = goal.x - sim.pos.x, dz = goal.z - sim.pos.z, d = Math.hypot(dx, dz);
    const ev = tick({ x: dx / d, z: dz / d, sprint: false }); if (ev) events.push(ev); t += DT;
  }
  e.add({ kind: "scrap", amount: 17, label: "Wreck part" });
  if (e.bank.scrap) fail("banked before the pick-up");
  // Home: follow the return point (recomputed every second, as the HUD does) until the crane has the mech.
  const tracks = craneTracks(w.convoy.bays, V.craneMount);
  const first = returnPoint(V, w.route, tracks, sim.pos.x, sim.pos.z, V.walkSpeed, V.convoySpeed, V.craneRange);
  const t0 = t;
  let rp = first, k = 0;
  while (e.state === "out" && t - t0 < 900) {
    if (k++ % 120 === 0) rp = returnPoint(V, w.route, craneTracks(w.convoy.bays, V.craneMount, tracks), sim.pos.x, sim.pos.z, V.walkSpeed, V.convoySpeed, V.craneRange);
    const dx = rp.x - sim.pos.x, dz = rp.z - sim.pos.z, d = Math.hypot(dx, dz);
    // Near the meeting, keep pace and wait for the crane (as a player would).
    const cmd = d > 3 && carry.state === "walking" ? { x: dx / d, z: dz / d, sprint: false } : { x: Math.sin(lead.heading) * V.convoySpeed / V.walkSpeed, z: Math.cos(lead.heading) * V.convoySpeed / V.walkSpeed, sprint: false };
    const ev = tick(cmd); if (ev) events.push(ev); t += DT;
  }
  const took = t - t0;
  if (events.join() !== "launched,banked") fail(`loop events ${events}`);
  if (e.bank.scrap !== 17) fail(`banked ${e.bank.scrap} (want 17)`);
  if (took > first.eta) fail(`the grip came ${took.toFixed(0)} s after turning home, over the ${first.eta.toFixed(0)} s estimate`);
  console.log(`whole loop (real walker and crane): launched, out ${(t0).toFixed(0)} s, turned home with an estimate of ${clock(first.eta)}; gripped after ${clock(took)} (${carry.crane === cranes[0] ? "front" : "rear"} crane), banked ${e.bank.scrap}`);
}

// ---- 7. a typical out-and-back with the default tuning (measured) ----
function outAndBack(label: string, stops: number, pickAhead: number, sprintOut = false) {
  const w = convoyWorld();
  for (let t = 0; t < 30; t += STEP) w.convoy.update(STEP);
  const raw = rawGround(w.field);
  const pois = new PoiField({ ...V, ...FLAT }, raw);
  const camps = new CampField(V);
  void camps;
  const lead = w.convoy.bays[0], sx = lead.x, sz = lead.z;
  // Launched off the lead bay's left side, 21 m out.
  let x = lead.x + lead.left.x * 21, z = lead.z + lead.left.z * 21;
  const fuel = new Fuel(V), e = new Expedition(V);
  e.launch();
  // The stops: the nearest POIs not behind the convoy (ahead of the lead's line by pickAhead or more).
  const all = pois.poisIn(x - 2000, z - 2000, x + 2000, z + 2000).filter((p) => {
    const dx = p.x - x, dz = p.z - z;
    return dx * lead.fwd.x + dz * lead.fwd.z >= pickAhead && Math.hypot(dx, dz) > 150 && Math.abs(dx * lead.left.x + dz * lead.left.z) > 70;
  });
  const route: { x: number; z: number; strip: number }[] = [];
  let cx = x, cz = z;
  for (let k = 0; k < stops && all.length; k++) {
    all.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
    const p = all.shift()!;
    const site = buildSite(p, { ...V });
    const spots = site.sections.flatMap((s) => s.spots);
    route.push({ x: p.x, z: p.z, strip: spots.reduce((a, s) => a + s.time, 0) });
    cx = p.x; cz = p.z;
  }
  let t = 0, maxD = 0;
  const walk = (tx: number, tz: number, speed: number) => {
    for (;;) {
      const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
      if (d < 4) return;
      const s = Math.min(d, speed * STEP);
      x += (dx / d) * s; z += (dz / d) * s;
      fuel.burn(STEP, { speed, walkSpeed: V.walkSpeed, sprintSpeed: V.sprintSpeed });
      w.convoy.update(STEP); t += STEP;
      maxD = Math.max(maxD, Math.hypot(x - w.convoy.bays[0].x, z - w.convoy.bays[0].z));
    }
  };
  for (const r of route) {
    walk(r.x, r.z, sprintOut ? V.sprintSpeed : V.walkSpeed);
    for (let s = 0; s < r.strip; s += STEP) { fuel.burn(STEP, { speed: 0, walkSpeed: V.walkSpeed, sprintSpeed: V.sprintSpeed, stripping: true }); w.convoy.update(STEP); t += STEP; }
  }
  const tracks = craneTracks(w.convoy.bays, V.craneMount);
  const rp = returnPoint(V, w.route, tracks, x, z, V.walkSpeed, V.convoySpeed, V.craneRange);
  const etaAtTurn = rp.eta, fuelAtTurn = fuel.left;
  walk(rp.x, rp.z, V.walkSpeed * V.homePace);
  // Pick-up: about 13 s from coming in range to standing on the deck (convoy-check), counted in homeMargin.
  const total = t + V.homeMargin;
  const out = route.map((r) => `${Math.round(Math.hypot(r.x - sx, r.z - sz))} m`).join(", ");
  console.log(`  ${label}: ${route.length} stop(s) (${out} from the launch, ${route.map((r) => r.strip.toFixed(0) + " s").join(" + ")} stripping), furthest ${maxD.toFixed(0)} m out; ` +
    `at the turn home ${(etaAtTurn / 60).toFixed(1)} min with ${(fuelAtTurn / 60).toFixed(1)} min of fuel; total ${(total / 60).toFixed(1)} min, fuel used ${(fuel.burnt / 60).toFixed(1)} of ${V.fuelMinutes} min`);
  return { total, fuelLeft: fuel.left };
}
{
  console.log("out and back (flat ground, default tuning, walking):");
  const a = outAndBack("two stops ahead", 2, 0);
  const b = outAndBack("one stop ahead", 1, 0);
  const c = outAndBack("two stops, sprint out", 2, 0, true);
  const d = outAndBack("three stops, any side", 3, -200);
  for (const r of [a, b, c, d]) {
    if (r.total > 20 * 60) fail(`an out-and-back took ${(r.total / 60).toFixed(1)} min (over 20)`);
  }
  if (a.fuelLeft <= 0) fail("the typical out-and-back ran out of fuel");
}

// Packs and raids (Keith 2026-10-26: more excitement out there): a mech walking out from the drop and wandering, quiet
// except when it fights; the first fight within about a minute of the drop and something coming for it every minute
// or two after; nothing hunts while aboard. Engaged packs count as fought for a while and then gone.
{
  const runs: { first: number; gaps: number[]; events: number }[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const tf = new ThreatField({ ...THREAT_DEFAULTS }, seed);
    let x = 0, z = 0, t = 0, first = -1, last = 0, heading = seed;
    const gaps: number[] = [], fights = new Map<string, number>(), ev: ThreatEvent[] = [];
    let events = 0;
    for (; t < 600; t += 0.1) {
      heading += Math.sin(t * 0.05 + seed) * 0.004;
      x += Math.sin(heading) * 4 * 0.1; z += Math.cos(heading) * 4 * 0.1;
      const loud = fights.size > 0;
      for (const e of tf.update(0.1, { x, z, out: true, loud }, ev)) {
        if (e.type !== "engage") continue;
        events++;
        if (first < 0) first = t;
        gaps.push(t - last); last = t;
        fights.set(e.pack.id, t);
      }
      // A fight lasts about 30 s, then the pack is dead.
      for (const [id, t0] of fights) if (t - t0 > 30) { const p = tf.packs.find((q) => q.id === id); if (p) p.n = 0; fights.delete(id); }
      for (const p of tf.packs) if (p.state === "live" && fights.has(p.id)) tf.setLive(p, x + 20, z, p.n);
    }
    runs.push({ first, gaps: gaps.slice(1), events });
  }
  const firsts = runs.map((r) => r.first), worstGap = Math.max(...runs.flatMap((r) => r.gaps));
  const meanGap = runs.flatMap((r) => r.gaps).reduce((a, b) => a + b, 0) / Math.max(1, runs.flatMap((r) => r.gaps).length);
  console.log(`threats: first fight at ${firsts.map((f) => f.toFixed(0) + " s").join(", ")} after the drop; ${runs.map((r) => r.events).join("/")} fights in 10 min; gaps mean ${meanGap.toFixed(0)} s, worst ${worstGap.toFixed(0)} s`);
  if (firsts.some((f) => f < 0 || f > 75)) fail("no fight within 75 s of the drop");
  if (meanGap > 120) fail(`fights only every ${meanGap.toFixed(0)} s on average (want a minute or two)`);
  // Aboard: nothing hunts, no raids come.
  const tf = new ThreatField({ ...THREAT_DEFAULTS }, 3);
  let engagedAboard = 0;
  for (let t = 0; t < 300; t += 0.1) for (const e of tf.update(0.1, { x: 0, z: 0, out: false, loud: true })) if (e.type !== "blast") engagedAboard++;
  if (engagedAboard) fail(`${engagedAboard} packs or raids came for a mech aboard`);
}

// ---- Depth (Keith 2026-10-28): distance from the road, the same at any clock time, growing away from it ----
{
  const D = { ...DEPTH_DEFAULTS };
  const route = new ConvoyRoute({ ...FLAT }, 0, 0);
  const pts = [[0, 0], [300, 100], [-700, 900], [1500, 2000], [-2500, 600], [90, 3000]];
  const before = pts.map(([x, z]) => depthAt(route, x, z));
  route.jump(40);
  for (let i = 0; i < 2000; i++) route.update(1 / 60);
  // The convoy has rolled on; every point that was in the window and still has its nearest road ahead is unchanged.
  const same = pts.map(([x, z]) => depthAt(route, x, z));
  let drift = 0;
  for (let i = 0; i < pts.length; i++) drift = Math.max(drift, Math.abs(same[i] - before[i]));
  const fresh = new ConvoyRoute({ ...FLAT }, 0, 0);
  const a = depthAt(fresh, 300, 100), b = depthAt(fresh, 300, 100);
  if (a !== b) fail("depth differs between two calls");
  // Away from the road it only grows.
  const r0 = new ConvoyRoute({ ...FLAT }, 0, 0), p = { x: 0, z: 0, heading: 0 };
  r0.ahead(300, p);
  const nx = Math.cos(p.heading), nz = -Math.sin(p.heading);
  let prev = -1, mono = true;
  const ds: number[] = [];
  for (let k = 0; k <= 30; k++) { const d = depthAt(r0, p.x + nx * k * 100, p.z + nz * k * 100); ds.push(d); if (d < prev - 1e-6) mono = false; prev = d; }
  if (!mono) fail("depth fell going away from the road");
  if (Math.abs(ds[10] - 1000) > 120) fail(`1000 m off the road reads ${ds[10].toFixed(0)} m deep`);
  const rings = [100, 600, 1500, 2600].map((d) => ringOf(D, d)).join("/");
  if (rings !== "Near/Out/Deep/Far") fail(`rings ${rings}`);
  if (dangerOf(D, 100) !== 0 || dangerOf(D, 2000) < 0.99 || dangerOf(D, 1e6) !== D.depthCap) fail("danger curve ends wrong");
  console.log(`depth: stable as the convoy rolls (max drift ${drift.toFixed(1)} m in a 2000-step roll), 1000 m off reads ${ds[10].toFixed(0)}, rings ${rings}, danger 0/${dangerOf(D, 1000).toFixed(2)}/${dangerOf(D, 2000).toFixed(2)} at 100/1000/2000 m`);
  if (drift > 30) fail(`depth drifted ${drift.toFixed(1)} m with the clock`);
}

if (problems.length) { console.log(`expedition check FAILED (${problems.length})`); throw new Error("expedition check failed"); }
console.log("expedition check passed");
