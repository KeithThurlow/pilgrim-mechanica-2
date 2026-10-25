# Rampart Siege: critique

Run 2026-10-24 (Claude, mech-modeler agent). Source `tools/blender/mechs/variants/rampart-siege/rampart_siege.py` (on
`rampart_v4`), renders `shots_siege.py`. Game model `public/models/mechs/rampart-siege.glb`: 12 meshes, 33,858 triangles.

## What it is

The heavy siege Rampart: the Rampart's hull widened (x1.12) and squashed (x0.88), sitting 0.37 m lower on new, shorter,
thicker, wider-set digitigrade legs (hip 2.72 m at x 0.92; femur 1.44, shin 0.68, cannon 1.02 to the foot point), big
barrel thighs with tank side skirts, broad three-toed machine feet, and a siege cannon on each shoulder (the right one
modelled, the left its mirror, as the game does). Paint: Valhalla gunmetal slate, hazard yellow, a stencilled V.

## Checks

| Check | Result |
|---|---|
| Signature form: the armoured thigh plate | **Survived whole** (`mass_vs_final.png`): one plate over the top-front, pike front and outer-front facet down to a V over the knee; seams run round it; rivets and the hull number sit on it, nothing cuts it |
| Knock knees (front ortho, `front_legs*.png`) | Never: knee 0.03 m outboard of the hip-ankle line at rest, 0.035 / 0.014 m in the stance; shins run straight down |
| Joint range (`range_legs.png`) | Thigh swung 32 deg forward with the knee bent 54 deg, and 30 deg back with the hock opened: the skirt stays outboard of the shin and knee servos, the knee drum gap stays open |
| Axis-aligned plate skin | Thigh 0.058 (0.32 before the skirt got its 4 deg flare and 6 deg toe-in), Shin 0, Cannon 0.036, Foot 0.204, Pelvis 0.16, Torso 0.12, Pod 0.24 (weapon limit 0.5). Nothing flagged |
| Booleans | per build ~845, ~21 fallbacks (hole-tolerant), 0 skipped cutters |
| Export | all parts manifold except one non-manifold edge on `Part_Pelvis` (inherited from the Rampart's pelvis) |
| Game | loads with `?mech=rampart-siege`, walks, the collar spins, fires from the muzzle brake (`ingame_*.png`) |

Triangles (export): Torso 8,073, Pod 3,730 + collar 164, Thigh 3,980 each, Cannon 2,552, Foot 2,186, Shin 1,330,
Pelvis 1,798. A leg is ~10k, over the skill's 4-5k guide, mostly actuation and service (rams, pipes, rivets, toe hinges).

## By read

**40 m (`game40.png`, `game40_x3.png`).** Reads as a squat, wide, heavy mech: the two cradles with mantlets are the
biggest shapes after the hull, the barrels point at the camera with a mass behind them (no sticks), the thighs and
skirts give it a planted stance, the three-toed feet spread. The hood is still the Rampart's olive-teal spine and is the
strongest single tone from 50 deg; the slate hull and legs separate well from the sand.

**15-25 m (`zoom10.png`, `front34.png`, `thigh_close.png`).** The thigh plate is the big calm panel, its painted rim and
the facet creases (inner-front and top-outer chamfers) catch light; the rivet rows on its top and over the V add the
Valhalla heaviness without cutting it. The skirts read as tank skirts: two shingled panels, bolt rows on the hanger
line, a V on the upper one. The mantlet is one thick faceted block; the recoil cylinders read on top of the cradle.

**10 m (`gun_close.png`, `feet_q34.png`, `back34.png`).** Muzzle brake slots, the fume extractor and clamp bands, the
recoil collar and lugs, the ejection port and bricks on the cradle; toe hinge drums and rams, ankle trunnions and rams,
sole pads; the back of the thigh opens on pipes, hamstring bundles and the flange web.

## By layer

- **Frame:** thigh core with pockets, clevis cheeks, shin side links, cannon core, the breech block. Dark olive, never a
  hole. Fine.
- **Actuation:** plenty (it is 11.6k of the 37.7k render triangles): the gun's recoil cylinders and recuperator are
  the brand's "massive recoil compensators". Possibly too much on the feet at 10 m.
- **Power:** hamstring and cannon bundles; little shows from the front.
- **Mounting:** skirt hangers and the thigh flange web show behind the skirt and at the thigh back; from the front the
  legs show almost no light ribs (`layer_map.png`).
- **Plates:** the thigh plate and skirts are the best part. The hull is the Rampart's, transformed, so it carries the
  Rampart's face shield signature rather than anything Valhalla.
- **Seals, heat, service, sensors:** the Rampart's, plus knee/ankle/hip boots, hazard bands on the knee guards and the
  mantlet top, lifting eyes on the mantlet, rungs on the skirt (the climb to the hull). The antenna was removed
  (Valhalla ignores avionics).

## Worst remaining issues

1. **The hull is the Rampart's.** Wider and squatter, but it reads as "a Rampart on heavy legs" more than a Valhalla
   artillery platform: no blast plating of its own (a first attempt at flank blast plates collided with the thigh tops
   and the transformed chest bricks and was taken out). Next pass: a thick spaced brow plate and stacked blast bands
   on the chest's lower front, modelled in the siege hull's own coordinates.
2. **The game's back kit sticks up.** The game hangs its drums and stand-in power pack 0.25 m above the waist; with the
   squatter hull the pack now rises above the hood (`ingame_close.png`). The power pack or its height should follow
   the model (a `Waist`-relative offset per mech, or the hull top).
3. **Legs are heavy on triangles** (~10k each including the foot) where the guide says 4-5k; the read justifies some,
   but rivets, toe rams and pipe clamps could be thinned.
4. **Foot body front** is a dark frame wall under the top plate, so from the front the foot reads dark-bottomed;
   a sole-edge plate or lighter frame shade there would help.
5. **Knee guard** under the V is small, and its hazard band only reads at 10 m.

## Revision pass done

After the first full build: the pod's part origin was on the wrong shoulder (the gun hung 2 m out), fixed; the skirt
flagged the axis check (0.32), fixed with a 4 deg flare and a 6 deg toe-in (0.058) that also deflects frontal fire; the
thigh barrel got two facet cuts; rivet rows along the thigh plate's top and V; the gun's "155" stencil, which mirrors on
the game's left pod, became a symmetric Valhalla V; the antenna came off as whole loose parts (a partial delete had left
an open cap on the torso).
