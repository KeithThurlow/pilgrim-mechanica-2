// Per-bandit clip playback for the baked bandit (pure: no three, no drawing). Each bandit plays one clip at its own
// time and rate; a clip change starts a crossfade from the old clip (kept playing) to the new one, carrying the
// cycle's phase between moving loops so the feet don't jump. rows() turns that into the texture rows and blend
// weights the vertex shader samples (banditVat.ts).
import type { VatClip } from "./banditVatFormat";

/** Clips that move the feet in a cycle: switching among these keeps the phase. */
export interface AnimClip extends VatClip { cycle: boolean }

export class BanditAnim {
  readonly clip: Uint8Array; readonly t: Float32Array; readonly rate: Float32Array;
  readonly prev: Uint8Array; readonly prevT: Float32Array; readonly prevRate: Float32Array;
  /** Crossfade progress 0..1 (1: only the current clip). */
  readonly fade: Float32Array;

  constructor(readonly clips: AnimClip[], max: number) {
    this.clip = new Uint8Array(max); this.t = new Float32Array(max); this.rate = new Float32Array(max);
    this.prev = new Uint8Array(max); this.prevT = new Float32Array(max); this.prevRate = new Float32Array(max);
    this.fade = new Float32Array(max).fill(1);
  }

  /** Start a slot fresh on a clip at time t (no fade). */
  reset(i: number, clip: number, t: number): void {
    this.clip[i] = this.prev[i] = clip; this.t[i] = this.prevT[i] = t; this.rate[i] = this.prevRate[i] = 1; this.fade[i] = 1;
  }

  /** Play `clip` at `rate`; a change fades over fadeTime (s). restart: begin the clip from its start (one-shots). */
  play(i: number, clip: number, rate: number, restart = false): void {
    const cur = this.clip[i];
    if (clip !== cur || restart) {
      const a = this.clips[cur], b = this.clips[clip];
      this.prev[i] = cur; this.prevT[i] = this.t[i]; this.prevRate[i] = this.rate[i];
      this.clip[i] = clip;
      this.t[i] = !restart && a.cycle && b.cycle ? (this.t[i] / a.duration) * b.duration : 0;
      this.fade[i] = 0;
    }
    this.rate[i] = rate;
  }

  step(i: number, dt: number, fadeTime: number): void {
    this.t[i] += dt * this.rate[i];
    if (this.fade[i] < 1) {
      this.prevT[i] += dt * this.prevRate[i];
      this.fade[i] = fadeTime > 1e-4 ? Math.min(1, this.fade[i] + dt / fadeTime) : 1;
    }
  }

  /** Seconds the current clip has left (one-shots; Infinity for loops). */
  left(i: number): number {
    const c = this.clips[this.clip[i]];
    return c.loop ? Infinity : c.duration - this.t[i];
  }

  /**
   * Texture rows for slot i into out[o..o+7]: current clip (row, next row, between), weight of the previous clip,
   * then the previous clip's (row, next row, between), and 0.
   */
  rows(i: number, out: Float32Array, o: number): void {
    rowOf(this.clips[this.clip[i]], this.t[i], out, o);
    const f = this.fade[i];
    out[o + 3] = f >= 1 ? 0 : 1 - f * f * (3 - 2 * f);
    rowOf(this.clips[this.prev[i]], this.prevT[i], out, o + 4);
    out[o + 7] = 0;
  }
}

function rowOf(c: VatClip, t: number, out: Float32Array, o: number): void {
  const n = c.frames;
  let x = t * c.fps, f0: number, f1: number;
  if (c.loop) {
    x = ((x % n) + n) % n;
    f0 = Math.floor(x); f1 = (f0 + 1) % n;
  } else {
    x = Math.min(Math.max(0, x), n - 1);
    f0 = Math.floor(x); f1 = Math.min(f0 + 1, n - 1);
  }
  out[o] = c.start + f0; out[o + 1] = c.start + f1; out[o + 2] = x - f0;
}
