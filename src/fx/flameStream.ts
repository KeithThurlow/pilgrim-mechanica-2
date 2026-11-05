// The flamer's stream as one continuous line (Keith 2026-11-05, with a reference of a flame tank: "a line that you'd
// expect to see ... it would arc out, and as it builds pressure it arcs out further"). Pure maths, cosmetic and local:
// no three.js, no drawing (flameTube.ts draws it).
// Each pouring nozzle lets go of a fuel point every `every` s, at the nozzle with the gun's velocity; every point then
// flies its own ballistic arc (gravity, a little drag), so a stream that's swung bends like water from a hose. The
// points joined in order (with the nozzle at the near end) make the line. A point that reaches the sand lands (the
// caller splashes a ground fire there); one that runs out of fuel in the air burns out (the caller lets a fireball
// rise). Where a point goes from the middle, the line breaks there.

/** A point's end: it came down on the sand, or burnt out in the air. */
export type StreamEnd = "land" | "burnout";

export interface StreamGround { height(x: number, z: number): number }

/** One nozzle's line. Points are kept oldest first. */
export class FuelLine {
  static readonly MAX = 96;
  n = 0;
  readonly px = new Float32Array(FuelLine.MAX); readonly py = new Float32Array(FuelLine.MAX); readonly pz = new Float32Array(FuelLine.MAX);
  readonly vx = new Float32Array(FuelLine.MAX); readonly vy = new Float32Array(FuelLine.MAX); readonly vz = new Float32Array(FuelLine.MAX);
  readonly age = new Float32Array(FuelLine.MAX); readonly burn = new Float32Array(FuelLine.MAX);
  /** 1: the line starts afresh at this point (the one before it went, or pouring started again). */
  readonly brk = new Uint8Array(FuelLine.MAX);
  /** The nozzle this frame (where the near end of the line is) and what it throws. */
  nx = 0; ny = 0; nz = 0; nvx = 0; nvy = 0; nvz = 0; nBurn = 1;
  /** Width scale (the inferno's is bigger), a freeze ray's (pale, no fire). */
  width = 1; cold = false;
  /** Pouring this frame, and last frame (a new pour starts a new line). */
  live = false; wasLive = false;
  /** Seconds since the nozzle last said it pours: a gun that pours only on its shots (a few a second) still pours in
   *  between, so the line stays joined (the PC render, 2026-11-05: every point was its own one-point strip, no line). */
  since = 0;
  /** Poured this step (for the drawing: the line runs on to the nozzle). */
  pouring = false;
  private acc = 0;
  readonly seed = Math.random() * 100;

  /** Lets go of a point at the nozzle, `dt` s ago (so it's already that far along its arc). */
  private emit(dt: number, G: number) {
    if (this.n >= FuelLine.MAX) this.drop(0, false);
    const i = this.n++;
    this.vx[i] = this.nvx; this.vy[i] = this.nvy - G * dt; this.vz[i] = this.nvz;
    this.px[i] = this.nx + this.nvx * dt; this.py[i] = this.ny + this.nvy * dt - 0.5 * G * dt * dt; this.pz[i] = this.nz + this.nvz * dt;
    this.age[i] = dt; this.burn[i] = this.nBurn;
    this.brk[i] = this.wasLive && i > 0 ? 0 : 1;
    this.wasLive = true;
  }

  /** Takes point i out; the line breaks there unless it was an end. */
  private drop(i: number, breakNext = true) {
    for (let j = i; j < this.n - 1; j++) {
      this.px[j] = this.px[j + 1]; this.py[j] = this.py[j + 1]; this.pz[j] = this.pz[j + 1];
      this.vx[j] = this.vx[j + 1]; this.vy[j] = this.vy[j + 1]; this.vz[j] = this.vz[j + 1];
      this.age[j] = this.age[j + 1]; this.burn[j] = this.burn[j + 1]; this.brk[j] = this.brk[j + 1];
    }
    this.n--;
    if (breakNext && i < this.n && i > 0) this.brk[i] = 1;
    if (i === 0 && this.n > 0) this.brk[0] = 1;
  }

  /** Steps the points; `end` hears each one that lands or burns out (before it goes). */
  step(dt: number, G: number, drag: number, every: number, ground: StreamGround,
    end: (what: StreamEnd, x: number, y: number, z: number, vx: number, vy: number, vz: number) => void) {
    const dr = Math.exp(-drag * dt);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      this.vx[i] *= dr; this.vz[i] *= dr; this.vy[i] = this.vy[i] * dr - G * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
    }
    for (let i = this.n - 1; i >= 0; i--) {
      const g = ground.height(this.px[i], this.pz[i]);
      if (this.py[i] <= g && this.vy[i] < 0) {
        end("land", this.px[i], g, this.pz[i], this.vx[i], this.vy[i], this.vz[i]);
        this.drop(i);
      } else if (this.age[i] >= this.burn[i]) {
        end("burnout", this.px[i], this.py[i], this.pz[i], this.vx[i], this.vy[i], this.vz[i]);
        this.drop(i);
      }
    }
    if (this.live) {
      this.acc += dt;
      while (this.acc >= every) { this.acc -= every; this.emit(this.acc, G); }
    } else { this.acc = every; this.wasLive = false; }
  }
}

/** Every nozzle's line, by a key the gun keeps (its side). */
export class FlameStreams {
  /** How long a line keeps pouring after the nozzle last said so (s). */
  static readonly HOLD = 0.15;
  readonly lines = new Map<object, FuelLine>();

  /** A nozzle pours this frame: at (x, y, z), throwing fuel at (vx, vy, vz) that burns `burn` s. */
  pour(key: object, x: number, y: number, z: number, vx: number, vy: number, vz: number, burn: number, width: number, cold: boolean) {
    let l = this.lines.get(key);
    if (!l) { l = new FuelLine(); this.lines.set(key, l); }
    l.live = true; l.since = 0; l.nx = x; l.ny = y; l.nz = z; l.nvx = vx; l.nvy = vy; l.nvz = vz; l.nBurn = burn; l.width = width; l.cold = cold;
  }

  step(dt: number, G: number, drag: number, every: number, ground: StreamGround,
    end: (line: FuelLine, what: StreamEnd, x: number, y: number, z: number, vx: number, vy: number, vz: number) => void) {
    for (const [key, l] of this.lines) {
      l.step(dt, G, drag, Math.max(0.005, every), ground, (w, x, y, z, vx, vy, vz) => end(l, w, x, y, z, vx, vy, vz));
      // The nozzle must say it pours again next frame.
      const was = l.live;
      l.pouring = was;
      l.since += dt;
      l.live = l.since < FlameStreams.HOLD;
      if (!was && l.n === 0) this.lines.delete(key);
    }
  }
}
