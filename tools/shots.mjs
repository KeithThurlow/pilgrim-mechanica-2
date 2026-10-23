// Screenshots of the labs for review: builds nothing, serves dist/ (run `npm run build` first), opens each page in
// headless Chromium, waits, saves PNGs to shots/ and prints each page's HUD plus any console errors.
//   npm run build && npm run shots              default set
//   node tools/shots.mjs "/labs/walker/?cam=side&flat" ...   your own pages
// Pages get ?webgl added (headless has no WebGPU), so frame times here say nothing about real performance.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../dist");
if (!existsSync(root)) { console.error("No dist/: run `npm run build` first."); process.exit(1); }
const out = resolve(import.meta.dirname, "../shots");
mkdirSync(out, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".glb": "model/gltf-binary" };
const server = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split("?")[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;

const DEFAULT = [
  "/labs/walker/?cam=game&fire",
  "/labs/walker/?cam=close&set=sunAzimuth:30,sunElevation:40",
  "/labs/walker/?cam=back&walk=straight&set=sunAzimuth:200,sunElevation:40",
  "/labs/walker/?cam=side&flat&walk=straight&set=sunAzimuth:125,sunElevation:30",
  "/labs/terrain/?shot",
  "/labs/terrain/?shot&view=high",
];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [i, url] of pages.entries()) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  page.on("pageerror", (e) => logs.push(e.message));
  const full = url + (url.includes("?") ? "&" : "?") + "webgl";
  await page.goto(`http://localhost:${port}${full}`);
  await page.waitForTimeout(8000);
  const name = `${String(i + 1).padStart(2, "0")}-${url.replace(/^\/labs\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "")}.png`;
  await page.screenshot({ path: join(out, name) });
  const hud = await page.evaluate(() => document.querySelector(".hud")?.innerText ?? "(no hud)");
  console.log(`${name}\n  ${hud.replace(/\n/g, "\n  ")}${logs.length ? "\n  ERRORS:\n  " + logs.join("\n  ") : ""}`);
  await page.close();
}
await browser.close();
server.close();
