// The summoner's ground units (glue; docs/proposal-summoner.md, Keith 2026-11-02: "robots that have turrets on them as
// your own companions, a couple of those" and "send out swarms of the little robots"). One RobotSwarm on the owner's
// team holds them all, on the robots' own sim and rig, in the summoner's paint (sand plate, cyan eyes):
// - Companions: weapon quads (a minigun one and a rocket one by default) that walk at the mech's flanks, hold range
//   and shoot what the owner has locked, else the nearest foe in reach; past the leash they come back. Destroyed, a
//   new one walks out of the bay after `compRebuild` s.
// - The scrap swarm: small scrappers that trail the mech in a loose cloud and bite anything that comes close. The send
//   command (sendSwarm) throws them at a point or at the owner's lock: they run there, bite every foe round it, and
//   come home when the area is clear or the time is up (recall comes back at once). Lost ones are rebuilt one at a
//   time (`swarmRebuild` s each).
// The swarm sim is driven only through per-robot targets (setTarget) and frozen (standing still at their spot), so it
// stays the enemies' code. Its rounds, rockets and bites are the owner's team's; enemies hit them like any unit.
// Ownership: host (the units, damage, targets); the commands (send, recall) come from their owner.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import { FLAG, type Filter } from "../game/register";
import type { Ground } from "../mech/walker";
import { RobotSwarm, ROBOT_DEFAULTS, DEAD, SMALL, MID, Q_MINI, Q_ROCKETS, LATCHED, isAirborne, type RobotValues } from "../combat/robots";
import { RobotsDraw } from "../combat/robotsDraw";
import { RobotTarget } from "../combat/robotTarget";
import { robotFootfall } from "../combat/robotPrints";
import { robotRagdoll } from "../physics/bodies";
import { splashBlast } from "../game/splash";
import type { DeathPhysics } from "../physics/deaths";
import { SUMMON_PAINT } from "./dronesDraw";

export const ALLY_DEFAULTS = {
  compCount: 0,
  compHp: 1400,
  compSize: 3.2,
  compSpeed: 7.5,
  compNear: 9,
  compFar: 18,
  compEngage: 32,
  compLeash: 42,
  compSide: 7,
  compBack: 3,
  compRebuild: 25,
  compMiniDamage: 8,
  compMiniPause: 1.4,
  compRocketDamage: 30,
  compRocketPause: 2.5,
  swarmCount: 16,
  swarmHp: 20,
  swarmSpeed: 11,
  swarmBite: 3,
  swarmRebuild: 3,
  swarmGuard: 12,
  swarmHome: 4,
  swarmSendRange: 70,
  swarmHunt: 16,
  swarmSendTime: 25,
  swarmClear: 3,
  keepUp: 1.25,
  compTopSpeed: 20,
  allyAggro: 14,
  allyAggroShare: 0.6,
};
export type AllyValues = typeof ALLY_DEFAULTS;

