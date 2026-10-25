---
name: mech-modeling
description: Model a Pilgrim Mechanica mech (or one mech part) procedurally in Blender Python, from a reference image or a design note, in the game's layered construction - mass first by additive/subtractive booleans, then frame, actuation, power, mounting, plates (where most of the look lives), seals, heat, service, sensors, mods. Use for any mech, mech part or mech study modelling task; weapons and vehicles borrow its plate and edge rules.
---

# Mech modelling (Pilgrim Mechanica)

Status: v0.8 (ported to Pilgrim Mechanica 2, 2026-10-24; method v0.7 from Keith 2026-10-22). This skill is meant to grow. Every run ends by proposing amendments (step 9), so the method gets codified until mech assets can be generated mostly automatically, the way the walker's animation already is.

## Ground rules

- **Code is the source.** Every mesh comes from a headless Blender script, run through the queue: `node tools/blender/run.mjs <script.py> -- args` (Blender 4.4, `-b --factory-startup`, a Python error fails the run). FBX, GLB, json and renders are generated and never hand-edited.
- **Kit:** `tools/blender/mechs/hskit.py`, documented in `tools/blender/mechs/README.md`, with `studies/military/mil_kit.py` and the Rampart study (`studies/rampart/rampart_v4.py`, the current mech).
  - It builds on `tools/blender/vehicles/vkit.py` and `tools/blender/buildings/stock.py`, which are read-only to you.
  - Shared kit files (hskit, mil_kit, rampart_v4, export_game) are read-only while other modelling agents run; put new helpers in your own folder and list them in your `skill-notes.md` for the manager to fold in.
