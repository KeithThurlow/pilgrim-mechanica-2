// Hostile quadruped robots, the sim (no drawing: robotsDraw.ts draws it). Keith 2026-10-24: "robots that are
// quadrupeds, and they kind of swarm across the land. Most ... quite small, but some of them are larger. ... a sense
// of power in their mech, but also a sense of threat."
// Small ones pour over the dunes as a pack (spatial-hash separation plus alignment), close in fast, leap onto the
// mech and latch on, biting until shot off, stomped off or shaken off by a fast mech; a share hang back and plink.
// Big ones advance steadily, stop at mid range and fire heavy bursts; stomps don't move them and they turn slowly.
// Structure of arrays, ROBOT_MAX slots; dead slots are reused once their wreck has sunk (or oldest wreck first).
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";

export const ROBOT_DEFAULTS = {
  // Small ones: the pack.
  robotRunSpeed: 8,
  robotSpeedJitter: 0.15,
  robotAccel: 5,
  robotTurn: 600,
  robotUphill: 0.9,
  robotDownhill: 0.25,
  robotFlank: 35,
  robotSpacing: 1.5,
  robotSepStrength: 4,
  robotGap: 0.45,
  robotAlign: 0.35,
  robotAlignRadius: 3,
  robotHp: 12,
  robotSize: 0.9,
  robotSizeJitter: 0.12,
  robotStride: 0.9,
  robotKeepOut: 0.6,
  robotWaitDist: 4,
  // Small ones: leap, latch, bite.
  robotLeapRange: 5,
  robotLeapSpeed: 11,
  robotLeapArc: 1.6,
  robotLatchReach: 2.2,
  robotMaxLatched: 24,
  robotLatchRing: 0.85,
  robotLatchLow: 1,
  robotLatchHigh: 4,
  robotBiteDamage: 1.5,
  robotBiteInterval: 0.4,
  robotShakeSpeed: 4.5,
  robotShakeTime: 2.5,
  robotGrip: 0.4,
  robotShakeFling: 5,
  // Small shooters.
  robotShooterShare: 0.2,
  robotShootNear: 12,
  robotShootFar: 22,
  robotShootSlack: 6,
  robotShotInterval: 1.1,
  robotShotSpread: 5,
  robotShotDamage: 2,
  // Big ones.
  robotBigShare: 0.1,
  robotBigSize: 4,
  robotBigSizeJitter: 0.12,
  robotBigHp: 400,
  robotBigSpeed: 4,
  robotBigAccel: 1.5,
  robotBigTurn: 45,
  robotBigNear: 18,
  robotBigFar: 30,
  robotBigSlack: 8,
  robotBigStride: 2.6,
  robotBigArc: 12,
  robotBigBurst: 5,
  robotBigRoundInterval: 0.14,
  robotBigPause: 2.4,
  robotBigAim: 1.2,
  robotBigSpread: 2.5,
  robotBigShotDamage: 15,
  // Stomps, hits, wrecks.
  robotStompKill: 0.6,
  robotStompThrow: 6,
  robotStompReach: 2.2,
  robotStompShake: 1,
  robotDownTime: 1.2,
  robotDeathThrow: 4,
  robotDeathPop: 3,
  robotFriction: 5,
  robotGravity: 18,
  robotHitScale: 1.25,
  robotBodyLife: 10,
  robotSinkTime: 2.5,
};
export type RobotValues = typeof ROBOT_DEFAULTS;

