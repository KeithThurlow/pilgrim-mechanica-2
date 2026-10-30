// Armour and armour pierce (docs/proposal-balance.md section 4, Keith 2026-10-30/31): one rule for every hit in the
// game, whoever fires and whatever is hit. Pure.
//
//   damage taken = max(floor × d, d − A × (1 − ap))
//
// A is the target's armour (flat, per hit; per kind or part: a cutter 3, an excavator 10, a mech's hull 8), ap the
// hit's armour pierce 0..1 (the share of the armour it ignores: rails 0.8-0.9, rockets 0.6, miniguns 0-0.25). Many
// small hits lose most of their damage on armour; big hits barely notice. The floor keeps every hit worth something.
// Pierce is not penetration (src/game/sheet.ts: how many bodies a round passes through, in metres).
//
// Hits that name no pierce (bites, saws, stomps, raider small arms, burns) ignore armour (UNSET_PIERCE = 1): the
// swarm's danger is its numbers, and burn is the small guns' answer to armour (Claude's call 2026-10-31). Room for
// armour-piercing rounds later: a feed's round type adds to the gun's pierce (src/weapons/gear.ts RoundSpec.ap).
import type { Param } from "../core/tweaks";

export const ARMOUR_DEFAULTS = {
  /** A hit keeps at least this share of its damage through any armour. */
  armourFloor: 0.15,
};
export type ArmourValues = typeof ARMOUR_DEFAULTS;

export const ARMOUR_PARAMS: Param[] = [
  { key: "armourFloor", label: "Armour: share a hit always keeps", min: 0, max: 1, step: 0.01, group: "Armour", tip: "damage taken = max(this × hit, hit − armour × (1 − pierce)): small rounds on heavy armour keep this much" },
];

/** What a hit that names no pierce is: armour-ignoring (bites, saws, stomps, burns). */
export const UNSET_PIERCE = 1;

/** The live rule (the battlefield copies its slider in each frame, so every adapter shares one floor). */
export const armourRule = { floor: ARMOUR_DEFAULTS.armourFloor };

/** Damage a hit of `d` does through armour `A` with armour pierce `ap` (0..1). */
export function armourHit(d: number, A: number, ap: number = UNSET_PIERCE, floor = armourRule.floor): number {
  if (!(A > 0) || !(d > 0)) return d;
  const p = ap < 0 ? 0 : ap > 1 ? 1 : ap;
  return Math.max(floor * d, d - A * (1 - p));
}
