// Tracers drawn on the GPU (scale step 5; the CPU version is a Mesh per tracer moved every frame, kept behind the
// fxGpuTracers slider). A tracer is written once when its round is fired (from, to, the time it left, shown or not);
// the vertex shader flies it: its head at (now - left) × speed along the line, its tail tracerLength behind, gone
// once it arrives. The CPU still times each round's arrival for its impact (MinigunFx); nothing is written per frame.
import * as THREE from "three/webgpu";
import { Fn, float, vec3, uniform, select, cross, normalize, max, min, clamp, mix, positionLocal, instancedBufferAttribute } from "three/tsl";

export class GpuTracers {
  readonly mesh: THREE.InstancedMesh;
  readonly uNow = uniform(0);
  readonly uSpeed = uniform(220);
  readonly uLength = uniform(1.2);
  private from: THREE.InstancedBufferAttribute;
  private to: THREE.InstancedBufferAttribute;
  private dirty0 = Infinity; private dirty1 = -1;
  /** Highest slot ever written (only those are drawn). */
  private top = 0;

  constructor(readonly N: number) {
    this.from = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    // w: shown (1), shown and ignited (2) or not (0); a never-used slot has from = to so it's already arrived.
    this.to = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    for (const a of [this.from, this.to]) a.setUsage(THREE.DynamicDrawUsage);
    const f = instancedBufferAttribute<"vec4">(this.from), t = instancedBufferAttribute<"vec4">(this.to);
    const mat = new THREE.MeshBasicNodeMaterial({ color: 0xffc46b, toneMapped: false });
    // Ignited rounds (Keith 2026-10-30): orange-red instead of amber.
    mat.colorNode = mix(vec3(1, 0.77, 0.42), vec3(1, 0.29, 0.07), clamp(t.w.sub(1), 0, 1));
    mat.positionNode = Fn(() => {
      const d = t.xyz.sub(f.xyz), dist = d.length();
      const dir = d.div(max(dist, 1e-4));
      const flown = this.uNow.sub(f.w).mul(this.uSpeed);
      const head = min(flown, dist), tail = max(float(0), head.sub(this.uLength));
      const len = max(head.sub(tail), 0.01);
      const on = t.w.greaterThan(0.5).and(flown.lessThan(dist)).and(flown.greaterThanEqual(0));
      const up = select(dir.y.abs().greaterThan(0.95), vec3(1, 0, 0), vec3(0, 1, 0));
      const x = normalize(cross(up, dir)), y = cross(dir, x);
      // The box runs z from -1 to 0 (the head at 0): stretch z to the tracer's length.
      const p = positionLocal;
      const local = x.mul(p.x).add(y.mul(p.y)).add(dir.mul(p.z.mul(len)));
      return select(on, f.xyz.add(dir.mul(head)).add(local), vec3(0, -1e4, 0));
    })();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 1).translate(0, 0, -0.5), mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.count = 1;
  }

  /** Slot i flies from a to b, leaving now (s on the uNow clock), shown or not. */
  set(i: number, a: THREE.Vector3, b: THREE.Vector3, now: number, shown: boolean, hot = false) {
    const F = this.from.array as Float32Array, T = this.to.array as Float32Array, o = i * 4;
    F[o] = a.x; F[o + 1] = a.y; F[o + 2] = a.z; F[o + 3] = now;
    T[o] = b.x; T[o + 1] = b.y; T[o + 2] = b.z; T[o + 3] = shown ? (hot ? 2 : 1) : 0;
    this.dirty0 = Math.min(this.dirty0, i); this.dirty1 = Math.max(this.dirty1, i);
    if (i + 1 > this.top) { this.top = i + 1; this.mesh.count = this.top; }
  }

  /** Once a frame: the clock and look, and upload the slots written since. */
  update(now: number, speed: number, length: number) {
    this.uNow.value = now; this.uSpeed.value = speed; this.uLength.value = length;
    if (this.dirty1 < 0) return;
    for (const a of [this.from, this.to]) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirty0 * 4, (this.dirty1 - this.dirty0 + 1) * 4);
      a.needsUpdate = true;
    }
    this.dirty0 = Infinity; this.dirty1 = -1;
  }
}
