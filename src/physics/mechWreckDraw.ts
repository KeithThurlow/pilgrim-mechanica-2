// Draws a mech's wreck with its own model: each pivot of the model (pelvis, hull, leg bones, feet) rides the ragdoll part
// that holds it, keeping where it sat on that part at the moment of death. Cosmetic.
import * as THREE from "three/webgpu";
import type { Dead } from "./deaths";

export class MechWreckRig {
  private binds: { obj: THREE.Object3D; part: number; p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  private pq = new THREE.Quaternion();
  private pp = new THREE.Vector3();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();

  /** Bind each object to its part as both stand now (the parts' poses from the death physics, the objects' world). */
  constructor(objs: { obj: THREE.Object3D; part: number }[], private d: Dead) {
    for (const { obj, part } of objs) {
      obj.updateWorldMatrix(true, false);
      const wp = obj.getWorldPosition(new THREE.Vector3()), wq = obj.getWorldQuaternion(new THREE.Quaternion());
      const inv = d.quat[part].clone().invert();
      this.binds.push({ obj, part, p: wp.sub(d.pos[part]).applyQuaternion(inv), q: inv.multiply(wq) });
    }
  }

  /** Pose the model from the parts (their live pose, or the pose they froze in). */
  apply() {
    const d = this.d;
    for (const b of this.binds) {
      const P = d.pos[b.part], Q = d.quat[b.part];
      const wp = this.v.copy(b.p).applyQuaternion(Q).add(P), wq = this.q.copy(Q).multiply(b.q);
      const parent = b.obj.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parent.getWorldPosition(this.pp); parent.getWorldQuaternion(this.pq).invert();
        wp.sub(this.pp).applyQuaternion(this.pq);
        wq.premultiply(this.pq);
      }
      b.obj.position.copy(wp);
      b.obj.quaternion.copy(wq);
    }
  }
}
