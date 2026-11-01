// Draws a strider (sim: src/combat/strider.ts). Cosmetic. Built in the sim's own Rampart-sized metres and scaled by S
// at the root, so every pose the walker solves lands where the legs are drawn.
//
// The look (Keith 2026-11-01): sci-fi, not construction. White cylindrical plates are the key feature, the mechanical
// bits between them dark and squarish; wiry: thin rods for the legs' bones with white sleeves on them, a slim
// cylindrical chest over an exposed spine and a small abdomen ring (thorax and abdomen), long thin arms hanging, and a
// wide disc head (his Pinterest reference: a wiry mech with a disc head). A red seeker eye and laser on the head's
// rim (red is seeking), a blue emitter under its front (blue is the weapon). Pipes and cables dangle off it, swaying
// on springs (no physics). About 3k triangles.
import * as THREE from "three/webgpu";
import type { LegPose } from "../mech/walker";
import { STRIDER_FRAME, BEAM, SLAM, type Strider } from "./strider";
import { glowMaterial } from "../weapons/ribbon";
import { ROBOT_PALETTE } from "./robotShapes";

/** The robots' shared white palette (ROBOT_PALETTE in robotShapes.ts). */
export const STRIDER_PALETTE = ROBOT_PALETTE;

const P = STRIDER_PALETTE;
const lit = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15, flatShading: true, ...o });
const MAT = {
  plate: lit(P.plate, { roughness: 0.42 }),
  plateDim: lit(P.plateDim),
  joint: lit(P.joint, { metalness: 0.45, roughness: 0.45 }),
  dark: lit(P.dark, { metalness: 0.3, roughness: 0.6 }),
  rod: lit(0x8d9196, { metalness: 0.7, roughness: 0.3 }),
  seek: new THREE.MeshBasicMaterial({ color: P.seek, toneMapped: false }),
};

// Unit shapes with their origin at the bottom (stretched from a joint toward the next) or centred.
const cyl = (seg: number) => new THREE.CylinderGeometry(0.5, 0.5, 1, seg).translate(0, 0.5, 0);
const ROD = cyl(6), SLEEVE = cyl(12), DRUM = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const BOX = new THREE.BoxGeometry(1, 1, 1), BALL = new THREE.SphereGeometry(0.5, 10, 8);
const DISC = new THREE.CylinderGeometry(1, 1, 1, 28);

function part(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, size?: [number, number, number], at?: [number, number, number], rot?: [number, number, number]) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  if (size) mesh.scale.set(...size);
  if (at) mesh.position.set(...at);
  if (rot) mesh.rotation.set(...rot);
  parent.add(mesh);
  return mesh;
}

const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
/** Stretch a bone mesh from a to b, w across `side` and d deep. */
function placeBone(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, w: number, d: number) {
  Y.subVectors(b, a);
  const len = Y.length();
  if (len < 1e-5) { m.visible = false; return; }
  m.visible = true;
  Y.divideScalar(len);
  X.copy(side).addScaledVector(Y, -side.dot(Y));
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0);
  X.normalize();
  Z.crossVectors(X, Y);
  M.makeBasis(X, Y, Z);
  m.quaternion.setFromRotationMatrix(M);
  m.position.copy(a);
  m.scale.set(w, len, d);
}

interface Leg {
  hip: THREE.Mesh; thigh: THREE.Mesh; thighSleeve: THREE.Mesh; knee: THREE.Mesh; kneeCap: THREE.Mesh;
  shinA: THREE.Mesh; shinB: THREE.Mesh; shinSleeve: THREE.Mesh; hock: THREE.Mesh; cannon: THREE.Mesh; ram: THREE.Mesh;
  foot: THREE.Group;
}

/** A cable between two anchors, sagging, its middle lagging on a spring; or a pipe hanging free from one (b null). */
interface Cable { a: THREE.Object3D; b: THREE.Object3D | null; len: number; sag: number; segs: THREE.Mesh[]; mid: THREE.Vector3; vel: THREE.Vector3; r: number; init: boolean }
const CABLE_SEGS = 6;

