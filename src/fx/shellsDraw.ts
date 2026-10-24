// Draws the shells (a hot glowing slug with a smoke trail left in the dust system) and their telegraphs: a ring on
// the sand where each will land, the size of its blast, with a disc filling in from the centre as it comes down
// (Keith 2026-10-24: telegraphed so you can dash out). Kept readable from the high game camera: a bold ring, drawn
// over the sand and units.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Shells } from "../game/shells";
import type { Ground } from "../mech/walker";

export const SHELL_FX_DEFAULTS = {
  markOpacity: 0.85,
  markWidth: 0.35,
  shellGlow: 1,
};
export type ShellFxValues = typeof SHELL_FX_DEFAULTS;

export const SHELL_FX_PARAMS: Param[] = [
  { key: "markOpacity", label: "Landing mark strength", min: 0, max: 1, step: 0.01, group: "Telegraphs" },
  { key: "markWidth", label: "Landing ring width (m)", min: 0.05, max: 1.5, step: 0.01, group: "Telegraphs" },
  { key: "shellGlow", label: "Shell size", min: 0.3, max: 3, step: 0.05, group: "Telegraphs" },
];

const RING_COL = 0xff5a2a;

interface Mark { ring: THREE.Mesh; fill: THREE.Mesh; slug: THREE.Mesh }

export class ShellsDraw {
  readonly group = new THREE.Group();
  private marks: Mark[] = [];
  private q = new THREE.Quaternion();
  private n = new THREE.Vector3();
  private nn = [0, 1, 0];
  private ringW = -1;

  constructor(private shells: Shells, private ground: Ground, public v: ShellFxValues) {}

  private mark(i: number): Mark {
    while (this.marks.length <= i) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: RING_COL, transparent: true, depthWrite: false, toneMapped: false }));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: RING_COL, transparent: true, depthWrite: false, toneMapped: false }));
      const slug = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd08a, toneMapped: false }));
      for (const m of [ring, fill]) { m.renderOrder = 2; (m.material as THREE.Material).polygonOffset = true; (m.material as THREE.Material).polygonOffsetFactor = -6; }
      slug.castShadow = true;
      this.group.add(ring, fill, slug);
      this.marks.push({ ring, fill, slug });
    }
    return this.marks[i];
  }

  update() {
    const v = this.v;
    let i = 0;
    for (const s of this.shells.list) {
      if (!s.live) continue;
      const m = this.mark(i++);
      const u = Math.min(1, s.t / s.flight);
      const nr = this.ground.normal(s.to.x, s.to.z, this.nn);
      this.q.setFromUnitVectors(UP, this.n.set(nr[0], nr[1], nr[2]));
      const y = this.ground.height(s.to.x, s.to.z) + 0.05;
      // Ring the blast's size; its width as a share of the radius is rebuilt when the slider moves.
      const inner = Math.max(0.05, 1 - v.markWidth / Math.max(0.3, s.radius));
      if (Math.abs(inner - this.ringW) > 1e-3) {
        this.ringW = inner;
        for (const mk of this.marks) { mk.ring.geometry.dispose(); mk.ring.geometry = new THREE.RingGeometry(inner, 1, 48).rotateX(-Math.PI / 2); }
      }
      m.ring.position.set(s.to.x, y, s.to.z); m.ring.quaternion.copy(this.q); m.ring.scale.setScalar(s.radius);
      // The fill grows toward the ring as it comes down, and brightens at the end.
      m.fill.position.copy(m.ring.position); m.fill.quaternion.copy(this.q); m.fill.scale.setScalar(Math.max(0.01, s.radius * u));
      (m.ring.material as THREE.MeshBasicMaterial).opacity = v.markOpacity * (0.6 + 0.4 * Math.sin(s.t * 18) ** 2);
      (m.fill.material as THREE.MeshBasicMaterial).opacity = v.markOpacity * (0.15 + 0.3 * u * u);
      m.slug.position.copy(s.pos); m.slug.scale.setScalar(v.shellGlow);
      for (const o of [m.ring, m.fill, m.slug]) o.visible = true;
    }
    for (; i < this.marks.length; i++) for (const o of [this.marks[i].ring, this.marks[i].fill, this.marks[i].slug]) o.visible = false;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
