// Molten spatter where a beam melts the sand (Keith 2026-11-02: the strike should read as things getting melted):
// little streaks of glowing glass thrown up and out, white-hot cooling to orange then dull red, falling back. One
// instanced mesh, one draw call. Cosmetic: Math.random is fine.
import * as THREE from "three/webgpu";

const MAX = 600;
const HOT = new THREE.Color(1.0, 0.92, 0.7), MID = new THREE.Color(1.0, 0.45, 0.08), COLD = new THREE.Color(0.35, 0.04, 0.0);

export class MeltSparks {
  readonly mesh: THREE.InstancedMesh;
  private p = new Float32Array(MAX * 3);
  private v = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private n = 0;
  private m = new THREE.Matrix4();
  private x = new THREE.Vector3(); private y = new THREE.Vector3(); private z = new THREE.Vector3(); private c = new THREE.Color();

  constructor(private ground: { height(x: number, z: number): number }) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** n streaks from (x, y, z), thrown up at about `speed` m/s, leaning along (dx, dz) (the way the strike drags). */
  emit(n: number, x: number, y: number, z: number, speed: number, dx = 0, dz = 0) {
    for (let k = 0; k < n; k++) {
      const i = this.n < MAX ? this.n++ : Math.floor(Math.random() * MAX);
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + 0.8 * Math.random()), out = 0.35 + 0.5 * Math.random();
      this.p[i * 3] = x; this.p[i * 3 + 1] = y + 0.05; this.p[i * 3 + 2] = z;
      this.v[i * 3] = Math.cos(a) * s * out + dx * s * 0.4; this.v[i * 3 + 1] = s * (0.6 + 0.6 * Math.random()); this.v[i * 3 + 2] = Math.sin(a) * s * out + dz * s * 0.4;
      this.life[i] = 0.25 + 0.55 * Math.random(); this.age[i] = 0;
    }
  }

  update(dt: number) {
    const P = this.p, V = this.v, col = this.mesh.instanceColor!.array as Float32Array;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      V[i * 3 + 1] -= 16 * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      const gy = this.ground.height(P[i * 3], P[i * 3 + 2]);
      if (P[i * 3 + 1] < gy) { P[i * 3 + 1] = gy; V[i * 3] *= 0.3; V[i * 3 + 1] = 0; V[i * 3 + 2] *= 0.3; }
      if (j !== i) {
        for (let q = 0; q < 3; q++) { P[j * 3 + q] = P[i * 3 + q]; V[j * 3 + q] = V[i * 3 + q]; }
        this.life[j] = this.life[i]; this.age[j] = this.age[i];
      }
      // A streak along its velocity, longer the faster it flies.
      const vx = V[j * 3], vy = V[j * 3 + 1], vz = V[j * 3 + 2], sp = Math.hypot(vx, vy, vz);
      this.z.set(vx, vy, vz).divideScalar(sp || 1);
      this.x.set(0, 1, 0).cross(this.z); if (this.x.lengthSq() < 1e-6) this.x.set(1, 0, 0); this.x.normalize();
      this.y.crossVectors(this.z, this.x);
      const u = this.age[j] / this.life[j], w = 0.05 * (1 - 0.5 * u), len = Math.max(0.06, Math.min(0.5, sp * 0.03));
      this.m.makeBasis(this.x.multiplyScalar(w), this.y.multiplyScalar(w), this.z.multiplyScalar(len));
      this.m.setPosition(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
      this.mesh.setMatrixAt(j, this.m);
      if (u < 0.3) this.c.copy(HOT).lerp(MID, u / 0.3); else this.c.copy(MID).lerp(COLD, (u - 0.3) / 0.7);
      const f = 1 - u * u;
      col[j * 3] = this.c.r * f; col[j * 3 + 1] = this.c.g * f; col[j * 3 + 2] = this.c.b * f;
      j++;
    }
    const was = this.mesh.count;
    this.n = j; this.mesh.count = j;
    if (j || was) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  }
}
