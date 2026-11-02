// Weight check (Keith 2026-11-02): hull weapons hang with their weight behind the shoulder. A hull gun's magazines,
// feeds, casings and counterweights sit behind the shoulder joint and not much barrel hangs out front:
// - the centre of its weight (its surface, which is how weight reads on screen) is behind the shoulder (z <= 0);
// - at least 0.9 m of it reaches back behind the shoulder;
// - its muzzle reaches no more than 3.2 m ahead (the longshot rifle 4.2 m: it's meant to be the long one);
// - its axis hangs outboard of the shoulder (at least 0.8 m), clear of the hull.
// Models not yet rebalanced are listed, not failed (BALANCED grows as they're rebuilt).
// Run: npx tsx tools/weight-check.ts [id-filter]
import * as THREE from "three/webgpu";
import { CATALOG } from "../src/weapons/catalog";
import { rootAtMount, type ModelDef } from "../src/weapons/parts";
import { Piece } from "../src/weapons/kit";

const BALANCED = new Set(["cannon-hull", "rail-cannon-hull", "flak-hull", "sniper-hull"]);
const REACH: Record<string, number> = { "sniper-hull": 4.2 };

// Decals are open quads with no volume or weight: leave them out.
const tri0 = Piece.prototype.tri;
Piece.prototype.tri = function (a, b, c, sec, tone, decal) { if (!decal) tri0.call(this, a, b, c, sec, tone, decal); };

/** Where a model's weight sits: the area-weighted centre of its surface, its z and x extents, its muzzles. */
export function weightOf(d: ModelDef) {
  let A = 0, zmin = 1e9, zmax = -1e9;
  const S = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Vector3();
  for (const p of d.parts) {
    const P = p.geometry.attributes.position, idx = p.geometry.index, n = idx ? idx.count : P.count;
    const at = (i: number, o: THREE.Vector3) => { const k = idx ? idx.getX(i) : i; return o.set(P.getX(k), P.getY(k), P.getZ(k)).add(p.pivot); };
    for (let i = 0; i < n; i += 3) {
      at(i, a); at(i + 1, b); at(i + 2, c);
      const ar = t.subVectors(b, a).cross(c.clone().sub(a)).length() / 2;
      A += ar;
      S.addScaledVector(a.clone().add(b).add(c), ar / 3);
      zmin = Math.min(zmin, a.z, b.z, c.z); zmax = Math.max(zmax, a.z, b.z, c.z);
    }
  }
  S.divideScalar(A);
  const muzzles = Object.entries(d.sockets).filter(([k]) => /Muzzle_\d+$/.test(k)).map(([k, s]) => {
    const host = k.includes("/") ? d.parts.find((p) => p.name === k.split("/")[0]) : undefined;
    return s.pos.z + (host ? host.pivot.z : 0);
  });
  return { cog: S, zmin, zmax, muzzle: Math.max(...muzzles) };
}

let fails = 0;
const only = process.argv[2];
for (const e of CATALOG) {
  if (e.side !== "right" || e.mount !== "hull" || !e.build) continue;
  if (only && !e.id.includes(only)) continue;
  const w = weightOf(rootAtMount(e.build(-1)));
  const line = `${e.id.padEnd(22)} weight at z ${w.cog.z.toFixed(2).padStart(5)}, x ${w.cog.x.toFixed(2)}; back to ${w.zmin.toFixed(2)}, muzzle at ${w.muzzle.toFixed(2)}`;
  if (!BALANCED.has(e.id)) { console.log(`  (not yet) ${line}`); continue; }
  const bad: string[] = [];
  if (w.cog.z > 0) bad.push("weight ahead of the shoulder");
  if (w.zmin > -0.9) bad.push("less than 0.9 m behind the shoulder");
  if (w.muzzle > (REACH[e.id] ?? 3.2)) bad.push(`muzzle past ${REACH[e.id] ?? 3.2} m`);
  if (Math.abs(w.cog.x) < 0.8) bad.push("hangs inside 0.8 m of the shoulder");
  for (const m of bad) { fails++; console.log(`FAIL ${e.id}: ${m}`); }
  if (!bad.length) console.log(`  ok        ${line}`);
}
console.log(fails ? `weight-check: ${fails} failed` : "weight-check: ok");
process.exit(fails ? 1 : 0);
