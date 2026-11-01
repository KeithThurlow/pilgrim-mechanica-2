// Headless check of footprint shapes (src/fx/footprint.ts) and shaped dent brushes (src/fx/dentRule.ts splat):
// - every leg model's feet bake to a sole of a sensible size, left and right are mirror images, and models that share
//   a foot share its atlas tile;
// - a shaped print presses where the sole is and not between the toes, faces its yaw, and keeps its mass (berm volume
//   about the depression's, as the capsule does);
// - the robot bucket bakes to three claw marks; a disc to a round pad of its area.
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bakeFootFromGeometry } from "../src/fx/footprintMesh";
import { bakeDiscFoot, footSdf, shapeBermRatio, TILE, type FootShape } from "../src/fx/footprint";
import { splat, SURFACE_IDS, type Brush } from "../src/fx/dentRule";
import { DENT_DEFAULTS } from "../src/fx/dents";
import { AVAILABLE_LOOKS } from "../src/items/item";
import { bucketGeometry } from "../src/combat/robotShapes";

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };
const f2 = (x: number) => x.toFixed(2);

async function feet(look: string) {
  const b = readFileSync(`public/models/${look === "rampart" ? "rampart.glb" : `mechs/${look}.glb`}`);
  const g = await new Promise<{ scene: THREE.Object3D }>((res, rej) =>
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer, "", res as never, rej));
  g.scene.updateMatrixWorld(true);
  const out: Record<string, FootShape | null> = {};
  for (const s of ["L", "R"]) {
    let geo: THREE.BufferGeometry | null = null, fp = new THREE.Vector3();
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name === `Part_Foot_${s}`) geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (o.name === `Foot_${s}`) fp = o.getWorldPosition(new THREE.Vector3());
    });
    out[s] = geo ? bakeFootFromGeometry(`${look}:${s}`, geo, new THREE.Vector3(fp.x, 0, fp.z)) : null;
  }
  return out;
}

// --- every leg model
const tiles = new Set<number>();
let rampart: FootShape | null = null;
for (const look of AVAILABLE_LOOKS) {
  const { L, R } = await feet(look);
  ok(!!L && !!R, `${look}: both feet bake`);
  if (!L || !R) continue;
  if (look === "rampart") rampart = L;
  tiles.add(L.index); tiles.add(R.index);
  ok(L.width > 0.4 && L.width < 1.4 && L.length > 0.6 && L.length < 2, `${look}: sole ${f2(L.width)} x ${f2(L.length)} m, ${f2(L.area)} m²`);
  let worst = 0;
  for (let z = -1; z <= 1; z += 0.05) for (let x = -1; x <= 1; x += 0.05) worst = Math.max(worst, Math.abs(footSdf(L, x, z) - footSdf(R, -x, z)));
  ok(worst < 0.06, `${look}: left and right feet mirror (worst ${f2(worst)} m)`);
}
ok(tiles.size < AVAILABLE_LOOKS.length * 2, `variants sharing a foot model share its tile (${tiles.size} tiles for ${AVAILABLE_LOOKS.length * 2} feet)`);

