// Convoy lab (Keith 2026-10-24, docs/proposal-convoy.md): the convoy village rolling over the dunes, laying a
// flattened road that stays behind it; the player's Rampart on twin-stick walks alongside. Walk into the crane's range
// and it picks the mech up and sets it in the bay; G deploys it over the side you aim at, back onto the sand at the
// convoy's speed. Until you take over, a demo walks in, rides, deploys, walks off and comes back.
// Flags: ?manual (no demo), ?aboard (start in the bay), ?deploy (start in the bay and deploy at once), ?zoom=metres,
// ?dt=0.033, ?flat.
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
import { MINIGUN_FX_DEFAULTS, MINIGUN_FX_PARAMS } from "../../src/fx/minigun";
import { DUST_DEFAULTS, DUST_PARAMS } from "../../src/fx/dust";
import { SFX_DEFAULTS, SFX_PARAMS } from "../../src/audio/sfx";
import { Battlefield } from "../../src/game/battlefield";
import { MechUnit, MECH_DEFAULTS, MECH_PARAMS } from "../../src/game/mechUnit";
import { ConvoyRoute, ROUTE_DEFAULTS, ROUTE_PARAMS } from "../../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS, PLATFORM_PARAMS } from "../../src/convoy/platform";
import { Crane, CRANE_DEFAULTS, CRANE_PARAMS } from "../../src/convoy/crane";
import { CraneCarry, CARRY_DEFAULTS, CARRY_PARAMS } from "../../src/convoy/carry";
import { PlatformBody, CraneBody } from "../../src/convoy/platformBody";

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;
const V = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...MARK_DEFAULTS, ...MECH_DEFAULTS,
  ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS, ...CRANE_DEFAULTS, ...CARRY_DEFAULTS,
  radius: 5, shadowBox: 60,
};
const DEFAULTS = { ...V };
const PARAMS: Param[] = [
  ...ROUTE_PARAMS, ...PLATFORM_PARAMS, ...CRANE_PARAMS, ...CARRY_PARAMS, ...MECH_PARAMS, ...WALKER_PARAMS, ...UPPER_PARAMS,
  ...MINIGUN_FX_PARAMS, ...DUST_PARAMS, ...MARK_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS,
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
scene.add(bf.group);

// The convoy, its crane, and their stand-in bodies.
const convoy = new Convoy(route, V, field);
convoy.reset(0, 0);
const crane = new Crane(V, convoy.bay);
const carry = new CraneCarry(V, crane, field);
const bodies = convoy.platforms.map((p) => new PlatformBody(p, p === convoy.bay ? V : null));
for (const b of bodies) { b.update(); scene.add(b.root); }
const craneBody = new CraneBody(crane, bodies[convoy.platforms.indexOf(convoy.bay)]);
scene.add(craneBody.group);

// The player's Rampart.
const body = await RampartBody.load(toon);
Object.assign(V, LEG_TYPES.rampart.values, body.legValues());
Object.assign(DEFAULTS, LEG_TYPES.rampart.values, body.legValues());
scene.add(body.root);
const player = new MechUnit(bf, V, body, toon, 1, 0, true);
bf.targets.push(player);
const sim = player.sim;

const iso = new IsoCamera(camera, canvas, V);
const keys = new Keys();
let auto = !params.has("manual");
let mouse: { x: number; y: number } | null = null;
let mouseDown = false;
canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; auto = false; } });
canvas.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.pointerType === "mouse") { mouseDown = true; auto = false; } });
addEventListener("pointerup", () => { mouseDown = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
let deployAsked = false;
addEventListener("keydown", (e) => { if (e.code === "KeyG" && !(e.target instanceof HTMLInputElement)) { deployAsked = true; auto = false; } });

/** Start over: convoy at the origin, mech off to its left (or in the bay). */
function restart() {
  convoy.reset(0, 0);
  crane.place();
  streamer.rebuildAll();
  const p = convoy.bay, at = p.toWorld(32, 0, V.craneMount + 25);
  player.reset(at.x, at.z, p.heading);
  carry.state = "walking"; carry.phase = ""; carry.attached = false; carry.armed = true;
  if (params.has("aboard") || params.has("deploy")) carry.putAboard(sim);
  if (params.has("deploy")) carry.deploy(1);
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
    { label: "Deploy (G)", onClick: () => { deployAsked = true; auto = false; } },
    { label: "Restart", onClick: () => restart() },
  ],
  topics: [
    { id: "convoy", label: "Convoy", groups: ["Convoy route", "Formation", "Platforms"] },
    { id: "cranes", label: "Cranes", groups: ["Crane", "Pick-up and deploy"] },
    { id: "road", label: "Road", groups: ["Road", "Dunes", "Shape", "Sand surface", "Streaming"] },
    { id: "mech", label: "Your mech", groups: ["Mech health", "Torso & guns", "Minigun", "Move"] },
    { id: "legs", label: "Legs", groups: ["Move", "Gait", "Legs", "Feet", "Terrain"] },
    { id: "hits", label: "Hits and dust", groups: ["Minigun hits", "Minigun FX", "Dust", "Dust: look", "Dust: sources", "Sand marks", "Sound"] },
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
const follow = sim.pelvis.clone();
iso.snap(follow);
if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
const stick = new THREE.Vector3(), aimPt = new THREE.Vector3(), shoulder = new THREE.Vector3();
let clock = 0;

// Demo: walk in beside the bay, ride a while, deploy (alternating sides), walk off out of range, come back.
const demo = { aboardFor: 0, awayFor: 0, leaving: false, side: 1 as 1 | -1 };
function demoCmd(dt: number): MoveCommand {
  const p = convoy.bay;
  if (carry.state === "aboard") {
    demo.aboardFor += dt;
    if (demo.aboardFor > 6) { carry.deploy(demo.side); demo.side = -demo.side as 1 | -1; demo.aboardFor = 0; }
    return { x: 0, z: 0, sprint: false };
  }
  if (carry.state === "landing") demo.leaving = true;
  if (carry.state === "walking" && demo.leaving) {
    // Off to the side and ahead a little, until out of range for a few seconds.
    if (carry.armed) demo.awayFor += dt;
    if (demo.awayFor > 5) { demo.awayFor = 0; demo.leaving = false; }
    const l = p.toLocal(sim.pos.x, sim.pos.z), s = Math.sign(l.x) || 1;
    return { x: p.left.x * s + p.fwd.x * 0.8, z: p.left.z * s + p.fwd.z * 0.8, sprint: true };
  }
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
    carry.deploy(side);
  }

  // Convoy, crane and carry at 120 Hz; the walker steps once for the frame (it substeps itself) unless held.
  const sub = Math.max(1, Math.ceil(dt * 120));
  let out: MoveCommand | null = cmd;
  for (let i = 0; i < sub; i++) {
    convoy.update(dt / sub);
    out = carry.update(dt / sub, sim, cmd);
  }
  if (out) {
    player.step(dt, out, aim, trigger && carry.state === "walking");
    if (V.convoyPush > 0.5) for (const p of convoy.platforms) { const o = p.pushOut(sim.pos.x, sim.pos.z, 2); if (o) { sim.pos.x = o.x; sim.pos.z = o.z; } }
  } else {
    // Held by the crane or riding the deck: the guns still track the aim, the body is posed from the hold.
    body.shoulderLine(shoulder);
    player.upper.update(dt, sim.heading, shoulder, aim, false);
    body.update(sim, player.upper);
  }

  for (const b of bodies) b.update();
  craneBody.update();

  reticle.visible = !!aim;
  if (aim) {
    reticle.position.set(aim.x, field.height(aim.x, aim.z) + 0.06, aim.z);
    (reticle.material as THREE.MeshBasicMaterial).color.setHex(player.upper.onTarget ? 0xffb347 : 0x9a958c);
  }

  follow.lerp(new THREE.Vector3(sim.pelvis.x, sim.pelvis.y - 1.2, sim.pelvis.z), Math.min(1, rawDt * 6));
  iso.update(follow, rawDt);
  toon.update(camera, canvas.clientHeight);
  streamer.update(sim.pos.x, sim.pos.z);
  const camDist = camera.position.distanceTo(follow);
  look.update(follow, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40));
  bf.update(dt, camera, look);

  const p = convoy.bay;
  app.hud.set("convoy", `convoy ${p.speed.toFixed(1)} m/s heading ${((p.heading * 180) / Math.PI).toFixed(0)}° · road ${route.count} points · ground chunks pending ${streamer.stats.pending}`);
  app.hud.set("mech", `mech: ${carry.label}${carry.state === "inRange" ? ` (${Math.max(0, V.craneDwell - carry.timer).toFixed(1)} s)` : ""} · ${carry.distance(sim).toFixed(0)} m from the crane (range ${V.craneRange})${auto ? " · demo" : ""}`);
  app.hud.set("crane", `crane: ${carry.phase || (carry.state === "aboard" ? "parked over the bay" : "stowed")} · slew ${((crane.slew * 180) / Math.PI).toFixed(0)}° · reach ${crane.radius.toFixed(1)} m · rope ${crane.hoist.toFixed(1)} m · picked up ${carry.pickups}, deployed ${carry.deploys}${bf.sfx.running ? "" : " · click for sound"}`);
});
