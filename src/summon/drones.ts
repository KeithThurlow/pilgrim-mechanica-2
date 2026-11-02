// Attack drones, the sim (Keith 2026-11-02: "drones that can fly around the mech and target enemies"; the summoner
// archetype, docs/proposal-summoner.md). Pure: no Three.js, no input, no drawing (dronesDraw.ts draws them; the glue in
// summons.ts feeds them foes from the register and turns their shots into battlefield rounds).
//
// - Idle: the drones hold an orbit round their owner's mech, evenly spaced on a ring that turns slowly, at a height
//   over the sand (never under the dune crest between them and the mech: the ring rides the higher of the two).
// - Hunting: each drone picks a foe within `droneEngage` of the owner: the owner's target lock first (Tab or the soft
//   lock), else one of the nearest few (drones spread over the three nearest by their number). It circles the foe at
//   `droneStrafeR`, firing short bursts when in range. It never strays past `droneLeash` from the owner: a foe out there
//   is dropped and the drone comes home.
// - Damage: a drone has a little health; shot down, it is rebuilt in the owner's bay and relaunched after
//   `droneRebuild` s.
// Rules (rule 12): seeded randomness (spread), commands in (the owner and foes are plain data handed in), events out
// (shots, deaths, launches as plain data), stable ids per drone (a rebuilt drone gets a new id). Ownership: host
// (damage, targets); the owner is the player whose mech carries the bay.
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";

export const DRONE_DEFAULTS = {
  droneCount: 4,
  droneOrbitR: 6.5,
  droneOrbitH: 5.5,
  droneOrbitSpin: 35,
  droneSpeed: 24,
  droneAccel: 45,
  droneGain: 2.6,
  droneBob: 0.25,
  droneEngage: 34,
  droneLeash: 45,
  droneStrafeR: 8,
  droneStrafeH: 4.5,
  droneStrafeSpin: 60,
  droneRange: 24,
  droneRate: 6,
  droneBurst: 6,
  dronePause: 0.7,
  droneDamage: 5,
  droneSpread: 2.5,
  droneHp: 40,
  droneRebuild: 6,
  droneSize: 1.1,
};
export type DroneValues = typeof DRONE_DEFAULTS;

export const DRONE_GROUPS = ["Drones", "Drones: flight", "Drones: guns"];
const G = "Drones", GF = "Drones: flight", GG = "Drones: guns";
export const DRONE_PARAMS: Param[] = [
  { key: "droneCount", label: "Drones", min: 0, max: 12, step: 1, group: G, tip: "How many the bay keeps up at once" },
  { key: "droneHp", label: "Health each", min: 1, max: 400, step: 1, group: G },
  { key: "droneRebuild", label: "Rebuilt after (s)", min: 0.5, max: 60, step: 0.5, group: G, tip: "A drone shot down is rebuilt in the bay and relaunched this long after" },
  { key: "droneSize", label: "Size (m across)", min: 0.4, max: 3, step: 0.05, group: G },
  { key: "droneEngage", label: "Picks foes within (m of the mech)", min: 5, max: 120, step: 1, group: G },
  { key: "droneLeash", label: "Never further than (m from the mech)", min: 10, max: 150, step: 1, group: G },
  { key: "droneOrbitR", label: "Orbit radius (m)", min: 2, max: 20, step: 0.1, group: GF },
  { key: "droneOrbitH", label: "Orbit height (m over the sand)", min: 1, max: 15, step: 0.1, group: GF },
  { key: "droneOrbitSpin", label: "Orbit turns (°/s)", min: 0, max: 180, step: 1, group: GF },
  { key: "droneSpeed", label: "Top speed (m/s)", min: 2, max: 60, step: 0.5, group: GF },
  { key: "droneAccel", label: "Acceleration (m/s²)", min: 2, max: 200, step: 1, group: GF },
  { key: "droneGain", label: "Homing (1/s)", min: 0.2, max: 10, step: 0.1, group: GF, tip: "How hard a drone heads for its spot: speed wanted = distance × this, up to top speed" },
  { key: "droneBob", label: "Bob (m)", min: 0, max: 1.5, step: 0.01, group: GF },
  { key: "droneStrafeR", label: "Circles a foe at (m)", min: 1, max: 30, step: 0.1, group: GF },
  { key: "droneStrafeH", label: "Over a foe at (m over the sand)", min: 1, max: 15, step: 0.1, group: GF },
  { key: "droneStrafeSpin", label: "Circling (°/s)", min: 0, max: 240, step: 1, group: GF },
  { key: "droneRange", label: "Fires within (m)", min: 2, max: 80, step: 0.5, group: GG },
  { key: "droneDamage", label: "Damage per round", min: 0, max: 100, step: 0.5, group: GG },
  { key: "droneRate", label: "Rounds per second in a burst", min: 0.5, max: 30, step: 0.5, group: GG },
  { key: "droneBurst", label: "Rounds per burst", min: 1, max: 40, step: 1, group: GG },
  { key: "dronePause", label: "Pause between bursts (s)", min: 0, max: 5, step: 0.05, group: GG },
  { key: "droneSpread", label: "Spread (°)", min: 0, max: 15, step: 0.1, group: GG },
];

