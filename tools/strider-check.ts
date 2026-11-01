// Headless strider check (src/combat/strider.ts): a strider walks in over the tall dunes on the mech's walker rig
// scaled up, toward a prey that circles, then the prey stands next to it. Fails on NaN, planted feet off the sand,
// legs out of reach, the hips sagging or floating, no footfalls, never closing to its range, no beam (and a beam
// line that doesn't reach past the aim), no slam once the prey is close, the slam not centred under it, a beam within
// 2 s after a slam, or two runs with the same seed not matching. Prints the numbers: height, stride, cadence, speed.
// Run: npm test (or npx tsx tools/strider-check.ts).
import { Vector3 } from "three";
import { Striders, STRIDER_DEFAULTS, STRIDER_FRAME, striderWalker, type StriderEvent } from "../src/combat/strider";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const dt = 1 / 60;

function run(seed: number) {
  const v = { ...STRIDER_DEFAULTS };
  const pack = new Striders(v, field, seed);
  const s = pack.spawn(140, 30, -Math.PI / 2);
  const W = striderWalker(v), S = v.striderScale, reach = W.femur + W.shin + W.cannon;
  const log: string[] = [];
  const ev: StriderEvent[] = [];
  pack.onEvent = (e) => { ev.push(e); log.push(`${e.type}@${s.modeT.toFixed(3)}:${s.pos().x.toFixed(3)}`); };
  const stats = { nan: 0, footOff: 0, footWorst: 0, reachOver: 0, sagLow: 1e9, sagHigh: 0, closest: 1e9, falls: 0, dist: 0, steps: 0 };
  let t = 0, lastSlam = -1e9, beamAfterSlam = 0;
  const prey = { x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: true };
  const sees = () => true;
  const P = new Vector3(), prev = s.pos(new Vector3());
  for (; t < 70; t += dt) {
    // Phase 1 (to 50 s): the prey circles slowly 20 m round the origin. Phase 2: it stands 8 m from the strider.
    if (t < 50) { const a = t * 0.08; prey.x = Math.sin(a) * 20; prey.z = Math.cos(a) * 20; prey.vx = Math.cos(a) * 1.6; prey.vz = -Math.sin(a) * 1.6; }
    else if (t - dt < 50) { const p = s.pos(P); prey.x = p.x + 8; prey.z = p.z; prey.vx = prey.vz = 0; s.slamClock = 0; }
    prey.y = field.height(prey.x, prey.z) + 2;
    const n0 = ev.length;
    pack.update(dt, prey, sees);
    for (let k = n0; k < ev.length; k++) {
      const e = ev[k];
      if (e.type === "footfall") stats.falls++;
      if (e.type === "slam") {
        lastSlam = t;
        const p = s.pos(P);
        if (Math.hypot(e.x - p.x, e.z - p.z) > 3) fail(`slam ${Math.hypot(e.x - p.x, e.z - p.z).toFixed(1)} m off its feet`);
      }
      if (e.type === "beam") {
        if (t - lastSlam < 2) beamAfterSlam++;
        const b = e.beam;
        const run = Math.hypot(b.end.x - b.start.x, b.end.z - b.start.z);
        if (run < v.striderBeamRun) fail(`beam furrow only ${run.toFixed(1)} m`);
        { const up = b.from.y - field.height(b.from.x, b.from.z); if (!(up > 5)) fail(`beam emitter only ${up.toFixed(1)} m up`); }
      }
    }
    const sim = s.sim, p = s.pos(P);
    if (!Number.isFinite(p.x + p.z + sim.pelvis.y)) { stats.nan++; break; }
    stats.dist += Math.hypot(p.x - prev.x, p.z - prev.z); prev.copy(p);
    stats.steps++;
    if (t < 50) stats.closest = Math.min(stats.closest, Math.hypot(prey.x - p.x, prey.z - p.z));
    const gy = field.height(p.x, p.z) / S;
    const lift = sim.pelvis.y - gy;
    stats.sagLow = Math.min(stats.sagLow, lift); stats.sagHigh = Math.max(stats.sagHigh, lift);
    for (const f of sim.feet) {
      const L = f.pose.hip.distanceTo(f.pose.ankle);
      if (L > reach * 1.01) { stats.reachOver++; }
      if (!f.swinging && f.stanceT > 0.1 && f.stanceT < 0.9) {
        const off = Math.abs(f.planted.y * S - field.height(f.planted.x * S, f.planted.z * S));
        stats.footWorst = Math.max(stats.footWorst, off);
        if (off > 0.25 * S) stats.footOff++;
      }
    }
  }
  return { s, pack, stats, log, beamAfterSlam, S, W };
}

