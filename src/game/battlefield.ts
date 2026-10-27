// The shared stage every combat lab plays on: the dune field, the dust, the ground marks (dents), the gun effects and their
// sound, steel wrecks, and everything that can be shot. One `fire` call resolves a round against all of it (the
// nearest of: a unit of another team, a steel wreck, the sand) and draws, sounds and applies it.
import type { Costs } from "../core/costs";
import * as THREE from "three/webgpu";
import { Shells, type Shell } from "./shells";
import { Register } from "./register";
import { WaterFx, WATER_FX_DEFAULTS, type WaterFxValues } from "../fx/water";
import { WaterDraw } from "../fx/waterDraw";
import { ShellsDraw, SHELL_FX_DEFAULTS, type ShellFxValues } from "../fx/shellsDraw";
import type { DuneField } from "../world/terrain";
import type { DesertLook } from "../world/look";
import { rayGround } from "../world/raycast";
import type { WreckStandIns } from "../world/wrecks";
import type { CraterLayer } from "../world/craters";
import { sinkDepth, type SinkSurface, type SinkValues } from "../mech/sink";
import { DustSim, type DustValues } from "../fx/dust";
import { DustDraw } from "../fx/dustDraw";
import { GroundMarks } from "../fx/groundMarks";
import { DentLayer, DENT_DEFAULTS, type DentValues } from "../fx/dents";
import { DetailPatch } from "../world/detailPatch";
import type { TerrainStreamer } from "../world/chunks";
import { ChunkGround } from "../world/chunkGround";
import type { Ground } from "../mech/walker";
import { MinigunFx, type MinigunFxValues, type HitSurface } from "../fx/minigun";
import { Sfx, type SfxValues } from "../audio/sfx";
import { MinigunAudio } from "../audio/minigunAudio";
import { PEN_DEFAULTS, type PenValues, type PenMaterial, type Sheet, type SheetHit } from "./sheet";
import { makeSheet, resolveSheet, type SheetFire, type SheetShot } from "./sheetFire";
import { splashBlast, firstBody } from "./splash";
export type { SheetFire, SheetShot } from "./sheetFire";

export type BattlefieldValues = DustValues & MinigunFxValues & SfxValues & Partial<ShellFxValues> & Partial<DentValues> & Partial<PenValues>;

