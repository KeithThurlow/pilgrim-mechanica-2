// The mech replica's own model (Keith 2026-11-02: "a new model that's just way more wireframey, way more basic ...
// same sort of proportions, but ... super wiry, like the robot mech. Still with miniguns on the side ... builds with
// rockets or miniguns, sort of random"). Code-built, so it costs nothing to change: thin rods on the walker's leg
// joints, ball joints, three-toed wire feet, and an open frame hull (a wire box round a glowing core, a visor eye) with
// a gun pod on a strut each side. Each pod is a minigun (a ring of six thin barrels that spin) or a rocket rack (four
// tubes in a wire cage); `setWeapon` picks which shows (the brain in replicas.ts rolls it). Only reads the sim's joints
// and the guns' aim, like the Rampart (src/mech/rampart.ts), and gives the wreck the same rig.
// Drawing only (cosmetic).
import * as THREE from "three/webgpu";
import type { WalkerSim, LegPose } from "../mech/walker";
import type { UpperSim } from "../mech/upper";
import { WRECK as WRECKED, type MechBody, type DeadRig } from "../game/mechUnit";
import type { ToonLook } from "../look/toon";

export type ReplicaWeapon = "minigun" | "rockets";

/** Sizes (m). Rods thin enough to read as a wire frame from the game camera, thick enough not to vanish. */
const R = { thigh: 0.13, shin: 0.11, cannon: 0.09, frame: 0.065, strut: 0.08, ball: 0.2, toe: 0.06 };
/** The hull frame round its origin (on the hips): half width, bottom, top, back, front. */
const F = { w: 0.85, y0: 0.15, y1: 1.35, z0: -0.7, z1: 0.75 };
/** Pod pivots, each side, in the hull frame. */
const POD = { x: 1.45, y: 0.95, z: 0.1 };

// Unit cylinder from y 0 to 1, radius 1 (scaled per rod), and a unit ball.
const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
const ballGeo = new THREE.IcosahedronGeometry(1, 0);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5);

const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
const A = new THREE.Vector3(), B = new THREE.Vector3();
/** A pivot at a, its +Y to b (scaled to the length), its X along `side` (as the Rampart's bones). */
function aim(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3) {
  Y.subVectors(b, a);
  const len = Y.length();
  if (len < 1e-5) { o.visible = false; return; }
  o.visible = true;
  Y.divideScalar(len);
  X.copy(side).addScaledVector(Y, -side.dot(Y));
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0);
  X.normalize();
  Z.crossVectors(X, Y);
  o.quaternion.setFromRotationMatrix(M.makeBasis(X, Y, Z));
  o.position.copy(a);
  o.scale.set(1, len, 1);
}

interface Leg { thigh: THREE.Group; shin: THREE.Group; cannon: THREE.Group; balls: THREE.Mesh[]; piston: THREE.Group; foot: THREE.Group; toe: THREE.Group }
interface Pod { side: 1 | -1; yawPitch: THREE.Group; kick: THREE.Group; spin: THREE.Group; mini: THREE.Group; rack: THREE.Group; muzzle: { minigun: THREE.Object3D; rockets: THREE.Object3D }; eject: THREE.Object3D }

export class ReplicaBody implements MechBody {
  readonly root = new THREE.Group();
  readonly armed = true;
  weapon: ReplicaWeapon = "minigun";
  private hull = new THREE.Group();
  /** On the hips (the sim's pelvis); the bar across them hangs off it. */
  private pelvis = new THREE.Group();
  private pelvisBar = new THREE.Group();
  private legs: Leg[];
  private pods: Pod[];
  private meshes: THREE.Mesh[] = [];
  private e = new THREE.Euler();
  private left = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(look: ToonLook) {
    this.root.name = "replica";
    this.root.add(this.hull, this.pelvis);
    this.pelvis.add(this.pelvisBar);
    this.pelvisBar.rotation.z = -Math.PI / 2; // its +Y along the hips' +X
    // The hips: a bar across, from hip to hip (posed each frame), and a spine up to the hull.
    this.rod(this.pelvisBar, R.strut * 1.4);

    // Hull: a wire box, crossed on the sides and the back, round a glowing core on a mast; a visor eye at the front.
    const h = this.hull;
    const c = [-1, 1].flatMap((sx) => [F.y0, F.y1].flatMap((y) => [F.z0, F.z1].map((z) => new THREE.Vector3(sx * F.w, y, z))));
    const edge = (i: number, j: number) => this.span(h, c[i], c[j], R.frame);
    // c index: sx*4 + y*2 + z (sx: 0 right, 1 left).
    for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) edge(i, j);
    edge(0, 3); edge(4, 7); edge(0, 6); // side and back braces
    this.span(h, A.set(0, -0.35, 0), B.set(0, F.y1, -0.1), R.strut * 1.2); // the spine
    const core = this.mesh(ballGeo, h, 0.32, [0, 0.75, -0.05], true);
    core.userData.glow = true;
    this.mesh(boxGeo, h, [0.7, 0.08, 0.08], [0, F.y1 - 0.15, F.z1 + 0.02]); // brow bar
    const eye = this.mesh(boxGeo, h, [0.45, 0.14, 0.06], [0, F.y1 - 0.32, F.z1 + 0.05], true);
    eye.userData.glow = true;
    // Shoulder struts out to the pods.
    for (const s of [1, -1] as const) {
      this.span(h, A.set(s * F.w, F.y1 - 0.25, 0.1), B.set(s * (POD.x - 0.15), POD.y, POD.z), R.strut);
      this.span(h, A.set(s * F.w, F.y0 + 0.2, 0.1), B.set(s * (POD.x - 0.15), POD.y - 0.05, POD.z), R.frame);
    }
    this.pods = ([1, -1] as const).map((s) => this.pod(s));

