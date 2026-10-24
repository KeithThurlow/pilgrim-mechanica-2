// Bake Mixamo's Vanguard (T. Choonyung) and a few rifle clips into a vertex animation texture for the bandit swarm
// (Keith 2026-10-24). Offline; the source FBXs stay out of git, the output is committed:
//   npx tsx tools/mixamo/bake-bandit.ts [<vanguard.fbx> <clip dir>]
// Steps: load the character (embedded texture sampled into vertex colours, a cloth mask from the tan plates),
// thin it with meshoptimizer, add a box rifle, then for each clip retarget the tracks by bone name (Mixamo prefixes
// stripped), scale the hips track to Vanguard's hip height, take the walk forward out of the hips so the sim drives
// position (the speed it carried is kept to match the run to the sim), pose the skeleton frame by frame, skin the
// kept vertices on the CPU and store positions and normals. Format: src/combat/banditVatFormat.ts.
import { writeFileSync, mkdirSync } from "node:fs";
import * as THREE from "three";
import { loadFbx, sample, boneKey } from "./nodeFbx";
import { thin, type SoupVertex } from "./decimate";
import type { VatHeader, VatClip, VatClipName } from "../../src/combat/banditVatFormat";

const CHAR = process.argv[2] ?? "/mnt/user-data/uploads/pilgrim-mechanica-2/Resources/mixamo/Vanguard By T. Choonyung.fbx";
const CLIPS_DIR = process.argv[3] ?? "/mnt/user-data/uploads/pilgrim-mechanica/Assets/_Project/Art/Animations/Mixamo/";
const OUT = "public/models/bandit-vat";
const TARGET_TRIS = 2200;
const CM = 0.01;

/** Clip name → source file, sample rate, loop, and whether both hands hold the rifle. */
const CLIPS: Record<VatClipName, { file: string; fps: number; loop: boolean; rifle: boolean }> = {
  run: { file: "Rifle/Rifle_Run_F.fbx", fps: 30, loop: true, rifle: true },
  sprint: { file: "Locomotion/Sprint_F.fbx", fps: 30, loop: true, rifle: false },
  runFire: { file: "Rifle/Rifle_Run_F_Firing_A.fbx", fps: 30, loop: true, rifle: true },
  walkFire: { file: "Rifle/Rifle_Walk_F_Firing.fbx", fps: 24, loop: true, rifle: true },
  aim: { file: "Stances/Rifle_Idle_Aim.fbx", fps: 12, loop: true, rifle: true },
  flinch: { file: "Reactions/Hit_Flinch.fbx", fps: 30, loop: false, rifle: false },
};

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// --- Character --------------------------------------------------------------------------------------------------
const { root, decode } = loadFbx(CHAR);
const skinned: THREE.SkinnedMesh[] = [];
root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
const body = skinned.find((m) => /mesh/i.test(m.name)) ?? skinned[0];
const bones = body.skeleton.bones;
const boneIndex = new Map(bones.map((b, i) => [boneKey(b.name), i]));
const boneInv = body.skeleton.boneInverses;
const rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
const hipsRestY = bones[boneIndex.get("Hips")!].position.y;

const soup: SoupVertex[] = [], tris: number[] = [];
for (const m of skinned) {
  const g = m.geometry, mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshPhongMaterial;
  const img = m === body ? await decode(mat.map) : null; // the visor's map is the body sheet: use a flat dark glass
  const P = g.attributes.position, UV = g.attributes.uv, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const remapBone = (k: number) => boneIndex.get(boneKey(m.skeleton.bones[k].name)) ?? 0;
  const base = soup.length;
  for (let i = 0; i < P.count; i++) {
    let rgb: [number, number, number] = [0.07, 0.09, 0.1];
    if (img && UV) rgb = sample(img, UV.getX(i), UV.getY(i));
    const lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
    // The tan armour plates take the bandit's cloth colour.
    const mask = img ? smooth(0.42, 0.58, lum) * smooth(0.08, 0.18, rgb[0] - rgb[2]) : 0;
    soup.push({
      p: [P.getX(i), P.getY(i), P.getZ(i)],
      c: [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2]), mask],
      skinI: [0, 1, 2, 3].map((k) => remapBone(SI.getComponent(i, k))),
      skinW: [0, 1, 2, 3].map((k) => SW.getComponent(i, k)),
    });
  }
  const n = g.index ? g.index.count : P.count;
  for (let k = 0; k < n; k++) tris.push(base + (g.index ? g.index.getX(k) : k));
}
const srcTris = tris.length / 3;
const { verts, index: bodyIndex } = await thin(soup, tris, TARGET_TRIS);
console.log(`Vanguard: ${srcTris} tris -> ${bodyIndex.length / 3} tris, ${verts.length} vertices`);

