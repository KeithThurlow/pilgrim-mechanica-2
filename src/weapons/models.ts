// Stand-in models for the new weapons, from boxes and cylinders in the Rampart's khaki, olive and dark steel, until
// modelled ones exist (another agent is building src/weapons/library.ts and kit/; the swap is wired after). One
// function per weapon, each returning a group plus its muzzle sockets, so any of them can be replaced on its own.
// Gun-side weapons hang on a side's pivot (+Z along the barrel, origin on the shoulder); shoulder weapons stand on a
// shoulder mount or the back mount (origin at the mount's top, +Z forward, +Y up).
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";

export type ModelKind = "rail" | "railLight" | "autocannon" | "rpg" | "shoulderRpg" | "missiles" | "mortar" | "linemortar";

export interface WeaponModel {
  kind: ModelKind;
  root: THREE.Group;
  /** Where rounds, beams, rockets or shells leave from (in order: tube i of a pod). */
  muzzles: THREE.Object3D[];
  /** Glowing parts (the rail's coils, ready lamps): brightness set by the arsenal. */
  glow: THREE.MeshBasicMaterial[];
  /** The part that kicks on a shot (barrel back along -Z, mortar tube down along -Y). */
  recoil: THREE.Group;
  /** Meshes for the hold-V selector. */
  meshes: THREE.Mesh[];
}

const KHAKI = 0xb7a77c, OLIVE = 0x6c7546, DARK = 0x3e3c35, STEEL = 0x77736b, GLOW = 0x7fe0ff, HOT = 0xff6a2a;
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const ring = new THREE.TorusGeometry(0.5, 0.12, 6, 16);
const ALONG: [number, number, number] = [Math.PI / 2, 0, 0]; // cylinders along +Z
type V3 = [number, number, number];

/** A small builder: parts in the toon look, glowing parts, muzzle sockets. */
function kit(kind: ModelKind, look: ToonLook) {
  const root = new THREE.Group();
  root.name = `weapon-${kind}`;
  const recoil = new THREE.Group();
  root.add(recoil);
  const m: WeaponModel = { kind, root, muzzles: [], glow: [], recoil, meshes: [] };
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, tint: number, size: V3, at: V3, rot: V3 = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geo);
    mesh.scale.set(...size); mesh.position.set(...at); mesh.rotation.set(...rot);
    look.apply(mesh);
    look.tint(mesh, tint);
    parent.add(mesh);
    m.meshes.push(mesh);
    return mesh;
  };
  const glow = (parent: THREE.Object3D, geo: THREE.BufferGeometry, col: number, size: V3, at: V3, rot: V3 = [0, 0, 0]) => {
    const mat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(...size); mesh.position.set(...at); mesh.rotation.set(...rot);
    parent.add(mesh);
    m.glow.push(mat);
    m.meshes.push(mesh);
    return mesh;
  };
  const muzzle = (parent: THREE.Object3D, at: V3) => { const o = new THREE.Object3D(); o.position.set(...at); parent.add(o); m.muzzles.push(o); return o; };
  const group = (parent: THREE.Object3D, at: V3, rot: V3 = [0, 0, 0]) => { const g = new THREE.Group(); g.position.set(...at); g.rotation.set(...rot); parent.add(g); return g; };
  return { m, recoil, add, glow, muzzle, group };
}

/** Rail cannon (Medium on the hull, or Light in a hand): a breech, two flat rails with coils, a muzzle shroud. */
function railModel(kind: "rail" | "railLight", look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle } = kit(kind, look);
  const k = kind === "rail" ? 1 : 0.72, len = 3.4 * k;
  add(recoil, box, OLIVE, [0.62 * k, 0.6 * k, 1.1 * k], [0, 0, 0.35 * k]);
  add(recoil, box, DARK, [0.5 * k, 0.18 * k, 0.9 * k], [0, 0.38 * k, 0.3 * k]);
  for (const y of [0.13, -0.13]) add(recoil, box, STEEL, [0.2 * k, 0.09 * k, len], [0, y * k, 0.9 * k + len / 2]);
  for (let i = 0; i < 5; i++) {
    const z = 1.1 * k + (i + 0.5) * (len * 0.82) / 5;
    add(recoil, box, KHAKI, [0.44 * k, 0.5 * k, 0.12 * k], [0, 0, z]);
    glow(recoil, ring, GLOW, [0.42 * k, 0.42 * k, 0.6 * k], [0, 0, z + 0.12 * k]);
  }
  add(recoil, box, DARK, [0.38 * k, 0.46 * k, 0.32 * k], [0, 0, 0.9 * k + len]);
  muzzle(recoil, [0, 0, 1.1 * k + len]);
  return m;
}

/** Autocannon (hull): a chunky receiver, a box magazine, a thick barrel with a muzzle brake. */
function autocannonModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, muzzle } = kit("autocannon", look);
  add(recoil, box, OLIVE, [0.78, 0.72, 1.3], [0, 0, 0.45]);
  add(recoil, box, KHAKI, [0.5, 0.55, 0.6], [0.55, -0.1, 0.3]);
  add(recoil, cyl, DARK, [0.32, 2.1, 0.32], [0, 0.05, 2.1], ALONG);
  add(recoil, cyl, STEEL, [0.42, 0.5, 0.42], [0, 0.05, 1.25], ALONG);
  add(recoil, box, DARK, [0.5, 0.3, 0.42], [0, 0.05, 3.15]);
  muzzle(recoil, [0, 0.05, 3.4]);
  return m;
}

