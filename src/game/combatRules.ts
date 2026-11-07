// The battlefield's rules, apart from its looks (docs/architecture-review.md stage 3: "damage as data"). What a blast,
// a lobbed shell or a crater *does* lives here: damage through splash, cover, the shells in flight, the craters dug into
// the ground, line of sight, the solids and the register. What it *looks and sounds like* stays in Battlefield, which
// plays each event this writes (dust, marks, water, blast waves, lights, sound).
//
// Pure of drawing: no scene, no FX, no audio (tools/combatrules-check.ts walks the imports and fails on any). It uses
// three's maths classes only, which run in a worker or in Node. So a host (the sim worker, a co-op host, a server) can run
// it alone and send its events; a view plays them.
//
// Deterministic: no Math.random, and crater digging is capped by count per tick (`dentPerTick`), not by wall-clock time,
// so the ground comes out the same on every machine.
// Ownership: host (damage, shells, craters, the ground). Events are plain data (rule 12).
import * as THREE from "three/webgpu";
import { Shells, type Shell } from "./shells";
import { Register } from "./register";
import { Solids } from "./solids";
import { splashBlast, firstBody, blastCover } from "./splash";
import { Shots } from "./shots";
import { Burns } from "./burn";
import { Chills } from "./chill";
import { FirePools } from "./firePools";
import type { Hittable } from "./battlefield";
import type { DuneField } from "../world/terrain";
import type { WreckStandIns } from "../world/wrecks";
import type { CraterLayer } from "../world/craters";
import type { WaveKind } from "../fx/blastWaves";

/** A blast went off (rule 12: plain data). low: near enough the ground to dig and mark it; wet: in the shallows. */
export interface BlastEvent { type: "blast"; team: number; x: number; y: number; z: number; radius: number; damage: number; kind: WaveKind; low: boolean; wet: boolean }
/** A shell was lobbed from (x, y, z), to burst with this radius. */
export interface LobEvent { type: "lob"; team: number; x: number; y: number; z: number; radius: number }
/** Something froze solid at (x, y, z) (the freeze ray). */
export interface FreezeEvent { type: "freeze"; x: number; y: number; z: number }
export type CombatEvent = BlastEvent | LobEvent | FreezeEvent;

export interface CombatRuleValues { blastGroundReach?: number; blastCover?: number; dentMerge?: number; dentPerTick?: number }

export class CombatRules {
  /** Everything that can be shot (adapters; the ECS replaces them in stages 4-5). */
  readonly targets: Hittable[] = [];
  /** Every live thing that can be hit, seen or salvaged, on one grid (src/game/register.ts). */
  readonly register = new Register();
  /** Mechs and vehicles as solid bodies (src/game/solids.ts). */
  readonly solids = new Solids();
  /** Slow telegraphed shells in flight. */
  readonly shells = new Shells();
  /** Blast craters in the ground (null: blasts leave only fine dents). */
  craters: CraterLayer | null = null;
  /** Called with a box whose ground changed (rebuild the chunks and the physics floor there). */
  onGround: ((x0: number, z0: number, x1: number, z1: number) => void) | null = null;
  /** The shallows' water level here, or null where there is no water (set by whoever knows it). */
  waterLevel: (() => number | null) | null = null;
  /** Every round in flight this tick, as data (src/game/shots.ts): resolved in step, damage as each hit is made;
   *  its draws (tracer, flash, impact) are left in shots.draws for the view to play. */
  readonly shots: Shots;
  /** Targets set burning (damage over time, heat), chilled and frozen ones, burning pools on the ground. The view
   *  reads their lists to draw flames, glow, frost and mist. */
  readonly burns: Burns;
  readonly chills: Chills;
  readonly pools: FirePools;
  /** What happened since the last drain: blasts, lobs (plain data). The view plays them; a host would send them. */
  readonly events: CombatEvent[] = [];
  /** Craters waiting to be dug (blasts queue them; step digs up to dentPerTick a tick). */
  readonly dentQueue: { x: number; z: number; r: number }[] = [];
  /** What digging costs: last tick's ms and dents, the worst tick's ms, the last dent's ms, merges and dents so far. */
  readonly dentStats = { frameMs: 0, frameDents: 0, worstMs: 0, lastMs: 0, merged: 0, dug: 0 };

