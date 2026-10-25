// Rarity (Keith 2026-10-25): five tiers, Common to Legendary, with 0-4 Protocol sockets. Rarer items roll wilder:
// each tier widens a stat's range both ways (stronger, but not always better) and lifts its middle a little toward
// better. How much is tuning (LOOT_PARAMS in generate.ts).

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export interface RarityInfo {
  name: string;
  /** Label colour. */
  color: string;
  sockets: number;
}

export const RARITY: Record<Rarity, RarityInfo> = {
  common: { name: "Common", color: "#c9c4b8", sockets: 0 },
  uncommon: { name: "Uncommon", color: "#7fcf6b", sockets: 1 },
  rare: { name: "Rare", color: "#5aa8f0", sockets: 2 },
  epic: { name: "Epic", color: "#b979f0", sockets: 3 },
  legendary: { name: "Legendary", color: "#f0a43a", sockets: 4 },
};

/** 0 for Common up to 4 for Legendary. */
export const tierOf = (r: Rarity) => RARITIES.indexOf(r);

export interface WidenTuning {
  /** Each tier above Common widens a stat's roll by this share of its Common width. */
  rarityWiden: number;
  /** Each tier above Common moves the middle of a roll toward better by this share of its Common width (below
   *  rarityWiden, a rarer range still reaches past the Common one both ways). */
  rarityLift: number;
}

/**
 * The range a stat rolls in, as multipliers of its base value: base spread `spread` each way at Common, widened by
 * rarity, middle lifted toward `better` (+1 higher is better, -1 lower is better).
 */
export function rollRange(spread: number, better: 1 | -1, rarity: Rarity, t: WidenTuning): [number, number] {
  const k = tierOf(rarity);
  const half = spread * (1 + t.rarityWiden * k);
  const mid = 1 + better * t.rarityLift * spread * k;
  return [mid - half, mid + half];
}
