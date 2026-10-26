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
// salvage onto the at-risk list, the crane's pick-up banks it, hold Q (or running out of fuel) recovers the mech and
// loses it, a destroyed mech loses it too; the radar (big in the convoy's range, the mech's own past it), the arrow
// home to the return point, fuel and the home estimate (src/expedition/).
// Flags: ?manual (no demo), ?aboard (start on the deck), ?deploy (start on the deck and launch at once), ?park (start
// parked), ?hang (start hanging from the crane over the sand), ?drop (just let go over the sand, falling), ?threat (a
// marker circling the train for the turrets to track), ?zoom=metres, ?dt=0.033, ?flat, ?watch=N (the camera
// follows car N, 0 the lead; ?watch=gapN the gap ahead of car N; ?watch=eN escort N); expedition: ?out (start out in the
// field, 280 m off the convoy, with some scrap at risk), ?far (850 m out, past the range edge), ?lowfuel[=seconds]
// (start out with little fuel left), ?loot=N (that much scrap at risk), ?nearcamp[=metres] (just outside the nearest swarm camp, or that far from it).
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { createApp } from "../../src/core/app";
import { installReport } from "../../src/core/report";
import { Selector } from "../../src/core/select";
import { tweakPanel, type Param } from "../../src/core/tweaks";
import { Keys } from "../../src/core/input";
import { IsoCamera, ISO_DEFAULTS, ISO_PARAMS } from "../../src/core/isoCamera";
import { DuneField, TERRAIN_DEFAULTS, TERRAIN_PARAMS } from "../../src/world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS, STREAM_PARAMS } from "../../src/world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS } from "../../src/world/look";
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../../src/mech/walkerTuning";
import { UPPER_DEFAULTS, UPPER_PARAMS, type Aim, type Trigger } from "../../src/mech/upper";
import type { MoveCommand } from "../../src/mech/walker";
import { LEG_TYPES } from "../../src/mech/legTypes";
import { RampartBody, mechLegType } from "../../src/mech/rampart";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../../src/look/toon";
import { MARK_DEFAULTS, MARK_PARAMS } from "../../src/fx/sandMarks";
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
import { DECK_DEFAULTS, DECK_PARAMS, deckLayout, walkToSpot } from "../../src/convoy/deck";
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
import { ExpeditionLoop, LOOP_DEFAULTS, LOOP_PARAMS, LOOP_TOPICS } from "../../src/expedition/loop";
import { POI_PARAMS } from "../../src/world/pois";
import { SITE_PARAMS } from "../../src/pois/kinds";
import { CAMP_PARAMS } from "../../src/expedition/camps";
import { Costs } from "../../src/core/costs";
import { TARGET_DEFAULTS, TARGET_PARAMS, type TargetCandidate, type Lock } from "../../src/game/targeting";
import { WEAPON_DEFAULTS, WEAPON_PARAMS, WEAPON_TOPIC } from "../../src/weapons/tuning";
import { MouseButtons, SoftAim, CameraShake, fitArsenal } from "../../src/game/playerAim";
import { robotCandidates } from "../../src/combat/robotTarget";
import { BIG, DOWN } from "../../src/combat/robots";
import { WALK_LEGS } from "../../src/combat/robotLegs";
import { loadoutFor, pickFromParams, type Pick } from "../../src/items/weaponPick";
import { Walkable } from "../../src/world/walkable";
import { ConvoyWalkways, WALKWAY_DEFAULTS, WALKWAY_PARAMS, platformFrame, deckPlane } from "../../src/convoy/walkways";
import { OnFoot, ON_FOOT_DEFAULTS, ON_FOOT_PARAMS, PILOT_TOPIC } from "../../src/pilot/onFoot";
import { bayScreen, loadBay, saveBay, type BayState } from "../../src/ui/bay";
import { resolve, LOADOUT_DEFAULTS, LOADOUT_PARAMS } from "../../src/items/loadout";
import { LOOT_DEFAULTS, LOOT_PARAMS } from "../../src/items/generate";
import { newBag } from "../../src/items/cargo";
import { applyLoadout } from "../../src/game/loadoutApply";

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;
const V = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...MARK_DEFAULTS, ...DENT_DEFAULTS, ...MECH_DEFAULTS,
  ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS,
  ...TRAIN_DEFAULTS, ...TRACK_DEFAULTS, ...PIPE_DEFAULTS, ...TRAIL_DEFAULTS, ...ESCORT_DEFAULTS, ...DEFENCE_DEFAULTS,
  ...LOOP_DEFAULTS, ...ON_FOOT_DEFAULTS, ...WALKWAY_DEFAULTS, ...LOOT_DEFAULTS, ...LOADOUT_DEFAULTS, ...TARGET_DEFAULTS, ...WEAPON_DEFAULTS,
  radius: 5, shadowBox: 60,
};
const DEFAULTS = { ...V };
const PARAMS: Param[] = [
  ...ON_FOOT_PARAMS, ...WALKWAY_PARAMS, ...LOOT_PARAMS, ...LOADOUT_PARAMS, ...WEAPON_PARAMS, ...TARGET_PARAMS,
  ...LOOP_PARAMS, ...ROUTE_PARAMS, ...TRAIN_PARAMS, ...PLATFORM_PARAMS, ...TRACK_PARAMS, ...TRAIL_PARAMS, ...PIPE_PARAMS, ...ESCORT_PARAMS, ...DEFENCE_PARAMS, ...CRANE_PARAMS, ...CARRY_PARAMS, ...DECK_PARAMS, ...MECH_PARAMS, ...WALKER_PARAMS, ...UPPER_PARAMS,
  ...MINIGUN_FX_PARAMS, ...DUST_PARAMS, ...MARK_PARAMS, ...DENT_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS,
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
route.onChange = (x0, z0, x1, z1) => streamer.rebuildArea(x0, z0, x1, z1);
const look = new DesertLook(scene, app.renderer, V);
const bf = new Battlefield(field, V, camera);
// Ruts and prints as dents on a fine patch (Keith 2026-10-25); markMode 0 brings back the decals.
bf.useDents(app.renderer, streamer);
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
const threatOn = params.has("threat");
const threatMark = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), new THREE.MeshBasicMaterial({ color: 0xff4030, toneMapped: false }));
threatMark.visible = threatOn;
scene.add(threatMark);

