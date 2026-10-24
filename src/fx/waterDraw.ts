// Draws the water effects: ripple rings as instanced flat rings on the water surface (a soft-edged band in the shader,
// fading and thinning as they spread), and splash drops as small bright sprites. One draw call each.
import * as THREE from "three/webgpu";
import { instancedBufferAttribute, uv, float, smoothstep, vec3 } from "three/tsl";
import { WaterFx, RIPPLE_MAX, DROP_MAX } from "./water";

export class WaterDraw {
  readonly group = new THREE.Group();
  private rings: THREE.InstancedMesh;
  private drops: THREE.InstancedMesh;
  /** Per ring: the band's inner edge as a share of the radius, and its opacity. */
  private ringData = new THREE.InstancedBufferAttribute(new Float32Array(RIPPLE_MAX * 2), 2);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private fx: WaterFx) {
    this.ringData.setUsage(THREE.DynamicDrawUsage);
    const data = instancedBufferAttribute<"vec2">(this.ringData);
    // A unit quad; the ring is the band at distance 1 from the centre, `inner` wide, soft on both edges.
    const p = uv().mul(2).sub(1);
    const r = p.length();
    const inner = data.x;
    const band = smoothstep(inner, inner.add(float(1).sub(inner).mul(0.5)), r).mul(float(1).sub(smoothstep(0.92, 1.0, r)));
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false });
    mat.colorNode = vec3(0.92, 0.97, 0.95);
    mat.opacityNode = band.mul(data.y);
    this.rings = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat, RIPPLE_MAX);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;
    const dmat = new THREE.MeshBasicMaterial({ color: 0xe8f4f0, toneMapped: false, transparent: true, opacity: 0.9 });
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), dmat, DROP_MAX);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.group.add(this.rings, this.drops);
  }

  update() {
    const fx = this.fx, v = fx.v, D = this.ringData.array as Float32Array;
    let n = 0;
    const y = fx.level + 0.04;
    for (let i = 0; i < RIPPLE_MAX; i++) {
      if (fx.rAge[i] >= fx.rLife[i]) continue;
      const R = fx.radius(i), u = fx.rAge[i] / fx.rLife[i];
      this.m.compose(this.p.set(fx.rx[i], y, fx.rz[i]), this.q.identity(), this.s.set(R, 1, R));
      this.rings.setMatrixAt(n, this.m);
      // Band width in metres → share of the radius; thinner and fainter as it spreads.
      D[n * 2] = Math.max(0.3, 1 - (v.rippleWidth * (1 + fx.rStr[i])) / Math.max(0.05, R));
      D[n * 2 + 1] = v.rippleStrength * fx.rStr[i] * (1 - u) * (1 - u) * Math.min(1, fx.rAge[i] * 8);
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    this.ringData.needsUpdate = true;
    let m = 0;
    for (let i = 0; i < DROP_MAX; i++) {
      if (fx.dAge[i] >= fx.dLife[i]) continue;
      this.m.compose(this.p.set(fx.dx[i], fx.dy[i], fx.dz[i]), this.q.identity(), this.s.setScalar(fx.dSize[i]));
      this.drops.setMatrixAt(m++, this.m);
    }
    this.drops.count = m;
    this.drops.instanceMatrix.needsUpdate = true;
  }
}
