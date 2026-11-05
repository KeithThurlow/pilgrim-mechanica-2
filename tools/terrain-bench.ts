// Times DuneField.sample and fingerprints its output, so a speed-up can be shown to change no height at all.
// Run: npx tsx tools/terrain-bench.ts [--write file | --compare file]
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
const fs = (globalThis as any).process.getBuiltinModule("node:fs");
const argv: string[] = (globalThis as any).process.argv;
const fields = [
  new DuneField({ ...TERRAIN_DEFAULTS }),
  new DuneField({ ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS } as any),
];
const N = 400_000, out = new Float64Array(N * 2 * 4);
let k = 0;
const t0 = performance.now();
for (const f of fields) {
  for (let i = 0; i < N; i++) {
    const x = ((i * 7919) % 6007) * 1.37 - 4000 + i * 1e-3, z = ((i * 104729) % 5003) * 1.61 - 4000 - i * 2e-3;
    const s = f.sample(x, z);
    out[k++] = s.h; out[k++] = s.crest; out[k++] = s.flat; out[k++] = s.rock ?? 0;
  }
}
const ms = performance.now() - t0;
console.log(`${(2 * N / 1000).toFixed(0)}k samples in ${ms.toFixed(0)} ms (${(ms * 1000 / (2 * N)).toFixed(2)} µs each)`);
const i = argv.indexOf("--write"), j = argv.indexOf("--compare");
if (i > 0) fs.writeFileSync(argv[i + 1], Buffer.from(out.buffer));
if (j > 0) {
  const ref = new Float64Array(new Uint8Array(fs.readFileSync(argv[j + 1])).buffer);
  let diff = 0; for (let n = 0; n < out.length; n++) if (!Object.is(ref[n], out[n])) diff++;
  console.log(diff ? `DIFFERS at ${diff} values` : "identical to reference");
}
