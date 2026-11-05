// Headless fortress and hub check (docs/proposal-fortresses.md):
// - placement: fortresses and hubs turn up, deterministic in any order, none within siegeClear of the start;
// - walls: every ring stands its full height round the ring except at its gates, its faces far steeper than the
//   walker's wall grade (nothing walks up them), and the walls never reach past the pad;
// - gates: a barred gate is a plug of the wall's height until it's down; down, the gap is the pad's floor;
// - reach: walking the ground on a 1.5 m grid (never onto ground steeper than the walker's wall grade), nothing inside a ring
//   can be reached while its gates stand, each yard opens once the gates out to it are down, and every salvage spot
//   is reachable then; a hub's openings let you in from the start;
// - the real walker: walking and running straight at a wall it stops outside; through a downed gate it walks in;
// - gates as targets: a round at a gate strikes its slab short of the sand, one along the wall misses, rounds and blasts
//   wear it down (armour off each hit), and at zero it's down: one gateDown event, never another hit;
// - the fence: bandits in a yard sent for a mech outside never cross or climb its wall while the gates stand, and once
//   a gate is down some come out through it; sentries posted on a wall top hold it (the swarm's hold);
// - hubs: asleep they build nothing; awake each standing fabricator sends batches, never past the cap alive; a round
//   at a fabricator hits it, shot down it builds nothing, all down the hub is dead (one hubDead) and packs stop leaning to it.
// Run: npm test (or npx tsx tools/fortress-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { POI_DEFAULTS, PoiField, type PoiPlacement } from "../src/world/pois";
import { PoiPads, rawGround } from "../src/world/poiPads";
import { addModifier } from "../src/world/modifiers";
import { SITE_DEFAULTS, buildSite } from "../src/pois/kinds";
import { SiegeWalls, isSiege, wallHeight, wallMetal, fenced, routeVia } from "../src/pois/fortressGround";
import { ringR, type Layout } from "../src/pois/fortress";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import * as THREE from "three/webgpu";
import { Gates, GATE_DEFAULTS, type GateEvent } from "../src/pois/gates";
import { armourHit } from "../src/game/armour";
import { BASE_BY_ID } from "../src/items/bases";
import { InfantrySwarm, INFANTRY_DEFAULTS, DEAD } from "../src/combat/infantry";
import { Fortresses, FORT_LIFE_DEFAULTS } from "../src/expedition/fortresses";
import { Hubs, HUB_LIFE_DEFAULTS, type HubEvent } from "../src/expedition/hubs";
import type { Battlefield } from "../src/game/battlefield";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 40) console.log("  FAIL " + s); problems.push(s); };
const V = { ...TERRAIN_DEFAULTS, ...POI_DEFAULTS, ...SITE_DEFAULTS };
const GRADE = WALKER_DEFAULTS.wallGrade;

function world(clear = 190) {
  const field = new DuneField(V);
  const raw = rawGround(field);
  const pois = new PoiField(V, raw);
  pois.keepClear = [{ x: 0, z: 0, r: clear }];
  const pads = new PoiPads(pois);
  addModifier(field, pads);
  const walls = new SiegeWalls(pois, V);
  addModifier(field, walls);
  return { field, pois, walls };
}

// ---- 1. placement ----
const A = 6000;
const w = world();
const sieges = w.pois.poisIn(-A, -A, A, A).filter(isSiege);
{
  const forts = sieges.filter((p) => p.kind === "fortress").length, hubs = sieges.length - forts;
  if (!forts) fail("no fortress in 12 x 12 km");
  if (!hubs) fail("no hub in 12 x 12 km");
  const b = world();
  const back = b.pois.poisIn(0, 0, A, A).concat(b.pois.poisIn(-A, -A, 0 - 1e-6, 0 - 1e-6), b.pois.poisIn(-A, 0, 0 - 1e-6, A), b.pois.poisIn(0, -A, A, 0 - 1e-6)).filter(isSiege);
  const key = (p: PoiPlacement) => `${p.id} ${p.kind} ${p.x.toFixed(5)} ${p.z.toFixed(5)} ${p.seed}`;
  if (sieges.map(key).sort().join("|") !== back.map(key).sort().join("|")) fail("fortress placement differs when asked in a different order");
  const near = Math.min(...sieges.map((p) => Math.hypot(p.x, p.z)));
  if (near < 190 + V.siegeClear) fail(`a fortress or hub ${near.toFixed(0)} m from the start (clear ${190 + V.siegeClear})`);
  console.log(`placement: ${forts} fortresses, ${hubs} hubs in 12 x 12 km, the same in any order · nearest the start ${near.toFixed(0)} m`);
}

