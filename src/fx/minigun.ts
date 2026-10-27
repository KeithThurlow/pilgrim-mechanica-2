// Minigun effects: tracers from the muzzle to what they hit, a flash and light per shot, hits by surface, and brass
// casings that eject outboard and bounce on the real ground.
// Hits (Keith 2026-10-24): sand hits feed the shared dust system (dust.ts: a low layer torn up and shoved downrange,
// dust thrown up) plus grit; steel gets sparks (mostly ricocheting on along the round, a few back off the face), a hot glint and a
// little dark smoke.
import * as THREE from "three/webgpu";
import type { Ground } from "../mech/walker";
import type { Param } from "../core/tweaks";
import { FX_BUDGET_DEFAULTS, FX_BUDGET_PARAMS, FxBudget, RANK } from "./budget";
import type { GpuBits } from "./gpuBits";
import type { GpuTracers } from "./gpuTracers";

export const MINIGUN_FX_DEFAULTS = {
  tracerSpeed: 220,
  tracerLength: 1.2,
  tracerEvery: 1,
  flashSize: 1,
  flashLight: 40,
  hitDust: 2.1,
  casingKick: 1.5,
  sandGrit: 5,
  metalSparks: 9,
  metalSparkSpeed: 11,
  metalSmoke: 1,
  sparkSize: 2.5,
  ...FX_BUDGET_DEFAULTS,
};
export type MinigunFxValues = typeof MINIGUN_FX_DEFAULTS;

export const MINIGUN_FX_PARAMS: Param[] = [
  { key: "tracerSpeed", label: "Tracer speed (m/s)", min: 40, max: 600, step: 5, group: "Minigun FX" },
  { key: "tracerLength", label: "Tracer length (m)", min: 0.3, max: 8, step: 0.1, group: "Minigun FX" },
  { key: "tracerEvery", label: "Tracer every Nth round", min: 1, max: 5, step: 1, group: "Minigun FX" },
  { key: "flashSize", label: "Muzzle flash size", min: 0, max: 3, step: 0.05, group: "Minigun FX" },
  { key: "flashLight", label: "Flash light", min: 0, max: 200, step: 1, group: "Minigun FX" },
  { key: "hitDust", label: "Hit size", min: 0, max: 3, step: 0.05, group: "Minigun FX", tip: "Scales every hit effect" },
  { key: "casingKick", label: "Casing eject speed", min: 0, max: 8, step: 0.1, group: "Minigun FX" },
  { key: "sandGrit", label: "Sand grit per hit", min: 0, max: 16, step: 1, group: "Minigun hits" },
  { key: "metalSparks", label: "Sparks off steel", min: 0, max: 30, step: 1, group: "Minigun hits" },
  { key: "metalSparkSpeed", label: "Spark speed (m/s)", min: 2, max: 30, step: 0.5, group: "Minigun hits" },
  { key: "sparkSize", label: "Spark size", min: 0.5, max: 6, step: 0.1, group: "Minigun hits" },
  { key: "metalSmoke", label: "Smoke off steel", min: 0, max: 4, step: 1, group: "Minigun hits" },
  ...FX_BUDGET_PARAMS,
];

/** What a round struck: the sand, or something steel (a wreck, a hull). */
export type HitSurface = "sand" | "metal" | "flesh";

const TRACERS = 160, FLASHES = 24, SPARKS = 600, GRIT = 600, CASINGS = 240;
/** Rounds in flight at once (each times its impact): the GPU tracers draw them all; the CPU path has a Mesh for the
 *  first TRACERS only. */
export const ROUNDS_IN_FLIGHT = 1024;

interface Tracer { mesh: THREE.Mesh | null; from: THREE.Vector3; to: THREE.Vector3; dist: number; t: number; live: boolean; surface: HitSurface; normal: THREE.Vector3; scale: number; own: boolean }
/** Impacts landing this frame, merged by cell and surface (src/fx/budget.ts). */
interface Merged { at: THREE.Vector3; dir: THREE.Vector3; normal: THREE.Vector3; surface: HitSurface; scale: number; n: number }
const SURF: Record<HitSurface, number> = { sand: 0, metal: 1, flesh: 2 };
interface Bit { pos: THREE.Vector3; vel: THREE.Vector3; age: number; life: number; spin: THREE.Vector3; rot: THREE.Euler; rest: boolean; landed: boolean }

