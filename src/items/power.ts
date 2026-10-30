// Item power and weapon DPS (Keith 2026-10-28): one number per item to compare at a glance, and damage per second
// for weapons. Pure.
//   Power: 100 × the mean over the item's stats of (its value with Protocols / the base's value), flipped for
//   lower-is-better stats, so a Common level 1 item with middling rolls is about 100 and better rolls, higher levels
//   and Protocols raise it. A Protocol item: 40 + 20 per rarity tier.
//   DPS (src/items/dps.ts, the one formula the balance sheet uses too, 2026-10-31): damage × rounds per shot ×
//   sustained shots/s over the magazine and reload; with its Protocols, their split, rate, cost, chains and ricochets
//   (best case). Area damage (blast, splash) isn't counted.
import { BASE_BY_ID, STATS } from "./bases";
import { tierOf } from "./rarity";
import { PROTOCOL_BY_ID } from "./protocols";
import { itemDpsPair, itemCadence } from "./dps";
import { effectiveStats } from "./loadout";
import type { Item } from "./item";

export function itemPower(item: Item): number {
  if (item.kind === "protocol") return 40 + 20 * tierOf(PROTOCOL_BY_ID[item.base]?.rarity ?? item.rarity);
  const b = BASE_BY_ID[item.base];
  if (!b) return 0;
  const eff = effectiveStats(item);
  let sum = 0, n = 0;
  for (const k in b.stats) {
    const base = b.stats[k].base, x = eff[k];
    if (!(base > 0) || x === undefined) continue;
    const ratio = (STATS[k]?.better ?? 1) > 0 ? x / base : base / Math.max(1e-3, x);
    sum += Math.min(4, ratio); n++;
  }
  return n ? Math.round((100 * sum) / n) : 0;
}

/** Damage per second for a weapon with its Protocols (src/items/dps.ts), null for anything that isn't one. */
export function itemDps(item: Item): number | null {
  return itemDpsPair(item)?.withProtocols ?? null;
}

/** "144 dps" for a weapon, "144 dps · 173 with Protocols" when its Protocols change it; "" for anything else. */
export function dpsText(item: Item): string {
  const p = itemDpsPair(item);
  if (!p) return "";
  const a = Math.round(p.base), b = Math.round(p.withProtocols), bonus = itemCadence(item)?.bonus ?? 0;
  const extra = bonus > 0 ? ` (+${Math.round(bonus * 100)}% per hit that chains or bounces on)` : "";
  return item.socketed.length && (a !== b || extra) ? `${a} dps · ${b} with Protocols${extra}` : `${a} dps`;
}

/**
 * Against what's fitted: the weakest fitted item of the same kind (the one it would replace), by DPS for weapons
 * and power otherwise. Null when nothing of that kind is fitted.
 */
export function versusFitted(item: Item, fitted: readonly (Item | null)[]): { power: number; dps: number | null } | null {
  let best: { power: number; dps: number | null } | null = null;
  for (const f of fitted) {
    if (!f || f.kind !== item.kind) continue;
    const p = itemPower(f), d = itemDps(f);
    const key = d ?? p, bestKey = best ? best.dps ?? best.power : Infinity;
    if (key < bestKey) best = { power: p, dps: d };
  }
  return best;
}
