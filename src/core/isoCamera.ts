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
  // At speed (Keith 2026-10-26, the sprint): look ahead along the motion and pull out a little, so a fast mech doesn't
  // sit at the screen's edge with nothing to see coming.
  camLead: 0.6,
  camLeadMax: 14,
  camLeadFrom: 7,
  camSpeedZoom: 1.2,
  camSpeedEase: 1.5,
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
  { key: "camLead", label: "Look ahead at speed (s of travel)", min: 0, max: 2, step: 0.05, group: "Camera", tip: "Moving faster than the start speed below, the view centres this many seconds ahead along the motion" },
  { key: "camLeadMax", label: "Look ahead at most (m)", min: 0, max: 40, step: 0.5, group: "Camera" },
  { key: "camLeadFrom", label: "Look ahead from (m/s)", min: 0, max: 20, step: 0.5, group: "Camera", tip: "Walking and running stay centred; above this the look-ahead builds in" },
  { key: "camSpeedZoom", label: "Pull out per m/s over that (m)", min: 0, max: 5, step: 0.05, group: "Camera", tip: "At 14 m/s about 8 m further out, at 22 m/s about 18 m" },
  { key: "camSpeedEase", label: "Look-ahead easing (1/s)", min: 0.2, max: 10, step: 0.1, group: "Camera", tip: "How quickly the look-ahead and pull-out follow changes of speed and direction" },
];

export class IsoCamera {
  /** Current distance from the focus (m). */
  dist = 0;
  private distTarget = 0;
  private focus = new THREE.Vector3();
  private started = false;
  enabled = true;
  /** Look-ahead (world x, z, m) and the extra distance from speed (m), eased. */
  private lead = new THREE.Vector2();
  private speedDist = 0;

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

  /** Glide the zoom to a distance (m) (the pilot getting out zooms in, getting back in zooms out). */
  zoomTo(d: number) { this.distTarget = THREE.MathUtils.clamp(d, this.v.camNearDist, this.v.camFarDist); }
  /** Where the zoom is heading (m). */
  get zoomTarget() { return this.distTarget; }

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

  /**
   * motion: the followed thing's ground velocity (m/s, world x/z); past camLeadFrom the view leads it and pulls out.
   */
  update(target: THREE.Vector3, dt: number, motion?: { x: number; z: number }) {
    if (!this.enabled) return;
    if (!this.started) { this.focus.copy(target); this.started = true; }
    this.focus.lerp(target, 1 - Math.exp(-this.v.camFollow * dt));
    this.distTarget = THREE.MathUtils.clamp(this.distTarget, this.v.camNearDist, this.v.camFarDist);
    this.dist += (this.distTarget - this.dist) * (1 - Math.exp(-10 * dt));
    // At speed: ahead along the motion, and further out.
    const v = this.v, mx = motion?.x ?? 0, mz = motion?.z ?? 0, s = Math.hypot(mx, mz);
    // Lead camLead seconds of travel (capped), blending in over the first 4 m/s past camLeadFrom.
    const over = Math.max(0, s - v.camLeadFrom);
    const k = s > 1e-3 ? (Math.min(v.camLeadMax, v.camLead * s) * Math.min(1, over / 4)) / s : 0;
    const ease = 1 - Math.exp(-v.camSpeedEase * dt);
    this.lead.x += (mx * k - this.lead.x) * ease;
    this.lead.y += (mz * k - this.lead.y) * ease;
    this.speedDist += (over * v.camSpeedZoom - this.speedDist) * ease;
    const dist = this.dist + this.speedDist;
    const fx = this.focus.x + this.lead.x, fz = this.focus.z + this.lead.y;
    const pitch = THREE.MathUtils.degToRad(this.pitchAt(dist));
    const yaw = THREE.MathUtils.degToRad(this.v.camYaw);
    // Camera sits behind the focus (opposite the facing) and above it.
    this.camera.position.set(
      fx - Math.sin(yaw) * Math.cos(pitch) * dist,
      this.focus.y + Math.sin(pitch) * dist,
      fz - Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.camera.lookAt(fx, this.focus.y, fz);
    if (this.camera.fov !== this.v.camFov) { this.camera.fov = this.v.camFov; this.camera.updateProjectionMatrix(); }
  }

  /** Snap to the target (first frame, or after a teleport). */
  snap(target: THREE.Vector3) { this.focus.copy(target); this.started = true; }
}
