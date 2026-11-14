// The new weapons' sounds, generated like everything else (src/audio/synth.ts): the rail cannon's crack and its
// charge whine, a rocket leaving the pod, a big blast, the mortar's thunk and the autocannon's bark. Levels are the
// Weapon sound sliders.
import { Synth, rng } from "../audio/synth";
import type * as THREE from "three/webgpu";
import type { Sfx } from "../audio/sfx";
import type { WeaponValues } from "./tuning";
import { sampleBank, sampleBankOf } from "../audio/sampleBank";

export type WeaponSound = "rail" | "railCharge" | "rocket" | "blast" | "mortar" | "cannon" | "clipOut" | "clipIn" | "swordSwing" | "swordHit" | "swordBlock" | "swordSmash" | "swordScrape" | "swordRing" | "bulletMetal" | "blastTail" | "blastBoom" | import("./guns").RoundGun | "breach";

export function addWeaponSounds(sfx: Sfx, v: WeaponValues) {
  const S = new Synth(sfx.rate);
  const variants = (n: number, seed: number, make: (r: () => number) => Float32Array) => Array.from({ length: n }, (_, i) => make(rng(seed * 131 + i)));
  /** A list of modes ([hz, dB, dB/s]) moved by f in pitch. */
  const hz = (m: [number, number, number][], f: number) => m.map(([h, d, r]) => [h * f, d, r] as [number, number, number]);
  // Rail (Keith 2026-10-26: a rail gun, not a laser): the slug's supersonic crack (a sharp tick and a split-second of
  // bright noise), a heavy thump under it and a low rolling boom; no beam whine on the shot.
  sfx.addSound("rail", variants(2, 41, (r) => S.mix(S.tick(r, 0.03, 1), S.noise(r, 0.06, 7000, 0.9, 0.0002), S.delay(S.noise(r, 0.05, 4200, 0.5, 0.0004), 0.012),
    S.thump(0.55, 95, 26, 1.25), S.delay(S.lowPass(S.noise(r, 1.1, 420, 0.55, 0.01), 700), 0.03))), () => v.railLevel);
  // Charging: a rising electrical whine with a second harmonic and crackle (played at the charge time's rate).
  sfx.addSound("railCharge", variants(1, 42, (r) => S.mix(S.whine(1.1, 160, 2100, 0.2), S.whine(1.1, 320, 4200, 0.06), S.servo(1.1, 600, 3200, 0.05), S.scale(S.crackle(r, 1.1, 0.16), 0.7))), () => v.railLevel * 0.6);
  // A rocket off the rail: a thump and a long hiss.
  sfx.addSound("rocket", variants(3, 43, (r) => S.mix(S.thump(0.12, 220, 90, 0.6), S.noise(r, 0.55, 2400 + r() * 800, 0.55, 0.004), S.delay(S.noise(r, 0.4, 900, 0.3, 0.05), 0.05))), () => v.rocketLevel);
  // A big blast (Keith 2026-11-02: the explosion in his reference clip, the sound at 11.2 s; built from its measurements,
  // not the audio). A dark rolling rumble rather than a sharp crack: little above 2 kHz even at the start, one small crack
  // 48 ms in, a 45-75 Hz body swelling for half a second in uneven surges every 50-150 ms while its pitch falls (74 to
  // 53 Hz), dense mid noise bands at 200 Hz-1.5 kHz dying at about -25 dB/s, all gone by 1.45 s. The clip's body takes
  // 0.57 s to peak; a short low thump and a burst of dark noise at the start here make the blast land when it goes off.
  const BLAST_MID: [number, number, number][] = [[213, -27.2, -25], [312, -29.9, -24], [388, -32.1, -25], [572, -30.7, -28], [748, -37.9, -29], [931, -39.9, -27], [1063, -39.4, -25], [1273, -39.4, -32], [1509, -36.5, -35]];
  // Played as three layers (Keith 2026-11-02: the deep tail made big blasts sound "like ... within a drum"; the mortar's
  // first hit could be bassier): the hit (thump, dark burst, crack, the first of the mids), the tail (the rolling
  // rumble, the falling low ring, the mid bands' decay) and a sub boom only big blasts add. Small blasts play hit and
  // tail as one, as before; bigger ones thin the tail and add the boom (blastVoice).
  // A dying walker's core going unstable (Keith 2026-11-02): a rising, crackling whine over the countdown (2.8 s at rate
  // 1, stretched to the delay) and a short two-tone beep on each blink of its warning ring.
  sfx.addSound("coreWhine", variants(1, 61, (r) => S.mix(S.whine(2.8, 90, 1400, 0.22), S.whine(2.8, 181, 2790, 0.07), S.scale(S.crackle(r, 2.8, 0.2), 0.8))), () => v.blastLevel * 0.3);
  sfx.addSound("coreBeep", variants(1, 62, () => S.mix(S.whine(0.06, 1650, 1650, 0.3), S.delay(S.whine(0.05, 2200, 2200, 0.22), 0.06))), () => v.blastLevel * 0.2);
  sfx.addSound("blast", variants(4, 44, (r) => {
    const f = 0.9 + r() * 0.2;
    return S.mix(
      S.thump(0.45, 90 * f, 45 * f, 0.45),
      S.lowPass(S.noise(r, 0.35, 900, 0.9, 0.002), 1300),
      S.delay(S.band(r, 0.05, 2000, 6000, 0.12, 0.001, -200), 0.048),
      S.ring(r, 0.4, hz(BLAST_MID, f), 0.3, { attack: 0.01, detune: 0.04, jitter: 0.06, chokeAt: 0.2, choke: 60 }),
      S.band(r, 0.4, 180, 1200, 0.25, 0.01, -60));
  }), () => v.blastLevel);
  sfx.addSound("blastTail", variants(4, 52, (r) => {
    const f = 0.9 + r() * 0.2, len = 1.45;
    const rumble = S.swell(r, S.lowPass(S.band(r, len, 25, 110, 0.7, 0.2, -17), 150), 0.08, 0.05, 0.15, 4, 12);
    return S.mix(
      S.ring(r, len, [[74 * f, -8, -17]], 0.6, { attack: 0.2, glide: 0.72 }),
      S.scale(rumble, 0.75),
      S.delay(S.ring(r, 1.0, hz(BLAST_MID, f), 0.2, { attack: 0.08, detune: 0.04, jitter: 0.06 }), 0.15),
      S.delay(S.band(r, 0.85, 180, 1200, 0.18, 0.08, -30), 0.15));
  }), () => v.blastLevel);
  // The big blast's sub boom: a deep falling sine and a low push of air, short, no ring.
  sfx.addSound("blastBoom", variants(3, 53, (r) => S.mix(S.thump(0.6, 62 + r() * 8, 28, 0.9), S.lowPass(S.noise(r, 0.4, 160, 0.8, 0.004), 220))), () => v.blastLevel);
  // Shoulder strikes (Keith 2026-11-14, src/weapons/strikes.ts). The charge: a rising whine and crackle, played faster
  // or slower per strike. The quake's slam: a huge low thump, a crack of metal and a long dark rumble. The orbital
  // lance: a roaring, sizzling column (bright crackle over a low drone) for its 2.4 s. The cryo bomb: a sharp hiss and
  // a glassy shatter. The singularity: a deep wobbling drone that bends down. The beacon's beeps and the shells'
  // falling whistle.
  const lvl = () => blastSafe(v) * v.strikeLevel;
  sfx.addSound("strikeCharge", variants(1, 70, (r) => S.mix(S.whine(1.0, 120, 1600, 0.2), S.whine(1.0, 240, 3200, 0.06), S.scale(S.crackle(r, 1.0, 0.2), 0.8))), () => v.strikeLevel * 0.5);
  sfx.addSound("quakeSlam", variants(2, 71, (r) => S.mix(S.thump(0.8, 70, 24, 1.0), S.clang(r, 0.25, 0.45), S.lowPass(S.noise(r, 0.5, 700, 0.9, 0.002), 900),
    S.delay(S.lowPass(S.band(r, 1.8, 25, 120, 0.8, 0.05, -12), 160), 0.05), S.delay(S.crackle(r, 0.6, 0.25), 0.05))), lvl);
  sfx.addSound("orbitalBeam", variants(1, 72, (r) => S.mix(S.scale(S.crackle(r, 2.6, 0.35), 0.9), S.lowPass(S.band(r, 2.6, 40, 220, 0.7, 0.05, -1.5), 300),
    S.whine(2.6, 900, 700, 0.07), S.noise(r, 2.6, 5200, 0.25, 0.05))), lvl);
  sfx.addSound("stasisBurst", variants(2, 73, (r) => S.mix(S.noise(r, 0.7, 7000, 0.7, 0.001), S.whine(0.5, 2600, 400, 0.15), S.delay(S.crackle(r, 0.6, 0.4), 0.04),
    S.thump(0.4, 110, 40, 0.6))), lvl);
  sfx.addSound("gravityHum", variants(1, 74, (r) => S.mix(S.growl(r, 3.0, 18, 46), S.whine(3.0, 160, 55, 0.2), S.lowPass(S.band(r, 3.0, 30, 90, 0.5, 0.3, -2), 140))), lvl);
  sfx.addSound("beacon", variants(1, 75, () => S.mix(S.whine(0.08, 1800, 1800, 0.3), S.delay(S.whine(0.08, 1800, 1800, 0.3), 0.18), S.delay(S.whine(0.12, 2400, 2400, 0.3), 0.36))), () => v.strikeLevel * 0.35);
  sfx.addSound("shellWhistle", variants(3, 76, (r) => S.mix(S.whine(1.1, 2200 + r() * 400, 700, 0.12), S.noise(r, 1.1, 3000, 0.08, 0.3))), () => v.strikeLevel * 0.45);
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
  // The smash (Keith 2026-11-05: the smash in his reference video at 1:48, "swords hitting metal, hitting things"),
  // synthetic, shaped on that clip (docs/decisions.md 2026-11-05): no ring and no tone to speak of, a flat wall of noise
  // from 125 Hz up that holds near its peak for about 0.12 s (metal folding, not a tap), falls about 40 dB/s and leaves
  // a bright scatter of debris. The crack and low thump are the blade's own, on top. Played over every unblocked cut.
  // Ten of them, each its own blow (Keith 2026-11-05: "a few more variations"): how dull, sharp and hollow it is, how
  // long it holds and how much torn steel shrieks through it are all drawn per variant, around the clip's shape.
  sfx.addSound("swordSmash", variants(10, 54, (r) => {
    const f = 0.85 + r() * 0.3, sharp = r(), hollow = r(), hold = 0.8 + r() * 0.4, tear = r() < 0.4 ? 0.04 + r() * 0.05 : 0;
    const box = 150 + hollow * 260;
    return S.mix(
      S.band(r, 0.08, 1500, 9000, 0.15 + sharp * 0.3, 0.0005, -160),
      crunch(S, r, 0.8 * hold, 0.8 + r() * 0.4, sharp * 0.3),
      S.band(r, 0.8 * hold, 90 + r() * 50, 400 + r() * 250, 0.75, 0.001, -40 / hold),
      S.band(r, 0.8 * hold, 500, 2000, 0.2 + r() * 0.16, 0.001, -44 / hold),
      S.band(r, 0.8, 4000, 9500, 0.03 + r() * 0.04, 0.002, -30),
      S.thump(0.14, 130 * f, 70 * f, 0.3),
      S.ring(r, 0.35, [[box, -20, -45], [box * 1.62, -24, -60]], hollow * 0.22, { attack: 0.002, detune: 0.02 }),
      tear ? S.delay(S.whine(0.22, 2100 * f, 1300 * f, tear), 0.02 + r() * 0.05) : new Float32Array(1),
      S.delay(S.ring(r, 0.3, hz([[612, -22, -60], [987, -24, -70], [1534, -25, -80], [2210, -27, -90], [3405, -29, -110]], f), 0.1, { attack: 0.002, detune: 0.02, chokeAt: 0.1, choke: 60 }), 0.003),
      S.delay(S.scale(S.crackle(r, 0.7, 0.3), 1), 0.1 + r() * 0.04));
  }), () => v.swordLevel * v.swordSmashLevel);
  // The blade singing on after a blow (Keith 2026-11-05: "swords ring a little after they've hit enemies"): the block's
  // struck-steel partials without the strike, thin and long, and quiet under the smash. Once per cut (Arsenal.hitSound).
  sfx.addSound("swordRing", variants(6, 57, (r) => {
    const f = 0.96 + r() * 0.08; // tight, so each sword keeps its note (Sword sound: ring pitch)
    return S.mix(
      S.ring(r, 1.3, hz(BLOCK_BODY.slice(3), f), 0.4, { attack: 0.01, detune: 0.006 }),
      S.ring(r, 1.3, hz(BLOCK_BODY.slice(0, 3), f), 0.22, { attack: 0.02, detune: 0.006 }),
      S.ring(r, 0.6, hz(BLOCK_HI, f), 0.1, { attack: 0.006, detune: 0.004 }));
  }), () => v.swordLevel * v.swordRingLevel);
  // The scrape (Keith 2026-11-05, "blade on metal"; the recording swaps in over this): steel dragging on steel, a
  // wavering pair of high squeals over bright grit, swelling in and fading. Played on metal bodies after the smash.
  sfx.addSound("swordScrape", variants(4, 55, (r) => {
    const hi = 2400 + r() * 900;
    return S.mix(
      S.band(r, 0.7, 2500, 9000, 0.32, 0.06, -9),
      S.whine(0.7, hi, hi * (0.86 + r() * 0.08), 0.06),
      S.whine(0.7, hi * 1.47, hi * 1.4, 0.035),
      S.grind(r, 0.6, 0.3));
  }), () => v.swordLevel * v.swordScrapeLevel);
  // A round on metal (src/audio/minigunAudio.ts): the Sfx's metal tick as a sound the ricochet recording can swap over.
  sfx.addSound("bulletMetal", variants(4, 56, (r) => S.mix(S.noise(r, 0.05, 5000, 0.35, 0.001), S.clang(r, 0.08, 0.12 + r() * 0.06))), () => sfx.v.metalLevel);
  // Round guns (Keith 2026-11-02, src/weapons/guns.ts), one voice each, levels on the Round guns: feel sliders.
  // SMG: a light, bright snap with a small thump; played many times a second, so short.
  sfx.addSound("smg", variants(4, 61, (r) => S.mix(S.tick(r, 0.02, 0.7), S.noise(r, 0.07, 5200, 0.55, 0.0003), S.thump(0.08, 280, 130, 0.45))), () => v.smgLevel);
  // Rifle: a harder crack, a firm thump and a short rolling tail.
  sfx.addSound("rifle", variants(3, 62, (r) => S.mix(S.tick(r, 0.025, 0.9), S.noise(r, 0.12, 3600, 0.7, 0.0003), S.thump(0.2, 190, 70, 0.75), S.delay(S.lowPass(S.noise(r, 0.45, 600, 0.3, 0.01), 800), 0.03))), () => v.rifleLevel);
  // Shotgun: the flak's old voice (Keith 2026-11-03): a heavy cough and the shot's rattle spreading out, then the pump
  // racking after it; with samples on, the flak recording (src/audio/samples.ts).
  sfx.addSound("shotgun", variants(3, 63, (r) => S.mix(S.thump(0.4, 105, 44, 1.2), S.noise(r, 0.32, 1100, 0.85, 0.001), S.delay(S.scale(S.crackle(r, 0.35, 0.35), 0.8), 0.06),
    S.delay(S.scale(S.clang(r, 0.08, 0.2), 0.6), 0.42), S.delay(S.scale(S.clang(r, 0.07, 0.2), 0.5), 0.55))), () => v.shotgunLevel);
  // Sniper: a supersonic crack, a deep punch and a long tail rolling off the dunes; the bolt cycles after.
  sfx.addSound("sniper", variants(2, 64, (r) => S.mix(S.tick(r, 0.03, 1), S.noise(r, 0.07, 6500, 0.85, 0.0002), S.thump(0.5, 115, 34, 1.2),
    S.delay(S.lowPass(S.noise(r, 1.6, 450, 0.5, 0.01), 650), 0.05), S.delay(S.scale(S.clang(r, 0.1, 0.25), 0.45), 0.75))), () => v.sniperLevel);
  // Flak firing (Keith 2026-11-03: the old cough and the flak recording went to the scattergun): a deep launch thump
  // and the rush of a salvo leaving, like a rocket pod's ripple at once; the noise is where its pellets land (flakPop).
  sfx.addSound("flak", variants(3, 65, (r) => S.mix(S.thump(0.35, 120, 50, 1.1), S.noise(r, 0.08, 2200, 0.6, 0.0005),
    S.delay(S.noise(r, 0.45, 1800 + r() * 600, 0.5, 0.02), 0.02), S.delay(S.noise(r, 0.35, 900, 0.3, 0.05), 0.06))), () => v.flakLevel);
  // A flak pellet's explosion (Keith 2026-11-03: "a storm of missiles hitting at once"): a small missile blast, a crack,
  // a low punch, a short roar and rattle; six variants pitched apart so a volley of them never lines up.
  sfx.addSound("flakPop", variants(6, 67, (r) => {
    const f = 0.85 + r() * 0.3;
    return S.mix(S.tick(r, 0.02, 0.7), S.thump(0.32, 120 * f, 48 * f, 0.9), S.lowPass(S.noise(r, 0.3, 1200 * f, 0.8, 0.002), 1600),
      S.delay(S.band(r, 0.05, 1800, 5000, 0.1, 0.001, -200), 0.03), S.delay(S.scale(S.crackle(r, 0.4, 0.3), 0.5), 0.05),
      S.band(r, 0.5, 150, 900, 0.2, 0.01, -40));
  }), () => v.flakPopLevel);
  // Breach cannon (src/weapons/cannon.ts): a big, deep gun report: a sharp crack in front, a heavy low punch and a
  // long rumble rolling off; its shell's explosion is the shared blast, scaled by its radius.
  sfx.addSound("breach", variants(3, 66, (r) => S.mix(S.tick(r, 0.03, 0.9), S.noise(r, 0.12, 3000, 0.75, 0.0003), S.thump(0.6, 95, 30, 1.3), S.lowPass(S.noise(r, 0.4, 900, 0.8, 0.002), 1200),
    S.delay(S.lowPass(S.noise(r, 1.8, 380, 0.55, 0.02), 520), 0.06))), () => v.breachLevel);
  sfx.addSound("cannon", variants(3, 46, (r) => S.mix(S.thump(0.16, 210, 70, 0.9), S.noise(r, 0.14, 2400, 0.6, 0.0006), S.tick(r, 0.03, 0.4))), () => v.cannonLevel);
  // The recorded sounds (Keith 2026-11-02, src/audio/samples.ts) swap in over these as they load, each behind its sliders.
  sampleBank(sfx, v as unknown as Record<string, number>);
}

