// Cutting a recorded sound into a game sound (Keith 2026-11-02: the Pixabay sounds, sampled and rebuilt rather than
// played raw). Pure maths on Float32Arrays, so it runs headless (tools/samples-check.ts): find where the sound starts,
// read from there at a playback rate (pitch), keep a length, fade it out, filter it, and match its loudness to the
// procedural sound it stands in for. The bank (sampleBank.ts) feeds it decoded audio and the slider values.

export interface CutOptions {
  /** Seconds after the detected onset to start reading (negative reaches back before it). */
  start: number;
  /** Seconds of output kept, at the output rate. */
  len: number;
  /** Seconds of fade-out at the end (an equal-power curve). */
  fade: number;
  /** Playback rate: 2 an octave up and half as long, 0.5 an octave down. */
  rate: number;
  /** Low-pass corner in Hz (at or over 18 kHz: off). */
  lowpass: number;
  /** High-pass corner in Hz (at or under 25 Hz: off). */
  highpass: number;
}

/** First sample louder than `db` below the peak (the mp3's lead-in and any silence skipped). */
export function onset(x: Float32Array, db = -30): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const th = peak * Math.pow(10, db / 20);
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= th) return i;
  return 0;
}

/** RMS over the first `sec` seconds (the punch, which is what the ear compares between two sounds). */
export function punchRms(x: Float32Array, sr: number, sec = 0.25): number {
  const n = Math.min(x.length, Math.max(1, Math.round(sec * sr)));
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

/** A second-order filter (RBJ cookbook), run in place. */
function biquad(x: Float32Array, sr: number, hz: number, high: boolean) {
  const w = (2 * Math.PI * Math.min(hz, sr * 0.45)) / sr, c = Math.cos(w), a = Math.sin(w) / (2 * Math.SQRT1_2);
  const b0 = high ? (1 + c) / 2 : (1 - c) / 2, b1 = high ? -(1 + c) : 1 - c, b2 = b0;
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
}

/**
 * Cut a sound out of `src` (mono, at `srcRate`) for playback at `outRate`. Reads from the onset plus `start`, at
 * `rate`, with linear interpolation; a 2 ms fade-in so a cut mid-wave doesn't click; the fade-out over the last `fade`
 * seconds; then the filters.
 */
export function cutSample(src: Float32Array, srcRate: number, outRate: number, o: CutOptions): Float32Array {
  const n = Math.max(1, Math.round(o.len * outRate));
  const out = new Float32Array(n);
  const step = (o.rate * srcRate) / outRate;
  let p = onset(src) + o.start * srcRate;
  for (let i = 0; i < n; i++, p += step) {
    const k = Math.floor(p);
    if (k < 0) continue;
    if (k + 1 >= src.length) break;
    out[i] = src[k] + (src[k + 1] - src[k]) * (p - k);
  }
  const fin = Math.min(n, Math.round(0.002 * outRate));
  for (let i = 0; i < fin; i++) out[i] *= i / fin;
  const fo = Math.min(n, Math.max(1, Math.round(o.fade * outRate)));
  for (let i = 0; i < fo; i++) out[n - fo + i] *= Math.cos((i / fo) * Math.PI * 0.5);
  if (o.lowpass < 18000) biquad(out, outRate, o.lowpass, false);
  if (o.highpass > 25) biquad(out, outRate, o.highpass, true);
  return out;
}

/** Scale `x` in place so its punch matches `ref`'s, times `gainDb`; never past `ceiling` at its peak. */
export function matchLoudness(x: Float32Array, sr: number, ref: number, gainDb: number, ceiling = 0.98): Float32Array {
  const have = punchRms(x, sr);
  if (have < 1e-6) return x;
  let k = (ref / have) * Math.pow(10, gainDb / 20), peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak * k > ceiling) k = ceiling / peak;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/** `a` with `b` mixed in at `share` (b's length is cut to a's or a is lengthened to b's). */
export function mixUnder(a: Float32Array, b: Float32Array | undefined, share: number): Float32Array {
  if (!b || share <= 0) return a;
  const out = new Float32Array(Math.max(a.length, b.length));
  out.set(a);
  for (let i = 0; i < b.length; i++) out[i] += b[i] * share;
  return out;
}

/** Stereo (or more) to mono, by averaging the channels. */
export function toMono(chans: Float32Array[]): Float32Array {
  if (chans.length === 1) return chans[0];
  const n = chans[0].length, out = new Float32Array(n);
  for (const c of chans) for (let i = 0; i < n; i++) out[i] += c[i] / chans.length;
  return out;
}

/** The robot remix (Keith 2026-11-02: the underwater recordings made alien), each stage off at 0. */
export interface AlienOptions {
  /** Ring modulation: the sound times a sine at this many Hz (metallic, inharmonic), mixed in at ringMix. */
  ring: number; ringMix: number;
  /** A comb resonator: a feedback delay of this many ms (a pitch of 1000/ms Hz) at this feedback (0..0.95). */
  comb: number; combFb: number;
  /** A resonant band-pass sweeping from sweepFrom to sweepTo Hz over the sound (exponentially), at Q, mixed in at sweepMix. */
  sweepFrom: number; sweepTo: number; sweepQ: number; sweepMix: number;
}

/** Run the robot remix on `x` in place (ring, then comb, then the sweep). */
export function alienize(x: Float32Array, sr: number, o: AlienOptions): Float32Array {
  const n = x.length;
  if (o.ring > 0 && o.ringMix > 0) {
    const w = (2 * Math.PI * o.ring) / sr;
    for (let i = 0; i < n; i++) x[i] = x[i] * (1 - o.ringMix) + x[i] * Math.sin(w * i) * o.ringMix * 2;
  }
  if (o.comb > 0.1 && o.combFb > 0) {
    const d = Math.max(1, Math.round((o.comb / 1000) * sr)), fb = Math.min(0.95, o.combFb), buf = new Float32Array(d);
    for (let i = 0, j = 0; i < n; i++, j = (j + 1) % d) { const y = x[i] + buf[j] * fb; buf[j] = y; x[i] = y * (1 - fb * 0.5); }
  }
  if (o.sweepMix > 0 && o.sweepFrom > 0 && o.sweepTo > 0) {
    // A state-variable filter (Chamberlin), its corner moved every sample; the band output, mixed in.
    const q = 1 / Math.max(0.5, o.sweepQ), lr = Math.log(o.sweepTo / o.sweepFrom);
    let lo = 0, bp = 0;
    for (let i = 0; i < n; i++) {
      const hz = Math.min(sr * 0.2, o.sweepFrom * Math.exp(lr * (i / n)));
      const f = 2 * Math.sin((Math.PI * hz) / sr);
      const hi = x[i] - lo - q * bp;
      bp += f * hi; lo += f * bp;
      x[i] = x[i] * (1 - o.sweepMix) + bp * o.sweepMix * 1.5;
    }
  }
  return x;
}
