// Icons lab (Keith 2026-11-13: "better 2D images for the inventory"; docs/asset-pipeline.md): each item base's
// own model drawn alone on a clear background, sized to the item's grid cells, the way the inventory shows it.
// `npm run icons` (tools/icons.mjs) steps through every base here and saves public/icons/<base id>.png, so the
// pictures always come from the models the game draws. A base with no model of its own has no picture (the
// inventory keeps its line drawing).
//
// Flags: ?base=<id> (start on it), ?px=N (pixels per grid cell, 64), ?webgl. window.__icons: { ids, draw(id) }.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BASES, BASE_BY_ID, type Base } from "../../src/items/bases";
import { GRID_CLASSES, gridClassOfBase, itemCells } from "../../src/items/gridSize";
import { makeItem } from "../../src/items/generate";
import { ToonLook, TOON_DEFAULTS } from "../../src/look/toon";
import { WEAPON_MODELS, type ModelKind } from "../../src/weapons/models";
import { createWeapon, preloadWeapons } from "../../src/weapons/library";
import { weaponLookFor } from "../../src/weapons/modelSwap";
import { partFromGlb, partGlb } from "../../src/mech/partModels";
import { standInSensor } from "../../src/mech/sensorModels";
import { asset } from "../../src/core/assetBase";
import { ICON_VIEWS, iconShape, type IconView } from "../../src/ui/iconShape";

const params = new URLSearchParams(location.search);
const PX = Number(params.get("px")) || 64;
const toon = new ToonLook({ ...TOON_DEFAULTS });
const loader = new GLTFLoader();
const glbs = new Map<string, Promise<THREE.Object3D | null>>();
const glb = (path: string) => {
  let p = glbs.get(path);
  if (!p) glbs.set(path, p = loader.loadAsync(asset(path)).then((g) => g.scene, () => null));
  return p;
};

/** Meshes of a mech model whose names match, as one group in the unit look. */
async function mechParts(look: string, match: RegExp): Promise<THREE.Object3D | null> {
  const scene = await glb(look === "rampart" ? "models/rampart.glb" : `models/mechs/${look}.glb`);
  if (!scene) return null;
  const g = new THREE.Group();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !match.test(m.name)) return;
    const part = new THREE.Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld));
    toon.apply(part, false);
    g.add(part);
  });
  return g.children.length ? g : null;
}

/** The model kind the arsenal draws a weapon base with (src/weapons/arsenal.ts), or a library id for the miniguns. */
function weaponKind(b: Base): ModelKind | null {
  if (b.kind === "shoulder") return b.shoulder ? (b.shoulder === "rpg" ? "shoulderRpg" : b.shoulder) : null;
  const light = b.size === "L";
  switch (b.cls) {
    case undefined: case "minigun": return null;
    case "melee": return "sword";
    case "rail": return light ? "railLight" : "rail";
    case "rpg": return light ? "rpgLight" : "rpg";
    case "cannon": return "breach";
    default: return b.cls in WEAPON_MODELS ? b.cls as ModelKind : null;
  }
}

/** The base's model, or null when it has none of its own yet. */
async function build(b: Base): Promise<THREE.Object3D | null> {
  switch (b.kind) {
    case "weapon": case "shoulder": {
      const mk = weaponKind(b);
      if (mk) return WEAPON_MODELS[mk](toon, "right").root;
      if (b.kind === "weapon" && (b.cls === undefined || (b.cls as string) === "minigun")) {
        const w = createWeapon(`minigun-${(b.size ?? "M").toLowerCase()}`, weaponLookFor(toon));
        w.laser?.dispose(); w.laser = null;
        return w.root;
      }
      return null;
    }
    case "pack": { const s = await partGlb(b.id); return s ? partFromGlb(s, toon) : null; }
    case "sensor": return standInSensor(b.id, toon, b.sensor?.style ?? "cluster").root;
    case "hull": return mechParts(b.look, /^Part_Torso/);
    case "legs": return b.id === "legs-hover" ? null : mechParts(b.look, /^Part_(Pelvis|Thigh|Shin|Cannon|Foot)/);
    case "waist": {
      const file = b.id === "waist-drums" ? "ammo-drum-back-half" : b.id === "waist-fulldrums" ? "ammo-drum-back-full" : null;
      if (!file) return null;
      const s = await glb(`models/weapons/${file}.glb`);
      if (!s) return null;
      const g = s.clone(true);
      const ms: THREE.Mesh[] = [];
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) ms.push(o as THREE.Mesh); });
      for (const m of ms) { toon.apply(m, false); toon.tint(m, 0x8b9160); }
      return g;
    }
    default: return null;
  }
}

