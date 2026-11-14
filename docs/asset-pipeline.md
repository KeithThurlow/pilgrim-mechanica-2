# Asset review and build pipeline (2026-11-13)

Keith 2026-11-13: "get a Fable 5.2 agent looking at all models... plan out its review and build pipeline and start
building assets for all mecha parts, weapons and enemies", then: items and assets with no model, better 2D images
for the inventory, and free rein on the inventory layout. Keith's PC (the reference art, the old weapon kit, the GPU)
is off for a few days, so this starts from the repo. Not blocked on Keith: defaults are picked here and listed under
Open questions. Work is on `claude/project-thread-vum2tc`, one PR per batch.

## What changed today: Blender runs in the cloud

Until now models waited for Keith's PC (`docs/asset-list.md`: "the cloud sessions have no Blender"). They don't any
more: `sh tools/blender/cloud-setup.sh` installs Blender's Python module (5.3) and `node tools/blender/run.mjs` uses
it by itself. The Rampart export runs here in 9.5 s and comes out the same (34,638 tris, the GLB within 1 KB of the
committed one). Cycles renders on the CPU (under a second for a small view), so the mech-modeling skill's whole loop
(build, measure, render, export, see it in a lab) works in a cloud session. Not here: the old repo's weapon kit
(`wkit.py`, only on the PC; weapons build on `hskit`/`vkit` and the TS kit's method until it's copied in), and the
generated-parts lane (needs the GPU).

## Review: what every model is today

Seen from the game camera in the armoury, swarm and walker labs, plus the code. Grades: **A** modelled and reads
well, **B** a careful code model that reads but is plain up close, **C** boxes and primitives, **none** nothing drawn.

### Mech parts

| Thing | Built how | Grade | Verdict |
| --- | --- | --- | --- |
| Rampart legs, hull, pods (+ 7 variants: stilt, turret, railgun, rocket, salvager, siege, wildcat) | Blender, layered (skill v0.8), 34.6k tris | A | Keep. The quality bar for everything else |
| Arms (Rampart, Siege, Loader, light) | `tools/blender/parts/arms.py` (2026-11-14), boxes until loaded | B | Done: one GLB per hull arm, pieces Joint/Stub/Upper/Elbow/Fore/Hand |
| Power packs (stand-in, capacitor, medic, replica bay, booster) | one box pack for all five | C | Build first: the back is what the game camera sees most. Five packs that each say what they do |
| Sensors (visor, twin-optic, mast, dish, long array) | code shapes in `sensorModels.ts` | B- | Build: two heads, three clusters, 1k each |
| Waist kit (drums, full drum, autoloader, cargo rack, cutting kit) | drums converted; the rest share them or nothing | C / none | Build the three with no model |
| Hover legs, Cuirass hull | variant reuse | B | Later: own models |

### Weapons

| Thing | Built how | Grade | Verdict |
| --- | --- | --- | --- |
| Minigun L/M/H, hand cannon L/M/H, missile pod L/M/H, back drums, belt | old kit, converted | A- | Keep; fit and finish only (W4, W9, W10) |
| RPG launchers (hull, shoulder), rocket | Blender (W1) | A | Keep |
| Rail cannons, autocannon, breach cannon, mortars, rocket and missile pods, plasma, laser, orb, arc, flak, longshot, rifle, SMG, scattergun | TS kit (`src/weapons/build/`) | B | Second pass later: silhouettes are right, plates and edges are thin |
| Swords (Breaker, Buster, short) | boxes in `models.ts` | C | Build: held in the hand, big on screen in a duel |
| Belt feed, incendiary feed, capacitor bank | boxes | C | Build |
| Drone rack, swarm hive, replica bay | none of their own | none | Build |
| Flamer, Inferno, frost thrower, cryo projector, napalm launcher | box rigs in `models.ts` | B- | Second pass |

### Enemies

| Thing | Built how | Grade | Verdict |
| --- | --- | --- | --- |
| Robots: scrapper, cutter, excavator, weapon quads | primitives merged per kind, instanced | C | Build (asset list R1). The most common thing on screen and the plainest. Keith's look stands: white cylindrical plates, dark squarish mechanics, cables |
| Crusher | primitives | C+ | Build: one hero model, the maw and pincers as moving nodes |
| Strider | rods and discs | B- | Build after the crusher; keep the wiry disc-head read |
| Humanoid robots, bandits | Mixamo Vanguard bake (box rifle) | B | Keep; a real rifle baked in (B1) |
| War band vehicles (7 kinds), escorts | boxes and cylinders in `carBody.ts` | C+ | Build later (V1): bodies as GLBs on the same wheels and turrets |
| Bandit and rival mechs, replicas | the Rampart, repainted | A | Keep; they gain the new arms, packs and sensors for free |
| Attack drones, turret quads, scrap swarm | primitives | C | Build with the robots (same family, your colours) |

### Not in this pass (listed so they aren't forgotten)

Convoy (platforms, crane, turrets, plough: C1-C3), POI wrecks and salvage (P1; best done with the generated lane and
the references), fortress walls, the pilot.

### Inventory

One line drawing per size class, tinted by rarity (`src/ui/itemIcon.ts`): a Buster sword and a short sword look the
same, every pack looks the same. No item shows what it is.

## The pipeline

