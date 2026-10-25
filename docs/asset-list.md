# Asset list (for the Blender agent on Keith's PC)

Keith 2026-10-25: "spec an asset list here... prioritize it as you see fit... an agent on the computer can consume
this." The cloud sessions have no Blender, so models are built on Keith's PC and come back through git. This file is
the queue between them.

## How to use this list (the desktop agent)

1. `git pull` in `pilgrim-mechanica-2` and read this file, `state.md` and `docs/assets.md`.
2. Take the **first open item** (`[ ]`) in priority order. Mark it `[~] (desktop, date)` and push that edit straight
   away, so a cloud agent doesn't build a code stand-in for it at the same time.
3. Build it with the old repo's Blender kit:
   - `pilgrim-mechanica/tools/blender/weapons/wkit.py` and `tools/blender/templates/*`;
   - the mech-modeling skill for mech parts;
   - `tools/blender/vehicles/`, `tools/blender/wrecks/` for those.

   New scripts can live in the old repo for now, but name the script in the item when you tick it.
4. Export to the path the item names, following **The contract** below, and render the check shots.
5. Tick it `[x] (desktop, date, script path, tris)`, add a row to `docs/assets.md`, add a line to `state.md` Changes
   ("assets: …, wiring is for the cloud side"), then commit and push.
   - Don't wire the model into the game code. The cloud side swaps the stand-in in, since it knows which agent owns
     which file.
   - If you're asked to wire it in anyway, keep to the loader file the item names.
6. Anything you think is wrong or missing in an item: write it under the item as `> desktop: …` and carry on.

## The contract (every model)

- **Format:** GLB straight from Blender's glTF exporter, metres at game size. Y up, front (muzzle) along **+Z**, the
  mech's left along **+X**. Note this is not Unity's frame, which the old FBXs used.
- **Root:** at the mount point (where it bolts to the hull, shoulder or arm), or at the grip for hand guns.
- **Nodes:** one `Body` mesh for the static parts. Every moving part is its own node with its origin on its pivot,
  named as in the old kit: `Spin`, `Slide`, `Barrel`, `Door_n`, `Missile_n`, `Recoil`, `Tube_n`, `Lid`.
