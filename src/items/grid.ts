// A grid inventory (Keith 2026-11-02): a cols × rows block of cells where each item takes its w × h (src/items/gridSize.ts),
// turned 90° or not. Pure data, JSON-safe; ids are the items' ids. Nothing overlaps and nothing hangs off the edge
// (tools/grid-check.ts). Not wired into the cargo yet: the weight limit still rules the cargo (src/items/cargo.ts);
// the grid lab (labs/inventory/) plays with the space on its own first.
import type { Param } from "../core/tweaks";
import type { Cells } from "./gridSize";

export interface Placed {
  id: string;
  /** Top left cell. */
  x: number;
  y: number;
  /** The item's size unturned (as it was when placed). */
  w: number;
  h: number;
  /** Turned 90°: it takes h columns and w rows. */
  rot: boolean;
}

export interface Grid {
  cols: number;
  rows: number;
  placed: Placed[];
}

export const newGrid = (cols: number, rows: number): Grid => ({ cols, rows, placed: [] });

/** The cells a size takes, turned or not. */
export const footprint = (s: Cells, rot: boolean): Cells => (rot ? { w: s.h, h: s.w } : { w: s.w, h: s.h });

/** Whether a size fits at x, y (ignoring the item `ignore`, so an item can be moved within its own grid). */
export function fitsAt(g: Grid, s: Cells, x: number, y: number, rot: boolean, ignore?: string): boolean {
  const f = footprint(s, rot);
  if (x < 0 || y < 0 || x + f.w > g.cols || y + f.h > g.rows) return false;
  for (const p of g.placed) {
    if (p.id === ignore) continue;
    const q = footprint(p, p.rot);
    if (x < p.x + q.w && p.x < x + f.w && y < p.y + q.h && p.y < y + f.h) return false;
  }
  return true;
}

/** Put an item at x, y; returns whether it went in. */
export function placeAt(g: Grid, id: string, s: Cells, x: number, y: number, rot: boolean): boolean {
  if (!fitsAt(g, s, x, y, rot, id)) return false;
  removeFrom(g, id);
  g.placed.push({ id, x, y, w: s.w, h: s.h, rot });
  return true;
}

/** Take an item out (null if it isn't there). */
export function removeFrom(g: Grid, id: string): Placed | null {
  const i = g.placed.findIndex((p) => p.id === id);
  return i < 0 ? null : g.placed.splice(i, 1)[0];
}

/** The first free spot, row by row from the top left; unturned first, then turned when `turn`. Null: no room. */
export function findSpot(g: Grid, s: Cells, turn = true, ignore?: string): { x: number; y: number; rot: boolean } | null {
  for (const rot of turn && s.w !== s.h ? [false, true] : [false]) {
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (fitsAt(g, s, x, y, rot, ignore)) return { x, y, rot };
  }
  return null;
}

/** Put an item in the first free spot; returns whether it went in. */
export function autoPlace(g: Grid, id: string, s: Cells, turn = true): boolean {
  const at = findSpot(g, s, turn, id);
  return !!at && placeAt(g, id, s, at.x, at.y, at.rot);
}

/** The id in a cell (null: free). */
export function itemAt(g: Grid, x: number, y: number): Placed | null {
  for (const p of g.placed) {
    const f = footprint(p, p.rot);
    if (x >= p.x && x < p.x + f.w && y >= p.y && y < p.y + f.h) return p;
  }
  return null;
}

/** Cells taken. */
export const usedCells = (g: Grid) => g.placed.reduce((n, p) => n + p.w * p.h, 0);

/**
 * Lay a list out afresh, biggest first (a tidy pack; also after the sizes change). Returns the ids that didn't fit
 * (left out of the grid).
 */