export const DRONE_MAX = 16;
const DEG = Math.PI / 180;

/** The mech that carries the bay: where it is (its centre of mass), its ground velocity, alive. */
export interface DroneOwner { x: number; y: number; z: number; vx: number; vz: number; alive: boolean }
/** A foe a drone can pick: a stable key (the register's id), centre of mass, body radius, ground velocity. */
export interface DroneFoe { key: number; x: number; y: number; z: number; r: number; vx: number; vz: number }
/** A round fired: which drone, from where, at what point (spread applied). */
export interface DroneShot { drone: number; id: number; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; foe: number; damage: number }
export type DroneEvent = { kind: "shot"; shot: DroneShot } | { kind: "down"; drone: number; id: number; x: number; y: number; z: number } | { kind: "launch"; drone: number; id: number };

export class Drones {
  readonly x = new Float32Array(DRONE_MAX); readonly y = new Float32Array(DRONE_MAX); readonly z = new Float32Array(DRONE_MAX);
  readonly vx = new Float32Array(DRONE_MAX); readonly vy = new Float32Array(DRONE_MAX); readonly vz = new Float32Array(DRONE_MAX);
  /** Last acceleration (m/s², flat): the drawer tilts the drone into it. */
  readonly ax = new Float32Array(DRONE_MAX); readonly az = new Float32Array(DRONE_MAX);
  /** Facing (radians, heading convention: 0 faces +Z): toward its foe, else along its flight. */
  readonly heading = new Float32Array(DRONE_MAX);
  readonly hp = new Float32Array(DRONE_MAX);
  /** 1 flying; 0 down (being rebuilt, `rebuild` s left). */
  readonly up = new Uint8Array(DRONE_MAX);
  readonly rebuild = new Float32Array(DRONE_MAX);
  /** The foe it's on (its key), or -1. */
  readonly foe = new Float64Array(DRONE_MAX).fill(-1);
  /** Stable id per drone in the air (rule 12): a rebuilt one gets a new one. */
  readonly id = new Uint32Array(DRONE_MAX);
  /** Firing: time to the next round, rounds left in the burst. */
  private fireClock = new Float32Array(DRONE_MAX);
  private burstLeft = new Uint8Array(DRONE_MAX);
  /** Its spot on a foe's circle (radians), seeded per launch so they don't all stack. */
  private phase = new Float32Array(DRONE_MAX);
  /** Look seed 0..1 (bob, rotor phase). */
  readonly seed = new Float32Array(DRONE_MAX);
  /** Ring angle of the idle orbit. */
  private ring = 0;
  private time = 0;
  private nextId = 1;
  private rs: number;
  /** Drones in use (the slider, at most DRONE_MAX). */
  n = 0;
  /** Rounds fired, drones lost, launches since construction (checks, HUD). */
  shots = 0; lost = 0; launches = 0;
  readonly events: DroneEvent[] = [];
  private order: number[] = [];

  constructor(public v: DroneValues, readonly ground: Ground, seed = 7) { this.rs = (seed >>> 0) || 1; }

