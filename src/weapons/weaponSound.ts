// The new weapons' sounds, generated like everything else (src/audio/synth.ts): the rail cannon's crack and its
// charge whine, a rocket leaving the pod, a big blast, the mortar's thunk and the autocannon's bark. Levels are the
// Weapon sound sliders.
import { Synth, rng } from "../audio/synth";
import type { Sfx } from "../audio/sfx";
import type { WeaponValues } from "./tuning";

export type WeaponSound = "rail" | "railCharge" | "rocket" | "blast" | "mortar" | "cannon";

export function addWeaponSounds(sfx: Sfx, v: WeaponValues) {
  const S = new Synth(sfx.rate);
  const variants = (n: number, seed: number, make: (r: () => number) => Float32Array) => Array.from({ length: n }, (_, i) => make(rng(seed * 131 + i)));
  // Rail (Keith 2026-10-26: a rail gun, not a laser): the slug's supersonic crack (a sharp tick and a split-second of
  // bright noise), a heavy thump under it and a low rolling boom; no beam whine on the shot.
  sfx.addSound("rail", variants(2, 41, (r) => S.mix(S.tick(r, 0.03, 1), S.noise(r, 0.06, 7000, 0.9, 0.0002), S.delay(S.noise(r, 0.05, 4200, 0.5, 0.0004), 0.012),
    S.thump(0.55, 95, 26, 1.25), S.delay(S.lowPass(S.noise(r, 1.1, 420, 0.55, 0.01), 700), 0.03))), () => v.railLevel);
  // Charging: a rising electrical whine with a second harmonic and crackle (played at the charge time's rate).
  sfx.addSound("railCharge", variants(1, 42, (r) => S.mix(S.whine(1.1, 160, 2100, 0.2), S.whine(1.1, 320, 4200, 0.06), S.servo(1.1, 600, 3200, 0.05), S.scale(S.crackle(r, 1.1, 0.16), 0.7))), () => v.railLevel * 0.6);
  // A rocket off the rail: a thump and a long hiss.
  sfx.addSound("rocket", variants(3, 43, (r) => S.mix(S.thump(0.12, 220, 90, 0.6), S.noise(r, 0.55, 2400 + r() * 800, 0.55, 0.004), S.delay(S.noise(r, 0.4, 900, 0.3, 0.05), 0.05))), () => v.rocketLevel);
  // A big blast: a deep falling boom, dark noise and crackle.
  sfx.addSound("blast", variants(4, 44, (r) => S.scale(S.mix(S.thump(0.7, 110 + r() * 30, 30, 1.1), S.noise(r, 0.6, 700 + r() * 300, 0.75, 0.002),
    S.delay(S.lowPass(S.crackle(r, 0.5, 0.6), 1600), 0.04), S.delay(S.noise(r, 0.9, 260, 0.4, 0.05), 0.06)), 0.85)), () => v.blastLevel);
  sfx.addSound("mortar", variants(2, 45, (r) => S.mix(S.thump(0.3, 150, 55, 1.0), S.noise(r, 0.25, 1100, 0.5, 0.001), S.clang(r, 0.12, 0.12))), () => v.mortarLevel);
  sfx.addSound("cannon", variants(3, 46, (r) => S.mix(S.thump(0.16, 210, 70, 0.9), S.noise(r, 0.14, 2400, 0.6, 0.0006), S.tick(r, 0.03, 0.4))), () => v.cannonLevel);
}