export class MinigunFx {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private grit: THREE.InstancedMesh;
  private gritBits: Bit[] = [];
  private gritI = 0;
  private sparks: THREE.InstancedMesh;
  private sparkBits: Bit[] = [];
  private sparkI = 0;
  private casings: THREE.InstancedMesh;
  private casingBits: Bit[] = [];
  private casingI = 0;
  /** Muzzle flashes by gun slot: 0 and 1 are the player's guns (with a light); the rest are other guns (no light, so the shaders never change). */
  private flashes: { mesh: THREE.Object3D; light: THREE.PointLight | null; t: number }[] = [];
  private round = 0;
  /** Called where a round hits, with what it hit, and where a casing first lands (for sound). */
  onHit: ((at: THREE.Vector3, surface: HitSurface) => void) | null = null;
  /** A round into the sand: where, its flat travel direction, the hit size and how many hits it stands for (merged;
   *  their puff counts multiply by n). The dust system makes the dust. */
  onSandHit: ((at: THREE.Vector3, dir: THREE.Vector3, k: number, n: number) => void) | null = null;
  /** The effects budget: merging, thinning and trimming (shared with the dust; set by the battlefield). */
  budget: FxBudget;
  private merged = new Map<number, Merged>();
  private mergePool: Merged[] = [];
  /** Smoke off a steel hit: where, the face normal, how many puffs, the hit size. */
  onSteelSmoke: ((at: THREE.Vector3, normal: THREE.Vector3, puffs: number, k: number) => void) | null = null;
  /** Hits so far by surface (HUD and tests). */
  hits = { sand: 0, metal: 0, flesh: 0 };
  /** A round into a body (bandits): where and its flat travel; the battlefield makes a small dust burst. */
  onFleshHit: ((at: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;
  onCasingLand: ((at: THREE.Vector3) => void) | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  /**
   * The GPU versions (scale step 5; set by the battlefield once it has the renderer): sparks, grit and casings, and
   * the tracers. fxGpuBits / fxGpuTracers pick them over the CPU pools above.
   */
  gpuBits: GpuBits | null = null;
  gpuTracers: GpuTracers | null = null;
  private clock = 0;
  private tracerNext = 0;
  /** GPU casings: when each lands (for its tonk), worked out when it's thrown. */
  private landings: { t: number; at: THREE.Vector3 }[] = [];
  private get gpuB() { return this.gpuBits !== null && this.v.fxGpuBits > 0.5; }
  private get gpuT() { return this.gpuTracers !== null && this.v.fxGpuTracers > 0.5; }

  constructor(private ground: Ground, public v: MinigunFxValues) {
    this.budget = new FxBudget(v);
    const tracerGeo = new THREE.BoxGeometry(0.07, 0.07, 1).translate(0, 0, -0.5);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, toneMapped: false });
    for (let i = 0; i < ROUNDS_IN_FLIGHT; i++) {
      let mesh: THREE.Mesh | null = null;
      if (i < TRACERS) {
        mesh = new THREE.Mesh(tracerGeo, tracerMat);
        mesh.visible = false;
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
      this.tracers.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), dist: 0, t: 0, live: false, surface: "sand", normal: new THREE.Vector3(0, 1, 0), scale: 1, own: false });
    }
    this.grit = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshStandardMaterial({ color: 0x9a7a50, roughness: 1 }), GRIT);
    this.sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }), SPARKS);
    this.casings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.35 }), CASINGS);
    this.casings.castShadow = true;
    for (const im of [this.grit, this.sparks, this.casings]) {
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.group.add(im);
    }
    for (let i = 0; i < SPARKS; i++) this.sparkBits.push(bit());
    for (let i = 0; i < GRIT; i++) this.gritBits.push(bit());
    for (let i = 0; i < CASINGS; i++) this.casingBits.push(bit());

    const flashGeo = new THREE.PlaneGeometry(1, 1);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < FLASHES; i++) {
      const mesh = new THREE.Group();
      for (const r of [0, Math.PI / 2]) { const p = new THREE.Mesh(flashGeo, flashMat); p.rotation.z = r; p.scale.set(0.35, 1, 1); p.rotation.x = Math.PI / 2; mesh.add(p); }
      const face = new THREE.Mesh(flashGeo, flashMat); face.scale.setScalar(0.7); mesh.add(face);
      mesh.visible = false;
      const light = i < 2 ? new THREE.PointLight(0xffb15a, 0, 14, 2) : null;
      this.group.add(mesh);
      if (light) this.group.add(light);
      this.flashes.push({ mesh, light, t: 0 });
    }
  }

  /**
   * One round from a muzzle to where it strikes (already spread). surface and normal: what it struck there.
   * eject: casing port; outboard: unit direction. own: the local player's own round (its hit is never merged,
   * thinned or trimmed). gun -1: no muzzle flash (a split round or a ricochet riding along with another).
   */
  shot(gun: number, muzzle: THREE.Vector3, dir: THREE.Vector3, hit: THREE.Vector3, eject: THREE.Vector3 | null, outboard: THREE.Vector3 | null, surface: HitSurface = "sand", normal?: THREE.Vector3, flashScale = 1, hitScale = 1, own = false) {
    this.round++;
    if (gun >= 0) {
      const f = this.flashes[Math.min(FLASHES - 1, gun)];
      f.t = 0.045;
      f.mesh.visible = this.v.flashSize > 0;
      f.mesh.position.copy(muzzle);
      f.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      f.mesh.rotateZ(Math.random() * Math.PI);
      f.mesh.scale.setScalar(this.v.flashSize * flashScale * (0.7 + Math.random() * 0.6));
      if (f.light) { f.light.position.copy(muzzle).addScaledVector(dir, 0.4); f.light.intensity = this.v.flashLight; }
    }

    // Every round flies (it times the hit); only every Nth shows as a tracer. The next free slot from a ring pointer
    // (a slot still flying is never taken: its impact would be lost), the oldest when all are flying.
    let ti = this.tracerNext;
    for (let n = 0; n < ROUNDS_IN_FLIGHT && this.tracers[ti].live; n++) ti = (ti + 1) % ROUNDS_IN_FLIGHT;
    this.tracerNext = (ti + 1) % ROUNDS_IN_FLIGHT;
    const t = this.tracers[ti];
    t.from.copy(muzzle); t.to.copy(hit); t.dist = muzzle.distanceTo(hit); t.t = 0; t.live = true;
    t.surface = surface; t.normal.copy(normal ?? UP); t.scale = hitScale; t.own = own;
    // Far tracers that aren't yours thin with the budget (the round still flies and hits).
    const shown = this.round % Math.max(1, Math.round(this.v.tracerEvery)) === 0 && (own || this.budget.admit(hit.x, hit.z));
    if (this.gpuT) { this.gpuTracers!.set(ti, muzzle, hit, this.clock, shown); if (t.mesh) t.mesh.visible = false; }
    else if (t.mesh) t.mesh.visible = shown;

    if (!eject || !outboard) return;
    const vel = this.s.copy(outboard).multiplyScalar(this.v.casingKick * (0.7 + Math.random() * 0.6)).add(new THREE.Vector3((Math.random() - 0.5), 1.8 + Math.random(), (Math.random() - 0.5) - 0.8));
    if (this.gpuB) {
      const g0 = this.ground.height(eject.x, eject.z) + 0.03;
      this.gpuBits!.casings.emit(eject.x, eject.y, eject.z, vel.x, vel.y, vel.z, 7, 1, 8 + Math.random() * 18, g0);
      // When it first lands (its tonk): falling from the port to the ground under it.
      const drop = Math.max(0, eject.y - g0), tl = (vel.y + Math.sqrt(vel.y * vel.y + 2 * 9.8 * drop)) / 9.8;
      this.landings.push({ t: this.clock + tl, at: new THREE.Vector3(eject.x + vel.x * tl, g0, eject.z + vel.z * tl) });
      return;
    }
    const c = this.casingBits[this.casingI++ % CASINGS];
    c.pos.copy(eject);
    c.vel.copy(vel);
    c.age = 0; c.life = 7; c.rest = false; c.landed = false;
    c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
  }

  /** One spark (the GPU pool or the CPU one). */
  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    if (this.gpuB) { this.gpuBits!.sparks.emit(x, y, z, vx, vy, vz, life, 1, 0, y - 5); return; }
    const s = this.sparkBits[this.sparkI++ % SPARKS];
    s.pos.set(x, y, z); s.vel.set(vx, vy, vz);
    s.age = 0; s.life = life; s.rest = false;
  }

  /**
   * A round arrives: the local player's own go straight to impact(); the rest gather by cell and surface for this
   * frame (flushMerged) when merging is on.
   */
  private land(at: THREE.Vector3, dir: THREE.Vector3, surface: HitSurface, normal: THREE.Vector3, scale: number, own: boolean) {
    const b = this.budget, cell = this.v.fxMergeCell;
    if (own || !b.on || cell <= 0) { this.impact(at, dir, surface, normal, scale, 1, own); return; }
    const key = ((Math.floor(at.x / cell) + 32768) * 65536 + (Math.floor(at.z / cell) + 32768)) * 4 + SURF[surface];
    const m = this.merged.get(key);
    if (m) {
      m.n++; m.scale = Math.max(m.scale, scale); m.dir.add(dir);
      b.stats.merged++;
      return;
    }
    const e = this.mergePool.pop() ?? { at: new THREE.Vector3(), dir: new THREE.Vector3(), normal: new THREE.Vector3(), surface, scale, n: 1 };
    e.at.copy(at); e.dir.copy(dir); e.normal.copy(normal); e.surface = surface; e.scale = scale; e.n = 1;
    this.merged.set(key, e);
  }

  /** This frame's merged impacts: one effect each, n^fxMergeSize bigger, n^fxMergeCount more puffs. */
  private flushMerged() {
    if (!this.merged.size) return;
    const v = this.v;
    for (const m of this.merged.values()) {
      m.dir.normalize();
      this.impact(m.at, m.dir, m.surface, m.normal, m.scale * Math.pow(m.n, v.fxMergeSize), Math.pow(m.n, v.fxMergeCount), false, m.n);
      this.mergePool.push(m);
    }
    this.merged.clear();
  }

  /** n: puff-count multiplier (a merge); hits: how many rounds this stands for (the counters). */
  private impact(at: THREE.Vector3, dir: THREE.Vector3, surface: HitSurface, normal: THREE.Vector3, scale = 1, n = 1, own = false, hits = 1) {
    this.hits[surface] += hits;
    const b = this.budget;
    if (!b.admit(at.x, at.z, own)) return;
    this.onHit?.(at, surface);
    const k = this.v.hitDust * scale;
    if (k <= 0) return;
    // The dust and smoke these call for were admitted here: the dust pool doesn't ask again (hold).
    b.hold++;
    if (surface === "metal") this.steel(at, dir, normal, k, n);
    else if (surface === "flesh") this.onFleshHit?.(at, new THREE.Vector3(dir.x, 0, dir.z).normalize());
    else this.sand(at, dir, k, n);
    b.hold--;
  }

  /** A round into sand: the dust (via onSandHit) and grit. */
  private sand(at: THREE.Vector3, dir: THREE.Vector3, k: number, n = 1) {
    const v = this.v;
    const fwd = this.s.set(dir.x, 0, dir.z);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const along = fwd.clone();
    // The dust itself (the low layer torn up and pushed downrange, and the dust thrown up) is the shared dust system.
    this.onSandHit?.(at, along, k, n);
    // Grit: sand thrown up in an arc, mostly on downrange.
    const gpu = this.gpuB;
    for (let i = 0; i < Math.round(v.sandGrit * Math.min(1, k / Math.max(1e-3, v.hitDust)) * n * this.budget.part(RANK.grit)); i++) {
      const f = (Math.random() * 1.6 - 0.4) * 3;
      const vx = along.x * f + (Math.random() - 0.5) * 2.5, vy = along.y * f + 2.5 + Math.random() * 4 * k, vz = along.z * f + (Math.random() - 0.5) * 2.5;
      const life = 0.5 + Math.random() * 0.4;
      if (gpu) { this.gpuBits!.grit.emit(at.x, at.y + 0.05, at.z, vx, vy, vz, life, 1, 6 + Math.random() * 12, at.y); continue; }
      const g = this.gritBits[this.gritI++ % GRIT];
      g.pos.copy(at).setY(at.y + 0.05);
      g.vel.set(vx, vy, vz);
      g.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      g.age = 0; g.life = life; g.rest = false; g.landed = false;
    }
  }

  /** A round off steel: sparks mostly on along the round (a ricochet spread), a few back off the face; a little smoke. */
  private steel(at: THREE.Vector3, dir: THREE.Vector3, normal: THREE.Vector3, k: number, mul = 1) {
    const v = this.v;
    const n = Math.round(v.metalSparks * Math.min(2, k) * mul);
    // Reflect the round off the face for the ricochet cone; the rest spray back off the face.
    const refl = dir.clone().addScaledVector(normal, -2 * dir.dot(normal)).normalize();
    const sv = this.sv;
    for (let i = 0; i < n; i++) {
      const ahead = i < n * 0.7;
      const base = ahead ? refl : normal;
      const cone = ahead ? 0.5 : 1.1;
      sv.set(base.x + (Math.random() - 0.5) * cone, base.y + (Math.random() - 0.3) * cone, base.z + (Math.random() - 0.5) * cone).normalize()
        .multiplyScalar(v.metalSparkSpeed * (ahead ? 0.6 + Math.random() * 0.6 : 0.3 + Math.random() * 0.4));
      this.spark(at.x + normal.x * 0.05, at.y + normal.y * 0.05, at.z + normal.z * 0.05, sv.x, sv.y, sv.z, 0.18 + Math.random() * 0.3);
    }
    // Smoke off the steel goes to the soft dust (the battlefield), not solid balls (they read as rocks, Keith's shot).
    if (v.metalSmoke > 0) this.onSteelSmoke?.(at, normal, v.metalSmoke, k);
  }

  /**
   * Sparks off steel that no round made (robots cutting at plating): count sparks sprayed out of the face (normal,
   * unit) in a wide cone at about speed m/s, short-lived. Shares the round sparks' pool.
   */
  sparksAt(at: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number) {
    const b = this.budget;
    if (!b.admit(at.x, at.z)) return;
    count = Math.round(count * b.part(RANK.spray));
    const sv = this.sv;
    for (let i = 0; i < count; i++) {
      sv.set(normal.x + (Math.random() - 0.5) * 1.6, normal.y + (Math.random() - 0.2) * 1.4, normal.z + (Math.random() - 0.5) * 1.6).normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.spark(at.x + normal.x * 0.03, at.y + normal.y * 0.03, at.z + normal.z * 0.03, sv.x, sv.y, sv.z, 0.12 + Math.random() * 0.25);
    }
  }
  private sv = new THREE.Vector3();

  update(dt: number) {
    this.clock += dt;
    for (let i = this.landings.length - 1; i >= 0; i--) {
      const l = this.landings[i];
      if (l.t > this.clock) continue;
      this.onCasingLand?.(l.at);
      this.landings.splice(i, 1);
    }
    const gpuT = this.gpuT;
    for (const f of this.flashes) {
      f.t -= dt;
      if (f.t <= 0) { f.mesh.visible = false; if (f.light) f.light.intensity = 0; }
    }
    for (const t of this.tracers) {
      if (!t.live) continue;
      t.t += dt * this.v.tracerSpeed;
      const head = Math.min(t.t, t.dist), tail = Math.max(0, head - this.v.tracerLength);
      const dir = this.s.subVectors(t.to, t.from).normalize();
      if (t.mesh && !gpuT) {
        t.mesh.position.copy(t.from).addScaledVector(dir, head);
        t.mesh.lookAt(t.mesh.position.clone().add(dir));
        t.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
      }
      if (t.t >= t.dist) { t.live = false; if (t.mesh) t.mesh.visible = false; this.land(t.to, dir, t.surface, t.normal, t.scale, t.own); }
    }
    this.flushMerged();
    this.gpuTracers?.update(this.clock, this.v.tracerSpeed, this.v.tracerLength);
    if (this.gpuBits) this.gpuBits.sparks.uSize.value = this.v.sparkSize;
    this.stepBits(this.sparkBits, this.sparks, dt, false, false, this.v.sparkSize);
    this.stepBits(this.gritBits, this.grit, dt, false, true);
    this.stepBits(this.casingBits, this.casings, dt, true);
  }

  private stepBits(bits: Bit[], im: THREE.InstancedMesh, dt: number, bounce: boolean, tumble = false, size = 1) {
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
          if (bounce && !b.landed) { b.landed = true; this.onCasingLand?.(b.pos); }
          if (!bounce || Math.abs(b.vel.y) < 0.8) { b.rest = true; b.rot.x = Math.PI / 2 * Math.round(b.rot.x / (Math.PI / 2)); }
          else { b.vel.y *= -0.32; b.vel.x *= 0.5; b.vel.z *= 0.5; b.spin.multiplyScalar(0.5); }
        }
      }
      const k = (bounce ? 1 : 1 - b.age / b.life) * size;
      this.q.setFromEuler(b.rot);
      if (!bounce && !tumble) this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.vel.clone().normalize());
      im.setMatrixAt(i, this.m.compose(b.pos, this.q, this.s.set(k, k, k)));
    });
    im.instanceMatrix.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function bit(): Bit {
  return { pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 1, life: 0, spin: new THREE.Vector3(), rot: new THREE.Euler(), rest: true, landed: true };
}
