// Stand-in look for the walker: a salvaged, patched-together hull on digitigrade legs, built from boxes so it
// costs nothing to change. Everything here only reads the sim's joints; swapping in modelled parts later means
// replacing these meshes, not the walk.
import * as THREE from "three/webgpu";
import type { WalkerSim, LegPose } from "./walker";

const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.15, flatShading: true, ...o });

export const WALKER_MATERIALS = {
  plate: mat(0xb09a72),
  rust: mat(0xb5532f, { roughness: 0.9 }),
  steel: mat(0x5c5f63, { metalness: 0.35, roughness: 0.6 }),
  joint: mat(0x3a3c40, { metalness: 0.4, roughness: 0.5 }),
  rod: mat(0xb9b6ad, { metalness: 0.8, roughness: 0.3 }),
  hazard: mat(0xd8a019),
  glass: mat(0x24160a, { emissive: 0xff8c2e, emissiveIntensity: 0.9, roughness: 0.2 }),
};

// Unit box with its origin at the bottom face, so scaling y stretches it from a joint toward the next.
const boneGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0);

function part(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, size?: [number, number, number], at?: [number, number, number], rot?: [number, number, number]) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (size) mesh.scale.set(...size);
  if (at) mesh.position.set(...at);
  if (rot) mesh.rotation.set(...rot);
  parent.add(mesh);
  return mesh;
}

const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
/** Stretch a bone mesh from a to b, its width w across `side` and depth d. */
function placeBone(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, w: number, d: number) {
  Y.subVectors(b, a);
  const len = Y.length();
  if (len < 1e-5) { m.visible = false; return; }
  m.visible = true;
  Y.divideScalar(len);
  X.copy(side).addScaledVector(Y, -side.dot(Y));
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0);
  X.normalize();
  Z.crossVectors(X, Y);
  M.makeBasis(X, Y, Z);
  m.quaternion.setFromRotationMatrix(M);
  m.position.copy(a);
  m.scale.set(w, len, d);
}

interface LegMeshes {
  thigh: THREE.Mesh; thighPlate: THREE.Mesh; knee: THREE.Mesh; shin: THREE.Mesh; hock: THREE.Mesh; cannon: THREE.Mesh;
  sleeve: THREE.Mesh; rod: THREE.Mesh; hipJoint: THREE.Mesh; foot: THREE.Group; toe: THREE.Group;
}

export class WalkerBody {
  readonly root = new THREE.Group();
  private hull = new THREE.Group();
  private pelvisMesh: THREE.Mesh;
  private legs: LegMeshes[];

