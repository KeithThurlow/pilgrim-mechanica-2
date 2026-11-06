// Chunk streaming check (perf, Keith 2026-11-06: one chunk build was ~25 ms on his PC, so builds now run over several
// frames under the budget): chunks built a few rows a frame, with patches and rebuilds landing on rows already filled,
// end up exactly as chunks built in one go.
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS } from "../src/world/chunks";

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed++; };

// Ground that changes in boxes (stand-ins for the road's cut): a raised floor switched on in each box.
const V = { ...TERRAIN_DEFAULTS };
const field = new DuneField(V);
const boxes: { x0: number; z0: number; x1: number; z1: number; berm: number }[] = [];
field.modifier = { at: (x, z, m) => {
  for (const b of boxes) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) { m.w = 0.5; m.berm = b.berm; m.lift = 0; m.rough = 0; return true; }
  return false;
} };
const change = (x0: number, z0: number, x1: number, z1: number, berm: number) => { boxes.push({ x0, z0, x1, z1, berm }); return [x0, z0, x1, z1] as const; };
const sv = { ...STREAM_DEFAULTS, radius: 2, budgetMs: 0.01 };
const slow = new TerrainStreamer(field, sv);
const at = (s: TerrainStreamer) => { const out: number[] = []; const o = new Float32Array(7);
  const n = sv.segments; for (let j = -2 * n; j < 3 * n; j += 3) for (let i = -2 * n; i < 3 * n; i += 3) out.push(s.vertexAt(i, j, o) ? o[0] + o[1] * 7 + o[4] * 13 : NaN); return out; };

// Frames: a row a frame (chunks near the focus at once). At frame 40 the chunk at (-2, 0) is part built: the ground
// changes over rows it has filled and is patched; later a change on a chunk not yet started is a rebuild.
let frames = 0;
const tick = () => { slow.update(5, 5); frames++; };
for (let f = 0; f < 40; f++) tick();
slow.patchArea(...change(-118, 4, -70, 60, 0.8));
for (let f = 0; f < 40; f++) tick();
slow.rebuildArea(...change(70, -123, 118, -67, 1.3));
for (let f = 0; f < 4000 && (slow.stats.pending > 0); f++) tick();
check(slow.stats.pending === 0, `every chunk built over ${frames} frames (pending ${slow.stats.pending})`);

const fast = new TerrainStreamer(field, { ...sv });
fast.fill(5, 5);
const a = at(slow), b = at(fast);
let diff = 0, nan = 0;
for (let i = 0; i < a.length; i++) { if ((a[i] !== a[i]) !== (b[i] !== b[i])) nan++; else if (a[i] !== a[i]) continue; else diff = Math.max(diff, Math.abs(a[i] - b[i])); }
check(nan === 0 && diff === 0, `built a few rows a frame = built at once (${a.length} vertices, max diff ${diff}, missing ${nan})`);
if (failed) { console.log(`${failed} failed`); process.exit(1); }
