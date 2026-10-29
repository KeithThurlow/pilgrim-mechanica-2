// Steel wreck stand-ins: a few blocky hulks sat on the dunes, for testing what rounds do to metal (sparks) against
// sand. Boxes until real wrecks are modelled; they only need to be steel and in the way.
import * as THREE from "three/webgpu";
import type { Ground } from "../mech/walker";

export class WreckStandIns {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  private ray = new THREE.Raycaster();

  constructor(ground: Ground, spots: { x: number; z: number; yaw: number; kind: "hulk" | "plate" | "tank"; scale?: number; sink?: number }[]) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8178, metalness: 0.35, roughness: 0.55, flatShading: true });
    const rust = new THREE.MeshStandardMaterial({ color: 0x7a4a2e, metalness: 0.3, roughness: 0.8, flatShading: true });
    for (const s of spots) {
      const g = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m); this.meshes.push(m);
      };
      if (s.kind === "hulk") {
        add(new THREE.BoxGeometry(3.2, 1.6, 5), steel, 0, 0.5, 0, 0.08, 0.12);
        add(new THREE.BoxGeometry(2.2, 1.1, 2), rust, 0.2, 1.6, -0.6, 0.1, 0.2);
      } else if (s.kind === "plate") {
        add(new THREE.BoxGeometry(4, 2.6, 0.25), steel, 0, 0.9, 0, 0.35, -0.1);
      } else {
        add(new THREE.CylinderGeometry(1.1, 1.1, 4.5, 8).rotateZ(Math.PI / 2), rust, 0, 0.7, 0, 0, 0.1);
      }
      // Sit on the dunes, partly buried.
      g.position.set(s.x, ground.height(s.x, s.z) - (s.sink ?? 0.2), s.z);
      g.rotation.y = s.yaw;
      g.scale.setScalar(s.scale ?? 1);
      this.group.add(g);
    }
    this.group.updateMatrixWorld(true);
  }

  /** Nearest steel struck along a ray within maxDist: the point and its world face normal, or null. */
  hit(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, at: THREE.Vector3, normal: THREE.Vector3) {
    this.ray.set(from, dir);
    this.ray.far = maxDist;
    const h = this.ray.intersectObjects(this.meshes, false)[0];
    if (!h || !h.face) return false;
    at.copy(h.point);
    normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    if (normal.dot(dir) > 0) normal.negate();
    return true;
  }
}
