// The game camera: high isometric view (the old project's decision: 50 degrees down at about 40 m, zooming in to
// about 45 degrees at 10-12 m), fixed facing so W is always up the screen, following a target smoothly.
import * as THREE from "three/webgpu";
import type { Param } from "./tweaks";

export const ISO_DEFAULTS = {
  camPitch: 50,
  camDist: 40,
  camNearPitch: 45,
  camNearDist: 12,
  camFollow: 6,
  camYaw: 0,
  camFov: 40,
};
export type IsoValues = typeof ISO_DEFAULTS;

export const ISO_PARAMS: Param[] = [
  { key: "camPitch", label: "Pitch, zoomed out (°)", min: 20, max: 89, step: 1, group: "Camera" },
  { key: "camDist", label: "Distance, zoomed out (m)", min: 10, max: 120, step: 1, group: "Camera" },
  { key: "camNearPitch", label: "Pitch, zoomed in (°)", min: 10, max: 89, step: 1, group: "Camera" },
  { key: "camNearDist", label: "Distance, zoomed in (m)", min: 4, max: 40, step: 0.5, group: "Camera" },
  { key: "camFollow", label: "Follow speed", min: 0.5, max: 30, step: 0.5, group: "Camera" },
  { key: "camYaw", label: "Facing (°)", min: -180, max: 180, step: 1, group: "Camera", tip: "0 = looking north (+Z); W always moves up the screen" },
  { key: "camFov", label: "Field of view (°)", min: 15, max: 75, step: 1, group: "Camera" },
];

export class IsoCamera {
  /** 0 = zoomed out (game view), 1 = zoomed in. */
  zoom = 0;
  private zoomTarget = 0;
  private focus = new THREE.Vector3();
  private started = false;

  constructor(private camera: THREE.PerspectiveCamera, el: HTMLElement, public v: IsoValues) {
    el.addEventListener("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoomTarget = Math.min(1, Math.max(0, this.zoomTarget + Math.sign(e.deltaY) * -0.12));
    }, { passive: false });
  }

  enabled = true;

  update(target: THREE.Vector3, dt: number) {
    if (!this.enabled) return;
    if (!this.started) { this.focus.copy(target); this.started = true; }
    this.focus.lerp(target, 1 - Math.exp(-this.v.camFollow * dt));
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-10 * dt));
    const v = this.v;
    const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(v.camPitch, v.camNearPitch, this.zoom));
    const dist = THREE.MathUtils.lerp(v.camDist, v.camNearDist, this.zoom);
    const yaw = THREE.MathUtils.degToRad(v.camYaw);
    // Camera sits behind the focus (opposite the facing) and above it.
    this.camera.position.set(
      this.focus.x - Math.sin(yaw) * Math.cos(pitch) * dist,
      this.focus.y + Math.sin(pitch) * dist,
      this.focus.z - Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.camera.lookAt(this.focus);
    if (this.camera.fov !== v.camFov) { this.camera.fov = v.camFov; this.camera.updateProjectionMatrix(); }
  }

  /** Snap to the target (first frame, or after a teleport). */
  snap(target: THREE.Vector3) { this.focus.copy(target); this.started = true; }
}
