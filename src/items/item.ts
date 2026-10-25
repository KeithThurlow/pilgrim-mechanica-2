// An item: a part or weapon for the walker, or a Protocol to socket into one (docs/proposal-loadout.md, Keith
// 2026-10-25). Pure data, JSON-safe (the loadout lab saves them to localStorage as they are).
import type { Rarity } from "./rarity";

/** What kind of thing it is; with the size, that decides which slots it fits (src/items/loadout.ts). */
export type ItemKind = "legs" | "hull" | "sensor" | "arm" | "weapon" | "shoulder" | "pack" | "waist" | "protocol";
/** Weapon size (Keith 2026-10-26): Medium is a hull weapon (a whole hull mount), Light a held weapon (in an arm's
 *  hand), Heavy a two-handed held weapon (needs an arm on both mounts). */
export type Size = "L" | "M" | "H";

/** What a sensor's seekers can point at (Keith 2026-10-26: the nearest rare or legendary item, wrecks, scrap...). */
export const SEEKER_MODES = ["scrap", "wreck", "rare", "legendary"] as const;
export type SeekerMode = (typeof SEEKER_MODES)[number];

export interface Item {
  /** Unique per item (base and seed). */
  id: string;
  /** Base id in `BASES` (or a Protocol id in `PROTOCOLS` for kind "protocol"). */
  base: string;
  kind: ItemKind;
  size?: Size;
  rarity: Rarity;
  /** Rolled stats, by stat key (see `STATS`). */
  stats: Record<string, number>;
  tags: string[];
  /** Protocol sockets (by rarity: 0-4). */
  sockets: number;
  /** Protocol items socketed into this one (at most `sockets`). */
  socketed: Item[];
  /** The maker (brand) that built it. */
  maker: string;
  /** Which model variant draws it ("rampart", "rampart-stilt", ...; only "rampart" exists so far). */
  look: string;
  /** Weight in tonnes (cargo capacity is in tonnes too). */
  weight: number;
  /** The seed it was rolled from (0 for the fixed default parts). */
  seed: number;
  /** Sensors: the seeker modes it carries (rarer sensors carry more). */
  seekers?: SeekerMode[];
}

/**
 * Model variants an item can ask for. The seven Rampart variants live on Keith's PC and will be pushed later
 * (proposal: Stilt, Turret, Railgun, Siege, Salvager, Rocket, Wildcat); until then every look draws as the Rampart.
 */
export const LOOKS = ["rampart", "rampart-stilt", "rampart-turret", "rampart-railgun", "rampart-siege", "rampart-salvager", "rampart-rocket", "rampart-wildcat"] as const;
/** Looks with a model in this repo. */
export const AVAILABLE_LOOKS: readonly string[] = ["rampart"];

/** The model variant to draw an item with: its own look if that model exists, else the Rampart. */
export function lookFor(item: Item): string {
  return AVAILABLE_LOOKS.includes(item.look) ? item.look : "rampart";
}

/** Weight including whatever is socketed. */
export function itemWeight(item: Item): number {
  return item.weight + item.socketed.reduce((s, p) => s + p.weight, 0);
}
