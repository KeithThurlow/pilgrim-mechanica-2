// Footfall effects: prints pressed into the sand (oldest recycled) and a low dust burst on each stomp.
import * as THREE from "three/webgpu";

const MAX_PRINTS = 200;
const PUFFS = 36;

export class FootfallFx {
  readonly group = new THREE.Group();
  private prints: THREE.InstancedMesh;
  private printI = 0;
  private puffs: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; vel: THREE.Vector3; age: number; life: number; size: number }[] = [];
  private puffI = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor() {
    const geo = new THREE.PlaneGeometry(0.85, 1.25).rotateX(-Math.PI / 2).translate(0, 0, 0.12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8a5a36, roughness: 1, transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.prints = new THREE.InstancedMesh(geo, mat, MAX_PRINTS);
    this.prints.count = 0;
    this.prints.receiveShadow = true;
    this.prints.frustumCulled = false;
    this.group.add(this.prints);

    const ball = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < PUFFS; i++) {
      const pm = new THREE.MeshStandardMaterial({ color: 0xe5c597, roughness: 1, transparent: true, opacity: 0, depthWrite: false, flatShading: true });
      const mesh = new THREE.Mesh(ball, pm);
      mesh.visible = false;
      this.group.add(mesh);
      this.puffs.push({ mesh, mat: pm, vel: new THREE.Vector3(), age: 0, life: 1, size: 1 });
    }
  }

  /** A foot landed at pos, plate oriented by q; strength around 1. */
  footfall(pos: THREE.Vector3, q: THREE.Quaternion, strength: number) {
    this.q.copy(q);
    this.m.compose(pos.clone().add(new THREE.Vector3(0, 0.02, 0)), this.q, new THREE.Vector3(1, 1, 1));
    this.prints.setMatrixAt(this.printI % MAX_PRINTS, this.m);
    this.printI++;
    this.prints.count = Math.min(MAX_PRINTS, this.printI);
    this.prints.instanceMatrix.needsUpdate = true;

    const n = 4;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[this.puffI++ % PUFFS];
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      p.mesh.position.set(pos.x + Math.cos(a) * 0.5, pos.y + 0.15, pos.z + Math.sin(a) * 0.5);
      p.vel.set(Math.cos(a) * 1.6 * strength, 0.5 + Math.random() * 0.4, Math.sin(a) * 1.6 * strength);
      p.age = 0;
      p.life = 0.9 + Math.random() * 0.6;
      p.size = (0.22 + Math.random() * 0.18) * strength;
      p.mesh.visible = true;
    }
  }

  update(dt: number) {
    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.mesh.visible = false; continue; }
      p.vel.multiplyScalar(Math.exp(-dt * 3));
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * (0.6 + t * 1.6));
      p.mat.opacity = 0.3 * (1 - t) * Math.min(1, t * 8);
    }
  }
}
