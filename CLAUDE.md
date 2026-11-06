# Pilgrim Mechanica 2

A mech salvage game in the browser. Your base is a convoy village that never stops rolling across a procedural
desert. You take a mech out to salvage wrecks and scrap while swarms of enemies close in, and you have to get back
before the convoy rolls out of range. Better mechs and convoy upgrades let you range further. Keith's pitch, the
loop and the open questions are in `docs/design.md`.

This is a restart of `KeithThurlow/pilgrim-mechanica` (Unity, prototype stage). Keep the ideas, not the code.
Carried over: the procedural digitigrade walker (rewritten), the salvage-from-wrecks loop, swarm combat, the
desert look direction. What came from where: `docs/decisions.md`.

## Ground rules (Keith 2026-10-24: these exist because the Unity project slowed to a crawl)

1. **Iteration speed beats performance, and beats preserving code.** Save a file, see it in the browser in under a
   second. If a system starts slowing changes down, rewrite it rather than working around it. Nothing here is
   precious; the project must stay easy to change.
2. **Every system gets its own lab page** in `labs/<name>/` (an `index.html` and `main.ts`; Vite picks it up by
   itself). Tune a system in its lab, not in the whole game. New system = new lab first.
3. **Every feel value is a slider.** Tuning values live in a params list (`Param[]` plus a defaults object) next to
   the system and show in the lab's panel (`src/core/tweaks.ts`). Never hardcode a value someone will want to tune.
   Group the sliders into **topics** (what they tune: the legs, a gun, the dunes) and register the matching parts with
   the **hold-V selector** (`src/core/select.ts`), so Keith can click a thing and see only its sliders (Keith
   2026-10-24). New sliders go in an existing group or a new group added to a topic, never loose.
4. **Every lab shows frame time** (`src/core/hud.ts`, automatic via `createApp`). We don't optimise early, but we
   always see the cost of what we add. Budget: 16.7 ms on Keith's PC.
5. **Small files, one job each.** Simulation is separate from rendering (e.g. `walker.ts` is pure maths, `walkerBody.ts`
   draws it), so systems can be tested headless and their looks swapped freely.
6. **Headless checks for anything with rules**: `npm test` runs `tools/*-check.ts`. Add a check when a system has
   things that must never happen (feet through the ground, legs out of reach, terrain cliffs).
7. **Check your work cheaply** (Keith 2026-10-27: usage was being eaten by rendered strips nobody looked at).
   - **Numbers first:** joint angles at key phases, swing height, hip bob, cadence, hit counts, costs. These come from
     the headless checks or a small node probe.
   - **Stick figures** only when you need to see a shape.
   - **Rendered screenshots** only for purely visual changes (models, dust, lighting, layout), one or two at most, from
     the game camera. **No rendered filmstrips or side-by-side strips.**
   - **For Keith:** end with the lab URL and flags to try it himself, not images.
8. **Log decisions** in `docs/decisions.md` (dated, who raised it, who decided). Mark only Keith's calls as his.
9. **Propose before big builds.** For a new system, outline files, data and key values first and wait for Keith.
10. **Every change updates `state.md` in the same commit** (Keith 2026-10-24): the system's entry if it changed, a
   dated line at the top of Changes (what, main files, what was checked, who), and In progress while work spans
   sessions or agents. Read `state.md` first when you start; it is the shared record between agents.
11. **Check the report inbox.** Keith reports from inside the labs (the Report button). Reports land in
   `reports/inbox.md` on his PC (`reports/<id>.md` has the note, a screenshot, the URL and every tuning value). When
   you start, and when Keith says he's reported something, read the inbox, handle the open lines, tick them
   (`- [x]`) and answer each in `reports/replies.md` (`<id>: what you did`), which shows back in the box.
12. **Stay ready for multiplayer** (Keith 2026-10-26: 4-player co-op later, one player hosting first; plan in
   `docs/multiplayer.md`). Nothing is networked yet, but code must keep these habits:
   - **Randomness:** seeded in anything that changes game state. `Math.random()` only in FX, sound and drawing.
   - **Commands:** sims take commands (move, aim, fire, dash, salvage, hop out) and never read input themselves.
   - **Events:** what happens (blasts, hits, deaths, pick-ups, banking) is plain-data events.
   - **Ids:** stable ids for anything peers must agree on.
   - **Ownership:** know who owns each piece of state: host (enemies, damage, loot, convoy, expedition), player (own
     movement and aim) or cosmetic (FX, ragdolls). Say so in the file header when it isn't obvious.
