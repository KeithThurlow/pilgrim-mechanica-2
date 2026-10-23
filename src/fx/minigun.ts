// Minigun effects: tracers from the muzzle to the ground, a flash and light per shot, hit dust thrown downrange
// with a few sparks, and brass casings that eject outboard and bounce on the real ground.
import * as THREE from "three/webgpu";
import type { Ground } from "../mech/walker";
import type { Param } from "../core/tweaks";

export const MINIGUN_FX_DEFAULTS = {
  tracerSpeed: 220,
  tracerLength: 3.2,
  tracerEvery: 1,
  flashSize: 0.9,
  flashLight: 40,
  hitDust: 1,
  casingKick: 3.2,
};
export type MinigunFxValues = typeof MINIGUN_FX_DEFAULTS;

export const MINIGUN_FX_PARAMS: Param[] = [
  { key: "tracerSpeed", label: "Tracer speed (m/s)", min: 40, max: 600, step: 5, group: "Minigun FX" },
  { key: "tracerLength", label: "Tracer length (m)", min: 0.3, max: 8, step: 0.1, group: "Minigun FX" },
  { key: "tracerEvery", label: "Tracer every Nth round", min: 1, max: 5, step: 1, group: "Minigun FX" },
  { key: "flashSize", label: "Muzzle flash size", min: 0, max: 3, step: 0.05, group: "Minigun FX" },
  { key: "flashLight", label: "Flash light", min: 0, max: 200, step: 1, group: "Minigun FX" },
  { key: "hitDust", label: "Hit dust", min: 0, max: 3, step: 0.05, group: "Minigun FX" },
  { key: "casingKick", label: "Casing eject speed", min: 0, max: 8, step: 0.1, group: "Minigun FX" },
];

const TRACERS = 48, PUFFS = 90, SPARKS = 60, CASINGS = 240;

interface Tracer { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; dist: number; t: number; live: boolean }
interface Puff { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; vel: THREE.Vector3; age: number; life: number; size: number }
interface Bit { pos: THREE.Vector3; vel: THREE.Vector3; age: number; life: number; spin: THREE.Vector3; rot: THREE.Euler; rest: boolean }

