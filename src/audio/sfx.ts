// Sound player: generates the sounds at load (src/audio/synth.ts), plays one-shots from a capped voice pool with a
// random variant and a little pitch jitter, pans by screen position, and runs sustained loops (the minigun growl)
// whose level and pitch are bent every frame. Same rules as the old SfxPlayer: a per-kind voice cap and a
// same-instant gate, so a minigun's rounds never sum into distortion.
import * as THREE from "three/webgpu";
import { Synth, rng } from "./synth";
import type { Param } from "../core/tweaks";

export type SfxKind = "spit" | "spinUp" | "spinDown" | "growl" | "brap" | "dirtHit" | "metalHit" | "casing";

export const SFX_DEFAULTS = {
  masterVolume: 0.35,
  spitLevel: 0.05,
  growlLevel: 1.22,
  spinLevel: 0.375,
  brapLevel: 0.19,
  dirtLevel: 0.32,
  metalLevel: 0.3,
  casingLevel: 0.18,
  growlDetune: 1.7,
};
export type SfxValues = typeof SFX_DEFAULTS;

export const SFX_PARAMS: Param[] = [
  { key: "masterVolume", label: "Master volume", min: 0, max: 1, step: 0.01, group: "Sound" },
  { key: "spitLevel", label: "Shot spit", min: 0, max: 1.5, step: 0.01, group: "Sound" },
  { key: "growlLevel", label: "Growl (per gun)", min: 0, max: 2, step: 0.01, group: "Sound" },
  { key: "spinLevel", label: "Spin-up / down", min: 0, max: 2, step: 0.01, group: "Sound" },
  { key: "brapLevel", label: "Impact brap", min: 0, max: 1.5, step: 0.01, group: "Sound" },
  { key: "dirtLevel", label: "Dirt hit", min: 0, max: 1.5, step: 0.01, group: "Sound" },
  { key: "metalLevel", label: "Metal hit", min: 0, max: 1.5, step: 0.01, group: "Sound" },
  { key: "casingLevel", label: "Casings", min: 0, max: 1, step: 0.01, group: "Sound" },
  { key: "growlDetune", label: "Gun detune (%)", min: 0, max: 10, step: 0.1, group: "Sound", tip: "The two guns' growls run this far apart in pitch, so they beat against each other" },
];

const LEVEL: Record<SfxKind, keyof SfxValues> = {
  spit: "spitLevel", spinUp: "spinLevel", spinDown: "spinLevel", growl: "growlLevel", brap: "brapLevel", dirtHit: "dirtLevel", metalHit: "metalLevel", casing: "casingLevel",
};
const PER_KIND = 5, GATE = 0.025;

export class Loop {
  constructor(readonly src: AudioBufferSourceNode, readonly gain: GainNode, readonly pan: StereoPannerNode) {}
}

export class Sfx {
  readonly ctx: AudioContext;
  private master: GainNode;
  private buffers = new Map<SfxKind, AudioBuffer[]>();
  private playing = new Map<SfxKind, AudioBufferSourceNode[]>();
  private last = new Map<SfxKind, number>();
  private tmp = new THREE.Vector3();

