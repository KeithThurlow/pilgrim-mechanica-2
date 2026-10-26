// A raider war band (Keith 2026-10-24): Mad Max style pickups with machine guns on the back, bigger gun trucks,
// six-wheelers with autocannons, a War Rig lead truck (eight wheels, two turrets) and a makeshift tank, that swarm the
// player's mech, circling it at range and breaking in for gun runs a few at a time, and bandit mechs
// (red Ramparts) that hold off and trade fire. Hurt vehicles flee; wrecks burn out and are cleared. When a band is
// gone, the next one rolls in from the dunes.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { CarSim, CAR_DEFAULTS, CAR_KINDS, axleSpan, type CarKind, type CarValues } from "../vehicles/car";
import { CarBody } from "../vehicles/carBody";
import { rayCapsule, capsuleNormal, type MechUnit } from "../game/mechUnit";
import type { Battlefield, Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import { KIND, FLAG, ObjectSerials, type Register } from "../game/register";
import { putMech } from "../game/registerOwners";
import type { DeathPhysics, Dead } from "../physics/deaths";

/**
 * What the band goes for: the player's mech, or the pilot on foot (src/pilot/quarry.ts Prey has this shape): alive,
 * an aim point, a ground position and a velocity.
 */
export interface WarTarget { alive: boolean; sim: { pelvis: THREE.Vector3; pos: THREE.Vector3; vel: THREE.Vector3 } }

export const WARBAND_DEFAULTS = {
  bandTechnicals: 5,
  bandTrucks: 2,
  bandSixWheelers: 1,
  bandWarRigs: 1,
  bandTanks: 1,
  bandMechs: 1,
  circleRadius: 24,
  circleSpread: 8,
  attackers: 2,
  runEvery: 4,
  gunRange: 42,
  gunTurn: 120,
  techRate: 7,
  techDamage: 1.2,
  techSpread: 3.5,
  truckRate: 2.2,
  truckDamage: 6,
  truckSpread: 2,
  sixRate: 1.5,
  sixDamage: 12,
  sixSpread: 1.5,
  tankRate: 0.2,
  tankDamage: 35,
  tankSpread: 0.8,
  tankTurn: 25,
  tankShellSpeed: 22,
  tankShellArc: 7,
  tankShellRadius: 4,
  tankLead: 0.6,
  techHull: 140,
  truckHull: 380,
  sixHull: 650,
  rigHull: 1400,
  tankHull: 1800,
  banditMechHull: 650,
  banditMechDamage: 0.2,
  banditMechRange: 26,
  fleeAt: 0.25,
  spawnDistance: 110,
  waveGap: 6,
  rutEvery: 1.6,
  techTopSpeed: 20,
  techAccel: 7,
  techGrip: 5,
  techDrift: 0.35,
  techSteer: 32,
  truckTopSpeed: 14,
  truckAccel: 4,
  truckGrip: 5.5,
  truckDrift: 0.22,
  truckSteer: 28,
  sixTopSpeed: 12,
  rigTopSpeed: 11,
  tankTopSpeed: 8,
  avoidSteep: 26,
  blastLift: 6,
  blastSpin: 4,
  blastPush: 4,
};
export type WarbandValues = typeof WARBAND_DEFAULTS;

export const WARBAND_PARAMS: Param[] = [
  { key: "bandTechnicals", label: "Technicals per band", min: 0, max: 20, step: 1, group: "War band" },
  { key: "bandTrucks", label: "Gun trucks per band", min: 0, max: 8, step: 1, group: "War band" },
  { key: "bandSixWheelers", label: "Six-wheelers per band", min: 0, max: 8, step: 1, group: "War band" },
  { key: "bandWarRigs", label: "War Rigs per band (lead truck)", min: 0, max: 3, step: 1, group: "War band" },
  { key: "bandTanks", label: "Tanks per band", min: 0, max: 4, step: 1, group: "War band" },
  { key: "bandMechs", label: "Bandit mechs per band", min: 0, max: 4, step: 1, group: "War band" },
  { key: "circleRadius", label: "Circle distance (m)", min: 8, max: 60, step: 1, group: "War band", tip: "How far out they circle the mech" },
  { key: "circleSpread", label: "Circle spread (m)", min: 0, max: 30, step: 1, group: "War band" },
  { key: "attackers", label: "Gun runs at once", min: 0, max: 10, step: 1, group: "War band", tip: "How many break in for a close pass at the same time (the old game's attack tokens)" },
  { key: "runEvery", label: "A gun run every (s)", min: 0.5, max: 20, step: 0.5, group: "War band" },
  { key: "gunRange", label: "Their gun range (m)", min: 10, max: 80, step: 1, group: "War band" },
  { key: "gunTurn", label: "Their turret turn (°/s)", min: 20, max: 400, step: 5, group: "War band" },
  { key: "techRate", label: "Technical: rounds/s", min: 0.5, max: 20, step: 0.5, group: "Raider guns" },
  { key: "techDamage", label: "Technical: damage per round", min: 0, max: 30, step: 0.5, group: "Raider guns" },
  { key: "techSpread", label: "Technical: spread (°)", min: 0, max: 15, step: 0.1, group: "Raider guns" },
  { key: "truckRate", label: "Gun truck: rounds/s", min: 0.2, max: 10, step: 0.1, group: "Raider guns" },
  { key: "truckDamage", label: "Gun truck: damage per round", min: 0, max: 80, step: 0.5, group: "Raider guns" },
  { key: "truckSpread", label: "Gun truck: spread (°)", min: 0, max: 10, step: 0.1, group: "Raider guns" },
  { key: "sixRate", label: "Autocannon (six-wheeler, War Rig rear): rounds/s", min: 0.1, max: 6, step: 0.1, group: "Raider guns" },
  { key: "sixDamage", label: "Autocannon: damage per round", min: 0, max: 100, step: 0.5, group: "Raider guns" },
  { key: "sixSpread", label: "Autocannon: spread (°)", min: 0, max: 10, step: 0.1, group: "Raider guns" },
  { key: "tankRate", label: "Tank: rounds/s", min: 0.05, max: 2, step: 0.01, group: "Raider guns" },
  { key: "tankDamage", label: "Tank: damage per round", min: 0, max: 300, step: 1, group: "Raider guns" },
  { key: "tankSpread", label: "Tank: spread (°)", min: 0, max: 5, step: 0.1, group: "Raider guns" },
  { key: "tankShellSpeed", label: "Tank: shell speed (m/s)", min: 5, max: 80, step: 1, group: "Raider guns", tip: "Slow, lobbed and marked where it lands: dash out of the ring" },
  { key: "tankShellArc", label: "Tank: shell arc (m)", min: 0, max: 30, step: 0.5, group: "Raider guns" },
  { key: "tankShellRadius", label: "Tank: blast radius (m)", min: 0.5, max: 10, step: 0.1, group: "Raider guns" },
  { key: "tankLead", label: "Tank: lead on a moving mech (0-1)", min: 0, max: 1.5, step: 0.05, group: "Raider guns" },
  { key: "tankTurn", label: "Tank: turret turn (°/s)", min: 5, max: 120, step: 1, group: "Raider guns" },
  { key: "techHull", label: "Technical: hit points", min: 10, max: 2000, step: 10, group: "Raider health" },
  { key: "truckHull", label: "Gun truck: hit points", min: 10, max: 4000, step: 10, group: "Raider health" },
  { key: "sixHull", label: "Six-wheeler: hit points", min: 10, max: 5000, step: 10, group: "Raider health" },
  { key: "rigHull", label: "War Rig: hit points", min: 10, max: 8000, step: 10, group: "Raider health" },
  { key: "tankHull", label: "Tank: hit points", min: 10, max: 8000, step: 10, group: "Raider health" },
  { key: "banditMechHull", label: "Bandit mech: hit points", min: 50, max: 5000, step: 10, group: "Raider health" },
  { key: "banditMechDamage", label: "Bandit mech: damage ×", min: 0, max: 2, step: 0.01, group: "Raider guns", tip: "Their miniguns' rounds against yours" },
  { key: "banditMechRange", label: "Bandit mech: holds off (m)", min: 8, max: 60, step: 1, group: "War band" },
  { key: "fleeAt", label: "Flee below health", min: 0, max: 0.9, step: 0.01, group: "War band" },
  { key: "spawnDistance", label: "Band rolls in from (m)", min: 40, max: 300, step: 5, group: "War band" },
  { key: "waveGap", label: "Next band after (s)", min: 0, max: 60, step: 0.5, group: "War band" },
  { key: "blastLift", label: "Wreck thrown up (m/s)", min: 0, max: 20, step: 0.1, group: "Raider wrecks", tip: "A killed vehicle blows up and is thrown: it can roll over and land on its roof" },
  { key: "blastSpin", label: "Wreck spin (rad/s)", min: 0, max: 15, step: 0.1, group: "Raider wrecks" },
  { key: "blastPush", label: "Wreck pushed along the hit (m/s)", min: 0, max: 20, step: 0.1, group: "Raider wrecks" },
  { key: "techTopSpeed", label: "Technical: top speed (m/s)", min: 4, max: 40, step: 0.5, group: "Raider driving" },
  { key: "techAccel", label: "Technical: acceleration", min: 1, max: 20, step: 0.1, group: "Raider driving" },
  { key: "techGrip", label: "Technical: grip", min: 0.5, max: 15, step: 0.1, group: "Raider driving", tip: "How hard the tyres bleed off sideways sliding" },
  { key: "techDrift", label: "Technical: drift", min: 0, max: 1, step: 0.01, group: "Raider driving", tip: "How readily hard turns break into a slide" },
  { key: "techSteer", label: "Technical: steering lock (°)", min: 10, max: 50, step: 1, group: "Raider driving" },
  { key: "truckTopSpeed", label: "Gun truck: top speed (m/s)", min: 4, max: 40, step: 0.5, group: "Raider driving" },
  { key: "truckAccel", label: "Gun truck: acceleration", min: 1, max: 20, step: 0.1, group: "Raider driving" },
  { key: "truckGrip", label: "Gun truck: grip", min: 0.5, max: 15, step: 0.1, group: "Raider driving" },
  { key: "truckDrift", label: "Gun truck: drift", min: 0, max: 1, step: 0.01, group: "Raider driving" },
  { key: "truckSteer", label: "Gun truck: steering lock (°)", min: 10, max: 50, step: 1, group: "Raider driving" },
  { key: "sixTopSpeed", label: "Six-wheeler: top speed (m/s)", min: 2, max: 30, step: 0.5, group: "Raider driving" },
  { key: "rigTopSpeed", label: "War Rig: top speed (m/s)", min: 2, max: 30, step: 0.5, group: "Raider driving" },
  { key: "tankTopSpeed", label: "Tank: top speed (m/s)", min: 1, max: 20, step: 0.5, group: "Raider driving" },
  { key: "avoidSteep", label: "Steer round slopes over (°)", min: 10, max: 60, step: 1, group: "Raider driving", tip: "Drivers turn aside rather than drive up a dune face steeper than this (the trucks bog down past about 36°)" },
  { key: "rutEvery", label: "Tyre rut every (m)", min: 0.4, max: 6, step: 0.1, group: "War band" },
];

export const RAIDERS = 2;
const D2R = Math.PI / 180;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

type Mode = "circle" | "run" | "flee";

/** Shape per kind (not tuning): hit capsule, clearance round the mech, blast size, wreck boxes, turret turn share. */
interface KindShape {
  half: number; radius: number; capY: number; clear: number; blast: number; turn: number; flash: number;
  /** Wreck main box half-length beyond the axle span, half height, and an optional upper box (cab or turret). */
  boxEnd: number; boxHalfY: number; top: { half: [number, number, number]; at: [number, number, number] } | null;
}
const SHAPES: Record<CarKind, KindShape> = {
  technical: { half: 2.5, radius: 1.25, capY: 0.3, clear: 9, blast: 1, turn: 1, flash: 0.6, boxEnd: 0.85, boxHalfY: 0.45, top: null },
  gunTruck: { half: 3.4, radius: 1.6, capY: 0.3, clear: 11, blast: 1.4, turn: 1, flash: 1.3, boxEnd: 0.85, boxHalfY: 0.45, top: null },
  sixWheeler: { half: 3.6, radius: 1.6, capY: 0.3, clear: 12, blast: 1.5, turn: 0.6, flash: 1.6, boxEnd: 0.9, boxHalfY: 0.5, top: null },
  warRig: { half: 5.5, radius: 1.9, capY: 0.6, clear: 15, blast: 2.2, turn: 1, flash: 1.3, boxEnd: 1.5, boxHalfY: 0.6, top: { half: [1.2, 0.85, 1.15], at: [0, 1.7, 4.1] } },
  tank: { half: 3.3, radius: 1.75, capY: 0.3, clear: 12, blast: 2.0, turn: 0, flash: 2.6, boxEnd: 1.2, boxHalfY: 0.5, top: { half: [1.05, 0.4, 1.3], at: [0, 0.9, 0] } },
};

/** One turret's gunner state. */
interface Turret { yaw: number; pitch: number; fireClock: number; hasLos: boolean; losClock: number; slot: number }

/** One raider vehicle: driver, gunner, health. */
export class Raider implements Hittable {
  readonly team = RAIDERS;
  readonly surface: HitSurface = "metal";
  readonly sim: CarSim;
  readonly body: CarBody;
  alive = true;
  hp: number;
  maxHp: number;
  mode: Mode = "circle";
  /** +1 circles one way, -1 the other. */
  dirSign = Math.random() < 0.5 ? 1 : -1;
  radius: number;
  readonly shape: KindShape;
  readonly turrets: Turret[] = [];
  deadFor = 0;
  runFrom = new THREE.Vector3();
  runTime = 0;
  /** Flat direction of the round that killed it (the wreck is thrown that way). */
  hitDir = new THREE.Vector3(0, 0, 1);
  /** Wreck tumble: velocity and spin while it's thrown, then it lies where it lands. */
  tumbleVel = new THREE.Vector3();
  tumbleSpin = new THREE.Vector3();
  tumbling = false;
  /** The wreck in the death physics (when there is one): it moves the body until it's cleared. */
  wreck: Dead | null = null;
  wheelAcc: number[];
  rutAcc = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(readonly kind: CarKind, ground: CarGround, slot: () => number, w: WarbandValues) {
    const cv: CarValues = { ...CAR_DEFAULTS, ...CAR_KINDS[kind] };
    this.sim = new CarSim(cv, ground);
    this.body = new CarBody(kind);
    this.shape = SHAPES[kind];
    const hull = { technical: w.techHull, gunTruck: w.truckHull, sixWheeler: w.sixHull, warRig: w.rigHull, tank: w.tankHull };
    this.maxHp = this.hp = hull[kind];
    this.radius = w.circleRadius + (Math.random() - 0.5) * w.circleSpread + (this.shape.clear - 9);
    for (let i = 0; i < this.body.turretCount; i++) this.turrets.push({ yaw: 0, pitch: 0, fireClock: Math.random(), hasLos: true, losClock: Math.random() * 0.25, slot: slot() });
    this.wheelAcc = new Array(this.sim.wheels.length).fill(0);
  }

  /** Centre of mass for targeting. */
  get centreY() { return this.sim.pos.y + this.shape.capY; }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const s = this.sim, sh = this.shape;
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    this.a.set(s.pos.x - fx * sh.half, s.pos.y + sh.capY, s.pos.z - fz * sh.half);
    this.b.set(s.pos.x + fx * sh.half, s.pos.y + sh.capY, s.pos.z + fz * sh.half);
    return rayCapsule(o, d, this.a, this.b, sh.radius, maxDist);
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.a, this.b, out); }

  damage(amount: number, _at?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive) return;
    if (dir) this.hitDir.set(dir.x, 0, dir.z).normalize();
    this.hp -= amount;
    if (this.hp <= 0) { this.alive = false; this.hp = 0; this.deadFor = 0; this.body.setWrecked(true); }
  }
}