- **Sockets:** empties named as in the old kit:
  - `Muzzle_0..n` (+Z out of the bore);
  - `Mount`;
  - `Grip_R`, `Grip_L`;
  - `Eject`;
  - `Laser` (the targeting laser's emitter, where the item asks for one);
  - `Glow_n` (lamps or heat points that the game lights).
- **Colour:**
  - **Vertex colour** `COLOR_0` carries the paint, AO and wear, as `rampart.glb` does.
  - Keep the material names `Paint_<section>` (plating, secondary, dark, mechanical, trim, lighting, detail, visor), so
    the game can retint a section for a paint scheme.
  - Emissive parts in a `Paint_lighting` material.
- **Look rules** (from the Rampart and the old brief):
  - grounded military salvage, not Gundam;
  - plates and big readable shapes first, greebles second;
  - edges bevelled enough to catch the light;
  - crease and ink lines take the shaded colour of the face next to them, never black.
- **Budgets:**

  | Kind | Triangles |
  | --- | --- |
  | Hull or shoulder weapon | up to 6k |
  | Hand gun | up to 3k |
  | Projectile (rocket, missile, shell) | up to 300 |
  | Vehicle | up to 12k |
  | Prop | up to 2k |
  | Big POI piece | up to 25k |

- **Scale:** next to the Rampart (4.4 m to the hood, hips at 3.05 m). Its right minigun pod is the reference for a
  Medium hull weapon.
- **Check shots** into `docs/asset-shots/<id>/`:
  - a 3/4 front and a side view;
  - one from the **game camera** (50° down, 40 m away, about 1280×720, the model on or beside the Rampart).

  The game camera is the one that matters: if it doesn't read there, it isn't done.
- **Sidecar:** `<file>.json` next to the GLB with class, size, mount, sockets, moving parts (axis, travel or angle)
  and tris. Same fields as the old kit's sidecars.

## Priority

- **P0:** needed now. Explosive weapons are being built in code this week and are drawn with code stand-ins.
- **P1:** a code stand-in or plain boxes exist and read badly, or a system is waiting on the asset.
- **P2:** the existing asset works; fit and finish.
- **P3:** for later systems; build when they're proposed.

Status: `[ ]` open · `[~]` taken · `[x]` done.

---

## P0: explosives (weapons step 2 is building these now)

### [x] W1 · RPG rocket launcher: hull (M) and shoulder (M) (desktop, 2026-10-25, `tools/blender/weapons/rocket_launcher.py`, hull 4,064 / shoulder 3,622 / rocket 208 tris)
- **Files:** `public/models/weapons/rocket-launcher-hull.glb`, `rocket-launcher-shoulder.glb`.
- **What:** a big single-tube (or twin-tube) launcher, like an RPG scaled to a mech.
  - It fires one rocket straight to a ground point and makes a big blast.
  - The **hull** one replaces an arm: it mounts at the shoulder joint and aims with the torso.
  - The **shoulder** one sits on top, beside the hull. Its `Mount` is on its base.
- **Sockets:** `Muzzle_0` (or `_0`/`_1` for twin tubes), `Laser` (a small targeting emitter under or beside the
  tube; it shows a faint laser line in the game), `Mount`.
- **Moving parts:** `Recoil` (back along -Z, 0.15 m); a rear blast cover `Lid` that flaps open on firing.
- **Look:** chunky tube with ribbed heat shield bands, a big flared back-blast vent, a sight box, hazard stripes at
  the muzzle. It should read as "explosive" from 40 m: a fat tube with a bright warhead colour visible in the bore
  is the tell.
- **Plus:** a projectile, `rocket.glb` (≤ 300 tris): a fat warhead, a body and fins; a `Glow_0` at the tail for the
  motor.

> desktop: Built single-tube. Nodes are `Body`, plus `Recoil`, which carries `Lid` (the blast cover) and `Missile_0` (the
> loaded round, warhead out of the muzzle; hide it on firing and spawn `rocket.glb` at `Muzzle_0`). The sidecar gives
> the axes and angles in the game frame (`Lid` +100° about local +X). The hull one is built for the right side,
> outboard -X; mirror it for the left as the game does the minigun pod. The shoulder one's `Recoil` origin is on its
> trunnion axis, so it can pitch the tube too. Added a red-orange warning band behind the muzzle, because from behind
> (the usual game view) the warhead nose is hidden. Paint section `detail` is the warhead's red here, and bolts use
> `mechanical`. The script imports the old repo's `wkit.py` from the sibling folder (`PM1_BLENDER_TOOLS` overrides it).
> Shots: `docs/asset-shots/W1/` (JPEG), from `rocket_launcher_shots.py`.

### [ ] W2 · Heavy mortar: shoulder (H)
- **File:** `public/models/weapons/mortar-heavy.glb`.
- **What:** one huge mortar tube on a shoulder cradle that tilts up to fire. It lobs one huge shell over hills.
- **Sockets:** `Muzzle_0`, `Mount`.
- **Moving parts:**
  - `Barrel` hinges about X from stowed (about 20° up, lying back along the hull) to firing (60–80° up);
  - `Recoil` (the tube slides down its cradle 0.3 m on firing).
- **Look:** a thick stubby tube, a recoil spring pack, a baseplate cradle, ammo racks beside it. The tube must be
  obviously big from above.
- **Plus:** a projectile, `mortar-shell.glb` (≤ 300 tris).

### [ ] W3 · Line mortar rack: shoulder (M)
- **File:** `public/models/weapons/mortar-line.glb`.
- **What:** a rack of 6–8 short tubes in a row that ripple-fire, so the shells land in a line. Keith: "blast things
  in a row".
- **Sockets:** `Muzzle_0..n` along the row (fired in order), `Mount`.
- **Moving parts:** the rack tilts as a whole (`Barrel` hinge about X); each tube has a small `Tube_n` recoil.
- **Look:** clearly many tubes from above. A long low rack, distinct from the missile pod's box.

### [ ] W4 · Missile pod: fit and finish (L / M / H exist)
- **Files:** `public/models/weapons/missile-pod-l|m|h.glb`, rebuilt from `tools/blender/templates/missile_pod.py`.
- **Today:**
  - The old models convert and look decent close up (see `docs/weapon-models-2026-10-22/MissilePod_M.png` in the old
    repo).
  - From the 40 m camera they read as a grey box.
  - Keith wants them to fire **up over the shoulder** and swarm down: 8–12 blasts.
- **Do:**
  - tilt the tube face up (about 30–45°, or a `Lid` that opens upward);
  - doors that open (`Door_n`, kept);
  - a brighter top face: warning paint on the lid, coloured missile tips visible when it's open;
  - lamps (`Glow_n`).
- **Plus:** a projectile, `missile.glb` (≤ 200 tris), slimmer than the rocket.

### [ ] W5 · Blast and crater kit (only if it's cheap)
- **What:** debris chunks: 4–6 rock or sand clods, 3 steel shards, 1 scorched ring decal mesh.
- **Files:** `public/models/fx/debris-*.glb`, each ≤ 150 tris.
- **Why:** the ground dents are in code, but the blasts throw only dust. A few lumps flying out sell them.

---

## P1: hull guns, and boxes that read badly

### [ ] W6 · Rail cannon: hull (M) and two-handed (H)
- **Files:** `rail-cannon-hull.glb`, `rail-cannon-2h.glb`.
- **What:** two long rails with a visible gap, capacitor banks, coolant lines.
  - It charges for about 1 s, then fires a straight piercing beam.
  - `Glow_0..n` along the rails light up as it charges.
- **Sockets:** `Muzzle_0`, `Mount` (hull), `Grip_R` / `Grip_L` (two-handed).
- **Moving parts:** `Recoil`.

### [ ] W7 · Autocannon: hull (M)
- **File:** `autocannon-hull.glb`.
- **What:** between the cannon and the minigun: one thick barrel with a muzzle brake, a box magazine, a big
  receiver. It fires explosive shells at a steady thump.
- **Sockets:** `Muzzle_0`, `Eject`, `Mount`.
- **Moving parts:** `Recoil` (0.2 m), a `Barrel` node for the recoil sleeve.

### [ ] W8 · Cannon: hull (M or H)
- **File:** `cannon-hull.glb`.
- **What:** a slow, heavy single shot. A tank-gun look: a long barrel, a fume extractor, a big breech.
- **Sockets:** `Muzzle_0`, `Eject`, `Mount`.
- **Moving parts:** `Recoil` (0.4 m).

### [ ] W9 · Minigun: fit and finish (L / M / H exist)
- **Files:** `minigun-l|m|h.glb`, rebuilt from `templates/minigun.py`.
- **Do:**
  - add a `Laser` socket (Keith wants a faint targeting laser on miniguns too);
  - add `Glow_n` heat points near the muzzle for barrel heat after firing;
  - recolour to sit with the Rampart's olive. The old kit's orange Goliath scheme fights the Rampart.
- **Note:** the Rampart's own built-in minigun pod is the look Keith already likes ("they felt powerful, they felt
  good"). Match its weight.

### [ ] M1 · Power pack for the Rampart
- **File:** `public/models/rampart-pack.glb`.
- **What:** the back power pack, today boxes in `src/mech/rampart.ts`.
  - Built in the Rampart's construction (the mech-modeling skill, v4 study).
  - It carries a `Mount` for back and shoulder weapons, plus `ShoulderMount_L/R` sockets for the shoulder weapons
    above.
  - Two looks: a stand-in pack and a capacitor pack (the loadout already has both as items). Plus a **booster pack**
    with thruster nozzles (`Glow_n` at each nozzle) for the dash boost.

### [ ] M2 · Rampart variants: push what exists
- **What:** the desktop session made Rampart variants earlier on 2026-10-25 (`src/mech/variants.ts` plus models),
  which were never pushed. Keith said they could be pushed as placeholders.
- **Do:** push them with an `assets.md` row. The loadout can then give the Siege and Salvager hulls and the Stilt
  legs their own looks; today they all draw as the Rampart.

### [ ] C1 · Convoy turrets: twin (M) and heavy
- **Files:** `public/models/convoy/turret-twin.glb`, `turret-heavy.glb`.
- **What:** deck turrets on the convoy cars' cut corners (twin) and the mech bays' cab roofs (heavy). Today they're
  code boxes.
- **Nodes:** `Ring` (yaw about Y), `Cradle` (pitch about X), `Muzzle_0..n`.
- **Look:** a pintle or ring mount with a shield plate. They should read against the deck from 40 m.

### [ ] C2 · Convoy crawler pods and footbridges
- **Files:** `public/models/convoy/crawler-pod.glb`, `footbridge.glb` (a 9 m span plus landings).
- **What:** the tracked pods under the platforms, and the bridges between cars.
  - Today they're boxes and extrusions.
  - Pods: Dune-style trapezoid tracks (Keith 2026-10-24). Moving `Track` node(s) with UVs that scroll along the
    belt, or a `Tread_n` chain.
  - Bridges: a walkway with rails, hinged at both ends (`Hinge_A`, `Hinge_B`).
- **Hold back:** platform canopies and village dressing until Keith sends references.

### [ ] P1 · POI wrecks and salvage
- **Files:** `public/models/pois/*`.
- **What:** the expedition loop (being built now) sends you out to POIs. Today they're boxes, rocks, I-beams and a
  capsule.
- **First:**
  - 3 mech wrecks (a downed Rampart-class hull, a torn-off leg, a gun pod in the sand);
  - 2 crashed-ship pieces: the old repo has `ShipCrash_EscapePod_01` and `ShipCrash_DebrisTrail_01` with LODs. Convert
    or rebuild them, plus one bigger hull section;
  - 4 salvage props (a crate, a container, a fuel drum stack, a scrap pile), each with a `Salvage` socket where the E
    prompt sits.
- **Note:** the desert isn't green; wrecks are sand-scoured steel.

### [ ] V1 · Raider vehicles and convoy escorts
- **Files:** `public/models/vehicles/*`.
- **What:** today they're stand-in bodies in `src/vehicles/carBody.ts`.
  - The old brief says no present-day cars: advanced all-terrain vehicles, vans and trucks.
  - The old repo's vehicle kit (`tools/blender/vehicles/`) has trucks and vans that could be adapted.
- **First:** a technical (pickup with a gun), a gun truck, a six-wheeler, a war rig. Each one intact and wrecked.
- **Nodes:** `Wheel_FL/FR/RL/RR` (plus `Wheel_ML/MR` for six wheels) at the hubs, `Turret` (yaw) and `Muzzle_0` where
  armed.

---

## P2: fit and finish on things that work

- [ ] **W10 · Hand cannon: look pass** (L / M / H exist). Recolour to the Rampart family and add a `Laser` socket.
  Low priority until arms carry hand guns.
- [ ] **R1 · Robots:** scrapper, cutter and excavator as models. Today they're code-built (`src/combat/robotShapes.ts`)
  and they read fine, so this is only worth it once the rest is done. Their legs are driven by code, so model each leg
  segment as its own node with its pivot.
- [ ] **B1 · Bandit rifle:** the baked Vanguard carries a box rifle. A ≤ 400-tri rifle to bake into the vertex
  animation (one mesh; rebaked on the cloud side).
- [ ] **D1 · Dust and smoke:** nothing to model. Listed only so nobody models it.

---

## P3: later systems (build when they're proposed)

- **Hand guns:** SMG, assault rifle, two-handed minigun, two-handed rail cannon (W6 covers it). Arms that carry them
  (an arm with a hand, `Grip` sockets).
- **Energy:** plasma cannon (hull M) and laser beam projector (hull M). A glowing core, coolant fins, `Glow_n`.
- **Summoning:** a shoulder drone bay (a launch rail plus a lid) and a drone (≤ 800 tris, rotors as `Rotor_n`); a
  scrapper-robot launcher.
- **Pilot on foot:** waiting on Keith's answers in `docs/proposal-pilot.md`.
- **Snow biome props:** after the ground dents land.

## Stand-ins in code (the cloud side)

A cloud agent is converting the old Minigun, HandCannon and MissilePod and building **code stand-ins** for W1–W3 and
W6–W8 (`src/weapons/library.ts`), with the same socket names, so the weapons can be played now. A Blender model at the
item's path replaces the stand-in when it lands. The code stand-in is never the goal.
