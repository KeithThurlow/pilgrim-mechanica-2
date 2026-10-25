# Rampart Rocket: breakdown (before code)

Variant id `rampart-rocket`. A Rampart (v4 legs and pelvis unchanged) on a **compact torso** with a **rocket salvo pod**
as the right weapon; the game mirrors that pod onto the left shoulder.

## Sources

- Old catalogue `torso.compact`: "A short core under a flat, wide chest wedge, a sensor head on a neck. Quick to turn."
  (torsoTurn 1.1, otherwise neutral).
- Old catalogue gear 17 `Rocket salvo pods` (Medium, shoulders): "Rocket pods on small pylons over the shoulders; fold
  down behind the back, swing up to fire salvos." The game has no fold-down yet, so the pod is modelled raised, on a
  short pylon, and the hinge sits on the shoulder pivot the game pitches about.
- Brand: Akiyama Motors, "The Utilitarian Standard": stamped steel blocks, universal joints, modular, form follows
  function; "Old Reliable", "a utilitarian tractor". Art refs: soft-cornered bulbous slabs, khaki / sand / bone with
  gunmetal and rust, hoses, round bolted ports, rivets, painted unit numbers. Never sleek or glossy, no glowing light
  strips. Palette (`akiyama.json`): plating `#A89571`, secondary `#B6A47F`, dark `#3A332A`, mechanical `#5D5F63`, trim
  `#75654A`, lighting `#FFB347`, detail `#C2B595`, visor `#3E5A58`. Shape: "vessel" style, exposed hubs and collars
  between masses.
- v4's left rocket box (`arm_l`, `rocket_mass`, `rockets`) and the old `missile_pod.py` template (recessed launch face
  behind an armoured lip, hinged door, nose waiting in each tube, backblast grille, sensor lens).

## Proportions (1.8 m pilot = 1 PH; mech height 5.2 m = 2.9 PH)

| | Rampart v4 | Rampart Rocket |
|---|---|---|
| hull height (waist top to hull top) | 3.11-5.05 m (1.9 m) | 3.62-4.52 m chest wedge (0.9 m) + sensor head to 4.86 |
| hull depth | -1.20 .. +1.37 (2.6 m) | -1.02 .. +0.80 (1.8 m): leaves the game's back drums / power pack (y 1.2-1.5) clear |
| hull width | 2.0 m (side boxes) | 2.0 m wedge (wide and flat) |
| shoulder | (±1.02, 0.10, 4.34) | (±1.04, 0.05, 4.12), on the wedge's flank |
| weapon | minigun 1.9 m long | pod 0.82 w x 1.24 h x 1.78 l, top at 5.07 m; tube face 0.66 x 0.96 |
| legs, pelvis | | unchanged (v4) |

At 40 m the read is: a low, wide wedge with a small head on top, flanked by two tall slab boxes over the shoulders,
each with a dark-dotted face. The pods are now the tallest masses, so the outline is "two boxes and a wedge" rather
than v4's "big hull with a gun".

## Mass list (layer 0)