type CarGround = ConstructorParameters<typeof CarSim>[1];

export class Warband {
  readonly group = new THREE.Group();
  readonly raiders: Raider[] = [];
  readonly mechs: MechUnit[] = [];
  /** Bands beaten so far and the gap before the next. */
  waves = 0;
  private gap = 0;
  private runClock = 0;
  private clock = 0;
  private nextSlot = 2;
  private tmp = new THREE.Vector3();
  private muzzle = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private aim = new THREE.Vector3();

  constructor(
    private bf: Battlefield,
    readonly v: WarbandValues,
    /** Makes a bandit mech (a red Rampart already loaded, unparented), or null to skip them. */
    private makeMech: (() => MechUnit | null) | null,
    /** Death physics for wrecks (Rapier); without it wrecks use a simple throw. */
    private deaths: DeathPhysics | null = null,
  ) {}

  /** Bring in a band from a random direction, spawnDistance out from the target. */
  spawn(target: THREE.Vector3) {
    const v = this.v;
    const a0 = Math.random() * Math.PI * 2;
    const n = (k: number, kind: CarKind): CarKind[] => Array(Math.max(0, Math.round(k))).fill(kind);
    // The War Rig leads from the middle; the tank trails.
    const kinds: CarKind[] = [...n(v.bandTechnicals / 2, "technical"), ...n(v.bandTrucks, "gunTruck"), ...n(v.bandWarRigs, "warRig"),
      ...n(v.bandSixWheelers, "sixWheeler"), ...n(v.bandTechnicals - Math.round(v.bandTechnicals / 2), "technical"), ...n(v.bandTanks, "tank")];
    kinds.forEach((kind, i) => {
      const a = a0 + (i - kinds.length / 2) * 0.12;
      const d = v.spawnDistance + Math.random() * 15 + (kind === "tank" ? 20 : 0);
      const r = new Raider(kind, this.bf.field, () => this.slot(), v);
      const x = target.x + Math.sin(a) * d, z = target.z + Math.cos(a) * d;
      r.sim.reset(x, z, a + Math.PI);
      this.raiders.push(r);
      this.bf.targets.push(r);
      this.group.add(r.body.root);
    });
    for (let i = 0; i < Math.round(v.bandMechs); i++) {
      const m = this.makeMech?.();
      if (!m) break;
      const a = a0 + 0.4 + i * 0.3, d = v.spawnDistance * 0.6;
      m.hullOverride = v.banditMechHull;
      m.damageScale = v.banditMechDamage;
      m.reset(target.x + Math.sin(a) * d, target.z + Math.cos(a) * d, a + Math.PI);
      this.mechs.push(m);
      this.bf.targets.push(m);
      this.group.add(m.body.root);
    }
    this.waves++;
  }