// The player's Rampart.
const body = await RampartBody.load(toon);
Object.assign(V, LEG_TYPES[mechLegType()].values, body.legValues());
Object.assign(DEFAULTS, LEG_TYPES[mechLegType()].values, body.legValues());
scene.add(body.root);
const player = new MechUnit(bf, V, body, toon, 1, 0, true);
bf.targets.push(player);
const sim = player.sim;
// The expedition: POIs, salvage and swarm camps out in the sand, the at-risk list, fuel, the radar and the HUD.
const loop = new ExpeditionLoop(V, field, bf, scene, camera, route, convoy, carry, player);
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
const cands: TargetCandidate[] = [];
const targets = () => robotCandidates(loop.swarms.sw, cands);
// The player's weapons as in the combat labs (src/game/playerAim.ts): the arsenal, camera shake, blasts.
const shaker = new CameraShake();
const { arsenal, draw: arsenalDraw } = fitArsenal(bf, player, V, toon, scene, targets, shaker);
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
  // crater() lays one mark every craterEvery calls: call it that many times so the landing always leaves one.
  for (let i = 0; i < Math.max(1, Math.round(V.craterEvery)); i++) bf.marks.crater(x, z, 5 * k);
  shaker.add(V.craneLandShake * k);
};
player.onLanding = (l) => { shaker.add(V.craneLandShake * Math.min(1.6, l.impact / 7.7)); };

