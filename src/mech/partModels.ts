// Fitted part models by item base id (packs first; arms and waist kit to follow): `public/models/parts/<id>.glb`, built
// by tools/blender/parts/ (docs/asset-pipeline.md), when the file exists; the caller keeps its code stand-in until it
// loads and when there is none (headless checks, a missing file). A part is one `Body` mesh whose paint, edge light and
// occlusion are in its vertex colours, plus a small `Glow` mesh of lit faces (lamps, hot throats) that stays bright
// at night. Drawing only.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ToonLook } from "../look/toon";
import { asset } from "../core/assetBase";

const loader = new GLTFLoader();
const base = asset("models/parts/");
const glbs = new Map<string, Promise<THREE.Object3D | null>>();

/** The GLB's scene for this base id, or null when there's none (a missing file, or the dev server's html). Cached. */
export function partGlb(id: string): Promise<THREE.Object3D | null> {
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

/**
 * The geometry as plain float attributes (position, normal, rgb colour) with its index: Blender's exporter packs
 * normalised 16-bit colours and may interleave, which the unit look's outline shell and the part merges can't copy.
 */
export function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["normal", 3], ["color", 3]] as const) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (g.index) out.setIndex(Array.from(g.index.array as ArrayLike<number>));
  return out;
}

/** Dress a copied GLB tree for one mech: bodies in the unit look, `Paint_lighting` meshes unlit (marked so paint
 *  leaves them alone). Node names and transforms are kept (a sensor's Head, HeadPitch and Sweep turn). */
export function dressPart(copy: THREE.Object3D, look: ToonLook) {
  // Collected first: the unit look hangs an outline shell on each mesh it takes, which a live traverse would walk into.
  const meshes: THREE.Mesh[] = [];
  copy.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    m.geometry = plain(m.geometry);
    const lit = (m.material as THREE.Material)?.name === "Paint_lighting";
    if (lit) { m.material = new THREE.MeshBasicMaterial({ vertexColors: true }); m.userData.glow = true; }
    else look.apply(m);
  }
}

/** A copy of a loaded part for one mech: the body in the unit look, the glow unlit. */
export function partFromGlb(scene: THREE.Object3D, look: ToonLook): THREE.Group {
  const root = new THREE.Group();
  const copy = scene.clone(true);
  root.add(copy);
  dressPart(copy, look);
  return root;
}

/** The length an arm model's bones are authored at (tools/blender/parts/arms.py). */
const ARM_BONE = 1.45;

/**
 * An arm model's posed pieces for one mech (src/mech/rampart.ts drawArm): the shoulder (Body), the two bones turned to
 * run one unit up +Y from their near joint (the game stretches them to the bone), the elbow and the fist. Null when the
 * GLB lacks a piece.
 */
export function armFromGlb(scene: THREE.Object3D, look: ToonLook): { joint: THREE.Object3D; upper: THREE.Object3D; fore: THREE.Object3D; elbow: THREE.Object3D; hand: THREE.Object3D } | null {
  const copy = scene.clone(true);
  const get = (n: string) => copy.getObjectByName(n) ?? null;
  const upper = get("Upper"), fore = get("Fore"), elbow = get("Elbow"), hand = get("Hand"), body = get("Body");
  if (!upper || !fore || !elbow || !hand || !body) return null;
  // The bones are authored from the far joint up to the near one: turn them over and make them one unit long.
  for (const bone of [upper, fore]) bone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry = plain(m.geometry).rotateX(Math.PI).translate(0, ARM_BONE, 0).scale(1, 1 / ARM_BONE, 1);
  });
  const joint = new THREE.Group();
  const glow = get("Glow");
  joint.add(body);
  if (glow) joint.add(glow);
  const out = { joint, upper, fore, elbow, hand };
  for (const o of Object.values(out)) { o.removeFromParent(); o.position.set(0, 0, 0); dressPart(o, look); }
  return out;
}
