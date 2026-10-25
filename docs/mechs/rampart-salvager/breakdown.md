# Rampart Salvager: breakdown (before code)

Variant id `rampart-salvager`. An industrial salvage Rampart from Goliath Earthworks ("The Industrial Leviathan"): the
Rampart's legs, pelvis and twin hull rotary guns, with the old catalogue's **cab torso** (`torso.cab`: "A construction
cab with amber windows and the pilot inside: light, fast to turn, thinly armoured") in place of the armoured chest.
It is the convoy's work machine: it walks out to a wreck, winches it, straps scrap to its roof and walks home.

References read (never committed): the old project's `construction mech.webp` (faceted yellow cab, amber glazing, a grey
tube roll cage over it, cream bands, grey joints), `rescue mech.jpg` (orange cab with a big glass front under a brow,
lifting eyes, stacks), `goliath-earthworks/` (yellow + black, hazard stripes, headlight clusters, glass cabs; never sleek)
and its palette `goliath.json`, `_house-style/notes.md` (crunchy real-robot hardware, big markings), and the old
`studies/industrial/rescue.py` (cab lofts, brow lamps, grab rails, lifting eyes, stacks).

## Proportions (pilot = 1.8 m; mech height 5.2 m to the roof, cage and stack above)

| | metres | pilot heights |
|---|---|---|
| Cab roof | 4.98 (cage 5.26, exhaust stack 5.55) | 2.8 |
| Cab width at the belt | 1.64 | 0.9 |
| Cab depth (prow to rear bulkhead) | 2.12 | 1.2 |
| Cab interior (floor 3.62 to roof) | 1.36 | seated pilot fits (helmet top about 4.72) |
| Door | 0.66 wide x 0.86 high | a crouching pilot's door |
| Legs, pelvis | unchanged Rampart v4 (hip 3.05, knee 1.38, ankle 0.27) | |
| Guns | barrel axis x -1.96, z 4.02 (the contract), barrels 1.30 m | |

The back stays free for the game's drums (about 1.1 m behind the waist, z 3.7) and its power pack (y 1.1-1.85,
z 4.4-5.1): the cab ends at y 1.0; only the stack (x 0.88, y 0.80) rises beside the pack.

## Mass list (layer 0)

- **Cab** (torso): three intersected prisms (side ∩ front ∩ top), not a box:
  - side profile: a forward "<" prow (lower chin facet raking forward-down from the belly to a knuckle at z 3.98, the
    windscreen raking back from the knuckle to z 4.66), a roof chamfer, flat-ish roof (4.98), a rear top chamfer,
    a near-vertical rear bulkhead, the belly at 3.62 (clear of the pelvis wings, 3.53);
  - front profile: a narrow belly (±0.58), a lower side chamfer out to the belt (±0.82), tumblehome in to the roof
    (±0.60);
  - top profile: the prow narrower (±0.62) with chamfered front corners (the A-pillars), the rear tapering to ±0.74.
  - cuts (6): top-front corner facets (2), a roof well for the rack, door recesses (2), lower rear corner chamfers, a
    rear vent recess.
- **Shoulder housings**: flat machinery blocks (octagonal side view) on each cab flank around the shoulder drum (x 0.70
  to 0.94), holding the slew ring the guns turn on.
- **Winch bumper**: a flat-faced push-bar box under the chin (y -0.80 to -1.24, z 3.18 to 3.52), open on top for the
  drum: machinery, flat allowed.
- **Rotary cannons**: the v4 minigun arm, heavier-duty: thicker barrels in a six-barrel spin cluster, a heavy muzzle
  clamp and brakes, the receiver in Goliath paint, a work lamp riding the gun.
- Joins: the cab and shoulder housings are fused; the bumper hangs from two brackets (a gap, it reads as bolted on).

## Per layer

