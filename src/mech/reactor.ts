// The reactor (Keith 2026-11-02: "a movement energy bar or kinetic energy ... separate from reactor energy"): the pool
// energy weapons draw on, kept apart from the kinetic capacitors (the dash's bars, src/mech/dash.ts) so a build can't
// turn big regen into both lots of shooting and lots of dodging. Pure. The hull carries the reactor (its capacity and
// regen are hull stats); the pack carries the kinetic capacitors. A shoulder capacitor bank (power) feeds the reactor.
//   charge 0..reactorCap, in the same units as weapons' "bars" of energy. It refills at reactorRegen per second, slowed
//   to reactorBusy of that while weapons drew on it within the last reactorDelay s (so firing slowly drains it and
//   pausing lets it catch up).
// Ownership: the player's own (their mech).
import type { Param } from "../core/tweaks";

export const REACTOR_DEFAULTS = {
  reactorCap: 4,
  reactorRegen: 0.4,
  reactorBusy: 0.25,
  reactorDelay: 0.6,
};
export type ReactorValues = typeof REACTOR_DEFAULTS;

export const REACTOR_GROUP = "Reactor";
export const REACTOR_PARAMS: Param[] = [
  { key: "reactorCap", label: "Capacity (bars)", min: 0.5, max: 12, step: 0.1, group: REACTOR_GROUP, tip: "What energy weapons draw on; the hull's own value when one is fitted" },
  { key: "reactorRegen", label: "Regen (bars/s)", min: 0, max: 3, step: 0.01, group: REACTOR_GROUP },
  { key: "reactorBusy", label: "Regen while firing (share)", min: 0, max: 1, step: 0.01, group: REACTOR_GROUP, tip: "While energy weapons draw on it the regen runs at this share" },
  { key: "reactorDelay", label: "Counts as firing for (s)", min: 0, max: 3, step: 0.05, group: REACTOR_GROUP },
];

export class Reactor {
  charge: number;
  /** Seconds since a weapon last drew on it. */
  idle = 99;
  /** A shoulder capacitor bank's passive: regen × this. */
  refillMul = 1;

  constructor(public v: ReactorValues) { this.charge = v.reactorCap; }

  /** What it holds when full (EnergyPool.cap: heavy weapons need their shot to fit, src/weapons/energy/energySim.ts). */
  get cap() { return Math.max(0.1, this.v.reactorCap); }
  /** What there is now (the energy weapons' EnergyPool). */
  get energy() { return this.charge; }
  /** Full again (a refit, a resupply). */
  fill() { this.charge = this.cap; }

  /** Spend n or nothing: false when there's less than n. */
  use(n: number): boolean {
    if (n <= 0) return true;
    if (this.charge < n - 1e-9) return false;
    this.charge -= n;
    this.idle = 0;
    return true;
  }

  /** A capacitor bank's discharge: add n at once (up to the cap); returns what it added. */
  refillNow(n: number): number {
    const add = Math.max(0, Math.min(n, this.cap - this.charge));
    this.charge += add;
    return add;
  }

  update(dt: number) {
    const v = this.v;
    this.idle += dt;
    const k = this.idle < v.reactorDelay ? v.reactorBusy : 1;
    this.charge = Math.min(this.cap, this.charge + v.reactorRegen * this.refillMul * k * dt);
  }
}
