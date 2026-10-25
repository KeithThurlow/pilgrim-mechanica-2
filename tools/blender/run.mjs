// Run a headless Blender script, at most BLENDER_SLOTS (default 2) at a time across every agent on this PC.
// Keith's PC runs short of memory, so parallel modelling agents queue here instead of all building at once.
//
//   node tools/blender/run.mjs <script.py> [-- script args]
//
// Slots are directories under tools/blender/.slots/ (mkdir is atomic); a slot older than 30 minutes is treated as
// abandoned and taken over. BLENDER points at the executable (default: Blender 4.4 in Program Files).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const slotsDir = join(here, ".slots");
const slots = Number(process.env.BLENDER_SLOTS ?? 2);
const blender = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 4.4/blender.exe";
const staleMs = 30 * 60 * 1000;
const [script, ...rest] = process.argv.slice(2);
if (!script) { console.error("usage: node tools/blender/run.mjs <script.py> [-- args]"); process.exit(2); }

mkdirSync(slotsDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claim() {
  let waited = 0;
  for (;;) {
    for (let i = 0; i < slots; i++) {
      const dir = join(slotsDir, `slot${i}`);
      try {
        mkdirSync(dir);
        writeFileSync(join(dir, "owner.txt"), `${process.pid} ${script} ${new Date().toISOString()}\n`);
        return dir;
      } catch {
        try { if (Date.now() - statSync(dir).mtimeMs > staleMs) rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    }
    if (waited % 30000 === 0) console.log(`[run.mjs] waiting for a Blender slot (${slots} in use)...`);
    await sleep(2000);
    waited += 2000;
  }
}

const slot = await claim();
const release = () => { try { rmSync(slot, { recursive: true, force: true }); } catch {} };
process.on("SIGINT", () => { release(); process.exit(130); });
process.on("SIGTERM", () => { release(); process.exit(143); });
console.log(`[run.mjs] ${slot.split(/[\\/]/).pop()}: blender -b --factory-startup -P ${script} ${rest.join(" ")}`);
const child = spawn(blender, ["-b", "--factory-startup", "--python-exit-code", "1", "-P", script, ...rest], { stdio: "inherit" });
child.on("exit", (code) => { release(); process.exit(code ?? 1); });
child.on("error", (e) => { console.error(e); release(); process.exit(1); });
