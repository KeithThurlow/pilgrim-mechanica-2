// Draws a crusher (sim: src/combat/crusher.ts). Cosmetic. The shell is built at unit width and scaled by the body
// width; the legs are placed in world space each frame from the sim's hips, knees and feet.
//
// The look (Keith 2026-11-01: a heavy quad, chonkier, a crab feel, a mouth like a jet turbine or a sandworm's maw that
// sucks things up): the robots' white cylindrical plate (ROBOT_PALETTE), a wide low elliptical drum with a domed
// carapace, cylinder pods down its flanks and exhaust stacks behind; four thick legs splayed out to the sides with the
// knees up over the shell, ending in spikes. The front is the maw: a white cowl round a fan that spins up, ringed with
// teeth that fold back like a throat at rest and flare open when it feeds, a blue glow deep inside as it sucks (blue
// is how it hurts). Red seeker lamps over the maw (red is how it seeks). Two pincers either side of the maw rear up
// and open before they snap. About 2.5k triangles.
import * as THREE from "three/webgpu";
import { ROBOT_PALETTE } from "./robotShapes";
import { CRUSHER_FRAME, CLAW, SUCK, type Crusher } from "./crusher";
import type { V3 } from "./robotLegs";
import { drawBetweenTicks } from "../look/treeInterp";

const P = ROBOT_PALETTE;
const lit = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15, flatShading: true, ...o });
const MAT = {
  plate: lit(P.plate, { roughness: 0.42 }),
  plateDim: lit(P.plateDim),
  joint: lit(P.joint, { metalness: 0.45, roughness: 0.45 }),
  dark: lit(P.dark, { metalness: 0.3, roughness: 0.6 }),
  chrome: lit(0xcfd3d6, { metalness: 0.8, roughness: 0.25 }),
  rod: lit(0x8d9196, { metalness: 0.7, roughness: 0.3 }),
  cowl: lit(P.plate, { roughness: 0.42, side: THREE.DoubleSide }),
  throat: new THREE.MeshBasicMaterial({ color: 0x07090c }),
};

const cyl = (seg: number) => new THREE.CylinderGeometry(0.5, 0.5, 1, seg).translate(0, 0.5, 0);
const ROD = cyl(6), SLEEVE = cyl(12), DRUM = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
const BOX = new THREE.BoxGeometry(1, 1, 1), BALL = new THREE.SphereGeometry(0.5, 12, 8);
const SPIKE = new THREE.ConeGeometry(0.5, 1, 6).rotateX(Math.PI).translate(0, 0.5, 0);
const TOOTH = new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0);
const COWL = new THREE.CylinderGeometry(1, 0.86, 1, 24, 1, true).rotateX(Math.PI / 2);
const LIP = new THREE.TorusGeometry(1, 0.13, 6, 24);
const PLATE = new THREE.CircleGeometry(1, 24);

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
/** Stretch a bone mesh (origin at its bottom, along +Y) from a to b, w across `side` and d deep. */
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

interface Leg { hip: THREE.Mesh; thigh: THREE.Mesh; thighRod: THREE.Mesh; knee: THREE.Mesh; shin: THREE.Mesh; shinSleeve: THREE.Mesh; ankle: THREE.Mesh; spike: THREE.Mesh }
interface Pincer { pivot: THREE.Group; fore: THREE.Group; jawA: THREE.Group; jawB: THREE.Group; side: number }

const TEETH = 16, INNER = 10, BLADES = 9;

