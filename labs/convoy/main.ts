// Convoy lab (Keith 2026-10-24, docs/proposal-convoy.md): the convoy village rolling over the dunes, laying a
// flattened road that stays behind it; the player's Rampart on twin-stick walks alongside. Walk into the crane's range
// and it picks the mech up (swinging on its rope) and sets it on the deck; walk about the moving deck, park in a bay
// (E, again to stand), or stand on a launch pad by the crane and it lifts you out and down beside the convoy at its
// speed (G launches from where you stand). Until you take over, a demo walks in, is picked up, parks, stands, walks
// to a launch pad, is launched, walks off and comes back.
// The convoy runs as a train (Keith 2026-10-24): platforms in a line with gaps the mech walks through, footbridges
// between them high enough to walk under, crawler tracks on the big ones leaving ruts and dust, pipe runs, vehicles
// tied down on the motor pool and escorts driving alongside.
// The expedition loop (docs/proposal-expedition.md) runs on top: POIs and swarm camps out in the sand, E strips
// salvage onto the at-risk list, the crane's pick-up banks it, hold X (or running out of fuel) recovers the mech and
// loses it, a destroyed mech loses it too; the radar (big in the convoy's range, the mech's own past it), the arrow
// home to the return point, fuel and the home estimate (src/expedition/).
// Flags: ?manual (no demo), ?aboard (start on the deck), ?deploy (start on the deck and launch at once), ?park (start
// parked), ?hang (start hanging from the crane over the sand), ?drop (just let go over the sand, falling), ?threat (a
// marker circling the train for the turrets to track), ?zoom=metres, ?dt=0.033, ?flat, ?watch=N (the camera
// follows car N, 0 the lead; ?watch=gapN the gap ahead of car N; ?watch=eN escort N); expedition: ?out (start out in the
// field, 280 m off the convoy, with some scrap at risk), ?far (850 m out, past the range edge), ?lowfuel[=seconds]
// (start out with little fuel left), ?depth=metres (start out that far off the road, for the depth rings), ?loot=N (that much scrap at risk), ?nearcamp[=metres] (just outside the nearest swarm camp, or that far from it); factions: ?banditcamp[=metres] (just outside the nearest bandit camp), ?clash (a robot pack on its way into the nearest bandit camp, both out of your sight: watch the radar flicker, then the wreckage), ?warband (a war band column a few hundred metres ahead, hunting you); ?fortress[=metres] / ?hub[=metres] (that far from the nearest bandit fortress or manufacturing hub, 150 m by default).
// The plough (Keith 2026-10-26): a giant bulldozer at the very front cuts the road and throws the sand into berms;
// ?watch=plough follows its blade, ?crest[=metres] starts with the blade that far (18 m) short of a big dune crest.
import { energyHud } from "../../src/ui/energyBar";
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { createApp } from "../../src/core/app";
import { installReport } from "../../src/core/report";
import { Selector } from "../../src/core/select";
import { tweakPanel, type Param } from "../../src/core/tweaks";
import { Keys, typing } from "../../src/core/input";
import { IsoCamera, ISO_DEFAULTS, ISO_PARAMS } from "../../src/core/isoCamera";
import { DuneField, TERRAIN_DEFAULTS, TERRAIN_PARAMS } from "../../src/world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS, STREAM_PARAMS } from "../../src/world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS, LIGHT_GROUPS } from "../../src/world/look";
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../../src/mech/walkerTuning";
import { UPPER_DEFAULTS, UPPER_PARAMS, type Aim, type Trigger } from "../../src/mech/upper";
import type { MoveCommand } from "../../src/mech/walker";
import { LEG_TYPES } from "../../src/mech/legTypes";
import { RampartBody, mechLegType } from "../../src/mech/rampart";
import { QUEST_FLAGS } from "../../src/quests/questLoop";
import type { Lair } from "../../src/quests/hvt";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../../src/look/toon";
import { DENT_DEFAULTS, DENT_PARAMS } from "../../src/fx/dents";
import { MINIGUN_FX_DEFAULTS, MINIGUN_FX_PARAMS } from "../../src/fx/minigun";
import { DUST_DEFAULTS, DUST_PARAMS } from "../../src/fx/dust";
import { SFX_DEFAULTS, SFX_PARAMS } from "../../src/audio/sfx";
import { Battlefield } from "../../src/game/battlefield";
import { MechUnit, MECH_DEFAULTS, MECH_PARAMS } from "../../src/game/mechUnit";
import { ConvoyRoute, ROUTE_DEFAULTS, ROUTE_PARAMS } from "../../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS, PLATFORM_PARAMS } from "../../src/convoy/platform";
import { Crane, CRANE_DEFAULTS, CRANE_PARAMS } from "../../src/convoy/crane";
import { CraneCarry, CARRY_DEFAULTS, CARRY_PARAMS } from "../../src/convoy/carry";
import { DECK_DEFAULTS, DECK_PARAMS, deckLayout, walkToSpot, MECH_PUSH_R } from "../../src/convoy/deck";
import { PlatformBody } from "../../src/convoy/platformBody";
import { CraneBody } from "../../src/convoy/craneBody";
import { TRAIN_DEFAULTS, TRAIN_PARAMS, bridgeSpans, type Span } from "../../src/convoy/train";
import { TRACK_DEFAULTS, TRACK_PARAMS } from "../../src/convoy/tracks";
import { PIPE_DEFAULTS, PIPE_PARAMS } from "../../src/convoy/pipes";
import { ConvoyTrail, TRAIL_DEFAULTS, TRAIL_PARAMS } from "../../src/convoy/trail";
import { EscortGroup, ESCORT_DEFAULTS, ESCORT_PARAMS } from "../../src/convoy/escort";
import { EscortBodies } from "../../src/convoy/escortBody";
import { BridgeBody } from "../../src/convoy/bridgeBody";
import { Defence, DEFENCE_DEFAULTS, DEFENCE_PARAMS } from "../../src/convoy/defence";
import { DefenceBody } from "../../src/convoy/defenceBody";
import { PloughBody } from "../../src/convoy/ploughBody";
import { PloughFx, PLOUGH_FX_DEFAULTS, PLOUGH_FX_PARAMS } from "../../src/convoy/ploughFx";
import { PLOUGH_BASE_LENGTH, BLADE_AHEAD } from "../../src/convoy/plough";
import { WAKE_PARAMS } from "../../src/convoy/wake";
import { ExpeditionLoop, LOOP_DEFAULTS, LOOP_PARAMS, LOOP_TOPICS } from "../../src/expedition/loop";
import { POI_PARAMS } from "../../src/world/pois";
import { SITE_PARAMS } from "../../src/pois/kinds";
import { CAMP_PARAMS } from "../../src/expedition/camps";
import { BANDIT_PARAMS } from "../../src/expedition/banditCamps";
import { COLUMN_PARAMS } from "../../src/expedition/warColumns";
import { FACTION_PARAMS } from "../../src/game/factions";
import { loadBanditVat } from "../../src/combat/banditVat";
import { Costs } from "../../src/core/costs";
import { TARGET_DEFAULTS, TARGET_PARAMS, enemiesOf, type Lock } from "../../src/game/targeting";
import { mechOwner } from "../../src/game/registerOwners";
import { WEAPON_DEFAULTS, WEAPON_PARAMS, WEAPON_TOPIC } from "../../src/weapons/tuning";
import { SHOT_DEFAULTS, SHOT_PARAMS } from "../../src/game/shots";
import { MouseButtons, SoftAim, CameraShake, fitArsenal } from "../../src/game/playerAim";
import { ReloadHud } from "../../src/ui/reloadHud";
import { HealthBars, BAR_DEFAULTS, BAR_PARAMS } from "../../src/ui/healthBars";
import { BIG, DOWN } from "../../src/combat/robots";
import { WALK_LEGS } from "../../src/combat/robotLegs";
import { loadoutFor, pickFromParams, type Pick } from "../../src/items/weaponPick";
import { Walkable } from "../../src/world/walkable";
import { ConvoyWalkways, WALKWAY_DEFAULTS, WALKWAY_PARAMS, platformFrame, deckPlane } from "../../src/convoy/walkways";
import { OnFoot, ON_FOOT_DEFAULTS, ON_FOOT_PARAMS, PILOT_TOPIC } from "../../src/pilot/onFoot";
import { bayScreen, loadBay, saveBay, type BayState } from "../../src/ui/bay";
import { convoyShop } from "../../src/ui/convoyShop";
import { VITALS_DEFAULTS, VITALS_PARAMS, vitalsHud } from "../../src/ui/vitalsHud";
import { KitControl, addRepairSounds } from "../../src/game/repairUse";
import { AbilityControl } from "../../src/abilities/abilityUse";
import { ABILITY_TOPIC } from "../../src/abilities/abilities";
import { resolve, LOADOUT_DEFAULTS, LOADOUT_PARAMS } from "../../src/items/loadout";
import { LOOT_DEFAULTS, LOOT_PARAMS } from "../../src/items/generate";
import { newBag, addTo } from "../../src/items/cargo";
import { rollLoot } from "../../src/items/generate";
import { RARITIES, type Rarity } from "../../src/items/rarity";
import { itemName } from "../../src/expedition/drops";
import { applyLoadout } from "../../src/game/loadoutApply";

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;
const V = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...DENT_DEFAULTS, ...MECH_DEFAULTS,
  ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS,
  ...TRAIN_DEFAULTS, ...TRACK_DEFAULTS, ...PIPE_DEFAULTS, ...TRAIL_DEFAULTS, ...ESCORT_DEFAULTS, ...DEFENCE_DEFAULTS,
  ...LOOP_DEFAULTS, ...PLOUGH_FX_DEFAULTS, ...ON_FOOT_DEFAULTS, ...WALKWAY_DEFAULTS, ...LOOT_DEFAULTS, ...LOADOUT_DEFAULTS, ...TARGET_DEFAULTS, ...WEAPON_DEFAULTS, ...SHOT_DEFAULTS, ...BAR_DEFAULTS, ...VITALS_DEFAULTS,
  radius: 5, shadowBox: 60,
  // The convoy lab runs the day (Keith 2026-10-28); the other labs hold a fixed noon unless ?time= is given.
  dayCycle: 1, dayRun: 1, timeOfDay: 16,
};
const DEFAULTS = { ...V };
const PARAMS: Param[] = [
  ...ON_FOOT_PARAMS, ...VITALS_PARAMS, ...WALKWAY_PARAMS, ...LOOT_PARAMS, ...LOADOUT_PARAMS, ...WEAPON_PARAMS, ...SHOT_PARAMS, ...BAR_PARAMS, ...TARGET_PARAMS,
  ...LOOP_PARAMS, ...ROUTE_PARAMS, ...PLOUGH_FX_PARAMS, ...TRAIN_PARAMS, ...PLATFORM_PARAMS, ...TRACK_PARAMS, ...TRAIL_PARAMS, ...PIPE_PARAMS, ...ESCORT_PARAMS, ...DEFENCE_PARAMS, ...CRANE_PARAMS, ...CARRY_PARAMS, ...DECK_PARAMS, ...MECH_PARAMS, ...WALKER_PARAMS, ...UPPER_PARAMS,
  ...MINIGUN_FX_PARAMS, ...DUST_PARAMS, ...DENT_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS,
  ...STREAM_PARAMS, ...LOOK_PARAMS,
];