  /** Seeded random 0..1 (mulberry32). */
  rand(): number {
    let t = (this.rs = (this.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Drones in the air now. */
  get flying() { let k = 0; for (let i = 0; i < this.n; i++) k += this.up[i]; return k; }

  private launch(i: number, o: DroneOwner) {
    this.up[i] = 1; this.hp[i] = this.v.droneHp; this.foe[i] = -1;
    // Off the mech's back, rising.
    this.x[i] = o.x; this.y[i] = o.y + 1.5; this.z[i] = o.z;
    this.vx[i] = o.vx; this.vy[i] = 6; this.vz[i] = o.vz;
    this.fireClock[i] = 0.3 * this.rand(); this.burstLeft[i] = 0;
    this.phase[i] = this.rand() * Math.PI * 2; this.seed[i] = this.rand();
    this.id[i] = this.nextId++;
    this.launches++;
    this.events.push({ kind: "launch", drone: i, id: this.id[i] });
  }

  /** A hit on drone i: down when its health runs out. */
  hurt(i: number, damage: number) {
    if (!this.up[i]) return;
    this.hp[i] -= damage;
    if (this.hp[i] > 0) return;
    this.up[i] = 0; this.rebuild[i] = this.v.droneRebuild; this.foe[i] = -1; this.lost++;
    this.events.push({ kind: "down", drone: i, id: this.id[i], x: this.x[i], y: this.y[i], z: this.z[i] });
  }

  /** Every drone down at once (the owner's mech destroyed); they come back once it's rebuilt. */
  grounded() { for (let i = 0; i < DRONE_MAX; i++) { this.up[i] = 0; this.rebuild[i] = this.v.droneRebuild; this.foe[i] = -1; } }

  /**
   * One step. foes: what the drones may pick (anything of another team within reach of the owner; the glue filters).
   * lock: the owner's target, preferred when it's within the leash. Events of the step are in `events` (cleared first).
   */
  step(dt: number, o: DroneOwner, foes: readonly DroneFoe[], lock: DroneFoe | null) {
    const v = this.v;
    this.events.length = 0;
    this.time += dt;
    this.ring += v.droneOrbitSpin * DEG * dt;
    const n = Math.max(0, Math.min(DRONE_MAX, Math.round(v.droneCount)));
    for (let i = n; i < this.n; i++) this.up[i] = 0;
    for (let i = this.n; i < n; i++) { this.up[i] = 0; this.rebuild[i] = 0; }
    this.n = n;
    // Foes by distance from the owner (drone k takes one of the nearest few, by its number).
    const order = this.order;
    order.length = 0;
    const leash2 = v.droneLeash * v.droneLeash, eng2 = v.droneEngage * v.droneEngage;
    for (let k = 0; k < foes.length; k++) {
      const f = foes[k], d2 = (f.x - o.x) ** 2 + (f.z - o.z) ** 2;
      if (d2 <= eng2) order.push(k);
    }
    order.sort((a, b) => ((foes[a].x - o.x) ** 2 + (foes[a].z - o.z) ** 2) - ((foes[b].x - o.x) ** 2 + (foes[b].z - o.z) ** 2));
    const lockOk = !!lock && (lock.x - o.x) ** 2 + (lock.z - o.z) ** 2 <= leash2;
    const gY = this.ground.height(o.x, o.z);
    let slot = 0;
    for (let i = 0; i < n; i++) {
      if (!this.up[i]) {
        if (!o.alive) continue;
        this.rebuild[i] -= dt;
        if (this.rebuild[i] <= 0) this.launch(i, o);
        continue;
      }
      // Its foe: the lock, else keep the one it has while it's still about, else one of the nearest few.
      let f: DroneFoe | null = null;
      if (!o.alive) this.foe[i] = -1;
      else if (lockOk) f = lock;
      else {
        const cur = this.foe[i];
        if (cur >= 0) for (const k of order) if (foes[k].key === cur) { f = foes[k]; break; }
        if (!f && order.length) f = foes[order[slot % Math.min(3, order.length)]];
      }
      this.foe[i] = f ? f.key : -1;
      // Where it wants to be.
      let wx: number, wy: number, wz: number;
      const bob = Math.sin(this.time * 2.1 + this.seed[i] * 6.28) * v.droneBob;
      if (f) {
        this.phase[i] += v.droneStrafeSpin * DEG * dt * (this.seed[i] < 0.5 ? 1 : -1);
        const a = this.phase[i];
        wx = f.x + Math.sin(a) * v.droneStrafeR; wz = f.z + Math.cos(a) * v.droneStrafeR;
        // Held inside the leash.
        const lx = wx - o.x, lz = wz - o.z, ld = Math.hypot(lx, lz);
        if (ld > v.droneLeash) { wx = o.x + lx / ld * v.droneLeash; wz = o.z + lz / ld * v.droneLeash; }
        wy = Math.max(this.ground.height(wx, wz), this.ground.height(f.x, f.z)) + v.droneStrafeH + bob;
      } else {
        const a = this.ring + (i / Math.max(1, n)) * Math.PI * 2;
        wx = o.x + Math.sin(a) * v.droneOrbitR; wz = o.z + Math.cos(a) * v.droneOrbitR;
        wy = Math.max(this.ground.height(wx, wz), gY) + v.droneOrbitH + bob;
        // Keep up with a moving mech.
        wx += o.vx * 0.25; wz += o.vz * 0.25;
      }
      slot++;
      // Steer: speed wanted toward the spot, limited; acceleration limited.
      let dx = (wx - this.x[i]) * v.droneGain, dy = (wy - this.y[i]) * v.droneGain, dz = (wz - this.z[i]) * v.droneGain;
      if (!f) { dx += o.vx; dz += o.vz; }
      const s = Math.hypot(dx, dy, dz);
      if (s > v.droneSpeed) { dx *= v.droneSpeed / s; dy *= v.droneSpeed / s; dz *= v.droneSpeed / s; }
      let ax = (dx - this.vx[i]) / dt, ay = (dy - this.vy[i]) / dt, az = (dz - this.vz[i]) / dt;
      const am = Math.hypot(ax, ay, az);
      if (am > v.droneAccel) { ax *= v.droneAccel / am; ay *= v.droneAccel / am; az *= v.droneAccel / am; }
      this.vx[i] += ax * dt; this.vy[i] += ay * dt; this.vz[i] += az * dt;
      this.ax[i] = ax; this.az[i] = az;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      // Never into the sand.
      const floor = this.ground.height(this.x[i], this.z[i]) + 0.8;
      if (this.y[i] < floor) { this.y[i] = floor; if (this.vy[i] < 0) this.vy[i] = 0; }
      // Facing: at its foe, else along its flight.
      if (f) this.heading[i] = Math.atan2(f.x - this.x[i], f.z - this.z[i]);
      else if (this.vx[i] * this.vx[i] + this.vz[i] * this.vz[i] > 1) this.heading[i] = Math.atan2(this.vx[i], this.vz[i]);
      // Guns: bursts while the foe is in range.
      this.fireClock[i] -= dt;
      if (!f) { this.burstLeft[i] = 0; continue; }
      const fd = Math.hypot(f.x - this.x[i], f.y - this.y[i], f.z - this.z[i]);
      if (fd > v.droneRange + f.r || this.fireClock[i] > 0) continue;
      if (this.burstLeft[i] === 0) this.burstLeft[i] = Math.max(1, Math.round(v.droneBurst));
      // Spread: a seeded offset within the cone at the foe's distance.
      const sp = Math.tan(v.droneSpread * DEG) * fd, ra = this.rand() * Math.PI * 2, rr = Math.sqrt(this.rand()) * sp;
      this.events.push({ kind: "shot", shot: {
        drone: i, id: this.id[i], fx: this.x[i], fy: this.y[i] - 0.2, fz: this.z[i],
        tx: f.x + Math.cos(ra) * rr, ty: f.y + Math.sin(ra) * rr * 0.6, tz: f.z - Math.sin(ra) * rr * 0.5, foe: f.key, damage: v.droneDamage,
      } });
      this.shots++;
      this.burstLeft[i]--;
      this.fireClock[i] = this.burstLeft[i] > 0 ? 1 / Math.max(0.1, v.droneRate) : v.dronePause * (0.8 + 0.4 * this.rand());
    }
  }
}
