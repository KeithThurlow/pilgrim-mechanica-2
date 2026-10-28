// Loot sounds, made on the fly on the shared audio context (procedural, no files; cosmetic, Math.random is fine).
// Keith 2026-10-28: the first pass was too gacha (bells, coins); the game is Mad Max, so items are an electric guitar
// and scrap is heavy steel.
// - drop: a Karplus-Strong plucked string (rendered into a buffer, `pluck`) through a drive (tanh waveshaper), a
//   cabinet (tightening high-pass, mid scoop, two low-passes at the tone) and a little room (generated impulse).
//   Common a palm-muted chug, Uncommon a two-note chug, Rare a ringing power chord (root, fifth, octave), Epic a
//   power chord bent up a whole step over a sub hit, Legendary the signature: a held low power chord, feedback
//   swelling into a squeal while the chord dives on the whammy, a noise crash and a deep hit;
// - pickup: the same voice, shorter;
// - coin (a scrap clump landing): a steel clank (inharmonic plate partials, a low thud, a grit transient, randomised
//   per hit); a fast streak adds layers and weight, not pitch, with the odd chain rattle or ratchet; a big haul ends
//   in a dumped-scrap slam;
// - banking: clanks roll in as the scrap counts, items thunk across as heavy crates, an industrial clunk at the end
//   with a power-chord sting on BANKED; the loss: a low detuned drone and a sludgy chord falling, and a dull thud.
// Nothing plays until the page has been clicked or a key pressed.
import type { Param } from "../core/tweaks";

export const LOOT_SOUND_DEFAULTS = {
  lootVolume: 0.5,
  guitarDrive: 14, guitarTone: 3000, guitarRoom: 0.25,
  volCommon: 0.8, volUncommon: 0.9, volRare: 1, volEpic: 1.1, volLegendary: 1.2,
  clankWeight: 0.6, clankBright: 0.4, streakBuild: 8, scrapVolume: 1,
};
export type LootSoundValues = typeof LOOT_SOUND_DEFAULTS;
export const LOOT_SOUND_PARAMS: Param[] = [
  { key: "lootVolume", label: "Loot sound volume", min: 0, max: 1.5, step: 0.05, group: "Loot" },
  { key: "guitarDrive", label: "Guitar drive", min: 1, max: 40, step: 1, group: "Loot", tip: "How hard the item-drop guitar clips: low is a clean crunch, high a fuzz wall" },
  { key: "guitarTone", label: "Guitar tone (Hz)", min: 800, max: 8000, step: 100, group: "Loot", tip: "The cabinet's low-pass: lower is darker" },
  { key: "guitarRoom", label: "Guitar room", min: 0, max: 1, step: 0.05, group: "Loot", tip: "How much of the guitar goes into the room reverb" },
  { key: "volCommon", label: "Drop volume: Common (chug)", min: 0, max: 2, step: 0.05, group: "Loot" },
  { key: "volUncommon", label: "Drop volume: Uncommon (two chugs)", min: 0, max: 2, step: 0.05, group: "Loot" },
  { key: "volRare", label: "Drop volume: Rare (power chord)", min: 0, max: 2, step: 0.05, group: "Loot", tip: "Also the BANKED sting" },
  { key: "volEpic", label: "Drop volume: Epic (bend + sub)", min: 0, max: 2, step: 0.05, group: "Loot" },
  { key: "volLegendary", label: "Drop volume: Legendary", min: 0, max: 2, step: 0.05, group: "Loot" },
  { key: "clankWeight", label: "Scrap clank weight", min: 0, max: 1, step: 0.05, group: "Loot", tip: "Lower pitch, a bigger thud, longer ring" },
  { key: "clankBright", label: "Scrap clank brightness", min: 0, max: 1, step: 0.05, group: "Loot", tip: "Upper metal partials and the grit on impact" },
  { key: "streakBuild", label: "Scrap streak build (clumps)", min: 1, max: 20, step: 1, group: "Loot", tip: "Clumps in a fast streak before the clanks reach full weight and density" },
  { key: "scrapVolume", label: "Scrap volume", min: 0, max: 2, step: 0.05, group: "Loot", tip: "Clanks, the slam, the bank's crates and clunk" },
];

