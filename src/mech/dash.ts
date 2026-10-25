// The mech's dash (Keith 2026-10-24: Space dodges or lunges in the WASD direction, on charges). Pure: charges that
// come back one at a time, and a burst whose speed is front-loaded (a hydraulic shove that skids to a stop), plus the
// crouch and lean it puts into the body. The walker skids its planted feet along (walker.push).
// Boost and slide (Keith 2026-10-25: "really enjoying how the sliding thing works"; a boost item to slide around on,
// better downhill than uphill): with boost fuel (a booster pack), holding Space after the dash keeps thrusting,
// steered by WASD; let go (or run dry) and the mech glides on its skidding feet until friction stops it. Gravity acts
// along the slope throughout, so a slide carries on down a dune face and dies quickly going up one.
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
  dashSlope: 1.5,
  slideFriction: 5,
  dashCarry: 4,
  slideMax: 16,
  boostFuel: 0,
  boostRegen: 0.35,
  boostSpeed: 13,
  boostThrust: 5,
  boostTurn: 70,
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
  { key: "dashSlope", label: "Slope pull on a slide (× gravity)", min: 0, max: 2, step: 0.05, group: G, tip: "Downhill a dash or slide speeds up, uphill it dies: the share of gravity along the slope" },
  { key: "dashCarry", label: "Speed carried into the slide (m/s)", min: 0, max: 12, step: 0.1, group: G, tip: "What's left of the shove when it ends: the mech glides on from there, further downhill, hardly at all uphill" },
  { key: "slideMax", label: "Top slide speed (m/s)", min: 4, max: 40, step: 0.5, group: G, tip: "A slide down a steep face can't build past this" },
  { key: "slideFriction", label: "Slide friction (m/s²)", min: 0.5, max: 30, step: 0.5, group: G, tip: "How fast a glide stops on the flat once the shove or boost is over" },
  { key: "boostFuel", label: "Boost fuel (s)", min: 0, max: 10, step: 0.1, group: G, tip: "0 without a booster pack. With fuel, hold Space after a dash to keep thrusting and slide around" },
  { key: "boostRegen", label: "Boost fuel back per second", min: 0, max: 3, step: 0.05, group: G },
  { key: "boostSpeed", label: "Boost speed (m/s)", min: 4, max: 30, step: 0.5, group: G },
  { key: "boostThrust", label: "Boost thrust (1/s)", min: 0.5, max: 20, step: 0.1, group: G, tip: "How quickly the boost brings the slide up to boost speed" },
  { key: "boostTurn", label: "Boost steering (°/s)", min: 5, max: 360, step: 1, group: G },
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
  /** After the shove: "boost" while Space is held and fuel lasts, then "glide" until friction stops it. */
  phase: "dash" | "boost" | "glide" | "none" = "none";
  /** Speed carried into the boost and glide (m/s), along dir. */
  speed = 0;
  fuel = 0;
  /** This frame's shove velocity (world, m/s), crouch (m) and lean (radians, along and across the dash). */
  vx = 0;
  vz = 0;
  crouch = 0;
  lean = 0;

  constructor(public v: DashValues) { this.charges = v.dashCharges; }

  /** Skidding on its feet: the shove, a boost or a glide. */
  get active() { return this.phase !== "none"; }
  /** The shove itself (damage cut, the sand burst). */
  get shoving() { return this.phase === "dash"; }

  /** Try to dash along (x, z) (any length); returns true if it started. */
  start(x: number, z: number): boolean {
    const l = Math.hypot(x, z);
    if (l < 1e-4 || this.charges < 1 || this.active || this.since < this.v.dashGap) return false;
    this.dirX = x / l; this.dirZ = z / l;
    this.charges--;
    this.t = 0;
    this.speed = 0;
    this.phase = "dash";
    this.since = 0;
    return true;
  }

  /**
   * hold: Space still down. steerX, steerZ: the stick (world) to steer a boost. grade: the ground's rise per metre
   * along the slide's direction (+ uphill).
   */
  update(dt: number, hold = false, steerX = 0, steerZ = 0, grade = 0) {
    const v = this.v;
    this.since += dt;
    this.fuel = Math.min(v.boostFuel, this.fuel + (this.phase === "boost" ? 0 : v.boostRegen * dt));
    const max = Math.max(1, Math.round(v.dashCharges));
    if (this.charges > max) this.charges = max;
    if (this.charges < max) {
      this.refill += dt;
      if (this.refill >= v.dashRecharge) { this.refill -= v.dashRecharge; this.charges++; }
    } else this.refill = 0;
    this.vx = this.vz = this.crouch = this.lean = 0;
    if (!this.active) return;
    const g = 9.8 * v.dashSlope * grade; // slows uphill (+ grade), speeds downhill
    if (this.phase === "dash") {
      this.t += dt;
      const T = Math.max(0.05, v.dashTime);
      const u = this.t / T;
      // Speed (1 - u)^2 covers dashDistance over T when its peak is 3D/T; the slope adds or takes its share.
      const s0 = (3 * v.dashDistance / T) * (1 - u) * (1 - u);
      // The slope's share builds up as a signed extra speed: uphill it eats into the shove, downhill it adds.
      this.speed -= g * dt;
      const s = Math.max(0, s0 + this.speed);
      this.vx = this.dirX * s; this.vz = this.dirZ * s;
      const bump = Math.sin(Math.PI * Math.min(1, u * 1.3));
      this.crouch = v.dashCrouch * bump;
      this.lean = (v.dashLean * Math.PI / 180) * bump;
      if (u >= 1) {
        this.t = -1;
        this.speed = Math.max(0, this.speed + v.dashCarry);
        // Carry on: boost while held and fuelled, else glide out what the slope gave.
        this.phase = hold && this.fuel > 0.05 ? "boost" : this.speed > 0.5 ? "glide" : "none";
      }
      return;
    }
    if (this.phase === "boost") {
      if (!hold || this.fuel <= 0) this.phase = "glide";
      else {
        this.fuel = Math.max(0, this.fuel - dt);
        // Steer toward the stick at a capped rate.
        if (steerX * steerX + steerZ * steerZ > 0.01) {
          const want = Math.atan2(steerX, steerZ), cur = Math.atan2(this.dirX, this.dirZ);
          let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
          const m = (v.boostTurn * Math.PI / 180) * dt, a = cur + Math.max(-m, Math.min(m, d));
          this.dirX = Math.sin(a); this.dirZ = Math.cos(a);
        }
        this.speed += (v.boostSpeed - this.speed) * Math.min(1, v.boostThrust * dt) - g * dt;
      }
    }
    if (this.phase === "glide") {
      this.speed -= (v.slideFriction + g) * dt;
      if (this.speed < 0.6) { this.speed = 0; this.phase = "none"; return; }
    }
    this.speed = Math.min(v.slideMax, Math.max(0, this.speed));
    this.vx = this.dirX * this.speed; this.vz = this.dirZ * this.speed;
    const k = Math.min(1, this.speed / Math.max(1, v.boostSpeed));
    this.crouch = v.dashCrouch * 0.6 * k;
    this.lean = (v.dashLean * Math.PI / 180) * 0.5 * k;
  }

  /** How far the charge in refill has come (0..1), for the HUD. */
  get refillShare() { return this.refill / Math.max(0.01, this.v.dashRecharge); }
}