  private back = new THREE.Vector3();
  private seg = new THREE.Vector3();
  private wsamp = { h: 0, crest: 0, flat: 0 } as import("../world/terrain").GroundSample;

  constructor(readonly field: DuneField, readonly v: CombatRuleValues, readonly wrecks: WreckStandIns | null = null) {
    this.burns = new Burns(v as never);
    this.chills = new Chills(v as never);
    this.chills.heatAt = (t, k) => this.burns.heatAtKey(t, k);
    this.chills.quench = (t, k) => this.burns.quench(t, k);
    this.chills.onFreeze = (c) => this.events.push({ type: "freeze", x: c.x, y: c.y, z: c.z });
    this.burns.onIgnite = (t, k) => this.chills.thaw(t, k);
    this.pools = new FirePools(field, this.targets, this.burns, v as never, this.register);
    this.shots = new Shots({ field, targets: this.targets, wrecks, register: this.register, v: v as never,
      ignite: (t, k, time, dps, x, y, z, cold, dx, dz) => cold ? this.chills.hit(t, k, time, dps, x, y, z, dx, dz) : this.burns.ignite(t, k, time, dps, x, y, z, dx, dz) });
  }

  /**
   * One tick of the rules, in this order: solids; shells in flight (bursting where they land or hit a body); craters
   * dug; shots resolved; burning, burning pools and chill stepped (damage over time, ignition, slowing, freezing).
   */
  step(dt: number) {
    this.solids.tick(dt);
    this.shells.update(dt, (s) => this.burst(s), this.shellHit);
    this.digQueued();
    this.shots.step(dt);
    if (this.burns.list.length) this.burns.step(dt);
    if (this.pools.list.length) this.pools.step(dt);
    if (this.chills.list.length) this.chills.step(dt);
  }

  /** Is (x, z) under the shallows' water (deep enough to splash)? */
  inWater(x: number, z: number, depth = 0.04): boolean {
    const level = this.waterLevel?.();
    if (level === null || level === undefined) return false;
    const s = this.field.sample(x, z, this.wsamp);
    return (s.ws ?? 0) > 0.3 && s.h < level - depth;
  }

  /**
   * A blast at p: damage through splash to everything of another team within radius (full at the centre, half at the
   * edge, with cover), and a crater queued when it is low enough to dig. Writes a blast event and returns it.
   */
  blast(team: number, p: THREE.Vector3, radius: number, damage: number, pierce?: number, kind: WaveKind = "default"): BlastEvent {
    // An air burst (on a tall robot's chassis or legs) doesn't dig or mark the ground (blastGroundReach × radius up).
    const low = p.y - this.field.height(p.x, p.z) < radius * (this.v.blastGroundReach ?? 0.5);
    const wet = low && this.inWater(p.x, p.z);
    const ev: BlastEvent = { type: "blast", team, x: p.x, y: p.y, z: p.z, radius, damage, kind, low, wet };
    this.events.push(ev);
    // The crater is queued (a 12-missile swarm would stall a tick digging them all at once).
    if (low) this.queueDent(p.x, p.z, radius);
    splashBlast(this.targets, team, p, radius, damage, this.back.set(0, -1, 0), null, pierce, this.cover(p));
    return ev;
  }

  /**
   * A blast that hurts the given team's own units (a strider's death clears the robots round it): every target of
   * `team` in reach takes its blast share as an explosive's, with cover; no event (the caller's blast has one).
   */
  blastOwn(team: number, p: THREE.Vector3, radius: number, damage: number, pierce?: number): number {
    if (damage <= 0) return 0;
    const cover = this.cover(p), dir = this.back.set(0, -1, 0);
    let n = 0;
    for (const t of this.targets) if (t.alive && t.team === team && t.splash) n += t.splash(p, radius, damage, dir, { blast: true, pierce, cover });
    return n;
  }

