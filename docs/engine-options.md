# Engine options: stay in the browser or move (2026-11-07)

Keith asked (2026-11-07) whether the game should move to Bevy or another engine so performance stays good while we add
more interesting points of interest. This is an assessment only: nothing is ported. Claude wrote it from main `2f961fa`
(after the sim worker steps #252 to #274), the PC profiles in the project files (`pc-profile-siege-prod.md`,
`perf/proposal-7ms.md`), `docs/sim-scope.md`, `docs/handoff-simworker.md` and the WASM probe
(`wasm-assessment/` in the project files).

## Short answer

**Don't move now.** What costs the frame is mostly fixable inside three.js: three.js's work per object, and ground
lookups. A port would mean months of rewriting while content stands still. Our best-case gain only matters if the
fixes below fail to get the convoy fight to 100 fps. **Native Bevy is the only move that clearly beats staying**,
so it is the fallback. A small spike, two versions of the same scene on Keith's PC, would show whether we need it before
we commit to anything. Bevy in the browser (WASM), Godot, Unity and Unreal each cost about as much as a native Bevy port
and gain less.

## What the frame costs today

The test scene is the convoy siege (`labs/convoy/?siege&manual`), measured on Keith's RTX 3080 with the production build.
About 16 ms a frame, all on the main thread before the worker. The goal is about 7 ms for 144 fps, with 100 fps
(10 ms) as the floor.

| Where | ms | What it is | Engine-bound? |
| --- | --- | --- | --- |
| Render submit | ~7 | three's per-object work: `renderObject` ~29% of the frame for ~195 camera objects + ~135 shadow objects (~14 µs each); `updateMatrixWorld` 6-7%, `_projectObject` 5-7%, node-material bookkeeping (`updateNode`, `updateBinding`, `needsRefresh`) several % | **Yes**: three's WebGPU renderer (TSL nodes) pays per object in JS. Native engines pay ~1 µs or batch it away. |
| Ground lookups | ~1-1.5 | `fbm`/`duneSet`/`base` ~6 µs a call, tens of thousands a frame (dust, shadows, feet, vehicles) | **No**: the number of calls is the problem. A cached height grid removes most of them in any language. |
| Game sim | ~5 | Robots, escorts, guardians, mech walkers, dust, dents, Rapier deaths, camps. No single hot spot left. | **Partly**: JS's JIT on typed arrays is within 1.5-2.5× of native here (the WASM probe measured 1.5× on the hottest maths). |
| Uploads | ~1 | `writeBuffer`/`writeTexture` (dents, instances, dust) | Mostly the amount of data, not the stack. |

The sim worker moved the ground copy, terrain builds, escorts and the robot swarm off the main thread. On the cloud bench
it saved little (7.8 vs 8.1-8.35 ms at 300 robots, no change at 40), because what is left on the main thread is drawing
and glue (`robotsDraw.update` ~1.1 ms, dust ~1, deaths ~1, guardians ~0.8). Keith's PC hasn't run the new `?bench` yet.

**Bottom line:** about half the frame is three.js's per-object cost. A native engine would remove most of that half.
The other half is the game's own work, which moves to any engine with only modest gains.

## The options

Frame times are estimates for the siege on Keith's PC, CPU main thread. Only "today" is measured. The rest are reasoned
from the breakdown above and how each stack is known to behave. The spike below is how we'd replace them with
measurements.