  private serials = new ObjectSerials();
  /** Into the register (src/game/register.ts): live raiders (vehicles) and bandit mechs, each a new id per life. */
  publish(reg: Register): void {
    const flags = FLAG.Hittable | FLAG.Detectable;
    for (let k = 0; k < this.raiders.length; k++) {
      const r = this.raiders[k];
      if (!r.alive) continue;
      reg.put(k, this.serials.serial(r, reg), KIND.Vehicle, r.team, flags, r.sim.pos.x, r.centreY, r.sim.pos.z, r.shape.radius + 0.5, 0, r.sim.vel.x, r.sim.vel.z);
    }
    for (let k = 0; k < this.mechs.length; k++) {
      const m = this.mechs[k];
      if (m.alive) putMech(reg, m, k, this.serials.serial(m, reg));
    }
  }

  // Muzzle-flash slots 2..19 (0-1: the player, 20-23: bandit mechs).
  private slot() { const s = this.nextSlot; this.nextSlot = this.nextSlot >= 19 ? 2 : this.nextSlot + 1; return s; }

  get liveCount() { return this.raiders.filter((r) => r.alive && r.mode !== "flee").length + this.mechs.filter((m) => m.alive).length; }

  update(dt: number, player: WarTarget) {
    const v = this.v;
    const target = player.sim.pelvis;
    // Next band when this one is beaten (or there isn't one yet).
    if (this.liveCount === 0) {
      this.gap += dt;
      if (this.gap >= v.waveGap || this.waves === 0) { this.gap = 0; this.spawn(target); }
    }
    // Gun runs: a few at a time, on a clock.
    this.runClock += dt;
    const running = this.raiders.filter((r) => r.alive && r.mode === "run").length;
    if (this.runClock >= v.runEvery && running < v.attackers) {
      const pick = this.raiders.filter((r) => r.alive && r.mode === "circle");
      if (pick.length) {
        const r = pick[Math.floor(Math.random() * pick.length)];
        r.mode = "run"; r.runTime = 0; r.runFrom.copy(r.sim.pos);
        this.runClock = 0;
      }
    }
    for (const r of this.raiders) this.drive(r, dt, player);
    for (const m of this.mechs) this.walkMech(m, dt, player);
    // Clear wrecks that have burnt out and runaways that are far off.
    for (let i = this.raiders.length - 1; i >= 0; i--) {
      const r = this.raiders[i];
      const far = r.sim.pos.distanceTo(target) > v.spawnDistance * 1.6;
      const cleared = r.wreck ? r.wreck.done : r.deadFor > 25;
      if ((!r.alive && cleared) || (r.alive && r.mode === "flee" && far)) this.remove(r, i);
    }
    for (let i = this.mechs.length - 1; i >= 0; i--) {
      const m = this.mechs[i];
      if (!m.alive && m.deadFor > 25) {
        this.group.remove(m.body.root);
        this.bf.targets.splice(this.bf.targets.indexOf(m), 1);
        this.mechs.splice(i, 1);
      }
    }
  }

