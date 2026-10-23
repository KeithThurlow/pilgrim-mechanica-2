# Pilgrim Mechanica 2

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
