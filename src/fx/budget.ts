// The effects budget (docs/proposal-scale.md, Keith approved 2026-10-26): one gate every effect request goes through
// before it reaches a particle pool, so 4-player fights with 3-6x today's effects per weapon stay inside a frame.
//
// 1. The local player's own effects always pass at full: their own rounds' impacts, and anything within fxNear metres
//    of their mech (its footfalls, hits round it). Co-op: each peer is the local player for its own effects.
// 2. Merge: impacts in the same fxMergeCell cell in the same frame become one bigger effect (MinigunFx gathers them;
//    the count goes into its size and puff counts: n^fxMergeSize and n^fxMergeCount).
// 3. Thin: past fxThinFrom metres from the camera focus, a share of requests is kept that falls with distance (to
//    fxFarKeep at fxThinTo) and with how full the budget is. Which ones are kept is a low-discrepancy sequence, so the
//    kept ones are evenly spread, not clumped, and the same calls keep the same share every frame.
// 4. Trim the extras: an effect's parts have ranks (0 the main flash and puff .. 1 the last extra: smoke). Under
//    pressure the tail goes first.
// 5. Pressure: the dust asked for last frame against fxDustPerFrame, and the live dust against the pool (fxLiveShare
//    of it), so puffs aren't recycled young and trails don't blink out mid-fight.
//
// Cosmetic only (rule 12): nothing here touches game state; peers each run their own.
import type { Param } from "../core/tweaks";

export const FX_BUDGET_DEFAULTS = {
  fxBudget: 1,
  fxNear: 15,
  fxThinFrom: 30,
  fxThinTo: 90,
  fxFarKeep: 0.3,
  fxDustPerFrame: 400,
  fxLiveShare: 0.85,
  fxTrimSpan: 1.5,
  fxMergeCell: 1.5,
  fxMergeSize: 0.25,
  fxMergeCount: 0.5,
};
export type FxBudgetValues = typeof FX_BUDGET_DEFAULTS;

const G = "Performance", GE = "Effects";
export const FX_BUDGET_PARAMS: Param[] = [
  { key: "fxBudget", label: "Effects budget on (0/1)", min: 0, max: 1, step: 1, group: G, tip: "The gate every effect goes through (src/fx/budget.ts): merge, thin far away, trim extras under pressure. Your own effects always pass at full. 0: every effect as asked (the pools drop the oldest when full)" },
  { key: "fxNear", label: "Effects: full within (m) of your mech", min: 0, max: 60, step: 1, group: G, tip: "Anything this close to your mech (footfalls, hits round it) is never thinned or trimmed; your own rounds' hits never are, at any range" },
  { key: "fxThinFrom", label: "Effects: thin from (m)", min: 0, max: 200, step: 1, group: G, tip: "From the camera's focus; nearer than this every request is kept" },
  { key: "fxThinTo", label: "Effects: thinnest at (m)", min: 1, max: 300, step: 1, group: G },
  { key: "fxFarKeep", label: "Effects: share kept far away", min: 0, max: 1, step: 0.01, group: G, tip: "Share of effect requests kept at the thinnest distance (with no pressure)" },
  { key: "fxDustPerFrame", label: "Effects: dust puffs per frame", min: 20, max: 8000, step: 10, group: G, tip: "Above this the far effects thin harder and the extras get trimmed" },
  { key: "fxLiveShare", label: "Effects: live dust before trimming (share of pool)", min: 0.2, max: 1, step: 0.01, group: G, tip: "When the live puffs fill this share of the pool, the budget counts as full, so young puffs aren't recycled" },
  { key: "fxTrimSpan", label: "Effects: trim over (× budget)", min: 0.1, max: 6, step: 0.1, group: G, tip: "How far past the budget until every extra is trimmed (plume, spray, grit, smoke); the main puff always stays" },
  { key: "fxMergeCell", label: "Merge hits within (m)", min: 0, max: 6, step: 0.1, group: GE, tip: "Hits in the same cell in the same frame become one bigger effect (not yours). 0: no merging" },
  { key: "fxMergeSize", label: "Merged hit: size × count ^", min: 0, max: 1, step: 0.01, group: GE, tip: "A merge of n hits is this much bigger: n ^ this" },
  { key: "fxMergeCount", label: "Merged hit: puffs × count ^", min: 0, max: 1, step: 0.01, group: GE, tip: "And throws this many more puffs, sparks and grit: n ^ this" },
];

