// Draws the target dummies (src/game/dummies.ts): a steel post on a foot with a target plate facing the start
// point, flashing when hit and reddening as it wears down; a downed one lies flat until it stands up again.
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";
import type { DummyRange } from "./dummies";

const STEEL = 0x8f877d, PLATE = 0xd9cfbf, HURT = 0xc4523f, FOOT = 0x4a4540;

export class DummiesDraw {
  readonly group = new THREE.Group();
  private posts: { root: THREE.Group; plate: THREE.Mesh; bar: THREE.Mesh }[] = [];
  private c = new THREE.Color();
  private plateCol = new THREE.Color(PLATE);
  private white = new THREE.Color(0xffffff);

  constructor(private range: DummyRange, private look: ToonLook) { this.rebuild(); }

  /** After the range is laid out again. */
  rebuild() {
    for (const p of this.posts) this.group.remove(p.root);
    this.posts = [];
    const h = this.range.v.dummyHeight;
    for (let i = 0; i < this.range.dummies.length; i++) {
      const root = new THREE.Group();
      // Post and foot in the unit look; plate and bar on their own materials (recoloured every frame).
      const add = (size: [number, number, number], y: number, tint: number, z = 0, own = false) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(...size), own ? new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6 }) : undefined);
        m.position.set(0, y, z);
        if (!own) { this.look.apply(m, false); this.look.tint(m, tint); }
        m.castShadow = true;
        root.add(m);
        return m;
      };
      add([1.8, 0.3, 1.8], 0.05, FOOT);
      add([0.4, h, 0.4], h / 2, STEEL);
      const plate = add([1.9, 1.9, 0.18], h * 0.68, PLATE, 0.3, true);
      const bar = add([1.6, 0.14, 0.05], h + 0.35, 0x8fd18a, 0.3, true);
      this.group.add(root);
      this.posts.push({ root, plate, bar });
    }
  }

  update() {
    const ds = this.range.dummies;
    if (ds.length !== this.posts.length) this.rebuild();
    ds.forEach((d, i) => {
      const p = this.posts[i];
      p.root.position.set(d.x, d.y, d.z);
      p.root.rotation.set(d.alive ? 0 : -Math.PI / 2 * Math.min(1, d.deadFor * 4), Math.atan2(-d.x, -d.z), 0, "YXZ");
      const share = Math.max(0, d.health / this.range.v.dummyHealth);
      this.c.setHex(HURT).lerp(this.plateCol, share).lerp(this.white, d.flash * 0.6);
      (p.plate.material as THREE.MeshStandardMaterial).color.copy(this.c);
      p.bar.visible = d.alive;
      p.bar.scale.x = Math.max(0.02, share);
    });
  }

  meshes() { return this.posts.map((p) => p.root); }
}
