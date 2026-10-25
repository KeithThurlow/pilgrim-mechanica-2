# Mech modelling kits

`tools/blender/mechs/` builds mech parts in Blender 4.4 from Python (`blender -b --factory-startup -P <script> -- args`).
The script is the source; FBX, JSON and renders are generated, never hand-edited.

| File | What |
| --- | --- |
| `hskit.py` | hard-surface kit (2026-10-22): massing + boolean union, boolean carving, strip-modelled plates, welds, construction layers |
| `hs_shots.py` | render suite for the hard-surface pass (before/after, close-ups, edges, technique and layer maps, build-ups, exploded, cutaway, mods dial, full mechs, game camera) |
| `hs_montage.py` | labelled contact sheets from those renders (plain Python with Pillow) |
| `studies/industrial/rescue_hs.py` | industrial rescue mech, hard-surface torso in layers (`MechStudy_Industrial_Rescue_v2*.fbx`) |
| `studies/military/military_hs.py` | lean military mech, hard-surface thighs in layers (`MechStudy_Military_human_v2.fbx`) |
| `hf_kit.py`, `heavy_frame*.py`, `studies/*` | earlier studies (vkit / ikit / mil_kit primitives); hskit builds on them |

Renders: `docs/mech-studies-2026-10-22/hard-surface/`. Regenerate with

    blender -b --factory-startup -P tools/blender/mechs/hs_shots.py -- --out <ABSOLUTE path> --only all
    python tools/blender/mechs/hs_montage.py

(The `--out` path must be absolute: Blender resolves a relative render path against the blend file, not the shell.)

---

## Why (Keith, 2026-10-22)

The first studies started from basic forms and only added chamfers and bevels. Keith asked for more massing, booleans
to join those masses, strip-modelled plates that are then extruded, and welds where curved surfaces meet. He then added
a construction order: the mech is built in layers from the inside out, and the plates should not hide all of it.

## Techniques

Every technique works on an `H.Solid`: a vkit `Piece` at the world origin with two extra face layers. `hs_op` records
which operand a face came from (used to find seams). `hs_tag` records which technique made the face (the technique map
render). Build masses into a Solid with any vkit, ikit or mil_kit primitive, then `H.commit(solid, layer_piece)`.

### 1. Massing + boolean union: `fuse(solids, name, fillet, segments, profile, bead, ...)`

Overlapping closed masses are unioned with Blender's EXACT solver. The seam edges (between faces from different
operands) are found and filleted (`fillet` width, `segments`; 1 = chamfer, 2+ = a round). Then a cleanup: merge by
distance, drop degenerate faces, and a limited dissolve that never crosses a paint section, flag or technique boundary.
- Parameters: `fillet` 0.02-0.05 m reads at toon scale; `segments` 2 for big hull seams, 1 for small parts; `bead` > 0
  adds a weld bead along the seam (see welds).
- Failure modes: non-closed operands (each is healed first: hole fill + normals; logged); an EXACT result that is
  non-manifold (retried hole-tolerant, then self-intersecting, then FAST; each fallback logged and counted). Coplanar
  faces between operands make slivers, so offset masses by a few mm. A fillet that breaks the manifold is undone and
  logged (`bevel_undone`).

### 2. Boolean carving: `carve(solid, cutters, bevel, segments)` plus cutter builders

Cutters are closed prisms. Their faces become the cut walls and floors, keeping the cutter's paint section and colour,
so a recess can expose a darker inner layer. The cut rims are chamfered by `bevel`.
- `cut_rect(c, u, v, n, w, h, depth, corner, slope, mat, col, skew)`: a panel recess or chamfered cut-out (clipped
  corners). `slope` splays the walls, so the cut is wider at the surface: a cast or chamfered look. A depth beyond the
  plate's thickness makes a window.
- `cut_vents(c, u, v, n, w, h, count, gap, depth)`: parallel vent slots.
- `cut_slab(p, n, u, w, h, d)`: a slab under a plane. Tilt `n` to slice a sloped facet; keep `d` shallow for a step.
- `cutter_prism(outline, c, u, v, n, depth, out, slope, steps)`: any CCW outline. `steps=[(h, extra)]` makes terraced
  walls. Outlines are offset with `safe_offset`, which halves an inset until no edge flips (a clipped corner smaller than
  the inset would otherwise fold the cutter).
