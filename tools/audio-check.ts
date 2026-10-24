// Headless audio check: every generated sound is finite, under full scale, has some energy, and the growl loops
// without a click at the seam. Run: npm test (or npx tsx tools/audio-check.ts).
import { Synth, rng, grindRecipe } from "../src/audio/synth";

const S = new Synth(48000);
const r = () => rng(42);
const sounds: Record<string, Float32Array> = {
  spit: S.mix(S.tick(r(), 0.03, 0.55), S.thump(0.05, 260, 120, 0.45), S.noise(r(), 0.06, 2600, 0.32, 0.0008), S.delay(S.tick(r(), 0.02, 0.22), 0.012)),
  spinUp: S.mix(S.whine(1.1, 110, 820, 0.26), S.servo(1.1, 700, 2300, 0.07), S.ratchet(r(), 1.1, 9, 58, 0.42, true), S.clatter(r(), 1.1, 7, 46, 0.22, true)),
  spinDown: S.mix(S.whine(0.9, 820, 90, 0.26), S.servo(0.7, 2300, 500, 0.05), S.ratchet(r(), 0.9, 52, 7, 0.36, false), S.clatter(r(), 0.8, 42, 6, 0.16, false)),
  growl: S.growl(r(), 1, 22, 55),
  casing: S.casingTonk(r()),
  grind: grindRecipe(S, r()),
  dirt: S.mix(S.noise(r(), 0.16, 900, 0.55, 0.001), S.thump(0.12, 120, 60, 0.45), S.crackle(r(), 0.15, 0.2)),
};
let failed = false;
for (const [name, s] of Object.entries(sounds)) {
  let peak = 0, rms = 0, bad = 0;
  for (const x of s) { if (!Number.isFinite(x)) bad++; peak = Math.max(peak, Math.abs(x)); rms += x * x; }
  rms = Math.sqrt(rms / s.length);
  const problems: string[] = [];
  if (bad) problems.push(`${bad} non-finite samples`);
  if (peak > 1) problems.push(`peak ${peak.toFixed(2)} over full scale`);
  if (rms < 0.005) problems.push("nearly silent");
  if (name === "growl" && Math.abs(s[0] - s[s.length - 1]) > 0.15) problems.push(`seam jump ${Math.abs(s[0] - s[s.length - 1]).toFixed(2)}`);
  console.log(`${problems.length ? "FAIL" : "ok  "} ${name.padEnd(9)} ${(s.length / 48000).toFixed(2)} s · peak ${peak.toFixed(2)} · rms ${rms.toFixed(3)}${problems.length ? " · " + problems.join("; ") : ""}`);
  if (problems.length) failed = true;
}
if (failed) throw new Error("audio check failed");
console.log("audio check passed");
