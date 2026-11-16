// Swarms stepped in the sim worker, drawn on the game's clock (src/look/remoteInterp.ts; Keith 2026-11-16: robots
// jumpy on the phone). A robot walks at a steady 6 m/s in a simulated page: a 30 Hz clock, drawn frames at 60 fps whose
// tick frames cost the main thread a phone-like 8-15 ms (sometimes 30), worker answers 4-30 ms after their tick and
// taken only between frames (so they bunch). Checks, per load:
// - the drawn robot never moves backwards, and its drawn speed frame to frame stays near 6 m/s (no freezes, no jumps);
// - it is drawn at most a few ticks behind the sim;
// - every snapshot is kept, however they bunch.
// Also prints the old blend (timed on when snapshots were seen) on the same page, for comparing.
// Run: npm test (or npx tsx tools/remoteinterp-check.ts).
import { Clock } from "../src/core/clock";
import { RemoteInterp, REMOTE_INTERP } from "../src/look/remoteInterp";
if (process.env.RI) Object.assign(REMOTE_INTERP, JSON.parse(process.env.RI));

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };
const SPEED = 6;

interface Run { meanErr: number; worstErr: number; back: number; holds: number; lagTicks: number; spread: number }

function page(load: "pc" | "phone" | "bad", mode: "new" | "old", seed0 = 7): Run {
  let seed = seed0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const clock = new Clock(30);
  const px = new Float32Array(1), gen = new Uint8Array(1), state = new Uint8Array(1);
  const R = new RemoteInterp([{ a: px }], [gen, state]);
  // The old blend: two captures, alpha from the time since the newest was seen over the measured period.
  let oPrev = 0, oCur = 0, oN = 0, last = -1, at = 0, period = 1000 / 30, oldStamp = 0;
  let simX = 0, sent = 0, now = 0, lastMs = 1000 / 60;
  const inflight: { id: number; x: number; t: number }[] = [];
  const tickCost = load === "pc" ? [2, 4] : load === "phone" ? [8, 15] : [12, 30];
  const late = load === "pc" ? [2, 8] : load === "phone" ? [4, 30] : [10, 60];
  let prevDrawn = NaN, errs = 0, worst = 0, n = 0, back = 0, lagSum = 0;
  const speeds: number[] = [];
  for (let f = 0; f < 60 * 20; f++) {
    // Answers that are in by now land before this frame (messages run between frames).
    for (let k = 0; k < inflight.length; ) {
      const m = inflight[k];
      if (m.t <= now) {
        px[0] = m.x;
        if (mode === "new") R.capture(m.id, 1);
        oldStamp++;
        inflight.splice(k, 1);
      } else k++;
    }
    const t0 = now;
    const frameDt = Math.min(0.05, lastMs / 1000);
    let cost = 1;
    clock.run(frameDt, () => {
      simX += SPEED * clock.dt;
      sent++;
      cost += tickCost[0] + rnd() * (tickCost[1] - tickCost[0]) + (rnd() < 0.03 ? 15 : 0);
      inflight.push({ id: sent, x: simX, t: t0 + cost + late[0] + rnd() * (late[1] - late[0]) });
    });
    // Draw.
    let drawn: number;
    if (mode === "new") {
      R.apply(sent, clock.alpha, frameDt, 1);
      drawn = px[0];
      R.restore();
    } else {
      if (oldStamp !== last) {
        if (last >= 0) period += (Math.min(200, Math.max(8, now - at)) - period) * 0.2;
        last = oldStamp; at = now; oPrev = oCur; oCur = px[0]; oN++;
      }
      const a = Math.min(1, (now - at) / period);
      drawn = oN >= 2 ? oPrev + (oCur - oPrev) * a : px[0];
    }
    // The frame takes its tick cost, or the vsync frame if it's less.
    lastMs = Math.max(1000 / 60, cost);
    now += lastMs;
    if (f > 120 && Number.isFinite(prevDrawn)) {
      const v = (drawn - prevDrawn) / frameDt;
      speeds.push(v);
      const e = Math.abs(v - SPEED) / SPEED;
      errs += e; worst = Math.max(worst, e); n++;
      if (drawn < prevDrawn - 1e-6) back++;
      lagSum += (simX - drawn) / (SPEED * clock.dt);
    }
    prevDrawn = drawn;
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
  return { meanErr: errs / n, worstErr: worst, back, holds: R.holds, lagTicks: lagSum / n, spread: sd / SPEED };
}

// Each frame's clock step is the last frame's real time (as the app's is): what's judged is whether the robot's drawn
// steps follow the game's time, as everything else on the page does.
for (const load of ["pc", "phone", "bad"] as const) {
  const a = page(load, "new"), b = page(load, "old");
  const pc = (x: number) => `${(x * 100).toFixed(0)}%`;
  console.log(`  ${load}: new speed error mean ${pc(a.meanErr)} worst ${pc(a.worstErr)} spread ${pc(a.spread)}, ${a.back} back, ${a.holds} held frames, ${a.lagTicks.toFixed(2)} ticks behind · old mean ${pc(b.meanErr)} worst ${pc(b.worstErr)} spread ${pc(b.spread)}, ${b.back} back, ${b.lagTicks.toFixed(2)} ticks behind`);
  if (a.back) fail(`${load}: the robot was drawn moving backwards ${a.back} times`);
  if (a.meanErr > (load === "bad" ? 0.12 : 0.05)) fail(`${load}: drawn speed off by ${pc(a.meanErr)} on average`);
  if (load !== "bad" && a.worstErr > 0.7) fail(`${load}: a drawn frame's speed was off by ${pc(a.worstErr)}`);
  if (a.lagTicks > 4) fail(`${load}: drawn ${a.lagTicks.toFixed(2)} ticks behind the sim`);
  if (a.spread > b.spread) fail(`${load}: smoother before (spread ${pc(b.spread)} vs ${pc(a.spread)})`);
}

// Every snapshot kept: three landing at once are all there to blend through.
{
  const px = new Float32Array(1), key = new Uint8Array(1);
  const R = new RemoteInterp([{ a: px }], [key]);
  for (let id = 1; id <= 3; id++) { px[0] = id; R.capture(id, 1); }
  const seen: number[] = [];
  for (const t of [1.25, 1.5, 2.5]) { R.delay = 3 - t; (R as unknown as { peak: number }).peak = 3 - t; R.apply(3, 0, 0, 1); seen.push(px[0]); R.restore(); }
  if (seen.some((v, i) => Math.abs(v - [1.25, 1.5, 2.5][i]) > 1e-5)) fail(`bunched snapshots: drew ${seen.join(", ")}, want 1.25, 1.5, 2.5`);
  if (px[0] !== 3) fail("restore didn't put the newest back");
  // A slot whose key changed since (a death) shows what the arrays hold now.
  key[0] = 2; px[0] = 9; R.delay = 1; R.apply(3, 0, 0, 1);
  if (px[0] !== 9) fail(`a slot whose state changed was blended (drew ${px[0]})`);
  R.restore();
}

if (problems.length) { console.log(`remoteinterp-check: ${problems.length} problem(s)`); process.exit(1); }
console.log("remoteinterp-check: ok");