// --- a shaped print
if (rampart) {
  const s = rampart, V = DENT_DEFAULTS, dep = 0.1;
  const wall = V.printWall, spread = V.printSpread;
  const mk = (yaw: number): Brush => ({
    x: 0, z: 0, r: 1, elong: 1, sy: Math.sin(yaw), cy: Math.cos(yaw), dep, berm: dep * shapeBermRatio(s, wall, spread),
    comp: 0.6, surf: SURFACE_IDS.sand, open: 0, mode: 0, shape: s.index + 1, ext: s.ext, wall, spread,
  });
  const at = (b: Brush, x: number, z: number) => { const st = [0, 0, 0, 0]; splat(st, 0, b, x, z); return st; };
  // Deepest spot of the sole and an outside spot close to it (between the toes or beside the heel).
  let inX = 0, inZ = 0, best = 0;
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) if (s.sdf[j * TILE + i] < best) { best = s.sdf[j * TILE + i]; inX = -s.ext + (i + 0.5) * (2 * s.ext / TILE); inZ = -s.ext + (j + 0.5) * (2 * s.ext / TILE); }
  const b0 = mk(0);
  ok(at(b0, inX, inZ)[0] > dep * 0.95, `the sole's middle presses full depth (${f2(at(b0, inX, inZ)[0] * 100)} cm)`);
  // The toes: a point on the sole well forward, and the gap beside it.
  let toe: [number, number] | null = null, gap: [number, number] | null = null;
  for (let z = s.length; z > 0.2 && !toe; z -= 0.02) for (let x = -0.6; x <= 0.6; x += 0.02) if (footSdf(s, x, z) < -0.03) { toe = [x, z]; break; }
  if (toe) for (let x = toe[0]; x <= toe[0] + 0.5; x += 0.01) if (footSdf(s, x, toe[1]) > 0.06) { gap = [x, toe[1]]; break; }
  ok(!!toe && at(b0, toe[0], toe[1])[0] > dep * 0.5, `a toe tip presses (${toe ? f2(at(b0, toe[0], toe[1])[0] * 100) : "-"} cm at ${toe?.map(f2)})`);
  ok(!!gap && at(b0, gap[0], gap[1])[0] < dep * 0.05, `the sand beside the toe stays up (${gap ? f2(at(b0, gap[0], gap[1])[0] * 100) : "-"} cm)`);
  // Yaw: a quarter turn left (heading +X) puts the toe at world (z, -x).
  if (toe) {
    const b90 = mk(Math.PI / 2), w = at(b90, toe[1], -toe[0])[0], o = at(b90, toe[0], toe[1])[0];
    ok(w > dep * 0.5, `turned to face +X, the toe lands ahead along +X (${f2(w * 100)} cm; its unturned spot ${f2(o * 100)} cm)`);
  }
  // Mass: berm volume about the depression's (the ring's ratio from the tile).
  let vd = 0, vb = 0;
  const h = 0.02;
  for (let z = -s.ext; z < s.ext; z += h) for (let x = -s.ext; x < s.ext; x += h) { const st = at(b0, x, z); vd += st[0]; vb += st[1]; }
  ok(Math.abs(vb / vd - 1) < 0.2, `a print keeps its mass: berm ${f2(vb * h * h * 1000)} l vs hollow ${f2(vd * h * h * 1000)} l`);
}

// --- robot feet
{
  const g = bucketGeometry();
  const s = bakeFootFromGeometry("check-bucket", g, new THREE.Vector3(), 1);
  ok(!!s, "the robot bucket bakes");
  if (s) {
    // Count separate blobs of sole (4-connected).
    const seen = new Uint8Array(TILE * TILE);
    let blobs = 0;
    for (let c = 0; c < TILE * TILE; c++) {
      if (seen[c] || s.sdf[c] >= 0) continue;
      blobs++;
      const st = [c]; seen[c] = 1;
      while (st.length) {
        const q = st.pop()!, i = q % TILE, j = (q / TILE) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj, k = jj * TILE + ii;
          if (ii < 0 || jj < 0 || ii >= TILE || jj >= TILE || seen[k] || s.sdf[k] >= 0) continue;
          seen[k] = 1; st.push(k);
        }
      }
    }
    ok(blobs === 3, `the bucket prints three claws (${blobs} marks)`);
  }
  const d = bakeDiscFoot("check-disc", 0.5);
  ok(!!d && Math.abs(d.area / (Math.PI * 0.25) - 1) < 0.15, `a disc foot's print has its area (${d ? f2(d.area) : "-"} m² vs ${f2(Math.PI * 0.25)})`);
}

console.log(fails ? `\n${fails} FAILED` : "\nall footprint checks passed");
process.exit(fails ? 1 : 0);