// World: dunes with the convoy's road in them.
const toon = new ToonLook(V);
const field = new DuneField(V);
if (params.has("flat")) { field.v = { ...V, height: 0, swell: 0, bumps: 0 }; field.update(); }
const route = new ConvoyRoute(V, 0, 0);
field.modifier = route;
const streamer = new TerrainStreamer(field, V);
scene.add(streamer.group);
// As the plough's blade advances, the ground behind it changes in small boxes: patched in place a few per frame
// under a time budget (the craters' way), nearest first is not needed as they come in order behind the blade.
const patchQueue: [number, number, number, number][] = [];
route.onChange = (x0, z0, x1, z1) => { patchQueue.push([x0, z0, x1, z1]); };
let patchMs = 0, patchVerts = 0;
function patchSome(budgetMs: number) {
  const t0 = performance.now();
  patchVerts = 0;
  while (patchQueue.length && (patchVerts === 0 || performance.now() - t0 < budgetMs)) {
    const b = patchQueue.shift()!;
    patchVerts += streamer.patchArea(b[0], b[1], b[2], b[3]);
  }
  patchMs = performance.now() - t0;
}
const look = new DesertLook(scene, app.renderer, V);
const bf = new Battlefield(field, V, camera);
// Ruts and prints as dents on a fine patch (Keith 2026-10-25).
if (!app.params.has("norender")) bf.useDents(app.renderer, streamer);
scene.add(bf.group);

// The convoy, its cranes (one per mech bay: the lead's and the rear one's), and their stand-in bodies.
const convoy = new Convoy(route, V, field);
convoy.reset(0, 0);
const cranes = convoy.bays.map((b) => new Crane(V, b));
const carry = new CraneCarry(V, cranes, field);
const bodies = convoy.platforms.map((p) => new PlatformBody(p, p.spec.kind === "bay" ? V : null, V, convoy.platforms));
for (const b of bodies) { b.update(); scene.add(b.root); }
const craneBodies = cranes.map((c) => new CraneBody(c, bodies[convoy.platforms.indexOf(c.platform)]));
for (const c of craneBodies) scene.add(c.group);
// Footbridges between the cars, escorts alongside, and the ruts and dust they all leave.
const bridges = new BridgeBody();
scene.add(bridges.group);
let spans: Span[] = [];
const escorts = new EscortGroup(V, convoy, field);
const escortBodies = new EscortBodies(escorts);
scene.add(escortBodies.group);
const trail = new ConvoyTrail(V, bf, field);
// Turrets on the cars (no enemies here: they sweep, or track the ?threat marker; the fire hook is left for combat).
const defence = new Defence(V, convoy.platforms);
const defenceBody = new DefenceBody(defence);
scene.add(defenceBody.group);
// The plough at the front and the sand it throws.
const ploughBody = new PloughBody(convoy.plough);
scene.add(ploughBody.root);
const ploughFx = new PloughFx(V, convoy.plough, bf, field);
const threatOn = params.has("threat");
const threatMark = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), new THREE.MeshBasicMaterial({ color: 0xff4030, toneMapped: false }));
threatMark.visible = threatOn;
scene.add(threatMark);

// The player's Rampart.
const body = await RampartBody.load(toon);
Object.assign(V, LEG_TYPES[mechLegType()].values, body.legValues());
Object.assign(DEFAULTS, LEG_TYPES[mechLegType()].values, body.legValues());
scene.add(body.root);
look.lights.track(body.root);
look.lights.ground = field; look.lights.camera = camera;
// Night lights: the bay terminals' lamp masts light the decks.
look.lights.addLamps(() => bodies.flatMap((b) => b.terminalMeshes().filter((m) => (m as THREE.Mesh).geometry?.type === "SphereGeometry")));
const player = new MechUnit(bf, V, body, toon, 1, 0, true);
// Each gun's magazine round the cursor; enemies' health bars (Keith 2026-10-31).
const reloadHud = new ReloadHud();
const healthBars = new HealthBars(scene, camera, () => bf.targets, player.team, V);
bf.targets.push(player);
bf.fx.own = player.sim.pos; // the effects budget keeps the local player's at full
const sim = player.sim;
// The expedition: POIs, salvage and swarm camps out in the sand, the at-risk list, fuel, the radar and the HUD.
const banditVat = await loadBanditVat().catch((e) => { console.warn("bandit bake not loaded, boxes instead:", e); return null; });
const loop = new ExpeditionLoop(V, field, bf, scene, camera, route, convoy, carry, player, { vat: banditVat, groundChanged: (x0, z0, x1, z1) => streamer.rebuildArea(x0, z0, x1, z1) });
// The fortresses' warlord: a red Rampart loaded now so a keep can field it at once (src/expedition/warlord.ts).
{
  const wb = await RampartBody.load(toon);
  const wl = new MechUnit(bf, V, wb, toon, 2, 20, false);
  wl.paint = 0x8e2a1e;
  wb.paint(toon, 0x8e2a1e);
  loop.attachWarlord(wl, scene);
}
/** Recovered or lost: back on the lead bay's set-down pad, repaired. */
function homeAboard() {
  carry.state = "walking"; carry.phase = ""; carry.attached = false; carry.armed = true; carry.ground.onDeck = false;
  const p = convoy.bays[0];
  player.reset(p.x, p.z, p.heading);
  carry.putAboard(sim, cranes[0]);
  for (const c of cranes) c.calm();
  // The pilot (killed on foot, or out when the mech was lost) is back in the cockpit.
  foot.reset();
  streamer.fill(sim.pos.x, sim.pos.z);
}
loop.onHome = homeAboard;
// Targets for the soft lock and the weapons: every robot out there (asleep ones too: shooting one wakes its camp).
// They're in the battlefield's register (src/game/register.ts) with the player's mech, rebuilt once a tick.
bf.register.add(mechOwner("player", () => [player]));
loop.register(bf.register);
const enemies = enemiesOf(player.team);
// The player's weapons as in the combat labs (src/game/playerAim.ts): the arsenal, camera shake, blasts.
const shaker = new CameraShake();
const { arsenal, draw: arsenalDraw } = fitArsenal(bf, player, V, toon, scene, enemies, shaker);
// The bandits may dive out of the mech's telegraphed shots (Keith 2026-10-31, src/game/bodyContact.ts).
loop.threatSource = { arsenal, wv: V };
// High value targets get their own Rampart (loaded on the first summon) and see the player's weapons for dodging.
loop.quests.setup({ look: toon, loadBody: () => RampartBody.load(toon), threat: () => loop.threatSource });
let hvtNow: Lair | null = null, hvtLair: Lair | null = null;
// For poking at from the console: window.__quests (the board, lairs, the HVT, the cable).
(window as unknown as { __quests: unknown }).__quests = loop.quests;
// No sand prints or dust from footfalls on the steel deck (they'd be left hanging in the air as it rolls on).
{
  const fall = sim.onFootfall, lift = sim.onLiftOff;
  sim.onFootfall = (f, k) => { if (!carry.ground.onDeck) fall?.(f, k); };
  sim.onLiftOff = (f, k) => { if (!carry.ground.onDeck) lift?.(f, k); };
}