```
design note (what it says, its sockets, its budget)
   └─► Blender script (tools/blender/<family>/<id>.py, on hskit: mass by booleans, then the layers)
         ├─► numbers: tris, bounds against the mount's box, sockets, layer value order      (seconds, no pictures)
         ├─► one Cycles sheet: game camera (50° at 40 m) + three-quarter close               (for the builder only)
         └─► export: public/models/<family>/<id>.glb + -lod1 + -lod2 + <id>.json
               ├─► the game loads it by id; the code stand-in stays as the fallback and for headless checks
               ├─► npm test: tools/assets-check.ts holds every model to the contract
               └─► npm run icons: the inventory picture, rendered from the same model
```

1. **Code is the only source.** Every model is a script; GLBs are outputs. A change is a diff, a revert is a revert.
2. **The loader never changes shape.** Weapons and sensors already load `<id>.glb` or fall back to code. Arms, packs
   and waist kit get the same loader (`public/models/parts/<base id>.glb`), enemies too (`public/models/enemies/`).
   So each asset lands alone, and deleting a file puts the stand-in back.
3. **The mech-modeling skill is the method** for mech parts; weapons, robots and vehicles borrow its mass, plate and
   edge rules (the three reads: silhouette at 40 m, plates and edges at 15-25 m, detail at 10 m).
4. **Review by numbers first** (rule 7). `tools/assets-check.ts` (new, in `npm test`) reads every GLB and its sidecar:
   triangles against the budget for its kind, meshes and materials (draw calls), the sockets and moving nodes its
   kind must have, vertex colours present, `Paint_<section>` names, size against its mount's box, LOD files present
   and lighter. One rendered sheet per asset for the builder; one game shot per batch; Keith gets lab URLs.
5. **Icons come from the models.** A page (`labs/icons/`) draws each item base's model alone, three-quarter from
   above, in the unit look with no ground, sized to the item's grid cells; `npm run icons` saves
   `public/icons/<base id>.webp`. The inventory shows it over a rarity-coloured tile and keeps the line drawing as the
   fallback. Rerun when a model changes, so pictures and models never drift.

### Draw cost (the rules every asset keeps)

Three's cost is per object (about 14 µs each on Keith's PC), not per triangle, so:

- **Budgets** are the asset list's: a two-mount mech 30k triangles fully fitted; legs 8.5k, hull 6.5k, hull weapon
  5k, arm 1.5k, held weapon 1.5k, shoulder 2k, pack 2k, sensor 1k, waist 1k a side. LOD1 about a third, LOD2 a ninth.
- **One mesh per bone, one material.** Paint, AO and wear live in vertex colours. Only parts that move are their own
  nodes. A fitted part adds one object (two with a moving piece); the merge at load (`mergeGeometry.ts`) stays.
- **Swarm units stay one instanced geometry per kind.** A robot model is loaded, merged to one geometry and handed to
  the existing instanced drawer: more triangles, the same draw calls. Budgets: scrapper 300, cutter 900, excavator
  2,500, quad 1,200 (at 300 on the field that is under 250k triangles, well inside what the GPU has spare).
- **Measured, not assumed:** `tools/drawcount-probe.mjs` on the convoy siege before and after each batch; the batch's
  PR quotes the object count. A batch that raises it gets fixed before it merges.

## Build order

By how much screen time the thing gets against how plain it is now. One PR per batch, merged when `npm test` passes,
each with a what-to-play list.

| # | Batch | Why here |
| --- | --- | --- |
| 0 | This plan, cloud Blender, the shots fix | Everything else needs it |
| 1 | Power packs ×5 and the part loader | The middle of the screen all game; today one box |
| 2 | The contract check (`assets-check`) and inventory pictures from models | Keith asked; works on today's models and improves as they do |
| 3 | Inventory layout and UI | Keith: free rein; own PR |
| 4 | Arms ×3, sensors ×5, waist kit ×3 | Finishes the mech: no boxes left on it |
| 5 | Robots: scrapper, cutter, excavator, quads; drones and the scrap swarm | The plainest thing in every fight |
| 6 | Swords ×3, feeds and capacitor, drone rack, hive, replica bay | Items with boxes or nothing |
| 7 | Crusher, strider | Hero enemies |
| 8 | War band vehicles and escorts | |
| 9 | Second pass on the TS-kit weapons; flamers and freeze rays | B to A |

## To check against the reference art when Keith's PC is back

- Brand looks: each maker's `notes.md` in `art-refs/` (Stratford-Aegis, Novus-Lux, Suzaku, Goliath Earthworks). Until
  then packs, arms and sensors follow the Rampart family and the variants already built for those makers.
- `_house-style/notes.md` and `mech-reference/notes.md`: plate language and how worn things are.
- `robot-reference/`: the robots, the strider's disc-head reference and the crusher.
- The old repo's `wkit.py` and templates: copy into `tools/blender/weapons/` so weapons build here on the real kit.

## Open questions for Keith (defaults in place)

1. **Robots stay white sci-fi** (his 2026-11-01 call) and get shape, not a new look. Default: yes.
2. **Icons are renders of the models**, not painted pictures. Default: renders, in the game's paint, on a rarity tile.
3. **Cloud builds on Blender 5.3, the PC on 4.4.** Same scripts, same output so far. Default: keep both; pin if they
   ever disagree.
4. **Old Rampart-family names for packs** (the "stand-in power pack" item becomes the Rampart's standard pack).
   Default: rename when its model lands.
