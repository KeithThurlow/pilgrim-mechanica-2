// Stand-in look for the convoy's turrets (defence.ts): a sponson bracket and pedestal at each cut corner, a turret
// housing that slews on it and twin barrels that elevate; the heavy one on a mech bay's cab roof is bigger with one
// long barrel. One mesh per moving part per turret; built again when the turret list changes.
import * as THREE from "three/webgpu";
import { Kit, kitMesh, KIT_MAT } from "./kit";
import { PAL } from "./furniture";
import { TWIN_UP, type Defence, type Turret } from "./defence";

/** Their own material, so hold-V lights the turrets apart from the platforms. */
export const TURRET_MAT = KIT_MAT.clone();

interface Rig { t: Turret; root: THREE.Group; yaw: THREE.Mesh; pitch: THREE.Mesh }

export class DefenceBody {
  readonly group = new THREE.Group();
  private rigs: Rig[] = [];
  private m = new THREE.Matrix4();
  private bx = new THREE.Vector3(); private by = new THREE.Vector3(); private bz = new THREE.Vector3();

  constructor(readonly defence: Defence) { this.group.name = "turrets"; }

  objects(): THREE.Object3D[] { return this.rigs.map((r) => r.root); }

  private build() {
    for (const r of this.rigs) { this.group.remove(r.root); r.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
    this.rigs = [];
    for (const t of this.defence.turrets) {
      const heavy = t.kind === "heavy";
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      // Static: the bracket from the deck edge out to the pedestal (twin) or a ring on the cab roof (heavy).
      const base = new Kit();
      if (heavy) base.cyl(1.1, 0.4, [0, -0.5, 0], PAL.dark, [0, 0, 0], 12);
      else {
        const drop = TWIN_UP;
        base.cyl(0.42, drop, [0, -drop / 2 - 0.15, 0], PAL.steel, [0, 0, 0], 10);
        base.box([1.3, 0.35, 1.3], [0, -drop + 0.2, 0], PAL.dark);
      }
      kitMesh(base.build(), root, TURRET_MAT);
      // Slewing housing.
      const hk = new Kit();
      if (heavy) {
        hk.box([2.2, 1.1, 2.6], [0, 0.2, -0.2], 0x6f6a5c);
        hk.box([1.6, 0.25, 1.8], [0, 0.85, -0.4], PAL.dark);
      } else {
        hk.box([1.2, 0.7, 1.3], [0, 0.1, -0.1], 0x6f6a5c);
        hk.box([0.5, 0.3, 0.5], [0.35, 0.55, -0.3], PAL.dark);
      }
      const yaw = kitMesh(hk.build(), root, TURRET_MAT);
      // Elevating barrels (along +z).
      const bk = new Kit();
      if (heavy) {
        bk.box([0.8, 0.7, 1.2], [0, 0, 0.6], PAL.dark);
        bk.cyl(0.18, 4.2, [0, 0, 2.6], PAL.steel, [Math.PI / 2, 0, 0], 8);
        bk.cyl(0.3, 0.6, [0, 0, 4.6], PAL.dark, [Math.PI / 2, 0, 0], 8);
      } else {
        bk.box([0.7, 0.4, 0.6], [0, 0, 0.3], PAL.dark);
        for (const sx of [1, -1]) bk.cyl(0.07, 1.7, [sx * 0.18, 0, 1.25], PAL.steel, [Math.PI / 2, 0, 0], 6);
      }
      const pitch = kitMesh(bk.build(), yaw, TURRET_MAT);
      pitch.position.set(0, heavy ? 0.3 : 0.15, heavy ? 0.6 : 0.4);
      this.group.add(root);
      this.rigs.push({ t, root, yaw, pitch });
    }
  }

  update() {
    const list = this.defence.turrets;
    if (list.length !== this.rigs.length || list.some((t, i) => this.rigs[i].t !== t)) this.build();
    for (const r of this.rigs) {
      const t = r.t, p = t.platform;
      // The pivot rides the platform (its tilt and heading); the housing slews about the platform's up.
      this.m.makeBasis(this.bx.set(p.left.x, p.left.y, p.left.z), this.by.set(p.up.x, p.up.y, p.up.z), this.bz.set(p.fwd.x, p.fwd.y, p.fwd.z));
      const w = this.defence.pivot(t);
      this.m.setPosition(w.x, w.y, w.z);
      r.root.matrix.copy(this.m);
      r.root.matrixWorldNeedsUpdate = true;
      r.yaw.rotation.set(0, t.yaw, 0);
      r.pitch.rotation.set(-t.pitch, 0, 0);
    }
  }
}

