// The flamers' stream look (Keith 2026-11-05, rebuilt as burning fuel thrown under gravity; src/fx/flameFx.ts): things
// that must never happen.
// - Nothing sinks under the sand.
// - Fuel thrown at an aim inside the reach comes down near it (lobVy's arc), splashes (droplets) and burns on the sand.
// - Fuel thrown past the reach burns out in the air, about the reach out, and rises; little of it lands.
// - Flying fuel falls under gravity (never climbing late in its flight); burnt-out fireballs rise.
// - Smoke comes from fire burning down, and it rises.
// Run: npm test (or npx tsx tools/flamefx-check.ts).
import * as THREE from "three/webgpu";
import { FlameFx, lobVy, FLY, GROUND, RISE } from "../src/fx/flameFx";
import { FIRE_DEFAULTS as F } from "../src/weapons/fire/fireTuning";

// Seeded, so the counts don't wobble run to run (the look uses Math.random).
let rs = 12345;
Math.random = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
const fails: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
const cam = new THREE.PerspectiveCamera();
const flat = { height: () => 0 };
type Raw = { n: number; py: Float32Array; vy: Float32Array; kind: Uint8Array; st: Uint8Array; age: Float32Array };
const raw = (f: FlameFx) => f as unknown as Raw;
const RANGE = F.flamerRange, VH = F.flameSpeed * F.flameGobFast, BURN = RANGE / VH * F.flameBurnFor, Y0 = 3.5;
const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;

/** Pours at an aim `aimAt` m out along +Z on flat sand, as FireGuns throws it, for `pourFor` s of `secs`. */
function pour(aimAt: number, secs = 2.5, pourFor = 0.8) {
  const f = new FlameFx(flat); f.tune(F);
  const r = raw(f), dt = 1 / 60, landed: number[] = [], burnt: number[] = [];
  f.probe = (what, _x, _y, z) => (what === GROUND ? landed : burnt).push(z);
  let under = 0, climb = 0, drops = 0, riseUp = 0, riseN = 0, smoke = 0, smokeUp = 0;
  for (let t = 0; t < secs; t += dt) {
    if (t < pourFor) for (let k = 0; k < 4; k++) {
      const vh = VH * (0.93 + Math.random() * 0.14), dist = Math.min(aimAt, RANGE * F.flameLob);
      f.gob(0, Y0, 0, 0, lobVy(-Y0, dist, vh, F.flameGravity), vh, BURN * (0.85 + Math.random() * 0.3), F.flameSize, 0);
    }
    f.update(dt, cam);
    for (let i = 0; i < r.n; i++) {
      if (r.py[i] < -1e-3) under++;
      const k = r.kind[i];
      if (k === 4) drops++;
      if (k === 0 && r.st[i] === FLY && r.age[i] > 0.3 && r.vy[i] > 3) climb++;
      if (k === 0 && r.st[i] === RISE && r.age[i] > 0) { riseN++; if (r.vy[i] >= 0) riseUp++; }
      if (k === 3) { smoke++; if (r.vy[i] > 0) smokeUp++; }
    }
  }
  return { landed, burnt, under, climb, drops, riseUp, riseN, smoke, smokeUp };
}

const near = pour(12);
must(near.under === 0, `fire under the sand (${near.under})`);
must(near.landed.length > 40, `fuel aimed 12 m out hardly lands (${near.landed.length})`);
must(Math.abs(mean(near.landed) - 12) < 3, `fuel aimed 12 m out lands at ${mean(near.landed).toFixed(1)} m`);
must(near.burnt.length < near.landed.length * 0.2, `fuel aimed inside the reach burns out in the air (${near.burnt.length} vs ${near.landed.length} landed)`);
must(near.drops > 0, "no splash droplets where it lands");
must(near.climb === 0, `flying fuel climbing late in its flight (${near.climb} gob-frames)`);
must(near.smoke > 5 && near.smokeUp === near.smoke, `smoke: ${near.smoke}, ${near.smoke - near.smokeUp} sinking`);

const far = pour(60);
must(far.under === 0, `fire under the sand far out (${far.under})`);
must(far.burnt.length > far.landed.length, `fuel aimed past the reach lands instead of burning out (${far.landed.length} landed, ${far.burnt.length} burnt out)`);
must(Math.abs(mean(far.burnt) - RANGE) < RANGE * 0.4, `fuel burns out at ${mean(far.burnt).toFixed(1)} m (reach ${RANGE})`);
must(far.riseN > 0 && far.riseUp >= far.riseN * 0.95, `burnt-out fireballs don't rise (${far.riseUp} of ${far.riseN})`);

