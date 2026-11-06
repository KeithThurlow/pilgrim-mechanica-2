// The weapons' models for the arsenal: each kind is the weapon model library's (src/weapons/library.ts: the desktop
// agent's GLB when it exists, else the converted old kit's, else a code stand-in), wrapped in the interface below.
// The box stand-ins further down are the fallback while a GLB is still loading, or if the library has no model.
// Gun-side weapons hang on a side's pivot (+Z along the barrel, origin on the shoulder); shoulder weapons stand on a
// shoulder mount or the back mount (origin at the mount's top, +Z forward, +Y up).
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";
import { libraryModel, KIND_MODELS } from "./modelSwap";

/** Shoulder feeds and power (Keith 2026-10-30): code stand-ins only, no library models yet. */
export type GearKind = "beltfeed" | "incendiary" | "capacitor";
/** Energy weapons (Keith 2026-11-02, src/weapons/energy/): the library's laser projector and plasma cannon stand-ins. */
export type EnergyKind = "laser" | "beam" | "lance" | "plasma" | "orb" | "arc" | "sunder";
export type LauncherKind = "rail" | "railLight" | "autocannon" | "rpg" | "rpgLight" | "shoulderRpg" | "missiles" | "mortar" | "linemortar" | "napalm" | EnergyKind;
/** Melee (Keith 2026-11-01): the sword, a code stand-in only. */
export type MeleeKind = "sword";
/** Round guns (Keith 2026-11-02, src/weapons/guns.ts): code stand-ins only. */
export type GunKind = "smg" | "rifle" | "shotgun" | "sniper" | "flak" | "breach" | "flamer" | "inferno" | "frost" | "cryo";
/** The drum and chute behind the Rampart's own minigun pod (Keith 2026-11-02). */
export type FeedKind = "minigunFeed";
export type ModelKind = LauncherKind | GearKind | MeleeKind | GunKind | FeedKind;

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
  /** The targeting laser's emitter, when the model has one (the beam starts here). */
  laserFrom?: THREE.Object3D | null;
  /** Glow_n points along a library model (the rail's coils, breech to muzzle): the draw lights them in turn. */
  glowPoints?: THREE.Object3D[];
  /** A clip-fed launcher's magazine (src/weapons/clip.ts): the model shows its loaded tubes and the clip swap. */
  clip?: import("./magazine").Mag | null;
  /** The sword: the group that swings (yaw: the swing's angle, pitch: its lift), the blade inside it (stretched along
   *  +Z to the reach) and the hot edge. */
  sword?: { swing: THREE.Group; blade: THREE.Group; edge: THREE.MeshBasicMaterial };
  /** A hull gun's bridge to the hull (the cryo projector): a group reaching inboard (x) from `from` m off the gun's
   *  axis, built `reach` m long; the arsenal stretches it to the hull wherever the gun sits out. */
  bridge?: { g: THREE.Group; from: number; reach: number };
}

const KHAKI = 0xb7a77c, OLIVE = 0x6c7546, DARK = 0x3e3c35, STEEL = 0x77736b, GLOW = 0x7fe0ff, HOT = 0xff6a2a;
const HOT_FIRE = HOT, KHAKI_PAINT = KHAKI, OLIVE_PAINT = OLIVE;
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const ring = new THREE.TorusGeometry(0.5, 0.12, 6, 16);
const sphere = new THREE.SphereGeometry(0.5, 14, 10);
/** A flared cone: narrow at -Y, wide at +Y (+Z after ALONG). */
const bell = new THREE.CylinderGeometry(0.5, 0.28, 1, 14);
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

/**
 * The sword (Keith 2026-11-01: "slightly closer to a katana" for the one-handed one): a long wrapped grip with a round
 * guard, then a slim blade curving gently up toward the tip, its edge (a faint hot line) along the underside, the spine
 * dark on top. Built along +Z from the hand; the blade group is 1 long (the arsenal stretches it to the reach). The
 * swish is drawn apart (src/weapons/swordSwish.ts).
 */
