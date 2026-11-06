// Terrain through the sim worker (docs/proposal-simworker.md step 2): two TerrainStreamers on the same convoy-lab ground,
// one building and patching its chunks itself, the other asking a stand-in worker (a GroundMirror fed the recorded ground
// events, answering a frame late, as src/sim/host.ts and worker.ts do). The convoy drives with the plough cutting the road,
// blasts dent the ground near it, the focus follows the convoy; after the answers are in, every chunk both have must match
// where they differ, the worker's chunk is never further from the ground than the main thread's (the main thread's crater
// patches read a cache of the ground under the dents, which can hold road it has since cut; the worker's read it fresh).
// Also: chunk vertices from the copy equal the main thread's exactly; most chunks were built remotely.
// Run: npm test (or npx tsx tools/terrainworker-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS } from "../src/convoy/platform";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";
import { SITES_DEFAULTS } from "../src/expedition/sites";
import { SitesGround, roadBlocks } from "../src/expedition/sitesGround";
import { TerrainStreamer, STREAM_DEFAULTS, PATCH_PAD, type BuildResult, type PatchResult } from "../src/world/chunks";
import { chunkArrays, fillChunkRows, patchBlocks } from "../src/world/chunkFill";
import { GroundRecorder } from "../src/sim/groundEvents";
import { GroundMirror } from "../src/sim/groundMirror";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };
let seed = 777;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const V = {
  ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS,
  ...TRAIN_DEFAULTS, ...CRATER_DEFAULTS, ...SITES_DEFAULTS, ...STREAM_DEFAULTS, radius: 3, segments: 32,
};
const field = new DuneField(V);
const route = new ConvoyRoute(V, 0, 0);
field.modifier = route;
const craters = new CraterLayer(V, field);
field.dents = craters;
const rec = new GroundRecorder({ V, field, route, craters, routeAt: [0, 0] });
const local = new TerrainStreamer(field, { ...V });
const remote = new TerrainStreamer(field, { ...V });
route.onChange = (x0, z0, x1, z1) => {
  craters.invalidate(x0, z0, x1, z1);
  for (const st of [local, remote]) st.patchArea(x0, z0, x1, z1);
};
const convoy = new Convoy(route, V, field);
convoy.reset(0, 0);
const sites = new SitesGround(V, field, roadBlocks(route));
sites.keepClear(0, 0, 190);
sites.rebuild();
const mirror = new GroundMirror(structuredClone(rec.init));

// The stand-in worker: requests in order (the ground's events before each), answered at the next frame.
type Job = () => (() => void);
let queue: Job[] = [], answers: (() => void)[] = [];
const flush = () => { const ev = rec.take(); if (ev.length) { const e = structuredClone(ev); queue.push(() => { mirror.apply(e); return () => {}; }); } };
remote.remote = {
  build: (q) => {
    flush();
    queue.push(() => {
      const a = chunkArrays(q.n, q.water);
      fillChunkRows(mirror.field, q.cx, q.cz, q.n, q.size, a, 0, q.n + 1);
      const res: BuildResult = structuredClone({ ...a, epoch: q.epoch, seq: q.seq, cx: q.cx, cz: q.cz, n: q.n, size: q.size });
      return () => remote.takeBuild(res);
    });
  },
  patch: (q) => {
    flush();
    queue.push(() => {
      const b = q.box, res: PatchResult = structuredClone({ ...q, blocks: patchBlocks(mirror.field, b[0], b[1], b[2], b[3], q.n, q.size) });
      return () => remote.takePatch(res);
    });
  },
};
/** The worker runs what was asked this frame; its answers arrive before the next frame. */
const workerFrame = () => { flush(); const q = queue; queue = []; for (const a of answers) a(); answers = q.map((j) => j()); };

const dt = 1 / 60, p = { x: 0, z: 0, heading: 0 };
const changed = (x0: number, z0: number, x1: number, z1: number) => { for (const st of [local, remote]) st.queuePatch(x0, z0, x1, z1); };
for (let f = 0; f < 900; f++) {
  for (let i = 0; i < 2; i++) convoy.update(dt / 2);
  if (f % 7 === 0) {
    route.pointAt(route.s + 30 * rnd(), p);
    const box = craters.blast(p.x + (rnd() - 0.5) * 90, p.z + (rnd() - 0.5) * 90, 3 + 5 * rnd());
    if (box) changed(box[0], box[1], box[2], box[3]);
  }
  craters.update(dt, changed);
  for (const st of [local, remote]) st.flushPatches();
  if (f === 400) { local.rebuildArea(p.x - 20, p.z - 20, p.x + 20, p.z + 20); remote.rebuildArea(p.x - 20, p.z - 20, p.x + 20, p.z + 20); }
  route.pointAt(route.s, p);
  local.update(p.x, p.z);
  remote.update(p.x, p.z);
  workerFrame();
}
// Settle: nothing changes; the remote one catches up.
for (let f = 0; f < 40; f++) { route.pointAt(route.s, p); local.update(p.x, p.z); remote.update(p.x, p.z); workerFrame(); }

