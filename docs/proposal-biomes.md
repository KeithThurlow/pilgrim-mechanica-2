# Proposal: biomes and blending between them (not built; waiting for Keith)

Keith 2026-10-25: not only desert. Three biomes to start:
- **Desert:** today's dunes.
- **Rocky:** desolate rock.
- **Shallows:** low land under shallow water, with small rocks, outcrops and sandbars. Fun to move across and a chance
  for nice effects.

First job: blend from one biome to the next.

## The rule that stays

The ground is still one pure function of (x, z). Feet, wheels, chunks, AI and the convoy's road all read it, in any
order. Biomes are part of that function, not a separate layer on top.

## How it works

1. **Biome map: `biomeAt(x, z)`.** It returns a weight for each biome; the weights always add up to 1.
   - The map is built from large, warped noise cells, a few hundred metres to a couple of kilometres across.
   - Borders have a soft band (`biomeBlend`, about 80 m). Inside a region the weight is exactly 1, so nothing gets
     blended there.
   - Only one cheap noise lookup per call (plus the warp): `height()` is called a lot.
2. **Each biome has its own height function.**
   - **Desert:** today's dunes, untouched.
   - **Rocky:** eroded rock. Broad shelves and mesa steps, with steep but walkable step faces (capped by a slider).
     Boulder fields and wind-cut ridges.
   - **Shallows:** a low, nearly flat floor just under a water level. Sandbars rise just above it, and small rock
     outcrops poke through.
3. **Blending heights: not a plain average.** Averaging dunes into rock makes mush, so each pair of biomes meets in
   its own way:
   - **Desert to rocky:** the rock rises through the sand. A smooth max of the two height fields, with the rock's
     share set by its weight. Sand fills the hollows and drifts against the rock's windward side, so the edge looks
     like sand banked up against stone rather than a smear.
   - **Desert to shallows:** the dunes shrink and sink toward the water level, so the shoreline falls naturally
     where the sand drops below the water. The last dunes become sandbars.
   - **Rocky to shallows:** the rock steps down into the water. Outcrops keep their tops, so you get rock islands.
4. **Surfaces: `surfaceAt(x, z)`.** Sand, rock, gravel, wet sand or water, worked out from the same weights plus slope
   and height above water.
   - The dust and sand-mark effects already ask for this: gravel throws less dust, there are no prints on rock, wet
     sand gives darker prints, and water gives splashes instead of dust.
5. **Look:**
   - The terrain shader gets each vertex's biome weights.
   - Each pixel blends by height and noise, not linearly: sand settles in the low spots and rock shows on the highs.
     So the borders look ragged and natural rather than smeared.
   - Each biome has its own palette: warm sand; grey and red-brown rock; wet sand and green-tinted shallows.
6. **Water (step 2):**
   - One water surface at the water level, drawn only where the ground is below it.
   - It's tinted deeper and darker with depth, with a foam line at the shore and around rocks.
   - Wading: the mech's feet throw splashes and ripples, vehicles slow down and throw spray, and dust stops.
7. **Outcrops (step 3):** the big ones are part of the height function, so feet stand on them. Small boulders and
   pebbles are seeded instanced scatter per chunk, for looks only.

## Files

- `src/world/biomes.ts`: pure. The biome map, the weights and `surfaceAt`.
- `src/world/rock.ts` and `src/world/shallows.ts`: pure. Each biome's height function.
- `src/world/terrain.ts`: blends the biomes' heights. The dunes' height function stays as it is, and the convoy road
  modifier still applies on top.
- `src/world/chunks.ts`: adds the biome weights attribute and the shader blend.
- `src/world/water.ts` (step 2) and `src/world/scatter.ts` (step 3).
- Lab: the terrain lab gets three things:
  - a biome overlay toggle;
  - `?view=high`, now showing the biome map;
  - a "walk the border" camera.
  
  The walker lab stays on desert unless you set `?biome=mix`.

## Sliders

A "Biomes" topic:
- region size, border width, warp, each biome's share;
- rock: shelf height, step steepness, boulder density;
- water level, sandbar share, outcrop density;
- per-biome colours.

## Checks: `tools/biome-check.ts`

- Deterministic; the weights always add up to 1.
- No height steps across a border: the biggest step between samples 0.1 m apart stays under the dunes' own limit.
- Rocky slopes stay under the cap.
- In the shallows the water is never deeper than the mech's knee, except in marked deep spots, if we want those.
- `height()` cost measured against today.

## Order

1. Biome map, blended heights and blended look in the terrain lab, with no water yet. This is the part Keith asked
   for.
2. Water for the shallows, plus wading effects.
3. Outcrops and boulder scatter, and per-biome dust and marks.

## Questions for Keith

- How big are regions? At 4 m/s the convoy covers 1 km in about 4 minutes. I'd start with regions of about 1–2 km
  and border bands of about 80 m, all on sliders.
- Can the convoy cross the shallows? I'd say yes, slower and throwing spray. Deeper water could later become a
  barrier that the route steers round.
- Should rocky ground ever be impassable cliffs, which would be a reason for the jump later? Or always walkable for
  now? I'd say walkable for now.
