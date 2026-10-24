// Hostile robots, the sim (no drawing: robotsDraw.ts draws it; shapes and leg maths in robotLegs.ts). Keith
// 2026-10-24: "robots ... swarm across the land. Most ... quite small, but some of them are larger. ... a sense of
// power in their mech, but also a sense of threat." Reshaped the same day (Keith): the small ones are four-legged
// starfish that scuttle and crab in any direction without turning, and tear at the mech's plating once they're on
// it; the big ones are War of the Worlds tripods, a small body high up on very long thin legs, that come in from the
// side and throw long shadows.
// Small ones pour over the dunes as a pack (spatial-hash separation plus alignment), close in fast, leap onto the
// mech and latch on, biting until shot off, stomped off or shaken off by a fast mech; a share hang back and plink.
// Their hub drifts round slowly as they run (the legs carry them any way). Big ones swing in from the flank, stop
// at mid range and fire heavy bursts from the high body; their three feet are planted on the sand and step one at a
// time; stomps don't move them. Structure of arrays, ROBOT_MAX slots; dead slots are reused once their wreck has
// sunk (or oldest wreck first).
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";
import {
  HUB_Y, HUB_H, BIG_LEGS, B_FOOT_R, B_BODY_H, bigLegAngle, bigHeight, bigHip, bigBend, solveKnee, smallLegs, B_THIGH, B_SHIN, type V3,
} from "./robotLegs";