13. **Assume you can be cut off at any moment** (Keith 2026-10-26: agents hit usage limits mid-work and can't see them
   coming). Work so a cutoff loses little:
   - **Commit at every working step** on your branch, not only at the end. WIP commits are fine; say "WIP" in the
     message. **Then push it to a work-in-progress branch** on GitHub: `git push origin HEAD:refs/heads/wip/<topic>`
     (Keith 2026-10-26: "we've actually lost quite a bit of work in the past to this"). Never force-push, and never
     push to `main`; the coordinator merges.
   - **Keep a handoff note current** as you go, in `docs/handoff-<topic>.md`: what's done, what's half done (files and
     functions), what's left in order, values chosen, known bugs, how to test. Commit it with the work and point to
     it from state.md's In progress. Delete it when the work merges.
   - **When resumed after a cutoff,** read your handoff note and `git log` first, then carry on.
   - **The coordinator** merges finished pieces promptly rather than holding them, and backs up agent branches when
     Keith allows it.
14. **Spend usage carefully** (Keith 2026-10-27).
   - **Run checks with intent:** the checks that touch what you changed while working, and the full `npm test` once
     before handing back.
   - **Keep tool output short:** read only the lines you need; don't page through big logs or whole files you won't
     edit.
   - **Don't wait on slow jobs:** no long renders or sleep loops.
   - **Short reports:** what changed, values, check results, the URL to try, rough edges. No narration.
   - **Builds over self-review:** Keith's review in game is what counts. Finish, merge and hand over a build he can
     play, rather than spending usage judging feel or looks yourself. When Keith is away, prefer work that doesn't
     need his eyes: performance, checks, fixes with clear numbers, refactors, proposals.
   - **The coordinator:**
     - starts a fresh agent from a handoff note rather than resuming one with a huge context. About 300k tokens is a
       soft guide, not a rule: agents can't see their own context size, so the coordinator (who sees each agent's
       usage) decides when to ask for a handoff, by the size and how the work is going;
     - keeps briefs short, and pauses agents whose work Keith isn't waiting on when usage is tight;
     - picks the model (Keith 2026-10-27): Opus specs the work and takes anything with a visual intent (looks, feel,
       animation, models); Sonnet implements code from a clear spec.

## Stack

- **Three.js r186** (`three/webgpu`: WebGPU renderer, falls back to WebGL 2 by itself), **TypeScript**, **Vite**.
- Shaders, when needed: TSL (`three/tsl`), which compiles to WGSL or GLSL. Classic materials also work.
- Physics: Rapier (`@dimforge/rapier3d-compat` 0.12, WebAssembly) for death physics only (ragdolls, wrecks); the
  living run on their own sims.
- No game engine, no ECS library yet. Swarms will need data-oriented arrays and instanced meshes; add structure
  when a system needs it, not before.

## Commands

- `npm run dev`: dev server with hot reload, opens the lab hub. `npm run check`: typecheck. `npm test`: headless checks (every `tools/*-check.ts`, found by itself, side by side on all cores;
  output only for failures, `npm test -- --verbose` for all, `npm test -- duel fortress` for some, `npm run test:serial` one at a time).
- `npm run build`: typecheck + production build to `dist/`. `npm run shots`: screenshots of the labs into `shots/`
  (needs a build; `npx playwright install chromium` once).

## Lab URL flags

