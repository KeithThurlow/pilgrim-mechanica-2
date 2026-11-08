// The game clock (docs/architecture-review.md stage 1, Keith 2026-11-07: "30 or 60 Hz" for the sim, drawn as fast as
// the graphics go). One place decides how many sim ticks a drawn frame runs and how long each is.
//
// A fixed tick, 30 Hz (Keith 2026-11-08, after playing 30 Hz on his phone: "we can probably just make 30 hertz the sim
// rate"; was 60 from 2026-11-07; `?tick=60` or 120 to try another rate).
// Real time goes into an accumulator; each frame runs as many whole ticks of 1/hz s as are due (at most `maxTicks`; a
// longer stall drops the rest rather than spiralling), and `alpha` (0..1) says how far the drawn frame is between the
// last tick and the next, for drawing between ticks (src/look/treeInterp.ts). The same inputs give the same results at
// any frame rate (tools/clock-check.ts). The old frame-locked clock (one tick per drawn frame) is gone.
//
// Rate groups: `every(n, phase)` is true on one tick in n, so a part can run at hz/n (far AI, heat, abstract groups;
// review §4.6). Ownership: host (the clock is the world's time; in co-op the host's tick count is the shared clock).


export class Clock {
  /** Ticks a second. */
  readonly hz: number;
  /** The length of a tick (s). */
  readonly dt: number;
  /** Ticks run so far; inside a tick, that tick's number (counts up as each one runs, not per frame). */
  tick = 0;
  /** Ticks run by the last frame. */
  ran = 0;
  /** How far the drawn frame is past the last tick, in ticks (0..1). */
  alpha = 1;
  /** Real time dropped by the catch-up cap (s), for the HUD. */
  dropped = 0;
  private acc = 0;

  constructor(hz = 30, readonly maxTicks = 4) {
    this.hz = hz > 0 ? hz : 60;
    this.dt = 1 / this.hz;
  }

  /** A frame of real time (s): how many ticks are due now (each `dt` long). Use run(), which also counts them. */
  advance(raw: number): number {
    this.acc += Math.max(raw, 0);
    let n = Math.floor(this.acc / this.dt + 1e-9);
    if (n > this.maxTicks) { this.dropped += (n - this.maxTicks) * this.dt; this.acc -= (n - this.maxTicks) * this.dt; n = this.maxTicks; }
    this.acc = Math.max(0, this.acc - n * this.dt);
    this.alpha = Math.min(1, this.acc / this.dt);
    this.ran = n;
    return n;
  }

  /** A frame: runs fn once per due tick (dt each), counting `tick` up after each one. */
  run(raw: number, fn: (dt: number) => void): number {
    const n = this.advance(raw);
    for (let k = 0; k < n; k++) { fn(this.dt); this.tick++; }
    return n;
  }

  /** Rate groups: true on one tick in n (this tick's number, offset by phase). */
  every(n: number, phase = 0): boolean { return n <= 1 || (this.tick + phase) % n === 0; }

  hud(): string {
    return `clock: ${this.hz} Hz tick, ${this.ran} tick${this.ran === 1 ? "" : "s"} this frame, alpha ${this.alpha.toFixed(2)}${this.dropped > 0 ? `, ${this.dropped.toFixed(1)} s dropped` : ""} (mechs, vehicles, robots and infantry are drawn between ticks)`;
  }
}

/** The clock a page asks for: 30 Hz (Keith 2026-11-08), or `?tick=N`. Guns that fire faster than the tick fire
 *  several rounds in one tick (src/mech/upper.ts), so rates of fire hold. */
export function clockFromUrl(params: URLSearchParams): Clock {
  const hz = Number(params.get("tick"));
  return new Clock(Number.isFinite(hz) && hz > 0 ? hz : 30);
}
