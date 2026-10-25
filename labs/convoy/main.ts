// Convoy lab (Keith 2026-10-24, docs/proposal-convoy.md): the convoy village rolling over the dunes, laying a
// flattened road that stays behind it; the player's Rampart on twin-stick walks alongside. Walk into the crane's range
// and it picks the mech up (swinging on its rope) and sets it on the deck; walk about the moving deck, park in a bay
// (E, again to stand), or stand on a launch pad by the crane and it lifts you out and down beside the convoy at its
// speed (G launches from where you stand). Until you take over, a demo walks in, is picked up, parks, stands, walks
// to a launch pad, is launched, walks off and comes back.
// The convoy runs as a train (Keith 2026-10-24): platforms in a line with gaps the mech walks through, footbridges
// between them high enough to walk under, crawler tracks on the big ones leaving ruts and dust, pipe runs, vehicles
// tied down on the motor pool and escorts driving alongside.
// Flags: ?manual (no demo), ?aboard (start on the deck), ?deploy (start on the deck and launch at once), ?park (start
// parked), ?hang (start hanging from the crane over the sand), ?zoom=metres, ?dt=0.033, ?flat, ?watch=N (the camera
// follows car N, 0 the lead; ?watch=gapN the gap ahead of car N; ?watch=eN escort N).
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
import { screenToGround } from "../../src/world/raycast";
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../../src/mech/walkerTuning";
import { UPPER_DEFAULTS, UPPER_PARAMS, type Aim } from "../../src/mech/upper";
import type { MoveCommand } from "../../src/mech/walker";
import { LEG_TYPES } from "../../src/mech/legTypes";
import { RampartBody } from "../../src/mech/rampart";
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

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;
const V = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...MARK_DEFAULTS, ...DENT_DEFAULTS, ...MECH_DEFAULTS,
  ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS, ...DECK_DEFAULTS,
  ...TRAIN_DEFAULTS, ...TRACK_DEFAULTS, ...PIPE_DEFAULTS, ...TRAIL_DEFAULTS, ...ESCORT_DEFAULTS,
  radius: 5, shadowBox: 60,
};
const DEFAULTS = { ...V };
const PARAMS: Param[] = [
  ...ROUTE_PARAMS, ...TRAIN_PARAMS, ...PLATFORM_PARAMS, ...TRACK_PARAMS, ...TRAIL_PARAMS, ...PIPE_PARAMS, ...ESCORT_PARAMS, ...CRANE_PARAMS, ...CARRY_PARAMS, ...DECK_PARAMS, ...MECH_PARAMS, ...WALKER_PARAMS, ...UPPER_PARAMS,
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

// The convoy, its crane, and their stand-in bodies.
const convoy = new Convoy(route, V, field);
convoy.reset(0, 0);
const crane = new Crane(V, convoy.bay);
const carry = new CraneCarry(V, crane, field);
const bodies = convoy.platforms.map((p) => new PlatformBody(p, p === convoy.bay ? V : null, V, convoy.platforms));
for (const b of bodies) { b.update(); scene.add(b.root); }
const craneBody = new CraneBody(crane, bodies[convoy.platforms.indexOf(convoy.bay)]);
scene.add(craneBody.group);
// Footbridges between the cars, escorts alongside, and the ruts and dust they all leave.
const bridges = new BridgeBody();
scene.add(bridges.group);
let spans: Span[] = [];
const escorts = new EscortGroup(V, convoy, field);
const escortBodies = new EscortBodies(escorts);
scene.add(escortBodies.group);
const trail = new ConvoyTrail(V, bf, field);

// The player's Rampart.
const body = await RampartBody.load(toon);
Object.assign(V, LEG_TYPES.rampart.values, body.legValues());
Object.assign(DEFAULTS, LEG_TYPES.rampart.values, body.legValues());
scene.add(body.root);
const player = new MechUnit(bf, V, body, toon, 1, 0, true);
bf.targets.push(player);
const sim = player.sim;
// No sand prints or dust from footfalls on the steel deck (they'd be left hanging in the air as it rolls on).
{
  const fall = sim.onFootfall, lift = sim.onLiftOff;
  sim.onFootfall = (f, k) => { if (!carry.ground.onDeck) fall?.(f, k); };
  sim.onLiftOff = (f, k) => { if (!carry.ground.onDeck) lift?.(f, k); };
}

const iso = new IsoCamera(camera, canvas, V);
const keys = new Keys();
let auto = !params.has("manual");
let mouse: { x: number; y: number } | null = null;
let mouseDown = false;
canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; auto = false; } });
canvas.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.pointerType === "mouse") { mouseDown = true; auto = false; } });
addEventListener("pointerup", () => { mouseDown = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
let deployAsked = false, parkAsked = false;
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.repeat) return;
  if (e.code === "KeyG") { deployAsked = true; auto = false; }
  if (e.code === "KeyE") { parkAsked = true; auto = false; }
});

