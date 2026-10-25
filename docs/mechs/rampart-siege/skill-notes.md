# Rampart Siege: skill notes (for the manager to fold into mech-modeling)

1. **Reuse a Rampart part by transforming it, not rewriting it.** A whole finished `H.Part` can be moved with a
   linear map on its pieces' verts (they are stored relative to the origin) and an affine map on the origin
   (`xform_part(part, lin, aff)` in `rampart_siege.py`). The siege hull is `rampart_v4.torso()` built in its own
   frame (a context manager swaps `rampart_v4`'s joint constants back while it builds) and then scaled x1.12 / z0.88
   and dropped. Cheap and robust for hull and pelvis; don't do it for anything with joint drums across the scaled axes
   (non-uniform scale makes them ellipses), so legs need their own masses.
2. **A variant's `@cached` masses need their own cache.** `rampart_v4.cached` keys on the function name, so a variant
   redefining `thigh_mass` with the same name would share entries with the base. Give each variant module its own
   `CACHE`.
3. **Panels need a region that cuts every edge to get chamfered rims.** A region bigger than the solid (a flat skirt or
   add-on plate inside a big rect) intersects to the solid unchanged and no rim is chamfered. Use the solid's own
   outline inset by ~1 cm (`H.convex_offset(outline, -0.012)`, clipped to the panel's band with a small
   Sutherland-Hodgman `clip_z`) as the region.
4. **Flat hung plates fail the axis check unless they lean.** A tank skirt hung straight scored 0.32 on the thigh. A
   4 deg flare (bottom out) plus a 6 deg toe-in (front edge tucked in) brought it to 0.06 and is also the right tank
   logic: a level shot from ahead glances off. Rule of thumb: any hung plate leans >= 4 deg in two axes.
5. **The bone frame's x is world +X on both legs** (`link_frame`), so "outer side" in a shin or cannon frame is
   `s * x`, not `x`. The Rampart's cannon stencil sits on the right leg's inner side because of this.
6. **Mirrored pods mirror stencils.** The game mirrors `Part_Pod_R` onto the left shoulder, so digits on a pod read
   backwards on one side. Use symmetric marks on pods (a brand chevron, bars, hazard bands); keep numbers on parts the
   game builds for both sides.
7. **Non-spinning gun hook recipe.** Make the spinning piece a few loose islands in a narrow y window round the axis
   (here a recoil collar: ring + 6 lugs, 164 tris) and make sure no other island's centroid falls in that window (a
   barrel clamp band at the same y would have been picked). In `export_split_guns` also drop `Arm_L` (`parts.pop`) when
   the left pod is only a render mirror.
8. **Deleting part of a layer: delete whole loose parts.** Removing faces by centroid height left 5 boundary edges on
   the torso; flood-fill islands first, then drop islands above the cut.
9. **The scratchpad can be shared between parallel agents.** Another agent's renders landed in my `r5/` and my `r1/`
   disappeared. Prefix scratch folders with the variant id (`siege_final/`) and check renders before copying them.
10. **Proportion recipe for a heavy walker** (legs.heavywalker, thighBulk 1.8): hip 0.89x the Rampart's (2.72 vs 3.05), hips 18% wider, thigh section ~1.0 x 1.1 m (about 1.25x the Rampart's area), femur 0.84x,
    cannon 0.78x, ankle higher (0.32) for a taller, broader foot. Keep the knee >= 0.03 m outboard of the hip-ankle line.
11. **In-game stance width must follow the hips.** With the Rampart's leg type, walkSpread 0.66 put the feet inside the
    siege's 0.92 m hips; walkSpread 0.95 / footSpread 1.2 looked right in the lab. A wider-hipped variant needs its own
    `LEG_TYPES` entry, not just measured bone lengths.
12. **Kit candidates:** `xform_part`, `mirror_part` (a part mirrored across x = 0 with faces flipped and the piece layer
    handles rebound), `clip_z`, `vmark` (a two-bar painted chevron) from `rampart_siege.py`.