// A launch drop lands heavily: the mech's own landing (src/game/mechUnit.ts) throws the sand, prints the feet and
// bangs; the drop adds a burst between the feet, a scuffed crater and a camera shake. Any other hard landing (off a
// dune crest) shakes the camera too.
carry.onTouchdown = (x, y, z, speed) => {
  const k = Math.min(1.6, speed / 7.7);
  const pv = carry.platform.vel;
  bf.dust.stomp(x, y, z, 2.4 * k, pv.x, pv.z);
  // A big strike (k >= 2) always leaves a dent.
  bf.marks.crater(x, z, Math.max(2, 5 * k));
  shaker.add(V.craneLandShake * k);
};
player.onLanding = (l) => { shaker.add(V.craneLandShake * Math.min(1.6, l.impact / 7.7)); };
// Each sprinting footfall: a small shake (sprintShake).
player.onSprintStep = (k) => shaker.add(V.sprintShake * Math.min(1.5, k));

const iso = new IsoCamera(camera, canvas, V);
const keys = new Keys();
// The pilot on foot (docs/proposal-pilot.md): hold F to hop out (parked in a bay, or anywhere on the sand) and back
// in by the mech; he walks the sand and the convoy's decks, stairs and footbridges (the walkways ride the cars).
const walkable = new Walkable(field);
const ways = new ConvoyWalkways(convoy, walkable, V);
ways.update();
const foot = await OnFoot.create(V, walkable, player, iso, bf, scene);
// Your vitals and repair kits on Q (src/ui/vitalsHud.ts, src/game/repairUse.ts; Keith 2026-10-31).
const vitals = vitalsHud(V);
const kitCtl = new KitControl(player, foot, bf.sfx);
// Abilities on keys 3 and 4 and their heal zones (src/abilities/); a zone on a deck sits on the deck.
player.uid = "player";
const abilityCtl = new AbilityControl(player, foot, scene, (x, z) => walkable.floorBelow(x, z, sim.pelvis.y + 2).y, bf.sfx);
addRepairSounds(bf.sfx, () => V.kitSound);
foot.showHealth = false;
/** Was the crane armed when the pilot got out on the sand (it mustn't come for the empty mech; restored on getting in). */
let armedWhenOut = true;
// The bay screen (src/ui/bay.ts): opened at a bay terminal on foot (E), B anywhere as a lab shortcut.
const BAY_KEY = "pm2:convoy-lab:bay";
// ?drop=rarity[,level] (Keith 2026-10-28): start out on the sand and drop an item of that rarity (and level) ahead of the
// mech, again every few seconds; ?drop=all[,level] drops one of each rarity in turn. A bare ?drop is still the crane's drop.
const itemDrops: { rarity: Rarity; level?: number }[] = (() => {
  const [r, l] = (params.get("drop") ?? "").split(","), level = l ? Number(l) : undefined;
  if (r === "all") return RARITIES.map((rarity) => ({ rarity, level }));
  return (RARITIES as readonly string[]).includes(r) ? [{ rarity: r as Rarity, level }] : [];
})();
let dropT = 1.2, dropK = 0, bankedSeen = 0;
// A fresh bay fits the default mech (Keith 2026-10-30): a minigun on each hull mount, the missile pod on shoulder 1 and
// a belt feed on shoulder 2 (its key overdrives the right gun), the power pack; ?left= ?right= ?k1= ?k2= ?k3= (as in
// the weapons lab) fit those instead.
const kit: Pick = { left: "minigun", right: "minigun", k1: "missiles", k2: "beltfeed", k3: "pack" };
const kitFlagged = pickFromParams(kit, params);
const bayState: BayState = (!params.has("fresh") && loadBay(BAY_KEY)) || { loadout: loadoutFor(kit), stash: newBag(), cargo: newBag(), seed: (Date.now() % 1e9) | 1 };
if (kitFlagged) bayState.loadout = loadoutFor(kit);
// What the convoy has banked and bought comes back from the save; ?unlock=all buys everything, ?bank=N sets the scrap.
loop.unlocks.load(bayState.unlocks);
loop.exp.bank.scrap = bayState.scrap ?? 0;
if (params.get("unlock") === "all") loop.unlocks.unlockAll();
if (params.has("bank")) loop.exp.bank.scrap = Number(params.get("bank")) || 0;
let savedScrap = loop.exp.bank.scrap;
function persist() {
  bayState.scrap = Math.floor(loop.exp.bank.scrap);
  bayState.unlocks = { ...loop.unlocks.levels };
  savedScrap = loop.exp.bank.scrap;
  saveBay(BAY_KEY, bayState);
}
function refit() {
  const r = resolve(bayState.loadout, V);
  bayState.cargo.capacity = r.cargoCapacity;
  applyLoadout(player, r);
  // The sensor's seekers (its radar range already went into V.mechRadar through the loadout's values).
  loop.seeker.setModes(r.seekers);
  persist();
}
refit();
// The pickup card compares with what is fitted.
loop.loot.hud.fitted = () => Object.values(bayState.loadout);
// Tab cycles the sensor's seeker mode (shown on the radar and in the expedition HUD).
addEventListener("keydown", (e) => { if (e.code === "Tab" && !bay.isOpen) { e.preventDefault(); loop.seeker.cycle(); } });
// ?seek=scrap|wreck|rare|legendary: start on that mode if the sensor has it.
for (let i = 0; params.get("seek") && i < loop.seeker.modes.length && loop.seeker.mode !== params.get("seek"); i++) loop.seeker.cycle();
const bay = bayScreen({ state: bayState, tuning: V, onChange: () => { refit(); panel.refresh(); } });
// The convoy's unlock shop: beside the bay screen at the terminal (U shows it on its own). Radar range and crane speed
// scale the sliders' values (kept as `base`, so a slider moved by hand is still the base).
const shop = convoyShop({
  unlocks: loop.unlocks, tuning: V, bank: loop.exp.bank, onChange: () => { applyUnlocks(); persist(); },
  // Repair kits (Keith 2026-10-31): they never refill by themselves; bought here, found in salvage.
  supplies: [{
    label: "Repair kit", tip: "Q in the mech: repairs part of the hull over a moment. On foot, hold Q beside the mech.",
    have: () => player.kits.count, max: () => V.kitMax, price: () => V.kitPrice,
    buy: () => { if (player.kits.count >= V.kitMax || loop.exp.bank.scrap < V.kitPrice) return false; loop.exp.bank.scrap -= V.kitPrice; player.kits.restock(1); return true; },
  }],
});
addEventListener("keydown", (e) => { if (e.code === "KeyU" && !e.repeat) shop.toggle(); });
const UNLOCK_RADAR_KEYS = ["convoyRadar"] as const;
const UNLOCK_CRANE_KEYS = ["craneSlew", "craneSlewAccel", "craneLuff", "craneLuffAccel", "craneHoist", "craneHoistAccel"] as const;
const unlockBase: Record<string, number> = {};
let appliedRadar = 1, appliedCrane = 1;
function applyUnlocks() {
  const rm = loop.unlocks.mul(V, "radar"), cm = loop.unlocks.mul(V, "crane");
  const Vk = V as unknown as Record<string, number>;
  for (const k of UNLOCK_RADAR_KEYS) { unlockBase[k] ??= Vk[k] / appliedRadar; Vk[k] = unlockBase[k] * rm; }
  for (const k of UNLOCK_CRANE_KEYS) { unlockBase[k] ??= Vk[k] / appliedCrane; Vk[k] = unlockBase[k] * cm; }
  appliedRadar = rm; appliedCrane = cm;
  panel?.refresh();
}
const terminals: ReturnType<typeof ways.terminals> = [];
let auto = !params.has("manual") && !params.has("onfoot") && !params.has("pad");
// Left click fires the left side's weapon, right click the right side's (both can be held); keys 1-3 the shoulder
// weapons; only while driving the mech (F is hold to hop out and back in, Keith 2026-10-26).
const buttons = new MouseButtons(canvas, () => { auto = false; });
let deployAsked = false, parkAsked = false;
// E held strips salvage out on the sand (E pressed still parks aboard); X held calls a recovery (Keith 2026-10-31: Q is the repair kit).
let eHeld = false, xHeld = false;
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === "KeyE") { eHeld = true; auto = false; }
  if (e.code === "KeyX") { xHeld = true; auto = false; }
});
addEventListener("keyup", (e) => { if (e.code === "KeyE") eHeld = false; if (e.code === "KeyX") xHeld = false; });
addEventListener("blur", () => { eHeld = false; xHeld = false; });
// Space: dash the way WASD points (Keith 2026-10-25: the dash in every lab), on charges; keep holding to carry on into
// the sprint out on the sand (Keith 2026-10-26).
let dashPressed = false, spaceDown = false;
addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || typing(e)) return;
  e.preventDefault();
  dashPressed = true;
  spaceDown = true;
  auto = false;
});
addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });
addEventListener("blur", () => { spaceDown = false; });
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.repeat) return;
  if (e.code === "KeyG") { deployAsked = true; auto = false; }
  if (e.code === "KeyE") { parkAsked = true; auto = false; }
});

