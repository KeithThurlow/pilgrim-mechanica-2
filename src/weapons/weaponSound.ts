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
  // Rail: a hard crack, a falling electric whine and a long low boom under it.
  sfx.addSound("rail", variants(2, 41, (r) => S.mix(S.tick(r, 0.04, 0.9), S.noise(r, 0.1, 6000, 0.7, 0.0003), S.whine(0.7, 2400, 300, 0.22),
    S.thump(0.7, 120, 32, 1.0), S.delay(S.lowPass(S.noise(r, 0.9, 500, 0.5, 0.01), 900), 0.02))), () => v.railLevel);
  sfx.addSound("railCharge", variants(1, 42, (r) => S.mix(S.whine(1.1, 180, 1900, 0.2), S.servo(1.1, 600, 3200, 0.06), S.scale(S.crackle(r, 1.1, 0.12), 0.6))), () => v.railLevel * 0.6);
  // A rocket off the rail: a thump and a long hiss.
  sfx.addSound("rocket", variants(3, 43, (r) => S.mix(S.thump(0.12, 220, 90, 0.6), S.noise(r, 0.55, 2400 + r() * 800, 0.55, 0.004), S.delay(S.noise(r, 0.4, 900, 0.3, 0.05), 0.05))), () => v.rocketLevel);
  // A big blast: a deep falling boom, dark noise and crackle.
  sfx.addSound("blast", variants(4, 44, (r) => S.scale(S.mix(S.thump(0.7, 110 + r() * 30, 30, 1.1), S.noise(r, 0.6, 700 + r() * 300, 0.75, 0.002),
    S.delay(S.lowPass(S.crackle(r, 0.5, 0.6), 1600), 0.04), S.delay(S.noise(r, 0.9, 260, 0.4, 0.05), 0.06)), 0.85)), () => v.blastLevel);
  sfx.addSound("mortar", variants(2, 45, (r) => S.mix(S.thump(0.3, 150, 55, 1.0), S.noise(r, 0.25, 1100, 0.5, 0.001), S.clang(r, 0.12, 0.12))), () => v.mortarLevel);
  sfx.addSound("cannon", variants(3, 46, (r) => S.mix(S.thump(0.16, 210, 70, 0.9), S.noise(r, 0.14, 2400, 0.6, 0.0006), S.tick(r, 0.03, 0.4))), () => v.cannonLevel);
}
