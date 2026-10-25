# Rampart "Wildcat": breakdown

Claude (mech-modeler agent), 2026-10-24. Brief: a scrap-built Rampart, the same machine kept running by salvagers who
rebuilt it from whatever they found (Wildcat / Scrap-Crafted, "The Self-Made Anomaly": rebar, stop signs, mismatched
parts, zero standardisation). Mods / wear layer (10) at heavy. Still reads as a Rampart at 40 m, still a maintained
machine, not a wreck.

References read: the old project's `docs/brands.md` (Wildcat), `art-refs/_house-style/notes.md` and
`gasaraki_crunchy.jpg` (crunchy layered hardware, stencils, cables), `mech-reference/notes.md` (one hue family per
machine, cream edge highlights: the Wildcat deliberately breaks the one-hue rule panel by panel), `world-reference/`
notes (ruin shows as patchwork repair, not devastation) and `generation-ships/notes.md` (old painted steel, rust at the
seams). No reference pixels are in this folder.

## What stays (the game contract and the family read)

- **Mass, proportions, joints: v4's, unchanged.** Same hip / knee / hock / ankle chain, same leg lengths and splay
  (knee 0.04 m outboard of the hip-ankle line at rest, 0.038 in the stance: never knock-kneed), same feet and toe hinge.
- **Twin hull miniguns**: v4's right minigun arm (the game mirrors it onto the left shoulder), barrel cluster split out
  for the spin exactly as v4 (360 tris), muzzle and eject points unchanged.
- **Signature form kept whole: the face shield**, the chest's one front plate in an upside-down U. Its outline, its arch
  and the seams round it are v4's; the salvage patch is welded *on* it, not cut through it.
- **The back stays clear** (behind y 1.0, below the hood) for the game's drums and power pack.

## What changes, by purpose (every piece says why it is there)

| Read | Piece | Says |
|---|---|---|
| 40 m | tyre strapped flat on the right side-box top; five sandbags on the left one | "they sandbagged it against plunging fire": top-down shapes the 50 deg camera sees |
| 40 m | tyre hung on the crotch skirt by chains | spaced armour in front of the hip block, the most Mad Max read from the front |
| 40 m | rusted corrugated sheet on brackets off the right thigh's outer face | a side skirt over the leg; breaks the left/right symmetry of the silhouette slightly |
| 40 m | paint patchwork: blue-grey, construction yellow, red-oxide primer, bare steel panels | parts from other machines; never as a pair (right thigh front blue, left khaki; left knee cap yellow, right khaki; left horn primer, right khaki) |
| 15-25 m | torch-cut scrap plates with clipped corners, weld bead all round, a few bolts | patches over hits: shield leg (primer), cheek, hull flank, left thigh, right shin, right cannon, gun receiver |
| 15-25 m | a stop sign welded on the right hull flank | Wildcat brand flavour: "rebar, stop signs and raw spite" |
| 15-25 m | rebar slat cage standing 0.14 m off the left hull flank | spaced armour over the side box |
| 15-25 m | track section hung down the left cannon | a skirt over the cannon's pipes |
| 15-25 m | lamp bar on posts over the brow (3 lamps), a spot on the left pauldron, a lamp clamped on each gun | they work at night (the game has a day-night cycle) |
| 15-25 m | fishbone TV antenna on the hood beside v4's whip | scavenged comms |
| 10 m | weld-stitched cracks (zig-zag beads) on cheek, chest side, left thigh, knee cap, cannon, wing, receiver top | maintained, not wrecked: every crack has been repaired |
| 10 m | v4's "01" painted out on the blue thigh plate, "27" from its donor stencilled lower | the plate's history |
| 10 m | strap bands round the gun receiver, a yellow feed box off another gun | the guns' field repairs |
| all | wear dial heavy: the bake's chipped chamfers wear 0.35 -> 0.7, dust 0.25 -> 0.35 | hard use |

## Layers

- 0 mass, 1 frame, 2 actuation, 3 power, 4 mounting, 6 seals, 7 heat, 8 service: v4's, untouched.
- 5 plates: v4's geometry; 16 panels repainted (`REPAINT`), each keeping its painted rim, edge band and insets.
- 9 sensors: v4's + five lamps (glow faces).
- 10 mods (heavy): everything in the table above, in each part's `__Mods` mesh, built in world rest coordinates on the
  surfaces of v4's masses (ray-projected), so it rides its bone in the game.

## Plate map changes (repaints)

Torso: left pauldron blue-grey; right hull flank back panel yellow; right hood side primer; left chest side bare; right
side-box top bare. Pelvis: left hip wing blue-grey. Thigh R: front plate blue-grey. Thigh L: lower back primer. Shin L:
knee cap yellow. Meta L: horn primer; Meta R: horn khaki (v4 olive), lower pod bare. Foot L: one toe cap primer. Gun:
outer-front receiver panel primer, feed box yellow, shoulder cap blue-grey.

## Joints

No joint changes; v4's ranges stand. Nothing added crosses a joint: mods sit mid-link (thigh, cannon), the tyre hangs
inside the thighs' swing (|x| < 0.36 against the thigh inner faces at about 0.6), the shin plate and knee-cap weld sit
on the shin's own plates.

## Left out

Rust noise on big faces (large panels are a few big polygons, so vertex-colour noise would smear across them); a back-
mounted tank or jerrycans (the back is reserved for the game's pack); anything on the left (rocket) arm, which the game
does not show.
