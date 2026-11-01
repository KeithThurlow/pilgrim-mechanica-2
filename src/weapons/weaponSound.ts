// The new weapons' sounds, generated like everything else (src/audio/synth.ts): the rail cannon's crack and its
// charge whine, a rocket leaving the pod, a big blast, the mortar's thunk and the autocannon's bark. Levels are the
// Weapon sound sliders.
import { Synth, rng } from "../audio/synth";
import type { Sfx } from "../audio/sfx";
import type { WeaponValues } from "./tuning";

export type WeaponSound = "rail" | "railCharge" | "rocket" | "blast" | "mortar" | "cannon" | "clipOut" | "clipIn" | "swordSwing" | "swordHit" | "swordBlock";

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
  // A rocket clip's swap (Keith 2026-10-31: a reload you can hear): the empty clip unlatching and dropping (a clank and a
  // short servo slide), then the full one seating (a heavy clunk with a latch tick).
  sfx.addSound("clipOut", variants(2, 47, (r) => S.mix(S.clang(r, 0.1, 0.35), S.servo(0.25, 900, 500, 0.06), S.delay(S.thump(0.12, 140, 70, 0.35), 0.18))), () => v.rocketLevel * 0.9);
  sfx.addSound("clipIn", variants(2, 48, (r) => S.mix(S.servo(0.3, 400, 1000, 0.05), S.delay(S.thump(0.18, 120, 50, 0.9), 0.28), S.delay(S.clang(r, 0.08, 0.4), 0.29), S.delay(S.tick(r, 0.02, 0.5), 0.36))), () => v.rocketLevel);
  // The sword (Keith 2026-11-01): a heavy whoosh as the slash starts (dark air, a servo whine).
  sfx.addSound("swordSwing", variants(3, 49, (r) => S.mix(S.noise(r, 0.32, 650 + r() * 250, 0.55, 0.11), S.delay(S.noise(r, 0.2, 1500, 0.25, 0.05), 0.08), S.servo(0.25, 300, 700, 0.04))), () => v.swordLevel);
  // The hit and the block (Keith 2026-11-01, round 3: "closer, but still not quite right"; his reference clip's 23 s
  // sound for an unblocked hit and its 7 s sound for steel on steel). Built from measurements of those sounds (modes,
  // levels, decay rates, pitch bends), not from the audio: docs/decisions.md 2026-11-01 has the numbers. Every
  // variant rolls the whole set of modes a few percent up or down.
  const hz = (m: [number, number, number][], f: number) => m.map(([h, d, r]) => [h * f, d, r] as [number, number, number]);
  // Unblocked hit (the 23 s slam): a 3.3 kHz crack first, then a 60-190 Hz body swelling to its peak 160 ms in with the
  // low mode bending down (153 to 92 Hz) and an inharmonic ring at 400 Hz to 1.4 kHz; choked off from 0.55 s rather than
  // ringing, with a small late knock. Two of the eight variants are the clip's other slam (20.97 s): no crack, a mid-heavy
  // body drifting up in pitch over a 46 Hz thump.
  const HIT_CRACK: [number, number, number][] = [[3309, -22.5, -70], [3477, -26.2, -70], [3197, -27.5, -70], [6679, -28.5, -110], [4789, -29.4, -90], [2358, -25.6, -60]];
  const HIT_LOW: [number, number, number][] = [[153, -16, -40], [55, -15, -33], [185, -15.8, -26], [41, -18, -29], [256, -20, -28], [110, -18, -35]];
  const HIT_MID: [number, number, number][] = [[436, -21.4, -30], [256, -27.3, -28], [537, -26.5, -28], [665, -25.5, -26], [895, -25.5, -31], [999, -26.1, -28], [1141, -26.4, -30], [846, -29.8, -23], [1358, -30.4, -36]];
  const ALT_MID: [number, number, number][] = [[263, -18, -34], [338, -20, -35], [421, -21, -36], [528, -22, -38], [641, -24, -40], [788, -25, -42]];
  sfx.addSound("swordHit", variants(8, 50, (r) => {
    const f = 0.9 + r() * 0.2, choke = { chokeAt: 0.55, choke: 40 };
    if (r() < 0.25) return S.mix(
      S.ring(r, 1.0, hz(ALT_MID, f), 0.95, { attack: 0.03, glide: 1.11, detune: 0.012, chokeAt: 0.5, choke: 30 }),
      S.ring(r, 0.9, [[46 * f, -12, -30]], 0.9, { attack: 0.02, glide: 0.9 }),
      S.band(r, 0.25, 300, 2400, 0.45, 0.008, -60));
    return S.mix(
      S.band(r, 0.1, 2200, 4000, 0.4, 0.0008, -120),
      S.delay(S.ring(r, 0.6, hz(HIT_CRACK, f), 0.3, { attack: 0.002, ...choke }), 0.012),
      S.ring(r, 1.15, hz(HIT_LOW, f), 1.05, { attack: 0.06, glide: 0.62, ...choke }),
      S.ring(r, 1.1, hz(HIT_MID, f), 0.65, { attack: 0.03, detune: 0.015, ...choke }),
      S.band(r, 0.3, 120, 2500, 0.5, 0.004, -70),
      S.delay(S.ring(r, 0.18, hz(HIT_MID.slice(0, 4), f * 1.05), 0.08, { attack: 0.002 }), 0.92 + r() * 0.05));
  }), () => v.swordLevel);
  // The block (the 7 s steel on steel): a bright, noisy clang. Inharmonic ringing at 6-11 kHz that dies in 0.2-0.4 s over
  // a steady body ring at 180 Hz-1.4 kHz that carries the 1.2 s tail, a 45 Hz thump under it, a burst of bright noise and
  // a small second bump half a second on. The clip's attack is a soft 50 ms; the ring here starts in 4 ms so the block
  // reads at once in a fight.
  const BLOCK_HI: [number, number, number][] = [[10902, -19, -179], [8020, -20.5, -100], [6466, -21.6, -90], [6009, -23.9, -87], [10302, -26.2, -80], [9147, -27.6, -109]];
  const BLOCK_BODY: [number, number, number][] = [[186, -20.6, -18], [247, -23.4, -25], [292, -25.1, -33], [477, -28, -25], [578, -29, -24], [785, -30, -23], [885, -31, -27], [1018, -34, -28], [1418, -32, -29], [1821, -34, -38], [2410, -31, -60], [3120, -30, -80], [3690, -32, -90]];
  sfx.addSound("swordBlock", variants(6, 51, (r) => {
    const f = 0.93 + r() * 0.14;
    return S.mix(
      S.band(r, 0.14, 3500, 15000, 0.3, 0.012, -130),
      S.ring(r, 0.6, hz(BLOCK_HI, f), 0.4, { attack: 0.008, detune: 0.004 }),
      S.ring(r, 1.26, hz(BLOCK_BODY, f), 0.65, { attack: 0.012, detune: 0.006 }),
      S.ring(r, 1.0, [[45 * f, -16, -27]], 0.12, { attack: 0.06, glide: 1.1 }),
      S.band(r, 0.12, 150, 2000, 0.4, 0.006, -80),
      S.delay(S.ring(r, 0.7, hz(BLOCK_BODY.slice(0, 5), f), 0.18, { attack: 0.01 }), 0.5 + r() * 0.04));
  }), () => v.swordLevel);
  sfx.addSound("cannon", variants(3, 46, (r) => S.mix(S.thump(0.16, 210, 70, 0.9), S.noise(r, 0.14, 2400, 0.6, 0.0006), S.tick(r, 0.03, 0.4))), () => v.cannonLevel);
}