- Every lab: `?webgl` forces WebGL 2. `?set=key:value,key:value` overrides any tuning value for that page load
  (not saved), e.g. `?set=sunAzimuth:120,height:12`. `?norender` runs the ticks without drawing (headless CPU timing; no GPU dent layer or GPU effects either). `?syncshaders`: new shaders build in the frame (three's old way, freezes while the driver compiles) instead of in the background (`src/core/asyncShaders.ts`).
  The HUD shows only the frame and the top CPU stages; `` ` `` (or a click) opens its details. `window.__hud()` dumps it all
  with recent frame spikes (also in every report).
- Walker lab: `?cam=game|close|side|back|feet|head` (head: face to face with the hull), `?sensor=<sensor base id>|none` (the sensor on the hull; default the visor head), `?model=standin` (box walker), `?flat` (no dunes),
  `?walk=straight` (constant heading for filmstrips), `?sprint` (with `walk=straight`), `?fire` (hold the trigger),
  `?manual` (no demo), `?zoom=metres` (game camera distance), `?aimat=x,z` (hold the aim on a point; steel wrecks
  near the start at 22,-28 / 6,-26 / 15,-18), `?dt=0.033` (fixed time per frame, for headless shots and filmstrips),
  `?surface=gravel|dirt|concrete|snow` (dust and dents as if the ground were that), `?dash`, `?at=x,z`, `?warm=seconds` (run that much sim time before the
  first drawn frame, for slow headless filmstrips), `?drop=metres[,m/s]` (start in the air that high, as if a crane let
  go, optionally moving), `?bound` (the demo holds Space: it sprints; with `?walk=straight` in a line), `?dashat=seconds`
  (the demo dashes ahead once; with `?bound` it sprints on from the dash), `?dashdir=left|right|diag|fwd|back|backdiag` (the demo dash's way off the legs' heading: side step, burst or cutback; with `?dash` or `?dashat`), `?wall=degrees[,metres]` (a steep-faced block
  30 m ahead of the straight demo), `?turnat=seconds` (with `?walk=straight`, the demo turns hard right then).
- Sprint (every lab with the mech): tap Space dashes, keep holding and the mech carries on into the sprint, faster and
  faster up to the legs' top speed; let go and it runs on, skidding off the extra speed. Energy bars at the left edge
  (Keith 2026-10-27): a dash empties a full bar, the sprint drains the rest (so it needs two), no hull weapons while sprinting: held guns' arms still track and fire inside a shoulder arc (out to 170° on its own side: past side-on the elbow rolls up and the gun turns over, Keith 2026-11-06) while the hull faces the run, the arm reaching from the shoulder (Keith 2026-11-03; Your mech › Held weapons).
  Energy weapons draw on the hull's reactor instead, a separate cyan bar beside them (Keith 2026-11-02; Your mech › Reactor).
  Space while a sword cut drives in or cuts is a power cut instead (a bar; quicker, blue swish, breaks blocks, parryable), and so
  is a cut right after a dash toward the aim (Keith 2026-11-02; Weapons › Sword power). A double click turns a cut vertical at the
  last moment: overhead down from the forehand, rising up from the backhand, harder but one line (Keith 2026-11-04; Weapons › Sword vertical cut).
- Terrain lab: `?shot` (marker parked), `?view=high` (overhead, no haze), `?seed=N`.
- Swarm lab (Keith 2026-11-02; the robots, bandits, warband, droids, crusher, summoner and strider labs forward here with their flags):
  `?enemy=robots|bandits|warband|droids|crusher` (robots by default), a list (`?enemy=robots,bandits`) or `?enemy=mix` (all at once);
  `?summon` adds the summoner's units on your side (drones, companions, the scrap swarm; robots near them turn on them);
  the buttons in the panel do the same. Each kind keeps its old lab's flags below. Every enemy kind is a front in
  `src/game/fronts/`. The weapon flags (`?left= ?right= ?k1-3= ?barrage ?proto=`) now work in every combat lab.
- Combat labs (swarm, summoner, crusher, repair, stress...): `?manual` (no demo), `?zoom=metres`, `?dt=0.033`, `?flat`,
  `?biome=mix|rocky|shallows` (desert by default), `?craters=N` (N blasts dent the ground round the start, one under
  the mech), `?proto=split:3,rate:2,multi:2,area:1.5,ricochet:1,chain:2` (raw round behaviour on every round of yours, unpriced; multi: side by side) or `?proto=splitter,overclock,doubleShot,quickLoader` (Protocol ids, priced, socketed into every picked weapon they fit; `src/items/protocols.ts`). R fills both magazines at once. Walker lab
  takes `?biome=` too. Swarm lab, robots (`?enemy=robots`): `?beam` (no packs; two excavators stopped either side of the mech, about to charge
  their beams, which sweep after the mech for `robotBeamSweep` s), `?pulse` (one big walker 10 m off, about to throw its terraform pulse at the mech's spot), `?bigdeath[=s]` (a big walker 12 m off with robots round its feet, destroyed after s: it tips over and its hull reactor goes up as it falls, an airburst nova; `?quaddeath[=s]` the same with a weapon quad), `?lineup` (a frozen row of each kind, the four weapon quads beside the mech), `?quads` (one weapon quad of each weapon coming in), `?swarm=N` (a big swarm: N on the field in packs of 60, e.g. `?swarm=300&barrage&time=22`), `?left= ?right= ?k1-3=` (fit weapons as the weapons lab),
  `?robotline[=m]` (a frozen line of mixed robots ahead, no packs; m: start that far to the side, meeting the
  centre at `?lmb`'s distance, so a shot from an arm runs down it), `?lmb=x,z` and `?fireat=N` (hold the left button aimed
  there, let go after N frames).
- Swarm lab, humanoid robots (`?enemy=droids`; `labs/droids/` forwards there): `?squad=N` (squad size, split into troopers, lancers and brutes by `droidLancerShare`/`droidBruteShare`), `?max=N` (on the field), `?still` (one squad frozen 13 m ahead, for looking), plus the combat-lab flags; off elsewhere for now (Keith 2026-11-01): `?set=robotDroids:3` brings them into robots-lab packs, `?set=droidsOn:1` into the convoy lab's camps, packs and raids.
- Striders (in the swarm lab with the robots, Keith 2026-11-01; `labs/strider/` forwards there): `?strider=N` (N up at once, 1 by default),
  `?strider=beam|slam|grab` (one at 45 m about to beam, 14 m about to slam, 6 m about to grab; no packs), `?striderdist=m`.
  Striders are mech-sized (8 m) with a disc hull and long clawed arms. In the convoy lab they come with big robot camps, packs and raids (`?nearcamp`, `?raid`; Striders: in the field).
- Summoner (Keith 2026-11-02; `docs/proposal-summoner.md`; swarm lab `?summon`, `labs/summoner/` forwards to `?enemy=robots&summon` on its old waves): `?drones=N` (attack drones up, 4), `?enemies=N` (robots on the field), `?pack=N`, `?companions=replicas|quads|both` (which kind walks with you; replicas by default), `?replicas=N` (wire-frame mechs, each rolled minigun or rockets; `&set=repRocketShare:1` all rockets, `:0` all miniguns), `?comps=N` (turret quads), `?scrappers=N` (the scrap swarm, 16), `?send` (the swarm thrown 30 m ahead at once), `?still` (a pack standing 25 m ahead, shooting back: watch your units), `?summoner` (the summoner items fitted: drone rack on key 1, swarm hive on key 2, replica bay on the pack; counts from the items), `?dismissat=s` (dismissed s in, as at a convoy pickup, back 30 s later), plus the combat-lab flags; drones and companions go for the Tab lock, else the nearest robots; Z throws the swarm at the lock or cursor, C calls it back. Summoner items fitted in any combat lab (duel, loadout, swarm...) or the convoy lab bring their summons: a drone rack's key (1 or 2) is a drone strike, a swarm hive's sends and recalls.
- Crushers (the heavy crab quad; swarm lab `?enemy=crusher`, `labs/crusher/` forwards there): `?count=N` (up at once), `?dist=m` (where they stand up), `?suck` (one 14 m ahead, spinning up at once), `?claw` (one beside you, pincer ready), `?eat` (it never hunts you: watch it eat the salvage heaps), `?heaps=N`, plus the combat-lab flags.
- Sounds lab (Keith 2026-11-02; the Pixabay recordings): a ▶ button per sound, `?play=<id>` (Breach, Autocannon, Shotgun (the flak recording), Sniper, Rifle, Smg, Mortar, RobotCharge, RobotBeam, RobotDeath, RobotBigDeath: plays on the first click), plus the combat-lab flags. The Sound samples topic (every combat lab and the convoy lab) cuts each one; `?set=samplesOn:0` is all procedural.
- Repair lab: `?hurt=share` (start at that share of hull), `?kits=N`, `?ability=beacon|nanite|weld` (fit only that one), `?ally`
  (a friendly mech at 15% hull 10 m off, for zones to heal), `?chip=dps` (the test turret; 0 stops it). Every combat lab and the
  convoy lab: Q a repair kit (on foot: hold Q by the mech), keys 3 and 4 the pack's and hull's abilities (Medic pack, Salvager, Siege).
- Fortress lab: `?kind=fortress|hub`, `?seed=N` (the layout), `?ring=N` (start in yard N, the gates out to it down),
  `?gates=open`, `?near` (just outside the outer wall), plus the combat-lab flags; the demo shoots the nearest gate down
  and walks in (with `?kind=hub`, it shoots the fabricators down while they build robots, then fights the boss that
  rolls out of the core); the keep holds the warlord; every `?seed=N` rolls a different shape;
  Shift+< or Shift+> puts it all back up.
- Inventory (Keith 2026-11-01; convoy and loadout labs): I anywhere (or click the mech doll at the bottom right) opens it; `?inv[=slot]` starts with it open (on that slot). In the field its cargo is the at-risk list, limited by the cargo grid's cells (Grid › Cargo columns and rows, cargo racks add rows; Loot and cargo › Cargo).
- Inventory lab (Keith 2026-11-02; the grid inventory and the doll): `?roll=N` (N items into the stash), `?out[=scrap]` (out in the field with that much salvage, 120; Grid › Salvage blocks › Compactor level stands in for the convoy's Salvage compactor unlock), `?inv=slot`, `?fresh`. In every inventory: drag items, R or right click while dragging turns one, drop on a doll slot fits it, drag a slot off onto a grid takes it off, right click sends across, bin (twice) scraps, sand drops; Sort chips order Tidy, Show chips dim all but one kind; doll tiles show each fitted item's footprint. Sizes: Grid topic (`src/items/gridSize.ts`).
- Loadout lab: `?bay=slot` (open the bay on a slot; rolls a few items into an empty stash), `?hover=N` (preview the Nth
  fitting item), `?fit=slot:base:rarity,...` (fit rolled items first; slots legs, hull, sensor, mountL/R, heldL/R, shoulderL/R,
  pack, waistL/R), `?choice=arm|hull` (what the bay offers a hull mount), `?fresh` (ignore the saved bay).
- Pose lab (Keith 2026-11-01): `?w=sword|buster|shortsword|minigun|...` (the weapon, the weapons lab's names), `?both` (in both arms),
  `?pose[=key]` (start posing on that key: rest, drive, aStart, aMid, aEnd, under, bStart, bMid, bEnd, cock, preRest, block, recoil),
  `?close` (the close cut's keys), `?dunes`; P pauses and poses, G/T/E hand, blade, elbow. Copy pose's JSON goes into `SWORD_POSES`
  (`src/weapons/swordPoses.ts`); `window.__pose` in the console.
- Parts lab: `?part=<id>` (a generated part from `public/models/gen/index.json`), `?cam=game|close`, `?zoom=metres`. Make parts with
  `npx tsx tools/partgen/run.ts --kind hull|hullweapon|shoulder|wreck` (`--prompt`, `--seed`, `--lane a|b|both`, `--image`, `--from x.ply|x.glb`; header of `run.ts`).
- Armoury lab: `?model=<id>`, `?view=rampart|turntable|lineup`, `?cam=game|close`, `?zoom=metres`, `?dt=0.033`, `?t=seconds`
  (start the firing cycle there), `?still` (no cycle), `?mech=<variant>`.
- Weapons lab (the review panel's flags above work here too; Keith 2026-11-06): `?target=auto|cutouts|trucks|swarm|runners|mech` (what the demo shoots: auto is the old tour for the picker's loadout; runners are 100 bandits running back and forth behind the mech, the mech an enemy Rampart walking up and down on the right; Runners and Target mech topics), `?left=`/`?right=minigun|lightmg|rail|lightrail|autocannon|rpg|rocketpod|sword|laser|beam|lance|plasma|orb|arc|sunder|smg|rifle|shotgun|sniper|flak|cannon|flamer|inferno|frost|cryo` (flamer: the held flamethrower, inferno: the hull one; both set things burning and heat metal, Keith 2026-11-05; frost, cryo: the held and hull freeze rays, chill slows and then freezes robots and bandits solid; smg, rifle, shotgun: held round guns; sniper, flak, cannon (the breach cannon, explosive shells): hull; energy weapons on the reactor: pulse laser, beam laser, nova lance, plasma cannon, particle orb, arc caster, sunder beam (click: charges, then a heavy beam you steer for 2.5 s); `&set=energyCost:0` makes them free) (rocketpod: an arm holding the missile pod: hold to channel its clip of 8; sword: an arm holding the Breaker sword, click to swing, hold to keep swinging), `?barrage` (rocket
  launchers on both hull mounts, the shoulder rocket on key 1, missile pods on keys 2 and 3; `?barrage=arms`: arm rocket pods
  instead; works wherever `?left=` does: robots, weapons, duel, convoy labs; add `&proto=splitter&time=22` for the night show), `?k1=`/`?k2=none|rpg|missiles|mortar|linemortar|napalm|beltfeed|incendiary|capacitor` (napalm: the napalm launcher, painted like the line mortar, each canister a burning pool)
  (shoulders sit on the hull top whatever the gun, Keith 2026-10-30; feeds and power are pressed, not painted), `?k3=pack|rpg|missiles|mortar|linemortar|napalm` (a back
  weapon in place of the pack), `?hold=N:x,z` (hold key N aimed there), `?lmb=x,z` / `?rmb=x,z` (hold a mouse button
  aimed there), `?aim=x,z`, `?fireat=N` (let go after N frames), `?lockcar` (guns on the first truck with the lock on
  it), `?start=x,z` (where the mech stands), plus the combat-lab flags.
- Weapon review (Keith 2026-11-03; now the weapons lab's review panel, Keith 2026-11-06: `labs/weaponreview/` forwards there; `src/items/weaponScaling.ts` on the balance sheet's model, `src/items/balanceModel.ts`): `?review` (the panel's weapon on the mech, panel open), `?w=<base id>` (mg-medium, flak-medium, sh-mortar...), `?protos=splitter,splitter` (socketed into the fired weapon, repeats allowed), `?armour=N` (every single target's armour; −1 their own), `?nofire` (the demo aims, holds fire), `?panel=0`, `?pen[=fodder|spread|horde|armoured|cutters|column]` (the demo shoots the test swarm off to the left, Keith 2026-11-04: live clear numbers beside the model's; Test swarm sliders), plus the combat-lab flags. `npx tsx tools/weaponscaling-check.ts` prints the same axes for every weapon (energy weapons and swords too, roughly; swords stand at the cutouts).
- Combat controls (every combat lab): left click fires the left side's weapon, right click the right side's (both can
  be held); keys 1-3 hold to paint a shoulder launcher, release to fire (line mortar and napalm also: tap the key, click the sand where the line starts, drag its way, let go fires; double tap fires straight ahead; Keith 2026-11-05, Weapons › Line aim); keys 1-2 on a feed or power item are a press (belt feed: overdrive, incendiary feed: ignited rounds, capacitor bank: discharge a bar; Keith 2026-10-30); hold F to hop out of the mech, hold F by it to get
  back in (Keith 2026-10-26; F no longer fires). Tab with an enemy under the cursor locks it (shots and sword act as if the cursor were
  on it; Tab again lets go; Keith 2026-11-01).
- Pilot (every combat lab and the convoy lab): `?onfoot` (start on foot beside the mech), `?holdf=seconds` (F held
  from the start, for shots of getting out).
- Duel lab: `?rival=seed` (which rival mech; Reroll steps on), `?rivalfit=slot:base[:rarity],...` (fit these over its roll,
  as the loadout lab's `?fit=`), `?left= ?right= ?k1= ?k2= ?k3=` (your weapons, as the weapons lab; else the loadout lab's bay
  save, else the weapons lab's last pick), `?bay` (use the bay save), `?rivallevel=recruit|veteran|ace` (the rival's difficulty preset, Recruit by default; also buttons in the panel), `?wreck[=s]` (the rival is destroyed that long into each round, 2 s by default, to watch its wreck fall; Shift+< or Shift+> for another), `?rivalup=N` (the rival's items roll N levels above yours, or below with a negative N; slider in the Rival group; the panel shows both levels and loadout DPS), a rival's summoner gear brings its summons on its team (`?rivalfit=shoulderL:sh-drones,shoulderR:sh-hive,pack:pack-replica`), plus the combat-lab flags; Shift+< or Shift+> restarts the round (not R: too easy to hit by accident, Keith 2026-11-06).
- Stress lab: `?run` (start the ramp once loaded), `?steps=25,50,100,150`, `?settle=s`, `?hold=s`, `?worst` (the co-op worst
  case: three AI allies, max-Protocol stand-ins, effects ×4), plus the combat-lab flags.
  Results go to the screen, the console and `window.__stress`.
- Convoy lab: `?manual`, `?aboard` (start on the deck; the mech can walk, run, dash or sprint off a mech bay's side), `?walkoff[=dash]` (the demo walks or dashes off the side instead of using the launch pad), `?deploy` (start launching), `?park` (start parked), `?hang`
  (start hanging from the crane, about to lift), `?drop` (just after the crane lets go), `?threat` (a marker circling the train for the turrets), `?crest[=m]` (the plough's blade that far short of the biggest cut ahead), `?zoom`, `?dt`, `?flat`, `?watch=N` (camera on car N, 0 the lead; `plough` the plough;
  `gapN` the gap ahead of car N; `eN` escort N); E parks in a bay, G launches from anywhere. Expedition: `?out` (start out in
  the field, 280 m off, scrap at risk), `?far` (850 m out, mech radar), `?lowfuel[=seconds]` (fuel on, little left; fuel is off by default, `?set=fuelOn:1`), `?loot=N`
  (N scrap at risk), `?nearcamp[=metres]` (just outside the nearest swarm camp, or that close), `?crusher[=metres]` (that close to the nearest salvage site a crusher grazes on), `?banditcamp[=metres]` (the same for the nearest bandit camp), `?clash` (330 m from a bandit camp with a robot pack walking into it, out of view), `?warband[=N]` (a war band column of N vehicles, 6 by default with a party bus and a turret truck, 260 m ahead hunting the mech), `?fortress[=m]` / `?hub[=m]` (that far, 150 m by default, from the nearest bandit fortress or manufacturing hub); E strips salvage on the sand, hold X recovers (Q is the repair kit), Tab cycles the sensor's seeker,
  `?seek=scrap|wreck|rare|legendary`. Loot: `?drop=rarity[,level]` (start out on the sand, an item of that rarity dropped ahead of the mech every few
  seconds; `?drop=all[,level]` one of each rarity in turn; a bare `?drop` is still the crane's drop), `?items=N` (N items at risk).
  Pilot: `?onfoot` starts on foot beside the mech parked in the lead bay (with `?out`, `?far`, `?nearcamp` or `?field`, on
  the sand beside it instead), `?pilotat=N,x,z` (on car N at local x, z) or `?pilotat=bN,t` (on footbridge N, t of the
  way across), `?bay` (bay screen open). On foot E at a bay terminal opens the bay screen; B anywhere.
  Weapons as in the combat labs (only while driving the mech); a fresh convoy bay fits miniguns on both hull mounts, the missile pod on key 1, a belt feed on key 2 and the power pack,
  `?left= ?right= ?k1= ?k2= ?k3=` (as the weapons lab) fit those instead; `?summoner` fits the summoner items (`?k1=drones|hive`, `?k2=`, `?k3=replicas`): the summons are with you on the sand, dismissed when the convoy picks you up, built again when you're back out; a hive's key throws and recalls the swarm. `?bigclose[=metres]` (an excavator that close,
  cursor held on its bucket, both guns firing), `?pad[=m]` (start out that close, default 60, to the nearest extraction pad,
  pickups bought, 400+ scrap at risk; hold E on the pad to call, then roam; when it hovers in, stand under it 4 s; quick: `&set=padWaitBase:5,padWaitPerKm:0`), `?unlock=all` (every convoy unlock bought; U or the bay screen shows the shop),
  `?bank=N` (N scrap banked), `?heli[=metres]` (start on the helipad on the lead bay, bank at least 500 unless `?bank=` says: hold H to call the quadcopter, WASD steers, H drops you; with metres it flies itself that far out to the left and drops), `?raid` (a raid at once), `?siege[=N]` (on the sand beside the convoy, a robot pack of N, 40, coming in: the convoy's turrets, escorts and guardian mechs fight it; `window.__defence` in the console). Contracts and HVTs: `?quest=salvage|cull|bounty|tow|pods` (out on the sand
  with that contract taken), `?hvt[=metres|now]` (that close, 60 m, to the nearest high value target's lair, one kill short of
  drawing it out; `now`: it's coming; with `?quest=bounty` the bounty is on it); J takes the newest offer, hold J drops one,
  hold E by a downed Rampart hooks it (again to drop); `window.__quests` in the console.

## Layout

```
state.md                live state of every system, work in progress, change history
reports/                Keith's in-lab reports and your replies (in git, so any agent can pick them up; delete one when fixed)
index.html              lab hub
labs/<name>/            one page per system (index.html + main.ts)
src/core/               app (renderer, loop), hud (frame time), tweaks (slider panel), input
src/world/              noise, terrain (the dune height function), chunks (streaming, the shadow-only terrain copy), chunkGround
                        (a cheap ground for looks off the chunks' triangles), look (light, haze), wrecks (steel stand-ins),
                        craters (blast dents in the ground: hardness, slump), walkable (the ground plus registered surfaces
                        with moving frames, for anyone on foot)
src/core/isoCamera.ts   the high isometric game camera
src/mech/               walker (leg sim), upper (torso and guns sim), walkerTuning, legTypes (leg archetypes), rampart (model rig), walkerBody (stand-in)
src/look/               toon (unit materials, optional cel bands, ink outlines)
src/audio/              synth (procedural sounds), sfx (player), minigunAudio
src/fx/                 dust (sim) + dustDraw, dents (GPU dent layer) + dentRule + groundMarks (every mark on the ground),
                        minigun (tracers, flash, hits, casings),
                        water (ripples, wakes, splashes) + waterDraw, shellsDraw (telegraph rings), blastWaves + blastWavesDraw
                        (a blast wave on every explosion: screen bend, ground ring, heat shimmer)
src/game/               fronts/ (the swarm lab's enemy kinds: robots, bandits, warband, droids, crusher; summoner: your units), battlefield (shared combat stage), solids (mechs and vehicles as solid bodies), repair (repair kits, pure) + repairUse (Q, sounds, the HUD view), sheet + sheetFire (direct fire as a vertical sheet with a penetration
                        budget), mechUnit (a mech with health), combatLab (combat lab shell), targeting (soft lock),
                        playerAim (mouse buttons, soft aim + reticle and brackets, camera shake, the arsenal; shared by the combat
                        labs and the convoy lab), loadoutApply (a loadout onto a mech), dummies + dummiesDraw (target dummies and cutouts),
                        firingRange (the weapons lab's ground and target spots), rangeVehicles (trucks on a loop),
                        duelGround (the duel lab's arena, cover drifts, line of sight)
src/convoy/             route (heading + flattened road), safeZone (enemies steer out), guard (turrets and escorts fire), guardians (escort mechs), platform, crane (axes + rope swing), carry (pick-up, park,
                        launch), deck (deck as ground, riding, spots), hold (crane hang and park poses), train (line
                        layout, footbridges), tracks (crawler pods), trail (ruts, dust), pipes (seeded pipe runs),
                        furniture, escort (escort driving), plough (the bulldozer that cuts the road) + wake (berms from the sand moved)
                        + ploughFx, walkways (decks, stairs, landings, footbridges as walkable
                        surfaces); drawing: platformBody, trackBody, pipesDraw, bridgeBody, craneBody, escortBody, kit
src/vehicles/           car (vehicle sim), carBody (stand-in raider vehicles)
src/combat/             warband (raider vehicles and bandit mechs) + partyBus (the bus's drops), infantry (bandit swarm) + infantryDraw, infantryTarget,
                        banditVat + banditAnim (Vanguard on a baked vertex animation texture; baker in tools/mixamo/),
                        robots (scrappers, cutters, excavators) + robotLegs, robotShapes, robotsDraw, robotTarget, robotTearFx,
                        crusher (the heavy crab quad: a sucking turbine maw, pincers, eats salvage) + crusherBody, crusherTarget, crusherFx, crusherField (glue),
                        rivalAi (a rival mech's brain: a view in, the player's commands out) + rivalKit (rolled rival loadouts,
                        the kit as the AI sees it), duelThreats (weapons in the air as threats), duelScore, duelSim (headless duel)
src/items/              item, bases (the part and weapon table), traits (weapon traits Protocols fit by), rarity, protocols, balanceModel (the balance sheet's maths) + weaponScaling (focus, area, crowd, reliability, reach, Protocol ceilings), loadout (slots, fit rules, resolve), gridSize (item grid sizes) + grid (the grid inventory),
                        generate (seeded loot), cargo (cargo and stash lists), weaponPick (a quick pick per button and key)
src/ui/                 bay (the bay screen: fit parts, sockets, loot), vitalsHud (hull bar, kits, red edge, hit arcs)
src/summon/             the summoner's units: drones (attack drones, pure) + dronesDraw; glue: allies (turret companions and the scrap swarm on the robots' sim), summons (all of them on a battlefield)
src/abilities/          abilities (timed abilities from hulls and packs), zones (heal zones, pure) + zonesDraw; glue: abilityUse
src/pilot/              the pilot on foot: pilot (capsule controller), mount (hold F out and in), quarry (the pilot as a
                        target, who enemies pick); glue: onFoot; drawing: pilotBody (Vanguard bake), pilotHud
src/quests/             contracts (pure board), hvt (lairs, summoning), tow (cable, pods); glue: hvtMech (the HVT's rival
                        mech), questLoop (into the expedition); drawing: questDraw, questHud
src/expedition/         the loop: expedition (states, at-risk list, bank), fuel, returnPoint, radar, camps (swarm camps, unknown
                        areas), threats (roaming packs, raids, distant blasts); glue: loop, sites (POIs + salvage), crusherSites (crushers grazing on salvage; a kill calls a swarm), fortresses (gates and
                        garrisons), swarmCamps (camps
                        and packs as the robot swarm); radarDraw, radarSound, threatMarks (edge-of-screen marks),
                        expeditionHud
src/weapons/            the new weapons, each with its own targeting: tuning (sliders), painter (strip, ring, laser) + painterDraw,
                        salvo (line rockets), rail, mortar, autocannon (pure sims), gear (shoulder feeds and power: overdrive, ignited rounds, discharge; pure), arsenal (a mech's weapons on the battlefield)
                        + arsenalDraw, models (each kind's model: the library's via modelSwap, boxes as the fallback),
                        projectileDraw, weaponSound, ribbon (ground-hugging marks).
                        Models: library (by id: GLB at public/models/weapons/<id>.glb, else a code stand-in), catalog, parts,
                        weaponModel, weaponLook + palette (paint sections, schemes, heat, lamps), laserSight, mounts (on the
                        Rampart), demo; kit/ (the old Blender weapon kit ported to TS), build/ (stand-ins); fire/ (the flamers
                        and napalm: tuning, fireGuns glue; burning in src/game/burn.ts, pools firePools.ts, damage types
                        damageType.ts, the look src/fx/flameFx.ts)
src/physics/            deaths (Rapier world of the dead: ragdolls, wrecks), bodies (ragdoll layouts), deadDraw
public/models/          GLB models (provenance in docs/assets.md)
tools/                  *-check.ts headless checks, shots.mjs screenshots; partgen/ (generated parts: ComfyUI client, splat to mesh,
                        game prep, kinds read from the Rampart; output in public/models/gen/)
docs/                   design.md (the game), decisions.md (log)
```

## Key conventions

- Units: metres, seconds; degrees in tuning, radians in code. Y up. Heading 0 faces +Z; +X is the mech's left.
- **The ground is a function.** `DuneField.height(x, z)` is pure and deterministic: chunks, feet, vehicles and AI all
  read the same function, so any chunk can be built in any order and nothing disagrees about where the ground is.
- Mech scale: the Rampart is about 4.4 m to the hood, hips at 3.05 m; walk 6 m/s, sprint (Shift) 8.5 m/s (Keith 2026-10-26; was the old project's 4 / 6.5).
- Camera: the game is played from a high isometric view (Keith 2026-10-24): 50° down at 40 m, zoom from 45° at 12 m
  out to 55° at 80 m.
  Judge looks and readability from that camera first; close views are for detail.
- Controls: twin-stick. WASD moves the legs (relative to the screen), the mouse aims the torso and guns, left click
  fires the left side's weapon and right click the right side's (Keith 2026-10-25), keys 1-4 the shoulder gear (every hull has two shoulders, keys 1 and 2, whatever its hull mounts hold).
  Hold F to hop out (the mech kneels; at the convoy, parked in a bay) and hold F within 3 m of it to get back in
  (Keith 2026-10-26); on foot WASD walks the pilot, Shift runs, E uses a bay terminal or strips salvage by hand.
- Models: parts that ride sim bones are baked to rest-pose world space and hung under pivots on their joints;
  read proportions from the model's joint markers rather than hardcoding them.
- Sound is procedural (`src/audio/synth.ts`, recipes from the old game's SfxSynth): no audio files. It starts on the
  first click or key press.
- Sims step at a fixed 120 Hz inside the frame (see the walker lab) so feel doesn't change with frame rate.

## State

Where every system stands, what's in progress, the next candidates and the change history: `state.md`. Read it
first; update it with every change (rule 10).
