// Draws the bandit swarm (infantry.ts): one instanced, merged low-poly stand-in figure (legs, torso, head wrap, a
// rifle), about 1.8 m tall, in a few raider cloth colours. No skeleton: running is a bob, a forward lean and a
// little sway; downed bandits topple flat along the way they were thrown and get back up; the dead lie flat, then
// sink into the sand and vanish before their slot is reused.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { InfantrySwarm, INFANTRY_MAX, DOWN, DEAD, EMPTY } from "./infantry";

/** Raider cloth: rust, dusty khaki, faded indigo, olive. */
const CLOTH = [0x9a4a2c, 0xb59c72, 0x4e5a78, 0x6b6a3e];

/** Look values that aren't feel (kept here; the lead can promote any to sliders). */
const BOB = 0.07, LEAN = 0.14, SWAY = 0.06, STRIDE = 1.6, FALL_RATE = 6, SINK = 0.7;

function part(w: number, h: number, d: number, x: number, y: number, z: number, rgb: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(rgb), n = g.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** The stand-in figure, feet at y = 0, facing +Z. White parts take the instance's cloth colour. */
function figure(): THREE.BufferGeometry {
  const cloth = 0xffffff, skin = 0x8a6448, dark = 0x2a2522, wrap = 0xd8ccb4;
  const g = mergeGeometries([
    part(0.18, 0.85, 0.2, 0.12, 0.43, 0, cloth),     // legs
    part(0.18, 0.85, 0.2, -0.12, 0.43, 0, cloth),
    part(0.2, 0.12, 0.3, 0.12, 0.06, 0.05, dark),    // boots
    part(0.2, 0.12, 0.3, -0.12, 0.06, 0.05, dark),
    part(0.46, 0.62, 0.28, 0, 1.15, 0, cloth),       // torso
    part(0.5, 0.14, 0.32, 0, 0.92, 0, dark),         // belt
    part(0.12, 0.5, 0.14, 0.3, 1.18, 0.12, cloth),   // arms, forward onto the rifle
    part(0.12, 0.5, 0.14, -0.3, 1.18, 0.12, cloth),
    part(0.22, 0.24, 0.24, 0, 1.6, 0, skin),         // head
    part(0.27, 0.12, 0.28, 0, 1.69, -0.01, wrap),    // head wrap
    part(0.07, 0.09, 0.85, 0.08, 1.33, 0.45, dark),  // rifle
  ]);
  g.computeVertexNormals();
  return g;
}

export class InfantryDraw {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private tilt = new Float32Array(INFANTRY_MAX);
  private phase = new Float32Array(INFANTRY_MAX);
  private gen = new Uint32Array(INFANTRY_MAX);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qa = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private ax = new THREE.Vector3(1, 0, 0);
  private ay = new THREE.Vector3(0, 1, 0);
  private az = new THREE.Vector3(0, 0, 1);

  constructor(private swarm: InfantrySwarm) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(figure(), mat, INFANTRY_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(INFANTRY_MAX * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  update(dt: number): void {
    const sw = this.swarm, v = sw.v, mesh = this.mesh;
    let n = 0;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY || (st === DEAD && sw.hideDead)) continue;
      if (this.gen[i] !== sw.gen[i]) { this.gen[i] = sw.gen[i]; this.tilt[i] = 0; this.phase[i] = sw.seed[i] * 6.283; }

      const speed = Math.hypot(sw.vx[i], sw.vz[i]);
      const flat = st === DOWN || st === DEAD;
      // Topple fast, get up a little slower.
      const want = flat ? 1 : 0;
      this.tilt[i] += Math.sign(want - this.tilt[i]) * Math.min(Math.abs(want - this.tilt[i]), dt * (flat ? FALL_RATE : FALL_RATE * 0.6));
      const tilt = this.tilt[i];

      let y = sw.py[i], scale = 1;
      if (st === DEAD) {
        const left = v.bodyLife - sw.stateTime[i];
        if (left < v.sinkTime) {
          const k = 1 - Math.max(0, left) / Math.max(0.01, v.sinkTime);
          y -= k * SINK;
          scale = 1 - k * k;
        }
      }

      if (tilt > 0.001) {
        // Lie along the fall: the figure's up turns toward fallYaw.
        this.q.setFromAxisAngle(this.ay, sw.fallYaw[i]);
        this.qa.setFromAxisAngle(this.ax, tilt * Math.PI * 0.5);
        this.q.multiply(this.qa);
        y += tilt * 0.18;
      } else {
        // Run cycle: bob, lean into the run, sway side to side.
        this.phase[i] += (speed / STRIDE) * Math.PI * dt;
        const run = Math.min(1, speed / 4);
        y += Math.abs(Math.sin(this.phase[i])) * BOB * run;
        this.q.setFromAxisAngle(this.ay, sw.heading[i]);
        this.qa.setFromAxisAngle(this.ax, LEAN * run);
        this.q.multiply(this.qa);
        this.qa.setFromAxisAngle(this.az, Math.sin(this.phase[i]) * SWAY * run);
        this.q.multiply(this.qa);
      }

      this.p.set(sw.px[i], y, sw.pz[i]);
      this.s.setScalar(scale * (0.94 + sw.seed[i] * 0.12));
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(n, this.m);
      this.c.setHex(CLOTH[sw.look[i] & 3]).multiplyScalar(0.85 + sw.seed[i] * 0.3);
      if (st === DEAD) this.c.multiplyScalar(0.7);
      mesh.setColorAt(n, this.c);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
