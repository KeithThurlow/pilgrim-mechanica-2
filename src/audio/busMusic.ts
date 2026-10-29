// The party bus's music (Keith 2026-10-29: "loud, lit up, music blaring"): a one-bar loop made at load, procedural
// like every sound here, as heard through a bus's walls: a four-on-the-floor kick, a driven saw bass on the off-beats
// and a fuzz power-chord stab, low-passed and a little crushed. Cosmetic (Math.random is fine); one loop per live bus,
// panned to it and fading with its distance; it cuts out when the bus dies.
import type * as THREE from "three/webgpu";
import type { Loop, Sfx } from "./sfx";

const NAME = "busMusic";
const BPM = 132;

function bar(rate: number): Float32Array {
  const beat = 60 / BPM, n = Math.floor(rate * beat * 4), out = new Float32Array(n);
  const add = (at: number, len: number, f: (t: number, k: number) => number) => {
    const i0 = Math.floor(at * rate), m = Math.floor(len * rate);
    for (let i = 0; i < m && i0 + i < n; i++) out[i0 + i] += f(i / rate, i / m);
  };
  // Kick on every beat: a falling sine thump.
  for (let b = 0; b < 4; b++) add(b * beat, 0.22, (t, k) => Math.sin(2 * Math.PI * (45 * t + 90 * (1 - Math.exp(-t * 30)) / 30)) * (1 - k) ** 2 * 0.9);
  // Bass on the off-beats: A, A, C, G (55, 55, 65.4, 49 Hz), a saw with its own little fall.
  const notes = [55, 55, 65.41, 49];
  for (let b = 0; b < 4; b++) {
    const hz = notes[b];
    add(b * beat + beat / 2, beat * 0.45, (t, k) => {
      const ph = (t * hz) % 1;
      return Math.tanh((ph * 2 - 1) * 2.5) * 0.35 * (1 - k * 0.7);
    });
  }
  // A fuzz power chord (root, fifth, octave) stabbed on 2 and 4.
  for (const b of [1, 3]) add(b * beat, beat * 0.3, (t, k) => {
    const r = 110;
    const s = Math.sin(2 * Math.PI * r * t) + Math.sin(2 * Math.PI * r * 1.5 * t) + 0.6 * Math.sin(2 * Math.PI * r * 2 * t);
    return Math.tanh(s * 3) * 0.22 * (1 - k);
  });
  // Through the walls: a one-pole low-pass, then soft clipping.
  let y = 0;
  const a = 1 - Math.exp(-2 * Math.PI * 900 / rate);
  for (let i = 0; i < n; i++) { y += a * (out[i] - y); out[i] = Math.tanh(y * 1.4) * 0.8; }
  return out;
}

/** The loops for the buses of one war band. */
export class BusMusic {
  private loops = new Map<object, Loop>();
  constructor(private sfx: Sfx, private level: () => number) {
    if (!(sfx as unknown as { busMusicMade?: boolean }).busMusicMade) {
      sfx.addSound(NAME, [bar(sfx.rate)], () => 1);
      (sfx as unknown as { busMusicMade?: boolean }).busMusicMade = true;
    }
  }

  /** Each frame per bus: playing (alive), where, and how far from the listener (the mech). */
  set(bus: object, playing: boolean, at: THREE.Vector3, dist: number) {
    let l = this.loops.get(bus);
    if (!playing) { if (l) { this.sfx.stopLoop(l); this.loops.delete(bus); } return; }
    if (!this.sfx.running) return;
    if (!l) { l = this.sfx.startSoundLoop(NAME, Math.random()) ?? undefined; if (!l) return; this.loops.set(bus, l); }
    this.sfx.setSoundLoop(l, NAME, at, this.level() / (1 + (dist / 35) ** 2));
  }

  /** Stop every loop (the band cleared). */
  clear() { for (const l of this.loops.values()) this.sfx.stopLoop(l); this.loops.clear(); }
}
