# Skill notes from the Wildcat run (2026-10-24)

Proposed amendments to `.claude/skills/mech-modeling/SKILL.md` and kit helpers for the manager to fold in.

## Recipes that worked

- **A salvage / faction variant can be a post-pass on the base build.** Wrap `rampart_v4.build_parts` (patch
  `R.build_parts`), let it build, then repaint and add to each Part's pieces before the bake. No v4 function is copied,
  the contract is untouched, and the variant is about 500 lines. Patch `K.bake_all` the same way to turn the wear dial
  (`wear`, `dust`) per variant.
- **Repaint a panel by ratio, not by overwrite.** Pick the panel as a loose island of the Plates piece by its world
  centroid (`probe_panels.py` lists them), take its base paint as the *brightest colour covering at least 20% of its
  area* (the outer skin; the largest face may be the inner skin, which made the first pass twice too bright), then scale
  every face by target / base. The painted rim (1.2x), edge band (0.66x), insets and inner skin keep their relations.
- **Place add-ons by ray from far away** (`on(surf, p, along)`: ray from p - 6 along, 12 m long, then
  `Surface.project` at the hit). `H.Surface.project`'s 1.5 m look-back misses whenever the probe point is more than
  1.5 m off the surface. Build the target from several solids (`skin([...])`, committed into one Solid, no boolean)
  so a pauldron in front of the chest is hit first.
- **Mods that read at 40 m sit on top**: from the 50 deg camera, things on the side-box tops (a tyre, sandbags) read
  more than anything on the flanks. Flat patches under about 0.3 m read as colour spots at 25 m; plates of 0.6 m or
  more read as plates.
- **Mismatched pairs** are the clearest salvage cue: repaint one of a pair (one thigh front, one knee cap, one horn, one
  toe cap), never both.
- **Keep spinning guns clean**: the exporter splits the barrel cluster by islands within 0.25 m of the axis ahead of
  y -0.46; keep gun mods (lamps, straps) outside that.

## Kit functions worth adding (in `tools/blender/mechs/variants/rampart-wildcat/`)

- `wildcat_util.islands(bm)`: loose parts of a bmesh (note `bm.faces.index_update()` first; without it every index is
  stale and it returns one face per part).
- In `rampart-wildcat.py`: `repaint(part, centre, col)`, `skin(solids)`, `on(surf, p, along)`, `tframe(n, up, spin)`,
  `scrap_plate(...)` (torch-cut plate, clipped corners, darker cut edges, weld bead round its foot, bolts),
  `stop_sign(...)`, `weld_line(surf, pts, along)` + `zigzag(a, b, amp, n, side)` (stitched crack repairs), `tyre(...)`
  (squarish torus via `V.prim(closed=True)`), `track_section(...)`, `lamp(...)` (housing, glow lens, wire guard),
  `chain(...)`, `strap(...)`. These belong in hskit's mods section next to `sandbag`, `slats`, `tarp`.
- `wildcat_shots.py`: loads a hyphenated variant module under an importable name for `shots.py --model`, plus extra
  shots (`compare_v4`, `top40`, `leg_l_close`, `torso_top`). `shots.py` could accept a file path for `--model` the way
  `export_game.py` does.

## Failure modes to add

- **A ray-placed add-on can land on the wrong facet**: the track section meant for the cannon's outer face landed along
  its outer-back facet. Probe from the face's normal direction, not a world axis, when the part is angled.
- **Mods are cheap per piece but add up**: about 8k triangles for this heavy dial (torso +3.9k). Give the mods layer a
  budget per part (about 1-1.5k) and use 6-8 sided bars.

## Shared-file changes wanted

None required. Nice to have: `shots.py --model` taking a file path; `export_game.py` is fine as is.
