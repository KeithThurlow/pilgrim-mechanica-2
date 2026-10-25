// Swarm camps on the sand (glue): the camps of src/expedition/camps.ts brought to life as the robot swarm
// (src/combat/robots.ts), one swarm for every camp so only one drawer. A camp streams in within campSpawn of the mech
// with the robots it still has (kills are remembered), asleep: frozen where they stand. It wakes when the mech comes
// within campWake, when stripping noise reaches it, or when one of them is shot; awake, its robots come for the mech
// with everything the robot lab has (leaps, clinging, saws, slugs, lobbed charges). It gives up (freezes again where
// it is) once the mech is aboard, dead, or campGiveUp away; clingers are shaken off first. Past campDrop the camp
// streams out and its survivors go back into the count.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import { RobotSwarm, DEAD, DOWN, LATCHED, BIG, MID, SMALL, isAirborne, robotCentre, type RobotValues } from "../combat/robots";
import { RobotsDraw } from "../combat/robotsDraw";
import { RobotTarget } from "../combat/robotTarget";
import { RobotTearFx, type RobotTearValues } from "../combat/robotTearFx";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { CampField, Camp } from "./camps";
import type { Prey } from "../pilot/quarry";

export const SWARM_CAMP_DEFAULTS = { campWake: 130, campGiveUp: 320, campSpawn: 650, campDrop: 950, campHear: 1 };
export type SwarmCampValues = typeof SWARM_CAMP_DEFAULTS;
const G = "Swarm camps: behaviour";
export const SWARM_CAMP_PARAMS: Param[] = [
  { key: "campWake", label: "Wake within (m)", min: 10, max: 500, step: 5, group: G, tip: "A sleeping camp comes for the mech when it gets this close" },
  { key: "campHear", label: "Hears stripping (× noise radius)", min: 0, max: 3, step: 0.05, group: G, tip: "Salvage noise wakes camps inside its radius times this" },
  { key: "campGiveUp", label: "Give up past (m)", min: 50, max: 1000, step: 10, group: G, tip: "Awake robots stop where they are when the mech is this far from them (or aboard)" },
  { key: "campSpawn", label: "Stream in within (m)", min: 200, max: 2000, step: 10, group: G },
  { key: "campDrop", label: "Stream out past (m)", min: 300, max: 3000, step: 10, group: G },
];

/** A streamed camp: its robots' slots, each with the slot's spawn count then (a slot freed and reused is no longer its). */
interface Live { camp: Camp; slots: number[]; gens: number[]; awake: boolean; hp: number }
export interface SwarmBlob { id: string; x: number; z: number; guess: number; awake: boolean }

export class SwarmCamps {
  readonly sw: RobotSwarm;
  readonly draw: RobotsDraw;
  readonly target: RobotTarget;
  private tear: RobotTearFx;
  private live = new Map<string, Live>();
  /** Robots each camp still has after a visit. */
  private left = new Map<string, number>();
  private near: Camp[] = [];
  private slot = 2;
  private from = new THREE.Vector3(); private dir = new THREE.Vector3(); private bite = new THREE.Vector3();
  private lobFrom = new THREE.Vector3(); private up = new THREE.Vector3(0, -1, 0);

  constructor(
    readonly v: SwarmCampValues & RobotValues & RobotTearValues, field: DuneField, private bf: Battlefield, scene: THREE.Scene,
    readonly camps: CampField, private player: MechUnit,
    /** True where a camp shouldn't be (the road). */
    private blocked: (x: number, z: number) => boolean,
  ) {
    this.sw = new RobotSwarm(v, field, 11);
    this.draw = new RobotsDraw(this.sw);
    scene.add(this.draw.group);
    this.target = new RobotTarget(this.sw, 3);
    bf.targets.push(this.target);
    this.tear = new RobotTearFx(bf.gunFx, bf.sfx, field, v);
    scene.add(this.tear.group);
    // Walkers' feet kick up sand; big ones lob charges through the battlefield's shells.
    this.sw.onFootfall = (i, x, y, z) => bf.dust.stomp(x, y, z, this.sw.kind[i] === BIG ? 0.5 : 0.12);
    this.sw.onLob = (_i, fx, fy, fz, x, z, flight) => {
      if (!player.alive) return;
      bf.lob(3, this.lobFrom.set(fx, fy, fz), x, z, flight, v.robotBigLobArc, v.robotBigLobRadius, v.robotBigShotDamage);
    };
    // The mech's stomps crush small ones; a dash throws clingers off.
    player.onStomp = (x, z, k) => this.sw.stomp(x, z, 2.6 * Math.min(1.5, k));
  }

