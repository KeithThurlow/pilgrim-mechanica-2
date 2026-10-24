// Walker lab: the Rampart on the procedural walker, on streamed dunes, from the high isometric game camera.
// Twin-stick: WASD walks the legs, the mouse aims the torso and its two hull miniguns, left button fires.
// Until you take over, a demo wanders, sweeps its aim and fires bursts.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createApp } from "../../src/core/app";
import { installReport } from "../../src/core/report";
import { Selector } from "../../src/core/select";
import { tweakPanel } from "../../src/core/tweaks";
import { Keys } from "../../src/core/input";
import { IsoCamera, ISO_DEFAULTS, ISO_PARAMS } from "../../src/core/isoCamera";
import { DuneField, TERRAIN_DEFAULTS, TERRAIN_PARAMS } from "../../src/world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS, STREAM_PARAMS } from "../../src/world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS } from "../../src/world/look";
import { screenToGround } from "../../src/world/raycast";
import type { MoveCommand } from "../../src/mech/walker";
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../../src/mech/walkerTuning";
import { UPPER_DEFAULTS, UPPER_PARAMS, type Aim } from "../../src/mech/upper";
import { WalkerBody } from "../../src/mech/walkerBody";
import { LEG_TYPES } from "../../src/mech/legTypes";
import { RampartBody } from "../../src/mech/rampart";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../../src/look/toon";
import { MARK_DEFAULTS, MARK_PARAMS } from "../../src/fx/sandMarks";
import { MINIGUN_FX_DEFAULTS, MINIGUN_FX_PARAMS } from "../../src/fx/minigun";
import { WreckStandIns } from "../../src/world/wrecks";
import { DUST_DEFAULTS, DUST_PARAMS } from "../../src/fx/dust";
import { SFX_DEFAULTS, SFX_PARAMS } from "../../src/audio/sfx";
import { Battlefield } from "../../src/game/battlefield";
import { MechUnit, MECH_DEFAULTS } from "../../src/game/mechUnit";

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;

const V = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...MARK_DEFAULTS, ...MECH_DEFAULTS, radius: 4, shadowBox: 30,
};
const DEFAULTS = { ...V };
// Review flags: ?model=standin, ?flat, ?walk=straight, ?sprint, ?fire (hold the trigger), ?cam=game|close|side|back|feet,
// ?zoom=metres (game camera distance).
const straight = params.get("walk") === "straight";

const toon = new ToonLook(V);
const field = new DuneField(V);
if (params.has("flat")) { field.v = { ...V, height: 0, swell: 0, bumps: 0 }; field.update(); }
const streamer = new TerrainStreamer(field, V);
scene.add(streamer.group);
const look = new DesertLook(scene, app.renderer, V);

const rampart = params.get("model") === "standin" ? null : await RampartBody.load(toon);
const standIn = rampart ? null : new WalkerBody();
// The leg archetype's walk and feet become this lab's defaults (so sliders still save over them); the model's own
// bone lengths are facts and always win.
const legType = LEG_TYPES[rampart ? "rampart" : "standin"];
Object.assign(V, legType.values, rampart?.legValues() ?? {});
Object.assign(DEFAULTS, legType.values, rampart?.legValues() ?? {});
scene.add(rampart ? rampart.root : standIn!.root);
// Steel to shoot at near the start: rounds spark off these and tear up the sand everywhere else.
const wrecks = new WreckStandIns(field, [
  { x: 22, z: -28, yaw: 0.6, kind: "hulk" },
  { x: 6, z: -26, yaw: -0.4, kind: "plate" },
  { x: 15, z: -18, yaw: 1.2, kind: "tank" },
]);
// The shared battlefield (dust, prints and craters, gun effects and sound) and the mech on it, as in the combat labs.
const bf = new Battlefield(field, V, camera, wrecks);
scene.add(bf.group);
const mech = new MechUnit(bf, V, rampart ?? standIn!, toon, 1, 0, true);
const { sim, upper } = mech;
const dust = bf.dust;
// ?surface=gravel|dirt|concrete: pretend the ground is that, to tune the other surfaces before the terrain has them.
const forcedSurface = params.get("surface");
if (forcedSurface === "gravel" || forcedSurface === "dirt" || forcedSurface === "concrete") dust.surfaceAt = () => forcedSurface;
let clock = 0;

// Cameras: the iso game camera, plus orbiting review views.
const iso = new IsoCamera(camera, canvas, V);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
controls.maxDistance = 160;
const follow = new THREE.Vector3();
const CAMS: Record<string, [pitch: number, dist: number, yawFromHeading: number]> = {
  close: [16, 15, 0.9],
  side: [6, 13, Math.PI / 2],
  back: [22, 15, Math.PI + 0.6],
  feet: [4, 7, 2.6],
};
let camName = params.get("cam") ?? "game";
function setCam(name: string) {
  camName = name;
  const game = name === "game";
  iso.enabled = game;
  controls.enabled = !game;
  if (game) { iso.snap(follow); return; }
  const [pitch, dist, yaw] = CAMS[name];
  const a = sim.heading + yaw, p = (pitch * Math.PI) / 180;
  controls.target.copy(follow);
  camera.position.copy(follow).add(new THREE.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)).multiplyScalar(dist));
  controls.update();
}