- Robustness: all cutters are first tried at once. EXACT, then hole-tolerant, then self-intersecting. The result is
  accepted only if it is manifold, the volume did not grow and is above 15% of the original, and a cutter face is
  present. If that fails, cutters go one at a time, EXACT then FAST, and a cutter that still fails is skipped and logged.
- Failure modes: a carve target that intersects itself (see the plate fold guard below); a cutter that only grazes the
  surface (no cutter faces, so it is rejected); a cut through a thin, curved plate going deeper at the edges than in the
  middle (the thigh's recess became a window this way and was kept).

### 3. Strip-modelled plates: `strip_plate(P, surf, path, width, ...)` and `Surface`

`Surface(solid)` is a projection target: the nearest point on a mass (or a hit along a direction), with smooth
interpolated normals. A plate is a strip of quads along `path` (its centre line). The strip is projected onto the
surface, stood off by `off`, and extruded by `thick` with a `ch` chamfer round the top rim.
- `width`: a half width, a `(start, end)` taper, or a callable `s -> (left, right)`.
- `skew=(start, end)`: angled ends.
- `notches=[(s0, s1, side, depth)]`: steps cut out of one edge.
- `crown`: a raised spine.
- `along`: project along one direction (wrapping a side) instead of to the nearest point.
- `n_across` (default: 2, 3 or 4 columns by width) and `row_len` (0.2 m) keep the triangle count down.
- `info={}` returns the plate's underside outline, top rim, centre line and grid. Standoffs, weld beads and stencils use
  these.
- Plates usually go on an envelope mass that is never emitted (the thigh) or on the finished hull (the torso).
- Fold guard: a strong skew on a wide plate wrapped round a curve can fold the strip through itself, which poisons any
  later boolean on it. Each plate is checked for self-intersection with a BVH. A folded plate is rebuilt with half the
  skew, twice, then with none; every retry is logged (`plate_refolds`).

### 4. Welds: `weld(a, b, name, fillet, bead)` and `weld_bead(S, chain, r, pitch)`

`weld` is a union of two distinct curved solids along their intersection, with a fillet and a bead swept along the seam.
The bead is a low tube whose radius ripples every `pitch` metres (stacked weld puddles). It is kept as decor, outside the
manifold, so later booleans on the welded solid stay clean. `weld_bead` also runs a bead round a strip plate's outline
for patches.

### 5. Profile massing: `prism`, `convex_offset`, `intersect`, `xform`, `section_loop` (2026-10-22, skill trial)

Added for the mech-modeling skill's mass layer (first run: `studies/rampart/`).
- `prism(outline, axis, a0, a1, mat, col, name, d=0, flag=0)`: a closed prism from a convex 2D outline across `axis`
  ('x': outline in (y, z); 'y': (x, z); 'z': (x, y)), from a0 to a1 (a0 < a1). `d` grows (+) or shrinks (-) the outline
  and both caps, so the same call with a different `d` is the same mass offset.
- `convex_offset(pts, d)`: the offset as an intersection of shifted half-planes; an inset larger than a short edge (a
  clipped corner) drops the edge instead of folding the outline (a miter offset folds there).
- `intersect(solids, name, fillet=0)`: boolean intersection, pairwise, EXACT then hole-tolerant then FAST; a result is
  accepted when manifold with 0 < volume <= the smallest operand. `fillet` bevels the rims between operands. The hull
  recipe: `intersect([prism(front, "y"), prism(side, "x"), prism(top, "z")])`.
- `xform(S, M)`: transforms a Solid (and decor) in place, normals recalculated.
- `section_loop(S, co, no, n)`: the outline where a plane cuts a Solid, resampled to n points: a rib hoop that follows
  the plates (feed it to `rib_web`).

The recipe built on them (in `studies/rampart/rampart.py`, not yet in the kit): every mass is a function
`mass(d)`, so the plate shell is `carve(mass(0), [mass(-0.06)])`, the rib hoops are `section_loop(mass(-0.085))` and the
frame is `mass(-0.17)` with pockets. A panel is `intersect([shell, region prism])`; the region's walls (face flag) become
the panel's edge band, and only the edges between a wall and the outer skin are chamfered. Seams are the gaps between
regions; raised and inset panels come from shells at other offsets and overlap like shingles.

### 6. Lofts, big ribs, pipes, add-ons and the axis check (2026-10-22, Rampart v3)

- `loft(stations, axis, d, mat, col, name, flag)`: a mass through section stations `[(t, convex outline), ...]` along an
  axis, as the convex hull of every station, so it bulges and tapers between them (barrel thighs, pods). `d` offsets every
  outline and moves the end stations, like `prism`; a station that collapses at that offset is skipped. Fold overshoots
  (a horn or heel spur past a pivot) in as extra stations rather than unioning a separate solid on.
- `flange_web(P, hoops, depth, width, ..., stringers)`: the mounting layer as deep, few flange ribs (feed it
  `section_loop` hoops taken just inside the plates); stringers join matching hoop points.
- `pipe_bundle(P, pts, side, count, r, gap, ..., clamp_every)`: parallel pipes along one route, offset along `side`,
  stepping down in gauge, with clamp straps.
- `addon_bricks(P, c, u, v, n, cols, rows, size, t, gap, ...)` and `tag_faces(S, faces, tag)`, `TAG_ADDON`: purposeful
  rectilinear add-ons (reactive bricks, stowage), tagged so the axis check leaves them out.
- `axis_aligned_share(objs, layer, deg=3, skip_tags=(TAG_ADDON,))`: per part, the share of plate face area within `deg`
  of an axis. **Caveat:** it counts every plate face, including region walls (a plate's edge thickness) and inner skins,
  which are axis-aligned by construction, so it reads high (0.40-0.57 on parts whose outer skin is under 0.15). For the
  skill's 25% check measure the outer skin only, before the construction flags are cleared (`rampart_v3.py`'s
  `panel()` does this) and report both.
- `carve(..., min_keep=0.15)`: the volume floor below which a result counts as a failed solve. A thin plate shell
  (`mass(d1) - mass(d0)`, a few cm) keeps only a few % of a big mass, so shells pass `min_keep=0.01`.

### 7. Flow regions and the stance solve (2026-10-22, Rampart v4)

- `flow_region(outline, origin, u, v, n, a0, a1, ...)`: a panel region drawn in a surface frame (u along the form, v
  across it), extruded along the surface normal. Seams then follow the form (skill f0) instead of world axes. Outlines
  may be concave (an arch, a chevron or V edge): `prism` uses the raw outline when it is not offset. `frame_matrix(o, u,
  v, n)` is the same frame as a 4x4.
- `offset_polyline(pts, d)`: a seam's far edge, so the next panel follows this panel's edge at a constant gap (mitred).
- `solve(residual, x0)`: damped Gauss-Newton with finite differences, for the stance (joint angles that put each ankle on
  a target with the foot flat; the study mirrors its joint empties in mathutils and solves on that).
- `leg_line(hip, knee, ankle, side)`: the knock-knee number (skill 6b): metres the knee sits outboard of the straight
  hip-ankle line at the knee's height, from the front. Negative = knock-kneed. Report it at rest and in the stance.

### Stats and log

`H.report()` returns:
- counts: `booleans`, `exact_ok`, `fallbacks`, `skipped_cutters`, `bevel_undone`, `plate_refolds`;
- every log line (`HSKIT ...` in the console).

The part builders copy these into the export JSON (`"hskit"`).

---

## Construction layers (Keith, 2026-10-22)

`H.Part(name, origin)` holds one rigid part as a set of layer pieces. `part["frame"]` is a vkit Piece named
`<name>__Frame`; any primitive builds into it. Each layer has its own paint section (`LAYER_SECTION`) and a default
colour from `layer_palette(dark, trim, primary, glow, mounting)`, in Keith's value order:

| # | Layer | Section | Value | What |
| --- | --- | --- | --- | --- |
| 1 | frame | dark | dark | the mechanical shape: beams, inner hull, joint drums, the pilot tub |
| 2 | actuation | trim | metallic, a little lighter | servos, rams, pistons, pipes, tubes |
| 3 | power | dark | close to the frame (cool tint) | muscle bundles, cells, cores, conduit; where muscles would be, and in the torso |
| 4 | mounting | sand | light | the spider web of rib hoops, stringers and standoffs the plates bolt to; seen only in gaps |
| 5 | plates | primary (+secondary) | paint, any colour | the armour, attached by standoffs and bolts |
| 6 | seals | tyre | dark, soft, matte | rubber boots, bellows, gaskets covering a joint's bend range |
| 7 | heat | dark (+glow faces) | slightly darker than the frame | fins, louvres, stacks, sinks; emissive faces flagged no-bake |
| 8 | service | trim | metallic | handholds, rungs, lifting eyes, hatches, tie-downs, stencils, sized to a 1.8 m pilot |
| 9 | sensors | glow | glow colour per family | lenses, lamps, antennas, the face |
| 10 | mods | cargo | worn, mismatched | patches, salvaged plates, sandbags, slats, cargo, tarps; dial none / light / heavy |

Field mods dial (`MODS_LEVELS`):
- none: faction clean;
- light: a holdout farm (a mismatched panel and patches with weld beads, a jerrycan);
- heavy: bandits (adds slats, a salvaged plate, sandbags, a tarp).

The torso always has an armoured pilot spot: a frame-layer tub and seat, with the canopy as its exposed face.

Layer helpers in hskit:
- `rib_web(P, hoops, r, diag)`: hoops with stringers and diagonals;
- `standoffs(P, plate_info, surf, every, bolts=plate_piece)`: brackets from a mass up to a plate, bolt heads on the plate;
- `ram(P, a, b, r)`: a lean hydraulic ram, about 100 tris instead of the 500 of `ikit.piston`;
- `bellows(P, a, b, r0, r1, folds)`;
- `rungs(P, a, b, count, n)`;
- `lifting_eye`, `sandbag`, `slats`, `tarp`, `strut`, `ring_tube`, `glow_flag`.

### Damage-state contract (design only, not built in the game)

- Every layer of a part is its own mesh, named `<Part>__<Layer>`: `Part_Torso__Plates` in the industrial study,
  `Thigh_L__Plates` in the military one.
- Each mesh sits under the part's joint empty, with its origin at the joint, so any subset can be shown or hidden without
  moving anything.
- `H.layer_of(name)` gives the layer.
- Each face also carries an `hs_layer` int and an `hs_tag` int as mesh attributes.
- Damage strips layers outside in, in this order (`H.DAMAGE_ORDER`): mods, plates, sensors, service, heat, seals,
  mounting, power, actuation, frame.
- So a damaged part shows its plates gone and the light rib web and machinery underneath. A wrecked part keeps only the
  frame and actuation.
- **For the game-engineer:** today the mech skin builder looks for one mesh per bone. To use these exports it would need
  to gather `<Part>__*` children and toggle them by layer.
- These are plans only: no runtime code, no Unity import.

---

## Reading a reference in layers (Keith: "When we look at a mech model/image, we should be trying to break down all those layers")

Before modelling a part, write down what the reference shows in each layer: what is visible, its shapes, its material
and colour value, where it shows through the plates, and what is absent. The two breakdowns below were written before
the v2 parts were modelled. They describe the references in words only; no reference pixels are kept or shipped.

### Industrial torso: `art-refs/mech-reference/rescue mech.jpg`

| Layer | In the reference | Modelled as |
| --- | --- | --- |
| frame | Dark charcoal (value ~0.15) where it shows: the waist column, a ball joint, the gaps round the shoulders. The torso's own structure is hidden by the shell. | A dark inner hull inside the shell, the waist drum, shoulder socket drums, a spine bar, the pilot tub; seen through the flank and rear windows and the canopy pocket. |
| actuation | Coil-spring dampers under the cab, black corrugated hoses at the elbows and wrists, a shoulder rotation disc. Mostly dark in the reference; nothing bright. | Canopy lift rams and torso-twist rams, flank pipes inside the window, a servo ring, cable looms; lighter metallic, so they read against the frame. |
| power | Not shown. The twin open-top boxes on the back imply an engine or power plant. | Invented: a core drum behind the cab with cells reaching into the rear windows, muscle bundles over the deck to the shoulder housings, a conduit. |
| mounting | Absent: the plates sit flush with dark panel lines; nothing is seen under them. | Invented to Keith's rule: light rib webs in the flank and rear windows, standoffs under the flank plates. |
| plates | Big rounded orange panels with chamfered edges and dark gaps; white and grey bands on shoulders and thighs; an overhanging brow with a vertical face; a raised round boss on top. | A hull massed from overlapping volumes and unioned, a brow mass, keel, rear hump and boss; strip plates on the flanks, cheeks, deck, rear and keel; secondary bands. |
| seals | A black gasket round the canopy; dark joint gaskets. | Canopy gasket, waist and neck bellows, shoulder bellows. |
| heat | Louvred slots on the hip covers; the back boxes' open mouths. | Hump louvres in a carved recess, a heat sink, glowing deck vent bars, stacks with dark mouths and a glow disc. |
| service | Lifting-eye loops on top, small stencils, a star badge. No ladder. | Lifting eyes, a brow grab handle, hatch hinges, tie-downs, a step chevron, and (added for the boarding route) four rungs up the front cheek to the canopy. |
| sensors | A teal dome lens on the boss, round cheek lenses, small indicator lights, a chin camera pod. | Head on the boss with lenses and antenna, indicator lights, four hex lamps in the brow slot, a chin lens. |
| mods / wear | None: clean civilian paint with light edge wear. | Default `none`; `light` and `heavy` exist for the dial. |
| pilot spot | A big teal bubble canopy low on the front, the seat visible through it, framed by the orange ring and the brow. | A canopy pocket cut into the hull with booleans; a smaller glass bubble inside it, so the pocket walls show; the tub and seat behind. |

### Military thigh: the Orion LRAM-82 tile (top left of `art-refs/mech-reference/Pinterest board.png`)

| Layer | In the reference | Modelled as |
| --- | --- | --- |
| frame | A dark gunmetal skeletal thigh bone, visible on the inner and rear thigh; black hip and knee. | A beam fused with the hip drum and a hip clevis, the knee drum welded on with a fillet and bead, lightening slots carved through the bone (seen on the inside). |
| actuation | Blue-anodised hoses and fittings at the hip and pelvis; small pistons behind the plates. | A ram down the back of the thigh, two hose runs on the inside with clamps, tinted toward the reference's blue. |
| power | Dark boxy modules at the pelvis and hip; none clear on the thigh. | Three muscle bundles down the front, under the plates; a cell on the inside. |
| mounting | Not distinct: small brackets and offsets at plate edges. | Three rib hoops with stringers, diagonals and spokes; standoffs under every plate. |
| plates | Tan / khaki, weathered, angular flat plates on the outer and front thigh; a big outer plate angled out; overlapping panels; scratched edges. | An outer plate (notched at the knee, the stencil on it, a recess that became a window, a slot), two front half plates meeting at a ridge, a rear-outer plate, a hip cuff of a collar and flange fused and slotted, the knee cap. |
| seals | The knee is dark; nothing distinct. | A knee boot behind the joint and a hip boot. |
| heat | None on the thigh. | None (the calf heat sink stays on the shin). |
| service | Yellow and black hazard stripes on the shin; small "+" stencils and panel numbers. | A hazard tag on the front plate, two handholds up the outer plate, the "82" / "03" stencil. |
| sensors | Purple glow on the head and arm tool; none on the thigh. | One small status lamp on the hip (purple, the family glow). |
| mods / wear | Worn paint, dirt, scratches; the dark shin against the tan thigh reads as a mismatched panel. | Default `none` (a faction mech); `light` welds a patch on, `heavy` adds a strapped box. |
| pilot spot | Not on the thigh. | n/a |

---

## Adopting hskit in the weapon kit

The weapon-model kit (`pm-weapon-models`) can import `hskit` the way mil_kit imports vkit. hskit is read-only from there
and has no mech-specific state.
- Receivers and housings: `fuse` for the masses, `carve` with `cut_rect` and `cut_vents` for ejection ports, lightening
  cuts and cooling slots.
- Shrouds and armour skins: `strip_plate` over a barrel or drum mass.
- Mounts: `weld` for a drum or mount welded onto a receiver.
- Layers: a weapon can use the same layers (frame = receiver, actuation = bolt and feed, power = cells or ammo, plates
  = shroud, heat = barrel fins, service = handles and sights) if Keith wants them on weapons too.
- Cost: about 0.2-0.5 s per boolean, and EXACT is slow on dense meshes. Keep operands light.