// ---- 2. walls, gates and reach, per fortress and hub ----
const smoothAt = (ring: Layout["rings"][number], a: number) => ring.gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g.a), Math.cos(a - g.a))) * ringR(ring, a) < g.w / 2 + ring.face + ring.driftW + 1);
let rings = 0, gatesTried = 0, steepest = Infinity, spotsReached = 0, driftSteep = 0, shapes = new Set<string>();

/** Grid flood from outside the walls: which cells can be walked to. */
function flood(field: DuneField, L: Layout) {
  const S = 1.5, R = L.reach + 12, n = Math.ceil((2 * R) / S) + 1;
  const h = new Float32Array(n * n), steep = new Uint8Array(n * n), nrm = [0, 1, 0];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = L.x - R + i * S, z = L.z - R + j * S;
    h[j * n + i] = field.height(x, z);
    // The ground's own steepness, whichever way you cross it (a grid step along a face would understate it).
    field.normal(x, z, nrm);
    steep[j * n + i] = Math.hypot(nrm[0], nrm[2]) / Math.max(0.05, nrm[1]) > GRADE ? 1 : 0;
  }
  const seen = new Uint8Array(n * n), q: number[] = [];
  for (let i = 0; i < n; i++) for (const c of [i, (n - 1) * n + i, i * n, i * n + n - 1]) if (!seen[c]) { seen[c] = 1; q.push(c); }
  while (q.length) {
    const c = q.pop()!, ci = c % n, cj = (c / n) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const d = j * n + i;
      if (seen[d] || steep[d] || Math.abs(h[d] - h[c]) / S > GRADE) continue;
      seen[d] = 1; q.push(d);
    }
  }
  return (x: number, z: number) => {
    const i = Math.round((x - L.x + R) / S), j = Math.round((z - L.z + R) / S);
    return i >= 0 && j >= 0 && i < n && j < n && seen[j * n + i] === 1;
  };
}