| Option | Est. frame | Port effort | What's lost |
| --- | --- | --- | --- |
| **A. Stay, fix the render path** | **8-10 ms** (100 fps likely, 144 possible) | Weeks of normal PRs, alongside content | Nothing |
| B. Bevy native (Rust, wgpu, ECS) | 4-6 ms (144 comfortable) | 4-8 months; content mostly frozen | Browser play, sub-second reload, lab URLs as they are, the Report box, the TS checks (rewritten) |
| C. Bevy to WASM (in the browser) | 7-10 ms | Same as B | Most of B's losses, without B's speed: single-threaded in the browser, same WebGPU limits |
| D. Godot 4 (C# or GDExtension) | 6-9 ms native | 4-8 months | Web export is WebGL 2 only and weaker, and C# doesn't export to the web at all (why we skipped it on 2026-10-24) |
| E. Unity (DOTS) / Unreal | 4-7 ms | 5-9 months | The slow loop Keith left Unity over; Unreal is heavier still. No browser. |
| F. Another JS engine (Babylon, PlayCanvas) | 9-12 ms | 2-3 months (render layer + models) | Not much, but the gain is small: same JS per-object cost class |

### A. Stay and fix the render path (recommended)

These attack the measured costs directly, biggest first:

1. **Fewer objects per model.** Merge the parts that ride one bone into one mesh at load, with paint in the vertex
   colours (`proposal-7ms.md` option 2). That takes ~195 camera objects to about 100, and the shadow pass drops by the
   same share. Expect 1.5-3 ms. This is the biggest single lever, and it's exactly the cost a native engine would save.
2. **Static things stop recomputing their matrices.** Today only 9 places set `matrixAutoUpdate`. Decks, furniture,
   pipes, POI pieces and chunks are static relative to their parent: turning it off with a manual update on move cuts
   `updateMatrixWorld` and the projection walk. Expect 0.5-1 ms.
3. **More instancing.** 108 `InstancedMesh`/`BatchedMesh` uses already exist. Extend them to POI props, scrap, wreck
   pieces and the convoy's repeated parts. Every POI we add should be instanced from the start (see "Points of
   interest" below).
4. **Cheaper shadows.** Caster proxies are already merged (`src/look/shadowProxies.ts`). Next: draw small or far
   casters into the shadow pass only every second frame, or not at all past a distance. Expect 0.5-1 ms.
5. **A cached height grid** for dust, shadows and other queries that read the ground at points near the mech: a 0.5 m grid
   round the focus, refreshed on craters. Expect 1 ms, and it helps every engine equally.
6. **Finish the worker for what's left on main:** death physics (Rapier already runs as WASM, so it moves cleanly),
   guardians, infantry, war bands. This only pays once the render path is cheaper, because the frame is the longer of
   the two.
7. **Free check: `?webgl` vs WebGPU per object.** Both go through three's node system, but the WebGL 2 path has
   different per-draw costs. One profile on Keith's PC tells us whether the WebGPU backend is part of the bill.

Realistic result: render submit ~3-4 ms, main-thread glue and drawing updates ~3-4 ms, sim in the worker alongside.
That's **8-10 ms main thread**. 100 fps is likely. 144 fps is possible but not certain, and every swarm we add pushes
against it.

**Risk:** three's WebGPU renderer has a fixed cost per object that we can shrink but not remove. If the game's scenes
keep getting denser (more POIs, bigger fights, 4-player co-op with four mechs), we'll hit that wall again. The
spike's job is to put a number on that ceiling.

### B. Bevy native

**Why it's fast:** Rust, with no garbage-collection pauses. Bevy's renderer is GPU-driven: it batches by mesh and
material, uses multi-draw indirect and caches the opaque pass on the GPU, so 800 draws cost about 1 ms of CPU rather than
7. ECS systems run in parallel across cores by default. The sim's typed-array style (`RobotSwarm` is already a structure
of arrays) maps well onto ECS or plain Rust arrays. Rapier is a Rust library, so the death physics come over as-is.
Our TSL shaders become WGSL, which Bevy uses natively. GLB models load directly. `dunes-rs` already ports the ground,
bit for bit.

**Expected frame:** render 1-2 ms and sim 2-4 ms, spread over threads, so about 4-6 ms. That's comfortably under 144 fps
with headroom for co-op and bigger swarms.

**Port effort:** 80,900 lines in `src/`, 18,600 in `tools/` (90 headless checks), 5,600 in 24 labs. Almost nothing
carries over as code: three.js is in 184 files, and the UI (bay, grid inventory, HUDs) needs rewriting in `bevy_ui` or
egui. Agents can rewrite quickly, but **the bottleneck is Keith's time**: the walker, sword poses, weapon feel,
dust and look were all tuned by eye. A rewrite drifts, and every system needs re-checking in game. Realistically
4-8 months before it matches today's game, with few new POIs in that time.

**What's lost and how much it hurts:**
- **Iteration speed (ground rule 1).** Vite reloads in under a second. A Bevy game crate rebuilds in about 2-10 s
  incrementally (with dynamic linking, a fast linker and per-system crates), and more for bigger changes. Bevy's
  hot-patching is still experimental. This is the rule the restart was built on.
- **Lab URLs and live sliders.** Rebuildable: labs become example binaries or a state picker, `?set=` becomes CLI args,
  and sliders become an egui panel. That's a few weeks to get back what `tweaks.ts` and `select.ts` give today, and the
  Report box (screenshot, URL, every value) has to be rebuilt.
