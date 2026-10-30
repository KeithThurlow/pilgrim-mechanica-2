// Shoulder gear that isn't a launcher (Keith 2026-10-30; docs/proposal-shoulders.md): feeds and power.
// A feed boosts only its own side's gun, always (the passive: fire rate, spin-up, rounds), and its key does more:
// the belt feed OVERDRIVES the gun (fire rate up for a few seconds), the incendiary feed loads IGNITED rounds (what
// they hit burns for a few seconds, src/game/burn.ts). Power (the capacitor bank) refills the energy bars faster, and
// its key DISCHARGES: bars refilled at once. Every one is a press on its key (not paint-and-release) with a cooldown
// counted from the press.
// Pure maths, no drawing or input: the arsenal (src/weapons/arsenal.ts) presses the key and applies the numbers to the
// mech's guns and energy bars; tools/weapons-check.ts runs it headless. Numbers come from the item's own rolled stats,
// or, for an unrolled base item, the "Shoulder gear" sliders (src/weapons/tuning.ts).
// Round types: add one to RoundType (src/items/bases.ts), give it numbers in `roundsOf` and its effect where the
// round is resolved (src/game/shots.ts).
// Ownership: the player's own state, like the dash; the burn it causes is host state (src/game/burn.ts).
import { SHOULDER_FAMILY, type RoundType, type ShoulderWeapon } from "../items/bases";
import type { WeaponValues } from "./tuning";

/** One piece of gear's numbers. Shares are fractions (0.1 is +10%). */
export interface GearStats {
  weapon: ShoulderWeapon;
  family: "feed" | "power";
  /** Passive, always on: its side's gun fire rate +, spin-up time cut, rounds +; the energy bars' refill speed +. */
  rate: number; spin: number; ammo: number; refill: number;
  /** The key: overdrive's fire rate +, how long the key's effect lasts (s), the cooldown (s, from the press). */
  boost: number; time: number; cooldown: number;
  /** The key loads this round type (null: it overdrives instead), and what it does to a target. */
  round: RoundType | null;
  burnTime: number; burnDps: number;
  /** The key (power): bars refilled at once. */
  bars: number;
}

/** A feed or power item's numbers: its own rolled stats when it has them, else the sliders. */
export function gearStats(weapon: ShoulderWeapon, own: Record<string, number> | null, v: WeaponValues): GearStats {
  const family = SHOULDER_FAMILY[weapon];
  const z = { weapon, family: family === "power" ? "power" : "feed", rate: 0, spin: 0, ammo: 0, refill: 0, boost: 0, time: 0, cooldown: 1, round: null, burnTime: 0, burnDps: 0, bars: 0 } as GearStats;
  const o = own;
  if (weapon === "beltfeed") {
    z.rate = o?.feedRate ?? v.beltRate; z.spin = o?.feedSpin ?? v.beltSpin;
    z.boost = o?.boost ?? v.beltBoost; z.time = o?.effectTime ?? v.beltTime; z.cooldown = o?.cooldown ?? v.beltCooldown;
  } else if (weapon === "incendiary") {
    z.rate = o?.feedRate ?? v.incRate; z.ammo = o?.feedAmmo ?? v.incAmmo;
    z.time = o?.effectTime ?? v.incTime; z.cooldown = o?.cooldown ?? v.incCooldown;
    z.round = "incendiary"; z.burnTime = o?.burnTime ?? v.burnTime; z.burnDps = o?.burnDps ?? v.burnDps;
  } else if (weapon === "capacitor") {
    z.refill = o?.refill ?? v.capRefill; z.bars = Math.max(1, Math.round(o?.dischargeBars ?? v.capBars));
    z.cooldown = o?.cooldown ?? v.capCooldown;
  }
  return z;
}

/** What an ignited round does to what it hits: how long it burns, and its damage per second. */
/** Special rounds loaded by a feed's key. `ap`: armour pierce they add to the gun's (armour-piercing rounds, later). */
export interface RoundSpec { type: RoundType; burnTime: number; burnDps: number; ap?: number }

/** The key's state: a cooldown and, for a feed, the time its effect has left. */
export class GearSim {
  /** Seconds until the key can be pressed again. */
  cool = 0;
  /** Seconds of the key's effect left (overdrive, ignited rounds). */
  left = 0;
  /** Times the key has fired (readouts and checks). */
  presses = 0;

  constructor(public stats: GearStats) {}

  update(dt: number) {
    this.cool = Math.max(0, this.cool - dt);
    this.left = Math.max(0, this.left - dt);
  }

  /** Press the key: true if it fired (it was off cooldown). */
  press(): boolean {
    if (this.cool > 0) return false;
    this.cool = this.stats.cooldown;
    this.left = this.stats.time;
    this.presses++;
    return true;
  }

  /** The overdrive is on. */
  get overdriving() { return this.stats.family === "feed" && this.stats.round === null && this.left > 0; }
  /** The gun's fire rate multiplier from this feed: the passive, and the overdrive while it lasts. */
  get rateMul() { return 1 + this.stats.rate + (this.overdriving ? this.stats.boost : 0); }
  /** The special round loaded now, or null. */
  get rounds(): RoundSpec | null {
    const s = this.stats;
    return s.round && this.left > 0 ? { type: s.round, burnTime: s.burnTime, burnDps: s.burnDps } : null;
  }
}
