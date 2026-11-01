// Fitting an item the way the bay and the inventory both do it (pure): fit it, and an arm fitted on a hull mount
// takes the best held weapon on offer into its hand (Keith 2026-10-25: an arm on its own left an empty mount). The
// caller moves items between its own lists (stash, cargo, the at-risk list) by what this returns.
import type { Item } from "./item";
import { MOUNTS, bestHeld, fit, type Loadout, type SlotId } from "./loadout";

export interface FitResult {
  /** What came off the mech (goes wherever the caller puts taken-off items). */
  off: Item[];
  /** Items from the pool now on the mech (the item itself, and the arm's held weapon); the caller takes them out of
   *  its lists. */
  used: Item[];
  /** An arm went on with nothing to hold: the held slot to show next. */
  emptyHeld: SlotId | null;
}

/** Fit `it` into `slot` (the caller checked fitProblem). `pool`: what else is on offer for an arm's hand. */
export function fitWithHeld(lo: Loadout, slot: SlotId, it: Item, pool: readonly Item[]): FitResult {
  const off = fit(lo, slot, it), used = [it];
  let emptyHeld: SlotId | null = null;
  if ((slot === "mountL" || slot === "mountR") && it.kind === "arm") {
    const side = slot === "mountL" ? "L" : "R";
    // What just came off is on offer too (the bay put it in the stash before choosing).
    const best = bestHeld(lo, side, [...pool.filter((x) => x !== it), ...off]);
    if (best) {
      const i = off.indexOf(best);
      if (i >= 0) off.splice(i, 1); else used.push(best);
      off.push(...fit(lo, MOUNTS[side].held, best));
    } else if (!lo[MOUNTS[side].held]) emptyHeld = MOUNTS[side].held;
  }
  return { off, used, emptyHeld };
}
