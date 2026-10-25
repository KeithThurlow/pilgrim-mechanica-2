# Rampart Railgun: skill notes (proposed amendments)

1. **Repainting a variant built on rampart_v4.**
   - Problem: v4 binds its paint tuples as default arguments at import, so `R.KHAKI = ...` misses most of them. That
     includes `shell`, `inset`, and `region` in rampart (v1): region walls take their colour from `HD1.region`'s
     default.
   - Recipe that works: reassign the module constants, and rewrite every function's `__defaults__` that equals an old
     paint value, in both `rampart_v4` and `rampart`. Then mutate `R.PAL` in place and reassign `R.PIPE_COLS`. See
     `_repaint()` in `rampart-railgun.py`.
   - Better for the kit: a `PALETTE` dict in rampart_v4 that functions read at call time.
2. **Brand dials as patches.**
   - No fasteners: set `V.bolt_row` to a no-op.
   - No weathering: wrap `K.bake_all` to force `wear=0` and low dust.
   - Both are worth making `build_full` arguments.
3. **`H.Surface.project(p, along)` has a short reach.** It casts from 1.5 m behind `p` to 1.5 m ahead (3 m in all). On a miss it
   falls back to the nearest point without saying so. Keep probe points within about 1 m of the surface, or the
   projection lands on the widest crease. Kit change worth making: a `reach` argument and a log line on the fallback.
4. **Mirrored gun parts.**
   - Build the right gun once, then mirror its finished layer pieces: `bmesh.ops.scale` with x = -1, then
     `reverse_faces`. Re-fetch the `Color`, `sec` and `flag` layers on the copy, and mirror the origin. See
     `mirror_part()`.
   - Keep text stencils off the gun, since they mirror too.
   - The mirrored part's axis share is not measured and reports 0, so copy the right part's value.
5. **A spin piece for a gun that doesn't spin.**
   - Use a coil ring between the receiver and the shroud, picked by y-range and radius in `export_split_guns`.
   - End any pipe bundle before that y-range, or its clamps get picked into the spinning piece.
6. **Forward barrels at 40 m.**
   - A 0.45 m shroud in a darker paint than the hull reads as a slab from straight above.
   - Value contrast matters more than width. A white hull is close to the sand's value, so the slate shroud and hood
     carry the 40 m read.
   - Add a straight-down 40 m render (`top40`) to the standard set for any long-barrelled weapon.
7. **Light seams (a brand look).**
   - Lay a thin glow bar (radius 0.01-0.012 m, 4 sides) in an existing panel seam, 1 cm under the surface.
   - Run it along the seam's own polyline: `offset_polyline(edge, gap / 2)`, projected onto the mass.
   - It reads at 15-25 m for about 30 triangles a metre, and doesn't cut the plates.
8. **Shared scratchpad.** Parallel agents can share one scratchpad directory, so write into a subfolder named for your
   variant.
9. **Kit helper candidates** (in this module): `mirror_part`, `light_seam`, `_repaint`.
