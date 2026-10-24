// A slewing, luffing jib crane on a platform (pure, no rendering). Three axes, each driven toward a target with its
// own top speed and acceleration (so it starts and stops smoothly, and those starts and stops set the load swinging):
// slew (turning on its mast, relative to the platform's heading), luff (boom elevation, which sets the working radius)
// and hoist (rope length down to the cradle). The cradle hangs on the rope as a damped 2D pendulum under the jib tip,
// pushed by the tip's acceleration (the crane's own moves and the platform's), and by the rope paying in and out.
// What it reaches for is decided by the carry controller (carry.ts); the crane only moves.
import type { Param } from "../core/tweaks";
import type { Platform } from "./platform";

export const CRANE_DEFAULTS = {
  craneJib: 22,
  craneMast: 3,
  craneMount: 11,
  craneReach: 21.5,
  craneMinReach: 4,
  craneSlew: 16,
  craneSlewAccel: 5,
  craneLuff: 6,
  craneLuffAccel: 4,
  craneHoist: 1.8,
  craneHoistAccel: 1.2,
  craneRopeDamping: 0.12,
  craneSwing: 0.5,
  craneSteady: 0.9,
};
export type CraneValues = typeof CRANE_DEFAULTS;

export const CRANE_PARAMS: Param[] = [
  { key: "craneJib", label: "Jib length (m)", min: 10, max: 40, step: 0.5, group: "Crane" },
  { key: "craneMast", label: "Mast height (m)", min: 1, max: 12, step: 0.5, group: "Crane", tip: "Slewing pivot above the deck" },
  { key: "craneMount", label: "Mount forward (m)", min: -18, max: 18, step: 0.5, group: "Crane", tip: "Where the crane stands along the mech-bay platform" },
  { key: "craneReach", label: "Max reach (m)", min: 8, max: 40, step: 0.5, group: "Crane", tip: "Furthest working radius (capped just under the jib length)" },
  { key: "craneMinReach", label: "Min reach (m)", min: 2, max: 15, step: 0.5, group: "Crane" },
  { key: "craneSlew", label: "Slew (°/s)", min: 2, max: 90, step: 1, group: "Crane motion", tip: "Top speed turning on its mast" },
  { key: "craneSlewAccel", label: "Slew accel (°/s²)", min: 1, max: 90, step: 0.5, group: "Crane motion", tip: "How hard it starts and stops turning (harder swings the load more)" },
  { key: "craneLuff", label: "Luff (°/s)", min: 1, max: 40, step: 0.5, group: "Crane motion", tip: "Top speed raising and lowering the jib (changes the reach)" },
  { key: "craneLuffAccel", label: "Luff accel (°/s²)", min: 0.5, max: 60, step: 0.5, group: "Crane motion" },
  { key: "craneHoist", label: "Hoist (m/s)", min: 0.3, max: 8, step: 0.1, group: "Crane motion", tip: "Top rope speed up and down" },
  { key: "craneHoistAccel", label: "Hoist accel (m/s²)", min: 0.2, max: 10, step: 0.1, group: "Crane motion" },
  { key: "craneRopeDamping", label: "Rope damping (1/s)", min: 0, max: 2, step: 0.01, group: "Crane swing", tip: "How quickly a swing dies down on its own" },
  { key: "craneSwing", label: "Swing strength", min: 0, max: 3, step: 0.05, group: "Crane swing", tip: "How much the jib's and the platform's moves push the load (0 = rigid rope)" },
  { key: "craneSteady", label: "Steadying (1/s)", min: 0, max: 4, step: 0.05, group: "Crane swing", tip: "Extra damping while the crane lowers a load onto its spot (the operator steadying it)" },
];

const D2R = Math.PI / 180;
const G = 9.81;
const MIN_ROPE = 1.2;
const MAX_SWING = 0.7; // radians: a hard stop on the rope angle so nothing runs away
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export interface V3 { x: number; y: number; z: number }

/** One axis: position chases a target with a capped speed and acceleration, braking to arrive without overshoot. */
class Axis {
  vel = 0;
  constructor(public x: number, private angular: boolean) {}
  step(target: number, vmax: number, acc: number, dt: number) {
    const err = this.angular ? wrap(target - this.x) : target - this.x;
    // Speed that still stops in time, toward the target.
    const want = Math.sign(err) * Math.min(vmax, Math.sqrt(2 * acc * Math.abs(err)));
    this.vel += Math.max(-acc * dt, Math.min(acc * dt, want - this.vel));
    let dx = this.vel * dt;
    // Arrive: don't step past the target.
    if (Math.abs(dx) > Math.abs(err) && Math.sign(dx) === Math.sign(err)) { dx = err; this.vel = Math.abs(err) < 1e-4 ? 0 : this.vel; }
    this.x = this.angular ? wrap(this.x + dx) : this.x + dx;
    return this.x;
  }
}

