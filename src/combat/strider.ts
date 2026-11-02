// Striders (Keith 2026-11-01): wiry robots on the mech's own walker rig, scaled up to about 8 m: between the mech and
// the tall terraforming walkers. Long digitigrade legs, a short torso, wide shoulders and long arms that nearly touch
// the ground (Keith's second pass), a small disc head. Red is how they seek: the head sweeps a red seeker until it
// sees its prey, then holds it. Blue is how they hurt: a terraforming beam from the head that burns a furrow down the sand (through the mech, the pilot, bandits),
// and up close a slam: a blue column straight down at its own feet, a ring on the sand growing for a couple of
// seconds, then the ground blows out round it (a crater; get away when you see the ring).
//
// The walk is the player's WalkerSim run in a scaled space: the sim thinks it is a Rampart on ground S times smaller
// (height(x, z) = field(x·S, z·S) / S) and everything it says is multiplied by S on the way out. So the gait, the
// footing on slopes and the leg solve are the mech's own, just S times bigger and slower to cadence.
//
// Pure: no three.js scene, no drawing (src/combat/striderBody.ts draws). Ownership: host (health, attacks, damage,
// deaths); the seeker's sweep and the dangling cables are cosmetic. Randomness seeded per strider.
import { Vector3 } from "three";
import type { Param } from "../core/tweaks";
import { WalkerSim, type Ground, type MoveCommand } from "../mech/walker";
import { WALKER_DEFAULTS, type WalkerValues } from "../mech/walkerTuning";
import type { RobotBeamEvent } from "./robots";
import { beamDrag, beamPower, beamWidthShare, beamTicks, beamTickDamage, beamLive, dragAim, type BeamShape } from "./beamCore";

export const STRIDER_DEFAULTS = {
  striderScale: 1.7,
  striderSpeed: 4.8,
  striderHull: 4000,
  striderArmour: 8,
  striderRange: 32,
  striderStrafe: 0.5,
  striderTurn: 90,
  striderLegDamage: 0.5,
  striderFootDamage: 0.3,
  striderBlast: 0.6,
  // Seeking (red)
  striderSeekSweep: 55,
  striderSeekRate: 0.35,
  striderLockTime: 1,
  // The beam (blue)
  striderBeamEvery: 9,
  striderBeamCharge: 2.2,
  striderBeamMin: 14,
  striderBeamMax: 80,
  striderBeamDamage: 160,
  striderBeamWidth: 1.8,
  striderBeamPierce: 0.8,
  striderBeamRun: 14,
  striderBeamSweep: 1.8,
  striderBeamDrag: 4.5,
  striderBeamChargeDrag: 2,
  striderBeamTick: 0.1,
  striderBeamStartWidth: 0.1,
  striderBeamStartPower: 0.04,
  striderBeamGrow: 2.2,
  // The slam (blue, straight down)
  striderSlamNear: 14,
  striderSlamCharge: 2.4,
  striderSlamRadius: 11,
  striderSlamDamage: 180,
  striderSlamPierce: 0.6,
  striderSlamEvery: 12,
  striderSlamRecover: 1.2,
  // The tearing grab (Keith 2026-11-01: salvagers that tear things to bits)
  striderRush: 0.5,
  striderRushTime: 8,
  striderMeleeReach: 7,
  striderMeleeArc: 70,
  striderMeleeWind: 0.75,
  striderMeleeDamage: 90,
  striderMeleeTear: 1.1,
  striderMeleeTearDps: 45,
  striderMeleeShove: 7,
  striderMeleeEvery: 3.5,
  // Its death (Keith 2026-11-02: "a big explosion when they die ... damage the enemies nearby", so killing one can
  // clear the swarm round it): a blast that hurts robots too.
  striderDeathDelay: 2.8,
  striderDeathRadius: 18,
  striderDeathDamage: 60,
  striderDeathOwnDamage: 450,
  striderDeathPierce: 0.4,
  striderDeathShove: 18,
  striderDeathBoom: 1.4,
  striderDeathCrater: 0.7,
  striderDeathCraterDepth: 3,
  // Look
  striderTilt: 12,
};
export type StriderValues = typeof STRIDER_DEFAULTS;