// The line (Keith 2026-11-05: one continuous line arcing out): fuel points poured from a nozzle along +Z.
function line(aimAt: number, secs = 2, pourFor = 1, pourEvery = 1, swing = 0) {
  const f = new FlameFx(flat); f.tune(F);
  const key = {}, dt = 1 / 60, ends: { land: number[]; burnout: number[] } = { land: [], burnout: [] };
  let gap = 0, worstN = 0, under = 0, joined = 0, points = 0, frame = 0;
  const vh = VH, dist = Math.min(aimAt, RANGE * F.flameLob);
  const orig = f.streams.step.bind(f.streams);
  f.streams.step = (d, G, drag, every, ground, end) => orig(d, G, drag, every, ground, (l, w, x, y, z, a, b, c) => { ends[w].push(z); end(l, w, x, y, z, a, b, c); });
  for (let t = 0; t < secs; t += dt) {
    if (t < pourFor && frame++ % pourEvery === 0) {
      // Swung: the aim's distance and side wander, so points land out of order.
      const d = dist * (1 + swing * Math.sin(t * 9)), a = swing * Math.sin(t * 5), vys = lobVy(-Y0, d, vh, F.flameGravity);
      f.pour(key, 0, Y0, 0, Math.sin(a) * vh, vys, Math.cos(a) * vh, BURN, 1);
    }
    f.update(dt, cam);
    for (const l of f.streams.lines.values()) {
      worstN = Math.max(worstN, l.n);
      for (let i = 0; i < l.n; i++) {
        if (l.py[i] < -1e-3) under++;
        // Drawn: in a run of two or more (a lone point between breaks draws nothing; the newest joins the nozzle).
        points++;
        const prevJoined = i > 0 && !l.brk[i], nextJoined = i + 1 < l.n ? !l.brk[i + 1] : l.pouring;
        if (prevJoined || nextJoined) joined++;
        if (i > 0 && !l.brk[i]) gap = Math.max(gap, Math.hypot(l.px[i] - l.px[i - 1], l.py[i] - l.py[i - 1], l.pz[i] - l.pz[i - 1]));
      }
    }
  }
  return { ...ends, gap, worstN, under, joined: joined / Math.max(1, points), left: f.streams.lines.size };
}
const ln = line(12), lf = line(60, 2.5);
must(ln.under === 0 && lf.under === 0, `line points under the sand (${ln.under}, ${lf.under})`);
must(ln.land.length > 20 && Math.abs(mean(ln.land) - 12) < 1.5, `line aimed 12 m lands at ${mean(ln.land).toFixed(1)} m (${ln.land.length} points)`);
must(ln.burnout.length === 0, `line aimed inside the reach burns out in the air (${ln.burnout.length})`);
must(lf.burnout.length > lf.land.length && Math.abs(mean(lf.burnout) - RANGE) < RANGE * 0.4, `line aimed 60 m: ${lf.land.length} landed, ${lf.burnout.length} burnt out at ${mean(lf.burnout).toFixed(1)} m (reach ${RANGE})`);
must(ln.gap < 1.2 && lf.gap < 1.2, `line has gaps between joined points (${ln.gap.toFixed(2)}, ${lf.gap.toFixed(2)} m)`);
// A gun pours on its shots, a few a second (the PC render, 2026-11-05: no line at all): the line stays joined.
const ls = line(12, 2, 1, 6);
must(ls.joined > 0.9 && ls.land.length > 20, `line poured only every 6th frame breaks up (${(ls.joined * 100).toFixed(0)}% joined, ${ls.land.length} landed)`);
// Swung (PC render 2026-11-05: a short stub stopped short of the fire): the line stays joined as points land out of order.
const lw = line(12, 2, 1, 1, 0.4);
must(lw.joined > 0.97, `swung line breaks into pieces (${(lw.joined * 100).toFixed(0)}% joined)`);
must(ln.left === 0 && lf.left === 0, `lines left over after they stopped (${ln.left}, ${lf.left})`);

console.log(`flamefx line: aimed 12 m lands at ${mean(ln.land).toFixed(1)} m (${ln.land.length} points, widest gap ${ln.gap.toFixed(2)} m, ${ln.worstN} points at most); aimed 60 m burns out at ${mean(lf.burnout).toFixed(1)} m`);
console.log(`flamefx: aimed 12 m: ${near.landed.length} landed at ${mean(near.landed).toFixed(1)} m, ${near.burnt.length} burnt out, ${near.drops} droplet-frames, ${near.smoke} smoke-frames; ` +
  `aimed 60 m: ${far.landed.length} landed, ${far.burnt.length} burnt out at ${mean(far.burnt).toFixed(1)} m (reach ${RANGE})`);
if (fails.length) { console.error("flamefx check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("flamefx check passed");
