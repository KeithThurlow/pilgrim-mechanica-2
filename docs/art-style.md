# Art style: retro-futuristic military hardware (2026-11-15)

Keith 2026-11-15, on the arc caster and the Sunder beam: "they both look almost steampunkish, which is interesting,
but it's not really what we're after. We're wanting futuristic, retro-futuristic looks, closer to military mech
appearance. More sci-fi, not steampunk." This page is the rule every model follows: mechs, parts, weapons, items,
vehicles, enemies. Written by Claude from Keith's reference art (where it is: the last section); the calls marked
Keith are his, the rest is a reading of the references for him to correct.

## In one line

**Late-80s real-robot military hardware, as a sci-fi future imagined it then:** armoured, machined, painted and
stencilled, built in a factory by a defence contractor and kept running in a desert. Patlabor, Gasaraki, Votoms,
Akira's vehicles, Titanfall and Helldivers walkers, JoyToy mech kits. The technology is advanced (reactors, rail
guns, beams); the finish is plain, worn military kit.

Not steampunk (brass, boilers, gauges, Tesla coils), not dieselpunk junk (pipes everywhere, rivet rows), not Gundam
(hero colours, fins, faces), not sleek glowing sci-fi (chrome, light strips, floating parts).

## The test

Before modelling a piece, ask: **would a defence contractor ship this in a sealed, armoured housing?** A real
military energy weapon hides its workings in a box with a cooling grille, a cable and a warning label. If the piece
shows its workings as ornament (windings, glass vessels, tanks, valves, bare electrodes), it reads as a Victorian
laboratory. Show **function through the casing's shape**, not by leaving the insides out.

## Shapes

- **Chamfered boxes and wedges.** Slabs with cut corners, sloped faces toward the likely fire, thick plate edges.
  Octagonal or faceted sections before round ones. Round only where something turns or seals: joints, barrels,
  lenses, turret rings, wheels.
- **Big simple masses first.** Two or three volumes carry a silhouette from the game camera (50° down, 40 m). A mech
  is a hunched armoured hull on digitigrade legs with the weapons as large clear blocks on its sides.
- **Layered plates over a frame.** Armour stands off a darker inner frame with gaps you can see into: the joint,
  ram or cable behind is glimpsed, never the whole silhouette.
- **Weapons are long boxes.** A receiver block, a shrouded or finned barrel, a muzzle device, an ammunition or power
  feed, a mount. Energy weapons follow the same grammar: a housing, a heat sink, an emitter in a hooded bezel.
- **Asymmetry with a reason:** a sensor pod on one side, a launcher on one shoulder, an offset antenna.
- **Proportions are heavy and a little toy-like** (Keith's picks 2026-10-04: `gasaraki_crunchy`, `extra arms`,
  `heavy armor`): thick limbs, big feet, small head or none. Bulk comes from the torso and limbs.

## Materials

- **Painted steel and composite armour**, matt, roughness about 0.55 (`src/look/toon.ts`). Paint is the surface
  almost everywhere.
- **Dark frame and mechanicals:** gunmetal, parkerised near-black, dark rubber boots and bellows on joints.
- **Machined bare metal only in small amounts:** ram rods, barrel bores, bearing faces, worn edges.
- **Glass is small and hooded:** sensor lenses, a visor slit, a sight. Never a vessel you can see through.
- **No brass, copper, bronze, gold, wood, leather, or polished chrome.** The one exception is ammunition (shell
  cases and belts are brass because cartridges are).

## Colour

- **One hue family per machine**, low saturation, warm. The Rampart's scheme is the anchor (`src/weapons/palette.ts`):
  khaki `#b9a676`, olive `#737b4b`, dark steel `#34322d`, cream edge `#e0d4ae`.
- **Military drab is the default range:** khaki, sand, olive, field grey, gunmetal, slate blue, bone white, navy.
  Construction yellow and orange belong to Goliath Earthworks and salvage gear only.
- **Shadows keep the hue:** about 80% of the lit value, a touch less saturated, no blue or purple shift. Deep
  accents (about 60%) only in vents and under plates. Edge highlights are thin and cream, never white or glossy.
- **One accent per machine**, small: a unit colour band, a hazard stripe, a red warning panel.
- **Light is information, not decoration.** A lamp means ready, hot, charging or looking. Keep it to lenses, status
  lamps, muzzles and vents: under about 2% of the surface at rest. Energy weapons glow when they charge and fire,
  through slots, a hooded emitter or heat-sink fins, and go dark again.
- **Robots are the exception in colour, not in language:** white and pale grey hard shells over dark joints
  (Keith 2026-11-01), with one cold accent light. Same boxes, plates and sealed housings.

## Detailing

