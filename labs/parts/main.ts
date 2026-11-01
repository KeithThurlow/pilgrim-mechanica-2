// Parts lab: the generated parts (tools/partgen/, docs/proposal-partgen.md) from public/models/gen/index.json, judged
// where it counts: on the Rampart from the game camera, in place of its own part (a hull on the waist, a hull weapon
// on both gun pivots in place of the miniguns, a shoulder weapon on both shoulders), and on a stand by the start for
// scale, sockets as markers. WASD walks the mech, the mouse aims it. The Fit sliders move, turn and scale the part on
// its mount; "Copy fit" puts the command that bakes them into the part's GLBs on the clipboard (tools/partgen/setfit.ts).
// Flags: ?part=<id>, ?cam=game|close, ?zoom=metres, ?set=key:value.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS, LIGHT_GROUPS } from "../../src/world/look";
import { WalkerSim } from "../../src/mech/walker";
import { WALKER_DEFAULTS } from "../../src/mech/walkerTuning";
import { UpperSim, UPPER_DEFAULTS } from "../../src/mech/upper";
import { LEG_TYPES } from "../../src/mech/legTypes";
import { RampartBody, mechLegType } from "../../src/mech/rampart";
import type { Aim } from "../../src/mech/upper";
import { Keys } from "../../src/core/input";
import { screenToGround } from "../../src/world/raycast";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../../src/look/toon";

const app = await createApp(document.getElementById("view")!);
const { scene, camera, params } = app;
const canvas = app.renderer.domElement;

const PARTS_DEFAULTS = { onRampart: 1, standAt: 6, turnSpeed: 15, sockets: 1, partTint: 0 };
const FIT_DEFAULTS = { fitX: 0, fitY: 0, fitZ: 0, fitYaw: 0, fitPitch: 0, fitRoll: 0, fitScale: 1 };
const FIT_PARAMS: Param[] = [
  { key: "fitX", label: "Across (m, + outward)", min: -1.5, max: 1.5, step: 0.01, group: "Fit on its mount" },
  { key: "fitY", label: "Up (m)", min: -1.5, max: 1.5, step: 0.01, group: "Fit on its mount" },
  { key: "fitZ", label: "Forward (m)", min: -1.5, max: 1.5, step: 0.01, group: "Fit on its mount" },
  { key: "fitYaw", label: "Turn (°)", min: -180, max: 180, step: 1, group: "Fit on its mount" },
  { key: "fitPitch", label: "Pitch (°)", min: -90, max: 90, step: 1, group: "Fit on its mount" },
  { key: "fitRoll", label: "Roll (°)", min: -90, max: 90, step: 1, group: "Fit on its mount" },
  { key: "fitScale", label: "Scale", min: 0.3, max: 2, step: 0.01, group: "Fit on its mount" },
];
const PARTS_PARAMS: Param[] = [
  { key: "onRampart", label: "Hulls on the Rampart", min: 0, max: 1, step: 1, group: "Parts" },
  { key: "standAt", label: "Stand beside it (m)", min: 3, max: 15, step: 0.1, group: "Parts" },
  { key: "turnSpeed", label: "Stand turns (°/s)", min: 0, max: 90, step: 1, group: "Parts" },
  { key: "sockets", label: "Show sockets", min: 0, max: 1, step: 1, group: "Parts" },
  { key: "partTint", label: "Olive tint over the colours", min: 0, max: 1, step: 0.01, group: "Parts" },
];
const V = {
  ...TOON_DEFAULTS, ...PARTS_DEFAULTS, ...FIT_DEFAULTS, ...ISO_DEFAULTS, ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS,
  ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, radius: 3, shadowBox: 24, biomeOnly: 0,
};
const DEFAULTS = { ...V };

const field = new DuneField(V);
field.v = { ...V, height: 0, swell: 0, bumps: 0 };
field.update();
const streamer = new TerrainStreamer(field, V);
scene.add(streamer.group);
const desert = new DesertLook(scene, app.renderer, V);
const toon = new ToonLook(V);