// Input: WASD legs, mouse aim, left button (or F in any camera) fires.
const keys = new Keys();
let auto = !params.has("manual");
let slow = false;
let mouse: { x: number; y: number } | null = null;
let mouseDown = false;
canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; auto = false; } });
canvas.addEventListener("pointerdown", (e) => { if (e.button === 0 && camName === "game" && e.pointerType === "mouse") { mouseDown = true; auto = false; } });
addEventListener("pointerup", () => { mouseDown = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

const shapeKeys = new Set([...TERRAIN_PARAMS.map((p) => p.key), "chunkSize", "segments"]);
let selector: Selector | null = null;
let picking = false; // a scene pick opens the topic itself; a topic button forgets the scene pick
const panel = tweakPanel({
  id: "walker-lab",
  title: rampart ? "Rampart walker" : "Walker lab",
  params: [...WALKER_PARAMS, ...UPPER_PARAMS, ...MINIGUN_FX_PARAMS, ...DUST_PARAMS, ...MARK_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS, ...STREAM_PARAMS, ...LOOK_PARAMS],
  values: V,
  defaults: DEFAULTS,
  actions: [
    { label: "Demo", onClick: () => { auto = !auto; }, active: () => auto },
    { label: "Slow-mo", onClick: () => { slow = !slow; }, active: () => slow },
    { label: "Game cam", onClick: () => setCam("game"), active: () => camName === "game" },
    ...Object.keys(CAMS).map((n) => ({ label: n[0].toUpperCase() + n.slice(1), onClick: () => setCam(n), active: () => camName === n })),
  ],
  // What's in this lab, and which slider groups each thing owns (hold V and click it, or use the buttons).
  topics: [
    { id: "legs", label: "Legs", groups: ["Move", "Gait", "Legs", "Feet", "Terrain", "Dust: sources", "Sand marks"] },
    { id: "dust", label: "Dust", groups: ["Dust", "Dust: look", "Dust: sources", "Dust: surfaces", "Sand marks"] },
    { id: "hull", label: "Hull", groups: ["Body", "Torso & guns"] },
    { id: "guns", label: "Miniguns", groups: ["Torso & guns", "Minigun", "Minigun FX", "Minigun hits", "Sound"] },
    { id: "hits", label: "Hits", groups: ["Minigun hits", "Dust: sources", "Sand marks", "Minigun FX", "Sound"] },
    { id: "dunes", label: "Dunes", groups: ["Dunes", "Shape", "Sand surface", "Streaming"] },
    { id: "light", label: "Light", groups: ["Look", "Cel look"] },
    { id: "camera", label: "Camera", groups: ["Camera"] },
  ],
  onFocus: () => { if (!picking) selector?.clear(); },
  onChange: (k) => { if (shapeKeys.has(k)) { field.update(); streamer.rebuildAll(); } },
});
// Hold V and click: the legs, the hull, either minigun, the drums, the ground (dunes) or the sky (light).
const regions = rampart?.regions() ?? standIn!.regions();
const r = regions as Partial<ReturnType<RampartBody["regions"]>>;
selector = new Selector(app, {
  items: [
    { topic: "legs", label: "Legs", objects: () => regions.legs },
    { topic: "hull", label: "Hull", objects: () => regions.hull },
    ...(r.gunLeft ? [{ topic: "guns", label: "Left minigun", objects: () => r.gunLeft! }] : []),
    ...(r.gunRight ? [{ topic: "guns", label: "Right minigun", objects: () => r.gunRight! }] : []),
    ...(r.back ? [{ topic: "guns", label: "Ammo drums", objects: () => r.back! }] : []),
    { topic: "hits", label: "Steel wreck (hits)", objects: () => wrecks.meshes },
  ],
  ground: { topic: "dunes", label: "Dunes", field },
  sky: { topic: "light", label: "Light and sky" },
  onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
});
const sel = selector;
installReport(app, "walker", V, () => ({ selected: sel.selection, topic: panel.focused }));
// The Rampart's bone lengths come from its model, so the IK fits its parts whatever was saved.
if (rampart) { Object.assign(V, rampart.legValues()); panel.refresh(); }

/** Demo: wanders with stops and sprints, sweeps the aim around and fires bursts. Deterministic, so shots repeat. */
function wander(t: number): MoveCommand {
  const seg = Math.floor(t / 8), local = t % 8;
  if (seg % 4 === 3 && local < 2.2) return { x: 0, z: 0, sprint: false };
  const a = 0.3 + 1.1 * Math.sin(t * 0.11) + 0.7 * Math.sin(t * 0.043 + 1.3);
  return { x: Math.sin(a), z: Math.cos(a), sprint: seg % 5 === 2 };
}
function demoAim(t: number): Aim {
  const a = sim.heading + 1.2 * Math.sin(t * 0.37) + 0.5 * Math.sin(t * 0.13 + 2);
  const d = 14 + 5 * Math.sin(t * 0.21);
  const x = sim.pos.x + Math.sin(a) * d, z = sim.pos.z + Math.cos(a) * d;
  return { x, y: field.height(x, z), z };
}

// Aim reticle: amber when the guns can bear, grey while the torso is still turning.
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }),
);
reticle.renderOrder = 10;
scene.add(reticle);