Detail says what a layer does (mech-modeling skill, "Every part and layer reads with a purpose"). In order of worth:

1. **Panel breaks and chamfered edges** that catch the sun. Most of the look at 15 to 25 m.
2. **Markings:** stencilled unit numbers, a maker's plate, warning panels, hazard tape at pinch points and muzzles,
   a kill tally. Big enough to read as a block of contrast from the game camera.
3. **Service hardware:** grab rails, steps, hatches with latches, lifting eyes, jacking points, tow hooks.
4. **Vents and heat:** louvre banks, grilles, finned heat sinks, exhaust slots with soot above them.
5. **Actuation and power, glimpsed:** hydraulic rams on lines of force, a cable loom in a clip run, a sealed
   connector. Short and tidy, routed along the frame.
6. **Sensors and comms:** whip antennas, a small dish, lens clusters, smoke dischargers.
7. **Wear:** chipped paint on edges and feet, sand scour low down, soot at muzzles, a replaced panel in another
   paint. Worn and maintained, not rusted or derelict.

Fasteners are **sparse recessed bolts or cap screws at corners and hinges**, not rows of rivets.

## Do and don't

| Do | Don't |
| --- | --- |
| A sealed housing with a cooling grille and a warning label | Bare coils, windings, capacitor stacks, tie rods |
| A finned heat sink or louvre bank for cooling | Coolant tanks with bands and valves, pressure gauges, hand wheels |
| A hooded lens or slotted emitter that lights when firing | Glass spheres, bell jars, tubes of glowing fluid, ring cages |
| A short armoured cable or a loom in clips | Hoses and pipes draped over the outside as decoration |
| A faceted muzzle brake, a shrouded barrel, a rail pair | Flared bells, trumpets, forked electrodes, prongs |
| Khaki, olive, grey, gunmetal; cream edges | Brass, copper, bronze, gold trim, wood, leather |
| Recessed bolts at corners | Rivet rows, portholes, domed boiler ends |
| Stencils, hazard tape, unit numbers | Filigree, crests, engraving, skulls, spikes |
| One small status lamp | Light strips, neon seams, glowing eyes |
| Chipped paint and sand | Heavy rust, patchwork scrap (bandit gear may be patched; it is still built from military parts) |

**Energy weapons are where this goes wrong**, because "electric" and "plasma" pull toward Tesla coils and glass.
The retro-futuristic answer: an arc weapon is an insulated emitter head (stacked ceramic-looking fins in dark
grey, like a high-voltage bushing) inside a guard frame on a boxed power unit; a beam weapon is a long finned
optical barrel with a hooded lens; a plasma weapon is a breech block with heat-sink fins and a shuttered muzzle. The
power source is a sealed cell pack with a cable, behind the shoulder.

## Makers

Each maker bends the house rules; none leaves them. From the `notes.md` in each maker's reference folder:

| Maker | Shapes | Colour | Never |
| --- | --- | --- | --- |
| Rampart family (default) | chamfered slabs, sloped hull, box thighs | khaki, olive, dark steel | |
| Stratford-Aegis | heavy power-armour slabs, big pauldrons | field grey, slate, one red or amber accent | |
| Goliath Earthworks | blocky construction machinery, glass cab, headlight clusters, visible hydraulics | yellow or orange and black, hazard stripes | sleek, glossy, delicate |
| Akiyama Motors | soft-cornered bulbous slabs, round ports | khaki, sand, bone, gunmetal, rust red | sleek, glossy, light strips |
| Novus-Lux | sleek angular layered plates swept forward, hidden fasteners | cool white, periwinkle, slate, teal lamps | rivets, hoses, weathering, rounded bulk |
| Valhalla Munitions | no notes yet; refs are heavy infantry armour, dark blue and black, ornate | | take the mass, drop the gothic ornament |
| Synthos Prime | no notes yet; one ref, sleek black with teal seams | | open: this is the "glowing sci-fi" this page rules out elsewhere |

Akiyama's references carry hoses, rivets and portholes. Under Keith's call those are kept few and functional (a
breather hose, a bolted inspection port), so Akiyama reads as an older, rounder military make, not as dieselpunk.

## Enemies (for the robot, crusher and strider rebuilds)

From `robot-reference/`:

- **Small and medium quads** (`small quad.png`, `medium quad bots with weapons.png`): a low drum or wedge hull in
  white or pale grey hard shell on four splayed two-segment legs with flat shin plates and small feet or wheels; a
  turret ring on top; twin rotary guns or a sensor bar on the hull; one blue status light and a whip antenna.
  Sealed, clean, machine-made. This is the pattern for scrappers, cutters, quads and companions.
