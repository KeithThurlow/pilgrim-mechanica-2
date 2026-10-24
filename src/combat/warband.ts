// A raider war band (Keith 2026-10-24): Mad Max style pickups with machine guns on the back and bigger gun trucks
// that swarm the player's mech, circling it at range and breaking in for gun runs a few at a time, and bandit mechs
// (red Ramparts) that hold off and trade fire. Hurt vehicles flee; wrecks burn out and are cleared. When a band is
// gone, the next one rolls in from the dunes.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { CarSim, CAR_DEFAULTS, CAR_KINDS, type CarKind, type CarValues } from "../vehicles/car";
import { CarBody } from "../vehicles/carBody";
import { rayCapsule, type MechUnit } from "../game/mechUnit";
import type { Battlefield, Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";

export const WARBAND_DEFAULTS = {
  bandTechnicals: 5,
  bandTrucks: 2,
  bandMechs: 1,
  circleRadius: 24,
  circleSpread: 8,
  attackers: 2,
  runEvery: 4,
  gunRange: 42,
  gunTurn: 120,
  techRate: 7,
  techDamage: 2.5,
  techSpread: 3.5,
  truckRate: 2.2,
  truckDamage: 11,
  truckSpread: 2,
  techHull: 140,
  truckHull: 380,
  banditMechHull: 650,
  banditMechDamage: 0.35,
  banditMechRange: 26,
  fleeAt: 0.25,
  spawnDistance: 110,
  waveGap: 6,
  rutEvery: 1.6,
  blastLift: 6,
  blastSpin: 4,
  blastPush: 4,
};
export type WarbandValues = typeof WARBAND_DEFAULTS;

export const WARBAND_PARAMS: Param[] = [
  { key: "bandTechnicals", label: "Technicals per band", min: 0, max: 20, step: 1, group: "War band" },
  { key: "bandTrucks", label: "Gun trucks per band", min: 0, max: 8, step: 1, group: "War band" },
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
  { key: "techHull", label: "Technical: hit points", min: 10, max: 2000, step: 10, group: "Raider health" },
  { key: "truckHull", label: "Gun truck: hit points", min: 10, max: 4000, step: 10, group: "Raider health" },
  { key: "banditMechHull", label: "Bandit mech: hit points", min: 50, max: 5000, step: 10, group: "Raider health" },
  { key: "banditMechDamage", label: "Bandit mech: damage ×", min: 0, max: 2, step: 0.01, group: "Raider guns", tip: "Their miniguns' rounds against yours" },
  { key: "banditMechRange", label: "Bandit mech: holds off (m)", min: 8, max: 60, step: 1, group: "War band" },
  { key: "fleeAt", label: "Flee below health", min: 0, max: 0.9, step: 0.01, group: "War band" },
  { key: "spawnDistance", label: "Band rolls in from (m)", min: 40, max: 300, step: 5, group: "War band" },
  { key: "waveGap", label: "Next band after (s)", min: 0, max: 60, step: 0.5, group: "War band" },
  { key: "blastLift", label: "Wreck thrown up (m/s)", min: 0, max: 20, step: 0.1, group: "Raider wrecks", tip: "A killed vehicle blows up and is thrown: it can roll over and land on its roof" },
  { key: "blastSpin", label: "Wreck spin (rad/s)", min: 0, max: 15, step: 0.1, group: "Raider wrecks" },
  { key: "blastPush", label: "Wreck pushed along the hit (m/s)", min: 0, max: 20, step: 0.1, group: "Raider wrecks" },
  { key: "rutEvery", label: "Tyre rut every (m)", min: 0.4, max: 6, step: 0.1, group: "War band" },
];

export const RAIDERS = 2;
const D2R = Math.PI / 180;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

type Mode = "circle" | "run" | "flee";

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
  turretYaw = 0;
  turretPitch = 0;
  fireClock = Math.random();
  deadFor = 0;
  runFrom = new THREE.Vector3();
  runTime = 0;
  /** Flat direction of the round that killed it (the wreck is thrown that way). */
  hitDir = new THREE.Vector3(0, 0, 1);
  /** Wreck tumble: velocity and spin while it's thrown, then it lies where it lands. */
  tumbleVel = new THREE.Vector3();
  tumbleSpin = new THREE.Vector3();
  tumbling = false;
  wheelAcc = [0, 0, 0, 0];
  rutAcc = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(readonly kind: CarKind, ground: CarGround, readonly flashSlot: number, w: WarbandValues) {
    const cv: CarValues = { ...CAR_DEFAULTS, ...CAR_KINDS[kind] };
    this.sim = new CarSim(cv, ground);
    this.body = new CarBody(kind);
    this.maxHp = this.hp = kind === "gunTruck" ? w.truckHull : w.techHull;
    this.radius = w.circleRadius + (Math.random() - 0.5) * w.circleSpread;
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const s = this.sim, half = (this.kind === "gunTruck" ? 3.4 : 2.5);
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    this.a.set(s.pos.x - fx * half, s.pos.y + 0.3, s.pos.z - fz * half);
    this.b.set(s.pos.x + fx * half, s.pos.y + 0.3, s.pos.z + fz * half);
    return rayCapsule(o, d, this.a, this.b, this.kind === "gunTruck" ? 1.6 : 1.25, maxDist);
  }

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
  ) {}

  /** Bring in a band from a random direction, spawnDistance out from the target. */
  spawn(target: THREE.Vector3) {
    const v = this.v;
    const a0 = Math.random() * Math.PI * 2;
    const kinds: CarKind[] = [...Array(Math.round(v.bandTechnicals)).fill("technical"), ...Array(Math.round(v.bandTrucks)).fill("gunTruck")];
    kinds.forEach((kind, i) => {
      const a = a0 + (i - kinds.length / 2) * 0.12;
      const d = v.spawnDistance + Math.random() * 15;
      const r = new Raider(kind, this.bf.field, this.slot(), v);
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

  // Muzzle-flash slots 2..19 (0-1: the player, 20-23: bandit mechs).
  private slot() { const s = this.nextSlot; this.nextSlot = this.nextSlot >= 19 ? 2 : this.nextSlot + 1; return s; }

  get liveCount() { return this.raiders.filter((r) => r.alive && r.mode !== "flee").length + this.mechs.filter((m) => m.alive).length; }

  update(dt: number, player: MechUnit) {
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
      if ((!r.alive && r.deadFor > 25) || (r.alive && r.mode === "flee" && far)) this.remove(r, i);
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

  private drive(r: Raider, dt: number, player: MechUnit) {
    const v = this.v, s = r.sim, T = player.sim.pelvis;
    let throttle = 0, steer = 0;
    if (!r.alive) {
      if (r.deadFor === 0) this.blowUp(r);
      r.deadFor += dt;
      if (r.tumbling) this.tumble(r, dt);
      else { throttle = s.speed > 0.5 ? -0.6 : 0; this.stepCar(r, dt, throttle, 0); }
      if (r.deadFor < 6 && Math.random() < dt * 8) {
        // Burning out: dark smoke from the wreck.
        this.bf.dust.emit(1, s.pos.x, s.pos.y + 1.2, s.pos.z, (Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5), 0.5, 3, 0.75);
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
    const desired = Math.atan2(tx - s.pos.x, tz - s.pos.z);
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
    const big = r.kind === "gunTruck" ? 1.4 : 1;
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
    const floor = g.height(s.pos.x, s.pos.z) + (r.kind === "gunTruck" ? 0.9 : 0.7);
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
    r.body.update(s, r.turretYaw, r.turretPitch);
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
      r.wheelAcc[i] = this.bf.dust.wheel(w.pos.x, w.pos.y, w.pos.z, s.vel.x, s.vel.z, moved, w.slip, r.wheelAcc[i]);
    });
    r.rutAcc += moved;
    if (r.rutAcc >= this.v.rutEvery) {
      r.rutAcc = 0;
      for (const w of [s.wheels[2], s.wheels[3]]) if (w.grounded) this.bf.marks.rut(w.pos.x, w.pos.z, s.heading, r.kind === "gunTruck" ? 0.6 : 0.45, this.v.rutEvery * 1.15);
    }
    r.body.update(s, r.turretYaw, r.turretPitch);
  }

  private gunner(r: Raider, dt: number, player: MechUnit) {
    const v = this.v, s = r.sim;
    if (r.mode === "flee" || !player.alive) return;
    // Aim at the hull, turning at a capped rate.
    const T = this.aim.copy(player.sim.pelvis);
    r.body.muzzle(this.muzzle);
    const dx = T.x - this.muzzle.x, dy = T.y - this.muzzle.y, dz = T.z - this.muzzle.z;
    const flat = Math.hypot(dx, dz);
    const wantYaw = wrap(Math.atan2(dx, dz) - s.heading);
    const wantPitch = Math.atan2(dy, flat);
    const turn = v.gunTurn * D2R * dt;
    r.turretYaw += clamp(wrap(wantYaw - r.turretYaw), -turn, turn);
    r.turretPitch += clamp(wantPitch - r.turretPitch, -turn, turn);
    const off = Math.abs(wrap(wantYaw - r.turretYaw));
    if (flat > v.gunRange || off > 6 * D2R) return;
    const truck = r.kind === "gunTruck";
    r.fireClock += dt * (truck ? v.truckRate : v.techRate);
    while (r.fireClock >= 1) {
      r.fireClock -= 1;
      r.body.muzzle(this.muzzle);
      r.body.barrel(this.dir);
      const spread = (truck ? v.truckSpread : v.techSpread) * D2R;
      const tilt = this.tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.tan(spread) * Math.random());
      const d = this.dir.clone().add(tilt.addScaledVector(this.dir, -tilt.dot(this.dir))).normalize();
      this.bf.fire(r.flashSlot, RAIDERS, this.muzzle, d, v.gunRange + 6, truck ? v.truckDamage : v.techDamage, { flashScale: truck ? 1.3 : 0.6, voice: "other" });
    }
  }

  /** Bandit mech: hold off at range, strafe across the player's guns, keep its own guns on the player. */
  private walkMech(m: MechUnit, dt: number, player: MechUnit) {
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