/** Start over: convoy at the origin, mech off to its left (or in the bay). */
function restart() {
  convoy.reset(0, 0);
  escorts.reset();
  crane.place();
  streamer.rebuildAll();
  const p = convoy.bay, at = p.toWorld(32, 0, V.craneMount + 25);
  carry.state = "walking"; carry.phase = ""; carry.attached = false; carry.armed = true; carry.ground.onDeck = false;
  player.reset(at.x, at.z, p.heading);
  crane.calm();
  if (params.has("aboard") || params.has("deploy") || params.has("park")) carry.putAboard(sim);
  if (params.has("deploy")) carry.deploy(sim, 1);
  if (params.has("park")) {
    // Into the left parking bay and settle there.
    const b = deckLayout(p, V).spots[0], w = p.toWorld(b.x, 0, b.z);
    sim.reset(w.x, w.z, p.heading);
    carry.togglePark(sim);
  }
  if (params.has("hang")) {
    // Hanging from the crane out over the sand beside the bay, as if just picked up.
    const w = p.toWorld(16, 0, V.craneMount + 6);
    player.reset(w.x, w.z, p.heading);
    carry.grab(sim);
  }
  streamer.fill(sim.pos.x, sim.pos.z);
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
    { label: "Restart", onClick: () => restart() },
  ],
  topics: [
    { id: "convoy", label: "Convoy", groups: ["Convoy route", "Train", "Footbridges", "Platforms"] },
    { id: "tracks", label: "Tracks and trail", groups: ["Tracks", "Convoy trail", "Ground dents", "Sand marks"] },
    { id: "pipes", label: "Pipes", groups: ["Pipes"] },
    { id: "escorts", label: "Escorts", groups: ["Escorts", "Escort driving", "Convoy trail"] },
    { id: "cranes", label: "Cranes", groups: ["Crane", "Crane motion", "Crane swing", "Pick-up and launch"] },
    { id: "deck", label: "Deck", groups: ["Deck"] },
    { id: "road", label: "Road", groups: ["Road", "Dunes", "Shape", "Sand surface", "Ground dents", "Ground dents: surfaces", "Streaming"] },
    { id: "mech", label: "Your mech", groups: ["Mech health", "Torso & guns", "Minigun", "Move"] },
    { id: "legs", label: "Legs", groups: ["Move", "Gait", "Legs", "Feet", "Terrain"] },
    { id: "hits", label: "Hits and dust", groups: ["Minigun hits", "Minigun FX", "Dust", "Dust: look", "Dust: sources", "Dust: surfaces", "Convoy trail", "Ground dents", "Sand marks", "Sound"] },
    { id: "light", label: "Light", groups: ["Look", "Cel look"] },
    { id: "camera", label: "Camera", groups: ["Camera"] },
  ],
  onFocus: () => { if (!picking) selector?.clear(); },
  onChange: (k) => {
    if (shapeKeys.has(k)) { field.update(); streamer.rebuildAll(); }
    // The road reindexes itself on its next step; the chunks need building again.
    if (roadKeys.has(k)) streamer.rebuildAll();
  },
});
const regions = body.regions();
selector = new Selector(app, {
  items: [
    { topic: "cranes", label: "Crane", objects: () => craneBody.meshes() },
    { topic: "deck", label: "Deck: parking bays and launch pads", objects: () => bodies.flatMap((b) => b.deckMeshes()) },
    { topic: "tracks", label: "Crawler tracks", objects: () => bodies.flatMap((b) => b.trackMeshes()) },
    { topic: "pipes", label: "Pipes", objects: () => bodies.flatMap((b) => b.pipeMeshes()) },
    { topic: "convoy", label: "Footbridges", objects: () => [...bridges.objects(), ...bodies.flatMap((b) => b.landingMeshes())] },
    { topic: "escorts", label: "Escorts and vehicles aboard", objects: () => [...escortBodies.objects(), ...bodies.flatMap((b) => b.vehicleMeshes())] },
    { topic: "convoy", label: "Convoy platforms", objects: () => bodies.flatMap((b) => b.meshes()) },
    { topic: "legs", label: "Legs", objects: () => regions.legs },
    { topic: "mech", label: "Your mech", objects: () => [...regions.hull, ...regions.gunLeft, ...regions.gunRight] },
  ],
  ground: { topic: "road", label: "Road and dunes", field },
  sky: { topic: "light", label: "Light and sky" },
  onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
});
const sel = selector;
installReport(app, "convoy", V, () => ({ selected: sel.selection, topic: panel.focused, mech: carry.label, crane: carry.phase, convoyS: Math.round(route.s) }));
Object.assign(V, body.legValues());
panel.refresh();

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }),
);
reticle.renderOrder = 10;
scene.add(reticle);

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
  return out.set(sim.pelvis.x, sim.pelvis.y - 1.2, sim.pelvis.z);
}
const follow = focus(new THREE.Vector3());
iso.snap(follow);
if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
const stick = new THREE.Vector3(), aimPt = new THREE.Vector3(), shoulder = new THREE.Vector3();
let clock = 0;

