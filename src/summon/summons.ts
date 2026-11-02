// The summoner's units on a battlefield (glue; docs/proposal-summoner.md, Keith 2026-11-02): the attack drones
// (drones.ts), and the ground units (allies.ts: turret companions and the scrap swarm). Feeds them their owner (the player's mech) and the foes the register holds round it, prefers the
// owner's target lock (Tab, or the soft lock), turns their shots into battlefield rounds of the owner's team, makes them
// hittable by the other teams' rounds, and draws them. Any combat lab (or the convoy lab) can add one.
// Ownership: host (the drones' damage and targets); the owner is the player whose mech carries them.
import * as THREE from "three/webgpu";
import type { Battlefield, Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { MechUnit } from "../game/mechUnit";
import { FLAG, type Filter } from "../game/register";
import type { Ground } from "../mech/walker";
import { Drones, DRONE_DEFAULTS, DRONE_PARAMS, DRONE_GROUPS, type DroneFoe, type DroneValues } from "./drones";
import { DronesDraw } from "./dronesDraw";
import { Allies, ALLY_DEFAULTS, ALLY_PARAMS, ALLY_GROUPS, type AllyValues } from "./allies";
import type { RobotValues } from "../combat/robots";
import type { DeathPhysics } from "../physics/deaths";
import { Replicas, REPLICA_DEFAULTS, REPLICA_PARAMS, REPLICA_GROUPS, type ReplicaValues } from "./replicas";
import type { MechUnitValues } from "../game/mechUnit";
import type { ToonLook } from "../look/toon";

export const SUMMON_DEFAULTS = { ...DRONE_DEFAULTS, ...ALLY_DEFAULTS, ...REPLICA_DEFAULTS };
export type SummonValues = DroneValues & AllyValues & RobotValues & ReplicaValues & MechUnitValues;
export const SUMMON_PARAMS = [...DRONE_PARAMS, ...REPLICA_PARAMS, ...ALLY_PARAMS];
export const SUMMON_TOPIC = { id: "summons", label: "Summons", groups: [...DRONE_GROUPS, ...REPLICA_GROUPS, ...ALLY_GROUPS] };

/** Battlefield gun slots the summons' rounds use (other guns share 2..19; the effects hold 24). */
const SLOT0 = 20, SLOTS = 4;

/** The drones as one target for the other teams' rounds: a sphere each. */
class DronesTarget implements Hittable {
  readonly surface: HitSurface = "metal";
  alive = true;
  private last = -1;
  constructor(private d: Drones, readonly team: number) {}
  hitRay(o: THREE.Vector3, dir: THREE.Vector3, maxDist: number) {
    const d = this.d, R = d.v.droneSize * 0.5;
    let best = -1;
    this.last = -1;
    for (let i = 0; i < d.n; i++) {
      if (!d.up[i]) continue;
      const ox = d.x[i] - o.x, oy = d.y[i] - o.y, oz = d.z[i] - o.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > maxDist) continue;
      const q = ox * ox + oy * oy + oz * oz - t * t;
      if (q > R * R) continue;
      const hit = t - Math.sqrt(R * R - q);
      if (best < 0 || hit < best) { best = hit; this.last = i; }
    }
    return best;
  }
  damage(amount: number) { if (this.last >= 0) this.d.hurt(this.last, amount); }
  /** Blasts and splash: every drone in the radius takes the damage, less toward the edge. */
  splash(at: THREE.Vector3, radius: number, damage: number) {
    const d = this.d;
    let n = 0;
    for (let i = 0; i < d.n; i++) {
      if (!d.up[i]) continue;
      const r = Math.hypot(d.x[i] - at.x, d.y[i] - at.y, d.z[i] - at.z);
      if (r > radius + d.v.droneSize * 0.5) continue;
      d.hurt(i, damage * Math.max(0.3, 1 - r / Math.max(0.1, radius)));
      n++;
    }
    return n;
  }
}

export class Summons {
  readonly drones: Drones;
  readonly dronesDraw: DronesDraw;
  /** Turret companions and the scrap swarm. */
  readonly allies: Allies;
  /** Mech replicas (wire-frame robot mechs at the owner's flanks), when the lab gives a toon look. */
  readonly replicas: Replicas | null;
  private target: DronesTarget;
  private foes: DroneFoe[] = [];
  private pool: DroneFoe[] = [];
  private near: number[] = [];
  private lockFoe: DroneFoe = { key: 0, x: 0, y: 0, z: 0, r: 1, vx: 0, vz: 0 };
  private from = new THREE.Vector3(); private dir = new THREE.Vector3(); private at = new THREE.Vector3();
  private slot = 0;
  private wasAlive = true;
  private filter: Filter;

