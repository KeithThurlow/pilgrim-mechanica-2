// A crusher's suction (src/combat/crusher.ts): streaks of sand and grit pulled along the sand in the cone in front of
// its maw, faster the nearer they get, while the fan spins (spinning up, sucking at the prey, or eating a heap).
// Cosmetic (Math.random is fine here). One instanced mesh for every crusher.
import * as THREE from "three/webgpu";
import type { Ground } from "../mech/walker";
import { SUCK, EAT, type Crusher } from "./crusher";
import type { ViewCull } from "../core/viewCull";

const MAX = 260;
interface Bit { x: number; y: number; z: number; owner: Crusher | null; life: number }

export class CrusherFx {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private bits: Bit[] = Array.from({ length: MAX }, () => ({ x: 0, y: 0, z: 0, owner: null, life: 0 }));
  private acc = new Map<Crusher, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private maw = { x: 0, y: 0, z: 0 };
  private vis = new Map<Crusher, boolean>();

  constructor(private ground: Ground) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xe0c89a, transparent: true, opacity: 0.75, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  /** view: streaks only for crushers whose cone is on the screen (perf 2026-11-07). */
  update(dt: number, list: readonly Crusher[], view?: ViewCull) {
    const vis = this.vis; vis.clear();
    const seen = (c: Crusher) => {
      let s = vis.get(c);
      if (s === undefined) vis.set(c, (s = !view || view.sees(c.x, c.bodyY, c.z, 8 + Math.max(c.v.crusherSuckRange, c.v.crusherEatReach))));
      return s;
    };
    // Spawn: a stream in the cone ahead, thicker as the fan comes up.
    for (const c of list) {
      if (!c.alive || c.spin < 0.15) continue;
      if (!seen(c)) { this.acc.set(c, 0); continue; }
      const rate = (c.mode === SUCK || c.mode === EAT ? 110 : 35) * c.spin;
      let a = (this.acc.get(c) ?? 0) + rate * dt;
      const range = c.mode === EAT ? c.v.crusherEatReach : c.v.crusherSuckRange, cone = (c.v.crusherSuckCone * Math.PI) / 180;
      c.maw(this.maw);
      while (a >= 1) {
        a -= 1;
        const b = this.bits.find((x) => !x.owner);
        if (!b) break;
        const ang = c.heading + (Math.random() * 2 - 1) * cone, d = 2 + Math.random() * range;
        b.x = this.maw.x + Math.sin(ang) * d; b.z = this.maw.z + Math.cos(ang) * d;
        b.y = this.ground.height(b.x, b.z) + Math.random() * 0.6;
        b.owner = c; b.life = 0;
      }
      this.acc.set(c, a);
    }
    let n = 0;
    for (const b of this.bits) {
      const c = b.owner;
      if (!c) continue;
      c.maw(this.maw);
      const dx = this.maw.x - b.x, dy = this.maw.y - b.y, dz = this.maw.z - b.z, d = Math.hypot(dx, dy, dz);
      b.life += dt;
      if (d < 0.8 || b.life > 4 || !c.alive || c.spin < 0.1 || !seen(c)) { b.owner = null; continue; }
      // Faster near the maw; it hugs the sand until the last few metres, then lifts into the intake.
      const speed = 3 + 60 * c.spin / Math.max(1.5, d);
      const k = Math.min(1, (speed * dt) / d);
      b.x += dx * k; b.z += dz * k;
      const g = this.ground.height(b.x, b.z);
      b.y = d < 5 ? b.y + dy * k : Math.max(g + 0.05, b.y + dy * k * 0.3);
      this.p.set(b.x, b.y, b.z);
      this.q.setFromUnitVectors(UP, DIR.set(dx, dy, dz).normalize());
      const len = Math.min(2.2, 0.15 + speed * 0.06);
      this.s.set(0.06, len, 0.06);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const c of this.acc.keys()) if (!list.includes(c)) this.acc.delete(c);
  }
}

const UP = new THREE.Vector3(0, 1, 0), DIR = new THREE.Vector3();