const GD = "Striders: death";
const G = "Striders", GB = "Striders: beam", GS = "Striders: slam", GM = "Striders: tearing";
export const STRIDER_PARAMS: Param[] = [
  { key: "striderRush", label: "Rushes in after a beam (chance)", min: 0, max: 1, step: 0.05, group: GM, tip: "Then it runs at you to grab and tear, for up to the rush time" },
  { key: "striderRushTime", label: "Rush lasts up to (s)", min: 0, max: 30, step: 0.5, group: GM },
  { key: "striderMeleeReach", label: "Reach (m)", min: 2, max: 15, step: 0.25, group: GM, tip: "From its middle: the long arms' swing" },
  { key: "striderMeleeArc", label: "Hits within (± ° of its front)", min: 10, max: 180, step: 5, group: GM },
  { key: "striderMeleeWind", label: "Wind-up (s)", min: 0.1, max: 3, step: 0.05, group: GM, tip: "The tell: arms up over the disc, claws spread, the eye flaring. A dash out of reach dodges it" },
  { key: "striderMeleeDamage", label: "Strike damage", min: 0, max: 500, step: 5, group: GM },
  { key: "striderMeleeTear", label: "Tears for (s)", min: 0, max: 4, step: 0.1, group: GM, tip: "After the strike it holds on and rips while you stay in reach" },
  { key: "striderMeleeTearDps", label: "Tearing damage per second", min: 0, max: 300, step: 5, group: GM },
  { key: "striderMeleeShove", label: "Strike throws you (m/s)", min: 0, max: 30, step: 0.5, group: GM },
  { key: "striderMeleeEvery", label: "A grab at most every (s)", min: 0.5, max: 20, step: 0.5, group: GM },
  { key: "striderTilt", label: "Disc tilted toward you (°)", min: 0, max: 60, step: 1, group: G, tip: "The hull disc leans down toward what it faces (looks only)" },
  { key: "striderScale", label: "Size (× the Rampart)", min: 1, max: 5, step: 0.1, group: G, tip: "The mech's walker rig scaled up: 1.7 stands about 8 m to the top of the head, between the mech and the tall walkers. Changing it stands them up again" },
  { key: "striderSpeed", label: "Walk speed (m/s)", min: 0.5, max: 12, step: 0.1, group: G },
  { key: "striderHull", label: "Hit points", min: 100, max: 30000, step: 50, group: G, tip: "A bandit mech has 1800, the warlord 4500" },
  { key: "striderArmour", label: "Armour (flat per hit)", min: 0, max: 40, step: 0.5, group: G },
  { key: "striderRange", label: "Holds off at (m)", min: 5, max: 100, step: 1, group: G },
  { key: "striderStrafe", label: "Strafe (share of the stick)", min: 0, max: 1, step: 0.05, group: G },
  { key: "striderTurn", label: "Torso turn (°/s)", min: 10, max: 360, step: 5, group: G },
  { key: "striderLegDamage", label: "Leg hits take (share)", min: 0, max: 1, step: 0.05, group: G },
  { key: "striderFootDamage", label: "Foot hits take (share)", min: 0, max: 1, step: 0.05, group: G },
  { key: "striderBlast", label: "Blasts take (share)", min: 0, max: 1.5, step: 0.05, group: G, tip: "Explosives' blast, measured to its nearest part; a round's splash never hurts it" },
  { key: "striderSeekSweep", label: "Seeker sweep (± °)", min: 0, max: 180, step: 1, group: G, tip: "Red: while it can't see its prey, the head sweeps this far either side of its walk" },
  { key: "striderSeekRate", label: "Seeker sweeps per second", min: 0.05, max: 2, step: 0.05, group: G },
  { key: "striderLockTime", label: "Seen this long before it fires (s)", min: 0, max: 5, step: 0.1, group: G },
  { key: "striderBeamEvery", label: "A beam every (s)", min: 1, max: 40, step: 0.5, group: GB },
  { key: "striderBeamCharge", label: "Charge (s)", min: 0.2, max: 6, step: 0.1, group: GB, tip: "Keith 2026-11-01: the beam is live from the start, thin and weak, growing to full at the release (src/combat/beamCore.ts, as the big walkers')" },
  { key: "striderBeamSweep", label: "Fires for (s)", min: 0, max: 5, step: 0.05, group: GB, tip: "After the release it keeps firing this long at full power" },
  { key: "striderBeamDrag", label: "Drags toward you at (m/s)", min: 0, max: 15, step: 0.25, group: GB, tip: "Its strike chases the prey over the sand through the charge and the sweep; under walking pace, so walking away keeps clear" },
  { key: "striderBeamChargeDrag", label: "Drags while charging at (m/s)", min: 0, max: 15, step: 0.25, group: GB, tip: "Slower than the sweep's drag, so moving off early clears the beam before it reaches full power" },
  { key: "striderBeamTick", label: "Burn tick (s)", min: 0.02, max: 0.5, step: 0.01, group: GB },
  { key: "striderBeamStartWidth", label: "Width at the charge's start (share)", min: 0.02, max: 1, step: 0.01, group: GB },
  { key: "striderBeamStartPower", label: "Power at the charge's start (share)", min: 0, max: 1, step: 0.01, group: GB, tip: "Damage and sand blast while charging, as a share of the sweep's" },
  { key: "striderBeamGrow", label: "Growth curve (width, power)", min: 0.3, max: 5, step: 0.1, group: GB },
  { key: "striderBeamMin", label: "Closest (m)", min: 0, max: 60, step: 1, group: GB },
  { key: "striderBeamMax", label: "Furthest (m)", min: 10, max: 200, step: 1, group: GB },
  { key: "striderBeamDamage", label: "Damage", min: 0, max: 1000, step: 5, group: GB, tip: "If held in it for the whole sweep at full power (the charge adds a little)" },
  { key: "striderBeamWidth", label: "Width (m)", min: 0.2, max: 6, step: 0.1, group: GB },
  { key: "striderBeamPierce", label: "Armour pierce", min: 0, max: 1, step: 0.05, group: GB },
  { key: "striderBeamRun", label: "Release furrow past the aim (m)", min: 0, max: 60, step: 1, group: GB, tip: "At the release the beam cracks a furrow on through the aim this far" },
  { key: "striderSlamNear", label: "Slams when you're within (m)", min: 0, max: 60, step: 1, group: GS },
  { key: "striderSlamCharge", label: "Charge (s)", min: 0.3, max: 6, step: 0.1, group: GS, tip: "The blue column at its feet and the ring on the sand: get out of the ring" },
  { key: "striderSlamRadius", label: "Blast radius (m)", min: 2, max: 40, step: 0.5, group: GS },
  { key: "striderSlamDamage", label: "Damage", min: 0, max: 1500, step: 5, group: GS },
  { key: "striderSlamPierce", label: "Armour pierce", min: 0, max: 1, step: 0.05, group: GS },
  { key: "striderSlamEvery", label: "A slam at most every (s)", min: 1, max: 60, step: 0.5, group: GS },
  { key: "striderSlamRecover", label: "Stands after it (s)", min: 0, max: 5, step: 0.1, group: GS },
  { key: "striderDeathDelay", label: "Goes up after (s)", min: 0, max: 8, step: 0.05, group: GD, tip: "Time to get clear after a melee kill: the wreck goes unstable (amber ring, sweep, glowing core), then the boom" },
  { key: "striderDeathRadius", label: "Death blast radius (m)", min: 2, max: 50, step: 0.5, group: GD },
  { key: "striderDeathDamage", label: "Damage to the mech", min: 0, max: 600, step: 5, group: GD, tip: "And anything else not a robot. Full at the centre, half at the edge" },
  { key: "striderDeathOwnDamage", label: "Damage to robots", min: 0, max: 3000, step: 10, group: GD, tip: "Every robot in reach (swarm, striders, crushers, droids) by its blast share, behind cover none" },
  { key: "striderDeathPierce", label: "Armour pierce", min: 0, max: 1, step: 0.05, group: GD },
  { key: "striderDeathShove", label: "Shove (m/s)", min: 0, max: 60, step: 0.5, group: GD },
  { key: "striderDeathCrater", label: "Crater radius (share of blast)", min: 0, max: 1.5, step: 0.05, group: GD },
  { key: "striderDeathCraterDepth", label: "Crater depth (m)", min: 0, max: 8, step: 0.1, group: GD },
  { key: "striderDeathBoom", label: "Extra boom (volume)", min: 0, max: 4, step: 0.05, group: GD },
];