/** Part ranks: what goes first under pressure (0 never). */
export const RANK = { main: 0, plume: 0.4, spray: 0.6, grit: 0.7, cloud: 0.5, casings: 0.8, smoke: 1 } as const;

const PHI = 0.6180339887498949;

export class FxBudget {
  /** The camera's focus (thinning measures from here). */
  fx = 0; fz = 0;
  /** The local player's mech (or pilot): effects near it pass at full. Null: nothing is local (a lab without one). */
  own: { x: number; z: number } | null = null;
  /** Pressure: 0 empty .. 1 at the budget .. more past it. From last frame's asks and the live pool. */
  pressure = 0;
  /** Dust puffs asked for this frame (counted by the dust pool), and the pool's size and live count. */
  spawned = 0;
  pool = 4096;
  /** Per frame (reset by frame()): requests seen, kept at full, thinned away, merged into others. */
  readonly stats = { asked: 0, full: 0, thinned: 0, merged: 0, spawned: 0, pressure: 0 };
  /** Last frame's stats (for the HUD and the stress lab). */
  readonly last = { asked: 0, full: 0, thinned: 0, merged: 0, spawned: 0, pressure: 0 };
  /** Above 0 while an admitted effect makes its parts (they don't ask again). */
  hold = 0;
  private seq = 0;
  private isFull = true;
  private trimL = 0;

  constructor(public v: FxBudgetValues) {}

  get on() { return this.v.fxBudget > 0.5; }

  /**
   * One effect request at (x, z): false if it's thinned away. own: the local player's own (always kept). After a
   * true, part(rank) scales each of its parts.
   */
  admit(x: number, z: number, own = false): boolean {
    // Inside an effect already admitted (an impact's dust and smoke): its own verdict stands.
    if (this.hold > 0) return true;
    const v = this.v;
    this.stats.asked++;
    if (!this.on) { this.isFull = true; return true; }
    if (own || (this.own && (x - this.own.x) ** 2 + (z - this.own.z) ** 2 < v.fxNear * v.fxNear)) {
      this.isFull = true; this.stats.full++; return true;
    }
    this.isFull = false;
    const d = Math.hypot(x - this.fx, z - this.fz);
    let keep = 1;
    if (d > v.fxThinFrom) {
      const u = Math.min(1, (d - v.fxThinFrom) / Math.max(1, v.fxThinTo - v.fxThinFrom));
      keep = 1 + (v.fxFarKeep - 1) * u;
    }
    // Over budget, everything not local thins in proportion (the far more so).
    if (this.pressure > 1) keep /= this.pressure;
    if (keep >= 1) return true;
    this.seq = (this.seq + PHI) % 1;
    if (this.seq < keep) return true;
    this.stats.thinned++;
    return false;
  }

  /** What share of a part of this rank the last admitted request keeps (1 when it's at full). */
  part(rank: number): number {
    if (this.isFull || rank <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - this.trimL * rank * 1.0001));
  }

  /** Is the last admitted request at full (local)? */
  get full() { return this.isFull; }

  /** Once a frame, after every effect has been asked for: roll the counts into the pressure for the next frame. */
  frame(alive: number) {
    const v = this.v;
    const ask = this.spawned / Math.max(1, v.fxDustPerFrame);
    const live = alive / Math.max(1, this.pool * v.fxLiveShare);
    // Live dust past the share pushes harder (it means puffs are about to be recycled young).
    const p = Math.max(ask, live >= 1 ? 1 + (live - 1) * 4 : live);
    // Smooth a little so one burst frame doesn't flap the trim.
    this.pressure += (p - this.pressure) * 0.5;
    this.trimL = Math.max(0, Math.min(1, (this.pressure - 1) / Math.max(0.05, v.fxTrimSpan)));
    this.stats.spawned = this.spawned;
    this.stats.pressure = this.pressure;
    Object.assign(this.last, this.stats);
    this.stats.asked = 0; this.stats.full = 0; this.stats.thinned = 0; this.stats.merged = 0;
    this.spawned = 0;
  }
}
