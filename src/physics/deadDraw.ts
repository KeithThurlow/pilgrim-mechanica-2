// Draws the death physics' ragdolls: one instanced box per part, posed from the physics (or the frozen pose), sunk
// into the sand at the end of the body's life. Vehicle wrecks are drawn by their own bodies.
import * as THREE from "three/webgpu";
import type { DeathPhysics } from "./deaths";

const MAX_PARTS = 4000;

export class DeadDraw {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private phys: DeathPhysics) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX_PARTS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTS * 3), 3);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  update() {
    let n = 0;
    for (const d of this.phys.dead) {
      if (d.kind !== "ragdoll") continue;
      for (let i = 0; i < d.parts.length && n < MAX_PARTS; i++, n++) {
        const h = d.parts[i].half;
        this.p.copy(d.pos[i]).setY(d.pos[i].y - d.sink);
        this.m.compose(this.p, d.quat[i], this.s.set(h[0] * 2, h[1] * 2, h[2] * 2));
        this.mesh.setMatrixAt(n, this.m);
        this.mesh.setColorAt(n, this.c.setHex(d.parts[i].color));
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
