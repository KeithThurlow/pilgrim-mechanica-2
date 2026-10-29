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
// - packs and raids: the first fight within 75 s of the drop, about one a minute or two after, none while aboard;
// - loot: seeded drops repeat for the same seed, rarity improves with depth and heat, levels with depth, power and DPS
//   rise with level, a walked-over drop joins the at-risk list, one left far behind vanishes, banking moves everything
//   into the bank and a loss empties the list (each with its event).
// - factions (docs/proposal-factions.md): bandit camp and war band column placement is seeded and rises with depth,
//   robots and bandits placed near each other both take damage, bandits and war bands never fight each other, the
//   engaged-group cap holds, and an out-of-view clash resolves with a winner, hurt survivors, wreckage and loot.
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
import { SalvageSim, SALVAGE_DEFAULTS } from "../src/pois/salvage";
import { CampField, CAMP_DEFAULTS } from "../src/expedition/camps";
import { scaled, convoyDepth, DepthField, depthAt, dangerOf, ringOf, DEPTH_DEFAULTS } from "../src/expedition/depth";
import { ThreatField, THREAT_DEFAULTS, type ThreatEvent } from "../src/expedition/threats";
import { POI_DEFAULTS, PoiField } from "../src/world/pois";
import { rawGround } from "../src/world/poiPads";
import { SITE_DEFAULTS, buildSite } from "../src/pois/kinds";
import { defaultLoadout } from "../src/items/loadout";
import { rollProtocol, rollItem, LOOT_DEFAULTS } from "../src/items/generate";
import { tierOf } from "../src/items/rarity";
import { DropField, DROP_DEFAULTS } from "../src/expedition/drops";
import { itemPower, itemDps } from "../src/items/power";
import { BanditField, BANDIT_DEFAULTS } from "../src/expedition/banditCamps";
import { WarColumns, COLUMN_DEFAULTS } from "../src/expedition/warColumns";
import { Skirmishes, aftermathSite, clashDrops } from "../src/expedition/fights";
import { FACTION_DEFAULTS, FACTION, TEAM, Relations, FightDirector, type AbstractGroup } from "../src/game/factions";
import { RobotGroup, BanditGroup } from "../src/game/fightGroups";
import { RobotSwarm, ROBOT_DEFAULTS, DEAD as ROBOT_DEAD } from "../src/combat/robots";
import { InfantrySwarm, INFANTRY_DEFAULTS, DEAD as BANDIT_DEAD } from "../src/combat/infantry";
import { Register } from "../src/game/register";
import { PadField, PadCaller, PAD_DEFAULTS, padFee, padWait, padQuote, type Pad, type PadEvent, type PadNow } from "../src/expedition/pads";
import { Unlocks, UNLOCK_DEFAULTS } from "../src/expedition/unlocks";

const U = { ...UNLOCK_DEFAULTS };

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
  // From the convoy: zero at its head, the same at any clock for a point that moves with it, deterministic, blended by depthLive.
  const rc = new ConvoyRoute({ ...FLAT }, 0, 0), hd = { x: 0, z: 0, heading: 0 };
  rc.jump(500);
  rc.ahead(rc.s, hd);
  if (convoyDepth(rc, hd.x, hd.z) > 1e-6) fail("convoy depth is not zero at the head");
  const cdA = convoyDepth(rc, hd.x + 900, hd.z + 700), cdB = convoyDepth(rc, hd.x + 900, hd.z + 700);
  const roadD = depthAt(rc, hd.x + 900, hd.z + 700);
  if (cdA !== cdB || cdA < roadD - 1e-6) fail(`convoy depth ${cdA.toFixed(0)} vs road ${roadD.toFixed(0)}`);
  const farAhead = [hd.x + Math.sin(rc.ahead(rc.s + 1500, hd).heading) * 0, 0];
  rc.ahead(rc.s + 1500, hd);
  const aheadRoad = depthAt(rc, hd.x, hd.z), aheadConvoy = convoyDepth(rc, hd.x, hd.z);
  const df = new DepthField(rc, { ...D, depthLive: 1 }), df0 = new DepthField(rc, { ...D, depthLive: 0 });
  if (!(aheadRoad < 5 && aheadConvoy > 1000 && df.liveDepth(hd.x, hd.z) > 1000 && df0.liveDepth(hd.x, hd.z) < 5)) fail("live depth blend wrong");
  console.log(`convoy depth: 0 at the head; a spot on the road 1500 m ahead is ${aheadRoad.toFixed(0)} m from the road and ${aheadConvoy.toFixed(0)} m from the convoy (live depth ${df.liveDepth(hd.x, hd.z).toFixed(0)} at depthLive 1, ${df0.liveDepth(hd.x, hd.z).toFixed(0)} at 0)`);
  void farAhead;
  const rings = [100, 600, 1500, 2600].map((d) => ringOf(D, d)).join("/");
  if (rings !== "Near/Out/Deep/Far") fail(`rings ${rings}`);
  if (dangerOf(D, 100) !== 0 || dangerOf(D, 2000) < 0.99 || dangerOf(D, 1e6) !== D.depthCap) fail("danger curve ends wrong");
  console.log(`depth: stable as the convoy rolls (max drift ${drift.toFixed(1)} m in a 2000-step roll), 1000 m off reads ${ds[10].toFixed(0)}, rings ${rings}, danger 0/${dangerOf(D, 1000).toFixed(2)}/${dangerOf(D, 2000).toFixed(2)} at 100/1000/2000 m`);
  if (drift > 30) fail(`depth drifted ${drift.toFixed(1)} m with the clock`);
}

