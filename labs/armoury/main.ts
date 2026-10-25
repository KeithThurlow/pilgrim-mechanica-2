// Armoury lab: every weapon model (src/weapons/library.ts) with its moving parts cycling: on the Rampart from the
// game camera (the view that matters), alone on a turntable, or all of them in a line-up. Paint, finish, laser and
// fit are sliders. A Blender model dropped at public/models/weapons/<id>.glb shows here in place of its stand-in.
// Flags: ?model=<id>, ?view=rampart|turntable|lineup, ?cam=game|close, ?zoom=metres, ?dt=0.033, ?t=seconds (start
// the cycle there), ?still (no cycle), ?mech=<variant> (a Rampart variant), ?set=key:value.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createApp } from "../../src/core/app";
import { installReport } from "../../src/core/report";
import { Selector } from "../../src/core/select";
import { tweakPanel, type Param } from "../../src/core/tweaks";
import { IsoCamera, ISO_DEFAULTS, ISO_PARAMS } from "../../src/core/isoCamera";
import { DuneField, TERRAIN_DEFAULTS } from "../../src/world/terrain";
import { BIOME_DEFAULTS } from "../../src/world/biomes";
import { ROCK_DEFAULTS } from "../../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../../src/world/shallows";
import { TerrainStreamer, STREAM_DEFAULTS } from "../../src/world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS } from "../../src/world/look";
import { WalkerSim } from "../../src/mech/walker";
import { WALKER_DEFAULTS } from "../../src/mech/walkerTuning";
import { UpperSim, UPPER_DEFAULTS } from "../../src/mech/upper";
import { LEG_TYPES } from "../../src/mech/legTypes";
import { RampartBody, mechLegType } from "../../src/mech/rampart";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../../src/look/toon";
import { CATALOG, entry, preloadWeapons, createWeapon, sourceOf, trianglesOf, type WeaponModel } from "../../src/weapons/library";
import { WeaponLook, WEAPON_LOOK_DEFAULTS, WEAPON_LOOK_PARAMS } from "../../src/weapons/weaponLook";
import { LASER_DEFAULTS, LASER_PARAMS } from "../../src/weapons/laserSight";
import { MOUNT_DEFAULTS, MOUNT_PARAMS, mountOnRampart, placeOnRampart } from "../../src/weapons/mounts";
import { WeaponDemo } from "../../src/weapons/demo";
import { SCHEMES } from "../../src/weapons/palette";

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;

const VIEWER_DEFAULTS = { turnSpeed: 20, cycleOn: 1, cyclePeriod: 5, heatRise: 0.3, heatCool: 4, aimSweep: 1 };
const VIEWER_PARAMS: Param[] = [
  { key: "turnSpeed", label: "Turntable speed (°/s)", min: 0, max: 120, step: 1, group: "Viewer" },
  { key: "cycleOn", label: "Cycle the moving parts", min: 0, max: 1, step: 1, group: "Viewer" },
  { key: "cyclePeriod", label: "Cycle length (s)", min: 1, max: 15, step: 0.1, group: "Viewer" },
  { key: "heatRise", label: "Heat per shot", min: 0, max: 1, step: 0.01, group: "Viewer" },
  { key: "heatCool", label: "Cool down (s)", min: 0.5, max: 20, step: 0.1, group: "Viewer" },
  { key: "aimSweep", label: "Rampart sweeps its aim", min: 0, max: 1, step: 1, group: "Viewer" },
];

const V = {
  ...TOON_DEFAULTS, ...WEAPON_LOOK_DEFAULTS, ...LASER_DEFAULTS, ...MOUNT_DEFAULTS, ...VIEWER_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS,
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, radius: 3, shadowBox: 24, biomeOnly: 0,
};
const DEFAULTS = { ...V };
if (params.has("still")) V.cycleOn = 0;

// Ground: the desert's flat sand (no dunes, so every model sits at the same height).
const field = new DuneField(V);
field.v = { ...V, height: 0, swell: 0, bumps: 0 };
field.update();
const streamer = new TerrainStreamer(field, V);
scene.add(streamer.group);
const desert = new DesertLook(scene, app.renderer, V);
const toon = new ToonLook(V);
const look = new WeaponLook(V, toon);

// The Rampart, standing, guns tracking an aim point.
const rampart = await RampartBody.load(toon);
Object.assign(V, LEG_TYPES[mechLegType()].values, rampart.legValues());
const sim = new WalkerSim(V, field), upper = new UpperSim(V);
sim.reset(0, 0, 0);
upper.reset(0);
scene.add(rampart.root);

await preloadWeapons();
const ids = CATALOG.filter((c) => c.side !== "left").map((c) => c.id);

