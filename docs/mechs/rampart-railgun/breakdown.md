# Rampart Railgun: breakdown (before code)

Variant id `rampart-railgun`. The Rampart's legs and hull masses with the two hull miniguns swapped for railguns, the
whole machine restyled toward **Novus-Lux, "The Digital Aristocrat"**.

Sources: the old game's gear entry *02 Chassis Medium Railguns* ("a pair of guns on single-joint arms from the hull
sides; no hands needed. Fire alternately; each shot swings its arm back"), `docs/brands.md` (Novus-Lux: sleek rounded
glass, seamless white paneling, proprietary energy systems, over-engineered internals; flashy, pristine, locked down),
`art-refs/novus-lux/notes.md` (sleek angular layered plates swept toward the front; cool white + periwinkle / slate +
lavender, navy undersuit, teal lights, no visible fasteners; never rivets, hoses, weathering, chunky rounded bulk),
`_house-style/notes.md` and `mech-reference/notes.md` (grounded real-robot, flat paint, edges do the work).

There is no 3D reference for the gun, so step 0 does not apply: the gun is designed here, sized against the v4 minigun
it replaces (same gun axis, x -1.96, z 4.02) and the 1.8 m pilot.

## What it communicates

A clean, expensive machine that carries two long, hot, electrically driven guns. At 40 m the read is: the Rampart's
hull and legs in white, and two long shrouded barrels reaching well ahead of the nose on short arms from the hull
sides. At 15-25 m: long, seamless white plates with teal light seams, a slate shroud running the length of each gun,
the bare rails and the muzzle brace past it. At 10 m: capacitor banks with lit end caps, coolant conduits, orange heat
vents.

## Proportions (pilot heights, 1.8 m)

| | m | pilot heights |
|---|---|---|
| Total height (hood) | 5.05 (the rocket box no longer sets 5.2; the hood fins reach ~5.25) | 2.9 |
| Hull width at the guns' outer faces | 2 x 2.27 = 4.5 | 2.5 |
| Gun length, receiver tail to muzzle brace | 3.35 (y +0.88 -> -2.47) | 1.9 |
| Gun receiver section | 0.62 w x 0.54 h | |
| Shroud section | 0.46 w x 0.42 h at the root -> 0.34 x 0.30 at its end | |
| Exposed rails | 0.62 m past the shroud | knee-high to a pilot |
| Legs | unchanged from v4 (hip 3.05, knee 1.38, hock 1.15, ankle 0.27) | |

