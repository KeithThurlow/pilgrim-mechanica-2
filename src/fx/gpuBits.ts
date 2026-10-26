// Sparks, grit and brass casings on the GPU (scale step 5; the CPU versions are MinigunFx's bits, kept behind the
// fxGpuBits slider): small solid bits thrown by hits and ejected by the guns, ballistic, landing on the ground (the
// detail patch's grid, src/fx/gpuGround.ts). Each kind is a GpuPool ring drawn as one instanced mesh whose vertex
// shader places and turns every instance from the buffers (no matrices written on the CPU).
//
// Buffers: P (position, age), V (velocity, life), A (tumble axis, tumble rate rad/s), B (size, resting 0/1, the ground
// where it was made (fallback), tumble angle so far).
import * as THREE from "three/webgpu";
import { Fn, float, vec3, vec4, uniform, If, select, cross, normalize, max, positionLocal, normalLocal } from "three/tsl";
import { GpuPool, type PoolStep } from "./gpuPool";
import { groundAt, type GpuGroundSource } from "./gpuGround";

type F = THREE.Node<"float">;
type V3 = THREE.Node<"vec3">;

/** How a kind of bit moves and looks. */
interface BitKind {
  /** Bounces off the ground (casings) rather than stopping dead. */
  bounce: boolean;
  /** Lies along its velocity (sparks) rather than tumbling. */
  streak: boolean;
  /** Shrinks to nothing over its life (sparks, grit), else stays whole (casings). */
  shrink: boolean;
}

/** Rotate v about the unit axis k by angle a (Rodrigues). */
function rotate(v: V3, k: V3, a: F): V3 {
  const c = a.cos(), s = a.sin();
  return v.mul(c).add(cross(k, v).mul(s)).add(k.mul(k.dot(v).mul(float(1).sub(c))));
}

export class GpuBitPool {
  readonly pool: GpuPool;
  readonly mesh: THREE.InstancedMesh;
  /** Size multiplier for every bit of this pool (sparkSize for the sparks). */
  readonly uSize = uniform(1);

  constructor(N: number, maxSpawn: number, readonly kind: BitKind, geometry: THREE.BufferGeometry, material: THREE.NodeMaterial, ground: GpuGroundSource) {
    this.pool = new GpuPool(N, maxSpawn, (s) => this.step(s, ground));
    const { P, V, A, B } = this.pool;
    const pa = P.toAttribute(), va = V.toAttribute(), aa = A.toAttribute(), ba = B.toAttribute();
    material.positionNode = Fn(() => {
      const age = pa.w, life = va.w;
      const alive = age.lessThan(life);
      const k = kind.shrink ? float(1).sub(age.div(max(life, 1e-3))) : float(1);
      const scale = select(alive, k.mul(ba.x).mul(this.uSize), float(0));
      let local: V3 = positionLocal.mul(scale);
      let nrm: V3 = normalLocal;
      if (kind.streak) {
        // The box's z along the velocity.
        const sp = va.xyz.length();
        const z = select(sp.greaterThan(1e-3), va.xyz.div(max(sp, 1e-6)), vec3(0, 1, 0));
        const up = select(z.y.abs().greaterThan(0.95), vec3(1, 0, 0), vec3(0, 1, 0));
        const x = normalize(cross(up, z)), y = cross(z, x);
        local = x.mul(local.x).add(y.mul(local.y)).add(z.mul(local.z));
        nrm = x.mul(nrm.x).add(y.mul(nrm.y)).add(z.mul(nrm.z));
      } else {
        local = rotate(local, aa.xyz, ba.w);
        nrm = rotate(nrm, aa.xyz, ba.w);
      }
      normalLocal.assign(nrm);
      return pa.xyz.add(local);
    })();
    this.mesh = new THREE.InstancedMesh(geometry, material, N);
    this.mesh.frustumCulled = false;
  }

  private step(s: PoolStep, ground: GpuGroundSource) {
    const { P, V, A, B, dt } = s;
    P.w.assign(P.w.add(dt));
    If(P.w.lessThan(V.w).and(B.y.lessThan(0.5)), () => {
      V.y.assign(V.y.sub(dt.mul(9.8)));
      P.xyz.assign(P.xyz.add(V.xyz.mul(dt)));
      B.w.assign(B.w.add(A.w.mul(dt)));
      const g = groundAt(ground, P.x, P.z, B.z).x.add(0.03);
      If(P.y.lessThan(g), () => {
        P.y.assign(g);
        if (this.kind.bounce) {
          If(V.y.abs().lessThan(0.8), () => {
            B.y.assign(1);
            // Lie flat on the sand: snap the tumble to a quarter turn.
            B.w.assign(B.w.div(Math.PI / 2).round().mul(Math.PI / 2));
          }).Else(() => {
            V.assign(vec4(V.x.mul(0.5), V.y.mul(-0.32), V.z.mul(0.5), V.w));
            A.w.assign(A.w.mul(0.5));
          });
        } else B.y.assign(1);
      });
    });
  }

  /** One bit: where, its velocity, life (s), size, tumble rate (rad/s), and the ground under it now. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, spin: number, ground: number) {
    // A random tumble axis (cosmetic: Math.random is fine here).
    let ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5;
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    return this.pool.emit(x, y, z, 0, vx, vy, vz, life, ax, ay, az, spin, size, 0, ground, Math.random() * 6.283, life);
  }

  update(renderer: THREE.WebGPURenderer, dt: number) { this.pool.update(renderer, dt); this.mesh.count = Math.max(1, this.pool.used); }
}

/** The three pools MinigunFx throws: sparks off steel, sand grit, the player's brass. */
export class GpuBits {
  readonly group = new THREE.Group();
  readonly sparks: GpuBitPool;
  readonly grit: GpuBitPool;
  readonly casings: GpuBitPool;

  constructor(ground: GpuGroundSource, sizes = { sparks: 8192, grit: 8192, casings: 2048 }) {
    const sparkMat = new THREE.MeshBasicNodeMaterial({ color: 0xffd27a, toneMapped: false });
    this.sparks = new GpuBitPool(sizes.sparks, 2048, { bounce: false, streak: true, shrink: true }, new THREE.BoxGeometry(0.04, 0.04, 0.3), sparkMat, ground);
    const gritMat = new THREE.MeshStandardNodeMaterial({ color: 0x9a7a50, roughness: 1 });
    this.grit = new GpuBitPool(sizes.grit, 2048, { bounce: false, streak: false, shrink: true }, new THREE.BoxGeometry(0.07, 0.07, 0.07), gritMat, ground);
    const brassMat = new THREE.MeshStandardNodeMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.35 });
    this.casings = new GpuBitPool(sizes.casings, 512, { bounce: true, streak: false, shrink: false }, new THREE.CylinderGeometry(0.035, 0.035, 0.13, 6).rotateX(Math.PI / 2), brassMat, ground);
    this.casings.mesh.castShadow = true;
    this.group.add(this.sparks.mesh, this.grit.mesh, this.casings.mesh);
  }

  update(renderer: THREE.WebGPURenderer, dt: number) {
    this.sparks.update(renderer, dt);
    this.grit.update(renderer, dt);
    this.casings.update(renderer, dt);
  }
}
