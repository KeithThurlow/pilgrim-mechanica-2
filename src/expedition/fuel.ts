// Fuel (pure, docs/proposal-expedition.md): it lives in the power pack and is counted in seconds of walking, so the
// HUD's "Fuel 9:20" reads against "Home 3:40" directly. Walking at walk speed burns 1 s per s; slower burns down to
// fuelIdle standing still (almost nothing); faster climbs to fuelSprint at sprint speed; a dash costs fuelDash at
// once; boosting burns fuelBoost per s on top; stripping salvage (the cutters) fuelStrip per s. It never goes below
// zero; at zero the expedition forces a recovery (Keith 2026-10-25: out of fuel is mission failure).
import type { Param } from "../core/tweaks";

export const FUEL_DEFAULTS = {
  fuelMinutes: 14,
  fuelIdle: 0.08,
  fuelSprint: 2.5,
  fuelDash: 4,
  fuelBoost: 5,
  fuelStrip: 0.5,
  warnRatio: 1.3,
  warnPad: 60,
  redPad: 20,
};
export type FuelValues = typeof FUEL_DEFAULTS;

const G = "Fuel";
export const FUEL_PARAMS: Param[] = [
  { key: "fuelMinutes", label: "Pack fuel (min of walking)", min: 2, max: 40, step: 0.5, group: G, tip: "A full power pack, in minutes of walking at walk speed (better packs and tanks later)" },
  { key: "fuelIdle", label: "Standing burn (× walking)", min: 0, max: 1, step: 0.01, group: G, tip: "Burn standing still: almost nothing" },
  { key: "fuelSprint", label: "Sprint burn (× walking)", min: 1, max: 6, step: 0.05, group: G, tip: "Burn at sprint speed (in between it climbs from walking's 1)" },
  { key: "fuelDash", label: "Dash cost (s of walking)", min: 0, max: 20, step: 0.5, group: G },
  { key: "fuelBoost", label: "Boost burn (× walking)", min: 0, max: 20, step: 0.1, group: G, tip: "Extra burn per second while boosting" },
  { key: "fuelStrip", label: "Stripping burn (× walking)", min: 0, max: 3, step: 0.05, group: G, tip: "Extra burn per second while cutting salvage" },
  { key: "warnRatio", label: "Comfortable at (× home time)", min: 1, max: 3, step: 0.05, group: G, tip: "Fuel under home time × this, plus the pad below, turns the HUD amber" },
  { key: "warnPad", label: "Comfortable pad (s)", min: 0, max: 300, step: 5, group: G },
  { key: "redPad", label: "Red under home time + (s)", min: 0, max: 120, step: 1, group: G, tip: "Fuel under home time plus this turns it red: head back now" },
];

/** 0 comfortable, 1 amber (fuel not comfortably above the way home), 2 red (barely enough, or not). */
export function fuelWarning(v: FuelValues, fuelLeft: number, homeEta: number): 0 | 1 | 2 {
  if (!Number.isFinite(homeEta) || fuelLeft < homeEta + v.redPad) return 2;
  if (fuelLeft < homeEta * v.warnRatio + v.warnPad) return 1;
  return 0;
}

/** What the mech is doing this step. */
export interface Burn {
  /** Ground speed (m/s). */
  speed: number;
  walkSpeed: number;
  sprintSpeed: number;
  boosting?: boolean;
  stripping?: boolean;
}

/** Burn rate (seconds of fuel per second) for what the mech is doing. */
export function burnRate(v: FuelValues, b: Burn): number {
  const s = Math.max(0, b.speed), w = Math.max(0.1, b.walkSpeed), sp = Math.max(w + 0.1, b.sprintSpeed);
  let r = s <= w ? v.fuelIdle + (1 - v.fuelIdle) * (s / w) : 1 + (v.fuelSprint - 1) * Math.min(1.5, (s - w) / (sp - w));
  if (b.boosting) r += v.fuelBoost;
  if (b.stripping) r += v.fuelStrip;
  return r;
}

export class Fuel {
  /** Seconds of walking left. */
  left: number;
  /** Burnt since the last refill (s), for the HUD and checks. */
  burnt = 0;

  constructor(public v: FuelValues) { this.left = this.capacity; }

  get capacity() { return this.v.fuelMinutes * 60; }
  get empty() { return this.left <= 0; }
  /** 0..1 of a full pack. */
  get share() { return this.capacity > 0 ? this.left / this.capacity : 0; }

  /** Burn for dt seconds of b. */
  burn(dt: number, b: Burn) { this.spend(burnRate(this.v, b) * Math.max(0, dt)); }

  /** A dash's lump. */
  dash() { this.spend(this.v.fuelDash); }

  spend(seconds: number) {
    const s = Math.max(0, Math.min(this.left, seconds));
    this.left -= s;
    this.burnt += s;
    if (this.left < 1e-9) this.left = 0;
  }

  /** Back to full (aboard the convoy). */
  refill() { this.left = this.capacity; this.burnt = 0; }
}
