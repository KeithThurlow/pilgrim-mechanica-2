// Draws heal zones (zones.ts): a soft green disc and a bright rim on the ground, pulsing, fading in and out, with
// little sparks rising inside; the weld is a tight amber ring round the mech. Cosmetic: Math.random only here.
import * as THREE from "three/webgpu";
import type { HealZones, Zone } from "./zones";

const COL: Record<string, number> = { beacon: 0x6ff0b0, nanite: 0x7fd6ff, weld: 0xffb44a };
const SEG = 48;

interface Look { group: THREE.Group; disc: THREE.Mesh; rim: THREE.Mesh; sparks: THREE.Points; seed: Float32Array }

export class ZonesDraw {
  readonly group = new THREE.Group();
  private looks = new Map<number, Look>();
  private discGeo = new THREE.CircleGeometry(1, SEG);
  private rimGeo = new THREE.RingGeometry(0.94, 1, SEG);
  private clock = 0;

  constructor(private zones: HealZones, private height: (x: number, z: number) => number) {
    this.discGeo.rotateX(-Math.PI / 2);
    this.rimGeo.rotateX(-Math.PI / 2);
  }

  private make(z: Zone): Look {
    const c = COL[z.kind] ?? 0x6ff0b0;
    const mat = (o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const group = new THREE.Group();
    const disc = new THREE.Mesh(this.discGeo, mat(0.12));
    const rim = new THREE.Mesh(this.rimGeo, mat(0.7));
    const n = 40, pos = new Float32Array(n * 3), seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); seed[i * 3] = Math.cos(a) * r; seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.sin(a) * r; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: c, size: 0.25, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    sparks.frustumCulled = false;
    group.add(disc, rim, sparks);
    this.group.add(group);
    return { group, disc, rim, sparks, seed };
  }

  update(dt: number) {
    this.clock += dt;
    const seen = new Set<number>();
    for (const z of this.zones.zones) {
      seen.add(z.id);
      const l = this.looks.get(z.id) ?? this.make(z);
      this.looks.set(z.id, l);
      const age = z.life - z.left, fade = Math.min(1, age / 0.3, z.left / 0.6);
      const y = this.height(z.x, z.z) + 0.15;
      l.group.position.set(z.x, y, z.z);
      const pulse = 1 + 0.03 * Math.sin(this.clock * 5);
      l.disc.scale.setScalar(z.radius);
      l.rim.scale.setScalar(z.radius * pulse);
      (l.disc.material as THREE.MeshBasicMaterial).opacity = 0.12 * fade;
      (l.rim.material as THREE.MeshBasicMaterial).opacity = 0.7 * fade;
      // Sparks rise 2.5 m and wrap round.
      const p = l.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const t = (l.seed[i * 3 + 1] + this.clock * 0.4) % 1;
        p.setXYZ(i, l.seed[i * 3] * z.radius, t * 2.5, l.seed[i * 3 + 2] * z.radius);
      }
      p.needsUpdate = true;
      (l.sparks.material as THREE.PointsMaterial).opacity = 0.9 * fade;
    }
    for (const [id, l] of this.looks) {
      if (seen.has(id)) continue;
      this.group.remove(l.group);
      for (const m of [l.disc, l.rim]) (m.material as THREE.Material).dispose();
      l.sparks.geometry.dispose();
      (l.sparks.material as THREE.Material).dispose();
      this.looks.delete(id);
    }
  }

  /** The zones' meshes (hold-V selection). */
  meshes(): THREE.Object3D[] { return [...this.looks.values()].map((l) => l.group); }
}