for (const p of sieges.slice(0, 6)) {
  const L = w.walls.layout(p);
  const pad = p.pad!;
  if (L.reach > pad.r) fail(`${p.id}: walls reach ${L.reach.toFixed(0)} m, past the pad (${pad.r} m)`);
  const floor = (x: number, z: number) => w.field.height(x, z) - wallHeight(L, x, z, w.walls.down);
  for (const ring of L.rings) {
    rings++;
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      if (smoothAt(ring, a)) continue;
      const sx = Math.sin(a), sz = Math.cos(a), R = ringR(ring, a);
      const top = w.field.height(p.x + sx * R, p.z + sz * R) - floor(p.x + sx * R, p.z + sz * R);
      // Rounds ring on the containers and puff on the sand banked against them.
      if (!wallMetal(L, p.x + sx * R, p.z + sz * R, w.walls.down) || !w.field.metalAt(p.x + sx * R, p.z + sz * R)) fail(`${p.id}: a container at ${R.toFixed(0)} m is not metal to rounds`);
      const dr = R + ring.top + ring.face + ring.driftW * 0.5;
      if (ring.drift > 0 && wallMetal(L, p.x + sx * dr, p.z + sz * dr, w.walls.down)) fail(`${p.id}: the drift at ${dr.toFixed(0)} m is metal to rounds`);
      if (top < ring.h * 0.95) { fail(`${p.id}: ring at ${R.toFixed(0)} m only ${top.toFixed(1)} m high at ${(a * 57.3).toFixed(0)} deg`); break; }
      // The container face: the rise from the drift at its foot to the top, over the face's width, either side (the
      // least of the two sides counts).
      let worst = Infinity;
      for (const side of [-1, 1]) {
        const r0 = R + side * ring.top, r1 = R + side * (ring.top + ring.face);
        worst = Math.min(worst, Math.abs(w.field.height(p.x + sx * r0, p.z + sz * r0) - w.field.height(p.x + sx * r1, p.z + sz * r1)) / ring.face);
      }
      // The drift's steepest pitch: it's meant to be walked (the walker's grade).
      for (const side of [-1, 1]) for (let e = ring.top + ring.face; e < ring.top + ring.face + ring.driftW; e += 0.5) {
        const r0 = R + side * e, r1 = R + side * (e + 0.5);
        driftSteep = Math.max(driftSteep, Math.abs(w.field.height(p.x + sx * r0, p.z + sz * r0) - w.field.height(p.x + sx * r1, p.z + sz * r1)) / 0.5);
      }
      steepest = Math.min(steepest, worst);
      if (worst < WALKER_DEFAULTS.wallStop) { fail(`${p.id}: ring at ${R.toFixed(0)} m: face only rises ${worst.toFixed(2)} per m at ${(a * 57.3).toFixed(0)} deg`); break; }
    }
  }
  // Gates: barred and standing, a plug; down, the floor.
  for (const ring of L.rings) for (const g of ring.gates) {
    gatesTried++;
    const up = w.field.height(g.x, g.z) - floor(g.x, g.z);
    if (g.barred && up < ring.h * 0.95) fail(`${g.id}: standing gate only ${up.toFixed(1)} m high`);
    if (!g.barred && up > 0.05) fail(`${g.id}: an opening ${up.toFixed(2)} m high`);
  }
  // Reach: outside in, a ring's gates at a time.
  const site = buildSite(p, V);
  const inRing = (x: number, z: number, k: number) => Math.hypot(x - p.x, z - p.z) < ringR(L.rings[k], Math.atan2(x - p.x, z - p.z)) - L.rings[k].top - L.rings[k].face;
  shapes.add(`${L.rings.length}:${L.rings.map((r) => r.gates.length).join(",")}`);
  w.walls.down.clear();
  for (let k = 0; k <= L.rings.length; k++) {
    const can = flood(w.field, L);
    // Everything inside ring k (k < count) must be out of reach while ring k's gates stand.
    if (k < L.rings.length && L.rings[k].gates.every((g) => g.barred)) {
      for (let t = 0; t < 40; t++) {
        const a = t * 2.4, d = (ringR(L.rings[k], a) - L.rings[k].top - L.rings[k].face - 2) * Math.sqrt((t + 0.5) / 40);
        const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (can(x, z)) { fail(`${p.id}: inside ring ${k} reachable with its gates standing (${d.toFixed(0)} m from the centre)`); break; }
      }
    }
    // Every spot outside ring k (and inside ring k - 1) reachable now.
    for (const sec of site.sections) for (const s of sec.spots) {
      const inside = k < L.rings.length && inRing(s.x, s.z, k);
      const outsidePrev = k === 0 || inRing(s.x, s.z, k - 1);
      if (inside || !outsidePrev) continue;
      // A spot on top of a prop: try round it (reach is 7 m).
      let ok = false;
      for (let t = 0; t < 12 && !ok; t++) ok = can(s.x + Math.cos(t * 0.52) * (t ? 4 : 0), s.z + Math.sin(t * 0.52) * (t ? 4 : 0));
      if (!ok) fail(`${p.id}: ${s.label} in section ${s.section} not reachable with the gates out to it down`);
      else spotsReached++;
    }
    if (k < L.rings.length) for (const g of L.rings[k].gates) w.walls.down.add(g.id);
  }
  w.walls.down.clear();
}
if (driftSteep > GRADE) fail(`a sand drift pitches ${driftSteep.toFixed(2)} per m (the walker climbs ${GRADE})`);
console.log(`walls: ${rings} rings, ${gatesTried} gates, ${shapes.size} shapes (${[...shapes].join(" ")}) · container faces rise at least ${steepest.toFixed(2)} per m (walker stops at ${WALKER_DEFAULTS.wallStop}), drifts at most ${driftSteep.toFixed(2)} · ${spotsReached} spots reached ring by ring`);

// ---- 3. the real walker against a wall, and through a downed gate ----
{
  const fort = sieges.find((p) => p.kind === "fortress");
  if (!fort) fail("no fortress to walk at");
  else {
    const L = w.walls.layout(fort), outer = L.rings[0], g = outer.gates[0];
    const walkAt = (a: number, sprint: boolean) => {
      const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, w.field);
      const d0 = ringR(outer, a) + 22, x0 = fort.x + Math.sin(a) * d0, z0 = fort.z + Math.cos(a) * d0;
      sim.reset(x0, z0, a + Math.PI);
      let closest = Infinity;
      for (let i = 0; i < 120 * 12; i++) {
        sim.update(1 / 120, { x: -Math.sin(a), z: -Math.cos(a), sprint });
        closest = Math.min(closest, Math.hypot(sim.pos.x - fort.x, sim.pos.z - fort.z));
      }
      return closest;
    };
    const wallA = g.a + Math.PI / Math.max(1, outer.gates.length); // half way between two gates
    for (const sprint of [false, true]) {
      const c = walkAt(wallA, sprint), Rw = ringR(outer, wallA);
      if (c < Rw - outer.top) fail(`${sprint ? "running" : "walking"} at the outer wall got to ${c.toFixed(1)} m from the centre (wall at ${Rw.toFixed(1)})`);
      console.log(`walker ${sprint ? "running" : "walking"} at the wall: stopped ${c.toFixed(1)} m from the centre (wall line ${Rw.toFixed(1)} m, up the drift to the containers)`);
    }
    w.walls.down.add(g.id);
    const c = walkAt(g.a, false);
    w.walls.down.clear();
    const inner = L.rings[1];
    if (c > ringR(outer, g.a) - outer.top - outer.face - 4) fail(`walking through a downed gate only got to ${c.toFixed(1)} m from the centre`);
    console.log(`walker through a downed gate: got to ${c.toFixed(1)} m from the centre (next wall at ${inner ? ringR(inner, g.a).toFixed(0) : 0} m)`);
  }
}