// ---- Camps grow with depth: averages over many cells, a straight road along z, depth = |x| ----
{
  const D = { ...DEPTH_DEFAULTS };
  const stat = (i0: number, i1: number) => {
    const cf = new CampField({ ...CAMP_DEFAULTS, campClear: 0 });
    cf.danger = (x) => dangerOf(D, Math.abs(x));
    let cells = 0, camps = 0, robots = 0;
    for (let j = 0; j < 150; j++) for (let i = i0; i <= i1; i++) { cells++; const c = cf.camp(i, j); if (c) { camps++; robots += c.size; } }
    return { perCell: camps / cells, robotsPerCell: robots / cells, size: robots / Math.max(1, camps) };
  };
  const near = stat(0, 0), out = stat(2, 2), deep = stat(3, 3), far = stat(6, 8);
  const f = (k: ReturnType<typeof stat>) => `${k.perCell.toFixed(2)} camps/cell, ${k.size.toFixed(1)} robots each, ${k.robotsPerCell.toFixed(1)} robots/cell`;
  console.log(`camps by depth: near ${f(near)}; out ${f(out)}; deep ${f(deep)}; far ${f(far)}`);
  if (!(near.perCell < far.perCell && near.size < out.size && out.size < far.size && near.robotsPerCell < out.robotsPerCell && out.robotsPerCell < far.robotsPerCell)) fail("camp density or size does not rise from Near to Far");
  // Without a depth function camps are what they were.
  const a = new CampField({ ...CAMP_DEFAULTS }), b = new CampField({ ...CAMP_DEFAULTS });
  b.danger = () => 0;
  let same = true;
  for (let j = 0; j < 40; j++) for (let i = 0; i < 6; i++) if (JSON.stringify(a.camp(i, j)) !== JSON.stringify(b.camp(i, j))) same = false;
  if (!same) fail("camps at danger 0 differ from camps without depth");
}

// ---- Packs and raids by depth: more, bigger, sooner ----
{
  const sim = (danger: number, seed: number) => {
    const tf = new ThreatField({ ...THREAT_DEFAULTS }, seed);
    const ev: ThreatEvent[] = [];
    let raids = 0, raidRobots = 0, firstRaid = -1, packs = 0, packSize = 0, n = 0;
    for (let t = 0; t < 600; t += 0.1) {
      for (const e of tf.update(0.1, { x: 0, z: 0, out: true, loud: false, danger }, ev)) if (e.type === "raid") { raids++; raidRobots += e.pack.n; if (firstRaid < 0) firstRaid = t; }
      for (const p of tf.packs) if (p.state === "live") tf.setLive(p, 0, 0, 0);
      if (t % 10 < 0.1) { const r = tf.packs.filter((q) => q.kind === "pack"); packs += r.length; for (const q of r) { packSize += q.n; n++; } }
    }
    return { raids, raidSize: raidRobots / Math.max(1, raids), firstRaid, packs: packs / 60, packSize: packSize / Math.max(1, n) };
  };
  const avg = (d: number) => { const r = [1, 2, 3, 4].map((s) => sim(d, s)); const m = (k: keyof typeof r[0]) => r.reduce((a, b) => a + b[k], 0) / r.length; return { raids: m("raids"), raidSize: m("raidSize"), firstRaid: m("firstRaid"), packs: m("packs"), packSize: m("packSize") }; };
  const n0 = avg(0), n1 = avg(1);
  const g = (k: typeof n0) => `${k.raids.toFixed(1)} raids of ${k.raidSize.toFixed(0)}, first at ${k.firstRaid.toFixed(0)} s, ${k.packs.toFixed(1)} packs round the mech of ${k.packSize.toFixed(1)}`;
  console.log(`threats per 10 min: danger 0: ${g(n0)}; danger 1: ${g(n1)}`);
  if (!(n1.raids > n0.raids * 1.5 && n1.raidSize > n0.raidSize * 1.5 && n1.firstRaid < n0.firstRaid && n1.packs > n0.packs * 1.5 && n1.packSize > n0.packSize * 1.5)) fail("threats do not rise with depth");
  if (Math.abs(n0.firstRaid - THREAT_DEFAULTS.raidFirst) > 5) fail("near the road the first raid moved");
  // First fight: by the new time (firstFight 25 s plus the scout's walk in).
  const tf = new ThreatField({ ...THREAT_DEFAULTS }, 9), ev: ThreatEvent[] = [];
  let first = -1;
  for (let t = 0; t < 120 && first < 0; t += 0.1) for (const e of tf.update(0.1, { x: 0, z: 0, out: true, loud: false }, ev)) if (e.type === "engage") first = t;
  console.log(`first fight (standing still): ${first.toFixed(0)} s after the drop (scout due at ${THREAT_DEFAULTS.firstFight} s)`);
  if (first < 0 || first > THREAT_DEFAULTS.firstFight + 30) fail(`first fight at ${first.toFixed(0)} s`);
  // Heat answers: a pull makes the nearest pack hunt for good; a heat raid is aimed at the mech.
  const t2 = new ThreatField({ ...THREAT_DEFAULTS }, 5);
  t2.update(0.1, { x: 0, z: 0, out: true, loud: false }, ev);
  const roam = t2.packs.filter((q) => q.kind === "pack"), nearest = [...roam].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  const pulled = t2.pull({ x: 0, z: 0, out: true, loud: false });
  if (!pulled || pulled !== nearest || pulled.state !== "hunt") fail("pull did not take the nearest pack");
  const hr = t2.heatRaid({ x: 0, z: 0, out: true, loud: false, danger: 1 });
  const want = Math.round(THREAT_DEFAULTS.heatRaidSize * scaled(THREAT_DEFAULTS.raidSizeFar, 1));
  if (!hr || hr.type !== "raid" || hr.pack.n !== want || Math.hypot(hr.pack.tx, hr.pack.tz) > 1) fail(`heat raid wrong (${hr && hr.type === "raid" ? hr.pack.n : "none"} want ${want})`);
}