const at = (hz: number, st: number) => hz * Math.pow(2, st / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const FIFTH = 1.4983;
const E2 = 82.41;
/** Thick-plate mode ratios: inharmonic, so the clank reads as steel, not a bell. */
const PLATE = [1, 1.53, 2.11, 2.74, 3.35, 4.16, 5.23];

export interface PluckOpts { t60: number; damp: number; bright: number }

/** A Karplus-Strong string, pure: noise burst (low-passed by `bright`) circulating in a delay line of one period,
 *  averaged (and further low-passed by `damp`, 1 = plain, low = palm-muted) and decayed to -60 dB over `t60`. */
export function pluck(sr: number, hz: number, len: number, o: PluckOpts): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.ceil(len * sr)), out = new Float32Array(n);
  const N = Math.max(2, Math.round(sr / hz)), buf = new Float32Array(N);
  let lp = 0, mean = 0, peak = 1e-6;
  for (let i = 0; i < N; i++) { lp += o.bright * ((Math.random() * 2 - 1) - lp); buf[i] = lp; mean += lp; }
  mean /= N;
  for (let i = 0; i < N; i++) { buf[i] -= mean; peak = Math.max(peak, Math.abs(buf[i])); }
  for (let i = 0; i < N; i++) buf[i] /= peak;
  const g = Math.pow(0.001, 1 / (hz * Math.max(0.01, o.t60)));
  let idx = 0, prev = buf[N - 1], f = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    f += o.damp * (0.5 * (cur + prev) - f);
    prev = cur; buf[idx] = g * f; out[i] = cur;
    idx = idx + 1 === N ? 0 : idx + 1;
  }
  return out;
}

type Amp = { input: GainNode; out: GainNode };

export class LootSound {
  private noiseBuf: AudioBuffer | null = null;
  private room: ConvolverNode | null = null;
  private curve: Float32Array<ArrayBuffer> | null = null;
  private curveDrive = -1;
  constructor(private ctx: AudioContext, public v: LootSoundValues) {}

  private get ok() { return this.ctx.state === "running" && this.v.lootVolume > 0; }
  private tierVol(tier: number) {
    const v = this.v;
    return [v.volCommon, v.volUncommon, v.volRare, v.volEpic, v.volLegendary][Math.max(0, Math.min(4, tier))];
  }

  // ---- shared plumbing ----

