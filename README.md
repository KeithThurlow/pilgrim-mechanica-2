# Pilgrim Mechanica 2

**Update and play (no Claude needed).** From the repo folder, in PowerShell or bash: pulls `main`, installs, builds and serves it with Vite, opening the lab hub.

```
cd C:\Users\thurl\Development\pilgrim-mechanica-2; npm run play
```

(bash: `cd ~/Development/pilgrim-mechanica-2 && npm run play`.) Add `-- --dev` for the hot-reload dev server instead of a build. If `main` has local edits it stops rather than overwrite them. Each run first stops any earlier play or dev server (a node process on ports 4173-4189 or 5173-5189) and always serves on the same address, http://localhost:4173 (`--dev`: 5173), so saved inventory and sliders carry over between runs.

A mech salvage game in the browser: a convoy village rolling across endless dunes, salvage runs against its range,
swarms closing in. Three.js (WebGPU), TypeScript, Vite.

## Run it

```
npm install
npm run dev
```

The dev server opens the lab hub. Each lab is one system with live sliders:

- **Walker lab**: the procedural walker on streamed dunes. WASD to walk, Shift to sprint, click the ground to walk
  there. Auto walk wanders until you take over.
- **Terrain lab**: the dune field streaming around a moving marker.

Tuning is saved per lab in your browser; **Copy values** gives JSON to paste back as new defaults.

## Checks

- `npm test`: headless walker and terrain checks.
- `npm run build && npm run shots`: screenshots of every lab into `shots/` (first time: `npx playwright install chromium`).

Working rules and project layout: `CLAUDE.md`. The game: `docs/design.md`.
