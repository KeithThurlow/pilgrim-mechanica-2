# Rampart-Stilt: breakdown (before code)

Variant id `rampart-stilt`. The Rampart on the old game's **stilt legs**, a light fast scout. Brand flavour: Suzaku
Dynamics, "The High-Revving Scout" (motorcycle-derived, ultra-light alloys, tightly coiled suspension, engines that run
hot and whine; a glass cannon built for evasion and repositioning).

Sources: the old part `legs.stilt` ("a short shin over a long cannon that reads as one long lower leg, small feet and a
high knee lift: quick and quiet, easy to push around"), its lab values, the old stilt walk strip
(`docs/walker-mechanical-2026-10-19/strip-Stilt.png`: a high thigh, a short shin kicked back almost level, a long near
vertical cannon), the mech-reference Pinterest board (the lanky "Orion" walker and the tall olive walker: thin long
lower legs under a compact hull), house style notes (real-robot, chunky over lean, markings). No 3D reference: built
from the Rampart v4 and the lab numbers.

## Proportions (game metres; lab x 0.693)

| | Old lab | Here | Rampart v4 |
|---|---|---|---|
| Hip height | 4.42 | 3.05 (same hull height) | 3.05 |
| Hip half width | 1.0 lab | 0.64 | 0.78 |
| Femur | 1.80 | 1.25 | 1.72 |
| Shin | 1.17 | 0.82 | 0.75 |
| Cannon (meta) | 1.80 | 1.24 (+0.42 horn past the hock) | 1.08 |
| Foot plate | 0.5 / toe 0.22 | about 0.36 wide x 0.88 long | 0.6 x 1.5 |

Joints, hip-local (x outward, y back, z up): knee (0.08, -0.33, -1.20) at world z 1.85, hock (0.13, 0.36, -1.64) at
z 1.41, ankle (0.18, 0.04, -2.83) at z 0.22. The chain stays digitigrade (knee forward, hock back) as the walker needs;
the cannon rakes about 15 degrees back. A 1.8 m pilot stands to just under the knee: the knee is high.

## Signature forms (step 7b)

1. **The long single-line lower leg.** The cannon is one long, slim blade from the heel spur up past the hock as a
   horn to about knee height (1.65 m of uninterrupted line); its front is **one plate** from the hock drum to the ankle,
   no seam across it. The short shin plugs into it from the knee like a bird's.
2. **The Rampart face shield** (the upside-down U), kept whole from v4 so the family reads.

## Mass list

- **Torso:** the Rampart's chest, rear hull, hood and pauldrons, reshaped as one lightening map (not rebuilt): 0.86x
  narrower at the waist tapering to 0.78x at the top (sloped sides), rear hull 0.74x as deep, 0.90x as tall, the top of
  the rear dropped toward the back (a wedge sloping off backwards), nose pushed 4% forward. Add-on reactive bricks
  removed (a glass cannon carries no reactive armour). Leaves the 1.1 m behind the waist clear for the game's drums.
- **Sensors forward:** a chin sensor pod under the nose (three lenses in a hooded housing), whip antennas, a laser
  ranger on the right pauldron.
- **Heat (one strong feature):** twin upswept motorcycle exhausts out of the rear hull's top corners, glowing ends.
- **Pelvis:** the Rampart's, 0.82x narrower (hips at 0.64).
- **Thigh:** a slim tapered loft along the bone (0.44 wide, 0.50 deep), a hip housing carried above the hip drum, a
  pike front; cuts: outer ram recess, knee scoop, back chamfer, hip-front chamfer, inner hip scoop.
- **Shin:** a short flat-sided link (machinery), knee cap disc, hock drum; flat side links with lightening slots.
- **Cannon:** a loft along the bone through 9 stations from the horn (0.42 past the hock) to a heel spur past the ankle;
  cuts: a back channel (rams), side recesses, horn wedge, heel step.
- **Foot:** the Rampart's machine foot (two splayed toes with a split, hinges, rams, heel spur, tread) scaled down to a
  small plate foot about the ankle point.
- **Gun pods:** the Rampart's minigun arm unchanged, moved in with the narrower shoulders. Left arm not built (the game
  mirrors the right pod).

## Layers

| Layer | Visible where | Notes |
|---|---|---|
| Frame | thigh core in the gaps, shin side links, cannon spine, knee and hock drums | dark olive, lightening pockets |
| Actuation | thigh ram in the outer recess, twin rams down the cannon's back channel, hock and knee servos, ankle rams | a step lighter |
| Power | hamstring bundles behind the thigh, cannon side bundles | dark, cool |
| Mounting | flange hoops in the thigh's front gap and the cannon's horn/blade gap | light, deep and few |
| Plates | shaped from the masses; tank logic: fronts raised and thickest | see the plate map |
| Seals | hip and knee bellows, tread pads | mid grey |
| Heat | the exhausts | glow ends |
| Service | stencils, a Suzaku red chevron on the thigh front, lifting eyes (Rampart) | |
| Sensors | chin pod, the Rampart's vision block and lenses, antennas | family glow |
| Mods | none (a factory scout) | |

## Plate map (legs; the torso keeps the Rampart's)

- **Thigh:** front glacis (one raised plate from the hip housing to above the knee, darker inset and the chevron), a
  knee guard below a slanted gap (a flange shows in it), outer and inner side plates leaving the ram recess open, a thin
  back plate. Chamfers 4.5 cm front, 3 cm sides.
- **Shin:** a knee cap (olive inset), top plate, two side plates.
- **Cannon:** the olive horn above the hock gap, the **one long front plate** (signature, never cut), outer and inner
  side guards in KHAKI2 split by the side recess line, a short heel cap. The back is open: the channel shows the rams.
- **Foot:** the Rampart's top plate, heel cap and toe caps.

## Joint ranges (skill 6b)

| Joint | Range | Room made |
|---|---|---|
| Hip | swing -60 / +40 deg, spread 10 | hip housing rounded about the drum; inner hip scoop; bellows |
| Knee | 20-140 deg | knee cap disc round the drum; the thigh's knee scoop; the thigh ends 0.12 short of the knee clevis |
| Hock | 40-170 deg | the horn carried past the hock with a gap round the shin's end; hock servo flats |
| Ankle | -40 / +50 deg | ankle drum clear of the foot body, rams with slack |
| Toes | 0-50 deg curl | split toes on hinge drums (Rampart foot) |

## What to leave out

Fine bolt rows on the legs (they won't read on 0.4 m wide links at 40 m), the rocket box, the chest reactive bricks.
