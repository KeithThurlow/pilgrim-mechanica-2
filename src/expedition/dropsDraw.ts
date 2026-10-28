// Draws item drops (drawing only; the drops are src/expedition/drops.ts): a small crate on the sand, a beam of light
// in its rarity's colour (taller the rarer, readable from the 40 m game camera), a soft halo round it and a ring on the
// ground. A new drop's beam shoots up; a Legendary's flares wide and tall for a moment. Picked up: a ring flash.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import { RARITY, tierOf } from "../items/rarity";
import type { Drop } from "./drops";

export const DROP_FX_DEFAULTS = { beamHeight: 7, beamTierGrow: 0.25, beamWidth: 0.22, beamGlow: 0.55, legendFlare: 3, flareTime: 1.4 };
export type DropFxValues = typeof DROP_FX_DEFAULTS;
const G = "Loot";
export const DROP_FX_PARAMS: Param[] = [
  { key: "beamHeight", label: "Drop beam height (m)", min: 1, max: 30, step: 0.5, group: G },
  { key: "beamTierGrow", label: "Beam taller per rarity tier", min: 0, max: 1, step: 0.05, group: G },
  { key: "beamWidth", label: "Drop beam width (m)", min: 0.05, max: 1.5, step: 0.01, group: G },
  { key: "beamGlow", label: "Drop beam brightness", min: 0.05, max: 1, step: 0.05, group: G },
  { key: "legendFlare", label: "Legendary flare ×", min: 1, max: 8, step: 0.25, group: G, tip: "A Legendary's beam flares this many times wider and taller when it lands" },
  { key: "flareTime", label: "Flare time (s)", min: 0.2, max: 4, step: 0.1, group: G },
];

interface Shown { root: THREE.Group; beam: THREE.Mesh; halo: THREE.Mesh; ring: THREE.Mesh; crate: THREE.Mesh; tier: number; age: number; seed: number }

export class DropsDraw {
  readonly group = new THREE.Group();
  private shown = new Map<string, Shown>();
  private flashes: { mesh: THREE.Mesh; age: number }[] = [];
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0);
  private ringGeo = new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2);
  private crateGeo = new THREE.BoxGeometry(0.9, 0.55, 0.65).translate(0, 0.27, 0);
  private t = 0;

  constructor(public v: DropFxValues, private field: DuneField) {}

  private glowMat(color: string, opacity: number) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  }

  add(d: Drop) {
    if (this.shown.has(d.id)) return;
    const col = RARITY[d.item.rarity].color, tier = tierOf(d.item.rarity);
    const root = new THREE.Group();
    root.position.set(d.x, this.field.height(d.x, d.z), d.z);
    const crate = new THREE.Mesh(this.crateGeo, new THREE.MeshStandardMaterial({ color: 0x5c5650, roughness: 0.6, metalness: 0.4, emissive: col, emissiveIntensity: 0.35, flatShading: true }));
    crate.rotation.y = Math.random() * Math.PI;
    const beam = new THREE.Mesh(this.beamGeo, this.glowMat(col, this.v.beamGlow));
    const halo = new THREE.Mesh(this.beamGeo, this.glowMat(col, this.v.beamGlow * 0.25));
    const ring = new THREE.Mesh(this.ringGeo, this.glowMat(col, 0.8));
    ring.position.y = 0.08;
    root.add(crate, beam, halo, ring);
    this.group.add(root);
    this.shown.set(d.id, { root, beam, halo, ring, crate, tier, age: 0, seed: Math.random() * 10 });
  }

  /** Picked up: gone, with a flash. */
  picked(id: string) {
    const s = this.shown.get(id);
    if (!s) return;
    const flash = new THREE.Mesh(this.ringGeo, this.glowMat((s.beam.material as THREE.MeshBasicMaterial).color.getStyle(), 1));
    flash.position.copy(s.root.position).y += 0.1;
    this.group.add(flash);
    this.flashes.push({ mesh: flash, age: 0 });
    this.remove(id);
  }

  remove(id: string) {
    const s = this.shown.get(id);
    if (!s) return;
    this.group.remove(s.root);
    for (const m of [s.beam, s.halo, s.ring, s.crate]) (m.material as THREE.Material).dispose();
    this.shown.delete(id);
  }

  clear() { for (const id of [...this.shown.keys()]) this.remove(id); }

  update(dt: number) {
    const v = this.v;
    this.t += dt;
    for (const s of this.shown.values()) {
      s.age += dt;
      // Shoots up over a quarter second; a Legendary flares, then settles.
      const rise = Math.min(1, s.age / 0.25), flareK = s.tier >= 4 ? Math.max(0, 1 - s.age / Math.max(0.05, v.flareTime)) : 0;
      const flare = 1 + (v.legendFlare - 1) * flareK * flareK;
      const pulse = 1 + 0.08 * Math.sin(this.t * 3 + s.seed);
      const h = v.beamHeight * (1 + v.beamTierGrow * s.tier) * rise * (1 + (flare - 1) * 0.6);
      const w = v.beamWidth * (1 + 0.15 * s.tier) * pulse * flare;
      s.beam.scale.set(w, h, w);
      s.halo.scale.set(w * 3, h * 0.8, w * 3);
      (s.beam.material as THREE.MeshBasicMaterial).opacity = v.beamGlow * (0.8 + 0.2 * pulse) * Math.min(1, 0.6 + flareK);
      (s.halo.material as THREE.MeshBasicMaterial).opacity = v.beamGlow * 0.25 * (1 + 2 * flareK);
      const r = 1.2 + 0.25 * Math.sin(this.t * 2.2 + s.seed) + 3 * flareK;
      s.ring.scale.set(r, 1, r);
      s.crate.position.y = 0.05 + 0.08 * Math.sin(this.t * 2 + s.seed);
    }
    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k];
      f.age += dt / 0.5;
      const r = 1 + f.age * 4;
      f.mesh.scale.set(r, 1, r);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - f.age);
      if (f.age >= 1) { this.group.remove(f.mesh); (f.mesh.material as THREE.Material).dispose(); this.flashes.splice(k, 1); }
    }
  }
}
