// A robot dying, heard (Keith 2026-11-16: the recorded deaths were underwater explosions and didn't fit). Built from
// the synth like the guns: a military machine breaking, not a splash. Three layers, each its own little recipe:
//   - the electrical short: a mains-hum buzz arcing on and off, bright snaps of spark, a crackle running on;
//   - the metallic crunch: heavy plate buckling (low inharmonic modes bending down), a gritty crunch of noise, the
//     body landing and loose parts clanking after it;
//   - the servo whine-down: the drive motors spinning down to nothing, wobbling as they lose power.
// "robotDeath" is the walker's (a scrapper plays it higher, shorter and quieter, robotSmallDeath); "robotBigDeath" is
// the big walker's reactor going up, played on top of the blast's sub boom (src/game/robotBeam.ts). Cosmetic.
import { Synth, rng, type Rng } from "./synth";
import type { Sfx } from "./sfx";

/** An electrical arc: a buzzy square-ish hum (mains and its harmonics) gated on and off at random, over hiss. */
export function arc(S: Synth, r: Rng, len: number, hz: number, gain: number) {
  const s = new Float32Array(S.n(len));
  let ph = 0, gate = 1, hold = 0, lp = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / S.rate;
    if (--hold <= 0) { gate = r() < 0.6 ? 0.4 + r() * 0.6 : 0; hold = Math.round((0.005 + r() * 0.035) * S.rate); }
    ph += (hz * (1 + 0.04 * (r() - 0.5))) / S.rate;
    const x = Math.sin(2 * Math.PI * ph);
    const buzz = Math.tanh(x * 4) * 0.6 + Math.sin(4 * Math.PI * ph) * 0.25 + Math.sin(6 * Math.PI * ph) * 0.15;
    const n = r() * 2 - 1;
    lp += 0.6 * (n - lp);
    const env = Math.min(1, t / 0.002) * Math.exp((-3 * t) / len);
    s[i] = (buzz * 0.7 + (n - lp) * 0.5) * gate * env * gain;
  }
  return s;
}

/** Spark snaps: a few sharp clicks of bright noise, each a few ms, scattered over `len` and thinning out. */
export function sparks(S: Synth, r: Rng, len: number, count: number, gain: number) {
  const s = new Float32Array(S.n(len));
  for (let k = 0; k < count; k++) {
    const at = Math.floor(Math.pow(r(), 1.8) * len * S.rate), d = Math.round((0.002 + r() * 0.006) * S.rate), g = gain * (0.4 + r() * 0.6) * (1 - at / s.length);
    let prev = 0;
    for (let j = 0; j < d && at + j < s.length; j++) { const n = r() * 2 - 1; s[at + j] += (n - prev) * g * Math.exp(-j / (d * 0.3)); prev = n; }
  }
  return s;
}

/** A servo or drive motor losing power: a whine falling to nothing, wobbling and stuttering as it goes. */
export function whineDown(S: Synth, r: Rng, len: number, fromHz: number, toHz: number, gain: number) {
  const s = new Float32Array(S.n(len));
  const wob = 6 + r() * 6;
  let a = 0, b = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / S.rate, k = t / len;
    const hz = toHz + (fromHz - toHz) * Math.pow(1 - k, 1.8);
    const stutter = 1 - 0.35 * Math.max(0, Math.sin(2 * Math.PI * wob * t * (1 + k)));
    a += (hz * (1 + 0.02 * Math.sin(2 * Math.PI * wob * 0.5 * t))) / S.rate;
    b += (hz * 2.01) / S.rate;
    const tone = (2 * (a - Math.floor(a + 0.5))) * 0.45 + Math.sin(2 * Math.PI * b) * 0.25 + Math.sin(2 * Math.PI * a) * 0.3;
    s[i] = tone * stutter * Math.min(1, t / 0.02) * Math.pow(1 - k, 1.3) * gain;
  }
  return s;
}

/** Steel crumpling: gritty band noise in short crunches (plates folding, rivets letting go). */
export function crunch(S: Synth, r: Rng, len: number, gain: number) {
  const s = new Float32Array(S.n(len));
  let lp = 0, lp2 = 0, burst = 0, hold = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / S.rate;
    if (--hold <= 0) { burst = r() < 0.7 ? 0.3 + r() * 0.7 : 0.05; hold = Math.round((0.006 + r() * 0.02) * S.rate); }
    const n = r() * 2 - 1;
    lp += 0.45 * (n - lp);
    lp2 += 0.04 * (lp - lp2);
    s[i] = (lp - lp2) * burst * Math.min(1, t / 0.002) * Math.exp((-4 * t) / len) * gain * 2;
  }
  return s;
}