// ---- Salvage heat, and scrap by depth ----
{
  const S = { ...SALVAGE_DEFAULTS };
  const sim = new SalvageSim(S);
  const spots = Array.from({ length: 12 }, (_, i) => ({ id: `t#${i}`, section: 0, x: 0, z: 0, h: 1, value: 60, time: 5, label: "sealed hold" }));
  sim.add({ place: { id: "t" }, sections: [{ name: "s", value: 720, spots }], value: 720 } as never);
  const hits: string[] = []; const when: number[] = []; let noise0 = 0, noiseLast = 0;
  sim.onHeat = (w) => { hits.push(w); when.push(t); };
  sim.onNoise = (_x, _z, r) => { if (!noise0) noise0 = r; noiseLast = r; };
  let t = 0;
  for (; t < 40; t += 1 / 60) sim.update(1 / 60, 0, 0, true);
  const hotAt = sim.heat;
  if (hits[0] !== "pack" || hits[1] !== "raid" || hits.length !== 2) fail(`heat thresholds fired ${hits.join(",")} (want pack then raid, once each)`);
  if (!(noiseLast > noise0 * 1.3)) fail(`noise did not grow with heat (${noise0.toFixed(0)} to ${noiseLast.toFixed(0)})`);
  // Held, then it falls slowly; the thresholds re-arm and fire again on the next heating.
  const held = sim.heat;
  for (let k = 0; k < 60 * 2; k++, t += 1 / 60) sim.update(1 / 60, 500, 500, false);
  if (Math.abs(sim.heat - held) > 1e-9) fail("heat fell inside the hold time");
  for (let k = 0; k < 60 * 20; k++, t += 1 / 60) sim.update(1 / 60, 500, 500, false);
  const cooled = sim.heat;
  if (!(cooled < held && cooled > 0)) fail(`heat after 20 s idle ${cooled.toFixed(2)} from ${held.toFixed(2)} (want lower, slowly)`);
  for (let k = 0; k < 60 * 120; k++, t += 1 / 60) sim.update(1 / 60, 500, 500, false);
  const pilot = new SalvageSim(S);
  pilot.add({ place: { id: "t" }, sections: [{ name: "s", value: 60, spots: [{ ...spots[0], id: "p#0", time: 400 }] }], value: 60 } as never);
  for (let k = 0; k < 60 * 12; k++) pilot.update(1 / 60, 0, 0, true, 7, 0.5, 0.35, false);
  const mech = new SalvageSim(S);
  mech.add({ place: { id: "t" }, sections: [{ name: "s", value: 60, spots: [{ ...spots[0], id: "m#0", time: 400 }] }], value: 60 } as never);
  for (let k = 0; k < 60 * 12; k++) mech.update(1 / 60, 0, 0, true);
  if (!(pilot.heat < mech.heat * 0.5)) fail("stripping by hand is as hot as in the mech");
  // Rich spots are louder and slower.
  const small = { ...spots[0], value: 12 }, rich = { ...spots[0], value: 120 };
  if (!(sim.size(rich) > sim.size(small))) fail("size does not rise with value");
  console.log(`salvage heat: 40 s of stripping 60-scrap spots reaches ${hotAt.toFixed(2)} (pack at ${S.heatPack}, raid at ${S.heatRaid}), fired ${hits.join(" then ")} at ${when.map((w) => w.toFixed(0) + " s").join(" and ")}; noise ${noise0.toFixed(0)} to ${noiseLast.toFixed(0)} m; held ${S.heatHold} s then ${held.toFixed(2)} to ${cooled.toFixed(2)} after 20 s, ${sim.heat.toFixed(2)} after 2 min more; by hand ${pilot.heat.toFixed(2)} vs mech ${mech.heat.toFixed(2)} in 12 s`);
  // A second heating fires again.
  const before = hits.length;
  for (let k = 0; k < 60 * 25; k++) sim.update(1 / 60, 0, 0, true);
  if (hits.length <= before) fail("heat thresholds did not re-arm after cooling");
  // Scrap rises with depth.
  const D = { ...DEPTH_DEFAULTS };
  const pay = new SalvageSim(S);
  pay.danger = (x) => dangerOf(D, x);
  const spot = (x: number) => ({ ...spots[0], x });
  const pays = [0, 400, 1000, 2000, 3000].map((x) => pay.pay(spot(x)));
  console.log(`scrap for a 60-scrap spot at 0/400/1000/2000/3000 m: ${pays.join("/")}`);
  for (let i = 1; i < pays.length; i++) if (pays[i] < pays[i - 1]) fail("scrap fell with depth");
  if (!(pays[3] >= 60 * S.scrapFar * 0.95) || pays[0] !== 60) fail(`scrap at the road ${pays[0]} / full depth ${pays[3]}`);
}

