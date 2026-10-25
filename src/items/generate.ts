// Seeded loot rolls: a base by kind and drop weights, a rarity by weights, each stat inside its range (widened by
// rarity), a maker. The same seed always rolls the same item. Tuning: LOOT_PARAMS (loadout lab, Loadout topic).
import type { Param } from "../core/tweaks";
import { BASES, BASE_BY_ID, STATS, type Base } from "./bases";
import { PROTOCOLS, PROTOCOL_BY_ID, type Protocol } from "./protocols";
import { RARITIES, RARITY, rollRange, type Rarity, type WidenTuning } from "./rarity";
import type { Item, ItemKind } from "./item";

export const LOOT_DEFAULTS = {
  rarityWiden: 0.5,
  rarityLift: 0.15,
  weightCommon: 50,
  weightUncommon: 28,
  weightRare: 14,
  weightEpic: 6,
  weightLegendary: 2,
  protocolShare: 0.2,
};
export type LootValues = typeof LOOT_DEFAULTS;

const G = "Loot rolls";
export const LOOT_PARAMS: Param[] = [
  { key: "rarityWiden", label: "Rarity widens rolls (per tier)", min: 0, max: 2, step: 0.05, group: G, tip: "Each tier above Common widens a stat's range both ways by this share of its Common width: rarer is wilder, not always better" },
  { key: "rarityLift", label: "Rarity lifts rolls (per tier)", min: 0, max: 1, step: 0.01, group: G, tip: "Each tier above Common moves the middle of a roll toward better by this share of its Common width; kept below the widening, rarer rolls still reach past Common both ways" },
  { key: "weightCommon", label: "Common weight", min: 0, max: 100, step: 1, group: G },
  { key: "weightUncommon", label: "Uncommon weight", min: 0, max: 100, step: 1, group: G },
  { key: "weightRare", label: "Rare weight", min: 0, max: 100, step: 1, group: G },
  { key: "weightEpic", label: "Epic weight", min: 0, max: 100, step: 1, group: G },
  { key: "weightLegendary", label: "Legendary weight", min: 0, max: 100, step: 1, group: G },
  { key: "protocolShare", label: "Protocols in random loot", min: 0, max: 1, step: 0.01, group: G, tip: "Share of random rolls that come up a Protocol instead of a part or weapon" },
];

/** Small seeded generator (mulberry32): numbers in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, list: readonly T[], weight: (t: T) => number): T {
  const total = list.reduce((s, t) => s + Math.max(0, weight(t)), 0);
  let x = r() * total;
  for (const t of list) { x -= Math.max(0, weight(t)); if (x < 0) return t; }
  return list[list.length - 1];
}

const weightOf = (v: LootValues, r: Rarity) =>
  ({ common: v.weightCommon, uncommon: v.weightUncommon, rare: v.weightRare, epic: v.weightEpic, legendary: v.weightLegendary })[r];

/** A stat's roll range in its own units for a base and rarity. */
export function statRange(base: Base, stat: string, rarity: Rarity, t: WidenTuning): [number, number] {
  const st = base.stats[stat];
  const [lo, hi] = rollRange(st.spread, STATS[stat]?.better ?? 1, rarity, t);
  return [st.base * lo, st.base * hi];
}

function finish(stat: string, x: number) {
  const info = STATS[stat];
  return info?.whole ? Math.max(stat === "dashCharges" ? 1 : 0, Math.round(x)) : Math.max(0.01, x);
}

/** An item of this base with its base values (no roll): the default parts. */
export function makeItem(baseId: string, rarity: Rarity = "common", id = "default-" + baseId): Item {
  const b = BASE_BY_ID[baseId];
  if (!b) throw new Error(`no base ${baseId}`);
  const stats: Record<string, number> = {};
  for (const k in b.stats) stats[k] = b.stats[k].base;
  return { id, base: b.id, kind: b.kind, size: b.size, rarity, stats, tags: [...b.tags], sockets: RARITY[rarity].sockets, socketed: [], maker: b.makers[0], look: b.look, weight: b.weight, seed: 0 };
}

export interface RollOptions {
  kind?: Exclude<ItemKind, "protocol">;
  base?: string;
  rarity?: Rarity;
}

/** Roll one part or weapon from a seed. */
export function rollItem(seed: number, v: LootValues, o: RollOptions = {}): Item {
  const r = rng(seed);
  const pool = o.base ? [BASE_BY_ID[o.base]] : BASES.filter((b) => !o.kind || b.kind === o.kind);
  const b = pick(r, pool, (x) => x.drop);
  const rarity = o.rarity ?? pick(r, RARITIES, (x) => weightOf(v, x));
  const stats: Record<string, number> = {};
  for (const k in b.stats) {
    const [lo, hi] = statRange(b, k, rarity, v);
    stats[k] = finish(k, lo + (hi - lo) * r());
  }
  const maker = b.makers[Math.floor(r() * b.makers.length)];
  return { id: `${b.id}#${(seed >>> 0).toString(36)}`, base: b.id, kind: b.kind, size: b.size, rarity, stats, tags: [...b.tags], sockets: RARITY[rarity].sockets, socketed: [], maker, look: b.look, weight: b.weight, seed: seed >>> 0 };
}

/** A Protocol as an item (to keep in stash and socket at the bay). */
export function protocolItem(p: Protocol, seed: number): Item {
  return { id: `proto-${p.id}#${(seed >>> 0).toString(36)}`, base: p.id, kind: "protocol", rarity: p.rarity, stats: {}, tags: ["protocol"], sockets: 0, socketed: [], maker: "", look: "", weight: 0.05, seed: seed >>> 0 };
}

export function rollProtocol(seed: number, id?: string): Item {
  const r = rng(seed ^ 0x9e3779b9);
  return protocolItem(id ? PROTOCOL_BY_ID[id] : pick(r, PROTOCOLS, (p) => p.drop), seed);
}

/** Random loot: mostly parts and weapons, a share of Protocols. A given rarity rolls only parts and weapons. */
export function rollLoot(seed: number, v: LootValues, rarity?: Rarity): Item {
  if (!rarity && rng(seed ^ 0x51ed27)() < v.protocolShare) return rollProtocol(seed);
  return rollItem(seed, v, { rarity });
}
