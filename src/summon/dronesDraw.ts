// Draws the attack drones (drones.ts): small quadcopters in the summoner's paint (warm sand plate over gunmetal, a
// cyan eye so they read as yours next to the robots' red), tilted into their acceleration, rotors spinning. All
// instanced: frames (one merged geometry with vertex colours), rotor discs, eye lamps. Cosmetic.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DRONE_MAX, type Drones } from "./drones";

/** The summoner's paint (shared with the companions' tint, summons.ts). */
export const SUMMON_PAINT = { plate: 0xc98a3a, dark: 0x2b2d31, eye: 0x4fe3ff, rotor: 0x15171a } as const;

function coloured(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = out.getAttribute("position").count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  out.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return out;
}

/** Rotor hubs in the frame (m, for a drone 1.1 m across). */
const HUB = 0.42;

/** One drone's frame, 1.1 m across, forward +Z: a body pod, four arms, motor cans, a gun under the nose. */
function frameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.24, 0.3, 0.2, 8); body.scale(1, 1, 1.35);
  parts.push(coloured(body, SUMMON_PAINT.plate));
  const top = new THREE.CylinderGeometry(0.16, 0.22, 0.08, 8); top.scale(1, 1, 1.3); top.translate(0, 0.13, -0.04);
  parts.push(coloured(top, SUMMON_PAINT.dark));
  for (let k = 0; k < 4; k++) {
    const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1;
    const arm = new THREE.BoxGeometry(0.07, 0.05, 0.62);
    arm.rotateY(Math.atan2(sx, sz)); arm.translate(sx * HUB * 0.5, 0.02, sz * HUB * 0.5);
    parts.push(coloured(arm, SUMMON_PAINT.dark));
    const can = new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8); can.translate(sx * HUB, 0.05, sz * HUB);
    parts.push(coloured(can, SUMMON_PAINT.plate));
  }
  const gun = new THREE.CylinderGeometry(0.035, 0.045, 0.42, 6); gun.rotateX(Math.PI / 2); gun.translate(0, -0.14, 0.24);
  parts.push(coloured(gun, SUMMON_PAINT.dark));
  const skid = new THREE.BoxGeometry(0.36, 0.04, 0.05); skid.translate(0, -0.16, -0.12);
  parts.push(coloured(skid, SUMMON_PAINT.dark));
  return mergeGeometries(parts)!;
}

export class DronesDraw {
  readonly group = new THREE.Group();
  private frames: THREE.InstancedMesh;
  private rotors: THREE.InstancedMesh;
  private eyes: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private ml = new THREE.Matrix4(); private mo = new THREE.Matrix4();
  private q = new THREE.Quaternion(); private qy = new THREE.Quaternion(); private qt = new THREE.Quaternion(); private qr = new THREE.Quaternion();
  private p = new THREE.Vector3(); private s = new THREE.Vector3(); private axis = new THREE.Vector3(); private up = new THREE.Vector3(0, 1, 0);
  private time = 0;

  constructor(private d: Drones) {
    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.3, flatShading: true });
    this.frames = new THREE.InstancedMesh(frameGeometry(), paint, DRONE_MAX);
    const disc = new THREE.CylinderGeometry(0.25, 0.25, 0.012, 16);
    this.rotors = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: SUMMON_PAINT.rotor, transparent: true, opacity: 0.45, depthWrite: false }), DRONE_MAX * 4);
    this.eyes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: SUMMON_PAINT.eye }), DRONE_MAX);
    for (const mesh of [this.frames, this.rotors, this.eyes]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.count = 0;
      this.group.add(mesh);
    }
    this.frames.castShadow = true;
  }

  /** The drones' meshes (for the hold-V selector). */
  get meshes(): THREE.Object3D[] { return [this.frames, this.rotors, this.eyes]; }

  update(dt: number) {
    const d = this.d, k = d.v.droneSize / 1.1;
    this.time += dt;
    let n = 0, r = 0;
    for (let i = 0; i < d.n; i++) {
      if (!d.up[i]) continue;
      // Tilt into the acceleration (a quadcopter leans the way it's pushing), capped.
      const ax = d.ax[i], az = d.az[i], am = Math.hypot(ax, az);
      const tilt = Math.min(0.55, (am / 9.81) * 0.5);
      this.qy.setFromAxisAngle(this.up, d.heading[i]);
      if (am > 1e-3) { this.axis.set(az / am, 0, -ax / am); this.qt.setFromAxisAngle(this.axis, tilt); } else this.qt.identity();
      this.q.multiplyQuaternions(this.qt, this.qy);
      this.m.compose(this.p.set(d.x[i], d.y[i], d.z[i]), this.q, this.s.set(k, k, k));
      this.frames.setMatrixAt(n, this.m);
      this.ml.makeTranslation(0, 0.02, 0.4);
      this.mo.multiplyMatrices(this.m, this.ml);
      this.eyes.setMatrixAt(n, this.mo);
      n++;
      for (let j = 0; j < 4; j++) {
        const sx = j & 1 ? 1 : -1, sz = j & 2 ? 1 : -1;
        this.qr.setFromAxisAngle(this.up, this.time * 40 * (j === 0 || j === 3 ? 1 : -1) + d.seed[i] * 6);
        this.ml.compose(this.p.set(sx * HUB, 0.13, sz * HUB), this.qr, this.s.set(1, 1, 1));
        this.mo.multiplyMatrices(this.m, this.ml);
        this.rotors.setMatrixAt(r++, this.mo);
      }
    }
    this.frames.count = n; this.eyes.count = n; this.rotors.count = r;
    this.frames.instanceMatrix.needsUpdate = true; this.eyes.instanceMatrix.needsUpdate = true; this.rotors.instanceMatrix.needsUpdate = true;
  }
}