/** Start over: convoy at the origin, mech off to its left (or in the bay). */
function restart() {
  loop.restart(0, 0);
  convoy.reset(0, 0);
  patchQueue.length = 0;
  // ?crest[=metres]: the convoy clock moved on until the blade is that far short of a big dune crest.
  if (params.has("crest")) {
    const short = Number(params.get("crest")) || 18;
    let best = -1, at = 0;
    for (let tries = 0; tries < 30 && best < 260; tries++) {
      for (let s = route.blade + 20; s < route.end - V.bermCarry - 10; s += 2) {
        const c = route.wake.cutAt(s);
        if (c > best) { best = c; at = s; }
      }
      if (best < 260) convoy.jump(route.s + 100);
    }
    convoy.jump(route.s + (at - short - route.blade));
  }
  escorts.reset();
  for (const c of cranes) c.place();
  streamer.rebuildAll();
  const p = convoy.bay, at = p.toWorld(32, 0, V.craneMount + 25);
  carry.state = "walking"; carry.phase = ""; carry.attached = false; carry.armed = true; carry.ground.onDeck = false;
  player.reset(at.x, at.z, p.heading);
  for (const c of cranes) c.calm();
  if (params.has("aboard") || params.has("deploy") || params.has("park")) carry.putAboard(sim);
  if (params.has("deploy")) carry.deploy(sim, 1);
  if (params.has("park")) {
    // Into the left parking bay and settle there.
    const b = deckLayout(p, V).spots[0], w = p.toWorld(b.x, 0, b.z);
    sim.reset(w.x, w.z, p.heading);
    carry.togglePark(sim);
  }
  if (params.has("drop") && !itemDrops.length) carry.dropBeside(sim, 1);
  if (params.has("hang")) {
    // Hanging from the crane out over the sand beside the bay, as if just picked up.
    const w = p.toWorld(16, 0, V.craneMount + 6);
    player.reset(w.x, w.z, p.heading);
    carry.grab(sim);
  }
  // Expedition starts: out in the field (?out, ?far), short of fuel, with scrap at risk.
  if (params.has("out") || params.has("far") || params.has("lowfuel") || params.has("depth") || params.has("quest") || itemDrops.length) {
    const side = params.has("depth") ? Number(params.get("depth")) || 1000 : params.has("far") ? 850 : 280, ahead = params.has("far") ? 120 : 60;
    const w = p.toWorld(side, 0, ahead);
    player.reset(w.x, w.z, p.heading + Math.PI / 2);
    carry.armed = true;
  }
  // ?pad[=metres]: out on the sand that close to the nearest extraction pad (pickups bought), loot at risk.
  if (params.has("pad")) {
    const pd = loop.pads.nearest(p.x, p.z, 6000);
    if (pd) {
      const near = Number(params.get("pad")) || 60, d = Math.hypot(pd.x - p.x, pd.z - p.z) || 1;
      const px = pd.x + ((p.x - pd.x) / d) * near, pz = pd.z + ((p.z - pd.z) / d) * near;
      player.reset(px, pz, Math.atan2(pd.x - px, pd.z - pz));
      carry.armed = true;
      if (!loop.unlocks.has("pickup")) { loop.unlocks.levels.pickup = 1; loop.unlocks.rev++; }
    }
  }
  // ?nearcamp: out on the sand just outside the wake range of the nearest swarm camp, facing it.
  if (params.has("nearcamp")) {
    const c = loop.camps.campsNear(p.x, p.z, 2500).filter((q) => route.corridor(q.x, q.z) <= 0)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (c) {
      const d = Math.hypot(c.x - p.x, c.z - p.z) || 1, back = Number(params.get("nearcamp")) || V.campWake + 15;
      const x = c.x - ((c.x - p.x) / d) * back, z = c.z - ((c.z - p.z) / d) * back;
      player.reset(x, z, Math.atan2(c.x - x, c.z - z));
      carry.armed = true;
    }
  }
  // ?banditcamp: out on the sand just outside the wake range of the nearest bandit camp, facing it.
  // ?clash: the same, further back, with a robot pack walking into the camp (neither side in view yet).
  if (params.has("banditcamp") || params.has("clash")) {
    const c = loop.bandits.campsNear(p.x, p.z, 3000).filter((q) => route.corridor(q.x, q.z) <= 0)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (c) {
      const clash = params.has("clash");
      const d = Math.hypot(c.x - p.x, c.z - p.z) || 1, back = clash ? 330 : Number(params.get("banditcamp")) || V.banditWake + 15;
      const x = c.x - ((c.x - p.x) / d) * back, z = c.z - ((c.z - p.z) / d) * back;
      player.reset(x, z, Math.atan2(c.x - x, c.z - z));
      carry.armed = true;
      if (clash) {
        // The pack starts beside the camp's far side, so the two meet well out of view.
        const px = c.x + ((c.x - x) / back) * 70, pz = c.z + ((c.z - z) / back) * 70;
        loop.threats.spawnPack(px, pz, 14, { x: c.x, z: c.z });
      }
    }
  }
  // ?fortress[=metres] / ?hub[=metres]: out on the sand that far (150 m by default) from the nearest bandit fortress or
  // manufacturing hub, facing it.
  for (const kind of ["fortress", "hub"] as const) {
    if (!params.has(kind)) continue;
    const R = 9000;
    const f = loop.sites.poisIn(p.x - R, p.z - R, p.x + R, p.z + R).filter((q) => q.kind === kind)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!f) { console.warn(`no ${kind} within ${R} m`); continue; }
    const d = Math.hypot(f.x - p.x, f.z - p.z) || 1, back = Number(params.get(kind)) || 150;
    const x = f.x - ((f.x - p.x) / d) * back, z = f.z - ((f.z - p.z) / d) * back;
    player.reset(x, z, Math.atan2(f.x - x, f.z - z));
    carry.armed = true;
  }
  // ?warband[=N]: a war band column (N vehicles, 6 by default: with a party bus and a turret truck at the back)
  // hunting the mech from a few hundred metres off.
  if (params.has("warband")) {
    const m = sim.pos, ang = p.heading;
    const x = m.x + Math.sin(ang) * 260, z = m.z + Math.cos(ang) * 260;
    loop.columns.place(x, z, Math.max(1, Number(params.get("warband")) || 6), m.x, m.z, 0.7);
    carry.armed = true;
  }
  // ?hvt[=metres|now]: out on the sand that close (60 m) to the nearest high value target's lair, one kill short of
  // drawing it out (now: it's already coming).
  if (params.has("hvt")) {
    const q = loop.quests, arg = params.get("hvt") ?? "";
    const lairs = [
      ...loop.camps.campsNear(p.x, p.z, 4000).map((c) => q.lairs.at({ id: c.id, x: c.x, z: c.z, faction: "robot" })),
      ...loop.bandits.campsNear(p.x, p.z, 4000).map((c) => q.lairs.at({ id: c.id, x: c.x, z: c.z, faction: "bandit" })),
    ].filter((l) => !!l && route.corridor(l.x, l.z) <= 0).sort((a, b) => Math.hypot(a!.x - p.x, a!.z - p.z) - Math.hypot(b!.x - p.x, b!.z - p.z));
    const l = lairs[0];
    if (l) {
      const back = Number(arg) || 60, d = Math.hypot(l.x - p.x, l.z - p.z) || 1;
      const x = l.x - ((l.x - p.x) / d) * back, z = l.z - ((l.z - p.z) / d) * back;
      player.reset(x, z, Math.atan2(l.x - x, l.z - z));
      carry.armed = true;
      l.kills = Math.max(0, l.need - 1);
      hvtNow = arg === "now" ? l : null;
      hvtLair = l;
    }
  }
  loop.exp.launch();
  if (hvtNow) { loop.quests.killed(hvtNow.cull, hvtNow.x, hvtNow.z); hvtNow = null; }
  // ?hvt with ?quest=bounty: the bounty is on that lair.
  // ?quest=salvage|cull|bounty|tow|pods: that contract taken at the start (out on the sand).
  const questKind = params.get("quest");
  if (questKind && (QUEST_FLAGS as string[]).includes(questKind)) loop.quests.force(questKind as (typeof QUEST_FLAGS)[number], true, hvtLair);
  hvtLair = null;
  if (["out", "far", "lowfuel", "nearcamp", "depth", "banditcamp", "clash", "warband", "pad", "fortress", "hub"].some((f) => params.has(f))) loop.exp.add({ kind: "scrap", amount: 34, label: "Debris field" });
  if (params.has("pad")) loop.exp.add({ kind: "scrap", amount: Number(params.get("loot")) || 400, label: "Supply pod" });
  if (params.has("loot")) loop.exp.add({ kind: "scrap", amount: Number(params.get("loot")) || 50, label: "Supply pod" });
  // ?items=N: N random items at risk (for the banking count-in and the loss).
  for (let k = 0; k < (Number(params.get("items")) || 0); k++) { const it = rollLoot(9001 + k * 7919, V, undefined, 1 + (k % 4) * 3); loop.exp.add({ kind: "item", item: it, label: itemName(it) }); }
  // ?lowfuel turns fuel on (it is off by default, Keith 2026-11-01) and leaves little in the pack.
  if (params.has("lowfuel")) { V.fuelOn = 1; loop.fuel.left = Number(params.get("lowfuel")) || 150; }
  if (carry.state !== "walking") loop.exp.state = "aboard";
  foot.reset();
  // ?onfoot: on foot beside the mech: parked in the left bay (unless a flag put the mech out on the sand).
  if (params.has("onfoot")) {
    const inField = ["out", "far", "lowfuel", "nearcamp", "field", "depth", "banditcamp", "clash", "warband", "pad", "fortress", "hub", "quest", "hvt"].some((f) => params.has(f));
    if (inField) { armedWhenOut = true; carry.armed = false; }
    else {
      if (!carry.onDeck) carry.putAboard(sim);
      loop.exp.state = "aboard";
      const b = deckLayout(p, V).spots[0], w = p.toWorld(b.x, 0, b.z);
      sim.reset(w.x, w.z, p.heading);
      carry.togglePark(sim);
    }
    ways.update();
    foot.startOut();
    // ?pilotat=N,x,z: on car N at local (x, z); ?pilotat=bN,t: on footbridge N, share t of the way across.
    const at = (params.get("pilotat") ?? "").split(",").map((s) => s.trim());
    if (at[0]?.startsWith("b")) {
      const s = ways.spans[Number(at[0].slice(1)) || 0], t = Number(at[1] ?? 0.5);
      if (s) foot.sim.place(s.a.x + (s.b.x - s.a.x) * t, s.a.y + (s.b.y - s.a.y) * t + 0.1, s.a.z + (s.b.z - s.a.z) * t, Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z));
    } else if (at.length === 3) {
      const q = convoy.platforms[Number(at[0])] ?? p, w = platformFrame(q).toWorld(Number(at[1]), Number(at[2]), { x: 0, z: 0 });
      foot.sim.place(w.x, deckPlane(q, w.x, w.z) + 3.2, w.z, q.heading + Math.PI);
    }
  }
  if (params.has("bay")) bay.open();
}

