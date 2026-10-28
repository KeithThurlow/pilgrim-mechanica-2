// Loot sounds, made on the fly on the shared audio context (procedural, no files; cosmetic, Math.random is fine):
// - coin: a clumped scrap arriving, a bright two-partial bell clink; a streak climbs a pentatonic scale, a big haul
//   ends on a chime;
// - drop: a clean ding when an item lands, higher and longer the rarer; Epic adds a fifth; Legendary is the big one
//   (a deep resonant hit, a noise thump and a long shimmering tail that climbs);
// - pickup: a rising arpeggio, one note more per rarity tier;
// - the banking count-in: soft ticks as scrap rolls over, a thunk per item (low thump, a click, its rarity's ding),
//   and a payday chord at the end; the loss: a low falling groan with a dull thud.
// Nothing plays until the page has been clicked or a key pressed.
import type { Param } from "../core/tweaks";

export const LOOT_SOUND_DEFAULTS = { lootVolume: 0.5, coinPitch: 1, streakSteps: 10 };
export type LootSoundValues = typeof LOOT_SOUND_DEFAULTS;
export const LOOT_SOUND_PARAMS: Param[] = [
  { key: "lootVolume", label: "Loot sound volume", min: 0, max: 1.5, step: 0.05, group: "Loot" },
  { key: "coinPitch", label: "Scrap clink pitch ×", min: 0.5, max: 2, step: 0.05, group: "Loot" },
  { key: "streakSteps", label: "Scrap streak climbs (notes)", min: 1, max: 20, step: 1, group: "Loot", tip: "How many notes up the scale a fast streak of clumps climbs before it holds" },
];

/** A pentatonic step above a root, in semitones. */
const PENTA = [0, 2, 4, 7, 9];
const semis = (i: number) => PENTA[i % 5] + 12 * Math.floor(i / 5);
const at = (hz: number, st: number) => hz * Math.pow(2, st / 12);

export class LootSound {
  private noiseBuf: AudioBuffer | null = null;
  constructor(private ctx: AudioContext, public v: LootSoundValues) {}

  private get ok() { return this.ctx.state === "running" && this.v.lootVolume > 0; }

  private tone(t0: number, len: number, f0: number, f1: number, gain: number, type: OscillatorType = "sine", attack = 0.004) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * this.v.lootVolume, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + len + 0.02);
  }

  private noise(t0: number, len: number, hz: number, gain: number, type: BiquadFilterType = "lowpass") {
    const ctx = this.ctx;
    if (!this.noiseBuf) {
      const n = ctx.sampleRate, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = hz;
    g.gain.setValueAtTime(gain * this.v.lootVolume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + len + 0.02);
  }

  /** A bell: a fundamental and an inharmonic upper partial. */
  private bell(t0: number, hz: number, len: number, gain: number) {
    this.tone(t0, len, hz, hz, gain, "sine");
    this.tone(t0, len * 0.6, hz * 2.76, hz * 2.76, gain * 0.35, "sine");
    this.tone(t0, len * 0.3, hz * 5.4, hz * 5.4, gain * 0.12, "sine");
  }

  /** A clump of scrap arrived: streak = clumps in a row so far (0 first), big = the last of a big haul. */
  coin(streak: number, big = false) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, root = 1320 * this.v.coinPitch;
    const st = semis(Math.min(streak, Math.max(1, this.v.streakSteps)));
    const hz = at(root, st) * (1 + (Math.random() - 0.5) * 0.01);
    this.noise(t, 0.03, 6000, 0.12, "highpass");
    this.bell(t, hz, 0.16, 0.22);
    this.bell(t + 0.035, hz * 1.5, 0.12, 0.1);
    if (big) [0, 4, 7, 12].forEach((s, i) => this.bell(t + 0.08 + i * 0.06, at(hz, s), 0.5, 0.18));
  }

  /** An item landed on the sand: tier 0 (Common) to 4 (Legendary). */
  drop(tier: number) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    if (tier >= 4) { this.legendary(t); return; }
    const hz = at(880, tier * 3);
    this.bell(t, hz, 0.5 + tier * 0.25, 0.22 + tier * 0.03);
    if (tier >= 2) this.bell(t + 0.09, hz * 1.5, 0.6 + tier * 0.2, 0.14);
    if (tier >= 3) { this.bell(t + 0.18, hz * 2, 0.9, 0.12); this.tone(t, 0.6, 110, 70, 0.3); }
  }

  /** The legendary drop: a deep resonant hit, a thump of noise, a long shimmering tail that climbs. */
  private legendary(t: number) {
    this.tone(t, 2.4, 82, 41, 0.75, "sine", 0.006);
    this.tone(t, 1.6, 164, 110, 0.25, "triangle", 0.006);
    this.noise(t, 0.6, 380, 0.55);
    this.noise(t + 0.02, 0.25, 3000, 0.15, "highpass");
    const root = 660;
    [0, 7, 12, 16, 19, 24, 28, 31].forEach((s, i) => {
      const hz = at(root, s), t0 = t + 0.25 + i * 0.11;
      this.bell(t0, hz, 1.8 - i * 0.08, 0.13);
      this.tone(t0, 2.2, hz * 1.003, hz * 1.003, 0.05, "sine", 0.3);
    });
    for (let k = 0; k < 6; k++) this.tone(t + 0.4 + k * 0.05, 2.6, at(2640, PENTA[k % 5]) * (1 + (Math.random() - 0.5) * 0.004), at(2640, PENTA[k % 5]), 0.035, "sine", 0.5);
  }

  /** Picked an item up: a rising arpeggio, one note more per tier. */
  pickup(tier: number) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, root = at(660, tier * 2);
    for (let i = 0; i <= tier + 1; i++) this.bell(t + i * 0.07, at(root, semis(i * 2)), 0.35, 0.16);
  }

  /** The bank count-in: a soft tick as scrap rolls over. */
  tick(i: number) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.bell(t, at(1760 * this.v.coinPitch, semis(i % 8)), 0.08, 0.1);
  }

  /** An item thunks into the bank. */
  thunk(tier: number) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.22, 150, 55, 0.6, "sine", 0.003);
    this.noise(t, 0.06, 1200, 0.3);
    this.bell(t + 0.04, at(880, tier * 3), 0.4, 0.12);
  }

  /** The count-in done: a payday chord. */
  payday() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16].forEach((s, i) => this.bell(t + i * 0.05, at(784, s), 0.9, 0.14));
  }

  /** The at-risk list lost: a low falling groan and a dull thud. */
  lost() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 1.3, 196, 58, 0.35, "sawtooth", 0.02);
    this.tone(t, 1.3, 98, 40, 0.4, "sine", 0.02);
    this.noise(t, 0.4, 260, 0.4);
  }
}