/** The body's frame above the pelvis, in the sim's (Rampart-sized) metres: shared with the drawing and the hits. */
// Keith 2026-11-01: long digitigrade legs, a short torso, wide shoulders and long arms that nearly reach the ground.
// Keith 2026-11-01 (third pass): the hull is a thin wide disc (as wide as the shoulders were) on a thin spine, leaning
// toward its prey, the shoulders mounted on its rim; no separate head (the seeker rides the disc's rim).
export const STRIDER_FRAME = {
  waist: 0.25, chestLow: 0.2, chestTop: 1.0, chestR: 0.2,
  /** Shoulder joints either side (x) at this height, on the disc's rim; upper arm and forearm lengths. */
  shoulderX: 1.2, shoulderY: 1.0, upperArm: 1.85, foreArm: 1.8,
  /** The disc: its middle's height (where it sees from), radius and thickness. */
  neck: 1.0, head: 1.0, headR: 1.12, headH: 0.3,
  /** The beam's emitter: under the disc's front. */
  emitY: 0.8, emitZ: 0.62,
};

/** The walk the sim runs: the mech's own, narrower and longer in the leg (wiry), speeds divided by the scale. */
export function striderWalker(v: StriderValues): WalkerValues {
  const S = v.striderScale;
  return {
    ...WALKER_DEFAULTS,
    hipHeight: 3.55, hipWidth: 0.62, femur: 1.9, shin: 1.75, cannon: 1.12, footSpread: 0.85, walkSpread: 0.6,
    bob: 0.04, moveLean: 2, speedLean: 0.8,
    walkSpeed: v.striderSpeed / S, sprintSpeed: (v.striderSpeed * 1.4) / S,
  };
}

