// Headless POI check (docs/proposal-pois.md, step 1):
// - placement is deterministic in any order (cells asked forward, backward and in sub-boxes give the same POIs);
// - no two POIs closer than the minimum spacing; pads never cross their cell;
// - pads are flat and level with the ground they sit in (inside: within about 20 cm over its length and under 3 degrees; the pad at the
//   mean of the ground it covers), and their edges are no steeper than the dunes' own limit (75 degrees, as the
//   terrain check);
// - every kind's salvage adds up: each section's value is the sum of its spots, the site's the sum of its sections,
//   stripping it all pays exactly that; every section has a spot, every spot sits within the POI's footprint;
// - stripping happens only within reach, pauses out of reach (progress kept), resumes, and makes noise while it runs;
// - the convoy's road still works with POI pads stacked on it (same heights as the road alone away from pads, the pads'
//   own heights away from the road), and the stack folds modifiers exactly as applying them one after another.
// Run: npm test (or npx tsx tools/poi-check.ts).
import { DuneField, TERRAIN_DEFAULTS, type GroundModifier, type ModifierSample } from "../src/world/terrain";
import { POI_DEFAULTS, POI_KINDS, POI_KIND_LIST, POI_LEVELS, PoiField, type PoiPlacement } from "../src/world/pois";
import { PoiPads, rawGround } from "../src/world/poiPads";
import { ModifierStack, addModifier } from "../src/world/modifiers";
import { SITE_DEFAULTS, buildSite } from "../src/pois/kinds";
import { SalvageSim, SALVAGE_DEFAULTS } from "../src/pois/salvage";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 40) console.log("  FAIL " + s); problems.push(s); };
const R2D = 180 / Math.PI;
const V = { ...TERRAIN_DEFAULTS, ...POI_DEFAULTS, ...SITE_DEFAULTS, ...SALVAGE_DEFAULTS, ...ROUTE_DEFAULTS };
const key = (p: PoiPlacement) => `${p.id} ${p.kind} ${p.x.toFixed(6)} ${p.z.toFixed(6)} ${p.seed} ${p.pad ? p.pad.h.toFixed(6) : "-"}`;

function world(v = V) {
  const field = new DuneField(v);
  const raw = rawGround(field);
  const pois = new PoiField(v, raw);
  const pads = new PoiPads(pois);
  addModifier(field, pads);
  return { field, raw, pois, pads };
}

// ---- 1. deterministic in any order ----
{
  const A = 4000;
  const a = world(), b = world(), c = world();
  const fa = a.pois.poisIn(-A, -A, A, A).map(key).sort();
  // b: the cells asked in reverse (finest level first, from the far corner).
  for (let l = POI_LEVELS.length - 1; l >= 0; l--) {
    const C = b.pois.cellSize(l);
    for (let j = Math.floor(A / C); j >= Math.floor(-A / C); j--) for (let i = Math.floor(A / C); i >= Math.floor(-A / C); i--) b.pois.cell(l, i, j);
  }
  const fb = b.pois.poisIn(-A, -A, A, A).map(key).sort();
  // c: four sub-boxes in a scrambled order, heights asked first.
  for (let k = 0; k < 400; k++) c.field.height(Math.sin(k * 7.1) * A, Math.cos(k * 3.3) * A);
  const fc: string[] = [];
  for (const [x0, z0] of [[0, 0], [-A, -A], [-A, 0], [0, -A]]) c.pois.poisIn(x0, z0, x0 + A - 1e-6, z0 + A - 1e-6).forEach((p) => fc.push(key(p)));
  fc.sort();
  if (fa.join("|") !== fb.join("|")) fail("placement differs when cells are asked in reverse");
  if (fa.join("|") !== fc.join("|")) fail(`placement differs when asked in sub-boxes (${fa.length} vs ${fc.length})`);
  // Heights with pads: same in any order and from a fresh world.
  const pts: [number, number][] = [];
  for (const p of a.pois.poisIn(-A, -A, A, A)) if (p.pad) for (let k = 0; k < 12; k++) pts.push([p.x + Math.cos(k) * (p.pad.r + k * 2), p.z + Math.sin(k) * (p.pad.r + k * 2)]);
  const h1 = pts.map(([x, z]) => a.field.height(x, z));
  const d = world();
  const h2 = [...pts].reverse().map(([x, z]) => d.field.height(x, z)).reverse();
  if (h1.some((h, i) => h !== h2[i])) fail("pad heights differ between worlds asked in different orders");
  const counts: Record<string, number> = {};
  for (const p of a.pois.poisIn(-A, -A, A, A)) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  console.log(`placement: ${fa.length} POIs in 8x8 km, the same in any order · ${POI_KIND_LIST.map((k) => `${k} ${counts[k] ?? 0}`).join(", ")}`);
  if (fa.length < 100) fail(`only ${fa.length} POIs in 8x8 km`);
  for (const k of POI_KIND_LIST) if (!counts[k]) fail(`no ${k} placed in 8x8 km`);
}