/** Rocket launcher (hull, RPG-like): a fat tube with a flared mouth, a sight box and a hot warhead in the mouth. */
function rpgModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle } = kit("rpg", look);
  add(recoil, box, OLIVE, [0.6, 0.55, 0.9], [0, 0, 0.3]);
  add(recoil, cyl, KHAKI, [0.52, 2.6, 0.52], [0, 0.05, 1.5], ALONG);
  add(recoil, cyl, DARK, [0.64, 0.4, 0.64], [0, 0.05, 2.75], ALONG);
  add(recoil, cyl, DARK, [0.6, 0.3, 0.6], [0, 0.05, 0.2], ALONG);
  add(recoil, box, DARK, [0.16, 0.22, 0.4], [0.36, 0.3, 0.8]);
  glow(recoil, box, HOT, [0.08, 0.06, 0.03], [0.36, 0.42, 1.0]);
  add(recoil, cyl, HOT, [0.3, 0.3, 0.3], [0, 0.05, 2.7], ALONG);
  muzzle(recoil, [0, 0.05, 3.0]);
  return m;
}

/** Shoulder rocket: one tube on a cradle, pointing forward and a little up. */
function shoulderRpgModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("shoulderRpg", look);
  add(recoil, box, DARK, [0.4, 0.3, 0.5], [0, 0.15, 0]);
  const tube = group(recoil, [0, 0.45, 0.1], [-0.12, 0, 0]);
  add(tube, cyl, KHAKI, [0.38, 1.9, 0.38], [0, 0, 0.2], ALONG);
  add(tube, cyl, DARK, [0.46, 0.3, 0.46], [0, 0, 1.15], ALONG);
  add(tube, cyl, DARK, [0.44, 0.2, 0.44], [0, 0, -0.75], ALONG);
  glow(tube, box, HOT, [0.08, 0.06, 0.03], [0.22, 0.2, 0.3]);
  muzzle(tube, [0, 0, 1.3]);
  return m;
}

/** Missile pod: a box tilted up and forward, its face a 3 x 4 grid of tubes (twelve missiles). */
function missilesModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("missiles", look);
  add(recoil, box, DARK, [0.45, 0.4, 0.45], [0, 0.2, 0]);
  const pod = group(recoil, [0, 0.85, 0], [-0.75, 0, 0]);
  add(pod, box, OLIVE, [1.05, 1.0, 1.0], [0, 0, 0]);
  add(pod, box, KHAKI, [1.12, 0.1, 1.05], [0, 0.53, 0]);
  add(pod, box, DARK, [0.95, 0.88, 0.06], [0, 0, 0.51]);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const x = -0.3 + c * 0.3, y = 0.33 - r * 0.22;
    add(pod, cyl, STEEL, [0.18, 0.12, 0.18], [x, y, 0.55], ALONG);
    muzzle(pod, [x, y, 0.65]);
  }
  glow(pod, box, HOT, [0.1, 0.06, 0.03], [0.42, 0.42, 0.53]);
  return m;
}

/** Big mortar: a fat tube nearly upright on a turntable, braced. */
function mortarModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("mortar", look);
  add(recoil, cyl, DARK, [1.0, 0.25, 1.0], [0, 0.12, 0]);
  const tube = group(recoil, [0, 0.25, 0], [-1.25, 0, 0]);
  add(tube, cyl, OLIVE, [0.62, 2.1, 0.62], [0, 0, 1.0], ALONG);
  add(tube, cyl, KHAKI, [0.78, 0.35, 0.78], [0, 0, 0.25], ALONG);
  add(tube, cyl, DARK, [0.72, 0.2, 0.72], [0, 0, 2.0], ALONG);
  for (const x of [-0.42, 0.42]) add(recoil, box, STEEL, [0.1, 1.0, 0.12], [x, 0.55, 0.25], [0.5, 0, 0]);
  glow(recoil, box, HOT, [0.08, 0.06, 0.03], [0.52, 0.18, 0.3]);
  muzzle(tube, [0, 0, 2.15]);
  return m;
}

/** Line mortar: a rack of five short tubes in a row, tilted up and forward. */
function lineMortarModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("linemortar", look);
  add(recoil, box, DARK, [1.3, 0.25, 0.7], [0, 0.12, 0]);
  const rack = group(recoil, [0, 0.3, 0], [-1.0, 0, 0]);
  add(rack, box, OLIVE, [1.35, 0.35, 0.5], [0, 0, 0.1]);
  for (let i = 0; i < 5; i++) {
    const x = -0.52 + i * 0.26;
    add(rack, cyl, KHAKI, [0.22, 1.0, 0.22], [x, 0, 0.55], ALONG);
    muzzle(rack, [x, 0, 1.1]);
  }
  glow(recoil, box, HOT, [0.1, 0.06, 0.03], [0.6, 0.26, 0.36]);
  return m;
}

/** Every stand-in, by kind. */
export const WEAPON_MODELS: Record<ModelKind, (look: ToonLook) => WeaponModel> = {
  rail: (l) => railModel("rail", l),
  railLight: (l) => railModel("railLight", l),
  autocannon: autocannonModel,
  rpg: rpgModel,
  shoulderRpg: shoulderRpgModel,
  missiles: missilesModel,
  mortar: mortarModel,
  linemortar: lineMortarModel,
};
