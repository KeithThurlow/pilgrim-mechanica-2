// Draw-cost probe (perf, 2026-11-07): how many objects three's renderer handles a frame, and who owns them.
// Usage: node tools/drawcount-probe.mjs [path?flags] [wait s] [base url]   (dev server running: npm run dev)
//   e.g. node tools/drawcount-probe.mjs "labs/convoy/?siege&manual" 20
// Counts every renderObject call over a few frames, split into the camera pass and the shadow pass, grouped by the
// nearest named ancestor under the scene (so "rampart", "platform"...). Then holds the sim (app.hold) and times the
// render call alone on the same moment. Headless Chromium runs WebGL 2 on a software GPU: object counts are exact,
// times are only good for comparing two runs on this machine.
import { chromium } from "playwright";

const url = process.argv[2] || "labs/convoy/?siege&manual";
const wait = Number(process.argv[3] || 20);
const base = process.argv[4] || "http://localhost:5173/";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.goto(base + url + (url.includes("?") ? "&" : "?") + "webgl");
await p.waitForFunction(() => window.__app, null, { timeout: 60000 });
await p.waitForTimeout(wait * 1000);
console.log("loaded; last frame", await p.evaluate(() => JSON.stringify(window.__app.last)));
const out = await p.evaluate(async (DRILL) => {
  const app = window.__app, r = app.renderer;
  const owner = (o) => {
    // The named ancestor nearest the scene root that isn't the scene: a model's top group.
    const chain = [];
    for (let c = o; c && c !== app.scene; c = c.parent) chain.push(c);
    const named = chain.filter((c) => c.name);
    const top = named.length ? named[named.length - 1].name : (chain[chain.length - 1]?.type ?? "?");
    // DRILL=name: under that owner, group by the next named level and the mesh's own name.
    if (DRILL && DRILL.split(",").includes(top)) return `${top} > ${(named[named.length - 2]?.name ?? "-").slice(0, 30)} > ${(o.name || o.material?.name || o.geometry?.type || "?").slice(0, 30)}`;
    return top.slice(0, 40);
  };
  const frames = 2;
  const cam = new Map(), sh = new Map();
  let camN = 0, shN = 0, inst = 0;
  const orig = r.renderObject.bind(r);
  r.renderObject = (object, scene, camera, ...rest) => {
    const shadow = !camera.isPerspectiveCamera || camera !== app.camera;
    const m = shadow ? sh : cam, k = owner(object);
    m.set(k, (m.get(k) || 0) + 1);
    if (shadow) shN++; else camN++;
    if (object.isInstancedMesh || object.isBatchedMesh) inst++;
    return orig(object, scene, camera, ...rest);
  };
  await new Promise((res) => { let n = 0; const f = () => (++n >= frames ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  r.renderObject = orig;
  const per = (m) => [...m].map(([k, v]) => [k, v / frames]).sort((a, b) => b[1] - a[1]);
  // Scene-graph size: objects whose matrices update each frame.
  let objs = 0, auto = 0, meshes = 0, mats = new Set();
  app.scene.traverse((o) => { objs++; if (o.matrixAutoUpdate) auto++; if (o.isMesh) { meshes++; if (o.material) mats.add(o.material); } });
  // Render alone on a held moment.
  app.hold = true;
  await new Promise((res) => setTimeout(res, 300));
  const ts = [];
  await new Promise((res) => { let n = 0; const f = () => { ts.push(app.last.render); (++n >= 8 ? res() : requestAnimationFrame(f)); }; requestAnimationFrame(f); });
  app.hold = false;
  ts.sort((a, b) => a - b);
  return { cam: camN / frames, shadow: shN / frames, instanced: inst / frames, camBy: per(cam).slice(0, 200), shBy: per(sh).slice(0, 12),
    objs, auto, meshes, materials: mats.size, renderMedian: ts[ts.length >> 1], calls: app.last.calls, backend: app.backend };
}, process.env.DRILL || "");
console.log(`${url}  backend ${out.backend}`);
console.log(`objects a frame: camera ${out.cam}, shadow ${out.shadow} (instanced/batched ${out.instanced}); draw calls ${out.calls}`);
console.log(`scene: ${out.objs} objects, ${out.auto} with matrixAutoUpdate, ${out.meshes} meshes, ${out.materials} materials`);
console.log(`render call median (held frame, software GPU): ${out.renderMedian.toFixed(2)} ms`);
console.log("camera pass by owner:\n" + out.camBy.map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`).join("\n"));
console.log("shadow pass by owner:\n" + out.shBy.map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`).join("\n"));
await b.close();