  private roomIn(): ConvolverNode {
    if (this.room) return this.room;
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * 1.3), b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = t < 0.012 ? 0 : (Math.random() * 2 - 1) * Math.exp(-t * 4.2) * 0.5;
      }
    }
    this.room = ctx.createConvolver();
    this.room.buffer = b;
    this.room.connect(ctx.destination);
    return this.room;
  }

  private send(node: AudioNode, amount: number) {
    if (amount <= 0) return;
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(this.roomIn());
  }

  private shaperCurve(): Float32Array<ArrayBuffer> {
    const k = Math.max(1, this.v.guitarDrive);
    if (this.curve && this.curveDrive === k) return this.curve;
    const n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
    // A touch of asymmetry (bias) for some even harmonics, like a pushed valve stage.
    const bias = 0.08, off = Math.tanh(k * bias);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = (Math.tanh(k * (x + bias)) - off) / (norm + Math.abs(off));
    }
    this.curve = c; this.curveDrive = k;
    return c;
  }

  /** The amp: tighten (high-pass) → drive → cabinet (mid scoop, two low-passes at the tone) → volume, plus room. */
  private amp(gain: number, opts: { driveMul?: number; toneMul?: number; room?: number } = {}): Amp {
    const ctx = this.ctx;
    const input = ctx.createGain(); input.gain.value = 0.6 * (opts.driveMul ?? 1);
    const tight = ctx.createBiquadFilter(); tight.type = "highpass"; tight.frequency.value = 90;
    const sh = ctx.createWaveShaper(); sh.curve = this.shaperCurve(); sh.oversample = "4x";
    const scoop = ctx.createBiquadFilter(); scoop.type = "peaking"; scoop.frequency.value = 750; scoop.Q.value = 0.8; scoop.gain.value = -5;
    const low = ctx.createBiquadFilter(); low.type = "peaking"; low.frequency.value = 130; low.Q.value = 1; low.gain.value = 4;
    const tone = this.v.guitarTone * (opts.toneMul ?? 1);
    const lp1 = ctx.createBiquadFilter(); lp1.type = "lowpass"; lp1.frequency.value = tone; lp1.Q.value = 0.9;
    const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = tone * 1.4; lp2.Q.value = 0.5;
    const out = ctx.createGain(); out.gain.value = 0.22 * gain * this.v.lootVolume;
    input.connect(tight).connect(sh).connect(scoop).connect(low).connect(lp1).connect(lp2).connect(out);
    out.connect(ctx.destination);
    this.send(out, opts.room ?? this.v.guitarRoom);
    return { input, out };
  }

  /** One string into the amp; returns its source so a bend or dive can ride playbackRate. */
  private string(a: Amp, t0: number, hz: number, len: number, o: PluckOpts, gain = 1, release = 0.05) {
    const ctx = this.ctx, data = pluck(ctx.sampleRate, hz, len, o);
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.copyToChannel(data, 0);
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b;
    g.gain.setValueAtTime(gain, t0);
    g.gain.setValueAtTime(gain, t0 + Math.max(0, len - release));
    g.gain.linearRampToValueAtTime(0, t0 + len);
    s.connect(g).connect(a.input);
    s.start(t0); s.stop(t0 + len + 0.02);
    return s;
  }

  /** A palm-muted chug on a root and its fifth. */
  private chug(a: Amp, t0: number, root: number, len = 0.2, gain = 1) {
    const o = { t60: 0.35, damp: 0.22, bright: 0.5 };
    this.string(a, t0, root, len, o, gain, 0.06);
    this.string(a, t0 + 0.004, root * FIFTH, len, o, gain * 0.8, 0.06);
    this.noise(t0, 0.015, 2500, 0.25 * gain, "highpass", a.input); // the pick
  }

  /** A strummed power chord (root, fifth, octave); returns the sources for bends. */
  private power(a: Amp, t0: number, root: number, len: number, t60 = 4, gain = 1) {
    const o = { t60, damp: 0.95, bright: 0.7 };
    const ss = [1, FIFTH, 2].map((m, i) => this.string(a, t0 + i * rnd(0.008, 0.014), root * m, len, o, gain * (i === 2 ? 0.7 : 1), 0.25));
    this.noise(t0, 0.02, 2000, 0.3 * gain, "highpass", a.input);
    return ss;
  }

  private tone(t0: number, len: number, f0: number, f1: number, gain: number, type: OscillatorType = "sine", attack = 0.004, dest: AudioNode = this.ctx.destination) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + len + 0.02);
    return g;
  }

  private noise(t0: number, len: number, hz: number, gain: number, type: BiquadFilterType = "lowpass", dest: AudioNode = this.ctx.destination, q = 0.7) {
    const ctx = this.ctx;
    if (!this.noiseBuf) {
      const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = hz; f.Q.value = q;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + len + 0.02);
    return g;
  }

  /** A deep hit under the guitar (clean, not through the amp). */
  private sub(t0: number, hz: number, len: number, gain: number) {
    const g = gain * this.v.lootVolume;
    this.tone(t0, len, hz, hz * 0.55, g, "sine", 0.004);
    this.noise(t0, len * 0.4, 180, g * 0.6);
  }

  // ---- item drops and pickups: the guitar ----

  /** An item landed on the sand: tier 0 (Common) to 4 (Legendary). */
  drop(tier: number) {
    if (!this.ok) return;
    this.riff(tier, this.ctx.currentTime, false);
  }

  /** Picked an item up: the same voice, shorter. */
  pickup(tier: number) {
    if (!this.ok) return;
    this.riff(tier, this.ctx.currentTime, true);
  }

  private riff(tier: number, t: number, short: boolean) {
    const vol = this.tierVol(tier) * (short ? 0.75 : 1);
    if (vol <= 0) return;
    if (tier <= 0) { this.chug(this.amp(vol), t, E2, short ? 0.12 : 0.2); return; }
    if (tier === 1) {
      const a = this.amp(vol), gap = short ? 0.08 : 0.13;
      this.chug(a, t, E2, short ? 0.1 : 0.14);
      this.chug(a, t + gap, at(E2, 3), short ? 0.12 : 0.22); // up a minor third
      return;
    }
    if (tier === 2) { this.power(this.amp(vol), t, E2, short ? 0.4 : 1.8, short ? 0.8 : 4); return; }
    if (tier === 3) {
      const a = this.amp(vol), len = short ? 0.5 : 1.9, root = at(E2, 5); // A
      const bendAt = t + (short ? 0.08 : 0.16), bendLen = short ? 0.1 : 0.22;
      for (const s of this.power(a, t, root, len, short ? 1 : 4)) {
        s.playbackRate.setValueAtTime(1, bendAt);
        s.playbackRate.exponentialRampToValueAtTime(at(1, 2), bendAt + bendLen); // a whole step up
      }
      this.sub(t, 55, short ? 0.4 : 0.8, 0.7 * vol);
      return;
    }
    this.legendary(t, vol, short);
  }

  /** The signature: a held low power chord, feedback swelling into a squeal while the chord dives on the whammy,
   *  a crash and a deep hit. */
  private legendary(t: number, vol: number, short: boolean) {
    const ctx = this.ctx, a = this.amp(vol, { room: this.v.guitarRoom * 1.6 });
    const len = short ? 0.8 : 3.8;
    const ss = this.power(a, t, E2, len, short ? 1.5 : 7, 1.1);
    ss.push(this.string(a, t, E2 / 2, len, { t60: short ? 1.5 : 7, damp: 0.9, bright: 0.6 }, 0.8, 0.3)); // the low string
    this.sub(t, 49, short ? 0.6 : 1.4, 1.1 * vol);
    // The crash: bright noise, clean, into the room.
    const crash = this.noise(t, short ? 0.6 : 2.4, 5000, 0.35 * vol * this.v.lootVolume, "highpass");
    this.send(crash, 0.4);
    this.noise(t, short ? 0.4 : 1.6, 8500, 0.2 * vol * this.v.lootVolume, "bandpass", ctx.destination, 1.5);
    if (short) return;
    // Feedback: a harmonic swells up through the amp, then squeals a fifth higher with vibrato.
    const fbHz = E2 * 8, swell = t + 0.35, squeal = t + 1.7, end = t + 3.6;
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(fbHz, t);
    o.frequency.setValueAtTime(fbHz, squeal);
    o.frequency.exponentialRampToValueAtTime(fbHz * FIFTH * 1.002, squeal + 0.12);
    lfo.frequency.value = 6.5;
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.setValueAtTime(0, squeal + 0.2);
    lfoG.gain.linearRampToValueAtTime(fbHz * 0.02, squeal + 0.7);
    lfo.connect(lfoG).connect(o.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02, swell);
    g.gain.exponentialRampToValueAtTime(0.7, squeal);
    g.gain.setValueAtTime(0.7, end - 0.6);
    g.gain.linearRampToValueAtTime(0, end);
    o.connect(g).connect(a.input);
    o.start(t); lfo.start(t); o.stop(end + 0.05); lfo.stop(end + 0.05);
    // The whammy dive under the squeal.
    const dive = t + 1.9;
    for (const s of ss) {
      s.playbackRate.setValueAtTime(1, dive);
      s.playbackRate.exponentialRampToValueAtTime(0.32, t + 3.4);
    }
  }

  // ---- scrap: steel ----

  /** One steel clank: plate partials, a low thud, a grit transient. w = weight 0-1, gain already scaled. */
  private clank(t0: number, w: number, bright: number, gain: number, dest: AudioNode) {
    const f0 = lerp(430, 140, w) * rnd(0.82, 1.22);
    const ring = lerp(0.07, 0.2, w) * rnd(0.7, 1.3);
    PLATE.forEach((r, k) => {
      const hz = f0 * r * rnd(0.96, 1.04);
      if (hz > 12000) return;
      const amp = gain * 0.22 / (1 + k * 0.5) * (k >= 3 ? Math.pow(Math.max(0.05, bright), (k - 2) / 2) : 1);
      this.tone(t0 + rnd(0, 0.002), ring / (1 + k * 0.35), hz, hz * rnd(0.995, 1), amp, "sine", 0.0008, dest);
    });
    const thudHz = lerp(150, 75, w) * rnd(0.9, 1.1);
    this.tone(t0, lerp(0.07, 0.16, w), thudHz, thudHz * 0.5, gain * lerp(0.25, 0.6, w), "sine", 0.002, dest);
    this.noise(t0, rnd(0.02, 0.045), lerp(1100, 4800, bright) * rnd(0.8, 1.2), gain * lerp(0.15, 0.3, bright), "bandpass", dest, 1.2);
  }

  /** The scrap bus: a low-pass at the brightness, scrap volume, a little room. */
  private scrapBus(gainMul = 1): GainNode {
    const ctx = this.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = lerp(2500, 10000, this.v.clankBright);
    g.gain.value = this.v.scrapVolume * this.v.lootVolume * gainMul;
    g.connect(lp).connect(ctx.destination);
    this.send(lp, 0.12);
    return g;
  }

  /** A chain rattle (uneven) or a ratchet (even): small, light, high clanks in a run. */
  private rattle(t0: number, count: number, gain: number, dest: AudioNode) {
    const ratchet = Math.random() < 0.4, step = rnd(0.018, 0.028);
    let t = t0;
    for (let i = 0; i < count; i++) {
      this.clank(t, 0, this.v.clankBright * 0.6 + 0.3, gain * (ratchet ? 0.5 : rnd(0.3, 0.6)) * (1 - i / (count + 2)), dest);
      t += ratchet ? step : rnd(0.012, 0.04);
    }
  }

  /** A clump of scrap arrived: streak = clumps in a row so far (0 first), big = the last of a big haul. */
  coin(streak: number, big = false) {
    if (!this.ok || this.v.scrapVolume <= 0) return;
    const t = this.ctx.currentTime, bus = this.scrapBus();
    const b = Math.min(1, streak / Math.max(1, this.v.streakBuild));
    const w = Math.min(1, this.v.clankWeight + 0.25 * b);
    const layers = 1 + Math.round(b * 3 + Math.random() * 0.6);
    const gain = 0.55 + 0.35 * b;
    for (let i = 0; i < layers; i++) this.clank(t + (i ? rnd(0.004, 0.03) : 0), w * rnd(0.8, 1.05), this.v.clankBright, gain / Math.sqrt(1 + i * 0.6), bus);
    if (Math.random() < 0.12 + 0.4 * b) this.rattle(t + rnd(0.03, 0.06), 4 + Math.round(6 * b), 0.5 * gain, bus);
    if (big) this.slam(t + 0.06, bus, 1);
  }

  /** A heavy dump of scrap: a big low thud, a cascade of clanks settling, a long low ring. */
  private slam(t: number, bus: GainNode, size: number) {
    this.tone(t, 0.7, 80, 30, 0.9 * size, "sine", 0.003, bus);
    this.noise(t, 0.45, 350, 0.6 * size, "lowpass", bus);
    this.noise(t, 0.12, 1800, 0.25 * size, "bandpass", bus, 0.8);
    for (let i = 0; i < 10; i++) {
      const dt = 0.3 * Math.pow(i / 10, 1.4) + rnd(0, 0.02);
      this.clank(t + dt, Math.max(0, this.v.clankWeight + 0.3 - i * 0.05), this.v.clankBright, (0.8 - i * 0.05) * size, bus);
    }
    const f0 = lerp(140, 80, this.v.clankWeight);
    PLATE.slice(0, 4).forEach((r, k) => this.tone(t + 0.01, 0.9 / (1 + k * 0.3), f0 * r * rnd(0.98, 1.02), f0 * r, 0.12 * size / (1 + k), "sine", 0.002, bus));
  }

  // ---- banking and loss ----

  /** The bank count-in: a clank as scrap rolls over, getting a little heavier as it goes. */
  tick(i: number) {
    if (!this.ok || this.v.scrapVolume <= 0) return;
    const t = this.ctx.currentTime, bus = this.scrapBus(0.6), b = Math.min(1, i / 12);
    this.clank(t, Math.min(1, this.v.clankWeight * rnd(0.7, 1) + 0.15 * b), this.v.clankBright, 0.5 + 0.3 * b, bus);
    if (i % 4 === 3 && Math.random() < 0.5) this.rattle(t + 0.02, 3, 0.3, bus);
  }

  /** An item thunks into the bank: a heavy crate set down (heavier by tier). */
  thunk(tier: number) {
    if (!this.ok || this.v.scrapVolume <= 0) return;
    const t = this.ctx.currentTime, bus = this.scrapBus(), s = 1 + tier * 0.12;
    this.tone(t, 0.26, 120 / s, 45 / s, 0.75 * s, "sine", 0.002, bus);
    this.noise(t, 0.09, 650, 0.45 * s, "lowpass", bus);
    this.noise(t, 0.03, 2200, 0.12, "bandpass", bus, 1);
    this.clank(t + 0.005, 1, this.v.clankBright * 0.5, 0.35, bus); // the steel corners
    this.tone(t + 0.07, 0.12, 95 / s, 50 / s, 0.35 * s, "sine", 0.002, bus); // it settles
    this.clank(t + 0.075, 0.9, this.v.clankBright * 0.4, 0.2, bus);
  }

  /** The count-in done: an industrial clunk (a latch, a slam), then a power-chord sting on BANKED. */
  payday() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    if (this.v.scrapVolume > 0) {
      const bus = this.scrapBus();
      this.noise(t, 0.012, 3500, 0.35, "highpass", bus); // the latch
      this.tone(t + 0.02, 0.55, 65, 32, 1, "sine", 0.002, bus);
      this.noise(t + 0.02, 0.18, 900, 0.5, "lowpass", bus);
      this.clank(t + 0.02, 1, this.v.clankBright, 0.9, bus);
      this.clank(t + 0.03, 0.85, this.v.clankBright, 0.5, bus);
    }
    const vol = this.v.volRare;
    if (vol > 0) this.power(this.amp(vol), t + 0.12, E2, 1.3, 3);
  }

  /** The at-risk list lost: a low detuned drone falling under a sludgy chord, and a dull thud. */
  lost() {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime, a = this.amp(1.1, { driveMul: 1.8, toneMul: 0.45, room: this.v.guitarRoom * 1.4 });
    const root = at(E2, -2); // D
    const fall = (s: AudioBufferSourceNode, to: number) => {
      s.playbackRate.setValueAtTime(1, t + 0.25);
      s.playbackRate.exponentialRampToValueAtTime(to, t + 2.1);
    };
    const o = { t60: 3, damp: 0.6, bright: 0.55 };
    fall(this.string(a, t + 0.04, root, 2.3, o, 1, 0.5), 0.6);
    fall(this.string(a, t + 0.055, root * 1.012, 2.3, o, 0.9, 0.5), 0.6); // detuned double
    fall(this.string(a, t + 0.07, root * FIFTH * 0.988, 2.3, o, 0.8, 0.5), 0.58); // a sour fifth
    for (const det of [1, 1.007]) {
      const d = ctx.createOscillator(), g = ctx.createGain();
      d.type = "sawtooth";
      d.frequency.setValueAtTime(root * det, t);
      d.frequency.exponentialRampToValueAtTime(root * det * 0.6, t + 2.1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.3);
      g.gain.setValueAtTime(0.25, t + 1.6);
      g.gain.linearRampToValueAtTime(0, t + 2.3);
      d.connect(g).connect(a.input);
      d.start(t); d.stop(t + 2.35);
    }
    this.sub(t, 60, 0.8, 0.8);
  }
}