// ---- Loot: seeded drops, rarity and level by depth and heat, pick-ups, banking, losing it, power and DPS ----
{
  const LV = { ...DROP_DEFAULTS, ...LOOT_DEFAULTS };
  const here = { danger: 0, heat: 0, depth: 0 };
  // The same seed and keys drop the same items.
  const a = new DropField(LV, 77), b = new DropField(LV, 77);
  let same = 0, dropped = 0;
  for (let k = 0; k < 400; k++) {
    const da = a.roll(`spot:${k}`, 0.5, k, 0, here), db = b.roll(`spot:${k}`, 0.5, k, 0, here);
    if (!!da !== !!db || (da && db && (da.item.id !== db.item.id || da.x !== db.x || JSON.stringify(da.item.stats) !== JSON.stringify(db.item.stats)))) continue;
    same++; if (da) dropped++;
  }
  if (same !== 400) fail(`drops: ${400 - same} of 400 rolls differ for the same seed`);
  if (a.roll("spot:3", 1, 0, 0, here)) fail("drops: a spot rolled twice");
  // Rarity improves with depth and with heat; levels rise with depth.
  const mean = (ctx: { danger: number; heat: number; depth: number }) => {
    const f = new DropField(LV, 5);
    let tiers = 0, levels = 0, n = 0;
    for (let k = 0; k < 3000; k++) { const d = f.roll(`k${k}`, 1, 0, 0, ctx, undefined); if (d && d.item.kind !== "protocol") { tiers += tierOf(d.item.rarity); levels += d.item.level ?? 1; n++; } }
    return { tier: tiers / n, level: levels / n };
  };
  const shallow = mean({ danger: 0, heat: 0, depth: 0 }), deep = mean({ danger: 1, heat: 0, depth: 1500 }), hot = mean({ danger: 0, heat: 1, depth: 0 });
  console.log(`loot: ${dropped}/400 spots dropped at 50%; mean rarity tier shallow ${shallow.tier.toFixed(2)}, deep ${deep.tier.toFixed(2)}, hot ${hot.tier.toFixed(2)}; mean level shallow ${shallow.level.toFixed(1)}, 1.5 km ${deep.level.toFixed(1)}`);
  if (!(deep.tier > shallow.tier + 0.2)) fail("loot: rarity doesn't improve with depth");
  if (!(hot.tier > shallow.tier + 0.15)) fail("loot: rarity doesn't improve with heat");
  if (!(deep.level > shallow.level + 5)) fail("loot: deeper drops don't roll higher levels");
  // Power and DPS rise with level (same seed, same rarity).
  let powerUp = 0, dpsUp = 0, weapons = 0;
  for (let s = 1; s <= 60; s++) {
    const lo = rollItem(s * 31, LV, { rarity: "rare", level: 1 }), hi = rollItem(s * 31, LV, { rarity: "rare", level: 20 });
    if (itemPower(hi) > itemPower(lo)) powerUp++;
    const dl = itemDps(lo), dh = itemDps(hi);
    if (dl !== null && dh !== null) { weapons++; if (dh > dl) dpsUp++; }
  }
  console.log(`loot: level 20 over level 1: power up on ${powerUp}/60 items, DPS up on ${dpsUp}/${weapons} weapons`);
  if (powerUp < 60) fail(`loot: power didn't rise with level on ${60 - powerUp} items`);
  if (!weapons || dpsUp < weapons) fail(`loot: DPS didn't rise with level on ${weapons - dpsUp} weapons`);
  // A walked-over item joins the at-risk list; banking moves everything; a loss empties the list.
  const e = new Expedition({ ...EXPEDITION_DEFAULTS });
  const f = new DropField(LV, 9);
  e.launch();
  e.add({ kind: "scrap", amount: 40, label: "Wreck" });
  const d = f.roll("spot:x", 1, 10, 0, here)!;
  if (f.update([{ x: 0, z: 0, by: "mech" }], true).length) fail("loot: a drop 10 m off was picked up");
  const got = f.update([{ x: 9, z: 0, by: "mech" }], true);
  for (const g of got) e.add({ kind: "item", item: g.item, label: "x" });
  if (got.length !== 1 || got[0] !== d || e.itemsAtRisk !== 1 || f.drops.length) fail("loot: walking over a drop didn't put it on the at-risk list");
  if (!f.events.some((ev) => ev.type === "picked")) fail("loot: no picked event");
  const far = f.roll("spot:far", 1, 0, 0, here)!;
  f.update([{ x: LV.dropForget + 50, z: 0, by: "pilot" }], true);
  if (f.drops.includes(far)) fail("loot: a drop left far behind didn't vanish");
  e.events.length = 0;
  e.pickedUp();
  const bev = e.events.find((ev) => ev.type === "banked");
  if (e.atRisk.length || e.bank.scrap !== 40 || e.bank.items.length !== 1 || !bev || bev.type !== "banked" || bev.lines.length !== 2) fail("loot: banking didn't move everything to the bank (with a banked event of the lines)");
  e.launch();
  e.add({ kind: "scrap", amount: 25, label: "Wreck" });
  e.add({ kind: "item", item: rollItem(4, LV), label: "y" });
  e.events.length = 0;
  e.recover("recalled");
  const lev = e.events.find((ev) => ev.type === "lost");
  if (e.atRisk.length || e.bank.scrap !== 40 || e.bank.items.length !== 1 || !lev || lev.type !== "lost" || lev.lines.length !== 2) fail("loot: a loss didn't empty the list (with a lost event of the lines), or touched the bank");
}