// Demo: walk in beside the bay, picked up, walk to a parking bay and park, stand, walk to a launch pad (sides
// alternate), launched, walk off out of range, come back.
const demo = { stage: "park" as "park" | "launch", wait: 0, awayFor: 0, leaving: false, side: 1 as 1 | -1 };
function demoCmd(dt: number): MoveCommand {
  const p = convoy.bay, still = { x: 0, z: 0, sprint: false };
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
    // Off to the side and ahead a little, until out of range for a few seconds.
    if (carry.armed) demo.awayFor += dt;
    if (demo.awayFor > 5) { demo.awayFor = 0; demo.leaving = false; demo.side = -demo.side as 1 | -1; }
    const l = p.toLocal(sim.pos.x, sim.pos.z), s = Math.sign(l.x) || 1;
    return { x: p.left.x * s + p.fwd.x * 0.8, z: p.left.z * s + p.fwd.z * 0.8, sprint: true };
  }
  if (carry.state === "lifting") return still;
  // Walk to a spot beside the crane, keeping up with the convoy.
  const l = p.toLocal(sim.pos.x, sim.pos.z), s = Math.sign(l.x) || 1;
  const at = p.toWorld(s * 15, 0, V.craneMount + 4);
  const dx = at.x - sim.pos.x, dz = at.z - sim.pos.z, d = Math.hypot(dx, dz);
  if (d < 2) return { x: p.fwd.x * (p.speed / V.walkSpeed), z: p.fwd.z * (p.speed / V.walkSpeed), sprint: false };
  return { x: dx / d, z: dz / d, sprint: d > 12 };
}

