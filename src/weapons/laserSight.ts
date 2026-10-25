// A faint targeting laser (Keith 2026-10-25: the minigun and rocket launchers carry one): a thin red beam from the
// emitter socket along the weapon's +Z, or to a point it's told to paint, with a small hot dot where it lands.
// Additive and unlit, so it reads as light from the 40 m game camera without lighting anything.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";

export const LASER_DEFAULTS = { laserOn: 1, laserLength: 60, laserWidth: 0.035, laserOpacity: 0.35, laserDot: 0.35 };
export type LaserValues = typeof LASER_DEFAULTS;
export const LASER_PARAMS: Param[] = [
  { key: "laserOn", label: "Targeting laser on", min: 0, max: 1, step: 1, group: "Targeting laser" },
  { key: "laserLength", label: "Reach (m)", min: 5, max: 150, step: 1, group: "Targeting laser", tip: "When nothing tells it where it lands" },
  { key: "laserWidth", label: "Beam width (m)", min: 0.005, max: 0.2, step: 0.005, group: "Targeting laser", tip: "About 0.04 m is one pixel at the 40 m game camera" },
  { key: "laserOpacity", label: "Beam strength", min: 0, max: 1, step: 0.01, group: "Targeting laser" },
  { key: "laserDot", label: "Dot size (m)", min: 0, max: 1.5, step: 0.01, group: "Targeting laser" },
];

const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const dotGeo = new THREE.SphereGeometry(0.5, 10, 8);

export class LaserSight {
  readonly group = new THREE.Group();
  private beam: THREE.Mesh;
  private core: THREE.Mesh;
  private dot: THREE.Mesh;
  private beamMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private coreMat = new THREE.MeshBasicMaterial({ color: 0xffb0a0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private dotMat = new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private target: THREE.Vector3 | null = null;
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(public color = 0xff2a1a) {
    this.beamMat.color.setHex(color);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.core = new THREE.Mesh(beamGeo, this.coreMat);
    this.dot = new THREE.Mesh(dotGeo, this.dotMat);
    for (const m of [this.beam, this.core, this.dot]) { m.frustumCulled = false; m.castShadow = false; m.raycast = () => {}; m.renderOrder = 5; }
    this.group.add(this.beam, this.core, this.dot);
  }

  /** Paint a world point (null: straight out along the weapon to the reach). */
  aimAt(p: THREE.Vector3 | null) { this.target = p ? (this.target ?? new THREE.Vector3()).copy(p) : null; }

  /** Call after the weapon's pose is set for the frame. */
  update(v: LaserValues, time = 0, on = true) {
    const vis = on && v.laserOn > 0.5 && v.laserOpacity > 0;
    this.group.visible = vis;
    if (!vis) return;
    let len = v.laserLength;
    this.group.quaternion.identity();
    // The socket's own scale (the weapon's fit) shouldn't thin the beam: undo it.
    this.group.parent!.updateWorldMatrix(true, false);
    const s = this.tmp.setFromMatrixScale(this.group.parent!.matrixWorld).x || 1;
    if (this.target) {
      const local = this.group.parent!.worldToLocal(this.tmp.copy(this.target));
      len = local.length() * s;
      if (len > 1e-3) this.group.quaternion.copy(this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), local.normalize()));
    }
    this.group.scale.setScalar(1 / s);
    const flicker = 0.9 + 0.1 * Math.sin(time * 53) * Math.sin(time * 17);
    this.beam.scale.set(v.laserWidth * 2.2, v.laserWidth * 2.2, len);
    this.core.scale.set(v.laserWidth * 0.7, v.laserWidth * 0.7, len);
    this.beamMat.opacity = v.laserOpacity * 0.45 * flicker;
    this.coreMat.opacity = v.laserOpacity * flicker;
    this.dot.position.set(0, 0, len);
    this.dot.scale.setScalar(v.laserDot * (0.85 + 0.15 * flicker));
    this.dotMat.opacity = Math.min(1, v.laserOpacity * 2.2);
  }

  dispose() { this.group.removeFromParent(); this.beamMat.dispose(); this.coreMat.dispose(); this.dotMat.dispose(); }
}