export type StriderMode = 0 | 1 | 2 | 3 | 4 | 5;
export const WALK = 0, BEAM = 1, SLAM = 2, RECOVER = 3, DOWNED = 4, MELEE = 5;
export const PART_BODY = 0, PART_LEG = 1, PART_FOOT = 2;

export type StriderEvent =
  | { type: "beamCharge"; id: number }
  | { type: "beam"; id: number; beam: RobotBeamEvent }
  | { type: "slamCharge"; id: number; x: number; z: number; radius: number }
  | { type: "slam"; id: number; x: number; y: number; z: number; radius: number; damage: number; pierce: number }
  | { type: "footfall"; id: number; x: number; y: number; z: number; k: number }
  | { type: "down"; id: number; x: number; y: number; z: number }
  | { type: "meleeWind"; id: number }
  /** A grab landing (strike) or ripping on (tear): where on the prey, the damage, which way it throws (strike only). */
  | { type: "melee"; id: number; kind: "strike" | "tear"; x: number; y: number; z: number; damage: number; dx: number; dz: number; shove: number };

/** Its prey: where it is (the hull's middle), its velocity, alive or not. */
export interface StriderPrey { x: number; y: number; z: number; vx: number; vz: number; alive: boolean }

/** A ground S times smaller: the sim walks on this. */
class ScaledGround implements Ground {
  constructor(public field: Ground, public S: number) {}
  height(x: number, z: number) { return this.field.height(x * this.S, z * this.S) / this.S; }
  /** A uniform scale keeps the slopes, so the normal is the field's at the matching point. */
  normal(x: number, z: number, out?: number[]) { return this.field.normal(x * this.S, z * this.S, out); }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const D2R = Math.PI / 180;
const STEP = 1 / 120;

export class Strider {
  readonly sim: WalkerSim;
  private ground: ScaledGround;
  /** Its scale (world metres per sim metre) since it was stood up. */
  S: number;
  health: number;
  maxHealth: number;
  alive = true;
  /** Asleep with its camp (src/expedition/striderCamps.ts): stands where it is, not stepped. */
  frozen = false;
  mode: StriderMode = WALK;
  modeT = 0;
  /** The torso's yaw (world, heading convention) and the head's pitch down (radians). */
  face = 0;
  pitch = 0;
  /** The seeker's sweep off the face (radians; cosmetic) and whether it holds the prey now. */
  seek = 0;
  seen = false;
  lockT = 0;
  beamClock: number;
  slamClock = 0;
  /** The beam's aim on the sand (world) while charging; the slam's centre. */
  readonly aim = new Vector3();
  readonly slamAt = new Vector3();
  /** Hit points the last frames took (for flashes). */
  hurt = 0;
  private strafeSide: number;
  /** Rushing in to grab (s left), the grab's clock, whether the strike landed. */
  rushT = 0;
  meleeClock = 0;
  private struck = false;
  private tearAcc = 0;
  private strafeClock: number;
  private seekClock = 0;
  private acc = 0;
  private sightClock = 0;
  readonly rand: () => number;