// ---- The studio: a clear background, a key light from the upper left of the picture, a soft fill, a rim from behind.
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL: params.has("webgl") });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);
document.getElementById("view")!.append(renderer.domElement);
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const key = new THREE.DirectionalLight(0xfff4e2, 3.2), rim = new THREE.DirectionalLight(0xcfe0ff, 1.4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f7f66, 1.5), key, rim, key.target, rim.target);
let shown: THREE.Object3D | null = null;

const ids = BASES.map((b) => b.id);
const info = document.getElementById("info")!;

/** Draw one base. Resolves with its picture's size, or null when the base has no model. */
async function draw(id: string): Promise<{ id: string; w: number; h: number } | null> {
  const b = BASE_BY_ID[id];
  if (shown) { shown.removeFromParent(); shown = null; }
  const model = b ? await build(b) : null;
  if (!b || !model) { info.textContent = `${id}: no model of its own yet (the inventory keeps its line drawing)`; renderer.setSize(PX * 2, PX * 2); await renderer.renderAsync(scene, cam); return null; }
  const cls = gridClassOfBase(b), cells = itemCells(makeItem(id)), shape = iconShape(cls, cells);
  const view: IconView = ICON_VIEWS[cls] ?? ICON_VIEWS.default;
  shown = model;
  scene.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  // The camera looks from `view.from`; its up is the model's long axis seen from there (a tall picture: a barrel or
  // blade stands upright) or the world's up.
  const dir = new THREE.Vector3(...view.from).normalize();
  const long = size.z >= size.x && size.z >= size.y ? new THREE.Vector3(0, 0, 1) : size.y >= size.x ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const up = view.upright === "long" ? long : new THREE.Vector3(0, 1, 0);
  cam.up.copy(up);
  cam.position.copy(c).addScaledVector(dir, 50);
  cam.lookAt(c);
  cam.updateMatrixWorld(true);
  // Fit the box's corners into the picture with a margin.
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), top = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  // Fit what is seen (every vertex, not the box: a box's corners waste a turned picture's room) with a margin.
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const p = new THREE.Vector3();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || m.userData.ink) return;
    const pos = m.geometry.getAttribute("position"), stride = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += stride) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(c);
      const x = p.dot(right), y = p.dot(top);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  });
  const W = shape.w * PX, H = shape.h * PX, margin = 1.08;
  const half = Math.max((x1 - x0) / W, (y1 - y0) / H) * margin / 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  cam.left = cx - half * W; cam.right = cx + half * W; cam.top = cy + half * H; cam.bottom = cy - half * H;
  cam.updateProjectionMatrix();
  key.position.copy(c).addScaledVector(dir, 6).addScaledVector(top, 9).addScaledVector(right, -5); key.target.position.copy(c);
  rim.position.copy(c).addScaledVector(dir, -6).addScaledVector(top, 3).addScaledVector(right, 6); rim.target.position.copy(c);
  renderer.setSize(W, H);
  weaponLookFor(toon).update(cam as unknown as THREE.PerspectiveCamera, H);
  await renderer.renderAsync(scene, cam);
  await renderer.renderAsync(scene, cam);
  info.textContent = `${id}\n${b.name} · ${b.kind} · class ${cls} (${GRID_CLASSES[cls].label})\ncells ${cells.w} × ${cells.h} · picture ${W} × ${H} px\nmodel ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
  return { id, w: W, h: H };
}

const sel = document.getElementById("base") as HTMLSelectElement;
for (const id of ids) sel.add(new Option(`${BASE_BY_ID[id].name} (${id})`, id));
const go = (id: string) => { sel.value = id; void draw(id); };
sel.onchange = () => go(sel.value);
const step = (d: number) => go(ids[(ids.indexOf(sel.value) + d + ids.length) % ids.length]);
document.getElementById("prev")!.onclick = () => step(-1);
document.getElementById("next")!.onclick = () => step(1);
addEventListener("keydown", (e) => { if (e.key === "[") step(-1); if (e.key === "]") step(1); });

await renderer.init();
await preloadWeapons();
(window as unknown as { __icons: unknown }).__icons = { ids, draw };
go(params.get("base") && BASE_BY_ID[params.get("base")!] ? params.get("base")! : ids[0]);