The minigun's muzzle was at y -1.90; the railgun's is at -2.47, 1.3 m ahead of the chest's nose. Barrels point forward
along the aim (the game's pose), which makes the top-down read two long bars: hence the shroud mass (below).

## Mass list (layer 0)

| Mass | Primitive / profile | Joins |
|---|---|---|
| Legs, pelvis, chest, rear hull, pauldrons | v4's masses unchanged | as v4 |
| Hood | v4's hood loft, plus two **swept crest fins** (thin wedge prisms raked back from the brow), the brand's swept fins | fused on the hood's top |
| Shoulder boom (the single-joint arm) | an octagonal loft along x from the shoulder drum (x -1.10) to the receiver's inner face (x -1.62), tapering, raked forward; a capsule drum at the hull side | overlaps the receiver |
| Receiver / capacitor housing | a loft along y through 5 hexagonal stations (leaning sides, chamfered top and belly), y +0.88 -> -0.40, with cuts: an outer capacitor recess, a top-front wedge, a rear belly chamfer, a top vent recess | the boom on its inner face |
| Coil ring | a 12-sided ring round the bore at y -0.42 -> -0.58 (the spin piece) | a gap to the receiver and the shroud |
| **Barrel shroud** (signature) | a loft along y through 4 stations, a flattened hexagon tapering forward, y -0.60 -> -1.86, cut with: an underside slot (rails show), two side windows per side, a tapered nose facet | the coil ring behind, rails through it |
| Rails | two flat bars (top and bottom) with a bore gap, y -0.45 -> -2.40, gunmetal | run through ring and shroud |
| Muzzle brace | an octagonal frame round the rail tips at y -2.30 -> -2.47, with a spacer block | holds the rail tips |

Signature form, kept whole: **the shroud line**, the one slate plate that runs the top and both shoulders of the
barrel from the coil ring to the shroud nose. Windows and vents go through its *sides* below the shoulder crease,
never across its top line; no panel seam crosses it.

## Per layer

| # | Layer | What shows | Shape language | Value / colour |
|---|---|---|---|---|
| 1 | Frame | hull core, tub, joint drums, leg beams; the gun's inner beam and a cradle under the receiver | as v4; the gun's frame is a dark spine under the shroud | **navy undersuit** (0.20, 0.22, 0.30), not near-black |
| 2 | Actuation | leg rams and servos (v4); the boom's elevation ram; the recoil buffer pair under the receiver (each shot swings the arm back) | rams on the lines of force | cool gunmetal |
| 3 | Power | **capacitor banks**: two rows of 5 cylinders in the receiver's outer recess, one row on top, lit end caps; the conduit from the hull into the boom | cylinders in racks, the energy store you can see | dark navy-blue, teal glow caps |
| 4 | Mounting | v4's flange ribs; two flange hoops inside the shroud showing through its windows | | pale lavender-grey |
| 5 | Plates | white hull and legs, periwinkle insets, slate hood and shroud | long, swept, few seams; chamfered rims with painted edges | white (0.80, 0.82, 0.86), periwinkle (0.52, 0.58, 0.80), slate (0.36, 0.42, 0.58) |
| 6 | Seals | v4's boots; a boot at the boom root | | slate-grey rubber |
| 7 | Heat | **the one strong feature: the guns' heat vents** - louvres along both sides of the shroud behind the brace and a fin stack on the receiver's back, orange glow floors (this gets hot); the hull's rear vents kept | fins and louvres | darker than the frame, orange glow |
| 8 | Service | rungs, lifting eyes, a few stencils in slate; **no bolt rows, no rivet pads** (brand) | | bare light metal |
| 9 | Sensors | a teal visor slit across the face, two teal brow lenses, a rangefinder lens on each gun | | teal |
| 10 | Mods / wear | dial **none**: pristine paint, wear and dust turned down (brand: never weathering) | | |

Coolant lines: the brand bans loose hoses, the skill wants plumbing. Compromise: sleeved **coolant conduits** in fixed
runs (teal-banded, clamped into the receiver's flank channel and into the shroud root), not hoses that loop.

## Plate map

- **Hull:** v4's face shield kept (the Rampart's signature) in white; the visor slit replaces the boxy vision block; the
  chest-side add-on bricks are dropped (brand: sleek) for one long swept side plate; teal light seams run in the gap
  round the shield and along the hood sides. Hood in slate with two swept fins.
- **Receiver:** a raised top plate (one panel, an inset periwinkle stripe), an outer plate split by the capacitor
  recess (front and back of it), an inner plate, a thin belly. Chamfer 3.5 cm.
- **Shroud:** one plate (the signature) over top and shoulders, 4.5 cm chamfer on its rims, the rail slot underneath, two
  windows and a louvre bank on each side below the crease. A short raised nose shingle over the shroud's tip.
- **Muzzle brace:** frame metal, chamfered, a slate cap on top.
- Big calm areas: the shroud top, the receiver top, the chest. Detail clusters: the capacitor recess, the boom root,
  the brace.

## Joint ranges

| Joint | Range | Room |
|---|---|---|
| Shoulder (the gun's single joint; the game yaws and pitches the pod there) | yaw about +-35, pitch -15 .. +20, kick ~0.25 m back per shot | the boom's drum stands 0.08 m clear of the hull side; a boot covers the root; the receiver's inner face is 0.45 m from the pauldron |
| Legs | v4's | v4's |

## What to leave out

Fine rail segmentation, cable ties, any rivets or bolt rows, text stencils that won't read at 10 m, weathering.
