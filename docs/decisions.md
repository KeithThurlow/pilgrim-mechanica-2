# Decisions

Newest first. Raised by / decided by: Keith or Claude. Only Keith's calls are marked as his.

| Date | Decision | Raised | Decided | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-24 | Old walker code is a guideline, not something to port line by line | Keith | Keith | The new walker is a fresh, smaller sim (`src/mech/walker.ts`); starting tuning values come from the old lab's build 65 Mechanical walk, scaled to metres. |
| 2026-10-24 | Feet must place properly on the ground for the player's mech; enemies and swarms can be cheaper | Keith | Keith | The ground is a pure height function so feet query it exactly. |
| 2026-10-24 | The convoy isn't steered by the player for now; it travels over procedural land | Keith | Keith | Gameplay loop first, story loop later. |
| 2026-10-24 | Build in the web; iteration time matters more than performance at this stage | Keith | Keith | After Unity's test loops and build times slowed small changes down. |
| 2026-10-24 | Three.js r186 (WebGPU renderer with WebGL 2 fallback) + TypeScript + Vite, no engine | Claude | Keith | Godot's web export lacks WebGPU and C#; Unity was the slow loop being left. |
| 2026-10-24 | Ground rules: lab per system, every feel value a slider, frame time in every lab, rewrite over workaround | Claude | Keith | In `CLAUDE.md`. Keith: half the Unity slowdown was not setting rules early enough. |
| 2026-10-24 | Restart as Pilgrim Mechanica 2: a moving convoy village, salvage runs against the convoy's range, swarms | Keith | Keith | `docs/design.md`. |
| 2026-10-24 | Terrain: transverse dunes with a crossing set, streamed chunks, vertex colours | Claude | open | Tune in the terrain lab. |
