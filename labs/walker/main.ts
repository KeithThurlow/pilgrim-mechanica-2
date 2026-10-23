// Walker lab: the Rampart on the procedural walker, on streamed dunes, from the high isometric game camera.
// Twin-stick: WASD walks the legs, the mouse aims the torso and its two hull miniguns, left button fires.
// Until you take over, a demo wanders, sweeps its aim and fires bursts.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createApp } from "../../src/core/app";
import { tweakPanel } from "../../src/core/tweaks";
import { Keys } from "../../src/core/input";
import { IsoCamera, ISO_DEFAULTS, ISO_PARAMS } from "../../src/core/isoCamera";
import { DuneField, TERRAIN_DEFAULTS, TERRAIN_PARAMS } from "../../src/world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS, STREAM_PARAMS } from "../../src/world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS } from "../../src/world/look";
import { rayGround, screenToGround } from "../../src/world/raycast";
import { WalkerSim, leftOf, type MoveCommand } from "../../src/mech/walker";
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../../src/mech/walkerTuning";
import { UpperSim, UPPER_DEFAULTS, UPPER_PARAMS, type Aim } from "../../src/mech/upper";
import { WalkerBody } from "../../src/mech/walkerBody";
import { RampartBody } from "../../src/mech/rampart";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../../src/look/toon";
import { FootfallFx } from "../../src/fx/footfall";
import { MinigunFx, MINIGUN_FX_DEFAULTS, MINIGUN_FX_PARAMS } from "../../src/fx/minigun";
import { Sfx, SFX_DEFAULTS, SFX_PARAMS } from "../../src/audio/sfx";
import { MinigunAudio } from "../../src/audio/minigunAudio";

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;

const V = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, radius: 4, shadowBox: 40,
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

const sim = new WalkerSim(V, field);
const upper = new UpperSim(V);
const rampart = params.get("model") === "standin" ? null : await RampartBody.load(toon);
const standIn = rampart ? null : new WalkerBody();
scene.add(rampart ? rampart.root : standIn!.root);
const steps = new FootfallFx();
const gunFx = new MinigunFx(field, V);
scene.add(steps.group, gunFx.group);
// Sound starts on the first click or key press (browser rule).
const sfx = new Sfx(V, camera);
const gunAudio = new MinigunAudio(sfx);
gunFx.onHit = (at) => gunAudio.hit(at);
gunFx.onCasingLand = (at) => gunAudio.casing(at);

const stepTimes: number[] = [];
let clock = 0;
const plateQ = (up: THREE.Vector3, yaw: number) => {
  const fw = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  fw.addScaledVector(up, -fw.dot(up)).normalize();
  const lf = new THREE.Vector3().crossVectors(up, fw).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lf, up, fw));
};
sim.onFootfall = (f, k) => {
  steps.footfall(f.planted, plateQ(f.plantedUp, f.plantedYaw), k);
  stepTimes.push(clock);
  while (stepTimes.length && clock - stepTimes[0] > 3) stepTimes.shift();
};

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
const panel = tweakPanel({
  id: "walker-lab",
  title: rampart ? "Rampart walker" : "Walker lab",
  params: [...WALKER_PARAMS, ...UPPER_PARAMS, ...MINIGUN_FX_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS, ...STREAM_PARAMS, ...LOOK_PARAMS],
  values: V,
  defaults: DEFAULTS,
  actions: [
    { label: "Demo", onClick: () => { auto = !auto; }, active: () => auto },
    { label: "Slow-mo", onClick: () => { slow = !slow; }, active: () => slow },
    { label: "Game cam", onClick: () => setCam("game"), active: () => camName === "game" },
    ...Object.keys(CAMS).map((n) => ({ label: n[0].toUpperCase() + n.slice(1), onClick: () => setCam(n), active: () => camName === n })),
  ],
  onChange: (k) => { if (shapeKeys.has(k)) { field.update(); streamer.rebuildAll(); } },
});
// The Rampart's leg lengths come from its model, so the IK fits its parts whatever was saved.
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
sim.reset(13, -40, 0.3);
upper.reset(0.3);
follow.copy(sim.pelvis);
streamer.fill(sim.pos.x, sim.pos.z);
setCam(camName);
if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
const lastFollow = follow.clone();
const stick = new THREE.Vector3(), aimPt = new THREE.Vector3(), shoulder = new THREE.Vector3();
const muzzle = new THREE.Vector3(), dir = new THREE.Vector3(), hit = new THREE.Vector3(), eject = new THREE.Vector3();
let rounds = 0;

