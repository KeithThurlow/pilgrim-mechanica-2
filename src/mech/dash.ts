// The mech's dash (Keith 2026-10-24: Space dodges or lunges in the WASD direction, on charges). Pure: charges that
// come back one at a time, and a burst whose speed is front-loaded (a hydraulic shove that skids to a stop), plus the
// crouch and lean it puts into the body. The walker skids its planted feet along (walker.push).
// After the shove the mech glides out what's left on its skidding feet until friction stops it; gravity acts along the
// slope, so the glide carries on down a dune face and dies quickly going up one (Keith 2026-10-25 liked the slide).
// Holding Space after the dash no longer boosts (Keith 2026-10-26: "boosted by rockets... not quite what I was after"):
// it carries on into the sprint (src/mech/bound.ts). The booster pack's tank (boostFuel) stays here, refilling between
// uses; the sprint spends it on thrust and glide.
// Energy (Keith 2026-10-27): the charges are bars of energy, each its own bar (a HUD at the side, src/ui/energyBar.ts).
// A dash needs a full bar and empties it; the sprint (only ever out of a held dash) drains the rest slowly, the emptiest
// bar with any left first, so the full ones stay for dashes. Nothing refills while sprinting; otherwise, dashRegenDelay
// after the last use, the bar nearest full refills at one bar per dashRecharge seconds, then the next.
// Ownership: the player's own state (their movement), like the walk.
import type { Param } from "../core/tweaks";

export const DASH_DEFAULTS = {
  dashDistance: 14,
  dashTime: 1.05,
  dashPushShare: 0.44,
  dashCharges: 4,
  dashRecharge: 2.3,
  dashGap: 0.25,
  dashRegenDelay: 0.8,
  sprintDrain: 0.25,
  dashCrouch: 1.2,
  dashLean: 25,
  dashShoveRadius: 4,
  dashShove: 5,
  dashShoveDamage: 6,
  dashDamageCut: 0.5,
  dashSlope: 1.5,
  slideFriction: 5,
  dashCarry: 4,
  slideMax: 16,
  boostFuel: 0,
  boostRegen: 0.35,
};
export type DashValues = typeof DASH_DEFAULTS;

// The shove's shape (distance, time, crouch, lean, glide) no longer moves the mech since the dash became footwork
// (Keith 2026-10-27, src/mech/dashSteps.ts): off the panel; it still times the damage cut and the crowd shove.
const G = "Dash";
export const DASH_PARAMS: Param[] = [
  { key: "dashCharges", label: "Energy bars (charges)", min: 1, max: 8, step: 1, group: G, tip: "A dash empties a full bar; the sprint drains the rest" },
  { key: "dashRecharge", label: "Refill per bar (s)", min: 0.2, max: 15, step: 0.1, group: G },
  { key: "dashRegenDelay", label: "Refill waits after use (s)", min: 0, max: 5, step: 0.05, group: G, tip: "Nothing refills while sprinting" },
  { key: "sprintDrain", label: "Sprint drains (bars/s)", min: 0, max: 2, step: 0.01, group: G, tip: "The sprint only comes out of a held dash, so it needs two bars: one for the dash, then this" },
  { key: "dashGap", label: "Least time between dashes (s)", min: 0, max: 2, step: 0.05, group: G },
  { key: "dashShoveRadius", label: "Shoves small things within (m)", min: 0, max: 10, step: 0.1, group: G, tip: "Bandits and small robots in the way are knocked aside; clingers are shaken off" },
  { key: "dashShove", label: "Shove speed (m/s)", min: 0, max: 30, step: 0.5, group: G },
  { key: "dashShoveDamage", label: "Shove damage", min: 0, max: 50, step: 0.5, group: G },
  { key: "boostFuel", label: "Booster tank (s)", min: 0, max: 10, step: 0.1, group: G, tip: "0 without a booster pack. With one, the sprint burns it for more top speed and a glide off jumps (Sprint kit)" },
  { key: "boostRegen", label: "Booster refill per second", min: 0, max: 3, step: 0.05, group: G, tip: "While not sprinting" },
  { key: "dashDamageCut", label: "Damage taken while dashing ×", min: 0, max: 1, step: 0.05, group: G },
];

/** The shove's speed shape over its time (0..1): rising over the push share a, then (1 - u)^2. */
function shape(u: number, a: number) {
  const r = a > 1e-4 ? Math.min(1, u / a) : 1;
  return (1 - u) * (1 - u) * r * r * (3 - 2 * r);
}
const areas = new Map<number, number>();
/** Its area over 0..1 (so any push share covers the same distance). */
function shapeArea(a: number) {
  let s = areas.get(a);
  if (s === undefined) { s = 0; for (let i = 0; i < 200; i++) s += shape((i + 0.5) / 200, a) / 200; areas.set(a, s); }
  return s;
}

export class Dash {
  /** Each bar's energy, 0..1 (a full bar is a dash). */
  bars: number[] = [];
  /** Dashes started (the expedition charges fuel per dash). */
  dashes = 0;
  /** Seconds since energy was last spent (a dash or the sprint). */
  idle = 99;
  /** The sprint is draining this frame (nothing refills). */
  draining = false;
  /** Seconds into the current dash; -1 when not dashing. */
  t = -1;
  since = 99;
  dirX = 0;
  dirZ = 1;
  /** After the shove: "glide" until friction stops it. */
  phase: "dash" | "glide" | "none" = "none";
  /** Speed carried into the glide (m/s), along dir. */
  speed = 0;
  /** The booster pack's tank (s): spent by the sprint (src/mech/bound.ts), refilling while not in use. */
  fuel = 0;
  /** The sprint is drawing on the tank this frame (no refill). */
  boosting = false;
  /** This frame's shove velocity (world, m/s), crouch (m) and lean (radians, along and across the dash). */
  vx = 0;
  vz = 0;
  crouch = 0;
  lean = 0;

