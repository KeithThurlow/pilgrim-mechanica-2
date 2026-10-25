# Rampart-Stilt: skill notes (proposed amendments)

1. **A lightening map instead of a rebuild.** A variant that keeps a mech's family but changes its weight can pass the
   finished part (every layer piece) through one smooth point map, `torso_D(p)`: per-axis scales about the joint, a
   taper with height and a drop of the rear top. Plates, seams, painted edges and the signature form all survive,
   because the map runs after the panels are cut. Keep the joint point fixed by the map, keep the map gentle (non-planar
   n-gons get triangulated by the export anyway), and move attached parts rigidly by the map's displacement at their
   joint (`DELTA` for the gun arm, the export's gun points follow). Helpers `deform_piece` / `deform_part` in
   `variants/rampart-stilt/rampart-stilt.py` are worth folding into hskit. Caveat: the axis-aligned check (measured in
   `panel()`) is taken before the map.
2. **Scaling a machine foot.** The Rampart foot can be reused at any size by building it at its own ankle height and
   scaling about (ankle x, ankle y, ground): x, y free, z = new ankle height / built ankle height, so the ankle drum stays
   on the ankle joint. The toe hinge and toe length for `LEG_TYPES` then scale with y.
3. **Old lab leg values convert directly.** Lab x (game hip / lab hip) gives femur, shin and cannon; solve the joint
   positions so the chain stays digitigrade (knee forward, hock behind the ankle) with the cannon rake you want. For
   stilt values (short shin, long cannon, hip 3.05) the shin comes out kicked back ~57 degrees from vertical: the old
   strip's look. "Reads as one long lower leg" is then carried by the blade itself: carry the cannon past the hock as a
   horn along its own line (not angled back as on the Rampart) and keep its front one plate.
4. **Bone-frame panels for slim links.** On links under 0.45 m wide, front / side / back region prisms in the bone frame
   (`bone_region(M, x0, x1, q0, q1, t0, t1)`) cut cleanly; leave the side regions short of the back chamfer (q < 0.10)
   and the back region from q 0.14, or the panels meet on the corner. Check that a back panel still has skin after the
   back chamfer slab (an empty intersect costs three failed solver passes).
5. **Joint hardware scales with the link, not the mech.** Rampart-sized knee drums and servos on a 0.44 m thigh read as
   wheels from the front. Rule of thumb: servo outer face within 1.1x the link's half width.
6. **Kit gap:** `K.stencil` has digits only, so brand lettering (Suzaku "SZ") can't be stencilled; a few letters would
   help brands read.
7. **Shots wrapper.** A variant can reuse `studies/rampart/shots.py` unchanged by putting its own folder on `sys.path`
   and calling `shots.main()`; extra shots (side ortho, a range sheet that rotates the joint empties of copies) go in
   the wrapper (`variants/rampart-stilt/stilt_shots.py`).
