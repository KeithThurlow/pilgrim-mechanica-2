// The shared stage every combat lab plays on: the dune field, the dust, the sand marks, the gun effects and their
// sound, steel wrecks, and everything that can be shot. One `fire` call resolves a round against all of it (the
// nearest of: a unit of another team, a steel wreck, the sand) and draws, sounds and applies it.
import * as THREE from "three/webgpu";
import { Shells, type Shell } from "./shells";
import { ShellsDraw, SHELL_FX_DEFAULTS, type ShellFxValues } from "../fx/shellsDraw";
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

export type BattlefieldValues = DustValues & MarkValues & MinigunFxValues & SfxValues & Partial<ShellFxValues>;

/** Anything a round can hit. */
export interface Hittable {
  team: number;
  alive: boolean;
  surface: HitSurface;
  /** Distance along the ray (unit dir) to this thing, or -1 if missed within maxDist. */
  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number;
  damage(amount: number, at: THREE.Vector3, dir: THREE.Vector3): void;
  /** Swarms: damage everything of theirs within radius of a point (a round's splash); returns how many were hit. */
  splash?(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3): number;
  /** After a hit: can a round carry on through what it just hit (light bodies), or does it stop there? */
  canPierce?(): boolean;
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
  /** Size of the impact effects (1 the minigun; small arms about 0.35: few small sparks, little dust, no crater). */
  hitScale?: number;
  /** How many light bodies (bandits, small robots) a round carries on through, each pass at piercing falloff. */
  pierce?: number;
  /** Splash at the impact (sand or body): radius (m) and the share of the round's damage to each swarm unit in it. */
  splash?: number;
  splashShare?: number;
  /** Damage kept after each body a round pierces. */
  pierceFalloff?: number;
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
  /** Slow telegraphed shells (lob) and their landing marks. */
  readonly shells = new Shells();
  readonly shellsDraw: ShellsDraw;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private hit = new THREE.Vector3();
  private steelAt = new THREE.Vector3();
  private steelN = new THREE.Vector3();
  private back = new THREE.Vector3();
  private from = new THREE.Vector3();
  private pt = new THREE.Vector3();

  constructor(readonly field: DuneField, readonly v: BattlefieldValues, camera: THREE.Camera, readonly wrecks: WreckStandIns | null = null) {
    this.marks = new SandMarks(field, v);
    this.gunFx = new MinigunFx(field, v);
    this.dust = new DustSim(v, field);
    this.dustDraw = new DustDraw(this.dust, field);
    // Labs that don't list the telegraph sliders still get their defaults.
    const sv = v as BattlefieldValues & Record<string, unknown>;
    for (const [k, val] of Object.entries(SHELL_FX_DEFAULTS)) if (!(k in sv)) sv[k] = val;
    this.shellsDraw = new ShellsDraw(this.shells, field, v as unknown as ShellFxValues);
    this.group.add(this.marks.group, this.gunFx.group, this.dustDraw.group, this.shellsDraw.group);
    if (wrecks) this.group.add(wrecks.group);
    this.sfx = new Sfx(v, camera);
    this.gunAudio = new MinigunAudio(this.sfx);
    this.gunFx.onSandHit = (at, d, k) => { this.dust.hit(at.x, at.y, at.z, d.x, d.z, k); if (k >= this.v.hitDust * 0.6) this.marks.crater(at.x, at.z, k); };
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
    // The round: nearest unit of another team; light bodies let it carry on through (pierce), losing some punch each.
    let struck: Hittable | null = null;
    const from = this.from.copy(muzzle);
    let base = 0, dmg = damage, passes = o.pierce ?? 0;
    for (;;) {
      let near: Hittable | null = null, nearD = reach - base;
      for (const t of this.targets) {
        if (!t.alive || t.team === team) continue;
        const dist = t.hitRay(from, d, nearD);
        if (dist >= 0 && dist < nearD) { nearD = dist; near = t; }
      }
      if (!near) break;
      // Re-run the winner's ray so its own "last hit" is this one (later targets in the loop may have overwritten nothing,
      // but each adapter remembers only its own nearest).
      near.hitRay(from, d, nearD + 1e-3);
      this.pt.copy(from).addScaledVector(d, nearD);
      near.damage(dmg, this.pt, d);
      if (passes > 0 && near.canPierce?.()) {
        // Through and out: the body still shows the hit (a puff, or a few sparks off a small robot).
        if (near.surface === "flesh") this.gunFx.onFleshHit?.(this.pt, d);
        else if (near.surface === "metal") this.gunFx.sparksAt(this.pt, this.back.copy(d).negate(), 3, 6);
        passes--;
        dmg *= o.pierceFalloff ?? 0.7;
        base += nearD + 0.9;
        from.copy(this.pt).addScaledVector(d, 0.9);
        if (base >= reach) break;
        continue;
      }
      struck = near;
      reach = base + nearD;
      hit.copy(this.pt);
      break;
    }
    if (struck) {
      surface = struck.surface;
      normal = struck.normalAt ? struck.normalAt(hit, this.back) : this.back.copy(d).negate();
    }
    // Splash: everything of theirs near where the round ends (the sand at their feet, or the body it stopped in).
    if (o.splash && o.splashShare) {
      for (const t of this.targets) if (t.alive && t.team !== team && t.splash) t.splash(hit, o.splash, damage * o.splashShare, d);
    }
    if (o.tracer !== false) this.gunFx.shot(slot, muzzle, d, hit, o.eject ?? null, o.outboard ?? null, surface, normal, o.flashScale ?? 1, o.hitScale ?? 1);
    if (o.voice === "player") this.gunAudio.shot(muzzle);
    else if (o.voice !== "none") this.sfx.play("spit", muzzle, 0.55, 0.7 + Math.random() * 0.15, true);
    return struck;
  }

