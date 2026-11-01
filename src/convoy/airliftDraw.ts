// Drawing for the helipad airlift (cosmetic; the rules are airlift.ts): the helipad painted on the lead bay's deck
// (a ring and an H that glow while H is held), and the stand-in quadcopter (boxes, the same look as the extraction
// pickup's) on four ropes over the carried mech: it drops onto the deck to clamp, carries the mech out, and flies
// home climbing after the drop.
import * as THREE from "three/webgpu";
import { Kit, kitMesh } from "./kit";
import type { Airlift } from "./airlift";

const BODY = 0xd0642a, DARK = 0x3d3a35, STEEL = 0x8f8a7f, HAZARD = 0xd8a019;
const ROPE = 4;
const m4 = new THREE.Matrix4(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();

export class AirliftDraw {
  readonly group = new THREE.Group();
  private pad = new THREE.Group();
  private padMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.55, depthWrite: false });
  private copter = new THREE.Group();
  private rotors: THREE.Object3D[] = [];
  private ropes: THREE.Mesh[] = [];
  private time = 0;
  private home = new THREE.Vector2(1, 0);
  /** Where the quadcopter is drawn (for the lab line). */
  readonly copterAt = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group.name = "helipad airlift";
    scene.add(this.group);
    this.buildPad();
    this.buildCopter();
    this.group.add(this.pad, this.copter);
    this.copter.visible = false;
  }

  private buildPad() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), this.padMat);
    this.pad.add(ring);
    for (const [w, d, x] of [[0.16, 1.0, 0.3], [0.16, 1.0, -0.3], [0.6, 0.16, 0]] as const) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), this.padMat);
      b.position.x = x;
      this.pad.add(b);
    }
  }

  private buildCopter() {
    const k = new Kit();
    k.box([2.4, 1.8, 6], [0, 0, 0], BODY);
    k.box([1.8, 0.9, 1.6], [0, 0.3, 2.6], 0x1a1612);
    k.box([0.5, 0.5, 5], [0, 0.4, -5], STEEL);
    k.box([1.8, 0.2, 0.9], [0, 0.9, -7], BODY);
    k.box([9, 0.4, 0.5], [0, 1, 0], DARK);
    k.box([0.5, 0.4, 9], [0, 1, 0], DARK);
    k.box([0.4, 0.8, 4], [1.2, -1.1, 0], STEEL);
    k.box([0.4, 0.8, 4], [-1.2, -1.1, 0], STEEL);
    // The clamp frame under the belly (rides at the end of the ropes: drawn on its own below).
    kitMesh(k.build(), this.copter);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.6, transparent: true, opacity: 0.55 });
    for (const [x, z] of [[4.5, 0], [-4.5, 0], [0, 4.5], [0, -4.5]]) {
      const r = new THREE.Group();
      r.position.set(x, 1.5, z);
      const blade = new THREE.BoxGeometry(5.6, 0.06, 0.34);
      r.add(new THREE.Mesh(blade, bladeMat), new THREE.Mesh(blade, bladeMat).rotateY(Math.PI / 2));
      this.copter.add(r);
      this.rotors.push(r);
    }
    const c = new Kit();
    c.box([3.2, 0.3, 0.3], [0, -ROPE, 1.4], HAZARD);
    c.box([3.2, 0.3, 0.3], [0, -ROPE, -1.4], HAZARD);
    c.box([0.3, 0.3, 3.1], [1.5, -ROPE, 0], HAZARD);
    c.box([0.3, 0.3, 3.1], [-1.5, -ROPE, 0], HAZARD);
    kitMesh(c.build(), this.copter);
    const rope = new THREE.CylinderGeometry(0.05, 0.05, ROPE - 1, 5).translate(0, -(ROPE - 1) / 2 - 1, 0);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.7 });
    for (const [x, z] of [[1.5, 1.4], [-1.5, 1.4], [1.5, -1.4], [-1.5, -1.4]]) {
      const m = new THREE.Mesh(rope, ropeMat);
      m.position.set(x, 0, z);
      this.copter.add(m);
      this.ropes.push(m);
    }
  }

  /** Meshes for the hold-V selector. */
  objects(): THREE.Object3D[] { return [this.pad, this.copter]; }

  /** One frame. `toConvoy`: a point on the convoy (the quadcopter flies home toward it after a drop). */
  update(dt: number, lift: Airlift, toConvoy: { x: number; z: number }) {
    this.time += dt;
    const v = lift.v, p = lift.pad, on = v.heliOn >= 0.5;
    // The pad on the deck, tilted with the platform.
    this.pad.visible = on;
    if (on) {
      const l = lift.padLocal(), w = p.toWorld(l.x, p.deck + 0.04, l.z);
      this.pad.position.set(w.x, w.y, w.z);
      m4.makeBasis(va.set(p.left.x, p.left.y, p.left.z), vb.set(p.up.x, p.up.y, p.up.z), vc.set(p.fwd.x, p.fwd.y, p.fwd.z));
      this.pad.quaternion.setFromRotationMatrix(m4);
      this.pad.scale.setScalar(v.heliPadR);
      const lit = lift.state === "calling" ? 0.55 + 0.4 * lift.callShare : lift.onPad ? 0.55 + 0.2 * Math.sin(this.time * 4) : 0.3;
      this.padMat.opacity = lit;
    }
    // The quadcopter.
    const s = lift.state, a = lift.at;
    const show = lift.holding || (s === "leave" && lift.t < v.heliLeave);
    this.copter.visible = show;
    if (!show) return;
    let x = a.x, y = a.y + ROPE, z = a.z, yaw = lift.heading, pitch = 0;
    if (s === "clamp") {
      // Down out of the sky onto the mech.
      const u = Math.min(1, lift.t / Math.max(0.1, v.heliClamp)), e = 1 - (1 - u) * (1 - u) * (1 - u);
      y += 34 * (1 - e);
    } else if (s === "leave") {
      // Home toward the convoy, climbing, nose down.
      this.home.set(toConvoy.x - lift.dropAt.x, toConvoy.z - lift.dropAt.z).normalize();
      const t = lift.t, d = 4 * t * t + 6 * t;
      x = lift.dropAt.x + this.home.x * d; z = lift.dropAt.z + this.home.y * d; y = lift.dropAt.y + ROPE + 3 * t + 0.6 * t * t;
      yaw = Math.atan2(this.home.x, this.home.y); pitch = 0.2;
    } else {
      // Nose down by speed.
      const sp = Math.hypot(lift.vel.x, lift.vel.z);
      pitch = Math.min(0.3, sp * 0.012);
      if (sp > 1) yaw = Math.atan2(lift.vel.x, lift.vel.z);
    }
    this.copter.position.set(x, y, z);
    this.copter.rotation.set(pitch, yaw, 0, "YXZ");
    this.copterAt.copy(this.copter.position);
    for (let i = 0; i < this.rotors.length; i++) this.rotors[i].rotation.y = this.time * 40 * (i % 2 ? -1 : 1);
    // After the drop the cradle hangs empty; the ropes show the whole time.
    for (const r of this.ropes) r.visible = true;
  }
}
