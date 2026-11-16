// One-command update and play: pull main, install, build, serve the build with Vite and open the lab hub.
// Run from the repo root: `npm run play` (the first run, after cloning: `npm install && npm run play`).
// Stops at the first failing step. `--dev` serves with hot reload instead of building first.
// Always on the same port (Keith 2026-11-16: runs were stacking up servers on new ports, and saved inventory lives in
// localStorage per address): before serving it stops any earlier play or dev server (a node process listening on
// 4173-4189 or 5173-5189), then serves on 4173 (build) or 5173 (`--dev`) with strictPort, so it fails rather than drift.
// Windows (PowerShell/cmd) and Mac/Linux.
import { spawnSync, execSync } from 'node:child_process'

const dev = process.argv.includes('--dev')
const PORT = dev ? 5173 : 4173
const win = process.platform === 'win32'

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' }
}

/** PIDs of processes listening on TCP `port`. */
function listeners(port) {
  const pids = new Set()
  if (win) {
    // "TCP  0.0.0.0:4173  0.0.0.0:0  LISTENING  1234" (IPv4 and IPv6; a listener's remote end is :0 in any language)
    for (const line of sh('netstat -ano').split(/\r?\n/)) {
      const c = line.trim().split(/\s+/)
      if (c.length === 5 && c[0] === 'TCP' && c[1].endsWith(`:${port}`) && c[2].endsWith(':0')) pids.add(Number(c[4]))
    }
  } else {
    for (const p of sh(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`).split(/\s+/)) if (p) pids.add(Number(p))
  }
  pids.delete(0); pids.delete(process.pid)
  return [...pids]
}

function isNode(pid) {
  const name = win ? sh(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`) : sh(`ps -p ${pid} -o comm=`)
  return /node/i.test(name)
}

function kill(pid) {
  if (win) sh(`taskkill /PID ${pid} /T /F`)
  else { try { process.kill(pid, 'SIGTERM') } catch {} }
}

/** Stop earlier play/dev servers: node listening on the Vite preview and dev port ranges. */
function stopOldServers() {
  const ports = []
  for (let p = 4173; p < 4190; p++) ports.push(p)
  for (let p = 5173; p < 5190; p++) ports.push(p)
  const stopped = []
  for (const port of ports) for (const pid of listeners(port)) {
    if (!isNode(pid)) { if (port === PORT) console.log(`Port ${port} is held by a non-node process (pid ${pid}); leaving it.`); continue }
    kill(pid); stopped.push(`${port} (pid ${pid})`)
  }
  if (!stopped.length) return
  console.log(`Stopped earlier server(s) on port ${stopped.join(', ')}.`)
  const until = Date.now() + 5000
  while (listeners(PORT).length && Date.now() < until) spawnSync(win ? 'ping' : 'sleep', win ? ['-n', '2', '127.0.0.1'] : ['0.3'])
}

const steps = [
  ['git', ['checkout', 'main']],
  ['git', ['pull', '--ff-only', 'origin', 'main']],
  ['npm', ['install']],
  ...(dev ? [] : [['npm', ['run', 'build']]]),
  'stop',
  ['npx', dev ? ['vite', '--open', '--port', PORT, '--strictPort']
               : ['vite', 'preview', '--open', '--host', '--port', PORT, '--strictPort']],
]
for (const step of steps) {
  if (step === 'stop') { stopOldServers(); continue }
  const [cmd, args] = step
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args.map(String), { stdio: 'inherit', shell: true })
  if (r.status !== 0) { console.error(`\nStopped: "${cmd} ${args.join(' ')}" failed.`); process.exit(r.status ?? 1) }
}
