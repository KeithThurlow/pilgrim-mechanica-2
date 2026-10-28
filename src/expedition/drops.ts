// Item drops out in the field (pure; host-owned: what drops, where, and who picked it up). A stripped salvage spot,
// or a robot killed (by size), can drop one item from the loot rolls (src/items/generate.ts). Every roll is seeded
// from the world seed and the thing's stable id (the spot's id, the robot's slot and generation), so every peer gets
// the same drop. Rarity leans better with depth (the danger 0..1+ from src/expedition/depth.ts) and salvage heat
// (0..1): each tier's weight is multiplied by e^(tier × (rarityDepth × danger + rarityHeat × heat)).
// A drop lies on the sand until a collector (the mech, or the pilot on foot) walks within reach of it, then it is
// "picked" (the glue puts it on the at-risk list); left further than dropForget behind it is "forgotten".
// What happens is plain-data events (rule 12), drained by the glue each frame.
import type { Param } from "../core/tweaks";
import { RARITIES, type Rarity } from "../items/rarity";
import { rng, rollItem, rollProtocol, type LootValues } from "../items/generate";
import type { Item } from "../items/item";
import { BASE_BY_ID } from "../items/bases";
import { PROTOCOL_BY_ID } from "../items/protocols";

export const DROP_DEFAULTS = {
  dropSpot: 0.3,
  dropSmall: 0.03,
  dropMid: 0.15,
  dropBig: 0.6,
  rarityDepth: 0.5,
  rarityHeat: 0.4,
  pickupMech: 4.5,
  pickupPilot: 1.8,
  dropForget: 400,
};
export type DropValues = typeof DROP_DEFAULTS;

export const LOOT_GROUP = "Loot";
const G = LOOT_GROUP;
export const DROP_PARAMS: Param[] = [
  { key: "dropSpot", label: "Item drop: stripped spot", min: 0, max: 1, step: 0.01, group: G, tip: "Chance a stripped salvage spot drops an item beside it" },
  { key: "dropSmall", label: "Item drop: small robot", min: 0, max: 1, step: 0.005, group: G },
  { key: "dropMid", label: "Item drop: medium robot", min: 0, max: 1, step: 0.01, group: G },
  { key: "dropBig", label: "Item drop: big robot", min: 0, max: 1, step: 0.01, group: G },
  { key: "rarityDepth", label: "Rarity lean per depth", min: 0, max: 2, step: 0.05, group: G, tip: "Each rarity tier's weight × e^(tier × this × danger): deeper out, rarer drops" },
  { key: "rarityHeat", label: "Rarity lean per heat", min: 0, max: 2, step: 0.05, group: G, tip: "The same for salvage heat (0..1)" },
  { key: "pickupMech", label: "Mech grabs within (m)", min: 1, max: 12, step: 0.1, group: G, tip: "Walk the mech's hips this close to a drop to pick it up" },
  { key: "pickupPilot", label: "Pilot grabs within (m)", min: 0.5, max: 5, step: 0.1, group: G },
  { key: "dropForget", label: "Drops vanish past (m)", min: 50, max: 2000, step: 10, group: G, tip: "A drop left this far behind is gone" },
];

export interface Drop { id: string; x: number; z: number; item: Item }
export type DropEvent =
  | { type: "dropped"; drop: Drop }
  | { type: "picked"; drop: Drop; by: "mech" | "pilot" }
  | { type: "forgotten"; id: string };
export interface Collector { x: number; z: number; by: "mech" | "pilot" }

/** FNV-1a of a string, mixed with a seed. */
export function hashKey(seed: number, key: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The rarity weights leaned by depth and heat (the loot rolls' weights as the base). */
export function rarityWeights(v: DropValues & LootValues, danger: number, heat: number): number[] {
  const base = [v.weightCommon, v.weightUncommon, v.weightRare, v.weightEpic, v.weightLegendary];
  const lean = v.rarityDepth * Math.max(0, danger) + v.rarityHeat * Math.max(0, Math.min(1, heat));
  return base.map((w, k) => Math.max(0, w) * Math.exp(k * lean));
}

/** A rarity from the leaned weights. */
export function rollRarity(r: () => number, v: DropValues & LootValues, danger: number, heat: number): Rarity {
  const w = rarityWeights(v, danger, heat);
  let t = r() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < w.length; k++) { t -= w[k]; if (t < 0) return RARITIES[k]; }
  return "common";
}

/** An item's display name (a base's name, or a Protocol's). */
export function itemName(item: Item): string {
  return item.kind === "protocol" ? PROTOCOL_BY_ID[item.base]?.name ?? item.base : BASE_BY_ID[item.base]?.name ?? item.base;
}

export class DropField {
  readonly drops: Drop[] = [];
  readonly events: DropEvent[] = [];
  /** Keys already rolled (a spot or a kill rolls once, even when it streams out and back in). */
  private rolled = new Set<string>();

  constructor(public v: DropValues & LootValues, public seed: number) {}

  reset() { this.drops.length = 0; this.rolled.clear(); this.events.length = 0; }

  /** Roll a drop for a stable key at (x, z) with this chance; null if nothing drops. */
  roll(key: string, chance: number, x: number, z: number, danger: number, heat: number): Drop | null {
    if (this.rolled.has(key)) return null;
    this.rolled.add(key);
    const seed = hashKey(this.seed, key), r = rng(seed);
    if (r() >= chance) return null;
    const rarity = rollRarity(r, this.v, danger, heat);
    const item = r() < this.v.protocolShare ? rollProtocol(seed) : rollItem(seed, this.v, { rarity });
    // Beside the spot rather than inside the wreck.
    const a = r() * Math.PI * 2, d = 2 + r() * 2.5;
    const drop: Drop = { id: `drop:${key}`, x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, item };
    this.drops.push(drop);
    this.events.push({ type: "dropped", drop });
    return drop;
  }

  /** A salvage spot stripped. */
  fromSpot(spotId: string, x: number, z: number, danger: number, heat: number) {
    return this.roll(`spot:${spotId}`, this.v.dropSpot, x, z, danger, heat);
  }

  /** A robot killed: size 0 small, 1 big, 2 medium (src/combat/robots.ts SMALL/BIG/MID); key: its slot and generation. */
  fromKill(key: string, size: number, x: number, z: number, danger: number, heat: number) {
    const chance = size === 1 ? this.v.dropBig : size === 2 ? this.v.dropMid : this.v.dropSmall;
    return this.roll(`kill:${key}`, chance, x, z, danger, heat);
  }

  /**
   * One step: collectors within reach pick drops up (take: may they; the glue says no while not out), drops further
   * than dropForget from every collector are forgotten. Returns the drops picked this step.
   */
  update(collectors: Collector[], take: boolean): Drop[] {
    const picked: Drop[] = [];
    for (let k = this.drops.length - 1; k >= 0; k--) {
      const d = this.drops[k];
      let near = Infinity, by: Collector | null = null;
      for (const c of collectors) {
        const dist = Math.hypot(c.x - d.x, c.z - d.z), reach = c.by === "mech" ? this.v.pickupMech : this.v.pickupPilot;
        if (take && dist <= reach && !by) by = c;
        near = Math.min(near, dist);
      }
      if (by) {
        this.drops.splice(k, 1);
        picked.push(d);
        this.events.push({ type: "picked", drop: d, by: by.by });
      } else if (collectors.length && near > this.v.dropForget) {
        this.drops.splice(k, 1);
        this.events.push({ type: "forgotten", id: d.id });
      }
    }
    return picked;
  }
}
