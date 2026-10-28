// The raider faction in the convoy lab's expedition (glue; Keith 2026-10-28, docs/proposal-factions.md): the two
// behaviours of one human faction.
// - BanditCamps: the placed camps (banditCamps.ts) brought to life as the infantry swarm (src/combat/infantry.ts), one
//   swarm for every camp so one drawer. A camp streams in within banditSpawn of the mech asleep (frozen), stirs within
//   banditActive (some walk a patrol round the camp, the rest stand at their posts), opens fire when the mech comes within
//   banditWake, when stripping noise reaches it, when one of them is hit, or when another faction attacks it. Territorial:
//   alert, they chase the mech only while it is within banditLeash of the camp's centre; past that they walk home.
//   Kills and survivors are remembered when the camp streams out.
// - WarBands: the roaming columns (warColumns.ts) that close with the mech come onto the field as the war band
//   (src/combat/warband.ts), one Warband per column, keeping its behaviour (circle, gun runs, drive-bys); handed back as
//   points with their survivors when the mech gets far or goes aboard.
// Both publish FightGroups so the fight director (src/game/factions.ts) can point them at other factions' groups.
// Ownership: host state (camps, columns, damage); drawing and sounds are cosmetic.
import * as THREE from "three/webgpu";
import type { DuneField } from "../world/terrain";
import { InfantrySwarm, DEAD, DOWN, type InfantryValues } from "../combat/infantry";
import { InfantryDraw, type BanditLookValues } from "../combat/infantryDraw";
import type { BanditVatData } from "../combat/banditVat";
import { InfantryTarget } from "../combat/infantryTarget";
import { Warband, type WarbandValues, type WarTarget } from "../combat/warband";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { Prey } from "../pilot/quarry";
import { BanditGroup, WarGroup } from "../game/fightGroups";
import { TEAM, FACTION, banditPower, columnPower, type AbstractGroup, type FactionValues } from "../game/factions";
import { ObjectSerials } from "../game/register";
import { hash4, rng } from "../world/pois";
import type { BanditField, BanditCamp, BanditValues } from "./banditCamps";
import type { WarColumns, Column, ColumnValues } from "./warColumns";
import type { CarKind } from "../vehicles/car";

export interface HumanBlob { id: string; x: number; z: number; guess: number; awake: boolean }
export interface HumanContact { id: number; x: number; z: number; kind: number }

interface Live {
  camp: BanditCamp;
  slots: number[]; gens: number[];
  state: "asleep" | "idle" | "alert";
  hp: number;
  /** Seconds since anything alerted it (it stands down after a quiet spell). */
  quiet: number;
  group: BanditGroup;
}

const CAMP_SLOT_MAX = 200;

export class BanditCamps {
  readonly sw: InfantrySwarm;
  readonly draw: InfantryDraw;
  readonly target: InfantryTarget;
  private live = new Map<string, Live>();
  /** Bandits each camp still has after a visit, and how hurt they are. */
  private left = new Map<string, number>();
  private hurt = new Map<string, number>();
  private near: BanditCamp[] = [];
  private slot = 2;
  private from = new THREE.Vector3(); private dir = new THREE.Vector3(); private aimPt = new THREE.Vector3();
  /** Per slot: its post at the camp, its patrol (waypoint, wait) or -1 for standing guard. */
  private postX = new Float32Array(1024); private postZ = new Float32Array(1024);
  private wp = new Int16Array(1024).fill(-1); private wait = new Float32Array(1024);
  private abstracts = new Map<string, AbstractGroup>();
  /** A bandit died: its slot, generation and where (for item drops). */
  onKill: ((i: number, gen: number, x: number, z: number) => void) | null = null;
  /** A camp opened fire / woke (for sound and notes). */
  onAlert: ((c: BanditCamp) => void) | null = null;