function swordModel(look: ToonLook): WeaponModel {
  const { m, add, glow, group } = kit("sword", look);
  const swing = group(m.root, [0, 0, 0]);
  add(swing, cyl, DARK, [0.16, 0.85, 0.16], [0, 0, -0.12], ALONG);
  for (let i = 0; i < 4; i++) add(swing, box, STEEL, [0.18, 0.04, 0.05], [0, 0, -0.45 + i * 0.2], [0, 0, 0.6]);
  add(swing, cyl, OLIVE, [0.5, 0.07, 0.5], [0, 0, 0.32], ALONG);
  add(swing, box, STEEL, [0.14, 0.24, 0.12], [0, 0, 0.4]);
  const blade = group(swing, [0, 0, 0.46]);
  // Four segments, each a little more raised and tipped up: a gentle curve.
  const N = 4;
  let edge: THREE.Mesh | null = null;
  for (let i = 0; i < N; i++) {
    const z = (i + 0.5) / N, y = 0.12 * z * z, tip = 0.12 * z, taper = 1 - 0.35 * z;
    add(blade, box, KHAKI, [0.07, 0.26 * taper, 1.02 / N], [0, y, z], [-tip, 0, 0]);
    add(blade, box, DARK, [0.1, 0.06, 1.02 / N], [0, y + 0.13 * taper, z], [-tip, 0, 0]);
    const e = glow(blade, box, HOT, [0.04, 0.035, 1.02 / N], [0, y - 0.13 * taper, z], [-tip, 0, 0]);
    edge ??= e;
  }
  add(blade, box, KHAKI, [0.06, 0.14, 0.08], [0, 0.14, 1.02], [-0.6, 0, 0]);
  const edgeMat = edge!.material as THREE.MeshBasicMaterial;
  // One material for the whole edge (the arsenal sets its glow).
  blade.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && me !== edge && m.glow.includes(me.material as THREE.MeshBasicMaterial)) me.material = edgeMat; });
  m.glow.length = 0; m.glow.push(edgeMat);
  edgeMat.opacity = 0.35;
  m.sword = { swing, blade, edge: edgeMat };
  return m;
}

/** Arm missile pod (Light; the fallback while its model builds): a short box with a 2 x 2 face of tubes, fired in turn. */
function rpgLightModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle } = kit("rpgLight", look);
  add(recoil, box, OLIVE, [0.5, 0.5, 1.3], [0, 0, 0.7]);
  add(recoil, box, DARK, [0.44, 0.44, 0.06], [0, 0, 1.36]);
  for (const [x, y] of [[0.11, 0.11], [-0.11, 0.11], [0.11, -0.11], [-0.11, -0.11]]) {
    add(recoil, cyl, STEEL, [0.15, 0.1, 0.15], [x, y, 1.38], ALONG);
    muzzle(recoil, [x, y, 1.45]);
  }
  glow(recoil, box, HOT, [0.06, 0.05, 0.03], [0.2, 0.22, 1.37]);
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

/**
 * Belt feed (shoulder, on the hull top above its gun): an ammo box with a belt chute running down and forward to the
 * gun below, and a lamp that lights while the overdrive runs. Mirrored by the side's sign through the mount.
 */
function beltFeedModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, group } = kit("beltfeed", look);
  add(recoil, box, OLIVE, [0.7, 0.55, 0.9], [0, 0.3, 0]);
  add(recoil, box, KHAKI, [0.76, 0.1, 0.96], [0, 0.6, 0]);
  const chute = group(recoil, [0, 0.1, 0.35], [0.9, 0, 0]);
  add(chute, box, STEEL, [0.16, 0.5, 0.1], [0, -0.3, 0]);
  for (let i = 0; i < 4; i++) add(chute, box, KHAKI, [0.12, 0.06, 0.1], [0, -0.1 - i * 0.12, 0.07]);
  glow(recoil, box, HOT, [0.1, 0.06, 0.03], [0.3, 0.45, 0.47]);
  return m;
}

/** Incendiary feed: the belt box in dark red with a stripe, a fuel tank on top; its lamp glows while ignited rounds are loaded. */
function incendiaryFeedModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, group } = kit("incendiary", look);
  add(recoil, box, DARK, [0.7, 0.5, 0.9], [0, 0.28, 0]);
  add(recoil, box, HOT, [0.74, 0.08, 0.5], [0, 0.4, 0.1]);
  add(recoil, cyl, KHAKI, [0.34, 0.8, 0.34], [0, 0.72, -0.1], [0, 0, Math.PI / 2]);
  const chute = group(recoil, [0, 0.1, 0.35], [0.9, 0, 0]);
  add(chute, box, STEEL, [0.16, 0.5, 0.1], [0, -0.3, 0]);
  for (let i = 0; i < 4; i++) add(chute, box, HOT, [0.12, 0.06, 0.1], [0, -0.1 - i * 0.12, 0.07]);
  glow(recoil, box, HOT, [0.1, 0.06, 0.03], [0.3, 0.45, 0.47]);
  return m;
}

