// Energy weapons' sounds (Keith 2026-11-02), generated (src/audio/synth.ts): the pulse laser's zap, the beam's hum
// (a loop while it burns), the nova lance's rising charge, its tearing release and its crack where it lands, the sunder
// beam's charge and roar. Level: Energy › Sound level.
import { Synth, rng } from "../../audio/synth";
import type { Sfx } from "../../audio/sfx";
import type { WeaponValues } from "../tuning";

export function addEnergySounds(sfx: Sfx, v: WeaponValues) {
  const S = new Synth(sfx.rate);
  const variants = (n: number, seed: number, make: (r: () => number) => Float32Array) => Array.from({ length: n }, (_, i) => make(rng(seed * 137 + i)));
  sfx.addSound("pulseZap", variants(3, 71, (r) => S.mix(S.whine(0.1, 2600 + r() * 400, 700, 0.3), S.tick(r, 0.02, 0.5), S.noise(r, 0.07, 6500, 0.22, 0.001), S.thump(0.08, 300, 120, 0.25))), () => v.energyLevel);
  sfx.addSound("beamHum", variants(1, 72, (r) => S.mix(S.whine(1.2, 180, 180, 0.22), S.whine(1.2, 540, 540, 0.07), S.whine(1.2, 1210, 1210, 0.03), S.scale(S.crackle(r, 1.2, 0.12), 0.8), S.band(r, 1.2, 1800, 5000, 0.06, 0.02, 0))), () => v.energyLevel);
  sfx.addSound("lanceCharge", variants(1, 73, (r) => S.mix(S.whine(1.4, 110, 1900, 0.16), S.whine(1.4, 220, 3800, 0.05), S.scale(S.crackle(r, 1.4, 0.12), 0.9))), () => v.energyLevel * 0.7);
  // The lance's release (Keith 2026-11-04: "sounds like a small laser rather than this thing ... that releases immense
  // energy"): a hard electric snap, a thick stack of detuned saws diving from a scream to a growl (the beam tearing out),
  // a sub boom that drops through the floor, a beating mains-hum discharge under it, and a long rumbling tail with
  // crackle. The old short crack-and-thump is the sunder beam's release now (sunderRelease).
  sfx.addSound("lanceFire", variants(2, 74, (r) => S.mix(
    S.band(r, 0.3, 1800, 9500, 1.1, 0.0004, -55),
    tear(S, r, 1.1, 2600, 55, 7, 0.016, 0.55, 1),
    S.thump(1.7, 120, 24, 1.25),
    S.delay(discharge(S, r, 1.5, 52, 0.42), 0.02),
    S.delay(S.lowPass(S.noise(r, 2.4, 650, 0.55, 0.02), 380), 0.04),
    S.scale(S.crackle(r, 1.8, 0.4), 1),
    S.delay(S.band(r, 1.4, 250, 2600, 0.22, 0.05, -9), 0.06),
  )), () => v.energyLevel);
  // Where it lands, over the blast's boom: an electric crack, a fizzing sizzle and a falling zap.
  sfx.addSound("lanceHit", variants(2, 81, (r) => S.mix(
    S.band(r, 0.22, 2500, 10000, 0.9, 0.0003, -45),
    S.scale(S.crackle(r, 1.1, 0.55), 1),
    S.band(r, 0.9, 3000, 9000, 0.18, 0.01, -14),
    S.whine(0.35, 4200, 600, 0.22),
    discharge(S, r, 0.6, 110, 0.18),
  )), () => v.energyLevel * v.lanceHitLevel);
  sfx.addSound("sunderRelease", variants(2, 74, (r) => S.mix(S.thump(0.55, 150, 38, 1.1), S.whine(0.4, 3400, 380, 0.3), S.noise(r, 0.5, 3200, 0.55, 0.001), S.scale(S.crackle(r, 0.45, 0.3), 1), S.delay(S.lowPass(S.noise(r, 0.9, 500, 0.4, 0.01), 600), 0.03))), () => v.energyLevel);
  // The sunder beam: a deep rising charge with a crackle, then a heavy roaring hum (a loop) while it blasts.
  sfx.addSound("sunderCharge", variants(1, 79, (r) => S.mix(S.whine(1.3, 60, 900, 0.22), S.whine(1.3, 120, 1800, 0.08), S.scale(S.crackle(r, 1.3, 0.2), 1), S.band(r, 1.3, 300, 2400, 0.08, 0.6, 0))), () => v.energyLevel * 0.8);
  sfx.addSound("sunderHum", variants(1, 80, (r) => S.mix(S.whine(1.2, 70, 70, 0.32), S.whine(1.2, 140, 140, 0.14), S.whine(1.2, 425, 425, 0.05), S.scale(S.crackle(r, 1.2, 0.25), 1), S.lowPass(S.noise(r, 1.2, 900, 0.25, 0.02), 900))), () => v.energyLevel);
  sfx.addSound("plasmaShot", variants(3, 75, (r) => S.mix(S.whine(0.18, 900, 260, 0.3), S.thump(0.14, 260, 90, 0.5), S.noise(r, 0.12, 2400, 0.25, 0.002))), () => v.energyLevel);
  sfx.addSound("plasmaHit", variants(3, 76, (r) => S.mix(S.thump(0.25, 180, 60, 0.6), S.noise(r, 0.3, 1800, 0.45, 0.001), S.scale(S.crackle(r, 0.25, 0.25), 1))), () => v.energyLevel);
  sfx.addSound("orbLaunch", variants(2, 77, (r) => S.mix(S.whine(0.6, 120, 420, 0.25), S.whine(0.6, 240, 840, 0.08), S.scale(S.crackle(r, 0.6, 0.15), 1), S.thump(0.3, 120, 50, 0.5))), () => v.energyLevel);
  sfx.addSound("arcZap", variants(4, 78, (r) => S.mix(S.scale(S.crackle(r, 0.16, 0.6), 1.2), S.noise(r, 0.08, 7000, 0.4, 0.0005), S.band(r, 0.14, 2500, 7000, 0.3, 0.001, -40), S.tick(r, 0.015, 0.6))), () => v.energyLevel);
}

