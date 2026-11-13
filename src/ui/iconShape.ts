// How an item's inventory picture is framed (labs/icons/ draws them, tools/icons.mjs saves them, src/ui/itemIcon.ts
// shows them): the picture's shape in grid cells, and where the camera looks from for each size class.
import type { Cells, GridClass } from "../items/gridSize";

/** Classes drawn long side down (weapons stand upright in the grid, Keith 2026-11-03): a flat footprint is the same
 *  picture turned. */
export const TALL: GridClass[] = ["hullGun", "held", "heldLong", "sword", "swordBig", "swordShort", "legs", "arm"];

/** The picture's shape for a class with these cells: tall classes always stand upright. */
export function iconShape(cls: GridClass, cells: Cells): Cells {
  return TALL.includes(cls) && cells.w > cells.h ? { w: cells.h, h: cells.w } : cells;
}

export interface IconView {
  /** Where the camera stands, as a direction from the model (x the model's left, y up, z its front). */
  from: [number, number, number];
  /** The picture's up: the model's long axis (a barrel or blade stands upright) or the world's. */
  upright: "long" | "world";
}

/** Views by size class: guns from the side and above with the muzzle up, packs from behind (the side the game
 *  camera sees), everything else three-quarter from the front. */
export const ICON_VIEWS: Partial<Record<GridClass, IconView>> & { default: IconView } = {
  default: { from: [0.7, 0.65, 0.9], upright: "world" },
  hullGun: { from: [1, 0.75, 0.3], upright: "long" },
  held: { from: [1, 0.75, 0.3], upright: "long" },
  heldLong: { from: [1, 0.75, 0.3], upright: "long" },
  sword: { from: [1, 0.5, 0.15], upright: "long" },
  swordBig: { from: [1, 0.5, 0.15], upright: "long" },
  swordShort: { from: [1, 0.5, 0.15], upright: "long" },
  legs: { from: [0.75, 0.3, 0.9], upright: "world" },
  pack: { from: [0.6, 0.7, -0.9], upright: "world" },
};
