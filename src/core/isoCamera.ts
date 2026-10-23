// The game camera: high isometric view, fixed facing so W is always up the screen, following a target smoothly.
// Scroll zooms between three framings: in close (45° at 12 m), the game view (50° at 40 m, the old project's
// decision) and far out (55° at 80 m, Keith 2026-10-24: the mech about half its game-view size).
import * as THREE from "three/webgpu";
import type { Param } from "./tweaks";

export const ISO_DEFAULTS = {
  camPitch: 50,
  camDist: 40,
  camNearPitch: 45,
  camNearDist: 12,
  camFarPitch: 55,
  camFarDist: 80,
  camFollow: 6,
  camYaw: 0,
  camFov: 40,
};
export type IsoValues = typeof ISO_DEFAULTS;

export const ISO_PARAMS: Param[] = [
  { key: "camPitch", label: "Game view pitch (°)", min: 20, max: 89, step: 1, group: "Camera" },
  { key: "camDist", label: "Game view distance (m)", min: 10, max: 160, step: 1, group: "Camera", tip: "Where the camera starts" },
  { key: "camNearPitch", label: "Zoomed in pitch (°)", min: 10, max: 89, step: 1, group: "Camera" },
  { key: "camNearDist", label: "Zoomed in distance (m)", min: 4, max: 60, step: 0.5, group: "Camera" },
  { key: "camFarPitch", label: "Zoomed out pitch (°)", min: 20, max: 89, step: 1, group: "Camera" },
  { key: "camFarDist", label: "Zoomed out distance (m)", min: 20, max: 300, step: 1, group: "Camera" },
  { key: "camFollow", label: "Follow speed", min: 0.5, max: 30, step: 0.5, group: "Camera" },
  { key: "camYaw", label: "Facing (°)", min: -180, max: 180, step: 1, group: "Camera", tip: "0 = looking north (+Z); W always moves up the screen" },
  { key: "camFov", label: "Field of view (°)", min: 15, max: 75, step: 1, group: "Camera" },
];

export class IsoCamera {
  /** Current distance from the focus (m). */
  dist = 0;
  private distTarget = 0;
  private focus = new THREE.Vector3();
  private started = false;
  enabled = true;

  constructor(private camera: THREE.PerspectiveCamera, el: HTMLElement, public v: IsoValues) {
    this.dist = this.distTarget = v.camDist;
    el.addEventListener("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      // Even steps in log space, so each notch feels the same near and far.
      this.distTarget = THREE.MathUtils.clamp(this.distTarget * Math.exp(Math.sign(e.deltaY) * 0.14), this.v.camNearDist, this.v.camFarDist);
    }, { passive: false });
  }

  /** Jump the zoom to a distance (m), e.g. for review shots. */
  setDistance(d: number) { this.dist = this.distTarget = THREE.MathUtils.clamp(d, this.v.camNearDist, this.v.camFarDist); }

  /** Pitch for a distance: in close -> game view -> far out, blended in log space. */
  pitchAt(d: number) {
    const v = this.v, L = Math.log;
    if (d <= v.camDist) {
      const t = THREE.MathUtils.clamp((L(d) - L(v.camNearDist)) / Math.max(1e-3, L(v.camDist) - L(v.camNearDist)), 0, 1);
      return THREE.MathUtils.lerp(v.camNearPitch, v.camPitch, t);
    }
    const t = THREE.MathUtils.clamp((L(d) - L(v.camDist)) / Math.max(1e-3, L(v.camFarDist) - L(v.camDist)), 0, 1);
    return THREE.MathUtils.lerp(v.camPitch, v.camFarPitch, t);
  }

  update(target: THREE.Vector3, dt: number) {
    if (!this.enabled) return;
    if (!this.started) { this.focus.copy(target); this.started = true; }
    this.focus.lerp(target, 1 - Math.exp(-this.v.camFollow * dt));
    this.distTarget = THREE.MathUtils.clamp(this.distTarget, this.v.camNearDist, this.v.camFarDist);
    this.dist += (this.distTarget - this.dist) * (1 - Math.exp(-10 * dt));
    const pitch = THREE.MathUtils.degToRad(this.pitchAt(this.dist));
    const yaw = THREE.MathUtils.degToRad(this.v.camYaw);
    // Camera sits behind the focus (opposite the facing) and above it.
    this.camera.position.set(
      this.focus.x - Math.sin(yaw) * Math.cos(pitch) * this.dist,
      this.focus.y + Math.sin(pitch) * this.dist,
      this.focus.z - Math.cos(yaw) * Math.cos(pitch) * this.dist,
    );
    this.camera.lookAt(this.focus);
    if (this.camera.fov !== this.v.camFov) { this.camera.fov = this.v.camFov; this.camera.updateProjectionMatrix(); }
  }

  /** Snap to the target (first frame, or after a teleport). */
  snap(target: THREE.Vector3) { this.focus.copy(target); this.started = true; }
}
