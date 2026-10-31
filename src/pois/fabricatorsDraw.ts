// Draws a hub's fabricator towers (cosmetic): a dark housing with a hazard band, a stack and a hot glow at the top
// while it works; a burnt, squat stump once it's down. Stand-in boxes (src/pois/fabricators.ts is the sim).
import * as THREE from "three/webgpu";
import type { Fabricators, FabState } from "./fabricators";

const dark = new THREE.MeshStandardMaterial({ color: 0x34302c, metalness: 0.35, roughness: 0.65, flatShading: true });
const steel = new THREE.MeshStandardMaterial({ color: 0x6f6a62, metalness: 0.4, roughness: 0.6, flatShading: true });
const hazard = new THREE.MeshStandardMaterial({ color: 0xc9961e, metalness: 0.1, roughness: 0.7, flatShading: true });
const burnt = new THREE.MeshStandardMaterial({ color: 0x1e1b19, metalness: 0.2, roughness: 0.9, flatShading: true });
const glow = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 2.5, roughness: 0.5 });

export class FabricatorsDraw {
  readonly group = new THREE.Group();
  private drawn = new Map<FabState, { g: THREE.Group; down: boolean }>();

  constructor(private fabs: Fabricators) {}

  meshes(): THREE.Object3D[] { return [...this.drawn.values()].map((d) => d.g); }

  update() {
    const live = new Set(this.fabs.list);
    for (const [s, d] of this.drawn) if (!live.has(s) || d.down !== s.down) { this.group.remove(d.g); dispose(d.g); this.drawn.delete(s); }
    for (const s of live) if (!this.drawn.has(s)) { const g = build(s, this.fabs.v.hubFabH); this.group.add(g); this.drawn.set(s, { g, down: s.down }); }
  }
}

function build(s: FabState, H: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(s.fab.x, s.floor, s.fab.z);
  g.rotation.y = s.fab.a;
  const add = (mat: THREE.Material, geo: THREE.BufferGeometry, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y; m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  if (s.down) {
    const h = H * 0.3;
    add(burnt, new THREE.BoxGeometry(6, h, 6), h / 2);
    add(burnt, new THREE.BoxGeometry(3, 1.2, 4), h + 0.4);
    return g;
  }
  add(dark, new THREE.BoxGeometry(6, H, 6), H / 2);
  add(hazard, new THREE.BoxGeometry(6.3, 1, 6.3), H * 0.62);
  add(steel, new THREE.CylinderGeometry(1, 1, 5, 10), H + 2.5);
  add(glow, new THREE.CylinderGeometry(1.1, 1.1, 0.6, 10), H + 5.1);
  return g;
}

function dispose(g: THREE.Group) { g.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
