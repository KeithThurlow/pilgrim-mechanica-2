// Slow vehicles for the firing range (labs/weapons): stand-in raider trucks driving a loop across the range so the
// autocannon, the mortar's lead and the salvo's snap have something moving to take. No AI: each drives round an
// ellipse at a set speed, chasing a point a little ahead of it. A Hittable with health; knocked out, it burns and
// comes back after a while. Sim and drawing in one small file (the body is src/vehicles/carBody.ts).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable, SplashOpts } from "./battlefield";
import { armourHit } from "./armour";
import type { HitSurface } from "../fx/minigun";
import { CarSim, CAR_DEFAULTS, CAR_KINDS, type CarKind, type CarValues } from "../vehicles/car";
import { CarBody } from "../vehicles/carBody";
import { rayCapsule, capsuleNormal } from "./mechUnit";

export const RANGE_CAR_DEFAULTS = {
  carCount: 2,
  carSpeed: 7,
  carLoopX: 0,
  carLoopZ: 44,
  carLoopW: 30,
  carLoopD: 6,
  carHealth: 1400,
  carArmour: 4,
  carRespawn: 5,
};
export type RangeCarValues = typeof RANGE_CAR_DEFAULTS;

const G = "Range vehicles";
export const RANGE_CAR_PARAMS: Param[] = [
  { key: "carCount", label: "Vehicles", min: 0, max: 6, step: 1, group: G },
  { key: "carSpeed", label: "Speed (m/s)", min: 0, max: 20, step: 0.5, group: G },
  { key: "carLoopX", label: "Loop centre x (m)", min: -60, max: 60, step: 1, group: G },
  { key: "carLoopZ", label: "Loop centre ahead (m)", min: 10, max: 120, step: 1, group: G },
  { key: "carLoopW", label: "Loop half-width (m)", min: 5, max: 80, step: 1, group: G },
  { key: "carLoopD", label: "Loop half-depth (m)", min: 2, max: 40, step: 0.5, group: G },
  { key: "carHealth", label: "Health", min: 50, max: 10000, step: 50, group: G },
  { key: "carArmour", label: "Armour", min: 0, max: 40, step: 0.5, group: G, tip: "Flat armour per hit (src/game/armour.ts): a gun truck's 4 by default" },
  { key: "carRespawn", label: "Back after (s)", min: 1, max: 30, step: 0.5, group: G },
];

type Ground = import("../mech/walker").Ground;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class RangeCar implements Hittable {
  readonly team = 2;
  readonly surface: HitSurface = "metal";
  readonly sim: CarSim;
  readonly body: CarBody;
  alive = true;
  health: number;
  deadFor = 0;
  /** Where it is on its loop (radians). */
  phase: number;
  /** Called with the damage of each hit (the lab's damage/s). */
  onDamage: ((amount: number) => void) | null = null;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private half: number;

  constructor(readonly kind: CarKind, ground: Ground, private v: RangeCarValues, phase: number) {
    const cv: CarValues = { ...CAR_DEFAULTS, ...CAR_KINDS[kind] };
    this.sim = new CarSim(cv, ground);
    this.body = new CarBody(kind);
    this.half = kind === "technical" ? 2.5 : 3.4;
    this.phase = phase;
    this.health = v.carHealth;
    this.place();
  }

  /** Back on the loop at its phase, heading along it. */
  place() {
    const v = this.v, p = this.phase;
    const x = v.carLoopX + Math.cos(p) * v.carLoopW, z = v.carLoopZ + Math.sin(p) * v.carLoopD;
    const tx = -Math.sin(p) * v.carLoopW, tz = Math.cos(p) * v.carLoopD;
    this.sim.reset(x, z, Math.atan2(tx, tz));
    this.body.setWrecked(false);
    this.alive = true;
    this.health = v.carHealth;
  }

  get centreY() { return this.sim.pos.y + 0.3; }

  update(dt: number) {
    const v = this.v, s = this.sim;
    if (!this.alive) {
      this.deadFor += dt;
      if (this.deadFor > v.carRespawn) { this.deadFor = 0; this.place(); }
      const sub = Math.max(1, Math.ceil(dt * 120));
      for (let i = 0; i < sub; i++) s.update(dt / sub, s.speed > 0.3 ? -0.8 : 0, 0);
      this.body.update(s, 0, 0);
      return;
    }
    // Chase a point a little ahead on the ellipse.
    const ang = Math.atan2((s.pos.z - v.carLoopZ) / Math.max(1, v.carLoopD), (s.pos.x - v.carLoopX) / Math.max(1, v.carLoopW));
    const ahead = ang + 10 / Math.max(5, (v.carLoopW + v.carLoopD));
    this.phase = ang;
    const tx = v.carLoopX + Math.cos(ahead) * v.carLoopW, tz = v.carLoopZ + Math.sin(ahead) * v.carLoopD;
    const err = wrap(Math.atan2(tx - s.pos.x, tz - s.pos.z) - s.heading);
    const steer = Math.max(-1, Math.min(1, err * 2));
    const throttle = Math.max(-1, Math.min(1, (v.carSpeed * (1 - 0.35 * Math.min(1, Math.abs(err))) - s.speed) * 0.5));
    const sub = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < sub; i++) s.update(dt / sub, throttle, steer);
    this.body.update(s, 0, 0);
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const s = this.sim, fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    this.a.set(s.pos.x - fx * this.half, s.pos.y + 0.3, s.pos.z - fz * this.half);
    this.b.set(s.pos.x + fx * this.half, s.pos.y + 0.3, s.pos.z + fz * this.half);
    return rayCapsule(o, d, this.a, this.b, 1.4, maxDist);
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.a, this.b, out); }

  splash(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3, o?: SplashOpts) {
    if (!this.alive) return 0;
    const p = this.sim.pos;
    const d = Math.max(0, Math.hypot(at.x - p.x, at.z - p.z) - this.half);
    if (d > radius) return 0;
    this.damage(damage * (1 - 0.5 * d / Math.max(0.01, radius)), at, dir, o?.pierce);
    return 1;
  }

  armourOf() { return this.v.carArmour ?? 0; }

  damage(amount: number, _at?: THREE.Vector3, _dir?: THREE.Vector3, pierce?: number) {
    if (!this.alive) return;
    amount = armourHit(amount, this.armourOf(), pierce);
    this.health -= amount;
    this.onDamage?.(amount);
    if (this.health <= 0) { this.alive = false; this.health = 0; this.deadFor = 0; this.body.setWrecked(true); }
  }
}

/** The range's vehicles: as many as the slider asks, spread round the loop. */
export class RangeCars {
  readonly group = new THREE.Group();
  cars: RangeCar[] = [];
  onDamage: ((amount: number) => void) | null = null;

  constructor(private ground: Ground, readonly v: RangeCarValues) { this.build(); }

  build() {
    for (const c of this.cars) this.group.remove(c.body.root);
    const n = Math.round(this.v.carCount);
    const kinds: CarKind[] = ["technical", "gunTruck"];
    this.cars = Array.from({ length: n }, (_, i) => new RangeCar(kinds[i % 2], this.ground, this.v, (i / Math.max(1, n)) * Math.PI * 2));
    for (const c of this.cars) { c.onDamage = (a) => this.onDamage?.(a); this.group.add(c.body.root); }
  }

  update(dt: number) { for (const c of this.cars) c.update(dt); }
}