const roadKeys = new Set(["routeHalfWidth", "trainLanes", "trainLaneSide", "routeBlend", "routeLift", "routeRough", ...WAKE_PARAMS.filter((p) => p.onRelease).map((p) => p.key)]);
const shapeKeys = new Set([...TERRAIN_PARAMS.map((p) => p.key), "chunkSize", "segments"]);
let selector: Selector | null = null;
let picking = false;
const panel = tweakPanel({
  id: "convoy-lab",
  title: "Convoy",
  params: PARAMS,
  values: V,
  defaults: DEFAULTS,
  actions: [
    { label: "Demo", onClick: () => { auto = !auto; }, active: () => auto },
    { label: "Launch (G)", onClick: () => { deployAsked = true; auto = false; } },
    { label: "Park (E)", onClick: () => { parkAsked = true; auto = false; } },
    { label: "Bay (B)", onClick: () => (bay.isOpen ? bay.close() : bay.open()), active: () => bay.isOpen },
    { label: "Restart", onClick: () => restart() },
  ],
  topics: [
    PILOT_TOPIC,
    { id: "health", label: "Health and repair", groups: ["Mech health", "Repair kits", "Health HUD"] },
    ABILITY_TOPIC,
    { id: "loadout", label: "Loadout", groups: ["Loot rolls", "Bare mech"] },
    { id: "convoy", label: "Convoy", groups: ["Convoy route", "Train", "Footbridges", "Platforms"] },
    { id: "tracks", label: "Tracks and trail", groups: ["Tracks", "Convoy trail", "Ground dents"] },
    { id: "pipes", label: "Pipes", groups: ["Pipes"] },
    { id: "escorts", label: "Escorts", groups: ["Escorts", "Escort driving", "Convoy trail"] },
    { id: "defence", label: "Defences", groups: ["Defences"] },
    { id: "cranes", label: "Cranes", groups: ["Crane", "Crane motion", "Crane swing", "Pick-up and launch", "Drop-off"] },
    { id: "deck", label: "Deck", groups: ["Deck", "Walk off"] },
    { id: "plough", label: "Plough and wake", groups: ["Plough", "Wake", "Plough sand", "Road"] },
    { id: "road", label: "Road", groups: ["Road", "Dunes", "Shape", "Sand surface", "Ground dents", "Ground dents: surfaces", "Streaming"] },
    { id: "mech", label: "Your mech", groups: ["Targeting", "Rounds", "Dash", "Trample", "Sprint kit", "Mech health", "Torso & guns", "Sensor head", "Minigun", "Move"] },
    { ...WEAPON_TOPIC, groups: [...WEAPON_TOPIC.groups, "Protocols"] },
    { id: "legs", label: "Legs", groups: ["Move", "Sprint", "Gait", "Idle", "Air", "Landing", "Legs", "Feet", "Feet sink", "Terrain"] },
    { id: "hits", label: "Hits and dust", groups: ["Minigun hits", "Minigun FX", "Effects", "Dust", "Dust: look", "Dust: sources", "Dust: surfaces", "Convoy trail", "Ground dents", "Sound"] },
    { id: "light", label: "Light", groups: [...LIGHT_GROUPS, "Cel look"] },
    { id: "camera", label: "Camera", groups: ["Camera"] },
    { id: "perf", label: "Performance", groups: ["Performance"] },
    ...LOOP_TOPICS,
  ],
  onFocus: () => { if (!picking) selector?.clear(); },
  onChange: (k) => {
    // A slider the unlocks scale: what was set is the new base (the shown value stays base × the unlock's step).
    if ((UNLOCK_RADAR_KEYS as readonly string[]).includes(k)) unlockBase[k] = (V as unknown as Record<string, number>)[k] / appliedRadar;
    if ((UNLOCK_CRANE_KEYS as readonly string[]).includes(k)) unlockBase[k] = (V as unknown as Record<string, number>)[k] / appliedCrane;
    if (shapeKeys.has(k)) { field.update(); route.wake.clear(); streamer.rebuildAll(); }
    // The road reindexes itself (and works its berms out again) on its next step; the chunks need building again.
    if (roadKeys.has(k)) { route.wake.clear(); streamer.rebuildAll(); }
    // POI placement and the dunes under it: placed again (pads rebuilt with the chunks); camps placed again.
    if (shapeKeys.has(k) || POI_PARAMS.some((p) => p.key === k) || SITE_PARAMS.some((p) => p.key === k)) { loop.rebuild("sites"); streamer.rebuildAll(); }
    if (CAMP_PARAMS.some((p) => p.key === k) || BANDIT_PARAMS.some((p) => p.key === k) || COLUMN_PARAMS.some((p) => p.key === k) || FACTION_PARAMS.some((p) => p.key === k)) loop.rebuild("camps");
  },
});
applyUnlocks();
const regions = body.regions();
selector = new Selector(app, {
  items: [
    { topic: "pilot", label: "Pilot", objects: () => foot.body.meshes() },
    { topic: "pilot", label: "Bay terminal", objects: () => bodies.flatMap((b) => b.terminalMeshes()) },
    { topic: "light", label: "Night lamps", objects: () => look.lights.selectables() },
    { topic: "pois", label: "POIs", objects: () => loop.sites.meshes() },
    { topic: "extraction", label: "Extraction pads", objects: () => loop.padDraw.objects() },
    { topic: "quests", label: "Contracts: beacons, hulk, pods", objects: () => (loop.quests.draw ? loop.quests.draw.group.children : []) },
    { topic: "quests", label: "High value target", objects: () => loop.quests.hvt.objects() },
    { topic: "loot", label: "Loot drops", objects: () => [loop.loot.draw.group, loop.loot.clumps.group] },
    { topic: "pois", label: "Salvage spots", objects: () => loop.sites.fx.objects() },
    { topic: "swarms", label: "Robots", objects: () => loop.swarms.draw.group.children },
    { topic: "raiders", label: "Bandits", objects: () => loop.banditCamps.draw.group.children },
    { topic: "raiders", label: "War band", objects: () => loop.bands.group.children },
    { topic: "fortress", label: "Fortress gates", objects: () => loop.forts.gatesDraw.meshes() },
    { topic: "fortress", label: "Hub fabricators", objects: () => loop.hubs.draw.meshes() },
    { topic: "fortress", label: "Fortress garrison", objects: () => loop.forts.draw.group.children },
    { topic: "defence", label: "Turrets", objects: () => defenceBody.objects() },
    { topic: "cranes", label: "Cranes", objects: () => craneBodies.flatMap((c) => c.meshes()) },
    { topic: "deck", label: "Deck: parking bays and launch pads", objects: () => bodies.flatMap((b) => b.deckMeshes()) },
    { topic: "tracks", label: "Crawler tracks", objects: () => bodies.flatMap((b) => b.trackMeshes()) },
    { topic: "pipes", label: "Pipes", objects: () => bodies.flatMap((b) => b.pipeMeshes()) },
    { topic: "convoy", label: "Footbridges", objects: () => [...bridges.objects(), ...bodies.flatMap((b) => b.landingMeshes())] },
    { topic: "escorts", label: "Escorts and vehicles aboard", objects: () => [...escortBodies.objects(), ...bodies.flatMap((b) => b.vehicleMeshes())] },
    { topic: "convoy", label: "Convoy platforms", objects: () => bodies.flatMap((b) => b.meshes()) },
    { topic: "plough", label: "Plough", objects: () => ploughBody.meshes() },
    { topic: "legs", label: "Legs", objects: () => regions.legs },
    { topic: "weapons", label: "Weapons", objects: () => arsenal.meshes() },
    { topic: "mech", label: "Your mech", objects: () => [...regions.hull, ...regions.gunLeft, ...regions.gunRight] },
    { topic: "mech", label: "Sensor head", objects: () => regions.sensor },
  ],
  ground: { topic: "road", label: "Road and dunes", field },
  sky: { topic: "light", label: "Light and sky" },
  onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
});
const sel = selector;
installReport(app, "convoy", V, () => ({ selected: sel.selection, topic: panel.focused, mech: carry.label, pilot: `${foot.mount.state}${foot.sim.alive ? "" : " (dead)"} on ${foot.sim.on?.name ?? "the sand"}`, crane: carry.phase, convoyS: Math.round(route.s), expedition: loop.exp.state, fuel: Math.round(loop.fuel.left), home: Math.round(loop.home.eta), atRisk: loop.exp.scrapAtRisk, banked: loop.exp.bank.scrap }));
Object.assign(V, body.legValues());
panel.refresh();

