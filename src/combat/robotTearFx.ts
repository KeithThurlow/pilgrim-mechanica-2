// Small robots tearing at the mech (Keith 2026-10-24: "small robots that try to scavenge and remove plating and tear
// things down"): every bite of a latched robot throws sparks off the hull where it grips (the battlefield's steel
// sparks), now and then flicks a scrap of plate off that tumbles to the sand and lies there a while, and a grinding,
// cutting screech plays every so often while any are on. The plates are a small instanced pool of their own.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";
import type { MinigunFx } from "../fx/minigun";
import type { Sfx } from "../audio/sfx";

export const ROBOT_TEAR_DEFAULTS = {
  robotTearSparks: 7,
  robotTearSparkSpeed: 5,
  robotTearPlateChance: 0.15,
  robotTearPlateSpeed: 4,
  robotTearPlateLife: 8,
  robotGrindEvery: 0.3,
};
export type RobotTearValues = typeof ROBOT_TEAR_DEFAULTS;

const G = "Robots: tearing";
export const ROBOT_TEAR_PARAMS: Param[] = [
  { key: "robotTearSparks", label: "Sparks per bite", min: 0, max: 30, step: 1, group: G },
  { key: "robotTearSparkSpeed", label: "Spark speed (m/s)", min: 0.5, max: 20, step: 0.1, group: G },
  { key: "robotTearPlateChance", label: "Plate torn off per bite", min: 0, max: 1, step: 0.01, group: G, tip: "Chance each bite flicks a scrap of plating off the mech" },
  { key: "robotTearPlateSpeed", label: "Plate fling speed (m/s)", min: 0, max: 12, step: 0.1, group: G },
  { key: "robotTearPlateLife", label: "Plates lie for (s)", min: 0.5, max: 30, step: 0.5, group: G },
  { key: "robotGrindEvery", label: "Grind sound every (s)", min: 0.05, max: 3, step: 0.05, group: G, tip: "While any are biting, a cutting screech plays about this often" },
];

const PLATES = 200;
const PLATE_COLORS = [0x6d6c52, 0x8b8b83, 0x5b5d55, 0x7a6a50, 0x9a9890];

export class RobotTearFx {
  readonly group = new THREE.Group();
  readonly plates: THREE.InstancedMesh;
  private pos = new Float32Array(PLATES * 3); private vel = new Float32Array(PLATES * 3);
  private rot = new Float32Array(PLATES * 3); private spin = new Float32Array(PLATES * 3);
  private age = new Float32Array(PLATES).fill(1e9); private rest = new Uint8Array(PLATES);
  private next = 0;
  private grindClock = 0;
  private at = new THREE.Vector3(); private n = new THREE.Vector3();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private p = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor(private gunFx: MinigunFx, private sfx: Sfx, private ground: Ground, public v: RobotTearValues) {
    this.plates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.025, 0.22), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.5 }), PLATES);
    this.plates.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PLATES * 3), 3);
    const c = new THREE.Color();
    for (let i = 0; i < PLATES; i++) {
      this.plates.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.plates.setColorAt(i, c.setHex(PLATE_COLORS[i % PLATE_COLORS.length]));
    }
    this.plates.castShadow = true; this.plates.receiveShadow = true;
    this.plates.frustumCulled = false;
    this.group.add(this.plates);
  }

  /**
   * A latched robot bit: its hub at (x, y, z) gripping a mech centred at (cx, cz). Sparks at the grip, maybe a plate,
   * maybe the grind.
   */
  bite(x: number, y: number, z: number, cx: number, cz: number) {
    const v = this.v;
    let ox = x - cx, oz = z - cz;
    const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    // The grip point is on the hull just inside the hub; sparks spray out of the hull and up a little.
    this.at.set(x - ox * 0.25, y, z - oz * 0.25);
    this.n.set(ox, 0.35, oz).normalize();
    if (v.robotTearSparks > 0) this.gunFx.sparksAt(this.at, this.n, Math.round(v.robotTearSparks * (0.6 + Math.random() * 0.8)), v.robotTearSparkSpeed);
    if (Math.random() < v.robotTearPlateChance) this.plate(ox, oz);
    if (this.grindClock <= 0) {
      this.sfx.play("grind", this.at, 0.8 + Math.random() * 0.3, 0.85 + Math.random() * 0.3, false);
      this.grindClock = v.robotGrindEvery * (0.6 + Math.random() * 0.8);
    }
  }

  private plate(ox: number, oz: number) {
    const i = this.next++ % PLATES, k = i * 3, sp = this.v.robotTearPlateSpeed * (0.5 + Math.random());
    this.pos[k] = this.at.x; this.pos[k + 1] = this.at.y; this.pos[k + 2] = this.at.z;
    this.vel[k] = ox * sp + (Math.random() - 0.5) * 1.5; this.vel[k + 1] = 1.5 + Math.random() * 2.5; this.vel[k + 2] = oz * sp + (Math.random() - 0.5) * 1.5;
    for (let a = 0; a < 3; a++) { this.rot[k + a] = Math.random() * 6.3; this.spin[k + a] = (Math.random() - 0.5) * 24; }
    this.age[i] = 0; this.rest[i] = 0;
  }

  update(dt: number) {
    const v = this.v, life = v.robotTearPlateLife;
    this.grindClock -= dt;
    for (let i = 0; i < PLATES; i++) {
      const age = this.age[i];
      if (age > life + 1) continue;
      this.age[i] = age + dt;
      const k = i * 3;
      if (this.age[i] > life) { this.plates.setMatrixAt(i, this.m.makeScale(0, 0, 0)); this.age[i] = 1e9; continue; }
      if (!this.rest[i]) {
        this.vel[k + 1] -= 9.8 * dt;
        this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
        for (let a = 0; a < 3; a++) this.rot[k + a] += this.spin[k + a] * dt;
        const gy = this.ground.height(this.pos[k], this.pos[k + 2]) + 0.015;
        if (this.pos[k + 1] < gy) {
          this.pos[k + 1] = gy;
          if (Math.abs(this.vel[k + 1]) < 1.5) {
            // Settle flat-ish on the sand.
            this.rest[i] = 1; this.rot[k] = Math.round(this.rot[k] / Math.PI) * Math.PI; this.rot[k + 2] = Math.round(this.rot[k + 2] / Math.PI) * Math.PI;
          } else {
            this.vel[k + 1] *= -0.3; this.vel[k] *= 0.45; this.vel[k + 2] *= 0.45;
            for (let a = 0; a < 3; a++) this.spin[k + a] *= 0.5;
          }
        }
      }
      const fade = Math.min(1, (life - this.age[i]) / 1);
      this.q.setFromEuler(this.e.set(this.rot[k], this.rot[k + 1], this.rot[k + 2]));
      this.p.set(this.pos[k], this.pos[k + 1] - (1 - fade) * 0.05, this.pos[k + 2]);
      this.plates.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.setScalar(Math.max(0.001, fade))));
    }
    this.plates.instanceMatrix.needsUpdate = true;
  }
}
