// What the dearest ticks are made of (perf, 2026-11-16): a CPU profile of the page over a stretch of a lab, and for
// every frame whose ticks took over SPIKE ms (default 20), the functions that ran in it (inclusive ms per spike).
// The dev server must be running. Usage: node tools/perf-spikes.mjs "<path?flags>" [wait s] [measure s] [rows]
//   e.g. FIRE=1 node tools/perf-spikes.mjs "labs/convoy/?siege=80&manual&lite=1&norender" 15 40
// A frame's spike is found by a 1 ms busy marker (__spikeMark) run by the next frame; the samples between the end of
// the marker before it and this marker, back as far as the spike lasted, are the spike's. Env as tools/perf-profile.mjs.
import { chromium } from "playwright";

const url = process.argv[2] || "labs/convoy/?siege=80&manual&lite=1&norender";
const wait = Number(process.argv[3] || 15), dur = Number(process.argv[4] || 30), rows = Number(process.argv[5] || 40);
const SPIKE = Number(process.env.SPIKE || 20);
const base = process.env.BASE || "http://localhost:5173/";
const [vw, vh] = (process.env.VIEW || "844x390").split("x").map(Number);
const b = await chromium.launch({
  headless: !process.env.HEADED,
  args: process.env.HEADED ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});
const p = await b.newPage({ viewport: { width: vw, height: vh } });
p.on("pageerror", (e) => console.log("pageerror", e.message));
const c = await p.context().newCDPSession(p);
await p.goto(base + url);
await p.waitForFunction(() => window.__hud && window.__app, null, { timeout: 180000 });
if (process.env.FIRE) { await p.mouse.move(vw / 2, vh / 2); await p.mouse.down({ button: "left" }); await p.mouse.down({ button: "right" }); }
for (const k of (process.env.KEYS || "").split(",").filter(Boolean)) await p.keyboard.down(k);
await p.waitForTimeout(wait * 1000);
await c.send("Profiler.enable"); await c.send("Profiler.setSamplingInterval", { interval: 200 }); await c.send("Profiler.start");
await p.evaluate((th) => {
  window.__spikes = [];
  const f = function __spikeLoop() {
    const l = window.__app.last;
    if (l.tick > th) {
      window.__spikes.push(l.tick);
      (function __spikeMark() { const e = performance.now() + 1; while (performance.now() < e) { /* marker */ } })();
    }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}, SPIKE);
await p.waitForTimeout(dur * 1000);
const { profile } = await c.send("Profiler.stop");
const spikes = await p.evaluate(() => window.__spikes);

const byId = new Map(), parent = new Map();
for (const n of profile.nodes) byId.set(n.id, n);
for (const n of profile.nodes) for (const ch of n.children || []) parent.set(ch, n.id);
const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/").split("?")[0]}:${n.callFrame.lineNumber + 1}`;
const ts = [];
let t = profile.startTime;
for (let i = 0; i < profile.samples.length; i++) { t += profile.timeDeltas[i] || 0; ts.push(t); }
const isMark = (id) => { for (let cur = id; cur !== undefined; cur = parent.get(cur)) if (byId.get(cur).callFrame.functionName === "__spikeMark") return true; return false; };
// Marker runs: consecutive marker samples.
const marks = [];
for (let i = 0; i < ts.length; i++) if (isMark(profile.samples[i]) && (i === 0 || !isMark(profile.samples[i - 1]))) marks.push(i);
const all = new Map(), dtOf = (i) => (i + 1 < ts.length ? ts[i + 1] - ts[i] : 0);
console.log(`${spikes.length} frames over ${SPIKE} ms in ${dur} s (${marks.length} marked): ${spikes.map((x) => x.toFixed(0)).join(" ")}`);
let prevEnd = 0;
for (let m = 0; m < marks.length; m++) {
  const i0 = marks[m], lim = ts[i0] - (spikes[m] ?? 40) * 1000 - 3000;
  const own = new Map();
  for (let i = i0 - 1; i >= prevEnd && ts[i] >= lim; i--) {
    const id = profile.samples[i], n = byId.get(id);
    if (n.callFrame.functionName === "(idle)" || n.callFrame.functionName === "(program)") continue;
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (seen.has(k)) continue; seen.add(k); own.set(k, (own.get(k) || 0) + dtOf(i)); all.set(k, (all.get(k) || 0) + dtOf(i)); }
  }
  let j = i0; while (j < ts.length && isMark(profile.samples[j])) j++; prevEnd = j;
  const top = [...own].filter(([k]) => !/^\(root\)|__spikeLoop|^\(anon\) core\/app/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.PER || 8));
  console.log(`\n-- spike ${m + 1}: ${(spikes[m] ?? 0).toFixed(1)} ms\n` + top.map(([k, v]) => `${(v / 1e3).toFixed(1).padStart(6)}  ${k}`).join("\n"));
}
console.log(`\n== all spikes together, ms inclusive ==\n` + [...all].filter(([k]) => !/^\(root\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, rows).map(([k, v]) => `${(v / 1e3).toFixed(1).padStart(7)}  ${k}`).join("\n"));
await b.close();
