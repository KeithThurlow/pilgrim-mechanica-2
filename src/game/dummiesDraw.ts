// Draws the target dummies (src/game/dummies.ts): a steel post on a foot with a target plate facing the start
// point, flashing when hit and reddening as it wears down; a downed one lies flat until it stands up again.
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";
import type { DummyRange } from "./dummies";

const STEEL = 0x8f877d, PLATE = 0xd9cfbf, HURT = 0xc4523f, FOOT = 0x4a4540, CUTOUT = 0xd8b27a, CUTOUT_DARK = 0x9b7a4c;

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
    for (let i = 0; i < this.range.dummies.length; i++) {
      const d = this.range.dummies[i];
      const h = d.height;
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
      let plate: THREE.Mesh, bar: THREE.Mesh;
      if (d.light) {
        // A plywood figure on a stake: a body board, a head, a little foot.
        const w = d.radius * 2;
        add([w * 1.2, 0.12, 0.6], 0.04, FOOT);
        plate = add([w, h * 0.62, 0.08], h * 0.4, CUTOUT, 0, true);
        add([w * 0.45, h * 0.2, 0.08], h * 0.84, CUTOUT_DARK);
        bar = add([w * 1.1, 0.1, 0.04], h + 0.25, 0x8fd18a, 0, true);
      } else {
        add([1.8, 0.3, 1.8], 0.05, FOOT);
        add([0.4, h, 0.4], h / 2, STEEL);
        plate = add([1.9, 1.9, 0.18], h * 0.68, PLATE, 0.3, true);
        bar = add([1.6, 0.14, 0.05], h + 0.35, 0x8fd18a, 0.3, true);
      }
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
      // Facing the start; a downed one falls the way it was hit.
      if (d.alive) p.root.rotation.set(0, Math.atan2(-d.x, -d.z), 0, "YXZ");
      else p.root.rotation.set(Math.PI / 2 * Math.min(1, d.deadFor * 4), d.fallYaw, 0, "YXZ");
      const share = Math.max(0, d.health / d.maxHealth);
      this.c.setHex(HURT).lerp(this.plateCol, share).lerp(this.white, d.flash * 0.6);
      (p.plate.material as THREE.MeshStandardMaterial).color.copy(this.c);
      p.bar.visible = d.alive;
      p.bar.scale.x = Math.max(0.02, share);
    });
  }

  meshes() { return this.posts.map((p) => p.root); }
}