const G1 = "Robots", G2 = "Robots: big ones", G3 = "Robots: attack";
export const ROBOT_PARAMS: Param[] = [
  { key: "robotRunSpeed", label: "Run speed (m/s)", min: 1, max: 16, step: 0.1, group: G1 },
  { key: "robotSpeedJitter", label: "Speed spread ±", min: 0, max: 0.5, step: 0.01, group: G1 },
  { key: "robotAccel", label: "Acceleration (1/s)", min: 0.5, max: 20, step: 0.1, group: G1 },
  { key: "robotTurn", label: "Turn rate (°/s)", min: 30, max: 1440, step: 10, group: G1 },
  { key: "robotUphill", label: "Uphill slows", min: 0, max: 4, step: 0.05, group: G1, tip: "Speed lost per unit of slope climbed" },
  { key: "robotDownhill", label: "Downhill boost (max)", min: 0, max: 1, step: 0.01, group: G1 },
  { key: "robotFlank", label: "Flank fan (°)", min: 0, max: 80, step: 1, group: G1, tip: "How wide the pack fans out round the mech on the way in" },
  { key: "robotSpacing", label: "Spacing (m)", min: 0.4, max: 4, step: 0.05, group: G1, tip: "Small ones closer than this steer apart" },
  { key: "robotSepStrength", label: "Separation push (m/s)", min: 0, max: 12, step: 0.1, group: G1 },
  { key: "robotGap", label: "Hard body radius (× size)", min: 0.2, max: 1, step: 0.01, group: G1, tip: "Bodies never overlap closer than the sum of these" },
  { key: "robotAlign", label: "Pack alignment", min: 0, max: 1, step: 0.01, group: G1, tip: "How much each one matches its neighbours' run: 0 loose, 1 a tight pack" },
  { key: "robotAlignRadius", label: "Pack radius (m)", min: 1, max: 8, step: 0.1, group: G1 },
  { key: "robotHp", label: "Health", min: 1, max: 100, step: 1, group: G1 },
  { key: "robotSize", label: "Body length (m)", min: 0.4, max: 2, step: 0.05, group: G1 },
  { key: "robotSizeJitter", label: "Size spread ±", min: 0, max: 0.4, step: 0.01, group: G1 },
  { key: "robotStride", label: "Stride (× size)", min: 0.3, max: 3, step: 0.05, group: G1, tip: "Ground covered per gait cycle, sets how fast the legs trot" },
  { key: "robotKeepOut", label: "Keep clear of mech (m)", min: 0, max: 4, step: 0.05, group: G1 },
  { key: "robotWaitDist", label: "Circle at when full (m)", min: 1, max: 15, step: 0.5, group: G1, tip: "With every latch spot taken, the rest circle this far beyond the mech" },
  { key: "robotLeapRange", label: "Leap from (m)", min: 1, max: 15, step: 0.1, group: G3, tip: "Distance to the mech's side where a small one jumps" },
  { key: "robotLeapSpeed", label: "Leap speed (m/s)", min: 3, max: 30, step: 0.5, group: G3 },
  { key: "robotLeapArc", label: "Leap arc (m)", min: 0, max: 5, step: 0.05, group: G3 },
  { key: "robotLatchReach", label: "Latches within (m)", min: 0.2, max: 6, step: 0.1, group: G3, tip: "If the mech moved more than this during the leap, it misses and falls" },
  { key: "robotMaxLatched", label: "Latch spots", min: 0, max: 64, step: 1, group: G3 },
  { key: "robotLatchRing", label: "Latch ring (× mech radius)", min: 0.3, max: 1.5, step: 0.01, group: G3 },
  { key: "robotLatchLow", label: "Latch from (m)", min: 0, max: 6, step: 0.1, group: G3 },
  { key: "robotLatchHigh", label: "Latch up to (m)", min: 0.5, max: 8, step: 0.1, group: G3 },
  { key: "robotBiteDamage", label: "Bite damage", min: 0, max: 20, step: 0.1, group: G3 },
  { key: "robotBiteInterval", label: "Bite every (s)", min: 0.05, max: 3, step: 0.05, group: G3 },
  { key: "robotShakeSpeed", label: "Shaken off above (m/s)", min: 0, max: 10, step: 0.1, group: G3, tip: "The mech moving faster than this works latched ones loose" },
  { key: "robotShakeTime", label: "Shaken off after (s)", min: 0.1, max: 10, step: 0.1, group: G3 },
  { key: "robotGrip", label: "Grip spread ±", min: 0, max: 0.8, step: 0.01, group: G3 },
  { key: "robotShakeFling", label: "Fling off speed (m/s)", min: 0, max: 15, step: 0.1, group: G3 },
  { key: "robotShooterShare", label: "Shooters (share)", min: 0, max: 1, step: 0.01, group: G3, tip: "Small ones that hang back and shoot instead of leaping" },
  { key: "robotShootNear", label: "Shooters near (m)", min: 3, max: 40, step: 0.5, group: G3 },
  { key: "robotShootFar", label: "Shooters far (m)", min: 4, max: 60, step: 0.5, group: G3 },
  { key: "robotShootSlack", label: "Shooters chase past (m)", min: 1, max: 20, step: 0.5, group: G3 },
  { key: "robotShotInterval", label: "Shooter shot every (s)", min: 0.1, max: 5, step: 0.05, group: G3 },
  { key: "robotShotSpread", label: "Shooter spread (°)", min: 0, max: 20, step: 0.1, group: G3 },
  { key: "robotShotDamage", label: "Shooter round damage", min: 0, max: 30, step: 0.5, group: G3, tip: "For the lab: what a small one's round does to the mech" },
  { key: "robotBigShare", label: "Big ones (share)", min: 0, max: 1, step: 0.01, group: G2 },
  { key: "robotBigSize", label: "Body length (m)", min: 1.5, max: 8, step: 0.05, group: G2 },
  { key: "robotBigSizeJitter", label: "Size spread ±", min: 0, max: 0.4, step: 0.01, group: G2 },
  { key: "robotBigHp", label: "Health", min: 10, max: 3000, step: 10, group: G2 },
  { key: "robotBigSpeed", label: "Walk speed (m/s)", min: 0.5, max: 10, step: 0.1, group: G2 },
  { key: "robotBigAccel", label: "Acceleration (1/s)", min: 0.2, max: 10, step: 0.1, group: G2 },
  { key: "robotBigTurn", label: "Turn rate (°/s)", min: 5, max: 360, step: 1, group: G2 },
  { key: "robotBigNear", label: "Stops from (m)", min: 5, max: 60, step: 0.5, group: G2 },
  { key: "robotBigFar", label: "Stops up to (m)", min: 6, max: 80, step: 0.5, group: G2 },
  { key: "robotBigSlack", label: "Chase again past (m)", min: 1, max: 30, step: 0.5, group: G2 },
  { key: "robotBigStride", label: "Stride (× size)", min: 0.2, max: 2, step: 0.05, group: G2 },
  { key: "robotBigArc", label: "Fires within (°)", min: 1, max: 90, step: 1, group: G2, tip: "Only fires when turned this close to the mech" },
  { key: "robotBigBurst", label: "Rounds per burst", min: 1, max: 20, step: 1, group: G2 },
  { key: "robotBigRoundInterval", label: "Time between rounds (s)", min: 0.03, max: 1, step: 0.01, group: G2 },
  { key: "robotBigPause", label: "Pause between bursts (s)", min: 0.2, max: 8, step: 0.05, group: G2 },
  { key: "robotBigAim", label: "Aim before first burst (s)", min: 0, max: 4, step: 0.05, group: G2 },
  { key: "robotBigSpread", label: "Spread (°)", min: 0, max: 15, step: 0.1, group: G2 },
  { key: "robotBigShotDamage", label: "Round damage", min: 0, max: 100, step: 0.5, group: G2, tip: "For the lab: what a big one's round does to the mech" },
  { key: "robotStompKill", label: "Stomp kills within (× radius)", min: 0, max: 1, step: 0.01, group: G1 },
  { key: "robotStompThrow", label: "Stomp throw (m/s)", min: 0, max: 15, step: 0.1, group: G1 },
  { key: "robotStompReach", label: "Stomp knocks off below (m)", min: 0, max: 6, step: 0.1, group: G3, tip: "Latched ones lower than this near the foot are knocked off" },
  { key: "robotStompShake", label: "Stomp shakes the rest (s)", min: 0, max: 5, step: 0.05, group: G3, tip: "Every stomp adds this to the shake-off clock of the higher ones" },
  { key: "robotDownTime", label: "Down for (s)", min: 0.2, max: 6, step: 0.05, group: G1 },
  { key: "robotDeathThrow", label: "Death throw (m/s)", min: 0, max: 15, step: 0.1, group: G1 },
  { key: "robotDeathPop", label: "Death pop up (m/s)", min: 0, max: 10, step: 0.1, group: G1 },
  { key: "robotFriction", label: "Wreck slide friction", min: 0.5, max: 20, step: 0.1, group: G1 },
  { key: "robotGravity", label: "Gravity (m/s²)", min: 2, max: 40, step: 0.5, group: G1 },
  { key: "robotHitScale", label: "Hit size (× body)", min: 0.5, max: 2.5, step: 0.05, group: G1, tip: "Rounds test an ellipsoid the body's size times this" },
  { key: "robotBodyLife", label: "Wrecks stay (s)", min: 1, max: 60, step: 0.5, group: G1 },
  { key: "robotSinkTime", label: "Sink at the end (s)", min: 0.1, max: 10, step: 0.1, group: G1 },
];

