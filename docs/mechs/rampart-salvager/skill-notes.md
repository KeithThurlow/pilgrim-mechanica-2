# Rampart Salvager: skill notes (for the manager to fold into mech-modeling)

1. **Repaint a base by remapping colours in place, before the build.** For a re-brand variant, remap the base module's
   colour constants. Also patch every function's `__defaults__` that holds one of those colours, in `rampart_v4`,
   `rampart` (v1) and `rampart_v2`, and rebuild `PAL`. The details:
   - Defaults bound at def time (`shell(col=KHAKI)`, `region(col=KHAKI)`, `inset(col=KHAKI_D)`, `bricks`) are missed if
     you only patch constants.
   - `shell()`'s own default colour overrides the mass lambda's colour.
   - See `recolour()` and `with_paint()` in `rampart-salvager.py`.

   Kit request: give `rampart_v4` a `PAINT` dict that every builder reads at call time, so variants don't need this.
2. **Paint the weapons a different value from the hull.** One brand colour over hull, legs and guns read as a blob at
   40 m. Charcoal guns with yellow drums fixed it. Rule: the hull and the weapons should differ by at least one value step.
3. **The axis-aligned check catches boxy cabs early.** A cab with near-vertical flanks scored 0.35. Recipe: a belt crease
   in the front profile, with the flank leaning out about 15° below it and tumbling home about 11° above, plus a 5° lean on
   the rear face. That brought it to 0.08, and the crease is a strong light line.
4. **Keep flange hoops out of windows.** `flanges()` on a whole mass draws hoops through glazing cut-outs. Take
   `section_loop` from the mass intersected with a box limited to the gap's extent.
5. **Glazing in an opaque-paint game:** glass is opaque vertex colour.
   - Make windows big (more than half the face plate).
   - Recess the pane about 7 cm behind the plate.
   - Add two lighter diagonal streaks.
   - Glass facing down (chin glass) is invisible from the 50° camera.

   An "open window with the pilot inside" only reads from a straight side view. Don't count on it.
6. **Mirrored arms:** when the game mirrors `Part_Pod_R`, build `Arm_L` as a mirrored copy of the right part (negate
   `co.x`, flip the origin, reverse faces) so renders show both guns. Drop it in `export_split_guns` and give
   `export_gun_points()` only the right gun's empties.
7. **Scratchpad hygiene:** parallel agents share the session scratchpad. Generic names (`r3/`, `patch2.py`,
   `game40.png`) collided with another agent's files. Always work in `<scratchpad>/<variant-id>/`.
8. **The service layer as the scale read:** roof racks, lamp bars, a beacon, a hook and a cage give an industrial mech its
   identity at 10-25 m cheaply (about 2k tris). Put lifting eyes where the convoy crane would pick the mech up (the
   shoulder housings).
