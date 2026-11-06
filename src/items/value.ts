// What an item is worth in scrap (Keith 2026-11-01: sort the inventory by scrap value). Pure. Nothing buys or breaks
// items down yet; this is the number the inventory sorts and shows, and what a scrapping or selling step would pay.
//   value = valueBase × valueRarity^tier × (1 + valuePerLevel × (level − 1)) × (1 + valuePerTonne × weight)
//           + the same for each socketed Protocol (its own rarity, level 1, no weight)
import type { Param } from "../core/tweaks";
import { tierOf } from "./rarity";
import { levelOf } from "./level";
import type { Item } from "./item";

export const VALUE_DEFAULTS = { valueBase: 10, valueRarity: 2.5, valuePerLevel: 0.08, valuePerTonne: 0.1 };
export type ValueValues = typeof VALUE_DEFAULTS;
const G = "Item value";
export const VALUE_PARAMS: Param[] = [
  { key: "valueBase", label: "Scrap value: Common level 1", min: 1, max: 200, step: 1, group: G, tip: "What a weightless Common level 1 item is worth in scrap (shown and sorted in the inventory; nothing pays it out yet)" },
  { key: "valueRarity", label: "Scrap value × per rarity tier", min: 1, max: 6, step: 0.1, group: G, tip: "2.5: Uncommon 2.5×, Rare 6×, Epic 16×, Legendary 39×, Mythic 98×" },
  { key: "valuePerLevel", label: "Scrap value + per level", min: 0, max: 0.5, step: 0.01, group: G, tip: "Share added per item level over 1" },
  { key: "valuePerTonne", label: "Scrap value + per tonne", min: 0, max: 1, step: 0.01, group: G, tip: "Heavier parts hold more steel" },
];

export function itemValue(it: Item, v: ValueValues = VALUE_DEFAULTS): number {
  const own = v.valueBase * Math.pow(v.valueRarity, tierOf(it.rarity)) * (1 + v.valuePerLevel * (levelOf(it) - 1)) * (1 + v.valuePerTonne * Math.max(0, it.weight));
  return Math.round(own + it.socketed.reduce((s, p) => s + itemValue({ ...p, level: 1, weight: 0 }, v), 0));
}