  /** Robots alive on the field, and awake. */
  get count() { return this.sw.count; }
  get awake() { let n = 0; for (const l of this.live.values()) if (l.awake) n += this.alive(l); return n; }
  get campsLive() { return this.live.size; }

  /** Salvage noise at (x, z) heard within radius: wakes the camps in it. */
  noise(x: number, z: number, radius: number) {
    const r = radius * this.v.campHear;
    for (const l of this.live.values()) if (!l.awake && this.dist(l, x, z) < r) l.awake = true;
  }

  /** Forget every camp (placement changed). */
  reset() {
    for (const l of this.live.values()) for (const i of this.own(l)) this.sw.remove(i);
    this.live.clear();
    this.left.clear();
    this.camps.reset();
  }

  /** Who the swarm went for last frame (a change shakes the clingers off). */
  private lastPrey: Prey["kind"] | null = null;

  /**
   * One frame. hunting: the mech is out in the field and alive (else every camp gives up). Streams camps, wakes and
   * calms them, steps the swarm against the mech, or against prey (src/pilot/quarry.ts: the pilot on foot when he's
   * nearer). pilot: where the pilot is on foot and how much closer than the mech he has to be to wake a camp.
   */
  update(dt: number, hunting: boolean, prey?: Prey, pilot?: { x: number; z: number; notice: number } | null) {
    const p = this.player.sim.pelvis, v = this.v, sw = this.sw;
    // Stream camps in and out round the mech.
    this.near.length = 0;
    this.camps.campsNear(p.x, p.z, v.campSpawn, this.near);
    for (const c of this.near) {
      if (this.live.has(c.id) || this.blocked(c.x, c.z)) continue;
      const n = this.left.get(c.id) ?? c.size;
      if (n <= 0) continue;
      const slots = sw.spawn(n, c.x, c.z, c.radius);
      for (const i of slots) sw.frozen[i] = 1;
      const l: Live = { camp: c, slots, gens: slots.map((i) => sw.gen[i]), awake: false, hp: 0 };
      l.hp = this.hp(l);
      this.live.set(c.id, l);
    }
    for (const [id, l] of this.live) {
      if (Math.hypot(l.camp.x - p.x, l.camp.z - p.z) <= v.campDrop) continue;
      this.left.set(id, this.alive(l));
      for (const i of this.own(l)) sw.remove(i);
      this.live.delete(id);
    }
    // Wake (close, shot) and calm (the mech gone).
    for (const l of this.live.values()) {
      const hp = this.hp(l), d = this.dist(l, p.x, p.z);
      const dp = pilot ? this.dist(l, pilot.x, pilot.z) : Infinity;
      if (hunting && !l.awake && (d < v.campWake || dp < v.campWake * (pilot?.notice ?? 0) || hp < l.hp - 1e-3)) l.awake = true;
      l.hp = hp;
      if (l.awake && (!hunting || d > v.campGiveUp)) l.awake = false;
      for (const i of this.own(l)) {
        if (l.awake) { sw.frozen[i] = 0; continue; }
        // Calming down: clingers shaken off first, then frozen where they land.
        if (sw.state[i] === LATCHED) sw.shake[i] = 1e3;
        sw.frozen[i] = isAirborne(sw.state[i]) ? 0 : 1;
      }
    }
    if (!sw.hi) return;
    const bf = this.bf;
    // The mech, or the pilot on foot (a change of prey shakes the clingers off the old one).
    const q: Prey = prey ?? { kind: "mech", alive: this.player.alive, at: p, radius: 2, unit: this.player, sim: this.player.sim };
    if (this.lastPrey && q.kind !== this.lastPrey) for (let i = 0; i < sw.hi; i++) if (sw.state[i] === LATCHED) sw.shake[i] = 1e3;
    this.lastPrey = q.kind;
    const T = q.at;
    sw.update(dt, { x: T.x, y: T.y, z: T.z, radius: q.radius, vx: q.sim.vel.x, vz: q.sim.vel.z, latchLow: q.latchLow, latchHigh: q.latchHigh },
      (fx, fy, fz, tx, ty, tz, kind) => {
        if (!q.alive) return;
        const from = this.from.set(fx, fy, fz);
        if (!bf.canSee(from, T)) return;
        this.dir.set(tx - fx, ty - fy, tz - fz).normalize();
        const drawn = kind !== SMALL || Math.random() < 0.5;
        if (drawn) this.slot = this.slot >= 19 ? 2 : this.slot + 1;
        const damage = kind === BIG ? v.robotBigShotDamage : kind === MID ? v.robotMidShotDamage : v.robotShotDamage;
        const look = kind === BIG ? { flash: 1.2, hit: 1 } : kind === MID ? { flash: 0.7, hit: 0.6 } : { flash: 0.35, hit: 0.3 };
        bf.fire(this.slot, 3, from, this.dir, from.distanceTo(T) + 8, damage,
          drawn ? { flashScale: look.flash, voice: "other", hitScale: look.hit } : { tracer: false, voice: "none" });
      },
      (i, damage) => {
        if (!q.alive) return;
        q.unit.damage(damage, this.bite.set(sw.px[i], sw.py[i], sw.pz[i]), this.up);
        this.tear.bite(sw.px[i], sw.py[i], sw.pz[i], T.x, T.z);
      },
      (_i, damage, x, y, z) => {
        if (!q.alive) return;
        q.unit.damage(damage, this.bite.set(x, y, z), this.up);
        this.tear.bite(x, y, z, T.x, T.z);
        this.tear.bite(x, y, z, T.x, T.z);
      });
    this.draw.update(dt);
    this.tear.update(dt);
  }

