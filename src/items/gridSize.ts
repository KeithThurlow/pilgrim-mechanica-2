// Item grid sizes (Keith 2026-11-02: "start giving items grid sizes and building a grid inventory space"). Every item
// takes a w × h block of cells in a grid inventory (src/items/grid.ts). Sizes go by size class: one table of classes
// (each a pair of sliders, w then h, so Keith can retune a whole family at once) and one table saying which class each
// base is in. A base not named in the table falls back by its kind, weapon size and gun class, so a new base always
// gets a size (tools/grid-check.ts holds every base to having one).
// Keith's sizes: hull weapons 2×3 or 2×8, hulls 3×2 or 4×2, packs 2×2, legs 2×3, arms 2×2, held weapons 2×2 or 2×3,
// waist mounts 2×1, shoulder gear 2×2; Buster sword 2×8, Breaker 1×8, Short sword 1×6, repair kits 1×2, Protocols 1×1. The rest are defaults picked here (open questions in docs/decisions.md).
// w is columns, h is rows, before turning; any item may turn 90° in the grid (Keith's call to confirm).
import type { Param } from "../core/tweaks";
import { BASE_BY_ID, type Base } from "./bases";
import type { Item } from "./item";

/** The size classes. */
export const GRID_CLASSES = {
  hullGun: { label: "Hull weapon", w: 2, h: 3 },
  hullGunLong: { label: "Long hull weapon", w: 2, h: 8 },
  hull: { label: "Hull", w: 3, h: 2 },
  hullBig: { label: "Big hull", w: 4, h: 2 },
  legs: { label: "Legs", w: 2, h: 3 },
  arm: { label: "Arm", w: 2, h: 2 },
  held: { label: "Held weapon", w: 2, h: 2 },
  heldLong: { label: "Long held weapon", w: 2, h: 3 },
  swordBig: { label: "Big sword", w: 2, h: 8 },
  sword: { label: "Sword", w: 1, h: 8 },
  swordShort: { label: "Short sword", w: 1, h: 6 },
  shoulder: { label: "Shoulder gear", w: 2, h: 2 },
  pack: { label: "Pack", w: 2, h: 2 },
  waist: { label: "Waist mount", w: 2, h: 1 },
  sensor: { label: "Sensor", w: 2, h: 1 },
  summon: { label: "Summon gear", w: 2, h: 2 },
  protocol: { label: "Protocol", w: 1, h: 1 },
  repairKit: { label: "Repair kit", w: 1, h: 2 },
  consumable: { label: "Consumable", w: 1, h: 1 },
  material: { label: "Crafting material", w: 1, h: 1 },
  // Salvage as blocks in the cargo (Keith 2026-11-02, leaning that way: salvage competes with gear for room, and
  // compaction upgrades pack it into smaller blocks). Each block holds `salvagePerBlock` scrap (src/items/grid.ts).
  salvageRaw: { label: "Raw salvage block", w: 3, h: 3 },
  salvageCompact: { label: "Compacted salvage block", w: 2, h: 2 },
} as const;
export type GridClass = keyof typeof GRID_CLASSES;
export const GRID_CLASS_IDS = Object.keys(GRID_CLASSES) as GridClass[];

/** Bases that aren't what the fallback would give them. */
export const GRID_CLASS_OF: Record<string, GridClass> = {
  // The long hull guns: barrels that run the length of the hull.
  "rail-medium": "hullGunLong", "sniper-medium": "hullGunLong", "lance-medium": "hullGunLong", "sunder-medium": "hullGunLong", "cannon-medium": "hullGunLong",
  // The big hulls.
  "hull-rampart": "hullBig", "hull-siege": "hullBig",
  // Long held guns (the heavy minigun, a two-hander, falls back to long too).
  // Swords (Keith 2026-11-02: Buster 2×8, Breaker 1×8, Short 1×6).
  "sword-heavy": "swordBig", "sword-short": "swordShort",
  // Summoner gear (Keith 2026-11-02).
  "pack-replica": "summon", "sh-drones": "summon", "sh-hive": "summon",
  "rifle-light": "heldLong", "shotgun-light": "heldLong", "rail-light": "heldLong",
};

