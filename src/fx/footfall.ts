// Footfall prints pressed into the sand (oldest recycled). The dust is the shared dust system (dust.ts).
import * as THREE from "three/webgpu";
import { uv, vec2, vec3, float, smoothstep, mix, mx_noise_float, abs, max } from "three/tsl";

const MAX_PRINTS = 200;

export class FootfallFx {
  readonly group = new THREE.Group();
  private prints: THREE.InstancedMesh;
  private printI = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor() {
    const geo = new THREE.PlaneGeometry(0.85, 1.25).rotateX(-Math.PI / 2).translate(0, 0, 0.12);
    // A soft pressed print, not a rectangle: a rounded, noisy-edged hollow, darker toward its rim (the sand pushed
    // up round it reads lighter just outside).
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const p = uv().mul(2).sub(1);
    const q = abs(p).sub(vec2(0.5, 0.62));
    const box = max(q, vec2(0, 0)).length().add(q.x.max(q.y).min(0)).sub(0.32); // rounded-box distance, 0 at the rim
    const n = mx_noise_float(vec3(p.mul(5), float(0.3))).mul(0.12);
    const inside = float(1).sub(smoothstep(-0.18, 0.06, box.add(n)));
    const rim = smoothstep(-0.4, 0.0, box.add(n)).mul(inside);
    mat.colorNode = mix(vec3(0.42, 0.25, 0.13), vec3(0.3, 0.17, 0.08), rim);
    mat.opacityNode = inside.mul(0.42);
    this.prints = new THREE.InstancedMesh(geo, mat, MAX_PRINTS);
    this.prints.count = 0;
    this.prints.receiveShadow = true;
    this.prints.frustumCulled = false;
    this.group.add(this.prints);
  }

  /** A foot landed at pos, plate oriented by q; strength around 1. */
  footfall(pos: THREE.Vector3, q: THREE.Quaternion, _strength: number) {
    this.q.copy(q);
    this.m.compose(pos.clone().add(new THREE.Vector3(0, 0.02, 0)), this.q, new THREE.Vector3(1, 1, 1));
    this.prints.setMatrixAt(this.printI % MAX_PRINTS, this.m);
    this.printI++;
    this.prints.count = Math.min(MAX_PRINTS, this.printI);
    this.prints.instanceMatrix.needsUpdate = true;
  }

  update(_dt: number) {}
}