| # | Layer | What shows | Shape / value |
|---|---|---|---|
| 1 | Frame | the pilot tub (cab shrunk 0.16) with a cavity behind the open side window, the seat; the **roll cage** (grey tubes over the roof and down the corners: a protective frame, ROPS); the bumper brackets; waist and shoulder drums | dark warm grey; cage mid grey (0.42) so it reads against yellow and sand |
| 2 | Actuation | waist twist rams, pipe bundles to the shoulders, the winch's hydraulic motor and hoses, slew-ring motor discs | metallic, a step lighter |
| 3 | Power | a cell pack under the cab floor showing in the belly gap, conduits to the shoulders | dark, cool |
| 4 | Mounting | flange hoops in the belt-line gap (z 3.88) and behind the glazing frame's seam | light, wide flanges |
| 5 | Plates | the glazing frame (signature), roof panels, door and rear-quarter panels, lower side skirts (charcoal), belly, rear bulkhead | Goliath yellow `#E2A428`, darker yellow insets, charcoal `#2B2825`-ish lower band |
| 6 | Seals | the waist boot, a rubber gasket round the glazing | dark matte rubber |
| 7 | Heat | **one strong feature**: a diesel exhaust stack at the left rear corner (rain cap, heat sleeve, clamps); a louvre grille low on the rear quarter | darker than the frame, glow at the stack mouth |
| 8 | Service (matters most here) | lifting eyes on the roof corners, rungs and grab handles beside the door, a fold-down step, door hinges and handle, roof rack with tie-down rings and straps, D-ring tie-downs along the skirt, hazard striping (bumper, roof rack, gun fronts), hull number and load stencils | bare metal, black/yellow hazard, cream stencils |
| 9 | Sensors | amber glazing (windscreen, chin glass, side windows; one side window slid open showing the seat and pilot), a work-lamp bar on the cage, corner lamps on the A-pillars, an amber beacon on the roof, a lamp on each gun | glow `#FFD27A`, glass dark amber |
| 10 | Mods | dial none (Goliath clean industrial); add-on stowage: crates, a cable spool and jerrycans strapped to the roof rack (tagged `addon`) | cargo colours |

## Plate map (cab)

- **Glazing frame (signature form, kept whole):** one raised plate (shell -0.08..+0.035) over both front facets and the
  A-pillar corner facets, its back seam following the prow's "<" 0.24 m behind it (so the seam flows with the form). The
  windscreen and the chin glass are cut out of it; what is left is a header, two A-pillars, the knuckle mullion and a
  sill, one plate. Chamfer 4.5 cm. Nothing else cuts it.
- **Roof:** two thin panels split on the centreline (a seam along the cab's length), the rear one dropped into the roof
  well under the rack; a darker inset hatch on the front panel. Chamfer 3.5 cm.
- **Flanks:** a door panel (side window cut, dark inset under the number), a rear-quarter panel behind the shoulder
  housing (louvre grille), and below a 4 cm belt gap a charcoal lower skirt wrapping the lower side chamfer (D-rings,
  hazard band at its front). Chamfers 3.5-4 cm.
- **Belly and rear bulkhead:** thin panels (thinnest at the back and bottom: tank logic, and the cab is thinly armoured
  by design).
- Calm areas: the roof panels, the door panel, the skirt. Detail clusters: the prow (lamps, wipers, bumper, winch), the
  roof rack, the door (rungs, handles, hinges), the stack.

## Edges

The bright lines that matter: the glazing frame's rim and its window rims (the face of the mech), the roof edge where
the roof turns down into the tumblehome, the belt-line seam, the skirt's top edge. Painted rims 1.2x, inner band 0.66x
(the v4 `panel()` treatment). Hazard stripes on the bumper and rack read at 15-25 m.

## Joint ranges (the variant touches only the waist and shoulders)

- Waist turn: the cab belly sits at 3.62, above the pelvis wings (top 3.53), with the waist boot showing in the gap;
  the bumper is ahead of the skirt (skirt front y -0.62, bumper back y -0.80).
- Shoulders: the slew ring and drum stand off the cab flank on the housing; the gun yoke's inner face (x 1.22) stays
  outside every cab part (|x| <= 0.98 on the flanks).
- Legs: unchanged v4 (not knock-kneed; the leg report is in the build json).

## Weapon pose

Barrels forward along the aim (game contract). The guns hang outboard of the cab at the shoulder height, a little lower
than the cab's belt, so the cab reads as the body between two cannons from 40 m.

## What to leave out

Wipers on every window (one on the windscreen), interior controls, window mullions on the side windows, small bolts
inside the rack.

## Signature form

**The cab's front glazing frame** (one plate round the windscreen and chin glass). Checked at the mass gate and at the
end (mass vs final render).