- **Striders** (`Screenshot 2026-11-01 150518.png`): a stacked disc head (a wide saucer over a smaller emitter
  disc), three or four very long thin legs with armoured shin plates and cable bundles at the knee, the beam from
  under the disc. Dark hull with the light only at the emitter. Read by the disc and the stilts from above.
- **Humanoid droids** (`pinterest robot reference.png`): thin skeletal frames, pale shell plates over dark joints,
  small featureless heads with one lens, a single orange or grey accent. No faces, no skulls.
- **Crusher:** no reference image of its own. Default: the robots' language at vehicle scale, the heavy crab quad
  in pale shell with a dark turbine maw, hazard marking round the intake; an industrial harvester, not a monster.
- Robots carry no stencils, hazard tape or wear a person would put there. Their markings are machine ones: a serial
  block, a coloured ring. That is how they read apart from human-built mechs at a glance.

## What drifts today

Judged from the build code, not from renders. Listed for the rebuild threads; nothing is changed by this page.

| Model | Where | What reads wrong | Toward |
| --- | --- | --- | --- |
| Arc caster | `src/weapons/build/energy.ts` `arcHull` | capacitor discs on a mast, tie rods, copper windings on a coil, forked electrodes: a Tesla coil | insulated emitter head in a guard frame on a boxed power unit |
| Sunder beam, plasma cannon | `plasma-cannon-hull` (the Sunder is it at ×1.25, `modelSwap.ts`) | glowing glass core in a spinning ring cage, ribbed coolant hoses, pronged emitter | breech block, heat-sink fins, shuttered muzzle; glow through slots when charging |
| Particle orb | `energy.ts` `orbHull` | glass containment sphere in a ring cage, coolant tank with bands and a valve, flared launch bell | sealed spherical housing in armour segments, a short faceted launcher |
| Coolant tanks | `energy.ts` `tank()` | banded capsule with an end valve on several energy weapons | finned radiator pack or a sealed cell box |
| Brass trim | `BRASS` in `tools/blender/parts/items.py`, `waist.py`, `warband.py` | brass collars, pommels, caps and valves on swords, feeds, waist kit, war band trucks | dark steel or the scheme's trim colour; brass stays on shell cases only |
| Laser projector | `energy.ts` | closest to target (finned optical housing, hooded lens); check the slow-spinning lens turret reads as optics | keep |

Mechs, arms, packs, sensors, round guns and the vehicles follow the Rampart family and are on style.

## Open for Keith

1. **Cel look or plain paint?** The old house-style notes say Akira-era cel animation with ink lines; the game today
   is plain lit paint with cel bands and ink as toggles (Keith 2026-10-24). This page assumes plain paint stays.
2. **Akiyama's hoses and portholes:** kept few and functional here. Say if the make should lose them entirely.
3. **Synthos Prime and Valhalla Munitions** have no notes; the defaults are in the makers table.
4. **The crusher** has no reference image; the default is above.
5. **Energy weapon glow at rest:** dark until charging here. Say if a faint idle glow is wanted for readability.

## Where the reference art is

On Keith's PC, in the old project: `C:\Users\thurl\Development\pilgrim-mechanica\art-refs\` (approved for cloud
sessions' folder access while his PC is on). Never commit reference pixels; they inform original designs only.

| Folder | What | Notes file |
| --- | --- | --- |
| `_house-style/` | the overall look; Keith's three picks | `notes.md` |
| `mech-reference/` | mechs: `Pinterest board.png` (about 30 walkers), `heavy.png`, the JoyToy and Titanfall kits, `helldiver/` (the Rampart's 3D reference, external IP) | `notes.md` (shading), `style-prompt.md` |
| `robot-reference/` | `small quad.png`, `medium quad bots with weapons.png`, `Screenshot 2026-11-01 150518.png` (the strider), `pinterest robot reference.png` (humanoids) | none |
| `Stratford-Aegis/`, `goliath-earthworks/`, `akiyama-motors/`, `novus-lux/`, `Valhalla Munitions/`, `Synthos Prime/` | one folder per maker | `notes.md` in Goliath, Akiyama, Novus-Lux |
| `overall-style/` | unsorted inbox, mostly more mechs | none |
| `world-reference/`, `generation-ships/` | landscapes, biomes, wrecked ships | `notes.md`, `palettes.md` |
| `particles/` | dust and explosion targets | none |
| `character-reference/` | pilots and people | none |

The strongest single images for this page's target: `mech-reference/heavy.png` (dark faceted walker with missile
boxes), `mech-reference/helldiver/helldivers.jpg` (the tan twin-cannon walker), `_house-style/gasaraki_crunchy.jpg`,
and the two tan gun walkers in `overall-style/` (`d8a12f8fcf72aad1.jpg`, `f5df8bd4ee38ac86.jpg`).