export class CrusherBody {
  readonly root = drawBetweenTicks(new THREE.Group());
  /** The shell: at the body centre, turned and leaned, scaled by the body width. */
  private shell = new THREE.Group();
  private maw = new THREE.Group();
  private fan = new THREE.Group();
  private inner = new THREE.Group();
  private teeth: THREE.Group[] = [];
  private pincers: Pincer[] = [];
  private legs: Leg[] = [];
  private glowMat = new THREE.MeshBasicMaterial({ color: P.beam, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private lampMat = new THREE.MeshBasicMaterial({ color: P.seek, toneMapped: false });
  private seeker: THREE.Mesh;
  private fanAngle = 0;
  private snap = 0;
  private lastClaw = 0;
  private t = 0;

  constructor() {
    this.root.name = "crusher";
    this.root.add(this.shell);
    const S = this.shell, F = CRUSHER_FRAME;
    S.rotation.order = "YXZ";
    // The hull: a wide, low elliptical drum, a band round it, a domed carapace, a dark belly.
    part(DRUM, MAT.plate, S, [1, F.bodyTall * 0.62, F.bodyDeep], [0, -0.02, 0]);
    part(DRUM, MAT.plateDim, S, [1.025, 0.035, F.bodyDeep * 1.025], [0, 0.06, 0]);
    part(DRUM, MAT.joint, S, [0.97, 0.03, F.bodyDeep * 0.97], [0, -0.12, 0]);
    part(BALL, MAT.plate, S, [0.92, 0.34, F.bodyDeep * 0.9], [0, 0.08, -0.02]);
    part(BALL, MAT.plateDim, S, [0.5, 0.2, 0.42], [0, 0.2, -0.06]);
    part(BOX, MAT.dark, S, [0.66, 0.12, 0.5], [0, -0.17, -0.02]);
    // Cylindrical plates across the back of the carapace (the robots' key feature), and down the flanks.
    for (const z of [-0.2, -0.29]) part(DRUM, MAT.plate, S, [0.1, 0.62, 0.1], [0, 0.14 + z * 0.3, z], [0, 0, Math.PI / 2]);
    for (const sx of [1, -1]) {
      part(DRUM, MAT.plate, S, [0.2, 0.62, 0.2], [sx * 0.47, -0.02, -0.04], [Math.PI / 2, 0, 0]);
      part(DRUM, MAT.joint, S, [0.21, 0.04, 0.21], [sx * 0.47, -0.02, 0.18], [Math.PI / 2, 0, 0]);
      part(DRUM, MAT.joint, S, [0.21, 0.04, 0.21], [sx * 0.47, -0.02, -0.26], [Math.PI / 2, 0, 0]);
      part(DRUM, MAT.dark, S, [0.12, 0.05, 0.12], [sx * 0.47, -0.02, -0.36], [Math.PI / 2, 0, 0]);
      // Exhaust stacks behind, leaning back.
      part(SLEEVE, MAT.dark, S, [0.08, 0.2, 0.08], [sx * 0.16, 0.1, -0.3], [-0.5, 0, 0]);
      part(SLEEVE, MAT.plate, S, [0.1, 0.06, 0.1], [sx * 0.16, 0.12, -0.31], [-0.5, 0, 0]);
      // Hip housings: dark blocks the legs swing from (the legs themselves are placed in world space).
      for (const z of [0.2, -0.2]) part(BOX, MAT.joint, S, [0.16, 0.14, 0.16], [sx * 0.36, -0.05, z]);
    }
    // Red seeker lamps on the brow over the maw, and a sweeping bar.
    for (const x of [-0.17, -0.07, 0.07, 0.17]) part(BOX, this.lampMat, S, [0.035, 0.02, 0.02], [x, 0.17, 0.335], [-0.5, 0, 0]).castShadow = false;
    part(BOX, MAT.dark, S, [0.42, 0.04, 0.04], [0, 0.17, 0.32], [-0.5, 0, 0]);
    this.seeker = part(BOX, this.lampMat, S, [0.06, 0.025, 0.025], [0, 0.17, 0.343], [-0.5, 0, 0]);
    this.seeker.castShadow = false;

    // The maw, its face leaning down toward what it eats.
    this.maw.position.set(0, F.mawY, F.mawZ - 0.08);
    this.maw.rotation.x = 0.3;
    S.add(this.maw);
    const W = this.maw, R = F.mawR;
    part(COWL, MAT.cowl, W, [R * 1.18, R * 1.18, 0.2], [0, 0, 0]);
    part(LIP, MAT.joint, W, [R * 1.18, R * 1.18, R * 1.18], [0, 0, 0.1]);
    part(PLATE, MAT.throat, W, [R, R, 1], [0, 0, -0.09]);
    const glow = part(PLATE, this.glowMat, W, [R * 0.95, R * 0.95, 1], [0, 0, -0.085]);
    glow.castShadow = false;
    // The fan: blades round a chrome spinner.
    this.fan.position.z = -0.05;
    W.add(this.fan);
    for (let k = 0; k < BLADES; k++) {
      const a = (k / BLADES) * Math.PI * 2, b = new THREE.Group();
      b.rotation.z = a;
      this.fan.add(b);
      part(BOX, MAT.chrome, b, [0.045, R * 0.85, 0.01], [0, R * 0.45, 0], [0, 0.55, 0]);
    }
    part(TOOTH, MAT.chrome, this.fan, [0.09, 0.09, 0.09], [0, 0, 0], [Math.PI / 2, 0, 0]);
    // Teeth on the lip: hinged at the rim, pointing in and back like a throat; they flare open when it feeds.
    for (let k = 0; k < TEETH; k++) {
      const a = (k / TEETH) * Math.PI * 2, pv = new THREE.Group();
      pv.position.set(Math.cos(a) * R * 1.1, Math.sin(a) * R * 1.1, 0.09);
      pv.rotation.z = a - Math.PI / 2;
      W.add(pv);
      part(TOOTH, k % 2 ? MAT.plate : MAT.chrome, pv, [0.035, k % 2 ? 0.08 : 0.11, 0.035], [0, 0, 0], [0, 0, Math.PI]);
      this.teeth.push(pv);
    }
    // A second, inner ring of smaller teeth, turning against the fan.
    this.inner.position.z = 0.02;
    W.add(this.inner);
    for (let k = 0; k < INNER; k++) {
      const a = (k / INNER) * Math.PI * 2;
      part(TOOTH, MAT.chrome, this.inner, [0.025, 0.06, 0.025], [Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8, 0], [0.5, 0, a + Math.PI / 2]);
    }

    // Pincers either side of the maw.
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * (F.clawX + 0.04), -0.07, 0.3);
      S.add(pivot);
      part(BALL, MAT.joint, pivot, [0.1, 0.1, 0.1]);
      part(SLEEVE, MAT.plate, pivot, [0.085, 0.16, 0.085], [0, 0, 0], [Math.PI / 2, 0, 0]);
      part(BOX, MAT.dark, pivot, [0.05, 0.05, 0.16], [0, -0.04, 0.08]);
      const fore = new THREE.Group();
      fore.position.set(0, 0, 0.16);
      pivot.add(fore);
      part(BALL, MAT.joint, fore, [0.075, 0.075, 0.075]);
      part(BOX, MAT.plateDim, fore, [0.07, 0.065, 0.12], [0, 0, 0.06]);
      const jaw = (up: number) => {
        const g = new THREE.Group();
        g.position.set(0, up * 0.02, 0.11);
        fore.add(g);
        part(BOX, MAT.plate, g, [0.05, 0.028, 0.12], [0, up * 0.012, 0.06]);
        part(SPIKE, MAT.chrome, g, [0.03, 0.06, 0.03], [0, up * 0.004, 0.17], [-Math.PI / 2, 0, 0]);
        return g;
      };
      this.pincers.push({ pivot, fore, jawA: jaw(1), jawB: jaw(-1), side });
    }

    // Legs (world space).
    for (let k = 0; k < 4; k++) {
      const leg: Leg = {
        hip: part(BALL, MAT.joint, this.root),
        thigh: part(SLEEVE, MAT.plate, this.root),
        thighRod: part(ROD, MAT.rod, this.root),
        knee: part(BALL, MAT.plateDim, this.root),
        shin: part(ROD, MAT.joint, this.root),
        shinSleeve: part(SLEEVE, MAT.plate, this.root),
        ankle: part(BALL, MAT.joint, this.root),
        spike: part(SPIKE, MAT.joint, this.root),
      };
      this.legs.push(leg);
    }
  }

