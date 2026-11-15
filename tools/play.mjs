// One-command update and play: pull main, install, build, serve the build with Vite and open the lab hub.
// Run from the repo root: `npm run play` (the first run, after cloning: `npm install && npm run play`).
// Stops at the first failing step. `--dev` serves with hot reload instead of building first.
import { spawnSync } from 'node:child_process'

const dev = process.argv.includes('--dev')
const steps = [
  ['git', ['checkout', 'main']],
  ['git', ['pull', '--ff-only', 'origin', 'main']],
  ['npm', ['install']],
  ...(dev ? [] : [['npm', ['run', 'build']]]),
  ['npx', dev ? ['vite', '--open'] : ['vite', 'preview', '--open', '--host']],
]
for (const [cmd, args] of steps) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true })
  if (r.status !== 0) { console.error(`\nStopped: "${cmd} ${args.join(' ')}" failed.`); process.exit(r.status ?? 1) }
}