  constructor(readonly id: number, public v: StriderValues, field: Ground, x: number, z: number, heading: number, seed = id * 7919 + 13) {
    this.rand = rng(seed);
    this.S = v.striderScale;
    this.ground = new ScaledGround(field, this.S);
    this.sim = new WalkerSim(striderWalker(v), this.ground);
    this.sim.reset(x / this.S, z / this.S, heading);
    this.face = heading;
    this.health = this.maxHealth = v.striderHull;
    this.beamClock = v.striderBeamEvery * (0.3 + this.rand() * 0.5);
    this.strafeSide = this.rand() < 0.5 ? -1 : 1;
    this.strafeClock = 4 + this.rand() * 6;
  }

  /** Where it stands (world, on the ground plane). */
  pos(out = new Vector3()) { return out.set(this.sim.pos.x * this.S, 0, this.sim.pos.z * this.S); }
  /** The pelvis (world). */
  pelvis(out = new Vector3()) { return out.copy(this.sim.pelvis).multiplyScalar(this.S); }
  /** A point on the body's axis h sim metres above the pelvis (world). */
  up(h: number, out = new Vector3()) { const p = this.sim.pelvis; return out.set(p.x, p.y + h, p.z).multiplyScalar(this.S); }
  /** The head's middle (world): where it sees from. */
  head(out = new Vector3()) { return this.up(STRIDER_FRAME.head, out); }
  /** The beam's emitter under the head's front rim (world). */
  emitter(out = new Vector3()) {
    const f = STRIDER_FRAME, p = this.sim.pelvis, S = this.S;
    return out.set((p.x + Math.sin(this.face) * f.emitZ) * S, (p.y + f.emitY) * S, (p.z + Math.cos(this.face) * f.emitZ) * S);
  }
  /** A shoulder joint (side 1: its left, +X at heading 0) and roughly where that arm's hand hangs (world). */
  shoulder(side: 1 | -1, out = new Vector3()) {
    const F = STRIDER_FRAME, k = side * F.shoulderX * this.S;
    return this.up(F.shoulderY, out).add(T7.set(Math.cos(this.face) * k, 0, -Math.sin(this.face) * k));
  }
  hand(side: 1 | -1, out = new Vector3()) {
    const F = STRIDER_FRAME, S = this.S;
    this.shoulder(side, out);
    out.y -= (F.upperArm + F.foreArm) * 0.95 * S;
    return out.add(T7.set(Math.sin(this.face) * 0.25 * S, 0, Math.cos(this.face) * 0.25 * S));
  }
  /** World velocity on the ground plane. */
  vel(out = new Vector3()) { return out.set(this.sim.vel.x * this.S, 0, this.sim.vel.z * this.S); }

  /** A hit (before armour) on a part: its share of the damage, armour off by the one rule (the caller does armour). */
  partShare(part: number) { return part === PART_LEG ? this.v.striderLegDamage : part === PART_FOOT ? this.v.striderFootDamage : 1; }

