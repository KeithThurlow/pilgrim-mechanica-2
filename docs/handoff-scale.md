# Handoff: the scale build (`wip/scale`)

Keith approved `docs/proposal-scale.md` on 2026-10-26 ("we just have to do it, and then I can see it"). Agent work,
pushed to `wip/scale` after every working step. Read this, then `git log`, when resuming.

## Order (the proposal's)

1. **Effects budget gate** (`src/fx/budget.ts`): merge, thin, trim, local player full. **Built** (step 1).
2. The register: already built by another agent (in main).
3. **Shots as data** (`src/game/shots.ts`): one projectile system, Protocols as fields, hits as events. **Built**
   (step 3): every `Battlefield.fire` is a shot command; rows resolve in `bf.update` (`resolveShots`).
4. **Real Protocol behaviours** on it (split, fire rate, area, ricochet, chain): **built in the shot system**; the
   worst case now passes them as `o.proto` instead of its stand-ins. Not yet on items (Protocol items with shot
   fields: next).
5. **GPU particles**, one look at a time (sparks and grit, tracers and casings, then dust), each behind a GPU/CPU
   slider. **Written, being verified** (see below).

## Step 5: GPU particles (written; verifying)

- `src/fx/gpuPool.ts`: a ring of N particles, 4 vec4 storage buffers (P, V, A, B), one TSL compute pass a frame. New
  particles come as rows of a float **spawn texture** (4 rows × maxSpawn), read with `textureLoad` at `k = (i - head)
  mod N`. Feasibility tested on both backends here (scratchpad `scale/gputest/`): a storage buffer read at another index
  fails on WebGL 2 ("Not enough space in bound transform feedback buffers"); the texture works on both. Live count is a
  CPU estimate (per-slot expiry), no readback.
- `src/fx/gpuGround.ts`: height/normal from `DetailPatch.gpuGround` (the chunks' 1 m grid as a texture round the focus).
- `src/fx/gpuBits.ts`: sparks (streak along velocity), grit (tumble), casings (bounce, land flat); instanced meshes
  placed in the vertex shader. Casing tonks: landing time worked out on the CPU when thrown (MinigunFx.landings).
- `src/fx/gpuTracers.ts`: 1024 tracers flown by the vertex shader from (from, to, time left); MinigunFx still times
  arrivals on the CPU (impacts). `ROUNDS_IN_FLIGHT` 1024 (CPU path draws the first 160).
- `src/fx/gpuDust.ts`: the dust sim ported (clump, cloud, spray); `DustSim.emit` forwards there when `fxGpuDust`;
  `DustDraw.attachGpu` draws it with the same shader (refactored into `puffMaterial`) and shadows draped on the ground.
- Sliders (Performance): `fxGpuBits`, `fxGpuTracers`, `fxGpuDust` (default 1), `fxGpuDustPool` (32768, on reload).
- Verified so far: WebGL readback in the robots lab (dust live 177 vs the CPU estimate 172, none under the ground;
  casings resting at +0.03 m; sparks flying); walker lab game-camera dust before / CPU / GPU (scratchpad
  `scale/shots/w3-three.png`): GPU matches once drawn oldest-last in two passes (clumps, then cloud); unsorted
  newest-last showed dark mottling (new clumps over old cloud). GPU tracers draw in the lab (`shots/tracertest.png`).
  WebGPU: the feasibility test and a robots-lab load had no errors; a WebGPU readback timed out on this box (too slow).
- Open: in the robots lab firing shot (`shots/r-gpu.png` vs `r-cpu.png`) the GPU frame shows less dust haze round the
  mech's left gun; not yet pinned down (random run-to-run, or puffs missing there).
- Scripts: `scale/gpucheck.mjs <url> frames` reads the pools back (live, height over the true ground); `smoke2.mjs`
  (console errors too). Shots: `shotg.mjs` stops the loop before the screenshot (the box renders 6-10 s a frame).

## Step 1: the effects budget (done)

- `src/fx/budget.ts`: `FxBudget.admit(x, z, own)` (thin), `part(rank)` (trim), `frame(alive)` (pressure from last
  frame's dust asks against `fxDustPerFrame` and the live pool against `fxLiveShare`), `hold` (an impact's own dust and
  smoke don't ask again). Sliders `FX_BUDGET_PARAMS`, spread into `MINIGUN_FX_DEFAULTS/PARAMS` so every lab with the
  minigun effects gets them: Performance group (gate) and a new **Effects** group (merge look), added to each lab's
  hits topic (combat labs, walker, convoy).
- `src/fx/dust.ts`: `budget` field; stomp, kick, hit, wheel and smoke ask it; `emit` only counts (blasts, plough and
  warband call it directly and are not thinned). **API unchanged** except `hit(..., k, n = 1)` (optional count
  multiplier for merged hits). No default values touched (the locomotion agent owns those).
- `src/fx/minigun.ts`: `shot(..., own = false)`; tracer arrivals gather by cell and surface (`land`, `flushMerged`);
  `impact(..., n, own, hits)`; far tracers not yours thin; `sparksAt` asks the budget; `onSandHit` gets `n`.
- `src/game/battlefield.ts`: `bf.fx` (the gate), focus from the sun target, `fx.frame()` at the end of update; rounds
  with `voice: "player"` are the local player's own.
- Labs set `bf.fx.own` to the player's mech position (combat lab shell, walker, convoy).
- Check: `tools/fxbudget-check.ts` (in `npm test`).

## Step 3: shots as data (done)

- `src/game/shots.ts`: `Shots.fire(cmd, look)` (split and rate expand into rows, seeded), `step(dt)` resolves due rows
  (sheet via `resolveSheet` with the register; plain rays culled via `reg.ray` like `sheetHits`), writes `events`
  (hit, splash, ricochet, chain, miss) and `draws` (cosmetic). Ricochet: mirror off the normal, seeded scatter, never
  down; chain: nearest register entry not yet hit by the family, starting outside the struck body. Generations capped
  by `protoMaxGen`. Sliders `SHOT_PARAMS` (group **Protocols**, added to the weapons topic in the combat labs and the
  convoy lab; `shotsPerFrame` in Performance).
- `Battlefield.fire` returns the shot id now (nobody used the old return); `FireOptions` gained `proto`, `interval`,
  `seed`. `fireSheet` is gone (the shot system does it). `MinigunFx.shot(gun = -1)`: no flash (split rounds and
  children are quiet; only a command's first round flashes, ejects and sounds).
- Check: `tools/shots-check.ts`.
- Known: events name targets by index in `bf.targets` + part key (host-local), not register id; mechUnit's spread still
  uses Math.random before the command.

## Merges

- 2026-10-27: main merged in (locomotion, narrower plough, sprint feel 1-3). Conflicts only in topic lists, the walker
  lab's player setup, package.json's test list, decisions and state. Dust emit API untouched (slide dust goes through
  `stomp`). All checks pass after it.

## Measuring

Scratch scripts (session scratchpad `scale/`): `build.mjs` (esbuild bundle of the labs into `scale/site`),
`stress.mjs "<query>" out.txt` (runs the stress lab to the end of its Run, writes the table), `checks.sh` (every
check). The box is shared: run A/B pairs back to back with `?set=fxBudget:0` vs on, same build.

## Known / rough

- The pilot on foot doesn't count as the local player yet (`fx.own` is the mech).
- Thinned impacts drop their ground mark and their sound too.
