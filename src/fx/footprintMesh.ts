// Triangles for a footprint bake (src/fx/footprint.ts) from three.js geometry: a foot model's geometry, or every mesh
// under a foot group. The asset step for legs: whoever builds a leg's foot calls one of these once, at load.
import * as THREE from "three/webgpu";
import { bakeFootShape, type FootShape } from "./footprint";

/** A geometry's triangles as a flat xyz list, moved by `m` (into the foot frame). */
export function geometryTris(g: THREE.BufferGeometry, m?: THREE.Matrix4): Float32Array {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out = new Float32Array(Math.floor(n / 3) * 9);
  const v = new THREE.Vector3();
  for (let k = 0; k < Math.floor(n / 3) * 3; k++) {
    v.fromBufferAttribute(pos, idx ? idx.getX(k) : k);
    if (m) v.applyMatrix4(m);
    out[k * 3] = v.x; out[k * 3 + 1] = v.y; out[k * 3 + 2] = v.z;
  }
  return out;
}

/**
 * Bake a print from a foot model's geometry in rest space: `at` is the foot point on the ground (the frame's origin),
 * `scale` sizes it (a model built small and scaled up). The foot must face +Z in rest space.
 */
export function bakeFootFromGeometry(key: string, g: THREE.BufferGeometry, at: THREE.Vector3, scale = 1, contact?: number): FootShape | null {
  const m = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z));
  return bakeFootShape(key, geometryTris(g, m), contact);
}

/**
 * Bake a print from every mesh under a foot group, in the group's own frame (its origin the foot point, +Z its toes),
 * times `scale`. For feet built in code (the strider's drum and peg).
 */
export function bakeFootFromObject(key: string, foot: THREE.Object3D, scale = 1, contact?: number): FootShape | null {
  foot.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(foot.matrixWorld).invert();
  const sc = new THREE.Matrix4().makeScale(scale, scale, scale);
  const parts: Float32Array[] = [];
  foot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    parts.push(geometryTris(mesh.geometry, sc.clone().multiply(inv).multiply(mesh.matrixWorld)));
  });
  const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return bakeFootShape(key, all, contact);
}