  /** Lob a telegraphed shell from `from` to land at `to` after `flight` seconds (see Battlefield.lob). */
  lob(team: number, from: THREE.Vector3, to: THREE.Vector3, flight: number, arc: number, radius: number, damage: number): Shell {
    this.events.push({ type: "lob", team, x: from.x, y: from.y, z: from.z, radius });
    return this.shells.lob(team, from, to, flight, arc, radius, damage);
  }

  /** Queue a crater; one close to a queued one (dentMerge × the bigger radius) joins it instead. */
  queueDent(x: number, z: number, r: number) {
    if (!this.craters) return;
    const merge = this.v.dentMerge ?? 0.6;
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

  /** Dent the ground with a blast of this radius at (x, z) (sized by the crater sliders); whether it dented. */
  dent(x: number, z: number, blastRadius: number): boolean {
    if (!this.craters) return false;
    const box = this.craters.blast(x, z, blastRadius);
    if (box) this.onGround?.(box[0], box[1], box[2], box[3]);
    return !!box;
  }

  /** A crater of its own size, past the usual depth limit (a dying walker's core). */
  crater(x: number, z: number, radius: number, depth: number): boolean {
    if (!this.craters) return false;
    const box = this.craters.add(x, z, radius, depth, depth);
    if (box) this.onGround?.(box[0], box[1], box[2], box[3]);
    return !!box;
  }

  /** Can a shooter at `from` see `to` (no dune in between)? */
  canSee(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const d = this.seg.subVectors(to, from);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    // March the line against the ground; stop a little short of the target (its feet are on the sand).
    for (let t = 1.5; t < len - 1.5; t += 1.5) {
      if (from.y + d.y * t < this.field.height(from.x + d.x * t, from.z + d.z * t)) return false;
    }
    return true;
  }

  /** A shell bursts where it is: its landing point, or a body it came down on. */
  private burst(s: Shell) { this.blast(s.team, s.pos, s.radius, s.damage, s.pierce, s.wave ?? (s.team === 3 ? "volley" : s.team === 2 ? "turret" : "mortar")); }
  /** Shells go off on the first body of another team in their path (a tall robot's chassis or legs). */
  private shellHit = (s: Shell, a: THREE.Vector3, b: THREE.Vector3) => { const h = firstBody(this.targets, s.team, a, b); return h ? h.f : -1; };

  /** Dig queued craters, up to dentPerTick this tick (a count, not a time budget, so every machine digs the same). */
  private digQueued() {
    const most = Math.max(1, Math.round(this.v.dentPerTick ?? 4));
    const t0 = performance.now();
    let n = 0;
    while (this.dentQueue.length && n < most) {
      const d = this.dentQueue.shift()!;
      const t1 = performance.now();
      this.dent(d.x, d.z, d.r);
      this.dentStats.lastMs = performance.now() - t1;
      n++; this.dentStats.dug++;
    }
    const ms = performance.now() - t0;
    this.dentStats.frameMs = ms; this.dentStats.frameDents = n;
    this.dentStats.worstMs = Math.max(this.dentStats.worstMs * 0.995, ms);
  }

  /** A blast's cover test at p (dunes, walls and steel wrecks between it and a unit shield the unit). */
  private steelAt = new THREE.Vector3();
  private steelN = new THREE.Vector3();
  private steelRay = (o: THREE.Vector3, d: THREE.Vector3, max: number) => (this.wrecks!.hit(o, d, max, this.steelAt, this.steelN) ? o.distanceTo(this.steelAt) : -1);
  private cover(p: THREE.Vector3) {
    if ((this.v.blastCover ?? 1) < 0.5) return undefined;
    return blastCover(this.field, this.wrecks ? this.steelRay : null, p);
  }
}
