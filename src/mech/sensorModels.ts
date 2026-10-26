// Sensor models by item base id (Keith 2026-10-26: a head at the front that follows the aim, or a cluster on top).
// Same order as the weapon library (src/weapons/library.ts): `public/models/sensors/<id>.glb` when it exists, else a
// code stand-in. Both carry the asset list's moving nodes (docs/asset-list.md "Mech parts and their mounts"):
// `Head` (turns about its own Y, yaw), `HeadPitch` (under Head, tips about its own X) and, on clusters, `Sweep` (turns
// about its own Y). The origin sits on the socket (`Sensor_Front` for a head, `Sensor_Top` for a cluster), +Z forward.
// Drawing only: src/mech/rampart.ts hangs these on the hull and turns the nodes from src/mech/head.ts.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ToonLook } from "../look/toon";

export interface SensorModel {
  root: THREE.Group;
  head: THREE.Object3D | null;
  pitch: THREE.Object3D | null;
  sweep: THREE.Object3D | null;
  source: "glb" | "stand-in";
}

const loader = new GLTFLoader();
let base = "/models/sensors/";
/** Where the sensor GLBs are served from (default /models/sensors/). */
export function setSensorModelBase(url: string) { base = url; }
const glbs = new Map<string, Promise<THREE.Object3D | null>>();

/** The GLB's scene for this id, or null when there's none (a missing file, or the dev server's html). Cached. */
export function sensorGlb(id: string): Promise<THREE.Object3D | null> {
  let p = glbs.get(id);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(base + id + ".glb");
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "glTF") return null;
        return (await loader.parseAsync(buf, base)).scene;
      } catch { return null; }
    })();
    glbs.set(id, p);
  }
  return p;
}

/** A model from a loaded GLB scene: a copy, toon-shaded, with its moving nodes found by name. */
export function fromGlb(scene: THREE.Object3D, look: ToonLook): SensorModel {
  const root = new THREE.Group();
  const copy = scene.clone(true);
  root.add(copy);
  copy.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry = m.geometry.clone(); look.apply(m); } });
  const find = (n: string) => copy.getObjectByName(n) ?? null;
  return { root, head: find("Head"), pitch: find("HeadPitch"), sweep: find("Sweep"), source: "glb" };
}

// ---- Code stand-ins (until the desktop agent's Blender models land at public/models/sensors/<id>.glb) ----

const KHAKI = 0xb7a77c, OLIVE = 0x6c7546, DARK = 0x3e3c35, STEEL = 0x8e8a7e;
const LENS = 0xff6a1f, LAMP = 0xfff1c8;

class Kit {
  constructor(private look: ToonLook) {}
  box(parent: THREE.Object3D, tint: number, size: [number, number, number], at: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
    return this.add(parent, new THREE.BoxGeometry(...size), tint, at, rot);
  }
  cyl(parent: THREE.Object3D, tint: number, rTop: number, rBot: number, h: number, at: [number, number, number], rot: [number, number, number] = [0, 0, 0], seg = 14) {
    return this.add(parent, new THREE.CylinderGeometry(rTop, rBot, h, seg), tint, at, rot);
  }
  /** Unlit and bright (a lens or a lamp), so it reads at the game camera in any light. */
  glow(parent: THREE.Object3D, color: number, geo: THREE.BufferGeometry, at: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    m.position.set(...at); m.rotation.set(...rot);
    m.userData.glow = true;
    parent.add(m);
    return m;
  }
  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, tint: number, at: [number, number, number], rot: [number, number, number]) {
    const m = new THREE.Mesh(geo);
    m.position.set(...at); m.rotation.set(...rot);
    this.look.apply(m);
    this.look.tint(m, tint);
    parent.add(m);
    return m;
  }
}

const node = (name: string, parent: THREE.Object3D, at: [number, number, number] = [0, 0, 0]) => {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(...at);
  parent.add(g);
  return g;
};
const HALF = Math.PI / 2;

/** Rampart visor head: a yoke on a turret ring, an armoured visor block with one big lens, two lamps, a brow plate. */
function visorHead(k: Kit, root: THREE.Group) {
  k.cyl(root, DARK, 0.34, 0.4, 0.14, [0, 0.07, 0]);
  const head = node("Head", root, [0, 0.14, 0]);
  k.box(head, DARK, [0.5, 0.22, 0.4], [0, 0.11, -0.02]);
  for (const s of [1, -1]) k.box(head, OLIVE, [0.09, 0.42, 0.34], [s * 0.5, 0.33, 0]);
  const pitch = node("HeadPitch", head, [0, 0.36, 0]);
  k.box(pitch, KHAKI, [0.88, 0.46, 0.7], [0, 0, 0.05]);
  // Brow and chin armour, angled.
  k.box(pitch, OLIVE, [0.98, 0.1, 0.62], [0, 0.27, 0.1], [-0.18, 0, 0]);
  k.box(pitch, OLIVE, [0.8, 0.09, 0.3], [0, -0.25, 0.32], [0.35, 0, 0]);
  // Visor face: a dark band with the lens set in it, lamps at its corners.
  k.box(pitch, DARK, [0.8, 0.26, 0.06], [0, 0.02, 0.41]);
  k.cyl(pitch, DARK, 0.17, 0.2, 0.16, [0.12, 0.02, 0.46], [HALF, 0, 0]);
  k.glow(pitch, LENS, new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), [0.12, 0.02, 0.545], [HALF, 0, 0]);
  for (const x of [-0.24, -0.33]) k.glow(pitch, LAMP, new THREE.BoxGeometry(0.06, 0.08, 0.02), [x, 0.04, 0.445]);
  // An aerial stub at the back corner.
  k.cyl(pitch, DARK, 0.015, 0.025, 0.55, [-0.34, 0.5, -0.22], [0, 0, 0], 6);
  return { head, pitch };
}

