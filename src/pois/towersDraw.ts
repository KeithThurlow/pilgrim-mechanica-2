// Draws the lookout towers (cosmetic): three levels of containers, each crossed over the one below, a sandbag rim
// round the top and a scrap pole; shot down, the stack topples away (a turn about its base edge) and lies there.
import * as THREE from "three/webgpu";
import { BOX } from "./fortress";
import type { Towers, TowerState } from "./towers";

const TONES = [0x7d4426, 0x606044, 0x7a766e, 0x3b3632, 0x8a5a2a, 0x7d4426];
const mats = TONES.map((c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.3, roughness: 0.65, flatShading: true }));
const bag = new THREE.MeshStandardMaterial({ color: 0xb09a72, roughness: 0.95, flatShading: true });
const pole = new THREE.MeshStandardMaterial({ color: 0x2c2824, metalness: 0.4, roughness: 0.6 });
const flag = new THREE.MeshStandardMaterial({ color: 0x8e2a1e, roughness: 0.8, side: THREE.DoubleSide });
const boxGeo = new THREE.BoxGeometry(BOX.wide, BOX.high, BOX.long);
const bagGeo = new THREE.BoxGeometry(1, 0.55, 0.5);
const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4, 5);
const flagGeo = new THREE.PlaneGeometry(1.4, 0.8);

interface Drawn { pivot: THREE.Group; body: THREE.Group }

export class TowersDraw {
  readonly group = new THREE.Group();
  private drawn = new Map<TowerState, Drawn>();
  private t = 0;

  constructor(private towers: Towers) {}

  meshes(): THREE.Object3D[] { return [...this.drawn.values()].map((d) => d.pivot); }

  update(dt: number) {
    this.t += dt;
    const live = new Set(this.towers.list);
    for (const [s, d] of this.drawn) if (!live.has(s)) { this.group.remove(d.pivot); this.drawn.delete(s); }
    for (const s of live) {
      let d = this.drawn.get(s);
      if (!d) { d = build(s); this.group.add(d.pivot); this.drawn.set(s, d); }
      // Topple: slow at first, then down hard, a bounce, and it lies there half sunk.
      const f = s.down ? s.fell : 0;
      const tip = f <= 0 ? 0 : Math.min(1.5, 0.15 * f + 1.6 * f * f);
      d.pivot.rotation.set(0, 0, 0);
      d.pivot.rotateOnWorldAxis(new THREE.Vector3(Math.cos(s.fallA), 0, -Math.sin(s.fallA)), tip);
      d.pivot.position.y = s.floor - (f > 1 ? Math.min(1.2, (f - 1) * 0.8) : 0);
    }
  }
}

function build(s: TowerState): Drawn {
  const b = s.b, pivot = new THREE.Group(), body = new THREE.Group();
  // The pivot on the base edge it falls over; the body placed back from it.
  const ex = Math.sin(s.fallA) * (b.dep / 2), ez = Math.cos(s.fallA) * (b.dep / 2);
  pivot.position.set(b.x + ex, s.floor, b.z + ez);
  body.position.set(-ex, 0, -ez);
  pivot.add(body);
  let k = (s.t.id.length * 7 + Math.round(b.x * 3)) % TONES.length;
  const put = (x: number, y: number, z: number, yaw: number) => {
    const m = new THREE.Mesh(boxGeo, mats[k++ % mats.length]);
    m.position.set(x, y, z); m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    body.add(m);
  };
  const ux = Math.sin(b.a), uz = Math.cos(b.a), wx = Math.cos(b.a), wz = -Math.sin(b.a);
  for (let lv = 0; lv < 3; lv++) {
    const y = BOX.high * (lv + 0.5);
    // Even levels: two lying along a, side by side; the odd level crossed over them.
    if (lv % 2 === 0) for (const sd of [-0.5, 0.5]) put(wx * sd * BOX.wide, y, wz * sd * BOX.wide, b.a);
    else for (const sd of [-0.5, 0.5]) put(ux * sd * BOX.wide, y, uz * sd * BOX.wide, b.a + Math.PI / 2);
  }
  // Sandbags round the top's edge.
  const top = BOX.high * 3, hl = b.len / 2 - 0.3, hd = b.dep / 2 - 0.3;
  for (let i = 0; i < 16; i++) {
    const t = i / 16, per = 2 * (hl + hd);
    let d = t * 2 * per, lx = 0, lz = 0;
    if (d < 2 * hl) { lx = -hl + d; lz = hd; } else if ((d -= 2 * hl) < 2 * hd) { lx = hl; lz = hd - d; } else if ((d -= 2 * hd) < 2 * hl) { lx = hl - d; lz = -hd; } else { d -= 2 * hl; lx = -hl; lz = -hd + d; }
    const m = new THREE.Mesh(bagGeo, bag);
    m.position.set(ux * lx + wx * lz, top + 0.27, uz * lx + wz * lz);
    m.rotation.y = b.a + (Math.abs(lz) > hd - 0.01 ? 0 : Math.PI / 2) + (i % 3) * 0.1;
    body.add(m);
  }
  const p = new THREE.Mesh(poleGeo, pole);
  p.position.set(ux * (hl - 0.2) + wx * (hd - 0.2), top + 2, uz * (hl - 0.2) + wz * (hd - 0.2));
  body.add(p);
  const fl = new THREE.Mesh(flagGeo, flag);
  fl.position.set(p.position.x + 0.7 * wx, top + 3.5, p.position.z + 0.7 * wz);
  fl.rotation.y = b.a;
  body.add(fl);
  return { pivot, body };
}
