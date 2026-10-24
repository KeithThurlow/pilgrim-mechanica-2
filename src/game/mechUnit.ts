// A mech on the battlefield: the walker sim (legs), the upper-body sim (torso and two miniguns), the Rampart model,
// health, and its rounds fired into the shared battlefield. Used for the player's mech and for bandit mechs (red
// Ramparts for now, Keith 2026-10-24), so both walk, shoot, kick up dust and take hits the same way.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { WalkerSim, leftOf, type MoveCommand } from "../mech/walker";
import type { WalkerValues } from "../mech/walkerTuning";
import { UpperSim, type UpperValues, type Aim } from "../mech/upper";
import type { RampartBody } from "../mech/rampart";
import type { ToonLook } from "../look/toon";
import type { DustValues } from "../fx/dust";
import type { HitSurface } from "../fx/minigun";
import type { Battlefield, Hittable } from "./battlefield";

export const MECH_DEFAULTS = {
  hull: 1000,
  roundDamage: 9,
  hitRadius: 1.7,
  respawn: 4,
};
export type MechValues = typeof MECH_DEFAULTS;

export const MECH_PARAMS: Param[] = [
  { key: "hull", label: "Hull (hit points)", min: 50, max: 5000, step: 10, group: "Mech health" },
  { key: "roundDamage", label: "Minigun round damage", min: 0, max: 60, step: 0.5, group: "Mech health", tip: "What each of the player's rounds takes off whatever it hits" },
  { key: "hitRadius", label: "Hit size (m)", min: 0.5, max: 3, step: 0.05, group: "Mech health", tip: "Radius of the capsule rounds hit, from the feet up past the hull" },
  { key: "respawn", label: "Rebuilt after (s)", min: 0.5, max: 20, step: 0.5, group: "Mech health", tip: "Lab only: a destroyed player mech stands up again after this long" },
];

export type MechUnitValues = WalkerValues & UpperValues & DustValues & MechValues;

const WRECK = 0x3b3531;

export class MechUnit implements Hittable {
  readonly sim: WalkerSim;
  readonly upper: UpperSim;
  surface: HitSurface = "metal";
  alive = true;
  health: number;
  /** Seconds since destroyed (for the lab's rebuild). */
  deadFor = 0;
  /** Recent damage taken per second (for a HUD flash). */
  hurt = 0;
  /** Paint colour (null: the model's own). */
  paint: number | null = null;
  /** Hull for this mech instead of the shared slider (bandit mechs). */
  hullOverride: number | null = null;
  /** Damage scale on this mech's own rounds (bandit mechs hit softer than the player). */
  damageScale = 1;
  /** Called on each footfall with where and how hard (stomps for infantry, later). */
  onStomp: ((x: number, z: number, strength: number) => void) | null = null;
  stepTimes: number[] = [];
  private clock = 0;
  private shoulder = new THREE.Vector3();
  private muzzle = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private eject = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(
    private bf: Battlefield,
    readonly v: MechUnitValues,
    readonly body: RampartBody,
    private look: ToonLook,
    readonly team: number,
    /** First of the two muzzle-flash slots this mech's guns use (0 for the player: those carry the flash lights). */
    private flashSlot: number,
    /** The player's guns get the full minigun voice and throw brass. */
    readonly player: boolean,
  ) {
    this.sim = new WalkerSim(v, bf.field);
    this.upper = new UpperSim(v);
    this.health = v.hull;
    const sim = this.sim, dust = bf.dust;
    sim.onFootfall = (f, k) => {
      bf.marks.print(f.planted.x, f.planted.z, f.plantedYaw, k);
      dust.stomp(f.planted.x, f.planted.y, f.planted.z, k * (sim.speed > v.walkSpeed + 0.5 ? v.sprintKick : 1), sim.vel.x, sim.vel.z);
      this.onStomp?.(f.planted.x, f.planted.z, k);
    };
    sim.onLiftOff = (f, k) => {
      if (k < 0.15) return;
      const hd = sim.heading;
      dust.kick(f.pos.x, f.pos.y, f.pos.z, -Math.sin(hd), -Math.cos(hd), Math.min(1.6, k) * (sim.speed > v.walkSpeed + 0.5 ? v.sprintKick : 1));
      this.stepTimes.push(this.clock);
      while (this.stepTimes.length && this.clock - this.stepTimes[0] > 3) this.stepTimes.shift();
    };
  }

  get maxHealth() { return this.hullOverride ?? this.v.hull; }