// ---- Factions (docs/proposal-factions.md): raiders (bandit camps + war band columns) and robots ----
{
  const FV = { ...FACTION_DEFAULTS };
  const D = { ...DEPTH_DEFAULTS };
  const gfield = new DuneField({ ...V });
  const pois = new PoiField({ ...V, ...FLAT }, rawGround(gfield));
  const far0 = { x: 1e7, z: 0 };

  // Seeded placement is deterministic, and bandit camps get more numerous and bigger with depth (road along z, depth = |x|).
  const mk = () => {
    const f = new BanditField({ ...BANDIT_DEFAULTS }, (x0, z0, x1, z1) => pois.poisIn(x0, z0, x1, z1));
    f.start = far0; f.danger = (x) => dangerOf(D, Math.abs(x));
    return f;
  };
  const camps = (f: BanditField, x0: number, x1: number) => {
    const out = [];
    for (let z = -6000; z < 6000; z += 500) for (const p of pois.poisIn(x0, z, x1, z + 500)) { const c = f.campAt(p); if (c) out.push(c); }
    return out;
  };
  const fa = mk(), fb = mk();
  const ja = JSON.stringify(camps(fa, 0, 400)), jb = JSON.stringify(camps(fb, 0, 400));
  if (ja !== jb || ja.length < 3) fail("factions: bandit camp placement differs between two builds (or is empty)");
  const sumSize = (cs: { size: number }[]) => cs.reduce((a, c) => a + c.size, 0);
  const nearC = camps(fa, 0, 400), farC = camps(fa, 2200, 2600);
  const nearPer = nearC.length, farPer = farC.length;
  const nearSize = sumSize(nearC) / Math.max(1, nearPer), farSize = sumSize(farC) / Math.max(1, farPer);
  console.log(`bandit camps by depth (12 km of road, 400 m wide): near ${nearPer} camps of ${nearSize.toFixed(1)}; far ${farPer} camps of ${farSize.toFixed(1)}`);
  if (!(farPer > nearPer && farSize > nearSize)) fail(`factions: bandit camps do not get more numerous and bigger with depth (near ${nearPer}/${nearSize.toFixed(1)}, far ${farPer}/${farSize.toFixed(1)})`);

  // War band columns: deterministic per cell, more and bigger with depth.
  const CV = { ...COLUMN_DEFAULTS };
  const colStat = (i0: number, i1: number) => {
    let n = 0, size = 0, heavy = 0;
    for (let j = -60; j < 60; j++) for (let i = i0; i <= i1; i++) {
      const c = WarColumns.initial(CV, i, j, far0, (x) => dangerOf(D, Math.abs(x)));
      const c2 = WarColumns.initial(CV, i, j, far0, (x) => dangerOf(D, Math.abs(x)));
      if (JSON.stringify(c) !== JSON.stringify(c2)) fail("factions: a column cell differs between two calls");
      if (c) { n++; size += c.kinds.length; heavy += c.kinds.filter((k) => k === "warRig" || k === "tank" || k === "sixWheeler").length; }
    }
    return { n, size: size / Math.max(1, n), heavy };
  };
  const cell = CV.colCell;
  const cn = colStat(0, Math.floor(400 / cell)), cf = colStat(Math.floor(2200 / cell), Math.floor(2600 / cell) + 1);
  console.log(`war band columns by depth: near ${cn.n} of ${cn.size.toFixed(1)} vehicles (${cn.heavy} heavy); far ${cf.n} of ${cf.size.toFixed(1)} (${cf.heavy} heavy)`);
  if (!(cf.n * (Math.floor(400 / cell) + 1) > cn.n * (Math.floor(2600 / cell) - Math.floor(2200 / cell) + 2) * 0.99 && cf.size > cn.size)) fail("factions: war band columns do not get more numerous and bigger with depth");

  // Relations: raiders (bandits and the war band) never fight each other; robots fight everyone.
  const rel = new Relations(FV);
  if (rel.hostile(FACTION.raiders, FACTION.raiders) || rel.hostileTeams(TEAM.raiders, TEAM.raiders)) fail("factions: raiders are hostile to raiders");
  if (!rel.hostile(FACTION.robots, FACTION.raiders) || !rel.hostile(FACTION.robots, FACTION.player) || !rel.hostile(FACTION.raiders, FACTION.player)) fail("factions: robots / raiders / player are not hostile by default");

  // Live fights: a robot pack and a bandit camp 60 m apart, the player far away. Both must take damage from each other.
  const gr = new DuneField({ ...TERRAIN_DEFAULTS });
  const robots = new RobotSwarm({ ...ROBOT_DEFAULTS }, gr, 11), bandits = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, gr, 12);
  const rs = robots.spawn(14, 0, 0, 6), bs = bandits.spawn(14, 60, 0, 6);
  const reg = new Register();
  reg.add({ name: "robots", publish: (r) => robots.publish(r, TEAM.robots) });
  reg.add({ name: "bandits", publish: (r) => bandits.publish(r, TEAM.raiders) });
  const gR = new RobotGroup("robots:a", robots, () => rs);
  const gB = new BanditGroup("bandits:a", bandits, () => bs, () => ({ x: 60, z: 0 }), () => 400);
  const dir = new FightDirector({ ...FV }, rel);
  const player = { x: 5000, y: 3, z: 0, radius: 3 };
  const nearest = (sw: { px: Float32Array; pz: Float32Array; state: Uint8Array; hi: number }, dead: number, x: number, z: number, r: number) => {
    let b = -1, bd = r;
    for (let i = 0; i < sw.hi; i++) { if (sw.state[i] >= dead) continue; const d = Math.hypot(sw.px[i] - x, sw.pz[i] - z); if (d < bd) { bd = d; b = i; } }
    return b;
  };
  const hpR0 = rs.reduce((a, i) => a + robots.hp[i], 0), hpB0 = bs.reduce((a, i) => a + bandits.hp[i], 0);
  let hitsOnBandits = 0, hitsOnRobots = 0, hitsOnPlayer = 0;
  const DT = 1 / 120;
  for (let t = 0; t < 40 * 120; t++) {
    robots.update(DT, { x: player.x, y: player.y, z: player.z, radius: player.radius }, (_fx, _fy, _fz, tx, _ty, tz, _k, i) => {
      const j = nearest(bandits, BANDIT_DEAD, tx, tz, 8);
      if (j >= 0) { hitsOnBandits++; bandits.damage(j, 3, Math.sin(robots.heading[i]), Math.cos(robots.heading[i])); } else hitsOnPlayer++;
    }, (i, d) => { const j = nearest(bandits, BANDIT_DEAD, robots.px[i], robots.pz[i], 3); if (j >= 0) { hitsOnBandits++; bandits.damage(j, d, 1, 0); } });
    bandits.update(DT, { x: player.x, y: player.y, z: player.z, radius: player.radius }, (_fx, _fy, _fz, tx, _ty, tz) => {
      const j = nearest(robots, ROBOT_DEAD, tx, tz, 8);
      if (j >= 0) { hitsOnRobots++; robots.damage(j, 3, 1, 0); } else hitsOnPlayer++;
    });
    if (t % 12 === 0) { reg.rebuild(); dir.update(0.1, [gR, gB], reg); }
  }
  const hpR1 = rs.reduce((a, i) => a + Math.max(0, robots.hp[i]), 0), hpB1 = bs.reduce((a, i) => a + Math.max(0, bandits.hp[i]), 0);
  console.log(`robots vs bandits: 14 vs 14, 40 s: robots took ${hitsOnRobots} hits (hp ${hpR0.toFixed(0)} -> ${hpR1.toFixed(0)}), bandits took ${hitsOnBandits} (hp ${hpB0.toFixed(0)} -> ${hpB1.toFixed(0)}), ${hitsOnPlayer} at the player`);
  if (!(hitsOnBandits > 0 && hitsOnRobots > 0 && hpR1 < hpR0 && hpB1 < hpB0)) fail("factions: robots and bandits placed near each other did not both take damage");

  // Two bandit camps side by side never fight (and the director doesn't pair them).
  {
    const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, gr, 3);
    const a = sw.spawn(6, 0, 0, 4), b = sw.spawn(6, 20, 0, 4);
    const r2 = new Register();
    r2.add({ name: "bandits", publish: (r) => sw.publish(r, TEAM.raiders) });
    const d2 = new FightDirector({ ...FV }, rel);
    const gs = [new BanditGroup("b1", sw, () => a, () => ({ x: 0, z: 0 }), () => 400), new BanditGroup("b2", sw, () => b, () => ({ x: 20, z: 0 }), () => 400)];
    r2.rebuild();
    d2.update(1, gs, r2);
    if (d2.count) fail(`factions: ${d2.count} bandit camps went for each other`);
    // A raider column vs a bandit camp out of view: no clash starts.
    const mkG = (id: string, x: number): AbstractGroup => ({ id, faction: FACTION.raiders, x, z: 0, count: 8, power: 20, vehicles: id.startsWith("col"), apply: () => {}, hold: () => {} });
    const sk = new Skirmishes({ ...FV }, rel, [(_x, _z, _r, out) => { out.push(mkG("bandit:x", 0), mkG("col:y", 30)); }]);
    for (let t = 0; t < 60; t += 0.5) sk.update(0.5, 0, 0);
    if (sk.started || sk.events.length) fail("factions: a bandit camp and a war band column clashed");
    console.log("bandits and the war band: no pairing in view, no clash out of view");
  }

  // The cap on groups fighting at once: 5 robot groups each 40 m from a bandit group, 200 m apart.
  {
    const sr = new RobotSwarm({ ...ROBOT_DEFAULTS }, gr, 21), sb = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, gr, 22);
    const rg: RobotGroup[] = [], bg: BanditGroup[] = [];
    for (let k = 0; k < 5; k++) {
      const a = sr.spawn(4, k * 300, 0, 3), b = sb.spawn(4, k * 300 + 40, 0, 3);
      rg.push(new RobotGroup("r" + k, sr, () => a));
      bg.push(new BanditGroup("b" + k, sb, () => b, () => ({ x: k * 300 + 40, z: 0 }), () => 400));
    }
    const r3 = new Register();
    r3.add({ name: "r", publish: (r) => sr.publish(r, TEAM.robots) });
    r3.add({ name: "b", publish: (r) => sb.publish(r, TEAM.raiders) });
    r3.rebuild();
    const counts: string[] = [];
    for (const cap of [0, 1, 3, 6, 10]) {
      const d3 = new FightDirector({ ...FV, maxEngaged: cap }, rel);
      d3.update(1, [...rg, ...bg], r3);
      counts.push(`${cap}:${d3.count}`);
      if (d3.count > cap) fail(`factions: ${d3.count} groups engaged with the cap at ${cap}`);
      if (cap >= 10 && d3.count !== 10) fail(`factions: with room under the cap only ${d3.count} of 10 groups engaged`);
      if (cap === 3 && d3.count !== 3) fail(`factions: the default cap of 3 engaged ${d3.count}`);
    }
    console.log(`engaged-group cap (10 groups in 5 pairs): cap:engaged ${counts.join(" ")}`);
  }

  // An out-of-view clash resolves with a winner, survivors that stay hurt, wreckage to strip and loot.
  {
    const st = { r: { count: 30, hurt: 0 }, b: { count: 10, hurt: 0 }, held: 0 };
    const gRob: AbstractGroup = { id: "pack:1", faction: FACTION.robots, x: 0, z: 0, count: 30, power: 30, vehicles: false, apply: (c, h) => { st.r = { count: c, hurt: h }; gRob.count = c; }, hold: (on) => { st.held += on ? 1 : -1; } };
    const gBan: AbstractGroup = { id: "bandit:1", faction: FACTION.raiders, x: 40, z: 0, count: 10, power: 12, vehicles: false, apply: (c, h) => { st.b = { count: c, hurt: h }; gBan.count = c; }, hold: (on) => { st.held += on ? 1 : -1; } };
    const sk = new Skirmishes({ ...FV }, rel, [(_x, _z, _r, out) => { out.push(gRob, gBan); }]);
    let t = 0;
    for (; t < 600 && !sk.events.length; t += 0.5) sk.update(0.5, 3000, 0);
    const ev = sk.events[0];
    if (!ev) { fail("factions: an out-of-view clash never resolved"); }
    else {
      const winnerRobots = ev.winner.faction === FACTION.robots;
      const drops = clashDrops(ev, FV);
      const site = aftermathSite(ev, FV, 0);
      const spots = site.sections.reduce((a, sec) => a + sec.spots.length, 0);
      const f = new DropField({ ...DROP_DEFAULTS, ...LOOT_DEFAULTS }, 99);
      let rolled = 0;
      for (let k = 0; k < drops; k++) if (f.roll(`clash:${ev.id}:0:${k}`, 1, ev.x + k * 2, ev.z, { danger: 0.5, heat: 0, depth: 1500 })) rolled++;
      console.log(`out-of-view clash: 30 robots (power 30) vs 10 bandits (12) resolved in ${ev.seconds.toFixed(0)} s: ${winnerRobots ? "robots" : "bandits"} win with ${ev.kept} left, ${(ev.hurt * 100).toFixed(0)}% hurt; ${ev.lostRobots} robots and ${ev.lostRaiders} bandits lost; wreckage with ${spots} scrap spots, ${rolled} item drops`);
      if (!winnerRobots) fail("factions: the stronger side (30 robots vs 10 bandits) lost the clash");
      if (st.r.count < 1 || st.r.count >= 30 || st.r.hurt <= 0) fail(`factions: the winner did not keep damaged survivors (${st.r.count} left, ${st.r.hurt.toFixed(2)} hurt)`);
      if (st.b.count !== 0) fail("factions: the loser survived");
      if (st.held !== 0) fail(`factions: groups still held after the clash (${st.held})`);
      if (!spots || !drops || rolled < 1) fail(`factions: the clash left no loot (${spots} spots, ${drops} drops, ${rolled} rolled)`);
    }
  }
}

