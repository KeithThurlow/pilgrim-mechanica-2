// Headless check for the recorded sounds (src/audio/samples.ts, sampleCut.ts, sampleBank.ts): the cutter keeps the
// length asked, skips the lead-in, fades to silence, filters, matches loudness and never clips; every sample's file
// is in public/ and stands in for a sound that exists. With ffmpeg on the PATH it also decodes each recording and
// prints its default cut (length, peak, how its punch compares with the procedural sound's). Run: npm test.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { alienize, cutSample, matchLoudness, onset, punchRms, mixUnder } from "../src/audio/sampleCut";
import { SAMPLES, SAMPLE_DEFAULTS, SAMPLE_PARAMS, ALIEN_FIELDS, alienKey, sampleKey } from "../src/audio/samples";
import { cutVariants } from "../src/audio/sampleBank";
import { addWeaponSounds } from "../src/weapons/weaponSound";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import type { Sfx } from "../src/audio/sfx";

let failed = 0;
const ok = (c: boolean, what: string) => { if (!c) { failed++; console.log(`FAIL ${what}`); } };
const sr = 48000;

// A synthetic recording: 0.3 s of silence, then a decaying 120 Hz tone with hiss.
const src = new Float32Array(sr * 3);
for (let i = Math.round(0.3 * sr); i < src.length; i++) { const t = i / sr - 0.3; src[i] = Math.exp(-t * 2) * (0.8 * Math.sin(2 * Math.PI * 120 * t) + 0.2 * Math.sin(i * 12.9898) ); }
ok(Math.abs(onset(src) / sr - 0.3) < 0.005, `onset at ${(onset(src) / sr).toFixed(3)} s, not 0.3`);
const cut = cutSample(src, sr, 44100, { start: 0, len: 1, fade: 0.3, rate: 1, lowpass: 20000, highpass: 20 });
ok(cut.length === 44100, `length ${cut.length}`);
ok(Math.abs(cut[cut.length - 1]) < 1e-3, "fades to silence");
ok(Math.abs(cut[0]) < 1e-3, "starts from silence (no click)");
const down = cutSample(src, sr, 44100, { start: 0, len: 1, fade: 0.3, rate: 0.5, lowpass: 20000, highpass: 20 });
ok(down.every(Number.isFinite), "pitched cut finite");
const dark = cutSample(src, sr, 44100, { start: 0, len: 1, fade: 0.3, rate: 1, lowpass: 300, highpass: 20 });
const thin = cutSample(src, sr, 44100, { start: 0, len: 1, fade: 0.3, rate: 1, lowpass: 20000, highpass: 1000 });
ok(punchRms(thin, 44100) < punchRms(cut, 44100) * 0.5, "high-pass takes the 120 Hz body off");
ok(punchRms(dark, 44100) > punchRms(thin, 44100), "low-pass keeps the body");
const m = matchLoudness(Float32Array.from(cut), 44100, 0.1, 0);
ok(Math.abs(20 * Math.log10(punchRms(m, 44100) / 0.1)) < 0.5, "loudness matched within 0.5 dB");
const loud = matchLoudness(Float32Array.from(cut), 44100, 5, 12);
ok(Math.max(...loud.map(Math.abs)) <= 0.981, "never past the ceiling");
ok(mixUnder(cut, new Float32Array(50000), 0.5).length === 50000, "mix under lengthens to the longer");

// A loop: as long as asked, and the wrap from its last sample to its first is no bigger than a step inside it.
const tone = new Float32Array(sr * 3);
for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin(2 * Math.PI * 97.3 * i / sr);
const lp = cutSample(tone, sr, 44100, { start: 0.2, len: 1, fade: 0.3, rate: 1, lowpass: 20000, highpass: 20, loop: 0.3 });
let step = 0; for (let i = 1; i < lp.length; i++) step = Math.max(step, Math.abs(lp[i] - lp[i - 1]));
ok(lp.length === 44100, `loop length ${lp.length}`);
ok(Math.abs(lp[0] - lp[lp.length - 1]) <= step * 1.5, "loop joins without a click");