/** Capacitor bank: a block of cells with a cooling fin on top and cables looping down to the hull; glows when it can discharge. */
function capacitorModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow } = kit("capacitor", look);
  add(recoil, box, DARK, [0.8, 0.5, 0.8], [0, 0.25, 0]);
  for (const x of [-0.24, 0, 0.24]) add(recoil, cyl, KHAKI, [0.2, 0.5, 0.2], [x, 0.7, 0]);
  for (const x of [-0.24, 0, 0.24]) glow(recoil, cyl, GLOW, [0.14, 0.06, 0.14], [x, 0.97, 0]);
  add(recoil, box, STEEL, [0.9, 0.06, 0.1], [0, 0.52, 0.35]);
  for (const x of [-0.3, 0.3]) add(recoil, cyl, DARK, [0.07, 0.7, 0.07], [x, 0.0, -0.4], [0.5, 0, 0]);
  return m;
}

/** An energy weapon's box fallback while its library model loads: the rail's boxes. */
function energyBox(kind: EnergyKind) {
  return (l: ToonLook): WeaponModel => { const m = railModel("rail", l); m.kind = kind; m.root.name = `weapon-${kind}`; return m; };
}

// ---- Round guns (Keith 2026-11-02): original stand-ins, each readable by its silhouette from the game camera ----

/** SMG (Light): a stubby receiver, a perforated shroud over a short barrel, a long magazine jutting out sideways, a
 *  folded stub stock. The shortest gun. */
function smgModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, muzzle } = kit("smg", look);
  add(recoil, box, OLIVE, [0.36, 0.42, 0.8], [0, 0, 0.35]);
  add(recoil, box, DARK, [0.3, 0.14, 0.5], [0, -0.05, -0.2]);
  add(recoil, cyl, STEEL, [0.22, 0.6, 0.22], [0, 0.04, 1.02], ALONG);
  for (let i = 0; i < 4; i++) add(recoil, box, DARK, [0.25, 0.05, 0.05], [0, 0.04, 0.82 + i * 0.13]);
  add(recoil, cyl, DARK, [0.1, 0.22, 0.1], [0, 0.04, 1.4], ALONG);
  // The magazine out of the left flank, angled forward.
  add(recoil, box, KHAKI, [0.5, 0.13, 0.16], [0.36, 0, 0.45], [0, -0.35, 0]);
  muzzle(recoil, [0, 0.04, 1.52]);
  return m;
}

/** Battle rifle (Light): a long bullpup body (the magazine behind the grip), a top sight rail with a box scope, a long
 *  barrel with a slotted brake. */
function rifleModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("rifle", look);
  add(recoil, box, OLIVE, [0.34, 0.46, 1.25], [0, 0, 0.35]);
  add(recoil, box, KHAKI, [0.22, 0.4, 0.26], [0, -0.32, -0.05], [0.25, 0, 0]);
  add(recoil, box, DARK, [0.1, 0.06, 1.0], [0, 0.27, 0.45]);
  add(recoil, box, DARK, [0.16, 0.18, 0.42], [0, 0.39, 0.5]);
  glow(recoil, box, GLOW, [0.1, 0.1, 0.02], [0, 0.39, 0.72]);
  add(recoil, cyl, STEEL, [0.11, 1.15, 0.11], [0, 0.06, 1.55], ALONG);
  add(recoil, box, DARK, [0.2, 0.18, 0.26], [0, 0.06, 2.15]);
  muzzle(recoil, [0, 0.06, 2.3]);
  m.laserFrom = group(recoil, [0.12, 0.16, 0.95]);
  return m;
}

/** Scattergun (Light): two fat barrels one over the other, a ribbed pump fore-end, a drum under the receiver. */
function shotgunModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, muzzle } = kit("shotgun", look);
  add(recoil, box, OLIVE, [0.42, 0.5, 0.9], [0, 0, 0.3]);
  for (const y of [0.1, -0.12]) add(recoil, cyl, STEEL, [0.22, 1.1, 0.22], [0, y, 1.25], ALONG);
  add(recoil, box, DARK, [0.32, 0.22, 0.5], [0, -0.2, 1.0]);
  for (let i = 0; i < 4; i++) add(recoil, box, KHAKI, [0.34, 0.24, 0.05], [0, -0.2, 0.8 + i * 0.13]);
  add(recoil, cyl, KHAKI, [0.46, 0.22, 0.46], [0, -0.36, 0.35]);
  add(recoil, box, DARK, [0.3, 0.46, 0.08], [0, -0.01, 1.82]);
  muzzle(recoil, [0, 0, 1.88]);
  return m;
}

/** Longshot rifle (Medium, hull): a very long fluted barrel on a slim receiver, a big scope with a lens, cheek fins
 *  and a wide three-port muzzle brake. The longest thing on the mech. */
function sniperModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("sniper", look);
  add(recoil, box, OLIVE, [0.52, 0.56, 1.5], [0, 0, 0.4]);
  add(recoil, box, KHAKI, [0.4, 0.4, 0.6], [0.42, -0.08, 0.3]);
  // The scope: a tube on two rings, a lit lens at the front.
  add(recoil, cyl, DARK, [0.26, 1.1, 0.26], [0, 0.5, 0.6], ALONG);
  for (const z of [0.3, 0.9]) add(recoil, box, STEEL, [0.12, 0.2, 0.08], [0, 0.32, z]);
  glow(recoil, cyl, GLOW, [0.2, 0.02, 0.2], [0, 0.5, 1.16], ALONG);
  // The barrel in three fluted lengths, thinning out.
  const len = 4.2;
  for (let i = 0; i < 3; i++) {
    const r = 0.2 - i * 0.03, z0 = 1.15 + (i * len) / 3;
    add(recoil, cyl, i % 2 ? STEEL : DARK, [r, len / 3, r], [0, 0.05, z0 + len / 6], ALONG);
    add(recoil, box, KHAKI, [r * 1.6, 0.04, 0.2], [0, 0.05, z0 + 0.05]);
  }
  for (const x of [0.18, -0.18]) add(recoil, box, DARK, [0.04, 0.3, 0.7], [x, 0.05, 1.5]);
  add(recoil, box, DARK, [0.42, 0.24, 0.42], [0, 0.05, 1.15 + len + 0.2]);
  for (let i = 0; i < 3; i++) add(recoil, box, STEEL, [0.46, 0.05, 0.05], [0, 0.05, 1.15 + len + 0.08 + i * 0.12]);
  muzzle(recoil, [0, 0.05, 1.15 + len + 0.45]);
  m.laserFrom = group(recoil, [0, 0.5, 1.2]);
  return m;
}

/** Flak cannon (Medium, hull): three short, wide barrels bundled in a triangle in a clamp, a drum feed on the flank,
 *  hot vents along the receiver. Stubby and heavy where the sniper is long and thin. */
function flakModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle } = kit("flak", look);
  add(recoil, box, OLIVE, [0.9, 0.8, 1.2], [0, 0, 0.4]);
  add(recoil, cyl, KHAKI, [0.75, 0.42, 0.75], [0.6, 0, 0.35], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 3; i++) glow(recoil, box, HOT, [0.04, 0.08, 0.7], [-0.46, 0.2 - i * 0.18, 0.45]);
  const tri: [number, number][] = [[0, 0.2], [0.19, -0.13], [-0.19, -0.13]];
  for (const [x, y] of tri) {
    add(recoil, cyl, DARK, [0.32, 1.5, 0.32], [x, y, 1.75], ALONG);
    add(recoil, cyl, STEEL, [0.38, 0.18, 0.38], [x, y, 2.45], ALONG);
    muzzle(recoil, [x, y, 2.55]);
  }
  for (const z of [1.3, 2.0]) add(recoil, cyl, KHAKI, [0.8, 0.14, 0.8], [0, 0, z], ALONG);
  return m;
}

/** Breach cannon (Medium, hull; src/weapons/cannon.ts): a tall boxy breech with a sliding block, a thick tapered barrel
 *  with a fume extractor bulge halfway, a big two-baffle muzzle brake and a recoil sleeve. A tank gun on a walker. */
function breachModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle } = kit("breach", look);
  add(m.root, box, OLIVE, [0.95, 0.85, 1.0], [0, 0, 0.2]);
  add(recoil, box, KHAKI, [0.8, 0.95, 0.9], [0, 0.05, 0.25]);
  add(recoil, box, DARK, [0.5, 0.3, 0.12], [0, 0.25, -0.24]);
  glow(recoil, box, HOT, [0.08, 0.06, 0.02], [0.3, 0.42, -0.21]);
  add(recoil, cyl, STEEL, [0.62, 0.7, 0.62], [0, 0.05, 0.95], ALONG);
  add(recoil, cyl, DARK, [0.4, 1.6, 0.4], [0, 0.05, 2.1], ALONG);
  add(recoil, cyl, OLIVE, [0.56, 0.6, 0.56], [0, 0.05, 2.7], ALONG);
  add(recoil, cyl, DARK, [0.34, 1.3, 0.34], [0, 0.05, 3.6], ALONG);
  for (const z of [4.3, 4.6]) add(recoil, box, STEEL, [0.78, 0.36, 0.14], [0, 0.05, z]);
  add(recoil, box, DARK, [0.5, 0.3, 0.6], [0, 0.05, 4.45]);
  muzzle(recoil, [0, 0.05, 4.8]);
  return m;
}