  /**
   * One frame: prey is who it hunts; sees(from, to) asks for a clear line (dunes). Events go to emit. The walker steps
   * at a fixed 120 Hz inside the frame.
   */
  update(dt: number, prey: StriderPrey | null, sees: (from: Vector3, to: Vector3) => boolean, emit: (e: StriderEvent) => void) {
    const v = this.v, S = this.S;
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.modeT += dt;
    let stick = { x: 0, z: 0 };
    if (!this.alive) {
      this.mode = DOWNED;
      this.stepWalker(dt, stick, emit);
      return;
    }
    const p = this.pos(T0);
    const has = !!prey && prey.alive;
    const dx = has ? prey!.x - p.x : 0, dz = has ? prey!.z - p.z : 0, dist = Math.hypot(dx, dz) || 1;
    // Seeing: every quarter second (a line of sight costs ground lookups).
    this.sightClock -= dt;
    if (this.sightClock <= 0) {
      this.sightClock = 0.25;
      this.seen = has && sees(this.head(T1), T2.set(prey!.x, prey!.y, prey!.z));
    }
    this.lockT = this.seen ? this.lockT + dt : Math.max(0, this.lockT - dt * 2);
    this.beamClock -= dt;
    this.slamClock -= dt;
    // The torso turns to the prey when it sees it (or the aim while charging); else to its walk, the seeker sweeping.
    let want = this.sim.heading;
    if (this.mode === BEAM) want = Math.atan2(this.aim.x - p.x, this.aim.z - p.z);
    else if (has && (this.seen || dist < v.striderSlamNear * 1.5)) want = Math.atan2(dx, dz);
    const turn = v.striderTurn * D2R * dt;
    this.face = wrap(this.face + clamp(wrap(want - this.face), -turn, turn));
    this.seekClock += dt;
    const sweep = this.seen || this.mode !== WALK ? 0 : Math.sin(this.seekClock * Math.PI * 2 * v.striderSeekRate) * v.striderSeekSweep * D2R;
    this.seek += (sweep - this.seek) * Math.min(1, dt * 4);
    // The head pitches down toward what it looks at.
    const look = this.mode === BEAM ? this.aim : this.mode === SLAM ? this.slamAt : has ? T3.set(prey!.x, prey!.y, prey!.z) : null;
    const h = this.head(T4);
    const wantPitch = look ? Math.atan2(h.y - look.y, Math.max(1, Math.hypot(look.x - h.x, look.z - h.z))) : 0.15;
    this.pitch += (clamp(wantPitch, -0.3, 1.4) - this.pitch) * Math.min(1, dt * 3);

    if (this.mode === WALK && has) {
      // Close in to its range, back off inside 60% of it, strafe round on a side that flips now and then.
      this.strafeClock -= dt;
      if (this.strafeClock <= 0) { this.strafeClock = 5 + this.rand() * 7; this.strafeSide = -this.strafeSide; }
      const ux = dx / dist, uz = dz / dist;
      this.rushT -= dt;
      // Rushing: straight at the prey to grab it.
      const close = this.rushT > 0 ? 1 : clamp((dist - v.striderRange) / 10, -1, 1);
      const s = v.striderStrafe * this.strafeSide * (1 - Math.abs(close) * 0.5);
      let x = ux * close - uz * s, z = uz * close + ux * s;
      const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
      stick = { x, z };
      this.meleeClock -= dt;
      if (dist < v.striderMeleeReach * 0.9 && this.meleeClock <= 0) {
        this.mode = MELEE; this.modeT = 0; this.struck = false; this.tearAcc = 0; this.rushT = 0;
        emit({ type: "meleeWind", id: this.id });
      } else if (dist < v.striderSlamNear && this.slamClock <= 0 && this.rushT <= 0) {
        this.mode = SLAM; this.modeT = 0;
        this.slamAt.set(p.x, 0, p.z);
        this.slamAt.y = this.ground.field.height(p.x, p.z);
        emit({ type: "slamCharge", id: this.id, x: p.x, z: p.z, radius: v.striderSlamRadius });
      } else if (this.beamClock <= 0 && this.lockT >= v.striderLockTime && dist >= v.striderBeamMin && dist <= v.striderBeamMax) {
        this.mode = BEAM; this.modeT = 0;
        this.aim.set(prey!.x, this.ground.field.height(prey!.x, prey!.z), prey!.z);
        emit({ type: "beamCharge", id: this.id });
      }
    } else if (this.mode === BEAM) {
      // The beam (src/combat/beamCore.ts): live from the start, growing; its strike drags toward the prey all along.
      const sh = this.beamShape(), was = this.modeT - dt;
      if (has && was > 0) {
        const d = dragAim(this.aim.x, this.aim.z, prey!.x, prey!.z, beamDrag(was, sh), dt, DRAG);
        this.aim.x = d.x; this.aim.z = d.z; this.aim.y = this.ground.field.height(d.x, d.z);
      }
      beamTicks(was, this.modeT, sh, (k, tk, release) => {
        emit({ type: "beam", id: this.id, beam: this.beamLine(k, tk, release) });
      });
      if (this.modeT >= beamLive(sh)) {
        this.mode = WALK; this.modeT = 0;
        this.beamClock = v.striderBeamEvery * (0.8 + this.rand() * 0.4);
        if (this.rand() < v.striderRush) this.rushT = v.striderRushTime;
      }
    } else if (this.mode === MELEE) {
      // Wind-up (the tell), then the strike if the prey is still in reach and in front; then it holds on and tears.
      const inReach = has && dist < v.striderMeleeReach && Math.abs(wrap(Math.atan2(dx, dz) - this.face)) < v.striderMeleeArc * D2R;
      const ux = dx / dist, uz = dz / dist;
      if (!this.struck && this.modeT >= v.striderMeleeWind) {
        this.struck = true;
        if (inReach) emit({ type: "melee", id: this.id, kind: "strike", x: prey!.x, y: prey!.y, z: prey!.z, damage: v.striderMeleeDamage, dx: ux, dz: uz, shove: v.striderMeleeShove });
      } else if (this.struck && inReach && v.striderMeleeTearDps > 0) {
        // Ripping: damage in ticks of a fifth of a second.
        this.tearAcc += dt;
        while (this.tearAcc >= 0.2) { this.tearAcc -= 0.2; emit({ type: "melee", id: this.id, kind: "tear", x: prey!.x, y: prey!.y, z: prey!.z, damage: v.striderMeleeTearDps * 0.2, dx: ux, dz: uz, shove: 0 }); }
      }
      if (this.modeT >= v.striderMeleeWind + v.striderMeleeTear) { this.mode = WALK; this.modeT = 0; this.meleeClock = v.striderMeleeEvery; }
    } else if (this.mode === SLAM) {
      if (this.modeT >= v.striderSlamCharge) {
        emit({ type: "slam", id: this.id, x: this.slamAt.x, y: this.slamAt.y, z: this.slamAt.z, radius: v.striderSlamRadius, damage: v.striderSlamDamage, pierce: v.striderSlamPierce });
        this.mode = RECOVER; this.modeT = 0;
        this.slamClock = v.striderSlamEvery;
        // Firing the beam right after a slam would be unfair: give the prey time to get clear.
        this.beamClock = Math.max(this.beamClock, v.striderSlamRecover + 2);
      }
    } else if (this.mode === RECOVER) {
      if (this.modeT >= v.striderSlamRecover) { this.mode = WALK; this.modeT = 0; }
    }
    this.stepWalker(dt, stick, emit);
    void S;
  }