let worse = 0, worst = 0, differ = 0;
let chunks = 0, verts = 0, dh = 0, dn = 0, dc = 0, missing = 0;
const a = new Float32Array(7), b = new Float32Array(7), n = V.segments;
route.pointAt(route.s, p);
const ccx = Math.floor(p.x / V.chunkSize), ccz = Math.floor(p.z / V.chunkSize);
for (let cz = ccz - 4; cz <= ccz + 4; cz++) for (let cx = ccx - 4; cx <= ccx + 4; cx++) {
  const A = local.chunkData(cx, cz), B = remote.chunkData(cx, cz);
  if (!A && !B) continue;
  if (!A || !B) { missing++; continue; }
  chunks++;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    if (!local.vertexAt(cx * n + i, cz * n + j, a) || !remote.vertexAt(cx * n + i, cz * n + j, b)) continue;
    verts++;
    // Where they differ, the worker's must be no further from the ground as it is now than the main thread's.
    const step = V.chunkSize / n, t = field.height(cx * V.chunkSize + i * step, cz * V.chunkSize + j * step);
    if (Math.abs(b[0] - t) > Math.abs(a[0] - t) + 1e-3) { worse++; worst = Math.max(worst, Math.abs(b[0] - t) - Math.abs(a[0] - t)); }
    if (Math.abs(a[0] - b[0]) > 1e-3) differ++;
    dh = Math.max(dh, Math.abs(a[0] - b[0]));
    dn = Math.max(dn, Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
    dc = Math.max(dc, Math.abs(a[4] - b[4]), Math.abs(a[5] - b[5]), Math.abs(a[6] - b[6]));
  }
}
const rs = remote.remoteStats;
console.log(`  ${chunks} chunks in both (${missing} in one only), ${verts} vertices: ${differ} heights differ by over 1 mm (largest ${dh.toFixed(3)} m), ${worse} of them further from the ground than the main thread's (by up to ${worst.toFixed(3)} m); remote: ${rs.builds} builds and ${rs.patches} patches asked, ${rs.applied} answers taken, ${rs.inflight} out`);
if (chunks < 20) fail(`only ${chunks} chunks to compare`);
if (missing > 2) fail(`${missing} chunks loaded in one streamer only after settling`);
if (verts < chunks * (n + 1) * (n + 1) * 0.9) fail(`only ${verts} vertices up to date in both`);
if (worse) fail(`${worse} of the worker's chunk vertices are further from the ground than the main thread's (by up to ${worst} m)`);
if (differ > verts * 0.01) fail(`${differ} of ${verts} chunk heights differ between the two (expected a few, where the main thread's crater patches read an old cache)`);
if (rs.builds < chunks / 2) fail(`only ${rs.builds} chunks were built remotely`);
if (rs.patches < 50) fail(`only ${rs.patches} patches went to the worker`);

// The copy's chunk vertices equal the main thread's exactly (same maths, same ground).
flush(); workerFrame(); workerFrame();
let exact = 0;
for (const [cx, cz] of [[ccx, ccz], [ccx + 1, ccz], [ccx, ccz - 1]]) {
  const A = chunkArrays(n, false), B = chunkArrays(n, false);
  fillChunkRows(field, cx, cz, n, V.chunkSize, A, 0, n + 1);
  fillChunkRows(mirror.field, cx, cz, n, V.chunkSize, B, 0, n + 1);
  for (let i = 0; i < A.pos.length; i++) if (A.pos[i] !== B.pos[i] || A.nor[i] !== B.nor[i] || A.col[i] !== B.col[i]) exact++;
}
const pa = patchBlocks(field, p.x - 10, p.z - 10, p.x + 10 + PATCH_PAD, p.z + 10, n, V.chunkSize), pb = patchBlocks(mirror.field, p.x - 10, p.z - 10, p.x + 10 + PATCH_PAD, p.z + 10, n, V.chunkSize);
for (let k = 0; k < pa.length; k++) for (let i = 0; i < pa[k].h.length; i++) if (pa[k].h[i] !== pb[k].h[i]) exact++;
console.log(`  copy vs main thread, three chunks and a patch: ${exact} values differ`);
if (exact) fail(`${exact} chunk values from the worker's copy differ from the main thread's`);

if (problems.length) { console.log(`terrainworker-check: ${problems.length} problem(s)`); process.exit(1); }
console.log("terrainworker-check: ok");