const GC = "Companions", GS = "Scrap swarm", GA = "Allies: enemies";
export const ALLY_GROUPS = [GC, GS, GA];
export const ALLY_PARAMS: Param[] = [
  { key: "compCount", label: "Companions", min: 0, max: 6, step: 1, group: GC, tip: "Weapon quads at your side: the first a minigun, the second rockets, then alternating" },
  { key: "compHp", label: "Health each", min: 50, max: 8000, step: 50, group: GC },
  { key: "compSize", label: "Size (m)", min: 1.5, max: 6, step: 0.1, group: GC },
  { key: "compSpeed", label: "Walk speed (m/s)", min: 1, max: 12, step: 0.1, group: GC, tip: "The mech walks 6 m/s: slower and they fall behind on the move" },
  { key: "compNear", label: "Hold range: near (m)", min: 2, max: 40, step: 0.5, group: GC },
  { key: "compFar", label: "Hold range: far (m)", min: 2, max: 60, step: 0.5, group: GC },
  { key: "compEngage", label: "Picks foes within (m of the mech)", min: 5, max: 120, step: 1, group: GC },
  { key: "compLeash", label: "Comes back past (m from the mech)", min: 10, max: 150, step: 1, group: GC },
  { key: "compSide", label: "Walks this far to the side (m)", min: 2, max: 25, step: 0.5, group: GC },
  { key: "compBack", label: "And this far behind (m)", min: -10, max: 20, step: 0.5, group: GC },
  { key: "compRebuild", label: "Rebuilt after (s)", min: 1, max: 180, step: 1, group: GC },
  { key: "compMiniDamage", label: "Minigun: damage per round", min: 0, max: 60, step: 0.5, group: GC },
  { key: "compMiniPause", label: "Minigun: pause between bursts (s)", min: 0.1, max: 10, step: 0.1, group: GC },
  { key: "compRocketDamage", label: "Rockets: damage each", min: 0, max: 200, step: 1, group: GC },
  { key: "compRocketPause", label: "Rockets: pause between volleys (s)", min: 0.2, max: 15, step: 0.1, group: GC },
  { key: "swarmCount", label: "Scrappers", min: 0, max: 80, step: 1, group: GS, tip: "The swarm's size: lost ones are rebuilt one at a time" },
  { key: "swarmHp", label: "Health each", min: 1, max: 200, step: 1, group: GS },
  { key: "swarmSpeed", label: "Run speed (m/s)", min: 2, max: 25, step: 0.5, group: GS },
  { key: "swarmBite", label: "Bite damage", min: 0, max: 50, step: 0.5, group: GS },
  { key: "swarmRebuild", label: "One rebuilt every (s)", min: 0.1, max: 30, step: 0.1, group: GS },
  { key: "swarmGuard", label: "At home: bite foes within (m of the mech)", min: 0, max: 40, step: 1, group: GS },
  { key: "swarmHome", label: "At home: cloud size (m)", min: 1, max: 15, step: 0.5, group: GS },
  { key: "swarmSendRange", label: "Sent: at most (m)", min: 5, max: 200, step: 1, group: GS, tip: "The send key throws them at the cursor (or your lock), at most this far" },
  { key: "swarmHunt", label: "Sent: bite foes within (m of the spot)", min: 2, max: 60, step: 1, group: GS },
  { key: "swarmSendTime", label: "Sent: home after (s)", min: 2, max: 120, step: 1, group: GS },
  { key: "swarmClear", label: "Sent: home once clear for (s)", min: 0.5, max: 20, step: 0.5, group: GS },
  { key: "keepUp", label: "Keep up: run to × your speed", min: 1, max: 2, step: 0.05, group: GS, tip: "When you sprint, scrappers (and companions, up to their top speed) run this many times your speed to stay with you" },
  { key: "compTopSpeed", label: "Companions: top speed keeping up (m/s)", min: 2, max: 30, step: 0.5, group: GC, tip: "The most a quad runs to keep up with you sprinting (its walk speed is the floor)" },
  { key: "allyAggro", label: "Enemies turn on allies within (m)", min: 0, max: 40, step: 0.5, group: GA, tip: "An enemy robot this close to a companion or scrapper (and nearer it than to you) goes for it instead" },
  { key: "allyAggroShare", label: "Share that turn on them", min: 0, max: 1, step: 0.05, group: GA },
];

/** Battlefield gun slots the allies' rounds use (the drones take 20..23 too; the effects hold 24). */
const SLOT0 = 20, SLOTS = 4;
const MAX_ALLIES = 128;

interface Unit { slot: number; gen: number }
interface Foe { key: number; x: number; y: number; z: number; r: number }