  constructor(
    readonly v: BanditValues & InfantryValues & BanditLookValues & FactionValues, field: DuneField, private bf: Battlefield, scene: THREE.Scene,
    readonly camps: BanditField, private player: MechUnit, vat: BanditVatData | null,
    /** True where a camp shouldn't be (the road). */
    private blocked: (x: number, z: number) => boolean,
  ) {
    this.sw = new InfantrySwarm(v, field, 23);
    this.draw = new InfantryDraw(this.sw, v, vat);
    scene.add(this.draw.group);
    this.target = new InfantryTarget(this.sw, TEAM.raiders);
    bf.targets.push(this.target);
    this.sw.onDeath = (i) => this.onKill?.(i, this.sw.gen[i], this.sw.px[i], this.sw.pz[i]);
    const prev = player.onStomp;
    player.onStomp = (x, z, k) => { prev?.(x, z, k); this.sw.stomp(x, z, 2.6 * Math.min(1.5, k)); };
  }

  get count() { return this.sw.count; }
  get campsLive() { return this.live.size; }
  get alert() { let n = 0; for (const l of this.live.values()) if (l.state === "alert") n += this.alive(l); return n; }
  get anyAlert() { for (const l of this.live.values()) if (l.state === "alert") return true; return false; }

  /** The fight groups of the camps that are up (not asleep). */
  groups(out: BanditGroup[] = []): BanditGroup[] {
    out.length = 0;
    for (const l of this.live.values()) if (l.state !== "asleep") out.push(l.group);
    return out;
  }

  /** Salvage noise at (x, z) heard within radius: camps in it are alerted. */
  noise(x: number, z: number, radius: number) {
    const r = radius * this.v.banditHear;
    for (const l of this.live.values()) if (l.state !== "alert" && this.dist(l, x, z) < r) this.alarm(l);
  }

  reset() {
    for (const l of this.live.values()) for (const i of this.own(l)) this.sw.remove(i);
    this.live.clear(); this.left.clear(); this.hurt.clear(); this.abstracts.clear();
    this.camps.reset();
  }

  private alarm(l: Live) { if (l.state !== "alert") { l.state = "alert"; this.onAlert?.(l.camp); } l.quiet = 0; }