  /**
   * Lob a telegraphed shell from `from` to land on the ground at (x, z) after `flight` seconds, bursting with `radius`
   * and `damage` (falling off to half at the edge) on everything of another team. The landing ring shows at once.
   */
  lob(team: number, from: THREE.Vector3, x: number, z: number, flight: number, arc: number, radius: number, damage: number): Shell {
    const to = this.hit.set(x, this.field.height(x, z), z);
    this.sfx.play("brap", from, 1.3, 0.45, false);
    return this.shells.lob(team, from, to, flight, arc, radius, damage);
  }

  private burst(s: Shell) {
    const p = s.to, k = Math.max(0.5, s.radius / 3);
    for (let i = 0; i < 18 * k; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6 * k;
      this.dust.emit(1, p.x, p.y + Math.random() * 0.5, p.z, Math.cos(a) * sp, 2 + Math.random() * 5 * k, Math.sin(a) * sp, 0.5 + Math.random() * 0.7, 2.5 + Math.random() * 3, 0.9);
    }
    for (let i = 0; i < 20 * k; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      this.dust.emit(2, p.x, p.y, p.z, Math.cos(a) * sp, 4 + Math.random() * 8, Math.sin(a) * sp, 0.15, 0.5 + Math.random() * 0.5, 0.95);
    }
    this.dust.stomp(p.x, p.y, p.z, 1.6 * k);
    this.marks.crater(p.x, p.z, 4 * k);
    this.sfx.play("brap", p, 1.8, 0.4, false);
    const down = this.back.set(0, -1, 0);
    for (const t of this.targets) if (t.alive && t.team !== s.team && t.splash) t.splash(p, s.radius, s.damage, down);
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
    this.shells.update(dt, (s) => this.burst(s));
    for (const s of this.shells.list) if (s.live && Math.random() < dt * 30) this.dust.smoke(s.pos.x, s.pos.y, s.pos.z, 0, 0.3, 0, 0.25, 1.2, 0.5, 0.8);
    this.shellsDraw.update();
    this.gunFx.update(dt);
    this.dust.update(dt);
    camera.updateMatrixWorld();
    this.dustDraw.update(camera, this.sunDir, this.v, look.sun);
  }
}