/** Body proportions, × size (body length). The drawer builds to these so hits match the look. */
export const BODY_W = 0.5, BODY_H = 0.3, BODY_Y = 0.5;
/** Legs: hip spread along and across the body, upper and lower segment lengths, all × size. */
export const HIP_X = 0.28, HIP_Z = 0.36, THIGH = 0.33, SHIN = 0.36;

export const ROBOT_MAX = 1024;
export const RUN = 0, LEAP = 1, LATCHED = 2, FIRE = 3, FLUNG = 4, DOWN = 5, DEAD = 6;
/** An unused slot. */
export const EMPTY = 255;
export const SMALL = 0, BIG = 1;

const DEG = Math.PI / 180;
const HASH_SIZE = 4096, HASH_MASK = HASH_SIZE - 1;
const SLOTS_MAX = 64;

/** The mech: aim point (x, y, z; y is where to shoot), its body radius, and optionally its velocity. */
export interface RobotTarget { x: number; y: number; z: number; radius: number; vx?: number; vz?: number }
export type RobotShotFn = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, big: boolean) => void;
export type RobotBiteFn = (i: number, damage: number) => void;

/** True while a robot is off the ground on purpose (leaping, latched, flung). */
export const isAirborne = (s: number) => s === LEAP || s === LATCHED || s === FLUNG;

export class RobotSwarm {
  readonly px = new Float32Array(ROBOT_MAX); readonly py = new Float32Array(ROBOT_MAX); readonly pz = new Float32Array(ROBOT_MAX);
  readonly vx = new Float32Array(ROBOT_MAX); readonly vy = new Float32Array(ROBOT_MAX); readonly vz = new Float32Array(ROBOT_MAX);
  /** Facing (radians, 0 = +Z). Latched ones face the mech's centre. */
  readonly heading = new Float32Array(ROBOT_MAX);
  readonly hp = new Float32Array(ROBOT_MAX);
  /** Body length (m). */
  readonly size = new Float32Array(ROBOT_MAX);
  readonly kind = new Uint8Array(ROBOT_MAX);
  readonly state = new Uint8Array(ROBOT_MAX).fill(EMPTY);
  /** Seconds in the current state (DEAD: since death; the drawer collapses and sinks from it). */
  readonly stateTime = new Float32Array(ROBOT_MAX);
  /** Trot cycle (radians, advances with ground covered). */
  readonly gait = new Float32Array(ROBOT_MAX);
  /** Wreck tumble (radians about the body's long axis) and its spin rate; the death fall direction. */
  readonly tumble = new Float32Array(ROBOT_MAX); readonly spin = new Float32Array(ROBOT_MAX);
  readonly fallYaw = new Float32Array(ROBOT_MAX);
  /** Smoothed climb along the run (rise over run). */
  readonly slope = new Float32Array(ROBOT_MAX);
  /** Small ones that shoot instead of leaping. */
  readonly shooter = new Uint8Array(ROBOT_MAX);
  /** Latch spot taken while leaping or latched (-1 none). */
  readonly slot = new Int16Array(ROBOT_MAX).fill(-1);
  readonly fireClock = new Float32Array(ROBOT_MAX);
  readonly burstLeft = new Uint8Array(ROBOT_MAX);
  /** Shake-off clock while latched. */
  readonly shake = new Float32Array(ROBOT_MAX);
  /** Per-robot spreads: speed ×, grip ×, stopping distance 0..1, flank side -1..1, look seed 0..1. */
  readonly speedK = new Float32Array(ROBOT_MAX); readonly gripK = new Float32Array(ROBOT_MAX);
  readonly range = new Float32Array(ROBOT_MAX); readonly flank = new Float32Array(ROBOT_MAX);
  readonly seed = new Float32Array(ROBOT_MAX);
  /** Bumped every time a slot is (re)spawned, so the drawer can reset per-slot state. */
  readonly gen = new Uint32Array(ROBOT_MAX);
  /** Live (not DEAD) robots. */
  count = 0;
  /** One past the highest slot ever used: loops stop here. */
  hi = 0;
  /** Rounds fired and bites made since construction (for checks and HUDs). */
  shots = 0; bites = 0;
  /** Ground height under the mech last update (latch spots ride on it). */
  baseY = 0;

  // Leap start and aim point.
  private lx = new Float32Array(ROBOT_MAX); private ly = new Float32Array(ROBOT_MAX); private lz = new Float32Array(ROBOT_MAX);
  private ax = new Float32Array(ROBOT_MAX); private ay = new Float32Array(ROBOT_MAX); private az = new Float32Array(ROBOT_MAX);
  private leapT = new Float32Array(ROBOT_MAX);
  private slotOwner = new Int32Array(SLOTS_MAX).fill(-1);
  private latchN = 0;
  // Spatial hash (counting sort, rebuilt every update) over grounded live robots.
  private cellStart = new Int32Array(HASH_SIZE + 1);
  private cellFill = new Int32Array(HASH_SIZE);
  private cellOf = new Int32Array(ROBOT_MAX);
  private sorted = new Int32Array(ROBOT_MAX);
  private inv = 1;
  private cx = new Float32Array(ROBOT_MAX); private cz = new Float32Array(ROBOT_MAX);
  private maxRad = 0.5;
  private rs: number;
  private tPrevX = NaN; private tPrevZ = NaN;
  private tvx = 0; private tvz = 0;
  private tx = 0; private tz = 0; private tr = 2;

