// A mech's weapons other than the miniguns' rounds (docs/proposal-weapons.md), on its battlefield: whatever the
// loadout fitted (src/game/loadoutApply.ts calls configure), stepped with the mech (MechUnit.weapons). Controls
// (Keith 2026-10-25): left click fires the left arm or hull weapon, right click the right; shoulder weapons sit on keys
// 1-3 (key 4 is kept for drones): hold the key to paint, release to fire. It fills the painters, runs the sims in
// this folder and turns what they do into blasts, damage, dust, sound and shake. Drawing: src/weapons/arsenalDraw.ts.
//
// Gun sides: rail cannon (hold to charge, release fires one slug through a penetrating sheet), autocannon (shells on the gun's clock, leading the lock), RPG
// rocket (fires at the ground under the cursor while held, on its cooldown). Miniguns and rocket launchers carry a
// faint targeting laser. Shoulders: RPG rocket, missile pod (swarm), big mortar, line mortar (a key paints, release
// fires), and (Keith 2026-10-30) feeds and power (src/weapons/gear.ts): a press on the key overdrives or loads special
// rounds into the gun on that side, or refills energy bars; their passives are applied to the guns and the dash.
import * as THREE from "three/webgpu";
import type { Battlefield, Hittable } from "../game/battlefield";
import type { MechUnit, MechWeapons } from "../game/mechUnit";
import { triggerOf, type Aim, type Trigger } from "../mech/upper";
import type { Resolved } from "../items/loadout";
import type { ShoulderFamily, ShoulderWeapon } from "../items/bases";
import { GearSim, gearStats, type RoundSpec } from "./gear";
import type { ToonLook } from "../look/toon";
import type { TargetCandidate } from "../game/targeting";
import type { WeaponValues } from "./tuning";
import { newPaint, clearPaint, type Paint, type Strip, type Vec3 } from "./painter";
import { SalvoSim, planStrip, type SalvoStats } from "./salvo";
import { RailSim, railSheet, coilGlow, type RailStats } from "./rail";
import type { Sheet } from "../game/sheet";
import { MortarSim, mortarAim, mortarHeight, lobArc, lobPoint, type MortarStats } from "./mortar";
import { CannonShells, leadPoint, type CannonStats, type Shell } from "./autocannon";
import { Rockets, rocketAim, type RocketStats } from "./rocket";
import { splashBlast, firstBody } from "../game/splash";
import { SwarmSim, type SwarmStats } from "./swarm";
import { WEAPON_MODELS, type WeaponModel, type ModelKind } from "./models";
import { addWeaponSounds } from "./weaponSound";
import { rayGround } from "../world/raycast";
import { newMag, magReady, magResize, magStep, magTake, shotRounds, magRounds, type Mag } from "./magazine";
import type { ShotProtocols } from "../game/shots";

type SideKind = "rail" | "autocannon" | "rpg" | "minigun" | null;

/** The rail cannon's energy colour (its charge preview, coils and beam). */
export const RAIL_GLOW = 0x7fe0ff;

/**
 * One fired rail slug, for drawing: its straight path from the muzzle to where it stopped (points every 2 m), the
 * bodies it went through, how long ago and at what power, and a seed for its trail's wisps.
 */
export interface RailShot { path: Vec3[]; from: Vec3; to: Vec3; hits: Vec3[]; age: number; power: number; seed: number; dir: Vec3 }

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
  /** Rail: the thin aim line on the sand while charging (ground points out to where the slug would stop). */
  aimLine: Vec3[];
  /** Rail: the reticle the charge meter rings (the lock or the cursor). */
  meterAt: Vec3 | null;
  /** Its Protocols' behaviour (a rocket launcher's split) and what each round costs from the magazine. */
  proto: ShotProtocols | undefined;
  cost: number;
}

