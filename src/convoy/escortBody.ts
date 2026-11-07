// Stand-in look for the escorts (escort.ts): the war band's vehicle bodies in the convoy's own paint; the guns point
// where the escort guns (guard.ts) aim them, else forward.
import * as THREE from "three/webgpu";
import { CarBody } from "../vehicles/carBody";
import type { EscortGroup } from "./escort";
import { FRIENDLY } from "./platformBody";
import { drawBetweenTicks } from "../look/treeInterp";

export class EscortBodies {
  readonly group = drawBetweenTicks(new THREE.Group());
  readonly bodies: CarBody[] = [];
  /** Turret angles for escort i's turret k (relative to its body), from the escort guns; null: forward. */
  turretAim: ((i: number, k: number) => { yaw: number; pitch: number } | null) | null = null;

  constructor(readonly escorts: EscortGroup) { this.group.name = "escorts"; }

  objects(): THREE.Object3D[] { return this.bodies.map((b) => b.root); }

  update() {
    const list = this.escorts.list;
    while (this.bodies.length > list.length) this.group.remove(this.bodies.pop()!.root);
    while (this.bodies.length < list.length) {
      const b = new CarBody(list[this.bodies.length].kind, FRIENDLY);
      this.group.add(b.root);
      this.bodies.push(b);
    }
    list.forEach((e, i) => {
      const b = this.bodies[i];
      for (let k = 1; k < b.turretCount; k++) { const a = this.turretAim?.(i, k); if (a) b.aim(k, a.yaw, a.pitch); }
      const a = this.turretAim?.(i, 0);
      b.update(e.sim, a?.yaw ?? 0, a?.pitch ?? 0);
    });
  }
}
