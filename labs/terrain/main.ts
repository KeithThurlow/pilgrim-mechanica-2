// Terrain lab: the dune field streaming around a moving point (stand-in for the convoy).
// Tune the dune shape, streaming and light; watch build cost in the HUD while the marker drives.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createApp } from "../../src/core/app";
import { installReport } from "../../src/core/report";
import { Selector } from "../../src/core/select";
import { tweakPanel, type Param } from "../../src/core/tweaks";
import { DuneField, TERRAIN_DEFAULTS, TERRAIN_PARAMS } from "../../src/world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS, STREAM_PARAMS } from "../../src/world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS } from "../../src/world/look";
import { BIOME_DEFAULTS, BIOME_PARAMS } from "../../src/world/biomes";
import { ROCK_DEFAULTS, ROCK_PARAMS } from "../../src/world/rock";
import { SHALLOWS_DEFAULTS, SHALLOWS_PARAMS } from "../../src/world/shallows";

const app = await createApp(document.getElementById("view")!);
const { scene, camera } = app;

const DRIVE_DEFAULTS = { speed: 8, heading: 40 };
const DRIVE_PARAMS: Param[] = [
  { key: "speed", label: "Marker speed (m/s)", min: 0, max: 40, step: 0.5, group: "Drive", tip: "The convoy will be slow (2-4 m/s); fast here tests streaming" },
  { key: "heading", label: "Marker heading", min: 0, max: 360, step: 1, group: "Drive" },
];

const V = { ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DRIVE_DEFAULTS };
const DEFAULTS = { ...V };
if (app.params.has("seed")) V.seed = Number(app.params.get("seed"));

const field = new DuneField(V);
const streamer = new TerrainStreamer(field, V);
scene.add(streamer.group);
const look = new DesertLook(scene, app.renderer, V);

const shapeKeys = new Set([...TERRAIN_PARAMS, ...BIOME_PARAMS, ...ROCK_PARAMS, ...SHALLOWS_PARAMS].filter((p) => p.onRelease).map((p) => p.key).concat(["chunkSize", "segments"]));
let running = !app.params.has("shot");
let selector: Selector | null = null;
let picking = false;
const panel = tweakPanel({
  id: "terrain-lab",
  title: "Terrain lab",
  params: [...DRIVE_PARAMS, ...BIOME_PARAMS, ...ROCK_PARAMS, ...SHALLOWS_PARAMS, ...TERRAIN_PARAMS, ...STREAM_PARAMS, ...LOOK_PARAMS],
  values: V,
  defaults: DEFAULTS,
  actions: [
    { label: "Driving", onClick: () => { running = !running; }, active: () => running },
    { label: "Next border", onClick: () => toBorder() },
    { label: "New seed", onClick: () => { V.seed = 1 + Math.floor(Math.random() * 99); field.update(); streamer.rebuildAll(); } },
  ],
  topics: [
    { id: "biomes", label: "Biomes", groups: ["Biome map", "Rocky ground", "Shallows"] },
    { id: "dunes", label: "Dunes", groups: ["Dunes", "Shape", "Sand surface", "Streaming"] },
    { id: "drive", label: "Marker", groups: ["Drive"] },
    { id: "light", label: "Light", groups: ["Look"] },
  ],
  onFocus: () => { if (!picking) selector?.clear(); },
  onChange: (k) => { if (shapeKeys.has(k)) { field.update(); streamer.rebuildAll(); } },
});

// The marker: a tall post so it reads from far out.
const marker = new THREE.Group();
const post = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 6), new THREE.MeshStandardMaterial({ color: 0x9a3b24, roughness: 0.7 }));
post.position.y = 3;
post.castShadow = true;
marker.add(post);
scene.add(marker);

// Hold V and click: the marker, the ground (dunes) or the sky (light).
selector = new Selector(app, {
  items: [{ topic: "drive", label: "Marker (the convoy stand-in)", objects: () => [marker] }],
  ground: { topic: "dunes", label: "Dunes", field },
  sky: { topic: "light", label: "Light and sky" },
  onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
});
const sel = selector;
installReport(app, "terrain", V, () => ({ selected: sel.selection, topic: panel.focused }));

const focus = new THREE.Vector3();
camera.position.set(-60, 70, -60);
if (app.params.get("view") === "high") { camera.position.set(-1, 420, 1); look.fogOn = false; }
const controls = new OrbitControls(camera, app.renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.target.copy(focus);
field.update(); // apply any saved or URL values loaded by the panel

const NAMES = ["desert", "rocky", "shallows"];
function dominant(x: number, z: number) {
  const w = field.biomes!.weights(x, z);
  return w.desert >= w.rocky && w.desert >= w.shallows ? 0 : w.rocky >= w.shallows ? 1 : 2;
}
/** Drive the marker along its heading to the next biome border and stop just short of it, facing across. */
function toBorder() {
  if (!field.biomes) return;
  const h = (V.heading * Math.PI) / 180, dx = Math.sin(h), dz = Math.cos(h);
  const start = dominant(focus.x, focus.z);
  for (let t = 20; t < 40000; t += 20) {
    if (dominant(focus.x + dx * t, focus.z + dz * t) !== start) {
      focus.x += dx * (t - V.biomeBlend * 0.75); focus.z += dz * (t - V.biomeBlend * 0.75);
      break;
    }
  }
  streamer.rebuildAll();
}
// ?biome=desert|rocky|shallows shows only that one; ?border drives to the first border along the heading.
const only = app.params.get("biome");
if (only && NAMES.includes(only)) V.biomeOnly = NAMES.indexOf(only);
else if (only === "mix") V.biomeOnly = -1;
field.update();
if (app.params.has("border")) toBorder();
streamer.fill(focus.x, focus.z);

app.onTick((dt) => {
  if (running) {
    const h = (V.heading * Math.PI) / 180;
    focus.x += Math.sin(h) * V.speed * dt;
    focus.z += Math.cos(h) * V.speed * dt;
  }
  focus.y = field.height(focus.x, focus.z);
  marker.position.copy(focus);
  marker.rotation.y = (V.heading * Math.PI) / 180;

  // Follow: move camera and orbit target by the focus's change.
  const d = focus.clone().sub(controls.target);
  camera.position.add(d);
  controls.target.add(d);
  controls.update();

  streamer.update(focus.x, focus.z);
  // Haze counts from the camera, and the shadow area grows with distance so dune shadows reach across the view.
  const camDist = camera.position.distanceTo(focus);
  look.update(focus, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40));

  const s = streamer.stats;
  app.hud.set("chunks", `chunks ${s.loaded} · built ${s.built} in ${s.buildMs.toFixed(1)} ms · queued ${s.pending}`);
  const w = field.biomes ? field.biomes.weights(focus.x, focus.z) : null;
  const bio = w ? ` · desert ${(w.desert * 100).toFixed(0)}% rocky ${(w.rocky * 100).toFixed(0)}% shallows ${(w.shallows * 100).toFixed(0)}%` : "";
  app.hud.set("pos", `x ${focus.x.toFixed(0)} z ${focus.z.toFixed(0)} · ground ${focus.y.toFixed(1)} m${bio}`);
});
