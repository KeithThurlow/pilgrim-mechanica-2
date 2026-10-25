# Rampart Salvager: critique

The GLB is `public/models/mechs/rampart-salvager.glb`: 33,838 tris, with 12 meshes in the game contract. The left arm is
dropped from the export because the game mirrors `Part_Pod_R`. The full Blender build is 37.3k tris including the mirrored
left gun. The torso is 9.9k tris, a little over the 9k guide. Booleans: 0 skipped cutters, 0 refolds and 30 fallbacks,
all of them in the shared v4 parts (`pod_up`).

Walker lab: `?mech=rampart-salvager` loads, walks and fires. Shots are in `shots/0[1-3]-walker-*-rampart-salvager*.png`.
The game's drums and power pack sit behind the cab without clashing with the exhaust stack.

## The three reads

- **Silhouette at 40 m** (`game40.png`, `game40_x3.png`): it reads as a yellow cab body between two charcoal rotary
  cannons. From above, the roll cage, the orange cable spool on the rack and the stack break the cab's top outline. The
  windscreen is the face. Proportions: the cab is narrower than the v4 chest and side boxes, so the guns stand further out.
  That suits the "light, thinly armoured" cab, but the hull reads less massive than the Rampart's.
- **Plates and edges at 15-25 m** (`cab_close.png`, `cab_side.png`, `zoom10.png`):
  - The belt crease at z 4.12 (flank leaning out below, tumbling home above) and the prow's "<" give the cab bright facet
    lines.
  - The glazing frame's rim and window rims carry the face.
  - The roof panel's lower rim reads as a drip rail over the door.
  - The front glazing frame is one big calm yellow plate. That is intended (the signature form), but it is the largest
    single flat-colour area on the mech.
- **Detail at 10 m:** the scale cues are there:
  - hazard bands on the bumper, the rack and the guns;
  - the winch drum in its well, the fairlead and the orange hook;
  - lifting eyes on the shoulder housings, the door grab rail, hinges and handle;
  - rungs and a boarding step, D-rings on the skirt;
  - the lamp bar, the A-pillar lamps and the beacon.

## By layer

| Layer | Works | Doesn't |
|---|---|---|
| Frame | The tub reads dark through the window cuts. The grey roll cage is the strongest new silhouette element. | The seat and pilot behind the open left window don't show from the three-quarter close-ups: the cameras look too far from the side to see in. A straight side view or a lower zoom would. Not verified. |
| Actuation | The grey shoulder housings with their slew rings read as machinery. The winch drum and motor show, and pipes run in the belt gap. | The waist rams are mostly hidden under the cab. |
| Power | Conduits run in the belt gap. | The cell pack under the floor is invisible from the game camera. |
| Mounting | The flange hoop in the belt gap and behind the frame seam is trimmed so it never shows through the glazing. That was a fix: in v1 the hoop crossed the chin glass. | Thin at 40 m. |
| Plates | One shell per region, chamfered and with painted rims. The outer-skin axis share on the torso is 0.083 (v1 was 0.351, flagged; fixed by leaning the flanks and the rear face). The rear quarter has a darker inset. | Yellow dominates the cab. The only tonal breaks are the charcoal skirt, the bulkhead and the insets. |
| Seals | The waist boot. | No gasket round the glazing; the dark window walls do that job. |
| Heat | One strong feature: the exhaust stack with its heat sleeve, rain flap and glowing mouth, plus a small louvre on each rear quarter. | The stack's rain flap floats a little. |
| Service | The densest layer, as the brief asked. | The door and rear-quarter stencils are small. The big top-down "07" on the roof is the one that reads. |
| Sensors | Amber glazing with reflection streaks. Lamps on the cage, the A-pillars and the guns; the beacon. | The chin glass faces down and is invisible from 50°, so the windscreen does all the work. |
| Mods | Crates, spool and jerrycans strapped on the rack, plus tool bins on the skirts, all tagged `addon`. | |

## Revision passes made

1. **Mass:** widened the cab (belt ±0.88, then ±0.91) and pushed the prow forward to -1.18 after the first mass gate read
   as a small box.
2. **Glazing:** enlarged it (windscreen 1.08 x 0.50, chin glass 0.96 x 0.32). It looked like small "eyes" in a big yellow
   face.
3. **Axis share** (worst plate issue, 0.351):
   - a belt crease with the flanks leaning out and in;
   - a 5° rear face;
   - the frame plate stopped short of the flat belly;
   - the belly panel dropped.

   Result: 0.083.
4. **Value** (worst 40 m issue, the whole mech one yellow blob): the guns are now charcoal machinery with yellow ammo
   drums (`with_paint()`), so the cab separates from them.
5. The mounting hoops showing through the chin glass were fixed by trimming the rib source mass.

## Signature form

**The front glazing frame survived whole.** `massvsfinal_cab.png` shows it as one plate round the windscreen and the
chin glass, with the seam following the prow behind it and nothing crossing it.

## Legs

Unchanged from v4 and not knock-kneed (`front_legs.png`). The knee sits 0.04 m outboard of the hip-ankle line at rest
and 0.038 m in the stance.

## Worst remaining issue

The cab is a large single-hue yellow volume. The glazing frame plus the roof is about 60% of what the camera sees, with
little secondary panel density on the frame plate itself, which has to stay whole. A cream or white band in the old
catalogue's style (on the roof edge or the A-pillars) or more stencil work would help. The hidden pilot is second.
