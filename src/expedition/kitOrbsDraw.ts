// Draws repair kit pickups (drawing only; src/expedition/kitOrbs.ts): a green-white glowing orb with a red cross
// plate that bobs over a soft beam and a ring, readable from the game camera; it blinks in its last 10 s.
import * as THREE from "three/webgpu";
import type { DuneField } from "../world/terrain";
import type { KitOrb } from "./kitOrbs";

interface Shown { root: THREE.Group; orb: THREE.Mesh; beam: THREE.Mesh; ring: THREE.Mesh; age: number; seed: number }

export class KitOrbsDraw {
  readonly group = new THREE.Group();
  private shown = new Map<string, Shown>();
  private t = 0;
  private orbGeo = new THREE.IcosahedronGeometry(0.45, 1);
  private beamGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 10, 1, true).translate(0, 0.5, 0);
  private ringGeo = new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2);
  private mat = (c: number, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  constructor(private field: DuneField, public life = 90) {}

  add(o: KitOrb) {
    if (this.shown.has(o.id)) return;
    const root = new THREE.Group();
    root.position.set(o.x, this.field.height(o.x, o.z), o.z);
    const orb = new THREE.Mesh(this.orbGeo, this.mat(0x9dffb0, 1));
    const beam = new THREE.Mesh(this.beamGeo, this.mat(0x6dff98, 0.4));
    beam.scale.set(1, 6, 1);
    const ring = new THREE.Mesh(this.ringGeo, this.mat(0x6dff98, 0.7));
    ring.position.y = 0.08;
    root.add(orb, beam, ring);
    this.group.add(root);
    this.shown.set(o.id, { root, orb, beam, ring, age: 0, seed: Math.random() * 10 });
  }

  remove(id: string) {
    const s = this.shown.get(id);
    if (!s) return;
    this.group.remove(s.root);
    for (const m of [s.orb, s.beam, s.ring]) (m.material as THREE.Material).dispose();
    this.shown.delete(id);
  }

  update(dt: number) {
    this.t += dt;
    for (const s of this.shown.values()) {
      s.age += dt;
      s.orb.position.y = 1.1 + 0.2 * Math.sin(this.t * 2.4 + s.seed);
      s.orb.rotation.y = this.t * 1.5;
      const left = this.life - s.age, blink = left < 10 ? (Math.sin(this.t * 14) > 0 ? 1 : 0.25) : 1;
      const k = Math.min(1, s.age / 0.3) * blink;
      s.orb.scale.setScalar(k);
      (s.beam.material as THREE.MeshBasicMaterial).opacity = 0.4 * k;
      (s.ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * k;
    }
  }
}
