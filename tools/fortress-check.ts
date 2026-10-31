// Headless fortress and hub check (docs/proposal-fortresses.md):
// - placement: fortresses and hubs turn up, deterministic in any order, none within siegeClear of the start;
// - walls: every ring stands its full height round the ring except at its gates, its faces far steeper than the
//   walker's wall grade (nothing walks up them), and the walls never reach past the pad;
// - gates: a barred gate is a plug of the wall's height until it's down; down, the gap is the pad's floor;
// - reach: walking the ground on a 1.5 m grid (never onto ground steeper than the walker's wall grade), nothing inside a ring
//   can be reached while its gates stand, each yard opens once the gates out to it are down, and every salvage spot
//   is reachable then; a hub's openings let you in from the start;
// - the real walker: walking and running straight at a wall it stops outside; through a downed gate it walks in.
// Run: npm test (or npx tsx tools/fortress-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { POI_DEFAULTS, PoiField, type PoiPlacement } from "../src/world/pois";
import { PoiPads, rawGround } from "../src/world/poiPads";
import { addModifier } from "../src/world/modifiers";
import { SITE_DEFAULTS, buildSite } from "../src/pois/kinds";
import { SiegeWalls, isSiege, wallHeight } from "../src/pois/fortressGround";
import type { Layout } from "../src/pois/fortress";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";

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

if (problems.length) { console.log(`FAIL ${problems.length} problem(s)`); throw new Error("fortress check failed"); }
console.log("fortress check passed");
