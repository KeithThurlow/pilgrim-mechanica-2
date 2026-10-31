// Mech part looks (Keith 2026-10-31: the mech changes as legs and hulls are fitted). Every look a part can show
// (src/items/item.ts AVAILABLE_LOOKS) must have its model with the parts and joints src/mech/rampart.ts swaps in:
// - legs: Part_Pelvis, Thigh/Shin/Cannon/Foot meshes per side, the Thigh/Shin/Cannon/Foot joint empties;
// - hull: Part_Torso, the Waist and both UpperArm empties (and Thigh_L, which sets the hull's height over the hips);
// - legs whose look is a variant: their LEG_TYPES bone lengths match the model's markers (the walker fits the parts).
import { readFileSync, existsSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AVAILABLE_LOOKS } from "../src/items/item";
import { LEG_TYPES } from "../src/mech/legTypes";
import { BASES } from "../src/items/bases";

let fails = 0;
const must = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log("FAIL", msg); } };

type Node = { name?: string; mesh?: number };
function glb(file: string): Node[] {
  const b = readFileSync(file), len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString()).nodes as Node[];
}
/** World positions of the model's nodes (its own transforms, parsed by three's loader). */
async function positions(file: string) {
  const b = readFileSync(file);
  const g = await new Promise<{ scene: THREE.Object3D }>((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer, "", res, rej));
  g.scene.updateMatrixWorld(true);
  const out: Record<string, THREE.Vector3> = {};
  g.scene.traverse((o) => { out[o.name] = o.getWorldPosition(new THREE.Vector3()); });
  return out;
}

const legLooks = new Set(BASES.filter((b) => b.kind === "legs").map((b) => b.look));
const hullLooks = new Set(BASES.filter((b) => b.kind === "hull").map((b) => b.look));
for (const look of AVAILABLE_LOOKS) {
  const file = `public/models/${look === "rampart" ? "rampart.glb" : `mechs/${look}.glb`}`;
  if (!existsSync(file)) { must(false, `${look}: no model at ${file}`); continue; }
  const nodes = glb(file);
  const meshes = new Set(nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
  const empties = new Set(nodes.filter((n) => n.mesh === undefined).map((n) => n.name));
  const need = (set: Set<string | undefined>, names: string[], what: string) => { for (const n of names) must(set.has(n), `${look}: no ${what} ${n}`); };
  const sides = (names: string[]) => names.flatMap((n) => [`${n}_L`, `${n}_R`]);
  if (legLooks.has(look) || look === "rampart") {
    need(meshes, ["Part_Pelvis", ...sides(["Part_Thigh", "Part_Shin", "Part_Cannon", "Part_Foot"])], "mesh");
    need(empties, sides(["Thigh", "Shin", "Cannon", "Foot"]), "joint");
    const t = LEG_TYPES[look];
    if (t && look !== "rampart") {
      const p = await positions(file), d = (a: string, b: string) => p[a].distanceTo(p[b]);
      const near = (x: number, y: number | undefined) => y !== undefined && Math.abs(x - y) < 0.01;
      must(near(d("Thigh_L", "Shin_L"), t.values.femur), `${look}: femur ${d("Thigh_L", "Shin_L").toFixed(3)} vs LEG_TYPES ${t.values.femur}`);
      must(near(d("Shin_L", "Cannon_L"), t.values.shin), `${look}: shin ${d("Shin_L", "Cannon_L").toFixed(3)} vs LEG_TYPES ${t.values.shin}`);
      must(near(d("Cannon_L", "Foot_L"), t.values.cannon), `${look}: cannon ${d("Cannon_L", "Foot_L").toFixed(3)} vs LEG_TYPES ${t.values.cannon}`);
      must(near(p.Thigh_L.y, t.values.hipHeight), `${look}: hip height ${p.Thigh_L.y.toFixed(3)} vs LEG_TYPES ${t.values.hipHeight}`);
    }
  }
  if (hullLooks.has(look) || look === "rampart") {
    need(meshes, ["Part_Torso"], "mesh");
    need(empties, ["Waist", "UpperArm_L", "UpperArm_R", "Thigh_L"], "joint");
  }
  console.log(`${look}: ${meshes.size} meshes, ${empties.size} empties`);
}
if (fails) { console.log(`mechlooks-check: ${fails} failures`); process.exit(1); }
console.log("mechlooks-check: ok");