export class MinigunFx {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private puffI = 0;
  private sparks: THREE.InstancedMesh;
  private sparkBits: Bit[] = [];
  private sparkI = 0;
  private casings: THREE.InstancedMesh;
  private casingBits: Bit[] = [];
  private casingI = 0;
  private flashes: { mesh: THREE.Object3D; light: THREE.PointLight; t: number }[] = [];
  private round = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(private ground: Ground, public v: MinigunFxValues) {
    const tracerGeo = new THREE.BoxGeometry(0.07, 0.07, 1).translate(0, 0, -0.5);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, toneMapped: false });
    for (let i = 0; i < TRACERS; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), dist: 0, t: 0, live: false });
    }
    const ball = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < PUFFS; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xe2c193, roughness: 1, transparent: true, opacity: 0, depthWrite: false, flatShading: true });
      const mesh = new THREE.Mesh(ball, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.puffs.push({ mesh, mat, vel: new THREE.Vector3(), age: 0, life: 1, size: 1 });
    }
    this.sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.25), new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }), SPARKS);
    this.casings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.35 }), CASINGS);
    this.casings.castShadow = true;
    for (const im of [this.sparks, this.casings]) {
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.group.add(im);
    }
    for (let i = 0; i < SPARKS; i++) this.sparkBits.push(bit());
    for (let i = 0; i < CASINGS; i++) this.casingBits.push(bit());

    const flashGeo = new THREE.PlaneGeometry(1, 1);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Group();
      for (const r of [0, Math.PI / 2]) { const p = new THREE.Mesh(flashGeo, flashMat); p.rotation.z = r; p.scale.set(0.35, 1, 1); p.rotation.x = Math.PI / 2; mesh.add(p); }
      const face = new THREE.Mesh(flashGeo, flashMat); face.scale.setScalar(0.7); mesh.add(face);
      mesh.visible = false;
      const light = new THREE.PointLight(0xffb15a, 0, 14, 2);
      this.group.add(mesh, light);
      this.flashes.push({ mesh, light, t: 0 });
    }
  }

  /** One round from a muzzle toward a ground point (already spread). eject: casing port; outboard: unit direction. */
  shot(gun: 0 | 1, muzzle: THREE.Vector3, dir: THREE.Vector3, hit: THREE.Vector3, eject: THREE.Vector3, outboard: THREE.Vector3) {
    this.round++;
    const f = this.flashes[gun];
    f.t = 0.045;
    f.mesh.visible = this.v.flashSize > 0;
    f.mesh.position.copy(muzzle);
    f.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    f.mesh.rotateZ(Math.random() * Math.PI);
    f.mesh.scale.setScalar(this.v.flashSize * (0.7 + Math.random() * 0.6));
    f.light.position.copy(muzzle).addScaledVector(dir, 0.4);
    f.light.intensity = this.v.flashLight;

    // Every round flies (it times the hit); only every Nth shows as a tracer.
    const t = this.tracers.find((x) => !x.live) ?? this.tracers[this.round % TRACERS];
    t.from.copy(muzzle); t.to.copy(hit); t.dist = muzzle.distanceTo(hit); t.t = 0; t.live = true;
    t.mesh.visible = this.round % Math.max(1, Math.round(this.v.tracerEvery)) === 0;

    const c = this.casingBits[this.casingI++ % CASINGS];
    c.pos.copy(eject);
    c.vel.copy(outboard).multiplyScalar(this.v.casingKick * (0.7 + Math.random() * 0.6)).add(new THREE.Vector3((Math.random() - 0.5), 1.8 + Math.random(), (Math.random() - 0.5) - 0.8));
    c.age = 0; c.life = 7; c.rest = false;
    c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
  }

  private impact(at: THREE.Vector3, dir: THREE.Vector3) {
    const k = this.v.hitDust;
    if (k <= 0) return;
    const fwd = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    for (let i = 0; i < 3; i++) {
      const p = this.puffs[this.puffI++ % PUFFS];
      p.mesh.position.copy(at).add(new THREE.Vector3(0, 0.1, 0));
      const a = (Math.random() - 0.5) * 1.4;
      const d = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      p.vel.copy(d).multiplyScalar((1.5 + Math.random() * 3) * k).add(new THREE.Vector3(0, 0.6 + Math.random() * 1.2, 0));
      p.age = 0; p.life = 0.7 + Math.random() * 0.8; p.size = (0.18 + Math.random() * 0.22) * k;
      p.mesh.visible = true;
    }
    for (let i = 0; i < 2; i++) {
      const s = this.sparkBits[this.sparkI++ % SPARKS];
      s.pos.copy(at);
      s.vel.copy(fwd).multiplyScalar(4 + Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5));
      s.age = 0; s.life = 0.25 + Math.random() * 0.2; s.rest = false;
    }
  }

  update(dt: number) {
    for (const f of this.flashes) {
      f.t -= dt;
      if (f.t <= 0) { f.mesh.visible = false; f.light.intensity = 0; }
    }
    for (const t of this.tracers) {
      if (!t.live) continue;
      t.t += dt * this.v.tracerSpeed;
      const head = Math.min(t.t, t.dist), tail = Math.max(0, head - this.v.tracerLength);
      const dir = this.s.subVectors(t.to, t.from).normalize();
      t.mesh.position.copy(t.from).addScaledVector(dir, head);
      t.mesh.lookAt(t.mesh.position.clone().add(dir));
      t.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
      if (t.t >= t.dist) { t.live = false; t.mesh.visible = false; this.impact(t.to, dir.clone()); }
    }
    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) { p.mesh.visible = false; continue; }
      p.vel.multiplyScalar(Math.exp(-dt * 3.5));
      p.vel.y -= dt * 0.6;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * (0.5 + u * 1.8));
      p.mat.opacity = 0.42 * (1 - u) * Math.min(1, u * 10);
    }
    this.stepBits(this.sparkBits, this.sparks, dt, false);
    this.stepBits(this.casingBits, this.casings, dt, true);
  }

  private stepBits(bits: Bit[], im: THREE.InstancedMesh, dt: number, bounce: boolean) {
    bits.forEach((b, i) => {
      if (b.age >= b.life) return;
      b.age += dt;
      if (b.age >= b.life) { im.setMatrixAt(i, this.m.makeScale(0, 0, 0)); return; }
      if (!b.rest) {
        b.vel.y -= 9.8 * dt;
        b.pos.addScaledVector(b.vel, dt);
        b.rot.x += b.spin.x * dt; b.rot.y += b.spin.y * dt; b.rot.z += b.spin.z * dt;
        const g = this.ground.height(b.pos.x, b.pos.z) + 0.03;
        if (b.pos.y < g) {
          b.pos.y = g;
          if (!bounce || Math.abs(b.vel.y) < 0.8) { b.rest = true; b.rot.x = Math.PI / 2 * Math.round(b.rot.x / (Math.PI / 2)); }
          else { b.vel.y *= -0.32; b.vel.x *= 0.5; b.vel.z *= 0.5; b.spin.multiplyScalar(0.5); }
        }
      }
      const k = bounce ? 1 : 1 - b.age / b.life;
      this.q.setFromEuler(b.rot);
      if (!bounce) this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.vel.clone().normalize());
      im.setMatrixAt(i, this.m.compose(b.pos, this.q, this.s.set(k, k, k)));
    });
    im.instanceMatrix.needsUpdate = true;
  }
}

function bit(): Bit {
  return { pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 1, life: 0, spin: new THREE.Vector3(), rot: new THREE.Euler(), rest: true };
}
