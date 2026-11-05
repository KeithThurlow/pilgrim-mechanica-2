// The recorded sounds (Keith 2026-11-02: Pixabay sounds, royalty-free, no attribution; provenance in docs/assets.md).
// Each one stands in for a procedural sound of the same name (src/weapons/weaponSound.ts): the bank (sampleBank.ts)
// cuts it into a few variants by these sliders, matches its punch to the procedural sound's, and swaps it in; with
// the sample off (or before it has loaded, or if it fails to) the procedural sound plays as before. "Procedural
// under" mixes the procedural sound in beneath the sample (its crack on a softer recording, say).
import type { Param } from "../core/tweaks";
import type { AlienOptions } from "./sampleCut";

export interface SampleDef {
  /** Key stem for its sliders (smp<Id>On, ...) and its file: public/sounds/pixabay/<file>.mp3. */
  id: string;
  file: string;
  /** The sound it plays as (Sfx.addSound's name). */
  sound: string;
  /** The procedural sound its loudness is matched to and mixed under it (default: `sound`). */
  ref?: string;
  label: string;
  /** The slider its level is read from (default: the ref's own level). */
  level?: string;
  /** The robot remix's defaults (sampleCut.ts alienize); robots only. */
  alien?: AlienOptions;
  /** A seamless loop with this many seconds of crossfade (Fade is unused); played with startSoundLoop, so cut once. */
  loop?: number;
  /** How many variants it is cut into (default SAMPLE_VARIANTS). */
  variants?: number;
  start: number; len: number; fade: number; pitch: number; spread: number; lowpass: number; highpass: number; gain: number; under: number;
}