// ---- 4. gates as targets ----
const fort = sieges.find((p) => p.kind === "fortress")!;
{
  const L = w.walls.layout(fort), ring = L.rings[0], g = ring.gates[0];
  // The ground rolls: the floor at the gate (as the glue takes it).
  const floor = w.field.height(g.x, g.z) - wallHeight(L, g.x, g.z, w.walls.down);
  const gates = new Gates({ ...GATE_DEFAULTS }, 2);
  const s = gates.add(fort.id, g, ring, floor);
  const events: GateEvent[] = [];
  gates.onEvent = (e) => { events.push(e); if (e.type === "gateDown") w.walls.down.add(e.id); };
  const ux = Math.sin(g.a), uz = Math.cos(g.a);
  const o = new THREE.Vector3(g.x + ux * 40, floor + 3, g.z + uz * 40), d = new THREE.Vector3(-ux, 0, -uz);
  const hit = gates.hitRay(o, d, 100);
  // Where the sand would stop it: march the ray against the ground.
  let sand = -1;
  for (let t = 0; t < 100; t += 0.05) if (w.field.height(o.x + d.x * t, o.z + d.z * t) > o.y) { sand = t; break; }
  if (hit < 0) fail("a round straight at a gate missed it");
  else if (sand >= 0 && hit > sand + 1e-3) fail(`a round at a gate meets the sand (${sand.toFixed(2)} m) before the slab (${hit.toFixed(2)} m)`);
  const a2 = g.a + Math.PI / ring.gates.length, o2 = new THREE.Vector3(fort.x + Math.sin(a2) * (ringR(ring, a2) + 40), floor + 3, fort.z + Math.cos(a2) * (ringR(ring, a2) + 40));
  if (gates.hitRay(o2, new THREE.Vector3(-Math.sin(a2), 0, -Math.cos(a2)), 100) >= 0) fail("a round at the wall between gates hit a gate");
  // Wear it down: 9-damage rounds (armour 3 takes a third), then a blast.
  let rounds = 0;
  while (!s.down && rounds < 5000) { gates.hitRay(o, d, 100); gates.damage(9, o, d, 0); rounds++; }
  const expect = Math.ceil(s.max / (9 - GATE_DEFAULTS.gateArmour));
  if (!s.down) fail("a gate never went down");
  if (Math.abs(rounds - expect) > 1) fail(`a gate took ${rounds} rounds of 9 (expected about ${expect} through its armour)`);
  const downs = events.filter((e) => e.type === "gateDown").length;
  gates.damage(9, o, d, 0);
  gates.splash(new THREE.Vector3(g.x, floor + 2, g.z), 5, 100, d, { blast: true });
  if (downs !== 1 || events.filter((e) => e.type === "gateDown").length !== 1) fail(`gateDown fired ${downs} times`);
  if (gates.hitRay(o, d, 100) >= 0) fail("a downed gate still stops rounds");
  if (!w.walls.down.has(g.id)) fail("gateDown didn't open the gap");
  const gap = w.field.height(g.x, g.z) - s.floor;
  if (Math.abs(gap) > 0.3) fail(`a downed gate's gap is ${gap.toFixed(2)} m off the floor`);
  // A fresh gate: a blast next to it wears it.
  const s2 = gates.add(fort.id, ring.gates[ring.gates.length - 1], ring, floor);
  const n = gates.splash(new THREE.Vector3(s2.gate.x + ux * 3, floor + 2, s2.gate.z + uz * 3), 6, 200, d, { blast: true });
  if (n !== 1 || s2.hp >= s2.max) fail(`a blast beside a gate hit ${n} gates, health ${s2.hp}/${s2.max}`);
  console.log(`gates: a round meets the slab at ${hit.toFixed(1)} m (sand at ${sand < 0 ? "-" : sand.toFixed(1)} m) · down after ${rounds} rounds of 9 (${s.max} hp, armour ${GATE_DEFAULTS.gateArmour}) · one gateDown · the gap at the floor (${gap.toFixed(2)} m)`);
  // Breach time (Keith 2026-11-05: walls took too long): two base miniguns on one gate, per ring inward.
  const mg = BASE_BY_ID["mg-medium"].stats, perRound = armourHit(mg.damage.base, GATE_DEFAULTS.gateArmour, mg.ap.base);
  const dps = 2 * mg.fireRate.base * perRound;
  const times = [0, 1, 2].map((r) => GATE_DEFAULTS.gateHp * (1 + GATE_DEFAULTS.gateRingHp * r) / dps);
  if (times[0] < 3 || times[0] > 10) fail(`two miniguns take ${times[0].toFixed(1)} s on an outer gate (want 3 to 10)`);
  if (times[2] > 15) fail(`two miniguns take ${times[2].toFixed(1)} s on a keep gate (want under 15)`);
  console.log(`gates: two miniguns (${dps.toFixed(0)} dps through armour) break the rings' gates in ${times.map((t) => t.toFixed(1)).join(" / ")} s; blasts ×${GATE_DEFAULTS.gateBlast}`);
  w.walls.down.clear();
}

