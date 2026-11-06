// Cargo space (Keith 2026-11-06: no cargo weight, the grid is the only limit). The cargo is a cargo grid
// (src/items/grid.ts: cargoCols × cargoRows, plus rows from cargo racks), and what it holds is counted in grid cells:
// an item takes its w × h (src/items/gridSize.ts), scrap takes one salvage block per `salvagePerBlock`. Compacting
// (Salvage compactor, smaller classes) makes the same cargo take fewer cells. Pure.
import { itemCells, classCells, SALVAGE_LEVELS, type GridSizeValues } from "./gridSize";
import { GRID_DEFAULTS, type GridValues } from "./grid";
import { GRID_SIZE_DEFAULTS } from "./gridSize";
import type { Item } from "./item";

/** How the cargo counts cells: an item's, and a scrap block's. */
export interface CargoSizing {
  itemCells(item: Item): number;
  /** Scrap in one salvage block. */
  scrapPerBlock: number;
  /** Cells one salvage block takes (falls with the compactor level). */
  blockCells: number;
}

/** The sizing from the grid and size values (the defaults where missing) and the compactor level. */
export function cargoSizing(v: Partial<GridValues & GridSizeValues> = {}, compactLevel = 0): CargoSizing {
  // v is often a lab's whole values object (thousands of keys) and this runs every frame in the convoy lab (perf,
  // 2026-11-06: copying it was 3% of a frame on Keith's PC): read v through the prototype, defaults only where missing.
  const sv = Object.create(v) as Record<string, unknown>;
  for (const k in GRID_SIZE_DEFAULTS) if ((v as Record<string, unknown>)[k] === undefined) sv[k] = (GRID_SIZE_DEFAULTS as Record<string, unknown>)[k];
  const szv = sv as unknown as GridSizeValues;
  const level = Math.max(0, Math.min(SALVAGE_LEVELS, Math.round(compactLevel)));
  const c = classCells(`salvage${level}` as Parameters<typeof classCells>[0], szv);
  return {
    itemCells: (it) => { const k = itemCells(it, szv); return k.w * k.h; },
    scrapPerBlock: Math.max(1, v.salvagePerBlock ?? GRID_DEFAULTS.salvagePerBlock),
    blockCells: c.w * c.h,
  };
}

/** Cells `amount` scrap takes, in blocks of the sizing's size (the last one part full). */
export const scrapCells = (z: CargoSizing, amount: number) => Math.ceil(Math.max(0, Math.floor(amount)) / z.scrapPerBlock) * z.blockCells;

/** The cargo grid's size in cells, with the rows the fitted racks add. */
export function cargoCapacity(v: Partial<GridValues> = {}, rackRows = 0): number {
  const cols = v.cargoCols ?? GRID_DEFAULTS.cargoCols, rows = v.cargoRows ?? GRID_DEFAULTS.cargoRows;
  return Math.round(cols) * (Math.round(rows) + Math.max(0, Math.round(rackRows)));
}

export const DEFAULT_SIZING: CargoSizing = cargoSizing();