/**
 * A tearing beam: `voices` detuned saws diving from `fromHz` to `toHz` (fast at first, then hanging low), through a
 * low-pass that follows the pitch down, swelling in over a few ms and dying over `len`. `mix` 0..1: how much of it.
 */
function tear(S: Synth, r: () => number, len: number, fromHz: number, toHz: number, voices: number, spread: number, gain: number, mix: number) {
  const s = new Float32Array(S.n(len)), ph = Array.from({ length: voices }, () => r()), det = Array.from({ length: voices }, (_, i) => 1 + spread * (i - (voices - 1) / 2) + (r() - 0.5) * spread * 0.4);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / S.rate, hz = toHz + (fromHz - toHz) * Math.exp(-t * 6.5);
    let v = 0;
    for (let k = 0; k < voices; k++) { ph[k] += (hz * det[k]) / S.rate; v += 2 * (ph[k] - Math.floor(ph[k] + 0.5)); }
    v /= Math.sqrt(voices);
    const a = 1 - Math.exp((-2 * Math.PI * Math.min(9000, hz * 3.5)) / S.rate);
    lp += a * (v - lp); lp2 += a * (lp - lp2);
    s[i] = lp2 * Math.min(1, t / 0.004) * Math.exp((-3.2 * t) / len) * gain * mix;
  }
  return s;
}

/** A discharge: a beating buzz at `hz` (two saws a hair apart and a sine an octave down), throbbing faster as it dies. */
function discharge(S: Synth, r: () => number, len: number, hz: number, gain: number) {
  const s = new Float32Array(S.n(len));
  let a = r(), b = r(), c = 0, trem = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / S.rate, k = t / len;
    a += hz / S.rate; b += (hz * 1.013) / S.rate; c += (hz * 0.5) / S.rate; trem += (14 + 26 * k) / S.rate;
    const saw = (a - Math.floor(a + 0.5)) + (b - Math.floor(b + 0.5)) + 0.6 * Math.sin(c * 2 * Math.PI);
    const am = 0.65 + 0.35 * Math.sin(trem * 2 * Math.PI);
    s[i] = saw * am * Math.min(1, t / 0.008) * Math.exp(-3.5 * k) * gain;
  }
  return s;
}