  constructor(public v: DashValues) { this.charges = v.dashCharges; }

  /** Full bars: dashes in hand. Setting it fills that many bars (the rest empty), sized to dashCharges. */
  get charges() { return this.bars.filter((b) => b >= 0.999).length; }
  set charges(n: number) {
    const max = Math.max(1, Math.round(this.v.dashCharges));
    this.bars = Array.from({ length: max }, (_, i) => (i < n ? 1 : 0));
  }
  /** All the energy there is (bars). */
  get energy() { return this.bars.reduce((a, b) => a + b, 0); }
  /** The bar refilling now (index, or -1), and how far it's come (the HUD). */
  get refilling() { let k = -1; for (let i = 0; i < this.bars.length; i++) if (this.bars[i] < 0.999 && (k < 0 || this.bars[i] > this.bars[k])) k = i; return k; }
  get refillShare() { const k = this.refilling; return k < 0 ? 0 : this.bars[k]; }

  /**
   * The sprint drains energy (sprintDrain bars per second): the emptiest bar with any left first. False when there's
   * none left (the sprint ends).
   */
  drain(dt: number): boolean {
    let k = -1;
    for (let i = 0; i < this.bars.length; i++) if (this.bars[i] > 1e-6 && (k < 0 || this.bars[i] < this.bars[k])) k = i;
    if (k < 0) return false;
    this.bars[k] = Math.max(0, this.bars[k] - this.v.sprintDrain * dt);
    this.draining = true; this.idle = 0;
    return true;
  }

  /** Skidding on its feet: the shove or the glide after it. */
  get active() { return this.phase !== "none"; }
  /** The shove itself (damage cut, the sand burst). */
  get shoving() { return this.phase === "dash"; }

  /** Try to dash along (x, z) (any length); returns true if it started. */
  start(x: number, z: number): boolean {
    const l = Math.hypot(x, z);
    // A dash can follow another at once, as soon as dashGap has passed (Keith 2026-10-27: the one instant change of way).
    if (l < 1e-4 || this.charges < 1 || this.since < this.v.dashGap) return false;
    this.dirX = x / l; this.dirZ = z / l;
    // A full bar empties (the last full one, so the bars read down from the top).
    for (let i = this.bars.length - 1; i >= 0; i--) if (this.bars[i] >= 0.999) { this.bars[i] = 0; break; }
    this.dashes++; this.idle = 0;
    this.t = 0;
    this.speed = 0;
    this.phase = "dash";
    this.since = 0;
    return true;
  }

  /** End the glide now (the sprint takes over the speed). */
  stop() { if (this.phase === "glide") { this.phase = "none"; this.speed = 0; } }
  /** End the shove or the glide now: held into the sprint, the push-off is the run's first stride. */
  cut() { this.phase = "none"; this.t = -1; this.speed = 0; this.vx = this.vz = this.crouch = this.lean = 0; }

  /** grade: the ground's rise per metre along the dash's direction (+ uphill). */
  update(dt: number, grade = 0) {
    const v = this.v;
    this.since += dt;
    this.fuel = Math.min(v.boostFuel, this.fuel + (this.boosting ? 0 : v.boostRegen * dt));
    // Bars: as many as dashCharges (a pack or a slider changing it adds empty ones or drops the last).
    const max = Math.max(1, Math.round(v.dashCharges));
    while (this.bars.length < max) this.bars.push(0);
    if (this.bars.length > max) this.bars.length = max;
    if (this.draining) this.idle = 0; else this.idle += dt;
    this.draining = false;
    if (this.idle >= v.dashRegenDelay) {
      const k = this.refilling;
      if (k >= 0) this.bars[k] = Math.min(1, this.bars[k] + dt / Math.max(0.05, v.dashRecharge));
    }
    this.vx = this.vz = this.crouch = this.lean = 0;
    if (!this.active) return;
    const g = 9.8 * v.dashSlope * grade; // slows uphill (+ grade), speeds downhill
    if (this.phase === "dash") {
      this.t += dt;
      const T = Math.max(0.05, v.dashTime);
      const u = this.t / T;
      // Speed (1 - u)^2 covers dashDistance over T when its peak is 3D/T; the push-off builds it up over dashPushShare
      // first (the integral keeps the distance); the slope adds or takes its share.
      const a = Math.max(0, v.dashPushShare);
      const s0 = (v.dashDistance / T) * shape(u, a) / shapeArea(a);
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
        this.phase = this.speed > 0.5 ? "glide" : "none";
      }
      return;
    }
    // Glide: friction and the slope take it down.
    this.speed -= (v.slideFriction + g) * dt;
    if (this.speed < 0.6) { this.speed = 0; this.phase = "none"; return; }
    this.speed = Math.min(v.slideMax, Math.max(0, this.speed));
    this.vx = this.dirX * this.speed; this.vz = this.dirZ * this.speed;
    const k = Math.min(1, this.speed / 13);
    this.crouch = v.dashCrouch * 0.6 * k;
    this.lean = (v.dashLean * Math.PI / 180) * 0.5 * k;
  }

}
