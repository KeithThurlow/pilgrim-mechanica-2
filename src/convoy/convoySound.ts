// The convoy's sound (Keith 2026-11-05: "tracks moving, bass and noise and tank" as the sound of large heavy metal
// things moving around): one loop of crawler tracks grinding along, at the car nearest the listener (the mech, or the
// pilot on foot), louder the nearer, faster and higher the faster the train rolls, silent when it stops. The recording
// (src/audio/samples.ts, TankTracks) swaps in over the procedural loop below once it loads. Cosmetic: sound only.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Loop, Sfx } from "../audio/sfx";
import { Synth, rng } from "../audio/synth";

export const CONVOY_SOUND_GROUP = "Convoy sound";
export const CONVOY_SOUND_DEFAULTS = {
  tracksLevel: 0.8,
  tracksNear: 25,
  tracksFar: 260,
  tracksSpeedRef: 4,
  tracksPitchBend: 0.35,
};
export type ConvoySoundValues = typeof CONVOY_SOUND_DEFAULTS;
const G = CONVOY_SOUND_GROUP;
export const CONVOY_SOUND_PARAMS: Param[] = [
  { key: "tracksLevel", label: "Tracks level", min: 0, max: 2, step: 0.01, group: G, tip: "The crawler tracks' grind and rumble, heard from the nearest car; 0 off" },
  { key: "tracksNear", label: "Full level within (m)", min: 2, max: 100, step: 1, group: G },
  { key: "tracksFar", label: "Silent past (m)", min: 30, max: 800, step: 5, group: G, tip: "Fades out between the two (a low rumble far out on the sand tells you where home is)" },
  { key: "tracksSpeedRef", label: "Plays at its own pitch at (m/s)", min: 0.5, max: 12, step: 0.1, group: G },
  { key: "tracksPitchBend", label: "Pitch follows speed", min: 0, max: 1, step: 0.01, group: G, tip: "0: one pitch whatever the speed; 1: twice as fast is an octave up" },
];

/** A 2 s procedural loop: a low engine and ground rumble, the tread's plates clanking over the sprockets, a gravel hiss. */
function tracksLoop(rate: number): Float32Array {
  const S = new Synth(rate), r = rng(9071), n = S.n(2), out = new Float32Array(n);
  // Rumble: band noise 25-160 Hz with a slow uneven wobble, and a 31 Hz engine drone with a little roughness.
  const rumble = S.band(r, 2, 25, 160, 1, 0.0005, 0);
  const hiss = S.band(r, 2, 1200, 5000, 0.12, 0.0005, 0);
  for (let i = 0; i < n; i++) {
    const t = i / rate, wob = 0.75 + 0.25 * Math.sin(2 * Math.PI * 1.5 * t) * Math.sin(2 * Math.PI * 0.5 * t);
    const drone = Math.sin(2 * Math.PI * 31 * t + 0.4 * Math.sin(2 * Math.PI * 7 * t)) * 0.18 + Math.sin(2 * Math.PI * 62 * t) * 0.06;
    out[i] = rumble[i] * 0.55 * wob + drone + hiss[i];
  }
  // Plate clanks: 16 per loop (8 Hz: plates over sprockets at a crawl), each a dull ring with a little jitter.
  for (let k = 0; k < 16; k++) {
    const at = Math.floor(((k + (r() - 0.5) * 0.15) / 16) * n);
    const c = S.mix(S.clang(r, 0.09, 0.08 + r() * 0.05), S.thump(0.08, 90 + r() * 30, 50, 0.12));
    for (let i = 0; i < c.length; i++) out[(at + i + n) % n] += c[i];
  }
  // The band noise starts and ends at different values: fold the last 0.1 s into the first so it loops seamlessly.
  const xf = Math.round(0.1 * rate), loop = out;
  for (let i = 0; i < xf; i++) { const t = i / xf; loop[i] = loop[i] * t + loop[n - xf + i] * (1 - t); }
  return loop.slice(0, n - xf);
}

export class ConvoySound {
  private loop: Loop | null = null;
  private ver = -1;
  private at = new THREE.Vector3();

  constructor(private sfx: Sfx, private v: ConvoySoundValues) {
    if (!sfx.hasSound("tankTracks")) sfx.addSound("tankTracks", [tracksLoop(sfx.rate)], () => v.tracksLevel);
  }

  /** Each frame: where the cars are, how fast the train rolls (m/s) and where the listener is. */
  update(cars: readonly { x: number; y: number; z: number }[], speed: number, listener: { x: number; z: number }) {
    const v = this.v, sfx = this.sfx;
    if (!sfx.running || !cars.length) return;
    let best = cars[0], bd = Infinity;
    for (const c of cars) { const d = (c.x - listener.x) ** 2 + (c.z - listener.z) ** 2; if (d < bd) { bd = d; best = c; } }
    const d = Math.sqrt(bd), moving = Math.min(1, speed / Math.max(0.1, v.tracksSpeedRef * 0.25));
    const fall = d <= v.tracksNear ? 1 : Math.max(0, 1 - (d - v.tracksNear) / Math.max(1, v.tracksFar - v.tracksNear)) ** 2;
    const volume = fall * moving;
    // A recording swapped in (or out) since the loop started: start it again on the new sound.
    if (this.loop && this.ver !== sfx.soundVersion("tankTracks")) { sfx.stopLoop(this.loop, 0.3); this.loop = null; }
    if (volume <= 0.001) { if (this.loop) { sfx.stopLoop(this.loop, 0.4); this.loop = null; } return; }
    if (!this.loop) { this.loop = sfx.startSoundLoop("tankTracks", Math.random()); this.ver = sfx.soundVersion("tankTracks"); if (!this.loop) return; }
    const pitch = Math.pow(Math.max(0.05, speed) / Math.max(0.1, v.tracksSpeedRef), v.tracksPitchBend);
    sfx.setSoundLoop(this.loop, "tankTracks", this.at.set(best.x, best.y + 1, best.z), volume, Math.max(0.5, Math.min(2, pitch)));
  }

  stop() { if (this.loop) { this.sfx.stopLoop(this.loop, 0.3); this.loop = null; } }
}