export class Crane {
  /** Slew relative to the platform's heading (radians; 0 = forward, +pi/2 = left). */
  get slew() { return this.aSlew.x; }
  /** Boom elevation (radians). */
  get luff() { return this.aLuff.x; }
  /** Rope length (m). */
  get hoist() { return this.aHoist.x; }
  /** World positions: the slewing pivot on the mast top, the jib tip and the cradle. */
  readonly base: V3 = { x: 0, y: 0, z: 0 };
  readonly tip: V3 = { x: 0, y: 0, z: 0 };
  readonly cradle: V3 = { x: 0, y: 0, z: 0 };
  /** Cradle velocity (m/s). */
  readonly cradleVel: V3 = { x: 0, y: 0, z: 0 };
  /** Rope angle from straight down, toward world +x and +z (radians), and its rate. */
  readonly swing = { x: 0, z: 0, vx: 0, vz: 0 };
  /** Biggest horizontal swing seen (m), for the check. */
  maxSwing = 0;
  /** Extra damping on (the carry sets this while lowering a load onto its spot). */
  steadying = false;
  private aSlew = new Axis(Math.PI, true);
  private aLuff = new Axis(0.6, false);
  private aHoist = new Axis(3, false);
  private slewT = Math.PI;
  private luffT = 0.6;
  private cradleYT: number | null = null;
  private tipVel = { x: 0, z: 0, ok: false };
  private fresh = true;

  constructor(public v: CraneValues, readonly platform: Platform) {
    this.aLuff.x = this.luffT = this.luffFor(18);
    this.place();
  }

  get radius() { return this.v.craneJib * Math.cos(this.luff); }
  /** Furthest working radius. */
  get maxReach() { return Math.min(this.v.craneReach, this.v.craneJib * 0.97); }

  /** Aim: slew (relative to the platform), radius, and the cradle's height (null: rope fully up). */
  aim(slew: number, radius: number, cradleY: number | null) {
    this.slewT = wrap(slew);
    this.luffT = this.luffFor(radius);
    this.cradleYT = cradleY;
  }

  /** Slew and radius that put the jib tip over world (x, z). */
  rel(x: number, z: number) {
    const dx = x - this.base.x, dz = z - this.base.z;
    return { slew: wrap(Math.atan2(dx, dz) - this.platform.heading), radius: Math.hypot(dx, dz) };
  }

  /** Slew and radius to a point on the platform (local left, forward). */
  relLocal(lx: number, lz: number) {
    const dz = lz - this.v.craneMount;
    return { slew: Math.atan2(lx, dz), radius: Math.hypot(lx, dz) };
  }

  /** How far the cradle hangs out from under the tip (m, horizontal). */
  get swingOffset() { return this.hoist * Math.hypot(Math.sin(this.swing.x), Math.sin(this.swing.z)); }
  /** How fast it is swinging (m/s, horizontal). */
  get swingSpeed() { return this.hoist * Math.hypot(this.swing.vx, this.swing.vz); }
  /** The load hangs still: within tol metres of under the tip and barely moving. */
  steady(tol = 0.15) { return this.swingOffset < tol && this.swingSpeed < tol * 1.5; }

  /** True when slew and luff are on target (within tolerances in radians) and the cradle within tolH of its height. */
  settled(tolA = 2 * D2R, tolH = 0.15) {
    const h = this.cradleYT === null ? true : Math.abs(this.ropeWant() - this.hoist) < tolH || this.hoist <= MIN_ROPE + 0.01;
    return Math.abs(wrap(this.slew - this.slewT)) < tolA && Math.abs(this.luff - this.luffT) < tolA && h
      && Math.abs(this.aSlew.vel) < 3 * D2R && Math.abs(this.aLuff.vel) < 3 * D2R;
  }