/**
 * Flamers (Keith 2026-11-05: "a dual nozzle ... one nozzle launching flammable material, and the second nozzle applying
 * flames to it"): a fuel nozzle on top (muzzle 0: the stream leaves here) and a short igniter nozzle under it with a
 * pilot flame always lit (glow; muzzle 1: where the flame catches the fuel), a fuel tank and a hose. The held flamer
 * carries one tank under the body; the hull Inferno two big tanks behind the breech, a thicker finned fuel barrel.
 */
function flamerModel(kind: "flamer" | "inferno", look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle } = kit(kind, look);
  const big = kind === "inferno";
  // Keith 2026-11-05: the hull ones stuck out too far forward; a shorter fuel barrel (was 1.25 × the held one's).
  const k = big ? 1.45 : 1, long = big ? 0.9 : 1;
  const HOT = HOT_FIRE, KHAKI = KHAKI_PAINT, OLIVE = OLIVE_PAINT;
  // Body and grip block.
  add(recoil, box, OLIVE, [0.42 * k, 0.4 * k, 0.9 * k], [0, 0, 0.3 * k]);
  add(recoil, box, DARK, [0.3 * k, 0.12 * k, 0.6 * k], [0, 0.25 * k, 0.3 * k]);
  // Fuel tank(s): the held one slung under the body; the Inferno's two standing behind it.
  if (big) {
    for (const x of [-0.28, 0.28]) {
      add(recoil, cyl, KHAKI, [0.44 * k, 0.95 * k, 0.44 * k], [x * k, 0.05 * k, -0.35 * k], ALONG);
      add(recoil, cyl, HOT, [0.46 * k, 0.07 * k, 0.46 * k], [x * k, 0.05 * k, -0.15 * k], ALONG);
      add(recoil, cyl, DARK, [0.2 * k, 0.12 * k, 0.2 * k], [x * k, 0.05 * k, -0.86 * k], ALONG);
    }
  } else {
    add(recoil, cyl, KHAKI, [0.32, 0.8, 0.32], [0, -0.33, 0.25], ALONG);
    add(recoil, cyl, HOT, [0.34, 0.06, 0.34], [0, -0.33, 0.45], ALONG);
    // Two fuel tanks standing out behind the grip as a counterweight (Keith 2026-11-05), banded, capped, piped forward.
    for (const x of [-0.17, 0.17]) {
      add(recoil, cyl, KHAKI, [0.3, 0.75, 0.3], [x, 0.02, -0.5], ALONG);
      add(recoil, cyl, HOT, [0.32, 0.05, 0.32], [x, 0.02, -0.3], ALONG);
      add(recoil, cyl, DARK, [0.14, 0.1, 0.14], [x, 0.02, -0.92], ALONG);
    }
    add(recoil, box, DARK, [0.5, 0.08, 0.12], [0, 0.02, -0.1]);
  }
  // The hose from the tank up into the fuel nozzle's breech.
  add(recoil, ring, DARK, [0.28 * k, 0.28 * k, 0.5 * k], [0.2 * k, -0.12 * k, 0.75 * k], [0, Math.PI / 2, 0]);
  // Fuel nozzle: a long barrel with heat fins and a flared tip.
  const fz = 0.75 * k, fl = 1.1 * k * long;
  add(recoil, cyl, STEEL, [0.17 * k, fl, 0.17 * k], [0, 0.08 * k, fz + fl / 2], ALONG);
  for (let i = 0; i < 4; i++) add(recoil, cyl, DARK, [0.27 * k, 0.04 * k, 0.27 * k], [0, 0.08 * k, fz + 0.15 * k + i * 0.14 * k], ALONG);
  add(recoil, cyl, DARK, [0.24 * k, 0.16 * k, 0.24 * k], [0, 0.08 * k, fz + fl + 0.04 * k], ALONG);
  muzzle(recoil, [0, 0.08 * k, fz + fl + 0.14 * k]);
  // Igniter nozzle under it, a little shorter, with its pilot flame (always lit).
  const iz = fz + fl * 0.78;
  add(recoil, cyl, DARK, [0.09 * k, fl * 0.75, 0.09 * k], [0, -0.1 * k, fz + fl * 0.4], ALONG);
  add(recoil, box, STEEL, [0.12 * k, 0.16 * k, 0.1 * k], [0, -0.03 * k, fz + fl * 0.6]);
  glow(recoil, box, HOT, [0.07 * k, 0.07 * k, 0.14 * k], [0, -0.1 * k, iz + 0.06 * k]);
  muzzle(recoil, [0, -0.1 * k, iz + 0.12 * k]);
  return m;
}