  /**
   * One frame. hunting: the mech is out and alive (else camps do not go for it; they still defend themselves). prey /
   * pilot as for the robot camps (src/expedition/swarmCamps.ts).
   */
  update(dt: number, hunting: boolean, prey?: Prey, pilot?: { x: number; z: number; notice: number } | null) {
    const p = this.player.sim.pelvis, v = this.v, sw = this.sw;
    // Stream camps in and out round the mech.
    this.near.length = 0;
    this.camps.campsNear(p.x, p.z, v.banditSpawn, this.near);
    for (const c of this.near) {
      if (this.live.has(c.id) || this.blocked(c.x, c.z)) continue;
      const n = Math.min(CAMP_SLOT_MAX, this.left.get(c.id) ?? c.size);
      if (n <= 0) continue;
      const slots = sw.spawn(n, c.x, c.z, c.radius);
      const hurt = this.hurt.get(c.id) ?? 0;
      const r = rng(hash4(c.seed, 3, 5, 7)), patrol = Math.round(slots.length * v.banditPatrolShare);
      slots.forEach((i, k) => {
        sw.frozen[i] = 1;
        if (hurt > 0) sw.hp[i] *= 1 - hurt;
        this.postX[i] = sw.px[i]; this.postZ[i] = sw.pz[i];
        this.wp[i] = k < patrol ? Math.floor(r() * 6) : -1;
        this.wait[i] = r() * v.banditPatrolPause;
      });
      const id = c.id;
      const l: Live = {
        camp: c, slots, gens: slots.map((i) => sw.gen[i]), state: "asleep", hp: 0, quiet: 0,
        group: new BanditGroup(id, sw, () => this.live.get(id)?.slots ?? [], () => c, () => v.banditLeash),
      };
      l.hp = this.hp(l);
      this.live.set(c.id, l);
    }
    for (const [id, l] of this.live) {
      if (Math.hypot(l.camp.x - p.x, l.camp.z - p.z) <= v.banditDrop || l.state === "alert") continue;
      this.left.set(id, this.alive(l));
      for (const i of this.own(l)) sw.remove(i);
      this.live.delete(id);
    }
    // The player's point the camps care about: the mech, or the pilot on foot when he is the one near.
    for (const l of this.live.values()) {
      const hp = this.hp(l), d = this.dist(l, p.x, p.z);
      const dp = pilot ? this.dist(l, pilot.x, pilot.z) : Infinity;
      const hit = hp < l.hp - 1e-3;
      l.hp = hp;
      const home = l.camp, tx = dp < d ? pilot!.x : p.x, tz = dp < d ? pilot!.z : p.z;
      const near = Math.min(d, dp);
      const fighting = l.group.fighting;
      l.quiet += dt;
      if (hit || fighting || (hunting && (d < v.banditWake || dp < v.banditWake * (pilot?.notice ?? 0)))) this.alarm(l);
      else if (l.state === "alert" && l.quiet > 10 && (!hunting || near > v.banditGiveUp)) l.state = "idle";
      if (l.state === "asleep" && near < v.banditActive) l.state = "idle";
      else if (l.state === "idle" && near > v.banditActive * 1.3) l.state = "asleep";
      const chase = l.state === "alert" && hunting && Math.hypot(home.x - tx, home.z - tz) <= v.banditLeash;
      for (const k of this.own(l)) {
        const i = k;
        if (l.state === "asleep") { sw.frozen[i] = 1; sw.vx[i] = 0; sw.vz[i] = 0; sw.clearTarget(i); continue; }
        sw.frozen[i] = 0;
        if (sw.state[i] >= DOWN) continue;
        // In a fight with another faction: the director set its target.
        if (sw.hasT[i] && !sw.calm[i]) continue;
        if (chase) { sw.clearTarget(i); continue; }
        this.stand(l, i, dt);
      }
    }
    if (!sw.hi) return;
    const bf = this.bf;
    const q: Prey = prey ?? { kind: "mech", alive: this.player.alive, at: p, radius: 2, unit: this.player, sim: this.player.sim };
    const T = q.at;
    sw.update(dt, { x: T.x, y: T.y, z: T.z, radius: q.kind === "pilot" ? 1 : 3 }, (fx, fy, fz, tx, ty, tz, i) => {
      const own = sw.hasT[i] === 1;
      if (!own && !q.alive) return;
      const from = this.from.set(fx, fy, fz);
      // Only with a clear line: no shooting through the dunes.
      if (!bf.canSee(from, own ? this.aimPt.set(tx, ty, tz) : T)) return;
      this.dir.set(tx - fx, ty - fy, tz - fz).normalize();
      const drawn = Math.random() < v.banditTracer;
      if (drawn) this.slot = this.slot >= 19 ? 2 : this.slot + 1;
      bf.fire(this.slot, TEAM.raiders, from, this.dir, v.fireRange + 5, v.banditDamage, drawn ? { flashScale: 0.35, voice: "other", hitScale: 0.3 } : { tracer: false, voice: "none" });
    });
    this.draw.update(dt);
  }

  /** Not fighting: a patrol walks its waypoints, the rest stand at their posts (calm targets). */
  private stand(l: Live, i: number, dt: number) {
    const sw = this.sw, v = this.v;
    if (this.wp[i] < 0) { sw.setTarget(i, this.postX[i], sw.py[i], this.postZ[i], 0, true); return; }
    const c = l.camp, R = v.banditPatrolRadius;
    const a = (this.wp[i] / 6) * Math.PI * 2 + (l.camp.seed % 7) * 0.3;
    const wx = c.x + Math.sin(a) * R, wz = c.z + Math.cos(a) * R;
    if (Math.hypot(sw.px[i] - wx, sw.pz[i] - wz) < 4) {
      this.wait[i] -= dt;
      if (this.wait[i] <= 0) { this.wp[i] = (this.wp[i] + 1) % 6; this.wait[i] = v.banditPatrolPause * (0.6 + 0.8 * ((i * 0.618) % 1)); }
    }
    sw.setTarget(i, wx, sw.py[i], wz, 0, true);
  }