/**
 * The explosion as one sound for every explosive (Keith 2026-11-02: "dial it up and down"), by the blast's radius (× `size`
 * for a caller that wants its blasts to sound bigger or smaller than they hit): k doublings from blastSizeRef. Bigger:
 * the hit louder and deeper, the tail thinner (blastTailCut a doubling, not under blastTailMin) and never slowed, and a
 * sub boom (blastBoom a doubling). Smaller: quieter and higher, hit and tail together, no boom.
 */
export function blastVoice(radius: number, v: WeaponValues, size = 1) {
  const k = Math.log2(Math.max(0.1, radius * size) / Math.max(0.1, v.blastSizeRef));
  const volume = Math.max(0.2, Math.min(v.blastSizeMax, 1 + v.blastSizeLoud * k));
  const rate = Math.max(0.5, Math.min(1.8, Math.pow(2, -v.blastSizePitch * k))) * (0.94 + Math.random() * 0.12);
  return {
    volume, rate,
    tail: volume * Math.max(v.blastTailMin, Math.min(1, 1 - v.blastTailCut * Math.max(0, k))),
    tailRate: Math.max(1, rate),
    boom: volume * v.blastBoom * Math.max(0, k),
  };
}

/** Play an explosion of this radius at a point: hit, tail and (big ones) the boom. */
export function playBlast(sfx: Sfx, at: THREE.Vector3, radius: number, v: WeaponValues, size = 1) {
  const b = blastVoice(radius, v, size);
  // A blast big enough plays a recording (Keith 2026-11-02: largebomb, giantbomb for the biggest) at the size's level,
  // its own pitch jittered, in place of the procedural hit and tail; the sub boom stays for the biggest.
  const bank = sampleBankOf(sfx), r = radius * size;
  const rec = !bank || r < v.sampleBlastFrom ? null : r >= v.sampleGiantFrom && bank.liveSound("blastGiant") ? "blastGiant" : bank.liveSound("blastLarge") ? "blastLarge" : null;
  if (rec) {
    sfx.playSound(rec, at, b.volume, 0.96 + Math.random() * 0.08);
    if (b.boom > 0.02) sfx.playSound("blastBoom", at, b.boom, 0.9 + Math.random() * 0.2);
    return;
  }
  sfx.playSound("blast", at, b.volume, b.rate);
  sfx.playSound("blastTail", at, b.tail, b.tailRate);
  if (b.boom > 0.02) sfx.playSound("blastBoom", at, b.boom, 0.9 + Math.random() * 0.2);
}

/** Grit crushed in a blow: dense clicks (hundreds a second, holding for the first 0.12 s, then thinning out) each a
 *  short burst of bright noise, `len` s long; `bright` 0..1 from dull crumbling to sharp crackle. */
function crunch(S: Synth, r: () => number, len: number, gain: number, bright: number) {
  const s = new Float32Array(S.n(len)), sr = S.rate;
  const a = 1 - Math.exp((-2 * Math.PI * (2500 + 6000 * bright)) / sr);
  let lp = 0, env = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / sr, late = Math.max(0, t - 0.12), rate = 900 * Math.exp(-late * 6);
    if (r() < rate / sr) env = 0.4 + r() * 0.6;
    env *= 0.993;
    lp += a * (r() * 2 - 1 - lp);
    s[i] = lp * env * gain * Math.exp(-late * 4.5) * Math.min(1, (len - t) / 0.05);
  }
  return s;
}

/** The blast level, never below a whisper (a strike's sounds follow it). */
function blastSafe(v: WeaponValues) { return Math.max(0.2, v.blastLevel * 0.5); }