/** A walker's death (about 1.3 s): a short and spark, the hull crunching, the drives whining down, parts clanking. */
export function robotDeathRecipe(S: Synth, r: Rng) {
  const f = 0.9 + r() * 0.2;
  return S.mix(
    S.scale(sparks(S, r, 0.35, 7, 1), 0.7),
    arc(S, r, 0.45, (55 + r() * 15) * f, 0.32),
    S.thump(0.35, 130 * f, 50 * f, 0.55),
    S.ring(r, 0.8, [[180 * f, -4, -30], [263 * f, -7, -40], [417 * f, -9, -55], [690 * f, -12, -70], [1130 * f, -16, -90]], 0.35, { attack: 0.004, glide: 0.82, detune: 0.03, jitter: 0.05 }),
    crunch(S, r, 0.4, 0.5),
    S.delay(whineDown(S, r, 0.9, (900 + r() * 300) * f, 70, 0.11), 0.03),
    S.delay(S.scale(S.crackle(r, 0.9, 0.25), 0.8), 0.08),
    S.delay(S.thump(0.18, 110 * f, 55 * f, 0.4), 0.28 + r() * 0.1),
    S.delay(S.clang(r, 0.14, 0.14), 0.36 + r() * 0.12),
    S.delay(S.clang(r, 0.1, 0.08), 0.55 + r() * 0.2));
}

/** A big walker's reactor going up (about 2.8 s): a heavy short, the hull tearing and groaning, the big drives
 *  winding down over two seconds, sparks raining and wreckage landing. The blast's own sub boom plays under it. */
export function robotBigDeathRecipe(S: Synth, r: Rng) {
  const f = 0.92 + r() * 0.16;
  // A touch under full level: it lands on top of the blast's sub boom.
  return S.scale(S.mix(
    sparks(S, r, 0.8, 16, 1),
    arc(S, r, 0.9, (45 + r() * 10) * f, 0.4),
    S.thump(0.8, 85 * f, 28 * f, 0.8),
    S.ring(r, 2.0, [[92 * f, -2, -12], [141 * f, -5, -16], [227 * f, -7, -22], [355 * f, -10, -30], [590 * f, -13, -40], [960 * f, -17, -55]], 0.4, { attack: 0.01, glide: 0.62, detune: 0.04, jitter: 0.05 }),
    crunch(S, r, 0.9, 0.55),
    S.delay(crunch(S, r, 0.5, 0.3), 0.45 + r() * 0.15),
    S.delay(whineDown(S, r, 2.3, (650 + r() * 200) * f, 35, 0.14), 0.05),
    S.delay(whineDown(S, r, 1.6, (1500 + r() * 400) * f, 90, 0.05), 0.1),
    S.delay(S.scale(S.crackle(r, 2.2, 0.35), 0.9), 0.1),
    S.delay(S.lowPass(S.noise(r, 1.4, 300, 0.5, 0.05), 400), 0.1),
    S.delay(S.thump(0.3, 90 * f, 40 * f, 0.5), 0.9 + r() * 0.3),
    S.delay(S.clang(r, 0.2, 0.15), 1.0 + r() * 0.3),
    S.delay(S.clang(r, 0.15, 0.1), 1.4 + r() * 0.4),
    S.delay(S.clang(r, 0.12, 0.07), 1.8 + r() * 0.4)), 0.7);
}

/** Both deaths as sounds on this Sfx, at the robots' level (Sound samples › Robot beams and deaths level). */
export function addRobotDeathSounds(sfx: Sfx, level: () => number) {
  const S = new Synth(sfx.rate);
  const variants = (n: number, seed: number, make: (r: Rng) => Float32Array) => Array.from({ length: n }, (_, i) => make(rng(seed * 131 + i)));
  sfx.addSound("robotDeath", variants(4, 81, (r) => robotDeathRecipe(S, r)), level);
  sfx.addSound("robotBigDeath", variants(2, 82, (r) => robotBigDeathRecipe(S, r)), level);
}
