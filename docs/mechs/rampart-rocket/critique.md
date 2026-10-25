# Rampart Rocket: critique

Model: `tools/blender/mechs/variants/rampart-rocket/rampart_rocket.py` (on `rampart_v4`). Game model:
`public/models/mechs/rampart-rocket.glb` (13 meshes, 39,884 tris, 4.2 MB). Renders in this folder (toon look, thin ink,
stance pose unless `_mass`).

## Numbers

| | |
|---|---|
| tris (whole build) | 39.9k: Torso 6.3k, each pod 6.6k (one is mirrored in the game), Pelvis 1.8k, legs 21.4k (v4, unchanged) |
| tris by layer | plates 11.5k, actuation 9.6k, weapon 5.4k (tubes, warheads, the hub caps), service 4.2k, frame 4.2k |
| hskit | 306 booleans, 291 EXACT, 3 fallbacks (v4's legs), **0 skipped cutters** |
| axis-aligned outer plate skin | Torso 0.13, pods 0.13 / 0.14 (v1 of the pod 0.67), Pelvis 0.16, legs ≤ 0.15 |
| knock-knee (legs unchanged) | knees 0.04 m outboard of the hip-ankle line at rest, 0.03-0.04 in the stance |
| export | clean: no non-manifold, boundary or zero-area faces in the new parts; `Part_PodSpin_R` 104 tris (2 islands, the hub cap) |

## The three reads

**Silhouette (40 m, `game40.png` + `game40_x3.png`).** Reads as two tall slab boxes flanking a low wedge with a small
head: clearly a different mech from v4's big-hull minigun Rampart. The glacis V and the dark-dot tube grids are the two
things that survive at 40 m; the open blast doors darken the box tops so each pod reads as "box with a lid up". The hull
is now the least of the three upper masses; at 40 m the pods carry the identity, which is the point of the variant, but
the hull loses some presence against v4's thighs (see worst issue).

**Plates and edges (15-25 m, `zoom10.png`, `q34.png`).** The glacis is one raised plate whose sides run along the wedge's
V (flow seams, not world axes); the cheeks, flanks, deck and back are cut along the station lines. The pod's lip wraps
the front as one raised band whose rear seam leans with the face rake, and the outer side's seam leans the same way.
Chamfers 4-4.5 cm on the lip and glacis catch the key light. Rivet rows along the glacis foot and the stamped stiffener
ribs on the door give the Akiyama "stamped steel" read.

**Detail (10 m, `pod_close.png`, `face_close.png`).** Each tube has a bright collar, a cream face plate round it, a
warhead nose with a rust tip 5-17 cm back; the hub on the outer face has a bolt circle; the reload hatch has a hinge bar,
two latch handles and the round count "12"; the head has three round lens ports (teal, one amber) in a visor slot; the
pilot vision slit is a teal block in the glacis.

## By layer

| Layer | Works | Doesn't |
|---|---|---|
| 0 mass | Wedge (6-station loft, 8 cuts), pod (two-profile intersection, 5 cuts, faces raked and sides leaning 3-4°), head loft. Silhouette settled at the first gate. | The wedge's plan is a little round at 40 m; stronger cheek facets would make it more of a pike. |
| 1 frame | Pilot tub, core column, axle + collar + bolted hub on the hinge axis (Akiyama's "exposed hubs and collars between masses"), pylon foot, the back rack. | The rack's L-brackets are plain prisms; no lightening holes. |
| 2 actuation | Elevation ram under the belly, door struts, hinge knuckles and pin, pipe bundles from the flank scoops into the axle and up the box's inner face, rack hose. | The elevation ram is mostly hidden under the pod belly from the game camera. |
| 3 power | Core cells and shoulder conduits. | Almost invisible: the wedge covers them (a compact torso leaves little room). |
| 4 mounting | Flange hoops under the cheek/flank and glacis/deck seams. | They show only at the 10 m zoom; the wedge's seams are narrow. |
| 5 plates | Glacis (raised, inset, slit), cheeks, sides with trim insets, flanks, chin, deck, spine, back; pod lip, sides, bone top, belly, back; the cream face plate; the trim-brown door. Tonal steps: plating / bone / trim / detail. | The hull is still mostly one khaki; the bone and trim pieces are small. |
| 6 seals | Waist boot, neck boot, shoulder bellows round the axle. | Fine. |
| 7 heat | One feature per mass: the deck louvre bank on the hull, the backblast grille on each pod. | The deck louvres face back, so the game camera rarely sees them. |
| 8 service | Rivets, lifting eyes, unit number "05" on hull flanks and pod sides, "12" on the hatch, hazard bands under the face and on the door, a grab rail. | "05" on the right pod reads mirrored on the game's left pod (geometry mirror). |
| 9 sensors | Head lens ports, vision block, pod sight lens (amber), antenna. No light strips (Akiyama). | |
| 10 mods | None (factory). | |

## Signature form: the launcher box's face

Kept whole: one cream face plate per pod, a 3 x 4 grid bored through it, no seam crossing it, the lip seam going round
it (`face_close.png`, and `q34_mass.png` against `q34.png`). It survived.

## Revision pass (done)

1. Glacis cutters (vision slit, inset) were skipped: `H.Surface.project` casts from 1.5 m above the point and only 3 m
   far, so my projection from z 6 missed the wedge and fell back to the nearest point. Projected from z 5.2: both cut.
2. Pod axis-aligned share 0.67: the sides, top and back were axis-aligned slabs. Leaning the sides 3-4°, dropping the top
   0.08 m to the back and leaning the back brought it to 0.13 with no loss of the "launcher box" read.
3. The face plate and the blast door read as the same khaki as the box: the face plate is now cream (`#C2B595`,
   brought 3 cm forward into the light) and the door trim brown (`#75654A`).
4. In the game the compact hull (back at y 0.80) left the game's power pack (front y 1.10) and drums (front y 1.15)
   hanging in the air (`shots/03-...side...png` before the fix). Added a universal back rack: two L-brackets, a shelf
   bar under the pack, a rail the drums clamp to, clamp blocks and a hose.
5. Trimmed the tube grid (fewer sides on collars, warheads, liners and bores): 7.2k to 6.6k per pod.

## Worst remaining issue

**Triangle count and the dead left pod.** 39.9k against the 25-35k guide; the game draws about the same (it drops
`Part_Pod_L` but mirrors `Part_Pod_R`), and `Part_Pod_L` (6.6k tris, about 0.7 MB) ships in the GLB unused. The legs
are 21k of it (v4). Second: the hull is visually light against v4's thighs at 40 m, and mostly one khaki.