  update(c: Crusher, dt: number) {
    this.t += dt;
    const W = c.W, S = this.shell;
    S.position.set(c.x, c.bodyY, c.z);
    S.rotation.set(c.pitch, c.heading, -c.roll);
    S.scale.setScalar(W);
    // Legs.
    for (let k = 0; k < 4; k++) {
      const l = this.legs[k];
      c.leg(k, HIP, KNEE, TIP, FOOT);
      VH.set(HIP.x, HIP.y, HIP.z); VK.set(KNEE.x, KNEE.y, KNEE.z); VT.set(TIP.x, TIP.y, TIP.z); VF.set(FOOT.x, FOOT.y, FOOT.z);
      SIDE.set(Math.cos(c.heading), 0, -Math.sin(c.heading));
      l.hip.position.copy(VH); l.hip.scale.setScalar(W * 0.17);
      placeBone(l.thigh, VH, VK, SIDE, W * 0.16, W * 0.17);
      placeBone(l.thighRod, VH, VK, SIDE, W * 0.06, W * 0.22);
      l.knee.position.copy(VK); l.knee.scale.setScalar(W * 0.15);
      placeBone(l.shin, VK, VT, SIDE, W * 0.08, W * 0.08);
      MID.lerpVectors(VK, VT, 0.62);
      placeBone(l.shinSleeve, VK, MID, SIDE, W * 0.13, W * 0.13);
      l.ankle.position.copy(VT); l.ankle.scale.setScalar(W * 0.08);
      placeBone(l.spike, VT, VF, SIDE, W * 0.1, W * 0.1);
    }
    // The maw: the fan spins up, the teeth flare, the throat glows blue as it sucks.
    const spin = c.spin, open = c.alive ? spin : 0;
    this.fanAngle += dt * (1.5 + spin * 26);
    this.fan.rotation.z = this.fanAngle;
    this.inner.rotation.z = -this.fanAngle * 0.25;
    const breathe = c.alive ? Math.sin(this.t * 1.6) * 0.06 : 0;
    const flare = -0.35 - open * 1.15 + breathe + (c.mode === SUCK ? Math.sin(this.t * 22) * 0.05 : 0);
    for (const pv of this.teeth) pv.rotation.x = flare;
    const pulse = c.mode === SUCK ? 0.85 + Math.sin(this.t * 18) * 0.15 : 1;
    this.glowMat.opacity = c.alive ? Math.min(1, spin * spin * pulse) : 0;
    // Seeker lamps: a bar sweeping along the brow while it seeks, steady while it hunts, flashing as it spins up.
    this.seeker.position.x = c.alive ? Math.sin(c.seek * 3) * 0.17 : 0;
    const flash = c.alive && spin > 0.05 && spin < 0.99 ? (Math.sin(this.t * 30) > 0 ? 1 : 0.3) : 1;
    this.lampMat.color.setHex(c.alive ? P.seek : 0x200806).multiplyScalar(flash);
    // Pincers: idle sway; the striking one rears up, out and opens, then snaps down and shut.
    const clawT = c.mode === CLAW ? c.clawT : 0;
    if (this.lastClaw > 0.9 && c.mode !== CLAW) this.snap = 1;
    this.lastClaw = c.mode === CLAW ? c.clawT : 0;
    this.snap = Math.max(0, this.snap - dt * 4);
    for (const p of this.pincers) {
      const striking = p.side === c.clawSide;
      const r = striking ? clawT : 0, s = striking ? this.snap : 0;
      const sway = c.alive ? Math.sin(this.t * 1.3 + p.side) * 0.08 : 0.5;
      p.pivot.rotation.set(0.35 - r * 1.1 + s * 0.5 + sway + (c.alive ? 0 : 0.6), p.side * (0.15 + r * 0.45 - s * 0.3), 0);
      p.fore.rotation.x = 0.4 - r * 0.5 + s * 0.2;
      const jaw = c.alive ? 0.12 + r * 0.7 - s * 0.12 + (spin > 0.5 ? 0.15 : 0) : 0.4;
      p.jawA.rotation.x = -jaw; p.jawB.rotation.x = jaw;
    }
  }
}

const HIP: V3 = { x: 0, y: 0, z: 0 }, KNEE: V3 = { x: 0, y: 0, z: 0 }, TIP: V3 = { x: 0, y: 0, z: 0 }, FOOT: V3 = { x: 0, y: 0, z: 0 };
const VH = new THREE.Vector3(), VK = new THREE.Vector3(), VT = new THREE.Vector3(), VF = new THREE.Vector3(), MID = new THREE.Vector3(), SIDE = new THREE.Vector3();
