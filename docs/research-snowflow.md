# Research: Snowflow demo (Noniv/snowflow_demo, MIT), and what we could take from it

Keith 2026-10-25: a WebGPU snow demo with ground deformation and snow-surfing. It inspires deformable ground, and
tracked, walking and hover mechs that each suit different expeditions. Does any of it help us? It's MIT licensed;
we'd take techniques, not code, since it's Babylon.js with hand-written WGSL and we're three.js with TSL.

## What it does that matters to us

1. **A deformation buffer that follows the player** (`src/terrain/deformation.js`,
   `shaders/deformSim.fragment.wgsl`).
   - Two 2048² RGBA16F textures cover 80 m around the player at 3.9 cm per texel. One full-screen pass a frame
     swaps them; there's no readback.
   - The window follows the player toroidally (UV = fract(worldXZ / 80)), so moving never copies the buffer.
     Texels that scroll into view are zeroed.
   - Each frame the pass does four jobs: scroll, relax, splat brushes, clamp.
     - Relax is diffusion: loose berms slump faster than packed floors, wind fills trails back in, and about 71% of
       a trail's depth survives a minute.
     - Splat: up to 96 brushes a frame, each a position, radius, stretch, yaw, depth, berm, compression and seed,
       uploaded as a tiny texture.
   - Channels:
     - depth pushed down;
     - mass piled up (the berms either side: the difference between a trail and a flat decal);
     - compression;
     - ice.
   - It is real displacement in the terrain's vertex shader *and* its shadow passes, so trails self-shadow and berms
     break the silhouette.
2. **The terrain is one static mesh** (a nested clipmap: 8 rings, ~870 m radius, 333k triangles, one draw call).
   - All placement and displacement happen in the vertex shader, so there's no CPU rebuild and no per-frame upload.
   - The height comes from noise baked once into a 4096² texture, mirrored back to the CPU so the character stands on
     exactly what's drawn.
3. **The surf wake is a swept mesh, not particles.**
   - A spine (the board's path, resampled every 30 cm into a 96-point data texture) and a fixed lattice placed in the
     vertex shader. A breaking-wave cross-section with a curl parameter, bigger on the outside of a turn.
   - Two spray populations come off it: a dense curtain at the crest, and grains flung clear.
4. **Water bodies** are the same swept-surface idea, with a foam channel. Refraction comes from one lookup into the
   sky LUT along the refracted ray, three lookups for dispersion, and absorption over the path for the tint. There's
   no scene copy.
5. **Feet plant**, and the gait advances with distance travelled. Our walker already works this way.

## What's usable here, and how

| Idea | Fit for us | How |
| --- | --- | --- |
| A GPU deformation window that follows the player | **High**, for looks | A TSL compute or fullscreen ping-pong pass over a toroidal texture around the camera focus. Chunks displace by it in the vertex shader. Footprints, ruts, track grooves, convoy tracks, dash furrows and small craters become real dents with berms, replacing our flat decals (`sandMarks`). |
| Gameplay-relevant craters | **High**, already planned | Keep them in the CPU ground function (a crater layer like the road and pads), so feet, wheels and AI agree. The GPU window carries the fine detail that only needs to look right. |
| The clipmap terrain | **Medium**, later | It would replace our streamed chunks and their CPU rebuilds: one mesh, the height in the vertex shader. That means the dune function in TSL or baked to a texture window. It's a big rewrite; worth it once deformation and water pile up, not now. |
| Swept-mesh wakes | **High** for tracked and hover mechs, and the convoy | A spine plus a lattice placed in the vertex shader: a bow wave of sand or water off a hover mech, curling berms off tracks, the convoy's crawler plume. |
| Two spray populations | **Medium** | Our dust and water drops could split the same way: a dense curtain at the source, flung grains. |
| Refraction via the sky | Low for now | Our water is shallow and mostly tinted floor; the shore is what matters (below). |

## Water meeting terrain: distance-field tricks (Keith wants a water pass later)

What the shore needs is a **distance to the shoreline**, not just depth:
- **Build it per chunk** when the chunk is built: a small distance transform over the chunk's wet/dry grid, carried
  as a vertex attribute or a small texture, with signed distance in metres.
- **Foam lines** that roll toward the shore (bands of `sin(distance × k − time × speed)`, broken up by noise), fading
  with distance out. That's the classic lapping-shore look, cheap and readable from the high camera.
- **A wet sand band** that darkens and dries as the water laps.
- **Depth tint and clarity** from depth (we have this), plus soft edges from the screen depth where water meets
  rock and mechs.
- **The same field steers effects:** ripples bend and fade near the shore, and spray kicks up where wakes hit
  sandbars.
- Deformation slots in: a crater dug under the waterline floods, and its shore distance updates with the chunk.

## Mech locomotion types (Keith's idea, logged)

| Type | Good at | Bad at |
| --- | --- | --- |
| Walker (today's) | rough rock, steep dunes, stepping over things, stomping | slow, loud |
| Tracked | speed and stability on sand, carrying weight, pushing through | steep slopes, turning in tight spots, deep water |
| Hover | water, shallows and smooth sand at speed, surfing dunes | rock, weight, being knocked about |

Each is a different sim under the same hull and weapon slots. Legs become a "drive" slot: the walker sim today; a
tank-style sim for tracks (the war band's tank already skid-steers); a hover sim with momentum and drift. The
swept-mesh wake is the hover and tracked mechs' signature effect. Biomes then give expeditions a reason to swap
drives.

## Suggested order (Keith to pick)

1. Crater layer in the ground function, with weapons (rockets, mortars). Planned already.
2. A GPU deformation window for footprints, ruts and furrows, replacing the decals: the biggest look-per-effort win.
3. A water shore pass with the distance field: foam lines, wet band, soft edges.
4. Drives: tracked first (it reuses the car sim), then hover with a swept wake.
5. A clipmap terrain if streaming starts to cost.