const rampart = await RampartBody.load(toon);
Object.assign(V, LEG_TYPES[mechLegType()].values, rampart.legValues());
const sim = new WalkerSim(V, field), upper = new UpperSim(V);
sim.reset(0, 0, 0);
upper.reset(0);
scene.add(rampart.root);
const torso = rampart.root.getObjectByName("torso") as THREE.Mesh | undefined;

// ---- The generated parts
interface Entry { id: string; kind: string; lane: string; label?: string }
const list: Entry[] = await fetch("/models/gen/index.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
const pick = document.getElementById("part") as HTMLSelectElement;
const info = document.getElementById("info")!;
for (const e of list) pick.add(new Option(`${e.id} · ${e.kind} · lane ${e.lane.toUpperCase()}`, e.id));
if (!list.length) info.textContent = "No generated parts yet: make one with npx tsx tools/partgen/run.ts (docs/proposal-partgen.md)";
let current = list.find((e) => e.id === params.get("part"))?.id ?? list[0]?.id;
if (current) pick.value = current;

const loader = new GLTFLoader();
const stand = new THREE.Group();
scene.add(stand);
/** The fit groups on the mech (one per side), which the Fit sliders move; the part sits inside, its base at the origin. */
let fits: THREE.Group[] = [];
const markerGeo = new THREE.SphereGeometry(0.08, 12, 8), markerMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, depthTest: false });
const discMat = new THREE.MeshStandardMaterial({ color: 0x8a8273, roughness: 0.85 });
let meshes: THREE.Mesh[] = [], markers: THREE.Object3D[] = [], shownKind = "";

/** A part as the game would show it: its meshes on the toon look, its empties as markers. */
async function load(id: string) {
  const gltf = await loader.loadAsync(`/models/gen/${id}.glb?v=${Date.now()}`);
  const root = gltf.scene, found: THREE.Mesh[] = [], empties: THREE.Object3D[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); else if (o !== root && !o.children.length) empties.push(o); });
  for (const m of found) toon.apply(m);
  for (const e of empties) { const s = new THREE.Mesh(markerGeo, markerMat); s.renderOrder = 10; e.add(s); markers.push(s); }
  return { root, found };
}