// ---- Freeze rays (Keith 2026-11-05; models 2026-11-05 overnight, agent): their own rigs, not the flamer in new paint ----
// Same sockets as the flamers (muzzle 0: the stream leaves here; muzzle 1: the coolant vent's cold mist), but read as
// cold kit from the game camera: pale insulated pressure vessels for weight behind the mount, a barrel wound with a
// glowing condenser coil (lit while the trigger is held), a flared emitter with an ice-blue lens. Slate and frost white
// where the flamers are olive and khaki.
const PALE = 0xd6dde0, SLATE = 0x5d6a72, ICE = 0x8fd3e8;

/** Frost thrower (Light, held): a squat compressor with a finned heat exchanger on top, one fat dewar flask behind the
 *  grip (domed, banded, a lit gauge) and a pilot bottle beside it, a short coiled barrel ending in a bell. */
function frostModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle } = kit("frost", look);
  // Compressor body and the heat exchanger's fins along its top.
  add(recoil, box, SLATE, [0.44, 0.44, 0.85], [0, 0, 0.3]);
  add(recoil, box, DARK, [0.12, 0.08, 0.72], [0, 0.25, 0.3]);
  for (let i = 0; i < 5; i++) add(recoil, box, STEEL, [0.38, 0.13, 0.04], [0, 0.3, 0.02 + i * 0.14]);
  // The dewar: a fat insulated flask behind the grip, domed at the back, two ice bands, a neck into the compressor.
  add(recoil, cyl, PALE, [0.48, 0.78, 0.48], [0, 0.04, -0.47], ALONG);
  add(recoil, sphere, PALE, [0.48, 0.48, 0.34], [0, 0.04, -0.86]);
  for (const z of [-0.25, -0.68]) add(recoil, cyl, ICE, [0.5, 0.06, 0.5], [0, 0.04, z], ALONG);
  add(recoil, cyl, DARK, [0.3, 0.12, 0.3], [0, 0.04, -0.06], ALONG);
  // Its gauge on top, lit.
  add(recoil, cyl, DARK, [0.15, 0.08, 0.15], [0, 0.31, -0.45]);
  glow(recoil, cyl, GLOW, [0.11, 0.02, 0.11], [0, 0.355, -0.45]);
  // The pilot bottle strapped along the left flank, piped forward.
  add(recoil, cyl, PALE, [0.18, 0.62, 0.18], [0.3, -0.12, -0.32], ALONG);
  add(recoil, cyl, DARK, [0.1, 0.08, 0.1], [0.3, -0.12, -0.67], ALONG);
  add(recoil, cyl, DARK, [0.05, 0.5, 0.05], [0.26, -0.12, 0.15], ALONG);
  // The barrel with its condenser coil, then the bell and the lens.
  add(recoil, cyl, STEEL, [0.15, 1.0, 0.15], [0, 0.04, 1.22], ALONG);
  for (let i = 0; i < 5; i++) glow(recoil, ring, GLOW, [0.28, 0.28, 0.55], [0, 0.04, 0.86 + i * 0.15]);
  add(recoil, cyl, DARK, [0.24, 0.08, 0.24], [0, 0.04, 1.6], ALONG);
  add(recoil, bell, DARK, [0.36, 0.26, 0.36], [0, 0.04, 1.82], ALONG);
  glow(recoil, cyl, GLOW, [0.24, 0.02, 0.24], [0, 0.04, 1.94], ALONG);
  muzzle(recoil, [0, 0.04, 2.02]);
  // The coolant vent under the barrel.
  add(recoil, box, STEEL, [0.12, 0.14, 0.1], [0, -0.1, 0.95]);
  add(recoil, cyl, DARK, [0.08, 0.55, 0.08], [0, -0.17, 1.12], ALONG);
  glow(recoil, cyl, GLOW, [0.07, 0.03, 0.07], [0, -0.17, 1.4], ALONG);
  muzzle(recoil, [0, -0.17, 1.44]);
  return m;
}

/**
 * Cryo projector (Medium, hull). Keith 2026-11-06: the weight sat too far forward, nothing joined it to the hull, the
 * black cradle under the vessels wasn't needed, and two round vessels behind a barrel read wrong. Now super-soaker
 * style: two long insulated tanks lie side by side along the top, on a saddle over a compact receiver that sits back
 * over the shoulder; a manifold with a gauge at their front feeds down into a short coiled barrel, a three-pronged
 * emitter round the lens. A trunnion with a flange reaches inboard into the hull (the side says which way is in).
 */
