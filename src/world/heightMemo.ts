// A remembered, coarse copy of the ground for AI that plans over it (perf, 2026-11-06: the convoy escorts' line and lane
// picking was ~15% of the ground samples in the convoy siege, asking for the same patch of dunes every 0.2 s).
// Heights at nodes every `step` metres, sampled exactly from the field on first use and kept for `ttl` seconds (or
// until a box over them is invalidated), read back bilinearly. Not the ground anything stands on: only for scoring
// routes and slopes. Whoever owns it advances `now` (sim time).
// Ownership: whoever runs the AI (host); it never feeds drawing or anything peers must agree on bit for bit.
import type { DuneField } from "./terrain";

const SLOTS = 1 << 15;

export class HeightMemo {
  /** Sim time (s): set by the owner each step. */
  now = 0;
  private ki = new Int32Array(SLOTS).fill(0x7fffffff);
  private kj = new Int32Array(SLOTS);
  private h = new Float64Array(SLOTS);
  private t = new Float64Array(SLOTS);
  /** Samples taken and reads answered since the last call to takeStats() (for the HUD). */
  private sampled = 0;
  private reads = 0;

  constructor(readonly field: DuneField, readonly step = 1.5, readonly ttl = 3) {}

  /** The ground's height at node (i, j). */
  private node(i: number, j: number) {
    const s = ((i * 73856093) ^ (j * 19349663)) & (SLOTS - 1);
    if (this.ki[s] === i && this.kj[s] === j && this.now - this.t[s] < this.ttl) return this.h[s];
    const v = this.field.height(i * this.step, j * this.step);
    this.ki[s] = i; this.kj[s] = j; this.h[s] = v; this.t[s] = this.now;
    this.sampled++;
    return v;
  }

  /** The ground's height at (x, z), bilinear between the four nodes round it. */
  height(x: number, z: number) {
    this.reads++;
    const fx = x / this.step, fz = z / this.step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j;
    const a = this.node(i, j), b = this.node(i + 1, j), c = this.node(i, j + 1), d = this.node(i + 1, j + 1);
    return (a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w;
  }

  /** The ground changed in the box: forget the nodes in it (and one round it). */
  invalidate(x0: number, z0: number, x1: number, z1: number) {
    const i0 = Math.floor(x0 / this.step) - 1, i1 = Math.ceil(x1 / this.step) + 1;
    const j0 = Math.floor(z0 / this.step) - 1, j1 = Math.ceil(z1 / this.step) + 1;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > SLOTS) { this.ki.fill(0x7fffffff); return; }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const s = ((i * 73856093) ^ (j * 19349663)) & (SLOTS - 1);
      if (this.ki[s] === i && this.kj[s] === j) this.ki[s] = 0x7fffffff;
    }
  }

  takeStats() { const r = { sampled: this.sampled, reads: this.reads }; this.sampled = this.reads = 0; return r; }
}
