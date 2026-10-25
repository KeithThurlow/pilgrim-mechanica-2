# Rampart Rocket: skill notes (amendments proposed for mech-modeling)

1. **`H.Surface.project(p, along=d)` only reaches 3 m.** It casts from `p - 1.5 d` for 3 m and silently falls back to
   the nearest point. Start the projection less than 1.5 m above the surface (z 5.2 for a hull top at 4.5); otherwise
   cutters land off the plate and the carve logs "cutter hit False" and skips them. Add to Known failure modes.
2. **Build once, render many.** `studies/rampart/shots.py` rebuilds the mech for every view (a Blender slot for minutes
   with seven agents queued). `variants/rampart-rocket/shots_rocket.py` builds once and re-points the camera, ground and
   compositor per view: 12 views in about 40 s. Worth folding into `shots.py` as the default; keep debug overlays
   (leg guides) scoped to their own view.
3. **Right-handed frames for hand-built solids on mirrored parts.** For `V.prim(..., M)` and `H.cutter_prism`, pass
   `u = X_` (not `s * X_`), so `u x v = n` on both sides; put the side-dependent order (inner/outer columns) in the
   positions, not in the frame. A mirrored frame flips the winding of hand-built rings.
4. **Machinery boxes: lean the sides 3-4°.** A launcher box with flat axis-aligned sides scored 0.67 on the axis check;
   leaning the sides in 3-4°, dropping the top 8 cm to the back and leaning the back took it to 0.13 and still reads as a
   flat, technical box. Cheap, and it gives every face a slightly different tone under the sun.
5. **A panel in another paint needs its own shell.** `region(..., col)` only colours the region walls (the plate's edge
   band); the skin colour comes from the shell. Build `shell(mass, d0, d1, BONE)` for a bone panel.
6. **Hinged covers shown open.** Build the cover as a slab in a hinge frame (`H.frame_matrix(hinge, X, v, n)`) and open it
   past vertical so it lies back over the top: from the game's 50° camera a forward-swung visor hides the face you want
   seen. Hinge knuckles alternating between the fixed lip (gunmetal) and the door (door paint), a pin through them, and
   two struts make it read as hinged.
7. **The spin contract on a non-spinning weapon.** Put a rotationally symmetric cap (no bolts) on the elevation hinge
   axis and aim `PodSpin_R -> PodSpinFwd_R` along that axis; the game's spin is then invisible. Split it in
   `export_split_guns` by distance to the cap centre plus a max radius, so the hub's bolt circle stays on the pod.
   Put the pod's hinge on the shoulder axis: the game pitches the pod about `UpperArm_R`, so the model's hinge and the
   game's pitch agree.
8. **Compact torsos and the game's back pack.** The game hangs its drums (front face y 1.15, z 3.29-4.01) and stand-in
   power pack (front y 1.10, z 4.40-5.10) at a fixed 1.12 m behind the waist. A hull that ends short of that leaves them
   floating; check the hull's back against those numbers at the mass gate, and bridge the gap with a rack (frame layer)
   if the hull is meant to be short.
9. **Signature face as a separate plate.** A face plate built as its own chamfered slab (rings through `V.prim`) and
   bored with one boolean of N round cutters stays a single, seamless plate by construction, and can take its own colour.
   Keep it 3-5 cm behind the lip so the lip's thickness shows, but not deeper or the recess shadows it at 40 m.

## Helpers in this variant worth folding into the kit

- `door_solid` / `door_M` (a hinged slab in a hinge frame, open angle as a parameter).
- `face_plate` (a chamfered plate bored with a grid of round cutters) and `tube_points` (grid positions in firing order).
- `back_rack` (L-brackets plus rails to a fixed attach zone).
- `shots_rocket.py` (build once, render many).
