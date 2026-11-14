// CPU profile of a lab, the page and its sim worker (perf, 2026-11-13). Headless on the cloud box's software GPU, or
// headed on a real one (HEADED=1). The dev server must be running (npm run dev): its unminified names are what's listed.
// Usage: node tools/perf-profile.mjs "<path?flags>" [wait s] [profile s] [rows]
//   e.g. node tools/perf-profile.mjs "labs/convoy/?siege=80&manual&lite=1&norender" 25 20
// Env: THROTTLE=4 (CPU slowed that many times, as a phone), FIRE=1 (both mouse buttons held at the screen's middle),
//   SERIES=2 (the HUD's top lines every 2 s of the wait), KEYS=KeyW,Space (held), VIEW=844x390, BASE=http://localhost:5173/, CHROME=<path>, HEADED=1, OUT=<file for raw JSON>.
// Prints, for the page and each worker: the dearest functions by self time and by total time, in ms a drawn frame
// (with ?dt=0.0333 a frame is one tick); then window.__hud(). Times are this machine's (times THROTTLE): compare runs here, not with Keith's PC.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2] || "labs/convoy/?siege&manual";
const wait = Number(process.argv[3] || 25), dur = Number(process.argv[4] || 15), rows = Number(process.argv[5] || 45);
const base = process.env.BASE || "http://localhost:5173/";
const [vw, vh] = (process.env.VIEW || "844x390").split("x").map(Number);
const throttle = Number(process.env.THROTTLE || 1);
const b = await chromium.launch({
  headless: !process.env.HEADED,
  args: process.env.HEADED ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});
const p = await b.newPage({ viewport: { width: vw, height: vh } });
p.on("pageerror", (e) => console.log("pageerror", e.message));
const c = await p.context().newCDPSession(p);
// Workers: attached as they start (not flattened: messages go through the page's session).
const workers = new Map(); // sessionId -> { url, pending: Map<id, resolve>, n }
c.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => { if (targetInfo.type === "worker") workers.set(sessionId, { url: targetInfo.url, pending: new Map(), n: 0 }); });
c.on("Target.receivedMessageFromTarget", ({ sessionId, message }) => {
  const w = workers.get(sessionId), m = JSON.parse(message);
  if (w && m.id && w.pending.has(m.id)) { w.pending.get(m.id)(m.result ?? m.error); w.pending.delete(m.id); }
});
const wsend = (sessionId, method, params = {}) => new Promise((res) => {
  const w = workers.get(sessionId), id = ++w.n;
  w.pending.set(id, res);
  c.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(() => res(null));
});
await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
await p.goto(base + url);
await p.waitForFunction(() => window.__hud, null, { timeout: 180000 });
if (throttle > 1) {
  await c.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  for (const id of workers.keys()) await wsend(id, "Emulation.setCPUThrottlingRate", { rate: throttle });
}
if (process.env.FIRE) { await p.mouse.move(vw / 2, vh / 2); await p.mouse.down({ button: "left" }); await p.mouse.down({ button: "right" }); }
for (const k of (process.env.KEYS || "").split(",").filter(Boolean)) await p.keyboard.down(k);
// SERIES=s: the HUD's top lines every s seconds while waiting (to find the fight's peak).
if (process.env.SERIES) {
  const step = Number(process.env.SERIES);
  for (let t = step; t <= wait; t += step) { await p.waitForTimeout(step * 1000); console.log(`${t}s  ` + (await p.evaluate(() => window.__hud().split("\n").slice(0, 4).join(" | "))).slice(0, Number(process.env.SERIESW || 700))); }
} else await p.waitForTimeout(wait * 1000);

await c.send("Profiler.enable"); await c.send("Profiler.setSamplingInterval", { interval: 250 }); await c.send("Profiler.start");
for (const id of workers.keys()) { await wsend(id, "Profiler.enable"); await wsend(id, "Profiler.setSamplingInterval", { interval: 250 }); await wsend(id, "Profiler.start"); }
await p.evaluate(() => { window.__pf = 0; const f = () => { window.__pf++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
const t0 = Date.now();
await p.waitForTimeout(dur * 1000);
const secs = (Date.now() - t0) / 1000;
const frames = Math.max(1, await p.evaluate(() => window.__pf));
const profiles = [["page", (await c.send("Profiler.stop")).profile]];
for (const [id, w] of workers) { const r = await wsend(id, "Profiler.stop"); if (r?.profile) profiles.push([`worker ${w.url.split("/").pop().split("?")[0]}`, r.profile]); }

function report(name, profile) {
  const byId = new Map(), parent = new Map(), dt = new Map(), self = new Map(), total = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  for (const n of profile.nodes) for (const ch of n.children || []) parent.set(ch, n.id);
  for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
  const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/").split("?")[0]}:${n.callFrame.lineNumber + 1}`;
  let all = 0, idle = 0;
  for (const [id, t] of dt) {
    const n = byId.get(id), k = key(n);
    all += t;
    if (n.callFrame.functionName === "(idle)") idle += t;
    self.set(k, (self.get(k) || 0) + t);
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) { const kk = key(byId.get(cur)); if (!seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) || 0) + t); } }
  }
  const per = (v) => (v / 1e3 / frames).toFixed(2).padStart(7);
  const top = (m, n) => [...m].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(root)")).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${per(v)}  ${k}`).join("\n");
  console.log(`\n=== ${name}: busy ${per(all - idle).trim()} ms a drawn frame (${frames} frames in ${secs.toFixed(1)} s${throttle > 1 ? `, CPU x${throttle} slower` : ""}) ===`);
  console.log("SELF, ms a frame\n" + top(self, rows) + "\nTOTAL, ms a frame\n" + top(total, rows * 2));
}
for (const [name, prof] of profiles) report(name, prof);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(profiles));
console.log("\n=== window.__hud() ===\n" + (await p.evaluate(() => window.__hud())));
await b.close();
