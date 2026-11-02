// The recorded sounds (Keith 2026-11-02: Pixabay sounds, royalty-free, no attribution; provenance in docs/assets.md).
// Each one stands in for a procedural sound of the same name (src/weapons/weaponSound.ts): the bank (sampleBank.ts)
// cuts it into a few variants by these sliders, matches its punch to the procedural sound's, and swaps it in; with
// the sample off (or before it has loaded, or if it fails to) the procedural sound plays as before. "Procedural
// under" mixes the procedural sound in beneath the sample (its crack on a softer recording, say).
import type { Param } from "../core/tweaks";

export interface SampleDef {
  /** Key stem for its sliders (smp<Id>On, ...) and its file: public/sounds/pixabay/<file>.mp3. */
  id: string;
  file: string;
  /** The sound it plays as (Sfx.addSound's name). */
  sound: string;
  /** The procedural sound its loudness is matched to and mixed under it (default: `sound`). */
  ref?: string;
  label: string;
  start: number; len: number; fade: number; pitch: number; spread: number; lowpass: number; highpass: number; gain: number; under: number;
}

// Lengths from the recordings' envelopes (most run 1.5-7 s with the work done in the first 0.5-2 s); guns that fire
// fast are cut shortest. Starts are after the detected onset.
export const SAMPLES: SampleDef[] = [
  { id: "Breach", file: "hugecannon", sound: "breach", label: "Breach cannon (hugecannon)", start: 0, len: 2.2, fade: 1.0, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Autocannon", file: "mediumcannon", sound: "cannon", label: "Autocannon (mediumcannon)", start: 0, len: 0.6, fade: 0.35, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Flak", file: "flakcannon", sound: "flak", label: "Flak (flakcannon)", start: 0, len: 1.1, fade: 0.6, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Sniper", file: "sniper", sound: "sniper", label: "Sniper (sniper)", start: 0, len: 1.6, fade: 0.9, pitch: 0, spread: 0.8, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Rifle", file: "rifle", sound: "rifle", label: "Rifle (rifle)", start: 0, len: 0.5, fade: 0.3, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "Smg", file: "smallroundfire", sound: "smg", label: "SMG (smallroundfire)", start: 0, len: 0.2, fade: 0.12, pitch: 0, spread: 1.5, lowpass: 20000, highpass: 120, gain: 0, under: 0 },
  { id: "Mortar", file: "grenadelauncherthump", sound: "mortar", label: "Mortar launch (grenadelauncherthump)", start: 0, len: 0.7, fade: 0.35, pitch: 0, spread: 1, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "BlastLarge", file: "largebomb", sound: "blastLarge", ref: "blast", label: "Large blast (largebomb)", start: 0, len: 2.0, fade: 1.0, pitch: 0, spread: 1.2, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
  { id: "BlastGiant", file: "giantbomb", sound: "blastGiant", ref: "blast", label: "Giant blast (giantbomb)", start: 0, len: 2.4, fade: 1.2, pitch: 0, spread: 1.2, lowpass: 20000, highpass: 20, gain: 0, under: 0 },
];

/** How many variants each sample is cut into (pitches spread evenly across its spread). */
export const SAMPLE_VARIANTS = 3;

const FIELDS = ["On", "Start", "Len", "Fade", "Pitch", "Spread", "Lp", "Hp", "Gain", "Under"] as const;
export type SampleField = (typeof FIELDS)[number];
export const sampleKey = (d: SampleDef, f: SampleField) => `smp${d.id}${f}`;

export const SAMPLE_GROUP = "Sound samples";
export const sampleGroup = (d: SampleDef) => `Sample: ${d.label}`;

const defaults: Record<string, number> = { samplesOn: 1, sampleBlastFrom: 2.5, sampleGiantFrom: 9 };
const params: Param[] = [
  { key: "samplesOn", label: "Recorded sounds on", min: 0, max: 1, step: 1, group: SAMPLE_GROUP, tip: "0: every sound procedural, as before the Pixabay sounds" },
  { key: "sampleBlastFrom", label: "Blasts this big use the recording (m)", min: 0, max: 20, step: 0.5, group: SAMPLE_GROUP, tip: "Smaller blasts (swarm missiles 2.2 m) keep the procedural blast; RPG 4.5, pod 3, cannon shell 4, salvo 5.5" },
  { key: "sampleGiantFrom", label: "Giant blast from (m)", min: 0, max: 30, step: 0.5, group: SAMPLE_GROUP, tip: "Blasts this big play the giant recording (the big mortar is 14 m)" },
];
for (const d of SAMPLES) {
  const g = sampleGroup(d);
  const v: Record<SampleField, number> = { On: 1, Start: d.start, Len: d.len, Fade: d.fade, Pitch: d.pitch, Spread: d.spread, Lp: d.lowpass, Hp: d.highpass, Gain: d.gain, Under: d.under };
  for (const f of FIELDS) defaults[sampleKey(d, f)] = v[f];
  params.push(
    { key: sampleKey(d, "On"), label: "Use the recording", min: 0, max: 1, step: 1, group: g, tip: "0: the procedural sound" },
    { key: sampleKey(d, "Start"), label: "Start after onset (s)", min: -0.05, max: 1.5, step: 0.005, group: g },
    { key: sampleKey(d, "Len"), label: "Length (s)", min: 0.05, max: 7, step: 0.01, group: g, tip: "How much of the recording is kept (at its own pitch)" },
    { key: sampleKey(d, "Fade"), label: "Fade out (s)", min: 0.01, max: 4, step: 0.01, group: g },
    { key: sampleKey(d, "Pitch"), label: "Pitch (semitones)", min: -24, max: 12, step: 0.1, group: g, tip: "Lower is slower and longer, like tape" },
    { key: sampleKey(d, "Spread"), label: "Variant spread (semitones)", min: 0, max: 6, step: 0.1, group: g, tip: `The ${SAMPLE_VARIANTS} variants sit this far apart in pitch, so repeats don't sound the same` },
    { key: sampleKey(d, "Lp"), label: "Low-pass (Hz)", min: 200, max: 20000, step: 50, group: g, tip: "Darker; 18000 and up is off" },
    { key: sampleKey(d, "Hp"), label: "High-pass (Hz)", min: 20, max: 2000, step: 5, group: g, tip: "Thinner; 25 and under is off" },
    { key: sampleKey(d, "Gain"), label: "Gain (dB)", min: -24, max: 12, step: 0.5, group: g, tip: "0: as loud in its first quarter second as the procedural sound it replaces" },
    { key: sampleKey(d, "Under"), label: "Procedural under", min: 0, max: 1.5, step: 0.01, group: g, tip: "Mix the procedural sound in beneath the recording, this loud" },
  );
}

/** Every sample slider's default; typed as the three shared keys only so spreading it doesn't loosen a lab's value type
 *  (the per-sample keys are read by name, sampleBank.ts). */
export const SAMPLE_DEFAULTS = defaults as { samplesOn: number; sampleBlastFrom: number; sampleGiantFrom: number };
export const SAMPLE_PARAMS: Param[] = params;
export const SAMPLE_TOPIC = { id: "samples", label: "Sound samples", groups: [SAMPLE_GROUP, ...SAMPLES.map(sampleGroup)] };