  step(dt: number) {
    if (dt <= 0) return;
    const v = this.v, px = this.cradle.x, py = this.cradle.y, pz = this.cradle.z;
    const tx = this.tip.x, tz = this.tip.z;
    this.aSlew.step(this.slewT, v.craneSlew * D2R, v.craneSlewAccel * D2R, dt);
    this.aLuff.step(this.luffT, v.craneLuff * D2R, v.craneLuffAccel * D2R, dt);
    this.place(false);
    const ropeBefore = this.hoist;
    this.aHoist.step(this.ropeWant(), v.craneHoist, v.craneHoistAccel, dt);
    const ropeRate = (this.hoist - ropeBefore) / dt;

    // Rope: a damped pendulum hung from the moving tip. The tip's horizontal acceleration pushes it the other way;
    // paying the rope in (shortening) speeds the swing up, paying out slows it (the 2 L'/L term).
    const vx = (this.tip.x - tx) / dt, vz = (this.tip.z - tz) / dt;
    let ax = 0, az = 0;
    if (this.tipVel.ok && !this.fresh) { ax = (vx - this.tipVel.x) / dt; az = (vz - this.tipVel.z) / dt; }
    // Platform teleports (a reset) or a first step: no kick.
    if (Math.hypot(ax, az) > 40) { ax = 0; az = 0; }
    this.tipVel.x = vx; this.tipVel.z = vz; this.tipVel.ok = true;
    const L = Math.max(MIN_ROPE, this.hoist), s = this.swing;
    const damp = v.craneRopeDamping + (this.steadying ? v.craneSteady : 0) + 2 * ropeRate / L;
    s.vx += (-(G / L) * Math.sin(s.x) - damp * s.vx - v.craneSwing * ax * Math.cos(s.x) / L) * dt;
    s.vz += (-(G / L) * Math.sin(s.z) - damp * s.vz - v.craneSwing * az * Math.cos(s.z) / L) * dt;
    s.x += s.vx * dt; s.z += s.vz * dt;
    for (const k of ["x", "z"] as const) {
      const vk = k === "x" ? "vx" : "vz";
      if (Math.abs(s[k]) > MAX_SWING) { s[k] = Math.sign(s[k]) * MAX_SWING; s[vk] = 0; }
      if (!Number.isFinite(s[k]) || !Number.isFinite(s[vk])) { s[k] = 0; s[vk] = 0; }
    }
    this.place();
    this.maxSwing = Math.max(this.maxSwing, this.swingOffset);
    if (!this.fresh) {
      this.cradleVel.x = (this.cradle.x - px) / dt; this.cradleVel.y = (this.cradle.y - py) / dt; this.cradleVel.z = (this.cradle.z - pz) / dt;
    }
    this.fresh = false;
  }

  /** Jump straight to an aim, at rest (lab start-ups). */
  snapTo(slew: number, radius: number, cradleY: number) {
    this.aim(slew, radius, cradleY);
    this.aSlew.x = this.slewT; this.aLuff.x = this.luffT;
    this.place(false);
    this.aHoist.x = this.ropeWant();
    this.calm();
  }

  /** Forget the motion (after the platform jumps, e.g. a restart). */
  calm() {
    const s = this.swing;
    s.x = s.z = s.vx = s.vz = 0;
    this.tipVel.ok = false;
    this.aSlew.vel = this.aLuff.vel = this.aHoist.vel = 0;
    this.maxSwing = 0;
    this.place();
  }

  /** Positions from the platform, the three axes and the swing. */
  place(cradle = true) {
    const p = this.platform, v = this.v;
    p.toWorld(0, p.deck + v.craneMast, v.craneMount, this.base);
    const a = p.heading + this.slew, r = this.radius;
    this.tip.x = this.base.x + Math.sin(a) * r;
    this.tip.y = this.base.y + v.craneJib * Math.sin(this.luff);
    this.tip.z = this.base.z + Math.cos(a) * r;
    if (cradle) {
      const L = this.hoist, sx = Math.sin(this.swing.x), sz = Math.sin(this.swing.z);
      this.cradle.x = this.tip.x + L * sx;
      this.cradle.y = this.tip.y - L * Math.sqrt(Math.max(0, 1 - sx * sx - sz * sz));
      this.cradle.z = this.tip.z + L * sz;
    }
  }

  /** Rope length that puts the (still) cradle at its target height. */
  private ropeWant() {
    return this.cradleYT === null ? MIN_ROPE : Math.max(MIN_ROPE, this.tip.y - this.cradleYT);
  }

  private luffFor(radius: number) {
    const r = Math.max(this.v.craneMinReach, Math.min(this.maxReach, radius));
    return Math.acos(Math.min(1, r / this.v.craneJib));
  }
}
