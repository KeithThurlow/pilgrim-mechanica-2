// A mech's weapons other than the miniguns' rounds (docs/proposal-weapons.md), on its battlefield: whatever the
// loadout fitted (src/game/loadoutApply.ts calls configure), stepped with the mech (MechUnit.weapons). Controls
// (Keith 2026-10-25): left click fires the left arm or hull weapon, right click the right; shoulder weapons sit on keys
// 1-3 (key 4 is kept for drones): hold the key to paint, release to fire. It fills the painters, runs the sims in
// this folder and turns what they do into blasts, damage, dust, sound and shake. Drawing: src/weapons/arsenalDraw.ts.
//
// Gun sides: rail cannon (hold to charge, release fires), autocannon (shells on the gun's clock, leading the lock), RPG
// rocket (fires at the ground under the cursor while held, on its cooldown). Miniguns and rocket launchers carry a
// faint targeting laser. Shoulders: RPG rocket, missile pod (swarm), big mortar, line mortar.
import * as THREE from "three/webgpu";
import type { Battlefield, Hittable } from "../game/battlefield";
import type { MechUnit, MechWeapons } from "../game/mechUnit";
import { triggerOf, type Aim, type Trigger } from "../mech/upper";
import type { Resolved } from "../items/loadout";
import type { ShoulderWeapon } from "../items/bases";
import type { ToonLook } from "../look/toon";
import type { TargetCandidate } from "../game/targeting";
import type { WeaponValues } from "./tuning";
import { newPaint, clearPaint, type Paint, type Strip, type Vec3 } from "./painter";
import { SalvoSim, planStrip, type SalvoStats } from "./salvo";
import { RailSim, railPath, railFire, type RailStats } from "./rail";
import { MortarSim, mortarAim, lobArc, lobPoint, type MortarStats } from "./mortar";
import { CannonShells, leadPoint, type CannonStats } from "./autocannon";
import { Rockets, type RocketStats } from "./rocket";
import { SwarmSim, type SwarmStats } from "./swarm";
import { WEAPON_MODELS, type WeaponModel, type ModelKind } from "./models";
import { addWeaponSounds } from "./weaponSound";
import { rayGround } from "../world/raycast";

type SideKind = "rail" | "autocannon" | "rpg" | "minigun" | null;

/** The rail cannon's energy colour (its charge preview, coils and beam). */
export const RAIL_GLOW = 0x7fe0ff;

/** One fired rail beam, for drawing: its path and how long ago. */
export interface RailShot { path: Vec3[]; from: Vec3; age: number; power: number }

/** A faint targeting laser (miniguns, rocket launchers): from, to, strength 0..1. */
export interface Laser { on: boolean; from: THREE.Vector3; to: THREE.Vector3; k: number }

interface Side {
  kind: SideKind;
  light: boolean;
  own: Record<string, number> | null;
  rail: RailSim;
  /** RPG: seconds until it can fire again. */
  cool: number;
  paint: Paint;
  model: WeaponModel | null;
  whined: boolean;
  laser: Laser;
}

/** A shoulder weapon on its key. */
export interface Shoulder {
  key: 1 | 2 | 3;
  mount: "shoulderL" | "shoulderR" | "back";
  weapon: ShoulderWeapon;
  own: Record<string, number> | null;
  model: WeaponModel | null;
  paint: Paint;
  /** The strip a line mortar was fired at, shown until its shells are down. */
  fired: Paint;
  held: boolean;
  /** RPG cooldown (the other weapons keep theirs in their sims). */
  cool: number;
  line: SalvoSim;
  mortar: MortarSim;
  swarm: SwarmSim;
  strip: Strip | null;
  at: { x: number; z: number };
  laser: Laser;
}

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const NAMES: Record<string, string> = { rail: "rail cannon", autocannon: "autocannon", rpg: "rocket launcher", minigun: "minigun", missiles: "missile pod", mortar: "big mortar", linemortar: "line mortar" };
const newLaser = (): Laser => ({ on: false, from: new THREE.Vector3(), to: new THREE.Vector3(), k: 0 });