const softAim = new SoftAim(scene, camera, canvas, field);

field.update();
restart();
/** What the camera follows: the mech, or (?watch=) a car, the gap ahead of a car, or an escort. */
const watch = params.get("watch");
function focus(out: THREE.Vector3) {
  if (watch === "plough") {
    const w = convoy.plough.toWorld(0, 0, PLOUGH_BASE_LENGTH / 2 + BLADE_AHEAD);
    return out.set(w.x, field.height(w.x, w.z), w.z);
  }
  const m = watch?.match(/^(gap|e)?(\d+)$/);
  if (m) {
    const i = Number(m[2]);
    if (m[1] === "e" && escorts.list[i]) return out.copy(escorts.list[i].sim.pos);
    const p = convoy.platforms[Math.min(i, convoy.platforms.length - 1)];
    if (m[1] === "gap" && p.follows >= 0) {
      const q = convoy.platforms[p.follows], a = q.toWorld(0, 0, -q.spec.length / 2), b = p.toWorld(0, 0, p.spec.length / 2);
      return out.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    }
    return out.set(p.x, p.y + p.deck, p.z);
  }
  return foot.focus(out) ?? out.set(sim.pelvis.x, sim.pelvis.y - 1.2, sim.pelvis.z);
}
const follow = focus(new THREE.Vector3());
iso.snap(follow);
if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
const stick = new THREE.Vector3(), shoulder = new THREE.Vector3();
let clock = 0;

// Demo: walk in beside the bay, picked up, walk to a parking bay and park, stand, walk to a launch pad (sides
// alternate), launched, walk off out of range, come back.
const walkOffDemo = params.has("walkoff") ? (params.get("walkoff") || "walk") : null;
const demo = { stage: "park" as "park" | "launch", wait: 0, awayFor: 0, leaving: false, side: 1 as 1 | -1 };
function demoCmd(dt: number): MoveCommand {
  const p = carry.platform, still = { x: 0, z: 0, sprint: false };
  const spots = deckLayout(p, V).spots;
  if (carry.state === "aboard" || carry.state === "parked" || carry.state === "launching") {
    if (carry.state === "parked") {
      demo.wait += dt;
      if (demo.wait > 5 && carry.phase === "settle") { carry.togglePark(sim); demo.stage = "launch"; }
      return still;
    }
    if (carry.state === "launching") return still;
    if (demo.stage === "park") {
      const b = spots.find((s) => s.kind === "park" && Math.sign(s.x) === demo.side)!;
      const c = walkToSpot(sim, p, b.x, b.z, 0.5);
      if (c.x === 0 && c.z === 0) { demo.wait += dt; if (demo.wait > 0.8 && carry.togglePark(sim)) demo.wait = 0; }
      return c;
    }
    // ?walkoff: straight off the side at a walk (?walkoff=dash: dashing off) instead of the crane's launch pad.
    if (walkOffDemo) {
      const c = { x: p.left.x * demo.side, z: p.left.z * demo.side, sprint: false };
      if (walkOffDemo === "dash" && Math.abs(p.toLocal(sim.pos.x, sim.pos.z).x) > 3) player.tryDash(c.x, c.z);
      return c;
    }
    const pad = spots.find((s) => s.kind === "launch" && s.side === demo.side)!;
    return walkToSpot(sim, p, pad.x, pad.z, 0.5);
  }
  if (carry.state === "landing") { demo.leaving = true; demo.stage = "park"; demo.wait = 0; }
  if (carry.state === "walking" && demo.leaving) {
    // Out on an expedition: to the nearest POI ahead, strip a couple of spots, then home.
    const f = loop.demoField();
    if (f) return f;
    if (carry.armed && loop.exp.state === "out") { demo.leaving = false; demo.side = -demo.side as 1 | -1; }
    // Nothing to strip: off to the side and ahead a little, until out of range for a few seconds.
    if (carry.armed) demo.awayFor += dt;
    if (demo.awayFor > 5) { demo.awayFor = 0; demo.leaving = false; demo.side = -demo.side as 1 | -1; }
    const l = p.toLocal(sim.pos.x, sim.pos.z), s = Math.sign(l.x) || 1;
    return { x: p.left.x * s + p.fwd.x * 0.8, z: p.left.z * s + p.fwd.z * 0.8, sprint: true };
  }
  if (carry.state === "lifting") return still;
  // Far out: for the return point first.
  const home = loop.demoHome();
  if (home) return home;
  // Walk to a spot beside the crane, keeping up with the convoy.
  const l = p.toLocal(sim.pos.x, sim.pos.z), s = Math.sign(l.x) || 1;
  const at = p.toWorld(s * 15, 0, carry.crane.mount + 4 * p.craneEnd);
  const dx = at.x - sim.pos.x, dz = at.z - sim.pos.z, d = Math.hypot(dx, dz);
  if (d < 2) return { x: p.fwd.x * (p.speed / V.walkSpeed), z: p.fwd.z * (p.speed / V.walkSpeed), sprint: false };
  return { x: dx / d, z: dz / d, sprint: d > 12 };
}