// ---- UI: model and view pickers
const pick = document.getElementById("model") as HTMLSelectElement;
for (const id of ids) {
  const e = entry(id), src = sourceOf(id);
  pick.add(new Option(`${e.label} · ${src === "stand-in" ? "stand-in" : "GLB"} · ${trianglesOf(id)} tris`, id));
}
const viewPick = document.getElementById("view-mode") as HTMLSelectElement;
const info = document.getElementById("info")!;
let current = params.get("model") && ids.includes(params.get("model")!) ? params.get("model")! : "rocket-launcher-hull";
let view = (["rampart", "turntable", "lineup"].includes(params.get("view") ?? "") ? params.get("view") : "rampart") as "rampart" | "turntable" | "lineup";
pick.value = current;
viewPick.value = view;
pick.addEventListener("change", () => { current = pick.value; build(); });
viewPick.addEventListener("change", () => { view = viewPick.value as typeof view; build(); });
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === "[" || e.key === "]") {
    const i = (ids.indexOf(current) + (e.key === "]" ? 1 : ids.length - 1)) % ids.length;
    current = ids[i]; pick.value = current; build();
  }
  if (e.code === "KeyC" && view === "rampart") setCam(camName === "game" ? "close" : "game");
});

// ---- What's shown
interface Shown { w: WeaponModel; demo: WeaponDemo; side: "left" | "right"; stand?: THREE.Object3D }
let shown: Shown[] = [];
const stands = new THREE.Group();
scene.add(stands);
const standGeo = new THREE.CylinderGeometry(1, 1.1, 0.25, 32);
const standMat = new THREE.MeshStandardMaterial({ color: 0x8a8273, roughness: 0.85 });

function clear() {
  for (const s of shown) s.w.dispose();
  shown = [];
  stands.clear();
  rampart.showPod(1, true); rampart.showPod(-1, true);
}

/** Size of a model's parts (for framing). */
function sizeOf(w: WeaponModel) {
  w.root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  for (const m of w.meshes) b.expandByObject(m);
  return b;
}

const t0 = Number(params.get("t") ?? 0);
function addOnRampart(id: string, side: "left" | "right") {
  const w = createWeapon(id, look);
  mountOnRampart(w, rampart, side, V);
  shown.push({ w, demo: new WeaponDemo(w), side });
}

function build() {
  clear();
  const e = entry(current);
  rampart.root.visible = view === "rampart";
  if (view === "rampart") {
    const left = e.side === "both" ? e.id : e.mirror ?? e.id;
    if (e.mount === "two_handed" || e.mount === "back" || e.mount === "belt" || e.mount === "projectile") addOnRampart(e.id, "right");
    else { addOnRampart(e.id, "right"); addOnRampart(left, "left"); }
  } else {
    const list = view === "lineup" ? ids : [current];
    const cols = Math.ceil(Math.sqrt(list.length * 1.6));
    list.forEach((id, i) => {
      const w = createWeapon(id, look);
      const stand = new THREE.Group();
      const x = view === "lineup" ? ((i % cols) - (cols - 1) / 2) * 5 : 0, z = view === "lineup" ? -Math.floor(i / cols) * 5 : 0;
      stand.position.set(x, 0, z);
      const disc = new THREE.Mesh(standGeo, standMat);
      disc.position.y = 0.125; disc.receiveShadow = disc.castShadow = true;
      stand.add(disc);
      w.root.scale.setScalar(w.entry.fit * V.weaponScale);
      const b = sizeOf(w);
      w.root.position.set(-(b.min.x + b.max.x) / 2, 0.25 - b.min.y + 0.35, -(b.min.z + b.max.z) / 2);
      disc.scale.set(Math.max(0.5, (b.max.z - b.min.z) * 0.36), 1, Math.max(0.5, (b.max.z - b.min.z) * 0.36));
      stand.add(w.root);
      stands.add(stand);
      shown.push({ w, demo: new WeaponDemo(w), side: "right", stand });
    });
    // Frame the model: its middle, from a distance by its biggest side (turntable); the whole grid (line-up).
    const size = sizeOf(shown[0].w).getSize(new THREE.Vector3()), big = Math.max(size.x, size.y, size.z);
    const span = view === "lineup" ? cols * 5 : big;
    controls.target.set(0, view === "lineup" ? 1 : 0.6 + size.y * 0.5, view === "lineup" ? -Math.floor((list.length - 1) / cols) * 2.5 : 0);
    const d = view === "lineup" ? span * 0.95 : big * 1.05 + 0.8;
    camera.position.copy(controls.target).add(new THREE.Vector3(d * 0.55, d * 0.5, d * 0.75));
    controls.update();
  }
  const src = sourceOf(current);
  const w0 = shown[0]?.w;
  info.textContent = `${e.label} · ${e.mount} · ${src === "stand-in" ? "code stand-in" : src === "glb-mirrored" ? "GLB (mirrored)" : "GLB"} · ${trianglesOf(current)} tris · sockets: ${w0 ? Object.keys(w0.sockets).join(" ") : ""} · moving: ${w0 ? w0.movingParts().join(" ") : ""}`;
  iso.enabled = view === "rampart" && camName === "game";
  controls.enabled = !iso.enabled;
  if (view === "rampart") setCam(camName);
}