  /** The beam's shape (src/combat/beamCore.ts) from the sliders. */
  beamShape(): BeamShape {
    const v = this.v, o = this.shape;
    o.charge = v.striderBeamCharge; o.sweep = v.striderBeamSweep; o.drag = v.striderBeamDrag; o.chargeDrag = v.striderBeamChargeDrag; o.tick = v.striderBeamTick;
    o.startWidth = v.striderBeamStartWidth; o.startPower = v.striderBeamStartPower; o.growth = v.striderBeamGrow;
    return o;
  }
  private shape: BeamShape = { charge: 1, sweep: 0, drag: 0, chargeDrag: 0, tick: 0.1, startWidth: 1, startPower: 1, growth: 1 };

  /**
   * One tick of the beam (k, at tk into it): from the emitter to the sand a little short of the aim and on just past it;
   * the release tick cracks a furrow on through the aim by striderBeamRun.
   */
  beamLine(k = 0, tk = this.modeT, release = false): RobotBeamEvent {
    const v = this.v, e = this.emitter(T5), a = this.aim, sh = this.beamShape(), p = beamPower(tk, sh);
    const fx = a.x - e.x, fz = a.z - e.z, fl = Math.hypot(fx, fz) || 1, ux = fx / fl, uz = fz / fl;
    const back = release ? Math.min(fl * 0.5, 6) : Math.min(fl * 0.5, 3), on = release ? v.striderBeamRun : 1.5;
    const sx = a.x - ux * back, sz = a.z - uz * back, ex = a.x + ux * on, ez = a.z + uz * on;
    const g = this.ground.field;
    return {
      robot: -1 - this.id, id: this.id,
      from: { x: e.x, y: e.y, z: e.z },
      start: { x: sx, y: g.height(sx, sz), z: sz },
      end: { x: ex, y: g.height(ex, ez), z: ez },
      width: v.striderBeamWidth * beamWidthShare(tk, sh), damage: beamTickDamage(tk, v.striderBeamDamage, sh), pierce: v.striderBeamPierce,
      tick: k, heat: p, power: p, release,
    };
  }