| Mass | Primitive | Joins |
|---|---|---|
| chest wedge | loft along y through 6 stations (a pike nose, wide flat middle, tapered back); cuts: two cheek facets, chin underside, glacis brow step, two flank scoops, rear deck chamfer, vision slit | rests on the core, overlaps it |
| core | short octagonal prism (z 3.40-3.80) round the waist | gap to the pelvis for the waist boot |
| neck + sensor head | short octagonal neck; head a lofted faceted wedge (V chin, sloped visor face) | the neck sits in a collar on the deck (exposed collar between masses: Akiyama) |
| pod box | front octagon prism ∩ side profile (raked face, top-back chamfer, belly chamfers); cuts: face recess behind the lip, outer flank recess, top-rear reload hatch recess | joins the pylon through a collar on its inner face |
| pylon / elevation mount | the upper-arm stub (v4's arm_link, shortened) + an elevation hub on the box's inner and outer faces on the shoulder axis | the hinge is the game's pitch pivot |
| blast door | a chamfered slab hinged at the top of the face, shown open (swung up and back ~150°) | its knuckles on the lip's top edge |

Machinery may be flat: the pod box is a launcher box, so its flat sides are allowed (skill), but every corner is
clipped and the face rakes back.

## Per layer

| # | Layer | What shows | Shape / value |
|---|---|---|---|
| 1 | frame | the pilot tub (wedge shrunk), the core column, waist and shoulder drums, the pod's inner box, the pylon stub, the elevation hub | dark warm grey `#3A332A`-ish, never black |
| 2 | actuation | elevation ram (pylon to box belly), door struts, torso twist rams, pipe bundles from the flank scoops into the pylon, hoses into the pod | gunmetal `#5D5F63`, a step lighter |
| 3 | power | core cells round the waist column, conduits up to the shoulders | dark, cool |
| 4 | mounting | flange hoops round the wedge under the cheek seam and the deck seam; a hoop inside the pod's side seam | light, deep flanges |
| 5 | plates | wedge: glacis (front) thick and raised, cheeks, flanks, deck; head shell; pod: lip, face plate, sides, top, belly, back | plating `#A89571`, bone `#B6A47F` secondary, trim `#75654A` insets |
| 6 | seals | waist boot, neck boot, shoulder bellows | rubber grey |
| 7 | heat | the one strong heat feature: a louvre bank on the rear deck; the pod's backblast grille | darker than frame |
| 8 | service | rivet rows along panel edges (stamped steel), lifting eyes, reload hatch handles, rungs on the wedge flank, unit number "05", tube count "12", hazard bands | bare metal, cream paint |
| 9 | sensors | the head's round lens ports (visor teal, one amber), a sight lens under the pod face, an antenna | `#3E5A58` visor, `#FFB347` lamp (no strips) |
| 10 | mods | none (factory Akiyama) | |

## Plate map

- **Chest wedge.** Glacis: one raised plate (6 cm proud) from the nose to the brow step, its rear edge following the
  step; two cheek plates down the sloped sides, seams running along the station lines (along the form, not world
  axes); flank plates under the shoulders with an inset; a thin deck plate on top behind the head collar; a back plate.
  Calm areas: glacis and deck. Detail clusters: round the neck collar, the flank scoops, the shoulders.
- **Head.** Two panels: crown and visor brow, a dark visor recess with three round lens ports.
- **Pod.** The **face** (signature, below); a lip plate round it (khaki, 4.5 cm chamfer, hazard band at its foot);
  outer side split once by a seam leaning with the face rake, a bone inset; inner side one plate round the collar;
  top: the reload hatch inset at the rear; belly and back thin.
- Chamfers 4-5 cm on the big slabs (glacis, pod sides), 2-3 cm on small ones. Rims painted light (1.2x), band inside
  darker (0.66x) via the v4 panel helper.

## Signature form (skill 7b): the launcher box's face

One bone-coloured plate filling the face recess, a 3 x 4 grid of tube mouths in it (dark bores, a bright gunmetal collar
each, a warhead nose 0.10 m back with a rust tip). No seam crosses the face plate; the lip goes round it. At 40 m it
should read as a light rectangle with a dark dot grid on each shoulder; at 15-25 m the collars catch the light.

## Edges that catch light

The glacis top rim and brow step, the cheek facet breaks, the pod lip's top and outer rim, the blast door's front edge,
the tube collars.

## Joints and ranges

| Joint | Range | Room |
|---|---|---|
| waist turn | the game turns the hull freely (torsoLimit 120°) | the core column is round under a wedge that clears the pelvis wings by 9 cm; waist boot |
| pod yaw | ±30° about the shoulder (game) | pod inner face 0.36 m outboard of the shoulder; the rear inner corner stays outboard of the wedge flank at 30° |
| pod pitch | ±20° about the shoulder axis (game) | the elevation hub is on that axis, the box hangs off it, the ram runs under it; the box belly is 0.3 m above the pylon root |
| neck | fixed (sensor head) | neck boot |
| legs | unchanged from v4 | |

## Weapon pose and game contract

Tubes point forward (-Y). `Part_PodSpin_R`: the outer elevation hub's cap, a plain disc about the hinge axis (spins
invisibly when the game spins it). `PodSpin_R` at the hub centre, `PodSpinFwd_R` 0.5 m outboard along the hinge axis.
`PodMuzzle0_R` at the first tube's mouth (top inner tube; `PodMuzzle1..11_R` follow in firing order: top row first,
alternating columns). `PodEject_R` at the backblast grille (debris goes out the back).

## Leave out

Rocket fins and motor detail inside the tubes (invisible), per-tube doors (a 12-door grid is noise at 40 m), rivets
smaller than 2 cm, any panel lines on the face plate.