export class Allies {
  readonly sw: RobotSwarm;
  readonly draw: RobotsDraw;
  readonly target: RobotTarget;
  /** The allies' own values: the robots' with the companion and swarm sliders over them (refreshed every frame). */
  private av: RobotValues;
  private comps: (Unit | null)[] = [];
  private compClock: number[] = [];
  private swarm: Unit[] = [];
  private swarmClock = 0;
  /** 1 while the unit's target is a foe (its shots and bites count); else it's walking to its spot. */
  private engaged = new Uint8Array(1024);
  private homeA = new Float32Array(1024); private homeR = new Float32Array(1024);
  /** The swarm's order: home, or sent to a spot (following a foe's id when sent at a lock). */
  mode: "home" | "sent" = "home";
  private sendX = 0; private sendZ = 0; private sendKey = -1; private sendT = 0; private clearT = 0;
  private near: number[] = []; private foes: Foe[] = []; private pool: Foe[] = [];
  private filter: Filter;
  private from = new THREE.Vector3(); private dir = new THREE.Vector3(); private at = new THREE.Vector3(); private down = new THREE.Vector3(0, -1, 0);
  private slot = 0;
  private rs = 12345;
  /** Kills by the allies' hands, bites and sends since construction (HUD, checks). */
  sends = 0;

  constructor(private bf: Battlefield, scene: THREE.Object3D, private V: AllyValues & RobotValues, ground: Ground, private owner: MechUnit,
    enemies: Filter, deaths: DeathPhysics | null = null) {
    this.av = { ...ROBOT_DEFAULTS, ...V } as RobotValues;
    this.refreshValues();
    this.sw = new RobotSwarm(this.av, ground, 21);
    this.sw.lookGround = bf.lookGround;
    this.draw = new RobotsDraw(this.sw, { cap: MAX_ALLIES, paint: SUMMON_PAINT.plate, eye: SUMMON_PAINT.eye, alarm: 0xbff6ff });
    scene.add(this.draw.group);
    this.target = new RobotTarget(this.sw, owner.team);
    bf.targets.push(this.target);
    bf.register.add(this.target);
    this.filter = { ...enemies, none: (enemies.none ?? 0) | FLAG.Asleep | FLAG.Down };
    const sw = this.sw;
    sw.onFootfall = robotFootfall(bf, sw);
    sw.onLob = (i, fx, fy, fz, x, z, flight) => {
      if (!this.engaged[i]) return;
      const l = sw.lobOf(i);
      bf.lob(owner.team, this.from.set(fx, fy, fz), x, z, flight, l.arc, l.radius, l.damage);
    };
    if (deaths) {
      sw.hideDead = true;
      sw.onDeath = (i, nx, nz, speed) => {
        const { parts, joints } = robotRagdoll(sw, i, SUMMON_PAINT.plate, SUMMON_PAINT.dark);
        deaths.ragdoll(parts, joints, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i], { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, sw.kind[i] === SMALL ? Math.max(3, speed) : 1);
      };
    }
  }

  /** The allies' values: the robots' sliders with the companion and swarm ones over them. */
  private refreshValues() {
    const a = this.av as Record<string, number>, V = this.V;
    Object.assign(a, V);
    a.robotQuadHp = V.compHp; a.robotQuadSize = V.compSize; a.robotQuadSpeed = V.compSpeed;
    a.robotQuadNear = V.compNear; a.robotQuadFar = Math.max(V.compNear, V.compFar);
    a.robotQuadMiniDamage = V.compMiniDamage; a.robotQuadMiniPause = V.compMiniPause;
    a.robotQuadRocketDamage = V.compRocketDamage; a.robotQuadRocketPause = V.compRocketPause;
    a.robotHp = V.swarmHp; a.robotRunSpeed = V.swarmSpeed; a.robotBiteDamage = V.swarmBite;
    a.robotShooterShare = 0; a.robotBigLobLead = 0; a.robotSpeedJitter = 0.08;
    // Keeping up (Keith 2026-11-02: summons sprint with you): faster than the mech while it's faster than them.
    const sp = Math.hypot(this.owner.sim.vel.x, this.owner.sim.vel.z) * V.keepUp;
    a.robotRunSpeed = Math.max(V.swarmSpeed, sp);
    a.robotQuadSpeed = Math.max(V.compSpeed, Math.min(V.compTopSpeed, sp));
    a.robotAccel = Math.max(V.robotAccel, sp * 0.8);
  }

  private rand() { this.rs = (Math.imul(this.rs, 1664525) + 1013904223) >>> 0; return this.rs / 4294967296; }
  private live(u: Unit | null): boolean { return !!u && this.sw.gen[u.slot] === u.gen && this.sw.state[u.slot] < DEAD; }

