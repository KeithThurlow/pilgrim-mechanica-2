// The mech's dash (Keith 2026-10-24: Space dodges or lunges in the WASD direction, on charges). Pure: charges that
// come back one at a time, and a burst whose speed is front-loaded (a hydraulic shove that skids to a stop), plus the
// crouch and lean it puts into the body. The walker skids its planted feet along (walker.push).
import type { Param } from "../core/tweaks";

export const DASH_DEFAULTS = {
  dashDistance: 9,
  dashTime: 0.45,
  dashCharges: 2,
  dashRecharge: 3,
  dashGap: 0.25,
  dashCrouch: 0.35,
  dashLean: 9,
  dashShoveRadius: 4,
  dashShove: 10,
  dashShoveDamage: 6,
  dashDamageCut: 0.5,
};
export type DashValues = typeof DASH_DEFAULTS;

const G = "Dash";
export const DASH_PARAMS: Param[] = [
  { key: "dashDistance", label: "Distance (m)", min: 2, max: 25, step: 0.5, group: G },
  { key: "dashTime", label: "Time (s)", min: 0.15, max: 1.2, step: 0.01, group: G, tip: "The shove is front-loaded: most of the distance in the first half, then it skids to a stop" },
  { key: "dashCharges", label: "Charges", min: 1, max: 5, step: 1, group: G },
  { key: "dashRecharge", label: "Recharge per charge (s)", min: 0.2, max: 15, step: 0.1, group: G },
  { key: "dashGap", label: "Least time between dashes (s)", min: 0, max: 2, step: 0.05, group: G },
  { key: "dashCrouch", label: "Crouch into it (m)", min: 0, max: 1.2, step: 0.01, group: G },
  { key: "dashLean", label: "Lean into it (°)", min: 0, max: 25, step: 0.5, group: G },
  { key: "dashShoveRadius", label: "Shoves small things within (m)", min: 0, max: 10, step: 0.1, group: G, tip: "Bandits and small robots in the way are knocked aside; clingers are shaken off" },
  { key: "dashShove", label: "Shove speed (m/s)", min: 0, max: 30, step: 0.5, group: G },
  { key: "dashShoveDamage", label: "Shove damage", min: 0, max: 50, step: 0.5, group: G },
  { key: "dashDamageCut", label: "Damage taken while dashing ×", min: 0, max: 1, step: 0.05, group: G },
];

export class Dash {
  charges: number;
  /** Seconds into the current charge's refill. */
  refill = 0;
  /** Seconds into the current dash; -1 when not dashing. */
  t = -1;
  since = 99;
  dirX = 0;
  dirZ = 1;
  /** This frame's shove velocity (world, m/s), crouch (m) and lean (radians, along and across the dash). */
  vx = 0;
  vz = 0;
  crouch = 0;
  lean = 0;

  constructor(public v: DashValues) { this.charges = v.dashCharges; }

  get active() { return this.t >= 0; }

  /** Try to dash along (x, z) (any length); returns true if it started. */
  start(x: number, z: number): boolean {
    const l = Math.hypot(x, z);
    if (l < 1e-4 || this.charges < 1 || this.active || this.since < this.v.dashGap) return false;
    this.dirX = x / l; this.dirZ = z / l;
    this.charges--;
    this.t = 0;
    this.since = 0;
    return true;
  }

  update(dt: number) {
    const v = this.v;
    this.since += dt;
    const max = Math.max(1, Math.round(v.dashCharges));
    if (this.charges > max) this.charges = max;
    if (this.charges < max) {
      this.refill += dt;
      if (this.refill >= v.dashRecharge) { this.refill -= v.dashRecharge; this.charges++; }
    } else this.refill = 0;
    this.vx = this.vz = this.crouch = this.lean = 0;
    if (!this.active) return;
    this.t += dt;
    const T = Math.max(0.05, v.dashTime);
    const u = this.t / T;
    if (u >= 1) { this.t = -1; return; }
    // Speed (1 - u)^2 covers dashDistance over T when its peak is 3D/T.
    const s = (3 * v.dashDistance / T) * (1 - u) * (1 - u);
    this.vx = this.dirX * s; this.vz = this.dirZ * s;
    const bump = Math.sin(Math.PI * Math.min(1, u * 1.3));
    this.crouch = v.dashCrouch * bump;
    this.lean = (v.dashLean * Math.PI / 180) * bump;
  }

  /** How far the charge in refill has come (0..1), for the HUD. */
  get refillShare() { return this.refill / Math.max(0.01, this.v.dashRecharge); }
}
