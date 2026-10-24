// Procedural sound building blocks, ported from the old project's SfxSynth (Assets/_Project/Combat/Runtime/Audio):
// every sound is generated as a sample array at load, so there are no audio files to manage. Recipes and numbers
// are the old ones (Keith tuned the minigun's in the Unity minigun lab, 2026-10-18 to 2026-10-23).

export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Synth {
  constructor(readonly rate: number) {}
  n(seconds: number) { return Math.max(1, Math.floor(seconds * this.rate)); }

  /** Low-passed noise with a fast attack and exponential decay. */
  noise(r: Rng, len: number, cutoff: number, gain: number, attack: number) {
    const s = new Float32Array(this.n(len));
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / this.rate), decay = 5 / len;
    let lp = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate;
      const env = Math.min(1, t / Math.max(0.0005, attack)) * Math.exp(-decay * t);
      lp += a * (r() * 2 - 1 - lp);
      s[i] = lp * env * gain * 1.6;
    }
    return s;
  }

  /** A sine whose pitch drops (kick, boom body). */
  thump(len: number, fromHz: number, toHz: number, gain: number) {
    const s = new Float32Array(this.n(len));
    let ph = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate;
      ph += (fromHz + (toHz - fromHz) * Math.min(1, t / (len * 0.5))) / this.rate;
      s[i] = Math.sin(ph * 2 * Math.PI) * Math.exp((-5 * t) / len) * Math.min(1, t / 0.002) * gain;
    }
    return s;
  }

  /** A short bright metallic tick: high partials with a very fast decay over a click of noise. */
  tick(r: Rng, len: number, gain: number) {
    const s = new Float32Array(this.n(len));
    const hz = 2600 + r() * 1400;
    let prev = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate, n = r() * 2 - 1, hp = n - prev;
      prev = n;
      const ring = Math.sin(2 * Math.PI * hz * t) + 0.6 * Math.sin(2 * Math.PI * hz * 1.53 * t) + 0.35 * Math.sin(2 * Math.PI * hz * 2.31 * t);
      s[i] = (hp * 0.5 * Math.exp(-t / 0.0015) + ring * 0.4 * Math.exp(-t / (len * 0.25))) * gain;
    }
    return s;
  }

  /** A servo's thin whine: a sine sweeping between two pitches. */
  servo(len: number, fromHz: number, toHz: number, gain: number) {
    const s = new Float32Array(this.n(len));
    let ph = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate, k = t / len;
      ph += (fromHz + (toHz - fromHz) * Math.sqrt(k)) / this.rate;
      s[i] = Math.sin(ph * 2 * Math.PI) * clamp01(t / 0.08) * clamp01((len - t) / 0.15) * gain;
    }
    return s;
  }

  /** A ratcheting gear: ticks whose rate sweeps (a pawl over a turning gear), each with a low knock. */
  ratchet(r: Rng, len: number, fromRate: number, toRate: number, gain: number, rising: boolean) {
    const s = new Float32Array(this.n(len));
    const tk = this.tick(r, 0.012, 1);
    let t = 0.004;
    while (t < len) {
      const k = t / len;
      const rate = fromRate + (toRate - fromRate) * (rising ? k * k * 0.4 + k * 0.6 : Math.sqrt(k));
      const env = rising ? 0.55 + 0.45 * k : 1 - 0.75 * k;
      const at = Math.floor(t * this.rate);
      for (let j = 0; j < tk.length && at + j < s.length; j++) {
        const knock = Math.sin((2 * Math.PI * 420 * j) / this.rate) * Math.exp(-j / (this.rate * 0.004)) * 0.35;
        s[at + j] += (tk[j] + knock) * gain * env;
      }
      t += (1 + (r() - 0.5) * 0.12) / Math.max(1, rate);
    }
    return s;
  }

  /** The barrel cluster's clatter: a band of noise beating at the rotation rate, a rattle tightening into a buzz. */
  clatter(r: Rng, len: number, fromHz: number, toHz: number, gain: number, rising: boolean) {
    const s = new Float32Array(this.n(len));
    let ph = 0, lp = 0, lp2 = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate, k = t / len;
      ph += (fromHz + (toHz - fromHz) * (rising ? k : Math.sqrt(k))) / this.rate;
      const phase = ph - Math.floor(ph);
      const sharp = rising ? 7 - 4.5 * k : 2.5 + 4.5 * k;
      const am = Math.exp(-phase * sharp * 3);
      lp += 0.35 * (r() * 2 - 1 - lp);
      lp2 += 0.08 * (lp - lp2);
      const env = (rising ? 0.35 + 0.65 * k : 1 - k) * clamp01(t / 0.03) * clamp01((len - t) / 0.08);
      s[i] = (lp - lp2) * am * env * gain * 3;
    }
    return s;
  }

  /** A motor whine sweeping between pitches (spin-up and spin-down): a saw plus a sine a fifth up. */
  whine(len: number, fromHz: number, toHz: number, gain: number) {
    const s = new Float32Array(this.n(len));
    let a = 0, b = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate, k = t / len;
      const hz = fromHz + (toHz - fromHz) * (fromHz < toHz ? Math.sqrt(k) : k * k * 0.3 + k * 0.7);
      a += hz / this.rate;
      b += (hz * 1.5) / this.rate;
      const saw = 2 * (a - Math.floor(a + 0.5)) * 0.6 + Math.sin(b * 2 * Math.PI) * 0.4;
      s[i] = saw * clamp01(t / 0.05) * clamp01((len - t) / 0.15) * gain;
    }
    return s;
  }

  /** The minigun's growl: shot cracks over a buzzy low saw, whole periods of both so it loops without a seam. */
  growl(r: Rng, len: number, pulses: number, hz: number) {
    const s = new Float32Array(this.n(len));
    const period = len / pulses;
    let lp = 0, body = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate, local = t % period;
      const crack = Math.exp(-local / (period * 0.18));
      lp += 0.25 * (r() * 2 - 1 - lp);
      const ph = t * hz, saw = 2 * (ph - Math.floor(ph + 0.5));
      body += 0.08 * (saw - body);
      const thump = Math.sin(local * 2 * Math.PI * 70) * Math.exp(-local / (period * 0.35));
      s[i] = lp * crack * 0.7 + body * 0.9 + saw * 0.15 + thump * 0.55;
    }
    let mean = 0;
    for (const x of s) mean += x;
    mean /= s.length;
    let peak = 0;
    for (let i = 0; i < s.length; i++) { s[i] -= mean; peak = Math.max(peak, Math.abs(s[i])); }
    const k = peak > 0.89 ? 0.89 / peak : 1;
    for (let i = 0; i < s.length; i++) s[i] *= k;
    return s;
  }

  /** Sparse random pops (debris, crackle after a blast). */
  /** A struck steel plate: four inharmonic partials decaying fast (the old SfxSynth's Clang). */
  clang(r: Rng, len: number, gain: number) {
    const s = new Float32Array(this.n(len));
    const base = 600 + r() * 400, ratios = [1, 1.47, 2.09, 2.76];
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate;
      let v = 0;
      for (let p = 0; p < ratios.length; p++) v += Math.sin(2 * Math.PI * base * ratios[p] * t) * Math.exp(-(8 + p * 6) * t / len) / (p + 1);
      s[i] = v * gain * Math.min(1, t / 0.001);
    }
    return s;
  }

  crackle(r: Rng, len: number, gain: number) {
    const s = new Float32Array(this.n(len));
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate;
      if (r() < 0.0015) s[i] = (r() * 2 - 1) * gain * Math.exp((-3 * t) / len);
      else if (i > 0) s[i] = s[i - 1] * 0.85;
    }
    return s;
  }

  /** A spent casing landing: a dull low steel tonk (Keith 2026-10-23: not a pinging toy). */
  casingTonk(r: Rng) {
    const s = new Float32Array(this.n(0.07));
    const P = 6, lo = 380 + r() * 120;
    const hz: number[] = [], dec: number[] = [], amp: number[] = [];
    for (let p = 0; p < P; p++) {
      const u = (p + 0.2 + 0.6 * r()) / P;
      hz.push(lo * Math.pow(1500 / lo, u));
      dec.push((0.006 + 0.008 * r()) * (1.2 - 0.7 * u));
      amp.push(0.6 + 0.4 * r());
    }
    const oa = 1 - Math.exp((-2 * Math.PI * 1700) / this.rate);
    let lp = 0, o1 = 0, o2 = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate;
      let v = 0;
      for (let p = 0; p < P; p++) v += Math.sin(2 * Math.PI * hz[p] * t) * amp[p] * Math.exp(-t / dec[p]);
      lp += (r() * 2 - 1 - lp) * 0.12;
      const x = (v * 0.09 + lp * Math.exp(-t / 0.003) * 0.6) * Math.min(1, t / 0.0008);
      o1 += oa * (x - o1); o2 += oa * (o1 - o2);
      s[i] = o2;
    }
    return s;
  }

  /**
   * Something cutting and tearing at steel plate (robots on the mech): a wavering metal screech with an inharmonic
   * partial, chattering on and off like teeth catching, over bright hissing grit.
   */
  grind(r: Rng, len: number, gain: number) {
    const s = new Float32Array(this.n(len));
    const f0 = 1900 + r() * 1100, chatter = 28 + r() * 30, wob = 5 + r() * 5;
    let ph = 0, lp = 0;
    for (let i = 0; i < s.length; i++) {
      const t = i / this.rate;
      const env = Math.min(1, t / 0.015) * Math.min(1, (len - t) / 0.09);
      ph += (f0 * (1 + 0.05 * Math.sin(2 * Math.PI * wob * t)) * (1 + 0.015 * (r() - 0.5))) / this.rate;
      const tone = Math.sin(2 * Math.PI * ph) + 0.45 * Math.sin(2 * Math.PI * 2.37 * ph) + 0.2 * Math.sin(2 * Math.PI * 3.9 * ph);
      const ch = 0.5 + 0.5 * Math.max(0, Math.sin(2 * Math.PI * chatter * t + Math.sin(t * 13) * 2));
      const n = r() * 2 - 1;
      lp += 0.35 * (n - lp);
      s[i] = (tone * 0.3 * ch + (n - lp) * 0.7 * (0.5 + 0.5 * ch)) * env * gain;
    }
    return s;
  }

  lowPass(part: Float32Array, hz: number) {
    const a = 1 - Math.exp((-2 * Math.PI * hz) / this.rate), s = new Float32Array(part.length);
    let lp = 0;
    for (let i = 0; i < s.length; i++) { lp += a * (part[i] - lp); s[i] = lp * 2.2; }
    return s;
  }

  delay(part: Float32Array, seconds: number) {
    const d = this.n(seconds), s = new Float32Array(part.length + d);
    s.set(part, d);
    return s;
  }

  /** Sum parts and soft-limit. */
  mix(...parts: Float32Array[]) {
    const s = new Float32Array(Math.max(...parts.map((p) => p.length)));
    for (const p of parts) for (let i = 0; i < p.length; i++) s[i] += p[i];
    for (let i = 0; i < s.length; i++) s[i] = Math.tanh(s[i]);
    return s;
  }

  scale(part: Float32Array, k: number) { for (let i = 0; i < part.length; i++) part[i] *= k; return part; }
}

/** Robots cutting at the mech's plating: a chattering steel screech with a little clank as a tooth catches. */
export function grindRecipe(S: Synth, r: Rng) {
  return S.mix(S.grind(r, 0.3 + r() * 0.2, 0.55), S.delay(S.clang(r, 0.06, 0.1), 0.02 + r() * 0.1));
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