  /** Camps on the sand for the radar: where their bandits are now (streamed) or the camp. */
  blobs(x: number, z: number, r: number, out: HumanBlob[] = []): HumanBlob[] {
    out.length = 0;
    this.near.length = 0;
    for (const c of this.camps.campsNear(x, z, r)) {
      if (this.blocked(c.x, c.z)) continue;
      const l = this.live.get(c.id);
      const left = l ? this.alive(l) : this.left.get(c.id) ?? c.size;
      if (left <= 0) continue;
      const guess = c.guess * (left / c.size);
      if (l) { const m = this.centre(l); out.push({ id: c.id, x: m.x, z: m.z, guess, awake: l.state === "alert" }); }
      else out.push({ id: c.id, x: c.x, z: c.z, guess, awake: false });
    }
    return out;
  }

  /** Live bandits within r of (x, z): the mech radar's dots. */
  contacts(x: number, z: number, r: number, out: HumanContact[] = []) {
    const sw = this.sw;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= DOWN) continue;
      if (Math.hypot(sw.px[i] - x, sw.pz[i] - z) <= r) out.push({ id: i * 1024 + (sw.gen[i] % 1024), x: sw.px[i], z: sw.pz[i], kind: 0 });
    }
    return out;
  }

  /** Alert bandits within r of (x, z), as points (the convoy's turrets). */
  threats(x: number, z: number, r: number, out: THREE.Vector3[]) {
    const sw = this.sw;
    for (const l of this.live.values()) {
      if (l.state !== "alert") continue;
      for (const i of this.own(l)) {
        if (sw.state[i] >= DOWN || out.length >= 24) continue;
        if (Math.hypot(sw.px[i] - x, sw.pz[i] - z) <= r) out.push(new THREE.Vector3(sw.px[i], sw.py[i] + 1.2, sw.pz[i]));
      }
    }
    return out;
  }

  /** A dash through them. */
  dashed(x: number, z: number, dx: number, dz: number, radius: number, speed: number, damage: number) {
    return this.sw.shove(x, z, radius, dx, dz, speed, damage);
  }

  /** Camps off the field with bandits left, as groups for the clashes. */
  abstractGroups(x: number, z: number, r: number, out: AbstractGroup[]) {
    this.near.length = 0;
    for (const c of this.camps.campsNear(x, z, r, this.near)) {
      if (this.live.has(c.id) || this.blocked(c.x, c.z)) continue;
      const n = this.left.get(c.id) ?? c.size;
      if (n <= 0) continue;
      let g = this.abstracts.get(c.id);
      if (!g) {
        const id = c.id;
        g = {
          id, faction: FACTION.raiders, x: c.x, z: c.z, count: n, power: 0, vehicles: false,
          apply: (count, hurt) => { this.left.set(id, count); this.hurt.set(id, Math.min(0.9, 1 - (1 - (this.hurt.get(id) ?? 0)) * (1 - hurt))); },
          hold() {},
        };
        this.abstracts.set(id, g);
      }
      g.count = n; g.power = banditPower(this.v, n) * (1 - (this.hurt.get(c.id) ?? 0));
      out.push(g);
    }
  }

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

// ---- War band columns on the field ----

interface LiveCol { col: Column; wb: Warband; group: WarGroup; away: number }

export class WarBands {
  readonly group = new THREE.Group();
  private live = new Map<string, LiveCol>();
  private serials = new ObjectSerials();
  private abstracts = new Map<string, AbstractGroup>();

  constructor(readonly v: WarbandValues & ColumnValues & FactionValues, private bf: Battlefield, scene: THREE.Scene, readonly columns: WarColumns) {
    scene.add(this.group);
  }

  get count() { let n = 0; for (const l of this.live.values()) n += l.wb.raiders.filter((r) => r.alive).length; return n; }
  get columnsLive() { return this.live.size; }

  /** Register owner: every live band's vehicles (ids unique across the bands). */
  publish(reg: Parameters<Warband["publish"]>[0]) { for (const l of this.live.values()) l.wb.publish(reg); }

  groups(out: WarGroup[] = []): WarGroup[] { out.length = 0; for (const l of this.live.values()) out.push(l.group); return out; }

