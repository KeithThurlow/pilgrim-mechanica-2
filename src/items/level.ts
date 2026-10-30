// Item levels (Keith 2026-10-28): every item has a level, separate from its rarity. Deeper drops roll higher levels
// (src/expedition/drops.ts), and the level scales the stat rolls: each level above 1 moves a stat toward better by
// `levelGrowth` of its value, times the stat's weight here (1: the stats that are the item's strength, 0.5: handling
// and speed, missing: shapes and counts that shouldn't grow, such as stride, arc and spread). Items saved before levels
// have none: they are level 1.
import { STATS } from "./bases";
import type { Item } from "./item";

/**
 * How much each stat grows with level (missing: not at all). Balance pass (2026-10-31, docs/proposal-balance.md
 * section 6): one power curve for items and enemies, P(n) = 1 + levelGrowth × (n − 1), on an item's damage (so its
 * DPS) and hull; rate, cooldowns, handling and speed don't change with level (feel stays put); a few utility stats grow
 * by part of it (about their old 4%-a-level pace).
 */
export const LEVEL_WEIGHT: Record<string, number> = {
  damage: 1, hull: 1, burnDps: 1, armour: 0.5, carry: 0.5, carryBonus: 0.5, radarRange: 0.25, boostFuel: 0.5, salvage: 0.5,
  blast: 0.15, splash: 0.15, range: 0.1, magazine: 0.25,
};

/** The power curve's multiplier at a level (items' damage and hull; enemies' health and damage at an area level). */
export const levelPower = (level: number, growth: number) => 1 + growth * Math.max(0, level - 1);

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
