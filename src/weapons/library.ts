// The weapon model library: load any weapon model by id (or class and size) and get a WeaponModel to hang on a mech.
//
//   await preloadWeapons();                                   // fetch every model once (or loadWeapon one by one)
//   const look = new WeaponLook(V, toon);                     // shared look; sliders WEAPON_LOOK_PARAMS
//   const gun = createWeapon("rocket-launcher-hull", look);   // sync after preload; find("Minigun", "M", "left")!.id
//   kick.add(gun.root);                                       // or mountOnRampart(gun, rampart, "right") (mounts.ts)
//   each frame: gun.spin(rate * dt); gun.setHeat(h); gun.laser?.update(LASER_V, t); look.update(camera, height)
//
// Where a model comes from (docs/asset-list.md): `public/models/weapons/<id>.glb` (+ `<id>.json` sidecar) when it
// exists; a `-left` id without its own file mirrors the right one; otherwise the code stand-in in the catalog. So a
// Blender model exported to the item's path replaces the stand-in with no code change.
// Models are cached: instances of one id share geometry; each instance has its own material (paint, heat, lamps).
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CATALOG, entry, type CatalogEntry } from "./catalog";
import { defFromGlb, mirrorDef, readSidecar, depaint, rootAtMount, type ModelDef } from "./parts";
import { WeaponModel } from "./weaponModel";
import type { WeaponLook } from "./weaponLook";
import { Build, v } from "./kit";
import { laserEmitter } from "./build/common";

export { CATALOG, find, entry, register } from "./catalog";
export type { CatalogEntry } from "./catalog";
export { WeaponModel } from "./weaponModel";

export type ModelSource = "glb" | "glb-mirrored" | "stand-in";
const defs = new Map<string, { def: ModelDef; source: ModelSource }>();
const loading = new Map<string, Promise<ModelDef>>();
const loader = new GLTFLoader();
let base = "/models/weapons/";
/** Where the GLBs are served from (default /models/weapons/). */
export function setWeaponModelBase(url: string) { base = url; }

/** A GLB's extras when it lacks them: a targeting laser under the minigun's barrels or on a pod's side. */
function addon(e: CatalogEntry, def: ModelDef) {
  if (!e.addon || Object.keys(def.sockets).some((k) => k.endsWith("Laser"))) return;
  const body = def.parts.find((p) => p.name === "Body");
  if (!body) return;
  const bb = body.geometry.boundingBox ?? (body.geometry.computeBoundingBox(), body.geometry.boundingBox!);
  const w = bb.max.x - bb.min.x, sd: 1 | -1 = e.side === "left" ? 1 : -1;
  const B = new Build(7, w, sd), P = B.piece("LaserPod");
  if (e.addon === "laserUnder") laserEmitter(B, P, v((bb.min.x + bb.max.x) / 2, bb.min.y - w * 0.04, bb.max.z - w * 0.55), w * 0.05);
  else laserEmitter(B, P, v(sd > 0 ? bb.max.x + w * 0.05 : bb.min.x - w * 0.05, (bb.min.y + bb.max.y) / 2, bb.max.z - w * 0.15), w * 0.05);
  const extra = B.def();
  def.parts.push(...extra.parts);
  Object.assign(def.sockets, extra.sockets);
}

/** A GLB and its sidecar at the path, or null when there's none (a missing file, or the dev server's html). */
async function tryGlb(id: string, e: CatalogEntry): Promise<ModelDef | null> {
  try {
    const res = await fetch(base + id + ".glb");
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "glTF") return null;
    let side: ReturnType<typeof readSidecar> = { moving: [], frames: {} };
    try {
      const j = await fetch(base + id + ".json");
      if (j.ok && (j.headers.get("content-type") ?? "").includes("json")) side = readSidecar(await j.json());
    } catch { /* no sidecar: the contract's defaults */ }
    const gltf = await loader.parseAsync(buf, base);
    const d = defFromGlb(gltf.scene, side.moving, e.heat);
    for (const [k, f] of Object.entries(side.frames)) {
      const s = d.sockets[k];
      if (s && f.forward) s.fwd = new THREE.Vector3(...(f.forward as [number, number, number]));
      if (s && f.up) s.up = new THREE.Vector3(...(f.up as [number, number, number]));
    }
    d.rootAt = side.rootAt ?? "joint";
    // Desktop models carry paint in their vertex colours (sidecar palette): take it out, keep it as their own scheme.
    if (side.palette) { depaint(d, side.palette); d.palette = side.palette; }
    return d;
  } catch (err) {
    console.warn(`weapon model ${id}.glb did not load`, err);
    return null;
  }
}

function standIn(e: CatalogEntry): ModelDef | null {
  return e.build ? rootAtMount(e.build(e.side === "left" ? 1 : -1)) : null;
}

/** Fetch (or build) a model's data; resolves once it's cached. */
export function loadDef(id: string): Promise<ModelDef> {
  const have = defs.get(id);
  if (have) return Promise.resolve(have.def);
  let p = loading.get(id);
  if (p) return p;
  const e = entry(id);
  p = (async () => {
    let source: ModelSource = "glb";
    let d = await tryGlb(id, e);
    if (!d && e.side === "left" && e.mirror) {
      const right = await tryGlb(e.mirror, entry(e.mirror));
      if (right) { d = mirrorDef(right); source = "glb-mirrored"; }
    }
    if (!d) { d = standIn(e); source = "stand-in"; }
    if (!d) throw new Error(`weapon model "${id}": no ${base}${id}.glb and no stand-in`);
    addon(e, d);
    defs.set(id, { def: d, source });
    loading.delete(id);
    return d;
  })();
  loading.set(id, p);
  return p;
}

/** Load models ahead (default: every one), so createWeapon can be called synchronously afterwards. */
export async function preloadWeapons(ids: string[] = CATALOG.map((c) => c.id)) {
  await Promise.all(ids.map(loadDef));
}

/** Is this model ready for createWeapon? */
export function isLoaded(id: string) { return defs.has(id); }
/** Where a loaded model came from: its GLB, the right side's GLB mirrored, or the code stand-in. */
export function sourceOf(id: string): ModelSource | null { return defs.get(id)?.source ?? null; }

/** A new instance (synchronous: the model must be loaded; a stand-in-only id is built on the spot). */
export function createWeapon(id: string, look: WeaponLook, scheme?: number): WeaponModel {
  let d = defs.get(id)?.def;
  if (!d) {
    const e = entry(id), s = standIn(e);
    if (!s) throw new Error(`weapon model "${id}" not loaded: await preloadWeapons() or loadWeapon()`);
    addon(e, s);
    defs.set(id, { def: s, source: "stand-in" });
    d = s;
  }
  return new WeaponModel(entry(id), d, look, scheme);
}

/** Load if needed, then create. */
export async function loadWeapon(id: string, look: WeaponLook, scheme?: number) {
  await loadDef(id);
  return createWeapon(id, look, scheme);
}

/** Triangles of a loaded model (all parts). */
export function trianglesOf(id: string) {
  const d = defs.get(id)?.def;
  return d ? Math.round(d.parts.reduce((s, p) => s + p.geometry.attributes.position.count / 3, 0)) : 0;
}
