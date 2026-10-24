// Stand-in look for the escorts (escort.ts): the war band's vehicle bodies in the convoy's own paint, guns forward.
import * as THREE from "three/webgpu";
import { CarBody } from "../vehicles/carBody";
import type { EscortGroup } from "./escort";
import { FRIENDLY } from "./platformBody";

export class EscortBodies {
  readonly group = new THREE.Group();
  private bodies: CarBody[] = [];

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
    list.forEach((e, i) => this.bodies[i].update(e.sim, 0, 0));
  }
}