/** A shoulder weapon on its key. */
export interface Shoulder {
  key: 1 | 2 | 3;
  mount: "shoulderL" | "shoulderR" | "back";
  weapon: ShoulderWeapon;
  family: ShoulderFamily;
  own: Record<string, number> | null;
  /** Feeds and power: the key's state (null on a launcher). */
  gear: GearSim | null;
  model: WeaponModel | null;
  paint: Paint;
  /** The strip a line mortar was fired at, shown until its shells are down. */
  fired: Paint;
  held: boolean;
  /** RPG: time between rockets (the other weapons keep their cooldowns in their sims). */
  cool: number;
  /** RPG: its magazine (src/weapons/magazine.ts); the volley launchers' cooldown is their reload. */
  mag: Mag;
  proto?: ShotProtocols;
  cost?: number;
  line: SalvoSim;
  mortar: MortarSim;
  swarm: SwarmSim;
  strip: Strip | null;
  at: { x: number; z: number };
  laser: Laser;
}

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const NAMES: Record<string, string> = { rail: "rail cannon", autocannon: "autocannon", rpg: "rocket launcher", minigun: "minigun", missiles: "missile pod", mortar: "big mortar", linemortar: "line mortar", beltfeed: "belt feed", incendiary: "incendiary feed", capacitor: "capacitor bank" };
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
  findTarget!: (key: unknown) => { x: number; y?: number; z: number } | null;

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues, private look: ToonLook,
    /** Targets the snap, the swarm and the leads can see (the lab's candidates). */
    public candidates: () => TargetCandidate[] = () => []) {
    if (!this.findTarget) this.findTarget = (key) => { const c = this.candidates().find((x) => x.key === key); return c ? { x: c.x, z: c.z } : null; };
    const side = (): Side => ({ kind: null, light: false, own: null, rail: new RailSim(v), cool: 0, paint: newPaint(), model: null, whined: false, laser: newLaser(), aimLine: [], meterAt: null, proto: undefined, cost: 1 });
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
      s.kind = kind; s.light = !!g?.light; s.own = g?.own ?? null; s.proto = g?.proto; s.cost = g?.cost ?? 1;
      if (mk && !s.model && body.mount) { s.model = WEAPON_MODELS[mk](this.look, i === 0 ? "left" : "right"); body.mount(i === 0 ? "left" : "right").add(s.model.root); }
      body.showPod?.(i === 0 ? 1 : -1, kind === "minigun" || kind === null);
      s.rail.charge = 0; s.rail.holding = false; s.cool = 0;
    });
    for (const sh of this.shoulders) sh.model?.root.removeFromParent();
    this.shoulders = r.shoulders.map((x) => {
      const mk: ModelKind = x.weapon === "rpg" ? "shoulderRpg" : x.weapon;
      const model = body.mount ? WEAPON_MODELS[mk](this.look, x.mount === "shoulderL" ? "left" : "right") : null;
      if (model && body.mount) body.mount(x.mount).add(model.root);
      const gear = x.family === "launcher" ? null : new GearSim(gearStats(x.weapon, x.own, this.v));
      const mag = newMag(x.own?.magazine ?? this.v.rpgShoulderMag, x.own?.reload ?? this.v.rpgShoulderReload);
      return { ...x, gear, model, paint: newPaint(), fired: newPaint(), held: false, cool: 0, mag, line: new SalvoSim(this.v), mortar: new MortarSim(this.v), swarm: new SwarmSim(this.v), strip: null, at: { x: 0, z: 0 }, laser: newLaser() };
    });
    // Passives that last as long as the gear is fitted: a feed's drum (the fire rate and spin-up follow each frame, so the
    // sliders stay live), a capacitor's faster refill.
    for (const g of this.unit.upper.guns) { g.rateMul = 1; g.spinCut = 0; g.ammoMul = 1; }
    this.unit.dash.refillMul = 1;
    for (const sh of this.shoulders) {
      if (!sh.gear) continue;
      const st = sh.gear.stats, gi = this.gunOf(sh);
      if (st.family === "feed" && (gi === 0 || gi === 1)) this.unit.upper.guns[gi].ammoMul *= 1 + st.ammo;
      if (st.family === "power") this.unit.dash.refillMul += st.refill;
    }
  }

  /** The gun a shoulder feed feeds: its own side's (0 left, 1 right); -1 on the back. */
  private gunOf(sh: Shoulder) { return sh.mount === "shoulderL" ? 0 : sh.mount === "shoulderR" ? 1 : -1; }

  /** Special rounds loaded into a side's gun now (the unit asks as it fires), or null. */
  rounds(side: 1 | -1): RoundSpec | null {
    const gi = side === 1 ? 0 : 1;
    for (const sh of this.shoulders) if (sh.gear && this.gunOf(sh) === gi) { const r = sh.gear.rounds; if (r) return r; }
    return null;
  }

  /** The fitted stand-ins (for the hold-V selector). */
  meshes(): THREE.Object3D[] {
    return [...this.sides.map((s) => s.model?.root), ...this.shoulders.map((s) => s.model?.root)].filter((x): x is THREE.Group => !!x);
  }

  // ---- Stats: the item's own when rolled, else the sliders ----

  railStats(s: Side): RailStats {
    const v = this.v, o = s.own;
    const ap = s.light ? v.railLightAp : v.railAp;
    if (o) return { damage: o.damage, charge: o.charge, cooldown: o.cooldown, range: o.range, pen: o.pen ?? this.railPen(s), ap: o.ap ?? ap };
    const lk = s.light ? v.railLightDamage : 1, lc = s.light ? v.railLightCharge : 1;
    return { damage: v.railDamage * lk, charge: v.railCharge * lc, cooldown: v.railCooldown, range: v.railRange * (s.light ? 0.85 : 1), pen: this.railPen(s), ap };
  }
  /** Penetration (m): the slider, the Light rail's share of it (items carry none of their own yet). */
  private railPen(s: Side) { return this.v.railPen * (s.light ? this.v.railLightPen : 1); }
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
    return o ? { damage: o.damage, speed: o.shellSpeed, splash: o.splash, range: o.range, spread: o.spread, ap: o.ap ?? v.acAp } : { damage: v.acDamage, speed: v.acSpeed, splash: v.acSplash, range: v.acRange, spread: v.acSpread, ap: v.acAp };
  }
  rpgStats(o: Record<string, number> | null, shoulder: boolean): RocketStats {
    const v = this.v;
    return o ? { damage: o.damage, blast: o.blast, speed: o.shellSpeed, cooldown: o.cooldown, ap: o.ap ?? v.rpgAp }
      : { damage: v.rpgDamage, blast: v.rpgBlast, speed: v.rpgSpeed, cooldown: shoulder ? v.rpgShoulderCooldown : v.rpgCooldown, ap: v.rpgAp };
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
      // Sprinting with the weapons off (src/mech/bound.ts): a rail's charge is dropped, not fired.
      if (u.gunsOff && s.rail.holding) { s.rail.holding = false; s.rail.charge = 0; s.whined = false; }
      const pressed = held && !this.prevTrig[i];
      this.prevTrig[i] = held;
      // The rail's coils light in turn from the breech as it charges (the box stand-in's rings; the library model's
      // lamps follow the charge as a whole, and the draw lights its Glow_n points in turn).
      const glows = s.model?.glow ?? [];
      glows.forEach((mat, gi) => { mat.opacity = s.kind === "rail" ? (glows.length > 1 ? 0.15 + 0.85 * coilGlow(s.rail.charge, gi, glows.length) : 0.25 + 0.75 * s.rail.charge) : 0.9; });
      if (s.model) s.model.recoil.position.z += (0 - s.model.recoil.position.z) * Math.min(1, dt * 8);
      s.cool = Math.max(0, s.cool - dt);
      // An unrolled autocannon (the picker's) fires at the Shells/s slider, live; its gun clock reads the gun's stats,
      // which carried the base's rate (Keith 2026-10-26: the slider did nothing). A rolled one keeps its own.
      if (s.kind === "autocannon" && !s.own && g.stats) { g.stats.fireRate = v.acRate; g.stats.ammo = v.acMag; g.stats.reload = v.acReload; u.upper.sizeMag(g); }
      // Targeting laser on the minigun and the rocket launcher, along the gun.
      s.laser.on = alive && (s.kind === "minigun" || s.kind === "rpg") && laserK > 0;
      if (s.laser.on) this.laserAlong(s.laser, s.model?.laserFrom ? s.model.laserFrom.getWorldPosition(this.tmp) : this.muzzleOf(s, side, this.tmp), u.body.barrel(side, this.dir), laserK);
      if (s.kind === "rpg") {
        // Fires at the ground under the cursor while held, a rocket every cooldown out of its magazine (this side's,
        // in the gun record: the HUD reads it there), then reloads (a click fires one).
        if (!s.own) magResize(g.mag, v.rpgMag, v.rpgReload);
        const n = shotRounds(s.proto?.split);
        if ((held || pressed) && s.cool <= 0 && u.cursor && magTake(g.mag, magRounds(s.proto?.split), s.cost)) {
          const st = this.rpgStats(s.own, false);
          s.cool = st.cooldown;
          this.fireRockets(this.muzzleOf(s, side, this.tmp), u.cursor, st, n);
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
      const { d, aim } = this.railAim(side, muzzle);
      // The preview: a thin precise line on the sand out to where the slug would stop, and a charge meter at the
      // reticle (src/weapons/arsenalDraw.ts). No beam: nothing leaves the gun until the release.
      clearPaint(s.paint);
      if (s.rail.holding) {
        const f = railSheet(v, st, aim);
        const sheet = bf.makeSheet(muzzle, d, st.range, f);
        const end = bf.resolveSheet(u.team, sheet, 0, f, d, false).result.end;
        this.lineOnSand(sheet, end, s.aimLine);
        s.meterAt = aim ? { x: aim.x, y: aim.y, z: aim.z } : null;
      } else { s.aimLine.length = 0; s.meterAt = null; }
      if (fired !== null) this.fireRail(s, side, muzzle, d, aim, st, fired);
    });

    // Shoulders: hold the key to paint, release to fire.
    // Sprinting with the weapons off, a painted shot is dropped, not fired (stepShoulder).
    for (const sh of this.shoulders) {
      if (sh.gear) this.stepGear(sh, dt, alive && !u.gunsOff && !!u.keys[sh.key - 1]);
      else this.stepShoulder(sh, dt, alive && !u.gunsOff && u.keys[sh.key - 1] && !!u.cursor, laserK);
    }
    // Each side's guns run on their feeds' passives and overdrives (a side with two feeds multiplies them).
    this.unit.upper.guns.forEach((g, gi) => {
      let rate = 1, spin = 0;
      for (const sh of this.shoulders) if (sh.gear?.stats.family === "feed" && this.gunOf(sh) === gi) { rate *= sh.gear.rateMul; spin = Math.max(spin, sh.gear.stats.spin); }
      g.rateMul = rate; g.spinCut = spin;
    });

    // Everything in flight.
    this.shells.update(dt, v.acGravity, bf.field, bf.targets, (s, at, t, swept) => this.cannonBurst(s.team, at, t, s.damage, s.splash, s.vel, swept, s.ap), this.shellSweep);
    const steel = bf.wrecks ? (o: THREE.Vector3, d: THREE.Vector3, max: number) => (bf.wrecks!.hit(o, d, max, this.tmp2, this.dir) ? o.distanceTo(this.tmp2) : -1) : null;
    this.rockets.update(dt, bf.field, bf.targets, steel, (r, at, _why, t) => {
      if (t) t.damage(r.damage * 0.5, at, r.dir, r.ap);
      this.blast(at, r.blast, r.damage, r.ap);
    });
    if (v.rpgSmoke > 0) for (const r of this.rockets.list) if (r.live) this.trail(r.prev, r.pos, 0.3 * v.rpgSmoke, 4);
  }

  /** A feed or power key: a press (not paint-and-release) fires it if it's off cooldown. */
  private stepGear(sh: Shoulder, dt: number, down: boolean) {
    const gear = sh.gear!, u = this.unit, bf = this.bf;
    gear.update(dt);
    const pressed = down && !sh.held;
    sh.held = down;
    if (sh.model) sh.model.recoil.position.y += (0 - sh.model.recoil.position.y) * Math.min(1, dt * 6);
    const lit = gear.left > 0;
    for (const mat of sh.model?.glow ?? []) mat.opacity = lit ? 0.95 : gear.cool <= 0 ? 0.5 : 0.12;
    if (!pressed || !gear.press()) return;
    const st = gear.stats;
    if (st.family === "power") u.dash.refillNow(st.bars);
    if (sh.model) sh.model.recoil.position.y = -0.12;
    bf.sfx.playSound("railCharge", u.sim.pelvis, 0.5, st.family === "power" ? 2.6 : 1.9);
    this.onFire?.(sh.weapon);
    this.onShake?.(0.03);
  }

  private stepShoulder(sh: Shoulder, dt: number, held: boolean, laserK: number) {
    const u = this.unit, bf = this.bf, v = this.v;
    sh.cool = Math.max(0, sh.cool - dt);
    if (sh.weapon === "rpg" && !sh.own) magResize(sh.mag, v.rpgShoulderMag, v.rpgShoulderReload);
    magStep(sh.mag, dt);
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
        p.ring = { x: to.x, z: to.z, r: st.blast }; p.ready = sh.cool <= 0 && magReady(sh.mag);
        p.beamTo = { x: to.x, y: to.y, z: to.z };
      }
    } else if (sh.held && u.alive && !u.gunsOff) {
      // Released: fire at what was painted (if ready).
      if (sh.weapon === "linemortar" && sh.strip) {
        if (sh.line.fire(sh.strip, this.lineStats(sh.own), bf.field, sh.line.fired + 1)) { this.onFire?.("linemortar"); sh.fired.strip = { ...sh.strip }; sh.fired.held = 0; }
      } else if (sh.weapon === "mortar") {
        if (sh.mortar.fire(sh.at.x, sh.at.z, this.mortarStats(sh.own))) this.onFire?.("mortar");
      } else if (sh.weapon === "missiles") {
        const picks = this.candidates().map((c) => ({ x: c.x, y: c.y, z: c.z, key: c.key }));
        if (sh.swarm.fire(sh.at.x, sh.at.z, this.swarmStats(sh.own), picks, bf.field)) this.onFire?.("missiles");
      } else if (sh.cool <= 0 && cur && magTake(sh.mag, magRounds(sh.proto?.split), sh.cost ?? 1)) {
        const st = this.rpgStats(sh.own, true);
        sh.cool = st.cooldown;
        this.fireRockets(launch.clone(), cur, st, shotRounds(sh.proto?.split));
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
      this.blast(this.tmp.set(r.pos.x, r.pos.y, r.pos.z), r.blast, r.damage, sh.own?.ap ?? v.salvoAp);
    }, (r) => {
      bf.sfx.playSound("mortar", this.tmp.set(r.p0.x, r.p0.y, r.p0.z), 0.7, 1.2 + Math.random() * 0.2);
      bf.dust.smoke(r.p0.x, r.p0.y, r.p0.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.35, 0.9, 0.7, 0.4);
      if (sh.model) sh.model.recoil.position.y = -0.08;
    }, this.bodyHit);
    for (const r of sh.line.rockets) if (r.live && r.launched) this.trail(r.prev, r.pos, 0.12 * v.salvoSmoke, 1);
    const mst = this.mortarStats(sh.own);
    sh.mortar.update(dt, (x, z) => {
      const from = this.shoulderMuzzle(sh, 0, new THREE.Vector3());
      const up = mortarHeight(x, z, u.lock, v);
      const to = { x, y: up ?? bf.field.height(x, z), z };
      const arc = lobArc(bf.field, from, to, v.mortarArc, v.mortarClear);
      bf.lob(u.team, from, x, z, v.mortarFlight, arc, mst.blast, mst.damage, up).pierce = sh.own?.ap ?? v.mortarAp;
      bf.sfx.playSound("mortar", from, 1.2, 0.75);
      for (let k = 0; k < 8; k++) bf.dust.smoke(from.x, from.y + 0.3, from.z, (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.5, 1.6, 0.75, 0.6);
      this.onShake?.(0.18);
      if (sh.model) sh.model.recoil.position.y = -0.3;
    });
    const track = (key: unknown) => this.findTarget(key);
    sh.swarm.update(dt, bf.field, (i, out) => { const m = this.shoulderMuzzle(sh, i, this.tmp); out.x = m.x; out.y = m.y; out.z = m.z; }, track, (m) => {
      this.blast(this.tmp.set(m.pos.x, m.pos.y, m.pos.z), m.blast, m.damage, sh.own?.ap ?? v.swarmAp);
    }, (m) => {
      bf.sfx.playSound("rocket", this.tmp.set(m.p0.x, m.p0.y, m.p0.z), 0.6, 1.1 + Math.random() * 0.2);
      if (sh.model) sh.model.recoil.position.z = -0.05;
    }, this.bodyHit);
    for (const m of sh.swarm.missiles) if (m.live && m.launched) this.trail(m.prev, m.pos, 0.16 * v.rpgSmoke, 2);
    if (sh.model) { sh.model.recoil.position.y += (0 - sh.model.recoil.position.y) * Math.min(1, dt * 6); sh.model.recoil.position.z += (0 - sh.model.recoil.position.z) * Math.min(1, dt * 8); }
    const ready = sh.weapon === "linemortar" ? sh.line.ready : sh.weapon === "mortar" ? sh.mortar.ready : sh.weapon === "missiles" ? sh.swarm.ready : sh.cool <= 0 && magReady(sh.mag);
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
    this.shells.fire(u.team, m, d, st, this.v.acPen).ap = st.ap;
    this.onFire?.("autocannon");
    this.bf.sfx.playSound("cannon", m, 1);
    this.bf.dust.smoke(m.x, m.y, m.z, d.x * 3, d.y * 3 + 0.5, d.z * 3, 0.3, 0.6, 0.6, 0.4);
    if (s.model) s.model.recoil.position.z = -0.3;
    this.onShake?.(0.04);
  }

  // ---- Effects ----

  /**
   * Where a rocket from `from` aimed at the cursor goes: the ground under the cursor, pulled in to range; or the body
   * of the lock the cursor is on (src/weapons/rocket.ts rocketAim).
   */
  private rpgPoint(from: THREE.Vector3, cur: THREE.Vector3): THREE.Vector3 {
    const p = rocketAim(from, cur, this.unit.lock, this.v.rpgRange, this.bf.field);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** The fraction of the way from a to b where a projectile meets a body of another team (-1: none). */
  private ha = new THREE.Vector3(); private hb = new THREE.Vector3();
  private bodyHit = (a: Vec3, b: Vec3) => {
    const h = firstBody(this.bf.targets, this.unit.team, this.ha.set(a.x, a.y, a.z), this.hb.set(b.x, b.y, b.z));
    return h ? h.f : -1;
  };

  /** n rockets at once (a Splitter's 3), fanned across the aim protoRocketFan° apart round the launcher. */
  private fireRockets(from: THREE.Vector3, cur: THREE.Vector3, st: RocketStats, n: number) {
    if (n <= 1) { this.fireRocket(from, cur, st); return; }
    const fan = (((this.bf.v as { protoRocketFan?: number }).protoRocketFan ?? 3) * Math.PI) / 180;
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * fan, cs = Math.cos(a), sn = Math.sin(a);
      const dx = cur.x - from.x, dz = cur.z - from.z;
      const x = from.x + dx * cs + dz * sn, z = from.z - dx * sn + dz * cs;
      this.fireRocket(from, new THREE.Vector3(x, this.bf.field.height(x, z), z), st, k > 0);
    }
  }

  private fireRocket(from: THREE.Vector3, cur: THREE.Vector3, st: RocketStats, quiet = false) {
    const bf = this.bf;
    this.rockets.fire(this.unit.team, from, this.rpgPoint(from, cur), st).ap = st.ap;
    if (quiet) return;
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

  /**
   * Where a rail on this side aims: at the lock (its centre) or the cursor, straight from the muzzle in plan (a slug
   * goes where you line it up, not where a lagging arm points); the barrel's heading with neither.
   */
  private railAim(side: 1 | -1, muzzle: THREE.Vector3): { d: THREE.Vector3; aim: Vec3 | null } {
    const u = this.unit;
    const aim: Vec3 | null = u.lock ? { x: u.lock.x, y: u.lock.y, z: u.lock.z } : u.cursor ? { x: u.cursor.x, y: u.cursor.y, z: u.cursor.z } : null;
    const d = this.dir;
    if (aim && Math.hypot(aim.x - muzzle.x, aim.z - muzzle.z) > 2) d.set(aim.x - muzzle.x, 0, aim.z - muzzle.z).normalize();
    else { u.body.barrel(side, d); d.y = 0; d.normalize(); }
    return { d, aim };
  }

  /** Points on the sand every 1.5 m along a sheet's line out to `end` (m along): the rail's aim line. */
  private lineOnSand(s: Sheet, end: number, out: Vec3[]) {
    out.length = 0;
    const n = Math.max(1, Math.min(63, Math.ceil(end / 1.5)));
    for (let i = 0; i <= n; i++) {
      const t = (end * i) / n, x = s.ox + s.dx * t, z = s.oz + s.dz * t;
      out.push({ x, y: this.bf.field.height(x, z), z });
    }
  }

  /**
   * Release: one slug, near instant, through a penetrating sheet (src/game/sheet.ts): every body on its line takes
   * damage by the budget left until the budget runs out (in a body or a dune). Then the show: a hard streak and a
   * lingering ionised trail (the draw), a big muzzle blast and kick, sparks and debris flung along the path at every
   * body, a strike where it ends (a puff and dent in sand, sparks on steel), the crack and thump.
   */
  private fireRail(s: Side, side: 1 | -1, muzzle: THREE.Vector3, d: THREE.Vector3, aim: Vec3 | null, st: RailStats, power: number) {
    const bf = this.bf, u = this.unit, v = this.v, field = bf.field;
    const dir = d.clone();
    const f = railSheet(v, st, aim);
    const sheet = bf.makeSheet(muzzle, dir, st.range, f);
    this.onFire?.("rail");
    const shot = bf.resolveSheet(u.team, sheet, st.damage * power, f, dir);
    this.last.rail = shot.dealt;
    this.last.railHits = shot.result.steps.length;
    this.last.railGround = shot.result.inGround ? 1 : 0;
    // The slug's straight path: from the muzzle toward the slug height over the ground at the aim, out to where it
    // stopped (into the ground when a dune stopped it).
    const L = shot.result.end;
    const aimFlat = aim ? Math.max(2, Math.hypot(aim.x - muzzle.x, aim.z - muzzle.z)) : 30;
    const aimY = aim ? field.height(aim.x, aim.z) + v.railSlugHeight : field.height(muzzle.x + dir.x * 30, muzzle.z + dir.z * 30) + v.railSlugHeight;
    const rise = (aimY - muzzle.y) / aimFlat;
    const yAt = (t: number) => {
      const x = muzzle.x + dir.x * t, z = muzzle.z + dir.z * t;
      return Math.max(field.height(x, z) + 0.25, muzzle.y + rise * t);
    };
    const path: Vec3[] = [];
    const n = Math.max(1, Math.min(60, Math.ceil(L / 2)));
    for (let i = 0; i <= n; i++) {
      const t = (L * i) / n;
      path.push({ x: muzzle.x + dir.x * t, y: yAt(t), z: muzzle.z + dir.z * t });
    }
    path[0] = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
    const to = path[path.length - 1];
    if (shot.result.inGround) to.y = field.height(to.x, to.z);
    const hits: Vec3[] = [];
    // Every body it went through: sparks and debris flung along the path (steel), a burst of cloth and dust (flesh).
    for (const step of shot.result.steps) {
      const h = step.hit;
      const at = new THREE.Vector3(h.x, yAt(h.along) * 0.5 + h.y * 0.5, h.z);
      hits.push({ x: at.x, y: at.y, z: at.z });
      const surface = h.target ? h.target.surface : "metal";
      if (surface === "flesh") { bf.gunFx.onFleshHit?.(at, dir); bf.gunFx.onFleshHit?.(at, dir); }
      else { bf.gunFx.sparksAt(at, dir, 16, 14); bf.gunFx.sparksAt(at, this.tmp2.copy(dir).negate(), 6, 6); }
      bf.dust.smoke(at.x, at.y, at.z, dir.x * 4, 0.6, dir.z * 4, 0.35, 0.9, 0.6, 0.8);
    }
    for (const x of shot.exits) bf.gunFx.sparksAt(x, dir, 8, 12);
    // The shock wave under the slug lifts sand where it flies low.
    for (let k = 2; k < path.length; k += 2) {
      const p = path[k], g = field.height(p.x, p.z);
      if (p.y - g > 3) continue;
      if (bf.inWater(p.x, p.z)) { bf.water?.splash(p.x, p.z, 0.4, dir.x, dir.z, 0.6); continue; }
      bf.dust.kick(p.x, g, p.z, dir.x, dir.z, (0.5 + power * 0.5) * (1 - (p.y - g) / 3));
    }
    // The strike where it ends: sparks on steel, a puff and dent in the sand.
    const last = shot.result.steps[shot.result.steps.length - 1];
    const endV = new THREE.Vector3(to.x, to.y, to.z);
    if (last?.stopped && (last.hit.target ? last.hit.target.surface : "metal") === "metal") bf.gunFx.sparksAt(endV, this.tmp2.copy(dir).negate(), 26, 16);
    else if (bf.inWater(to.x, to.z)) bf.water?.splash(to.x, to.z, 1.2, dir.x, dir.z, 1.4);
    else if (!last?.stopped) {
      const g = field.height(to.x, to.z);
      bf.dust.hit(to.x, g, to.z, dir.x, dir.z, 2.5 + power);
      bf.marks.crater(to.x, to.z, 2 + power);
    }
    // The muzzle: a big blast of smoke and sand, sparks off the rails, the kick and shake.
    const b = v.railBlast * (0.6 + 0.4 * power);
    if (b > 0) {
      for (let k = 0; k < 8; k++) {
        const sp = 2 + Math.random() * 6;
        bf.dust.smoke(muzzle.x + dir.x * 0.6, muzzle.y, muzzle.z + dir.z * 0.6, dir.x * sp + (Math.random() - 0.5) * 3, 0.4 + Math.random() * 1.5, dir.z * sp + (Math.random() - 0.5) * 3, 0.45 * b, 0.9 + Math.random() * 0.6, 0.55, 0.3);
      }
      bf.gunFx.sparksAt(muzzle, dir, Math.round(12 * b), 12);
      const g = field.height(muzzle.x, muzzle.z);
      if (muzzle.y - g < 6) bf.dust.stomp(muzzle.x + dir.x * 2, g, muzzle.z + dir.z * 2, 1.4 * b);
    }
    this.railShots.push({ path, from: { x: muzzle.x, y: muzzle.y, z: muzzle.z }, to, hits, age: 0, power, seed: Math.random() * 100, dir: { x: dir.x, y: 0, z: dir.z } });
    bf.sfx.playSound("rail", muzzle, 0.7 + 0.3 * power, 1.05 - 0.1 * power);
    u.upper.guns[side === 1 ? 0 : 1].kick = v.railKick;
    u.upper.shake = Math.min(0.08, u.upper.shake + 0.05 * power);
    if (s.model) s.model.recoil.position.z = -v.railKick * 1.5;
    this.onShake?.(v.railShake * power);
  }

  /**
   * One step of a shell's flight as a sheet (src/game/sheet.ts): its path in plan, the band from under the ground to
   * acSheetUp over the shell. Bodies it can pay to pass take damage by the budget left (sparks out the far side); the
   * one it can't stops it (damaged here; the burst follows).
   */
  private shellSweep = (s: Shell, a: THREE.Vector3, b: THREE.Vector3): { at: THREE.Vector3; t: Hittable | null } | null => {
    const bf = this.bf, v = this.v;
    const fl = Math.hypot(b.x - a.x, b.z - a.z);
    if (fl < 1e-4) return null;
    const ay = a.y, by = b.y;
    const sheet: Sheet = {
      ox: a.x, oz: a.z, dx: (b.x - a.x) / fl, dz: (b.z - a.z) / fl, from: 0, len: fl, half: v.acSheetHalf, under: v.sheetUnder,
      top: (t) => ay + ((by - ay) * t) / fl + v.acSheetUp, ground: (x, z) => bf.field.height(x, z),
    };
    const d = this.tmp2.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    // The damage this shell still carries, by the budget it has left (the walk's share is relative to what it's given).
    const k = s.pen0 > 0 ? Math.pow(Math.max(0, s.pen / s.pen0), v.penCurve) : 1;
    const shot = bf.resolveSheet(s.team, sheet, s.damage * k, { half: v.acSheetHalf, height: v.acSheetUp, pen: Math.max(1e-3, s.pen), pierce: s.ap }, d, true,
      (h) => s.passed.some((p) => p.t === h.target && p.key === h.key));
    if (!shot.result.steps.length) return null;
    for (const st of shot.result.steps) s.passed.push({ t: st.hit.target, key: st.hit.key });
    for (const x of shot.exits) bf.gunFx.sparksAt(x, d, 4, 7);
    s.pen = shot.result.left;
    const last = shot.result.steps[shot.result.steps.length - 1];
    return last.stopped ? { at: shot.end, t: last.hit.target ?? null } : null;
  };

  /** An autocannon shell bursts: the target it struck takes the shell (unless a sweep already hit it), everything near takes a share. */
  private cannonBurst(team: number, at: THREE.Vector3, t: Hittable | null, damage: number, splash: number, vel: THREE.Vector3, swept = false, ap?: number) {
    const bf = this.bf, v = this.v;
    const d = this.dir.copy(vel).normalize();
    if (t) { if (!swept) t.damage(damage, at, d, ap); bf.gunFx.sparksAt(at, this.tmp2.copy(d).negate(), 8, 7); }
    if (splash > 0) splashBlast(bf.targets, team, at, splash, damage * v.acSplashShare, d, t, ap);
    if (!t && bf.inWater(at.x, at.z)) bf.water?.splash(at.x, at.z, 1, d.x, d.z, 1.2);
    else { bf.dust.hit(at.x, at.y, at.z, d.x, d.z, 1.8); if (!t) bf.marks.crater(at.x, at.z, 1.3); }
    for (let k = 0; k < 4; k++) bf.dust.smoke(at.x, at.y + 0.3, at.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.3, 0.8, 0.7, 0.75);
    bf.sfx.play("brap", at, 0.9, 0.8, true);
  }

  /** A rocket, missile or shell's blast: the battlefield's one blast entry point (crater queued, dust, sound, splash). */
  private blast(at: THREE.Vector3, radius: number, damage: number, ap?: number) {
    this.bf.blast(this.unit.team, at.clone(), radius, damage, ap);
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
    // Sprinting with the weapons off (src/mech/bound.ts): SPRINT, then the controls dimmed.
    if (this.unit.gunsOff) return [`<b style="color:#ffb347">SPRINT</b> <span style="opacity:.4">weapons off · ${this.controlList().join(" · ")}</span>`];
    return this.controlList();
  }

  private controlList(): string[] {
    const out: string[] = [];
    const u = this.unit;
    this.sides.forEach((s, i) => {
      const b = i === 0 ? "LMB" : "RMB";
      if (!s.kind) { out.push(`${b} —`); return; }
      const g = u.upper.guns[i];
      let state = "";
      if (s.kind === "rail") state = s.rail.cooldown > 0 ? `${s.rail.cooldown.toFixed(1)} s` : s.rail.holding ? `charge ${Math.round(s.rail.charge * 100)}%` : "hold to charge";
      else if (g.mag.reloading > 0) state = `<b style="color:#ffb347">reload ${g.mag.reloading.toFixed(1)} s</b>`;
      else if (s.kind === "rpg") state = `${Math.ceil(g.ammo)}/${g.mag.size}${s.cool > 0 ? ` ${s.cool.toFixed(1)} s` : ""}`;
      else state = `${Math.ceil(g.ammo)}/${g.mag.size}`;
      out.push(`${b} ${NAMES[s.kind]}${s.light ? " (hand)" : ""} ${state}`);
    });
    for (const sh of this.shoulders) {
      if (sh.gear) {
        const g = sh.gear, st = g.stats;
        const what = st.family === "power" ? "discharge" : st.round ? "ignited rounds" : "overdrive";
        out.push(`${sh.key} ${NAMES[sh.weapon]} ${g.left > 0 ? `<b style="color:#ffb347">${what} ${g.left.toFixed(1)} s</b>` : g.cool > 0 ? `${g.cool.toFixed(1)} s` : "ready"}`);
        continue;
      }
      const cd = sh.weapon === "linemortar" ? sh.line.cooldown : sh.weapon === "mortar" ? sh.mortar.cooldown : sh.weapon === "missiles" ? sh.swarm.cooldown : Math.max(sh.cool, sh.mag.reloading);
      const left = sh.weapon === "rpg" ? ` ${Math.ceil(sh.mag.left)}/${sh.mag.size}` : "";
      out.push(`${sh.key} ${NAMES[sh.weapon] ?? sh.weapon}${left} ${cd > 0 ? `${sh.mag.reloading > 0 ? "reload " : ""}${cd.toFixed(1)} s` : sh.held ? "aiming" : "ready"}`);
    }
    return out;
  }
}
