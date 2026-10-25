# Rampart turret: critique

Build: `tools/blender/mechs/variants/rampart-turret/rampart-turret.py` (on `rampart_v4`), renders by `shots_turret.py`.
Game model `public/models/mechs/rampart-turret.glb`: 31,122 tris (torso 7,588), 12 meshes, contract intact (all part
meshes, joint empties, the minigun's PodSpin/PodSpinFwd/PodMuzzle0/PodEject; v4's rocket-tube muzzles dropped). Every
exported part 0 non-manifold, 0 boundary edges after the clean. hskit: 0 skipped cutters, 0 undone bevels, 0 refolds
(fallbacks only on the boolean solver order, all accepted).

## The three reads

**Silhouette (40 m)** (`mass_game40_crop`, `game40_crop`, in-game `?cam=game`). A low, long turret with an arrow nose in
plan; from above it reads as a tank turret between two gun pods, clearly not the Rampart's hunched hull. Height drops from
5.2 m to about 4.95 m (sights), turret roof 4.8 m, turret 2.1 x 2.7 x 1.0 m. Works. Weak spot: from straight above the
roof is one calm grey field; the hatches, sights and the 12 cm ring seam carry it, but it's quieter than the v4 hull.

**Plates and edges (15-25 m)** (`q34`, `turret_close`, `zoom10`). The dark gunmetal glacis wedge between the two pale
cheeks is the strongest read on the mech and survived whole (`mass_vs_final`): one plate, the red stripe inset inside it,
seams only round its edge, wrapping over the lip. Cheeks are raised a step over the sides, so the cheek/side seam reads
as a shingle; the 2 x 2 reactive bricks on each plan-angled cheek face and the 2 x 1 on the flank say "front armour".
Tank logic holds: glacis thickest and highest (-0.11..+0.06), cheeks thick, sides normal, roof and bustle thin. Outer-skin
axis-aligned share: torso 0.106 after the crowned roof and leaned sides (was 0.293: the first roof sloped under 3 degrees).

**Detail (10 m)** (`roof_close`, `cheek_close`, `rear_close`). The face is three amber lenses in a dark glass band under
the glacis lip (protected under the overhang). Roof: gunner's sight doghouse, commander's independent viewer, commander's
hatch in a well ringed by five periscopes, loader's hatch, laser-warning domes, lifting eyes, antennas, wind mast, louvres
in the bustle chamfer. Smoke dischargers on the cheek top-sides. Stencil "07" on the cheeks.

## By layer

| Layer | Works | Doesn't |
|---|---|---|
| Frame | the ring/basket under the turret with lightening pockets reads as "turret on a ring" and gives traverse room | the turret's inner tub is barely seen (only at the seams); the pelvis's dark core now shows from behind (v4 hid it under the rear hull) |
| Actuation | bright race lip, traverse drives, pipe bundles under the overhang, a pipe pair clipped along the y 0.60 seam | most of it sits under the turret, only seen from low angles |
| Power | conduits from the bustle underside round to the shoulders | hidden from the game camera |
| Mounting | two deep flanges in wide seams (8 cm slanted, 12 cm ring); the ring at y 0.60 shows on roof and sides (`rear_close`) | the slanted cheek/side seam's flange is hard to see from the front |
| Plates | glacis, cheeks, roof, sides, bustle, lower front band; bricks; insets for tonal variation | roof could take one more inset or shingle |
| Seals | waist boot, pod bellows | |
| Heat | one louvre bank in the bustle chamfer | small; the game's power pack sits right behind it |
| Service | hatches, eyes, rungs, smoke dischargers, stencils | |
| Sensors | lens band under the lip, sights, periscopes, LWR domes, antennas | |
| Mods | none (clean pre-war relic) | |

Value order checks out in `layer_map` / `layers_exploded`: frame dark, actuation lighter, ribs light, plates paint.

## Revision pass done

Worst issue after the first full build: the turret was a closed shell, nothing of the inner layers showed (`layer_map` all
plate). Fixed by widening the two hoop seams (cheek ≤ v 0.38 / side ≥ v 0.47; side and roof end y 0.54, bustle and rear roof
start y 0.66), moving the flanges up to `mass(-0.045)` taken from the *cut* mass (so they follow the bustle chamfer), and
running clipped pipes along the ring seam. Second: the glacis first covered the full front width and hid the cheeks; narrowed
to a wedge (±0.40 at the lip to ±0.62 at the crease) so the cheeks read as separate armour blocks.

## Worst remaining

1. In game the stand-in back kit (khaki power pack boxes, olive-tinted drums from `rampart.ts`) clashes with the
   Stratford-Aegis grey; it sits against the bustle well in size and place.
2. The legs and pelvis are v4's, repainted, not thickened: the heavier top would carry better with a thigh skirt plate.
3. The gap under the turret (ring, pelvis top) is dark and busy from low side views.

## Checks

Never knock-kneed (v4 legs): knee outboard of the hip-ankle line 0.04 m at rest, 0.038 / 0.030 in the stance (`front_legs`).
Gun clearance: cheeks stop at |x| 1.06; at the 30 degree inward arc the hub comes to x 1.32. Back room: bustle ends at
y 1.02, the game's pack starts at 1.10. Walker lab: `shots/0{1-4}-walker-*-mech-rampart-turret*.png`, no console errors,
reach misses 0-0.27%.