// ---- 5. the fence: nobody on foot over a wall ----
{
  const L = w.walls.layout(fort), ring = L.rings[0], next = L.rings[1];
  const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, w.field, 9);
  sw.fence = (x0, z0, x1, z1) => fenced(L, x0, z0, x1, z1, w.walls.down);
  // 40 in the outer yard, the mech 60 m outside the wall half way between two gates; 6 sentries on the wall's top.
  const am = ring.gates[0].a + Math.PI / ring.gates.length;
  const Ram = ringR(ring, am);
  const tx = fort.x + Math.sin(am) * (Ram + 60), tz = fort.z + Math.cos(am) * (Ram + 60);
  const yardR = (ringR(next, am) + Ram) / 2;
  const yard = sw.spawn(40, fort.x + Math.sin(am) * yardR, fort.z + Math.cos(am) * yardR, 10);
  const sentries = sw.spawn(6, fort.x + Math.sin(am) * Ram, fort.z + Math.cos(am) * Ram, 0.5);
  // Posted along the wall's top 5 m apart, as the glue posts them.
  sentries.forEach((i, k) => {
    const a = am + ((k - 2.5) * 5) / Ram, R = ringR(ring, a);
    sw.px[i] = fort.x + Math.sin(a) * R; sw.pz[i] = fort.z + Math.cos(a) * R;
    sw.hold[i] = 1; sw.py[i] = w.field.height(sw.px[i], sw.pz[i]);
  });
  for (const i of [...yard, ...sentries]) sw.hp[i] = 1e9; // nobody dies of the test
  const T = { x: tx, y: w.field.height(tx, tz) + 3, z: tz, radius: 2.5 };
  const outside = (i: number) => Math.hypot(sw.px[i] - fort.x, sw.pz[i] - fort.z) > ringR(ring, Math.atan2(sw.px[i] - fort.x, sw.pz[i] - fort.z)) + ring.top + ring.face;
  const onWall = (i: number) => wallHeight(L, sw.px[i], sw.pz[i], w.walls.down) > ring.h * 0.8; // up on the containers (the drift is walked)
  let out = 0, climbed = 0, sentryMoved = 0, sentryOff = 0;
  const s0 = sentries.map((i) => [sw.px[i], sw.pz[i]]);
  for (let t = 0; t < 30 * 60; t++) {
    sw.update(1 / 60, T, () => {});
    for (const i of yard) { if (sw.state[i] >= DEAD) continue; if (outside(i)) out++; if (onWall(i)) climbed++; }
    for (const i of sentries) if (!onWall(i)) sentryOff++;
  }
  sentries.forEach((i, k) => { sentryMoved = Math.max(sentryMoved, Math.hypot(sw.px[i] - s0[k][0], sw.pz[i] - s0[k][1])); });
  if (out) fail(`${out} bandit-frames outside the wall with the gates standing`);
  if (climbed) fail(`${climbed} bandit-frames up on the wall`);
  // Sentries jostle a little for room (the swarm's spacing) but never leave the wall's top.
  if (sentryMoved > 5 || sentryOff) fail(`sentries: one moved ${sentryMoved.toFixed(1)} m, ${sentryOff} sentry-frames off the wall`);
  // A gate down: the yard comes out through it (aim the mech at that gate).
  const g = ring.gates[0];
  w.walls.down.add(g.id);
  const T2 = { x: fort.x + Math.sin(g.a) * (ringR(ring, g.a) + 40), y: 0, z: fort.z + Math.cos(g.a) * (ringR(ring, g.a) + 40), radius: 2.5 };
  T2.y = w.field.height(T2.x, T2.z) + 3;
  let through = 0;
  // The glue's routing (routeVia): round the yard to the open gate (round the shacks), through it, then at the mech;
  // the town's yards are wide (the outer wall about 120 m out), so they get 100 s.
  let worstWait = 0;
  for (let t = 0; t < 100 * 60; t++) {
    for (const i of yard) {
      if (sw.state[i] >= DEAD) continue;
      const via = routeVia(L, sw.px[i], sw.pz[i], T2.x, T2.z, w.walls.down);
      if (via) { sw.setTarget(i, via.x, sw.py[i], via.z, 0, true); sw.hurry[i] = 1; } else { sw.clearTarget(i); sw.hurry[i] = 0; }
    }
    sw.update(1 / 60, T2, () => {});
    if (yard.every((i) => sw.state[i] >= DEAD || outside(i)) && !worstWait) worstWait = t / 60;
  }
  for (const i of yard) if (sw.state[i] < DEAD && outside(i)) through++;
  w.walls.down.clear();
  if (through < 36) fail(`with a gate down only ${through} of 40 came round and out through it in 100 s`);
  console.log(`fence: 40 bandits held in the yard for 30 s (${out} out, ${climbed} on the wall), sentries kept to the wall's top (moved up to ${sentryMoved.toFixed(2)} m) · a gate down: ${through} of 40 came round and out through it${worstWait ? ` (all out by ${worstWait.toFixed(0)} s)` : ""}`);
}

