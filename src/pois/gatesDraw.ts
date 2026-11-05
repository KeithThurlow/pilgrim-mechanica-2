// Draws the standing gates (cosmetic): a steel barricade filling each gap, welded from plates with a frame of girders
// and a hazard stripe, standing a little proud of the plug in the ground under it. Gone when its gate is down (the blast and the open
// gap say the rest). Stand-in boxes; the sim (src/pois/gates.ts) doesn't care what it looks like.
import * as THREE from "three/webgpu";
import type { Gates, GateState } from "./gates";
import { along } from "./fortress";

const steel = new THREE.MeshStandardMaterial({ color: 0x6f6a62, metalness: 0.4, roughness: 0.6, flatShading: true });
const dark = new THREE.MeshStandardMaterial({ color: 0x34302c, metalness: 0.3, roughness: 0.7, flatShading: true });
/** How far the plates and posts run into the ground: the floor rolls across a gap, and the gate stands on its middle. */
const SINK = 1;
const hazard = new THREE.MeshStandardMaterial({ color: 0xc9961e, metalness: 0.1, roughness: 0.7, flatShading: true });

export class GatesDraw {
  readonly group = new THREE.Group();
  private drawn = new Map<GateState, THREE.Group>();

  constructor(private gates: Gates) {}

  /** Meshes of the standing gates (hold-V). */
  meshes(): THREE.Object3D[] { return [...this.drawn.values()]; }

  update() {
    const live = new Set(this.gates.list.filter((s) => !s.down));
    for (const [s, g] of this.drawn) if (!live.has(s)) { this.group.remove(g); dispose(g); this.drawn.delete(s); }
    for (const s of live) if (!this.drawn.has(s)) { const g = build(s); this.group.add(g); this.drawn.set(s, g); }
  }
}

function build(s: GateState): THREE.Group {
  const g = new THREE.Group(), gate = s.gate, h = s.ring.h;
  // Square to the wall, not to the fortress's centre: a straight wall crosses the line from the centre at a slant, and
  // the gap (and the plug in the ground) is cut along the wall, so a slanted wall's gap is longer by 1 / cos of the slant.
  const yaw = along(s.ring, gate.a) - Math.PI / 2, slant = Math.max(0.5, Math.abs(Math.cos(yaw - gate.a)));
  const W = (gate.w + 1.2) / slant, T = gate.t + 0.6;
  g.position.set(gate.x, s.floor, gate.z);
  g.rotation.y = yaw; // local z across the wall, local x along it
  const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  // Plates, a little ragged in height.
  const n = Math.max(2, Math.round(W / 2.4));
  for (let i = 0; i < n; i++) {
    const w = W / n, x = -W / 2 + w * (i + 0.5), hh = h * (1.06 + 0.06 * Math.sin(i * 2.3 + gate.a * 5));
    add(steel, w - 0.08, hh + SINK, T, x, (hh - SINK) / 2, 0);
  }
  // Girders across both faces, posts, and a hazard stripe.
  for (const side of [-1, 1]) {
    for (const y of [h * 0.25, h * 0.7]) add(dark, W + 0.4, 0.45, 0.35, 0, y, side * (T / 2 + 0.17));
    add(hazard, W * 0.9, 0.35, 0.05, 0, h * 0.48, side * (T / 2 + 0.03));
  }
  for (let i = 0; i <= 2; i++) add(dark, 0.45, h + 0.4 + SINK, T + 0.5, -W / 2 + (W * i) / 2, (h + 0.4 - SINK) / 2, 0);
  return g;
}

function dispose(g: THREE.Group) { g.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