  /** Companions and scrappers up now. */
  get companions() { let n = 0; for (const c of this.comps) if (this.live(c)) n++; return n; }
  get scrappers() { let n = 0; for (const s of this.swarm) if (this.live(s)) n++; return n; }

  /**
   * The send command: throw the swarm at (x, z) (clamped to swarmSendRange from the mech), or at a foe by its register
   * id (they follow it). Sending again re-aims them.
   */
  sendSwarm(x: number, z: number, key = -1) {
    const p = this.owner.sim.pos, V = this.V;
    let dx = x - p.x, dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > V.swarmSendRange) { dx *= V.swarmSendRange / d; dz *= V.swarmSendRange / d; }
    this.sendX = p.x + dx; this.sendZ = p.z + dz; this.sendKey = key;
    this.mode = "sent"; this.sendT = 0; this.clearT = 0;
    this.sends++;
  }
  /** The recall command: the swarm comes home now. */
  recall() { this.mode = "home"; this.sendKey = -1; }

  /** Foes near (x, z) within r, from the register (rebuilt this tick). */
  private foesNear(x: number, z: number, r: number): Foe[] {
    const reg = this.bf.register;
    this.near.length = 0; this.foes.length = 0;
    reg.near(x, z, r, this.filter, this.near);
    for (let k = 0; k < this.near.length; k++) {
      const e = this.near[k], f = this.pool[k] ?? (this.pool[k] = { key: 0, x: 0, y: 0, z: 0, r: 1 });
      f.key = reg.id[e]; f.x = reg.x[e]; f.y = reg.y[e]; f.z = reg.z[e]; f.r = reg.r[e];
      this.foes.push(f);
    }
    return this.foes;
  }

  private nearestTo(x: number, z: number, list: readonly Foe[]): Foe | null {
    let best: Foe | null = null, bd = Infinity;
    for (const f of list) { const d = (f.x - x) ** 2 + (f.z - z) ** 2; if (d < bd) { bd = d; best = f; } }
    return best;
  }

  /** Aim unit i at a foe, or walk it to a spot (standing still once there). */
  private steer(i: number, foe: Foe | null, sx: number, sz: number) {
    const sw = this.sw;
    if (foe) {
      this.engaged[i] = 1; sw.frozen[i] = 0;
      if (sw.kind[i] === MID) sw.shooter[i] = 1;
      sw.setTarget(i, foe.x, foe.y, foe.z, Math.max(0.5, foe.r));
      return;
    }
    this.engaged[i] = 0;
    if (sw.kind[i] === MID) sw.shooter[i] = 0;
    const d = Math.hypot(sw.px[i] - sx, sw.pz[i] - sz);
    if (sw.frozen[i] ? d > 4 : d < 1.8) sw.frozen[i] = sw.frozen[i] ? 0 : 1;
    sw.setTarget(i, sx, sw.hubY[i], sz, 0.3);
  }

  update(dt: number) {
    const V = this.V, sw = this.sw, o = this.owner, bf = this.bf;
    this.refreshValues();
    const P = o.sim.pos, H = o.sim.heading, fx = Math.sin(H), fz = Math.cos(H), lx = Math.cos(H), lz = -Math.sin(H);
    // Build what's missing: companions after their rebuild time, scrappers one at a time.
    const nc = Math.max(0, Math.round(V.compCount));
    while (this.comps.length < nc) { this.comps.push(null); this.compClock.push(0); }
    for (let k = 0; k < this.comps.length; k++) {
      const c = this.comps[k];
      if (k >= nc) { if (this.live(c)) sw.remove(c!.slot); this.comps[k] = null; continue; }
      if (this.live(c) || !o.alive) continue;
      if (c) { this.comps[k] = null; this.compClock[k] = V.compRebuild; }
      if ((this.compClock[k] -= dt) > 0) continue;
      const side = k % 2 ? -1 : 1;
      const s = sw.spawn(1, P.x - fx * 3 + lx * side * 2, P.z - fz * 3 + lz * side * 2, 0, { mid: 1, big: 0, quad: 1, weapon: k % 2 ? Q_ROCKETS : Q_MINI });
      if (s.length) { this.comps[k] = { slot: s[0], gen: sw.gen[s[0]] }; sw.heading[s[0]] = H; sw.turret[s[0]] = H; }
    }
    this.swarm = this.swarm.filter((u) => this.live(u));
    const ns = Math.max(0, Math.round(V.swarmCount));
    while (this.swarm.length > ns) sw.remove(this.swarm.pop()!.slot);
    this.swarmClock -= dt;
    if (o.alive && this.swarm.length < ns && this.swarmClock <= 0) {
      this.swarmClock = V.swarmRebuild;
      const s = sw.spawn(1, P.x - fx * 2.5, P.z - fz * 2.5, 0, { mid: 0, big: 0 });
      if (s.length) {
        const i = s[0];
        this.swarm.push({ slot: i, gen: sw.gen[i] });
        this.homeA[i] = this.rand() * Math.PI * 2; this.homeR[i] = Math.sqrt(this.rand());
      }
    }

    // Companions: the owner's lock, else the nearest foe to each within reach of the mech; past the leash, home.
    const L = o.lock, lockKey = L && typeof L.key === "number" ? L.key : -1;
    const lockFoe: Foe | null = L ? { key: lockKey, x: L.x, y: L.y, z: L.z, r: L.r } : null;
    const lockIn = !!lockFoe && Math.hypot(lockFoe.x - P.x, lockFoe.z - P.z) <= V.compEngage;
    const compFoes = this.foesNear(P.x, P.z, V.compEngage).slice();
    for (let k = 0; k < this.comps.length; k++) {
      const c = this.comps[k];
      if (!this.live(c)) continue;
      const i = c!.slot, side = k % 2 ? -1 : 1, out = V.compSide * (1 + Math.floor(k / 2) * 0.6);
      const sx = P.x + lx * side * out - fx * V.compBack, sz = P.z + lz * side * out - fz * V.compBack;
      const far = Math.hypot(sw.px[i] - P.x, sw.pz[i] - P.z) > V.compLeash;
      const foe = !o.alive || far ? null : lockIn ? lockFoe : this.nearestTo(sw.px[i], sw.pz[i], compFoes);
      this.steer(i, foe, sx, sz);
    }

    // The swarm: home (a cloud behind the mech, biting what comes close), or sent (to the spot, biting all round it).
    if (this.mode === "sent") {
      this.sendT += dt;
      if (this.sendKey >= 0) {
        const e = bf.register.find(this.sendKey);
        if (e >= 0) { this.sendX = bf.register.x[e]; this.sendZ = bf.register.z[e]; } else this.sendKey = -1;
      }
    }
    const sent = this.mode === "sent";
    const swarmFoes = sent ? this.foesNear(this.sendX, this.sendZ, V.swarmHunt) : this.foesNear(P.x, P.z, V.swarmGuard);
    if (sent) {
      this.clearT = swarmFoes.length ? 0 : this.clearT + dt;
      let there = 0, n = 0;
      for (const u of this.swarm) { n++; if (Math.hypot(sw.px[u.slot] - this.sendX, sw.pz[u.slot] - this.sendZ) < 10) there++; }
      if (this.sendT > V.swarmSendTime || (this.clearT > V.swarmClear && (there >= n * 0.5 || this.sendT > 8))) this.recall();
    }
    for (const u of this.swarm) {
      const i = u.slot;
      if (sw.state[i] === LATCHED || isAirborne(sw.state[i])) continue;
      const foe = o.alive && swarmFoes.length ? this.nearestTo(sw.px[i], sw.pz[i], swarmFoes) : null;
      let sx: number, sz: number;
      if (this.mode === "sent") {
        sx = this.sendX + Math.cos(this.homeA[i]) * this.homeR[i] * 3; sz = this.sendZ + Math.sin(this.homeA[i]) * this.homeR[i] * 3;
      } else {
        const a = this.homeA[i], r = V.swarmHome * this.homeR[i];
        sx = P.x - fx * (V.swarmHome + 3) + Math.cos(a) * r; sz = P.z - fz * (V.swarmHome + 3) + Math.sin(a) * r;
      }
      this.steer(i, foe, sx, sz);
    }

    // Step them: rounds, rockets and bites only on a foe.
    const team = o.team;
    sw.update(dt, { x: P.x, y: o.sim.pelvis.y, z: P.z, radius: 2 },
      (gx, gy, gz, tx, ty, tz, kind, i) => {
        if (!this.engaged[i]) return;
        this.from.set(gx, gy, gz);
        if (!bf.canSee(this.from, this.at.set(tx, ty, tz))) return;
        this.dir.set(tx - gx, ty - gy, tz - gz);
        const len = this.dir.length();
        this.dir.multiplyScalar(1 / Math.max(1e-6, len));
        this.slot = (this.slot + 1) % SLOTS;
        const mid = kind !== SMALL;
        bf.fire(SLOT0 + this.slot, team, this.from, this.dir, len + 8, sw.shotDamage(i), { flashScale: mid ? 0.7 : 0.35, voice: "other", hitScale: mid ? 0.6 : 0.3 });
      },
      (i, damage) => {
        if (!this.engaged[i]) return;
        this.at.set(sw.px[i], sw.py[i] + 0.4, sw.pz[i]);
        splashBlast(bf.targets, team, this.at, 1.6, damage, this.down);
        bf.gunFx.sparksAt(this.at, this.down, 2, 4);
      });
    this.draw.update(dt);
  }

  /** Every ally on the ground alive now: where it is and its body radius (for enemies to turn on). */
  each(fn: (x: number, y: number, z: number, r: number) => void) {
    const sw = this.sw;
    for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DEAD) fn(sw.px[i], sw.hubY[i], sw.pz[i], sw.kind[i] === MID ? sw.size[i] * 0.4 : 0.6);
  }

  hud(): string {
    const c = this.comps.filter((u) => this.live(u)).length;
    const sent = this.mode === "sent" ? ` · sent ${Math.round(this.sendT)} s` : " · home";
    return `companions ${c}/${Math.round(this.V.compCount)} · scrappers ${this.scrappers}/${Math.round(this.V.swarmCount)}${sent} · lost ${this.target.kills}`;
  }
}

