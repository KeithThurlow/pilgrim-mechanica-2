// Radar sounds, made on the fly on the shared audio context (no files): the zoom across the convoy's range edge (a
// rising chirp out to the convoy's picture, a falling one in to the mech's own) and a low warning tone when fuel
// turns red. Quiet; nothing plays until the page has been clicked or a key pressed.
export class RadarSound {
  constructor(private ctx: AudioContext, public volume = 0.12) {}

  private tone(t0: number, len: number, f0: number, f1: number, gain: number, type: OscillatorType = "sine") {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * this.volume, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + len + 0.02);
  }

  /** Crossing the range edge: out (to the convoy's radar) rises, in (to the mech's) falls. */
  zoom(out: boolean) {
    if (this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    if (out) { this.tone(t, 0.5, 260, 980, 0.8); this.tone(t + 0.42, 0.18, 1400, 1400, 0.5, "triangle"); }
    else { this.tone(t, 0.5, 980, 220, 0.8); this.tone(t + 0.42, 0.18, 330, 330, 0.5, "triangle"); }
  }

  /** Fuel just went red. */
  warn() {
    if (this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 2; k++) this.tone(t + k * 0.22, 0.16, 440, 430, 0.9, "square");
  }

  /** A raid coming: three falling blips. */
  alarm() {
    if (this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 3; k++) this.tone(t + k * 0.18, 0.15, 720, 520, 0.9, "sawtooth");
  }

  /** Banked: a bright double blip. */
  banked() {
    if (this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.12, 880, 880, 0.6, "triangle"); this.tone(t + 0.13, 0.22, 1320, 1320, 0.6, "triangle");
  }
}
