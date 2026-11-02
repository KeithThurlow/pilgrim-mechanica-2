// Headless check of the red-hot sand (src/fx/groundHeat.ts): beams heat their line, the hotter the weapon the longer it
// glows, explosions glow briefly at most, it all cools away to an empty active list (an idle layer costs nothing),
// nothing far off aliases into the window, and a long diagonal beam touches only cells near it.
import { GroundHeat, HEAT_DEFAULTS } from "../src/fx/groundHeat";

let fails = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "ok  " : "FAIL"} ${msg}`); if (!c) fails++; };
const v = { ...HEAT_DEFAULTS };
const DT = 1 / 60;

/** Seconds a spot painted at `temp` stays above the glow threshold. */
function glowTime(temp: number, line = true) {
  const h = new GroundHeat(v);
  h.update(DT, 0, 0);
  if (line) h.line(-10, 0, 10, 0, 1, temp); else h.spot(0, 0, 1.5, temp);
  let t = 0;
  while (h.at(0.1, 0.1) > v.heatGlowFrom && t < 120) { h.update(DT, 0, 0); t += DT; }
  return t;
}

// 1. A beam heats its line, and not far off it.
{
  const h = new GroundHeat(v);
  h.update(DT, 0, 0);
  h.line(-20, -5, 20, 5, 0.8, v.heatBeam);
  const mid = h.at(0, 0), off = h.at(0, 4);
  ok(mid > v.heatBeam * 0.85, `beam line at its middle ${mid.toFixed(0)}° (beam ${v.heatBeam}°)`);
  ok(off === 0, `4 m off the line ${off.toFixed(0)}°`);
  ok(h.charAt(0, 0) > 0.2, `beam fuses the sand (char ${h.charAt(0, 0).toFixed(2)})`);
  // Cells touched: a 41 m line 1.6 m wide is about 41 × 1.6 / 0.41² ≈ 400 cells; far fewer than its bounding box.
  ok(h.active.length < 800, `long diagonal beam touched ${h.active.length} cells (bounding box would be ~${Math.round((40 / h.cell) * (10 / h.cell))})`);
}

// 2. Hotter weapons glow longer; explosions briefly or not at all.
{
  const strider = glowTime(v.heatStrider), beam = glowTime(v.heatBeam), rail = glowTime(v.heatRail, false), ign = glowTime(v.heatIgnited, false), blast = glowTime(v.heatBlast, false);
  console.log(`     glow time: strider ${strider.toFixed(1)} s, excavator beam ${beam.toFixed(1)} s, rail ${rail.toFixed(1)} s, ignited ${ign.toFixed(1)} s, blast ${blast.toFixed(1)} s`);
  ok(strider > beam && beam > rail && rail > ign && ign >= blast, "the hotter the weapon, the longer the sand glows");
  ok(beam > 1.5 && beam < 6, `excavator beam glows ${beam.toFixed(1)} s (1.5..6; Keith 2026-11-02: fade almost at once)`);
  ok(blast < 1.5, `an explosion glows ${blast.toFixed(1)} s at most (under 1.5)`);
}

// 3. Dwell: a beam held on the sand heats it over heatRise, not at once; held long it reaches the beam's heat.
{
  const h = new GroundHeat(v);
  h.update(DT, 0, 0);
  h.spot(0, 0, 1, v.heatBeam, DT);
  const first = h.at(0.1, 0.1);
  for (let k = 0; k < 60; k++) h.spot(0, 0, 1, v.heatBeam, DT);
  const held = h.at(0.1, 0.1);
  ok(first < v.heatBeam * 0.4, `one tick of a held beam: ${first.toFixed(0)}°`);
  ok(held > v.heatBeam * 0.85, `held a second: ${held.toFixed(0)}°`);
}

// 4. Everything cools away; the active list empties and the bytes go back to zero.
{
  const h = new GroundHeat(v);
  h.update(DT, 0, 0);
  h.line(-10, 0, 10, 0, 1, v.heatStrider);
  for (let i = 0; i < 300; i++) h.spot((i % 40) - 20, ((i * 7) % 30) - 15, 0.3, v.heatIgnited);
  let t = 0;
  while (h.active.length && t < 600) { h.update(0.1, 0, 0); t += 0.1; }
  let sum = 0;
  for (let i = 0; i < h.bytes.length; i += 4) sum += h.bytes[i] + h.bytes[i + 1];
  ok(h.active.length === 0, `cooled away after ${t.toFixed(0)} s (char life ${v.heatCharLife} s)`);
  ok(sum === 0, `texture bytes back to zero (${sum})`);
  const ver = h.version;
  for (let i = 0; i < 30; i++) h.update(DT, 0, 0);
  ok(h.version === ver, "an idle layer doesn't re-upload");
}

// 5. Following the focus clears what left the window, so a far cell never shows through the wrap; far paint is ignored.
{
  const h = new GroundHeat(v);
  h.update(DT, 0, 0);
  h.spot(30, 0, 2, v.heatBeam);
  ok(h.at(30, 0) > 1000, "hot spot 30 m east");
  h.update(DT, 100, 0); // focus moves 100 m east: x = 30 is now 70 m behind, outside the 104 m window's 52 m half
  ok(h.at(30, 0) === 0, "cleared once it left the window");
  ok(h.at(30 + h.area, 0) === 0, "and doesn't alias one window over");
  h.spot(400, 400, 2, v.heatBeam);
  ok(h.at(400, 400) === 0 && h.stats.painted === 0, "paint far outside the window is ignored");
}

// 6. Off means off.
{
  const h = new GroundHeat({ ...v, heatOn: 0 });
  h.update(DT, 0, 0);
  h.line(-5, 0, 5, 0, 1, 2000);
  ok(h.active.length === 0, "heatOn 0 paints nothing");
}

// 7. Cost: a big fight's worth of paint and cooling.
{
  const h = new GroundHeat(v);
  h.update(DT, 0, 0);
  const t0 = performance.now();
  for (let f = 0; f < 120; f++) {
    for (let b = 0; b < 4; b++) h.line(-40 + b * 5, -30, -30 + b * 20, 30, 0.8, v.heatBeam, DT);
    for (let r = 0; r < 30; r++) h.spot(Math.sin(f + r) * 30, Math.cos(f * 1.3 + r) * 30, 0.3, v.heatIgnited);
    h.update(DT, 0, 0);
  }
  const ms = (performance.now() - t0) / 120;
  ok(ms < 1.5, `4 sweeping beams + 30 ignited hits a frame: ${ms.toFixed(2)} ms/frame, ${h.stats.active} cells warm`);
}

// 8. Night light: glowing sand gathers into a few patches along the line; none once it stops glowing.
{
  const h = new GroundHeat(v);
  h.update(DT, 0, 0);
  h.line(-20, 0, 20, 0, 0.5, v.heatBeam);
  h.update(DT, 0, 0);
  const out = new Float32Array(5 * 16);
  const n = h.lights(out);
  let near = true, pow = 0;
  for (let k = 0; k < n; k++) { if (Math.abs(out[k * 5 + 1]) > 1 || Math.abs(out[k * 5]) > 21) near = false; pow += out[k * 5 + 2]; }
  ok(n > 0 && n <= v.heatLights, `a 40 m beam trail asks for ${n} lights (at most ${v.heatLights})`);
  ok(near, "each light sits on the trail");
  console.log(`     glowing area ${pow.toFixed(1)} m² of full glow → ${(pow * v.heatLight / Math.max(1, n)).toFixed(0)} power per light`);
  let t = 0;
  while (h.lights(out) > 0 && t < 60) { h.update(0.1, 0, 0); t += 0.1; }
  ok(t > 1.5 && t < 6, `lights go out with the glow, after ${t.toFixed(1)} s`);
  const g = new GroundHeat(v); g.update(DT, 0, 0);
  for (let b = 0; b < 4; b++) g.line(-40 + b * 5, -30, -30 + b * 20, 30, 0.8, v.heatBeam);
  g.update(DT, 0, 0);
  const t0 = performance.now();
  for (let k = 0; k < 100; k++) g.lights(out);
  ok((performance.now() - t0) / 100 < 0.5, `gathering 4 beams' glow: ${((performance.now() - t0) / 100).toFixed(3)} ms`);
}

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log("heat check passed");
