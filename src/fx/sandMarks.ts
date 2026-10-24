// Marks pressed into the sand: footprints, round craters where rounds strike, and slide trails where a foot breaks
// the sand loose on a steep dune face (Keith 2026-10-24: sell a heavy mech on sand, cheaply). No mesh is deformed:
// each mark is a flat decal on the dune whose shader works out a little height field (a hollow with a raised rim)
// and lights it from the sun, so the sun side of the rim catches light and the far wall of the hollow sits in shade.
// Marks fade out over markLife seconds; the oldest are reused first.
import * as THREE from "three/webgpu";
import { instancedBufferAttribute, uv, vec2, vec3, float, uniform, smoothstep, mix, max, abs, exp, clamp, mx_noise_float, length, step } from "three/tsl";
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";

export const MARK_DEFAULTS = {
  markDepth: 0.9,
  markLife: 45,
  markDark: 0.55,
  printSize: 1,
  craterSize: 0.55,
  craterEvery: 3,
  slideOnSlope: 1,
};
export type MarkValues = typeof MARK_DEFAULTS;

export const MARK_PARAMS: Param[] = [
  { key: "markDepth", label: "Mark depth (look)", min: 0, max: 3, step: 0.05, group: "Sand marks", tip: "How deep prints and craters look: strength of the lit rim and shaded wall" },
  { key: "markLife", label: "Marks last (s)", min: 2, max: 240, step: 1, group: "Sand marks" },
  { key: "markDark", label: "Churned sand darkness", min: 0, max: 1, step: 0.01, group: "Sand marks" },
  { key: "printSize", label: "Footprint size ×", min: 0.3, max: 2, step: 0.01, group: "Sand marks" },
  { key: "craterSize", label: "Round crater size (m)", min: 0.1, max: 2, step: 0.01, group: "Sand marks" },
  { key: "craterEvery", label: "Crater every Nth round", min: 1, max: 10, step: 1, group: "Sand marks" },
  { key: "slideOnSlope", label: "Slides on steep sand", min: 0, max: 3, step: 0.05, group: "Sand marks", tip: "On steep dune faces a step breaks sand loose downhill: a longer trail the steeper it is" },
];

const MAX_MARKS = 900;
const PRINT = 0, CRATER = 1, SLIDE = 2;

