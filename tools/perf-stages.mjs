// The HUD's stage costs averaged over a stretch of a lab (perf, 2026-11-13): no profiler attached, so the numbers
// are the game's own. The dev server (or a preview of a build) must be running.
// Usage: node tools/perf-stages.mjs "<path?flags>" [wait s] [measure s]
//   e.g. node tools/perf-stages.mjs "labs/convoy/?siege=80&manual&lite=1&norender&dt=0.0333" 20 30
// Env as tools/perf-profile.mjs: THROTTLE, FIRE, KEYS, VIEW, BASE, CHROME, HEADED.
// Prints the mean and the worst of the frame's sim and submit, then every stage's mean ms a frame (window.__costs).
import { chromium } from "playwright";

const url = process.argv[2] || "labs/convoy/?siege&manual";
const wait = Number(process.argv[3] || 20), dur = Number(process.argv[4] || 30);
const base = process.env.BASE || "http://localhost:5173/";
const [vw, vh] = (process.env.VIEW || "844x390").split("x").map(Number);
const b = await chromium.launch({
  headless: !process.env.HEADED,
  args: process.env.HEADED ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});
const p = await b.newPage({ viewport: { width: vw, height: vh } });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.goto(base + url);
await p.waitForFunction(() => window.__hud && window.__app, null, { timeout: 180000 });
if (Number(process.env.THROTTLE || 1) > 1) await (await p.context().newCDPSession(p)).send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
if (process.env.FIRE) { await p.mouse.move(vw / 2, vh / 2); await p.mouse.down({ button: "left" }); await p.mouse.down({ button: "right" }); }
for (const k of (process.env.KEYS || "").split(",").filter(Boolean)) await p.keyboard.down(k);
await p.waitForTimeout(wait * 1000);
// Every frame: the app's own times and the stage list as the HUD last had it.
await p.evaluate(() => {
  const s = (window.__perf = { n: 0, tick: 0, render: 0, worstTick: 0, worstRender: 0, ticks: [], stages: {} });
  const f = () => {
    const l = window.__app.last;
    s.n++; s.tick += l.tick; s.render += l.render; s.ticks.push(l.tick);
    if (l.tick > s.worstTick) s.worstTick = l.tick;
    if (l.render > s.worstRender) s.worstRender = l.render;
    const c = window.__costs?.();
    if (c) for (const k in c) s.stages[k] = (s.stages[k] || 0) + c[k];
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
await p.waitForTimeout(dur * 1000);
const s = await p.evaluate(() => window.__perf);
const sorted = s.ticks.slice().sort((a, b) => a - b), pc = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
console.log(`${s.n} frames in ${dur} s · sim ${(s.tick / s.n).toFixed(2)} ms mean, ${pc(0.5).toFixed(1)} median, ${pc(0.95).toFixed(1)} at 95%, ${pc(0.99).toFixed(1)} at 99%, ${s.worstTick.toFixed(1)} worst · submit ${(s.render / s.n).toFixed(2)} mean, ${s.worstRender.toFixed(1)} worst`);
console.log(Object.entries(s.stages).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / s.n).toFixed(2)}`).join(" · "));
console.log((await p.evaluate(() => window.__hud())).split("\n").filter((l) => /^(clock|sim|deaths):/.test(l)).join("\n").slice(0, 900));
await b.close();
