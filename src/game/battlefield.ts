// The shared stage every combat lab plays on: the dune field, the dust, the sand marks, the gun effects and their
// sound, steel wrecks, and everything that can be shot. One `fire` call resolves a round against all of it (the
// nearest of: a unit of another team, a steel wreck, the sand) and draws, sounds and applies it.
import * as THREE from "three/webgpu";
import type { DuneField } from "../world/terrain";
import type { DesertLook } from "../world/look";
import { rayGround } from "../world/raycast";
import type { WreckStandIns } from "../world/wrecks";
import { DustSim, type DustValues } from "../fx/dust";
import { DustDraw } from "../fx/dustDraw";
import { SandMarks, type MarkValues } from "../fx/sandMarks";
import { MinigunFx, type MinigunFxValues, type HitSurface } from "../fx/minigun";
import { Sfx, type SfxValues } from "../audio/sfx";
import { MinigunAudio } from "../audio/minigunAudio";

export type BattlefieldValues = DustValues & MarkValues & MinigunFxValues & SfxValues;

/** Anything a round can hit. */
export interface Hittable {
  team: number;
  alive: boolean;
  surface: HitSurface;
  /** Distance along the ray (unit dir) to this thing, or -1 if missed within maxDist. */
  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number;
  damage(amount: number, at: THREE.Vector3, dir: THREE.Vector3): void;
  /** The surface normal where the last hitRay struck (sparks ricochet off it); else they fly back along the round. */
  normalAt?(at: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
}

export interface FireOptions {
  /** Casing port and outboard direction (the player's miniguns throw brass; others don't). */
  eject?: THREE.Vector3;
  outboard?: THREE.Vector3;
  flashScale?: number;
  /** The player's guns use the full minigun voice; other guns a quieter gated crack; "none" is silent. */
  voice?: "player" | "other" | "none";
  /** Draw the tracer (default) or resolve the round without one (for crowds of small arms). */
  tracer?: boolean;
}

export class Battlefield {
  readonly group = new THREE.Group();
  readonly dust: DustSim;
  readonly dustDraw: DustDraw;
  readonly marks: SandMarks;
  readonly gunFx: MinigunFx;
  readonly sfx: Sfx;
  readonly gunAudio: MinigunAudio;
  readonly targets: Hittable[] = [];
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private hit = new THREE.Vector3();
  private steelAt = new THREE.Vector3();
  private steelN = new THREE.Vector3();
  private back = new THREE.Vector3();

  constructor(readonly field: DuneField, readonly v: BattlefieldValues, camera: THREE.Camera, readonly wrecks: WreckStandIns | null = null) {
    this.marks = new SandMarks(field, v);
    this.gunFx = new MinigunFx(field, v);
    this.dust = new DustSim(v, field);
    this.dustDraw = new DustDraw(this.dust, field);
    this.group.add(this.marks.group, this.gunFx.group, this.dustDraw.group);
    if (wrecks) this.group.add(wrecks.group);
    this.sfx = new Sfx(v, camera);
    this.gunAudio = new MinigunAudio(this.sfx);
    this.gunFx.onSandHit = (at, d, k) => { this.dust.hit(at.x, at.y, at.z, d.x, d.z, k); this.marks.crater(at.x, at.z, k); };
    this.gunFx.onHit = (at, surface) => this.gunAudio.hit(at, surface);
    this.gunFx.onSteelSmoke = (at, n, puffs, k) => {
      for (let i = 0; i < puffs; i++) {
        this.dust.smoke(at.x + n.x * 0.2, at.y + n.y * 0.2, at.z + n.z * 0.2, n.x * (0.6 + Math.random()), 0.6 + n.y + Math.random() * 0.5, n.z * (0.6 + Math.random()),
          0.18 * Math.sqrt(k), 0.7 + Math.random() * 0.5, 0.6, 0.85);
      }
    };
    // A round through a body: a puff of dust and cloth off it, no crater.
    this.gunFx.onFleshHit = (at, d) => {
      for (let i = 0; i < 3; i++) {
        this.dust.emit(0, at.x, at.y, at.z, d.x * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.5, d.z * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
          0.15 + Math.random() * 0.15, 0.6 + Math.random() * 0.4, 0.8);
      }
    };
    this.gunFx.onCasingLand = (at) => this.gunAudio.casing(at);
  }

  /**
   * One round from a muzzle along d (unit, spread already applied), out to range: hits the nearest unit of another
   * team, a steel wreck or the sand; draws its tracer (flash slot `slot`), plays it, and applies damage.
   * Returns what it hit (null: the sand or nothing).
   */
  fire(slot: number, team: number, muzzle: THREE.Vector3, d: THREE.Vector3, range: number, damage: number, o: FireOptions = {}): Hittable | null {
    const hit = this.hit;
    let reach = range;
    if (rayGround(muzzle, d, this.field, range, hit)) reach = muzzle.distanceTo(hit);
    else hit.copy(muzzle).addScaledVector(d, range);
    let surface: HitSurface = "sand";
    let normal: THREE.Vector3 | undefined;
    if (this.wrecks?.hit(muzzle, d, reach, this.steelAt, this.steelN)) {
      reach = muzzle.distanceTo(this.steelAt);
      hit.copy(this.steelAt); surface = "metal"; normal = this.steelN;
    }
    let struck: Hittable | null = null;
    for (const t of this.targets) {
      if (!t.alive || t.team === team) continue;
      const dist = t.hitRay(muzzle, d, reach);
      if (dist >= 0 && dist < reach) { reach = dist; struck = t; }
    }
    if (struck) {
      hit.copy(muzzle).addScaledVector(d, reach);
      surface = struck.surface;
      normal = struck.normalAt ? struck.normalAt(hit, this.back) : this.back.copy(d).negate();
      struck.damage(damage, hit, d);
    }
    if (o.tracer !== false) this.gunFx.shot(slot, muzzle, d, hit, o.eject ?? null, o.outboard ?? null, surface, normal, o.flashScale ?? 1);
    if (o.voice === "player") this.gunAudio.shot(muzzle);
    else if (o.voice !== "none") this.sfx.play("spit", muzzle, 0.55, 0.7 + Math.random() * 0.15, true);
    return struck;
  }

  /** Can a shooter at `from` see `to` (no dune in between)? For enemies deciding whether to fire. */
  canSee(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const d = this.hit.subVectors(to, from);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    // March the line against the ground; stop a little short of the target (its feet are on the sand).
    for (let t = 1.5; t < len - 1.5; t += 1.5) {
      if (from.y + d.y * t < this.field.height(from.x + d.x * t, from.z + d.z * t)) return false;
    }
    return true;
  }

  update(dt: number, camera: THREE.Camera, look: DesertLook) {
    this.sunDir.subVectors(look.sun.position, look.sun.target.position).normalize();
    this.sfx.update();
    this.marks.update(dt, this.sunDir);
    this.gunFx.update(dt);
    this.dust.update(dt);
    camera.updateMatrixWorld();
    this.dustDraw.update(camera, this.sunDir, this.v, look.sun);
  }
}