async function build() {
  stand.clear(); markers = []; meshes = [];
  for (const f of fits) f.removeFromParent();
  fits = [];
  if (torso) torso.visible = true;
  rampart.showPod(1, true); rampart.showPod(-1, true);
  if (!current) return;
  const e = list.find((x) => x.id === current)!;
  shownKind = e.kind;
  const a = await load(current);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 0.25, 32), discMat);
  disc.position.y = 0.125; disc.receiveShadow = true;
  const b = new THREE.Box3().setFromObject(a.root), size = b.getSize(new THREE.Vector3());
  disc.scale.set(Math.max(size.x, size.z) * 0.6, 1, Math.max(size.x, size.z) * 0.6);
  a.root.position.y = 0.25;
  stand.add(disc, a.root);
  meshes.push(...a.found);
  if (V.onRampart > 0.5) await mountOnMech(e.kind, current);
  applyTint();
  const side = await fetch(`/models/gen/${current}.json`).then((r) => r.json()).catch(() => ({}));
  info.textContent = `${current} · ${e.kind} · lane ${e.lane.toUpperCase()} · ${side.trisIn ?? "?"} → ${side.tris ?? "?"} tris · ${(side.size ?? []).map((v: number) => v.toFixed(2)).join("×")} m · ${side.prompt ?? side.from ?? ""}`;
}
/** Bounds of a group's own meshes, in that group's frame. */
function localBox(g: THREE.Object3D, only?: (o: THREE.Object3D) => boolean) {
  const b = new THREE.Box3(), inv = new THREE.Matrix4();
  g.updateMatrixWorld(true);
  inv.copy(g.matrixWorld).invert();
  for (const o of g.children) {
    if (!(o as THREE.Mesh).isMesh || (only && !only(o))) continue;
    const m = o as THREE.Mesh;
    m.geometry.computeBoundingBox();
    b.union(m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
  }
  return b;
}

/**
 * Put the part on the Rampart where the game would: a hull in place of its hull (its base on the old hull's base,
 * centred over it), a hull weapon on each gun pivot in place of the minigun pod (centred where the pod was; the left
 * one mirrored, as the game mirrors the pod), a shoulder weapon on each shoulder mount (its base on the socket).
 */
async function mountOnMech(kind: string, id: string) {
  const sides: { parent: THREE.Object3D; at: THREE.Vector3; mirror: boolean }[] = [];
  if (kind === "hull" && torso) {
    const tb = localBox(torso.parent!, (o) => o === torso);
    sides.push({ parent: torso.parent!, at: new THREE.Vector3((tb.min.x + tb.max.x) / 2, tb.min.y, (tb.min.z + tb.max.z) / 2), mirror: false });
    torso.visible = false;
  } else if (kind === "hullweapon") {
    for (const sd of [-1, 1] as const) {
      const pivot = rampart.mount(sd > 0 ? "left" : "right");
      const pb = localBox(pivot);
      rampart.showPod(sd, false);
      // The part's centre (its base is at y 0) goes where the pod's centre was.
      sides.push({ parent: pivot, at: new THREE.Vector3((pb.min.x + pb.max.x) / 2, pb.min.y, (pb.min.z + pb.max.z) / 2), mirror: sd > 0 });
    }
  } else if (kind === "shoulder") {
    for (const sd of [-1, 1] as const) sides.push({ parent: rampart.mount(sd > 0 ? "Shoulder_L" : "Shoulder_R"), at: new THREE.Vector3(), mirror: sd > 0 });
  }
  for (const s of sides) {
    const h = await load(id);
    const base = new THREE.Group(), fit = new THREE.Group();
    base.position.copy(s.at);
    if (s.mirror) base.scale.x = -1;
    base.add(fit); fit.add(h.root);
    s.parent.add(base);
    fit.userData.base = base;
    fits.push(fit);
    meshes.push(...h.found);
  }
  applyFit();
}

/** The Fit sliders onto every mounted copy ("across" is outward on either side: the left copy is mirrored). */
function applyFit() {
  const D = Math.PI / 180;
  for (const f of fits) {
    f.position.set(-V.fitX, V.fitY, V.fitZ);
    f.rotation.set(V.fitPitch * D, V.fitYaw * D, V.fitRoll * D, "YXZ");
    f.scale.setScalar(V.fitScale);
  }
}

/** The command that bakes the current fit into the part's files (all levels of detail and its sockets). */
function fitCommand() {
  const f = [V.fitX, V.fitY, V.fitZ, V.fitYaw, V.fitPitch, V.fitRoll, V.fitScale].map((v) => +v.toFixed(3)).join(",");
  return `npx tsx tools/partgen/setfit.ts ${current} ${f}`;
}

function applyTint() {
  const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0x8a9468), V.partTint).getHex();
  for (const m of meshes) toon.tint(m, tint);
  for (const s of markers) s.visible = V.sockets > 0.5;
}
pick.addEventListener("change", () => { current = pick.value; void build(); });
addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement || !list.length) return;
  if (ev.key === "[" || ev.key === "]") {
    const i = (list.findIndex((x) => x.id === current) + (ev.key === "]" ? 1 : list.length - 1)) % list.length;
    current = list[i].id; pick.value = current; void build();
  }
  if (ev.code === "KeyC") setCam(camName === "game" ? "close" : "game");
});

// ---- Camera
const iso = new IsoCamera(camera, canvas, V);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
let camName = params.get("cam") === "close" ? "close" : "game";
const focus = new THREE.Vector3();
function setCam(name: string) {
  camName = name;
  iso.enabled = name === "game";
  controls.enabled = !iso.enabled;
  if (iso.enabled) { iso.snap(focus); return; }
  controls.target.set(-V.standAt / 2, 2.5, 0);
  camera.position.set(4, 6, 12);
  controls.update();
}
if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));

