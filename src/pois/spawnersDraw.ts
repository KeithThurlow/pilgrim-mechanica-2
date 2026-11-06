// Draws the spawner shacks' doors (cosmetic): two steel leaves hinged at the container's door end, swinging open as
// the bandits are about to pour out, a lamp over them that flashes red while they're open, and a hazard band so the
// shack reads as the one to shoot. Down: the leaves are gone (blown off) and the lamp is dark.
import * as THREE from "three/webgpu";
import { BOX } from "./fortress";
import type { Spawners, SpawnerState } from "./spawners";

const leafMat = new THREE.MeshStandardMaterial({ color: 0x7a3a22, metalness: 0.35, roughness: 0.6, flatShading: true });
const barMat = new THREE.MeshStandardMaterial({ color: 0x2c2824, metalness: 0.4, roughness: 0.6, flatShading: true });
const hazard = new THREE.MeshStandardMaterial({ color: 0xc9961e, metalness: 0.1, roughness: 0.7, flatShading: true });
const lampOff = new THREE.MeshStandardMaterial({ color: 0x3a1010, roughness: 0.5 });
const lampOn = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 3, roughness: 0.5 });
const leafGeo = new THREE.BoxGeometry(BOX.wide / 2 - 0.04, BOX.high - 0.2, 0.07).translate((BOX.wide / 2 - 0.04) / 2, (BOX.high - 0.2) / 2, 0);
const barGeo = new THREE.BoxGeometry(0.08, BOX.high - 0.3, 0.1);
const lampGeo = new THREE.BoxGeometry(0.35, 0.22, 0.22);
const bandGeo = new THREE.BoxGeometry(BOX.wide + 0.02, 0.3, 0.04);

interface Drawn { g: THREE.Group; l: THREE.Object3D; r: THREE.Object3D; lamp: THREE.Mesh }

export class SpawnersDraw {
  readonly group = new THREE.Group();
  private drawn = new Map<SpawnerState, Drawn>();
  private t = 0;

  constructor(private sp: Spawners) {}

  meshes(): THREE.Object3D[] { return [...this.drawn.values()].map((d) => d.g); }

  update(dt: number) {
    this.t += dt;
    const live = new Set(this.sp.list);
    for (const [s, d] of this.drawn) if (!live.has(s)) { this.group.remove(d.g); this.drawn.delete(s); }
    for (const s of live) {
      let d = this.drawn.get(s);
      if (!d) { d = build(s); this.group.add(d.g); this.drawn.set(s, d); }
      // Swing out to 110°; down, the leaves are blown away.
      const a = s.open * 1.9;
      d.l.visible = d.r.visible = !s.down;
      d.l.rotation.y = -a; d.r.rotation.y = a;
      const on = !s.down && s.open > 0.02 && Math.sin(this.t * 14) > -0.2;
      d.lamp.material = on ? lampOn : lampOff;
    }
  }
}

function build(s: SpawnerState): Drawn {
  const g = new THREE.Group();
  // Local frame: +z out of the door, x across it; at the door face on the floor.
  g.position.set(s.sp.x, s.floor, s.sp.z);
  g.rotation.y = s.sp.a;
  const hinge = (side: number) => {
    const p = new THREE.Group();
    p.position.set(side * (BOX.wide / 2 - 0.02), 0.1, 0.06);
    const m = new THREE.Mesh(leafGeo, leafMat);
    m.castShadow = true;
    m.scale.x = -side;
    p.add(m);
    for (const f of [0.3, 0.7]) { const b = new THREE.Mesh(barGeo, barMat); b.position.set(-side * (BOX.wide / 2 - 0.04) * f, BOX.high / 2, 0.06); p.add(b); }
    g.add(p);
    return p;
  };
  const l = hinge(-1), r = hinge(1);
  const lamp = new THREE.Mesh(lampGeo, lampOff);
  lamp.position.set(0, BOX.high + 0.15, 0.05);
  g.add(lamp);
  const band = new THREE.Mesh(bandGeo, hazard);
  band.position.set(0, BOX.high - 0.25, 0.03);
  g.add(band);
  return { g, l, r, lamp };
}