  private remove(r: Raider, i: number) {
    this.group.remove(r.body.root);
    this.bf.targets.splice(this.bf.targets.indexOf(r), 1);
    this.raiders.splice(i, 1);
  }

  private drive(r: Raider, dt: number, player: WarTarget) {
    const v = this.v, s = r.sim, T = player.sim.pelvis;
    // Driving sliders apply live.
    if (r.kind === "technical" || r.kind === "gunTruck") {
      const tr = r.kind === "gunTruck";
      s.v.topSpeed = tr ? v.truckTopSpeed : v.techTopSpeed; s.v.accel = tr ? v.truckAccel : v.techAccel;
      s.v.grip = tr ? v.truckGrip : v.techGrip; s.v.drift = tr ? v.truckDrift : v.techDrift; s.v.maxSteer = tr ? v.truckSteer : v.techSteer;
    } else s.v.topSpeed = r.kind === "sixWheeler" ? v.sixTopSpeed : r.kind === "warRig" ? v.rigTopSpeed : v.tankTopSpeed;
    let throttle = 0, steer = 0;
    if (!r.alive) {
      if (r.deadFor === 0) this.blowUp(r);
      r.deadFor += dt;
      if (r.wreck) {
        s.pos.copy(r.wreck.pos[0]); s.pos.y -= r.wreck.sink;
        s.quat.copy(r.wreck.quat[0]);
        this.pose(r);
      } else if (r.tumbling) this.tumble(r, dt);
      else { throttle = s.speed > 0.5 ? -0.6 : 0; this.stepCar(r, dt, throttle, 0); }
      if (r.deadFor < 6 && Math.random() < dt * 8) {
        // Burning out: dark smoke from the wreck.
        this.bf.dust.smoke(s.pos.x, s.pos.y + 1.2, s.pos.z, (Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5), 0.5, 3, 0.75, 0.9);
      }
      return;
    }
    if (r.hp < r.maxHp * v.fleeAt) r.mode = "flee";
    const dx = s.pos.x - T.x, dz = s.pos.z - T.z, dist = Math.hypot(dx, dz) || 1;
    const top = s.v.topSpeed;
    let tx = T.x, tz = T.z, want = top * 0.8;
    if (r.mode === "circle") {
      // A point ahead on the orbit round the mech.
      const ang = Math.atan2(dx, dz) + r.dirSign * 0.55;
      tx = T.x + Math.sin(ang) * r.radius; tz = T.z + Math.cos(ang) * r.radius;
    } else if (r.mode === "run") {
      // Cut close past the mech's side, then swing back out to the circle.
      r.runTime += dt;
      const side = r.dirSign * 7;
      tx = T.x + (-dz / dist) * side; tz = T.z + (dx / dist) * side;
      want = top;
      if (r.runTime > 2 && dist < 12) r.mode = "circle";
      if (r.runTime > 9) r.mode = "circle";
    } else {
      tx = s.pos.x + dx / dist * 50; tz = s.pos.z + dz / dist * 50;
      want = top;
    }
    // Keep clear of each other and of the mech's feet.
    let ax = 0, az = 0;
    for (const o of this.raiders) {
      if (o === r || !o.alive) continue;
      const ox = s.pos.x - o.sim.pos.x, oz = s.pos.z - o.sim.pos.z, d2 = ox * ox + oz * oz;
      if (d2 < 64 && d2 > 1e-4) { const d = Math.sqrt(d2); ax += (ox / d) * (8 - d); az += (oz / d) * (8 - d); }
    }
    if (dist < 7) { ax += (dx / dist) * (7 - dist) * 3; az += (dz / dist) * (7 - dist) * 3; }
    tx += ax * 2; tz += az * 2;
    let desired = Math.atan2(tx - s.pos.x, tz - s.pos.z);
    // Round slopes too steep to climb first; keeping clear of the mech (below) wins over that.
    desired = this.aroundSteep(s.pos.x, s.pos.z, desired);
    // Never drive into the mech. From well out, if the line ahead would cut inside the clearance, aim for the line
    // that grazes it instead (the side nearer the way it wants to go); inside, swerve out along the tangent.
    const clear = r.shape.clear;
    // The tank stops to shoot once the mech is in range (it turns on the spot to drive on).
    if (r.kind === "tank" && r.mode === "circle" && dist < v.gunRange * 0.85) want = 0;
    if (dist >= clear && dist < 35) {
      const toMech = Math.atan2(-dx, -dz);
      const graze = Math.asin(Math.min(1, clear / dist));
      const off = wrap(desired - toMech);
      if (Math.abs(off) < graze) desired = toMech + (off >= 0 ? 1 : -1) * graze;
    }
    if (dist < clear) {
      // Turn to the side the nose already points (never a 180° about-turn, which dithers left and right), out along
      // the tangent and further out the closer it is.
      const toMech = Math.atan2(-dx, -dz);
      const side = wrap(s.heading - toMech) >= 0 ? 1 : -1;
      const t = Math.max(0, (dist - 2) / (clear - 2));
      desired = toMech + side * (Math.PI / 2 + (1 - t) * 0.7);
      want = top * (0.45 + 0.35 * t);
    }
    const err = wrap(desired - s.heading);
    steer = clamp(err * 1.8, -1, 1);
    // Slow for hard turns so they slide round rather than spin.
    want *= 1 - 0.45 * Math.min(1, Math.abs(err) / 1.2);
    throttle = clamp((want - s.speed) * 0.4, -1, 1);
    this.stepCar(r, dt, throttle, steer);
    this.gunner(r, dt, player);
  }

