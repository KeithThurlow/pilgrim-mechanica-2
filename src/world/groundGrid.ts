// The ground read back from a grid of exact heights (perf, 2026-11-14: in the convoy lab every ground read ran the
// dunes and then the road, the POI pads, the fort walls and the craters again; a quarter of the main thread's tick).
// Nodes every `step` metres hold DuneField.heightExact, worked out on first use; a read is bilinear between the four
// nodes round it, and a read on a node is exact. A node is forgotten when a box over it is invalidated (the ground
// changed there: a crater, the plough's cut, a site built) and after `ttl` ticks whatever happens, so a change nobody
// announced shows within that time.
// What a read gives depends only on where the nodes are, never on what happens to be remembered, as long as changes
// are announced: so it stays a pure function of position between changes.
// Only readers that turn DuneField.gridReads on round their own work use it (a mech's legs, src/game/mechUnit.ts):
// they ask for the same few metres over and over (under 1% of reads work a height out). Scattered readers would work
// out four heights for one, and what the sim worker mirrors (convoy, craters, escorts) must be the exact ground.
// Ownership: the main thread's. The sim worker and the headless checks read the exact ground.
import type { DuneField } from "./terrain";
import type { Param } from "../core/tweaks";

export const GROUND_GRID_DEFAULTS = {
  groundGrid: 1,
  groundGridTtl: 2,
};
export type GroundGridValues = typeof GROUND_GRID_DEFAULTS;
export const GROUND_GRID_PARAMS: Param[] = [
  { key: "groundGrid", label: "Ground read from a grid", min: 0, max: 1, step: 1, group: "Performance", tip: "1: mechs' legs read the ground from a grid of exact heights every 0.5 m (bilinear between), instead of working the dunes, road, pads, walls and craters out for every read. 0: every read worked out (?groundgrid=0 does the same from the start)" },
  { key: "groundGridTtl", label: "Grid heights kept (s)", min: 0.2, max: 10, step: 0.2, group: "Performance", tip: "A remembered height is worked out again after this long, so a change to the ground that nothing announced shows within that time; announced ones (craters, the plough's cut, sites) show at once" },
];

const BITS = 17, SLOTS = 1 << BITS, EMPTY = 0x7fffffff;

export class GroundGrid {
  private ki = new Int32Array(SLOTS).fill(EMPTY);
  private kj = new Int32Array(SLOTS);
  private h = new Float64Array(SLOTS);
  private born = new Int32Array(SLOTS);
  private now = 0;
  private inv: number;
  /** Reads answered and nodes worked out since takeStats() (for the HUD). */
  private reads = 0;
  private made = 0;

  /** step: metres between nodes; ttl: ticks a node is kept. */
  constructor(readonly field: DuneField, readonly step = 0.5, public ttl = 60) { this.inv = 1 / step; }

  /** Once a tick: nodes older than ttl ticks are worked out again when next read. */
  tick() { this.now++; }

  private node(i: number, j: number) {
    const s = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & (SLOTS - 1);
    if (this.ki[s] === i && this.kj[s] === j && this.now - this.born[s] < this.ttl) return this.h[s];
    const v = this.field.heightExact(i * this.step, j * this.step);
    this.ki[s] = i; this.kj[s] = j; this.h[s] = v; this.born[s] = this.now;
    this.made++;
    return v;
  }

  /** The ground's height at (x, z). */
  height(x: number, z: number) {
    this.reads++;
    const fx = x * this.inv, fz = z * this.inv, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j;
    const a = this.node(i, j);
    if (u === 0 && w === 0) return a;
    const b = this.node(i + 1, j), c = this.node(i, j + 1), d = this.node(i + 1, j + 1);
    return (a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w;
  }

  /** The ground changed in the box: forget the nodes in it and one round it. */
  invalidate(x0: number, z0: number, x1: number, z1: number) {
    const i0 = Math.floor(x0 * this.inv) - 1, i1 = Math.ceil(x1 * this.inv) + 1;
    const j0 = Math.floor(z0 * this.inv) - 1, j1 = Math.ceil(z1 * this.inv) + 1;
    if (!((i1 - i0 + 1) * (j1 - j0 + 1) <= SLOTS)) { this.clear(); return; }
    const ki = this.ki, kj = this.kj;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const s = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & (SLOTS - 1);
      if (ki[s] === i && kj[s] === j) ki[s] = EMPTY;
    }
  }

  /** Forget everything (the field's shape changed, the convoy jumped). */
  clear() { this.ki.fill(EMPTY); }

  /** Reads and nodes worked out since the last call. */
  takeStats() { const s = { reads: this.reads, made: this.made }; this.reads = 0; this.made = 0; return s; }
}