field.update();
mech.reset(13, -40, 0.3);
follow.copy(sim.pelvis);
streamer.fill(sim.pos.x, sim.pos.z);
setCam(camName);
if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
const lastFollow = follow.clone();
const stick = new THREE.Vector3(), aimPt = new THREE.Vector3();
// ?aimat=x,z: hold the aim on a fixed point (repeatable shots of hits).
const aimAtArg = params.get("aimat")?.split(",").map(Number);
const aimAt: Aim | null = aimAtArg && aimAtArg.length === 2 ? { x: aimAtArg[0], y: field.height(aimAtArg[0], aimAtArg[1]) + 0.8, z: aimAtArg[1] } : null;

// ?dt=seconds: every frame advances this much time, however long it took to draw (repeatable headless shots).
const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
app.onTick((rawDt) => {
  const dt = (fixedDt || rawDt) * (slow ? 0.25 : 1);
  clock += dt;

  keys.move(camera, stick);
  if (keys.has("KeyR")) upper.resupply();
  if (auto && upper.guns[0].ammo < 100) upper.resupply(); // the demo never runs dry
  if (stick.lengthSq() > 0 || keys.has("KeyF")) auto = false;
  let cmd: MoveCommand;
  if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
  else if (auto) cmd = straight ? { x: Math.sin(0.3), z: Math.cos(0.3), sprint: params.has("sprint") } : wander(clock);
  else cmd = { x: 0, z: 0, sprint: false };

  let aim: Aim | null = null;
  if (auto) aim = straight ? null : demoAim(clock);
  else if (aimAt) aim = aimAt;
  else if (mouse && screenToGround(mouse.x, mouse.y, canvas, camera, field, aimPt)) aim = { x: aimPt.x, y: aimPt.y, z: aimPt.z };
  // No firing while selecting (hold V).
  const trigger = !sel.active && (params.has("fire") || mouseDown || keys.has("KeyF") || (auto && !straight && clock % 6 > 3.2));

  mech.step(dt, cmd, aim, trigger);

  reticle.visible = !!aim && !!rampart;
  if (aim) {
    reticle.position.set(aim.x, aim.y + 0.06, aim.z);
    (reticle.material as THREE.MeshBasicMaterial).color.setHex(upper.onTarget ? 0xffb347 : 0x9a958c);
  }

  follow.lerp(new THREE.Vector3(sim.pelvis.x, sim.pelvis.y - 1.2, sim.pelvis.z), Math.min(1, rawDt * 6));
  if (camName === "game") iso.update(follow, rawDt);
  else {
    const delta = follow.clone().sub(lastFollow);
    camera.position.add(delta);
    controls.target.add(delta);
    controls.update();
  }
  lastFollow.copy(follow);
  toon.update(camera, canvas.clientHeight);

  streamer.update(sim.pos.x, sim.pos.z);
  // Haze and shadows scale with the zoom: fog counts from the camera, and far views need a bigger shadow box.
  const camDist = camera.position.distanceTo(follow);
  look.update(follow, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40));
  bf.update(dt, camera, look);

  const [a, b] = sim.feet;
  const misses = sim.stats.overreach / Math.max(1, sim.stats.frames * 2);
  const torsoRel = ((((upper.torsoYaw - sim.heading) * 180) / Math.PI + 540) % 360) - 180;
  app.hud.set("walk", `${sim.speed.toFixed(1)} m/s · ${(mech.stepTimes.length / 3).toFixed(1)} steps/s · ${cmd.sprint ? "sprint" : "walk"}${auto ? " (demo)" : ""}`);
  app.hud.set("feet", `L ${a.swinging ? "swing" : "planted"} · R ${b.swinging ? "swing" : "planted"} · reach misses ${(misses * 100).toFixed(2)}% · dust ${dust.alive}`);
  if (rampart) app.hud.set("guns", `torso ${torsoRel.toFixed(0)}° from legs · spin L ${(upper.guns[0].spin * 100).toFixed(0)}% R ${(upper.guns[1].spin * 100).toFixed(0)}% · ammo L ${upper.guns[0].ammo} R ${upper.guns[1].ammo} · hits sand ${bf.gunFx.hits.sand} steel ${bf.gunFx.hits.metal}${bf.sfx.running ? "" : " · click for sound"}`);
});