const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
app.onTick((rawDt) => {
  const dt = fixedDt || rawDt;
  clock += dt;
  keys.move(camera, stick);
  if (keys.has("KeyR")) player.upper.resupply();
  if (stick.lengthSq() > 0) auto = false;
  let cmd: MoveCommand = { x: 0, z: 0, sprint: false };
  let aim: Aim | null = null;
  let trigger = false;
  if (auto) cmd = demoCmd(dt);
  else {
    if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
    if (mouse && screenToGround(mouse.x, mouse.y, canvas, camera, field, aimPt)) aim = { x: aimPt.x, y: aimPt.y + 1, z: aimPt.z };
    trigger = mouseDown || keys.has("KeyF");
  }
  if (sel.active) trigger = false;
  if (deployAsked) {
    deployAsked = false;
    // Over the side the aim is on (left if no aim).
    const p = convoy.bay;
    const side = aim ? (p.toLocal(aim.x, aim.z).x >= 0 ? 1 : -1) : 1;
    carry.deploy(sim, side);
  }
  if (parkAsked) { parkAsked = false; carry.togglePark(sim); }

  // Convoy, crane and carry at 120 Hz; the walker steps once for the frame (it substeps itself) unless held.
  const sub = Math.max(1, Math.ceil(dt * 120));
  let out: MoveCommand | null = cmd;
  // Escorts steer round the mech when it's on the sand (not on the deck or hanging from the crane).
  const mechOnSand = carry.ground.onDeck || carry.attached ? null : sim.pos;
  for (let i = 0; i < sub; i++) {
    convoy.update(dt / sub);
    out = carry.update(dt / sub, sim, cmd);
    escorts.update(dt / sub, mechOnSand);
    for (const e of escorts.list) trail.car(e, e.sim, e.moved, e.kind === "technical" ? 0.45 : 0.6);
  }
  trail.update(convoy.platforms);
  // A mech walking on the deck rides it: the platform's motion this frame first, then its own step, kept on the deck.
  carry.ride(sim);
  if (out) {
    player.step(dt, out, aim, trigger && carry.state === "walking");
    carry.keep(sim);
    if (!carry.ground.onDeck && V.convoyPush > 0.5) for (const p of convoy.platforms) { const o = p.pushOut(sim.pos.x, sim.pos.z, 2); if (o) { sim.pos.x = o.x; sim.pos.z = o.z; } }
  } else {
    // Held by the crane or parked: the guns still track the aim, the body is posed from the hold.
    body.shoulderLine(shoulder);
    player.upper.update(dt, sim.heading, shoulder, aim, false);
    body.update(sim, player.upper);
  }

  for (const b of bodies) b.update();
  craneBody.update();
  spans = bridgeSpans(convoy.platforms, V, spans);
  bridges.update(spans, dt);
  escortBodies.update();

  reticle.visible = !!aim;
  if (aim) {
    reticle.position.set(aim.x, field.height(aim.x, aim.z) + 0.06, aim.z);
    (reticle.material as THREE.MeshBasicMaterial).color.setHex(player.upper.onTarget ? 0xffb347 : 0x9a958c);
  }

  follow.lerp(focus(new THREE.Vector3()), Math.min(1, rawDt * 6));
  iso.update(follow, rawDt);
  toon.update(camera, canvas.clientHeight);
  streamer.update(follow.x, follow.z);
  const camDist = camera.position.distanceTo(follow);
  look.update(follow, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40));
  bf.update(dt, camera, look);

  const p = convoy.bay;
  app.hud.set("convoy", `convoy ${p.speed.toFixed(1)} m/s heading ${((p.heading * 180) / Math.PI).toFixed(0)}° · ${convoy.platforms.length} cars over ${convoy.length.toFixed(0)} m · ${spans.length} footbridges · ${escorts.list.length} escorts · pipe runs ${bodies.reduce((a, b) => a + b.pipeRuns, 0)} · ruts ${trail.ruts} · road ${route.count} points · ground chunks pending ${streamer.stats.pending}`);
  app.hud.set("mech", `mech: ${carry.label}${carry.state === "inRange" ? ` (${Math.max(0, V.craneDwell - carry.timer).toFixed(1)} s)` : ""} · ${carry.distance(sim).toFixed(0)} m from the crane (range ${V.craneRange})${auto ? " · demo" : ""}`);
  app.hud.set("crane", `crane: ${carry.phase && carry.state !== "parked" ? carry.phase : "stowed"} · slew ${((crane.slew * 180) / Math.PI).toFixed(0)}° · reach ${crane.radius.toFixed(1)} m · rope ${crane.hoist.toFixed(1)} m · swing ${crane.swingOffset.toFixed(2)} m · picked up ${carry.pickups}, launched ${carry.deploys}, parked ${carry.parks}${bf.sfx.running ? "" : " · click for sound"}`);
});