  constructor(private bf: Battlefield, scene: THREE.Object3D, readonly v: SummonValues, ground: Ground, private owner: MechUnit, enemies: Filter, deaths: DeathPhysics | null = null,
    mechs: { look: ToonLook } | null = null) {
    this.drones = new Drones(v, ground);
    this.dronesDraw = new DronesDraw(this.drones);
    scene.add(this.dronesDraw.group);
    this.target = new DronesTarget(this.drones, owner.team);
    bf.targets.push(this.target);
    // Foes: hittable things of another team, not asleep or knocked down.
    this.filter = { ...enemies, none: (enemies.none ?? 0) | FLAG.Asleep | FLAG.Down };
    this.allies = new Allies(bf, scene, v, ground, owner, enemies, deaths);
    this.replicas = mechs ? new Replicas(bf, scene, v, mechs.look, owner, enemies) : null;
  }

  /** The send command (the swarm at the owner's lock, else at the cursor) and the recall. */
  send() {
    const o = this.owner, L = o.lock;
    if (L) this.allies.sendSwarm(L.x, L.z, typeof L.key === "number" ? L.key : -1);
    else if (o.cursor) this.allies.sendSwarm(o.cursor.x, o.cursor.z);
  }
  recall() { this.allies.recall(); }

  /** Every summon on the ground (companions, scrappers, replicas): where and how big, for enemies to turn on. */
  each(fn: (x: number, y: number, z: number, r: number, air?: boolean) => void) {
    this.allies.each(fn); this.replicas?.each(fn);
    const d = this.drones;
    for (let i = 0; i < d.n; i++) if (d.up[i]) fn(d.x[i], d.y[i], d.z[i], d.v.droneSize * 0.5, true);
  }

  /** Meshes for the hold-V selector. */
  get meshes(): THREE.Object3D[] { return [...this.dronesDraw.meshes, ...this.allies.draw.group.children, ...(this.replicas?.objects() ?? [])]; }

  update(dt: number) {
    const bf = this.bf, o = this.owner, v = this.v, reg = bf.register, p = o.sim.pelvis;
    // The register's foes round the mech (it was rebuilt this tick, before the soft lock).
    this.near.length = 0; this.foes.length = 0;
    reg.near(p.x, p.z, v.droneEngage, this.filter, this.near);
    for (let k = 0; k < this.near.length; k++) {
      const e = this.near[k];
      const f = this.pool[k] ?? (this.pool[k] = { key: 0, x: 0, y: 0, z: 0, r: 1, vx: 0, vz: 0 });
      f.key = reg.id[e]; f.x = reg.x[e]; f.y = reg.y[e]; f.z = reg.z[e]; f.r = reg.r[e]; f.vx = reg.vx[e]; f.vz = reg.vz[e];
      this.foes.push(f);
    }
    // The owner's lock (Tab or the soft lock): its key is the register's id.
    let lock: DroneFoe | null = null;
    const L = o.lock;
    if (L) {
      const lf = this.lockFoe;
      lf.key = typeof L.key === "number" ? L.key : -2; lf.x = L.x; lf.y = L.y; lf.z = L.z; lf.r = L.r; lf.vx = L.vx ?? 0; lf.vz = L.vz ?? 0;
      lock = lf;
    }
    if (this.wasAlive && !o.alive) this.drones.grounded();
    this.wasAlive = o.alive;
    const d = this.drones;
    d.step(dt, { x: p.x, y: p.y, z: p.z, vx: o.sim.vel.x, vz: o.sim.vel.z, alive: o.alive }, this.foes, lock);
    for (const e of d.events) {
      if (e.kind === "shot") {
        const s = e.shot;
        this.from.set(s.fx, s.fy, s.fz);
        this.at.set(s.tx, s.ty, s.tz);
        if (!bf.canSee(this.from, this.at)) continue;
        this.dir.subVectors(this.at, this.from);
        const len = this.dir.length();
        this.dir.multiplyScalar(1 / Math.max(1e-6, len));
        this.slot = (this.slot + 1) % SLOTS;
        bf.fire(SLOT0 + this.slot, o.team, this.from, this.dir, len + 6, s.damage, { flashScale: 0.3, voice: "other", hitScale: 0.35, seed: s.id * 977 + d.shots });
      } else if (e.kind === "down") {
        // Shot down: a pop of sparks and smoke where it was.
        bf.blast(o.team, this.at.set(e.x, e.y, e.z), 1.2, 0);
      }
    }
    this.dronesDraw.update(dt);
    this.allies.update(dt);
    this.replicas?.update(dt);
  }

  /** HUD line. */
  hud(): string {
    const d = this.drones;
    let busy = 0;
    for (let i = 0; i < d.n; i++) if (d.up[i] && d.foe[i] >= 0) busy++;
    return `drones ${d.flying}/${d.n} up · ${busy} attacking · rounds ${d.shots} · lost ${d.lost} · ${this.allies.hud()}${this.replicas?.hud() ?? ""}`;
  }
}