    this.legs = [0, 1].map(() => {
      const bone = (r: number) => { const g = new THREE.Group(); this.root.add(g); this.rod(g, r); return g; };
      const foot = new THREE.Group(), toe = new THREE.Group();
      this.root.add(foot);
      foot.add(toe);
      // Wire feet: a back spur and a bar across, three toes forward on the hinge.
      this.span(foot, A.set(0, 0.06, 0), B.set(0, 0.06, -0.55), R.toe);
      this.span(foot, A.set(-0.3, 0.06, 0.05), B.set(0.3, 0.06, 0.05), R.toe);
      for (const a of [-0.45, 0, 0.45]) this.span(toe, A.set(0, 0.06, 0), B.set(Math.sin(a) * 0.7, 0.04, Math.cos(a) * 0.7), R.toe);
      const balls = [R.ball * 1.15, R.ball, R.ball * 0.85, R.ball * 0.6].map((r) => this.mesh(ballGeo, this.root, r));
      return { thigh: bone(R.thigh), shin: bone(R.shin), cannon: bone(R.cannon), balls, piston: bone(R.frame), foot, toe };
    });
    for (const m of this.meshes) look.apply(m, true);
  }

  private mesh(geo: THREE.BufferGeometry, parent: THREE.Object3D, size: number | [number, number, number], at?: [number, number, number], glow = false) {
    const m = new THREE.Mesh(geo);
    if (typeof size === "number") m.scale.setScalar(size); else m.scale.set(...size);
    if (at) m.position.set(...at);
    if (glow) m.userData.glow = true;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }
  /** A rod child of a pivot, along its +Y from 0 to 1. */
  private rod(parent: THREE.Object3D, r: number) { const m = this.mesh(rodGeo, parent, [r, 1, r]); return m; }
  /** A fixed rod from a to b in `parent`'s frame. */
  private span(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number) {
    const g = new THREE.Group();
    parent.add(g);
    aim(g, a, b, X.set(1, 0, 0).clone());
    this.rod(g, r);
    return g;
  }

  /** A gun pod on a side: the minigun (a ring of barrels on a spinning hub) and the rocket rack, one shown. */
  private pod(side: 1 | -1): Pod {
    const yawPitch = new THREE.Group(), kick = new THREE.Group(), spin = new THREE.Group(), mini = new THREE.Group(), rack = new THREE.Group();
    yawPitch.position.set(side * POD.x, POD.y, POD.z);
    this.hull.add(yawPitch);
    yawPitch.add(kick);
    kick.add(mini, rack);
    this.mesh(ballGeo, yawPitch, 0.22);
    // Minigun: a hub at the back, six barrels round the spin axis, a ring band near the front.
    mini.add(spin);
    this.mesh(tubeGeo, mini, [0.2, 0.2, 0.35], [0, 0, -0.15]);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.mesh(tubeGeo, spin, [0.035, 0.035, 1.35], [Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.1]);
    }
    this.mesh(tubeGeo, spin, [0.17, 0.17, 0.06], [0, 0, 1.05]);
    this.mesh(boxGeo, mini, [0.22, 0.3, 0.3], [side * 0.22, -0.12, -0.05]); // the drum
    const mMuzzle = new THREE.Object3D();
    mMuzzle.position.set(0, 0, 1.5);
    mini.add(mMuzzle);
    // Rockets: a wire cage, four dark tubes in it.
    const cw = 0.28, cz0 = -0.35, cz1 = 0.6;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.span(rack, A.set(sx * cw, sy * cw, cz0), B.set(sx * cw, sy * cw, cz1), R.frame * 0.8);
    for (const z of [cz0, cz1]) for (const [ax, ay, bx, by] of [[-1, -1, 1, -1], [-1, 1, 1, 1], [-1, -1, -1, 1], [1, -1, 1, 1]])
      this.span(rack, A.set(ax * cw, ay * cw, z), B.set(bx * cw, by * cw, z), R.frame * 0.8);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.mesh(tubeGeo, rack, [0.1, 0.1, 0.9], [sx * 0.13, sy * 0.13, cz0 + 0.02]).userData.dark = true;
    const rMuzzle = new THREE.Object3D();
    rMuzzle.position.set(0, 0, cz1 + 0.1);
    rack.add(rMuzzle);
    rack.visible = false;
    const eject = new THREE.Object3D();
    eject.position.set(side * 0.25, 0, 0.1);
    kick.add(eject);
    return { side, yawPitch, kick, spin, mini, rack, muzzle: { minigun: mMuzzle, rockets: rMuzzle }, eject };
  }

  /** Which gun the pods carry. */
  setWeapon(w: ReplicaWeapon) {
    this.weapon = w;
    for (const p of this.pods) { p.mini.visible = w === "minigun"; p.rack.visible = w === "rockets"; }
  }

  update(sim: WalkerSim, upper: UpperSim) {
    const left = this.left.set(1, 0, 0).applyQuaternion(sim.pelvisQ);
    this.e.set(sim.bodyPitch - upper.lean, upper.torsoYaw + upper.shake * Math.sin(performance.now() * 0.09), sim.hullRoll, "YXZ");
    this.hull.quaternion.setFromEuler(this.e);
    this.hull.position.copy(sim.pelvis).addScaledVector(Y.set(0, 1, 0).applyQuaternion(sim.pelvisQ), 0.35);
    const hw = sim.v.hipWidth + 0.15;
    this.pelvis.position.copy(sim.pelvis);
    this.pelvis.quaternion.copy(sim.pelvisQ);
    this.pelvisBar.position.set(-hw, 0, 0);
    this.pelvisBar.scale.set(1, 2 * hw, 1);
    sim.feet.forEach((f, i) => this.pose(this.legs[i], f.pose, left));
    for (const p of this.pods) {
      const g = upper.guns[p.side === 1 ? 0 : 1];
      p.yawPitch.rotation.set(g.pitch, g.yaw, 0, "YXZ");
      p.kick.position.z = -g.kick;
      p.spin.rotation.z = g.spinAngle * -p.side;
    }
  }

  private pose(L: Leg, P: LegPose, side: THREE.Vector3) {
    aim(L.thigh, P.hip, P.knee, side);
    aim(L.shin, P.knee, P.hock, side);
    aim(L.cannon, P.hock, P.ankle, side);
    // A piston from high on the thigh to the shin's middle, so the leg reads as a machine.
    aim(L.piston, A.copy(P.hip).lerp(P.knee, 0.3), B.copy(P.knee).lerp(P.hock, 0.5), side);
    L.balls[0].position.copy(P.hip); L.balls[1].position.copy(P.knee); L.balls[2].position.copy(P.hock); L.balls[3].position.copy(P.ankle);
    L.foot.position.copy(P.foot);
    L.foot.quaternion.copy(P.footQ);
    L.toe.position.copy(P.toeHinge).sub(P.foot).applyQuaternion(this.q.copy(P.footQ).invert());
    L.toe.quaternion.copy(this.q).multiply(P.toeQ);
  }

  shoulderLine(out = new THREE.Vector3()) { return out.set(0, POD.y, 0).applyQuaternion(this.hull.quaternion).add(this.hull.position); }
  muzzle(side: 1 | -1, out = new THREE.Vector3()) { return this.podOf(side).muzzle[this.weapon].getWorldPosition(out); }
  eject(side: 1 | -1, out = new THREE.Vector3()) { return this.podOf(side).eject.getWorldPosition(out); }
  barrel(side: 1 | -1, out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.podOf(side).kick.getWorldQuaternion(this.q)); }
  private podOf(side: 1 | -1) { return side === 1 ? this.pods[0] : this.pods[1]; }

  private tints: { mesh: THREE.Mesh; base: number }[] | null = null;
  /** Paint: every rod in `color` (the robot steel, or the wreck's), the tubes darker; the core and eye keep their glow. */
  paint(look: ToonLook, color: number | null) {
    if (!this.tints) this.tints = this.meshes.filter((m) => !m.userData.glow).map((m) => ({ mesh: m, base: m.userData.dark ? 0x2b2d31 : 0xc7d0d4 }));
    for (const { mesh, base } of this.tints) look.tint(mesh, color === null || mesh.userData.dark ? base : color);
    for (const m of this.meshes) if (m.userData.glow) look.tint(m, color === WRECKED ? 0x2b2d31 : 0x4fe3ff);
  }

  /** For the wreck (src/physics/mechWreck.ts): the leg pivots as the Rampart's, the hull frame as its box. */
  deadRig(): DeadRig {
    return {
      pelvis: this.pelvis, hull: this.hull,
      hullBox: { centre: { x: 0, y: (F.y0 + F.y1) / 2, z: (F.z0 + F.z1) / 2 }, half: { x: F.w + 0.1, y: (F.y1 - F.y0) / 2, z: (F.z1 - F.z0) / 2 } },
      legs: this.legs.map((L) => ({ thigh: L.thigh, shin: L.shin, cannon: L.cannon, foot: L.foot })),
    };
  }

}