// --- Rifle: boxes in a grip frame (cm; x right, y up, z along the barrel; origin in the right palm) -------------------
const rifleLocal: { p: THREE.Vector3; face: number }[] = [];
const rifleTris: number[] = [];
function box(cx: number, cy: number, cz: number, w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const P = g.attributes.position;
  const base = rifleLocal.length;
  for (let i = 0; i < P.count; i++) rifleLocal.push({ p: new THREE.Vector3(P.getX(i) + cx, P.getY(i) + cy, P.getZ(i) + cz), face: 0 });
  for (let i = 0; i < P.count; i++) rifleTris.push(base + i);
}
box(0, 4, 8, 5, 9, 36);     // receiver
box(0, 5, 38, 3, 4, 26);    // handguard
box(0, 5.5, 58, 1.6, 1.6, 16); // barrel
box(0, 2, -18, 4.5, 11, 22); // stock
box(0, -6, 14, 3.5, 13, 6);  // magazine
box(0, -3, 0, 3, 8, 4);      // grip
const RIFLE_RGB: [number, number, number, number] = [toLinear(0.13), toLinear(0.12), toLinear(0.11), 0];

// --- Clips --------------------------------------------------------------------------------------------------------
const V = verts.length + rifleLocal.length;
const allIndex = [...bodyIndex, ...rifleTris.map((i) => i + verts.length)];
const T = allIndex.length / 3;
const framesPos: Float32Array[] = [];
const clips = {} as Record<VatClipName, VatClip>;

const boneMats = bones.map(() => new THREE.Matrix4());
const tmp = new THREE.Vector3(), acc = new THREE.Vector3();
const rh = new THREE.Vector3(), lh = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3();
const rifleBasis = new THREE.Matrix4();
let rifleInHand: THREE.Matrix4 | null = null; // grip frame in the right hand's space, from the aim pose

function restPose() { bones.forEach((b, i) => { b.position.copy(rest[i].p); b.quaternion.copy(rest[i].q); b.scale.copy(rest[i].s); }); }

function retarget(src: THREE.AnimationClip, ratio: number): { clip: THREE.AnimationClip; speed: number } {
  const tracks: THREE.KeyframeTrack[] = [];
  let speed = 0;
  for (const t of src.tracks) {
    const dot = t.name.lastIndexOf(".");
    const bone = boneIndex.get(boneKey(t.name.slice(0, dot))), prop = t.name.slice(dot + 1);
    if (bone === undefined) continue;
    const name = `${bones[bone].name}.${prop}`;
    if (prop === "quaternion") { tracks.push(new THREE.QuaternionKeyframeTrack(name, t.times, t.values)); continue; }
    if (prop !== "position" || boneKey(bones[bone].name) !== "Hips") continue;
    // Hips: scale to Vanguard and take the travel out (the sim moves the bandit).
    const v = Float32Array.from(t.values), n = v.length / 3, dur = src.duration || 1;
    const dx = v[n * 3 - 3] - v[0], dz = v[n * 3 - 1] - v[2];
    speed = (Math.hypot(dx, dz) * ratio * CM) / dur;
    for (let k = 0; k < n; k++) {
      const f = t.times[k] / dur;
      v[k * 3] = (v[k * 3] - dx * f) * ratio; v[k * 3 + 1] *= ratio; v[k * 3 + 2] = (v[k * 3 + 2] - dz * f) * ratio;
    }
    tracks.push(new THREE.VectorKeyframeTrack(name, t.times, v));
  }
  return { clip: new THREE.AnimationClip(src.name, src.duration, tracks), speed };
}

