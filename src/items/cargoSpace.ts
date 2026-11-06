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
  const sv = { ...GRID_SIZE_DEFAULTS, ...v } as GridSizeValues;
  const level = Math.max(0, Math.min(SALVAGE_LEVELS, Math.round(compactLevel)));
  const c = classCells(`salvage${level}` as Parameters<typeof classCells>[0], sv);
  return {
    itemCells: (it) => { const k = itemCells(it, sv); return k.w * k.h; },
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
