// Item levels (Keith 2026-10-28): every item has a level, separate from its rarity. Deeper drops roll higher levels
// (src/expedition/drops.ts), and the level scales the stat rolls: each level above 1 moves a stat toward better by
// `levelGrowth` of its value, times the stat's weight here (1: the stats that are the item's strength, 0.5: handling
// and speed, missing: shapes and counts that shouldn't grow, such as stride, arc and spread). Items saved before levels
// have none: they are level 1.
import { STATS } from "./bases";
import type { Item } from "./item";

/** How much each stat grows with level (missing: not at all). */
export const LEVEL_WEIGHT: Record<string, number> = {
  damage: 1, hull: 1, carry: 1, carryBonus: 1, radarRange: 0.5, boostFuel: 1, ammoPerGun: 1, salvage: 1, blast: 0.5, splash: 0.5,
  range: 0.3, fireRate: 0.5, walkSpeed: 0.25, sprintSpeed: 0.25, accel: 0.5, torsoTurnRate: 0.5, track: 0.5, handling: 0.5,
  cooldown: 0.5, dashRecharge: 0.5, charge: 0.5, spinUp: 0.5, impact: 0.5,
};

export const levelOf = (item: { level?: number }) => Math.max(1, item.level ?? 1);

/** The multiplier a level puts on a stat (below 1 for lower-is-better stats). */
export function levelMul(stat: string, level: number, growth: number): number {
  const w = LEVEL_WEIGHT[stat] ?? 0;
  if (!w || level <= 1) return 1;
  const g = 1 + growth * w * (level - 1);
  return (STATS[stat]?.better ?? 1) > 0 ? g : 1 / g;
}

/** The fixed default parts and old saves: level 1. */
export function withLevel(item: Item): Item { if (item.level === undefined) item.level = 1; return item; }
