// Shared stand-in drawing kit for the convoy: collects vertex-coloured boxes, cylinders and other shapes in one frame
// and merges them into one geometry (one draw call per part that moves on its own).
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type V3 = [number, number, number];

/** Plain lit paint over vertex colours; no environment map, so no metalness (it only darkens). */
export const KIT_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });

const Y = new THREE.Vector3(0, 1, 0);

export class Kit {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();
  private va = new THREE.Vector3();
  private vb = new THREE.Vector3();

  get empty() { return this.parts.length === 0; }

  box(size: V3, at: V3, color: number, rot: V3 = [0, 0, 0]) { return this.add(new THREE.BoxGeometry(...size), at, rot, color); }
  /** Cylinder along its local y; `rot` turns it. */
  cyl(r: number, len: number, at: V3, color: number, rot: V3 = [0, 0, 0], seg = 10) { return this.add(new THREE.CylinderGeometry(r, r, len, seg), at, rot, color); }
  /** A cylinder from a to b. */
  between(a: V3, b: V3, r: number, color: number, seg = 6) {
    this.va.set(...a); this.vb.set(...b);
    const d = this.vb.clone().sub(this.va), L = d.length();
    if (L < 1e-4) return this;
    const g = new THREE.CylinderGeometry(r, r, L, seg, 1, false);
    this.q.setFromUnitVectors(Y, d.divideScalar(L));
    this.m.compose(this.va.add(this.vb).multiplyScalar(0.5), this.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    return this.push(g, color);
  }
  /** A box with its local axes given (x across, y up, z along), centred at `at`. */
  oriented(size: V3, at: V3, ax: THREE.Vector3, ay: THREE.Vector3, az: THREE.Vector3, color: number) {
    const g = new THREE.BoxGeometry(...size);
    this.m.makeBasis(ax, ay, az).setPosition(...at);
    g.applyMatrix4(this.m);
    return this.push(g, color);
  }
  /** Any geometry, moved by a matrix. */
  geo(g: THREE.BufferGeometry, color: number, matrix?: THREE.Matrix4) {
    if (matrix) g.applyMatrix4(matrix);
    return this.push(g, color);
  }
  private add(g: THREE.BufferGeometry, at: V3, rot: V3, color: number) {
    this.q.setFromEuler(this.e.set(...rot));
    this.m.compose(new THREE.Vector3(...at), this.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    return this.push(g, color);
  }
  private push(g: THREE.BufferGeometry, color: number) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    const n = ng.getAttribute("position").count, col = new Float32Array(n * 3);
    this.c.setHex(color);
    for (let i = 0; i < n; i++) { col[i * 3] = this.c.r; col[i * 3 + 1] = this.c.g; col[i * 3 + 2] = this.c.b; }
    ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // Merging needs matching attributes: positions, normals and colours only.
    for (const k of Object.keys(ng.attributes)) if (k !== "position" && k !== "normal" && k !== "color") ng.deleteAttribute(k);
    if (!ng.getAttribute("normal")) ng.computeVertexNormals();
    ng.clearGroups();
    this.parts.push(ng);
    return this;
  }
  build() {
    const g = this.parts.length ? mergeGeometries(this.parts, false)! : new THREE.BufferGeometry();
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return g;
  }
}

export function kitMesh(g: THREE.BufferGeometry, parent: THREE.Object3D, mat: THREE.Material = KIT_MAT) {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