// ---- 2. spacing; pads inside their cell ----
{
  const w = world();
  const A = 4000, list = w.pois.poisIn(-A, -A, A, A);
  let closest = Infinity;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const d = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z);
    closest = Math.min(closest, d);
    if (d < V.poiSpacing) fail(`${list[i].id} and ${list[j].id} only ${d.toFixed(0)} m apart`);
  }
  for (const p of list) {
    if (!p.pad) continue;
    const C = w.pois.cellSize(p.level), R = p.pad.r + p.pad.half + p.pad.blend;
    const i = Math.floor(p.x / C), j = Math.floor(p.z / C);
    if (Math.floor((p.x - R) / C) !== i || Math.floor((p.x + R) / C) !== i || Math.floor((p.z - R) / C) !== j || Math.floor((p.z + R) / C) !== j) fail(`${p.id}'s pad crosses its cell`);
  }
  // Another seed and a smaller cell, spacing still kept.
  const v2 = { ...V, poiSeed: 42, poiCell: 260, poiChance: 1 };
  const w2 = world(v2), l2 = w2.pois.poisIn(-2000, -2000, 2000, 2000);
  let c2 = Infinity;
  for (let i = 0; i < l2.length; i++) for (let j = i + 1; j < l2.length; j++) c2 = Math.min(c2, Math.hypot(l2[i].x - l2[j].x, l2[i].z - l2[j].z));
  if (c2 < v2.poiSpacing) fail(`seed 42, 260 m cells: two POIs ${c2.toFixed(0)} m apart`);
  console.log(`spacing: closest pair ${closest.toFixed(0)} m (min ${V.poiSpacing}); seed 42 with 260 m cells ${c2.toFixed(0)} m over ${l2.length} POIs`);
}

