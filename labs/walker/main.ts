// Walker lab: the procedural walker on the streamed dunes, feet planted on the real ground.
// Auto walk wanders (with stops and sprints) until you take over with WASD or a click on the ground.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createApp } from "../../src/core/app";
import { tweakPanel } from "../../src/core/tweaks";
import { Keys, onGroundTap } from "../../src/core/input";
import { DuneField, TERRAIN_DEFAULTS, TERRAIN_PARAMS } from "../../src/world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS, STREAM_PARAMS } from "../../src/world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS } from "../../src/world/look";
import { WalkerSim, type MoveCommand } from "../../src/mech/walker";
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../../src/mech/walkerTuning";
import { WalkerBody } from "../../src/mech/walkerBody";
import { FootfallFx } from "../../src/fx/footfall";

const app = await createApp(document.getElementById("view")!);
const { scene, camera } = app;

const V = { ...WALKER_DEFAULTS, ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, radius: 3, shadowBox: 40 };
const DEFAULTS = { ...V };
// Review flags: ?flat (no dunes), ?walk=straight (constant heading, for side-on filmstrips), ?cam=close|side|feet.
const straight = app.params.get("walk") === "straight";

const field = new DuneField(V);
if (app.params.has("flat")) { field.v = { ...V, height: 0, swell: 0, bumps: 0 }; field.update(); }
const streamer = new TerrainStreamer(field, V);
scene.add(streamer.group);
const look = new DesertLook(scene, app.renderer, V);

const sim = new WalkerSim(V, field);
sim.reset(13, -40, 0.3);
const body = new WalkerBody();
scene.add(body.root);
const fx = new FootfallFx();
scene.add(fx.group);
const stepTimes: number[] = [];
let clock = 0;
const plateQ = (up: THREE.Vector3, yaw: number) => {
  const fw = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  fw.addScaledVector(up, -fw.dot(up)).normalize();
  const lf = new THREE.Vector3().crossVectors(up, fw).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lf, up, fw));
};
sim.onFootfall = (f, k) => {
  fx.footfall(f.planted, plateQ(f.plantedUp, f.plantedYaw), k);
  stepTimes.push(clock);
  while (stepTimes.length && clock - stepTimes[0] > 3) stepTimes.shift();
};

// Camera: a game view (50 degrees down, behind and above) that follows the walker; orbit and zoom freely.
const controls = new OrbitControls(camera, app.renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
controls.maxDistance = 160;
const follow = new THREE.Vector3().copy(sim.pelvis);
const CAMS: Record<string, [pitch: number, dist: number, yawFromHeading: number | null]> = {
  game: [50, 34, null],
  close: [16, 14, 0.9],
  side: [6, 12, Math.PI / 2],
  feet: [4, 7, 2.6],
};
let camName = app.params.get("cam") ?? "game";
function setCam(name: string) {
  camName = name;
  const [pitch, dist, yaw] = CAMS[name];
  const a = yaw === null ? Math.PI : sim.heading + yaw;
  const p = (pitch * Math.PI) / 180;
  controls.target.copy(follow);
  camera.position.copy(follow).add(new THREE.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)).multiplyScalar(dist));
  controls.update();
}

const keys = new Keys();
let auto = !app.params.has("manual");
let slow = false;
let goal: THREE.Vector3 | null = null;
onGroundTap(app.renderer.domElement, camera, streamer.group, (p) => { goal = p.clone(); auto = false; panel.refresh(); });