export const ROBOT_DEFAULTS = {
  // Small ones: the pack.
  robotRunSpeed: 8,
  robotSpeedJitter: 0.15,
  robotAccel: 5,
  robotTurn: 600,
  robotDrift: 50,
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
  robotStride: 0.7,
  robotFootLift: 0.14,
  robotKeepOut: 0.6,
  robotWaitDist: 4,
  // Small ones: leap, latch, bite.
  robotLeapRange: 5,
  robotLeapSpeed: 11,
  robotLeapArc: 1.6,
  robotLatchReach: 2.2,
  robotMaxLatched: 24,
  robotLatchRing: 1.05,
  robotLatchLow: 1,
  robotLatchHigh: 4,
  robotBiteDamage: 0.8,
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
  robotShotDamage: 1.2,
  // Big ones.
  robotBigShare: 0.1,
  robotBigSize: 3,
  robotBigHeight: 10,
  robotBigSizeJitter: 0.12,
  robotBigHp: 400,
  robotBigSpeed: 3,
  robotBigAccel: 1.5,
  robotBigTurn: 45,
  robotBigFlank: 60,
  robotBigSpacing: 12,
  robotBigNear: 18,
  robotBigFar: 30,
  robotBigSlack: 8,
  robotBigStepTime: 0.7,
  robotBigStepAt: 0.3,
  robotBigStepLift: 1.8,
  robotBigLegHit: 0.35,
  robotBigLegDamage: 0.5,
  robotBigArc: 12,
  robotBigBurst: 5,
  robotBigRoundInterval: 0.14,
  robotBigPause: 2.4,
  robotBigAim: 1.2,
  robotBigSpread: 2.5,
  robotBigShotDamage: 10,
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
  { key: "robotTurn", label: "Shooters turn (°/s)", min: 30, max: 1440, step: 10, group: G1, tip: "How fast a small shooter turns its hub to aim" },
  { key: "robotDrift", label: "Hub drift (°/s)", min: 0, max: 360, step: 1, group: G1, tip: "Small ones crab any way without turning; the hub just drifts round this fast (each its own way)" },
  { key: "robotUphill", label: "Uphill slows", min: 0, max: 4, step: 0.05, group: G1, tip: "Speed lost per unit of slope climbed" },
  { key: "robotDownhill", label: "Downhill boost (max)", min: 0, max: 1, step: 0.01, group: G1 },
  { key: "robotFlank", label: "Flank fan (°)", min: 0, max: 80, step: 1, group: G1, tip: "How wide the pack fans out round the mech on the way in" },
  { key: "robotSpacing", label: "Spacing (m)", min: 0.4, max: 4, step: 0.05, group: G1, tip: "Small ones closer than this steer apart" },
  { key: "robotSepStrength", label: "Separation push (m/s)", min: 0, max: 12, step: 0.1, group: G1 },
  { key: "robotGap", label: "Hard body radius (× size)", min: 0.2, max: 1, step: 0.01, group: G1, tip: "Bodies never overlap closer than the sum of these" },
  { key: "robotAlign", label: "Pack alignment", min: 0, max: 1, step: 0.01, group: G1, tip: "How much each one matches its neighbours' run: 0 loose, 1 a tight pack" },
  { key: "robotAlignRadius", label: "Pack radius (m)", min: 1, max: 8, step: 0.1, group: G1 },
  { key: "robotHp", label: "Health", min: 1, max: 100, step: 1, group: G1 },
  { key: "robotSize", label: "Size (m)", min: 0.4, max: 2, step: 0.05, group: G1, tip: "Hub centre to foot is about 0.6 × this" },
  { key: "robotSizeJitter", label: "Size spread ±", min: 0, max: 0.4, step: 0.01, group: G1 },
  { key: "robotStride", label: "Stride (× size)", min: 0.2, max: 3, step: 0.05, group: G1, tip: "Ground covered per gait cycle, sets how fast the legs scuttle" },
  { key: "robotFootLift", label: "Foot lift (× size)", min: 0, max: 0.4, step: 0.01, group: G1 },
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
  { key: "robotBigSize", label: "Body size (m)", min: 1, max: 8, step: 0.05, group: G2 },
  { key: "robotBigHeight", label: "Body height (m)", min: 4, max: 20, step: 0.1, group: G2, tip: "How high the tripod carries its body; the legs scale with it" },
  { key: "robotBigSizeJitter", label: "Size spread ±", min: 0, max: 0.4, step: 0.01, group: G2 },
  { key: "robotBigHp", label: "Health", min: 10, max: 3000, step: 10, group: G2 },
  { key: "robotBigSpeed", label: "Walk speed (m/s)", min: 0.5, max: 10, step: 0.1, group: G2 },
  { key: "robotBigAccel", label: "Acceleration (1/s)", min: 0.2, max: 10, step: 0.1, group: G2 },
  { key: "robotBigTurn", label: "Turn rate (°/s)", min: 5, max: 360, step: 1, group: G2 },
  { key: "robotBigFlank", label: "Come in from the side (°)", min: 0, max: 90, step: 1, group: G2, tip: "How far round to the flank they swing on the way in" },
  { key: "robotBigSpacing", label: "Keep apart (m)", min: 0, max: 40, step: 0.5, group: G2 },
  { key: "robotBigNear", label: "Stops from (m)", min: 5, max: 60, step: 0.5, group: G2 },
  { key: "robotBigFar", label: "Stops up to (m)", min: 6, max: 80, step: 0.5, group: G2 },
  { key: "robotBigSlack", label: "Chase again past (m)", min: 1, max: 30, step: 0.5, group: G2 },
  { key: "robotBigStepTime", label: "Step time (s)", min: 0.15, max: 3, step: 0.05, group: G2, tip: "How long one leg takes to swing" },
  { key: "robotBigStepAt", label: "Step when off by (× spread)", min: 0.05, max: 1, step: 0.01, group: G2, tip: "A foot steps when it's this far (× the feet's spread) from where it wants to be" },
  { key: "robotBigStepLift", label: "Step lift (m)", min: 0, max: 6, step: 0.1, group: G2 },
  { key: "robotBigLegHit", label: "Leg hit radius (m)", min: 0, max: 1.5, step: 0.01, group: G2, tip: "Rounds hit the long legs within this" },
  { key: "robotBigLegDamage", label: "Leg hits count (×)", min: 0, max: 2, step: 0.05, group: G2, tip: "Damage share of a round into a leg rather than the body" },
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
  { key: "robotHitScale", label: "Hit size (× body)", min: 0.5, max: 2.5, step: 0.05, group: G1, tip: "Rounds test an ellipsoid round the hub (small) or body (big), its size times this" },
  { key: "robotBodyLife", label: "Wrecks stay (s)", min: 1, max: 60, step: 0.5, group: G1 },
  { key: "robotSinkTime", label: "Sink at the end (s)", min: 0.1, max: 10, step: 0.1, group: G1 },
];

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
  /**
   * World height of the body's centre (the hub for small ones, the high body for tripods); px, pz are under it. py is
   * the sand under the robot when it stands, the hub itself while leaping or latched.
   */
  readonly hubY = new Float32Array(ROBOT_MAX);
  /** Tripod feet (3 per robot, world x y z): where each foot is, and while stepping (stepT ≥ 0) where from and to. */
  readonly footX = new Float32Array(ROBOT_MAX * BIG_LEGS); readonly footY = new Float32Array(ROBOT_MAX * BIG_LEGS); readonly footZ = new Float32Array(ROBOT_MAX * BIG_LEGS);
  /** Step progress 0..1 per tripod foot; -1 planted. */
  readonly stepT = new Float32Array(ROBOT_MAX * BIG_LEGS).fill(-1);
  private sfx0 = new Float32Array(ROBOT_MAX * BIG_LEGS); private sfy0 = new Float32Array(ROBOT_MAX * BIG_LEGS); private sfz0 = new Float32Array(ROBOT_MAX * BIG_LEGS);
  private sfx1 = new Float32Array(ROBOT_MAX * BIG_LEGS); private sfy1 = new Float32Array(ROBOT_MAX * BIG_LEGS); private sfz1 = new Float32Array(ROBOT_MAX * BIG_LEGS);
  /** A tripod foot coming down: robot, foot world position (dust, sound). */
  onFootfall: ((i: number, x: number, y: number, z: number) => void) | null = null;
  /** Set by hitRay: the last hit was on a tripod's leg (not its body). */
  hitLeg = false;
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
      if (big) {
        // Feet planted where they want to be, the body at its height above them.
        const H = this.heightOf(i), spread = B_FOOT_R * H;
        let fy = 0;
        for (let k = 0; k < BIG_LEGS; k++) {
          const a = bigLegAngle(this.heading[i], k), f = i * BIG_LEGS + k;
          this.footX[f] = x + Math.sin(a) * spread; this.footZ[f] = z + Math.cos(a) * spread;
          this.footY[f] = this.ground.height(this.footX[f], this.footZ[f]);
          this.stepT[f] = -1;
          fy += this.footY[f];
        }
        this.hubY[i] = (this.py[i] + fy / BIG_LEGS) * 0.5 + H;
      } else this.hubY[i] = this.py[i] + HUB_Y * this.size[i];
    }
  }

  /**
   * A standing small one's legs (world, 3 × 4 floats each): hips on the hub tilted with the slope under it, feet on
   * the sand sweeping along its run. The drawer and the checks both use this.
   */
  smallLegPose(i: number, hips: Float32Array | number[], feet: Float32Array | number[]) {
    const v = this.v, S = this.size[i], x = this.px[i], y = this.py[i], z = this.pz[i];
    const e = S * 0.4;
    const gx = (this.ground.height(x + e, z) - this.ground.height(x - e, z)) / (2 * e);
    const gz = (this.ground.height(x, z + e) - this.ground.height(x, z - e)) / (2 * e);
    const sp = Math.hypot(this.vx[i], this.vz[i]);
    const move = this.state[i] === DOWN ? 0 : Math.min(1, sp / 3);
    const mx = sp > 1e-3 ? (this.vx[i] / sp) * move : 0, mz = sp > 1e-3 ? (this.vz[i] / sp) * move : 0;
    const bob = Math.abs(Math.sin(this.gait[i] * 2)) * 0.03 * S * move;
    smallLegs(x, y, z, S, this.heading[i], gx, gz, this.gait[i], mx, mz, S * v.robotStride, S * v.robotFootLift * move, bob, hips, feet);
  }

  /** Body height above the sand for a tripod (m). */
  heightOf(i: number) { return bigHeight(this.size[i], this.v.robotBigHeight, this.v.robotBigSize); }

  /**
   * Hard body radius on the ground (m). A tripod has none down there: small ones run between its legs (it keeps
   * other tripods off with robotBigSpacing instead).
   */
  private rad(i: number) { return this.kind[i] === BIG ? 0 : this.size[i] * this.v.robotGap; }

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
        } else if (big) {
          // Tripods swing round to the flank on the way in and come at the mech from the side.
          const f = this.flank[i], side = (f < 0 ? -1 : 1) * (0.5 + 0.5 * Math.abs(f));
          const fa = side * v.robotBigFlank * DEG * Math.min(1, Math.max(0, dist - v.robotBigFar) / 40);
          const c = Math.cos(fa), sn = Math.sin(fa);
          wx = (ux * c - uz * sn) * spd; wz = (uz * c + ux * sn) * spd;
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
        const xi = px[i], zi = pz[i], ri = this.rad(i), wide = Math.max(reach, ri + this.maxRad, big ? v.robotBigSpacing : 0);
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
            const soft = big && this.kind[j] === BIG ? Math.max(sp, v.robotBigSpacing) : Math.max(sp, gap * 1.3);
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
        // Neither kind has to face where it walks: small ones crab on four legs, tripods step any way. A tripod
        // keeps its gun head turned on the mech; a small one's hub just drifts round unless it's aiming.
        if (big && Number.isNaN(face)) face = Math.atan2(ux, uz);
        if (!Number.isNaN(face)) {
          let dh = face - this.heading[i];
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          this.heading[i] += Math.max(-turn, Math.min(turn, dh));
        }
      }
      if (!big && Number.isNaN(face) && st !== DOWN) {
        const drift = v.robotDrift * DEG * (this.seed[i] * 2 - 1) * Math.min(1.5, 0.3 + Math.hypot(vx[i], vz[i]) / Math.max(1, v.robotRunSpeed));
        this.heading[i] += drift * dt;
      }

      // Guns.
      if (st === FIRE) {
        let dh = Math.atan2(ux, uz) - this.heading[i];
        dh = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
        this.fireClock[i] -= dt;
        if (big) {
          if (this.fireClock[i] <= 0 && dh < v.robotBigArc * DEG) {
            if (this.burstLeft[i] === 0) this.burstLeft[i] = Math.max(1, Math.round(v.robotBigBurst));
            this.fire(i, target, v.robotBigSpread * DEG, this.hubY[i] - size[i] * B_BODY_H * 0.2, size[i] * 0.55, true, onShot);
            this.burstLeft[i]--;
            this.fireClock[i] = this.burstLeft[i] > 0 ? v.robotBigRoundInterval : v.robotBigPause * (0.7 + 0.6 * this.rand());
          }
        } else if (this.fireClock[i] <= 0 && dh < 0.5) {
          this.fire(i, target, v.robotShotSpread * DEG, this.hubY[i] + size[i] * HUB_H * 0.3, size[i] * 0.25, false, onShot);
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
        if (s !== DOWN && this.kind[i] !== BIG) this.gait[i] += (run / Math.max(0.05, size[i] * v.robotStride)) * Math.PI * 2;
      }
      if (this.kind[i] === BIG) this.stepTripod(i, dt);
    }
    // Body centres.
    for (let i = 0; i < this.hi; i++) {
      const s = state[i];
      if (s === EMPTY || s === DEAD || this.kind[i] === BIG) continue;
      this.hubY[i] = py[i] + size[i] * (s === RUN || s === FIRE ? HUB_Y : s === DOWN ? HUB_Y * 0.6 : s === FLUNG ? HUB_H * 0.5 : 0);
    }
    // Keep gait phases bounded (Float32 loses the fraction on big numbers).
    for (let i = 0; i < this.hi; i++) if (this.gait[i] > 1000) this.gait[i] -= Math.PI * 2 * 150;
  }

  /**
   * A tripod's feet: planted ones stay put; when one has fallen too far behind where it wants to be (out on its
   * spoke, led along the walk) it swings there in an arc, one at a time (two when the body runs ahead). The body
   * rides at its height over the sand under it and its feet.
   */
  private stepTripod(i: number, dt: number) {
    const v = this.v, H = this.heightOf(i), spread = B_FOOT_R * H;
    const T = Math.max(0.1, v.robotBigStepTime), lead = T * 1.5;
    const x = this.px[i], z = this.pz[i];
    let stepping = 0, worst = -1, worstE = 0, sumY = 0;
    const ix = this.idealX, iz = this.idealZ;
    for (let k = 0; k < BIG_LEGS; k++) {
      const f = i * BIG_LEGS + k, a = bigLegAngle(this.heading[i], k);
      ix[k] = x + Math.sin(a) * spread + this.vx[i] * lead; iz[k] = z + Math.cos(a) * spread + this.vz[i] * lead;
      if (this.stepT[f] >= 0) {
        stepping++;
        const t = Math.min(1, this.stepT[f] + dt / T), e = t * t * (3 - 2 * t);
        this.stepT[f] = t;
        this.footX[f] = this.sfx0[f] + (this.sfx1[f] - this.sfx0[f]) * e;
        this.footZ[f] = this.sfz0[f] + (this.sfz1[f] - this.sfz0[f]) * e;
        this.footY[f] = this.sfy0[f] + (this.sfy1[f] - this.sfy0[f]) * e + 4 * v.robotBigStepLift * t * (1 - t);
        if (t >= 1) {
          this.stepT[f] = -1;
          this.footY[f] = this.ground.height(this.footX[f], this.footZ[f]);
          this.onFootfall?.(i, this.footX[f], this.footY[f], this.footZ[f]);
        }
      } else {
        const err = Math.hypot(this.footX[f] - ix[k], this.footZ[f] - iz[k]);
        if (err > worstE) { worstE = err; worst = k; }
      }
      sumY += this.footY[f];
    }
    const at = v.robotBigStepAt * spread;
    if (worst >= 0 && ((stepping === 0 && worstE > at) || (stepping === 1 && worstE > at * 2.5))) {
      const f = i * BIG_LEGS + worst;
      this.sfx0[f] = this.footX[f]; this.sfy0[f] = this.footY[f]; this.sfz0[f] = this.footZ[f];
      this.sfx1[f] = ix[worst]; this.sfz1[f] = iz[worst]; this.sfy1[f] = this.ground.height(ix[worst], iz[worst]);
      this.stepT[f] = 0;
    }
    const want = (this.py[i] + sumY / BIG_LEGS) * 0.5 + H;
    this.hubY[i] += (want - this.hubY[i]) * Math.min(1, dt * 2.5);
  }
  private idealX = new Float32Array(BIG_LEGS); private idealZ = new Float32Array(BIG_LEGS);

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
    this.lx[i] = this.px[i]; this.ly[i] = this.hubY[i]; this.lz[i] = this.pz[i];
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

  /** One round from the front of the body: muzzle at world height fy, fwd metres ahead of the centre. */
  private fire(i: number, t: RobotTarget, spread: number, fy: number, fwd: number, big: boolean, onShot: RobotShotFn) {
    const h = this.heading[i];
    const fx = this.px[i] + Math.sin(h) * fwd, fz = this.pz[i] + Math.cos(h) * fwd;
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

  /**
   * Nearest live robot hit by a ray, or null. Small ones: a squat ellipsoid round the hub (its size × hit scale).
   * Tripods: an ellipsoid round the high body, and thin capsules down the legs (hitLeg says which was hit).
   */
  hitRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { index: number; dist: number; leg: boolean } | null {
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-9) return null;
    dx /= L; dy /= L; dz /= L;
    const k = this.v.robotHitScale;
    let best = -1, bestT = maxDist, bestLeg = false;
    for (let i = 0; i < this.hi; i++) {
      const s = this.state[i];
      if (s >= DEAD) continue;
      const S = this.size[i];
      if (this.kind[i] === BIG) {
        const H = this.hubY[i] - this.py[i];
        // Quick reject: a sphere round the whole tripod.
        const qx = ox - this.px[i], qy = oy - (this.py[i] + H * 0.55), qz = oz - this.pz[i];
        const R = H * 0.85 + S;
        const b0 = qx * dx + qy * dy + qz * dz, c0 = qx * qx + qy * qy + qz * qz - R * R;
        if ((c0 > 0 && b0 > 0) || b0 * b0 - c0 < 0) continue;
        const t = rayEllipsoid(ox - this.px[i], oy - this.hubY[i], oz - this.pz[i], dx, dy, dz, S * 0.5 * k, S * B_BODY_H * 0.5 * k, S * 0.5 * k);
        if (t >= 0 && t < bestT) { bestT = t; best = i; bestLeg = false; }
        const r = this.v.robotBigLegHit;
        if (r <= 0) continue;
        const L1 = B_THIGH * H, L2 = B_SHIN * H, hip = this.hp3, knee = this.kn3, foot = this.ft3;
        for (let g = 0; g < BIG_LEGS; g++) {
          const f = i * BIG_LEGS + g;
          bigHip(this.px[i], this.hubY[i], this.pz[i], S, this.heading[i], g, hip);
          foot.x = this.footX[f]; foot.y = this.footY[f]; foot.z = this.footZ[f];
          const b = bigBend(this.heading[i], g, this.bd3);
          solveKnee(hip, foot, L1, L2, b.x, b.y, b.z, knee);
          let tl = raySegment(ox, oy, oz, dx, dy, dz, hip, knee, r);
          if (tl >= 0 && tl < bestT) { bestT = tl; best = i; bestLeg = true; }
          tl = raySegment(ox, oy, oz, dx, dy, dz, knee, foot, r);
          if (tl >= 0 && tl < bestT) { bestT = tl; best = i; bestLeg = true; }
        }
        continue;
      }
      const cy = this.hubY[i], qx = ox - this.px[i], qy = oy - cy, qz = oz - this.pz[i];
      const R = S * 0.5 * k;
      const b0 = qx * dx + qy * dy + qz * dz, c0 = qx * qx + qy * qy + qz * qz - R * R;
      if ((c0 > 0 && b0 > 0) || b0 * b0 - c0 < 0) continue;
      // Standing: flat across the legs, squat in height; clinging or tumbling: a ball.
      const flat = s === RUN || s === FIRE || s === DOWN;
      const t = flat
        ? rayEllipsoid(qx, qy, qz, dx, dy, dz, S * 0.45 * k, S * 0.22 * k, S * 0.45 * k)
        : rayEllipsoid(qx, qy, qz, dx, dy, dz, S * 0.34 * k, S * 0.34 * k, S * 0.34 * k);
      if (t >= 0 && t < bestT) { bestT = t; best = i; bestLeg = false; }
    }
    this.hitLeg = best >= 0 && bestLeg;
    return best < 0 ? null : { index: best, dist: bestT, leg: this.hitLeg };
  }
  private hp3: V3 = { x: 0, y: 0, z: 0 }; private kn3: V3 = { x: 0, y: 0, z: 0 };
  private ft3: V3 = { x: 0, y: 0, z: 0 }; private bd3: V3 = { x: 0, y: 0, z: 0 };

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