export class StriderBody {
  readonly root = new THREE.Group();
  /** Everything above the hips, turned by the torso's yaw. */
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private pelvis = new THREE.Group();
  private arms: { pivot: THREE.Group; elbow: THREE.Group }[] = [];
  private legs: Leg[];
  private cables: Cable[] = [];
  private eye: THREE.Mesh;
  private laser: THREE.Mesh;
  private laserMat: THREE.MeshBasicMaterial;
  private emitCore: THREE.Mesh;
  private emitHalo: THREE.Mesh;
  private haloMat: THREE.MeshBasicMaterial;
  private t = 0;

  constructor() {
    const F = STRIDER_FRAME;
    this.root.name = "strider";
    this.root.add(this.pelvis, this.torso);
    // Hips: a dark block with a white drum across it.
    part(BOX, MAT.dark, this.pelvis, [0.9, 0.34, 0.5]);
    part(DRUM, MAT.plate, this.pelvis, [0.42, 1.3, 0.42], [0, 0.04, 0], [0, 0, Math.PI / 2]);
    // The spine: three bare rods up to the chest, through a small white abdomen ring.
    const T = this.torso;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      part(ROD, MAT.rod, T, [0.07, F.chestLow - 0.1, 0.07], [Math.sin(a) * 0.14, 0.1, Math.cos(a) * 0.14 - 0.04]);
    }
    part(SLEEVE, MAT.plate, T, [0.62, 0.26, 0.62], [0, 0.48, -0.02]);
    part(SLEEVE, MAT.joint, T, [0.5, 0.08, 0.5], [0, 0.44, -0.02]);
    part(BOX, MAT.joint, T, [0.34, 0.22, 0.3], [0, 0.88, -0.05]);
    // The chest: a slim white cylinder, a dark band round it, a square vent at the front and a pack behind.
    const ch = F.chestTop - F.chestLow;
    part(SLEEVE, MAT.plate, T, [F.chestR * 2, ch, F.chestR * 2], [0, F.chestLow, 0]);
    part(SLEEVE, MAT.dark, T, [F.chestR * 2.06, 0.1, F.chestR * 2.06], [0, F.chestLow + ch * 0.42, 0]);
    part(SLEEVE, MAT.plateDim, T, [F.chestR * 1.7, 0.12, F.chestR * 1.7], [0, F.chestLow - 0.1, 0]);
    part(BOX, MAT.dark, T, [0.3, 0.32, 0.12], [0, F.chestLow + ch * 0.68, F.chestR - 0.02]);
    part(BOX, MAT.joint, T, [0.22, 0.05, 0.13], [0, F.chestLow + ch * 0.68 + 0.08, F.chestR + 0.02]);
    part(BOX, MAT.plateDim, T, [0.5, 0.62, 0.32], [0, F.chestLow + ch * 0.55, -F.chestR - 0.08]);
    part(BOX, MAT.joint, T, [0.12, 0.5, 0.08], [0.15, F.chestLow + ch * 0.55, -F.chestR - 0.27]);
    part(BOX, MAT.joint, T, [0.12, 0.5, 0.08], [-0.15, F.chestLow + ch * 0.55, -F.chestR - 0.27]);
    // Neck.
    part(ROD, MAT.rod, T, [0.1, F.head - F.chestTop, 0.1], [0, F.chestTop, 0]);
    part(SLEEVE, MAT.joint, T, [0.3, 0.12, 0.3], [0, F.chestTop, 0]);
    // The head: a wide white disc, a dark rim and underside, a red seeker eye on the front of the rim.
    this.head.position.set(0, F.head, 0);
    T.add(this.head);
    const H = this.head;
    part(DISC, MAT.plate, H, [F.headR, F.headH, F.headR]);
    part(DISC, MAT.plateDim, H, [F.headR * 0.55, F.headH * 0.7, F.headR * 0.55], [0, F.headH * 0.6, 0]);
    part(DISC, MAT.dark, H, [F.headR * 1.03, 0.05, F.headR * 1.03], [0, -F.headH * 0.2, 0]);
    part(DISC, MAT.joint, H, [F.headR * 0.62, 0.08, F.headR * 0.62], [0, -F.headH * 0.55, 0]);
    this.eye = part(BOX, MAT.seek, H, [0.34, 0.05, 0.06], [0, 0.0, F.headR + 0.01]);
    this.eye.castShadow = false;
    part(BOX, MAT.seek, H, [0.05, 0.03, 0.05], [0.32, 0.0, F.headR - 0.06]).castShadow = false;
    part(BOX, MAT.seek, H, [0.05, 0.03, 0.05], [-0.32, 0.0, F.headR - 0.06]).castShadow = false;
    // The seeker's laser: a thin red line out of the eye (length set each frame).
    this.laserMat = glowMaterial(P.seek, true);
    this.laser = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), this.laserMat);
    this.laser.position.set(0, 0, F.headR);
    this.laser.frustumCulled = false;
    H.add(this.laser);
    // The blue emitter under the head's front: a dark collar, a blue core, a halo that grows with a charge.
    const emit = new THREE.Group();
    emit.position.set(0, F.emitY - F.head, F.emitZ);
    H.add(emit);
    part(SLEEVE, MAT.joint, emit, [0.26, 0.1, 0.26], [0, -0.02, 0]);
    this.emitCore = part(BALL, new THREE.MeshBasicMaterial({ color: P.beam, toneMapped: false }), emit, [0.16, 0.16, 0.16], [0, -0.04, 0]);
    this.emitCore.castShadow = false;
    this.haloMat = glowMaterial(P.beam, true);
    this.emitHalo = new THREE.Mesh(BALL, this.haloMat);
    this.emitHalo.position.set(0, -0.04, 0);
    emit.add(this.emitHalo);
    // Arms: long and thin, hanging; a dark shoulder ball, a white sleeve on the upper arm, a slim forearm, claws.
    for (const sx of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (F.chestR + 0.1), F.chestTop - 0.2, 0);
      T.add(pivot);
      part(BALL, MAT.joint, pivot, [0.2, 0.2, 0.2]);
      part(ROD, MAT.rod, pivot, [0.07, 1.0, 0.07], [0, -1.0, 0]);
      part(SLEEVE, MAT.plate, pivot, [0.16, 0.6, 0.16], [0, -0.75, 0]);
      const elbow = new THREE.Group();
      elbow.position.set(0, -1.0, 0);
      pivot.add(elbow);
      part(BALL, MAT.joint, elbow, [0.13, 0.13, 0.13]);
      part(SLEEVE, MAT.plateDim, elbow, [0.1, 1.05, 0.1], [0, -1.05, 0]);
      part(BOX, MAT.dark, elbow, [0.12, 0.16, 0.12], [0, -1.12, 0]);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        part(BOX, MAT.joint, elbow, [0.035, 0.28, 0.035], [Math.sin(a) * 0.05, -1.3, Math.cos(a) * 0.05], [Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35]);
      }
      this.arms.push({ pivot, elbow });
    }
    // Legs.
    this.legs = [0, 1].map(() => {
      const foot = new THREE.Group();
      this.root.add(foot);
      part(BOX, MAT.dark, foot, [0.24, 0.16, 0.3], [0, 0.08, -0.02]);
      // Three white toes forward and a spur behind.
      for (const a of [-0.45, 0, 0.45]) part(BOX, MAT.plate, foot, [0.08, 0.08, 0.6], [Math.sin(a) * 0.28, 0.04, Math.cos(a) * 0.28], [0, a, 0]);
      part(BOX, MAT.joint, foot, [0.07, 0.07, 0.36], [0, 0.04, -0.28]);
      return {
        hip: part(BALL, MAT.joint, this.root, [0.3, 0.3, 0.3]),
        thigh: part(ROD, MAT.rod, this.root),
        thighSleeve: part(SLEEVE, MAT.plate, this.root),
        knee: part(BALL, MAT.joint, this.root, [0.22, 0.22, 0.22]),
        kneeCap: part(DRUM, MAT.plate, this.root, [0.3, 0.1, 0.3]),
        shinA: part(ROD, MAT.rod, this.root),
        shinB: part(ROD, MAT.rod, this.root),
        shinSleeve: part(SLEEVE, MAT.plateDim, this.root),
        hock: part(BALL, MAT.joint, this.root, [0.16, 0.16, 0.16]),
        cannon: part(SLEEVE, MAT.plate, this.root),
        ram: part(ROD, MAT.joint, this.root),
        foot,
      };
    });
    // Cables and pipes: two looping from the chest's pack down to the hips, one from under the head to the chest, and
    // two pipes hanging free from the chest's bottom ring.
    const anchor = (parent: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    const cable = (a: THREE.Object3D, b: THREE.Object3D | null, len: number, sag: number, r: number) => {
      const segs: THREE.Mesh[] = [];
      for (let k = 0; k < CABLE_SEGS; k++) { const m = part(ROD, MAT.dark, this.root); m.castShadow = false; segs.push(m); }
      this.cables.push({ a, b, len, sag, segs, mid: new THREE.Vector3(), vel: new THREE.Vector3(), r, init: false });
    };
    const ch0 = F.chestLow + ch * 0.4;
    cable(anchor(T, 0.2, ch0, -F.chestR - 0.2), anchor(this.pelvis, 0.38, 0.05, -0.25), 0, 0.35, 0.06);
    cable(anchor(T, -0.2, ch0, -F.chestR - 0.2), anchor(this.pelvis, -0.38, 0.05, -0.25), 0, 0.45, 0.06);
    cable(anchor(H, 0.3, -F.headH * 0.5, -0.35), anchor(T, 0.25, F.chestTop - 0.1, -0.3), 0, 0.22, 0.045);
    cable(anchor(T, 0.3, F.chestLow - 0.12, 0.15), null, 0.95, 0, 0.07);
    cable(anchor(T, -0.25, F.chestLow - 0.12, 0.22), null, 0.7, 0, 0.05);
  }

  /** Parts by region, for the hold-V selector. */
  regions() {
    return { legs: this.legs.flatMap((L) => [L.thigh, L.thighSleeve, L.shinA, L.shinB, L.shinSleeve, L.cannon, L.foot]), body: [this.torso, this.pelvis] };
  }

  update(s: Strider, dt: number) {
    const sim = s.sim;
    this.t += dt;
    this.root.scale.setScalar(s.S);
    this.pelvis.position.copy(sim.pelvis);
    this.pelvis.quaternion.copy(sim.pelvisQ);
    // The torso rides the hips and turns with the face (the walker's hull lean kept as a little pitch and roll).
    this.torso.position.copy(sim.pelvis);
    this.torso.rotation.set(0, s.face, 0, "YXZ");
    this.head.rotation.set(s.pitch * 0.6, s.seek, 0, "YXZ");
    // Arms swing with the walk, against the legs, and hang back while charging.
    const swing = Math.sin(sim.phase * Math.PI * 2) * Math.min(1, sim.speed * 1.2) * 0.35;
    const charging = s.mode === BEAM || s.mode === SLAM;
    this.arms.forEach((a, i) => {
      const k = i === 0 ? 1 : -1;
      a.pivot.rotation.set(charging ? -0.5 : swing * k + 0.08, 0, k * (charging ? 0.5 : 0.12));
      a.elbow.rotation.set(charging ? -0.4 : -0.25 - Math.max(0, swing * k) * 0.5, 0, 0);
    });
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.pelvisQ);
    sim.feet.forEach((f, i) => this.pose(this.legs[i], f.pose, left));
    // Lights: the seeker eye pulses while sweeping, holds steady once it sees; the laser shows while it seeks or holds.
    const seeking = !s.seen && s.mode === 0 && s.alive;
    (this.eye.material as THREE.MeshBasicMaterial).color.setHex(P.seek).multiplyScalar(seeking ? 0.6 + 0.4 * Math.abs(Math.sin(this.t * 5)) : 1);
    this.laser.visible = s.alive && (seeking || s.seen) && !charging;
    if (this.laser.visible) {
      // Out to the sand along the head's line (or 40 m), in the root's (sim) metres.
      const reach = Math.min(40 / s.S, (sim.pelvis.y + STRIDER_FRAME.head) / Math.max(0.12, Math.sin(Math.max(0.05, s.pitch * 0.6 + 0.12))));
      this.laser.scale.set(0.02, 0.02, reach);
      this.laserMat.opacity = seeking ? 0.35 : 0.6;
    }
    const c = s.charge();
    const k = charging ? c : 0;
    this.emitCore.scale.setScalar(0.16 + k * 0.18);
    this.emitHalo.visible = k > 0.01;
    this.emitHalo.scale.setScalar(0.3 + k * 0.9 + Math.sin(this.t * 30) * 0.03 * k);
    this.haloMat.opacity = 0.25 + k * 0.6;
    // The cables hang off parts that just moved.
    this.root.updateMatrixWorld(true);
    for (const cb of this.cables) this.cable(cb, dt);
  }

  private pose(L: Leg, p: LegPose, side: THREE.Vector3) {
    L.hip.position.copy(p.hip);
    L.knee.position.copy(p.knee);
    L.hock.position.copy(p.hock);
    placeBone(L.thigh, p.hip, p.knee, side, 0.11, 0.11);
    const a = V0.copy(p.hip).lerp(p.knee, 0.12), b = V1.copy(p.hip).lerp(p.knee, 0.72);
    placeBone(L.thighSleeve, a, b, side, 0.3, 0.3);
    // A cap on the knee, across the leg.
    L.kneeCap.position.copy(p.knee);
    L.kneeCap.quaternion.setFromUnitVectors(V2.set(0, 1, 0), side);
    // The shin: two thin rods side by side, a dim sleeve over their middle.
    const off = V3.copy(side).multiplyScalar(0.06);
    placeBone(L.shinA, V0.copy(p.knee).add(off), V1.copy(p.hock).add(off), side, 0.06, 0.06);
    placeBone(L.shinB, V0.copy(p.knee).sub(off), V1.copy(p.hock).sub(off), side, 0.06, 0.06);
    placeBone(L.shinSleeve, V0.copy(p.knee).lerp(p.hock, 0.25), V1.copy(p.knee).lerp(p.hock, 0.7), side, 0.2, 0.17);
    placeBone(L.cannon, p.hock, p.ankle, side, 0.11, 0.11);
    // A ram behind, from the thigh's middle to the shin's.
    const front = V2.subVectors(p.knee, p.hip).cross(side).normalize();
    placeBone(L.ram, V0.copy(p.hip).lerp(p.knee, 0.4).addScaledVector(front, -0.14), V1.copy(p.knee).lerp(p.hock, 0.45).addScaledVector(front, -0.12), side, 0.05, 0.05);
    L.foot.position.copy(p.foot);
    L.foot.quaternion.copy(p.footQ);
  }

  /** A cable sagging between its anchors (or a pipe hanging from one), its middle (or tip) on a spring. */
  private cable(cb: Cable, dt: number) {
    const inv = INV.copy(this.root.matrixWorld).invert();
    const a = cb.a.getWorldPosition(V0).applyMatrix4(inv);
    const b = cb.b ? cb.b.getWorldPosition(V1).applyMatrix4(inv) : V1.copy(a).add(V2.set(0, -cb.len, 0));
    // Rest of the middle (a pipe: its tip) and a spring toward it, so it lags and swings as the body moves.
    const rest = V2.copy(a).lerp(b, cb.b ? 0.5 : 1);
    if (cb.b) rest.y -= cb.sag;
    if (!cb.init) { cb.mid.copy(rest); cb.vel.set(0, 0, 0); cb.init = true; }
    const k = 40, damp = 3.5;
    cb.vel.addScaledVector(V3.subVectors(rest, cb.mid), k * dt).multiplyScalar(Math.max(0, 1 - damp * dt));
    cb.mid.addScaledVector(cb.vel, dt);
    // A pipe keeps its length: the tip on a sphere round its anchor.
    if (!cb.b) { const d = V3.subVectors(cb.mid, a); const l = d.length() || 1; cb.mid.copy(a).addScaledVector(d, cb.len / l); }
    // Quadratic through a, mid, b (a pipe: a straight line to its tip).
    const end = cb.b ? b : cb.mid;
    V4.copy(a);
    for (let i = 0; i < CABLE_SEGS; i++) {
      const u = (i + 1) / CABLE_SEGS;
      const pt = cb.b ? quad(a, cb.mid, end, u, V5) : V5.copy(a).lerp(end, u);
      placeBone(cb.segs[i], V4, pt, X_AXIS, cb.r, cb.r);
      V4.copy(pt);
    }
  }
}

/** A point on the quadratic that passes through a at 0, m at 0.5 and b at 1. */
function quad(a: THREE.Vector3, m: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3) {
  // Control point so the curve passes through m at u = 0.5.
  const cx = 2 * m.x - (a.x + b.x) / 2, cy = 2 * m.y - (a.y + b.y) / 2, cz = 2 * m.z - (a.z + b.z) / 2;
  const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
  return out.set(a.x * w0 + cx * w1 + b.x * w2, a.y * w0 + cy * w1 + b.y * w2, a.z * w0 + cz * w1 + b.z * w2);
}

const V0 = new THREE.Vector3(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const V4 = new THREE.Vector3(), V5 = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const INV = new THREE.Matrix4();