- **Browser distribution.** It becomes a download (itch, Steam). That's fine for a PC game, but every playtest needs an
  install.
- **Multiplayer plan.** The plan still holds: commands, events, ids and seeded RNG are engine-neutral, and Rust has
  good netcode crates (`lightyear`, `bevy_replicon`) plus an easy headless dedicated server. Only WebRTC peer to peer
  in the browser goes; native would use UDP or Steam networking.

### C. Bevy to WASM

This keeps browser distribution, but it loses most of B's gain. Multithreaded Bevy in the browser isn't mature: it
needs SharedArrayBuffer and cross-origin isolation, so in practice it runs single-threaded. WASM measured only 1.5× over
our JS on the hottest maths, and JS↔WASM crossings cost extra. The renderer would still beat three's per-object cost, so
render submit drops, but the frame lands about where option A does, for the full port cost. **Worst trade on the list.**

### D. Godot, E. Unity / Unreal, F. Other JS engines

- **Godot 4:** a good native renderer, and MultiMesh suits swarms. But GDScript is slower than our JS for sim code, so
  the sim would be C# (no web export) or C++ GDExtension. The web export is WebGL 2 only. It has the same port cost as
  Bevy and doesn't buy anything Bevy doesn't, and the editor workflow fits agents writing code less well than plain code
  does.
- **Unity (DOTS) / Unreal:** either could hit 144 fps. But the restart happened because Unity's loop slowed changes to
  a crawl (decisions 2026-10-24). Unreal is heavier still, and both are poor fits for agents editing text files.
  Not recommended.
- **Babylon.js / PlayCanvas:** they're in the same JS cost class. Babylon's frozen world matrices and thin instances
  would help, but we can do the same in three (A.2, A.3). Months of re-plumbing for a small gain.

## Points of interest and performance

More interesting POIs are a content question, not an engine one, as long as each POI follows the rules that keep the
frame flat:
- **A POI is a function of position** (it already is: `src/world/pois.ts`), it spawns on approach and goes back to a
  marker when left (`sim-scope.md` opportunities 2 and 3).
- **Its repeated props are instanced or merged** (A.1, A.3), and its static pieces don't update their matrices (A.2).
- **Its sim sleeps until woken**, like camps do.

Built this way, a richer POI costs a few draws, whichever engine draws it. Better POIs can start now on the current
stack, and a port would put them on hold.

## Staged path

1. **Now (Keith away):** A.1 (merge parts per bone, starting with the Rampart and the bandit vehicles), A.2 (static
   matrices) and A.5 (height grid). Each is its own PR with a look check from the game camera and the `?bench` numbers.
   None of this needs Keith's eyes beyond a quick look on return.
2. **Spike (1-2 sessions, prepared now, measured by Keith on his PC):** the same synthetic siege-sized scene, drawn
   two ways:
   - `labs/drawcost/` (three): N objects with the siege's mix (about 200 camera objects, shadows on, 1,000 instanced
     robots, ground chunks from `DuneField`), toggles for per-part vs merged, static matrices on/off, WebGPU vs `?webgl`.
     It reports µs per object and frame ms.
   - `spikes/bevy-drawcost/` (Rust, outside the game's build): the same counts in Bevy native, with the ground from
     `dunes-rs`. One `cargo run --release`, printing the same numbers.
   - **Gate:** if A's best (merged, static) gets the siege's draw cost to about 3 ms or less, stay, with no port. If
     three's per-object floor still leaves the siege above 10 ms after step 1, and Bevy's scene comes in 2× or more
     faster, then plan a Bevy port, one system at a time behind a native "lab" binary. The ground, robot swarm and walker
     would go first, since they're pure maths already checked headless.
3. **Only if the gate says port:** write a separate proposal (rule 9) covering crate layout, how sliders and labs come
   back, and the order of systems. Keep the TS game playable on main until the Rust one matches it.

## Open questions for Keith

- **Default chosen:** stay on three.js and do step 1 now; spike when you're back. Change it if you'd rather start the
  Bevy spike first, or if you'd accept a download-only game for the speed.
- **Is 144 fps a must, or is 100 fps fine with 144 a nice-to-have?** If 144 is a must with 4-player co-op and big
  swarms, native Bevy becomes more likely to be needed later.
