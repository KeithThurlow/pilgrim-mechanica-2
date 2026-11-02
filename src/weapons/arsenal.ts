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
import type { WaveKind } from "../fx/blastWaves";
import * as THREE from "three/webgpu";
import type { Battlefield, Hittable, Parry } from "../game/battlefield";
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
import { SwarmSim, channelAim, type SwarmStats } from "./swarm";
import { CLIP_SEAT, nextTube, reloadShare } from "./clip";
import { WEAPON_MODELS, type WeaponModel, type ModelKind } from "./models";
import { addWeaponSounds } from "./weaponSound";
import { rayGround } from "../world/raycast";
import { newMag, magReady, magReload, magResize, magStep, magTake, shotRounds, type Mag } from "./magazine";
import type { ShotProtocols } from "../game/shots";
import { famOfTeam } from "../world/lamps";
import { SwordSim, cutDamage, powerStats, lungeIntent, sweepTimes, swordCuts, clipPose, clipLength, twistTarget, springStep, type SwordStats, type SwordPose, type SwordClip } from "./sword";
import { SwordSwish } from "./swordSwish";
import type { HeldPose } from "../mech/rampart";
import { sheetHits } from "../game/sheetFire";
import { penDensity, type SheetHit } from "../game/sheet";
import { hitStop } from "../game/hitStop";
import { EnergyGuns } from "./energy/energyGuns";
import { isEnergy } from "./energy/energySim";
import type { EnergyKind } from "./models";

import { gunFeel, gunNumbers, isRoundGun, type RoundGun } from "./guns";

type SideKind = "rail" | "autocannon" | "rpg" | "minigun" | "melee" | "energy" | RoundGun | null;

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
  /** The weapon's base id (a sword's posed keys). */
  base?: string;
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
  /** A rocket pod: the next tube to fire from. */
  tube: number;
  /** Clip-fed (rockets, the arm missile pod): seconds off the trigger with rounds spent (the top-up swap), and the
   *  reload's share last frame (its sounds). */
  idle: number;
  seat: number;
  /** The arm missile pod (Light rpg): its missiles, the values they fly by, and whether it's channelling now. */
  swarm: SwarmSim;
  sv: WeaponValues;
  channel: boolean;
  /** The sword (melee): its swing, the bodies this swing has hit (by target, then its unit key), the swing's cleave
   *  budget left, whether it has bitten yet, and the swish (the ribbon the blade sweeps, its clock, the bent air's
   *  spacing). */
  sword: SwordSim;
  swordHits: Map<Hittable, Set<number>>;
  swingSeen: number;
  cleave: number;
  bit: boolean;
  swish: SwordSwish | null;
  swishT: number;
  swishAir: number;
  swishLast: THREE.Vector3;
  /** The waist's twist this sword asks for (radians, + the mech's left) and its spring's speed. */
  twist: number;
  twistV: number;
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
  /** RPG: the clip swap (seconds idle with rounds spent, the reload's share last frame). */
  idle: number;
  seat: number;
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
const swordBuf: SheetHit<Hittable>[] = [];
/** A power cut's swish (Keith 2026-11-02): blue for players, red for enemies. */
const POWER_BLUE = new THREE.Color(0x3fa8ff), POWER_RED = new THREE.Color(0xff3a2a);
const NAMES: Record<string, string> = { laser: "pulse laser", beam: "beam laser", lance: "nova lance", plasma: "plasma cannon", orb: "particle orb", arc: "arc caster", melee: "sword", rail: "rail cannon", autocannon: "autocannon", rpg: "rocket launcher", minigun: "minigun", smg: "SMG", rifle: "battle rifle", shotgun: "scattergun", sniper: "longshot rifle", flak: "flak cannon", missiles: "missile pod", mortar: "big mortar", linemortar: "line mortar", beltfeed: "belt feed", incendiary: "incendiary feed", capacitor: "capacitor bank" };
/** Short names for the action bar's buttons. */
const SHORT: Record<string, string> = { rpg: "Rockets", missiles: "Missiles", mortar: "Mortar", linemortar: "Line mortar", beltfeed: "Overdrive", incendiary: "Ignite", capacitor: "Discharge" };
/** A shoulder or back key's state for the action bar (seconds; coolMax/leftMax when the sim knows them). */
export interface KeySlot { key: string; name: string; cool: number; coolMax?: number; left: number; leftMax?: number; aiming: boolean; off: boolean; rounds?: string; reloading?: boolean }
const newLaser = (): Laser => ({ on: false, from: new THREE.Vector3(), to: new THREE.Vector3(), k: 0 });

