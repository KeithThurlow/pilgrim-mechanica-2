// Energy weapons' sounds (Keith 2026-11-02), generated (src/audio/synth.ts): the pulse laser's zap, the beam's hum
// (a loop while it burns), the nova lance's rising charge and its crack and thump. Level: Energy › Sound level.
import { Synth, rng } from "../../audio/synth";
import type { Sfx } from "../../audio/sfx";
import type { WeaponValues } from "../tuning";

export function addEnergySounds(sfx: Sfx, v: WeaponValues) {
  const S = new Synth(sfx.rate);
  const variants = (n: number, seed: number, make: (r: () => number) => Float32Array) => Array.from({ length: n }, (_, i) => make(rng(seed * 137 + i)));
  sfx.addSound("pulseZap", variants(3, 71, (r) => S.mix(S.whine(0.1, 2600 + r() * 400, 700, 0.3), S.tick(r, 0.02, 0.5), S.noise(r, 0.07, 6500, 0.22, 0.001), S.thump(0.08, 300, 120, 0.25))), () => v.energyLevel);
  sfx.addSound("beamHum", variants(1, 72, (r) => S.mix(S.whine(1.2, 180, 180, 0.22), S.whine(1.2, 540, 540, 0.07), S.whine(1.2, 1210, 1210, 0.03), S.scale(S.crackle(r, 1.2, 0.12), 0.8), S.band(r, 1.2, 1800, 5000, 0.06, 0.02, 0))), () => v.energyLevel);
  sfx.addSound("lanceCharge", variants(1, 73, (r) => S.mix(S.whine(1.4, 110, 1900, 0.16), S.whine(1.4, 220, 3800, 0.05), S.scale(S.crackle(r, 1.4, 0.12), 0.9))), () => v.energyLevel * 0.7);
  sfx.addSound("lanceFire", variants(2, 74, (r) => S.mix(S.thump(0.55, 150, 38, 1.1), S.whine(0.4, 3400, 380, 0.3), S.noise(r, 0.5, 3200, 0.55, 0.001), S.scale(S.crackle(r, 0.45, 0.3), 1), S.delay(S.lowPass(S.noise(r, 0.9, 500, 0.4, 0.01), 600), 0.03))), () => v.energyLevel);
}