/** A base's size class. */
export function gridClassOfBase(b: Base): GridClass {
  const named = GRID_CLASS_OF[b.id];
  if (named) return named;
  switch (b.kind) {
    case "weapon":
      if (b.cls === "melee") return "sword";
      if (b.size === "M") return "hullGun";
      return b.size === "H" ? "heldLong" : "held";
    case "hull": return "hull";
    case "legs": return "legs";
    case "arm": return "arm";
    case "shoulder": return "shoulder";
    case "pack": return "pack";
    case "waist": return "waist";
    case "sensor": return "sensor";
  }
}

/** An item's size class (Protocols and unknown bases: their own small classes). */
export function gridClassOf(item: Pick<Item, "kind" | "base">): GridClass {
  if (item.base === SALVAGE_RAW) return "salvageRaw";
  if (item.base === SALVAGE_COMPACT) return "salvageCompact";
  if (item.kind === "protocol") return "protocol";
  const b = BASE_BY_ID[item.base];
  return b ? gridClassOfBase(b) : "material";
}

const wKey = (c: GridClass) => `grid_${c}_w`;
const hKey = (c: GridClass) => `grid_${c}_h`;

export type GridSizeValues = Record<string, number>;

export const GRID_SIZE_DEFAULTS: GridSizeValues = Object.fromEntries(
  GRID_CLASS_IDS.flatMap((c) => [[wKey(c), GRID_CLASSES[c].w], [hKey(c), GRID_CLASSES[c].h]]),
);

export const GRID_SIZE_PARAMS: Param[] = GRID_CLASS_IDS.flatMap((c) => [
  { key: wKey(c), label: `${GRID_CLASSES[c].label} w`, min: 1, max: 8, step: 1, group: "Item sizes", tip: "Columns before turning" },
  { key: hKey(c), label: `${GRID_CLASSES[c].label} h`, min: 1, max: 8, step: 1, group: "Item sizes", tip: "Rows before turning" },
]);

export interface Cells { w: number; h: number }

/** A class's size from the values (the table's numbers where a value is missing). */
export function classCells(c: GridClass, v: Partial<GridSizeValues> = GRID_SIZE_DEFAULTS): Cells {
  const w = v[wKey(c)] ?? GRID_CLASSES[c].w, h = v[hKey(c)] ?? GRID_CLASSES[c].h;
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/** An item's size in cells, unturned. */
export const itemCells = (item: Pick<Item, "kind" | "base">, v?: Partial<GridSizeValues>): Cells => classCells(gridClassOf(item), v);

// ---- Salvage blocks (a placeholder: the expedition still counts scrap as a number; the grid shows it as blocks) ----
export const SALVAGE_RAW = "salvage-raw", SALVAGE_COMPACT = "salvage-compact";
export const isSalvage = (item: Pick<Item, "base">) => item.base === SALVAGE_RAW || item.base === SALVAGE_COMPACT;

/** A salvage block as a grid item (not a real item: no slot takes it, it isn't in any list). */
export function salvageItem(index: number, compact: boolean, amount: number): Item {
  return { id: `salvage#${index}`, base: compact ? SALVAGE_COMPACT : SALVAGE_RAW, kind: "protocol", rarity: "common", stats: { scrap: amount }, tags: ["salvage"], sockets: 0, socketed: [], maker: "", look: "", weight: 0, seed: 0 };
}

/** The blocks for an amount of scrap: full blocks of `perBlock`, the last one part full. */
export function salvageBlocks(scrap: number, perBlock: number, compact: boolean): Item[] {
  const per = Math.max(1, perBlock), n = Math.ceil(Math.max(0, Math.floor(scrap)) / per), out: Item[] = [];
  for (let i = 0; i < n; i++) out.push(salvageItem(i, compact, Math.min(per, Math.floor(scrap) - i * per)));
  return out;
}