// ---- Cameras: the game camera on the Rampart, orbit for close looks and the turntables.
const iso = new IsoCamera(camera, canvas, V);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
let camName = params.get("cam") === "close" ? "close" : "game";
const focus = new THREE.Vector3(0, 0, 0);
function setCam(name: string) {
  camName = name;
  iso.enabled = view === "rampart" && name === "game";
  controls.enabled = !iso.enabled;
  if (iso.enabled) { iso.snap(focus); return; }
  controls.target.set(0, 4, 0);
  camera.position.set(9, 7.5, 10);
  controls.update();
}
if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));

// ---- Panel and selection
let selector: Selector | null = null;
let picking = false;
const panel = tweakPanel({
  id: "armoury-lab",
  title: "Armoury",
  params: [...WEAPON_LOOK_PARAMS, ...LASER_PARAMS, ...MOUNT_PARAMS, ...VIEWER_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...LOOK_PARAMS],
  values: V,
  defaults: DEFAULTS,
  actions: [
    { label: "Next model", onClick: () => { current = ids[(ids.indexOf(current) + 1) % ids.length]; pick.value = current; build(); } },
    { label: "Game camera", onClick: () => { if (view !== "rampart") { view = "rampart"; viewPick.value = view; build(); } setCam(camName === "game" ? "close" : "game"); }, active: () => view === "rampart" && camName === "game" },
  ],
  topics: [
    { id: "paint", label: "Weapon paint", groups: ["Weapon paint", "Weapon finish"] },
    { id: "laser", label: "Laser", groups: ["Targeting laser"] },
    { id: "fit", label: "Fit", groups: ["Fit on the Rampart"] },
    { id: "viewer", label: "Viewer", groups: ["Viewer"] },
    { id: "unit", label: "Unit look", groups: ["Cel look"] },
    { id: "camera", label: "Camera", groups: ["Camera"] },
    { id: "light", label: "Light", groups: ["Look"] },
  ],
  onFocus: () => { if (!picking) selector?.clear(); },
  onChange: (k) => {
    if (k === "weaponScheme") for (const s of shown) s.w.setScheme(V.weaponScheme);
    if (k in MOUNT_DEFAULTS) { if (view === "rampart") for (const s of shown) placeOnRampart(s.w, s.side, V); else build(); }
  },
});
selector = new Selector(app, {
  items: [
    { topic: "paint", label: "Weapon (paint and finish)", objects: () => shown.map((s) => s.w.root) },
    { topic: "fit", label: "Rampart (weapon fit)", objects: () => (view === "rampart" ? [rampart.root] : []) },
  ],
  ground: { topic: "light", label: "Light", field },
  sky: { topic: "light", label: "Light and sky" },
  onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
});
const sel = selector;
installReport(app, "armoury", V, () => ({ selected: sel.selection, topic: panel.focused, model: current, view }));

build();
streamer.fill(0, 0);

// ---- Loop
const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
let clock = t0, spin = 0;
const aim = { x: 0, y: 0, z: 30 }, tmp = new THREE.Vector3();
app.onTick((rawDt) => {
  const dt = fixedDt || rawDt;
  clock += dt;
  if (view === "rampart") {
    // Stand and track a slowly sweeping aim point ahead.
    const a = V.aimSweep > 0.5 ? Math.sin(clock * 0.35) * 0.5 : 0;
    aim.x = Math.sin(a) * 30; aim.z = Math.cos(a) * 30; aim.y = field.height(aim.x, aim.z);
    rampart.shoulderLine(tmp);
    const sub = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < sub; i++) { sim.update(dt / sub, { x: 0, z: 0, sprint: false }); upper.update(dt / sub, sim.heading, tmp, aim, false); }
    rampart.update(sim, upper);
    focus.set(sim.pos.x, sim.pos.y, sim.pos.z);
    if (iso.enabled) iso.update(focus, dt);
  } else {
    spin += (V.turnSpeed * Math.PI / 180) * dt;
    for (const s of shown) if (s.stand) s.stand.rotation.y = spin;
  }
  if (controls.enabled) controls.update();
  for (const s of shown) {
    if (V.cycleOn > 0.5) s.demo.update(clock, dt, V.cyclePeriod, V.heatRise);
    s.w.tick(dt, V.heatCool);
    s.w.laser?.aimAt(view === "rampart" ? tmp.set(aim.x, aim.y, aim.z) : null);
    s.w.laser?.update(V, clock);
  }
  toon.update(camera, canvas.clientHeight);
  look.update(camera, canvas.clientHeight);
  const camDist = camera.position.distanceTo(view === "rampart" ? focus : controls.target);
  desert.update(view === "rampart" ? focus : controls.target, camDist + 120, Math.max(1, camDist / 40));
  streamer.update(focus.x, focus.z);
  app.hud.set("model", `${entry(current).label} · ${SCHEMES[Math.round(V.weaponScheme)]?.name ?? ""}`);
});