  constructor() {
    const W = WALKER_MATERIALS;
    this.root.name = "walker";
    this.root.add(this.hull);
    this.pelvisMesh = part(boxGeo, W.steel, this.root);

    // Hull: a boxy cab on the hips, armour patched over it, exhaust stacks and a salvage rack behind.
    const h = this.hull;
    part(boxGeo, W.plate, h, [2.2, 1.35, 2.0], [0, 0.95, 0]);
    part(boxGeo, W.plate, h, [2.0, 0.7, 0.9], [0, 0.55, 1.15], [-0.6, 0, 0]); // sloped glacis
    part(boxGeo, W.glass, h, [1.6, 0.24, 0.08], [0, 1.36, 1.01]); // cab window
    part(boxGeo, W.rust, h, [2.35, 0.14, 2.15], [0, 1.68, -0.05], [0.04, 0, 0]); // roof plate
    part(boxGeo, W.rust, h, [0.12, 1.0, 1.6], [1.16, 0.9, 0.05], [0, 0, 0.06]); // side armour
    part(boxGeo, W.plate, h, [0.12, 0.9, 1.4], [-1.16, 0.85, -0.05], [0, 0, -0.05]);
    part(boxGeo, W.hazard, h, [0.5, 0.12, 0.05], [0.62, 0.3, 1.55], [-0.6, 0, 0]);
    part(boxGeo, W.steel, h, [1.9, 0.9, 0.7], [0, 1.05, -1.3]); // rack box
    part(boxGeo, W.rust, h, [0.7, 0.5, 0.6], [0.5, 1.7, -1.35]); // strapped-on crate
    for (const sx of [0.75, -0.75]) {
      part(cylGeo, W.joint, h, [0.24, 1.5, 0.24], [sx, 1.2, -1.72]); // exhaust stacks
      part(cylGeo, W.rust, h, [0.3, 0.12, 0.3], [sx, 2.62, -1.72]);
    }
    part(cylGeo, W.joint, h, [0.04, 1.6, 0.04], [-0.9, 1.75, -0.6]); // antenna
    part(boxGeo, W.joint, h, [0.36, 0.3, 0.3], [-0.55, 1.88, 0.85]); // searchlight
    part(boxGeo, W.glass, h, [0.26, 0.2, 0.04], [-0.55, 1.88, 1.01]);

    this.legs = [0, 1].map(() => {
      const foot = new THREE.Group();
      part(boneGeo, W.steel, foot, [0.78, 0.22, 0.9], [0, 0, 0.05]); // sole plate
      part(boxGeo, W.plate, foot, [0.66, 0.12, 0.7], [0, 0.28, 0.0]);
      // Front toes on a hinge at the ball of the foot (positioned from the tuning each frame).
      const toe = new THREE.Group();
      foot.add(toe);
      for (const sx of [0.2, -0.2]) part(boxGeo, W.steel, toe, [0.24, 0.18, 0.5], [sx, 0.09, 0.22], [0, sx * 0.6, 0]);
      part(boxGeo, W.steel, foot, [0.2, 0.16, 0.45], [0, 0.08, -0.55]); // back spur
      this.root.add(foot);
      const leg: LegMeshes = {
        hipJoint: part(boxGeo, W.joint, this.root, [0.55, 0.55, 0.55]),
        thigh: part(boneGeo, W.plate, this.root),
        thighPlate: part(boneGeo, W.rust, this.root),
        knee: part(boxGeo, W.joint, this.root, [0.5, 0.5, 0.5]),
        shin: part(boneGeo, W.steel, this.root),
        hock: part(boxGeo, W.joint, this.root, [0.36, 0.36, 0.36]),
        cannon: part(boneGeo, W.plate, this.root),
        sleeve: part(cylGeo, W.joint, this.root),
        rod: part(cylGeo, W.rod, this.root),
        foot, toe,
      };
      return leg;
    });
  }

  update(sim: WalkerSim) {
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.pelvisQ);
    this.hull.position.copy(sim.pelvis);
    this.hull.quaternion.copy(sim.hullQ);
    const hw = sim.v.hipWidth;
    this.pelvisMesh.position.copy(sim.pelvis);
    this.pelvisMesh.quaternion.copy(sim.pelvisQ);
    this.pelvisMesh.scale.set(hw * 2 + 0.3, 0.45, 0.8);
    sim.feet.forEach((f, i) => this.pose(this.legs[i], f.pose, left));
  }

  private pose(L: LegMeshes, P: LegPose, side: THREE.Vector3) {
    L.hipJoint.position.copy(P.hip);
    L.knee.position.copy(P.knee);
    L.hock.position.copy(P.hock);
    placeBone(L.thigh, P.hip, P.knee, side, 0.5, 0.62);
    // Armour on the front of the thigh.
    const front = new THREE.Vector3().subVectors(P.knee, P.hip).cross(side).normalize();
    const a = P.hip.clone().addScaledVector(front, 0.3), b = P.knee.clone().lerp(P.hip, 0.15).addScaledVector(front, 0.3);
    placeBone(L.thighPlate, a, b, side, 0.58, 0.12);
    placeBone(L.shin, P.knee, P.hock, side, 0.36, 0.42);
    placeBone(L.cannon, P.hock, P.ankle, side, 0.28, 0.34);
    // Hydraulic ram behind the knee: thigh to shin.
    const back = front.clone().negate();
    const s0 = P.hip.clone().lerp(P.knee, 0.3).addScaledVector(back, 0.35);
    const s1 = P.knee.clone().lerp(P.hock, 0.5).addScaledVector(back, 0.22);
    const mid = s0.clone().lerp(s1, 0.55);
    placeBone(L.sleeve, s0, mid, side, 0.2, 0.2);
    placeBone(L.rod, mid.clone().lerp(s0, 0.15), s1, side, 0.1, 0.1);
    L.foot.position.copy(P.foot);
    L.foot.quaternion.copy(P.footQ);
    L.toe.position.set(0, 0, P.toeHinge.distanceTo(P.foot));
    L.toe.quaternion.copy(P.footQ).invert().multiply(P.toeQ);
  }
}