  constructor(public v: SfxValues, private camera: THREE.Camera) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.build();
    // Browsers start audio suspended until the page is clicked or a key is pressed.
    const wake = () => { if (this.ctx.state !== "running") void this.ctx.resume(); };
    addEventListener("pointerdown", wake);
    addEventListener("keydown", wake);
  }

  get running() { return this.ctx.state === "running"; }

  private build() {
    const S = new Synth(this.ctx.sampleRate);
    const variants = (n: number, seed: number, make: (r: () => number) => Float32Array) =>
      Array.from({ length: n }, (_, i) => make(rng(seed * 101 + i)));
    const add = (k: SfxKind, data: Float32Array[]) => this.buffers.set(k, data.map((d) => {
      const b = this.ctx.createBuffer(1, d.length, this.ctx.sampleRate);
      b.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
      return b;
    }));
    // The minigun lab's spit: a sharp metallic tick, a chunk of the bolt, a short burst of gas.
    add("spit", variants(3, 1, (r) => S.mix(S.tick(r, 0.03, 0.55), S.thump(0.05, 260, 120, 0.45), S.noise(r, 0.06, 2600, 0.32, 0.0008), S.delay(S.tick(r, 0.02, 0.22), 0.012))));
    // Spin-up: the motor whine with a servo above it, a ratchet speeding up, the barrels' clatter tightening.
    add("spinUp", variants(1, 2, (r) => S.mix(S.whine(1.1, 110, 820, 0.26), S.servo(1.1, 700, 2300, 0.07), S.ratchet(r, 1.1, 9, 58, 0.42, true), S.clatter(r, 1.1, 7, 46, 0.22, true))));
    add("spinDown", variants(1, 3, (r) => S.mix(S.whine(0.9, 820, 90, 0.26), S.servo(0.7, 2300, 500, 0.05), S.ratchet(r, 0.9, 52, 7, 0.36, false), S.clatter(r, 0.8, 42, 6, 0.16, false))));
    // The growl: 22 shot pulses over a 55 Hz saw, a seamless 1 s loop.
    add("growl", variants(1, 4, (r) => S.growl(r, 1, 22, 55)));
    // The slug hit as a mini explosion (Keith 2026-10-18: "less of a tinkle"): a fast low whump, dark noise, low crackle.
    add("brap", variants(4, 5, (r) => S.scale(S.mix(S.thump(0.18, 170 + r() * 50, 58, 0.95), S.noise(r, 0.13, 1300 + r() * 500, 0.6, 0.0015),
      S.noise(r, 0.24, 420, 0.45, 0.004), S.delay(S.lowPass(S.crackle(r, 0.22, 0.5), 1800), 0.03)), 0.8)));
    add("dirtHit", variants(4, 6, (r) => S.mix(S.noise(r, 0.16, 900, 0.55, 0.001), S.thump(0.12, 120, 60, 0.45), S.crackle(r, 0.15, 0.2))));
    // A round on steel (the old game's BulletImpact): a bright tick of noise and a short clang.
    add("metalHit", variants(4, 8, (r) => S.mix(S.noise(r, 0.05, 5000, 0.35, 0.001), S.clang(r, 0.08, 0.12 + r() * 0.06))));
    add("casing", variants(3, 7, (r) => S.casingTonk(r)));
  }

  /** Stereo pan from where a point sits on screen (-0.8 left .. 0.8 right); null when well off screen. */
  private panFor(at: THREE.Vector3): number | null {
    const p = this.tmp.copy(at).project(this.camera);
    if (p.z > 1 || p.x < -1.8 || p.x > 1.8 || p.y < -1.8 || p.y > 1.8) return null;
    return Math.max(-0.8, Math.min(0.8, p.x * 0.6));
  }

  /** rate: playback speed (and pitch) multiplier on top of the small random jitter. */
  play(kind: SfxKind, at: THREE.Vector3, volume = 1, rate = 1, gated = true) {
    if (!this.running) return;
    const pan = this.panFor(at);
    if (pan === null) return;
    const now = this.ctx.currentTime;
    if (gated && now - (this.last.get(kind) ?? -1) < GATE) return;
    const list = this.playing.get(kind) ?? [];
    if (list.length >= PER_KIND) { try { list.shift()!.stop(); } catch { /* already ended */ } }
    this.last.set(kind, now);
    const vs = this.buffers.get(kind)!;
    const src = this.ctx.createBufferSource();
    src.buffer = vs[Math.floor(Math.random() * vs.length)];
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = volume * (this.v[LEVEL[kind]] as number);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.master);
    src.start();
    list.push(src);
    this.playing.set(kind, list);
    src.onended = () => { const l = this.playing.get(kind); if (l) { const i = l.indexOf(src); if (i >= 0) l.splice(i, 1); } };
  }

  /** Start a looping sound; bend it with setLoop. offset picks where in the loop it starts (so two loops don't phase-lock). */
  startLoop(kind: SfxKind, offset = 0): Loop {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(kind)![0];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    const p = this.ctx.createStereoPanner();
    src.connect(g).connect(p).connect(this.master);
    src.start(0, offset * src.buffer.duration);
    return new Loop(src, g, p);
  }

  setLoop(loop: Loop, at: THREE.Vector3, volume: number, pitch: number, kind: SfxKind = "growl") {
    const t = this.ctx.currentTime;
    const pan = this.panFor(at) ?? 0;
    loop.gain.gain.setTargetAtTime(volume * (this.v[LEVEL[kind]] as number), t, 0.02);
    loop.src.playbackRate.setTargetAtTime(Math.max(0.05, pitch), t, 0.03);
    loop.pan.pan.setTargetAtTime(pan, t, 0.05);
  }

  /** Call each frame (master level follows the slider). */
  update() { this.master.gain.value = this.v.masterVolume; }
}
