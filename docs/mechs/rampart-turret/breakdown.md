# Rampart turret: breakdown (written before code)

Variant id `rampart-turret`. The Rampart with its hull and cockpit head replaced by a low, wide, long faceted tank
turret. Old part catalogue, `torso.turret`: "Headless, wide, long and angular, like an M1 Abrams turret: heavily
armoured, slow to traverse." Brand: Stratford-Aegis, "The Aerospace Apex" (sharp radar-absorbent angles, integrated
long-range avionics, pre-war hardware treated as a relic).

Sources: the brief, `torso.turret.asset`, the old project's `docs/brands.md`, `art-refs/Stratford-Aegis/` (five
images: gunmetal and near-black armour with off-white panel blocks, red accent stripes, small amber lamps, faceted
helmet-like heads), `_house-style/notes.md` and "heavy armor, no shoulder or back mount.png" (heavy builds get their
bulk from the torso mass itself, no bolt-on shoulder or back mounts), `mech-reference/notes.md`. Real turrets reasoned
from: M1 (flat long turret, cheek armour boxes with near-vertical faces angled in plan, bustle overhanging the deck,
sights in armoured "doghouses" on the roof, smoke dischargers on the cheek sides), Leopard 2A5+ (the wedge add-on
armour on the front: a pointed spaced plate sloped back hard), T-14 (a faceted, crewless box with sensor blocks set
into it). No 3D reference: this is a design-note build, so step 0 is skipped and the mass is gated on its own.

## Proportions (game height 5.2 m, pilot 1.8 m)

| | Rampart v4 | Turret variant |
|---|---|---|
| Torso height | 3.11-5.05 m (1.9 m, a tall hunched hull plus hood) | 3.80-4.76 m (0.96 m, about half a pilot) |
| Torso width | 1.98 m (side boxes) | 2.12 m at the cheeks, leaning in to 1.80 m at the roof |
| Torso length | 2.5 m (nose -1.20 to rear 1.37) | 2.66 m (nose -1.64 to bustle back 1.02) |
| Top of the mech | 5.2 m (rocket box) | about 4.95 m (sight heads); turret roof 4.76 |
| Width : height : length | | 2.2 : 1 : 2.8 (an M1 turret is about 4 : 1 : 3.6 without the gun) |

Fixed by the game contract and kept: hips (x 0.78, z 3.05), knees, hocks, ankles, feet, waist (0, 0.10, 3.45),
shoulders (x 1.02, y 0.10, z 4.34), minigun axis (x 1.96, z 4.02). Back room: the game hangs its drums at y 1.15-1.97,
z 3.29-4.01 and its power pack at y 1.10-1.85, z 4.40-5.10, |x| < 0.78 (measured from `rampart.ts` and the drum GLB), so
the bustle ends at y 1.02 and the pack sits against it like an M1's bustle rack. Gun clearance: at the 30 degree gun arc
the right gun's hub comes in to x -1.32 at y -0.89, so the cheeks stop at |x| 1.06.

## Mass list (layer 0)

| Mass | Built as | Joins |
|---|---|---|
| Turret | plan prism (z) ∩ side prism (x) ∩ front prism (y), then cuts (below) | sits on the turret ring, 0.33 m clear of the pelvis |
| Turret ring and basket | a dark drum r 0.62, z 3.62-3.82, over the Rampart's waist drum | frame, under the turret; reads "turret on a ring" |
| Pelvis, legs, feet | Rampart v4 unchanged in form | |
| Minigun pods | Rampart v4 right arm; the left is its mirror (renders only, the game mirrors it itself) | shoulder drums in recesses in the turret sides |

Turret profiles (+x halves, metres):
- Plan: nose (0, -1.64), V to (0.40, -1.52), cheek face angled about 30 degrees back to (0.98, -1.18), widest
  (1.06, -0.90) to (1.06, 0.40), bustle taper (0.96, 0.72), (0.80, 1.02).
- Side: lip (-1.64, 4.16), glacis up at 31 degrees to the crease (-0.74, 4.70), roof rising to (0.60, 4.76), bustle back
  (1.02, 4.70)-(1.02, 4.20), bustle undercut to (0.62, 3.92), floor (-0.90, 3.80), lower front face leaning out to the lip.
- Front: floor (0.80, 3.78), lower chamfer to (1.06, 4.02), side to (1.05, 4.30), side leaning in 18 degrees to the roof
  edge (0.90, 4.80).

Cuts (each offset-consistent in `mass(d)`): cheek facets (a compound slope off each front-outer corner), front lower
corner chamfers, bustle top-rear chamfer, bustle lower side chamfers, shoulder recesses (joint room for the pod mounts),
a vision-band recess in the lower front face under the lip, the commander's hatch well on the roof. That is 7 cuts plus
the three profiles.

## Signature form (skill 7b)

**The front glacis**: one raised plate, a trapezoid narrowing up the 31 degree slope from the lip to the crease, wrapping
over the lip a hand's width onto the lower front face (a plate that turns a corner). Nothing cuts through it: the cheeks,
roof and lower front are seamed round it. From the 50 degree game camera it is the biggest lit facet on the mech.