export class Arsenal implements MechWeapons {
  readonly shells = new CannonShells();
  readonly rockets = new Rockets();
  readonly sides: [Side, Side];
  shoulders: Shoulder[] = [];
  /** Rail beams fired recently (the draw fades them). */
  readonly railShots: RailShot[] = [];
  /** Camera shake asked for (the lab decays it). */
  onShake: ((k: number) => void) | null = null;
  /** Called as a weapon fires (its kind), before its damage lands: the lab's per-shot readout. */
  onFire: ((kind: string) => void) | null = null;
  /** Damage of the last rail beam (exact; the lab measures the rest on its targets). */
  last: Record<string, number> = {};
  private clock = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private prevTrig: [boolean, boolean] = [false, false];
  /** Where a target is now, by its key (a missile's), or null once it's gone: the register's lookup by id. */
  findTarget!: (key: unknown) => { x: number; z: number } | null;

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues, private look: ToonLook,
    /** Targets the snap, the swarm and the leads can see (the lab's candidates). */
    public candidates: () => TargetCandidate[] = () => []) {
    if (!this.findTarget) this.findTarget = (key) => { const c = this.candidates().find((x) => x.key === key); return c ? { x: c.x, z: c.z } : null; };
    const side = (): Side => ({ kind: null, light: false, own: null, rail: new RailSim(v), cool: 0, paint: newPaint(), model: null, whined: false, laser: newLaser() });
    this.sides = [side(), side()];
    addWeaponSounds(bf.sfx, v);
  }

  // ---- What's fitted ----

  configure(r: Resolved) {
    const body = this.unit.body;
    const guns = [r.guns.left, r.guns.right];
    this.sides.forEach((s, i) => {
      const g = guns[i];
      const kind: SideKind = !g ? null : g.cls === "rail" ? "rail" : g.cls === "autocannon" ? "autocannon" : g.cls === "rpg" ? "rpg" : "minigun";
      const mk: ModelKind | null = kind === "rail" ? (g!.light ? "railLight" : "rail") : kind === "autocannon" ? "autocannon" : kind === "rpg" ? "rpg" : null;
      if (s.model && s.model.kind !== mk) { s.model.root.removeFromParent(); s.model = null; }
      s.kind = kind; s.light = !!g?.light; s.own = g?.own ?? null;
      if (mk && !s.model && body.mount) { s.model = WEAPON_MODELS[mk](this.look, i === 0 ? "left" : "right"); body.mount(i === 0 ? "left" : "right").add(s.model.root); }
      body.showPod?.(i === 0 ? 1 : -1, kind === "minigun" || kind === null);
      s.rail.charge = 0; s.rail.holding = false; s.cool = 0;
    });
    for (const sh of this.shoulders) sh.model?.root.removeFromParent();
    this.shoulders = r.shoulders.map((x) => {
      const mk: ModelKind = x.weapon === "rpg" ? "shoulderRpg" : x.weapon;
      const model = body.mount ? WEAPON_MODELS[mk](this.look, x.mount === "shoulderL" ? "left" : "right") : null;
      if (model && body.mount) body.mount(x.mount).add(model.root);
      return { ...x, model, paint: newPaint(), fired: newPaint(), held: false, cool: 0, line: new SalvoSim(this.v), mortar: new MortarSim(this.v), swarm: new SwarmSim(this.v), strip: null, at: { x: 0, z: 0 }, laser: newLaser() };
    });
  }

  /** The fitted stand-ins (for the hold-V selector). */
  meshes(): THREE.Object3D[] {
    return [...this.sides.map((s) => s.model?.root), ...this.shoulders.map((s) => s.model?.root)].filter((x): x is THREE.Group => !!x);
  }

  // ---- Stats: the item's own when rolled, else the sliders ----

  railStats(s: Side): RailStats {
    const v = this.v, o = s.own;
    if (o) return { damage: o.damage, charge: o.charge, cooldown: o.cooldown, range: o.range };
    const lk = s.light ? v.railLightDamage : 1, lc = s.light ? v.railLightCharge : 1;
    return { damage: v.railDamage * lk, charge: v.railCharge * lc, cooldown: v.railCooldown, range: v.railRange * (s.light ? 0.85 : 1) };
  }
  lineStats(o: Record<string, number> | null): SalvoStats {
    const v = this.v;
    return o ? { rockets: o.shells, damage: o.damage, cooldown: o.cooldown, length: o.stripLength, blast: o.blast }
      : { rockets: v.salvoRockets, damage: v.salvoDamage, cooldown: v.salvoCooldown, length: v.salvoLength, blast: v.salvoBlast };
  }
  mortarStats(o: Record<string, number> | null): MortarStats {
    const v = this.v;
    return o ? { shells: v.mortarShells, damage: o.damage, cooldown: o.cooldown, blast: o.blast } : { shells: v.mortarShells, damage: v.mortarDamage, cooldown: v.mortarCooldown, blast: v.mortarBlast };
  }
  cannonStats(o: Record<string, number> | null): CannonStats {
    const v = this.v;
    return o ? { damage: o.damage, speed: o.shellSpeed, splash: o.splash, range: o.range, spread: o.spread } : { damage: v.acDamage, speed: v.acSpeed, splash: v.acSplash, range: v.acRange, spread: v.acSpread };
  }
  rpgStats(o: Record<string, number> | null, shoulder: boolean): RocketStats {
    const v = this.v;
    return o ? { damage: o.damage, blast: o.blast, speed: o.shellSpeed, cooldown: o.cooldown }
      : { damage: v.rpgDamage, blast: v.rpgBlast, speed: v.rpgSpeed, cooldown: shoulder ? v.rpgShoulderCooldown : v.rpgCooldown };
  }
  swarmStats(o: Record<string, number> | null): SwarmStats {
    const v = this.v;
    return o ? { missiles: o.rockets, damage: o.damage, blast: o.blast, cooldown: o.cooldown, radius: v.swarmRadius }
      : { missiles: v.swarmMissiles, damage: v.swarmDamage, blast: v.swarmBlast, cooldown: v.swarmCooldown, radius: v.swarmRadius };
  }

  // ---- Each frame ----

  step(dt: number, _aim: Aim | null, trigger: Trigger) {
    this.clock += dt;
    const u = this.unit, bf = this.bf, v = this.v;
    for (const r of this.railShots) r.age += dt;
    while (this.railShots.length && this.railShots[0].age > v.railTrail + 0.2) this.railShots.shift();
    const alive = u.alive;
    // The faint targeting laser: brighter as the sun goes down.
    const night = Math.min(1, Math.max(0, (0.35 - bf.sunDir.y) / 0.4));
    const laserK = v.laserDay + (v.laserNight - v.laserDay) * night;

    this.sides.forEach((s, i) => {
      const side: 1 | -1 = i === 0 ? 1 : -1;
      const g = u.upper.guns[i];
      const held = alive && triggerOf(trigger, i) && g.enabled;
      const pressed = held && !this.prevTrig[i];
      this.prevTrig[i] = held;
      for (const mat of s.model?.glow ?? []) mat.opacity = s.kind === "rail" ? 0.25 + 0.75 * s.rail.charge : 0.9;
      if (s.model) s.model.recoil.position.z += (0 - s.model.recoil.position.z) * Math.min(1, dt * 8);
      s.cool = Math.max(0, s.cool - dt);
      // Targeting laser on the minigun and the rocket launcher, along the gun.
      s.laser.on = alive && (s.kind === "minigun" || s.kind === "rpg") && laserK > 0;
      if (s.laser.on) this.laserAlong(s.laser, s.model?.laserFrom ? s.model.laserFrom.getWorldPosition(this.tmp) : this.muzzleOf(s, side, this.tmp), u.body.barrel(side, this.dir), laserK);
      if (s.kind === "rpg") {
        // Fires at the ground under the cursor while held, on its cooldown (a click fires one).
        if ((held || pressed) && s.cool <= 0 && u.cursor) {
          const st = this.rpgStats(s.own, false);
          s.cool = st.cooldown;
          this.fireRocket(this.muzzleOf(s, side, this.tmp), u.cursor, st);
          if (s.model) s.model.recoil.position.z = -0.35;
        }
        clearPaint(s.paint);
        return;
      }
      if (s.kind !== "rail") { clearPaint(s.paint); return; }
      const st = this.railStats(s);
      if (held && !s.rail.holding && s.rail.cooldown <= 0 && !s.whined) { s.whined = true; bf.sfx.playSound("railCharge", u.sim.pelvis, 1, 1 / Math.max(0.3, st.charge)); }
      if (!held) s.whined = false;
      const fired = s.rail.update(dt, held, st);
      const muzzle = this.muzzleOf(s, side, this.tmp);
      const dir = u.body.barrel(side, this.dir);
      const flat = Math.hypot(dir.x, dir.z) || 1;
      // The preview: a thin beam along the gun out to range, thickening as it charges.
      const p = s.paint;
      if (s.rail.holding) {
        p.on = true; p.held += dt; p.charge = s.rail.charge; p.ready = s.rail.charge >= v.railMinCharge;
        p.tint = p.ready ? RAIL_GLOW : null;
        p.beamScale = 0.35 + 1.3 * s.rail.charge * s.rail.charge;
        const path = railPath(bf.field, muzzle, { x: dir.x / flat, z: dir.z / flat }, st.range, v);
        p.beamFrom = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
        const end = path[path.length - 1] ?? { x: muzzle.x + dir.x / flat * 4, y: muzzle.y, z: muzzle.z + dir.z / flat * 4 };
        p.beamTo = { ...end };
        p.strip = null; p.ring = null; p.arc.length = 0;
      } else clearPaint(p);
      if (fired !== null) this.fireRail(s, side, muzzle, dir, st, fired);
    });

    // Shoulders: hold the key to paint, release to fire.
    for (const sh of this.shoulders) this.stepShoulder(sh, dt, alive && u.keys[sh.key - 1] && !!u.cursor, laserK);

    // Everything in flight.
    this.shells.update(dt, v.acGravity, bf.field, bf.targets, (s, at, t) => this.cannonBurst(s.team, at, t, s.damage, s.splash, s.vel));
    const steel = bf.wrecks ? (o: THREE.Vector3, d: THREE.Vector3, max: number) => (bf.wrecks!.hit(o, d, max, this.tmp2, this.dir) ? o.distanceTo(this.tmp2) : -1) : null;
    this.rockets.update(dt, bf.field, bf.targets, steel, (r, at, _why, t) => {
      if (t) t.damage(r.damage * 0.5, at, r.dir);
      this.blast(at, r.blast, r.damage);
    });
    if (v.rpgSmoke > 0) for (const r of this.rockets.list) if (r.live) this.trail(r.prev, r.pos, 0.3 * v.rpgSmoke, 4);
  }

  private stepShoulder(sh: Shoulder, dt: number, held: boolean, laserK: number) {
    const u = this.unit, bf = this.bf, v = this.v;
    sh.cool = Math.max(0, sh.cool - dt);
    const p = sh.paint;
    const launch = this.shoulderMuzzle(sh, 0, this.tmp2);
    const cur = u.cursor;
    // The shoulder rocket's faint laser runs to the cursor while it's fitted.
    sh.laser.on = sh.weapon === "rpg" && !!cur && u.alive && laserK > 0;
    if (sh.laser.on) { if (sh.model?.laserFrom) sh.model.laserFrom.getWorldPosition(sh.laser.from); else sh.laser.from.copy(launch); sh.laser.to.copy(this.rpgPoint(launch, cur!)); sh.laser.k = laserK; }
    if (held && cur) {
      p.on = true; p.held += dt; p.charge = 1; p.beamScale = 1; p.tint = null;
      p.beamFrom = { x: launch.x, y: launch.y, z: launch.z };
      p.strip = null; p.ring = null; p.arc.length = 0;
      if (sh.weapon === "linemortar") {
        const st = this.lineStats(sh.own);
        sh.strip = planStrip(u.sim.pos, cur, st.length, v, this.candidates());
        p.strip = sh.strip; p.ready = sh.line.ready;
        p.beamTo = { x: cur.x, y: bf.field.height(cur.x, cur.z) + 0.1, z: cur.z };
      } else if (sh.weapon === "mortar") {
        const st = this.mortarStats(sh.own);
        const c = mortarAim(u.sim.pos, cur, u.lock ? { x: u.lock.x, z: u.lock.z, vx: u.lock.vx, vz: u.lock.vz } : null, v);
        sh.at = c;
        p.ring = { x: c.x, z: c.z, r: st.blast }; p.ready = sh.mortar.ready;
        const to = { x: c.x, y: bf.field.height(c.x, c.z), z: c.z };
        const arc = lobArc(bf.field, launch, to, v.mortarArc, v.mortarClear);
        for (let k = 1; k < 24; k++) p.arc.push(lobPoint(launch, to, arc, k / 24, v3()));
        p.beamTo = { ...to };
      } else if (sh.weapon === "missiles") {
        const st = this.swarmStats(sh.own);
        sh.at = { x: cur.x, z: cur.z };
        p.ring = { x: cur.x, z: cur.z, r: st.radius }; p.ready = sh.swarm.ready;
        p.beamTo = { x: cur.x, y: bf.field.height(cur.x, cur.z) + 0.1, z: cur.z };
      } else {
        const st = this.rpgStats(sh.own, true), to = this.rpgPoint(launch, cur);
        sh.at = { x: to.x, z: to.z };
        p.ring = { x: to.x, z: to.z, r: st.blast }; p.ready = sh.cool <= 0;
        p.beamTo = { x: to.x, y: to.y, z: to.z };
      }
    } else if (sh.held && u.alive) {
      // Released: fire at what was painted (if ready).
      if (sh.weapon === "linemortar" && sh.strip) {
        if (sh.line.fire(sh.strip, this.lineStats(sh.own), bf.field, sh.line.fired + 1)) { this.onFire?.("linemortar"); sh.fired.strip = { ...sh.strip }; sh.fired.held = 0; }
      } else if (sh.weapon === "mortar") {
        if (sh.mortar.fire(sh.at.x, sh.at.z, this.mortarStats(sh.own))) this.onFire?.("mortar");
      } else if (sh.weapon === "missiles") {
        const picks = this.candidates().map((c) => ({ x: c.x, z: c.z, key: c.key }));
        if (sh.swarm.fire(sh.at.x, sh.at.z, this.swarmStats(sh.own), picks, bf.field)) this.onFire?.("missiles");
      } else if (sh.cool <= 0 && cur) {
        const st = this.rpgStats(sh.own, true);
        sh.cool = st.cooldown;
        this.fireRocket(launch.clone(), cur, st);
        if (sh.model) sh.model.recoil.position.z = -0.3;
      }
      clearPaint(p);
    } else clearPaint(p);
    sh.held = held;

    // The line mortar's strip stays painted (dimmer, no laser) until its shells are down.
    const fp = sh.fired;
    fp.on = sh.line.flying && !!fp.strip;
    if (fp.on) { fp.held += dt; fp.ready = true; fp.charge = 0.6; fp.beamTo = fp.beamFrom; }

    // Line mortar shells, big mortar shells, missiles.
    sh.line.update(dt, (i, out) => { const m = this.shoulderMuzzle(sh, i, this.tmp); out.x = m.x; out.y = m.y; out.z = m.z; }, (r) => {
      this.blast(this.tmp.set(r.pos.x, r.pos.y, r.pos.z), r.blast, r.damage);
    }, (r) => {
      bf.sfx.playSound("mortar", this.tmp.set(r.p0.x, r.p0.y, r.p0.z), 0.7, 1.2 + Math.random() * 0.2);
      bf.dust.smoke(r.p0.x, r.p0.y, r.p0.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.35, 0.9, 0.7, 0.4);
      if (sh.model) sh.model.recoil.position.y = -0.08;
    });
    for (const r of sh.line.rockets) if (r.live && r.launched) this.trail(r.prev, r.pos, 0.12 * v.salvoSmoke, 1);
    const mst = this.mortarStats(sh.own);
    sh.mortar.update(dt, (x, z) => {
      const from = this.shoulderMuzzle(sh, 0, new THREE.Vector3());
      const to = { x, y: bf.field.height(x, z), z };
      const arc = lobArc(bf.field, from, to, v.mortarArc, v.mortarClear);
      bf.lob(u.team, from, x, z, v.mortarFlight, arc, mst.blast, mst.damage);
      bf.sfx.playSound("mortar", from, 1.2, 0.75);
      for (let k = 0; k < 8; k++) bf.dust.smoke(from.x, from.y + 0.3, from.z, (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.5, 1.6, 0.75, 0.6);
      this.onShake?.(0.18);
      if (sh.model) sh.model.recoil.position.y = -0.3;
    });
    const track = (key: unknown) => this.findTarget(key);
    sh.swarm.update(dt, bf.field, (i, out) => { const m = this.shoulderMuzzle(sh, i, this.tmp); out.x = m.x; out.y = m.y; out.z = m.z; }, track, (m) => {
      this.blast(this.tmp.set(m.pos.x, m.pos.y, m.pos.z), m.blast, m.damage);
    }, (m) => {
      bf.sfx.playSound("rocket", this.tmp.set(m.p0.x, m.p0.y, m.p0.z), 0.6, 1.1 + Math.random() * 0.2);
      if (sh.model) sh.model.recoil.position.z = -0.05;
    });
    for (const m of sh.swarm.missiles) if (m.live && m.launched) this.trail(m.prev, m.pos, 0.16 * v.rpgSmoke, 2);
    if (sh.model) { sh.model.recoil.position.y += (0 - sh.model.recoil.position.y) * Math.min(1, dt * 6); sh.model.recoil.position.z += (0 - sh.model.recoil.position.z) * Math.min(1, dt * 8); }
    const ready = sh.weapon === "linemortar" ? sh.line.ready : sh.weapon === "mortar" ? sh.mortar.ready : sh.weapon === "missiles" ? sh.swarm.ready : sh.cool <= 0;
    for (const mat of sh.model?.glow ?? []) mat.opacity = ready ? 0.95 : 0.15;
  }

  /** A gun of another class fired a round on its clock (the autocannon). */
  shot(side: 1 | -1) {
    const s = this.sides[side === 1 ? 0 : 1];
    if (s.kind !== "autocannon") return;
    const u = this.unit, v = this.v, st = this.cannonStats(s.own);
    const m = this.muzzleOf(s, side, new THREE.Vector3());
    const d = u.body.barrel(side, this.dir);
    const lock = u.lock;
    if (lock) {
      const lp = leadPoint(m, lock, { x: lock.vx ?? 0, y: 0, z: lock.vz ?? 0 }, st.speed, v.acGravity, v.acLead);
      d.set(lp.x - m.x, lp.y - m.y, lp.z - m.z).normalize();
    } else if (u.cursor) {
      // No lock: along the gun, pitched to come down on the cursor (with the drop).
      const c = u.cursor, flat = Math.hypot(c.x - m.x, c.z - m.z), hl = Math.hypot(d.x, d.z) || 1;
      const t = flat / st.speed, y = c.y + 1 + 0.5 * v.acGravity * t * t;
      d.set((d.x / hl) * flat, y - m.y, (d.z / hl) * flat).normalize();
    }
    const spread = (st.spread * Math.PI) / 180;
    const j = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.tan(spread) * Math.random());
    d.add(j.addScaledVector(d, -j.dot(d))).normalize();
    this.shells.fire(u.team, m, d, st);
    this.onFire?.("autocannon");
    this.bf.sfx.playSound("cannon", m, 1);
    this.bf.dust.smoke(m.x, m.y, m.z, d.x * 3, d.y * 3 + 0.5, d.z * 3, 0.3, 0.6, 0.6, 0.4);
    if (s.model) s.model.recoil.position.z = -0.3;
    this.onShake?.(0.04);
  }

  // ---- Effects ----

  /** Where a rocket from `from` aimed at the cursor goes: the ground under the cursor, pulled in to range. */
  private rpgPoint(from: THREE.Vector3, cur: THREE.Vector3): THREE.Vector3 {
    const dx = cur.x - from.x, dz = cur.z - from.z, d = Math.hypot(dx, dz), k = d > this.v.rpgRange ? this.v.rpgRange / d : 1;
    const x = from.x + dx * k, z = from.z + dz * k;
    return new THREE.Vector3(x, this.bf.field.height(x, z), z);
  }

  private fireRocket(from: THREE.Vector3, cur: THREE.Vector3, st: RocketStats) {
    const bf = this.bf;
    this.rockets.fire(this.unit.team, from, this.rpgPoint(from, cur), st);
    this.onFire?.("rpg");
    bf.sfx.playSound("rocket", from, 1, 0.8);
    for (let k = 0; k < 5; k++) bf.dust.smoke(from.x, from.y, from.z, (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, 0.4, 0.9, 0.7, 0.35);
    this.onShake?.(0.08);
  }

  /** A smoke trail between two points of a projectile's flight. */
  private trail(a: Vec3, b: Vec3, size: number, n: number) {
    if (size <= 0) return;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      this.bf.dust.smoke(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t,
        (Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4, size, 1 + Math.random() * 0.6, 0.55, 0.15);
    }
  }

  /** The faint laser along a gun: to the first sand or body it meets, out to its range. */
  private laserAlong(l: Laser, from: THREE.Vector3, dir: THREE.Vector3, k: number) {
    const bf = this.bf, range = this.v.laserRange;
    l.from.copy(from);
    let reach = range;
    if (rayGround(from, dir, bf.field, range, this.tmp2)) reach = from.distanceTo(this.tmp2);
    for (const t of bf.targets) {
      if (!t.alive || t.team === this.unit.team) continue;
      const d = t.hitRay(from, dir, reach);
      if (d >= 0 && d < reach) reach = d;
    }
    l.to.copy(from).addScaledVector(dir, reach);
    l.k = k;
  }

  private fireRail(s: Side, side: 1 | -1, muzzle: THREE.Vector3, dir: THREE.Vector3, st: RailStats, charge: number) {
    const bf = this.bf, u = this.unit, v = this.v;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const path = railPath(bf.field, muzzle, { x: dir.x / flat, z: dir.z / flat }, st.range, v);
    this.onFire?.("rail");
    const hits = railFire(path, bf.targets, u.team, st.damage * charge, v);
    this.last.rail = hits.reduce((a, h) => a + h.damage, 0);
    this.railShots.push({ path, from: { x: muzzle.x, y: muzzle.y, z: muzzle.z }, age: 0, power: charge });
    // Sparks where it went through, dust kicked up all along its line, a flash at the end.
    for (const h of hits) bf.gunFx.sparksAt(h.at, this.tmp2.copy(dir).negate(), 10, 9);
    for (let k = 0; k < path.length; k += 2) {
      const p = path[k];
      if (bf.inWater(p.x, p.z)) { bf.water?.splash(p.x, p.z, 0.5, dir.x, dir.z, 0.8); continue; }
      bf.dust.kick(p.x, p.y - v.railHeight, p.z, dir.x / flat, dir.z / flat, 0.6 + charge * 0.6);
    }
    const end = path[path.length - 1];
    if (end) { bf.dust.hit(end.x, end.y - v.railHeight, end.z, dir.x / flat, dir.z / flat, 2.5); bf.marks.crater(end.x, end.z, 1.5); }
    bf.sfx.playSound("rail", muzzle, 0.6 + 0.4 * charge, 1.1 - 0.15 * charge);
    u.upper.guns[side === 1 ? 0 : 1].kick = v.railKick;
    u.upper.shake = Math.min(0.06, u.upper.shake + 0.04 * charge);
    if (s.model) s.model.recoil.position.z = -v.railKick * 1.5;
    this.onShake?.(v.railShake * charge);
  }

  /** An autocannon shell bursts: the target it struck takes the shell, everything near takes a share. */
  private cannonBurst(team: number, at: THREE.Vector3, t: Hittable | null, damage: number, splash: number, vel: THREE.Vector3) {
    const bf = this.bf, v = this.v;
    const d = this.dir.copy(vel).normalize();
    if (t) { t.damage(damage, at, d); bf.gunFx.sparksAt(at, this.tmp2.copy(d).negate(), 8, 7); }
    if (splash > 0) for (const o of bf.targets) if (o !== t && o.alive && o.team !== team && o.splash) o.splash(at, splash, damage * v.acSplashShare, d);
    if (!t && bf.inWater(at.x, at.z)) bf.water?.splash(at.x, at.z, 1, d.x, d.z, 1.2);
    else { bf.dust.hit(at.x, at.y, at.z, d.x, d.z, 1.8); if (!t) bf.marks.crater(at.x, at.z, 1.3); }
    for (let k = 0; k < 4; k++) bf.dust.smoke(at.x, at.y + 0.3, at.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.3, 0.8, 0.7, 0.75);
    bf.sfx.play("brap", at, 0.9, 0.8, true);
  }

  /** A rocket, missile or shell's blast: the battlefield's one blast entry point (crater queued, dust, sound, splash). */
  private blast(at: THREE.Vector3, radius: number, damage: number) {
    this.bf.blast(this.unit.team, at.clone(), radius, damage);
  }

  private muzzleOf(s: Side, side: 1 | -1, out: THREE.Vector3) {
    return s.model?.muzzles[0] ? s.model.muzzles[0].getWorldPosition(out) : this.unit.body.muzzle(side, out);
  }

  /** Tube i of a shoulder weapon, or over the hull. */
  shoulderMuzzle(sh: Shoulder, i: number, out: THREE.Vector3) {
    const m = sh.model?.muzzles;
    if (m?.length) return m[i % m.length].getWorldPosition(out);
    return out.copy(this.unit.sim.pelvis).setY(this.unit.sim.pelvis.y + 2);
  }

  /** The controls and their state, for the HUD: which button or key fires what, and cooldowns. */
  controls(): string[] {
    const out: string[] = [];
    const u = this.unit;
    this.sides.forEach((s, i) => {
      const b = i === 0 ? "LMB" : "RMB";
      if (!s.kind) { out.push(`${b} —`); return; }
      const g = u.upper.guns[i];
      let state = "";
      if (s.kind === "rail") state = s.rail.cooldown > 0 ? `${s.rail.cooldown.toFixed(1)} s` : s.rail.holding ? `charge ${Math.round(s.rail.charge * 100)}%` : "hold to charge";
      else if (s.kind === "rpg") state = s.cool > 0 ? `${s.cool.toFixed(1)} s` : "ready";
      else if (s.kind === "minigun") state = `${g.ammo} rds`;
      out.push(`${b} ${NAMES[s.kind]}${s.light ? " (hand)" : ""} ${state}`);
    });
    for (const sh of this.shoulders) {
      const cd = sh.weapon === "linemortar" ? sh.line.cooldown : sh.weapon === "mortar" ? sh.mortar.cooldown : sh.weapon === "missiles" ? sh.swarm.cooldown : sh.cool;
      out.push(`${sh.key} ${NAMES[sh.weapon] ?? sh.weapon} ${cd > 0 ? `${cd.toFixed(1)} s` : sh.held ? "aiming" : "ready"}`);
    }
    return out;
  }
}