function cryoModel(look: ToonLook, side: "left" | "right" = "right"): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("cryo", look);
  const inb = side === "right" ? 1 : -1; // +X is the mech's left: a right gun's hull is toward +X
  // Receiver: sits back over the shoulder, an end plate behind, radiator fins down the outboard flank only.
  add(recoil, box, SLATE, [0.6, 0.5, 1.2], [0, -0.05, 0.1]);
  add(recoil, box, DARK, [0.48, 0.38, 0.06], [0, -0.05, -0.52]);
  for (let i = 0; i < 4; i++) add(recoil, box, STEEL, [0.08, 0.38, 0.05], [-inb * 0.33, -0.06, -0.25 + i * 0.22]);
  // The bridge to the hull: a yoke plate on the inboard face, then (its own group, stretched by the arsenal to reach
  // the hull wherever the gun sits out) the trunnion, a bearing collar, a brace under it and the flange on the hull.
  add(recoil, box, DARK, [0.06, 0.42, 0.72], [inb * 0.31, -0.05, 0.05]);
  const bridge = group(recoil, [inb * 0.31, -0.04, 0.02]);
  add(bridge, cyl, STEEL, [0.3, 0.72, 0.3], [inb * 0.36, 0, 0], [0, 0, Math.PI / 2]);
  add(bridge, cyl, DARK, [0.44, 0.1, 0.44], [inb * 0.08, 0, 0], [0, 0, Math.PI / 2]);
  add(bridge, box, STEEL, [0.4, 0.08, 0.12], [inb * 0.3, -0.2, 0.18], [0, 0, inb * 0.45]);
  add(bridge, box, DARK, [0.08, 0.52, 0.52], [inb * 0.68, 0, 0]);
  m.bridge = { g: bridge, from: 0.31, reach: 0.72 };
  // Two long tanks side by side along the top, on a saddle, banded in ice, domed both ends, strapped down.
  add(recoil, box, DARK, [0.56, 0.06, 1.1], [0, 0.23, -0.15]);
  const ty = 0.46, tz0 = -1.0, tz1 = 0.5, tr = 0.4;
  for (const x of [-0.16, 0.16]) {
    add(recoil, cyl, PALE, [tr, tz1 - tz0, tr], [x, ty, (tz0 + tz1) / 2], ALONG);
    add(recoil, sphere, PALE, [tr, tr, 0.24], [x, ty, tz1]);
    add(recoil, sphere, PALE, [tr, tr, 0.24], [x, ty, tz0]);
    for (const z of [-0.72, -0.25]) add(recoil, cyl, ICE, [tr + 0.03, 0.06, tr + 0.03], [x, ty, z], ALONG);
    add(recoil, cyl, DARK, [0.12, 0.1, 0.12], [x, ty, tz0 - 0.15], ALONG);
  }
  for (const z of [-0.5, 0.15]) add(recoil, box, DARK, [0.62, 0.05, 0.09], [0, ty + 0.2, z]);
  // The manifold across the tanks' fronts, its gauge, the feed pipe down into the barrel's collar.
  add(recoil, box, DARK, [0.48, 0.16, 0.14], [0, ty, tz1 + 0.12]);
  add(recoil, cyl, DARK, [0.15, 0.08, 0.15], [0, ty + 0.12, tz1 + 0.12]);
  glow(recoil, cyl, GLOW, [0.11, 0.02, 0.11], [0, ty + 0.165, tz1 + 0.12]);
  add(recoil, cyl, STEEL, [0.1, 0.36, 0.1], [0, 0.26, tz1 + 0.22], [0.35, 0, 0]);
  // The barrel: a collar, then the coil wound along it, short so the weight stays back.
  add(recoil, cyl, DARK, [0.46, 0.16, 0.46], [0, -0.02, 0.76], ALONG);
  add(recoil, cyl, STEEL, [0.28, 0.95, 0.28], [0, -0.02, 1.31], ALONG);
  for (let i = 0; i < 5; i++) glow(recoil, ring, GLOW, [0.44, 0.44, 0.7], [0, -0.02, 0.95 + i * 0.15]);
  add(recoil, cyl, DARK, [0.42, 0.14, 0.42], [0, -0.02, 1.7], ALONG);
  // The emitter: three prongs leaning in round a bell, the lens inside.
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 3, r = 0.22;
    const x = Math.cos(a) * r, y = -0.02 + Math.sin(a) * r;
    const prong = add(recoil, box, STEEL, [0.07, 0.07, 0.42], [x, y, 1.93]);
    prong.rotation.set(Math.sin(a) * 0.18, -Math.cos(a) * 0.18, 0);
  }
  add(recoil, bell, DARK, [0.32, 0.2, 0.32], [0, -0.02, 1.86], ALONG);
  glow(recoil, cyl, GLOW, [0.22, 0.02, 0.22], [0, -0.02, 1.96], ALONG);
  muzzle(recoil, [0, -0.02, 2.04]);
  // The coolant vent under the receiver's nose.
  add(recoil, box, STEEL, [0.16, 0.16, 0.14], [0, -0.36, 0.6]);
  add(recoil, cyl, DARK, [0.11, 0.5, 0.11], [0, -0.36, 0.9], ALONG);
  glow(recoil, cyl, GLOW, [0.09, 0.03, 0.09], [0, -0.36, 1.15], ALONG);
  muzzle(recoil, [0, -0.36, 1.19]);
  return m;
}