export class SandMarks {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  /** Per mark: kind, fade (1 new .. 0 gone), depth, seed. */
  private data = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARKS * 4), 4);
  /** Per mark: the sun direction in the mark's own frame (x across, y up, z along). */
  private sun = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARKS * 3), 3);
  private born = new Float32Array(MAX_MARKS).fill(-1e9);
  private depth0 = new Float32Array(MAX_MARKS);
  private quats: THREE.Quaternion[] = [];
  private next = 0;
  private used = 0;
  private t = 0;
  private rounds = 0;
  private uDepth = uniform(1.2);
  private uDark = uniform(0.55);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private nn = [0, 1, 0];

  constructor(private ground: Ground, public v: MarkValues) {
    for (const a of [this.data, this.sun]) a.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_MARKS; i++) this.quats.push(new THREE.Quaternion());
    const d = instancedBufferAttribute<"vec4">(this.data);
    const sunL = instancedBufferAttribute<"vec3">(this.sun);
    const kind = d.x, fade = d.y, deep = d.z, seed = d.w;
    const p = uv().mul(2).sub(1);
    // Signed distance to the mark's edge (negative inside), by kind: a rounded foot, a ragged circle, a long trough.
    const wob = mx_noise_float(vec3(p.mul(2.6), seed.mul(17))).mul(0.12);
    const sdf = (pp: THREE.Node<"vec2">) => {
      const qq = abs(pp).sub(vec2(0.42, 0.56));
      const b = length(max(qq, vec2(0, 0))).add(qq.x.max(qq.y).min(0)).sub(0.28);
      const c = length(pp).sub(0.55);
      const t = length(vec2(pp.x.mul(1.6), pp.y.mul(0.75))).sub(0.6);
      return mix(mix(b, c, step(0.5, kind)), t, step(1.5, kind)).add(wob);
    };
    // Height: a hollow inside, a raised rim of pushed-up sand just outside.
    const height = (dd: THREE.Node<"float">) =>
      smoothstep(0.08, -0.35, dd).negate().add(exp(dd.sub(0.1).div(0.13).pow(2).negate()).mul(0.5));
    const e = 0.04;
    const d0 = sdf(p);
    const h0 = height(d0);
    const hx = height(sdf(p.add(vec2(e, 0)))).sub(height(sdf(p.sub(vec2(e, 0)))));
    const hz = height(sdf(p.add(vec2(0, e)))).sub(height(sdf(p.sub(vec2(0, e)))));
    const k = this.uDepth.mul(deep).mul(0.6);
    const n = vec3(hx.negate().mul(k), float(2 * e), hz.negate().mul(k)).normalize();
    // Relief: how much brighter or darker than flat sand this bit faces the sun.
    // The difference from flat sand's lighting (not a ratio: on a slope facing away from the sun flat sand is barely
    // lit, and a ratio blew the whole quad dark, Keith's war band shot).
    const relief = clamp(n.dot(sunL).sub(sunL.y).mul(2.5), -1, 1);
    const churn = max(h0.negate(), 0).mul(this.uDark).mul(0.35); // disturbed sand in the hollow reads darker
    const lightCol = vec3(0.86, 0.68, 0.46), darkCol = vec3(0.24, 0.15, 0.08);
    const lit = step(0, relief.sub(churn));
    const amount = abs(relief).mul(0.9).add(churn);
    // Inside the quad only (both shapes stay well within it), faded with age.
    const edge = float(1).sub(smoothstep(0.85, 1.0, max(abs(p.x), abs(p.y))));
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    mat.colorNode = mix(darkCol, lightCol, lit);
    mat.opacityNode = clamp(amount, 0, 0.85).mul(fade).mul(edge);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, MAX_MARKS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.group.add(this.mesh);
  }

  /** A foot planted at (x, z) facing yaw; strength around 1. On a steep face it also leaves a slide downhill. */
  print(x: number, z: number, yaw: number, strength: number) {
    const v = this.v;
    const nr = this.ground.normal(x, z, this.nn);
    const steep = 1 - nr[1];
    const s = v.printSize;
    this.add(PRINT, x, z, yaw, 0.95 * s, 1.35 * s, Math.min(1.6, 0.7 + 0.3 * strength) * (1 + steep * 1.5));
    if (v.slideOnSlope > 0 && steep > 0.08) {
      // Downhill: against the slope's rise.
      const dx = nr[0], dz = nr[2], l = Math.hypot(dx, dz) || 1;
      const len = (1 + steep * 9) * v.slideOnSlope;
      this.add(SLIDE, x + (dx / l) * len * 0.45, z + (dz / l) * len * 0.45, Math.atan2(dx, dz), 1.1 * s, len, 0.5 + steep);
    }
  }

  /** A tyre track: a short narrow trough, laid every so often under a rolling wheel. */
  rut(x: number, z: number, yaw: number, width: number, length: number) {
    this.add(SLIDE, x, z, yaw, width, length, 0.45);
  }

  /** A round into the sand: a small crater, every Nth round so a burst leaves a churned patch, not a carpet. */
  crater(x: number, z: number, k: number) {
    if (this.rounds++ % Math.max(1, Math.round(this.v.craterEvery)) !== 0) return;
    const r = this.v.craterSize * (0.7 + Math.random() * 0.6) * Math.sqrt(Math.max(0.2, k));
    this.add(CRATER, x, z, Math.random() * Math.PI * 2, r * 2, r * 2, 1.1);
  }

  private add(kind: number, x: number, z: number, yaw: number, w: number, l: number, depth: number) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_MARKS;
    this.used = Math.max(this.used, i + 1);
    const nr = this.ground.normal(x, z, this.nn);
    const up = this.v3.set(nr[0], nr[1], nr[2]);
    // Lay the decal on the slope, turned to yaw.
    const tilt = new THREE.Quaternion().setFromUnitVectors(UP, up);
    const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const q = this.quats[i].copy(tilt).multiply(turn);
    this.m.compose(new THREE.Vector3(x, this.ground.height(x, z) + 0.02, z), q, new THREE.Vector3(w, 1, l));
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    const D = this.data.array as Float32Array;
    D[i * 4] = kind; D[i * 4 + 1] = 1; D[i * 4 + 2] = depth; D[i * 4 + 3] = Math.random();
    this.born[i] = this.t;
    this.depth0[i] = depth;
    this.mesh.count = this.used;
  }

  /** sunDir: unit vector toward the sun (world). */
  update(dt: number, sunDir: THREE.Vector3) {
    this.t += dt;
    this.uDepth.value = this.v.markDepth;
    this.uDark.value = this.v.markDark;
    const D = this.data.array as Float32Array, S = this.sun.array as Float32Array;
    const life = Math.max(1, this.v.markLife);
    for (let i = 0; i < this.used; i++) {
      const age = this.t - this.born[i];
      // Full for most of its life, then fades away.
      D[i * 4 + 1] = Math.max(0, 1 - Math.max(0, age - life * 0.6) / (life * 0.4));
      this.q.copy(this.quats[i]).invert();
      this.v3.copy(sunDir).applyQuaternion(this.q);
      // The decal's local z runs along the mark; the uv's y runs the other way, so flip z for the shader's frame.
      S[i * 3] = this.v3.x; S[i * 3 + 1] = this.v3.y; S[i * 3 + 2] = -this.v3.z;
    }
    this.data.needsUpdate = true;
    this.sun.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
