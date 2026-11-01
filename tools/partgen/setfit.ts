// Bake a fit from the parts lab into a generated part: every level of detail (<id>.glb, -lod1, -lod2) and its
// sockets are moved, turned and scaled the way the lab's Fit sliders showed it on its mount, so the game needs no
// offsets. The lab's "Copy fit" button gives the command:
//   npx tsx tools/partgen/setfit.ts <id> across,up,forward,yaw,pitch,roll,scale
// (metres and degrees; "across" is outward on the right side, i.e. -X; turns in the order yaw, pitch, roll).
// The sidecar keeps every fit applied. Reset the lab's sliders after baking.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { readGlb, writeGlb } from "./glb";
import { loadKinds } from "./kinds";
import { normals } from "./prep";

const [id, spec] = process.argv.slice(2);
if (!id || !spec) throw new Error("usage: setfit.ts <id> across,up,forward,yaw,pitch,roll,scale");
const [ax, up, fw, yaw, pitch, roll, scale] = spec.split(",").map(Number);
if ([ax, up, fw, yaw, pitch, roll, scale].some((v) => !Number.isFinite(v))) throw new Error("setfit: seven numbers needed");
const dir = "public/models/gen";
const side = JSON.parse(readFileSync(`${dir}/${id}.json`, "utf8"));
const kind = loadKinds()[side.kind];
if (!kind) throw new Error(`setfit: unknown kind ${side.kind}`);

const D = Math.PI / 180;
const m = new THREE.Matrix4().compose(
  new THREE.Vector3(-ax, up, fw),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, yaw * D, roll * D, "YXZ")),
  new THREE.Vector3(scale, scale, scale),
);
const v = new THREE.Vector3();
const rot = new THREE.Matrix3().getNormalMatrix(m);
const turnNormals = (n: Float32Array) => { for (let i = 0; i < n.length; i += 3) { v.fromArray(n, i).applyMatrix3(rot).normalize(); v.toArray(n, i); } return n; };
const move = (p: Float32Array) => { for (let i = 0; i < p.length; i += 3) { v.fromArray(p, i).applyMatrix4(m); v.toArray(p, i); } };

for (const f of [`${id}.glb`, `${id}-lod1.glb`, `${id}-lod2.glb`]) {
  const path = `${dir}/${f}`;
  if (!existsSync(path)) continue;
  const g = readGlb(new Uint8Array(readFileSync(path)));
  const parts = g.meshes.map((mesh) => {
    move(mesh.pos);
    // A textured part (lane B) keeps its UVs, maps and its own normals, turned with the fit.
    const nrm = mesh.nrm ? turnNormals(mesh.nrm) : normals(mesh.pos, mesh.index);
    return { name: mesh.name, pos: mesh.pos, nrm, col: mesh.col ?? new Float32Array(mesh.pos.length).fill(1), index: mesh.index, material: kind.material, uv: mesh.maps ? mesh.uv : undefined, maps: mesh.maps };
  });
  const empties = [...g.empties].map(([n, p]) => { v.set(...p).applyMatrix4(m); return [n, [v.x, v.y, v.z]] as [string, [number, number, number]]; });
  writeFileSync(path, writeGlb(parts, empties, { kind: kind.id, lane: side.lane }));
  console.log(`${path}: fitted`);
}
side.fit = [...(side.fit ?? []), { across: ax, up, forward: fw, yaw, pitch, roll, scale, at: new Date().toISOString() }];
writeFileSync(`${dir}/${id}.json`, JSON.stringify(side, null, 2) + "\n");