/**
 * Enemies turn on allies (the summoner lab; the camps' fight director does it in the field): an enemy robot near an
 * ally, and nearer it than to the prey, goes for it, a share of them (by slot, spread evenly). Others go back to the
 * prey. Robots already leaping on or latched to the mech are left alone.
 */
export function aggroOnAllies(enemy: RobotSwarm, allies: { each(fn: (x: number, y: number, z: number, r: number, air?: boolean) => void): void }, prey: { x: number; z: number }, range: number, share: number, list: number[] = []) {
  list.length = 0;
  allies.each((x, y, z, r, air) => { list.push(x, y, z, r, air ? 1 : 0); });
  for (let i = 0; i < enemy.hi; i++) {
    if (enemy.state[i] >= DEAD || isAirborne(enemy.state[i]) || enemy.frozen[i]) continue;
    if ((i * 0.618034) % 1 >= share) { if (enemy.hasT[i]) enemy.clearTarget(i); continue; }
    const ex = enemy.px[i], ez = enemy.pz[i];
    // Only those that shoot go for drones in the air (a biter can't reach them).
    const shoots = enemy.shooter[i] === 1 || enemy.kind[i] !== SMALL;
    let best = -1, bd = range * range;
    for (let k = 0; k < list.length; k += 5) {
      if (list[k + 4] && !shoots) continue;
      const d = (list[k] - ex) ** 2 + (list[k + 2] - ez) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    // An ally nearer it than the prey, or right in its face (within half the range), is what it goes for.
    const dp = (prey.x - ex) ** 2 + (prey.z - ez) ** 2;
    if (best >= 0 && (bd < dp || bd < range * range * 0.25)) enemy.setTarget(i, list[best], list[best + 1], list[best + 2], list[best + 3]);
    else if (enemy.hasT[i]) enemy.clearTarget(i);
  }
}