  /** A dash: clingers thrown off, small ones in the way bowled over. */
  dashed(x: number, z: number, dx: number, dz: number, radius: number, damage: number) {
    const sw = this.sw, r2 = radius * radius;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === LATCHED) { sw.shake[i] = 1e3; continue; }
      if (st >= DOWN || sw.kind[i] !== SMALL) continue;
      const ox = sw.px[i] - x, oz = sw.pz[i] - z;
      if (ox * ox + oz * oz < r2) sw.damage(i, damage, dx, dz);
    }
  }

  /** What the convoy radar knows: each camp near (x, z) within r, where its robots are now (streamed) or the camp. */
  blobs(x: number, z: number, r: number, out: SwarmBlob[] = []): SwarmBlob[] {
    out.length = 0;
    for (const c of this.camps.campsNear(x, z, r)) {
      if (this.blocked(c.x, c.z)) continue;
      const l = this.live.get(c.id);
      const left = l ? this.alive(l) : this.left.get(c.id) ?? c.size;
      if (left <= 0) continue;
      // The estimate shrinks with the camp (the radar sees fewer heat sources), still off by the camp's guess.
      const guess = c.guess * (left / c.size);
      if (l) { const m = this.centre(l); out.push({ id: c.id, x: m.x, z: m.z, guess, awake: l.awake }); }
      else out.push({ id: c.id, x: c.x, z: c.z, guess, awake: false });
    }
    return out;
  }

  /** Live robots within r of (x, z): position and kind (the mech radar's dots). */
  contacts(x: number, z: number, r: number, out: { id: number; x: number; z: number; kind: number }[] = []) {
    out.length = 0;
    const sw = this.sw, c = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= DOWN) continue;
      robotCentre(sw, i, c);
      if (Math.hypot(c.x - x, c.z - z) <= r) out.push({ id: i * 1024 + (sw.gen[i] % 1024), x: c.x, z: c.z, kind: sw.kind[i] });
    }
    return out;
  }

  /** Awake robots within r of (x, z), as points (the convoy's turrets track them). */
  threats(x: number, z: number, r: number, out: THREE.Vector3[]) {
    out.length = 0;
    const sw = this.sw;
    for (const l of this.live.values()) {
      if (!l.awake) continue;
      for (const i of this.own(l)) {
        if (sw.state[i] >= DOWN || out.length >= 24) continue;
        if (Math.hypot(sw.px[i] - x, sw.pz[i] - z) <= r) out.push(new THREE.Vector3(sw.px[i], sw.hubY[i], sw.pz[i]));
      }
    }
    return out;
  }

  /** The slots still this camp's (dropping the ones reused since). */
  private own(l: Live): number[] {
    const sw = this.sw;
    for (let k = l.slots.length - 1; k >= 0; k--) if (sw.gen[l.slots[k]] !== l.gens[k]) { l.slots.splice(k, 1); l.gens.splice(k, 1); }
    return l.slots;
  }
  private alive(l: Live) { let n = 0; for (const i of this.own(l)) if (this.sw.state[i] < DEAD) n++; return n; }
  private hp(l: Live) { let h = 0; for (const i of this.own(l)) if (this.sw.state[i] < DEAD) h += this.sw.hp[i]; return h; }
  private centre(l: Live) {
    let x = 0, z = 0, n = 0;
    for (const i of this.own(l)) if (this.sw.state[i] < DEAD) { x += this.sw.px[i]; z += this.sw.pz[i]; n++; }
    return n ? { x: x / n, z: z / n } : { x: l.camp.x, z: l.camp.z };
  }
  private dist(l: Live, x: number, z: number) { const m = this.centre(l); return Math.hypot(m.x - x, m.z - z); }
}