// Lengths from the recordings' envelopes (most run 1.5-7 s with the work done in the first 0.5-2 s); guns that fire
// fast are cut shortest. Starts are after the detected onset.
export const SAMPLES: SampleDef[] = [
  { id: "Breach", file: "hugecannon", sound: "breach", label: "Breach cannon (hugecannon)", start: 0, len: 2.2, fade: 1.0, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Autocannon", file: "mediumcannon", sound: "cannon", label: "Autocannon (mediumcannon)", start: 0, len: 0.6, fade: 0.35, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Shotgun", file: "flakcannon", sound: "shotgun", label: "Scattergun (flakcannon; Keith 2026-11-03: the flak recording suits the scattergun)", start: 0, len: 1.1, fade: 0.6, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Sniper", file: "sniper", sound: "sniper", label: "Sniper (sniper)", start: 0, len: 1.6, fade: 0.9, pitch: 0, spread: 0.8, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Rifle", file: "rifle", sound: "rifle", label: "Rifle (rifle)", start: 0, len: 0.5, fade: 0.3, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Smg", file: "smallroundfire", sound: "smg", label: "SMG (smallroundfire)", start: 0, len: 0.2, fade: 0.12, pitch: 0, spread: 1.5, lowpass: 20000, highpass: 120, gain: 0, under: 0 },
  { id: "Mortar", file: "grenadelauncherthump", sound: "mortar", label: "Mortar launch (grenadelauncherthump)", start: 0, len: 0.7, fade: 0.35, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "BlastLarge", file: "largebomb", sound: "blastLarge", ref: "blast", label: "Large blast (largebomb)", start: 0, len: 2.0, fade: 1.0, pitch: 0, spread: 1.2, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "BlastGiant", file: "giantbomb", sound: "blastGiant", ref: "blast", label: "Giant blast (giantbomb)", start: 0, len: 2.4, fade: 1.2, pitch: 0, spread: 1.2, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  // Batch 3: something going off far out in the desert (the expedition's distant blasts): the 7 s rolling double boom
  // Keith labelled "cannon", darkened and slowed a little, as far thunder.
  { id: "Distant", file: "cannon", sound: "distantBlast", ref: "blast", label: "Distant blast (cannon)", start: 0, len: 4, fade: 2.5, pitch: -2, spread: 1.5, lowpass: 1500, highpass: 30, gain: -2, under: 0 },
  // The robots (batch 2; Keith: "underwater", to be remixed further): pitched down and run through the alien remix. Matched
  // in loudness to the procedural blast (the beam and deaths) and the rail's charge whine (the charge).
  { id: "RobotCharge", file: "robotchargingnoise", sound: "robotCharge", ref: "railCharge", level: "robotChargeLevel", label: "Robot beam charge (robotchargingnoise)", start: 0, len: 2.0, fade: 0.4, pitch: -2, spread: 1, lowpass: 20000, highpass: 40, gain: 0, under: 0,
    alien: { ring: 0, ringMix: 0, comb: 4, combFb: 0.55, sweepFrom: 180, sweepTo: 2400, sweepQ: 8, sweepMix: 0.6 } },
  { id: "RobotBeam", file: "robotalienbeam", sound: "robotBeam", ref: "blast", level: "robotSoundLevel", label: "Robot beam release (robotalienbeam)", start: 0, len: 1.6, fade: 0.9, pitch: 0, spread: 1.5, lowpass: 20000, highpass: 30, gain: -3, under: 0,
    alien: { ring: 110, ringMix: 0.4, comb: 3, combFb: 0.6, sweepFrom: 300, sweepTo: 3000, sweepQ: 5, sweepMix: 0.35 } },
  { id: "RobotDeath", file: "robotalienexplosion", sound: "robotDeath", ref: "blast", level: "robotSoundLevel", label: "Robot death (robotalienexplosion)", start: 0, len: 2.2, fade: 1.2, pitch: -3, spread: 2, lowpass: 20000, highpass: 30, gain: -2, under: 0,
    alien: { ring: 70, ringMix: 0.35, comb: 6, combFb: 0.6, sweepFrom: 2000, sweepTo: 200, sweepQ: 6, sweepMix: 0.4 } },
  { id: "RobotBigDeath", file: "largerrobotalienexplosion", sound: "robotBigDeath", ref: "blast", level: "robotSoundLevel", label: "Big robot death (largerrobotalienexplosion)", start: 0, len: 3.0, fade: 1.6, pitch: -5, spread: 1.5, lowpass: 20000, highpass: 25, gain: 0, under: 0,
    alien: { ring: 45, ringMix: 0.3, comb: 9, combFb: 0.65, sweepFrom: 1500, sweepTo: 120, sweepQ: 6, sweepMix: 0.4 } },
  // The sword (Keith 2026-11-05). The swipe is a turbine blade's sweep: its one big pass, sped up 3 semitones as he asked,
  // and each sword's pitch goes on top (Sword sound). The scrape is the loudest half second of a recording he marked too long.
  { id: "SwordSwing", file: "bladeswipe", sound: "swordSwing", label: "Sword swipe (bladeswipe)", start: 0.05, len: 0.75, fade: 0.3, pitch: 3, spread: 1, lowpass: 20000, highpass: 60, gain: 0, under: 0 },
  { id: "SwordScrape", file: "bladeonmetal", sound: "swordScrape", label: "Sword scrape on metal (bladeonmetal)", start: 0.5, len: 0.6, fade: 0.3, pitch: 0, spread: 2, lowpass: 20000, highpass: 200, gain: 0, under: 0 },
];

/** How many variants each sample is cut into (pitches spread evenly across its spread). */
export const SAMPLE_VARIANTS = 3;

const FIELDS = ["On", "Start", "Len", "Fade", "Pitch", "Spread", "Lp", "Hp", "Gain", "Under"] as const;
export type SampleField = (typeof FIELDS)[number];
export const sampleKey = (d: SampleDef, f: SampleField) => `smp${d.id}${f}`;

export const SAMPLE_GROUP = "Sound samples";

type AlienField = keyof AlienOptions;
export const ALIEN_FIELDS: [AlienField, string, number, number, number, string][] = [
  ["ring", "Remix: ring mod (Hz)", 0, 600, 1, "Multiplies the sound by a tone this high: metallic, inharmonic; 0 off"],
  ["ringMix", "Remix: ring mod mix", 0, 1, 0.01, ""],
  ["comb", "Remix: resonator (ms)", 0, 30, 0.1, "A feedback delay this long rings at 1000/ms Hz (a hollow, robotic body); 0 off"],
  ["combFb", "Remix: resonator feedback", 0, 0.95, 0.01, "Higher rings longer and more pitched"],
  ["sweepFrom", "Remix: sweep from (Hz)", 50, 8000, 10, "A resonant band moving across the sound, from here..."],
  ["sweepTo", "Remix: sweep to (Hz)", 50, 8000, 10, "...to here (up for a charge, down for a death)"],
  ["sweepQ", "Remix: sweep resonance", 0.5, 20, 0.1, ""],
  ["sweepMix", "Remix: sweep mix", 0, 1, 0.01, "0 off"],
];
export const alienKey = (d: SampleDef, f: AlienField) => `smp${d.id}${f[0].toUpperCase()}${f.slice(1)}`;
export const sampleGroup = (d: SampleDef) => `Sample: ${d.label}`;

const defaults: Record<string, number> = { samplesOn: 1, sampleBlastFrom: 2.5, sampleGiantFrom: 9, robotSoundLevel: 2, robotChargeLevel: 0.5, robotSmallDeath: 0.3 };
const params: Param[] = [
  { key: "samplesOn", label: "Recorded sounds on", min: 0, max: 1, step: 1, group: SAMPLE_GROUP, tip: "0: every sound procedural, as before the Pixabay sounds" },
  { key: "sampleBlastFrom", label: "Blasts this big use the recording (m)", min: 0, max: 20, step: 0.5, group: SAMPLE_GROUP, tip: "Smaller blasts (swarm missiles 2.2 m) keep the procedural blast; RPG 4.5, pod 3, cannon shell 4, salvo 5.5" },
  { key: "sampleGiantFrom", label: "Giant blast from (m)", min: 0, max: 30, step: 0.5, group: SAMPLE_GROUP, tip: "Blasts this big play the giant recording (the big mortar is 14 m)" },
  { key: "robotSoundLevel", label: "Robot beams and deaths level", min: 0, max: 4, step: 0.01, group: SAMPLE_GROUP, tip: "The robots' recorded beam release and deaths (as loud as Big blasts at the same value)" },
  { key: "robotChargeLevel", label: "Robot beam charge level", min: 0, max: 2, step: 0.01, group: SAMPLE_GROUP },
  { key: "robotSmallDeath", label: "Small robot death share", min: 0, max: 1, step: 0.01, group: SAMPLE_GROUP, tip: "Scrappers die by the dozen: their death is the robot death this loud, higher and shorter (0: silent)" },
];
for (const d of SAMPLES) {
  const g = sampleGroup(d);
  const v: Record<SampleField, number> = { On: 1, Start: d.start, Len: d.len, Fade: d.fade, Pitch: d.pitch, Spread: d.spread, Lp: d.lowpass, Hp: d.highpass, Gain: d.gain, Under: d.under };
  for (const f of FIELDS) defaults[sampleKey(d, f)] = v[f];
  params.push(
    { key: sampleKey(d, "On"), label: "Use the recording", min: 0, max: 1, step: 1, group: g, tip: "0: the procedural sound" },
    { key: sampleKey(d, "Start"), label: "Start after onset (s)", min: -0.05, max: Math.max(1.5, d.start * 2), step: 0.005, group: g },
    { key: sampleKey(d, "Len"), label: "Length (s)", min: 0.05, max: Math.max(7, d.len * 2), step: 0.01, group: g, tip: "How much of the recording is kept (at its own pitch)" },
    d.loop ? { key: sampleKey(d, "Fade"), label: "Loop crossfade (s)", min: 0.01, max: 2, step: 0.01, group: g, tip: "The end runs into the start over this long, so the loop has no seam" }
      : { key: sampleKey(d, "Fade"), label: "Fade out (s)", min: 0.01, max: 4, step: 0.01, group: g },
    { key: sampleKey(d, "Pitch"), label: "Pitch (semitones)", min: -24, max: 12, step: 0.1, group: g, tip: "Lower is slower and longer, like tape" },
    { key: sampleKey(d, "Spread"), label: "Variant spread (semitones)", min: 0, max: 6, step: 0.1, group: g, tip: `The ${d.variants ?? SAMPLE_VARIANTS} variants sit this far apart in pitch, so repeats don't sound the same` },
    { key: sampleKey(d, "Lp"), label: "Low-pass (Hz)", min: 200, max: 20000, step: 50, group: g, tip: "Darker; 18000 and up is off" },
    { key: sampleKey(d, "Hp"), label: "High-pass (Hz)", min: 20, max: 2000, step: 5, group: g, tip: "Thinner; 25 and under is off" },
    { key: sampleKey(d, "Gain"), label: "Gain (dB)", min: -24, max: 12, step: 0.5, group: g, tip: "0: as loud in its first quarter second as the procedural sound it replaces" },
    { key: sampleKey(d, "Under"), label: "Procedural under", min: 0, max: 1.5, step: 0.01, group: g, tip: "Mix the procedural sound in beneath the recording, this loud" },
  );
  if (d.alien) for (const [f, label, min, max, step, tip] of ALIEN_FIELDS) {
    const key = alienKey(d, f);
    defaults[key] = d.alien[f];
    params.push({ key, label, min, max, step, group: g, tip });
  }
}

/** Every sample slider's default; typed as the three shared keys only so spreading it doesn't loosen a lab's value type
 *  (the per-sample keys are read by name, sampleBank.ts). */
export const SAMPLE_DEFAULTS = defaults as { samplesOn: number; sampleBlastFrom: number; sampleGiantFrom: number; robotSoundLevel: number; robotChargeLevel: number; robotSmallDeath: number };
export const SAMPLE_PARAMS: Param[] = params;
export const SAMPLE_TOPIC = { id: "samples", label: "Sound samples", groups: [SAMPLE_GROUP, ...SAMPLES.map(sampleGroup)] };
