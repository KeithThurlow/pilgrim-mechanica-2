// Draws a strider (sim: src/combat/strider.ts). Cosmetic. Built in the sim's own Rampart-sized metres and scaled by S
// at the root, so every pose the walker solves lands where the legs are drawn.
//
// The look (Keith 2026-11-01): sci-fi, not construction. White cylindrical plates are the key feature, the mechanical
// bits between them dark and squarish; wiry: thin rods for the legs' bones with white sleeves on them, a slim
// cylindrical chest over an exposed spine and a small abdomen ring (thorax and abdomen), long thin arms hanging, and a
// wide disc head (his Pinterest reference: a wiry mech with a disc head). Third pass (Keith 2026-11-01): no toes (pegs);
// the hull a thin wide disc on a thin spine, leaning toward its prey, the shoulders on its rim; blades and claws on the
// long arms, a grab-and-tear with a scary wind-up. A red seeker eye and laser running round the disc's rim (red is
// seeking), a blue emitter under its front (blue is the weapon). Pipes and cables dangle off it, swaying
// on springs (no physics). About 3k triangles.
import * as THREE from "three/webgpu";
import type { LegPose } from "../mech/walker";
import { STRIDER_FRAME, BEAM, SLAM, type Strider } from "./strider";
import { glowMaterial } from "../weapons/ribbon";
import { ROBOT_PALETTE } from "./robotShapes";
import { footShapeOr } from "../fx/footprint";
import { bakeFootFromObject } from "../fx/footprintMesh";
import { drawBetweenTicks } from "../look/treeInterp";

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
// The disc's shallow lens: wide at the rim, narrowing to the middle (unit height, origin in the middle).
const LENS_TOP = new THREE.CylinderGeometry(0.62, 1, 1, 32);
const LENS_BOTTOM = new THREE.CylinderGeometry(1, 0.5, 1, 32);
// A leg's peg: a white cuff tapering to the pad.
const PEG = new THREE.CylinderGeometry(0.075, 0.035, 0.32, 10).translate(0, 0.16, 0);
const D2R = Math.PI / 180;

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

/** An arm: its joints, its three claws' hinges, and where its pose has eased to (shoulder x and z, elbow, claw spread). */
interface Arm { pivot: THREE.Group; elbow: THREE.Group; claws: THREE.Group[]; x: number; z: number; e: number; spread: number }

