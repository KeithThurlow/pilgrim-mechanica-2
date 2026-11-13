// Inventory pictures from the models (docs/asset-pipeline.md): steps the icons lab through every item base and
// saves each picture to public/icons/<base id>.png, then writes src/ui/iconList.ts (which bases have one).
// Serves dist/ like tools/shots.mjs, so run `npm run build` first; public/ fills in anything newer.
//   npm run build && npm run icons            every base
//   node tools/icons.mjs pack-medic sh-mortar   only these (the list keeps the others)
// CHROME=<path> picks an installed Chromium. Pictures are drawn with WebGL in software here, the same shading as the game.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../dist"), pub = resolve(import.meta.dirname, "../public");
if (!existsSync(root)) { console.error("No dist/: run `npm run build` first."); process.exit(1); }
const out = join(pub, "icons");
mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".glb": "model/gltf-binary" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let p = join(root, url);
  if (existsSync(join(pub, url)) && !statSync(join(pub, url)).isDirectory()) p = join(pub, url);
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`http://localhost:${server.address().port}/labs/icons/?webgl`);
await page.waitForFunction(() => window.__icons);
await page.addStyleTag({ content: "body, #view { background: transparent !important; border: 0 !important; }" });
const all = await page.evaluate(() => window.__icons.ids);
const only = process.argv.slice(2);
const made = [], none = [];
for (const id of only.length ? only : all) {
  const r = await page.evaluate((i) => window.__icons.draw(i), id);
  const file = join(out, id + ".png");
  if (!r) { none.push(id); if (existsSync(file)) rmSync(file); continue; }
  await page.locator("#view canvas").screenshot({ path: file, omitBackground: true });
  made.push(`${id} ${r.w}x${r.h}`);
}
await browser.close();
server.close();
const have = readdirSync(out).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort();
writeFileSync(resolve(import.meta.dirname, "../src/ui/iconList.ts"),
  `// Written by tools/icons.mjs (npm run icons): the item bases with a picture in public/icons/. Don't edit.\nexport const ICON_IDS: ReadonlySet<string> = new Set(${JSON.stringify(have)});\n`);
console.log(`icons: ${made.length} drawn, ${have.length} in public/icons/`);
if (none.length) console.log(`no model of their own (line drawing stays): ${none.join(", ")}`);