// ---- 6. hubs build robots ----
{
  const hub = sieges.find((p) => p.kind === "hub")!;
  const groups = new Map<string, number>();
  let boss: string | null = null;
  const sink = { addGroup: (id: string, n: number) => { groups.set(id, n); }, addBoss: (id: string) => { boss = id; return 1; }, group: (id: string) => (id === boss ? { n: 1, x: hub.x, z: hub.z } : groups.has(id) ? { n: groups.get(id)!, x: hub.x, z: hub.z } : null) };
  const HV = { ...HUB_LIFE_DEFAULTS, hubFabH: V.hubFabH };
  const bf = { targets: [] as unknown[] } as unknown as Battlefield;
  const H = new Hubs(HV, w.field, bf, new THREE.Scene(), w.walls, sink, (x0, z0, x1, z1) => w.pois.poisIn(x0, z0, x1, z1));
  const ev: HubEvent[] = [];
  H.onEvent = (e) => ev.push(e);
  const far = { x: hub.x + 400, z: hub.z }, near = { x: hub.x + 120, z: hub.z };
  for (let t = 0; t < 60; t += 0.1) H.update(0.1, true, far);
  if (groups.size) fail(`an asleep hub built ${groups.size} batches`);
  const nf = H.fabs.list.length;
  if (nf !== Math.round(V.hubFabs)) fail(`a hub streamed in ${nf} fabricators (expected ${V.hubFabs})`);
  for (let t = 0; t < 120; t += 0.1) H.update(0.1, true, near);
  let alive = 0; for (const n of groups.values()) alive += n;
  if (!groups.size) fail("an awake hub built nothing in 120 s");
  if (alive > HV.hubCap) fail(`an awake hub has ${alive} robots out (cap ${HV.hubCap})`);
  const built = groups.size;
  // Kill the robots, shoot the fabricators down one by one.
  groups.clear();
  const b = H.bearing(hub.x + 900, hub.z);
  if (b === undefined || Math.abs(Math.atan2(Math.sin(b + Math.PI / 2), Math.cos(b + Math.PI / 2))) > 0.05) fail(`packs east of a hub don't lean west to it (bearing ${b})`);
  let rounds = 0;
  for (const s of H.fabs.list) {
    const o = new THREE.Vector3(hub.x + (s.fab.x - hub.x) * 0.2, s.floor + 4, hub.z + (s.fab.z - hub.z) * 0.2);
    const d = new THREE.Vector3(s.fab.x - o.x, 0, s.fab.z - o.z).normalize();
    while (!s.down && rounds < 20000) { if (H.fabs.hitRay(o, d, 200) < 0) { fail("a round at a fabricator missed it"); break; } H.fabs.damage(20, o, d, 0); rounds++; }
  }
  for (let t = 0; t < 120; t += 0.1) H.update(0.1, true, near);
  if (groups.size) fail(`a dead hub built ${groups.size} batches`);
  if (!boss || !ev.some((e) => e.type === "hubBossUp")) fail("no boss came out when the last tower fell");
  boss = null; // killed
  for (let t = 0; t < 2; t += 0.1) H.update(0.1, true, near);
  if (ev.filter((e) => e.type === "hubBossDown").length !== 1) fail("the boss's death wasn't one hubBossDown");
  const deads = ev.filter((e) => e.type === "hubDead").length;
  if (deads !== 1 || !H.isDead(hub.id)) fail(`hubDead fired ${deads} times`);
  const b2 = H.bearing(hub.x + 900, hub.z);
  if (b2 !== undefined && b !== undefined && Math.abs(b2 - b) < 1e-6) fail("packs still lean to a dead hub");
  console.log(`hubs: asleep nothing · awake ${built} batches in 120 s (${alive} robots, cap ${HV.hubCap}) · ${nf} fabricators down in ${rounds} rounds of 20 · dead: one hubDead, no more batches, the boss out and down once`);
}