export class Arsenal implements MechWeapons {
  readonly shells = new CannonShells();
  readonly rockets = new Rockets();
  readonly sides: [Side, Side];
  shoulders: Shoulder[] = [];
  /** Rail beams fired recently (the draw fades them). */
  readonly railShots: RailShot[] = [];
  /** Energy weapons on either side (Keith 2026-11-02, src/weapons/energy/): pulse laser, beam laser, nova lance. */
  readonly energy: EnergyGuns;
  /** Camera shake asked for (the lab decays it). */
  onShake: ((k: number) => void) | null = null;
  /** Called as a weapon fires (its kind), before its damage lands: the lab's per-shot readout. */
  onFire: ((kind: string) => void) | null = null;
  /** Damage of the last rail beam (exact; the lab measures the rest on its targets). */
  last: Record<string, number> = {};
  private clock = 0;
  /** An AI's aim is frozen for the shot (src/combat/rivalAi.ts, track then snapshot): the rail's line draws solid. Cosmetic. */
  railSnapped = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private frame = new THREE.Matrix4();
  private sh = new THREE.Vector3();
  private sh2 = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private prevTrig: [boolean, boolean] = [false, false];
  /** Where a target is now, by its key (a missile's), or null once it's gone: the register's lookup by id. */
  findTarget!: (key: unknown) => { x: number; y?: number; z: number } | null;
  /** Whose fire this is, for its lights' colour (src/world/lamps.ts; a rival's rockets light red-orange). */
  readonly fam: number;

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues, private look: ToonLook,
    /** Targets the snap, the swarm and the leads can see (the lab's candidates). */
    public candidates: () => TargetCandidate[] = () => []) {
    this.fam = famOfTeam(unit.team);
    if (!this.findTarget) this.findTarget = (key) => { const c = this.candidates().find((x) => x.key === key); return c ? { x: c.x, z: c.z } : null; };
    const side = (): Side => ({ kind: null, light: false, own: null, rail: new RailSim(v), cool: 0, paint: newPaint(), model: null, whined: false, laser: newLaser(), aimLine: [], meterAt: null, proto: undefined, cost: 1, tube: 0, idle: 0, seat: -1, swarm: new SwarmSim({ ...v }), sv: { ...v }, channel: false,
      sword: new SwordSim(1), swordHits: new Map(), swingSeen: 0, cleave: 0, bit: false, swish: null, swishT: 0, swishAir: 0, swishLast: new THREE.Vector3(), twist: 0, twistV: 0 });
    this.sides = [side(), side()];
    this.sides[1].sword = new SwordSim(-1);
    this.energy = new EnergyGuns(bf, unit, v, () => this.candidates());
    this.energy.onShake = (k) => this.onShake?.(k);
    this.energy.onFire = (k) => this.onFire?.(k);
    addWeaponSounds(bf.sfx, v);
  }

  // ---- What's fitted ----

  configure(r: Resolved) {
    const body = this.unit.body;
    const guns = [r.guns.left, r.guns.right];
    this.sides.forEach((s, i) => {
      const g = guns[i];
      const kind: SideKind = !g ? null : isEnergy(g.cls) ? "energy" : g.cls === "melee" ? "melee" : g.cls === "rail" ? "rail" : g.cls === "autocannon" ? "autocannon" : g.cls === "rpg" ? "rpg" : isRoundGun(g.cls) ? g.cls : "minigun";
      const mk: ModelKind | null = kind === "energy" ? g!.cls as EnergyKind : kind === "rail" ? (g!.light ? "railLight" : "rail") : kind === "autocannon" ? "autocannon" : kind === "rpg" ? (g!.light ? "rpgLight" : "rpg") : kind === "melee" ? "sword" : null;
      if (s.model && s.model.kind !== mk) { s.model.root.removeFromParent(); s.model = null; }
      if (kind !== "melee" && s.swish) { s.swish.mesh.removeFromParent(); s.swish = null; }
      if (kind !== "melee") body.holdPose?.(i === 0 ? 1 : -1, null);
      body.setTwist?.(0);
      s.kind = kind; s.light = !!g?.light; s.own = g?.own ?? null; s.base = g?.base; s.proto = g?.proto; s.cost = g?.cost ?? 1;
      if (mk && !s.model && body.mount) { s.model = WEAPON_MODELS[mk](this.look, i === 0 ? "left" : "right"); body.mount(i === 0 ? "left" : "right").add(s.model.root); }
      body.showPod?.(i === 0 ? 1 : -1, kind === "minigun" || kind === null);
      s.rail.charge = 0; s.rail.holding = false; s.cool = 0; s.idle = 0; s.seat = -1; s.channel = false;
      s.sword.stop(); s.swordHits.clear(); s.swish?.clear(); s.twist = s.twistV = 0;
      this.energy.configure(i, kind === "energy" && isEnergy(g!.cls) ? g!.cls : null, g?.own ?? null);
      // A clip-fed launcher shows its magazine (src/weapons/clip.ts).
      if (s.model) s.model.clip = kind === "rpg" ? this.unit.upper.guns[i].mag : null;
    });
    for (const sh of this.shoulders) sh.model?.root.removeFromParent();
    this.shoulders = r.shoulders.map((x) => {
      const mk: ModelKind = x.weapon === "rpg" ? "shoulderRpg" : x.weapon;
      const model = body.mount ? WEAPON_MODELS[mk](this.look, x.mount === "shoulderL" ? "left" : "right") : null;
      if (model && body.mount) body.mount(x.mount).add(model.root);
      const gear = x.family === "launcher" ? null : new GearSim(gearStats(x.weapon, x.own, this.v));
      const mag = newMag(x.own?.magazine ?? this.v.rpgShoulderMag, x.own?.reload ?? this.v.rpgShoulderReload);
      if (model) model.clip = x.weapon === "rpg" ? mag : null;
      return { ...x, gear, model, paint: newPaint(), fired: newPaint(), held: false, cool: 0, mag, idle: 0, seat: -1, line: new SalvoSim(this.v), mortar: new MortarSim(this.v), swarm: new SwarmSim(this.v), strip: null, at: { x: 0, z: 0 }, laser: newLaser() };
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
  /** light: an arm's rocket pod (its own sliders). */
  rpgStats(o: Record<string, number> | null, shoulder: boolean, light = false): RocketStats {
    const v = this.v;
    if (o) return { damage: o.damage, blast: o.blast, speed: o.shellSpeed, cooldown: o.cooldown, ap: o.ap ?? v.rpgAp };
    if (light) return { damage: v.rpgDamage * v.podDamage, blast: v.podBlast, speed: v.rpgSpeed, cooldown: v.podCooldown, ap: v.rpgAp };
    return { damage: v.rpgDamage, blast: v.rpgBlast, speed: v.rpgSpeed, cooldown: shoulder ? v.rpgShoulderCooldown : v.rpgCooldown, ap: v.rpgAp };
  }
  /**
   * The pose lab (labs/pose/): hold a side's sword at a point of a move (clip, time in s, reach 0 close .. 1 far)
   * instead of swinging it; no cuts. null: swing as normal. Lab only.
   */
  swordHold: ((side: 1 | -1) => { clip: SwordClip; t: number; span: number } | null) | null = null;
  /** Each side's last sword frame (0 left, 1 right): its shoulder in the hull's frame, the aim's yaw off the hull, its
   *  stats and reach (the pose lab reads poses back through these). */
  readonly swordFrame: ({ shoulder: THREE.Vector3; aimYaw: number; st: SwordStats; span: number; clip: SwordClip; t: number } | null)[] = [null, null];
  /** A side's sword stats (0 left, 1 right), or null when it holds no sword. */
  swordStatsOf(i: number): SwordStats | null { const s = this.sides[i]; return s.kind === "melee" ? this.swordStats(s) : null; }

  swordStats(s: Side): SwordStats {
    const st = this.swordBase(s);
    return s.sword.power ? powerStats(st, this.v) : st;
  }
  /** A side's sword stats before a power cut's (src/weapons/sword.ts powerStats). */
  private swordBase(s: Side): SwordStats {
    const v = this.v, o = s.own;
    return o ? { damage: o.damage, ap: o.ap ?? v.swordAp, reach: o.reach, arc: o.swing, windup: o.windup, slash: o.slash, recover: o.recover, cleave: o.cleave, parry: o.parry ?? 1, heft: o.heft ?? 1, stance: o.stance ?? 0, pose: s.base }
      : { damage: v.swordDamage, ap: v.swordAp, reach: v.swordReach, arc: v.swordArc, windup: v.swordWindup, slash: v.swordSlash, recover: v.swordRecover, cleave: v.swordCleave, parry: 1, heft: 1, stance: 1, pose: s.base ?? "sword-light" };
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
    // A dead owner is cold whatever called it (a held rail would fire on release, a painted shot too).
    if (!alive) this.stop();
    // The faint targeting laser: brighter as the sun goes down.
    const night = Math.min(1, Math.max(0, (0.35 - bf.sunDir.y) / 0.4));
    const laserK = v.laserDay + (v.laserNight - v.laserDay) * night;

    this.sides.forEach((s, i) => {
      const side: 1 | -1 = i === 0 ? 1 : -1;
      const g = u.upper.guns[i];
      const held = alive && triggerOf(trigger, i) && g.enabled;
      // Sprinting with the weapons off (src/mech/bound.ts): a rail's charge is dropped, not fired. So in a dash (Keith
      // 2026-10-31, rail balance: no dash while a rail is charging or charged; the dash wins and the charge is lost), and
      // no charge builds until the dash is over.
      const noRail = u.gunsOff || u.sim.inDash;
      if (noRail && s.rail.holding) { s.rail.holding = false; s.rail.charge = 0; s.whined = false; }
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
      // An unrolled round gun (the picker's) runs on its sliders, live, like the autocannon.
      if (isRoundGun(s.kind) && !s.own && g.stats) {
        const n = gunNumbers(s.kind, v);
        Object.assign(g.stats, { fireRate: n.fireRate, damage: n.damage, spread: n.spread, range: n.range, pierce: n.pierce, ap: n.ap, ammo: n.magazine, reload: n.reload, pellets: n.pellets, splash: n.splash, splashShare: n.splashShare });
        u.upper.sizeMag(g);
      }
      // Targeting laser on the minigun, the rocket launcher, the rifle and the sniper rifle, along the gun.
      s.laser.on = alive && (s.kind === "minigun" || s.kind === "rpg" || s.kind === "rifle" || s.kind === "sniper") && laserK > 0;
      if (s.laser.on) this.laserAlong(s.laser, s.model?.laserFrom ? s.model.laserFrom.getWorldPosition(this.tmp) : this.muzzleOf(s, side, this.tmp), u.body.barrel(side, this.dir), laserK);
      if (s.kind === "melee") { this.stepSword(s, held, dt); clearPaint(s.paint); return; }
      if (s.kind === "energy") {
        // Energy weapons (src/weapons/energy/energyGuns.ts): a dash or the sprint drops a charge and stops a beam. The
        // lamps follow a lance's charge and a beam.
        const muzzle = this.muzzleOf(s, side, this.tmp);
        const { d, aim } = this.railAim(side, muzzle);
        this.energy.step(i, dt, held, noRail, muzzle, d, aim);
        const es = this.energy.sides[i];
        for (const mat of glows) mat.opacity = es.cls === "lance" ? 0.2 + 0.8 * es.sim.charge : es.beam.on ? 1 : 0.45;
        clearPaint(s.paint);
        return;
      }
      if (s.kind === "rpg") {
        // Clip-fed (Keith 2026-10-31): held, the clip ripples out a rocket every cooldown at the ground under the cursor,
        // tube by tube (this side's magazine, in the gun record: the HUD reads it there; a click fires one), then the
        // clip is swapped. The arm's missile pod channels instead (stepChannel).
        if (!s.own) magResize(g.mag, s.light ? v.podMag : v.rpgMag, s.light ? v.podReload : v.rpgReload);
        if (s.model && s.model.clip !== g.mag) s.model.clip = g.mag;
        this.clipSwap(s, g.mag, held || pressed, dt, u.sim.pelvis);
        if (s.light) { this.stepChannel(s, side, g.mag, held, dt); return; }
        if ((held || pressed) && s.cool <= 0 && u.cursor) {
          const tube = nextTube(g.mag);
          if (magTake(g.mag, 1, s.cost)) {
            const st = this.rpgStats(s.own, false, s.light);
            s.cool = st.cooldown;
            this.fireRockets(this.muzzleOf(s, side, this.tmp, tube), u.cursor, st, s.proto);
            if (s.model) s.model.recoil.position.z = -0.35;
          }
        }
        clearPaint(s.paint);
        return;
      }
      if (s.kind !== "rail") { clearPaint(s.paint); return; }
      const st = this.railStats(s);
      const railHeld = held && !noRail;
      if (railHeld && !s.rail.holding && s.rail.cooldown <= 0 && !s.whined) { s.whined = true; bf.sfx.playSound("railCharge", u.sim.pelvis, 1, 1 / Math.max(0.3, st.charge)); }
      if (!railHeld) s.whined = false;
      const fired = s.rail.update(dt, railHeld, st);
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

    this.energy.age(dt);

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
      this.blast(at, r.blast, r.damage, r.ap, "rocket");
    });
    if (v.rpgSmoke > 0) for (const r of this.rockets.list) if (r.live) this.trail(r.prev, r.pos, 0.3 * v.rpgSmoke, 4);
  }

  /**
   * A clip's swap (Keith 2026-10-31: a reload you can see and hear): a part-used clip off the trigger for rocketTopUp s
   * is swapped too; the empty clip drops with a clank, the full one seats with a clunk (src/weapons/clip.ts).
   */
  private clipSwap(c: { idle: number; seat: number }, m: Mag, firing: boolean, dt: number, at: Vec3) {
    const v = this.v;
    if (firing || m.reloading > 0 || m.left >= m.size) c.idle = 0;
    else if (v.rocketTopUp > 0 && (c.idle += dt) >= v.rocketTopUp) { magReload(m); c.idle = 0; }
    const p = reloadShare(m), sfx = this.bf.sfx, pos = this.tmp2.set(at.x, at.y, at.z);
    if (p >= 0 && c.seat < 0) sfx.playSound("clipOut", pos, 0.8, 0.9 + Math.random() * 0.2);
    if (p >= CLIP_SEAT && c.seat >= 0 && c.seat < CLIP_SEAT) { sfx.playSound("clipIn", pos, 1, 0.9 + Math.random() * 0.15); this.onShake?.(0.03); }
    c.seat = p;
  }

  /**
   * The arm missile pod (Keith 2026-10-31: "missiles on arms ... should work like [the shoulder battery], almost like a
   * channelling weapon"): held, a missile leaves the next tube every cooldown at what's under the cursor (the lock, or
   * the enemies within podReach shared in turn, or a scatter), for as long as it's held and the clip lasts; let go, it
   * stops. The walk slows while it channels (moveMul).
   */
  private stepChannel(s: Side, side: 1 | -1, mag: Mag, held: boolean, dt: number) {
    const u = this.unit, v = this.v, bf = this.bf;
    Object.assign(s.sv, v, { swarmRise: v.podRise, swarmSpeed: v.podSpeed, swarmDrop: v.podDrop, swarmFan: 0.6 });
    s.swarm.v = s.sv; s.swarm.ahead = 4;
    const cur = u.cursor, p = s.paint;
    s.channel = held && !!cur && magReady(mag);
    if (held && cur) {
      // Its reach on the sand round the cursor while held (no beam: it isn't painting).
      p.on = true; p.held += dt; p.charge = 1; p.beamScale = 0; p.tint = null; p.strip = null; p.arc.length = 0;
      p.ring = { x: cur.x, z: cur.z, r: Math.max(1, v.podReach) }; p.ready = magReady(mag);
      p.beamFrom = { x: cur.x, y: cur.y, z: cur.z }; p.beamTo = p.beamFrom;
    } else clearPaint(p);
    if (s.channel && s.cool <= 0 && cur) {
      const tube = nextTube(mag);
      if (magTake(mag, 1, s.cost)) {
        const st = this.rpgStats(s.own, false, true);
        s.cool = st.cooldown;
        const n = shotRounds(s.proto?.split, 1, s.proto?.multi), picks = this.candidates().map((c) => ({ x: c.x, y: c.y, z: c.z, key: c.key }));
        for (let k = 0; k < n; k++) s.swarm.launchOne(channelAim(cur.x, cur.z, s.swarm.fired, v.podReach, picks, u.lock), st.damage, st.blast, tube, bf.field);
        if (s.model) s.model.recoil.position.z = -0.12;
        // The clip's last missile out: the walk picks up again (it reloads, not channels).
        s.channel = magReady(mag);
      }
    }
    s.swarm.update(dt, bf.field, (i, out) => { const m = this.muzzleOf(s, side, this.tmp, i); out.x = m.x; out.y = m.y; out.z = m.z; }, (key) => this.findTarget(key), (m) => {
      this.blast(this.tmp.set(m.pos.x, m.pos.y, m.pos.z), m.blast, m.damage, s.own?.ap ?? v.rpgAp, "missile");
    }, (m) => {
      this.onFire?.("rpg");
      bf.sfx.playSound("rocket", this.tmp.set(m.p0.x, m.p0.y, m.p0.z), 0.7, 1.15 + Math.random() * 0.2);
      bf.nightLights?.launch(m.p0.x, m.p0.y, m.p0.z, 0.5, this.fam);
      bf.dust.smoke(m.p0.x, m.p0.y, m.p0.z, (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.5, 0.3, 0.8, 0.7, 0.3);
    }, this.bodyHit);
    for (const m of s.swarm.missiles) if (m.live && m.launched) this.trail(m.prev, m.pos, 0.14 * v.rpgSmoke, 2);
  }

  /**
   * The sword (src/weapons/sword.ts): the moves step on the trigger (rest, the cut across to under the far shoulder,
   * the back-cut, the return past the waist) and set the arm's pose; the body reaches a two-bone arm to its hand.
   * Through a cut the blade is a vertical sheet from the hand out to the reach, sampled through the time it swept this
   * step. Each body it crosses is hit once per cut (damage, knock along the cut, sparks, a crunch), paying its chord ×
   * density out of the cut's cleave budget; once that's spent the rest of the cut passes over them. The first bite stalls
   * the blade, shakes the camera and (the local player's own cut) asks for hit stop.
   */
  private stepSword(s: Side, held: boolean, dt: number) {
    const u = this.unit, v = this.v, bf = this.bf, sw = s.sword, body = u.body;
    const st = this.swordStats(s);
    // Close or far (Keith 2026-11-01): the cut's reach from how far off the aim is (the lock, else the cursor), on the
    // lunge's scale: within its no-lunge distance the bent-elbow draw cut, from its full-lunge distance the full sweep.
    // Scrubbing (a look slider): the arm held at a point of A (0..1) or B (1..2), at the aim's reach; no cuts.
    const held0 = this.swordHold?.(sw.side) ?? null;
    const scrub: { clip: SwordClip; share: number; span: number; t?: number } | null = held0 ? { clip: held0.clip, share: 0, span: held0.span, t: held0.t }
      : v.swordScrub > 0 ? { clip: (v.swordScrub <= 1 ? "A" : "B") as "A" | "B", share: v.swordScrub <= 1 ? v.swordScrub : v.swordScrub - 1, span: this.reachShare() } : null;
    const sweep = scrub ? null : sw.update(dt, held, st, v, this.reachShare());
    if (scrub) sw.lungeK = 0;
    if (sw.swings !== s.swingSeen) { s.swingSeen = sw.swings; s.swordHits.clear(); s.cleave = st.cleave; s.bit = false; }
    // The hull's frame and this side's shoulder in it (a body without them: a frame on the pelvis along the torso).
    const frame = this.frame;
    if (body.hullFrame) body.hullFrame(frame);
    else frame.compose(this.tmp2.copy(u.sim.pelvis), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), u.upper.torsoYaw), new THREE.Vector3(1, 1, 1));
    // A sword arm's shoulder sits further out from the hull, to make room for the blade (Keith 2026-11-01, round 4).
    const shoulder = body.shoulderAt ? body.shoulderAt(sw.side, this.sh) : this.sh.set(sw.side * 1.02, 0.89, 0);
    shoulder.x += sw.side * v.swordShoulderOut;
    // The waist (Keith 2026-11-01, round 7): a spring toward where the swing wants the torso, so it lags the blade and
    // swings on past it. Both swords' twists add (dual swords: a cut each way partly cancels), up to swordTwistMax.
    const D2R = Math.PI / 180;
    // A close cut turns the waist less (0.5 ×).
    const want = u.alive ? sw.side * (scrub ? twistTarget(scrub.clip, scrub.t ?? scrub.share * clipLength(scrub.clip, st, v, scrub.span), st, v, scrub.span) : twistTarget(sw.clip, sw.t, st, v, sw.span)) * v.swordTwist * D2R * (0.5 + 0.5 * sw.span) : 0;
    for (let left = dt; left > 1e-6; left -= 1 / 120) [s.twist, s.twistV] = springStep(s.twist, s.twistV, want, v.swordTwistHz, v.swordTwistDamp, Math.min(left, 1 / 120));
    let total = 0;
    for (const o of this.sides) if (o.kind === "melee") total += o.twist;
    const tmax = v.swordTwistMax * D2R;
    // Drawn only (Keith 2026-11-01: "without affecting weapon aims"): the hull turns, the guns on it turn back. The
    // sword's pose is in the drawn hull's frame, so the sword (and its cut) turns with the waist.
    body.setTwist?.(Math.max(-tmax, Math.min(tmax, total)));
    const aimYaw = u.upper.guns[sw.side === 1 ? 0 : 1].yaw;
    const scrubT = scrub ? scrub.t ?? scrub.share * clipLength(scrub.clip, st, v, scrub.span) : 0;
    const pose = scrub ? clipPose(scrub.clip, scrubT, sw.side, shoulder, aimYaw, st, v, scrub.span) : sw.pose(shoulder, aimYaw, st, v);
    const fr = this.swordFrame[sw.side === 1 ? 0 : 1] ??= { shoulder: new THREE.Vector3(), aimYaw: 0, st, span: 1, clip: "guard", t: 0 };
    fr.shoulder.copy(shoulder); fr.aimYaw = aimYaw; fr.st = st;
    fr.span = scrub ? scrub.span : sw.span; fr.clip = scrub ? scrub.clip : sw.clip; fr.t = scrub ? scrubT : sw.t;
    const armed: HeldPose = { ...pose, upper: v.swordUpperArm, fore: v.swordForearm, out: v.swordShoulderOut };
    body.holdPose?.(sw.side, u.alive ? armed : null);
    // The hand in the world (the arm may have pulled it in to its reach: the model's pivot is where it really is).
    const hand = this.tmp;
    const m = s.model, ms = m?.sword;
    if (m) m.root.getWorldPosition(hand); else hand.set(pose.hand.x, pose.hand.y, pose.hand.z).applyMatrix4(frame);
    if (sw.started) bf.sfx.playSound("swordSwing", hand, sw.power ? 1.2 : 0.9, (sw.power ? 0.7 : 0.85) + Math.random() * 0.25);
    // A power cut (Keith 2026-11-02): the hydraulics bang and a low whoosh as it kicks in.
    if (sw.powered && u.alive) { bf.sfx.play("brap", u.sim.pelvis, 0.8, 0.3, false); if (!sw.started) bf.sfx.playSound("swordSwing", hand, 1.1, 0.7 + Math.random() * 0.15); }
    // The swish (src/weapons/swordSwish.ts): in the hull's frame, so the blade's length there is the reach over the
    // hull's scale. Fed every pose the cut sweeps (smooth however fast), and the blade's pose just after the cut.
    const hullG = body.hullGroup?.();
    const hs = this.tmp2.setFromMatrixScale(frame).x || 1, bladeL = (st.reach * v.swordLength) / hs;
    const fast = sw.cutting || ((sw.clip === "A" || sw.clip === "B") && sw.t < (sw.cutWindow(st, v)?.[1] ?? 0) + v.swordSwishAfter);
    if (hullG && v.swordTrail > 0 && !s.swish) s.swish = new SwordSwish();
    const swish = hullG && v.swordTrail > 0 ? s.swish : null;
    if (swish && swish.mesh.parent !== hullG) hullG!.add(swish.mesh);
    s.swishT += dt;
    const feed = (p: SwordPose, at: number) => {
      swish?.push(p.hand, p.fwd, bladeL, v.swordSwishInner, at);
      // Bent air along the arc: a puff every so far the blade's outer half travels.
      if (v.swordSwishBend <= 0 || !bf.waves) return;
      const k = 0.75 * bladeL, ax = p.hand.x + p.fwd.x * k, ay = p.hand.y + p.fwd.y * k, az = p.hand.z + p.fwd.z * k;
      const w = this.tmp3.set(ax, ay, az).applyMatrix4(frame);
      if (s.swishAir <= 0) { bf.waves.puff(w.x, w.y, w.z, v.swordSwishAirSize, v.swordSwishBend, v.swordSwishLife * 1.6); s.swishAir = v.swordSwishAirStep; }
      else s.swishAir -= w.distanceTo(s.swishLast);
      s.swishLast.copy(w);
    };
    if (!fast) s.swishAir = 0;
    if (fast && u.alive && !sweep) feed(pose, s.swishT);
    if (sweep && u.alive) {
      const fw = this.dir, hw = this.sh2;
      // Which way the edge travels across the aim: the first cut toward the far side, the back-cut toward its own.
      const dir = sw.side * (sweep.clip === "A" ? 1 : -1);
      for (const t of sweepTimes(sweep)) {
        const p = clipPose(sweep.clip, t, sw.side, shoulder, aimYaw, st, v, sw.span);
        feed(p, s.swishT - (sweep.to - t));
        if (s.cleave <= 0) continue;
        hw.set(p.hand.x, p.hand.y, p.hand.z).applyMatrix4(frame);
        fw.set(p.fwd.x, p.fwd.y, p.fwd.z).transformDirection(frame);
        this.swordSheet(s, hw, Math.atan2(fw.x, fw.z), st, dir);
      }
    }
    // A power cut's swish (Keith 2026-11-02): blue for players, red for enemies, brighter.
    if (s.swish) {
      s.swish.tint(sw.power ? (u.player ? POWER_BLUE : POWER_RED) : null);
      if (swish) swish.update(s.swishT, v.swordSwishLife, v.swordTrail * (sw.power ? v.swordPowerTrail : 1)); else s.swish.clear();
    }
    // The model: the blade stretched to the reach, the edge hot in the cut.
    if (m && ms) {
      ms.swing.rotation.set(0, 0, 0);
      const ws = Math.max(1e-3, m.root.getWorldScale(this.tmp2).x);
      const len = st.reach * v.swordLength;
      ms.blade.scale.z = Math.max(0.3, len / ws - 0.46);
      // A heavier sword is a thicker, broader blade (the buster), a lighter one slimmer.
      ms.blade.scale.x = ms.blade.scale.y = st.heft ?? 1;
      ms.edge.opacity = sw.cutting ? 1 : 0.35;
    }
  }

  /** One sheet of the blade at a world yaw: hit what it crosses that this swing hasn't hit yet. */
  private swordSheet(s: Side, hand: THREE.Vector3, yaw: number, st: SwordStats, dir: number) {
    const u = this.unit, v = this.v, bf = this.bf, field = bf.field;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const sheet = {
      ox: hand.x, oz: hand.z, dx, dz, from: 0, len: st.reach, half: v.swordHalf, under: v.sheetUnder,
      top: (t: number) => field.height(hand.x + dx * t, hand.z + dz * t) + v.swordHeight,
      ground: (x: number, z: number) => field.height(x, z),
    };
    const budget = { left: s.cleave };
    const hits = swordCuts(sheetHits(bf.targets, u.team, sheet, null, swordBuf, bf.register), s.swordHits, budget, (m) => penDensity(v, m));
    s.cleave = budget.left;
    // The swing's way across (the blade's tangent, toward where it's cutting) and out along the blade: the knock.
    const tx = -dz * dir, tz = dx * dir;
    for (const h of hits) {
      const t = h.target;
      const at = new THREE.Vector3(h.x, h.y, h.z);
      if (h.ray) { const o = new THREE.Vector3(h.ray.ox, h.ray.oy, h.ray.oz), d = new THREE.Vector3(h.ray.dx, h.ray.dy, h.ray.dz); t.hitRay(o, d, h.ray.dist + 1e-3); }
      else t.pick?.(h.key);
      const kd = new THREE.Vector3(tx * 0.7 + dx * 0.5, 0.25, tz * 0.7 + dz * 0.5).normalize();
      this.onFire?.("melee");
      // A mech facing the cut with a free sword blocks it (Keith 2026-11-01): less damage and knock, the blade stalls.
      const power = s.sword.power;
      const met = t.parry?.(u.sim.pos.x, u.sim.pos.z, power) ?? { take: 1 }, take = met.take, blocked = take < 1 && !met.broke;
      t.damage(cutDamage(st, v, s.sword.span) * (power ? v.swordPowerDamage : 1) * u.damageScale * take, at, kd, st.ap);
      if (v.swordKnock > 0) t.knock?.(at, kd, v.swordKnock * (blocked ? v.swordBlockKnock : 1));
      if (met.parried) {
        // The blades met (Keith 2026-11-01): a clash of sparks and light, a bend in the air, a loud ching; my blade
        // recoils too and this cut is over.
        const f = v.swordParryFlash;
        bf.gunFx.sparksAt(at, kd.set(kd.x, 0.6, kd.z).normalize(), Math.round(60 * f), 18);
        bf.gunFx.sparksAt(at, kd.set(-kd.x, 0.6, -kd.z).normalize(), Math.round(30 * f), 14);
        if (f > 0) { bf.nightLights?.flash(at.x, at.y, at.z, 4 * f); bf.waves?.puff(at.x, at.y, at.z, 3 * f, 0.25 * f, 0.3); }
        bf.sfx.playSound("swordBlock", at, 2.2, 1.12 + Math.random() * 0.1);
        bf.sfx.playSound("swordBlock", at, 1.4, 0.8 + Math.random() * 0.08);
        s.sword.recoil(v);
        // A parried power cut is the punish (Keith 2026-11-02): the cutter's blade hangs longer.
        if (power) s.sword.hitch += v.swordPowerParried;
        s.swordHits.clear(); s.cleave = 0;
        this.onShake?.(v.swordShake * 1.4);
        if (u.player && !u.ally) hitStop.add(v.swordStop * 1.6, v.swordStopScale);
        return;
      }
      if (met.broke) {
        // Through the block: a burst of sparks and a heavy clang; the cut carries on.
        bf.gunFx.sparksAt(at, kd, 40, 16);
        if (v.swordParryFlash > 0) bf.nightLights?.flash(at.x, at.y, at.z, 2.5 * v.swordParryFlash);
        bf.sfx.playSound("swordBlock", at, 2, 0.7 + Math.random() * 0.08);
      }
      bf.gunFx.sparksAt(at, kd, blocked ? 26 : 10, blocked ? 14 : 9);
      if (blocked) {
        bf.sfx.playSound("swordBlock", at, 1.7, 0.92 + Math.random() * 0.16);
        s.sword.bite(v.swordBlockStall);
      }
      bf.dust.smoke(at.x, at.y, at.z, kd.x * 2, 0.6, kd.z * 2, 0.5, 0.7, 0.75, 0.35);
      if (!blocked) bf.sfx.playSound("swordHit", at, s.bit ? 0.7 : 1.1, 0.88 + Math.random() * 0.3);
      if (!s.bit) {
        s.bit = true;
        s.sword.bite(v.swordHitch);
        this.onShake?.(v.swordShake);
        if (u.player && !u.ally) hitStop.add(v.swordStop, v.swordStopScale);
      } else this.onShake?.(v.swordShake * 0.35);
    }
  }

  /** How far off the sword's aim is (Keith 2026-11-01: close cut or full sweep), 0 (within swordCloseWithin) .. 1
   *  (swordFullFrom or farther). */
  private reachShare(): number {
    const v = this.v, u = this.unit, at = u.lock ?? u.cursor;
    if (!at) return 1;
    const d = Math.hypot(at.x - u.sim.pos.x, at.z - u.sim.pos.z);
    return Math.max(0, Math.min(1, (d - v.swordCloseWithin) / Math.max(0.1, v.swordFullFrom - v.swordCloseWithin)));
  }

  /**
   * The mech steps into a swing (world m/s along the aim; below 0 back off it), or null: the walker takes it as outside
   * motion. How far off the target is (the lock, else the cursor): none within swordLungeNear, growing to the full
   * lunge at swordLungeFar. And the legs' way (Keith 2026-11-01, round 9: "responsive to WSAD ... blend between"):
   * standing still or walking into the cut the full step; walking across it a share; backing straight off it none, or a
   * small hop back. A smooth blend on the dot of the walk's way with the aim's, scaled by how hard WASD is held.
   */
  /**
   * An enemy's sword cut from (x, z) is landing on this mech (Keith 2026-11-01: auto block). A sword at rest or
   * recovering (not mid-cut) whose arm faces the cutter, within swordBlockArc of the torso's aim on that side, swings up
   * across the front and takes it: the share of the damage that lands is swordBlockTake. One already up blocks again.
   */
  parry(fromX: number, fromZ: number, power = false): Parry {
    const v = this.v, u = this.unit;
    if (!u.alive) return { take: 1 };
    const to = Math.atan2(fromX - u.sim.pos.x, fromZ - u.sim.pos.z);
    // How far off this side's arm faces the cutter (the torso's aim on that side).
    const off = (s: Side) => {
      const g = u.upper.guns[s.sword.side === 1 ? 0 : 1];
      const o = to - (u.upper.torsoYaw + (g?.yaw ?? 0));
      return Math.abs(Math.atan2(Math.sin(o), Math.cos(o)));
    };
    const half = (v.swordBlockArc / 2) * (Math.PI / 180);
    // The parry (Keith 2026-11-01): my own sword driving or cutting toward the cutter meets its blade; both recoil.
    if (v.swordParry > 0) for (const s of this.sides) {
      if (s.kind !== "melee" || !s.sword.swinging || off(s) > half) continue;
      s.sword.parried(v);
      s.swordHits.clear(); s.cleave = 0;
      this.onShake?.(v.swordShake * 1.4);
      if (u.player && !u.ally) hitStop.add(v.swordStop * 1.6, v.swordStopScale);
      return { take: v.swordParryTake, parried: true };
    }
    if (v.swordBlock <= 0) return { take: 1 };
    let pick: Side | null = null, best = Infinity;
    for (const s of this.sides) {
      if (s.kind !== "melee" || !(s.sword.blocking || s.sword.free)) continue;
      // One already up first, else the arm that faces it best.
      const a = off(s), score = a - (s.sword.blocking ? 10 : 0);
      if (a <= half && score < best) { best = score; pick = s; }
    }
    // A power cut (Keith 2026-11-02) breaks the block: the sword that would take it is flung back (so it can't block
    // the next cut either) and swordPowerBlockTake of the damage lands.
    if (pick && power && v.swordPower > 0) {
      pick.sword.recoil(v);
      this.onShake?.(v.swordShake);
      return { take: v.swordPowerBlockTake, broke: true };
    }
    if (!pick || !pick.sword.block(v)) return { take: 1 };
    return { take: v.swordBlockTake };
  }

  /**
   * Space pressed (Keith 2026-11-02): every sword driving in or cutting becomes a power cut, for swordPowerCost of the
   * dash's energy. False (Space dashes as usual) when no sword is mid-cut or there isn't the energy: a normal cut.
   */
  powerCut(): boolean {
    const v = this.v;
    if (v.swordPower <= 0) return false;
    const ready = this.sides.filter((s) => s.kind === "melee" && s.sword.canPower(this.swordBase(s), v));
    if (!ready.length || !this.unit.dash.spend(v.swordPowerCost)) return false;
    for (const s of ready) s.sword.powerUp(this.swordBase(s), v);
    return true;
  }

  /** A dash started along (x, z) (unit): toward the aim (the lock, else the cursor), a cut starting soon is a power cut. */
  dashed(x: number, z: number) {
    const v = this.v, u = this.unit, at = u.lock ?? u.cursor;
    if (v.swordPower <= 0 || !at) return;
    const dx = at.x - u.sim.pos.x, dz = at.z - u.sim.pos.z, d = Math.hypot(dx, dz);
    if (d < 1e-3 || (x * dx + z * dz) / d < Math.cos(v.swordPowerDashCone * Math.PI / 180)) return;
    for (const s of this.sides) if (s.kind === "melee") s.sword.primed = v.swordPowerDashWindow;
  }

  lunge(move?: { x: number; z: number }): { x: number; z: number } | null {
    const v = this.v, u = this.unit;
    let k = 0;
    for (const s of this.sides) if (s.kind === "melee") k = Math.max(k, s.sword.lungeK * (s.sword.power ? v.swordPowerLunge : 1));
    const at = u.lock ?? u.cursor;
    if (k <= 0 || v.swordLunge <= 0 || !at) return null;
    const dx = at.x - u.sim.pos.x, dz = at.z - u.sim.pos.z, d = Math.hypot(dx, dz);
    const far = Math.max(0, Math.min(1, (d - v.swordLungeNear) / Math.max(0.1, v.swordLungeFar - v.swordLungeNear)));
    if (far <= 0 || d < 1e-3) return null;
    const want = lungeIntent(move, dx / d, dz / d, v);
    if (Math.abs(want) < 1e-3) return null;
    const sp = v.swordLunge * k * far * want;
    return { x: (dx / d) * sp, z: (dz / d) * sp };
  }

  /**
   * Weapons cold (Keith 2026-10-31: effects stuck after a mech died mid-fire): the owner died, got out, or the round
   * started over. Every trigger and key is let go WITHOUT firing (a held rail would otherwise fire on release, a painted
   * shoulder shot too), and everything a held weapon was showing is dropped: the rail's charge, aim line, meter and coil
   * glow, painter strips and rings, lasers, the arm pod's channel, feed and power effects. Rounds already flying go on.
   */
  stop() {
    for (const s of this.sides) {
      s.rail.holding = false; s.rail.charge = 0; s.whined = false;
      s.aimLine.length = 0; s.meterAt = null; s.channel = false; s.laser.on = false;
      s.sword.stop(); s.swish?.clear(); s.twist = s.twistV = 0;
      this.unit.body.setTwist?.(0);
      clearPaint(s.paint);
      for (const mat of s.model?.glow ?? []) mat.opacity = s.kind === "rail" ? 0.15 : 0.9;
    }
    this.prevTrig[0] = this.prevTrig[1] = false;
    this.energy.stop();
    for (const sh of this.shoulders) {
      sh.held = false; sh.strip = null; sh.laser.on = false;
      clearPaint(sh.paint);
      if (sh.gear) { sh.gear.left = 0; sh.held = false; }
    }
    for (const g of this.unit.upper.guns) { g.rateMul = 1; }
  }

  /** Walking speed share now: the arm missile pod slows the walk while it channels. */
  moveMul() { return this.sides.some((s) => s.channel) ? 1 - this.v.podSlow : 1; }

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
    if (sh.weapon === "rpg") this.clipSwap(sh, sh.mag, held || sh.held, dt, u.sim.pelvis);
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
        sh.strip = planStrip(u.sim.pos, cur, st.length, v, this.candidates(), st.blast * v.salvoWidth / Math.max(0.1, v.salvoBlast));
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
      } else if (sh.cool <= 0 && cur && magTake(sh.mag, 1, sh.cost ?? 1)) {
        const st = this.rpgStats(sh.own, true);
        sh.cool = st.cooldown;
        // Tube by tube out of the clip.
        const from = this.shoulderMuzzle(sh, Math.max(0, Math.ceil(sh.mag.size - sh.mag.left - 1e-6) - 1), new THREE.Vector3());
        this.fireRockets(from, cur, st, sh.proto);
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
      this.blast(this.tmp.set(r.pos.x, r.pos.y, r.pos.z), r.blast, r.damage, sh.own?.ap ?? v.salvoAp, "lineMortar");
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
      this.blast(this.tmp.set(m.pos.x, m.pos.y, m.pos.z), m.blast, m.damage, sh.own?.ap ?? v.swarmAp, "missile");
    }, (m) => {
      bf.sfx.playSound("rocket", this.tmp.set(m.p0.x, m.p0.y, m.p0.z), 0.6, 1.1 + Math.random() * 0.2);
      bf.nightLights?.launch(m.p0.x, m.p0.y, m.p0.z, 0.5, this.fam);
      if (sh.model) sh.model.recoil.position.z = -0.05;
    }, this.bodyHit);
    for (const m of sh.swarm.missiles) if (m.live && m.launched) this.trail(m.prev, m.pos, 0.16 * v.rpgSmoke, 2);
    if (sh.model) { sh.model.recoil.position.y += (0 - sh.model.recoil.position.y) * Math.min(1, dt * 6); sh.model.recoil.position.z += (0 - sh.model.recoil.position.z) * Math.min(1, dt * 8); }
    const ready = sh.weapon === "linemortar" ? sh.line.ready : sh.weapon === "mortar" ? sh.mortar.ready : sh.weapon === "missiles" ? sh.swarm.ready : sh.cool <= 0 && magReady(sh.mag);
    for (const mat of sh.model?.glow ?? []) mat.opacity = ready ? 0.95 : 0.15;
  }

  /** A round gun fires a shot (src/weapons/guns.ts; the unit fires its rounds): its model's muzzle, sound, kick, shake. */
  gunShot(side: 1 | -1, muzzle: THREE.Vector3): boolean {
    const s = this.sides[side === 1 ? 0 : 1];
    if (!isRoundGun(s.kind)) return false;
    const feel = gunFeel(s.kind, this.v);
    if (s.model?.muzzles.length) this.muzzleOf(s, side, muzzle, s.tube++);
    if (s.model) s.model.recoil.position.z = -feel.kick;
    this.bf.sfx.playSound(s.kind, muzzle, 1);
    const d = this.unit.body.barrel(side, this.dir);
    // Shotguns and flak cough a puff of smoke; the sniper a long one.
    if (s.kind === "shotgun" || s.kind === "flak" || s.kind === "sniper") {
      const big = s.kind === "shotgun" ? 0.35 : 0.5;
      this.bf.dust.smoke(muzzle.x, muzzle.y, muzzle.z, d.x * 4, d.y * 4 + 0.4, d.z * 4, big, 0.7, 0.55, 0.45);
    }
    this.onFire?.(s.kind);
    this.onShake?.(feel.shake);
    return !!s.model?.muzzles.length;
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
    // A Double shot puts its copies side by side, protoPairGap metres apart across the barrel (one muzzle's effects).
    const pairs = Math.max(1, Math.round(s.proto?.multi ?? 1)), gap = (this.bf.v as { protoPairGap?: number }).protoPairGap ?? 0.5;
    const hl = Math.hypot(d.x, d.z) || 1, px = d.z / hl, pz = -d.x / hl;
    for (let k = 0; k < pairs; k++) {
      const off = (k - (pairs - 1) / 2) * gap;
      this.shells.fire(u.team, pairs > 1 ? new THREE.Vector3(m.x + px * off, m.y, m.z + pz * off) : m, d, st, this.v.acPen).ap = st.ap;
    }
    // Its stream's tube light pulses with each shell, out to the lock or the cursor (Keith 2026-10-31; cosmetic).
    const aimAt = lock ?? u.cursor, reach = aimAt ? Math.min(st.range, Math.hypot(aimAt.x - m.x, aimAt.z - m.z)) : st.range;
    this.bf.nightLights?.stream(m.x, m.y, m.z, m.x + d.x * reach, m.y + d.y * reach, m.z + d.z * reach, st.damage * (1 + (st.ap ?? 0)), this.fam, false, true);
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

  /**
   * A rocket shot with its Protocols: a Splitter's 3 fan across the aim protoRocketFan° apart round the launcher; a
   * Double shot's copies fly side by side, protoPairGap metres apart at the launcher and at the aim point.
   */
  private fireRockets(from: THREE.Vector3, cur: THREE.Vector3, st: RocketStats, proto: ShotProtocols | undefined) {
    const n = Math.max(1, Math.round(proto?.split ?? 1)), pairs = Math.max(1, Math.round(proto?.multi ?? 1));
    if (n <= 1 && pairs <= 1) { this.fireRocket(from, cur, st); return; }
    const bv = this.bf.v as { protoRocketFan?: number; protoPairGap?: number };
    const fan = ((bv.protoRocketFan ?? 3) * Math.PI) / 180, gap = bv.protoPairGap ?? 0.5;
    const dx = cur.x - from.x, dz = cur.z - from.z, l = Math.hypot(dx, dz) || 1, px = dz / l, pz = -dx / l;
    for (let m = 0; m < pairs; m++) {
      const off = (m - (pairs - 1) / 2) * gap;
      const f = new THREE.Vector3(from.x + px * off, from.y, from.z + pz * off);
      for (let k = 0; k < n; k++) {
        const a = (k - (n - 1) / 2) * fan, cs = Math.cos(a), sn = Math.sin(a);
        const x = f.x + dx * cs + dz * sn, z = f.z - dx * sn + dz * cs;
        this.fireRocket(f, new THREE.Vector3(x, this.bf.field.height(x, z), z), st, k > 0 || m > 0);
      }
    }
  }

  private fireRocket(from: THREE.Vector3, cur: THREE.Vector3, st: RocketStats, quiet = false) {
    const bf = this.bf;
    this.rockets.fire(this.unit.team, from, this.rpgPoint(from, cur), st).ap = st.ap;
    if (quiet) return;
    bf.nightLights?.launch(from.x, from.y, from.z, 1, this.fam);
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
      // The slug's energy dumped into the sand: a red-hot splash, hotter with the charge (src/fx/groundHeat.ts).
      bf.heat?.spot(to.x, to.z, 0.5 + 0.4 * power, ((bf.v as { heatRail?: number }).heatRail ?? 0) * (0.5 + 0.5 * power));
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
    // A small blast wave (src/fx/blastWaves.ts), a ground ring when it hit the sand.
    bf.waves?.post("cannon", at.x, at.y + 0.3, at.z, Math.max(1.2, splash), { ground: !t, fam: this.fam });
  }

  /** A rocket, missile or shell's blast: the battlefield's one blast entry point (crater queued, dust, sound, splash). */
  private blast(at: THREE.Vector3, radius: number, damage: number, ap: number | undefined, kind: WaveKind) {
    this.bf.blast(this.unit.team, at.clone(), radius, damage, ap, kind);
  }
  /** The battlefield's blast waves (the draw leaves heat shimmer behind rockets in flight). */
  get waves() { return this.bf.waves; }

  private muzzleOf(s: Side, side: 1 | -1, out: THREE.Vector3, tube = 0) {
    const m = s.model?.muzzles;
    return m?.length ? m[tube % m.length].getWorldPosition(out) : this.unit.body.muzzle(side, out);
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

  /**
   * The shoulder and back keys for the action bar (src/ui/actionBar.ts; Keith 2026-11-01: "weapon abilities on buttons
   * down the bottom, so we can see cooldowns"): the key, a short name, seconds of cooldown left (the bar keeps the
   * share), seconds of effect left and its length (overdrive, ignited rounds), rounds left for a clip, aiming.
   */
  keySlots(): KeySlot[] {
    const off = !!this.unit.gunsOff;
    return this.shoulders.map((sh) => {
      const name = SHORT[sh.weapon] ?? NAMES[sh.weapon] ?? sh.weapon;
      if (sh.gear) {
        const g = sh.gear, st = g.stats;
        return { key: String(sh.key), name, cool: g.cool, coolMax: st.cooldown, left: g.left, leftMax: st.time, aiming: false, off };
      }
      const cd = sh.weapon === "linemortar" ? sh.line.cooldown : sh.weapon === "mortar" ? sh.mortar.cooldown : sh.weapon === "missiles" ? sh.swarm.cooldown : Math.max(sh.cool, sh.mag.reloading);
      return { key: String(sh.key), name, cool: cd, left: 0, aiming: sh.held, off, rounds: sh.weapon === "rpg" ? `${Math.ceil(sh.mag.left)}/${sh.mag.size}` : undefined, reloading: sh.mag.reloading > 0 };
    });
  }

  private controlList(): string[] {
    const out: string[] = [];
    const u = this.unit;
    this.sides.forEach((s, i) => {
      const b = i === 0 ? "LMB" : "RMB";
      if (!s.kind) { out.push(`${b} —`); return; }
      const g = u.upper.guns[i];
      let state = "";
      if (s.kind === "melee") state = (s.sword.power ? `<b style="color:#6cc4ff">power</b> ` : "") + (s.sword.clip === "guard" ? "click to cut, again to cut back; Space mid-cut: power cut" : s.sword.clip === "A" ? "cut" : s.sword.clip === "B" ? "back-cut" : "recover");
      else if (s.kind === "energy") state = this.energy.stateText(i);
      else if (s.kind === "rail") state = s.rail.cooldown > 0 ? `${s.rail.cooldown.toFixed(1)} s` : s.rail.holding ? `charge ${Math.round(s.rail.charge * 100)}%` : "hold to charge";
      else if (g.mag.reloading > 0) state = `<b style="color:#ffb347">reload ${g.mag.reloading.toFixed(1)} s</b>`;
      else if (s.kind === "rpg") state = `${Math.ceil(g.ammo)}/${g.mag.size}${s.cool > 0 ? ` ${s.cool.toFixed(1)} s` : ""}`;
      else state = `${Math.ceil(g.ammo)}/${g.mag.size}`;
      out.push(`${b} ${NAMES[s.kind === "energy" ? this.energy.sides[i].cls ?? s.kind : s.kind]}${s.light ? " (hand)" : ""} ${state}`);
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