const a = run(3);
const aLog = [...a.log];
const { s, pack, stats, S, W } = a;
const top = (W.hipHeight + STRIDER_FRAME.head + STRIDER_FRAME.headH / 2) * S;
const falls = stats.falls / (70);
console.log(`strider: scale ${S}, hips ${(W.hipHeight * S).toFixed(1)} m, head top ${top.toFixed(1)} m · walked ${stats.dist.toFixed(0)} m (${(stats.dist / 70).toFixed(2)} m/s avg) · ${falls.toFixed(2)} footfalls/s · closest ${stats.closest.toFixed(1)} m (range ${STRIDER_DEFAULTS.striderRange})`);
console.log(`  hips over the ground ${(stats.sagLow * S).toFixed(2)}–${(stats.sagHigh * S).toFixed(2)} m · planted foot worst ${stats.footWorst.toFixed(2)} m · beams ${pack.beams} · slams ${pack.slams} · health ${s.health}`);
// Keith 2026-11-01: long arms that nearly touch the ground (hands within 2.5 m of the sand, standing).
{
  const h = s.hand(1), gap = h.y - field.height(h.x, h.z);
  console.log(`  hand ${gap.toFixed(2)} m over the sand · arms ${((STRIDER_FRAME.upperArm + STRIDER_FRAME.foreArm) * S).toFixed(1)} m · shoulders ${(STRIDER_FRAME.shoulderX * 2 * S).toFixed(1)} m wide`);
  if (gap > 2.5 || gap < -0.3) fail(`hands ${gap.toFixed(2)} m over the sand`);
}
if (stats.nan) fail("NaN");
if (stats.reachOver) fail(`legs out of reach on ${stats.reachOver} samples`);
if (stats.footOff > stats.steps * 0.01) fail(`planted feet off the sand on ${stats.footOff} samples (worst ${stats.footWorst.toFixed(2)} m)`);
if (stats.sagLow < W.hipHeight * 0.6) fail(`hips sag to ${(stats.sagLow * S).toFixed(1)} m`);
if (stats.sagHigh > W.hipHeight * 1.25) fail(`hips float at ${(stats.sagHigh * S).toFixed(1)} m`);
if (stats.falls < 20) fail(`only ${stats.falls} footfalls`);
if (stats.closest > STRIDER_DEFAULTS.striderRange + 20) fail(`never closed in (closest ${stats.closest.toFixed(1)} m)`);
if (pack.beams < 2) fail(`only ${pack.beams} beams`);
if (pack.slams < 1) fail("no slam with the prey close");
if (a.beamAfterSlam) fail(`${a.beamAfterSlam} beams within 2 s of a slam`);
// Damage: a kill takes its hull, and the down event fires once.
pack.hit(s, s.health + 1);
pack.hit(s, 100);
if (s.alive || pack.kills !== 1) fail(`kill: alive ${s.alive}, kills ${pack.kills}`);
// Same seed, same run.
const b = run(3);
{ const k = aLog.findIndex((x, i) => x !== b.log[i]); if (k >= 0 || aLog.length !== b.log.length) fail(`two runs with the same seed differ at event ${k}: ${aLog[k]} vs ${b.log[k]} (${aLog.length}/${b.log.length} events)`); }
const c = run(4);
if (aLog.join("|") === c.log.join("|")) console.log("note: seeds 3 and 4 ran the same (fine, just unusual)");
if (failed) { console.log("strider check FAILED"); process.exit(1); }
console.log("strider check passed");
