# Skill notes from the rampart-turret run

Proposed amendments to `.claude/skills/mech-modeling/SKILL.md`:

1. **Overlapping panels are fine when their shells differ.** Panels cut from shells at different outer offsets (glacis
   +0.06, cheeks +0.04, sides 0, roof -0.02) may overlap freely: the higher one shingles over the lower one, no z-fight.
   Only panels from the *same* shell need disjoint regions. This made region design much faster than partitioning exactly.
2. **Regions in the signature plate's own frame.** Drawing the glacis, cheek and side seams as `flow_region`s in the
   glacis frame (u across, v up the slope) gives seams that follow the main form, and the side seam becomes the plane
   `v = const`, which leans back going down with the glacis. Use `H.intersect([flow_region, plan prism])` to limit a
   region in a second direction.
3. **Ribs only read if the seam is wider than the rib is deep.** A 4.5 cm seam over a flange 7.5 cm down shows nothing.
   8-12 cm seams with the flange taken at `mass(-0.045)` from the *cut* mass (so it follows chamfers and does not poke
   out) read at 25 m. Check with the layer map before calling a part done: "all plate colour" means it's a closed shell.
4. **Axis check catches flat roofs.** A roof sloped 2.6 degrees counts as axis-aligned and pushed the torso to 0.29.
   Crown the roof (front profile ridge) and lean vertical sides a few degrees; remember the roof is `min()` of the
   profiles in an intersect, so crown the profile that is actually lowest.
5. **Brand repaint by chromaticity.** To repaint a base mech (v4's khaki) into a brand palette, remap loop colours by
   chromaticity before the bake: rim and wall tints (colour x k) map to new colour x k, so painted edges survive. Helper
   `brand_paint()` in `variants/rampart-turret/rampart-turret.py`; worth a kit function (`H.repaint(pieces, mapping)`).
6. **Mirrored left pod for renders.** The game ignores the left arm; build it as the right arm mirrored (negate x, reverse
   faces, rename pieces) for renders and drop it when `export_game` is the running script (saves about 3k tris in the GLB).
   Helper `arm_l_mirror()`; a variant should also define `export_gun_points()` so v4's rocket muzzles aren't exported.
7. **Measure the game's back kit before shaping the rear.** From `rampart.ts` and the drum GLB: drums occupy y 1.15-1.97,
   z 3.29-4.01, |x| < 0.99; the power pack y 1.10-1.85, z 4.40-5.10, |x| < 0.78 (Blender coords). Worth putting in the
   skill's contract section.
8. **shots.py `--model` takes a module name**, so a hyphenated variant file can't be imported; load it with
   `importlib.util.spec_from_file_location` and register it in `sys.modules` before calling the shots helpers
   (`variants/rampart-turret/shots_turret.py` does this, plus extra views: cheek, roof, rear, under, game40_crop).

## Shared-file requests (for the manager)

- `src/mech/rampart.ts`: the back drums are tinted `0x8b9160` (Rampart olive) and the stand-in pack is khaki for every
  variant; a per-variant tint (or the modelled pack) would stop the clash with this variant's grey.
- `hskit`: fold in `brand_paint` (repaint) and a mirrored-part helper.