/** Anything a round can hit. */
export interface Hittable {
  team: number;
  alive: boolean;
  surface: HitSurface;
  /** Distance along the ray (unit dir) to this thing, or -1 if missed within maxDist. */
  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number;
  damage(amount: number, at: THREE.Vector3, dir: THREE.Vector3): void;
  /**
   * Swarms: damage everything of theirs within radius of a point (a round's splash, or with o.blast an explosive's
   * blast, measured to each unit's nearest part); returns how many were hit.
   */
  splash?(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3, o?: SplashOpts): number;
  /** One adapter for many units (a swarm): splash can spare the unit just struck directly (SplashOpts.spare). */
  spares?: boolean;
  /**
   * Sheet hits (src/game/sheet.ts): push every unit (and the part the line crosses) in the sheet. Targets without one
   * are tested by a fan of rays through the band (Battlefield.sheetHits).
   */
  sheet?(s: Sheet, out: SheetHit<Hittable>[]): void;
  /** Make a sheet hit's key (unit and part) the one damage, normalAt and knock act on. */
  pick?(key: number): void;
  /** What it's made of, for penetration when it has no sheet of its own (default: by surface). */
  material?: PenMaterial;
  /** The surface normal where the last hitRay struck (sparks ricochet off it); else they fly back along the round. */
  normalAt?(at: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  /** After a hit: throw what was just hit along dir at this speed (m/s), if it's light enough (the rail cannon). */
  knock?(at: THREE.Vector3, dir: THREE.Vector3, speed: number): void;
}

/** How a splash lands (src/game/splash.ts). */
export interface SplashOpts {
  /** An explosive's blast (rocket, missile, shell), not a round's splash: armoured units take it by their blast share. */
  blast?: boolean;
  /** Spare the unit the adapter's last direct hit struck (it already took the round). */
  spare?: boolean;
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
  /**
   * Resolve the round as a sheet with a penetration budget (src/game/sheet.ts) instead of a thin ray: the player's
   * direct fire. Without it (enemy small arms) a round stops on the first thing its ray meets.
   */
  sheet?: SheetFire;
  /** Splash at the impact (sand or body): radius (m) and the share of the round's damage to each swarm unit in it. */
  splash?: number;
  splashShare?: number;
}

export class Battlefield {
  readonly group = new THREE.Group();
  readonly dust: DustSim;
  readonly dustDraw: DustDraw;
  /** Every mark on the ground (prints, ruts, furrows, strikes): dents once useDents was called (none before). */
  readonly marks: GroundMarks;
  /** The dent layer and the fine ground patch that draws it (null until useDents). */
  dents: DentLayer | null = null;
  patch: DetailPatch | null = null;
  /**
   * A cheap ground for looks (the streamed chunks' own triangles, src/world/chunkGround.ts): dust and small robots'
   * legs read it. The true field until useDents gives it the streamer.
   */
  lookGround: Ground;
  readonly gunFx: MinigunFx;
  readonly sfx: Sfx;
  readonly gunAudio: MinigunAudio;
  readonly targets: Hittable[] = [];
  /** Every live thing that can be hit, seen or salvaged, on one grid (src/game/register.ts): owners add themselves;
   *  the lab rebuilds it once a tick, before the soft lock. */
  readonly register = new Register();
  /** Slow telegraphed shells (lob) and their landing marks. */
  readonly shells = new Shells();
  readonly shellsDraw: ShellsDraw;
  /** Ripples and splashes on the shallows' water (null where the ground has no water). */
  readonly water: WaterFx | null = null;
  private waterDraw: WaterDraw | null = null;
  private wsamp = { h: 0, crest: 0, flat: 0 } as import("../world/terrain").GroundSample;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** Blast craters in the ground (null: blasts leave only fine dents). Set by the lab, with onGround. */
  craters: CraterLayer | null = null;
  /** Called with a box whose ground changed (rebuild the chunks and the physics floor there). */
  onGround: ((x0: number, z0: number, x1: number, z1: number) => void) | null = null;
  private hit = new THREE.Vector3();
  private steelAt = new THREE.Vector3();
  private steelN = new THREE.Vector3();
  private back = new THREE.Vector3();
  private pt = new THREE.Vector3();