// ---- extraction pads and convoy unlocks (docs/proposal-extraction.md) ----
{
  const PV = { ...PAD_DEFAULTS, ...DEPTH_DEFAULTS };
  const mk = () => {
    const route = new ConvoyRoute({ ...FLAT }, 0, 0), f = new PadField({ ...PV });
    f.depth = (x, z) => depthAt(route, x, z);
    return { route, f };
  };
  // Placed the same every build, and none in the Near ring.
  const A = mk(), B = mk();
  const pa = A.f.near(0, 0, 6000), pb = B.f.near(0, 0, 6000);
  const sig = (l: Pad[]) => l.map((p) => `${p.id}@${p.x.toFixed(1)},${p.z.toFixed(1)}`).sort().join("|");
  if (!pa.length) fail("pads: none placed within 6 km");
  if (sig(pa) !== sig(pb)) fail("pads: a second build placed them differently");
  if (pa.some((p) => ringOf(PV, depthAt(A.route, p.x, p.z)) === "Near")) fail("pads: one stands in the Near ring");
  if (PV.padChanceNear !== 0) fail("pads: the Near chance default is not 0");
  const byRing: Record<string, number> = {};
  for (const p of pa) byRing[p.ring] = (byRing[p.ring] ?? 0) + 1;
  console.log(`pads: ${pa.length} within 6 km (${Object.entries(byRing).map(([k, n]) => `${k} ${n}`).join(", ")}), same every build, none Near`);

  // The fee and the wait rise with distance (and the wait is capped).
  let rising = true, pf = -1, pw = -1;
  for (let km = 0; km <= 8; km += 0.5) {
    const f = padFee(PV, km), w = padWait(PV, km);
    if (f <= pf || w < pw) rising = false;
    pf = f; pw = w;
  }
  if (!rising) fail("pads: fee or wait did not rise with distance");
  if (padWait(PV, 100) !== PV.padWaitMax) fail("pads: the wait is not capped");
  console.log(`pads: fee ${padFee(PV, 0.5)} / ${padFee(PV, 2)} / ${padFee(PV, 4)} scrap, wait ${padWait(PV, 0.5)} / ${padWait(PV, 2)} / ${padWait(PV, 4)} s at 0.5 / 2 / 4 km`);

  // A fresh expedition out in the field, a pad under it, the mech 2 km from the convoy.
  const pad: Pad = { id: "pad:t", x: 1000, z: 1000, ring: "Deep", depth: 1500 };
  const setup = (over: Partial<typeof PV> = {}, carried = 300, bank = 0) => {
    const e = new Expedition(V);
    e.bank.scrap = bank;
    e.launch();
    if (carried) e.add({ kind: "scrap", amount: carried, label: "Hoard" });
    const c = new PadCaller({ ...PV, ...over }, e);
    const now = (o: Partial<PadNow> = {}): PadNow => ({ x: pad.x, z: pad.z, alive: true, eHeld: true, unlocked: true, convoyM: 2000, ...o });
    const step = (s: number, on: Pad | null = pad, o: Partial<PadNow> = {}) => {
      for (let t = 0; t < s; t += 1 / 30) { c.update(1 / 30, on, now(o)); e.update(1 / 30, false, false); }
    };
    return { e, c, now, step };
  };

  // Unusable until the pickup is unlocked; the unlock rules.
  {
    const u = new Unlocks(), { e, c, step } = setup();
    step(3, pad, { unlocked: u.has("pickup") });
    if (c.state !== "idle" || e.scrapAtRisk !== 300) fail("pads: a call went through before the unlock");
    if (c.refusal !== "locked") fail(`pads: refusal before the unlock was '${c.refusal}'`);
    const bank = { scrap: 100 };
    if (u.buy(U, "pickup", bank)) fail("unlock: bought with too little in the bank");
    bank.scrap = 1000;
    if (!u.buy(U, "pickup", bank) || bank.scrap !== 1000 - U.unlPickup || !u.has("pickup")) fail("unlock: buying the pickup did not charge the price");
    if (u.buy(U, "pickup", bank)) fail("unlock: a one-level unlock bought twice");
    const r = new Unlocks();
    r.buy(U, "radar", { scrap: 9999 });
    if (Math.abs(r.mul(U, "radar") - U.unlRadarMul1) > 1e-9 || r.nextPrice(U, "radar") !== U.unlRadar2) fail("unlock: radar level 1 effect or next price wrong");
    const all = new Unlocks(); all.unlockAll();
    if (all.nextPrice(U, "radar") !== null || all.nextPrice(U, "crane") !== null || Math.abs(all.mul(U, "crane") - U.unlCraneMul2) > 1e-9) fail("unlock: unlockAll is not the top level");
    const back = new Unlocks(); back.load(JSON.parse(JSON.stringify(all.levels)));
    if (back.level("radar") !== 3 || back.level("crane") !== 2 || !back.has("pickup")) fail("unlock: levels lost through save and load");
    back.load({ radar: 99, bogus: 3, crane: -1 });
    if (back.level("radar") !== 3 || back.level("crane") !== 0 || "bogus" in back.levels) fail("unlock: bad saved levels not cleaned");
    console.log(`unlocks: locked pad refuses; pickup ${U.unlPickup}, radar ${U.unlRadar1}/${U.unlRadar2}/${U.unlRadar3} (x${U.unlRadarMul1}/${U.unlRadarMul2}/${U.unlRadarMul3}), crane ${U.unlCrane1}/${U.unlCrane2}; save and load round-trip`);
  }

  // A paid pickup banks everything and brings the mech home.
  {
    const { e, c, step } = setup({}, 400, 0);
    const it = rollItem(4242, { ...LOOT_DEFAULTS });
    e.add({ kind: "item", item: it, label: "Gun" });
    const fee = padFee(PV, 2);
    step(PV.padHold + 0.5);
    if (c.state !== "waiting") fail(`pads: holding E did not start the call (${c.state})`);
    if (e.scrapAtRisk !== 400 - fee) fail(`pads: carried scrap after the fee is ${e.scrapAtRisk}, expected ${400 - fee}`);
    let homes = 0;
    for (let t = 0; t < 400 && c.state !== "idle"; t += 1 / 30) {
      c.update(1 / 30, pad, { x: pad.x, z: pad.z, alive: true, eHeld: false, unlocked: true, convoyM: 2000 });
      if (e.update(1 / 30, false, false) === "home") homes++;
    }
    for (let t = 0; t < 6; t += 1 / 30) if (e.update(1 / 30, false, false) === "home") homes++;
    if (!c.events.some((x) => x.type === "extracted")) fail("pads: no extracted event");
    if (e.bank.scrap !== 400 - fee || e.bank.items.length !== 1 || e.atRisk.length !== 0) fail(`pads: pickup banked ${e.bank.scrap} scrap / ${e.bank.items.length} items, at risk ${e.atRisk.length}`);
    if (e.counts.extracted !== 1 || e.counts.destroyed !== 0 || e.last?.reason !== "extracted") fail("pads: the run did not end as extracted");
    if (e.events.filter((x) => x.type === "banked").length !== 1 || e.events.some((x) => x.type === "lost")) fail("pads: banking events wrong (one banked, no lost)");
    if (homes !== 1) fail(`pads: the mech was sent home ${homes} times`);
    console.log(`pads: paid pickup (fee ${fee}, waited ${PV.padWaitBase + PV.padWaitPerKm * 2} s) banked ${e.bank.scrap} scrap and ${e.bank.items.length} item, mech home once`);
  }

  // Cancel: leave the pad while waiting, the set share comes back.
  {
    const { e, c, step } = setup({}, 300, 0);
    const fee = padFee(PV, 2);
    step(PV.padHold + 0.3);
    if (c.state !== "waiting") fail("pads(cancel): call did not start");
    step(5, pad);
    step(0.5, null, { x: pad.x + PV.padLeave + 3, eHeld: false });
    const ev = c.events.find((x) => x.type === "cancelled") as Extract<PadEvent, { type: "cancelled" }> | undefined;
    if (c.state !== "idle" || !ev) fail("pads(cancel): leaving did not cancel");
    else {
      const want = Math.round(fee * PV.padRefund);
      if (ev.refundCarried !== want || e.scrapAtRisk !== 300 - fee + want) fail(`pads(cancel): refunded ${ev.refundCarried}, carried ${e.scrapAtRisk}, expected refund ${want}`);
      console.log(`pads: cancel refunds ${ev.refundCarried} of the ${fee} fee (${PV.padRefund * 100}%)`);
    }
  }

  // Destroyed while waiting: everything and the fee lost.
  {
    const { e, c, step } = setup({}, 300, 77);
    step(PV.padHold + 0.3);
    if (c.state !== "waiting") fail("pads(destroyed): call did not start");
    step(10);
    e.destroyed();
    step(1, pad, { alive: false });
    if (c.state !== "idle" || e.bank.scrap !== 77 || e.atRisk.length !== 0 || e.counts.destroyed !== 1) fail(`pads(destroyed): state ${c.state}, bank ${e.bank.scrap}, at risk ${e.atRisk.length}`);
    if (c.events.some((x) => x.type === "extracted" || x.type === "cancelled")) fail("pads(destroyed): extracted or refunded after the mech died");
    console.log("pads: destroyed while waiting loses everything carried and the fee (bank untouched)");
  }

  // Carried-only mode refuses when the carried scrap is short, even with a full bank.
  {
    const { e, c, step } = setup({ padBankTopUp: 0 }, 50, 9999);
    step(PV.padHold + 0.5);
    if (c.state !== "idle" || c.refusal !== "short" || e.scrapAtRisk !== 50 || e.bank.scrap !== 9999) fail(`pads(carried only): state ${c.state}, refusal '${c.refusal}'`);
    const q = padQuote({ ...PV, padBankTopUp: 0 }, true, 2, 300, 0);
    if (!q.ok || q.bankCost !== 0) fail("pads(carried only): enough carried scrap was refused");
    console.log(`pads: carried-only mode refuses 50 carried against a fee of ${padFee(PV, 2)}, takes nothing from the bank`);
  }

  // Top-up mode charges the bank the markup on what the carried scrap lacks.
  {
    const fee = padFee(PV, 2), carried = 50, rest = fee - carried, cost = Math.ceil(rest * PV.padBankMarkup);
    const { e, c, step } = setup({ padBankTopUp: 1 }, carried, 1000);
    step(PV.padHold + 0.5);
    if (c.state !== "waiting" || e.scrapAtRisk !== 0 || e.bank.scrap !== 1000 - cost) fail(`pads(top-up): carried ${e.scrapAtRisk}, bank ${e.bank.scrap}, expected 0 and ${1000 - cost}`);
    // Cancel returns the share to where it came from.
    step(0.5, null, { x: pad.x + 99, eHeld: false });
    const rc = Math.round(carried * PV.padRefund), rb = Math.round(cost * PV.padRefund);
    if (e.scrapAtRisk !== rc || e.bank.scrap !== 1000 - cost + rb) fail(`pads(top-up cancel): carried ${e.scrapAtRisk} (want ${rc}), bank ${e.bank.scrap} (want ${1000 - cost + rb})`);
    const poor = setup({ padBankTopUp: 1 }, 50, cost - 1);
    poor.step(PV.padHold + 0.5);
    if (poor.c.state !== "idle" || poor.c.refusal !== "short") fail("pads(top-up): a bank one short of the marked-up cost was accepted");
    console.log(`pads: top-up covers ${rest} lacking at x${PV.padBankMarkup} = ${cost} from the bank; a bank one short refuses`);
  }
}

if (problems.length) { console.log(`expedition check FAILED (${problems.length})`); throw new Error("expedition check failed"); }
console.log("expedition check passed");