  /** Charge share of the attack under way (0..1), or 0. */
  /** The grab under way: 0..1 through the wind-up, then 1..2 through the tearing; -1 when not grabbing. */
  grab() {
    const v = this.v;
    if (this.mode !== MELEE) return -1;
    return this.modeT < v.striderMeleeWind ? this.modeT / v.striderMeleeWind : 1 + clamp((this.modeT - v.striderMeleeWind) / Math.max(0.05, v.striderMeleeTear), 0, 1);
  }

  charge() {
    const v = this.v;
    return this.mode === BEAM ? clamp(this.modeT / v.striderBeamCharge, 0, 1) : this.mode === SLAM ? clamp(this.modeT / v.striderSlamCharge, 0, 1) : 0;
  }

  /** Take damage after armour (the target adapter does the armour and the part's share). */
  hit(amount: number, emit: (e: StriderEvent) => void) {
    if (!this.alive || !(amount > 0)) return;
    this.health -= amount;
    this.hurt = Math.min(1, this.hurt + amount / 300);
    if (this.health <= 0) {
      this.health = 0; this.alive = false; this.mode = DOWNED; this.modeT = 0;
      const p = this.pelvis(T6);
      emit({ type: "down", id: this.id, x: p.x, y: p.y, z: p.z });
    }
  }

  private stepWalker(dt: number, stick: { x: number; z: number }, emit: (e: StriderEvent) => void) {
    const sim = this.sim, S = this.S;
    const cmd: MoveCommand = { x: stick.x, z: stick.z, sprint: this.rushT > 0, face: this.face };
    if (this.alive && this.mode !== WALK) { cmd.x = 0; cmd.z = 0; }
    sim.onFootfall = (f, k) => emit({ type: "footfall", id: this.id, x: f.planted.x * S, y: f.planted.y * S, z: f.planted.z * S, k });
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) { this.acc -= STEP; sim.update(STEP, cmd); }
  }
}

const DRAG = { x: 0, z: 0 };
const T0 = new Vector3(), T1 = new Vector3(), T2 = new Vector3(), T3 = new Vector3(), T4 = new Vector3(), T5 = new Vector3(), T6 = new Vector3(), T7 = new Vector3();

/** The striders on a field: stands them up, steps them, hands out ids. Host. */
export class Striders {
  readonly list: Strider[] = [];
  private nextId = 1;
  onEvent: ((e: StriderEvent) => void) | null = null;
  /** Fired since construction (for the HUD and the check). */
  beams = 0; slams = 0; kills = 0;
  private emit = (e: StriderEvent) => {
    if (e.type === "beam" && e.beam.release) this.beams++;
    else if (e.type === "slam") this.slams++;
    else if (e.type === "down") this.kills++;
    this.onEvent?.(e);
  };

  constructor(public v: StriderValues, public field: Ground, private seed = 1) {}

  spawn(x: number, z: number, heading: number): Strider {
    const s = new Strider(this.nextId++, this.v, this.field, x, z, heading, this.seed * 104729 + this.nextId * 7919);
    this.list.push(s);
    return s;
  }

  get alive() { let n = 0; for (const s of this.list) if (s.alive) n++; return n; }

  update(dt: number, prey: StriderPrey | null, sees: (from: Vector3, to: Vector3) => boolean) {
    for (const s of this.list) if (!s.frozen) s.update(dt, prey, sees, this.emit);
  }

  hit(s: Strider, amount: number) { s.hit(amount, this.emit); }

  remove(s: Strider) { const k = this.list.indexOf(s); if (k >= 0) this.list.splice(k, 1); }
}
