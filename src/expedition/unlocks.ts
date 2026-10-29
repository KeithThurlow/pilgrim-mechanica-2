// The convoy grows with scrap (docs/proposal-economy.md, Keith 2026-10-28): it starts small and banked scrap buys
// capabilities, the main scrap sink beside items. Pure data and rules, no UI. First three: extraction pickups (the
// pads do nothing until bought), radar range (3 levels), crane speed (2 levels). Prices, steps and effects are
// sliders. Ownership: host (the convoy's bank pays); the level table is saved with the bay.
import type { Param } from "../core/tweaks";

export const UNLOCK_GROUP = "Convoy unlocks";
export const UNLOCK_DEFAULTS = {
  unlPickup: 250,
  unlRadar1: 120, unlRadar2: 320, unlRadar3: 700,
  unlRadarMul1: 1.3, unlRadarMul2: 1.7, unlRadarMul3: 2.2,
  unlCrane1: 150, unlCrane2: 400,
  unlCraneMul1: 1.35, unlCraneMul2: 1.8,
};
export type UnlockValues = typeof UNLOCK_DEFAULTS;
const G = UNLOCK_GROUP;
export const UNLOCK_PARAMS: Param[] = [
  { key: "unlPickup", label: "Extraction pickups (scrap)", min: 0, max: 2000, step: 10, group: G, tip: "Until bought, the extraction pads do nothing" },
  { key: "unlRadar1", label: "Radar range 1 (scrap)", min: 0, max: 3000, step: 10, group: G },
  { key: "unlRadar2", label: "Radar range 2 (scrap)", min: 0, max: 3000, step: 10, group: G },
  { key: "unlRadar3", label: "Radar range 3 (scrap)", min: 0, max: 3000, step: 10, group: G },
  { key: "unlRadarMul1", label: "Radar range 1 (× range)", min: 1, max: 4, step: 0.05, group: G },
  { key: "unlRadarMul2", label: "Radar range 2 (× range)", min: 1, max: 4, step: 0.05, group: G },
  { key: "unlRadarMul3", label: "Radar range 3 (× range)", min: 1, max: 4, step: 0.05, group: G },
  { key: "unlCrane1", label: "Crane speed 1 (scrap)", min: 0, max: 3000, step: 10, group: G },
  { key: "unlCrane2", label: "Crane speed 2 (scrap)", min: 0, max: 3000, step: 10, group: G },
  { key: "unlCraneMul1", label: "Crane speed 1 (× speed)", min: 1, max: 3, step: 0.05, group: G },
  { key: "unlCraneMul2", label: "Crane speed 2 (× speed)", min: 1, max: 3, step: 0.05, group: G },
];

export type UnlockId = "pickup" | "radar" | "crane";
export interface UnlockDef {
  id: UnlockId;
  label: string;
  tip: string;
  /** Slider keys: one price per level. */
  price: (keyof UnlockValues)[];
  /** Slider keys: the multiplier each level gives (none: a plain switch). */
  mul?: (keyof UnlockValues)[];
}
export const UNLOCKS: UnlockDef[] = [
  { id: "pickup", label: "Extraction pickups", tip: "A quadcopter can lift you off a pad out in the sand, for a fee", price: ["unlPickup"] },
  { id: "radar", label: "Radar range", tip: "The convoy's radar sees further", price: ["unlRadar1", "unlRadar2", "unlRadar3"], mul: ["unlRadarMul1", "unlRadarMul2", "unlRadarMul3"] },
  { id: "crane", label: "Crane speed", tip: "The cranes slew, luff and hoist faster", price: ["unlCrane1", "unlCrane2"], mul: ["unlCraneMul1", "unlCraneMul2"] },
];
export const UNLOCK_BY_ID: Record<string, UnlockDef> = Object.fromEntries(UNLOCKS.map((u) => [u.id, u]));

export type UnlockLevels = Record<string, number>;

export class Unlocks {
  /** Level bought per unlock id. */
  levels: UnlockLevels = {};
  /** Bumped on every change (the lab re-applies the effects when it moves). */
  rev = 0;

  level(id: UnlockId): number { return this.levels[id] ?? 0; }
  maxLevel(id: UnlockId): number { return UNLOCK_BY_ID[id].price.length; }
  has(id: UnlockId): boolean { return this.level(id) > 0; }

  /** Price of the next level, or null at the top. */
  nextPrice(v: UnlockValues, id: UnlockId): number | null {
    const d = UNLOCK_BY_ID[id], l = this.level(id);
    return l >= d.price.length ? null : Math.round(v[d.price[l]]);
  }

  /** Buy the next level out of `bank.scrap`. Returns false (nothing changes) if maxed or too poor. */
  buy(v: UnlockValues, id: UnlockId, bank: { scrap: number }): boolean {
    const p = this.nextPrice(v, id);
    if (p === null || bank.scrap < p) return false;
    bank.scrap -= p;
    this.levels[id] = this.level(id) + 1;
    this.rev++;
    return true;
  }

  /** Every unlock at its top level (?unlock=all). */
  unlockAll() { for (const u of UNLOCKS) this.levels[u.id] = u.price.length; this.rev++; }

  /** The multiplier the unlock gives now (1 at level 0, or for a switch). */
  mul(v: UnlockValues, id: UnlockId): number {
    const d = UNLOCK_BY_ID[id], l = this.level(id);
    return d.mul && l > 0 ? v[d.mul[l - 1]] : 1;
  }

  /** Replace the levels from saved data (unknown ids and bad levels dropped). */
  load(raw: unknown) {
    this.levels = {};
    if (raw && typeof raw === "object") for (const [k, n] of Object.entries(raw as Record<string, unknown>)) {
      const d = UNLOCK_BY_ID[k];
      if (d && typeof n === "number" && n > 0) this.levels[k] = Math.min(d.price.length, Math.floor(n));
    }
    this.rev++;
  }
}
