# Rampart "Wildcat": critique

Claude (mech-modeler agent), 2026-10-24. Renders in this folder (Blender toon look, thin ink); in-game shots
`ingame_*.png` (walker lab, `?mech=rampart-wildcat`, headless WebGL).

## The three reads

**Silhouette (40 m)** (`game40_crop.png`, `ingame_game40_fire.png`). Still a Rampart: same legs, hull, hood and twin
guns; the face shield's U is intact (`mass_vs_final.png`). What the scrap adds to the outline is small and on purpose:
the tyre and the sandbag pile on the side-box tops (the 50 deg camera sees them), the antenna, the crotch tyre and the
right thigh's rusted skirt. At 40 m the variant mostly reads through colour: blue, yellow and primer panels against the
khaki, which is the strongest "rebuilt from parts" cue there. Risk: the patchwork also reads as a little toy-like in the
Blender toon renders; under the game's plain lit paint and harsh sun it is calmer (`ingame_close.png`).

**Plates and edges (15-25 m)** (`plates_close.png`, `ref.png`, `zoom10.png`). Repainted panels keep v4's painted rim
and edge band, so they read as real plates that were swapped, not as decals. Welded scrap plates show their thickness
(darker torch-cut edges) and a bead round the foot. The blue right thigh against the khaki left one is the clearest
"limb plate that does not match its pair". Weakest here: most scrap plates are 0.2-0.3 m, so at 25 m they read as
colour spots rather than plates; the corrugated thigh skirt (0.62 x 0.86 m) is the size that works.

**Detail (10 m)** (`leg_l_close.png`, `torso_top.png`, `ingame_zoom12.png`). Weld-stitched cracks, the painted-out
"01" with the donor's "27", strap bands and a lamp on the gun, the lamp bar, the fishbone antenna, chains, sandbag
straps. The track section hangs down the back-outer edge of the left cannon rather than flat on its outer face (the
ray hits the cannon's outer-back facet); it reads as a track skirt from behind and the side.

## By layer

| Layer | Works | Doesn't |
|---|---|---|
| 0-4, 6-8 | v4's, unchanged (contract kept: same joints, leg check 0.04 m outboard, PodSpin split 360 tris as v4) | v4's own issues stand (torso axis-aligned plate share 0.29 > 0.25, 1 non-manifold edge each in cannons and pelvis, inherited) |
| 5 plates | 16 panels repainted in four salvage paints, never as matched pairs; rims and insets keep their relation | no new plate geometry: replaced plates are the same shape as v4's (a different-shaped replacement plate would say more) |
| 9 sensors | five extra lamps with guards: night work | lamp lenses are small at 40 m |
| 10 mods | heavy and purposeful: spaced armour (tyres, sandbags, sheet skirt, slat cage, track), welded patches, crack welds, stop sign, antenna | adds about 8k triangles (v4 34.6k -> 42.7k in the export; torso 8.1k -> 12.0k, over the 9k guide) |
| wear | chipped chamfers and dust doubled in the bake | chips only hit small chamfer faces, so big panels stay clean: still "maintained", but heavy wear is mostly carried by the patchwork, not the paint |

## Revision pass

Worst issue after the first build: the scrap read only as small coloured spots and the add-ons did nothing for the
40 m outline. Fixes: sandbags enlarged and stacked (five, 0.50 m), a big corrugated sheet skirt on brackets off the
right thigh, a second scrap plate on the right cheek, two more mismatched panels. Earlier fixes: repaint factor taken
from the panel's brightest common colour (the first pass scaled from the inner skin and came out twice too bright);
v4's "01" painted out under the donor's "27" (they overlapped).

## Worst remaining issue

Triangle cost of the mods layer on the torso (12k vs a 9k guide). Cheapest cuts: lamp housings 10 -> 8 sides, weld
bead pitch 0.045 -> 0.07 on the short cracks, the antenna crossbars at 3 sides.

## Signature form

The face shield survived whole: same outline and seams as v4 (`mass_vs_final.png`), one primer patch welded on its
left leg, nothing cut through it.
