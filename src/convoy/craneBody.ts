// Stand-in look for the bay's crane: the turret rides the platform, the jib, rope and cradle are placed in the world
// from the crane sim each frame.
import * as THREE from "three/webgpu";
import type { Crane } from "./crane";
import { Kit, kitMesh } from "./kit";
import { PAL } from "./furniture";
import type { PlatformBody } from "./platformBody";

const ROPE = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.6, metalness: 0.4 });
const DOWN = new THREE.Vector3(0, -1, 0);

/** The crane: turret on the platform, jib, rope and cradle placed in the world. */
export class CraneBody {
  readonly group = new THREE.Group();
  private turret = new THREE.Group();
  private jib: THREE.Mesh;
  private rope: THREE.Mesh;
  private cradle: THREE.Mesh;
  private mast: THREE.Mesh;
  private jibLen = -1;
  private e = new THREE.Euler();
  private dir = new THREE.Vector3();
  private lean = new THREE.Quaternion();
  private yaw = new THREE.Quaternion();

  constructor(readonly crane: Crane, private platformBody: PlatformBody) {
    const t = new Kit();
    // Turret: a cab and a counterweight on the slewing ring.
    t.box([3, 2.4, 4.4], [0, 0.4, -1], PAL.ochre);
    t.box([2.6, 0.7, 0.1], [0, 0.9, 1.25], PAL.glass);
    t.box([3.4, 1.6, 1.8], [0, 0.2, -3.6], PAL.dark);
    t.box([0.6, 1, 1], [1.1, 1.5, 0], PAL.steel);
    t.box([0.6, 1, 1], [-1.1, 1.5, 0], PAL.steel);
    kitMesh(t.build(), this.turret);
    this.mast = kitMesh(new THREE.CylinderGeometry(0.9, 1.1, 1, 12).translate(0, 0.5, 0), platformBody.root);
    this.platformBody.root.add(this.turret);

    this.jib = kitMesh(new THREE.BufferGeometry(), this.group);
    const rg = new THREE.CylinderGeometry(0.12, 0.12, 1, 6).translate(0, -0.5, 0);
    this.rope = kitMesh(rg, this.group, ROPE);
    this.rope.castShadow = false;
    // Cradle: a yoke with two arms that hook under the hull.
    const c = new Kit();
    c.box([3.6, 0.5, 0.8], [0, 0, 0], PAL.hazard);
    c.box([0.5, 0.5, 0.5], [0, 0.4, 0], PAL.dark);
    for (const sx of [1, -1]) {
      c.box([0.35, 2.2, 0.6], [sx * 1.7, -1.1, 0], PAL.hazard);
      c.box([0.9, 0.3, 0.6], [sx * 1.35, -2.2, 0], PAL.dark);
    }
    this.cradle = kitMesh(c.build(), this.group);
    this.group.name = "crane";
  }

  meshes(): THREE.Object3D[] { return [this.group, this.turret, this.mast]; }

  update() {
    const cr = this.crane, v = cr.v, p = cr.platform, D = p.deck;
    if (v.craneJib !== this.jibLen) {
      this.jibLen = v.craneJib;
      const k = new Kit();
      const L = v.craneJib;
      // A lattice-ish jib: two chords and a top chord, cross plates, and a sheave at the tip.
      // Chunky enough to read from the 40 m game camera; a dark band every few metres reads as lattice.
      for (const sx of [1, -1]) k.box([0.45, 0.45, L], [sx * 0.75, 0, L / 2], PAL.ochre);
      k.box([0.45, 0.45, L], [0, 1.1, L / 2], PAL.ochre);
      for (let z = 1.2; z < L - 0.5; z += 2.4) {
        k.box([1.9, 0.25, 0.25], [0, 0.05, z], PAL.dark);
        for (const sx of [1, -1]) k.box([0.2, 1.3, 0.2], [sx * 0.4, 0.55, z + 1.2], PAL.ochre, [0, 0, sx * 0.55]);
      }
      k.cyl(0.6, 1.8, [0, 0.3, L], PAL.dark, [0, 0, Math.PI / 2], 10);
      this.jib.geometry.dispose();
      this.jib.geometry = k.build();
    }
    this.mast.position.set(0, D, this.crane.mount);
    this.mast.scale.set(1, v.craneMast, 1);
    this.turret.position.set(0, D + v.craneMast, this.crane.mount);
    this.turret.rotation.set(0, cr.slew, 0);
    this.jib.position.set(cr.base.x, cr.base.y, cr.base.z);
    this.jib.quaternion.setFromEuler(this.e.set(-cr.luff, p.heading + cr.slew, 0, "YXZ"));
    // Rope from the tip to the swinging cradle; the cradle hangs in line with it.
    this.rope.position.set(cr.tip.x, cr.tip.y, cr.tip.z);
    this.dir.set(cr.cradle.x - cr.tip.x, cr.cradle.y - cr.tip.y, cr.cradle.z - cr.tip.z);
    const len = Math.max(0.1, this.dir.length());
    this.lean.setFromUnitVectors(DOWN, this.dir.divideScalar(len));
    this.rope.quaternion.copy(this.lean);
    this.rope.scale.set(1, len, 1);
    this.cradle.position.set(cr.cradle.x, cr.cradle.y, cr.cradle.z);
    // Arms either side of a carried mech (which is turned to face along the platform).
    this.cradle.quaternion.copy(this.lean).multiply(this.yaw.setFromEuler(this.e.set(0, p.heading, 0)));
  }
}
