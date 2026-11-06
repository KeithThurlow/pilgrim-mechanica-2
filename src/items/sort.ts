// Sorting item lists (Keith 2026-11-01: sort the inventory by weight, DPS, scrap value). Pure.
import { tierOf } from "./rarity";
import { levelOf } from "./level";
import { itemPower, itemDps } from "./power";
import { itemValue, VALUE_DEFAULTS, type ValueValues } from "./value";
import type { Item } from "./item";
import { itemName } from "./bayState";

export const SORT_KEYS = ["rarity", "dps", "power", "value", "level"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const SORT_NAMES: Record<SortKey, string> = {
  rarity: "Rarity", dps: "DPS", power: "Power", value: "Scrap value", level: "Level",
};

/** The number an item sorts by (higher is "more"); null when it has none (DPS of a non-weapon). */
export function sortValue(it: Item, key: SortKey, v: ValueValues = VALUE_DEFAULTS): number | null {
  switch (key) {
    case "rarity": return tierOf(it.rarity);
    case "dps": return itemDps(it);
    case "power": return itemPower(it);
    case "value": return itemValue(it, v);
    case "level": return levelOf(it);
  }
}

/** A sorted copy: by the key (descending, or ascending with `up`), items without a value last, then rarity and name. */
export function sortItems(items: readonly Item[], key: SortKey = "rarity", up = false, v: ValueValues = VALUE_DEFAULTS): Item[] {
  const keyed = items.map((it) => ({ it, k: sortValue(it, key, v) }));
  keyed.sort((a, b) => {
    if (a.k === null || b.k === null) { if (a.k !== b.k) return a.k === null ? 1 : -1; }
    else if (a.k !== b.k) return up ? a.k - b.k : b.k - a.k;
    return tierOf(b.it.rarity) - tierOf(a.it.rarity) || a.it.kind.localeCompare(b.it.kind) || itemName(a.it).localeCompare(itemName(b.it)) || a.it.id.localeCompare(b.it.id);
  });
  return keyed.map((x) => x.it);
}
