// The flame stream's solid look (Keith 2026-11-05: "a very thin, long emissive cone ... blue and becomes bright orange,
// yellow, and then almost solid flame-like balls"). Drawing only (cosmetic, local): FlameFx (flameFx.ts) runs the gobs
// and hands this the cones and blobs to draw each frame.
// - Cones: one per pouring nozzle, a thin open tube from the nozzle out along the stream, widening, blue at the nozzle
//   going white-yellow then orange, flickering and rippling with noise. One instanced mesh, additive.
// - Blobs: every lit gob of the stream as a low-poly ball whose surface is pushed in and out by moving noise (seeded per
//   blob), stretched along its flight, squashed flat on the sand; hot core, soft see-through rim. One instanced mesh.
import * as THREE from "three/webgpu";
import {
  instancedBufferAttribute, positionLocal, normalLocal, positionGeometry, mx_noise_float, time, vec3, float, mix,
  smoothstep, normalView, positionView, dot, normalize, abs, clamp, atan,
} from "three/tsl";

export const CONE_MAX = 32, BLOB_MAX = 1536;

export class FlameBlobs {
  readonly group = new THREE.Group();
  private cones: THREE.InstancedMesh;
  private blobs: THREE.InstancedMesh;
  /** Cones: x 1 for a freeze ray (pale blue all along), y brightness. */
  private coneData = new THREE.InstancedBufferAttribute(new Float32Array(CONE_MAX * 4), 4);
  /** Blobs: rgb (HDR), alpha. */
  private blobCol = new THREE.InstancedBufferAttribute(new Float32Array(BLOB_MAX * 4), 4);
  /** Blobs: noise seed, how lumpy (share of the radius), how fast the surface boils, how hot the core is (0..1). */
  private blobNoise = new THREE.InstancedBufferAttribute(new Float32Array(BLOB_MAX * 4), 4);
  nc = 0; nb = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private d = new THREE.Vector3();
  private static UP = new THREE.Vector3(0, 1, 0);