export class StriderBody {
  readonly root = drawBetweenTicks(new THREE.Group());
  /** Everything above the hips, turned by the torso's yaw. */
  private torso = new THREE.Group();
  /** The hull disc (leaning toward the prey) and the seeker running round its rim. */
  private disc = new THREE.Group();
  private eyeYaw!: THREE.Group;
  private pelvis = new THREE.Group();
  private arms: Arm[] = [];
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
    // The spine: three thin bare rods from the hips up to the disc, through a small white abdomen ring.
    const T = this.torso;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      part(ROD, MAT.rod, T, [0.06, F.head - 0.1, 0.06], [Math.sin(a) * 0.11, 0.05, Math.cos(a) * 0.11]);
    }
    part(SLEEVE, MAT.plate, T, [0.42, 0.14, 0.42], [0, F.waist, 0]);
    part(SLEEVE, MAT.joint, T, [0.34, 0.05, 0.34], [0, F.waist - 0.04, 0]);
    part(SLEEVE, MAT.plateDim, T, [0.3, 0.3, 0.3], [0, F.head * 0.55, 0]);
    part(SLEEVE, MAT.joint, T, [0.38, 0.1, 0.38], [0, F.head - 0.2, 0]);
    // The hull: a thin wide disc, a shallow lens (white above, dim below, a dark rim), leaning toward what it faces.
    this.disc.position.set(0, F.head, 0);
    T.add(this.disc);
    const D = this.disc, R = F.headR;
    part(LENS_TOP, MAT.plate, D, [R, F.headH * 0.55, R], [0, F.headH * 0.3, 0]);
    part(LENS_BOTTOM, MAT.plateDim, D, [R, F.headH * 0.6, R], [0, -F.headH * 0.25, 0]);
    part(DISC, MAT.dark, D, [R * 1.025, 0.045, R * 1.025]);
    part(DISC, MAT.plate, D, [R * 0.3, F.headH * 0.5, R * 0.3], [0, F.headH * 0.55, 0]);
    part(DISC, MAT.joint, D, [R * 0.42, 0.05, R * 0.42], [0, -F.headH * 0.6, 0]);
    for (let k = 0; k < 6; k++) {
      // Dark ribs out across the top, and square vents between them.
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      part(BOX, MAT.dark, D, [0.05, 0.03, R * 0.62], [Math.sin(a) * R * 0.62, F.headH * 0.42, Math.cos(a) * R * 0.62], [0, a, 0]);
      const b = a + Math.PI / 6;
      part(BOX, MAT.joint, D, [0.16, 0.025, 0.12], [Math.sin(b) * R * 0.78, F.headH * 0.26, Math.cos(b) * R * 0.78], [0, b, 0]);
    }
    // The seeker: a red eye that runs round the disc's rim (its sweep), with its laser.
    this.eyeYaw = new THREE.Group();
    D.add(this.eyeYaw);
    this.eye = part(BOX, MAT.seek, this.eyeYaw, [0.26, 0.05, 0.05], [0, 0, R + 0.02]);
    this.eye.castShadow = false;
    part(BOX, MAT.seek, this.eyeYaw, [0.05, 0.035, 0.04], [0.22, 0, R - 0.02]).castShadow = false;
    part(BOX, MAT.seek, this.eyeYaw, [0.05, 0.035, 0.04], [-0.22, 0, R - 0.02]).castShadow = false;
    this.laserMat = glowMaterial(P.seek, true);
    this.laser = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), this.laserMat);
    this.laser.position.set(0, 0, R + 0.02);
    this.laser.frustumCulled = false;
    this.eyeYaw.add(this.laser);
    // The blue emitter under the disc's front: a dark collar, a blue core, a halo that grows with a charge.
    const emit = new THREE.Group();
    emit.position.set(0, F.emitY - F.head, F.emitZ);
    D.add(emit);
    part(SLEEVE, MAT.joint, emit, [0.24, 0.08, 0.24], [0, -0.02, 0]);
    this.emitCore = part(BALL, new THREE.MeshBasicMaterial({ color: P.beam, toneMapped: false }), emit, [0.15, 0.15, 0.15], [0, -0.04, 0]);
    this.emitCore.castShadow = false;
    this.haloMat = glowMaterial(P.beam, true);
    this.emitHalo = new THREE.Mesh(BALL, this.haloMat);
    this.emitHalo.position.set(0, -0.04, 0);
    emit.add(this.emitHalo);
    // Shoulders on the disc's rim (on its tilt axis, so they stay put as it leans): a dark bracket from the rim, a
    // square housing and a white cap.
    for (const sx of [1, -1]) {
      part(BOX, MAT.dark, T, [0.22, 0.12, 0.26], [sx * (F.headR - 0.02), F.shoulderY, 0]);
      part(BOX, MAT.joint, T, [0.24, 0.3, 0.32], [sx * F.shoulderX, F.shoulderY, 0]);
      part(SLEEVE, MAT.plate, T, [0.38, 0.1, 0.42], [sx * F.shoulderX, F.shoulderY + 0.14, 0]);
    }
    // Arms: very long, hanging nearly to the sand. A white sleeve over the upper arm's rod, a dark elbow, a white
    // forearm with a long dark blade down its outside past the wrist, a blue cutter lamp at the wrist, three long
    // hooked claws on hinges.
    const lampMat = new THREE.MeshBasicMaterial({ color: P.beam, toneMapped: false });
    for (const sx of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * F.shoulderX, F.shoulderY, 0);
      T.add(pivot);
      part(BALL, MAT.joint, pivot, [0.24, 0.24, 0.24]);
      part(ROD, MAT.rod, pivot, [0.08, F.upperArm, 0.08], [0, -F.upperArm, 0]);
      part(SLEEVE, MAT.plate, pivot, [0.24, F.upperArm * 0.62, 0.24], [0, -F.upperArm * 0.78, 0]);
      part(SLEEVE, MAT.dark, pivot, [0.26, 0.05, 0.26], [0, -F.upperArm * 0.5, 0]);
      const elbow = new THREE.Group();
      elbow.position.set(0, -F.upperArm, 0);
      pivot.add(elbow);
      part(BALL, MAT.joint, elbow, [0.2, 0.2, 0.2]);
      part(SLEEVE, MAT.plate, elbow, [0.2, F.foreArm * 0.85, 0.2], [0, -F.foreArm * 0.9, 0]);
      // The blade: down the outside of the forearm and on past the claws, a white edge along it.
      part(BOX, MAT.dark, elbow, [0.05, F.foreArm * 0.95, 0.2], [sx * 0.13, -F.foreArm * 1.18, -0.02]);
      part(BOX, MAT.plate, elbow, [0.03, F.foreArm * 0.8, 0.04], [sx * 0.13, -F.foreArm * 1.25, 0.1]);
      part(BOX, MAT.dark, elbow, [0.22, 0.22, 0.24], [0, -F.foreArm, 0]);
      const lamp = part(BOX, lampMat, elbow, [0.12, 0.05, 0.03], [0, -F.foreArm + 0.04, 0.125]);
      lamp.castShadow = false;
      const claws: THREE.Group[] = [];
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const hinge = new THREE.Group();
        hinge.position.set(Math.sin(a) * 0.08, -F.foreArm - 0.1, Math.cos(a) * 0.08);
        hinge.rotation.y = a;
        elbow.add(hinge);
        // A long finger and its hooked tip, bending out from the wrist (the hinge's x rotation spreads it).
        part(BOX, MAT.joint, hinge, [0.05, 0.45, 0.05], [0, -0.22, 0]);
        part(BOX, MAT.plate, hinge, [0.045, 0.22, 0.045], [0, -0.5, -0.06], [0.7, 0, 0]);
        claws.push(hinge);
      }
      this.arms.push({ pivot, elbow, claws, x: 0, z: 0, e: 0, spread: 0.3 });
    }
    // Legs: no toes; each ends in a peg: a white tapered cuff on a dark pad.
    this.legs = [0, 1].map(() => {
      const foot = new THREE.Group();
      this.root.add(foot);
      part(DRUM, MAT.dark, foot, [0.24, 0.07, 0.24], [0, 0.035, 0]);
      part(PEG, MAT.plate, foot, [1, 1, 1], [0, 0.07, 0]);
      // Its print in the sand, from the pad's model (src/fx/footprint.ts; once, shared by every strider).
      footShapeOr("strider", () => bakeFootFromObject("strider", foot, 1, 0.05));
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
    // Cables and pipes: two looping from under the disc down to the hips, a hose from each shoulder round the back of
    // the upper arm, and three pipes hanging free from under the disc's back and sides.
    const anchor = (parent: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    const cable = (a: THREE.Object3D, b: THREE.Object3D | null, len: number, sag: number, r: number) => {
      const segs: THREE.Mesh[] = [];
      for (let k = 0; k < CABLE_SEGS; k++) { const m = part(ROD, MAT.dark, this.root); m.castShadow = false; segs.push(m); }
      this.cables.push({ a, b, len, sag, segs, mid: new THREE.Vector3(), vel: new THREE.Vector3(), r, init: false });
    };
    cable(anchor(D, 0.35, -F.headH * 0.5, -0.45), anchor(this.pelvis, 0.38, 0.05, -0.2), 0, 0.3, 0.06);
    cable(anchor(D, -0.35, -F.headH * 0.5, -0.45), anchor(this.pelvis, -0.38, 0.05, -0.2), 0, 0.4, 0.06);
    cable(anchor(D, 0.1, -F.headH * 0.5, -R * 0.85), null, 1.1, 0, 0.06);
    cable(anchor(D, R * 0.6, -F.headH * 0.5, -R * 0.55), null, 0.8, 0, 0.05);
    cable(anchor(D, -R * 0.65, -F.headH * 0.5, -R * 0.4), null, 0.65, 0, 0.045);
    this.arms.forEach((a, i) => {
      const sx = i === 0 ? 1 : -1;
      cable(anchor(T, sx * (F.shoulderX - 0.15), F.shoulderY - 0.12, -0.18), anchor(a.pivot, 0, -F.upperArm * 0.45, -0.15), 0, 0.15, 0.05);
    });
  }

  /** Parts by region, for the hold-V selector. */
  regions() {
    return { legs: this.legs.flatMap((L) => [L.thigh, L.thighSleeve, L.shinA, L.shinB, L.shinSleeve, L.cannon, L.foot]), body: [this.torso, this.pelvis] };
  }

  update(s: Strider, dt: number) {
    const sim = s.sim, v = s.v;
    this.t += dt;
    this.root.scale.setScalar(s.S);
    this.pelvis.position.copy(sim.pelvis);
    this.pelvis.quaternion.copy(sim.pelvisQ);
    // The torso rides the hips and turns with the face; the disc leans toward what it faces, with a slow drift.
    this.torso.position.copy(sim.pelvis);
    this.torso.rotation.set(0, s.face, 0, "YXZ");
    const g = s.grab();
    this.disc.rotation.set(v.striderTilt * D2R + s.pitch * 0.25 + (g >= 0 && g < 1 ? -0.25 * g : 0) + Math.sin(this.t * 1.3) * 0.02, 0, Math.sin(this.t * 0.9) * 0.025, "YXZ");
    this.eyeYaw.rotation.y = s.seek;
    const charging = s.mode === BEAM || s.mode === SLAM;
    this.arms.forEach((a, i) => this.arm(a, i === 0 ? 1 : -1, s, g, charging, dt));
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.pelvisQ);
    sim.feet.forEach((f, i) => this.pose(this.legs[i], f.pose, left));
    // Lights: the seeker eye pulses while sweeping, holds steady once it sees, flares through a grab's wind-up; the
    // laser shows while it seeks or holds.
    const seeking = !s.seen && s.mode === 0 && s.alive;
    const flare = g >= 0 && g < 1 ? 1.4 + Math.sin(this.t * 30) * 0.4 : 1;
    (this.eye.material as THREE.MeshBasicMaterial).color.setHex(P.seek).multiplyScalar(seeking ? 0.6 + 0.4 * Math.abs(Math.sin(this.t * 5)) : flare);
    this.laser.visible = s.alive && (seeking || s.seen) && !charging && g < 0;
    if (this.laser.visible) {
      // Out to the sand along the disc's lean (or 40 m), in the root's (sim) metres.
      const down = v.striderTilt * D2R + s.pitch * 0.25;
      const reach = Math.min(40 / s.S, (sim.pelvis.y + STRIDER_FRAME.head) / Math.max(0.12, Math.sin(Math.max(0.05, down))));
      this.laser.scale.set(0.02, 0.02, reach);
      this.laserMat.opacity = seeking ? 0.35 : 0.6;
    }
    const c = s.charge();
    const k = charging ? c : 0;
    this.emitCore.scale.setScalar(0.15 + k * 0.2);
    this.emitHalo.visible = k > 0.01;
    this.emitHalo.scale.setScalar(0.3 + k * 1.0 + Math.sin(this.t * 30) * 0.03 * k);
    this.haloMat.opacity = 0.25 + k * 0.6;
    // The cables hang off parts that just moved.
    this.root.updateMatrixWorld(true);
    for (const cb of this.cables) this.cable(cb, dt);
  }

  /**
   * One arm (side k: 1 its left). Walking: hung a little forward, swinging long against the legs, claws flexing and
   * twitching. Rushing: reaching ahead, claws open. Charging: spread wide. A grab: up and back over the disc with the
   * claws spread and trembling (the tell), a fast swing down at the strike, then wrenching apart, claws clenched.
   */
  private arm(a: Arm, k: number, s: Strider, g: number, charging: boolean, dt: number) {
    const sim = s.sim, t = this.t, ph = k > 0 ? 0 : 1.7;
    const swing = Math.sin(sim.phase * Math.PI * 2) * Math.min(1, sim.speed * 1.2) * 0.35;
    const twitch = Math.max(0, Math.sin(t * 0.7 + ph * 2.3) - 0.93) * 6;
    let x: number, z: number, e: number, spread: number, rate = 8;
    if (g >= 0 && g < 1) {
      const u = g * g * (3 - 2 * g);
      x = -0.3 - 2.4 * u; z = k * (0.1 + 0.45 * u); e = -0.3 - 1.0 * u; spread = 0.4 + 0.8 * u + Math.sin(t * 40 + ph) * 0.06 * u;
      rate = 10;
    } else if (g >= 1) {
      const u = g - 1;
      // The strike comes down in a blink, then the wrenching.
      x = -0.95 + Math.sin(t * 13 + ph) * 0.22; z = k * (0.3 + 0.4 * Math.abs(Math.sin(t * 9 + ph))); e = -0.45 - 0.3 * Math.abs(Math.sin(t * 11 + ph)); spread = 0.05;
      rate = u < 0.15 ? 30 : 12;
    } else if (charging) {
      x = -0.35; z = k * 0.55; e = -0.5; spread = 0.9;
    } else if (s.rushT > 0) {
      x = -0.95 + swing * 0.3; z = k * 0.12; e = -0.55; spread = 0.75 + Math.sin(t * 6 + ph) * 0.1;
    } else {
      x = swing * k - 0.15 - twitch * 0.25; z = k * (0.08 + twitch * 0.1); e = -0.2 - Math.max(0, swing * k) * 0.45 - twitch * 0.3;
      spread = 0.3 + Math.sin(t * 2.2 + ph) * 0.12 + twitch * 0.5;
    }
    const f = Math.min(1, dt * rate);
    a.x += (x - a.x) * f; a.z += (z - a.z) * f; a.e += (e - a.e) * f; a.spread += (spread - a.spread) * Math.min(1, dt * 14);
    a.pivot.rotation.set(a.x, 0, a.z);
    a.elbow.rotation.set(a.e, 0, 0);
    for (const c of a.claws) c.rotation.x = -a.spread;
    void s;
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
