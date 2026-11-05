// The flame stream's solid look (Keith 2026-11-05; src/fx/flameFx.ts, flameBlobs.ts): things that must never happen.
// - Gobs never sink under the sand; lit ones that land burn on for a while and slide on.
// - Fire on the sand is a swarm (Keith 2026-11-05): it keeps on in the fire's direction, past the aim, swerving round
//   burning things (fewer on top of one than with nothing there) and between two close together; it never turns back
//   onto them; frost the same.
// - Lit flames throw smoke, and smoke rises.
// - The blobs and cones stay inside their pools.
// Run: npm test (or npx tsx tools/flamefx-check.ts).
import * as THREE from "three/webgpu";
import { FlameFx, type FlowGoal } from "../src/fx/flameFx";
import { BLOB_MAX } from "../src/fx/flameBlobs";
import { FIRE_DEFAULTS as F } from "../src/weapons/fire/fireTuning";

// Seeded, so the counts don't wobble run to run (the look uses Math.random).
let rs = 12345;
Math.random = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
const fails: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
const cam = new THREE.PerspectiveCamera();
const slope = { height: (x: number, z: number) => 0.05 * x + 0.02 * z };
const flat = { height: () => 0 };

type Raw = { n: number; px: Float32Array; py: Float32Array; pz: Float32Array; kind: Uint8Array; onG: Float32Array; vy: Float32Array; vz: Float32Array };
const raw = (f: FlameFx) => f as unknown as Raw;

/** Pours a stream along +Z from 1.5 m up for `pour` s, burning things at `att`, then runs on to `total` s. */
function run(ground: { height(x: number, z: number): number }, att: [number, number][], pour = 1, total = 2.2, goal: FlowGoal | null = null, cold = false) {
  const f = new FlameFx(ground);
  f.tune(F);
  const dt = 1 / 60;
  let under = 0, maxBlobs = 0, landed = 0;
  for (let t = 0; t < total; t += dt) {
    if (t < pour) for (let k = 0; k < 6; k++) {
      const a = (Math.random() - 0.5) * 0.12;
      f.gob(0, 3, 0, Math.sin(a) * 26, -4.5, Math.cos(a) * 26, 1.1, 0.55, 3.2, 0.05, cold, goal);
    }
    for (const [x, z] of att) f.attract(x, 1, z);
    f.update(dt, cam);
    const r = raw(f);
    for (let i = 0; i < r.n; i++) {
      if (r.py[i] < ground.height(r.px[i], r.pz[i]) - 1e-3) under++;
      if (r.kind[i] === 0 && r.onG[i] >= 0) landed++;
    }
    maxBlobs = Math.max(maxBlobs, (f.blobs as unknown as { blobs: THREE.InstancedMesh }).blobs.count);
  }
  return { f, under, maxBlobs, landed };
}

/** Mean distance of grounded gobs from (x, z), and how many are within `r`. */
function near(f: FlameFx, x: number, z: number, r: number) {
  const g = raw(f);
  let sum = 0, n = 0, inR = 0;
  for (let i = 0; i < g.n; i++) if (g.kind[i] === 0 && g.onG[i] >= 0) { const d = Math.hypot(g.px[i] - x, g.pz[i] - z); sum += d; n++; if (d < r) inR++; }
  return { mean: n ? sum / n : Infinity, n, inR };
}

const free = run(flat, [], 1, 1.6);
must(free.under === 0, `gobs under the sand (${free.under})`);
must(free.landed > 0, "no lit gob ever landed");
must(free.maxBlobs > 0 && free.maxBlobs <= BLOB_MAX, `blobs drawn ${free.maxBlobs}`);
const slid = run(slope, [], 1, 1.6);
must(slid.under === 0, `gobs under a slope (${slid.under})`);

// The swarm: fire on the sand flows on along the stream's line, round a burning thing in its way and on; frost the same.
const G: FlowGoal = { x: 0, z: 18, nx: 0, nz: 1 };
const meanZ = (f: FlameFx) => { const g = raw(f); let s = 0, n = 0; for (let i = 0; i < g.n; i++) if (g.kind[i] === 0 && g.onG[i] >= 0) { s += g.pz[i]; n++; } return n ? s / n : -1; };
const noGoal = meanZ(run(flat, [], 1, 2).f), toGoal = meanZ(run(flat, [], 1, 2, G).f);
const frostFree = meanZ(run(flat, [], 1, 2, null, true).f), frost = meanZ(run(flat, [], 1, 2, G, true).f);
must(toGoal > noGoal + 1, `fire doesn't flow on to the aim's plane (mean ${toGoal.toFixed(2)} vs ${noGoal.toFixed(2)} m out)`);
must(frost > frostFree + 1, `frost doesn't flow on to the aim's plane (mean ${frost.toFixed(2)} vs ${frostFree.toFixed(2)} m out)`);
const O: [number, number] = [0, 12.5], rIn = 0.7;
const blocked = run(flat, [O], 1, 2, G).f, open = run(flat, [], 1, 2, G).f;
const inO = near(blocked, ...O, rIn).inR, ringIn = near(open, ...O, rIn).inR;
const past = (() => { const g = raw(blocked); let n = 0; for (let i = 0; i < g.n; i++) if (g.kind[i] === 0 && g.onG[i] >= 0 && g.pz[i] > O[1] + 1) n++; return n; })();
// Never back: no gob on the sand heads back toward the shooter (the old pull dragged them back onto what burned).
const back = (() => { const g = raw(blocked) as Raw & { vz: Float32Array }; let n = 0, all = 0; for (let i = 0; i < g.n; i++) if (g.kind[i] === 0 && g.onG[i] >= 0) { all++; if (g.vz[i] < -0.5) n++; } return { n, all }; })();
must(back.n <= back.all * 0.02, `fire turns back (${back.n} of ${back.all} heading back)`);
must(past > 0, "fire doesn't flow on past a burning thing in its way");
must(inO < ringIn, `fire runs through a burning thing (${inO} inside vs ${ringIn} with nothing there)`);
// Two burning things 3 m apart across its way: it flows between them (and on), not only round the outside.
const A: [number, number] = [1.5, 12.5], B: [number, number] = [-1.5, 12.5];
const between = (() => { const g = raw(run(flat, [A, B], 1, 2, G).f); let n = 0; for (let i = 0; i < g.n; i++) if (g.kind[i] === 0 && g.onG[i] >= 0 && Math.abs(g.px[i]) < 0.8 && g.pz[i] > 12.5) n++; return n; })();
must(between > 0, "fire doesn't flow between two burning things");
console.log(`flamefx swarm: ${between} between and past a pair;`);
console.log(`flamefx swarm: mean out ${noGoal.toFixed(1)} → ${toGoal.toFixed(1)} m (frost ${frostFree.toFixed(1)} → ${frost.toFixed(1)}), plane at ${G.z}; inside a burning thing ${ringIn} → ${inO}, ${past} flowed past it`);

// Smoke: lit flames throw it, and it rises.
{
  const { f } = run(flat, [], 1, 1.4), g = raw(f);
  let n = 0, up = 0;
  for (let i = 0; i < g.n; i++) if (g.kind[i] === 3) { n++; if (g.vy[i] > 0) up++; }
  must(n > 5, `too little smoke (${n})`);
  must(up === n, `smoke sinking (${n - up} of ${n})`);
}

console.log(`flamefx: landed ${free.landed} gob-frames, blobs ≤${free.maxBlobs}; ${back.n}/${back.all} heading back`);
if (fails.length) { console.error("flamefx check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("flamefx check passed");