// ---- Panel and the hold-V selector
let selector: Selector | null = null, picking = false;
const panel = tweakPanel({
  id: "parts-lab", title: "Parts", params: [...PARTS_PARAMS, ...FIT_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...LOOK_PARAMS], values: V, defaults: DEFAULTS,
  actions: [
    { label: "Next part", onClick: () => { if (!list.length) return; current = list[(list.findIndex((x) => x.id === current) + 1) % list.length].id; pick.value = current; void build(); } },
    { label: "Game camera", onClick: () => setCam(camName === "game" ? "close" : "game"), active: () => camName === "game" },
    { label: "Copy fit", onClick: () => { const c = fitCommand(); void navigator.clipboard?.writeText(c); console.log(c); info.textContent = c; } },
    { label: "Reset fit", onClick: () => { Object.assign(V, FIT_DEFAULTS); applyFit(); panel.refresh(); } },
  ],
  topics: [
    { id: "parts", label: "Generated part", groups: ["Parts"] },
    { id: "fit", label: "Fit", groups: ["Fit on its mount"] },
    { id: "unit", label: "Unit look", groups: ["Cel look"] },
    { id: "camera", label: "Camera", groups: ["Camera"] },
    { id: "light", label: "Light", groups: LIGHT_GROUPS },
  ],
  onFocus: () => { if (!picking) selector?.clear(); },
  onChange: (k) => { if (k === "onRampart") void build(); if (k === "partTint" || k === "sockets") applyTint(); if (k in FIT_DEFAULTS) applyFit(); },
});
selector = new Selector(app, {
  items: [
    { topic: "parts", label: "Generated part (on the stand)", objects: () => [stand] },
    { topic: "fit", label: "Generated part (fit on the mech)", objects: () => fits },
    { topic: "unit", label: "Rampart (unit look)", objects: () => [rampart.root] },
  ],
  ground: { topic: "light", label: "Light", field },
  sky: { topic: "light", label: "Light and sky" },
  onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
});
const sel = selector;
installReport(app, "parts", V, () => ({ selected: sel.selection, topic: panel.focused, part: current }));

await build();
setCam(camName);
streamer.fill(0, 0);

let spin = 0, mouse: { x: number; y: number } | null = null;
const keys = new Keys(), stick = new THREE.Vector3(), aimPt = new THREE.Vector3(), tmp = new THREE.Vector3();
canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") mouse = { x: e.clientX, y: e.clientY }; });
app.onTick((dt) => {
  // WASD walks the mech (relative to the screen), the mouse aims it; no input, it stands and looks ahead.
  keys.move(camera, stick);
  const cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
  let aim: Aim = { x: sim.pos.x + Math.sin(sim.heading) * 30, y: 0, z: sim.pos.z + Math.cos(sim.heading) * 30 };
  if (mouse && camName === "game" && screenToGround(mouse.x, mouse.y, canvas, camera, field, aimPt)) aim = { x: aimPt.x, y: aimPt.y, z: aimPt.z };
  rampart.shoulderLine(tmp);
  const sub = Math.max(1, Math.ceil(dt * 120));
  for (let i = 0; i < sub; i++) { sim.update(dt / sub, cmd); upper.update(dt / sub, sim.heading, tmp, aim, false); }
  rampart.update(sim, upper);
  // The stand stays by the start, on the mech's right (-X), which faces the game camera.
  stand.position.set(-V.standAt, 0, 0);
  spin += (V.turnSpeed * Math.PI / 180) * dt;
  stand.rotation.y = spin;
  // The camera follows the mech once it walks off; at the start it frames the mech and the stand.
  const near = Math.hypot(sim.pos.x, sim.pos.z) < 2;
  focus.set(near ? -V.standAt / 2 : sim.pos.x, 0, near ? 0 : sim.pos.z);
  if (iso.enabled) iso.update(focus, dt);
  if (controls.enabled) { if (!near) controls.target.lerp(tmp.set(sim.pos.x, 2.5, sim.pos.z), Math.min(1, dt * 4)); controls.update(); }
  toon.update(camera, canvas.clientHeight);
  const camDist = camera.position.distanceTo(iso.enabled ? focus : controls.target);
  desert.update(iso.enabled ? focus : controls.target, camDist + 120, Math.max(1, camDist / 40), dt);
  streamer.update(focus.x, focus.z);
  app.hud.set("part", current ? `${current} (${shownKind})` : "none");
});
