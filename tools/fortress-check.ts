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
import { SiegeWalls, isSiege, wallHeight, fenced, routeVia } from "../src/pois/fortressGround";
import type { Layout } from "../src/pois/fortress";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import * as THREE from "three/webgpu";
import { Gates, GATE_DEFAULTS, type GateEvent } from "../src/pois/gates";
import { InfantrySwarm, INFANTRY_DEFAULTS, DEAD } from "../src/combat/infantry";
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
const smoothAt = (L: Layout, a: number, ringR: number) => L.rings.some((r) => r.r === ringR && r.gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g.a), Math.cos(a - g.a))) * r.r < g.w / 2 + r.face + 1));
let rings = 0, gatesTried = 0, steepest = Infinity, spotsReached = 0;

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
      if (smoothAt(L, a, ring.r)) continue;
      const sx = Math.sin(a), sz = Math.cos(a);
      const top = w.field.height(p.x + sx * ring.r, p.z + sz * ring.r) - floor(p.x + sx * ring.r, p.z + sz * ring.r);
      if (top < ring.h * 0.95) { fail(`${p.id}: ring at ${ring.r} m only ${top.toFixed(1)} m high at ${(a * 57.3).toFixed(0)} deg`); break; }
      // Steepest rise across the face, either side (over 0.5 m steps).
      let worst = 0;
      for (const side of [-1, 1]) for (let e = ring.top; e < ring.top + ring.face; e += 0.5) {
        const r0 = ring.r + side * e, r1 = ring.r + side * (e + 0.5);
        worst = Math.max(worst, Math.abs(w.field.height(p.x + sx * r0, p.z + sz * r0) - w.field.height(p.x + sx * r1, p.z + sz * r1)) / 0.5);
      }
      steepest = Math.min(steepest, worst);
      if (worst < WALKER_DEFAULTS.wallStop) { fail(`${p.id}: ring at ${ring.r} m: face only rises ${worst.toFixed(2)} per m at ${(a * 57.3).toFixed(0)} deg`); break; }
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
  const inRing = (x: number, z: number, k: number) => Math.hypot(x - p.x, z - p.z) < L.rings[k].r - L.rings[k].top - L.rings[k].face;
  w.walls.down.clear();
  for (let k = 0; k <= L.rings.length; k++) {
    const can = flood(w.field, L);
    // Everything inside ring k (k < count) must be out of reach while ring k's gates stand.
    if (k < L.rings.length && L.rings[k].gates.some((g) => g.barred)) {
      for (let t = 0; t < 40; t++) {
        const a = t * 2.4, d = (L.rings[k].r - L.rings[k].top - L.rings[k].face - 2) * Math.sqrt((t + 0.5) / 40);
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
console.log(`walls: ${rings} rings, ${gatesTried} gates · faces rise at least ${steepest.toFixed(2)} per m (walker stops at ${WALKER_DEFAULTS.wallStop}) · ${spotsReached} spots reached ring by ring`);

// ---- 3. the real walker against a wall, and through a downed gate ----
{
  const fort = sieges.find((p) => p.kind === "fortress");
  if (!fort) fail("no fortress to walk at");
  else {
    const L = w.walls.layout(fort), outer = L.rings[0], g = outer.gates[0];
    const walkAt = (a: number, sprint: boolean) => {
      const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, w.field);
      const d0 = outer.r + 22, x0 = fort.x + Math.sin(a) * d0, z0 = fort.z + Math.cos(a) * d0;
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
      const c = walkAt(wallA, sprint);
      if (c < outer.r - outer.top) fail(`${sprint ? "running" : "walking"} at the outer wall got to ${c.toFixed(1)} m from the centre (wall at ${outer.r})`);
      console.log(`walker ${sprint ? "running" : "walking"} at the wall: stopped ${c.toFixed(1)} m from the centre (wall line ${outer.r} m)`);
    }
    w.walls.down.add(g.id);
    const c = walkAt(g.a, false);
    w.walls.down.clear();
    const inner = L.rings[1];
    if (c > outer.r - outer.top - outer.face - 4) fail(`walking through a downed gate only got to ${c.toFixed(1)} m from the centre`);
    console.log(`walker through a downed gate: got to ${c.toFixed(1)} m from the centre (next wall at ${inner?.r ?? 0} m)`);
  }
}

// ---- 4. gates as targets ----
const fort = sieges.find((p) => p.kind === "fortress")!;
{
  const L = w.walls.layout(fort), ring = L.rings[0], g = ring.gates[0];
  const floor = w.field.height(fort.x, fort.z) - wallHeight(L, fort.x, fort.z, w.walls.down);
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
  const a2 = g.a + Math.PI / ring.gates.length, o2 = new THREE.Vector3(fort.x + Math.sin(a2) * (ring.r + 40), floor + 3, fort.z + Math.cos(a2) * (ring.r + 40));
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
  const gap = w.field.height(g.x, g.z) - floor;
  if (Math.abs(gap) > 0.3) fail(`a downed gate's gap is ${gap.toFixed(2)} m off the floor`);
  // A fresh gate: a blast next to it wears it.
  const s2 = gates.add(fort.id, ring.gates[ring.gates.length - 1], ring, floor);
  const n = gates.splash(new THREE.Vector3(s2.gate.x + ux * 3, floor + 2, s2.gate.z + uz * 3), 6, 200, d, { blast: true });
  if (n !== 1 || s2.hp >= s2.max) fail(`a blast beside a gate hit ${n} gates, health ${s2.hp}/${s2.max}`);
  console.log(`gates: a round meets the slab at ${hit.toFixed(1)} m (sand at ${sand < 0 ? "-" : sand.toFixed(1)} m) · down after ${rounds} rounds of 9 (${s.max} hp, armour ${GATE_DEFAULTS.gateArmour}) · one gateDown · the gap at the floor (${gap.toFixed(2)} m)`);
  w.walls.down.clear();
}

// ---- 5. the fence: nobody on foot over a wall ----
{
  const L = w.walls.layout(fort), ring = L.rings[0], next = L.rings[1];
  const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, w.field, 9);
  sw.fence = (x0, z0, x1, z1) => fenced(L, x0, z0, x1, z1, w.walls.down);
  // 40 in the outer yard, the mech 60 m outside the wall half way between two gates; 6 sentries on the wall's top.
  const am = ring.gates[0].a + Math.PI / ring.gates.length;
  const tx = fort.x + Math.sin(am) * (ring.r + 60), tz = fort.z + Math.cos(am) * (ring.r + 60);
  const yardR = (next.r + ring.r) / 2;
  const yard = sw.spawn(40, fort.x + Math.sin(am) * yardR, fort.z + Math.cos(am) * yardR, 10);
  const sentries = sw.spawn(6, fort.x + Math.sin(am) * ring.r, fort.z + Math.cos(am) * ring.r, 2);
  for (const i of sentries) { sw.hold[i] = 1; sw.py[i] = w.field.height(sw.px[i], sw.pz[i]); }
  for (const i of [...yard, ...sentries]) sw.hp[i] = 1e9; // nobody dies of the test
  const T = { x: tx, y: w.field.height(tx, tz) + 3, z: tz, radius: 2.5 };
  const outside = (i: number) => Math.hypot(sw.px[i] - fort.x, sw.pz[i] - fort.z) > ring.r + ring.top + ring.face;
  const onWall = (i: number) => wallHeight(L, sw.px[i], sw.pz[i], w.walls.down) > 1;
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
  const T2 = { x: fort.x + Math.sin(g.a) * (ring.r + 40), y: 0, z: fort.z + Math.cos(g.a) * (ring.r + 40), radius: 2.5 };
  T2.y = w.field.height(T2.x, T2.z) + 3;
  let through = 0;
  // The glue's routing (routeVia): round the yard to the open gate, through it, then at the mech.
  let worstWait = 0;
  for (let t = 0; t < 60 * 60; t++) {
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
  if (through < 36) fail(`with a gate down only ${through} of 40 came round and out through it in 60 s`);
  console.log(`fence: 40 bandits held in the yard for 30 s (${out} out, ${climbed} on the wall), sentries kept to the wall's top (moved up to ${sentryMoved.toFixed(2)} m) · a gate down: ${through} of 40 came round and out through it${worstWait ? ` (all out by ${worstWait.toFixed(0)} s)` : ""}`);
}

// ---- 6. hubs build robots ----
{
  const hub = sieges.find((p) => p.kind === "hub")!;
  const groups = new Map<string, number>();
  const sink = { addGroup: (id: string, n: number) => { groups.set(id, n); }, group: (id: string) => (groups.has(id) ? { n: groups.get(id)! } : null) };
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
  const deads = ev.filter((e) => e.type === "hubDead").length;
  if (deads !== 1 || !H.isDead(hub.id)) fail(`hubDead fired ${deads} times`);
  const b2 = H.bearing(hub.x + 900, hub.z);
  if (b2 !== undefined && b !== undefined && Math.abs(b2 - b) < 1e-6) fail("packs still lean to a dead hub");
  console.log(`hubs: asleep nothing · awake ${built} batches in 120 s (${alive} robots, cap ${HV.hubCap}) · ${nf} fabricators down in ${rounds} rounds of 20 · dead: one hubDead, no more batches`);
}

if (problems.length) { console.log(`FAIL ${problems.length} problem(s)`); throw new Error("fortress check failed"); }
console.log("fortress check passed");