- **Units and axes:** metres, Z up, front -Y, the mech's left +X. Build in world rest-pose coordinates. (The game is Y up, +Z forward; the export handles it.)
- **Blender slots:** `run.mjs` lets at most two Blender runs go at once across every agent (Keith's PC is short of memory). It waits for a slot by itself; don't start Blender any other way.
- **Reference images:** never commit reference pixels (the old project's `art-refs/`, or composites with a reference in them). Side-by-sides go in the scratchpad only.
- **Size:** every mech comes from one height (`mechHeight` 5.2; the walker's head sits about 4.7 m up). A 1.8 m pilot stands at about knee to mid-thigh.
- **Every part and layer reads with a purpose (Keith 2026-10-22).** Before modelling a piece, say in one line what it communicates. Plates read as "this deflects": angled to the likely fire, thick edges, overlapping like armour. Every non-plate piece shows what its layer does: the frame carries load (lugs, lightening holes, axles), actuation moves (rams on lines of force, hoses that loop with the joint), power feeds (bundles, junctions, couplings), heat vents, service is used by a person, and sensors look. A detail with no purpose is noise, so cut it.
- **Work posed, rig at rest.** Put the legs, arms and weapons under temporary pivot groups and render in a stance like the reference's (weight on one leg, a stride, guns raised) while judging forms. A stance shows forms and proportion problems that a stiff rest pose hides. Before export, return everything to the rest pose so the model stays easy to rig. Keep the pose as a script option (`--pose stance|rest`), not baked into the meshes.
- **Read the design first:** `docs/design.md` and the Unit look row of `state.md` here; the old project's `docs/design/art-and-world.md` (`C:/Users/thurl/Development/pilgrim-mechanica/`) for the wider look. The game is grounded military and 80s real-robot, not Gundam. In this game units are plain lit paint over vertex colours under a harsh desert sun, no outline by default (cel bands and ink are toggles), so the painted edges and plate shading do the work.

## Pilgrim Mechanica 2: from script to game

- **Scratch space.** Parallel agents share one scratchpad: work only in `<scratchpad>/<id>/` and check a render is yours before copying it (2026-10-24: agents' render folders got mixed up).
- **Back kit.** The game hangs two ammo drums and a stand-in power pack on the back and paints them per variant (`src/mech/variants.ts`: `backAt`, `drumTint`, `packBody`, `packCells`); give the manager values for yours. Drop the unused left arm at export with `--drop Arm_L`.
- **Where things go.** A variant lives in `tools/blender/mechs/variants/<id>/` (its build module, shots script, helpers), its notes and renders in `docs/mechs/<id>/` (`breakdown.md`, `critique.md`, `skill-notes.md`, PNG renders), and its game model at `public/models/mechs/<id>.glb`.
- **Build on the Rampart.** A variant module imports `rampart_v4` and replaces what changes. `rampart_v4`'s `build_full()` calls its own module globals, so patch replacements onto that module (`import rampart_v4 as R; R.torso = torso`) or copy the functions you change into your module; redefining them in your file alone does nothing.
- **Export.** `node tools/blender/run.mjs tools/blender/mechs/studies/rampart/export_game.py -- --model tools/blender/mechs/variants/<id>/<id>.py --out <scratchpad>/<id>.fbx`, then `npx tsx tools/fbx-to-glb.ts <scratchpad>/<id>.fbx public/models/mechs/<id>.glb`. Hooks a variant can define for guns unlike the minigun: `export_gun_points()` and `export_split_guns(parts, split_off)` (see the docstring at the top of `export_game.py`).
- **The game's contract** (`src/mech/rampart.ts`). Meshes `Part_Pelvis`, `Part_Torso`, `Part_Thigh_L/R`, `Part_Shin_L/R`, `Part_Cannon_L/R`, `Part_Foot_L/R`, `Part_Pod_R`, `Part_PodSpin_R`; empties `Thigh_L/R` (hip), `Shin_L/R` (knee), `Cannon_L/R` (hock), `Foot_L/R` (foot point), `UpperArm_R`, `Waist`, `PodSpin_R`, `PodSpinFwd_R`, `PodMuzzle0_R`, `PodEject_R`. The game mirrors the right pod onto the left shoulder and ignores the left arm, spins `Part_PodSpin_R` about `PodSpin_R -> PodSpinFwd_R` (give a non-spinning weapon a small piece there, such as a coil ring, so it still exists), fires from `PodMuzzle0_R`, ejects at `PodEject_R`, and hangs its own ammo drums and power pack on the back (about 1.1 m behind the waist), so leave room there. Leg lengths are read from the empties; the walker is digitigrade (hip, knee forward, hock back, foot), so keep that chain. Toe hinge 0.14 m ahead of the foot point unless the variant gets its own `LEG_TYPES` entry.
- **See it in the game.** Don't run `npm run build` while other agents work (it rewrites `dist/` under them); `shots.mjs` serves new GLBs from `public/` without a build. Run `node tools/shots.mjs "/labs/walker/?cam=close&mech=<id>&set=sunAzimuth:30,sunElevation:40" "/labs/walker/?cam=game&mech=<id>&fire" "/labs/walker/?cam=side&flat&walk=straight&mech=<id>"`; PNGs land in `shots/`. Look at them. Use `?mech=<id>` in the dev server too.
- **References** are in the old project: `C:/Users/thurl/Development/pilgrim-mechanica/art-refs/` (`mech-reference/` with `notes.md`, `_house-style/` with `notes.md`, `robot-reference/`, and one folder per brand with `notes.md`; brands in that project's `docs/brands.md`). The Rampart's own 3D reference is `art-refs/mech-reference/helldiver/` (a Tripo model; external IP, never shipped). The old part catalogue, with each part's description and walker values, is `Assets/_Project/Combat/Data/FrameParts/*.asset` and `Assets/_Project/Combat/Data/Walker/Gear/*.asset` there.

## The three reads (judge every step against these)

The camera sits at a 50° pitch about 40 m away, and zooms to about 10 m at 45°.

1. **Silhouette (40 m).** Masses, proportions, the outline from above-front. This is most of what players see. It comes from the mass layer.
2. **Plates and edges (15-25 m).** How the plates break the forms into panels, and the bright chamfered edges catching the key light. Keith (2026-10-22): plating, and the edges you perceive around it, does a lot of the work. Spend the most effort here.
3. **Detail (10 m zoom).** Inner layers showing through gaps, stencils, bolts, hoses, wear.

A step that doesn't improve one of these reads is wasted triangles.

## The layers (inside out)

Layer 0, mass, is a construction layer only: it is not exported. Layers 1-10 are each exported as their own mesh, named `<Part>__<Layer>`, with their own paint section (the `H.Part` / `LAYER_SECTION` table in the README).

| # | Layer | Value / colour | Role |
|---|---|---|---|
| 0 | **Mass** | (not drawn) | The volume and silhouette. Every other layer is derived from it or fitted to it. |
| 1 | Frame | dark | Beams, the inner hull, joint drums, the armoured pilot tub (every torso has one). |
| 2 | Actuation | metallic, a little lighter | Servos, rams, pistons, pipes, tubes, cables. |
| 3 | Power | dark, near the frame, cool tint | Muscle-like bundles where muscles would be, cells and the core in the torso. |
| 4 | Mounting | light | A web of ribs and standoffs following the inside of the plates. Mostly hidden; shows in the gaps. |
| 5 | Plates | paint, any colour | The armour. Strip-cut panels with chamfered edges. |
| 6 | Seals | dark matte rubber | Boots, bellows and gaskets over a joint's bend range. |
| 7 | Heat | darker than the frame, glow faces | Fins, louvres, stacks. |
| 8 | Service | bare metal | Handholds, rungs, hatches, lifting eyes, stencils, all at pilot scale. |
| 9 | Sensors | family glow | Lenses, lamps, antennas, the face. |
| 10 | Mods / wear | salvage | Dial none / light / heavy by faction. |

Value order to check in every render: frame and power dark, actuation a step lighter, ribs light, plates whatever the paint is. If everything comes out mid-grey, the layers aren't reading.

## Steps

### 0. Working from a 3D reference (preferred input)

A 3D reference, such as a Tripo3D model Keith supplies, beats a painting: it can be measured instead of guessed. The Rampart v2 run (`docs/mech-skill-rampart-v2-2026-10-22/`) went from a painting-only outline to a mass match of 0.75-0.80 this way.

1. **Import headless and scale** to the game height (5.2 m).
2. **Render fixed orthographic cameras** (front, side, back, top, three-quarter) twice each: once shaded and once as a black-on-white mask. Every pixel then converts to metres.
3. **Render each region alone** (each leg link, the torso, each weapon, the pelvis). Isolating regions caught three measurement errors that a whole-mech view hid.
4. **Slice plane sections** through every major mass (thigh, shin, torso, head) and plot them on a 0.1 m grid. These are the real plate curvatures. Build plates from them, not from guesses.
5. **Turn sections into masses.** Take one convex outline per view and build each mass as the intersection of three prisms. Add section stations wherever the form bulges or tapers (barrel thighs, pods).
6. **Read the joints** from the side sections (hip, knee, reverse joint, ankle heights) and build each link in its own bone frame.
7. **Gate the mass** at identical cameras, in the rest pose: an overlap of about 0.75 or better on every view. Note which mismatch is the reference's pose (record its offsets) and which is a real form error. Judge forms in the stance, gate at rest.
7b. **Name the signature forms at the mass gate (Keith 2026-10-22).** Pick the 1-3 forms that make the mass appealing (v3: one big front plate in an upside-down U over the chest). Write them down in the form study. They must survive into the final model as single, uninterrupted plates: panel seams go round them, never through them. Compare the final model to the mass render at the end and say whether each one survived.
8. **Build in the rest pose,** unposing the reference in your head.
9. **Forms come from the model; paint, markings and stencils from the painting** or the faction.
10. **Keep reference pixels out of the repo:** the model, its textures, and any render or side-by-side containing it stay in the scratchpad.

Tools for this belong in `tools/blender/mechs/ref/` (import, scale, ortho masks, region isolation, sections, overlap score).

### 1. Break the reference down (before any code)

Write `breakdown.md` in your docs folder:
- **Proportions.** Measure in pilot heights from the reference: total height, shoulder width, torso depth, thigh and shin length, foot size.
- **Mass list.** Every major mass and its primitive or profile, and how it joins its neighbours (union, overlap, or a gap at a joint).
- **Per layer (0-10).** What is visible, its shape language, its value and colour, and where it shows through the plates.
- **Plate map.** For each mass:
  - how many panels and where the seams run;
  - which panels are raised, inset or stepped;
  - where the big calm areas are and where detail clusters;
  - chamfer widths.
- **Edges.** Which edges catch light in the reference (usually the top and front rims of plates and the facet breaks on the cockpit), and roughly how wide the chamfers read.
- **What to leave out.** Detail that won't survive 40 m and doesn't help the 10 m zoom.

- **Decide the weapon pose.** Barrels point forward along the aim in the game, even if the reference poses them sideways, and forward barrels change the top-down read.
- **Size from the game.** The game's mech height beats the reference's own scale figure: a soldier in a painting is rarely accurate (Rampart run: 2.9 pilot heights, not 3.3).

### 2. Mass (layer 0): additive and subtractive booleans

**Write every mass as a function of an offset, `mass(d)`.** The plate shell (d = 0), the inner face of the plates (d = -plate thickness), the rib hoops (d = -plate - rib) and the frame (d deeper still) are then the same expression at other offsets, so every layer fits the next exactly. Kit helpers: `H.prism`, `H.convex_offset`, `H.intersect`, `H.xform`, `H.section_loop`.

This is not how a human sculpts a mech, but it suits a script well. Every mass is a CSG expression that can be read in code.
- **No rectilinear starts (Keith 2026-10-22).** A cube is almost always the wrong first solid. Start from wedges, tapered prisms, lofts and extruded non-rectangular profiles. If a mass is still rectilinear when you finish, it is almost certainly too basic. Weapons are a partial exception: boxy housings and tubes are fine there, but take their proportions from the reference. Rectilinear shapes do belong as **add-on detail with a purpose**: reactive armour bricks like a tank's, ammo boxes, stowage bins, equipment crates, bolted on top of the shaped masses. Use them in rows or clusters where they read as added protection or kit, never as the base mass of a part.
- **Armour is shaped; machinery may be flat (Keith 2026-10-22, after v3).** The no-rectilinear rule is for armour masses. Highly functional parts can and should have flatter faces and read as technical: leg mechanics, actuator housings, servo blocks, brackets, launcher boxes (v2's flat-sided rocket box was good). Legs in particular need more technical parts between their armour.
- **Fold overshoots into the loft.** A horn, spur or counter-mass past a pivot is extra stations of the link's own loft. Unioning it on as a separate solid failed in v3 and skipped every later cut.
- **Offsets consistent in every cutter.** A slab or scoop with a limited footprint shrinks its width and height by 2d as its plane moves by d, or `mass(d0)` and `mass(d1)` share walls and the shell is non-manifold. Orthonormalise scoop directions against the normal.
- **Cut more than you think.** After the first envelope, keep cutting forms out of each big mass: chamfered corners, scoops, steps, recesses, tapers. The v2 chest and thighs were a marked improvement but still too few cuts. A big mass with fewer than about 4-6 cuts reads as a block.
- **Links overshoot their pivots.** A leg or arm link carries on past the joint it turns on, as a horn, heel spur or counter-mass, and the joint sits inside the mass, not at its end. The v2 cannon segment (the long lower leg link) stopped at its pivot on the shin where the reference carries it past. Read the overshoot from the side sections and model it. A link that ends exactly at its pivot is too simple.
- **Add.** Start from closed solids that are not boxes: wedges, tapered prisms, extruded 2D profiles (side and front outlines extruded, then *intersected*, which is the best trick for a hull), lofts through superellipse stations, and capsules for joint drums. Union them with `H.fuse` (seams filleted).
- **Subtract.** Shape with differences. `H.cut_slab` on tilted planes facets corners and noses. Scoops, notches, wheel-well-like recesses and undercuts take volume away. Faceting a curved mass into 3-6 planes per quarter turn reads far better under cel shading than a smooth curve.
- **Intersect.** Use it to trim a mass to its envelope: the side profile ∩ the front profile ∩ the top profile gives a believable hull in three lines of code.
- **Joints.** One closed manifold per rigid part (pelvis, torso, thigh, shin, foot, upper arm, forearm, head and pods). Leave real clearance at joints for the seals layer and for motion.
- **Gate the head separately.** Its width and wedge shape (the Rampart cockpit came out an egg where the reference is a wide wedge with a V chin) are the mech's face, and they're easy to get wrong inside a whole-mech gate.
- **Gate.** Render the mass alone, flat grey, from the game camera at 40 m and from the reference's angle. Compare the silhouettes before going on. Fix proportions here, because they are cheap to change now and expensive later.

### 3. Frame (1) and the pilot tub

Derive the frame from the mass. Inset or shrink the mass (or a simplified version of it) by roughly the plate depth plus the rib depth, then carve lightening holes and slots into it. The frame must be clearly smaller than the mass, or the inner layers have no room. It should not fill the shell: that was the 2026-10-22 industrial torso's flaw. Joint drums and axles sit at the pivots. The torso holds the armoured pilot tub and seat, with the canopy or vision block as its exposed face.

### 4. Actuation (2) and power (3)

- **Rams:** run along the lines of force. Anchor them to frame lugs on both sides of a joint (`H.ram`).
- **Hoses and cables:** bundles that loop across joints with slack (`H.ring_tube`).
- **Lots of piping (Keith 2026-10-22).** Run pipes and tubing around the part between and under plates: along the ribs, in and out of plate gaps, down the back of each leg link, into the power pack and the weapons. Pipes come in a few gauges, clip to the ribs at intervals, and bend round obstacles with real radii. They should be visible in plate gaps and at the plate edges at the 15-25 m read, so they show the machine is plumbed.
- **Power:** bundles sit where muscles would: the back of the thigh, the calf, the shoulder, plus the torso core.
- **Placement:** put these where the plates will leave gaps (behind the knee, the inner thigh, under the yoke). Anything fully covered is wasted.

### 5. Mounting (4)

Ribs follow the inside of the plate shell, like a web. They are not a box of struts (the 2026-10-22 thigh's flaw). Build the plate shell first (step 6a), then make the ribs from it:
- hoops at stations along the part: `mass(-plate - rib)`;
- stringers along the length;
- standoffs and brackets up to each plate (`H.rib_web`, `H.standoffs`).

Keep it to hoops and stringers. Diagonals turn the web into spaghetti at the close read.

**Big and readable (Keith 2026-10-22).** The ribs are a feature, not a hint. Make them deep and few, with wide flanges (about 8-15 cm deep on a leg, more on the torso), so they read at 40 m in the gaps between plates. Leave the plates real gaps where the web shows, and frame those gaps on purpose. A thin web that only shows at 10 m is too small.

Light-coloured. Make sure some of it shows in at least two gaps per part at the 15-25 m read.

### 6. Plates (5): where the look lives

a. **Shell.** The mass *is* the plates' outer skin. Plates take their thickness inward, from `mass(0)` to `mass(-t)`; only raised panels go outward.

b. **Cut it into panels.** The method that worked best (Rampart run: clean edges, the whole mech's plates in 2.7k triangles):
- Build each panel as **the shell intersected with a region prism**: an outline drawn on the surface and extruded through it.
- Chamfer only the panel's rim edges.
- Leave 3-4 cm seams between panels, so they read at 15-25 m.

`H.strip_plate` remains the tool for bands that run along a curve. Slicing one shell with cutter slabs is the fallback.

Prefer several overlapping plates to one plate wrapped round a form. Overlaps cast shadow lines that read at a distance; a raised cap overlapping the slab below like a shingle was the strongest single read on the Rampart thigh.

c. **Panel hierarchy.** Big calm panels, about 60-70% of the area, against clusters of small ones. Raise some panels (a step up), inset others, and have a few overlap like shingles, upper over lower so rain would run off.

d. **Edges.**
- Every exposed plate edge gets a chamfer, about 2-3 cm on small panels and 4-5 cm on big slabs, so it catches the key light as a bright line. This is the main read at 15-25 m.
- **Paint the edges as well as shaping them.** Chamfers only light up when they face the sun, so give each panel's rim chamfer a lighter colour (about 1.2x the plate colour) and the band just inside it a darker one (about 0.66x). The edge then reads from every angle. This was the biggest gain in the Rampart run.
- Use a single flat chamfer (segments 1) on plate rims and rounds (2+) only on cast parts.
- Corners get clipped or angled, never left as square box corners.
- Keep plate edges straight or cleanly curved. Jagged or stair-stepped boolean edges (the 2026-10-22 torso) mean the cut needs `H.clean` / dissolve, or should be a strip plate instead.

e. **Thickness.** Plates are visibly thick, 4-8 cm, and that thickness shows at every edge and gap. Paper-thin plates read as a skin.

f0. **Seams follow the flow of the surface (Keith 2026-10-22).** Panels look manufactured to fit together when their seams run along the form: along section loops, parallel to the plate's own edges and feature creases, tapering with the form, wrapping round curvature. A rectilinear grid of axis-aligned cuts reads as unbelievable slicing (v3). Cut with planes or strips aligned to the surface's local direction, not to world axes. Fewer, longer, flowing seams beat many short straight ones.
- **Plates flow across parts.** Shoulder plates continue down onto the chest, the hood onto the back, so the armour reads as one designed shell, not a box per part.
- **Stencils sit inside one plate,** never across a seam. A darker inset under a number reads better than a bare plate.

f1. **Think like a tank designer (Keith 2026-10-22).** Mechs are walking tanks, so tank armour is the reference for plating:
- **Slope every face that faces fire.** The front and sides angle away from a level shot, so hits glance off. A vertical face toward the enemy is a weak spot and should look like one, or be covered.
- **Thickest at the front,** thinner on the sides, thinnest on the top and back.
- **Wedges and V-shapes:** glacis plates, pike noses, sloped sides and turret-style faceted cheeks, like a modern MBT turret.
- **Add-on armour shows the threat:** reactive bricks and spaced plates on the front and flanks, skirts over the legs like side skirts over tracks, slat cages over vulnerable rear pieces.
- **Weak points are protected on purpose:** joints, optics and vents sit behind lips, mantlets or louvres.
- For ideas, look at real tank armour and its layout: the M1, Leopard 2, T-14, Merkava, and WWII sloped armour (T-34, Panther).

f2. **Plate rules from the v2 run.**
- Plates are always shells of faceted masses that turn a corner. A plate with no corner reads as cardboard.
- **Don't stack a part from separate blocks.** A thigh is one rounded or barrel mass, cut into panels. Three stacked boxes read as crates (v2's thigh flaw against the Tripo barrel).
- **Every big mass needs tonal variation:** at least one darker or greener inset sub-panel. One plate colour everywhere reads as a pumpkin from the front.
- **Secondary panel density:** the reference models carry many small overlapping sub-plates, grooves and inset details on top of the big panels. Aim for that density on the big masses at the 10 m zoom.
- **Frame and seals stay off near-black** (a dark olive or grey), or every gap reads as a hole.
- **Rib frames stay inside recesses,** or they read as ladders.

f. **Facets.** On cockpit and torso plates, break the form into planar facets with crisp creases, as in the Rampart reference's head. Under cel shading each facet becomes a flat tone, and that is the style.

### 6b. Legs and feet (Keith 2026-10-22)

- **Never knock-kneed.** Seen from the front, each shin runs straight down or splays slightly outward: the ankle is at least as far from the centreline as the knee. Shins pointing toward each other make nothing look scary. Check it in the rest pose and in the stance (front ortho: ankle |x| ≥ knee |x| on both legs) and report it.
- **Feet are machines.** A foot is not one big puck. It shows how it works: articulated toes on hinges with their own rams or servos, an ankle actuator and pivot block, sole pads or treads, heel spur, the cabling into the ankle. From the front it needs a split toe front (a notch between toe caps), or it reads as a puck even when it has toes.

- **Joints need visible room to move (Keith 2026-10-22, after v4).** Every joint must look like it can rotate as far as it needs. v4's hips, cannon joint and foot/toes looked jammed: plates ran up to the pivot with no space. For each joint:
  - Write down its range in the breakdown (hip: swing and spread; knee; cannon/reverse joint; ankle; toes; shoulder; elbow; waist turn).
  - Open the plates around the pivot: scallops, notches, a clear gap round the joint drum, plates that end short of it or overlap so they can slide.
  - Fill that space with the inner layers on show: the joint drum and axle, the rams across it, seals or bellows, hoses with slack, the frame lugs. The gap is where the mechanism reads.
  - Check it: pose each joint to both ends of its range (`--pose` extremes) and confirm plates of neighbouring parts don't pass through each other. Render one range sheet per leg and arm.

### 7. Seals (6), heat (7), service (8), sensors (9), mods (10)

- **Seals:** bellows or boots covering each joint's visible bend gap.
- **Heat:** one strong feature per mech (stacks, louvres, a fin bank) rather than many small ones.
- **Service:** rungs, handholds and stencils sized to a 1.8 m pilot. They are the scale cue at the zoom.
- **Sensors:** the face and lamps carry the family glow colour.
- **Mods:** follow the dial for the faction.

### 8. Renders and checks

Run at least these (`hs_shots.py` has most of them):
- **The reference's angle**, a side-by-side in the scratchpad only;
- **The game camera at 40 m** and **the zoom at 10 m**, on the game's ground colour. Always pair the 40 m render with a 3x crop: the mech is only about 160 px wide there;
- **Ink:** `shots.py --ink sepia|thin|face`. Thin is the working default. Thick sepia separates best from sand at 40 m but flattens the mech up close; face-coloured lines look best close up but melt into the ground at 40 m (Keith to decide);
- **The mass alone** (step 2 gate);
- **An exploded layer view and a layer colour map:** every layer present, value order right;
- **A technique map** (`hs_tag`): booleans, plates and welds are all used, not just bevels;
- **Axis-aligned plate check:** for each part, the share of plate (layer 5) face area whose normal lies within about 3° of the ±X, ±Y or ±Z axis. More than about 25% flags the part for refinement: its plates are probably rectilinear. Weapons get a looser limit (about 50%). Tag reactive armour bricks and stowage (`hs_tag` `addon`) and leave them out of the share. Measure the plates' outer skin only: plate edges and inner skins are axis-aligned by construction. Apply it to armour; functional machinery is exempt. Report the number per part and list the flagged parts in the critique;
- **Stats:** triangles per part and layer, booleans and fallbacks from `H.report()`. Zero skipped cutters is the goal; explain any.

Budgets, as a guide (judge against the read, not the number):
- a full mech is about 25-35k triangles;
- the torso up to about 9k;
- a leg about 4-5k;
- cap the hidden layers per part (about 2-2.5k on a leg) rather than as a share. Plates made from shell-region panels are cheap, so the inner layers can fairly be most of the triangles (70% on the Rampart run) when they earn it at the 10 m read.
- The exploded-layer render is built once, not once per layer.

### 9. Critique by layer, then improve the skill

- Write `critique.md`: for each layer and each of the three reads, what works and what doesn't, against the reference.
- Do at least one revision pass on the worst issues before handing over.
- Finish with **skill amendments**: what this run learned (a recipe that worked, a failure mode, a parameter range, a kit function worth adding). Put them in `skill-notes.md` in your docs folder for the manager to fold into this file. Don't edit this skill directly unless told to.

## Export

One FBX per mech, built with the study conventions in the README:
- the joint empties;
- `<Part>__<Layer>` meshes under each empty, each with its origin at the joint;
- `hs_layer` and `hs_tag` face attributes;
- a json with stats and the hskit report.

For the game, `export_game.py` joins each part's layers into one mesh per bone and writes the contract above; see "Pilgrim Mechanica 2: from script to game".

## Known failure modes (add to these)

- **Primitives plus bevels only:** pillowy and toy-like (Keith, studies v1).
- **A frame that fills the shell:** no room for the inner layers, and nothing shows through (industrial torso v2).
- **Ribs as a rectangular strut box:** they should follow the plates (military thigh v2).
- **One slab wrapped round a form, read as a single plate:** cut it into overlapping panels.
- **Jagged boolean plate edges:** clean, dissolve, or use a strip plate instead.
- **Detail that doesn't change the outline:** at 40 m the change doesn't show. Fix the mass first.
- **Coplanar operand faces in a boolean:** slivers. Offset by a few mm.
- **Wide, strongly skewed strip plates on tight curves:** they fold. The kit's fold guard retries, but plan gentler paths.
- **Carving a filleted, fused solid against an offset copy of itself fails** (the Rampart toe caps). Build shells as `mass(0)` minus `mass(-t)` from the unfilleted expression.
- **Forward barrels at 40 m read as sticks hanging beside the legs.** Give barrels a shroud or a mass at the pod, and check the top-down read.
- **Rectilinear starts:** a cube first solid survives as a crate (v2 thighs, chest). Start from wedges and prisms, and check the axis-aligned plate share.
- **Links that stop at their pivots:** the cannon segment reads as too simple (v2). Carry links past their joints.
- **Weapon housings too boxy against the reference** (v2 minigun): match the housing-to-barrel proportions from the reference sections, not a generic box.
- **Jammed joints:** plates running right up to a pivot, no visible room to rotate, no mechanism showing (v4 hips, cannon, toes). Open the plates round the joint and show the inner layers.
- **Signature forms cut up** (v3's upside-down U front plate, sliced into panels). Keep them whole.
- **Grid seams:** axis-aligned cuts across a curved plate read as fake. Follow the flow.
- **Knock knees:** shins angled inward. Never.
- **Puck feet:** a big foot block with no mechanism.
- **Bright ribs in a gap above the face** read as a halo from 50°: keep that gap narrow or the rib darker.
- **Seals hidden behind rams:** seals go on the side of the joint that the camera sees.

## Revisions

- v0.8 (2026-10-24): ported to Pilgrim Mechanica 2: the Blender queue (`tools/blender/run.mjs`), variants on `rampart_v4`, `export_game.py --model` and its gun hooks, the game's part contract, GLB into `public/models/mechs/`, `?mech=<id>` and headless shots for the in-game check, references read from the old project.
- v0.1 (2026-10-22): first version.
- v0.2 (2026-10-22): amendments from the Rampart trial (`docs/mech-skill-2026-10-22/skill-notes.md` on `claude/mech-skill-rampart`): `mass(d)`, plates inward from the mass, shell ∩ region panels, painted edges, a lighter rib web, weapon pose and scale in step 1, the head gate, a per-part budget for hidden layers.
- v0.3 (2026-10-22): from the Rampart v2 trial on the Tripo model (`docs/mech-skill-rampart-v2-2026-10-22/skill-notes.md`): step 0 (working from a 3D reference), the v2 plate rules, the 3x crop, and the ink options.
- v0.7 (2026-10-22): Keith's review of v4: joints need visible room to move, with the inner layers showing in the gap; a range-of-motion check per joint.
- v0.6 (2026-10-22): Keith's review of v3 and the v3 skill notes: signature forms kept whole, seams follow the flow, plates flow across parts, armour shaped but machinery may be flat, more technical leg parts, never knock-kneed, feet as machines; overshoots as loft stations, consistent cutter offsets, outer-skin axis check, gate at rest.
- v0.5c (2026-10-22): Keith: think like a tank designer: sloped armour, thickness by facing, add-on armour, protected weak points; tanks as plating reference.
- v0.5b (2026-10-22): Keith: rectilinear shapes are fine as purposeful add-ons (reactive armour bricks, ammo boxes, stowage), tagged `addon` and left out of the axis-aligned check.
- v0.5 (2026-10-22): Keith: every part and layer reads with a purpose (plates deflect), work posed with temporary groups then return to rest, big readable rib webs, lots of piping between and under plates.
- v0.4 (2026-10-22): Keith's review of v2: no rectilinear starts (wedges and prisms), cut more forms from each big mass, links overshoot their pivots, the axis-aligned plate check, weapon housings proportioned from the reference.