function gripFrame(out: THREE.Matrix4, twoHands: boolean) {
  const hand = bones[boneIndex.get("RightHand")!];
  if (twoHands) {
    rh.setFromMatrixPosition(hand.matrixWorld);
    lh.setFromMatrixPosition(bones[boneIndex.get("LeftHand")!].matrixWorld);
    fwd.subVectors(lh, rh).normalize();
    right.crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize().negate();
    up.crossVectors(fwd, right).normalize();
    // Palm a little past the wrist, toward the left hand.
    out.makeBasis(right, up, fwd).setPosition(rh.addScaledVector(fwd, 6).addScaledVector(up, -3));
  } else {
    out.multiplyMatrices(hand.matrixWorld, rifleInHand!);
  }
}

let row = 0;
// Bake the aim stance first: its first frame gives the rifle's place in the hand for the one-handed clips.
const order: VatClipName[] = ["aim", "run", "sprint", "runFire", "walkFire", "flinch"];
for (const name of order) {
  const cfg = CLIPS[name];
  const { root: croot } = loadFbx(CLIPS_DIR + cfg.file);
  let clipHips = 0;
  croot.traverse((o) => { if ((o as THREE.Bone).isBone && boneKey(o.name) === "Hips" && !clipHips) clipHips = o.position.y; });
  const { clip, speed } = retarget(croot.animations[0], hipsRestY / clipHips);
  const dur = clip.duration;
  const frames = cfg.loop ? Math.max(1, Math.round(dur * cfg.fps)) : Math.round(dur * cfg.fps) + 1;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  let minY = Infinity, maxY = -Infinity;
  for (let f = 0; f < frames; f++) {
    const t = cfg.loop ? (f * dur) / frames : (f * dur) / Math.max(1, frames - 1);
    restPose();
    mixer.setTime(Math.min(t, dur - 1e-4));
    root.updateMatrixWorld(true);
    bones.forEach((b, i) => boneMats[i].multiplyMatrices(b.matrixWorld, boneInv[i]));
    const out = new Float32Array(V * 3);
    verts.forEach((v, k) => {
      acc.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        const w = v.skinW[j];
        if (w > 0) acc.addScaledVector(tmp.set(v.p[0], v.p[1], v.p[2]).applyMatrix4(boneMats[v.skinI[j]]), w);
      }
      out[k * 3] = acc.x * CM; out[k * 3 + 1] = acc.y * CM; out[k * 3 + 2] = acc.z * CM;
      minY = Math.min(minY, acc.y * CM); maxY = Math.max(maxY, acc.y * CM);
    });
    if (!rifleInHand) {
      gripFrame(rifleBasis, true);
      rifleInHand = new THREE.Matrix4().copy(bones[boneIndex.get("RightHand")!].matrixWorld).invert().multiply(rifleBasis);
    }
    gripFrame(rifleBasis, cfg.rifle);
    rifleLocal.forEach((r, k) => {
      tmp.copy(r.p).applyMatrix4(rifleBasis);
      const o = (verts.length + k) * 3;
      out[o] = tmp.x * CM; out[o + 1] = tmp.y * CM; out[o + 2] = tmp.z * CM;
    });
    framesPos.push(out);
  }
  clips[name] = { start: row, frames, fps: cfg.fps, loop: cfg.loop, speed: +speed.toFixed(3), duration: +dur.toFixed(4) };
  row += frames;
  console.log(`${name}: ${cfg.file} ${dur.toFixed(2)} s, ${frames} frames, speed ${speed.toFixed(2)} m/s, y ${minY.toFixed(2)}..${maxY.toFixed(2)}`);
}