// The robot remix: every stage on at once stays finite and bounded, and does change the sound.
const al = alienize(Float32Array.from(cut), 44100, { ring: 90, ringMix: 0.5, comb: 5, combFb: 0.9, sweepFrom: 3000, sweepTo: 100, sweepQ: 12, sweepMix: 0.8 });
ok(al.every(Number.isFinite) && Math.max(...al.map(Math.abs)) < 50, "remix finite and bounded");
let diff = 0; for (let i = 0; i < al.length; i++) diff += Math.abs(al[i] - cut[i]);
ok(diff / al.length > 0.01, "remix changes the sound");
const same = alienize(Float32Array.from(cut), 44100, { ring: 0, ringMix: 0, comb: 0, combFb: 0, sweepFrom: 100, sweepTo: 100, sweepQ: 1, sweepMix: 0 });
ok(same.every((x, i) => x === cut[i]), "remix with every stage off leaves it alone");

// The table: files present, sliders complete, sounds that exist.
const procedural = readFileSync("src/weapons/weaponSound.ts", "utf8");
const keys = new Set(SAMPLE_PARAMS.map((p) => p.key));
const D = SAMPLE_DEFAULTS as unknown as Record<string, number>;
for (const d of SAMPLES) {
  ok(existsSync(`public/sounds/pixabay/${d.file}.mp3`), `${d.file}.mp3 in public/sounds/pixabay`);
  for (const f of ["On", "Start", "Len", "Fade", "Pitch", "Spread", "Lp", "Hp", "Gain", "Under"] as const) ok(keys.has(sampleKey(d, f)) && Number.isFinite(D[sampleKey(d, f)]), `${d.id} ${f} slider`);
  if (d.alien) for (const [f] of ALIEN_FIELDS) ok(keys.has(alienKey(d, f)) && Number.isFinite(D[alienKey(d, f)]), `${d.id} remix ${f} slider`);
  ok(procedural.includes(`addSound("${d.ref ?? d.sound}"`), `${d.id} matches a procedural sound (${d.ref ?? d.sound})`);
}

// The real recordings, when ffmpeg is about (it is on the agents' machines; Keith's PC may not have it).
let ff = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ff = false; }
// The procedural sounds, generated as the game does, to match against.
const proc = new Map<string, Float32Array[]>();
const fake = { rate: 44100, onUpdate: [], addSound: (n: string, d: Float32Array[]) => proc.set(n, d) } as unknown as Sfx;
addWeaponSounds(fake, WEAPON_DEFAULTS);
if (ff) {
  for (const d of SAMPLES) {
    const raw = execFileSync("ffmpeg", ["-v", "quiet", "-i", `public/sounds/pixabay/${d.file}.mp3`, "-ac", "1", "-ar", "44100", "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const ref = proc.get(d.ref ?? d.sound)!;
    const refRms = ref.reduce((a, p) => a + punchRms(p, 44100), 0) / ref.length;
    const vs = cutVariants(d, D, x, 44100, 44100, ref);
    const peak = Math.max(...vs.map((v) => v.reduce((a, s) => Math.max(a, Math.abs(s)), 0)));
    const lens = vs.map((v) => (v.length / 44100).toFixed(2)).join("/");
    const punch = 20 * Math.log10(punchRms(vs[vs.length >> 1], 44100) / refRms);
    const refPeak = Math.max(...ref.map((v) => v.reduce((a, s) => Math.max(a, Math.abs(s)), 0)));
    ok(vs.every((v) => v.every(Number.isFinite)) && peak > 0.01 && peak <= 0.981, `${d.id} cut finite, audible, under full scale`);
    console.log(`  ${d.id.padEnd(11)} ${(x.length / 44100).toFixed(2)} s recording → ${lens} s cuts · peak ${peak.toFixed(2)} (procedural ${refPeak.toFixed(2)}) · punch ${punch >= 0 ? "+" : ""}${punch.toFixed(1)} dB vs procedural`);
  }
} else console.log("  (no ffmpeg: recordings not decoded)");

if (failed) throw new Error(`samples check: ${failed} failed`);
console.log("samples check passed");
