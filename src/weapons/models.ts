// Stand-in models for the new weapons, from boxes and cylinders in the Rampart's khaki, olive and dark steel, until
// modelled ones exist (docs/proposal-weapons.md): a long rail barrel with coils, a chunky autocannon, a box launcher
// with a grid of tubes and a mortar tube for the back mount. Each hangs where the minigun pods and drums are (a gun
// side's pivot, +Z along the barrel; or the back mount) and names its muzzles: the point a beam or shell leaves from,
// or each tube of the rocket pod.
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";

export type ModelKind = "rail" | "railLight" | "autocannon" | "salvo" | "mortar";

export interface WeaponModel {
  kind: ModelKind;
  root: THREE.Group;
  /** Where rounds, beams or rockets leave from (in order: tube i of the pod). */
  muzzles: THREE.Object3D[];
  /** Glowing parts (the rail's coils, the pod's ready lamps): brightness set by the arsenal. */
  glow: THREE.MeshBasicMaterial[];
  /** The part that kicks back along -Z on a shot (barrel, mortar tube). */
  recoil: THREE.Group;
  /** Meshes for the hold-V selector. */
  meshes: THREE.Mesh[];
}

const KHAKI = 0xb7a77c, OLIVE = 0x6c7546, DARK = 0x3e3c35, STEEL = 0x77736b, GLOW = 0x7fe0ff, HOT = 0xff6a2a;
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const ring = new THREE.TorusGeometry(0.5, 0.12, 6, 16);

export function weaponModel(kind: ModelKind, look: ToonLook): WeaponModel {
  const root = new THREE.Group();
  root.name = `weapon-${kind}`;
  const recoil = new THREE.Group();
  root.add(recoil);
  const m: WeaponModel = { kind, root, muzzles: [], glow: [], recoil, meshes: [] };
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, tint: number, size: [number, number, number], at: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geo);
    mesh.scale.set(...size); mesh.position.set(...at); mesh.rotation.set(...rot);
    look.apply(mesh);
    look.tint(mesh, tint);
    parent.add(mesh);
    m.meshes.push(mesh);
    return mesh;
  };
  const glowMesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, col: number, size: [number, number, number], at: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const mat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(...size); mesh.position.set(...at); mesh.rotation.set(...rot);
    parent.add(mesh);
    m.glow.push(mat);
    m.meshes.push(mesh);
    return mesh;
  };
  const muzzle = (parent: THREE.Object3D, at: [number, number, number]) => {
    const o = new THREE.Object3D(); o.position.set(...at); parent.add(o); m.muzzles.push(o); return o;
  };
  const along: [number, number, number] = [Math.PI / 2, 0, 0]; // cylinders along +Z

  if (kind === "rail" || kind === "railLight") {
    // A breech block on the shoulder, two flat rails out front with coils round them, a muzzle shroud.
    const k = kind === "rail" ? 1 : 0.72, len = 3.4 * k;
    add(recoil, box, OLIVE, [0.62 * k, 0.6 * k, 1.1 * k], [0, 0, 0.35 * k]);
    add(recoil, box, DARK, [0.5 * k, 0.18 * k, 0.9 * k], [0, 0.38 * k, 0.3 * k]);
    for (const y of [0.13, -0.13]) add(recoil, box, STEEL, [0.2 * k, 0.09 * k, len], [0, y * k, 0.9 * k + len / 2]);
    for (let i = 0; i < 5; i++) {
      const z = 1.1 * k + (i + 0.5) * (len * 0.82) / 5;
      add(recoil, box, KHAKI, [0.44 * k, 0.5 * k, 0.12 * k], [0, 0, z]);
      glowMesh(recoil, ring, GLOW, [0.42 * k, 0.42 * k, 0.6 * k], [0, 0, z + 0.12 * k]);
    }
    add(recoil, box, DARK, [0.38 * k, 0.46 * k, 0.32 * k], [0, 0, 0.9 * k + len]);
    muzzle(recoil, [0, 0, 1.1 * k + len]);
  } else if (kind === "autocannon") {
    // A chunky receiver, a box magazine, a thick barrel with a muzzle brake.
    add(recoil, box, OLIVE, [0.78, 0.72, 1.3], [0, 0, 0.45]);
    add(recoil, box, KHAKI, [0.5, 0.55, 0.6], [0.55, -0.1, 0.3]);
    add(recoil, cyl, DARK, [0.32, 2.1, 0.32], [0, 0.05, 2.1], along);
    add(recoil, cyl, STEEL, [0.42, 0.5, 0.42], [0, 0.05, 1.25], along);
    add(recoil, box, DARK, [0.5, 0.3, 0.42], [0, 0.05, 3.15]);
    muzzle(recoil, [0, 0.05, 3.4]);
  } else if (kind === "salvo") {
    // A box launcher above the pack, tilted up and forward, its face a 4 x 3 grid of tubes.
    const pod = new THREE.Group();
    pod.position.set(0, 2.15, 0.1);
    pod.rotation.x = -0.6; // tubes point up and forward
    recoil.add(pod);
    add(pod, box, OLIVE, [1.75, 1.05, 1.25], [0, 0, 0]);
    add(pod, box, KHAKI, [1.85, 0.12, 1.3], [0, 0.56, 0]);
    add(pod, box, DARK, [1.6, 0.9, 0.08], [0, 0, 0.64]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const x = -0.57 + c * 0.38, y = 0.27 - r * 0.27;
      add(pod, cyl, STEEL, [0.24, 0.14, 0.24], [x, y, 0.68], along);
      muzzle(pod, [x, y, 0.8]);
    }
    for (const x of [-0.95, 0.95]) add(pod, box, DARK, [0.12, 0.8, 1.0], [x, -0.1, -0.05]);
    glowMesh(pod, box, HOT, [0.14, 0.08, 0.04], [0.72, 0.42, 0.66]);
    add(recoil, box, DARK, [0.5, 0.9, 0.5], [0, 1.6, 0.05]);
  } else if (kind === "mortar") {
    // A turntable on the back, a fat tube tilted up and a little forward, braced.
    const base = add(recoil, cyl, DARK, [1.1, 0.25, 1.1], [0, 1.75, -0.05]);
    void base;
    const tube = new THREE.Group();
    tube.position.set(0, 1.85, -0.05);
    tube.rotation.x = -1.2; // nearly upright, leaning forward
    recoil.add(tube);
    add(tube, cyl, OLIVE, [0.5, 1.9, 0.5], [0, 0, 0.95], along);
    add(tube, cyl, KHAKI, [0.62, 0.3, 0.62], [0, 0, 0.25], along);
    add(tube, cyl, DARK, [0.58, 0.18, 0.58], [0, 0, 1.85], along);
    for (const x of [-0.42, 0.42]) add(recoil, box, STEEL, [0.1, 0.9, 0.12], [x, 2.05, 0.2], [0.5, 0, 0]);
    muzzle(tube, [0, 0, 1.95]);
  }
  return m;
}