// ---- 3. pads flat and level ----
{
  const w = world();
  const A = 4000;
  let worstIn = 0, worstSlopeIn = 0, worstEdge = 0, worstLevel = 0, n = 0;
  const pad = w.pois.poisIn(-A, -A, A, A).filter((p) => p.pad);
  // Hand-placed ones on purpose in rough places too (across a dune crest).
  for (let k = 0; k < 12; k++) pad.push(w.pois.placeAt(`hand:${k}`, k % 2 ? "debrisField" : "deadConvoy", 4300 + (k % 4) * 140, -2500 + Math.floor(k / 4) * 160, k, k * 99));
  w.pois.extra.push(...pad.filter((p) => p.level < 0));
  w.pads.reindex();
  const nrm = [0, 1, 0];
  for (const p of pad) {
    const d = p.pad!;
    n++;
    const ax = Math.sin(d.yaw), az = Math.cos(d.yaw);
    let lo = Infinity, hi = -Infinity;
    for (let t = -1; t <= 1; t += 0.25) for (let a = 0; a < 12; a++) for (const f of [0, 0.45, 0.9]) {
      const x = d.x + ax * d.half * t + Math.cos(a * 0.52) * d.r * f, z = d.z + az * d.half * t + Math.sin(a * 0.52) * d.r * f;
      const h = w.field.height(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      w.field.normal(x, z, nrm);
      worstSlopeIn = Math.max(worstSlopeIn, Math.acos(nrm[1]) * R2D);
    }
    worstIn = Math.max(worstIn, hi - lo);
    // Level with the ground it covers: the pad at the mean of the raw ground over the pad and half its blend.
    let s = 0, m = 0;
    for (let t = -1; t <= 1; t += 0.25) for (let a = 0; a < 16; a++) for (const f of [0, 0.5, 1]) {
      s += w.raw.height(d.x + ax * d.half * t + Math.cos(a * 0.39) * (d.r + d.blend * 0.5) * f, d.z + az * d.half * t + Math.sin(a * 0.39) * (d.r + d.blend * 0.5) * f); m++;
    }
    worstLevel = Math.max(worstLevel, Math.abs(s / m - d.h));
    // The edge blend: no steeper than the dunes allow.
    for (let a = 0; a < 48; a++) for (let rr = d.r; rr <= d.r + d.blend; rr += 0.5) {
      const t = (a % 3) - 1;
      const x = d.x + ax * d.half * t + Math.cos(a * 0.131) * rr, z = d.z + az * d.half * t + Math.sin(a * 0.131) * rr;
      w.field.normal(x, z, nrm);
      worstEdge = Math.max(worstEdge, Math.acos(nrm[1]) * R2D);
    }
  }
  // The swell is cancelled by a quadratic fit, so a long pad keeps a few cm of its curve.
  const bumpAllow = 0.2 + 2 * V.bumps * V.padRough;
  if (worstIn > bumpAllow) fail(`a pad's floor varies by ${worstIn.toFixed(2)} m (allowed ${bumpAllow.toFixed(2)})`);
  if (worstSlopeIn > 3) fail(`a pad's floor slopes ${worstSlopeIn.toFixed(1)} deg`);
  if (worstLevel > 1.5) fail(`a pad sits ${worstLevel.toFixed(2)} m off the mean of its ground`);
  if (worstEdge > 75) fail(`a pad's edge reaches ${worstEdge.toFixed(0)} deg (cliff)`);
  console.log(`pads: ${n} checked · floor within ${worstIn.toFixed(3)} m, slope under ${worstSlopeIn.toFixed(2)} deg · off the ground's mean by up to ${worstLevel.toFixed(2)} m · steepest edge ${worstEdge.toFixed(0)} deg`);
}

// ---- 4. salvage adds up ----
{
  const w = world();
  let sites = 0, spots = 0, total = 0;
  for (const kind of POI_KIND_LIST) for (let k = 0; k < 60; k++) {
    const p = w.pois.placeAt(`v:${kind}:${k}`, kind, k * 50, -k * 30, k * 0.7, k * 7919 + 13);
    const site = buildSite(p, V);
    const again = buildSite(p, V);
    if (JSON.stringify(site) !== JSON.stringify(again)) fail(`${kind} seed ${k}: building twice differs`);
    sites++;
    let sum = 0;
    if (!site.sections.length) fail(`${kind} seed ${k}: no sections`);
    site.sections.forEach((sec, i) => {
      const s = sec.spots.reduce((a, q) => a + q.value, 0);
      if (!sec.spots.length) fail(`${kind} seed ${k}: section ${i} has no spots`);
      if (s !== sec.value) fail(`${kind} seed ${k}: section ${i} value ${sec.value} but its spots sum to ${s}`);
      for (const q of sec.spots) {
        if (q.section !== i) fail(`${kind} seed ${k}: spot in section ${i} says ${q.section}`);
        if (Math.hypot(q.x - p.x, q.z - p.z) > POI_KINDS[kind].footprint) fail(`${kind} seed ${k}: a spot ${Math.hypot(q.x - p.x, q.z - p.z).toFixed(1)} m out, past its footprint`);
        if (!(q.value > 0 && q.time > 0)) fail(`${kind} seed ${k}: a spot with value ${q.value}, time ${q.time}`);
      }
      sum += sec.value;
    });
    if (sum !== site.value) fail(`${kind} seed ${k}: site value ${site.value} but sections sum to ${sum}`);
    // Strip it all: walk to each spot and hold E until done.
    const sim = new SalvageSim({ ...SALVAGE_DEFAULTS });
    sim.add(site);
    let banked = 0;
    sim.onBanked = () => banked++;
    for (const s of sim.spots) for (let t = 0; t < 120 && !s.done; t++) sim.update(0.1, s.x + 0.5, s.z, true);
    if (sim.scrap !== site.value) fail(`${kind} seed ${k}: stripping all paid ${sim.scrap}, site worth ${site.value}`);
    if (banked !== site.sections.length) fail(`${kind} seed ${k}: banked ${banked} of ${site.sections.length} sections`);
    spots += sim.spots.length; total += site.value;
  }
  console.log(`salvage: ${sites} sites, ${spots} spots, ${total} scrap: sections, sites and stripping all agree`);
}

// ---- 5. stripping only within reach ----
{
  const v = { ...SALVAGE_DEFAULTS };
  const p = world().pois.placeAt("reach", "supplyPod", 0, 0, 0, 5);
  const site = buildSite(p, V);
  const sim = new SalvageSim(v);
  sim.add(site);
  let noise = 0;
  sim.onNoise = () => noise++;
  const s = sim.spots[0];
  // Everything else out of the way: only this spot.
  for (const q of sim.spots) if (q !== s) q.done = true;
  const dt = 1 / 120;
  const away = (d: number) => [s.x + d, s.z] as const;
  for (let t = 0; t < 10 / dt; t++) sim.update(dt, ...away(v.salvageReach + 0.3), true);
  if (s.progress !== 0) fail(`stripped from out of reach (${s.progress.toFixed(2)})`);
  for (let t = 0; t < 10 / dt; t++) sim.update(dt, ...away(v.salvageReach - 0.5), false);
  if (s.progress !== 0) fail("stripped without E held");
  const half = s.time / v.stripSpeed / 2;
  for (let t = 0; t < half / dt; t++) sim.update(dt, ...away(v.salvageReach - 0.5), true);
  const mid = s.progress;
  if (Math.abs(mid - 0.5) > 0.02) fail(`half the strip time gave ${mid.toFixed(2)}`);
  for (let t = 0; t < 3 / dt; t++) sim.update(dt, ...away(v.salvageReach + 1), true);
  if (s.progress !== mid) fail("progress changed out of reach (should pause)");
  const n0 = noise;
  for (let t = 0; t < (half + 0.1) / dt; t++) sim.update(dt, ...away(1), true);
  if (!s.done) fail(`not done after the full strip time (${s.progress.toFixed(2)})`);
  if (sim.scrap !== sim.pay(s)) fail(`paid ${sim.scrap}, spot worth ${sim.pay(s)}`);
  const expect = half / v.noiseEvery;
  if (noise - n0 < expect - 1.5 || noise - n0 > expect + 1.5) fail(`${noise - n0} noises in ${half.toFixed(1)} s of stripping (expected about ${expect.toFixed(1)})`);
  console.log(`reach: nothing from ${(v.salvageReach + 0.3).toFixed(1)} m, half at half time (${mid.toFixed(2)}), paused out of reach, done in ${s.time.toFixed(1)} s, ${noise} noises`);
}

// ---- 6. the convoy road with pads stacked ----
{
  // The stack folds exactly as sequential application.
  const mk = (w: number, berm: number, lift: number, rough: number): GroundModifier => ({ at: (_x, _z, o) => { o.w = w; o.berm = berm; o.lift = lift; o.rough = rough; return true; } });
  const S = 2.3, B = 0.4, h0 = 7.1;
  const apply = (h: number, m: ModifierSample) => h * (1 - m.w) + (S + m.lift + B * m.rough) * m.w + m.berm;
  const ms: ModifierSample[] = [{ w: 0.3, berm: 0.5, lift: 1, rough: 0.2 }, { w: 0.7, berm: 0, lift: -2, rough: 1 }, { w: 0.5, berm: 0.2, lift: 4, rough: 0 }];
  let seq = h0;
  for (const m of ms) seq = apply(seq, m);
  const out: ModifierSample = { w: 0, berm: 0, lift: 0, rough: 0 };
  new ModifierStack(ms.map((m) => mk(m.w, m.berm, m.lift, m.rough))).at(0, 0, out);
  if (Math.abs(apply(h0, out) - seq) > 1e-9) fail(`stack fold ${apply(h0, out)} vs sequential ${seq}`);

  const roadOnly = new DuneField(V);
  const r1 = new ConvoyRoute(V, 0, 0);
  roadOnly.modifier = r1;
  const both = new DuneField(V);
  const r2 = new ConvoyRoute(V, 0, 0);
  both.modifier = r2;
  const raw = rawGround(both), pois = new PoiField(V, raw);
  // A pad across the road and one beside it, plus the generated ones.
  pois.extra.push(pois.placeAt("onroad", "debrisField", 0, 60, 0.4, 3), pois.placeAt("beside", "deadConvoy", 120, 40, 1.1, 4));
  const pads = new PoiPads(pois);
  addModifier(both, pads);
  const padsOnly = new DuneField(V);
  padsOnly.modifier = new PoiPads(pois);
  for (let k = 0; k < 600; k++) { r1.update(0.5); r2.update(0.5); }
  let diffRoad = 0, diffPad = 0, nRoad = 0, nPad = 0, bad = 0;
  const tmp: ModifierSample = { w: 0, berm: 0, lift: 0, rough: 0 };
  for (let z = -300; z <= 1300; z += 2.3) for (let x = -200; x <= 200; x += 2.3) {
    const h = both.height(x, z);
    if (!Number.isFinite(h)) { bad++; continue; }
    const onPad = pads.at(x, z, tmp), onRoad = r2.at(x, z, tmp);
    if (!onPad) { diffRoad = Math.max(diffRoad, Math.abs(h - roadOnly.height(x, z))); nRoad++; }
    else if (!onRoad) { diffPad = Math.max(diffPad, Math.abs(h - padsOnly.height(x, z))); nPad++; }
  }
  if (bad) fail(`${bad} non-finite heights with road and pads stacked`);
  if (diffRoad > 1e-9) fail(`road heights off by ${diffRoad} away from pads`);
  if (diffPad > 1e-9) fail(`pad heights off by ${diffPad} away from the road`);
  // The road still flattens: its floor smooth where no pad is.
  let rough = 0;
  for (let s = 100; s < 1000; s += 13) {
    const p = r2.pointAt(s);
    if (pads.at(p.x, p.z, tmp)) continue;
    rough = Math.max(rough, Math.abs(both.height(p.x, p.z) - both.height(p.x + Math.cos(p.heading) * 3, p.z - Math.sin(p.heading) * 3)));
  }
  if (rough > 0.6) fail(`road floor steps ${rough.toFixed(2)} m across 3 m with pads stacked`);
  console.log(`road + pads: stack folds exactly; ${nRoad} road-side samples match the road alone, ${nPad} pad samples match the pads alone; road floor within ${rough.toFixed(2)} m across 3 m`);
}

if (problems.length) { console.log(`FAIL ${problems.length} problem(s)`); throw new Error("poi check failed"); }
console.log("poi check passed");