const costs = new Costs();
bf.costs = costs;
// For shots: ?bigclose[=metres] puts an excavator that far ahead of the mech with the cursor held on one of its
// buckets and both guns firing (the lock should take its chassis); ?raid sends a raid at once.
const bigClose = params.has("bigclose");
if (bigClose) {
  const h = sim.heading, d = Number(params.get("bigclose")) || 8;
  loop.swarms.addGroup("test:big", 1, sim.pos.x + Math.sin(h) * d, sim.pos.z + Math.cos(h) * d, { mid: 0, big: 1 });
}
if (params.has("raid")) loop.threats.raidNow = true;
const footPt = new THREE.Vector3();
function holdOnBucket() {
  const sw = loop.swarms.sw;
  for (let i = 0; i < sw.hi; i++) {
    if (sw.kind[i] !== BIG || sw.state[i] >= DOWN) continue;
    const r = canvas.getBoundingClientRect(), f = i * WALK_LEGS + 1;
    footPt.set(sw.footX[f], sw.footY[f], sw.footZ[f]).project(camera);
    buttons.mouse = { x: r.left + (footPt.x + 1) / 2 * r.width, y: r.top + (1 - footPt.y) / 2 * r.height };
    buttons.left = buttons.right = true;
    return;
  }
}

const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
/** ?holdf=seconds: F held from the start (headless shots of getting out). */
const holdF = Number(params.get("holdf") ?? 0);
app.onTick((rawDt) => {
  if (bigClose) holdOnBucket();
  const dt = fixedDt || rawDt;
  clock += dt;
  costs.begin();
  bf.register.rebuild();
  costs.mark("register");
  keys.move(camera, stick);
  if (keys.has("KeyR")) player.upper.resupply();
  const fHeld = keys.has("KeyF") || clock < holdF;
  if (stick.lengthSq() > 0 || fHeld) auto = false;
  let cmd: MoveCommand = { x: 0, z: 0, sprint: false };
  let aim: Aim | null = null, cursor: Aim | null = null, shotAt: Aim | null = null;
  let trigger: Trigger = false;
  let lock: Lock | null = null;
  // Shoulder weapon keys 1-4: hold to paint, release to fire.
  let held: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  // Out of the mech (getting out, on foot, getting in): WASD walks the pilot; the mech stands where it was left and
  // its weapons don't fire.
  const driving = foot.driving;
  player.piloted = driving;
  if (auto) { cmd = demoCmd(dt); aim = cursor = loop.demoAim; trigger = loop.demoTrigger; }
  else if (driving) {
    if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
    // Soft lock as in the combat labs: the enemy under the cursor (a tall walker by its body, or the sand among its
    // feet), else the one nearest the line of fire; led by its motion, the rounds straight at it.
    ({ cursor, aim, shotAt, lock } = softAim.pick(buttons.mouse, bf.register, enemies, sim.pos, V));
    trigger = [buttons.left, buttons.right];
    held = [keys.has("Digit1"), keys.has("Digit2"), keys.has("Digit3"), keys.has("Digit4")];
  }
  // Weapons work only out on the sand (not on the deck, hanging or parked).
  // Clamped in the pickup's cradle: no driving, no guns.
  if (loop.padCall.clamped) { cmd = { x: 0, z: 0, sprint: false }; trigger = false; }
  // Towing a hulk (src/quests/tow.ts): slower, no sprint, no dash.
  if (loop.quests.noSprint) { const k = loop.quests.moveScale; cmd = { x: cmd.x * k, z: cmd.z * k, sprint: false }; dashPressed = false; }
  if (sel.active || (carry.state !== "walking" && carry.state !== "inRange")) { trigger = false; held = [false, false, false, false]; }
  player.keys = held;
  player.cursor = cursor ? (player.cursor ?? new THREE.Vector3()).set(cursor.x, field.height(cursor.x, cursor.z), cursor.z) : null;
  player.lock = lock?.target ?? null;
  if (deployAsked) {
    deployAsked = false;
    // Over the side the aim is on (left if no aim).
    const p = convoy.bay;
    const side = aim ? (p.toLocal(aim.x, aim.z).x >= 0 ? 1 : -1) : 1;
    if (driving) carry.deploy(sim, side);
  }
  // E: parks or stands the mech while driving; on foot, uses a bay terminal within reach.
  ways.terminals(terminals);
  const fp = foot.sim.pos;
  const term = foot.walking ? terminals.find((t) => Math.hypot(t.x - fp.x, t.z - fp.z) < V.pilotTerminalReach && Math.abs(t.y - fp.y) < 1.5) : undefined;
  if (parkAsked) {
    parkAsked = false;
    if (driving) carry.togglePark(sim);
    else if (term) { if (bay.isOpen) bay.close(); else bay.open(); }
  }
  // Holding F: where may the pilot get out? On the sand anywhere; aboard, only parked in a bay (F there parks it first).
  const onSandNow = carry.state === "walking" || carry.state === "inRange";
  const aboardNow = carry.state === "aboard" || carry.state === "parked";
  let blockOut: string | null = null;
  if (carry.state === "aboard") blockOut = carry.spot?.kind === "park" ? null : "walk into a parking bay first";
  else if (carry.state === "parked") blockOut = carry.phase === "rise" ? "the mech is standing up" : null;
  else if (!onSandNow) blockOut = carry.state === "landing" ? "keep pace first" : "the crane has the mech";
  else if (player.dash.active) blockOut = "mid-dash";
  else if (player.bound.on) blockOut = "mid-sprint";

  // Convoy, crane and carry at 120 Hz; the walker steps once for the frame (it substeps itself) unless held.
  const sub = Math.max(1, Math.ceil(dt * 120));
  let out: MoveCommand | null = cmd;
  // Escorts steer round the mech when it's on the sand (not on the deck or hanging from the crane).
  const mechOnSand = carry.ground.onDeck || carry.attached ? null : sim.pos;
  for (let i = 0; i < sub; i++) {
    convoy.update(dt / sub);
    out = carry.update(dt / sub, sim, cmd);
    costs.mark("convoy");
    // The pilot rides and walks the walkways as they are after this step's move.
    ways.update();
    foot.walk(dt / sub, stick, keys.sprint, ways.pushOut.bind(ways));
    costs.mark("pilot");
    escorts.update(dt / sub, mechOnSand);
    costs.mark("escorts");
    for (const e of escorts.list) trail.car(e, e.sim, e.moved, e.kind === "technical" ? 0.45 : 0.6);
    costs.mark("trail");
  }
  trail.update(convoy.platforms);
  costs.mark("trail");
  // ?threat: a marker circling the train 45 m out, for the turrets to track.
  if (threatOn) {
    const mid = convoy.platforms[Math.floor(convoy.platforms.length / 2)], a = clock * 0.15;
    threatMark.position.set(mid.x + Math.sin(a) * 60, mid.y + 6, mid.z + Math.cos(a) * 60);
    defence.target([threatMark.position]);
  } else defence.target(loop.turretThreats());
  defence.update(dt);
  costs.mark("turrets");
  // A mech walking on the deck rides it: the platform's motion this frame first, then its own step, kept on the deck.
  carry.ride(sim);
  if (out) {
    // Dash only while the mech walks free (on the sand or the deck), not hanging, parked, falling or in the forced follow.
    const free = driving && (carry.state === "walking" || carry.state === "inRange" || carry.state === "pickup" || carry.state === "aboard" || carry.state === "launching");
    if (dashPressed && free) {
      // With no keys held, dash the way the legs face.
      if (stick.lengthSq() > 0.01) player.tryDash(stick.x, stick.z);
      else player.tryDash(Math.sin(sim.heading), Math.cos(sim.heading));
    }
    // The sprint on the sand, and on the deck when its sides are open (Keith 2026-10-31: sprint off the side); the crane's
    // states keep the mech at a walk.
    player.dashHold = spaceDown && !auto && free && !loop.quests.noSprint && (carry.state === "walking" || carry.state === "inRange" || (carry.state === "aboard" && V.deckOpenSides > 0.5));
    player.step(dt, out, aim, trigger, shotAt ?? aim);
    carry.keep(sim);
    // (Not while falling: a mech that walked off a side starts inside the footprint and flies clear of it by itself.)
    if (!carry.ground.onDeck && carry.state !== "falling" && V.convoyPush > 0.5) {
      for (const p of convoy.platforms) { const o = p.pushOut(sim.pos.x, sim.pos.z, MECH_PUSH_R); if (o) { sim.pos.x = o.x; sim.pos.z = o.z; } }
      const o = convoy.plough.pushOut(sim.pos.x, sim.pos.z, MECH_PUSH_R);
      if (o) { sim.pos.x = o.x; sim.pos.z = o.z; }
    }
  } else {
    // Held by the crane or parked: the guns still track the aim, the body is posed from the hold.
    body.shoulderLine(shoulder);
    player.upper.update(dt, sim.heading, shoulder, aim, false);
    body.update(sim, player.upper);
  }

  dashPressed = false;
  costs.mark("mech");

  // Getting out and in: the mount, the field kneel or the bay's park, the crane kept off an empty mech on the sand.
  const kitPrompt = kitCtl.update(dt, keys.has("KeyQ") && !bay.isOpen, auto);
  abilityCtl.update(dt, keys.has("Digit3") && !bay.isOpen, keys.has("Digit4") && !bay.isOpen, auto);
  const termPrompt = term ? `Press <b>E</b>: bay terminal (fit parts, stash)${bay.isOpen ? " · open" : ""}` : "";
  const prompt = [termPrompt, kitPrompt].filter(Boolean).join("<br>");
  foot.update(dt, { hold: fHeld && !auto, stick, run: keys.sprint, blockOut, knelt: aboardNow ? carry.settled : undefined, prompt, walkHere: false, pushOut: ways.pushOut.bind(ways) });
  if (foot.event === "kneel" && carry.state === "aboard") carry.togglePark(sim);
  if (foot.event === "kneel" && onSandNow) armedWhenOut = carry.armed;
  if (foot.event === "in") {
    if (carry.state === "parked" && carry.phase === "settle") carry.togglePark(sim);
    if (carry.state === "walking") carry.armed = armedWhenOut;
  }
  if (!foot.driving && onSandNow) { carry.armed = false; if (carry.state === "inRange") carry.state = "walking"; }
  // Killed where no expedition ends it (aboard): back in the cockpit after a moment.
  if (!foot.sim.alive && foot.deadFor > 3 && loop.exp.state !== "lost") homeAboard();
  costs.mark("pilot");
  for (const b of bodies) b.update();
  for (const c of craneBodies) c.update();
  spans = bridgeSpans(convoy.platforms, V, spans);
  bridges.update(spans, dt);
  escortBodies.update();
  defenceBody.update();
  ploughBody.update();
  ploughFx.update(dt);
  costs.mark("convoy bodies");
  // The ground behind the plough's blade, patched in place under a small budget.
  patchSome(1.5);
  costs.mark("plough patch");

  softAim.draw(driving ? cursor : null, lock?.target ?? null, player.upper.onTarget && !player.gunsOff);
  reloadHud.update(buttons.mouse, player.upper, driving && player.alive);
  healthBars.update(rawDt);

  follow.lerp(focus(new THREE.Vector3()), Math.min(1, rawDt * 6));
  // Out on the sand the camera leads the mech at speed (the sprint).
  iso.update(follow, rawDt, driving && (carry.state === "walking" || carry.state === "inRange") ? { x: sim.vel.x + sim.skid.x, z: sim.vel.z + sim.skid.z } : undefined);
  shaker.apply(camera, rawDt, V.shakeDecay);
  toon.update(camera, canvas.clientHeight);
  costs.mark("camera");
  streamer.update(follow.x, follow.z);
  costs.mark("ground");
  const camDist = camera.position.distanceTo(follow);
  look.update(follow, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40), dt);
  costs.mark("light");
  bf.update(dt, camera, look);
  arsenalDraw.update();
  app.hud.set("weapons", () => arsenal.controls().join(" · "));
  // The expedition: POIs and salvage, swarm camps (the robot sim), fuel, the way home, the radar and its HUD.
  loop.update(dt, {
    eHeld, recallHeld: xHeld, jHeld: keys.has("KeyJ"), demo: auto, mark: (st) => costs.mark(st), canvas, night: look.night,
    pilot: foot.mount.onFoot ? {
      onFoot: true, alive: foot.sim.alive, x: fp.x, z: fp.z, prey: (x, z) => foot.quarry.pick(x, z), notice: V.pilotNotice,
      reach: V.pilotReach, rate: V.pilotStripRate, noise: V.pilotStripNoise,
    } : undefined,
  });
  app.hud.set("expedition", () => loop.line + ` · pads ${loop.pads.near(sim.pelvis.x, sim.pelvis.z, 3000).length} within 3 km, pickup ${loop.padCall.state}, bank ${Math.floor(loop.exp.bank.scrap)}, unlocks ${Object.entries(loop.unlocks.levels).map(([k, n]) => k + n).join(" ") || "none"}`);
  app.hud.set("contracts", loop.quests.line);
  // The shop shows with the bay screen; the bank moving (banked, a fee) redraws it and is saved.
  shop.sync(bay.isOpen);
  if (loop.exp.bank.scrap !== savedScrap) { persist(); shop.refresh(); }
  // Banked items go into the bay stash; ?drop drops its items ahead of the mech while out.
  for (; bankedSeen < loop.exp.bank.items.length; bankedSeen++) { addTo(bayState.stash, loop.exp.bank.items[bankedSeen]); saveBay(BAY_KEY, bayState); }
  if (itemDrops.length && loop.exp.state === "out" && (dropT -= dt) <= 0) {
    const d = itemDrops[dropK++ % itemDrops.length];
    loop.loot.force(d.rarity, sim.pelvis.x, sim.pelvis.z, sim.heading, d.level);
    dropT = d.rarity === "legendary" ? 4 : 2.5;
  }
  costs.end(app.hud);

  const p = convoy.bay;
  app.hud.set("convoy", () => `convoy ${p.speed.toFixed(1)} m/s heading ${((p.heading * 180) / Math.PI).toFixed(0)}° · ${convoy.platforms.length} cars over ${convoy.length.toFixed(0)} m · ${spans.length} footbridges · ${escorts.list.length} escorts · pipe runs ${bodies.reduce((a, b) => a + b.pipeRuns, 0)} · ruts ${trail.ruts} · road ${route.count} points · ground chunks pending ${streamer.stats.pending}`);
  const pl = convoy.plough;
  app.hud.set("plough", () => `plough: cut ${pl.cut.toFixed(0)} m² at the blade · moving ${pl.rate.left.toFixed(0)} / ${pl.rate.right.toFixed(0)} m³/s left / right (load ${(ploughFx.load[0] * 100).toFixed(0)}% / ${(ploughFx.load[1] * 100).toFixed(0)}%) · patched ${patchVerts} vertices in ${patchMs.toFixed(2)} ms, ${patchQueue.length} boxes waiting · wake stations ${route.wake.computed}`);
  app.hud.set("pilot", foot.driving ? "" : `pilot: ${foot.mount.state}${foot.sim.alive ? "" : " (killed)"} · health ${Math.round(foot.sim.health)}/${V.pilotHealth}${foot.mount.onFoot ? ` · on ${foot.sim.on?.name ?? "the sand"} · ${foot.toMech.toFixed(1)} m from the mech (F within ${V.pilotRange})` : ""}`);
  app.hud.set("mech", () => `mech: ${carry.label}${carry.state === "inRange" ? ` (${Math.max(0, V.craneDwell - carry.timer).toFixed(1)} s)` : ""} · ${carry.distance(sim).toFixed(0)} m from the crane (range ${V.craneRange})${auto ? " · demo" : ""}`);
  energyHud().update(player.dash, foot.driving);
  vitals.update(dt, { ...kitCtl.view(), abilities: abilityCtl.view(), healing: abilityCtl.healing(foot.driving ? player.uid : "pilot") }, player.hits, camera, sim.pelvis);
  if (vitals.lowNow) kitCtl.warn();
  const dashDots = "●".repeat(player.dash.charges) + "○".repeat(Math.max(0, Math.round(V.dashCharges) - player.dash.charges))
    + (V.boostFuel > 0 ? ` booster ${"▮".repeat(Math.round(10 * player.dash.fuel / V.boostFuel)).padEnd(10, "▯")}` : "");
  app.hud.set("dash", () => `dash ${dashDots} (Space)${player.bound.on ? ` · sprint ${sim.speed.toFixed(1)} m/s` : " · hold Space to sprint"} · hull ${Math.max(0, Math.round(player.health))}/${player.maxHealth} · ammo L ${player.upper.guns[0].ammo} R ${player.upper.guns[1].ammo}${lock ? ` · lock on ${lock.how === "cursor" ? "cursor" : "line of fire"}` : ""} · hits body ${loop.swarms.target.partHits[0]}, legs ${loop.swarms.target.partHits[1]}, feet ${loop.swarms.target.partHits[2]}`);
  const crane = carry.crane;
  app.hud.set("crane", () => `crane: ${crane.platform.spec.name} · ${carry.phase && carry.state !== "parked" ? carry.phase : "stowed"} · slew ${((crane.slew * 180) / Math.PI).toFixed(0)}° · reach ${crane.radius.toFixed(1)} m · rope ${crane.hoist.toFixed(1)} m · swing ${crane.swingOffset.toFixed(2)} m · picked up ${carry.pickups}, launched ${carry.deploys}, parked ${carry.parks}${bf.sfx.running ? "" : " · click for sound"}`);
});
