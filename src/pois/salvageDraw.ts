// Draws salvage: a ring on the sand and a bobbing marker over every spot still worth stripping (brighter when the mech
// is in reach), a progress bar over any spot part done (readable from the 40 m game camera), and while stripping:
// sparks (the battlefield's gun effects), hot bits of metal flung off and bouncing, grinding dust and smoke, the
// grind sound, and a pulse on the sand each time the noise goes out.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { SalvageSim, SpotState } from "./salvage";

export const SALVAGE_FX_DEFAULTS = { stripSparks: 70, stripBits: 6, markerSize: 1, barWidth: 4.5 };
export type SalvageFxValues = typeof SALVAGE_FX_DEFAULTS;
const G = "Salvage: look";
export const SALVAGE_FX_PARAMS: Param[] = [
  { key: "stripSparks", label: "Sparks per second", min: 0, max: 300, step: 1, group: G },
  { key: "stripBits", label: "Bits per second", min: 0, max: 40, step: 0.5, group: G, tip: "Hot pieces of metal flung off while stripping" },
  { key: "markerSize", label: "Marker size", min: 0.3, max: 3, step: 0.05, group: G, tip: "Rings and markers over salvage spots" },
  { key: "barWidth", label: "Progress bar width (m)", min: 1, max: 10, step: 0.1, group: G },
];

const AMBER = new THREE.Color(0xffb347), BRIGHT = new THREE.Color(0xffe2a8), DONE = new THREE.Color(0x6d675e);
const MAX_SPOTS = 512, BARS = 12, BITS = 96, PULSES = 6;

interface Bit { pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; age: number; rest: boolean }

export class SalvageDraw {
  readonly group = new THREE.Group();
  private rings: THREE.InstancedMesh;
  private pips: THREE.InstancedMesh;
  private bars: { root: THREE.Group; fill: THREE.Mesh }[] = [];
  private bits: Bit[] = [];
  private bitMesh: THREE.InstancedMesh;
  private pulses: { mesh: THREE.Mesh; age: number }[] = [];
  private nextBit = 0;
  private nextPulse = 0;
  private t = 0;
  private sparkAcc = 0;
  private bitAcc = 0;
  private soundT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private n = new THREE.Vector3();

