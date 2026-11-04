// Draws the test swarm (src/game/testSwarm.ts): one instanced squat post per body in the tier's colour, reddening as
// it wears down and flashing when hit; a downed body lies as a low heap until it stands up again. A ring on the
// ground marks the pen.
import * as THREE from "three/webgpu";
import type { TestSwarm } from "./testSwarm";

const BODY = 0xb9b0a2, HURT = 0xc4523f, DOWN = 0x4a4540;

export class TestSwarmDraw {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private built: unknown = null;
  private ring: THREE.Mesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private body = new THREE.Color(BODY);
  private hurt = new THREE.Color(HURT);
  private down = new THREE.Color(DOWN);
  private white = new THREE.Color(0xffffff);

  constructor(private sw: TestSwarm) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: 0x4bc0d9, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);
    this.rebuild();
  }

  /** After the pen is laid out again. */
  rebuild() {
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); }
    this.built = this.sw.bodies;
    const n = Math.max(1, this.sw.bodies.length);
    // A unit post (1 m across, 1 m tall, base at 0); each instance scales it to the body.
    const g = new THREE.CylinderGeometry(0.42, 0.5, 1, 8);
    g.translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, this.body);
    this.group.add(this.mesh);
  }

  update() {
    const sw = this.sw;
    if (sw.bodies !== this.built) this.rebuild();
    const mesh = this.mesh!;
    let rMax = 0, yc = 0;
    sw.bodies.forEach((b, i) => {
      rMax = Math.max(rMax, Math.hypot(b.x - sw.cx, b.z - sw.cz) + b.radius);
      yc += b.y;
      const w = b.radius * 2, h = b.height;
      if (b.alive) {
        this.e.set(0, 0, 0);
        this.s.set(w, h, w);
        const share = Math.max(0, b.health / sw.v.tsHp);
        this.c.copy(this.hurt).lerp(this.body, share).lerp(this.white, b.flash * 0.6);
      } else {
        this.e.set(Math.PI / 2 * Math.min(1, b.deadFor * 4), b.fallYaw, 0, "YXZ");
        this.s.set(w, h, w * 0.6);
        this.c.copy(this.down);
      }
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(b.x, b.y, b.z), this.q, this.s);
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, this.c);
    });
    mesh.count = sw.bodies.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.ring.visible = sw.bodies.length > 0;
    if (this.ring.visible) {
      this.ring.position.set(sw.cx, yc / sw.bodies.length + 0.05, sw.cz);
      this.ring.scale.setScalar(rMax + 0.6);
    }
  }

  meshes(): THREE.Object3D[] { return this.mesh ? [this.mesh] : []; }
}