const iso = new IsoCamera(camera, canvas, V);
const keys = new Keys();
// The pilot on foot (docs/proposal-pilot.md): hold F to hop out (parked in a bay, or anywhere on the sand) and back
// in by the mech; he walks the sand and the convoy's decks, stairs and footbridges (the walkways ride the cars).
const walkable = new Walkable(field);
const ways = new ConvoyWalkways(convoy, walkable, V);
ways.update();
const foot = await OnFoot.create(V, walkable, player, iso, bf, scene);
/** Was the crane armed when the pilot got out on the sand (it mustn't come for the empty mech; restored on getting in). */
let armedWhenOut = true;
// The bay screen (src/ui/bay.ts): opened at a bay terminal on foot (E), B anywhere as a lab shortcut.
const BAY_KEY = "pm2:convoy-lab:bay";
// A fresh bay fits a mixed build (the mounts, Keith 2026-10-26): a hull minigun on the right, an arm on the left with
// a light minigun and the missile pod on 1, the power pack; ?left= ?right= ?k1= ?k2= ?k3= (as in the weapons lab) fit
// those instead.
const kit: Pick = { left: "minigun", right: "minigun", k1: "missiles", k2: "none", k3: "pack" };
const kitFlagged = pickFromParams(kit, params);
const bayState: BayState = (!params.has("fresh") && loadBay(BAY_KEY)) || { loadout: loadoutFor(kit), stash: newBag(), cargo: newBag(), seed: (Date.now() % 1e9) | 1 };
if (kitFlagged) bayState.loadout = loadoutFor(kit);
function refit() {
  const r = resolve(bayState.loadout, V);
  bayState.cargo.capacity = r.cargoCapacity;
  applyLoadout(player, r);
  // The sensor's seekers (its radar range already went into V.mechRadar through the loadout's values).
  loop.seeker.setModes(r.seekers);
  saveBay(BAY_KEY, bayState);
}
refit();
// Tab cycles the sensor's seeker mode (shown on the radar and in the expedition HUD).
addEventListener("keydown", (e) => { if (e.code === "Tab" && !bay.isOpen) { e.preventDefault(); loop.seeker.cycle(); } });
// ?seek=scrap|wreck|rare|legendary: start on that mode if the sensor has it.
for (let i = 0; params.get("seek") && i < loop.seeker.modes.length && loop.seeker.mode !== params.get("seek"); i++) loop.seeker.cycle();
const bay = bayScreen({ state: bayState, tuning: V, onChange: () => { refit(); panel.refresh(); } });
const terminals: ReturnType<typeof ways.terminals> = [];
let auto = !params.has("manual") && !params.has("onfoot");
// Left click fires the left side's weapon, right click the right side's (both can be held); keys 1-3 the shoulder
// weapons; only while driving the mech (F is hold to hop out and back in, Keith 2026-10-26).
const buttons = new MouseButtons(canvas, () => { auto = false; });
let deployAsked = false, parkAsked = false;
// E held strips salvage out on the sand (E pressed still parks aboard); Q held calls a recovery.
let eHeld = false, qHeld = false;
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === "KeyE") { eHeld = true; auto = false; }
  if (e.code === "KeyQ") { qHeld = true; auto = false; }
});
addEventListener("keyup", (e) => { if (e.code === "KeyE") eHeld = false; if (e.code === "KeyQ") qHeld = false; });
addEventListener("blur", () => { eHeld = false; qHeld = false; });
// Space: dash the way WASD points (Keith 2026-10-25: the dash in every lab), on charges; keep holding to carry on into
// the sprint out on the sand (Keith 2026-10-26).
let dashPressed = false, spaceDown = false;
addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
  if (params.has("drop")) carry.dropBeside(sim, 1);
  if (params.has("hang")) {
    // Hanging from the crane out over the sand beside the bay, as if just picked up.
    const w = p.toWorld(16, 0, V.craneMount + 6);
    player.reset(w.x, w.z, p.heading);
    carry.grab(sim);
  }
  // Expedition starts: out in the field (?out, ?far), short of fuel, with scrap at risk.
  if (params.has("out") || params.has("far") || params.has("lowfuel")) {
    const side = params.has("far") ? 850 : 280, ahead = params.has("far") ? 120 : 60;
    const w = p.toWorld(side, 0, ahead);
    player.reset(w.x, w.z, p.heading + Math.PI / 2);
    carry.armed = true;
  }
  // ?nearcamp: out on the sand just outside the wake range of the nearest swarm camp, facing it.
  if (params.has("nearcamp")) {
    const c = loop.camps.campsNear(p.x, p.z, 2500).filter((q) => !route.at(q.x, q.z, { w: 0, berm: 0, lift: 0, rough: 0 }))
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (c) {
      const d = Math.hypot(c.x - p.x, c.z - p.z) || 1, back = Number(params.get("nearcamp")) || V.campWake + 15;
      const x = c.x - ((c.x - p.x) / d) * back, z = c.z - ((c.z - p.z) / d) * back;
      player.reset(x, z, Math.atan2(c.x - x, c.z - z));
      carry.armed = true;
    }
  }
  loop.exp.launch();
  if (["out", "far", "lowfuel", "nearcamp"].some((f) => params.has(f))) loop.exp.add({ kind: "scrap", amount: 34, label: "Debris field" });
  if (params.has("loot")) loop.exp.add({ kind: "scrap", amount: Number(params.get("loot")) || 50, label: "Supply pod" });
  if (params.has("lowfuel")) loop.fuel.left = Number(params.get("lowfuel")) || 150;
  if (carry.state !== "walking") loop.exp.state = "aboard";
  foot.reset();
  // ?onfoot: on foot beside the mech: parked in the left bay (unless a flag put the mech out on the sand).
  if (params.has("onfoot")) {
    const inField = ["out", "far", "lowfuel", "nearcamp", "field"].some((f) => params.has(f));
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

const roadKeys = new Set(["routeHalfWidth", "routeBlend", "routeBerm", "routeLift", "routeRough"]);
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
    { id: "loadout", label: "Loadout", groups: ["Loot rolls", "Bare mech"] },
    { id: "convoy", label: "Convoy", groups: ["Convoy route", "Train", "Footbridges", "Platforms"] },
    { id: "tracks", label: "Tracks and trail", groups: ["Tracks", "Convoy trail", "Ground dents", "Sand marks"] },
    { id: "pipes", label: "Pipes", groups: ["Pipes"] },
    { id: "escorts", label: "Escorts", groups: ["Escorts", "Escort driving", "Convoy trail"] },
    { id: "defence", label: "Defences", groups: ["Defences"] },
    { id: "cranes", label: "Cranes", groups: ["Crane", "Crane motion", "Crane swing", "Pick-up and launch", "Drop-off"] },
    { id: "deck", label: "Deck", groups: ["Deck"] },
    { id: "road", label: "Road", groups: ["Road", "Dunes", "Shape", "Sand surface", "Ground dents", "Ground dents: surfaces", "Streaming"] },
    { id: "mech", label: "Your mech", groups: ["Targeting", "Rounds", "Dash", "Sprint kit", "Mech health", "Torso & guns", "Minigun", "Move"] },
    WEAPON_TOPIC,
    { id: "legs", label: "Legs", groups: ["Move", "Sprint", "Gait", "Air", "Landing", "Legs", "Feet", "Terrain"] },
    { id: "hits", label: "Hits and dust", groups: ["Minigun hits", "Minigun FX", "Dust", "Dust: look", "Dust: sources", "Dust: surfaces", "Convoy trail", "Ground dents", "Sand marks", "Sound"] },
    { id: "light", label: "Light", groups: ["Look", "Cel look"] },
    { id: "camera", label: "Camera", groups: ["Camera"] },
    ...LOOP_TOPICS,
  ],
  onFocus: () => { if (!picking) selector?.clear(); },
  onChange: (k) => {
    if (shapeKeys.has(k)) { field.update(); streamer.rebuildAll(); }
    // The road reindexes itself on its next step; the chunks need building again.
    if (roadKeys.has(k)) streamer.rebuildAll();
    // POI placement and the dunes under it: placed again (pads rebuilt with the chunks); camps placed again.
    if (shapeKeys.has(k) || POI_PARAMS.some((p) => p.key === k) || SITE_PARAMS.some((p) => p.key === k)) { loop.rebuild("sites"); streamer.rebuildAll(); }
    if (CAMP_PARAMS.some((p) => p.key === k)) loop.rebuild("camps");
  },
});
const regions = body.regions();
selector = new Selector(app, {
  items: [
    { topic: "pilot", label: "Pilot", objects: () => foot.body.meshes() },
    { topic: "pilot", label: "Bay terminal", objects: () => bodies.flatMap((b) => b.terminalMeshes()) },
    { topic: "pois", label: "POIs", objects: () => loop.sites.meshes() },
    { topic: "pois", label: "Salvage spots", objects: () => loop.sites.fx.objects() },
    { topic: "swarms", label: "Robots", objects: () => loop.swarms.draw.group.children },
    { topic: "defence", label: "Turrets", objects: () => defenceBody.objects() },
    { topic: "cranes", label: "Cranes", objects: () => craneBodies.flatMap((c) => c.meshes()) },
    { topic: "deck", label: "Deck: parking bays and launch pads", objects: () => bodies.flatMap((b) => b.deckMeshes()) },
    { topic: "tracks", label: "Crawler tracks", objects: () => bodies.flatMap((b) => b.trackMeshes()) },
    { topic: "pipes", label: "Pipes", objects: () => bodies.flatMap((b) => b.pipeMeshes()) },
    { topic: "convoy", label: "Footbridges", objects: () => [...bridges.objects(), ...bodies.flatMap((b) => b.landingMeshes())] },
    { topic: "escorts", label: "Escorts and vehicles aboard", objects: () => [...escortBodies.objects(), ...bodies.flatMap((b) => b.vehicleMeshes())] },
    { topic: "convoy", label: "Convoy platforms", objects: () => bodies.flatMap((b) => b.meshes()) },
    { topic: "legs", label: "Legs", objects: () => regions.legs },
    { topic: "weapons", label: "Weapons", objects: () => arsenal.meshes() },
    { topic: "mech", label: "Your mech", objects: () => [...regions.hull, ...regions.gunLeft, ...regions.gunRight] },
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
  if (auto) { cmd = demoCmd(dt); aim = cursor = loop.demoAim; trigger = loop.demoTrigger; }
  else if (driving) {
    if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
    // Soft lock as in the combat labs: the enemy under the cursor (a tall walker by its body, or the sand among its
    // feet), else the one nearest the line of fire; led by its motion, the rounds straight at it.
    ({ cursor, aim, shotAt, lock } = softAim.pick(buttons.mouse, targets(), sim.pos, V));
    trigger = [buttons.left, buttons.right];
    held = [keys.has("Digit1"), keys.has("Digit2"), keys.has("Digit3"), keys.has("Digit4")];
  }
  // Weapons work only out on the sand (not on the deck, hanging or parked).
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
    // The sprint only on the sand: the decks and the crane's states keep the mech at a walk.
    player.dashHold = spaceDown && !auto && free && (carry.state === "walking" || carry.state === "inRange");
    player.step(dt, out, aim, trigger, shotAt ?? aim);
    carry.keep(sim);
    if (!carry.ground.onDeck && V.convoyPush > 0.5) for (const p of convoy.platforms) { const o = p.pushOut(sim.pos.x, sim.pos.z, 2); if (o) { sim.pos.x = o.x; sim.pos.z = o.z; } }
  } else {
    // Held by the crane or parked: the guns still track the aim, the body is posed from the hold.
    body.shoulderLine(shoulder);
    player.upper.update(dt, sim.heading, shoulder, aim, false);
    body.update(sim, player.upper);
  }

  dashPressed = false;
  costs.mark("mech");

  // Getting out and in: the mount, the field kneel or the bay's park, the crane kept off an empty mech on the sand.
  const prompt = term ? `Press <b>E</b>: bay terminal (fit parts, stash)${bay.isOpen ? " · open" : ""}` : "";
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
  costs.mark("convoy bodies");

  softAim.draw(driving ? cursor : null, lock?.target ?? null, player.upper.onTarget);

  follow.lerp(focus(new THREE.Vector3()), Math.min(1, rawDt * 6));
  // Out on the sand the camera leads the mech at speed (the sprint).
  iso.update(follow, rawDt, driving && (carry.state === "walking" || carry.state === "inRange") ? { x: sim.vel.x + sim.skid.x, z: sim.vel.z + sim.skid.z } : undefined);
  shaker.apply(camera, rawDt, V.shakeDecay);
  toon.update(camera, canvas.clientHeight);
  costs.mark("camera");
  streamer.update(follow.x, follow.z);
  costs.mark("ground");
  const camDist = camera.position.distanceTo(follow);
  look.update(follow, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40));
  costs.mark("light");
  bf.update(dt, camera, look);
  arsenalDraw.update();
  app.hud.set("weapons", arsenal.controls().join(" · "));
  // The expedition: POIs and salvage, swarm camps (the robot sim), fuel, the way home, the radar and its HUD.
  loop.update(dt, {
    eHeld, qHeld, demo: auto, mark: (st) => costs.mark(st), canvas,
    pilot: foot.mount.onFoot ? {
      onFoot: true, alive: foot.sim.alive, x: fp.x, z: fp.z, prey: (x, z) => foot.quarry.pick(x, z), notice: V.pilotNotice,
      reach: V.pilotReach, rate: V.pilotStripRate, noise: V.pilotStripNoise,
    } : undefined,
  });
  app.hud.set("expedition", loop.line);
  app.hud.set("costs", costs.end());

  const p = convoy.bay;
  app.hud.set("convoy", `convoy ${p.speed.toFixed(1)} m/s heading ${((p.heading * 180) / Math.PI).toFixed(0)}° · ${convoy.platforms.length} cars over ${convoy.length.toFixed(0)} m · ${spans.length} footbridges · ${escorts.list.length} escorts · pipe runs ${bodies.reduce((a, b) => a + b.pipeRuns, 0)} · ruts ${trail.ruts} · road ${route.count} points · ground chunks pending ${streamer.stats.pending}`);
  app.hud.set("pilot", foot.driving ? "" : `pilot: ${foot.mount.state}${foot.sim.alive ? "" : " (killed)"} · health ${Math.round(foot.sim.health)}/${V.pilotHealth}${foot.mount.onFoot ? ` · on ${foot.sim.on?.name ?? "the sand"} · ${foot.toMech.toFixed(1)} m from the mech (F within ${V.pilotRange})` : ""}`);
  app.hud.set("mech", `mech: ${carry.label}${carry.state === "inRange" ? ` (${Math.max(0, V.craneDwell - carry.timer).toFixed(1)} s)` : ""} · ${carry.distance(sim).toFixed(0)} m from the crane (range ${V.craneRange})${auto ? " · demo" : ""}`);
  const dashDots = "●".repeat(player.dash.charges) + "○".repeat(Math.max(0, Math.round(V.dashCharges) - player.dash.charges))
    + (V.boostFuel > 0 ? ` booster ${"▮".repeat(Math.round(10 * player.dash.fuel / V.boostFuel)).padEnd(10, "▯")}` : "");
  app.hud.set("dash", `dash ${dashDots} (Space)${player.bound.on ? ` · sprint ${sim.speed.toFixed(1)} m/s` : " · hold Space to sprint"} · hull ${Math.max(0, Math.round(player.health))}/${player.maxHealth} · ammo L ${player.upper.guns[0].ammo} R ${player.upper.guns[1].ammo}${lock ? ` · lock on ${lock.how === "cursor" ? "cursor" : "line of fire"}` : ""} · hits body ${loop.swarms.target.partHits[0]}, legs ${loop.swarms.target.partHits[1]}, feet ${loop.swarms.target.partHits[2]}`);
  const crane = carry.crane;
  app.hud.set("crane", `crane: ${crane.platform.spec.name} · ${carry.phase && carry.state !== "parked" ? carry.phase : "stowed"} · slew ${((crane.slew * 180) / Math.PI).toFixed(0)}° · reach ${crane.radius.toFixed(1)} m · rope ${crane.hoist.toFixed(1)} m · swing ${crane.swingOffset.toFixed(2)} m · picked up ${carry.pickups}, launched ${carry.deploys}, parked ${carry.parks}${bf.sfx.running ? "" : " · click for sound"}`);
});
