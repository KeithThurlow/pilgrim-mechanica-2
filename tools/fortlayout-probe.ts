// Probe (not a check): a fortress layout's numbers. npx tsx tools/fortlayout-probe.ts [seeds]
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { POI_DEFAULTS, PoiField } from "../src/world/pois";
import { PoiPads, rawGround } from "../src/world/poiPads";
import { addModifier } from "../src/world/modifiers";
import { SITE_DEFAULTS, buildSite } from "../src/pois/kinds";
import { SiegeWalls, wallHeight } from "../src/pois/fortressGround";
const V = { ...TERRAIN_DEFAULTS, ...POI_DEFAULTS, ...SITE_DEFAULTS };
const field = new DuneField(V);
const pois = new PoiField({ ...V, poiChance: 0, bigChance: 0 }, rawGround(field));
const pads = new PoiPads(pois); addModifier(field, pads);
const walls = new SiegeWalls(pois, V); addModifier(field, walls);
for (const seed of [3, 1, 2, 4, 5, 6]) {
  pois.extra.length = 0;
  const p = pois.placeAt(`lab:${seed}`, "fortress", 0, 250, 0.4, seed * 7919 + 13);
  pois.extra.push(p); pads.reindex(); walls.reset();
  const L = walls.layout(p);
  const t0 = performance.now();
  let lo = Infinity, hi = -Infinity, n = 0;
  for (let x = -150; x <= 150; x += 1) for (let z = -150; z <= 150; z += 1) { const h = field.height(x, 250 + z) - wallHeight(L, x, 250 + z, walls.down); n++; if (Math.hypot(x, z) < 120) { lo = Math.min(lo, h); hi = Math.max(hi, h); } }
  const ms = (performance.now() - t0) / n * 1000;
  const site = buildSite(p, V);
  const lanes = L.streets.filter((s) => !s.main).length;
  const per = L.rings.map((_, k) => L.blocks.filter((b) => b.yard === k && b.kind === "shack").length);
  console.log(`seed ${seed}: rings ${L.rings.length} (${L.rings.map((r) => r.r.toFixed(0) + ":" + r.gates.map((g) => (g.barred ? "B" : "o")).join("")).join(" ")}) streets ${L.streets.length - lanes} lanes ${lanes} shacks ${per.join("/")} spawners ${L.spawners.length} cover ${L.blocks.filter((b) => b.kind === "cover").length} props ${site.props.length} spots ${site.sections.map((s) => s.spots.length).join("/")} floor relief ${(hi - lo).toFixed(1)} m · ${ms.toFixed(2)} us/sample`);
}

// ?svg: a plan of each seed into the scratchpad (rings, gates, streets, shacks).
if (process.argv.includes("--svg")) {
  const { ringR } = await import("../src/pois/fortress");
  const fs = await import("node:fs");
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000" viewBox="0 0 1500 1000" style="background:#e8d9b8">`;
  [3, 1, 2, 4, 5, 6].forEach((seed, idx) => {
    pois.extra.length = 0;
    const p = pois.placeAt(`lab:${seed}`, "fortress", 0, 250, 0.4, seed * 7919 + 13);
    pois.extra.push(p); pads.reindex(); walls.reset();
    const L = walls.layout(p);
    const ox = 250 + (idx % 3) * 500, oz = 250 + Math.floor(idx / 3) * 500, k = 1.9;
    const X = (x: number) => (ox + (x - p.x) * k).toFixed(1), Z = (z: number) => (oz - (z - p.z) * k).toFixed(1);
    out += `<text x="${ox - 230}" y="${oz - 225}" font-size="16">seed ${seed}</text>`;
    for (const ring of L.rings) {
      let d = "";
      for (let i = 0; i <= 180; i++) { const a = (i / 180) * Math.PI * 2, R = ringR(ring, a); d += `${i ? "L" : "M"}${X(p.x + Math.sin(a) * R)},${Z(p.z + Math.cos(a) * R)}`; }
      out += `<path d="${d}" fill="none" stroke="#6b4b2a" stroke-width="5"/>`;
      for (const g of ring.gates) out += `<circle cx="${X(g.x)}" cy="${Z(g.z)}" r="8" fill="${g.barred ? "#c22" : "#2a2"}"/>`;
    }
    for (const s of L.streets) out += `<polyline points="${s.pts.map((q) => `${X(q.x)},${Z(q.z)}`).join(" ")}" fill="none" stroke="${s.main ? "#fff" : "#f6f0e0"}" stroke-width="${s.w * k}" stroke-linejoin="round" opacity="0.8"/>`;
    for (const b of L.blocks) {
      const ux = Math.sin(b.a), uz = Math.cos(b.a), wx = Math.cos(b.a), wz = -Math.sin(b.a);
      const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, t]) => `${X(b.x + ux * b.len / 2 * s + wx * b.dep / 2 * t)},${Z(b.z + uz * b.len / 2 * s + wz * b.dep / 2 * t)}`);
      out += `<polygon points="${c.join(" ")}" fill="${b.kind === "cover" ? "#555" : b.stack > 1 ? "#7a4030" : "#a8643f"}"/>`;
      if (b.kind === "shack") out += `<line x1="${X(b.x)}" y1="${Z(b.z)}" x2="${X(b.x + Math.sin(b.door) * 3)}" y2="${Z(b.z + Math.cos(b.door) * 3)}" stroke="#000" stroke-width="1"/>`;
    }
  });
  fs.writeFileSync(process.argv[process.argv.indexOf("--svg") + 1], out + "</svg>");
}
