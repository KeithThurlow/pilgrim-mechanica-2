// npm test: runs every tools/*-check.ts (and the balance sheet's --check) side by side, one process per check,
// as many at once as the machine has cores. A check's output is shown only when it fails (or with --verbose).
// Slowest checks start first, by the times of the last run (node_modules/.cache/check-times.json).
// Usage: node tools/run-checks.mjs [--verbose] [-j N] [name-filter ...]
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const jIdx = args.indexOf('-j');
const jobs = jIdx >= 0 ? Number(args[jIdx + 1]) : Math.max(1, cpus().length);
const filters = args.filter((a, i) => !a.startsWith('-') && !(jIdx >= 0 && i === jIdx + 1));

const checks = readdirSync('tools')
  .filter((f) => f.endsWith('-check.ts'))
  .map((f) => ({ name: f.slice(0, -3), argv: [join('tools', f)] }));
checks.push({ name: 'balance-sheet', argv: [join('tools', 'balance-sheet.ts'), '--check'] });
const todo = filters.length ? checks.filter((c) => filters.some((f) => c.name.includes(f))) : checks;

const cacheDir = join('node_modules', '.cache');
const cacheFile = join(cacheDir, 'check-times.json');
let times = {};
try { times = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { /* first run */ }
todo.sort((a, b) => (times[b.name] ?? 1e9) - (times[a.name] ?? 1e9));

const tsx = join('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const t0 = performance.now();
const results = [];
let next = 0;

function run(check) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(tsx, check.argv, { shell: process.platform === 'win32', env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      const ms = performance.now() - start;
      const ok = code === 0;
      results.push({ name: check.name, ok, ms });
      times[check.name] = ms;
      const line = `${ok ? 'ok  ' : 'FAIL'} ${check.name} ${(ms / 1000).toFixed(1)} s`;
      if (!ok || verbose) console.log(`\n--- ${check.name} ---\n${out.trimEnd()}\n${line}`);
      else console.log(line);
      resolve();
    });
  });
}

async function worker() {
  while (next < todo.length) await run(todo[next++]);
}
await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, worker));

try { mkdirSync(cacheDir, { recursive: true }); writeFileSync(cacheFile, JSON.stringify(times, null, 1)); } catch { /* fine */ }
const failed = results.filter((r) => !r.ok);
const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5).map((r) => `${r.name} ${(r.ms / 1000).toFixed(1)} s`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s (${jobs} at once). Slowest: ${slow.join(', ')}`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
