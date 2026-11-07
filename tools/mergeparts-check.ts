// Merged weapon parts (src/weapons/weaponModel.ts planFor, src/look/mergeGeometry.ts): what must never happen.
// Every weapon (code-built or GLB), merged, must draw exactly the triangles the parts drew one by one, in the same places,
// at rest and posed (every hinge and slide at full travel, the barrels spun, a missile fired and hidden): same vertex
// count, same sums of positions. And the merge must actually save objects (the missile pod at rest: a few meshes).
import { readFileSync, existsSync } from "node:fs";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { defFromGlb, readSidecar } from "../src/weapons/parts";
import { CATALOG } from "../src/weapons/catalog";
import { WeaponModel } from "../src/weapons/weaponModel";
import type { WeaponLook } from "../src/weapons/weaponLook";
import type { ModelDef } from "../src/weapons/parts";

let fails = 0;
const fail = (m: string) => { fails++; console.log("FAIL " + m); };
const look = { v: { weaponScheme: 0 }, apply() {}, release() {} } as unknown as WeaponLook;

/** The old way: a pivot and a motion group per part, each with its own mesh. */
function reference(def: ModelDef) {
  const root = new THREE.Group(), parts: Record<string, THREE.Group> = {}, pivots: Record<string, THREE.Vector3> = {};
  for (const p of def.parts) {
    const pivot = new THREE.Group(), motion = new THREE.Group();
    const host = p.parent ? parts[p.parent] : undefined;
    pivot.position.copy(p.pivot).sub(host && p.parent ? pivots[p.parent] : new THREE.Vector3());
    pivots[p.name] = p.pivot;
    motion.add(new THREE.Mesh(p.geometry));
    pivot.add(motion);
    (host ?? root).add(pivot);
    parts[p.name] = motion;
  }
  return { root, parts };
}

/** Vertex count and position sums of every mesh that draws (visible all the way up). */
function drawn(root: THREE.Object3D, skip?: THREE.Object3D | null) {
  root.updateMatrixWorld(true);
  let n = 0, meshes = 0;
  const s = [0, 0, 0, 0], v = new THREE.Vector3();
  const walk = (o: THREE.Object3D) => {
    if (!o.visible || o === skip) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      meshes++;
      const P = m.geometry.attributes.position, idx = m.geometry.index;
      const count = idx ? idx.count : P.count;
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(P, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
        n++; s[0] += v.x; s[1] += v.y; s[2] += v.z; s[3] += v.lengthSq();
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return { n, s, meshes };
}

const D2R = Math.PI / 180, AX = new THREE.Vector3();
function pose(parts: Record<string, THREE.Group>, def: ModelDef, mode: "rest" | "full") {
  for (const m of def.moving) {
    const p = parts[m.node];
    if (!p) continue;
    const k = mode === "rest" ? 0 : m.kind === "spin" ? 1.1 : 1;
    const a = m.axis;
    if (m.kind === "spin") p.quaternion.setFromAxisAngle(AX.set(...(a ?? [0, 0, 1])).normalize(), k);
    else if (m.kind === "hinge") p.quaternion.setFromAxisAngle(AX.set(...(a ?? [1, 0, 0])).normalize(), (m.angleDeg ?? 0) * D2R * k);
    else p.position.copy(AX.set(...(a ?? [0, 0, -1])).normalize().multiplyScalar((m.travel ?? 0) * k));
  }
  if (parts.Missile_0) parts.Missile_0.visible = mode === "rest";
}

// The code-built weapons and the GLBs (as armoury-check loads them).
const loader = new GLTFLoader();
async function defOf(e: (typeof CATALOG)[number]): Promise<ModelDef | null> {
  if (e.build) return e.build(e.side === "left" ? 1 : -1);
  const path = `public/models/weapons/${e.id}.glb`;
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
  const side = existsSync(path.replace(".glb", ".json")) ? readSidecar(JSON.parse(readFileSync(path.replace(".glb", ".json"), "utf8"))) : { moving: [] };
  return defFromGlb(gltf.scene, side.moving, e.heat);
}

let checked = 0, partsBefore = 0, meshesAfter = 0;
for (const e of CATALOG) {
  const def = await defOf(e);
  if (!def) continue;
  const w = new WeaponModel(e, def, look), ref = reference(def);
  w.root.scale.setScalar(1);
  for (const mode of ["rest", "full", "rest"] as const) {
    pose(w.parts, def, mode);
    pose(ref.parts, def, mode);
    const a = drawn(w.root, w.laser?.group), b = drawn(ref.root);
    const off = Math.max(...a.s.map((x, i) => Math.abs(x - b.s[i]) / Math.max(1, Math.abs(b.s[i]))));
    if (a.n !== b.n || off > 1e-4) fail(`${e.id} ${mode}: merged draws ${a.n} vertices (sums off by ${off.toExponential(1)}), parts one by one ${b.n}`);
    if (mode === "rest" && a.meshes > b.meshes) fail(`${e.id}: merged draws more meshes at rest (${a.meshes}) than parts (${b.meshes})`);
    if (mode === "rest") { partsBefore += b.meshes; meshesAfter += a.meshes; }
    if (e.id.startsWith("missile-pod-h") && mode === "rest" && a.meshes > 4) fail(`missile pod at rest draws ${a.meshes} meshes`);
  }
  checked++;
}
console.log(`${checked} weapons: at rest ${partsBefore / 2} part meshes drawn as ${meshesAfter / 2}`);
if (!checked) fail("no weapons found");
if (fails) { console.log(`${fails} failures`); process.exit(1); }
console.log("mergeparts-check: ok");
