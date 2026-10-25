# Rampart-Stilt: critique

Final: `public/models/mechs/rampart-stilt.glb`, 26,978 triangles (torso 8.3k, pod 2.7k + spin 0.4k, pelvis 1.8k, per leg
thigh 2.0k, shin 1.3k, cannon 1.9k, foot 1.7k). Booleans 254 at build, 2 thigh-back panels dropped (fixed by removing the
panel: the back chamfer leaves nothing there), 0 skipped cutters in the final run.

Renders here: `side_rest` (the leg's zigzag and the long blade), `front34`, `front_legs` (knock-knee check), `range_leg`
(right leg stretched / folded / rest), `legtech_close`, `zoom10`, `game40` + `game40_crop3x`, `back34`, `layer_map`,
`mass_side` / `mass_front34` (the mass gate). In-game: `shots/0{1,2,3}-walker-...-mech-rampart-stilt*.png`.

## The three reads

- **40 m.** Reads as a different mech from the Rampart at a glance: a compact hull and pod up on two thin pale stilts,
  a much bigger gap of sky between hull and feet. The torso still carries the Rampart family (olive hood, khaki face
  shield). The legs are thin enough that at 40 m they are two pale lines; that is the scout's identity, but the knees and
  feet are the only dark accents on them.
- **15-25 m.** The cannon front plate is the strongest single read on the leg: one long chamfered edge from hock to
  ankle. The thigh glacis's pike edge catches light. The knee servo drums read as the joint. Torso plates and painted
  edges are the Rampart's (mapped), so they read as before, a little steeper.
- **10 m.** Pipes down the thigh back and cannon side, the shin's top ram, the cannon's back-channel rams, the chin
  sensor pod's three amber lenses, the exhausts' glowing ends and the red Suzaku stripe all read.

## By layer

| Layer | Works | Doesn't |
|---|---|---|
| Mass | Old stilt proportions reproduced (femur 1.247, shin 0.820, cannon 1.233 from the empties); the zigzag and high knee match the old strip; legs splay out (never knock-kneed, rest and stance) | The thigh is the plainest mass: five cuts on a tapered loft, reads as a slab from the side |
| Frame | Knee clevis cheeks, side links with slots, hock drum in the blade show | Thigh frame barely shows (plates close round it) |
| Actuation | Rams on lines of force on every leg link; pipes loop at the knee | The thigh's hip ram sits in a shallow recess and is mostly hidden at 25 m |
| Power | Hamstring bundles show in the thigh's knee gap | Cannon bundle is hidden |
| Mounting | Flange in the horn / blade gap | Too small to read in the layer map: the gaps on slim links are narrow. Worth wider gaps or a deeper flange on the thigh |
| Plates | Signature blade plate whole; glacis + knee guard + sides + back on the thigh; KHAKI2 guards on the blade | Thigh side plates are large calm panels with no inset (only the glacis has one) |
| Seals | Hip and knee boots | Small |
| Heat | Twin upswept exhausts: a clear, brand-specific single feature | Exhaust tubes are mapped with the torso, so they lean slightly |
| Service | Stencils on thigh and blade, red chevron, Rampart's lifting eyes and rungs | Stencils only take digits (kit), no Suzaku lettering |
| Sensors | Chin pod (three lenses forward), laser ranger, whips: sensors pushed forward as asked | |

## Checks

- **Signature forms.** The long single-line lower leg survived: the cannon's front is one plate (`cannon_front`, t -0.09
  to 1.10, no cuts), the horn carries the line up past the hock. The face shield (Rampart) is kept whole through the map.
- **Knock knees.** Rest: knee x 0.72, hock 0.77, ankle 0.82 (hip 0.64), knee 0.004 m outboard of the hip-ankle line.
  Stance: ankle |x| at or past knee |x| on both legs (R knee -0.021 m inside its line because the pelvis shifts 0.16 m
  over the planted leg; ankle still outboard of the knee).
- **Range.** `range_leg`: folded (thigh up 45, high knee lift) and stretched (push-off) show no plate passing through a
  neighbour; the shin's knee cap clears the thigh's knee scoop.
- **Axis-aligned plates** (outer skin): thigh 3.2%, shin 0%, cannon 8.6%, foot 14.7%, pelvis 16.2%, pod 22.9% (weapon
  limit 50%); torso 12% measured before the lightening map (all-faces after it 41%, mostly region walls). None flagged.

## Revision pass

Worst issue after the first full build: the knee and hock servo drums stuck out to 0.34 m half width, nearly twice the
thigh's, making a light leg look knock-wheeled from the front. Cheeks moved in (0.155-0.205), knee drum 0.245, servos
0.115 m radius at 0.24, hock servos 0.10 at 0.17. The thigh's empty lower back panel was dropped.

## Worst remaining issue

The thigh is too plain (a slab with one inset from the side and at 15 m). It needs a second shingle on the glacis and an
inset on each side plate, and a wider knee-guard gap so its flange reads. Second: in the game the stand-in power pack and
drums hang at the Rampart's heights, so on this shorter, shallower torso the pack box floats above the hood's back
(`shots/03-...rampart-stilt.png`); the pack should hang from the model (an empty) rather than a fixed offset.