  /** A column closes with the mech: onto the field. */
  bring(col: Column) {
    if (this.live.has(col.id)) return;
    const wb = new Warband(this.bf, this.v, null);
    wb.autoWaves = false;
    wb.serials = this.serials;
    wb.spawnColumn(col.x, col.z, col.heading, col.kinds, col.speed, col.health);
    this.group.add(wb.group);
    this.live.set(col.id, { col, wb, group: new WarGroup(col.id, wb), away: 0 });
  }

  /**
   * One frame: step every band against the mech; report survivors back to the column (centre, kinds, health); hand a
   * band back to the map when the mech is far off or aboard for a while, or drop it when it is wrecked.
   */
  update(dt: number, target: WarTarget, hunting: boolean, at: { x: number; z: number }) {
    const v = this.v;
    for (const [id, l] of this.live) {
      l.wb.update(dt, target);
      const alive = l.wb.raiders.filter((r) => r.alive);
      const c = l.col;
      if (!alive.length) {
        // Wrecks burn out in the band's own list; the column is finished.
        c.kinds = [];
        if (!l.wb.raiders.length) { this.group.remove(l.wb.group); l.wb.clear(); this.live.delete(id); }
        continue;
      }
      let x = 0, z = 0, hp = 0, max = 0;
      for (const r of alive) { x += r.sim.pos.x; z += r.sim.pos.z; hp += r.hp; max += r.maxHp; }
      c.x = x / alive.length; c.z = z / alive.length; c.state = "live";
      const far = Math.hypot(c.x - at.x, c.z - at.z) > v.colDrop * 0.6;
      l.away = hunting && !far ? 0 : l.away + dt;
      if (l.away > (far ? 0.1 : 4) && !l.group.fighting) {
        this.columns.setAbstract(c, alive.map((r) => r.kind), Math.max(0.1, hp / max), c.x, c.z);
        c.heading = alive[0].sim.heading;
        this.group.remove(l.wb.group);
        l.wb.clear();
        this.live.delete(id);
      }
    }
  }

  contacts(x: number, z: number, r: number, out: HumanContact[] = []) {
    for (const l of this.live.values()) for (const [k, q] of l.wb.raiders.entries()) {
      if (!q.alive) continue;
      if (Math.hypot(q.sim.pos.x - x, q.sim.pos.z - z) <= r) out.push({ id: 900000 + k, x: q.sim.pos.x, z: q.sim.pos.z, kind: 1 });
    }
    return out;
  }

  threats(x: number, z: number, r: number, out: THREE.Vector3[]) {
    for (const l of this.live.values()) for (const q of l.wb.raiders) {
      if (!q.alive || out.length >= 24) continue;
      if (Math.hypot(q.sim.pos.x - x, q.sim.pos.z - z) <= r) out.push(new THREE.Vector3(q.sim.pos.x, q.sim.pos.y + 1, q.sim.pos.z));
    }
    return out;
  }

  /** Columns off the field (not live, not fresh gone) as groups for the clashes. */
  abstractGroups(x: number, z: number, r: number, out: AbstractGroup[]) {
    for (const c of this.columns.cols) {
      if (c.state === "live" || !c.kinds.length || Math.hypot(c.x - x, c.z - z) > r) continue;
      let g = this.abstracts.get(c.id);
      if (!g) {
        g = {
          id: c.id, faction: FACTION.raiders, x: c.x, z: c.z, count: 0, power: 0, vehicles: true,
          apply: (count, hurt) => {
            // The weakest go first: keep the strongest `count` vehicles, the rest hurt by what is left.
            c.kinds = c.kinds.slice(0, Math.max(0, count));
            c.health = Math.max(0.1, c.health * (1 - hurt));
          },
          hold: (on) => { c.state = on ? "busy" : c.state === "busy" ? "roam" : c.state; },
        };
        this.abstracts.set(c.id, g);
      }
      g.x = c.x; g.z = c.z; g.count = c.kinds.length; g.power = columnPower(this.v, c.kinds) * c.health;
      out.push(g);
    }
  }
}

export type { CarKind };