/** Twin-optic head: a rounded drum on a neck with two lenses side by side, cheek armour, one lamp. */
function opticHead(k: Kit, root: THREE.Group) {
  k.cyl(root, DARK, 0.28, 0.34, 0.12, [0, 0.06, 0]);
  const head = node("Head", root, [0, 0.12, 0]);
  k.cyl(head, DARK, 0.12, 0.14, 0.32, [0, 0.16, 0], [0, 0, 0], 10);
  const pitch = node("HeadPitch", head, [0, 0.4, 0]);
  k.cyl(pitch, STEEL, 0.3, 0.3, 0.9, [0, 0, 0.02], [0, 0, HALF], 14);
  for (const s of [1, -1]) {
    k.box(pitch, OLIVE, [0.12, 0.5, 0.56], [s * 0.47, 0, 0.02]);
    k.cyl(pitch, DARK, 0.13, 0.15, 0.2, [s * 0.18, 0.02, 0.32], [HALF, 0, 0]);
    k.glow(pitch, LENS, new THREE.CylinderGeometry(0.09, 0.09, 0.02, 14), [s * 0.18, 0.02, 0.425], [HALF, 0, 0]);
  }
  k.glow(pitch, LAMP, new THREE.BoxGeometry(0.1, 0.05, 0.02), [0, -0.2, 0.27]);
  return { head, pitch };
}

/** Rampart mast: a tall post with a small dish and a beacon, still. */
function mastCluster(k: Kit, root: THREE.Group) {
  k.box(root, DARK, [0.44, 0.12, 0.44], [0, 0.06, 0]);
  k.cyl(root, DARK, 0.06, 0.09, 1.1, [0, 0.6, 0], [0, 0, 0], 8);
  const sweep = node("Sweep", root, [0, 0, 0]);
  k.cyl(sweep, KHAKI, 0.4, 0.14, 0.08, [0, 1.0, 0.06], [1.1, 0, 0]);
  k.box(sweep, OLIVE, [0.5, 0.12, 0.12], [0, 0.72, 0]);
  for (const s of [1, -1]) k.box(sweep, KHAKI, [0.08, 0.3, 0.14], [s * 0.26, 0.76, 0]);
  k.glow(root, LENS, new THREE.BoxGeometry(0.12, 0.12, 0.12), [0, 1.24, 0]);
  return { sweep };
}

/** Survey dish: a wide dish on a turntable that sweeps round. */
function dishCluster(k: Kit, root: THREE.Group) {
  k.cyl(root, DARK, 0.32, 0.38, 0.16, [0, 0.08, 0]);
  const sweep = node("Sweep", root, [0, 0.16, 0]);
  k.box(sweep, OLIVE, [0.5, 0.36, 0.3], [0, 0.18, 0]);
  k.cyl(sweep, KHAKI, 0.72, 0.18, 0.12, [0, 0.62, 0.1], [1.15, 0, 0], 18);
  // The feed on a strut along the dish's axis, its tip lit.
  k.cyl(sweep, DARK, 0.03, 0.03, 0.55, [0, 0.73, 0.35], [1.15, 0, 0], 6);
  k.glow(sweep, LENS, new THREE.BoxGeometry(0.1, 0.1, 0.1), [0, 0.85, 0.6]);
  return { sweep };
}

/** Long array: a wide bar of panels up on two posts, still. */
function arrayCluster(k: Kit, root: THREE.Group) {
  k.box(root, DARK, [0.9, 0.12, 0.4], [0, 0.06, 0]);
  for (const s of [1, -1]) k.box(root, DARK, [0.1, 0.6, 0.12], [s * 0.32, 0.4, 0]);
  const sweep = node("Sweep", root, [0, 0.7, 0]);
  k.box(sweep, OLIVE, [2.0, 0.14, 0.18], [0, 0, 0]);
  for (let i = 0; i < 5; i++) k.box(sweep, KHAKI, [0.32, 0.42, 0.05], [-0.8 + i * 0.4, 0.22, 0.04], [-0.2, 0, 0]);
  for (const s of [1, -1]) k.glow(sweep, LENS, new THREE.BoxGeometry(0.08, 0.08, 0.08), [s * 1.02, 0.04, 0]);
  return { sweep };
}

const STAND_INS: Record<string, (k: Kit, root: THREE.Group) => { head?: THREE.Object3D; pitch?: THREE.Object3D; sweep?: THREE.Object3D }> = {
  "sensor-visor": visorHead,
  "sensor-optic": opticHead,
  "sensor-mast": mastCluster,
  "sensor-dish": dishCluster,
  "sensor-array": arrayCluster,
};

/** The code stand-in for a sensor base (an unknown id gets the visor head or the mast, by style). */
export function standInSensor(id: string, look: ToonLook, style: "head" | "cluster" = "cluster"): SensorModel {
  const root = new THREE.Group();
  root.name = id;
  const build = STAND_INS[id] ?? (style === "head" ? visorHead : mastCluster);
  const n = build(new Kit(look), root);
  return { root, head: n.head ?? null, pitch: n.pitch ?? null, sweep: n.sweep ?? null, source: "stand-in" };
}