app.onTick((rawDt) => {
  const dt = rawDt * (slow ? 0.25 : 1);
  clock += dt;

  keys.move(camera, stick);
  if (stick.lengthSq() > 0 || keys.has("KeyF")) auto = false;
  let cmd: MoveCommand;
  if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
  else if (auto) cmd = straight ? { x: Math.sin(0.3), z: Math.cos(0.3), sprint: params.has("sprint") } : wander(clock);
  else cmd = { x: 0, z: 0, sprint: false };

  let aim: Aim | null = null;
  if (auto) aim = straight ? null : demoAim(clock);
  else if (mouse && screenToGround(mouse.x, mouse.y, canvas, camera, field, aimPt)) aim = { x: aimPt.x, y: aimPt.y, z: aimPt.z };
  const trigger = params.has("fire") || mouseDown || keys.has("KeyF") || (auto && !straight && clock % 6 > 3.2);

  if (rampart) rampart.shoulderLine(shoulder); else shoulder.copy(sim.pelvis).setY(sim.pelvis.y + 1.3);
  const fired: (1 | -1)[] = [];
  const sub = Math.max(1, Math.ceil(dt * 120));
  for (let i = 0; i < sub; i++) {
    sim.update(dt / sub, cmd);
    for (const s of upper.update(dt / sub, sim.heading, shoulder, aim, trigger && !!rampart)) fired.push(s);
  }
  if (rampart) rampart.update(sim, upper); else standIn!.update(sim);

  if (rampart) {
    const left = leftOf(upper.torsoYaw);
    const spread = (V.spread * Math.PI) / 180;
    for (const s of fired) {
      rampart.muzzle(s, muzzle);
      rampart.barrel(s, dir);
      // Spread: tilt inside the cone, then wherever that ray meets the ground (or full range in the air).
      const tilt = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.tan(spread) * Math.random());
      const d = dir.clone().add(tilt.addScaledVector(dir, -tilt.dot(dir))).normalize();
      if (!rayGround(muzzle, d, field, V.range, hit)) hit.copy(muzzle).addScaledVector(d, V.range);
      rampart.eject(s, eject);
      gunFx.shot(s === 1 ? 0 : 1, muzzle, d, hit, eject, left.clone().multiplyScalar(s));
      gunAudio.shot(muzzle);
      rounds++;
    }
    const firing = trigger && upper.spin >= V.fireFrom;
    gunAudio.update(dt, trigger, firing, upper.spin, [rampart.muzzle(1, new THREE.Vector3()), rampart.muzzle(-1, new THREE.Vector3())]);
  }
  sfx.update();
  steps.update(dt);
  gunFx.update(dt);

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

  const [a, b] = sim.feet;
  const misses = sim.stats.overreach / Math.max(1, sim.stats.frames * 2);
  const torsoRel = ((((upper.torsoYaw - sim.heading) * 180) / Math.PI + 540) % 360) - 180;
  app.hud.set("walk", `${sim.speed.toFixed(1)} m/s · ${(stepTimes.length / 3).toFixed(1)} steps/s · ${cmd.sprint ? "sprint" : "walk"}${auto ? " (demo)" : ""}`);
  app.hud.set("feet", `L ${a.swinging ? "swing" : "planted"} · R ${b.swinging ? "swing" : "planted"} · reach misses ${(misses * 100).toFixed(2)}%`);
  if (rampart) app.hud.set("guns", `torso ${torsoRel.toFixed(0)}° from legs · spin ${(upper.spin * 100).toFixed(0)}% · ${rounds} rounds${sfx.running ? "" : " · click for sound"}`);
});
