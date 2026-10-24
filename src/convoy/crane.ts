// A slewing, luffing jib crane on a platform (pure, no rendering). Three axes, each driven toward a target at its
// own rate: slew (turning on its mast, relative to the platform's heading), luff (boom elevation, which sets the
// working radius) and hoist (rope length down to the cradle). The cradle hangs straight down from the jib tip.
// What it reaches for is decided by the carry controller (carry.ts); the crane only moves.
import type { Param } from "../core/tweaks";
import type { Platform } from "./platform";

export const CRANE_DEFAULTS = {
  craneJib: 22,
  craneMast: 3,
  craneMount: 11,
  craneReach: 21.5,
  craneMinReach: 6,
  craneSlew: 30,
  craneLuff: 12,
  craneHoist: 3,
};
export type CraneValues = typeof CRANE_DEFAULTS;

export const CRANE_PARAMS: Param[] = [
  { key: "craneJib", label: "Jib length (m)", min: 10, max: 40, step: 0.5, group: "Crane" },
  { key: "craneMast", label: "Mast height (m)", min: 1, max: 12, step: 0.5, group: "Crane", tip: "Slewing pivot above the deck" },
  { key: "craneMount", label: "Mount forward (m)", min: -18, max: 18, step: 0.5, group: "Crane", tip: "Where the crane stands along the mech-bay platform" },
  { key: "craneReach", label: "Max reach (m)", min: 8, max: 40, step: 0.5, group: "Crane", tip: "Furthest working radius (capped just under the jib length)" },
  { key: "craneMinReach", label: "Min reach (m)", min: 2, max: 15, step: 0.5, group: "Crane" },
  { key: "craneSlew", label: "Slew (°/s)", min: 5, max: 90, step: 1, group: "Crane", tip: "How fast it turns on its mast" },
  { key: "craneLuff", label: "Luff (°/s)", min: 2, max: 40, step: 0.5, group: "Crane", tip: "How fast the jib raises and lowers (changes the reach)" },
  { key: "craneHoist", label: "Hoist (m/s)", min: 0.5, max: 8, step: 0.1, group: "Crane", tip: "Rope speed up and down" },
];

const D2R = Math.PI / 180;
const MIN_ROPE = 1.2;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const toward = (x: number, t: number, max: number) => x + Math.max(-max, Math.min(max, t - x));

export interface V3 { x: number; y: number; z: number }

export class Crane {
  /** Slew relative to the platform's heading (radians; 0 = forward, +pi/2 = left). */
  slew = Math.PI;
  /** Boom elevation (radians). */
  luff = 0.6;
  /** Rope length (m). */
  hoist = 3;
  /** World positions: the slewing pivot on the mast top, the jib tip and the cradle. */
  readonly base: V3 = { x: 0, y: 0, z: 0 };
  readonly tip: V3 = { x: 0, y: 0, z: 0 };
  readonly cradle: V3 = { x: 0, y: 0, z: 0 };
  /** Cradle velocity (m/s). */
  readonly cradleVel: V3 = { x: 0, y: 0, z: 0 };
  /** Targets. */
  private slewT = Math.PI;
  private luffT = 0.6;
  private cradleYT: number | null = null;
  private fresh = true;

  constructor(public v: CraneValues, readonly platform: Platform) {
    this.luff = this.luffT = this.luffFor(18);
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

  /** Slew and radius that put the cradle over world (x, z). */
  rel(x: number, z: number) {
    const dx = x - this.base.x, dz = z - this.base.z;
    return { slew: wrap(Math.atan2(dx, dz) - this.platform.heading), radius: Math.hypot(dx, dz) };
  }

  /** Slew and radius to a point on the platform (local left, forward). */
  relLocal(lx: number, lz: number) {
    const dz = lz - this.v.craneMount;
    return { slew: Math.atan2(lx, dz), radius: Math.hypot(lx, dz) };
  }

  /** True when slew and luff are on target (within tolerances in radians) and the cradle within tolH of its height. */
  settled(tolA = 2 * D2R, tolH = 0.15) {
    const h = this.cradleYT === null ? true : Math.abs(this.cradle.y - this.cradleYT) < tolH || this.hoist <= MIN_ROPE + 0.01;
    return Math.abs(wrap(this.slew - this.slewT)) < tolA && Math.abs(this.luff - this.luffT) < tolA && h;
  }

  step(dt: number) {
    const v = this.v, px = this.cradle.x, py = this.cradle.y, pz = this.cradle.z;
    this.slew = wrap(this.slew + Math.max(-v.craneSlew * D2R * dt, Math.min(v.craneSlew * D2R * dt, wrap(this.slewT - this.slew))));
    this.luff = toward(this.luff, this.luffT, v.craneLuff * D2R * dt);
    this.place(false);
    const want = this.cradleYT === null ? MIN_ROPE : Math.max(MIN_ROPE, this.tip.y - this.cradleYT);
    this.hoist = toward(this.hoist, want, v.craneHoist * dt);
    this.place();
    if (!this.fresh && dt > 0) {
      this.cradleVel.x = (this.cradle.x - px) / dt; this.cradleVel.y = (this.cradle.y - py) / dt; this.cradleVel.z = (this.cradle.z - pz) / dt;
    }
    this.fresh = false;
  }

  /** Positions from the platform and the three axes. */
  place(cradle = true) {
    const p = this.platform, v = this.v;
    p.toWorld(0, p.deck + v.craneMast, v.craneMount, this.base);
    const a = p.heading + this.slew, r = this.radius;
    this.tip.x = this.base.x + Math.sin(a) * r;
    this.tip.y = this.base.y + v.craneJib * Math.sin(this.luff);
    this.tip.z = this.base.z + Math.cos(a) * r;
    if (cradle) { this.cradle.x = this.tip.x; this.cradle.y = this.tip.y - this.hoist; this.cradle.z = this.tip.z; }
  }

  private luffFor(radius: number) {
    const r = Math.max(this.v.craneMinReach, Math.min(this.maxReach, radius));
    return Math.acos(Math.min(1, r / this.v.craneJib));
  }
}