// ---- 4. the convoy's turrets see the garrison (alert yards only) ----
{
  const wd = world(), fp = wd.pois.poisIn(-A, -A, A, A).find((q) => q.kind === "fortress")!;
  const any: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : any), apply: () => any });
  const bf = { targets: [], register: { add() {} }, canSee: () => true, gunFx: any, sfx: any, dust: any, blast() {}, resolveSheet: () => any, fire: () => 0 } as unknown as Battlefield;
  const pel = new THREE.Vector3(fp.x, wd.field.height(fp.x, fp.z) + 3, fp.z + 400);
  const mech = { alive: true, sim: { pelvis: pel, pos: pel, vel: new THREE.Vector3() }, shoveFrom() {} } as never;
  const F = new Fortresses({ ...FORT_LIFE_DEFAULTS, ...INFANTRY_DEFAULTS } as never, wd.field, bf, new THREE.Scene(), wd.walls, mech, null, () => [fp], () => {});
  for (let k = 0; k < 30; k++) F.update(1 / 30, true);
  const pts: THREE.Vector3[] = [];
  F.threats(fp.x, fp.z, 2000, pts, 1000);
  if (pts.length) fail(`${pts.length} sleeping garrison bandits counted as turret threats`);
  const live = [...F.live.values()][0];
  if (!live) fail("the fortress never streamed in");
  else {
    (F as unknown as { alarm(f: unknown, y: unknown): void }).alarm(live, live.yards[0]);
    F.threats(fp.x, fp.z, 2000, pts, 1000);
    const want = live.yards.filter((y) => y.state === "alert").reduce((n, y) => n + F.aliveIn(fp.id, y.k), 0);
    if (!pts.length || pts.length !== want) fail(`alert garrison: ${pts.length} turret threats, ${want} bandits alive in alert yards`);
    console.log(`fortress threats: asleep 0, alert ${pts.length}`);
    // ---- 7. spawner shacks: alert, waves pour out of their doors; shot down, nobody comes out of them again ----
    const L = live.L, poured: { x: number; z: number; id: string }[] = [];
    if (!L.spawners.length) fail("a fortress with no spawner shacks");
    for (let k = 0; k < L.rings.length - 1; k++) if (!L.spawners.some((q) => q.yard === k)) fail(`no spawner in yard ${k}`);
    for (const q of L.spawners) {
      const b = L.blocks[q.block];
      const out = (m: number) => wallHeight(L, q.x + Math.sin(q.a) * m, q.z + Math.cos(q.a) * m, wd.walls.down);
      if (out(-1) < b.h * 0.8) fail(`${q.id}: its door isn't on its shack's face`);
      if (out(3) > 0.7) fail(`${q.id}: its door opens onto something solid (${out(3).toFixed(2)} m)`);
    }
    const pourOrig = F.spawners.onPour!;
    F.spawners.onPour = (sp, x, z, a) => { poured.push({ x, z, id: sp.sp.id }); pourOrig(sp, x, z, a); };
    for (let k = 0; k < 30 * 8; k++) F.update(1 / 30, true);
    const first = poured.length;
    if (first < FORT_LIFE_DEFAULTS.fortTrickle) fail(`alert, only ${first} bandits poured out in 8 s`);
    for (const q of poured) {
      const sp = L.spawners.find((s) => s.id === q.id)!;
      if (Math.hypot(q.x - sp.x, q.z - sp.z) > 2.5) fail(`a bandit came out ${Math.hypot(q.x - sp.x, q.z - sp.z).toFixed(1)} m from its door`);
      if (wallHeight(L, q.x, q.z, wd.walls.down) > 0.7) { fail("a bandit came out on top of something"); break; }
    }
    // ---- 8. lookout towers: crews on top; alert, the grenadiers and rocketeers lob at the mech; shot down, the stack
    // leaves the ground and the crew dies ----
    {
      if (!L.towers.length) fail("a fortress with no lookout towers");
      const lobs: number[] = [];
      const bfl = bf as unknown as { lob: (...a: unknown[]) => unknown };
      bfl.lob = (...a: unknown[]) => { lobs.push(Math.hypot((a[2] as number) - pel.x, (a[3] as number) - pel.z)); return any; };
      // Stand the mech 30 m off the first tower with a bomb-thrower or rocketeer (outside, if the tower's in the outer yard).
      const t0 = F.towers.list.find((t) => t.crew.some((c) => c.kind !== "gun")) ?? F.towers.list[0];
      const top = t0 ? wd.field.height(t0.b.x, t0.b.z) - t0.floor : 0;
      if (t0 && top < t0.t.h * 0.9) fail(`a tower stands only ${top.toFixed(1)} m (${t0.t.h.toFixed(1)})`);
      const crewUp = t0 ? t0.crew.every((c) => F.sw.py[c.i] - t0.floor > t0.t.h * 0.9) : false;
      if (t0 && !crewUp) fail("a tower's crew isn't up on top");
      const keepP = pel.clone();
      if (t0) { pel.set(t0.b.x + 30, wd.field.height(t0.b.x + 30, t0.b.z), t0.b.z); for (const y of live.yards) (F as unknown as { alarm(f: unknown, y: unknown): void }).alarm(live, y); }
      for (let k = 0; k < 30 * 12; k++) F.update(1 / 30, true);
      const special = t0?.crew.filter((c) => c.kind !== "gun").length ?? 0;
      if (special && !lobs.length) fail("a tower's grenadier or rocketeer never fired in 12 s");
      if (lobs.some((d) => d > 0.5)) fail("a tower shot landed off the mech");
      // Down: off the ground, crew dead.
      let tdowns = 0;
      F.onTower = (e) => { if (e.type === "towerDown") tdowns++; };
      if (t0) { for (let n = 0; n < 500 && !t0.down; n++) F.towers.hurt(t0, 100); F.towers.hurt(t0, 100); }
      const after = t0 ? wd.field.height(t0.b.x, t0.b.z) - t0.floor : 0;
      const crewDead = t0 ? t0.crew.every((c) => F.sw.gen[c.i] !== c.gen || F.sw.state[c.i] >= DEAD - 1) : true;
      if (t0 && (tdowns !== 1 || after > 1)) fail(`tower down: ${tdowns} towerDown, ${after.toFixed(1)} m of it still in the ground`);
      if (!crewDead) fail("a toppled tower's crew lived");
      pel.copy(keepP);
      console.log(`towers: ${L.towers.length}, top ${top.toFixed(1)} m, crew ${t0?.crew.map((c) => c.kind).join("+")} up there · alert: ${lobs.length} shots at the mech 30 m off in 12 s · shot down: one towerDown, gone from the ground (${after.toFixed(2)} m), crew down`);
    }
    // Shoot every spawner down: one spawnerDown each, and no more pour.
    let downs = 0;
    F.onSpawner = (e) => { if (e.type === "spawnerDown") downs++; };
    for (const st of F.spawners.list) for (let n = 0; n < 200 && !st.down; n++) F.spawners.hurt(st, 100);
    F.spawners.hurt(F.spawners.list[0], 100);
    const before = poured.length;
    for (let k = 0; k < 30 * 40; k++) F.update(1 / 30, true);
    if (downs !== F.spawners.list.length) fail(`spawnerDown fired ${downs} times for ${F.spawners.list.length} spawners`);
    if (poured.length !== before) fail(`${poured.length - before} poured out of shot-down spawners`);
    console.log(`spawners: ${L.spawners.length} (every yard), doors on their faces onto open ground · alert: ${first} out of the doors in 8 s · all shot down: ${downs} downs, none out after`);
  }
}

if (problems.length) { console.log(`FAIL ${problems.length} problem(s)`); throw new Error("fortress check failed"); }
console.log("fortress check passed");
