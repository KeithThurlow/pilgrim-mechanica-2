# Rampart Siege: breakdown (before code)

Variant `rampart-siege`: the heavy siege Rampart. Valhalla Munitions, "The Artillery Platform": thick, ugly blast
plating, heavy recoil gear, no finesse. Built on `rampart_v4` (`tools/blender/mechs/variants/rampart-siege/rampart_siege.py`).

## Sources

- Old catalogue: `legs.heavywalker` ("Bulkier thighs and a slower, wider stride: hard to push around, slow to get
  going", labValues `thighBulk 1.8`, `walkSpread 1.25`; moveSpeed 0.85, knockbackTaken 0.7, actuatorWeight 1.35) and
  `03 Chassis Heavy Siege rails` ("a pair of guns on single-joint arms from the hull sides; fire alternately; each shot
  swings its arm back"). So: hull-side guns on a short single-joint arm, big recoil, legs that look planted.
- Brand: Valhalla ignores mobility and avionics; thick blast plating and massive recoil compensators; a blunt
  instrument. The brand folder is heavy armour suits: stacked horizontal bands of thick, rounded-edged plate, big
  knee and shin guards, dark gunmetal and blue-steel paint, rivets.
- `mech-reference/heavy.png`: a squat dark walker, hull wider than tall, short thick legs with big guards, flat feet,
  yellow hazard flashes on dark grey. `_house-style`: heavy builds get bulk from torso and limbs.
- No 3D reference: the Rampart v4 is the base and the brief sets the changes, so the mass gate is against the brief's
  proportions, not a measured model.

## Proportions (pilot = 1.8 m)

| | Rampart v4 | Siege | Pilots |
|---|---|---|---|
| Hip height | 3.05 | 2.72 | 1.5 |
| Hip half-width | 0.78 | 0.92 (wider-set) | |
| Femur (hip-knee) | 1.72 | 1.44 | 0.8 |
| Shin (knee-hock) | 0.75 | 0.68 | |
| Cannon (hock-ankle) | 1.08 | 0.85 | |
| Ankle height | 0.27 | 0.32 | |
| Thigh section | 0.88 x 1.00 | 0.98 x 1.10 | thighBulk read as ~1.25 x section area |
| Hull top | 5.05 (5.2 rocket box) | ~4.5, the mantlets ~4.3 | 2.5 |
| Width over the guns | 4.6 | ~4.4 | 2.4 |
| Foot | 0.6 x 1.3 | 0.9 x 1.45 incl. toes | |

The hull is the Rampart's hull, widened 12% and squashed to 0.88 in height, sitting 0.37 m lower. The legs are new
masses on the same digitigrade chain (hip, knee forward, hock back, foot), every link shorter and thicker.

## Joint ranges (leave room, show the mechanism)

hip swing +-35 deg, spread +-10; knee 0-60; hock (reverse joint) +-30; ankle +-30; toes 0-40 (curl); pod pitch -10..+30
on the shoulder; waist turn (game). The knee servo housings stay outboard of the thigh's clevis cheeks; the thigh skirt
stands 0.12 m off the knee servo so the shin turns behind it; the cannon's horn has the shin's underside clear.

## Masses

| Mass | Primitive / profile | Joins |
|---|---|---|
| Thigh | barrel loft through 8 z stations (pike front, prow on the outer-front facet, rounded back), leaning out 0.24 m at the knee; 6 cuts (knee scoop, inner hip scoop, top-front and lower-back chamfers, a front step, the outer recess for the skirt hangers) | hip drum inside its top; knee clevis cheeks in its bottom |
| Thigh skirt | a flat-sided wedge hung off the outer face on standoffs, from mid thigh to 0.35 m below the knee | a gap to the thigh (rib web shows) |
| Shin | a link prism knee-hock, 0.22 radius, 0.48 wide | drums at both ends |
| Cannon | loft along the bone, 0.58 wide, horn 0.42 m past the hock, heel spur past the ankle | hock drum inside its top |
| Cannon skirt | a plate on the outer face over the ankle rams | standoffs |
| Foot | a low broad wedge (0.62 wide), three splayed toes (-24, 0, +24 deg) on one hinge line 0.24 m ahead of the foot point, a heel spur | ankle drum in a trunnion block |
| Pelvis | the Rampart's, 18% wider so the hip drums reach the new hips | |
| Hull | the Rampart's chest, rear hull and hood lofts, x1.12 wide, x0.88 tall | waist drum |
| Siege cannon (right pod, mirrored by the game) | cradle loft (chamfered octagon), mantlet loft (a faceted wedge shield), barrel tube with a thermal sleeve, fume extractor and a box muzzle brake, a breech block | yoke to a short upper arm on the shoulder |

## Per layer

| # | Layer | Siege |
|---|---|---|
| 1 frame | dark olive | thigh core with lightening pockets, clevis cheeks, flat shin side links, cannon core, the cradle's inner beam, the breech, toe frames |
| 2 actuation | lighter metal | knee servos, hock servos, a big ram down the outer recess, two pistons in the cannon's front channel, ankle rams, toe rams (one per toe), pipe bundles down every leg link; on the gun: two big recoil cylinders over the barrel and a recuperator under it, rods bright between them and the mantlet |
| 3 power | dark cool | hamstring bundles behind the thigh, cannon side bundles, a feed conduit into the breech |
| 4 mounting | light | thigh flange hoops in the front/back gaps, skirt standoffs (the brackets a tank skirt hangs on), cannon hoops |
| 5 plates | gunmetal slate (Valhalla), darker insets, hazard yellow | see plate map |
| 6 seals | rubber | hip boot, knee boot, ankle boot, sole pads, a barrel boot behind the mantlet |
| 7 heat | dark + glow | the hull's rear vents (from the Rampart); slotted heat shroud on the barrel |
| 8 service | bare metal | stencils, rungs on the thigh skirt (it is the climb to the hull), lifting eyes on the mantlet, bolt rows on the skirts |
| 9 sensors | glow | the Rampart's face; a ranging lens on the cradle |
| 10 mods | none | faction clean |

## Plate map

- **Thigh, signature form: the armoured thigh plate.** One thick (8 cm, raised) plate wraps the pike front and the
  front-outer facet from the hip's top chamfer down to a V edge over the knee. No seam crosses it; a darker inset and
  the hull number sit inside it. Seams run round it: a knee guard below the V (following it at a 4 cm gap), the inner
  plate behind the inner seam, thin back plates with a flange gap between them, a top plate over the hip.
- **Thigh skirt** (the tank side skirt): two shingled panels on the outer side, upper over lower, bolt rows along the
  hanger line, a rung pair. The skirt hangs past the knee and covers the knee servo from the side.
- **Shin:** knee cap (faceted disc shell), a front plate, side plates.
- **Cannon:** an olive horn, the upper pod plate with insets, a lower pod plate, guards each side of the front channel,
  a small skirt plate over the outer ankle ram.
- **Foot:** top plate following the body slope, a toe cap per toe, a heel cap.
- **Gun:** the mantlet is one thick faceted shield (the gun's own signature; nothing cuts it but the barrel collar
  boss); cradle top plate with a hazard band, outer and inner side plates, belly plate; add-on bricks on the cradle's
  outer flank.
- Chamfers: 4-5 cm on the thigh plate, skirts and mantlet, 2-3 cm on small panels. Edges painted (rim x1.2, band x0.66).

## Edges that should catch the light

The thigh plate's top chamfer and V edge, the skirt's top rim, the mantlet's facet breaks, the hull's face facets.

## Leave out

Fine bolts on the hull back (the game's drums hang there), anything under 3 cm on the legs except bolts on the skirts,
the Rampart's rocket box (the left pod is the mirrored cannon, only for renders; the export drops it).