/**
 * Robot i's centre of mass in world space (the hub for small ones, the high body for tripods) into out; returns its
 * body radius (m), for aiming and lock-on.
 */
export function robotCentre(sw: RobotSwarm, i: number, out: { x: number; y: number; z: number }): number {
  out.x = sw.px[i]; out.y = sw.hubY[i]; out.z = sw.pz[i];
  return sw.kind[i] === BIG ? sw.size[i] * 0.5 : sw.size[i] * 0.35;
}

/** Ray (from q relative to the ellipsoid's centre, unit d) against an axis-aligned ellipsoid; distance or -1. */
function rayEllipsoid(qx: number, qy: number, qz: number, dx: number, dy: number, dz: number, ex: number, ey: number, ez: number): number {
  const lqx = qx / ex, lqy = qy / ey, lqz = qz / ez, ldx = dx / ex, ldy = dy / ey, ldz = dz / ez;
  const a = ldx * ldx + ldy * ldy + ldz * ldz, b = lqx * ldx + lqy * ldy + lqz * ldz, c = lqx * lqx + lqy * lqy + lqz * lqz - 1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t >= 0) return t;
  return c < 0 ? 0 : -1;
}

/** Ray (origin o, unit d) against a capsule from a to b of radius r: distance to about where it enters, or -1. */
function raySegment(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, a: V3, b: V3, r: number): number {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = ox - a.x, wy = oy - a.y, wz = oz - a.z;
  const B = dx * vx + dy * vy + dz * vz, C = vx * vx + vy * vy + vz * vz, D = dx * wx + dy * wy + dz * wz, E = vx * wx + vy * wy + vz * wz;
  const den = C - B * B;
  let tc = den > 1e-9 ? (E - B * D) / den : C > 1e-9 ? E / C : 0;
  tc = Math.max(0, Math.min(1, tc));
  const sc = Math.max(0, B * tc - D);
  const px = wx + dx * sc - vx * tc, py = wy + dy * sc - vy * tc, pz = wz + dz * sc - vz * tc;
  const d2 = px * px + py * py + pz * pz;
  if (d2 > r * r) return -1;
  return Math.max(0, sc - Math.sqrt(r * r - d2));
}