  constructor(private sim: SalvageSim, private bf: Battlefield, public v: SalvageFxValues) {
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(1.35, 1.75, 40).rotateX(-Math.PI / 2), ringMat, MAX_SPOTS);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 5;
    const pipMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.pips = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.5, 0).scale(1, 1.5, 1), pipMat, MAX_SPOTS);
    this.pips.frustumCulled = false;
    for (let i = 0; i < MAX_SPOTS; i++) { this.rings.setColorAt(i, AMBER); this.pips.setColorAt(i, AMBER); }
    this.group.add(this.rings, this.pips);
    for (let i = 0; i < BARS; i++) {
      const root = new THREE.Group();
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x1b1916, transparent: true, opacity: 0.75, depthTest: false, toneMapped: false }));
      back.scale.set(1.08, 0.55, 1);
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false, toneMapped: false }));
      fill.position.x = -0.5;
      fill.scale.set(0.5, 0.36, 1);
      back.renderOrder = 20; fill.renderOrder = 21;
      root.add(back, fill);
      root.visible = false;
      this.group.add(root);
      this.bars.push({ root, fill });
    }
    const bitMat = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.6, metalness: 0.3, emissive: 0xff7a2a, emissiveIntensity: 0.6, flatShading: true });
    this.bitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.06, 0.2), bitMat, BITS);
    this.bitMesh.frustumCulled = false;
    this.bitMesh.castShadow = true;
    for (let i = 0; i < BITS; i++) {
      this.bits.push({ pos: new THREE.Vector3(0, -999, 0), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), age: 99, rest: true });
    }
    this.group.add(this.bitMesh);
    for (let i = 0; i < PULSES; i++) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.pulses.push({ mesh, age: 99 });
    }
  }

  /** A noise went out from (x, z): a pulse across the sand. */
  pulse(x: number, z: number) {
    const pl = this.pulses[this.nextPulse++ % PULSES];
    pl.age = 0;
    pl.mesh.position.set(x, this.bf.field.height(x, z) + 0.15, z);
    pl.mesh.visible = true;
  }

  /** A spot finished: a last burst. */
  burst(s: SpotState) {
    const at = this.spotPos(s, this.p);
    this.bf.gunFx.sparksAt(at, this.n.set(0, 1, 0), 40, 9);
    for (let i = 0; i < 8; i++) this.fling(at, this.n.set(Math.random() - 0.5, 1, Math.random() - 0.5).normalize());
    for (let i = 0; i < 6; i++) this.bf.dust.smoke(at.x, at.y, at.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.5, 2.5, 0.7, 0.7);
    this.bf.sfx.play("metalHit", at, 1.2, 0.6, false);
    this.bf.sfx.play("brap", at, 0.8, 0.5, false);
  }

  private spotPos(s: SpotState, out: THREE.Vector3) {
    return out.set(s.x, this.bf.field.height(s.x, s.z) + s.h, s.z);
  }

  private fling(at: THREE.Vector3, dir: THREE.Vector3) {
    const b = this.bits[this.nextBit++ % BITS];
    b.pos.copy(at);
    b.vel.copy(dir).multiplyScalar(4 + Math.random() * 5);
    b.vel.y += 2 + Math.random() * 3;
    b.spin.set(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10);
    b.age = 0; b.rest = false;
  }

  /** Per frame, after the sim; mech hips at (mx, mz). */
  update(dt: number, camera: THREE.Camera, mx: number, mz: number) {
    this.t += dt;
    const v = this.v, sim = this.sim, field = this.bf.field, k = v.markerSize;
    // Markers.
    let n = 0;
    for (const s of sim.spots) {
      if (n >= MAX_SPOTS) break;
      const gy = field.height(s.x, s.z);
      const reach = s === sim.inReach;
      const sc = s.done ? k * 0.55 : reach ? k * 1.15 : k;
      this.m.compose(this.p.set(s.x, gy + 0.12, s.z), this.q.identity(), this.s.setScalar(sc));
      this.rings.setMatrixAt(n, this.m);
      this.rings.setColorAt(n, s.done ? DONE : reach ? BRIGHT : AMBER);
      const bob = Math.sin(this.t * 2.4 + s.x * 0.3) * 0.25;
      this.q.setFromAxisAngle(this.n.set(0, 1, 0), this.t * 1.5 + s.z);
      this.m.compose(this.p.set(s.x, gy + s.h + 2.6 * k + bob, s.z), this.q, this.s.setScalar(s.done ? 0 : k * (reach ? 1.25 : 1)));
      this.pips.setMatrixAt(n, this.m);
      this.pips.setColorAt(n, reach ? BRIGHT : AMBER);
      n++;
    }
    this.rings.count = n; this.pips.count = n;
    this.rings.instanceMatrix.needsUpdate = true; this.pips.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    if (this.pips.instanceColor) this.pips.instanceColor.needsUpdate = true;

    // Progress bars: the active spot first, then any part done nearby.
    let b = 0;
    const shown = sim.spots.filter((s) => !s.done && (s === sim.active || s.progress > 0)).sort((a, c) => (a === sim.active ? -1 : c === sim.active ? 1 : 0));
    for (const s of shown) {
      if (b >= BARS) break;
      const bar = this.bars[b++];
      bar.root.visible = true;
      bar.root.position.set(s.x, field.height(s.x, s.z) + s.h + 4.4 * k, s.z);
      bar.root.quaternion.copy(camera.quaternion);
      bar.root.scale.setScalar(v.barWidth);
      bar.fill.scale.x = Math.max(0.001, s.progress);
      (bar.fill.material as THREE.MeshBasicMaterial).color.setHex(s === sim.active ? 0xffb347 : 0x9a8a70);
    }
    for (; b < BARS; b++) this.bars[b].root.visible = false;

    // Stripping: sparks off the cut, bits flung toward and past the mech's side, grinding dust, the grind.
    const a = sim.active;
    if (a) {
      const at = this.spotPos(a, this.p);
      const dx = mx - a.x, dz = mz - a.z, d = Math.hypot(dx, dz) || 1;
      this.sparkAcc += v.stripSparks * dt;
      while (this.sparkAcc >= 1) {
        const burst = Math.min(8, Math.floor(this.sparkAcc));
        this.sparkAcc -= burst;
        const j = this.s.set(at.x + (Math.random() - 0.5) * 1.2, at.y + Math.random() * 0.6, at.z + (Math.random() - 0.5) * 1.2);
        this.bf.gunFx.sparksAt(j, this.n.set(dx / d * 0.6 + (Math.random() - 0.5), 1, dz / d * 0.6 + (Math.random() - 0.5)).normalize(), burst, 7);
      }
      this.bitAcc += v.stripBits * dt;
      while (this.bitAcc >= 1) {
        this.bitAcc -= 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        this.fling(at, this.n.set(-dz / d * side + (Math.random() - 0.5) * 0.6, 0.6, dx / d * side + (Math.random() - 0.5) * 0.6).normalize());
      }
      if (Math.random() < dt * 6) this.bf.dust.smoke(at.x, at.y, at.z, (Math.random() - 0.5), 0.8 + Math.random(), (Math.random() - 0.5), 0.35, 2, 0.6, 0.55);
      if (Math.random() < dt * 8) this.bf.dust.emit(1, at.x, at.y - a.h + 0.2, at.z, (Math.random() - 0.5) * 3, 0.5 + Math.random(), (Math.random() - 0.5) * 3, 0.6, 2.5, 0.7);
      this.soundT -= dt;
      if (this.soundT <= 0) { this.soundT = 0.22; this.bf.sfx.play("grind", at, 0.9, 0.8 + Math.random() * 0.25, false); }
    } else { this.sparkAcc = 0; this.bitAcc = 0; this.soundT = 0; }

    // Bits: fly, bounce once off the sand, lie a while, then sink away.
    for (let i = 0; i < BITS; i++) {
      const bit = this.bits[i];
      bit.age += dt;
      if (!bit.rest) {
        bit.vel.y -= 18 * dt;
        bit.pos.addScaledVector(bit.vel, dt);
        bit.rot.x += bit.spin.x * dt; bit.rot.y += bit.spin.y * dt; bit.rot.z += bit.spin.z * dt;
        const gy = field.height(bit.pos.x, bit.pos.z) + 0.03;
        if (bit.pos.y < gy) {
          bit.pos.y = gy;
          if (Math.abs(bit.vel.y) > 3) { bit.vel.y *= -0.3; bit.vel.x *= 0.5; bit.vel.z *= 0.5; bit.spin.multiplyScalar(0.4); }
          else { bit.rest = true; bit.rot.x = 0; bit.rot.z = 0; }
        }
      }
      const sink = bit.age > 6 ? Math.min(1, (bit.age - 6) / 2) : 0;
      this.q.setFromEuler(bit.rot);
      this.m.compose(this.p.copy(bit.pos).setY(bit.pos.y - sink * 0.3), this.q, this.s.setScalar(bit.age > 8 ? 0 : 1));
      this.bitMesh.setMatrixAt(i, this.m);
    }
    this.bitMesh.instanceMatrix.needsUpdate = true;

    // Noise pulses: a ring racing out across the sand and fading.
    for (const pl of this.pulses) {
      if (!pl.mesh.visible) continue;
      pl.age += dt;
      const t = pl.age / 0.9;
      if (t >= 1) { pl.mesh.visible = false; continue; }
      pl.mesh.scale.setScalar(2 + t * 26);
      (pl.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - t);
    }
  }

  /** Meshes for hold-V. */
  objects(): THREE.Object3D[] { return [this.rings, this.pips]; }
}