  constructor() {
    for (const a of [this.coneData, this.blobCol, this.blobNoise]) a.setUsage(THREE.DynamicDrawUsage);
    // Cone: a tube along +Y from 0 to 1, thin end at the nozzle.
    const cg = new THREE.CylinderGeometry(1, 0.22, 1, 12, 10, true);
    cg.translate(0, 0.5, 0);
    {
      const cd = instancedBufferAttribute<"vec4">(this.coneData);
      const t = positionGeometry.y; // 0 at the nozzle, 1 at the end
      const ang = atan(positionGeometry.x, positionGeometry.z);
      const n = mx_noise_float(vec3(ang.mul(1.6), t.mul(7).sub(time.mul(22)), cd.x.mul(5)));
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      mat.blending = THREE.AdditiveBlending;
      // The tube ripples: the radius breathes with the noise, more toward the end.
      mat.positionNode = positionLocal.add(vec3(positionLocal.x, 0, positionLocal.z).mul(n.mul(0.35).mul(t.add(0.2))));
      // Keith 2026-11-05: bluer for longer, then very white-hot yellow, yellower toward the end.
      const blue = vec3(0.2, 0.45, 2.0), white = vec3(2.2, 2.0, 1.25), yellow = vec3(2.0, 1.45, 0.3);
      const fire = mix(mix(blue, white, smoothstep(0.12, 0.42, t)), yellow, smoothstep(0.5, 1, t));
      const ice = mix(vec3(0.6, 0.85, 1.5), vec3(0.35, 0.55, 1.1), t);
      mat.colorNode = mix(fire, ice, cd.x);
      // Softer at the rim (seen side on, the tube's edge is where it is thinnest), fading out toward the end.
      const face = abs(dot(normalize(normalView), normalize(positionView.negate())));
      mat.opacityNode = clamp(face.mul(1.3), 0, 1).mul(float(1).sub(smoothstep(0.55, 1, t))).mul(smoothstep(0, 0.04, t))
        .mul(n.mul(0.35).add(0.75)).mul(cd.y).mul(0.55);
      this.cones = new THREE.InstancedMesh(cg, mat, CONE_MAX);
    }
    {
      const bc = instancedBufferAttribute<"vec4">(this.blobCol), bn = instancedBufferAttribute<"vec4">(this.blobNoise);
      const nz = mx_noise_float(positionGeometry.mul(1.7).add(vec3(bn.x, bn.x.mul(1.3), time.mul(bn.z))));
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      mat.positionNode = positionLocal.add(normalLocal.mul(nz.mul(bn.y)));
      const face = abs(dot(normalize(normalView), normalize(positionView.negate())));
      // A white-hot core where you look straight in, the instance colour at the rim; the rim fades to nothing.
      // White-hot where you look straight in; at the Fresnel rim a yellow that grows as the blob burns on (bn.w falls
      // from 1 at the nozzle to 0), so the old flame reads yellow at its edges (Keith 2026-11-05).
      const bright = bc.xyz.length().mul(0.45).add(0.15);
      const core = smoothstep(0.6, 1, face).mul(bn.w.mul(0.6).add(0.4));
      const rim = float(1).sub(smoothstep(0.15, 0.7, face)).mul(float(1).sub(bn.w).mul(0.8).add(0.2));
      const body = mix(bc.xyz, vec3(2.0, 1.5, 0.32).mul(bright), rim);
      mat.colorNode = mix(body, vec3(2.2, 2.0, 1.3).mul(bright), core).mul(nz.mul(0.2).add(1));
      mat.opacityNode = smoothstep(0.0, 0.4, face).mul(bc.w);
      mat.blending = THREE.AdditiveBlending;
      this.blobs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, BLOB_MAX);
    }
    for (const [mesh, order] of [[this.cones, 6], [this.blobs, 5]] as const) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = order;
      this.group.add(mesh);
    }
  }

  /** A pouring nozzle this frame: from (x, y, z) along unit (dx, dy, dz), `len` m long, `r` m wide at its far end. */
  cone(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, r: number, bright: number, cold: boolean) {
    if (this.nc >= CONE_MAX || len < 0.2) return;
    const i = this.nc++;
    this.p.set(x, y, z);
    this.q.setFromUnitVectors(FlameBlobs.UP, this.d.set(dx, dy, dz));
    this.m.compose(this.p, this.q, this.s.set(r, len, r));
    this.cones.setMatrixAt(i, this.m);
    const a = this.coneData.array as Float32Array, o = i * 4;
    a[o] = cold ? 1 : 0; a[o + 1] = bright;
  }

  /** A blob this frame: centre, radius, its flight (stretches it along that), how flat it lies (0 round, 1 a puddle),
   *  colour and alpha, noise seed and lumpiness, how hot its core is. */
  blob(x: number, y: number, z: number, r: number, vx: number, vy: number, vz: number, flat: number,
    cr: number, cg: number, cb: number, a: number, seed: number, lump: number, core: number) {
    if (this.nb >= BLOB_MAX) return;
    const i = this.nb++;
    this.p.set(x, y, z);
    const sp = Math.hypot(vx, vy, vz);
    const st = Math.min(1.4, 1 + sp * 0.012);
    if (sp > 0.5) this.q.setFromUnitVectors(FlameBlobs.UP, this.d.set(vx / sp, vy / sp, vz / sp));
    else this.q.identity();
    // Flat on the sand: the ball spreads into a low lump (applied along world Y, so only when it isn't flying).
    if (flat > 0.01) { this.q.identity(); this.m.compose(this.p, this.q, this.s.set(r * (1 + flat * 0.5), r * (1 - flat * 0.6), r * (1 + flat * 0.5))); }
    else this.m.compose(this.p, this.q, this.s.set(r / Math.sqrt(st), r * st, r / Math.sqrt(st)));
    this.blobs.setMatrixAt(i, this.m);
    const c = this.blobCol.array as Float32Array, n = this.blobNoise.array as Float32Array, o = i * 4;
    c[o] = cr; c[o + 1] = cg; c[o + 2] = cb; c[o + 3] = a;
    n[o] = seed; n[o + 1] = lump; n[o + 2] = 0.8 + (seed % 1) * 0.8; n[o + 3] = core;
  }

  /** Uploads this frame's cones and blobs, ready for the next frame's. */
  flush() {
    const up = (mesh: THREE.InstancedMesh, n: number, attrs: THREE.InstancedBufferAttribute[]) => {
      mesh.count = n;
      if (!n) return;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
      for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    };
    up(this.cones, this.nc, [this.coneData]);
    up(this.blobs, this.nb, [this.blobCol, this.blobNoise]);
    this.nc = 0; this.nb = 0;
  }
}
