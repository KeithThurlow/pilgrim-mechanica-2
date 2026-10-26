// A ring of particles on the GPU (docs/proposal-scale.md, scale step 5): four vec4 storage buffers per particle (P, V,
// A, B: what each holds is the look's business) stepped by one TSL compute pass a frame, on WebGPU and on WebGL 2
// (three runs compute there as a vertex pass with transform feedback: each invocation reads anything but writes only
// its own particle, which is all this does).
//
// Making particles: the CPU never touches the buffers. emit() writes a row into a spawn texture (four rows of
// `maxSpawn` texels: P, V, A, B); the pass initialises the slots [head, head + count) of the ring from those rows and
// steps every other slot. (Spawn rows in a storage buffer read at another index fail on WebGL 2; a float texture works
// on both.) The ring overwrites its oldest slots, so the effects budget (src/fx/budget.ts) keeps the asks per frame
// and the live count (estimated here on the CPU from each slot's expiry, no readback) inside the pool.
//
// Cosmetic only (rule 12): nothing reads these back.
import * as THREE from "three/webgpu";
import { Fn, instancedArray, instanceIndex, uniform, If, uint, int, ivec2, textureLoad, texture } from "three/tsl";

type V4 = THREE.Node<"vec4">;
export interface PoolStep {
  /** This particle's buffers (assign to change them). */
  P: V4; V: V4; A: V4; B: V4;
  /** Seconds this frame, and a running clock. */
  dt: THREE.Node<"float">; time: THREE.Node<"float">;
}

export class GpuPool {
  readonly P; readonly V; readonly A; readonly B;
  readonly uHead = uniform(0, "uint");
  readonly uCount = uniform(0, "uint");
  readonly uDt = uniform(0);
  readonly uTime = uniform(0);
  private spawnData: Float32Array;
  private spawnTex: THREE.DataTexture;
  readonly compute: THREE.ComputeNode;
  /** Rows written this frame (not yet stepped in). */
  count = 0;
  head = 0;
  /** Asks this frame the spawn rows couldn't hold (dropped). */
  dropped = 0;
  /** When each slot's particle dies (s on the pool's clock): the CPU's estimate of what's alive. */
  private expire: Float32Array;
  private clock = 0;
  alive = 0;

  constructor(readonly N: number, readonly maxSpawn: number, step: (s: PoolStep) => void) {
    this.P = instancedArray(N, "vec4"); this.V = instancedArray(N, "vec4");
    this.A = instancedArray(N, "vec4"); this.B = instancedArray(N, "vec4");
    this.expire = new Float32Array(N);
    this.spawnData = new Float32Array(maxSpawn * 4 * 4);
    const t = new THREE.DataTexture(this.spawnData, maxSpawn, 4, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.flipY = false;
    t.needsUpdate = true;
    this.spawnTex = t;
    const tex = texture(t);
    const { P, V, A, B, uHead, uCount } = this;
    this.compute = Fn(() => {
      const i = instanceIndex;
      const k = i.add(uint(N)).sub(uHead).mod(uint(N));
      const p = P.element(i), v = V.element(i), a = A.element(i), b = B.element(i);
      If(k.lessThan(uCount), () => {
        const ki = int(k);
        p.assign(textureLoad(tex, ivec2(ki, int(0))));
        v.assign(textureLoad(tex, ivec2(ki, int(1))));
        a.assign(textureLoad(tex, ivec2(ki, int(2))));
        b.assign(textureLoad(tex, ivec2(ki, int(3))));
      }).Else(() => {
        step({ P: p, V: v, A: a, B: b, dt: this.uDt, time: this.uTime });
      });
    })().compute(N);
  }

  /** One new particle (16 floats, the look's layout), alive for `life` seconds (for the live estimate). False: full. */
  emit(px: number, py: number, pz: number, pw: number, vx: number, vy: number, vz: number, vw: number,
    ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number, life: number): boolean {
    if (this.count >= this.maxSpawn) { this.dropped++; return false; }
    const k = this.count++, W = this.maxSpawn * 4, d = this.spawnData, o = k * 4;
    d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = pw;
    d[W + o] = vx; d[W + o + 1] = vy; d[W + o + 2] = vz; d[W + o + 3] = vw;
    d[2 * W + o] = ax; d[2 * W + o + 1] = ay; d[2 * W + o + 2] = az; d[2 * W + o + 3] = aw;
    d[3 * W + o] = bx; d[3 * W + o + 1] = by; d[3 * W + o + 2] = bz; d[3 * W + o + 3] = bw;
    this.expire[(this.head + k) % this.N] = this.clock + life;
    return true;
  }

  /** Step every particle (and take in this frame's new ones). */
  update(renderer: THREE.WebGPURenderer, dt: number) {
    this.clock += dt;
    this.uDt.value = dt;
    this.uTime.value = this.clock;
    this.uHead.value = this.head;
    this.uCount.value = this.count;
    if (this.count) this.spawnTex.needsUpdate = true;
    renderer.compute(this.compute);
    this.head = (this.head + this.count) % this.N;
    this.count = 0;
    this.dropped = 0;
    // The live estimate (cheap: one compare a slot).
    let n = 0;
    const e = this.expire, c = this.clock;
    for (let i = 0; i < e.length; i++) if (e[i] > c) n++;
    this.alive = n;
  }
}
