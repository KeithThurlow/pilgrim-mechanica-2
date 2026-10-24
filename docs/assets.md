# Assets

Every model in `public/models/`, where it came from and how to remake it.

| File | What | Source | Notes |
| --- | --- | --- | --- |
| `rampart.glb` | The Rampart walker: one mesh per walker bone (`Part_Pelvis`, `Part_Torso`, `Part_Thigh/Shin/Cannon/Foot_L/R`, `Part_Pod_L/R`, `Part_PodSpin_R`, `Part_PodRocket<i>_L`), joint empties (`Thigh_L` hip, `Shin_L` knee, `Cannon_L` hock, `Foot_L` foot point, `UpperArm_L` shoulder, `Waist`) and gun points (`PodSpin_R`, `PodSpinFwd_R`, `PodMuzzle0_R`, `PodEject_R`, `PodMuzzle<i>_L`). Vertex colours carry the paint, AO and wear. 34.6k tris. | Old repo `Assets/_Project/Art/Generated/Mechs/Rampart/Rampart_Mech.fbx`, built by `tools/blender/mechs/studies/rampart/export_game.py` from `rampart_v4.py` (the mech-modeling skill's v4 study; Keith 2026-10-22: "huge improvement"). Renamed from Helldiver 2026-10-23 (external IP). | Front +Z, left +X, metres. The left rocket box is in the file but hidden; the game mirrors the right minigun pod onto the left (Keith 2026-10-24). |
| `ammo-drum-half.glb`, `ammo-drum-half-left.glb` | Half-width back ammo drum for the right gun, and its mirror for the left. `Mount` at the front face, `FeedOut` toward its gun. | Old repo `Assets/_Project/Art/Generated/Weapons/Mech/Weapon_AmmoDrum_Back_Half(_Lside).fbx` (asset-smith kit, Goliath Earthworks style, pass 2, 2026-10-22). | Tinted olive in the game to match the Rampart. |
| `bandit-vat.json`, `bandit-vat.bin` | The bandit swarm's character: Vanguard thinned from 11.4k to 2.2k tris (2,272 with a box rifle), base colour from its texture baked into vertex colours, a cloth mask on the tan plates; six clips (aim 37 frames at 12 fps, run 22, sprint 20, run-and-fire 17, walk-and-fire 24, flinch 14) as a 1409×134 RGBA half-float position texture and an RG8 octahedral normal texture, 1.9 MB. Format in `src/combat/banditVatFormat.ts`. | Character: **Vanguard by T. Choonyung** (Mixamo, Adobe), `resources/mixamo/Vanguard By T. Choonyung.fbx` in Keith's working copy (`resources/` is gitignored). Clips: Mixamo animations from the old repo `Assets/_Project/Art/Animations/Mixamo/` (`Rifle/Rifle_Run_F`, `Rifle/Rifle_Run_F_Firing_A`, `Rifle/Rifle_Walk_F_Firing`, `Stances/Rifle_Idle_Aim`, `Reactions/Hit_Flinch`, `Locomotion/Sprint_F`). Mixamo characters and animations are free to use in projects under Adobe's Mixamo terms; the source FBXs are not in this repo. | Remake: `npx tsx tools/mixamo/bake-bandit.ts [<vanguard.fbx> <clip dir>]` (thinning with meshoptimizer, MIT, vendored with three as `examples/jsm/libs/meshopt_simplifier.module.js`). Feet at y 0, facing +Z, metres; walk travel taken out of the hips (the clip's speed is kept in the header). |
| `ammo-belt-link.glb` | One link of an ammo belt (pitch 0.075 m, 0.30 m wide). | Old repo `Weapon_AmmoBelt_Link.fbx`. | Not used yet: for a belt from drum to gun. |

## Converting more

`npx tsx tools/fbx-to-glb.ts <in.fbx> <out.glb> ...` converts the old project's FBX exports, keeping node names,
empties and vertex colours. The old models are in Git LFS: `git lfs pull --include=<path>` in the old repo first.

Long term the Blender scripts should export GLB straight into `public/models/` (Blender's glTF exporter keeps
the colour attribute as `COLOR_0`). The Rampart's source scripts live in the old repo; bring them over when the
model next needs to change.

## Not available

The old weapon kit's other models (Light and Heavy miniguns, hand cannons, missile pods) were never committed to
LFS, so only their stub files exist in the old repo. They'd need rebuilding from `tools/blender/weapons/` there.