// --- Normals per frame ----------------------------------------------------------------------------------------------
function octEncode(x: number, y: number, z: number): [number, number] {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / s, v = y / s;
  if (z < 0) { const ou = u; u = (1 - Math.abs(v)) * Math.sign(ou || 1); v = (1 - Math.abs(ou)) * Math.sign(v || 1); }
  return [Math.round((u * 0.5 + 0.5) * 255), Math.round((v * 0.5 + 0.5) * 255)];
}
const F = framesPos.length;
const posHalf = new Uint16Array(F * V * 4), nrm = new Uint8Array(F * V * 2);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new Float32Array(V * 3);
framesPos.forEach((P, f) => {
  n.fill(0);
  for (let t = 0; t < T; t++) {
    const i0 = allIndex[t * 3], i1 = allIndex[t * 3 + 1], i2 = allIndex[t * 3 + 2];
    a.fromArray(P, i0 * 3); b.fromArray(P, i1 * 3).sub(a); c.fromArray(P, i2 * 3).sub(a);
    b.cross(c); // area-weighted
    for (const i of [i0, i1, i2]) { n[i * 3] += b.x; n[i * 3 + 1] += b.y; n[i * 3 + 2] += b.z; }
  }
  for (let v = 0; v < V; v++) {
    const o = (f * V + v);
    posHalf[o * 4] = THREE.DataUtils.toHalfFloat(P[v * 3]);
    posHalf[o * 4 + 1] = THREE.DataUtils.toHalfFloat(P[v * 3 + 1]);
    posHalf[o * 4 + 2] = THREE.DataUtils.toHalfFloat(P[v * 3 + 2]);
    posHalf[o * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
    const L = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    const [u, w] = octEncode(n[v * 3] / L, n[v * 3 + 1] / L, n[v * 3 + 2] / L);
    nrm[o * 2] = u; nrm[o * 2 + 1] = w;
  }
});

// --- Write ---------------------------------------------------------------------------------------------------------
const colour = new Float32Array(V * 4);
verts.forEach((v, k) => colour.set(v.c, k * 4));
for (let k = 0; k < rifleLocal.length; k++) colour.set(RIFLE_RGB, (verts.length + k) * 4);
const clothSum = [0, 0, 0, 0];
verts.forEach((v) => { if (v.c[3] > 0.5) { clothSum[0] += v.c[0]; clothSum[1] += v.c[1]; clothSum[2] += v.c[2]; clothSum[3]++; } });
const clothRef: [number, number, number] = [0, 1, 2].map((i) => +(clothSum[i] / Math.max(1, clothSum[3])).toFixed(4)) as [number, number, number];
const index16 = new Uint16Array(allIndex);
const restPos = framesPos[clips.run.start];

const parts = [posHalf, nrm, colour, index16, restPos];
const offsets: number[] = [];
let size = 0;
for (const p of parts) { size = Math.ceil(size / 4) * 4; offsets.push(size); size += p.byteLength; }
const bin = new Uint8Array(size);
parts.forEach((p, i) => bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offsets[i]));

const bb = new THREE.Box3();
for (let v = 0; v < verts.length; v++) bb.expandByPoint(new THREE.Vector3(verts[v].p[0], verts[v].p[1], verts[v].p[2]));
const header: VatHeader = {
  version: 1, vertices: V, triangles: T, frames: F, height: +(bb.max.y * CM).toFixed(3), clothRef, clips,
  offsets: { pos: offsets[0], normal: offsets[1], colour: offsets[2], index: offsets[3], rest: offsets[4] },
  source: `Vanguard by T. Choonyung (Mixamo), ${srcTris} tris thinned; clips: ${order.map((k) => CLIPS[k].file).join(", ")}`,
};
mkdirSync("public/models", { recursive: true });
writeFileSync(`${OUT}.bin`, bin);
writeFileSync(`${OUT}.json`, JSON.stringify(header, null, 1));
console.log(`wrote ${OUT}.bin (${(size / 1024).toFixed(0)} KB): ${V} vertices (${rifleLocal.length} rifle), ${T} tris, ${F} frames; ` +
  `pos texture ${V}x${F} RGBA16F, normal texture ${V}x${F} RG8; height ${header.height} m; cloth ref ${clothRef}`);