  /** A killed vehicle blows up: a blast of sand and dark smoke, a crater, a thud, and the wreck thrown. */
  private blowUp(r: Raider) {
    const v = this.v, s = r.sim, p = s.pos, bf = this.bf;
    const big = r.shape.blast;
    // The blast digs a crater where the vehicle stood (blast radius 3 m per unit of blast size).
    bf.dent(p.x, p.z, 3 * big);
    for (let i = 0; i < 30 * big; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
      bf.dust.emit(1, p.x, p.y + Math.random(), p.z, Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp, 0.6 + Math.random() * 0.8, 3 + Math.random() * 4, 0.9);
    }
    for (let i = 0; i < 24 * big; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 10;
      bf.dust.emit(2, p.x, p.y, p.z, Math.cos(a) * sp, 4 + Math.random() * 9, Math.sin(a) * sp, 0.15, 0.5 + Math.random() * 0.5, 0.95);
    }
    bf.dust.stomp(p.x, p.y - 0.8, p.z, 2.5 * big);
    bf.marks.crater(p.x, p.z, 6 * big);
    bf.sfx.play("brap", p, 2, 0.55, false);
    // Thrown by the blast. With the death physics, a real rigid body that can roll over and slide down a dune.
    if (this.deaths) {
      const cv = s.v;
      const sh = r.shape, len = axleSpan(cv) / 2 + sh.boxEnd;
      r.wreck = this.deaths.wreck([cv.track / 2 + 0.2, sh.boxHalfY, len],
        sh.top ?? { half: [cv.track / 2 - 0.05, 0.45, 0.75], at: [0, 0.85, len - 1.3] },
        s.pos, s.quat, s.vel, r.hitDir.x, r.hitDir.z, v.blastLift / big, v.blastSpin / big);
      return;
    }
    // Thrown: up, along the killing round, spinning end over end and sideways (it can land on its roof).
    r.tumbling = true;
    r.tumbleVel.copy(s.vel).addScaledVector(r.hitDir, v.blastPush).setY(v.blastLift * (0.7 + Math.random() * 0.6) / big);
    const side = new THREE.Vector3(r.hitDir.z, 0, -r.hitDir.x);
    r.tumbleSpin.copy(side).multiplyScalar(v.blastSpin * (0.5 + Math.random())).add(new THREE.Vector3(0, (Math.random() - 0.5) * v.blastSpin, 0)).add(r.hitDir.clone().multiplyScalar((Math.random() - 0.5) * v.blastSpin)).divideScalar(big);
  }