/** Napalm launcher (shoulder, Keith 2026-11-05): a line-mortar rack of three fat canister tubes banded in orange, tilted
 *  up and forward, with the gel drum behind. */
function napalmModel(look: ToonLook): WeaponModel {
  const { m, recoil, add, glow, muzzle, group } = kit("napalm", look);
  add(recoil, box, DARK, [1.2, 0.25, 0.75], [0, 0.12, 0]);
  add(recoil, cyl, KHAKI, [0.55, 0.9, 0.55], [0, 0.45, -0.35], [0, 0, Math.PI / 2]);
  add(recoil, cyl, HOT, [0.57, 0.08, 0.57], [0.25, 0.45, -0.35], [0, 0, Math.PI / 2]);
  const rack = group(recoil, [0, 0.35, 0.1], [-0.9, 0, 0]);
  add(rack, box, OLIVE, [1.15, 0.45, 0.55], [0, 0, 0.1]);
  for (let i = 0; i < 3; i++) {
    const x = -0.36 + i * 0.36;
    add(rack, cyl, OLIVE, [0.32, 1.0, 0.32], [x, 0, 0.6], ALONG);
    add(rack, cyl, HOT, [0.34, 0.08, 0.34], [x, 0, 0.85], ALONG);
    add(rack, cyl, DARK, [0.36, 0.1, 0.36], [x, 0, 1.1], ALONG);
    muzzle(rack, [x, 0, 1.15]);
  }
  glow(recoil, box, HOT, [0.1, 0.06, 0.03], [0.55, 0.26, 0.38]);
  return m;
}

/** The box stand-ins, by kind (the fallback). */
/** The box stand-ins take the side where it matters (the cryo projector's bridge reaches inboard). */
export const BOX_MODELS: Record<ModelKind, (look: ToonLook, side?: "left" | "right") => WeaponModel> = {
  rail: (l) => railModel("rail", l),
  railLight: (l) => railModel("railLight", l),
  autocannon: autocannonModel,
  rpg: rpgModel,
  rpgLight: rpgLightModel,
  shoulderRpg: shoulderRpgModel,
  missiles: missilesModel,
  mortar: mortarModel,
  linemortar: lineMortarModel,
  napalm: napalmModel,
  beltfeed: beltFeedModel,
  incendiary: incendiaryFeedModel,
  capacitor: capacitorModel,
  sword: swordModel,
  laser: energyBox("laser"),
  beam: energyBox("beam"),
  lance: energyBox("lance"),
  smg: smgModel,
  rifle: rifleModel,
  shotgun: shotgunModel,
  sniper: sniperModel,
  flak: flakModel,
  breach: breachModel,
  flamer: (l) => flamerModel("flamer", l),
  inferno: (l) => flamerModel("inferno", l),
  frost: frostModel,
  cryo: cryoModel,
  minigunFeed: (l) => { const m = kit("minigunFeed", l).m; return m; },
  plasma: energyBox("plasma"),
  orb: energyBox("orb"),
  arc: energyBox("arc"),
  sunder: energyBox("sunder"),
};

/** Every weapon's model, by kind: the library's (sided: the right one or its left mirror), boxes as the fallback. */
export const WEAPON_MODELS: Record<ModelKind, (look: ToonLook, side?: "left" | "right") => WeaponModel> = Object.fromEntries(
  (Object.keys(BOX_MODELS) as ModelKind[]).map((k) => [k, (look: ToonLook, side: "left" | "right" = "right") =>
    KIND_MODELS[k] ? libraryModel(k, look, side, () => BOX_MODELS[k](look)) : BOX_MODELS[k](look, side)]),
) as Record<ModelKind, (look: ToonLook, side?: "left" | "right") => WeaponModel>;