export function repack(g: Grid, items: { id: string; cells: Cells }[], turn = false): string[] {
  g.placed = [];
  const order = [...items].sort((a, b) => b.cells.w * b.cells.h - a.cells.w * a.cells.h || Math.max(b.cells.w, b.cells.h) - Math.max(a.cells.w, a.cells.h) || (a.id < b.id ? -1 : 1));
  const left: string[] = [];
  for (const it of order) if (!autoPlace(g, it.id, it.cells, turn)) left.push(it.id);
  return left;
}

/**
 * Bring a grid in step with a list of items (its saved layout against what is really in the bag): items gone are taken
 * out, items whose size changed (a slider) are placed again, new items go in the first free spot. `grow`: add rows
 * until everything fits (the stash). Returns the ids that have no room (shown apart, as over the grid).
 */
export function syncGrid(g: Grid, items: { id: string; cells: Cells }[], _turn = false, grow = false): string[] {
  const want = new Map(items.map((i) => [i.id, i.cells]));
  g.placed = g.placed.filter((p) => {
    const c = want.get(p.id);
    if (!c || c.w !== p.w || c.h !== p.h) return false;
    const f = footprint(p, p.rot);
    return p.x >= 0 && p.y >= 0 && p.x + f.w <= g.cols && p.y + f.h <= g.rows;
  });
  // Overlaps from a stale save: the later one is placed again.
  const kept: Placed[] = [];
  for (const p of g.placed) if (fitsAt({ ...g, placed: kept }, p, p.x, p.y, p.rot)) kept.push(p);
  g.placed = kept;
  const fresh = items.filter((i) => !g.placed.some((p) => p.id === i.id))
    .sort((a, b) => b.cells.w * b.cells.h - a.cells.w * a.cells.h || (a.id < b.id ? -1 : 1));
  const left: string[] = [];
  for (const it of fresh) {
    // Placed upright as sized (Keith 2026-11-03: weapons stand upright everywhere); only the player turns an item.
    while (!autoPlace(g, it.id, it.cells, false) && grow && g.rows < 400) g.rows++;
    if (!g.placed.some((p) => p.id === it.id)) left.push(it.id);
  }
  return left;
}

// ---- Sliders: the grids' own sizes ----
export interface GridValues {
  cargoCols: number;
  cargoRows: number;
  stashCols: number;
  stashRows: number;
  gridTurn: number;
  gridCellPx: number;
  salvagePerBlock: number;
  salvageLevel: number;
  [k: string]: number;
}

export const GRID_DEFAULTS: GridValues = { cargoCols: 10, cargoRows: 8, stashCols: 12, stashRows: 12, gridTurn: 1, gridCellPx: 30, salvagePerBlock: 25, salvageLevel: 0 };

const G = "Grid";
export const GRID_PARAMS: Param[] = [
  { key: "cargoCols", label: "Cargo columns", min: 4, max: 20, step: 1, group: G, tip: "The mech's cargo grid (later from the legs and hull, like the weight)" },
  { key: "cargoRows", label: "Cargo rows", min: 4, max: 20, step: 1, group: G },
  { key: "stashCols", label: "Stash columns", min: 6, max: 30, step: 1, group: G, tip: "The convoy's stash grid: as wide as this, at least this tall, and it grows to take everything (no limit yet)" },
  { key: "stashRows", label: "Stash rows", min: 6, max: 30, step: 1, group: G },
  { key: "gridTurn", label: "Items can turn", min: 0, max: 1, step: 1, group: G, tip: "1: R (or right click) turns an item 90° while you hold it. Items are always placed upright on their own" },
  { key: "gridCellPx", label: "Cell size (px)", min: 16, max: 64, step: 1, group: G },
  { key: "salvagePerBlock", label: "Scrap per salvage block", min: 5, max: 200, step: 5, group: "Salvage blocks", tip: "Out in the field the scrap at risk shows in the cargo grid as blocks of this much" },
  { key: "salvageLevel", label: "Compactor level (labs without a convoy)", min: 0, max: 3, step: 1, group: "Salvage blocks", tip: "Stand-in for the convoy's Salvage compactor unlock where there's no convoy (the inventory lab); the convoy lab uses what's bought" },
];