  /** Ballistic wreck: gravity, spin, bouncing off the sand until it lies still. */
  private tumble(r: Raider, dt: number) {
    const s = r.sim, g = this.bf.field;
    r.tumbleVel.y -= 9.8 * dt;
    s.pos.addScaledVector(r.tumbleVel, dt);
    const w = r.tumbleSpin.length();
    if (w > 1e-4) s.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(r.tumbleSpin.clone().divideScalar(w), w * dt));
    const floor = g.height(s.pos.x, s.pos.z) + s.v.rideHeight * 0.75;
    if (s.pos.y < floor) {
      s.pos.y = floor;
      if (r.tumbleVel.y < 0) r.tumbleVel.y *= -0.25;
      r.tumbleVel.x *= 0.6; r.tumbleVel.z *= 0.6;
      r.tumbleSpin.multiplyScalar(0.55);
      const land = this.bf.dust;
      land.stomp(s.pos.x, floor - 0.7, s.pos.z, Math.min(1.5, Math.abs(r.tumbleVel.y) * 0.5 + 0.3));
      if (r.tumbleVel.length() < 0.6 && r.tumbleSpin.length() < 0.4) r.tumbling = false;
    }
    s.vel.copy(r.tumbleVel);
    this.pose(r);
  }

  /**
   * If the way ahead climbs a face steeper than avoidSteep, try headings either side (widening) and take the nearest
   * one that doesn't; the trucks can't climb slip faces, so they drive round them like a driver would.
   */
  private aroundSteep(x: number, z: number, heading: number) {
    const g = this.bf.field, look = 7, limit = Math.tan(this.v.avoidSteep * D2R);
    const climb = (h: number) => (g.height(x + Math.sin(h) * look, z + Math.cos(h) * look) - g.height(x, z)) / look;
    if (climb(heading) < limit) return heading;
    for (const off of [0.35, 0.7, 1.05, 1.4, 1.75]) {
      for (const sgn of [1, -1]) if (climb(heading + sgn * off) < limit) return heading + sgn * off;
    }
    return heading;
  }

  private stepCar(r: Raider, dt: number, throttle: number, steer: number) {
    const s = r.sim;
    const before = s.pos.clone();
    const sub = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < sub; i++) s.update(dt / sub, throttle, steer);
    const moved = s.pos.distanceTo(before);
    // Wheels throw dust and leave ruts.
    s.wheels.forEach((w, i) => {
      if (!w.grounded || Math.abs(s.speed) < 0.5) return;
      // Through water: a wake and spray off the wheels instead of dust.
      if (this.bf.inWater?.(w.pos.x, w.pos.z)) {
        r.wheelAcc[i] = this.bf.water!.wake(w.pos.x, w.pos.z, moved, r.wheelAcc[i], 0.5, 1.2);
        if (Math.random() < Math.abs(s.speed) * 0.02) this.bf.water!.splash(w.pos.x, w.pos.z, 0.4, -s.vel.x * 0.05, -s.vel.z * 0.05, 0.7);
        return;
      }
      r.wheelAcc[i] = this.bf.dust.wheel(w.pos.x, w.pos.y, w.pos.z, s.vel.x, s.vel.z, moved, w.slip, r.wheelAcc[i]);
    });
    r.rutAcc += moved;
    if (r.rutAcc >= this.v.rutEvery) {
      r.rutAcc = 0;
      const width = r.kind === "technical" ? 0.45 : r.kind === "tank" ? 0.8 : 0.6;
      for (const i of s.rearWheels()) { const w = s.wheels[i]; if (w.grounded && !this.bf.inWater?.(w.pos.x, w.pos.z)) this.bf.marks.rut(w.pos.x, w.pos.z, s.heading, width, this.v.rutEvery * 1.15); }
    }
    this.pose(r);
  }

  /** Pose the body: every turret at its own angles, turret 0 through update. */
  private pose(r: Raider) {
    for (let i = 1; i < r.turrets.length; i++) r.body.aim(i, r.turrets[i].yaw, r.turrets[i].pitch);
    const t0 = r.turrets[0];
    r.body.update(r.sim, t0 ? t0.yaw : 0, t0 ? t0.pitch : 0);
  }

  /** Each turret's gun: what it fires (the War Rig's rear turret is an autocannon). */
  private gun(r: Raider, i: number) {
    const v = this.v;
    const k = r.kind === "warRig" ? (i === 0 ? "gunTruck" : "sixWheeler") : r.kind;
    if (k === "technical") return { rate: v.techRate, damage: v.techDamage, spread: v.techSpread, flash: 0.6, hit: 0.4 };
    if (k === "gunTruck") return { rate: v.truckRate, damage: v.truckDamage, spread: v.truckSpread, flash: 1.3, hit: 0.75 };
    if (k === "sixWheeler") return { rate: v.sixRate, damage: v.sixDamage, spread: v.sixSpread, flash: 1.6, hit: 1 };
    return { rate: v.tankRate, damage: v.tankDamage, spread: v.tankSpread, flash: 2.6, hit: 1.6 };
  }

  private gunner(r: Raider, dt: number, player: WarTarget) {
    const v = this.v, s = r.sim;
    if (r.mode === "flee" || !player.alive) return;
    const T = this.aim.copy(player.sim.pelvis);
    const turnRate = (r.kind === "tank" ? v.tankTurn : v.gunTurn * r.shape.turn) * D2R * dt;
    r.turrets.forEach((t, i) => {
      // Aim at the hull, turning at a capped rate.
      r.body.muzzle(this.muzzle, i);
      const dx = T.x - this.muzzle.x, dy = T.y - this.muzzle.y, dz = T.z - this.muzzle.z;
      const flat = Math.hypot(dx, dz);
      const wantYaw = wrap(Math.atan2(dx, dz) - s.heading);
      const wantPitch = Math.atan2(dy, flat);
      t.yaw += clamp(wrap(wantYaw - t.yaw), -turnRate, turnRate);
      t.pitch += clamp(wantPitch - t.pitch, -turnRate, turnRate);
      const off = Math.abs(wrap(wantYaw - t.yaw));
      if (flat > v.gunRange || off > 6 * D2R) return;
      // Hold fire while a dune is in the way (checked a few times a second, not every round).
      t.losClock -= dt;
      if (t.losClock <= 0) { t.losClock = 0.25; t.hasLos = this.bf.canSee(this.muzzle, T); }
      if (!t.hasLos) return;
      const g = this.gun(r, i);
      t.fireClock += dt * g.rate;
      while (t.fireClock >= 1) {
        t.fireClock -= 1;
        r.body.muzzle(this.muzzle, i);
        r.body.barrel(this.dir, i);
        const spread = g.spread * D2R;
        const tilt = this.tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.tan(spread) * Math.random());
        const d = this.dir.clone().add(tilt.addScaledVector(this.dir, -tilt.dot(this.dir))).normalize();
        if (r.kind === "tank") {
          // A slow lobbed shell at where the mech will be (its walk, not a dash), marked on the sand.
          const P = player.sim.pos, pv = player.sim.vel;
          const flight = Math.hypot(P.x - this.muzzle.x, P.z - this.muzzle.z) / Math.max(1, v.tankShellSpeed);
          this.bf.lob(RAIDERS, this.muzzle, P.x + pv.x * flight * v.tankLead, P.z + pv.z * flight * v.tankLead, flight, v.tankShellArc, v.tankShellRadius, g.damage);
          this.bf.gunFx.shot(t.slot, this.muzzle, d, this.muzzle, null, null, "sand", undefined, g.flash, 0);
        } else this.bf.fire(t.slot, RAIDERS, this.muzzle, d, v.gunRange + 6, g.damage, { flashScale: g.flash, voice: "other", hitScale: g.hit });
        if (r.kind === "tank") {
          // The cannon kicks sand up round the tank.
          this.bf.dust.stomp(s.pos.x, s.pos.y - s.v.rideHeight, s.pos.z, 1.2);
          this.bf.sfx.play("brap", this.muzzle, 1.2, 0.5, false);
        }
      }
    });
  }

  /** Bandit mech: hold off at range, strafe across the player's guns, keep its own guns on the player. */
  private walkMech(m: MechUnit, dt: number, player: WarTarget) {
    if (!m.alive) { m.step(dt, { x: 0, z: 0, sprint: false }, null, false); return; }
    const p = m.sim.pos, T = player.sim.pelvis;
    const dx = T.x - p.x, dz = T.z - p.z, dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist, uz = dz / dist;
    const want = this.v.banditMechRange;
    const close = clamp((dist - want) / 8, -1, 1);
    // Strafe one way then the other every few seconds, each mech on its own beat.
    this.clock += dt;
    const strafe = Math.sin(this.clock * 0.6 + this.mechs.indexOf(m) * 2.1) > 0 ? 0.7 : -0.7;
    let x = ux * close + -uz * strafe, z = uz * close + ux * strafe;
    const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    const aim = { x: T.x, y: T.y, z: T.z };
    m.step(dt, { x, z, sprint: false }, aim, player.alive && dist < m.v.range + 4);
  }
}