  constructor(public v: RobotValues, readonly ground: Ground, seed = 1) {
    this.rs = (seed >>> 0) || 1;
  }

  /** Robots latched on the mech right now. */
  get latchedCount(): number { return this.latchN; }

  /** Seeded random 0..1 (mulberry32). */
  rand(): number {
    let t = (this.rs = (this.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private freeSlot(): number {
    for (let i = 0; i < this.hi; i++) if (this.state[i] === EMPTY) return i;
    if (this.hi < ROBOT_MAX) return this.hi++;
    let best = -1, bestT = -1;
    for (let i = 0; i < ROBOT_MAX; i++) if (this.state[i] === DEAD && this.stateTime[i] > bestT) { bestT = this.stateTime[i]; best = i; }
    return best;
  }

  /** n robots around (cx, cz) within radius; a share of them big. */
  spawn(n: number, cx: number, cz: number, radius: number): void {
    const v = this.v;
    const bigN = Math.round(n * v.robotBigShare);
    for (let k = 0; k < n; k++) {
      const i = this.freeSlot();
      if (i < 0) return;
      // Big ones spread evenly through the group (every n/bigN-th), the rest small.
      const big = bigN > 0 && Math.floor(((k + 1) * bigN) / n) !== Math.floor((k * bigN) / n);
      const r = radius * Math.sqrt((k + 0.5) / n), a = k * 2.39996 + this.rand() * 0.5;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      this.px[i] = x; this.pz[i] = z; this.py[i] = this.ground.height(x, z);
      this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
      this.heading[i] = Math.atan2(cx - x, cz - z) + Math.PI + (this.rand() - 0.5);
      this.kind[i] = big ? BIG : SMALL;
      this.size[i] = big ? v.robotBigSize * (1 + (this.rand() * 2 - 1) * v.robotBigSizeJitter) : v.robotSize * (1 + (this.rand() * 2 - 1) * v.robotSizeJitter);
      this.hp[i] = big ? v.robotBigHp : v.robotHp;
      this.state[i] = RUN; this.stateTime[i] = 0;
      this.gait[i] = this.rand() * Math.PI * 2;
      this.tumble[i] = 0; this.spin[i] = 0; this.fallYaw[i] = 0; this.slope[i] = 0;
      this.shooter[i] = !big && this.rand() < v.robotShooterShare ? 1 : 0;
      this.slot[i] = -1;
      this.fireClock[i] = 0; this.burstLeft[i] = 0; this.shake[i] = 0;
      this.speedK[i] = 1 + (this.rand() * 2 - 1) * v.robotSpeedJitter;
      this.gripK[i] = 1 + (this.rand() * 2 - 1) * v.robotGrip;
      this.range[i] = this.rand(); this.flank[i] = this.rand() * 2 - 1; this.seed[i] = this.rand();
      this.gen[i]++;
      this.count++;
    }
  }

  /** Hard body radius (m). */
  private rad(i: number) { return this.size[i] * this.v.robotGap; }

  private hashOf(x: number, z: number): number {
    const ix = Math.floor(x * this.inv), iz = Math.floor(z * this.inv);
    return (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & HASH_MASK;
  }

  private grounded(s: number) { return s === RUN || s === FIRE || s === DOWN; }

  private buildHash() {
    const { cellStart, cellFill, cellOf, sorted, state } = this;
    const v = this.v;
    this.inv = 1 / Math.max(0.5, v.robotSpacing, v.robotAlignRadius);
    cellStart.fill(0);
    let maxRad = 0;
    for (let i = 0; i < this.hi; i++) {
      if (!this.grounded(state[i])) continue;
      maxRad = Math.max(maxRad, this.rad(i));
      const h = this.hashOf(this.px[i], this.pz[i]);
      cellOf[i] = h; cellStart[h + 1]++;
    }
    this.maxRad = maxRad;
    for (let h = 0; h < HASH_SIZE; h++) cellStart[h + 1] += cellStart[h];
    cellFill.set(cellStart.subarray(0, HASH_SIZE));
    for (let i = 0; i < this.hi; i++) if (this.grounded(state[i])) sorted[cellFill[cellOf[i]]++] = i;
  }

  /**
   * Visit grounded live robots that may be within r of (x, z) (hash collisions give extras, so callers still test
   * the distance). Valid until the next update.
   */
  near(x: number, z: number, r: number, fn: (j: number) => void) {
    const inv = this.inv, x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const z0 = Math.floor((z - r) * inv), z1 = Math.floor((z + r) * inv);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const h = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & HASH_MASK;
      for (let s = this.cellStart[h], e = this.cellStart[h + 1]; s < e; s++) fn(this.sorted[s]);
    }
  }

  /** World position of latch spot k on the mech (on a ring round it, heights spread low to high). */
  private slotPos(k: number, out: number[]) {
    const v = this.v, a = k * 2.39996, f = (k * 0.6180339 + 0.31) % 1;
    const r = this.tr * v.robotLatchRing;
    out[0] = this.tx + Math.sin(a) * r;
    out[1] = this.baseY + v.robotLatchLow + f * Math.max(0, v.robotLatchHigh - v.robotLatchLow);
    out[2] = this.tz + Math.cos(a) * r;
  }

  /** The free latch spot facing robot i best, or -1. */
  private claimSlot(i: number): number {
    const n = Math.min(SLOTS_MAX, Math.max(0, Math.round(this.v.robotMaxLatched)));
    const bearing = Math.atan2(this.px[i] - this.tx, this.pz[i] - this.tz);
    let best = -1, bestD = Infinity;
    for (let k = 0; k < n; k++) {
      if (this.slotOwner[k] >= 0) continue;
      let d = k * 2.39996 - bearing;
      d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0) { this.slotOwner[best] = i; this.slot[i] = best; }
    return best;
  }

  private freeLatch(i: number) {
    const k = this.slot[i];
    if (k >= 0 && this.slotOwner[k] === i) this.slotOwner[k] = -1;
    this.slot[i] = -1;
  }

  private setState(i: number, s: number) {
    if (this.state[i] === LATCHED) this.latchN--;
    if (s === LATCHED) this.latchN++;
    if (s !== LEAP && s !== LATCHED) this.freeLatch(i);
    this.state[i] = s; this.stateTime[i] = 0;
  }

  private tmp = [0, 0, 0];

  update(dt: number, target: RobotTarget, onShot: RobotShotFn, onBite?: RobotBiteFn): void {
    const v = this.v, { px, py, pz, vx, vy, vz, state, stateTime, size } = this;
    if (dt <= 0) return;
    // The mech's motion: given, or measured from its last position.
    if (target.vx !== undefined && target.vz !== undefined) { this.tvx = target.vx; this.tvz = target.vz; }
    else if (Number.isFinite(this.tPrevX)) {
      const k = Math.min(1, dt * 8);
      this.tvx += ((target.x - this.tPrevX) / dt - this.tvx) * k;
      this.tvz += ((target.z - this.tPrevZ) / dt - this.tvz) * k;
    }
    this.tPrevX = target.x; this.tPrevZ = target.z;
    this.tx = target.x; this.tz = target.z; this.tr = target.radius;
    this.baseY = this.ground.height(target.x, target.z);
    const tSpeed = Math.hypot(this.tvx, this.tvz);
    this.buildHash();

    const keep = target.radius + v.robotKeepOut;
    const sp = v.robotSpacing, sp2 = sp * sp, ar = v.robotAlignRadius, ar2 = ar * ar;
    const reach = Math.max(sp, ar);
    const cx = this.cx, cz = this.cz, tmp = this.tmp, g = v.robotGravity;
    const slotsFull = () => this.latchN + this.leaping() >= Math.min(SLOTS_MAX, Math.round(v.robotMaxLatched));
    let full = slotsFull();

    for (let i = 0; i < this.hi; i++) {
      const s = state[i];
      cx[i] = 0; cz[i] = 0;
      if (s === EMPTY) continue;
      stateTime[i] += dt;
      const big = this.kind[i] === BIG;

      if (s === DEAD) {
        if (stateTime[i] >= v.robotBodyLife) { state[i] = EMPTY; continue; }
        this.ballistic(i, dt, g);
        continue;
      }

      if (s === FLUNG) {
        if (this.ballistic(i, dt, g)) { this.setState(i, DOWN); }
        continue;
      }

      if (s === LEAP) {
        const T = this.leapT[i], t = Math.min(1, stateTime[i] / T);
        const ox = px[i], oz = pz[i];
        px[i] = this.lx[i] + (this.ax[i] - this.lx[i]) * t;
        pz[i] = this.lz[i] + (this.az[i] - this.lz[i]) * t;
        py[i] = this.ly[i] + (this.ay[i] - this.ly[i]) * t + 4 * v.robotLeapArc * t * (1 - t);
        vx[i] = (px[i] - ox) / dt; vz[i] = (pz[i] - oz) / dt;
        if (t >= 1) {
          this.slotPos(this.slot[i], tmp);
          if (Math.hypot(tmp[0] - px[i], tmp[1] - py[i], tmp[2] - pz[i]) < v.robotLatchReach) {
            this.setState(i, LATCHED);
            this.shake[i] = 0; this.fireClock[i] = v.robotBiteInterval * this.rand();
          } else {
            // Missed: falls off the side.
            this.setState(i, FLUNG);
            vy[i] = 0; vx[i] *= 0.3; vz[i] *= 0.3;
          }
        }
        continue;
      }

      if (s === LATCHED) {
        this.slotPos(this.slot[i], tmp);
        px[i] = tmp[0]; py[i] = tmp[1]; pz[i] = tmp[2];
        vx[i] = this.tvx; vz[i] = this.tvz;
        this.heading[i] = Math.atan2(target.x - px[i], target.z - pz[i]);
        this.gait[i] += dt * 9; // scrabbling
        // Bite.
        this.fireClock[i] -= dt;
        if (this.fireClock[i] <= 0) {
          this.fireClock[i] += v.robotBiteInterval;
          this.bites++;
          onBite?.(i, v.robotBiteDamage);
        }
        // A fast mech works it loose; a slow one lets the clock fade.
        if (tSpeed > v.robotShakeSpeed) this.shake[i] += dt;
        else this.shake[i] = Math.max(0, this.shake[i] - dt * 0.5);
        if (this.shake[i] > v.robotShakeTime * this.gripK[i]) this.fling(i, v.robotShakeFling);
        continue;
      }

      const tx = target.x - px[i], tz = target.z - pz[i];
      const dist = Math.hypot(tx, tz) || 1e-6;
      const ux = tx / dist, uz = tz / dist;

      let st = s;
      if (st === DOWN) {
        if (stateTime[i] >= v.robotDownTime * (0.8 + 0.4 * this.seed[i])) st = RUN;
      } else if (big) {
        const stop = v.robotBigNear + this.range[i] * Math.max(0, v.robotBigFar - v.robotBigNear);
        if (st === RUN && dist <= stop) st = FIRE;
        else if (st === FIRE && dist > stop + v.robotBigSlack) st = RUN;
      } else if (this.shooter[i]) {
        const stop = v.robotShootNear + this.range[i] * Math.max(0, v.robotShootFar - v.robotShootNear);
        if (st === RUN && dist <= stop) st = FIRE;
        else if (st === FIRE && dist > stop + v.robotShootSlack) st = RUN;
      } else if (st === RUN && dist - target.radius < v.robotLeapRange && !full && stateTime[i] > 0.2) {
        if (this.startLeap(i, dt)) { full = slotsFull(); continue; }
      }
      if (st !== s) {
        this.setState(i, st);
        if (st === FIRE) { this.fireClock[i] = (big ? v.robotBigAim : v.robotShotInterval) * (0.5 + this.rand()); this.burstLeft[i] = 0; }
      }

      // Desired velocity.
      let wx = 0, wz = 0, face = NaN;
      const hill = Math.max(0.3, Math.min(1 + v.robotDownhill, 1 - this.slope[i] * v.robotUphill));
      if (st === RUN) {
        const spd = (big ? v.robotBigSpeed : v.robotRunSpeed) * this.speedK[i] * hill;
        if (!big && !this.shooter[i] && full && dist < keep + v.robotWaitDist * 1.4 + 2) {
          // Every spot is taken: circle the mech, waiting for one to come free.
          // A band, not a ring, so the waiting pack doesn't pile up on one circle.
          const want = keep + v.robotWaitDist * (0.6 + 0.8 * this.range[i]), side = this.flank[i] < 0 ? -1 : 1;
          const radial = Math.max(-1, Math.min(1, (dist - want) * 0.3));
          wx = (ux * radial - uz * side * 0.7) * spd * 0.5; wz = (uz * radial + ux * side * 0.7) * spd * 0.5;
        } else {
          const fa = this.flank[i] * v.robotFlank * DEG * Math.min(1, dist / 50);
          const c = Math.cos(fa), sn = Math.sin(fa);
          wx = (ux * c - uz * sn) * spd; wz = (uz * c + ux * sn) * spd;
        }
      } else if (st === FIRE) {
        face = Math.atan2(ux, uz);
        const near = big ? v.robotBigNear : v.robotShootNear;
        if (dist < near) { const back = (big ? v.robotBigSpeed : v.robotRunSpeed) * 0.35; wx = -ux * back; wz = -uz * back; }
      }

      const turn = (big ? v.robotBigTurn : v.robotTurn) * DEG * dt;
      if (st === DOWN) {
        const f = Math.max(0, 1 - v.robotFriction * dt);
        vx[i] *= f; vz[i] *= f;
      } else {
        // Separation (soft), alignment with the pack, and a hard gap (positional, applied after the loop).
        let sx = 0, sz = 0, avx = 0, avz = 0, an = 0;
        const xi = px[i], zi = pz[i], ri = this.rad(i), wide = Math.max(reach, ri + this.maxRad);
        const inv = this.inv;
        const x0 = Math.floor((xi - wide) * inv), x1 = Math.floor((xi + wide) * inv);
        const z0 = Math.floor((zi - wide) * inv), z1 = Math.floor((zi + wide) * inv);
        for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
          const h = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & HASH_MASK;
          for (let q = this.cellStart[h], e = this.cellStart[h + 1]; q < e; q++) {
            const j = this.sorted[q];
            if (j === i) continue;
            const dx = xi - px[j], dz = zi - pz[j], d2 = dx * dx + dz * dz;
            const rj = this.rad(j), gap = ri + rj;
            const soft = Math.max(sp, gap * 1.3);
            if (d2 >= soft * soft && d2 >= ar2) continue;
            const d = Math.sqrt(d2);
            let nx: number, nz: number;
            if (d > 1e-5) { nx = dx / d; nz = dz / d; } else { const a = (i * 2.39996) % (Math.PI * 2); nx = Math.cos(a); nz = Math.sin(a); }
            if (d < soft) { const w = 1 - d / soft; sx += nx * w; sz += nz * w; }
            if (d2 < ar2 && this.kind[j] === this.kind[i] && state[j] === RUN) { avx += vx[j]; avz += vz[j]; an++; }
            if (d < gap) {
              // Big ones shove small ones; equals share the push.
              const share = this.kind[i] === this.kind[j] ? 0.5 : this.kind[i] === BIG ? 0 : 1;
              const push = (gap - d) * share; cx[i] += nx * push; cz[i] += nz * push;
            }
          }
        }
        if (sp2 > 0) { wx += sx * v.robotSepStrength; wz += sz * v.robotSepStrength; }
        if (an > 0 && st === RUN) {
          const k = v.robotAlign;
          wx += (avx / an - wx) * k; wz += (avz / an - wz) * k;
        }
        // Don't press into the mech.
        if (dist < keep + 1.5) {
          const into = wx * ux + wz * uz;
          if (into > 0) { wx -= ux * into; wz -= uz * into; }
        }
        const steer = Math.min(1, (big ? v.robotBigAccel : v.robotAccel) * dt);
        vx[i] += (wx - vx[i]) * steer; vz[i] += (wz - vz[i]) * steer;
        // Big ones only walk the way they face: their body has to turn first.
        const speed2 = vx[i] * vx[i] + vz[i] * vz[i];
        if (Number.isNaN(face) && speed2 > 0.25) face = Math.atan2(vx[i], vz[i]);
        if (!Number.isNaN(face)) {
          let dh = face - this.heading[i];
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          this.heading[i] += Math.max(-turn, Math.min(turn, dh));
        }
        if (big && speed2 > 1e-4) {
          const hx = Math.sin(this.heading[i]), hz = Math.cos(this.heading[i]);
          const along = Math.max(st === FIRE ? -v.robotBigSpeed : 0, vx[i] * hx + vz[i] * hz);
          const side = (vx[i] * hz - vz[i] * hx) * 0.3;
          vx[i] = hx * along + hz * side; vz[i] = hz * along - hx * side;
        }
      }

      // Guns.
      if (st === FIRE) {
        let dh = Math.atan2(ux, uz) - this.heading[i];
        dh = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
        this.fireClock[i] -= dt;
        if (big) {
          if (this.fireClock[i] <= 0 && dh < v.robotBigArc * DEG) {
            if (this.burstLeft[i] === 0) this.burstLeft[i] = Math.max(1, Math.round(v.robotBigBurst));
            this.fire(i, target, v.robotBigSpread * DEG, size[i] * (BODY_Y + BODY_H * 0.3), 0.55, true, onShot);
            this.burstLeft[i]--;
            this.fireClock[i] = this.burstLeft[i] > 0 ? v.robotBigRoundInterval : v.robotBigPause * (0.7 + 0.6 * this.rand());
          }
        } else if (this.fireClock[i] <= 0 && dh < 0.5) {
          this.fire(i, target, v.robotShotSpread * DEG, size[i] * (BODY_Y + BODY_H * 0.3), 0.55, false, onShot);
          this.fireClock[i] = v.robotShotInterval * (0.7 + 0.6 * this.rand());
        }
      }
    }

    // Move, apply the hard gaps, keep clear of the mech, stand on the sand, trot.
    for (let i = 0; i < this.hi; i++) {
      const s = state[i];
      if (!this.grounded(s)) continue;
      const ox = px[i], oz = pz[i], oy = py[i];
      let x = ox + vx[i] * dt + cx[i], z = oz + vz[i] * dt + cz[i];
      const dx = x - target.x, dz = z - target.z, d = Math.hypot(dx, dz), m = keep + this.rad(i) * 0.5;
      if (d < m) {
        if (d > 1e-5) { x = target.x + (dx / d) * m; z = target.z + (dz / d) * m; } else { x = target.x + m; }
      }
      px[i] = x; pz[i] = z; vy[i] = 0;
      const y = this.ground.height(x, z);
      py[i] = y;
      const run = Math.hypot(x - ox, z - oz);
      if (run > 1e-4) {
        const k = Math.min(1, dt * 4);
        this.slope[i] += ((y - oy) / run - this.slope[i]) * k;
        if (s !== DOWN) {
          const stride = size[i] * (this.kind[i] === BIG ? v.robotBigStride : v.robotStride);
          this.gait[i] += (run / Math.max(0.05, stride)) * Math.PI * 2;
        }
      }
    }
    // Keep gait phases bounded (Float32 loses the fraction on big numbers).
    for (let i = 0; i < this.hi; i++) if (this.gait[i] > 1000) this.gait[i] -= Math.PI * 2 * 150;
  }

  private leaping(): number {
    let n = 0;
    const m = Math.min(SLOTS_MAX, Math.round(this.v.robotMaxLatched));
    for (let k = 0; k < m; k++) { const o = this.slotOwner[k]; if (o >= 0 && this.state[o] === LEAP) n++; }
    return n;
  }

  /** Jump at a free latch spot, aiming where the mech will be on landing. False if no spot is free. */
  private startLeap(i: number, _dt: number): boolean {
    const v = this.v;
    const k = this.claimSlot(i);
    if (k < 0) return false;
    this.slotPos(k, this.tmp);
    const d0 = Math.hypot(this.tmp[0] - this.px[i], this.tmp[2] - this.pz[i]);
    const T = Math.max(0.3, d0 / Math.max(0.5, v.robotLeapSpeed));
    this.lx[i] = this.px[i]; this.ly[i] = this.py[i]; this.lz[i] = this.pz[i];
    this.ax[i] = this.tmp[0] + this.tvx * T; this.ay[i] = this.tmp[1]; this.az[i] = this.tmp[2] + this.tvz * T;
    this.leapT[i] = T;
    this.state[i] = LEAP; this.stateTime[i] = 0;
    this.slot[i] = k;
    this.heading[i] = Math.atan2(this.ax[i] - this.px[i], this.az[i] - this.pz[i]);
    return true;
  }

  /** Throw a latched or leaping robot off the mech, outward. */
  private fling(i: number, speed: number) {
    const dx = this.px[i] - this.tx, dz = this.pz[i] - this.tz, d = Math.hypot(dx, dz) || 1;
    const s = speed * (0.6 + 0.8 * this.rand());
    this.setState(i, FLUNG);
    this.vx[i] = (dx / d) * s + this.tvx; this.vz[i] = (dz / d) * s + this.tvz; this.vy[i] = s * 0.4;
    this.fallYaw[i] = Math.atan2(dx, dz);
    this.spin[i] = (this.rand() * 2 - 1) * 10;
  }

  /** Fall and slide under gravity and friction; true when on the ground. */
  private ballistic(i: number, dt: number, g: number): boolean {
    const { px, py, pz, vx, vy, vz } = this;
    const gy = this.ground.height(px[i], pz[i]);
    const air = py[i] > gy + 1e-3 || vy[i] > 0;
    if (air) {
      vy[i] -= g * dt;
      px[i] += vx[i] * dt; pz[i] += vz[i] * dt; py[i] += vy[i] * dt;
      this.tumble[i] += this.spin[i] * dt;
      const gy2 = this.ground.height(px[i], pz[i]);
      if (py[i] <= gy2) { py[i] = gy2; vy[i] = 0; return true; }
      return false;
    }
    const f = Math.max(0, 1 - this.v.robotFriction * dt);
    vx[i] *= f; vz[i] *= f; this.spin[i] *= f;
    this.tumble[i] += this.spin[i] * dt;
    if (vx[i] * vx[i] + vz[i] * vz[i] > 1e-6) { px[i] += vx[i] * dt; pz[i] += vz[i] * dt; }
    py[i] = this.ground.height(px[i], pz[i]);
    return true;
  }

  private fire(i: number, t: RobotTarget, spread: number, muzzleY: number, fwd: number, big: boolean, onShot: RobotShotFn) {
    const h = this.heading[i], sz = this.size[i];
    const fx = this.px[i] + Math.sin(h) * sz * fwd, fz = this.pz[i] + Math.cos(h) * sz * fwd, fy = this.py[i] + muzzleY;
    let dx = t.x - fx, dy = t.y - fy, dz = t.z - fz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const r = spread * Math.sqrt(this.rand()), a = this.rand() * Math.PI * 2;
    let rx = dz, rz = -dx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = dy * rz, uy = dz * rx - dx * rz, uz = -dy * rx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    const ca = Math.cos(a) * Math.tan(r), sa = Math.sin(a) * Math.tan(r);
    let ex = dx + rx * ca + (ux / ul) * sa, ey = dy + (uy / ul) * sa, ez = dz + rz * ca + (uz / ul) * sa;
    const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    const reach = L * 1.5;
    this.shots++;
    onShot(fx, fy, fz, fx + ex * reach, fy + ey * reach, fz + ez * reach, big);
  }

  /** Nearest live robot hit by a ray (an ellipsoid round the body, sized by size × hit scale), or null. */
  hitRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { index: number; dist: number } | null {
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-9) return null;
    dx /= L; dy /= L; dz /= L;
    const k = this.v.robotHitScale;
    let best = -1, bestT = maxDist;
    for (let i = 0; i < this.hi; i++) {
      const s = this.state[i];
      if (s >= DEAD) continue;
      const S = this.size[i];
      // Quick reject: bounding sphere.
      const cy = this.py[i] + (s === LATCHED ? 0 : S * BODY_Y * (s === DOWN ? 0.4 : 1));
      const qx = ox - this.px[i], qy = oy - cy, qz = oz - this.pz[i];
      const R = S * 0.5 * k;
      const b0 = qx * dx + qy * dy + qz * dz, c0 = qx * qx + qy * qy + qz * qz - R * R;
      if (c0 > 0 && b0 > 0) continue;
      if (b0 * b0 - c0 < 0) continue;
      let t: number;
      if (s === LATCHED || s === LEAP || s === FLUNG) {
        // Clinging or tumbling: the bounding sphere shrunk a little.
        const r = R * 0.75, c = qx * qx + qy * qy + qz * qz - r * r, disc = b0 * b0 - c;
        if (disc < 0) continue;
        t = -b0 - Math.sqrt(disc);
        if (t < 0) t = c < 0 ? 0 : -1;
      } else {
        // Ellipsoid in the body frame: half length, half width, half height.
        const h = this.heading[i], sh = Math.sin(h), ch = Math.cos(h);
        const ea = S * 0.5 * k, eb = S * BODY_W * 0.5 * k, ec = S * BODY_H * 0.5 * k * 1.6;
        const lqz = (qx * sh + qz * ch) / ea, lqx = (qx * ch - qz * sh) / eb, lqy = qy / ec;
        const ldz = (dx * sh + dz * ch) / ea, ldx = (dx * ch - dz * sh) / eb, ldy = dy / ec;
        const a = ldx * ldx + ldy * ldy + ldz * ldz;
        const b = lqx * ldx + lqy * ldy + lqz * ldz;
        const c = lqx * lqx + lqy * lqy + lqz * lqz - 1;
        const disc = b * b - a * c;
        if (disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / a;
        if (t < 0) t = c < 0 ? 0 : -1;
      }
      if (t >= 0 && t < bestT) { bestT = t; best = i; }
    }
    return best < 0 ? null : { index: best, dist: bestT };
  }

  /** Called when a robot dies: its index, the flat direction it was thrown and how hard (m/s). */
  onDeath: ((i: number, nx: number, nz: number, speed: number) => void) | null = null;
  /** True when something else draws the dead (the death physics' ragdolls): the drawer then hides them. */
  hideDead = false;

  private kill(i: number, dirX: number, dirZ: number) {
    const v = this.v, l = Math.hypot(dirX, dirZ);
    const nx = l > 1e-6 ? dirX / l : Math.sin(this.heading[i]), nz = l > 1e-6 ? dirZ / l : Math.cos(this.heading[i]);
    const wasAir = isAirborne(this.state[i]);
    this.setState(i, DEAD);
    this.hp[i] = 0;
    this.fallYaw[i] = Math.atan2(nx, nz);
    if (this.kind[i] === BIG) {
      // Big ones just collapse where they stand.
      this.vx[i] = 0; this.vz[i] = 0; this.vy[i] = 0; this.spin[i] = 0;
    } else {
      const s = v.robotDeathThrow * (0.6 + 0.8 * this.rand());
      this.vx[i] = nx * s + (wasAir ? this.tvx : 0); this.vz[i] = nz * s + (wasAir ? this.tvz : 0);
      this.vy[i] = v.robotDeathPop * (0.5 + this.rand());
      this.spin[i] = (this.rand() < 0.5 ? -1 : 1) * (6 + this.rand() * 8);
    }
    this.count--;
    this.onDeath?.(i, nx, nz, Math.hypot(this.vx[i], this.vz[i]));
  }

  /** Damage a live robot; returns true if this killed it. Small wrecks are thrown along (dirX, dirZ). */
  damage(i: number, amount: number, dirX: number, dirZ: number): boolean {
    if (i < 0 || i >= this.hi || this.state[i] >= DEAD) return false;
    this.hp[i] -= amount;
    if (this.hp[i] > 0) return false;
    this.kill(i, dirX, dirZ);
    return true;
  }

  /**
   * A mech foot landing at (x, z): small ones on the ground closest are crushed, within radius knocked down and
   * thrown; latched ones low on the mech near the foot are knocked off, the rest shaken; big ones don't care.
   */
  stomp(x: number, z: number, radius: number): void {
    const v = this.v, kill = radius * v.robotStompKill;
    for (let i = 0; i < this.hi; i++) {
      const s = this.state[i];
      if (s >= DEAD || this.kind[i] === BIG) continue;
      const dx = this.px[i] - x, dz = this.pz[i] - z, d = Math.hypot(dx, dz);
      if (s === LATCHED) {
        if (d < radius + this.tr && this.py[i] - this.baseY < v.robotStompReach) this.fling(i, v.robotShakeFling);
        else this.shake[i] += v.robotStompShake;
        continue;
      }
      if (s === LEAP || s === FLUNG || d >= radius) continue;
      const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
      if (d < kill) { this.kill(i, nx, nz); continue; }
      const k = 1 - d / radius;
      this.setState(i, DOWN);
      this.fallYaw[i] = Math.atan2(nx, nz);
      this.vx[i] = nx * v.robotStompThrow * (0.5 + k); this.vz[i] = nz * v.robotStompThrow * (0.5 + k);
    }
  }
}
