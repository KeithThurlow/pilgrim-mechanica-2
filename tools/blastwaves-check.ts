// Blast waves (src/fx/blastWaves.ts, blastWavesDraw.ts): every blast kind gets a wave by default; waves close in space
// and time merge; the live and per-frame caps are never exceeded; with nothing live the bend pass is off (no frame
// copy); every kind is posted from somewhere in the game; time per frame for a big barrage. Run: npx tsx tools/blastwaves-check.ts
import * as THREE from "three/webgpu";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BlastWaves, BLAST_WAVE_DEFAULTS, WAVE_KIND_LIST, WAVE_KINDS } from "../src/fx/blastWaves";
import { BlastWavesDraw } from "../src/fx/blastWavesDraw";

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };
const fresh = (over: Partial<typeof BLAST_WAVE_DEFAULTS> = {}) => new BlastWaves({ ...BLAST_WAVE_DEFAULTS, ...over });
const flat = { height: () => 0, normal: (_x: number, _z: number, out = [0, 1, 0]) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; } };

// 1. Every kind gets a wave by default; big kinds a second ring and heat.
for (const k of WAVE_KIND_LIST) {
  const w = fresh();
  w.post(k, 0, 1, 0, 3);
  const p = WAVE_KINDS[k];
  const main = w.waves.filter((x) => !x.ring2), second = w.waves.filter((x) => x.ring2);
  ok(main.length === 1 && main[0].reach > 0 && main[0].strength > 0 && main[0].life > 0,
    `${k}: one wave, reach ${main[0]?.reach.toFixed(1)} m, bend ${main[0]?.strength.toFixed(2)} m, ${main[0]?.life.toFixed(2)} s`);
  ok(second.length === (p.ring2 ? 1 : 0) && (w.puffs.length > 0) === p.heat, `${k}: second ring ${second.length}, heat puffs ${w.puffs.length}`);
}
{
  const w = fresh({ waveOn: 0 }); w.post("rocket", 0, 0, 0, 3);
  ok(w.waves.length === 0 && !w.active, "waves off: nothing posted");
  const w2 = fresh({ waveRocketK: 0 }); w2.post("rocket", 0, 0, 0, 3);
  ok(w2.waves.length === 0, "a kind's slider at 0 turns that kind off");
}

// 2. Merging: two blasts 2 m apart in one frame make one bigger, stronger wave; far apart stay two; after the merge time, two.
{
  const w = fresh();
  w.post("rocket", 0, 0, 0, 3); const r0 = w.waves[0].reach, s0 = w.waves[0].strength;
  w.post("rocket", 2, 0, 0, 3);
  ok(w.waves.length === 1 && w.waves[0].n === 2 && w.waves[0].reach > r0 && w.waves[0].strength > s0,
    `close blasts merge: 1 wave of 2, reach ${r0.toFixed(1)} -> ${w.waves[0].reach.toFixed(1)}, bend ${s0.toFixed(2)} -> ${w.waves[0].strength.toFixed(2)}`);
  w.post("rocket", 60, 0, 0, 3);
  ok(w.waves.length === 2, "a blast 60 m off stays its own wave");
  const w2 = fresh();
  w2.post("rocket", 0, 0, 0, 3);
  for (let i = 0; i < 30; i++) w2.update(1 / 120);
  w2.post("rocket", 1, 0, 0, 3);
  ok(w2.waves.length === 2, "a blast after the merge time starts its own wave");
}