  reset(x: number, z: number, heading: number) {
    this.sim.reset(x, z, heading);
    this.upper.reset(heading);
    this.health = this.maxHealth;
    this.alive = true;
    this.deadFor = 0;
    this.body.paint(this.look, this.paint);
  }

  /** Advance one frame: legs and guns at 120 Hz, fire whatever the guns fired, pose the model. */
  step(dt: number, cmd: MoveCommand, aim: Aim | null, trigger: boolean) {
    this.clock += dt;
    this.hurt = Math.max(0, this.hurt - dt * 400);
    if (!this.alive) { this.deadFor += dt; return; }
    const { sim, upper, body, v } = this;
    body.shoulderLine(this.shoulder);
    const fired: (1 | -1)[] = [];
    const sub = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < sub; i++) {
      sim.update(dt / sub, cmd);
      for (const s of upper.update(dt / sub, sim.heading, this.shoulder, aim, trigger)) fired.push(s);
    }
    body.update(sim, upper);
    const left = leftOf(upper.torsoYaw);
    const spread = (v.spread * Math.PI) / 180;
    for (const s of fired) {
      body.muzzle(s, this.muzzle);
      body.barrel(s, this.dir);
      const tilt = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.tan(spread) * Math.random());
      const d = this.dir.clone().add(tilt.addScaledVector(this.dir, -tilt.dot(this.dir))).normalize();
      if (this.player) body.eject(s, this.eject);
      this.bf.fire(this.flashSlot + (s === 1 ? 0 : 1), this.team, this.muzzle, d, v.range, v.roundDamage * this.damageScale, this.player
        ? { eject: this.eject, outboard: left.clone().multiplyScalar(s), voice: "player" }
        : { voice: "other" });
    }
    if (this.player) {
      this.bf.gunAudio.update(dt, trigger, upper.guns, [body.muzzle(1, new THREE.Vector3()), body.muzzle(-1, new THREE.Vector3())]);
    }
  }

  /** Rounds hit a capsule from the feet up past the hull. */
  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    const p = this.sim.pelvis;
    this.a.set(p.x, p.y - 2.4, p.z);
    this.b.set(p.x, p.y + 1.6, p.z);
    return rayCapsule(o, d, this.a, this.b, this.v.hitRadius, maxDist);
  }

  damage(amount: number, at: THREE.Vector3, dir: THREE.Vector3) {
    if (!this.alive) return;
    this.health -= amount;
    this.hurt += amount;
    void at; void dir;
    if (this.health <= 0) this.destroy();
  }

  private destroy() {
    this.alive = false;
    this.health = 0;
    this.deadFor = 0;
    this.body.paint(this.look, WRECK);
    // A burst of dark smoke and sand where it went down.
    const p = this.sim.pelvis, dust = this.bf.dust;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      dust.emit(1, p.x + Math.cos(a), p.y - 1 + Math.random() * 2, p.z + Math.sin(a), Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s,
        0.8 + Math.random() * 0.8, 3 + Math.random() * 3, 0.85);
    }
    this.bf.dust.stomp(p.x, p.y - 3, p.z, 2.5);
  }
}

/** Distance along a unit ray to a capsule (segment a-b, radius r), or -1. */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, maxDist: number): number {
  // Closest approach between the ray and the segment, then a sphere test there (good enough for hits).
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const aox = o.x - a.x, aoy = o.y - a.y, aoz = o.z - a.z;
  const dd = 1, ee = abx * abx + aby * aby + abz * abz, de = d.x * abx + d.y * aby + d.z * abz;
  const dao = d.x * aox + d.y * aoy + d.z * aoz, eao = abx * aox + aby * aoy + abz * aoz;
  const den = dd * ee - de * de;
  let s = den > 1e-6 ? (de * eao - ee * dao) / den : 0; // along the ray
  let t = ee > 1e-6 ? (eao + s * de) / ee : 0; // along the segment
  t = Math.max(0, Math.min(1, t));
  // Re-solve s for the clamped t.
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  s = (cx - o.x) * d.x + (cy - o.y) * d.y + (cz - o.z) * d.z;
  if (s < 0 || s > maxDist + r) return -1;
  const px = o.x + d.x * s - cx, py = o.y + d.y * s - cy, pz = o.z + d.z * s - cz;
  const dist2 = px * px + py * py + pz * pz;
  if (dist2 > r * r) return -1;
  const back = Math.sqrt(r * r - dist2);
  const hit = s - back;
  return hit >= 0 && hit <= maxDist ? hit : -1;
}
