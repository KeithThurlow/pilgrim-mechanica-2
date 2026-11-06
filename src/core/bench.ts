// An A/B frame-time bench (Keith 2026-11-06: judging the sim worker by eye on a scene that plays out differently every
// time is no test). `?bench` on a lab that calls runBench: the same page is played once per variant (here: with the sim
// worker and with ?noworker), each at a fixed time step so every run simulates the same frames, warmed up and then
// measured; the page reloads itself between runs and at the end shows the numbers side by side (and copies them).
// Results are kept in sessionStorage between the reloads, and also in window.__bench.
import type { FrameHud } from "./hud";

export const BENCH_DEFAULTS = { benchWarm: 8, benchMeasure: 30 };

interface Run { label: string; frames: number[]; sim: number; draw: number; stages: Record<string, number> }
const KEY = "pm2-bench";

/**
 * variants: the extra URL flags of each run, in order (e.g. ["", "noworker"]). Call once at start-up; does nothing
 * without ?bench. warm and measure: seconds of the run's simulated time (dt × frames).
 */
export function runBench(hud: FrameHud, variants: { label: string; flag: string }[], opt: { warm?: number; measure?: number; dt?: number } = {}) {
  const url = new URL(location.href), q = url.searchParams;
  if (!q.has("bench")) return;
  const i = Math.max(0, Number(q.get("bench")) || 0);
  const dt = opt.dt ?? 1 / 120;
  // Every run at the same fixed step, so each simulates the same frames whatever the frame rate.
  // And with this run's flags only (a page opened with ?noworker&bench still starts with the worker).
  const want = variants[i]?.flag ?? "";
  let fix = !q.has("dt");
  for (const v of variants) if (v.flag && v.flag !== want && q.has(v.flag)) { q.delete(v.flag); fix = true; }
  if (want && !q.has(want)) { q.set(want, ""); fix = true; }
  if (fix) { if (!q.has("dt")) q.set("dt", String(dt)); location.replace(url.toString().replace(/=(?=&|$)/g, "")); return; }
  const step = Number(q.get("dt")) || dt;
  // ?benchtime=warm,measure (simulated seconds) to change the lengths.
  const bt = (q.get("benchtime") ?? "").split(",").map(Number);
  const warmN = Math.round((bt[0] || opt.warm || BENCH_DEFAULTS.benchWarm) / step), measureN = Math.round((bt[1] || opt.measure || BENCH_DEFAULTS.benchMeasure) / step);
  let results: Run[] = [];
  try { results = i === 0 ? [] : JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { results = []; }
  const run: Run = { label: variants[i]?.label ?? `run ${i}`, frames: [], sim: 0, draw: 0, stages: {} };
  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:50;background:#000c;color:#fff;font:13px/1.4 monospace;padding:8px 12px;border-radius:6px;white-space:pre";
  document.body.appendChild(banner);
  let n = 0;
  hud.onFrame.push((ms, sim, draw, stages) => {
    n++;
    if (n <= warmN) { banner.textContent = `bench ${i + 1}/${variants.length} (${run.label}): warming up ${Math.round((100 * n) / warmN)}%`; return; }
    if (run.frames.length >= measureN) return;
    run.frames.push(ms); run.sim += sim; run.draw += draw;
    if (stages) for (const [k, v] of stages) run.stages[k] = (run.stages[k] ?? 0) + v;
    banner.textContent = `bench ${i + 1}/${variants.length} (${run.label}): measuring ${Math.round((100 * run.frames.length) / measureN)}%`;
    if (run.frames.length < measureN) return;
    results.push(run);
    try { sessionStorage.setItem(KEY, JSON.stringify(results)); } catch { /* private window: one run only */ }
    const next = variants[i + 1];
    if (next) {
      for (const v of variants) if (v.flag) q.delete(v.flag);
      if (next.flag) q.set(next.flag, "");
      q.set("bench", String(i + 1));
      location.replace(url.toString().replace(/=(?=&|$)/g, ""));
      return;
    }
    show(banner, results, step);
  });
}

function summary(r: Run) {
  const f = [...r.frames].sort((a, b) => a - b), N = Math.max(1, f.length);
  const avg = f.reduce((a, b) => a + b, 0) / N, p95 = f[Math.floor(0.95 * (N - 1))] ?? 0, worst = f[N - 1] ?? 0;
  const stages = Object.entries(r.stages).map(([k, v]) => [k, v / N] as [string, number]).sort((a, b) => b[1] - a[1]);
  return { avg, p95, worst, sim: r.sim / N, draw: r.draw / N, stages };
}

function show(el: HTMLElement, results: Run[], step: number) {
  const S = results.map((r) => ({ label: r.label, ...summary(r) }));
  const pad = (s: string, w: number) => s.padEnd(w);
  const col = (f: (s: (typeof S)[number]) => number) => S.map((s) => pad(f(s).toFixed(2), 12)).join("");
  const keys = [...new Set(S.flatMap((s) => s.stages.slice(0, 10).map(([k]) => k)))];
  const lines = [
    `bench: ${location.pathname} ${location.search} · fixed step ${(step * 1000).toFixed(2)} ms · ${results[0]?.frames.length ?? 0} frames each`,
    pad("", 24) + S.map((s) => pad(s.label, 12)).join(""),
    pad("frame avg ms", 24) + col((s) => s.avg),
    pad("frame p95", 24) + col((s) => s.p95),
    pad("frame worst", 24) + col((s) => s.worst),
    pad("tick (sim) ms", 24) + col((s) => s.sim),
    pad("submit ms", 24) + col((s) => s.draw),
    pad("gpu/wait ms", 24) + col((s) => Math.max(0, s.avg - s.sim - s.draw)),
    "cpu stages (ms a frame):",
    ...keys.map((k) => pad("  " + k, 24) + S.map((s) => pad((s.stages.find((x) => x[0] === k)?.[1] ?? 0).toFixed(2), 12)).join("")),
  ];
  const text = lines.join("\n");
  (window as unknown as { __bench: string }).__bench = text;
  console.log(text);
  el.textContent = text + "\n\n(click to copy)";
  el.style.cursor = "pointer";
  el.style.pointerEvents = "auto";
  el.onclick = () => { navigator.clipboard?.writeText(text).then(() => { el.textContent = text + "\n\ncopied: paste it to Claude"; }).catch(() => {}); };
  navigator.clipboard?.writeText(text).catch(() => { /* needs a click: the banner copies */ });
}