  constructor(readonly field: DuneField, readonly v: BattlefieldValues, camera: THREE.Camera, readonly wrecks: WreckStandIns | null = null) {
    // Labs that don't list the dent or penetration sliders still get their defaults.
    const dv = v as BattlefieldValues & Record<string, unknown>;
    for (const [k, val] of Object.entries(DENT_DEFAULTS)) if (!(k in dv)) dv[k] = val;
    for (const [k, val] of Object.entries(PEN_DEFAULTS)) if (!(k in dv)) dv[k] = val;
    this.lookGround = field;
    this.marks = new GroundMarks(field, v as BattlefieldValues & DentValues);
    this.gunFx = new MinigunFx(field, v);
    this.dust = new DustSim(v, field);
    // Biomes: rock and water throw no dust, rocky sand less (the ground knows what it's made of).
    if (field.biomes) this.dust.surfaceAt = (x, z) => field.surfaceAt(x, z);
    if (field.waterLevel !== null) {
      const sv0 = v as BattlefieldValues & Record<string, unknown>;
      for (const [k, val] of Object.entries(WATER_FX_DEFAULTS)) if (!(k in sv0)) sv0[k] = val;
      this.water = new WaterFx(v as unknown as WaterFxValues, field.waterLevel);
      this.waterDraw = new WaterDraw(this.water);
      this.group.add(this.waterDraw.group);
    }
    this.dustDraw = new DustDraw(this.dust, field);
    // Labs that don't list the telegraph sliders still get their defaults.
    const sv = v as BattlefieldValues & Record<string, unknown>;
    for (const [k, val] of Object.entries(SHELL_FX_DEFAULTS)) if (!(k in sv)) sv[k] = val;
    this.shellsDraw = new ShellsDraw(this.shells, field, v as unknown as ShellFxValues);
    this.group.add(this.gunFx.group, this.dustDraw.group, this.shellsDraw.group);
    if (wrecks) this.group.add(wrecks.group);
    this.sfx = new Sfx(v, camera);
    this.gunAudio = new MinigunAudio(this.sfx);
    this.gunFx.onSandHit = (at, d, k) => {
      // Into water: a spray of drops and rings instead of dust and a crater.
      if (this.inWater(at.x, at.z)) { this.water!.splash(at.x, at.z, 0.35 + k * 0.5, d.x * 0.4, d.z * 0.4, 1.4); return; }
      this.dust.hit(at.x, at.y, at.z, d.x, d.z, k); if (k >= this.v.hitDust * 0.6) this.marks.crater(at.x, at.z, k);
    };
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
    if (o.sheet) return this.fireSheet(slot, team, muzzle, d, range, damage, o, o.sheet);
    // The round: the nearest unit of another team its ray meets.
    let struck: Hittable | null = null;
    let near: Hittable | null = null, nearD = reach;
    for (const t of this.targets) {
      if (!t.alive || t.team === team) continue;
      const dist = t.hitRay(muzzle, d, nearD);
      if (dist >= 0 && dist < nearD) { nearD = dist; near = t; }
    }
    if (near) {
      // Re-run the winner's ray so its own "last hit" is this one (each adapter remembers only its own nearest).
      near.hitRay(muzzle, d, nearD + 1e-3);
      this.pt.copy(muzzle).addScaledVector(d, nearD);
      near.damage(damage, this.pt, d);
      struck = near;
      reach = nearD;
      hit.copy(this.pt);
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

  /** A direct-fire sheet from a muzzle (src/game/sheetFire.ts). */
  makeSheet(muzzle: THREE.Vector3, d: THREE.Vector3, range: number, f: SheetFire): Sheet {
    return makeSheet(this.field, muzzle, d, range, f, this.v as BattlefieldValues & PenValues);
  }

  /** Resolve a sheet against every target and the steel wrecks, applying damage (or only predicting, apply false). */
  resolveSheet(team: number, s: Sheet, damage: number, f: SheetFire, dir: THREE.Vector3, apply = true, skip?: (h: SheetHit<Hittable>) => boolean): SheetShot {
    return resolveSheet(this.field, this.targets, this.wrecks, team, s, damage, f, dir, this.v as BattlefieldValues & PenValues, apply, skip, this.register);
  }

  /** fire() for a sheet round: resolve it, then draw the tracer to where it ended and sparks where it went through. */
  private fireSheet(slot: number, team: number, muzzle: THREE.Vector3, d: THREE.Vector3, range: number, damage: number, o: FireOptions, f: SheetFire): Hittable | null {
    const sheet = this.makeSheet(muzzle, d, range, f);
    const shot = this.resolveSheet(team, sheet, damage, f, d);
    for (const x of shot.exits) this.gunFx.sparksAt(x, d, 3, 6);
    const last = shot.result.steps[shot.result.steps.length - 1];
    const struck = last?.stopped ? last.hit.target : null;
    const hit = this.hit.copy(shot.end);
    const normal = struck?.normalAt ? struck.normalAt(hit, this.back) : this.back.copy(d).negate();
    if (o.splash && o.splashShare) {
      for (const t of this.targets) if (t.alive && t.team !== team && t.splash) t.splash(hit, o.splash, damage * o.splashShare, d);
    }
    const dir = this.pt.copy(hit).sub(muzzle).normalize();
    if (o.tracer !== false) this.gunFx.shot(slot, muzzle, dir, hit, o.eject ?? null, o.outboard ?? null, shot.surface, normal, o.flashScale ?? 1, o.hitScale ?? 1);
    if (o.voice === "player") this.gunAudio.shot(muzzle);
    else if (o.voice !== "none") this.sfx.play("spit", muzzle, 0.55, 0.7 + Math.random() * 0.15, true);
    return struck;
  }

  /**
   * Draw ground marks as dents (Keith 2026-10-25): a GPU dent layer around the camera focus and the fine patch of
   * ground that shows them (the chunks leave it a hole). Needs the renderer, so headless stages skip it (no marks).
   */
  useDents(renderer: THREE.WebGPURenderer, streamer: TerrainStreamer) {
    const v = this.v as BattlefieldValues & DentValues;
    this.dents = new DentLayer(renderer, this.field, v);
    this.patch = new DetailPatch(this.field, streamer, this.dents, v);
    this.marks.dents = this.dents;
    this.group.add(this.patch.group);
    // Perf pass 1: what only draws reads the chunks' triangles instead of the full height function.
    this.lookGround = new ChunkGround(streamer, this.field);
    this.dust.ground = this.lookGround;
    this.dustDraw.ground = this.lookGround;
    return this.dents;
  }

  /**
   * How far a planted foot sinks into the ground here (m; src/mech/sink.ts, Keith 2026-10-26 21:54): by the surface and
   * the crater layer's hardness, deterministic (the walkers plant their feet this deep). sinkSurface: a lab can pretend
   * the ground is another surface (?surface=snow).
   */
  sinkSurface: ((x: number, z: number) => SinkSurface) | null = null;
  sinkDepth(x: number, z: number) {
    const s = this.sinkSurface ? this.sinkSurface(x, z) : this.field.surfaceAt(x, z);
    const hard = (this.field.dents as { hardness?: (x: number, z: number) => number } | null)?.hardness?.(x, z) ?? 0;
    return sinkDepth(this.v as Partial<SinkValues>, s, hard);
  }

  /** Is (x, z) under the shallows' water (deep enough to splash)? */
  inWater(x: number, z: number, depth = 0.04): boolean {
    if (!this.water) return false;
    const s = this.field.sample(x, z, this.wsamp);
    return (s.ws ?? 0) > 0.3 && s.h < this.water.level - depth;
  }

  /**
   * Lob a telegraphed shell from `from` to land on the ground at (x, z) after `flight` seconds, bursting with `radius`
   * and `damage` (falling off to half at the edge) on everything of another team. The landing ring shows at once.
   * y: land up there instead (a tall body's centre: the ring stays on the sand under it).
   */
  lob(team: number, from: THREE.Vector3, x: number, z: number, flight: number, arc: number, radius: number, damage: number, y?: number): Shell {
    const to = this.hit.set(x, y ?? this.field.height(x, z), z);
    this.sfx.play("brap", from, 1.3, 0.45, false);
    return this.shells.lob(team, from, to, flight, arc, radius, damage);
  }

  /**
   * Dent the ground with a blast of this radius at (x, z): a real crater in the height function (sized by the crater
   * sliders, less on hard ground, none on protected ground), and the chunks follow. Returns whether it dented.
   */
  /** Craters waiting to be dug (blasts queue them; update digs them within a time budget per frame). */
  readonly dentQueue: { x: number; z: number; r: number }[] = [];
  /** What digging costs: last frame's ms and dents, the worst frame's ms, the queue, merges so far. */
  readonly dentStats = { frameMs: 0, frameDents: 0, worstMs: 0, lastMs: 0, merged: 0, dug: 0 };

  /** Queue a crater; one close to a queued one (dentMerge × the bigger radius) joins it instead. */
  queueDent(x: number, z: number, r: number) {
    if (!this.craters) return;
    const merge = (this.v as { dentMerge?: number }).dentMerge ?? 0.6;
    for (const d of this.dentQueue) {
      if (Math.hypot(d.x - x, d.z - z) < merge * Math.max(d.r, r)) {
        const w = r / (r + d.r);
        d.x += (x - d.x) * w; d.z += (z - d.z) * w; d.r = Math.max(d.r, r);
        this.dentStats.merged++;
        return;
      }
    }
    this.dentQueue.push({ x, z, r });
  }

  /** Dig queued craters until this frame's budget (ms) is spent; at least one per frame. */
  private digQueued() {
    const budget = (this.v as { dentBudget?: number }).dentBudget ?? 6;
    const t0 = performance.now();
    let n = 0;
    while (this.dentQueue.length) {
      const d = this.dentQueue.shift()!;
      const t1 = performance.now();
      this.dent(d.x, d.z, d.r);
      this.dentStats.lastMs = performance.now() - t1;
      n++; this.dentStats.dug++;
      if (performance.now() - t0 >= budget) break;
    }
    const ms = performance.now() - t0;
    this.dentStats.frameMs = ms; this.dentStats.frameDents = n;
    this.dentStats.worstMs = Math.max(this.dentStats.worstMs * 0.995, ms);
  }

  dent(x: number, z: number, blastRadius: number): boolean {
    if (!this.craters) return false;
    const box = this.craters.blast(x, z, blastRadius);
    if (box) this.onGround?.(box[0], box[1], box[2], box[3]);
    return !!box;
  }

  /** A shell bursts where it is: its landing point, or a body it came down on (shellHit). */
  private burst(s: Shell) { this.blast(s.team, s.pos, s.radius, s.damage); }
  /** Shells go off on the first body of another team in their path (a tall robot's chassis or legs). */
  private shellHit = (s: Shell, a: THREE.Vector3, b: THREE.Vector3) => { const h = firstBody(this.targets, s.team, a, b); return h ? h.f : -1; };

  /** Called with every blast (where, how big), e.g. for camera shake in a lab. */
  onBlast: ((at: THREE.Vector3, radius: number) => void) | null = null;

  /**
   * A blast on the ground at p (its y is moved onto the new ground): the crater, dust and debris, the sound, and
   * damage through splash() to everything of another team within radius (full at the centre, half at the edge).
   * Shells burst through here; the player's rockets and mortar shells too (src/weapons).
   */
  blast(team: number, p: THREE.Vector3, radius: number, damage: number) {
    const s = { team, radius, damage };
    const k = Math.max(0.5, s.radius / 3);
    this.onBlast?.(p, radius);
    // The blast digs into the ground first (the floor under the water too), so marks and dust sit on the new ground.
    // An air burst (on a tall robot's chassis or legs) doesn't dig or mark the ground (blastGroundReach × radius up).
    const low = p.y - this.field.height(p.x, p.z) < s.radius * ((this.v as { blastGroundReach?: number }).blastGroundReach ?? 0.5);
    const wet = low && this.inWater(p.x, p.z);
    // The crater is queued (a 12-missile swarm would stall a frame digging them all at once); the effects play now.
    if (low) this.queueDent(p.x, p.z, s.radius);
    if (wet) {
      this.water!.splash(p.x, p.z, 2.5 * k, 0, 0, 2);
      for (let r = 0; r < 3; r++) this.water!.ripple(p.x, p.z, 1, 1.5 + r * 0.6);
      this.sfx.play("brap", p, 1.6, 0.5, false);
      splashBlast(this.targets, s.team, p, s.radius, s.damage, this.back.set(0, -1, 0));
      return;
    }
    for (let i = 0; i < 18 * k; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6 * k;
      this.dust.emit(1, p.x, p.y + Math.random() * 0.5, p.z, Math.cos(a) * sp, 2 + Math.random() * 5 * k, Math.sin(a) * sp, 0.5 + Math.random() * 0.7, 2.5 + Math.random() * 3, 0.9);
    }
    for (let i = 0; i < 20 * k; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      this.dust.emit(2, p.x, p.y, p.z, Math.cos(a) * sp, 4 + Math.random() * 8, Math.sin(a) * sp, 0.15, 0.5 + Math.random() * 0.5, 0.95);
    }
    if (low) { this.dust.stomp(p.x, p.y, p.z, 1.6 * k); this.marks.blast(p.x, p.z, s.radius); }
    this.sfx.play("brap", p, 1.8, 0.4, false);
    splashBlast(this.targets, s.team, p, s.radius, s.damage, this.back.set(0, -1, 0));
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

  /** A lab's per-stage timer (src/core/costs.ts): when set, update() splits its time into dents, gun fx, dust. */
  costs: Costs | null = null;

  update(dt: number, camera: THREE.Camera, look: DesertLook) {
    this.sunDir.subVectors(look.sun.position, look.sun.target.position).normalize();
    const c = this.costs;
    this.sfx.update();
    if (this.dents && this.patch) {
      // The dents and the patch follow the camera focus (the sun's shadow box is centred on it).
      const f = look.sun.target.position;
      this.dents.update(dt, f.x, f.z);
      this.patch.update(f.x, f.z, true);
    }
    c?.mark("ground dents");
    this.shells.update(dt, (s) => this.burst(s), this.shellHit);
    this.digQueued();
    c?.mark("dents");
    for (const s of this.shells.list) if (s.live && Math.random() < dt * 30) this.dust.smoke(s.pos.x, s.pos.y, s.pos.z, 0, 0.3, 0, 0.25, 1.2, 0.5, 0.8);
    this.shellsDraw.update();
    if (this.water) { this.water.level = this.field.waterLevel ?? this.water.level; this.water.update(dt); this.waterDraw!.update(); }
    this.gunFx.update(dt);
    c?.mark("gun fx");
    this.dust.update(dt);
    camera.updateMatrixWorld();
    this.dustDraw.update(camera, this.sunDir, this.v, look.sun);
    c?.mark("dust");
  }
}
