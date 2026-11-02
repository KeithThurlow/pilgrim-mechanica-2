// The recorded sounds on a running Sfx (Keith 2026-11-02): fetches and decodes each recording once, cuts it into
// variants by its sliders (sampleCut.ts), matches its punch to the procedural sound it stands in for and swaps it in
// (Sfx.swapSound). Watches the sliders and recuts a sound a moment after one of its values changes; a sample switched
// off, still loading or failing to load leaves the procedural sound playing. Cosmetic: sound only, no game state.
import type { Sfx } from "./sfx";
import { SAMPLES, SAMPLE_VARIANTS, sampleKey, type SampleDef } from "./samples";
import { cutSample, matchLoudness, mixUnder, punchRms, toMono } from "./sampleCut";

type V = Record<string, number>;
const banks = new WeakMap<Sfx, SampleBank>();

const base = (() => { try { return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"; } catch { return "/"; } })();
export const sampleUrl = (d: SampleDef) => `${base}sounds/pixabay/${d.file}.mp3`;

export class SampleBank {
  private raw = new Map<string, { data: Float32Array; rate: number } | "loading" | "failed">();
  private sig = new Map<string, string>();
  private last = 0;
  /** Recordings decoded so far, and those that failed (for the lab's HUD). */
  loaded = 0;
  failed = 0;

  constructor(private sfx: Sfx, private v: V) {
    for (const d of SAMPLES) void this.load(d);
    sfx.onUpdate?.push(() => this.update()); // (absent on the headless checks' stand-in Sfx)
  }

  /** Whether a sample's sound is playing the recording now. */
  live(d: SampleDef) { return this.sig.get(d.id)?.startsWith("on") ?? false; }

  /** Whether the named sample sound (e.g. blastLarge) is in. */
  liveSound(sound: string) { const d = SAMPLES.find((s) => s.sound === sound); return !!d && this.live(d); }

  private async load(d: SampleDef) {
    if (typeof window === "undefined" || typeof fetch === "undefined") return;
    this.raw.set(d.id, "loading");
    try {
      const res = await fetch(sampleUrl(d));
      if (!res.ok) throw new Error(`${res.status}`);
      const buf = await this.sfx.ctx.decodeAudioData(await res.arrayBuffer());
      const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      this.raw.set(d.id, { data: toMono(chans), rate: buf.sampleRate });
      this.loaded++;
      this.sig.delete(d.id);
    } catch (e) {
      console.warn(`sound sample ${d.file} not loaded, procedural instead:`, e);
      this.raw.set(d.id, "failed");
      this.failed++;
    }
  }

  private signature(d: SampleDef) {
    const v = this.v, on = (v.samplesOn ?? 1) > 0.5 && (v[sampleKey(d, "On")] ?? 1) > 0.5;
    if (!on) return "off";
    return "on:" + (["Start", "Len", "Fade", "Pitch", "Spread", "Lp", "Hp", "Gain", "Under"] as const).map((f) => v[sampleKey(d, f)]).join(",");
  }

  /** Recut any sample whose values changed (checked five times a second; a slider drag recuts at most that often). */
  update() {
    const now = performance.now();
    if (now - this.last < 200) return;
    this.last = now;
    for (const d of SAMPLES) {
      const raw = this.raw.get(d.id);
      if (!raw || raw === "loading" || raw === "failed") continue;
      const s = this.signature(d);
      if (this.sig.get(d.id) === s) continue;
      this.sig.set(d.id, s);
      if (s === "off") { this.sfx.swapSound(d.sound, null); continue; }
      const ref = d.ref ?? d.sound;
      const proc = this.sfx.procedural(ref);
      // A sample-only sound (blastLarge) takes the level of the sound it's matched to.
      const level = d.ref ? this.levelOf(d.ref) : undefined;
      this.sfx.swapSound(d.sound, cutVariants(d, this.v, raw.data, raw.rate, this.sfx.rate, proc), level);
    }
  }

  private levelOf(name: string) {
    const v = this.v;
    return name === "blast" ? () => v.blastLevel ?? 1 : () => 1;
  }
}

/** A sample's variants by its sliders: pitches spread evenly, punch matched to the procedural variants', those mixed under. */
export function cutVariants(d: SampleDef, v: V, src: Float32Array, srcRate: number, outRate: number, proc?: Float32Array[]): Float32Array[] {
  const k = (f: Parameters<typeof sampleKey>[1]) => v[sampleKey(d, f)];
  const refRms = proc?.length ? proc.reduce((a, p) => a + punchRms(p, outRate), 0) / proc.length : 0.25;
  const out: Float32Array[] = [];
  for (let i = 0; i < SAMPLE_VARIANTS; i++) {
    const semis = k("Pitch") + (SAMPLE_VARIANTS > 1 ? (i / (SAMPLE_VARIANTS - 1) - 0.5) * k("Spread") : 0);
    const rate = Math.pow(2, semis / 12);
    const cut = cutSample(src, srcRate, outRate, { start: k("Start"), len: k("Len") / rate, fade: k("Fade") / rate, rate, lowpass: k("Lp"), highpass: k("Hp") });
    matchLoudness(cut, outRate, refRms, k("Gain"));
    out.push(mixUnder(cut, proc?.[i % Math.max(1, proc.length)], k("Under")));
  }
  return out;
}

/** The bank on this Sfx, made on first ask (every arsenal on a battlefield shares one). */
export function sampleBank(sfx: Sfx, v: V): SampleBank {
  let b = banks.get(sfx);
  if (!b) { b = new SampleBank(sfx, v); banks.set(sfx, b); }
  return b;
}

/** The bank on this Sfx if one was made (playBlast asks without making one). */
export const sampleBankOf = (sfx: Sfx) => banks.get(sfx);