const shapeKeys = new Set([...TERRAIN_PARAMS.map((p) => p.key), "chunkSize", "segments"]);
const panel = tweakPanel({
  id: "walker-lab",
  title: "Walker lab",
  params: [...WALKER_PARAMS, ...TERRAIN_PARAMS, ...STREAM_PARAMS, ...LOOK_PARAMS],
  values: V,
  defaults: DEFAULTS,
  actions: [
    { label: "Auto walk", onClick: () => { auto = !auto; goal = null; }, active: () => auto },
    { label: "Slow-mo", onClick: () => { slow = !slow; }, active: () => slow },
    ...Object.keys(CAMS).map((n) => ({ label: n === "game" ? "Game cam" : n[0].toUpperCase() + n.slice(1), onClick: () => setCam(n), active: () => camName === n })),
  ],
  onChange: (k) => { if (shapeKeys.has(k)) { field.update(); streamer.rebuildAll(); } },
});

/** Wanders with long walks, the odd sprint and a stop now and then: deterministic, so shots repeat. */
function wander(t: number): MoveCommand {
  const seg = Math.floor(t / 8), local = t % 8;
  if (seg % 4 === 3 && local < 2.2) return { x: 0, z: 0, sprint: false };
  const a = 0.3 + 1.1 * Math.sin(t * 0.11) + 0.7 * Math.sin(t * 0.043 + 1.3);
  return { x: Math.sin(a), z: Math.cos(a), sprint: seg % 5 === 2 };
}

// The panel may have loaded saved or URL values: apply them before the first chunks are built.
field.update();
sim.reset(13, -40, 0.3);
streamer.fill(sim.pos.x, sim.pos.z);
follow.copy(sim.pelvis);
setCam(camName);
const stick = new THREE.Vector3();
let lastCamFollow = follow.clone();

app.onTick((rawDt) => {
  const dt = rawDt * (slow ? 0.25 : 1);
  clock += dt;
  keys.move(camera, stick);
  let cmd: MoveCommand;
  if (stick.lengthSq() > 0) { auto = false; goal = null; cmd = { x: stick.x, z: stick.z, sprint: keys.sprint }; }
  else if (goal) {
    const dx = goal.x - sim.pos.x, dz = goal.z - sim.pos.z, d = Math.hypot(dx, dz);
    if (d < 1.2) goal = null;
    const m = Math.min(1, d / 4);
    cmd = { x: (dx / d) * m, z: (dz / d) * m, sprint: d > 30 || keys.sprint };
  } else if (auto) cmd = straight ? { x: Math.sin(0.3), z: Math.cos(0.3), sprint: app.params.has("sprint") } : wander(clock);
  else cmd = { x: 0, z: 0, sprint: false };

  // Fixed 120 Hz steps for the sim, whatever the frame rate.
  const sub = Math.max(1, Math.ceil(dt * 120));
  for (let i = 0; i < sub; i++) sim.update(dt / sub, cmd);
  body.update(sim);
  fx.update(dt);

  follow.lerp(new THREE.Vector3(sim.pelvis.x, sim.pelvis.y - 1.2, sim.pelvis.z), Math.min(1, rawDt * 6));
  const delta = follow.clone().sub(lastCamFollow);
  camera.position.add(delta);
  controls.target.add(delta);
  lastCamFollow.copy(follow);
  controls.update();

  streamer.update(sim.pos.x, sim.pos.z);
  look.update(follow, V.radius * V.chunkSize);

  const [a, b] = sim.feet;
  const misses = sim.stats.overreach / Math.max(1, sim.stats.frames * 2);
  app.hud.set("walk", `${sim.speed.toFixed(1)} m/s · ${(stepTimes.length / 3).toFixed(1)} steps/s · ${cmd.sprint ? "sprint" : "walk"}${auto ? " (auto)" : goal ? " (to click)" : ""}`);
  app.hud.set("feet", `L ${a.swinging ? "swing " + (a.u * 100).toFixed(0) + "%" : "planted"} · R ${b.swinging ? "swing " + (b.u * 100).toFixed(0) + "%" : "planted"} · reach misses ${(misses * 100).toFixed(2)}%`);
  app.hud.set("chunks", `chunks ${streamer.stats.loaded} · ground ${field.height(sim.pos.x, sim.pos.z).toFixed(1)} m`);
});