## Per layer

| # | Layer | What shows | Where it shows through |
|---|---|---|---|
| 1 | Frame | the turret's inner hull (`mass(-0.20)`, the pilot tub inside), the turret ring and basket, waist and shoulder drums; legs as v4 | under the turret overhang, in the shoulder recesses, at the ring |
| 2 | Actuation | traverse drive motors on the ring (two flat servo blocks), pipe bundles under the overhang out to the gun yokes, the pods' rams; legs as v4 | under the turret sides, at the ring |
| 3 | Power | conduits from the bustle's back (where the game's pack plugs in) round the ring to the shoulders; legs as v4 | under the bustle, round the ring |
| 4 | Mounting | two deep flange hoops just inside the plates: one on the slanted cheek/side seam plane, one on the y 0.60 roof/bustle seam plane | the two wide seams (6 cm) on the sides and roof |
| 5 | Plates | glacis, cheeks with reactive bricks, roof front and rear, sides, bustle sides and back, lower front band | |
| 6 | Seals | waist boot, shoulder bellows (pods), leg seals as v4 | |
| 7 | Heat | one louvre bank recessed in the roof behind the hatch (sight and avionics cooling) | |
| 8 | Service | commander's hatch, lifting eyes on the roof corners, grab rails along the bustle, rungs up the side behind the shoulder, stencils | |
| 9 | Sensors | the face: three amber lenses in the dark vision band under the glacis lip; the gunner's sight doghouse (roof front right), the commander's independent viewer (roof left), periscope vision blocks round the hatch, laser-warning domes on the cheeks, two whip antennas, a wind-sensor mast | |
| 10 | Mods | none (a pre-war Stratford-Aegis relic, clean) | |

## Plate map (turret)

| Panel | Shell (offsets) | Region | Notes |
|---|---|---|---|
| Glacis (signature) | thickest, -0.10 to +0.06 | flow region in the glacis plane, trapezoid u ±0.70 at the lip to ±0.52 at the crease | raised above everything round it, 4.5 cm rim chamfer; one red Stratford stripe inset near the top |
| Cheeks x2 | thick, -0.08 to +0.04 | glacis-frame region outboard of the glacis edge (4 cm seam that follows the edge), down to v 0.40 | wraps the front-outer corner and the front of the side; its back seam leans back going down with the glacis plane; 3 x 2 reactive bricks on the plan-angled face, a darker inset on the side |
| Roof front | thin, -0.06 to -0.02 | plan region, crease to y 0.57 | sight doghouse on it |
| Roof rear | thin | plan region, y 0.63 to the back | hatch well, louvres |
| Sides x2 | normal, -0.07 to 0 | x region behind the cheek seam to y 0.57 | the shoulder recess cut into it |
| Bustle sides x2 | normal | y 0.63 to the back | stowage bin (addon) |
| Bustle back | thin | | small, the pack hides it |
| Lower front band | normal | under the glacis wrap, x ±0.70 | the dark vision band with the sensor lenses |

Seams: 4 cm generally, 6 cm on the two hoop seams so the light ribs read at 40 m. Big calm areas: glacis, cheek tops,
roof. Detail clusters: the roof (sights, hatch, louvres), the cheek faces (bricks), the shoulder recesses.

## Edges

Rim chamfers 4.5 cm on the glacis and cheeks, 3.5 cm on sides, 2.5-3 cm on the roof and bustle. The edges that should
catch the sun at 50 degrees: the glacis lip and its slanted side edges, the cheek tops, the roof's side edges where the
sides lean in, the crease. Painted edges (1.2x rim, 0.66x band) come with v4's `panel()`.

## Paint (brand)

Stratford-Aegis in desert service: plates a pale aerospace grey, the glacis, cheek bricks and lower-leg guards in a
darker blue-grey gunmetal, the frame a neutral dark grey (not near-black), red accent stripes, cream-white stencils,
amber lamps. The whole Rampart is repainted to match by remapping its paint colours before the bake (one switch,
`BRAND_PAINT`, turns it off and leaves v4's khaki).

## Joints and ranges

- Waist turn (turret traverse): unlimited on the ring in principle (game limit 120 degrees from the legs); the turret's
  floor is 0.33 m above the pelvis and the ring is a clear drum, so it reads as able to turn.
- Shoulders (gun yaw ±30 degrees, pitch to the game's limit): each pod's shoulder drum sits in a 0.78 x 0.56 m recess in
  the turret side, so the arm link and bellows have room; cheeks stop at |x| 1.06 to clear the hubs at full inward yaw.
- Legs: v4's ranges, unchanged.

## Weapon pose

Twin hull miniguns forward along the aim, as v4 (the game contract). The left one in the renders is a mirror of the right.

## What to leave out

Anything that only reads below 10 m inside the turret (crew interior, the pilot), fine bolts on the roof beyond a few rows,
a main gun (it is headless and gunless by the catalogue; the miniguns are the armament). No back mount on the turret
itself (house style; the game's pack hangs there).
