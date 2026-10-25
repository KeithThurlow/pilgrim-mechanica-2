# Rampart Railgun: critique

The renders in this folder come from `tools/blender/mechs/variants/rampart-railgun/shots_rg.py` with the thin ink, in
the stance pose unless noted. The `0?-walker-*` PNGs are headless walker-lab shots of the exported GLB
(`?mech=rampart-railgun`). There are no reference pixels in this folder.

## The three reads

**Silhouette (40 m)** (`game40.png`, `game40_x3.png`, `top40_x3.png`, `mass_game40_x3.png`, `02-walker-cam-game...png`).
- Works: the two guns read as long slate bars ahead of a white hull, clearly heavier than the minigun's barrel cluster.
  From straight above they are slabs with a mass at the receiver, not sticks, so the skill's failure mode is avoided by
  the 0.47 m shroud.
- Works: the slate shroud and hood give the value contrast against the sand that the white alone would not. The white
  is close to the sand in value, and the cool hue does the rest.
- Works: the mass gate and the final model have the same outline.
- Doesn't work: the bare rails and the brace past the shroud are only a few pixels across at 40 m. The gun's length
  reads, but its tip does not. The muzzle flash covers that in play.

**Plates and edges (15-25 m)** (`zoom10.png`, `chest_close.png`, `gun_close.png`).
- Works: long calm white plates with painted rims.
- Works: teal light seams (round the face shield, along the hood spine, in the shroud's crease and on the crest fins)
  give the Novus-Lux light-seam look without any texture.
- Works: the visor slit replaces the boxy vision block and gives the face one glowing line.
- Works: the shroud is one plate over its top and shoulders.
- Doesn't work: the legs keep v4's military dressing (thigh add-on bricks, "01" stencils, the red band and the
  roundel), which fights the brand. The brief said to keep the legs, so I only repainted them.

**Detail (10 m)** (`gun_close.png`, `gun_side.png`, `gun_top.png`).
- Works: the capacitor bay (2 x 5 cells with lit teal caps) is the gun's best detail.
- Works: the coil ring with its teal band; the copper bore liners and the ceramic insulators on the bare rails; the
  brace and its stays; the fin stack on the receiver's back with an orange floor; the windows onto the rails and the
  flange ribs.
- Doesn't work: the shroud's side vent reads as one orange block, not slats. The slots sit close together and the glow
  floor shows through all of them.
- Doesn't work: the heat read is strong at 10 m and gone at 40 m.

## By layer

| Layer | Verdict |
|---|---|
| Frame | Navy undersuit, darker than everything else. Reads in every gap without turning into a hole. |
| Actuation | v4's legs. The gun's elevation ram and twin recoil buffers under the receiver read in the side view. |
| Power | The capacitor banks are the gun's signature detail. The conduit down the boom is mostly hidden. |
| Mounting | Flange hoops inside the shroud show through the windows; v4's elsewhere. The lavender-white reads light. |
| Plates | White, periwinkle and slate, no rivets. Axis-aligned share of the outer skin: Torso 0.12, Arm_R 0.085, Thigh 0.08, Pelvis 0.16, Foot 0.15, Meta 0.04, Shin 0.0. No part is flagged. Arm_L reports 0.0 because it is a mirrored copy and isn't measured; it equals Arm_R. |
| Seals | v4's boots, plus one at the boom root. |
| Heat | The guns' vents and fin stack, and the hull's rear louvres. The orange glow against the brand's teal is deliberate: it says "this gets hot". |
| Service | Bolt rows suppressed (brand: no visible fasteners). Rungs and lifting eyes kept for scale. |
| Sensors | Teal visor, brow lenses, rangefinders and the light seams. |
| Mods / wear | None: wear 0 and dust 0.08 in the bake. |

## Signature form

The shroud line survived whole. It is one slate plate from the coil ring to the nose facet (`gun_top.png`); the
windows and vents sit in the white side plates under its crease, and no seam crosses it. The Rampart's own face shield
is also kept whole.

## Revision pass

1. **Windows, vents and heat floor misplaced.** This was the worst issue after the first full render: the shroud's
   windows and vents didn't show, and the heat floor sat at the crease.
   - Cause: `H.Surface.project(p, along)` casts only from 1.5 m behind `p`, 3 m long. My probe points were 2 m out, so
     the ray missed and silently fell back to the nearest point (the widest crease).
   - Fix: probes moved to 0.7 m out. The windows, vents, the crease light seam and the fin light seams now land where
     intended.
2. **Fin-stack floor buried.** Its orange floor sat under the recess floor plate. It is now raised above that plate,
   and the fins stand proud of the top.
3. **Two small fixes.**
   - A slate band floated off the receiver's tapered tail; it now sits on the surface.
   - The coolant bundle ended inside the y-range the export splits off as the spinning coil ring, so one of its clamps
     could have been split into the spinning piece. It now ends at the receiver face.

## Worst remaining issue

The legs' v4 military dressing (bricks, stencils, roundel) clashes with the Novus-Lux hull. The next step is a
leg-dressing pass that swaps the thigh bricks for a swept periwinkle shingle and drops the stencils. That needs either
copies of v4's thigh and meta functions in this module or hooks in rampart_v4. In the game, the shared olive back drums
and power pack also clash.

## Stats

- **Build:** 37.4k triangles in total. Torso 7.6k, each gun 4.8k, each leg 9.0-9.1k including the foot.
- **GLB:** 37,358 triangles over 13 meshes. Part_Pod_L (4.9k) is not used by the game, so about 32.4k are on screen.
  `Part_PodSpin_R` (the coil ring) is 436 triangles.
- **Booleans:** 0 skipped cutters, and a few fallbacks from v4's `pod_up` carve, unchanged from v4.
- **Legs:** the knee sits 0.04 m outboard of the hip-ankle line at rest and 0.03-0.04 m in the stance, so not
  knock-kneed (v4's legs).