// 3. Caps: a split-rocket barrage (60 blasts a frame spread over 80 m, for 3 s) never passes the caps.
{
  const w = fresh();
  let worstLive = 0, worstNew = 0, worstReach = 0;
  for (let f = 0; f < 180; f++) {
    const before = w.stats.started;
    for (let i = 0; i < 60; i++) w.post(i % 3 ? "rocket" : "mortar", Math.random() * 80, 0, Math.random() * 80, 2 + Math.random() * 2);
    worstNew = Math.max(worstNew, w.waves.filter((x) => !x.ring2 && x.frame === (w as unknown as { frame: number }).frame).length);
    worstLive = Math.max(worstLive, w.waves.length);
    for (const x of w.waves) worstReach = Math.max(worstReach, x.reach);
    void before;
    for (let i = 0; i < 20; i++) w.exhaust(Math.random() * 80, 10, Math.random() * 80, 1, 0, 0, 1);
    w.update(1 / 60);
  }
  ok(worstLive <= BLAST_WAVE_DEFAULTS.waveMax, `live waves never over the cap: worst ${worstLive} of ${BLAST_WAVE_DEFAULTS.waveMax}`);
  ok(worstNew <= BLAST_WAVE_DEFAULTS.wavePerFrame, `new waves a frame never over the cap: worst ${worstNew} of ${BLAST_WAVE_DEFAULTS.wavePerFrame}`);
  ok(w.puffs.length <= BLAST_WAVE_DEFAULTS.waveHeatMax, `heat puffs never over the cap: ${w.puffs.length} of ${BLAST_WAVE_DEFAULTS.waveHeatMax}`);
  const one = fresh(); one.post("mortar", 0, 0, 0, 4);
  const lim = Math.max(...one.waves.map((x) => x.reach)) * BLAST_WAVE_DEFAULTS.waveMergeCap + 1e-6;
  ok(worstReach <= lim, `merged waves stay bounded: biggest ${worstReach.toFixed(1)} m (limit ${lim.toFixed(1)} m)`);
  console.log(`     barrage: ${w.stats.posted} posted, ${w.stats.started} started, ${w.stats.merged} merged, ${w.stats.folded} folded`);
}

// 4. The draw: nothing live -> the bend mesh hidden (no frame copy); a wave -> quads drawn; everything dies out -> hidden again.
{
  const w = fresh();
  const d = new BlastWavesDraw(w, flat);
  const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 2000);
  cam.position.set(0, 30, 26); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  d.update(1 / 60, cam, null);
  ok(!d.bend.visible && !d.stats.copy && d.rings.count === 0, "no waves: the bend pass is off");
  w.post("mortar", 0, 0.5, 0, 3);
  d.update(1 / 60, cam, null);
  ok(d.bend.visible && d.stats.quads >= 2 && d.rings.count === 1, `a mortar blast: ${d.stats.quads} quads (rings and heat), ${d.rings.count} ground ring`);
  for (let i = 0; i < 400; i++) d.update(1 / 60, cam, null);
  ok(!d.bend.visible && !w.active, "after it dies out: the bend pass is off again");
  // Behind the camera: not drawn.
  w.post("rocket", 0, 0.5, 200, 3);
  d.update(1 / 60, cam, null);
  ok(d.stats.quads === 0, "a blast behind the camera draws nothing");
  // CPU cost of a full frame: the caps' worth of waves and puffs.
  for (let i = 0; i < 200; i++) w.post("mortar", Math.random() * 40 - 20, 0, Math.random() * 40 - 20, 3);
  for (let i = 0; i < 200; i++) w.puff(Math.random() * 40 - 20, 3, Math.random() * 40 - 20, 1, 0.05, 2);
  const t0 = performance.now(), N = 200;
  for (let i = 0; i < N; i++) { d.update(1 / 600, cam, null); }
  console.log(`     draw update with ${w.waves.length} waves, ${w.puffs.length} puffs: ${((performance.now() - t0) / N).toFixed(3)} ms CPU a frame (GPU unmeasured)`);
}

// 5. Every kind is posted from somewhere in the game (a blast or wave post with its name), so none goes unused.
{
  const files: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts") && !p.endsWith("blastWaves.ts")) files.push(p); } };
  walk("src");
  const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
  for (const k of WAVE_KIND_LIST) ok(all.includes(`"${k}"`), `kind ${k} is posted somewhere in src`);
  const bf = readFileSync("src/game/battlefield.ts", "utf8");
  ok(/blast\([^)]*kind: WaveKind[\s\S]{0,1200}this\.waves\.post\(kind/.test(bf), "Battlefield.blast posts its wave (every explosion goes through it)");
}

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log("\nblast waves: all ok");
