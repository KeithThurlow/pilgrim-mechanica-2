// Procedural digitigrade walker: pure simulation, no rendering. Give it a ground function and a stick each frame;
// it moves the body, times the steps, places each foot on the ground, and solves the legs.
//
//   hip -> knee (bends forward) -> hock (bends back) -> ankle -> foot plate -> toes (hinged at the ball of the foot)
//
// Gait: one phase drives both feet half a cycle apart. A foot is planted (world-locked) for `duty` of the cycle and
// swings for the rest. At lift-off it picks a landing spot where the body will be when it lands, on the ground
// there, tilted to the slope; it re-aims while the body turns, then locks before the stomp.
// Body: rides on the feet (dropping toward the lower one on slopes), shifts and rolls onto the planted leg,
// thuds on each footfall; the hull counter-rolls to stay level.
// Air (Keith 2026-10-26): one airborne state whatever the cause (a crane drop, a dune crest taken fast, a jump, a
// blast; launch() from outside, or the sim itself when the ground falls away faster than gravity can follow). The body
// flies ballistic, the legs tuck going up and reach for the ground coming down; the landing squats by how hard it hit,
// staggers and hurts past thresholds, and skids the planted feet with any speed the legs can't run on with.
// Sprint (Keith 2026-10-26: hold Space after the dash and the mech runs on, faster and faster; docs/proposal-bound.md):
// with `bound` on, the walk blends into a run (Keith 18:28: even left/right footfalls, not a skipping gallop): the gait
// phase with the run's cadence and a planted share that leaves short flights, sprinter swings (follow-through, a tuck
// with the thigh up and toes curled, a reach and a plant under the hips), the hock opening further at push-off and the
// hull kept clear of the ground ahead. Speed builds toward the legs' top speed; the line of run turns only as fast as
// the feet grip (the turning circle grows with speed squared) and the body can turn ahead of it into a drift that skids
// the feet. Running off a crest flies on the gallop's air pose and lands on its staggered stance (the gallop: trailing
// foot down first, the body dipping, then the run again; boundGallop brings back the whole gallop). Walls: ground
// steeper than wallGrade takes the speed going into it away (sprint, dash, skid), and nothing takes off upward faster
// than launchUpMax, so a wall can't fling the mech into the sky.
// Dash (Keith 18:28): a push-off. The planted foot pushes, the hips open toward the dash, the other foot steps out and
// slides, the push foot is drawn back beside it, then the gait picks up; held, the push-off flows into the run.
// Slopes (Keith 18:28): uphill the swinging thigh rises toward the hull; downhill legs stop at legReachMax and a foot
// that can't reach the ground hangs while the mech drops the rest.
import { Vector3, Quaternion, Euler, Matrix4 } from "three";
import type { WalkerValues } from "./walkerTuning";
import { dashAcross, dashAlong, dashBeats, dashDip, dashEdgeK, dashKind, dashLeanK, dashPreTurn, dashTurn, dashYaw, type DashBeats, type DashKind } from "./dashSteps";

export interface Ground {
  height(x: number, z: number): number;
  normal(x: number, z: number, out?: number[]): number[];
}

/** Desired move direction in world x/z; length 0..1 is the stick amount. */
export interface MoveCommand {
  x: number; z: number; sprint: boolean;
  /** A pilot sits in it: standing still a while, the legs flex now and then (the idle). */
  idle?: boolean;
}

export interface LegPose {
  hip: Vector3; knee: Vector3; hock: Vector3; ankle: Vector3; foot: Vector3;
  /** Toe hinge (ball of the foot) and toe tip. */
  toeHinge: Vector3; toe: Vector3;
  /** Toe segment orientation (like footQ, bent at the hinge). */
  toeQ: Quaternion;
  /** Foot plate orientation (y up off the sole, z toward the toes). */
  footQ: Quaternion;
  /** The leg's bending plane forward direction. */
  legFwd: Vector3;
}

const D2R = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const CARRY_Q = new Quaternion();
const MIN_CYCLE = 0.55; // cycles/s used to finish a step when the body has stopped
const RE_AIM_UNTIL = 0.72; // swing progress after which the landing spot is locked
const G = 9.81;
const AIR_MIN = 0.06; // seconds in the air before a foot can touch down again
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
export const forwardOf = (h: number, out = new Vector3()) => out.set(Math.sin(h), 0, Math.cos(h));
export const leftOf = (h: number, out = new Vector3()) => out.set(Math.cos(h), 0, -Math.sin(h));

/** A damped spring toward a target: x'' = k (target - x) - c x'. */
class Spring {
  x = 0; v = 0;
  constructor(public k: number, public c: number) {}
  step(target: number, dt: number) {
    this.v += (this.k * (target - this.x) - this.c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
  /** Same, damped against the target's own speed: follows a ramp without lagging behind it. */
  stepFF(target: number, targetV: number, dt: number) {
    this.v += (this.k * (target - this.x) + this.c * (targetV - this.v)) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/** A foot's swing in the dash's steps: from where it left to its spot (world), over t0..t1 seconds into the dash. */
interface DashSwing { from: Vector3; to: Vector3; toYaw: number; t0: number; t1: number; lift: number; under: boolean }

export class Foot {
  swinging = false;
  /** Swing progress 0..1 (0 while planted). */
  u = 0;
  /** In the air: the foot's place relative to the hips (eased toward the air pose). */
  airRel = new Vector3();
  /** Knee turned outward at the hip while squashed (degrees, eased). */
  splay = 0;
  /** Stance progress 0..1 (0 while swinging). */
  stanceT = 0;
  planted = new Vector3(); plantedUp = new Vector3(0, 1, 0); plantedYaw = 0;
  lift = new Vector3(); liftYaw = 0; liftPitch = 0; liftUp = new Vector3(0, 1, 0);
  target = new Vector3(); targetUp = new Vector3(0, 1, 0); targetYaw = 0;
  /** Current plate centre, up, yaw and toe-down pitch. */
  pos = new Vector3(); up = new Vector3(0, 1, 0); yaw = 0; pitch = 0;
  /** Toe angle at the hinge, relative to the foot: + curls the toes down and under, - bends them up. */
  toe = 0; liftToe = 0;
  /** Ground height the body rides on for this foot. */
  groundY = 0;
  /** Cannon angle back from the hip-ankle line (radians), and its value at lift-off. */
  theta = 0;
  liftTheta = 0;
  /** In a sprint stance: 0 planted, 1 still coming down (lands late), 2 already lifted for the leap. */
  bState: 0 | 1 | 2 = 0;
  /** The run's swing: where the foot left from relative to the body (along the heading, to the left, up from the hips). */
  runA = new Vector3();
  /** The run's cannon angle for this frame (blended into the walk's by the run share). */
  runTheta = 0;
  /** Planted foot's skid velocity this frame (m/s, world x/z): a dash slide, a drift, a landing skid. 0 when locked. */
  slide = new Vector3();
  /** Its planted spot last frame, and whether it was planted then. */
  prevPlanted = new Vector3();
  wasPlanted = false;
  /** The ground fell away out of this foot's reach: it hangs at full stretch instead of landing. */
  short = false;
  /** Hanging at full reach over ground it can't reach (downhill); planted again once the ground is within reach. */
  hang = false;
  /** Extra turn of the knee (radians): the dash's lead knee driving toward the dash. */
  kneeYaw = 0;
  /** The thigh angle (forward of straight down) an uphill swing has raised to (swingThighFold). */
  foldW = 0;
  foldT = 0;
  /** A swing joined part way (out of a landing stance): from entryU the foot eases from entryRel (body-relative, like runA) onto its path. -1: none. */
  entryU = -1;
  entryRel = new Vector3();
  pose: LegPose = {
    hip: new Vector3(), knee: new Vector3(), hock: new Vector3(), ankle: new Vector3(), foot: new Vector3(),
    toeHinge: new Vector3(), toe: new Vector3(), toeQ: new Quaternion(),
    footQ: new Quaternion(), legFwd: new Vector3(),
  };
  constructor(public side: 1 | -1, public offset: number) {}
}

/** A touchdown, for effects, damage and checks. */
export interface Landing {
  /** Downward speed at touchdown (m/s) and the speed along the ground (m/s). */
  impact: number;
  speed: number;
  airTime: number;
  /** How deep the hips will squat (m), and how hard it was: 0 soft .. 1 at the hard threshold and beyond. */
  depth: number;
  hard: number;
  /** Seconds without control (0 unless hard), and damage to take. */
  stagger: number;
  damage: number;
  /** Between the feet, on the ground. */
  x: number; y: number; z: number;
  /** Taken in the sprint's stride (the feet already stomped one by one). */
  bound?: boolean;
}

export interface WalkerStats {
  steps: number;
  takeoffs: number;
  landings: number;
  airFrames: number;
  /** Frames where a leg could not reach its foot (should stay near zero). */
  overreach: number;
  /** Frames where a swinging foot dipped under the ground. */
  scuffs: number;
  frames: number;
  /** Sprint leaps pushed off. */
  leaps: number;
  /** Running foot-frames whose toes dragged forward at full stretch. */
  toeDrag: number;
}

export class WalkerSim {
  /** Body position on the ground plane (y unused); pelvis carries the height. */
  pos = new Vector3();
  heading = 0;
  speed = 0;
  vel = new Vector3();
  turnSpeed = 0;
  phase = 0;
  pelvis = new Vector3();
  pelvisQ = new Quaternion();
  hullQ = new Quaternion();
  feet: [Foot, Foot] = [new Foot(1, 0), new Foot(-1, 0.5)];
  stats: WalkerStats = { steps: 0, takeoffs: 0, landings: 0, airFrames: 0, overreach: 0, scuffs: 0, frames: 0, leaps: 0, toeDrag: 0 };
  /**
   * The sprint, set from outside each frame (src/mech/bound.ts: Space held after the dash). The walker decides when it
   * can run it: not while staggered or squatting out of a hard landing.
   */
  bound = false;
  /** Top speed for the sprint now (0: the legs' boundTop; a booster adds to it), and a booster's glide (share of gravity cancelled while falling in a leap). */
  boundTopNow = 0;
  boundGlide = 0;
  /** The sprint's ground speed (m/s) and its line of run (radians like a heading; lags the heading in a drift). */
  boundSpeed = 0;
  course = 0;
  /** Planted feet skidding sideways in a drift (m/s), for skid dust and furrows. */
  footSlip = 0;
  /**
   * Leaning into the turn while sprinting (Keith 2026-10-26 21:54: "the mech to lean as it turns... all the way over, so
   * the shoulders come over"): the whole body rolls (+ left side up, radians, eased) by the lateral acceleration, the
   * line of run's turn rate × the speed, capped at turnRollMax; the hull takes all of it (it isn't kept level).
   */
  turnRoll = 0;
  /** The line of run's turn rate (rad/s, + to the left), smoothed, and the course it was at last step. */
  courseRate = 0;
  private lastCourse = NaN;
  /** In the sprint's gait: the run, a landing stance, or one of its leaps. */
  get bounding() { return this.running || this.bStance !== null || (this.airborne && this.bLeap); }
  /** The sprint's run gait is on (steering like a vehicle); runK is how far the gait has blended from the walk (0..1). */
  running = false;
  runK = 0;
  /** The gait's planted share and cycles per second now (the planted share eases, so steps never jump). */
  dutyNow = 0.6;
  cpsNow = 0;
  /**
   * How far a planted foot sinks into the ground at (x, z) (m; src/mech/sink.ts, set by the mech unit from the surface).
   * Planted spots and landing spots sit this far under the ground; a swinging foot eases out of it and back in.
   * Null: none (feet on top).
   */
  sinkAt: ((x: number, z: number) => number) | null = null;
  /** The run's plant compression: the hull's extra nose-down pitch now (radians), from body(). */
  private plantPitch = 0;
  /** The over-stretch hurry on the cadence (1: none), eased while running. */
  private hurry = 1;
  /** How far the hips sit below where they want to be (m): the stretch is read as if they were there. */
  private hipShort = 0;
  /** The height the running hips may rise to by the reach of the feet carrying them (eased; NaN until running). */
  private reachCap = NaN;
  /** The idle flex: steps left in it (0: not flexing), and how far its gait has blended in (0..1). */
  idleLeft = 0;
  idleK = 0;
  private stillT = 0;
  private idleNext = NaN;
  private idleSeed = 0x2f6b1d3;
  /** Drift slip of the planted feet this frame (world m/s). */
  private slip = new Vector3();
  /** The run's tucked swing pose, relative to the hip (along, up), and its cannon angle. */
  private tuck = { x: 0, y: 0, theta: 0 };
  /** The hips' target height last frame (for the run's feed-forward over rising ground). */
  private prevYT = NaN;
  /**
   * The dash as a push-off (Keith 2026-10-26 18:28): P the foot it pushes off (held, then drawn back under), L the lead
   * foot (steps out toward the dash and slides). Offsets are world x/z from the body and y from the hips.
   */
  private dashMove: {
    t: number; kind: DashKind; dx: number; dz: number; yaw: number; side: number; I: Foot; O: Foot; B: DashBeats;
    h0: number; turn: number; pre: number; carried: number; ax: number; az: number; slope: number; covered: number;
    iSw: DashSwing | null; oSw: DashSwing | null; iDown: boolean; oSet: boolean; oUp: boolean;
  } | null = null;
  /** The dash's shove is being ignored (the steps move the body) until it's gone. */
  private pushLatch = false;
  private pushQuiet = 0;
  /** The dash's lean (roll, left side up +; pitch, nose down +) and hip height change (m), eased out after it. */
  private dashRoll = 0;
  private dashPitch = 0;
  private dashDipNow = 0;
  /** Let go after a dash: its short sprint (the run along it), holding the peak for burstHold more metres, then rolling off. */
  private burst = false;
  private burstHold = 0;
  /** The dash's boost: the run kicks up to this speed (m/s) at dashBoostAccel, then it's spent (0). */
  private boostTo = 0;
  /** In the dash's push-off and slide. */
  get dashing() { return this.dashMove !== null; }
  /** Hips turned toward the dash (radians, eased). */
  private hipOpen = 0;
  /** Body position at the start of this step (planted feet slide by what it moved). */
  private prevPos = new Vector3();
  private bStance: { t: number; T: number; Tc: number; lag: number; r0: number; A: number; first: Foot } | null = null;
  /** This flight is a sprint leap (not a drop or a crest taken walking). */
  private bLeap = false;
  /** Last frame's outside push (a dash), so a sprint starting as the dash ends carries its speed. */
  private pushPrev = new Vector3();
  /** This frame's push after the walls had their say. */
  private pushEff = new Vector3();
  /** Flying: the body is ballistic at airVel (world, m/s), the feet reach for the ground. */
  airborne = false;
  airVel = new Vector3();
  airT = 0;
  /** Which foot reaches ahead in the air and how far, × airSplit: + the left, - the right (a bound swaps it each leap). */
  airLead = 1;
  /** Seconds of stagger left after a hard landing: the stick does nothing. */
  stagger = 0;
  /** Sliding the legs can't step out of (after a landing): skids the planted feet, dies off at landFriction. */
  skid = new Vector3();
  /** The last touchdown (null before the first). */
  lastLanding: Landing | null = null;
  /** Called on each touchdown. */
  onLand: ((l: Landing) => void) | null = null;
  private airY = 0;
  /** 0 legs tucked (rising) .. 1 reaching (falling). */
  private airExt = 1;
  /** The landing squat in progress: depth (m), drop and rise times (s), time since touchdown. */
  private squatState: { depth: number; down: number; up: number; t: number } | null = null;
  /** Called on each footfall with the foot and a strength around 1. */
  onFootfall: ((f: Foot, strength: number) => void) | null = null;
  /** Called as a foot leaves the ground (strength around 1, more with speed). */
  onLiftOff: ((f: Foot, strength: number) => void) | null = null;

  private bodyY = new Spring(70, 16);
  private impact = new Spring(260, 30);
  private lat = new Spring(140, 24);
  private roll = new Spring(120, 22);
  private pitch = new Spring(60, 15);
  private accelSmooth = 0;
  /** Ground rise per metre along the heading (+ uphill), smoothed. */
  grade = 0;
  /**
   * Outside motion (a dash): world velocity added to the body; planted feet skid along with it instead of stepping.
   * crouch lowers the hips (m); leanPitch / leanRoll tilt the body (radians, nose down + / left side up +).
   */
  push = new Vector3();
  crouch = 0;
  leanPitch = 0;
  leanRoll = 0;
  private t = { f: new Vector3(), l: new Vector3(), a: new Vector3(), b: new Vector3(), n3: new Vector3(), n: [0, 1, 0], e: new Euler(), m: new Matrix4() };

  constructor(public v: WalkerValues, public ground: Ground) {
    this.reset(0, 0, 0);
  }

  /** Body pitch (nose down +) and roll (left side up +), radians: for an upper body riding on the hips. */
  get bodyPitch() { return this.pitch.x; }
  get bodyRoll() { return this.roll.x + this.turnRoll + this.dashRoll; }
  /** The hull's roll: what of the hip roll it doesn't level out, plus all of the lean into a turn or a dash (Keith 2026-10-27: the shoulders lean too). */
  get hullRoll() { return this.roll.x * (1 - this.v.shoulderLevel) + this.turnRoll + this.dashRoll; }

  reset(x: number, z: number, heading: number) {
    this.airborne = false; this.airVel.set(0, 0, 0); this.squatState = null; this.stagger = 0; this.skid.set(0, 0, 0);
    this.idleLeft = 0; this.idleK = 0; this.stillT = 0; this.idleNext = NaN;
    this.bStance = null; this.bLeap = false; this.boundSpeed = 0; this.course = heading; this.footSlip = 0; this.pushPrev.set(0, 0, 0);
    this.turnRoll = 0; this.courseRate = 0; this.lastCourse = NaN;
    this.running = false; this.runK = 0; this.dutyNow = this.v.duty; this.cpsNow = 0; this.prevYT = NaN; this.reachCap = NaN; this.slip.set(0, 0, 0);
    this.pushLatch = false; this.pushQuiet = 0; this.burst = false; this.burstHold = 0; this.boostTo = 0; this.dashRoll = this.dashPitch = this.dashDipNow = 0;
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.phase = 0.05;
    const f = forwardOf(heading), l = leftOf(heading);
    for (const ft of this.feet) {
      ft.swinging = false;
      ft.u = 0;
      ft.bState = 0;
      ft.short = false; ft.hang = false; ft.wasPlanted = false; ft.slide.set(0, 0, 0);
      ft.planted.copy(this.pos).addScaledVector(l, ft.side * this.v.footSpread).addScaledVector(f, ft.side * 0.25);
      this.groundAt(ft.planted, ft.plantedUp);
      ft.plantedYaw = heading + ft.side * this.v.toeOut * D2R;
      ft.pos.copy(ft.planted); ft.up.copy(ft.plantedUp); ft.yaw = ft.plantedYaw; ft.pitch = 0;
      ft.theta = ft.liftTheta = this.v.cannonRake * D2R;
    }
    const g = this.ground.height(x, z);
    this.bodyY.x = g + this.v.hipHeight; this.bodyY.v = 0;
    this.pelvis.set(x, this.bodyY.x, z);
    this.pose();
  }

  /**
   * Moving ground (a convoy deck): move the whole walker rigidly, turned by dyaw about (px, pz) then shifted by
   * (dx, dy, dz). Body, height spring, planted feet and swing lift/landing spots ride along, so a mech standing on a
   * moving platform keeps its footing; its own walking stays relative to the ground under it.
   */
  carry(dx: number, dy: number, dz: number, dyaw: number, px: number, pz: number) {
    const c = Math.cos(dyaw), s = Math.sin(dyaw);
    const turn = (p: Vector3) => { const x = p.x, z = p.z; p.x = x * c + z * s; p.z = z * c - x * s; };
    const move = (p: Vector3) => { p.x -= px; p.z -= pz; turn(p); p.x += px + dx; p.y += dy; p.z += pz + dz; };
    move(this.pos); move(this.pelvis);
    turn(this.vel); turn(this.airVel); turn(this.skid);
    this.airY += dy;
    this.heading = wrap(this.heading + dyaw);
    this.course = wrap(this.course + dyaw);
    if (Number.isFinite(this.lastCourse)) this.lastCourse = wrap(this.lastCourse + dyaw);
    this.bodyY.x += dy;
    this.reachCap += dy; this.prevYT += dy;
    const q = CARRY_Q.setFromAxisAngle(UP, dyaw);
    this.pelvisQ.premultiply(q); this.hullQ.premultiply(q);
    for (const f of this.feet) {
      // (prevPlanted too, so riding a deck never reads as a foot skidding.)
      move(f.planted); move(f.lift); move(f.target); move(f.pos); move(f.prevPlanted);
      turn(f.plantedUp); turn(f.liftUp); turn(f.targetUp); turn(f.up);
      f.plantedYaw += dyaw; f.liftYaw += dyaw; f.targetYaw += dyaw; f.yaw += dyaw;
      f.groundY += dy;
    }
    this.pose();
  }

  /**
   * A heavy landing (after a drop): the hips start sink metres low and spring back up on the body's height spring,
   * and the plant-thud spring is hit downward at kick m/s on top (the hocks squash with it).
   */
  thud(sink: number, kick: number) {
    this.bodyY.x -= sink; this.bodyY.v = 0;
    this.impact.v -= kick;
    this.pose();
  }

  /**
   * Leave the ground (or change course in the air) with the hips at their current place, flying at (vx, vy, vz) m/s:
   * a crane letting go, a jump, a blast. The walker lands by itself.
   */
  launch(vx: number, vy: number, vz: number) {
    this.dashMove = null; this.burst = false; this.boostTo = 0;
    this.hipOpen = 0;
    for (const f of this.feet) f.kneeYaw = 0;
    if (!this.airborne) {
      this.airborne = true;
      this.airT = 0;
      this.airY = this.pelvis.y;
      this.squatState = null;
      this.stats.takeoffs++;
      for (const f of this.feet) { f.airRel.subVectors(f.pos, this.pelvis); f.swinging = false; f.u = 0; f.stanceT = 0; f.hang = false; f.short = false; }
    }
    this.airVel.set(vx, vy, vz);
    this.skid.set(0, 0, 0);
  }

  /** Hips below standing height now from a landing squat (m; negative while overshooting). */
  get squat() {
    const q = this.squatState;
    if (!q) return 0;
    if (q.t < q.down) return q.depth * Math.sin((Math.PI / 2) * (q.t / q.down));
    const r = smooth(0, 1, (q.t - q.down) / q.up);
    return q.depth * (1 - r) - q.depth * this.v.landOvershoot * Math.sin(Math.PI * r) * r;
  }
  /** Still settling from a landing. */
  get landing() { return this.squatState !== null; }

  /** Solve the legs for the body and feet as they stand (after writing the pose from outside, e.g. a crane holding the mech). */
  solve() { this.pose(); }

  stride() { return Math.min(this.v.strideMax, this.v.strideBase + this.v.stridePerSpeed * this.speed); }
  /** 0 at walk speed and below, 1 at sprint speed: how much the gait is a run (bounce, crouch). */
  runShare() { return smooth(this.v.walkSpeed, Math.max(this.v.walkSpeed + 0.1, this.v.sprintSpeed), this.speed); }
  /** Each foot's distance from the centre line: footSpread standing, coming in to walkSpread once moving. */
  spread() { return this.v.footSpread + (this.v.walkSpread - this.v.footSpread) * clamp(this.speed / 1.5, 0, 1); }
  duty() { return this.v.duty + (this.v.dutyFast - this.v.duty) * clamp(this.speed / Math.max(0.1, this.v.sprintSpeed), 0, 1); }

  update(dt: number, cmd: MoveCommand) {
    if (dt <= 0) return;
    const v = this.v;
    this.stats.frames++;
    // A dash's shove, once its steps have started, moves nothing (the steps do) until it's gone.
    // (Gone: quiet for a quarter second; the shove's tail dips to nothing just before its glide picks up.)
    if (this.pushLatch) {
      this.pushQuiet = this.push.lengthSq() < 0.25 ? this.pushQuiet + dt : 0;
      if (this.pushQuiet > 0.25) this.pushLatch = false;
      this.push.set(0, 0, 0);
    }
    if (this.stagger > 0) { this.stagger = Math.max(0, this.stagger - dt); cmd = { x: 0, z: 0, sprint: false }; }
    this.footSlip = 0;
    this.slip.set(0, 0, 0);
    this.tuckPose();
    this.turnLean(dt);
    this.plantPitch = 0;
    // The sprint, once any stagger and landing squat are over. Its ground gait is the run (left, right, left, right);
    // the gallop's stance is the way down out of the air (a crest jump's landing), and the whole gait with boundGallop.
    const gallop = v.boundGallop >= 0.5;
    const sprinting = (this.bound || this.burst || (this.dashMove !== null && this.dashMove.oUp)) && this.stagger <= 0 && !this.squatState;
    this.runK = clamp(this.runK + (sprinting && !gallop ? dt : -dt) / Math.max(0.02, v.runBlend), 0, 1);
    if (this.airborne) { this.stats.airFrames++; this.fly(dt, cmd); this.pose(); this.pushPrev.copy(this.push); this.trackSlides(dt); return; }
    if (this.squatState) { this.squatState.t += dt; if (this.squatState.t >= this.squatState.down + this.squatState.up) this.squatState = null; }
    if (this.bound && this.stagger <= 0 && !this.squatState && (gallop || this.bStance)) { this.boundStep(dt, cmd); this.pushPrev.copy(this.push); this.trackSlides(dt); return; }
    if (this.bStance) this.endBound();
    this.prevPos.copy(this.pos);
    // The run: the sprint while Space holds it, or a dash's short sprint after letting go (burst). The dash's steps
    // hand over to it themselves.
    if (this.bound) this.burst = false;
    if (!this.dashMove) {
      if ((this.bound || this.burst) && this.stagger <= 0 && !this.squatState) { if (!this.running) this.runStart(); }
      else if (this.running) this.runEnd();
    }
    this.pushPrev.copy(this.push);
    // A dash's shove (from outside, src/mech/dash.ts) starting: the steps.
    if (!this.dashMove && !this.running && this.push.lengthSq() > 4) this.dashBegin(this.push.x, this.push.z);

    if (this.running) this.runSteer(dt, cmd);
    else if (this.dashMove) this.dashSteer(dt);
    else {
    // Grade along the heading: slows the walk uphill; shapes the stance downhill (aim, body).
    {
      const fw = forwardOf(this.heading, this.t.f);
      const hA = this.ground.height(this.pos.x + fw.x * 2, this.pos.z + fw.z * 2);
      const hB = this.ground.height(this.pos.x - fw.x * 2, this.pos.z - fw.z * 2);
      this.grade += ((hA - hB) / 4 - this.grade) * Math.min(1, dt * 4);
    }
    // Heading swings toward the stick at a capped rate, and the walk slows through the turn (and uphill).
    const mag = Math.min(1, Math.hypot(cmd.x, cmd.z));
    let want = 0;
    if (mag > 0.05) {
      const err = wrap(Math.atan2(cmd.x, cmd.z) - this.heading);
      const max = v.turnRate * D2R * dt;
      const dh = clamp(err, -max, max);
      this.heading = wrap(this.heading + dh);
      this.turnSpeed = dh / dt;
      want = mag * (cmd.sprint ? v.sprintSpeed : v.walkSpeed) * (1 - v.turnSlow * Math.min(1, Math.abs(err) / (Math.PI / 2)));
      want *= 1 - v.uphillSlow * smooth(0, 0.35, this.grade);
    } else this.turnSpeed = 0;
    const prev = this.speed;
    const rate = want > this.speed ? v.accel : v.decel;
    this.speed += clamp(want - this.speed, -rate * dt, rate * dt);
    // Walking into a wall: the legs can't take it up a face steeper than wallStop (the walk is along the heading, so a
    // wall only slows it; turning away frees it).
    if (this.speed > 0.05) {
      const fw0 = forwardOf(this.heading, this.t.f);
      const out = this.faceScrub(fw0.x * this.speed, fw0.z * this.speed, Math.min(1, v.wallScrub * dt), false);
      this.speed = Math.max(0, out.x * fw0.x + out.z * fw0.z);
    }
    this.accelSmooth += ((this.speed - prev) / dt - this.accelSmooth) * Math.min(1, dt * 6);
    forwardOf(this.heading, this.vel).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    }
    // Landing skid: dies off at landFriction.
    const sk = this.skid.length();
    if (sk > 1e-4) {
      this.skid.multiplyScalar(Math.max(0, sk - v.landFriction * dt) / sk);
      // A skid into a wall dies against it.
      this.faceScrub(this.skid.x, this.skid.z, Math.min(1, v.wallScrub * dt), false);
      this.skid.x = this.t.a.x; this.skid.z = this.t.a.z;
    }
    // A shove (the dash) up a slope covers less ground across it, and into a wall none (Keith 2026-10-26: dashing at a
    // steep wall flung the mech into the sky).
    let px = this.push.x, pz = this.push.z;
    if (px * px + pz * pz > 1e-6) { this.faceScrub(px, pz, 1, true); px = this.t.a.x; pz = this.t.a.z; }
    this.pushEff.set(px, 0, pz);
    const sx = (px + this.skid.x) * dt, sz = (pz + this.skid.z) * dt;
    if (sx * sx + sz * sz > 1e-12) {
      // Skid: the body is shoved and the planted feet slide with it, kept on the sand.
      this.pos.x += sx; this.pos.z += sz;
      for (const f of this.feet) {
        if (this.dashMove) break; // the dash places its own feet
        if (f.swinging) { f.lift.x += sx; f.lift.z += sz; f.target.x += sx; f.target.z += sz; this.groundAt(f.target, f.targetUp); continue; }
        f.planted.x += sx; f.planted.z += sz;
        this.groundAt(f.planted, f.plantedUp);
      }
    }
    // A drift in the sprint: the planted feet slide across.
    if (this.slip.lengthSq() > 1e-8) {
      for (const f of this.feet) if (!f.swinging) { f.planted.addScaledVector(this.slip, dt); this.groundAt(f.planted, f.plantedUp); }
    }
    if (this.leaves()) { this.stats.airFrames++; this.fly(dt, cmd); this.pose(); this.trackSlides(dt); return; }
    if (this.dashMove) { this.dashFeet(dt); this.body(dt, this.dutyNow); this.pose(); this.trackSlides(dt); return; }

    this.idleTick(dt, cmd);

    // Gait phase. The run (sprinting) and the walk share it: the run's cadence rises with speed and its planted share
    // is the ground per stance over the stride, so the flights grow with speed; the planted share eases toward what's
    // wanted (never jumping a foot from stance to swing and back).
    const S = this.stride(), rk = this.gaitK;
    let dWant = this.duty(), cps = this.speed / S;
    if (rk > 0) {
      const { cps: cpsR, duty: dR } = this.runCadence();
      dWant += (dR - dWant) * rk;
      cps += (cpsR - cps) * rk;
    }
    // The idle flex steps with no overlap of planted feet, so each step hands on to the other leg until it's done.
    if (this.idleLeft > 0) dWant = 0.5;
    this.dutyNow += clamp(dWant - this.dutyNow, -0.5 * dt, 0.5 * dt);
    const d = this.dutyNow;
    const anySwing = this.feet[0].swinging || this.feet[1].swinging;
    if (anySwing) cps = Math.max(cps, this.idleLeft > 0 ? v.idleRate : MIN_CYCLE);
    else if (this.idleLeft > 0) cps = v.idleRate;
    // Standing: step a foot back under the body if it's out of place, once any landing squat is over (both feet stay
    // planted through the squat).
    else if (this.speed < 0.08) { cps = 0; if (!this.squatState) this.settle(d); }
    // A planted leg near full stretch (sharp turns, steep ground) hurries the steps instead of overreaching. Running,
    // eased (it used to flick the cadence between one and two and a half times as the legs stretched, Keith 21:54).
    const hurry = 1 + 1.5 * smooth(0.9, 1, this.stretch());
    // Only while the run is on: blending back to the walk after letting go, a trailing leg steps in full at once (Keith
    // 2026-10-27: eased, it trailed out of reach and the hips dropped into the splits).
    this.hurry = this.running ? this.hurry + (hurry - this.hurry) * Math.min(1, dt * 4) : hurry;
    cps *= 1 + (this.hurry - 1) * (this.running ? v.runHurry : 1);
    this.cpsNow = cps;
    this.phase = (this.phase + cps * dt) % 1;

    for (const f of this.feet) {
      const p = (this.phase + f.offset) % 1;
      if (!f.swinging && !f.hang && rk > 0.5 && f.stanceT > 0.5) this.toeDrag(f, dt);
      const swing = p >= d;
      if (f.hang) {
        // Hanging at full reach over ground that fell away: it plants once the ground comes within reach.
        f.u = 1; f.stanceT = 0;
        this.aim(f);
        if (!f.short) { f.hang = false; this.land(f); }
      } else if (swing && !f.swinging) this.liftOff(f);
      else if (!swing && f.swinging) {
        // The spot was locked late in the swing; if it was out of reach then, the foot hangs instead of landing.
        if (f.short) { f.hang = true; f.u = 1; } else this.land(f);
      }
      if (f.swinging && !f.hang) {
        f.u = Math.max(f.u, clamp((p - d) / (1 - d), 0, 1));
        f.stanceT = 0;
        if (f.u < RE_AIM_UNTIL) this.aim(f);
      } else if (!f.swinging) {
        f.stanceT = p / d;
      }
      this.moveFoot(f);
    }
    // Nothing holding it up (a foot hangs over a drop and the other has lifted): it falls, and lands as any fall does.
    if (this.feet.every((f) => f.swinging) && this.feet.some((f) => f.hang)) {
      this.body(dt, d);
      this.pose();
      this.launch(this.vel.x + this.skid.x, 0, this.vel.z + this.skid.z);
      if (this.running) this.bLeap = true;
      this.trackSlides(dt);
      return;
    }

    this.body(dt, d);
    this.pose();
    this.trackSlides(dt);
  }

  /**
   * The run's cadence (cycles/s) and planted share now. Steps/s rise with speed (runSteps to runStepsTop) and with the
   * climb along the line of run (runClimbSteps per degree; downhill runDescentSteps fewer), so a climb takes quicker,
   * shorter strides (Keith 2026-10-26 21:54); the ground per stance shrinks with the stride, so the planted share is the
   * flat's.
   */
  runCadence() {
    const v = this.v;
    const base = (v.runSteps + (v.runStepsTop - v.runSteps) * this.speedShare()) / 2;
    const deg = Math.atan(this.grade) / D2R;
    const steps = Math.max(1, 2 * base + v.runClimbSteps * clamp(deg, 0, 35) - v.runDescentSteps * clamp(-deg, 0, 35));
    const cps = steps / 2;
    const stance = v.boundStanceLen * Math.min(1, base / cps);
    return { cps, duty: clamp((stance * cps) / Math.max(1, this.speed), 0.2, 0.5) };
  }

  /** 0 at the run's speed, 1 at the legs' top speed (by ground speed). */
  private speedShare() {
    const top = this.boundTopNow || this.v.boundTop, run = this.v.sprintSpeed;
    return clamp((this.speed - run) / Math.max(0.5, top - run), 0, 1);
  }

  /** Each planted foot's skid speed this frame, from how far its planted spot moved (for slide dust and furrows). */
  private trackSlides(dt: number) {
    for (const f of this.feet) {
      const planted = !f.swinging && !this.airborne && f.bState === 0;
      if (planted && f.wasPlanted) f.slide.set((f.planted.x - f.prevPlanted.x) / dt, 0, (f.planted.z - f.prevPlanted.z) / dt);
      else f.slide.set(0, 0, 0);
      f.prevPlanted.copy(f.planted);
      f.wasPlanted = planted;
    }
  }

  /** Start the run: with the speed it has (at least the Shift run's), along the way it's going. */
  private runStart() {
    const v = this.v;
    const mx = this.vel.x + this.skid.x + this.pushPrev.x, mz = this.vel.z + this.skid.z + this.pushPrev.z;
    const s = Math.hypot(mx, mz);
    this.boundSpeed = Math.max(s, v.sprintSpeed);
    this.course = s > 0.5 ? Math.atan2(mx, mz) : this.heading;
    this.skid.set(0, 0, 0);
    this.running = true;
  }

  /** Let go: the run hands its speed to the walk (up to the Shift run's) and skids the rest off. */
  private runEnd() {
    const v = this.v;
    const fw = forwardOf(this.heading, this.t.f);
    const vx = Math.sin(this.course) * this.boundSpeed, vz = Math.cos(this.course) * this.boundSpeed;
    this.speed = clamp(vx * fw.x + vz * fw.z, 0, Math.max(v.walkSpeed, v.sprintSpeed));
    this.vel.copy(fw).multiplyScalar(this.speed);
    this.skid.set(vx - this.vel.x, 0, vz - this.vel.z);
    this.boundSpeed = 0;
    this.running = false;
    this.walkPhaseFromFeet(fw);
  }

  /**
   * Handing the sprint's footing to the walk (Keith 2026-10-27: the splits on letting go). The run plants under the
   * hips, the walk a little ahead and for a whole stance of d × stride; held that long, a foot the sprint planted trails
   * out of reach and the hips drop to the ground after it. The phase goes where the frontmost planted foot already is
   * along the walk's stance; a foot behind it that's past its push-off lifts at once.
   */
  private walkPhaseFromFeet(fw: Vector3) {
    const v = this.v;
    let front: Foot | null = null, fx = -Infinity;
    for (const f of this.feet) {
      if (f.swinging || f.hang) continue;
      const x = (f.planted.x - this.pos.x) * fw.x + (f.planted.z - this.pos.z) * fw.z;
      if (x > fx) { fx = x; front = f; }
    }
    if (!front) return;
    // The walk's planted share at once (the sprint's is under a half: both feet would be up together).
    this.dutyNow = this.duty();
    const d = this.dutyNow, L = d * this.stride();
    const ahead = L * (0.5 - v.stanceBack) * smooth(0, 0.6, this.speed);
    const st = clamp((ahead - fx) / Math.max(0.1, L), 0, 0.98);
    this.phase = (((st * d - front.offset) % 1) + 1) % 1;
  }

  /**
   * The run's speed and steering, like a vehicle: speed builds toward the top (less uphill); the line of run turns at
   * the grip (grip × g / speed), the body may turn ahead of it into a drift that scrubs speed and slides the feet; walls
   * take the speed going into them.
   */
  private runSteer(dt: number, cmd: MoveCommand) {
    const v = this.v;
    const prev = this.boundSpeed;
    this.grade += (this.gradeAlong(Math.sin(this.course), Math.cos(this.course), 2) - this.grade) * Math.min(1, dt * 4);
    const top = this.boundTop(this.grade);
    // A dash's short sprint (Keith 2026-10-27: "a burst of speed for a distance of like 25-30m and the player can slow it
    // down prematurely by pulling... in the opposite direction"): up to the peak (the boost), held for burstHold metres,
    // rolled off (dashRolloff), braked hard (dashBrake) with the stick against it; it ends at the walk's pace (or what
    // the stick asks). Held into the sprint, the boost, then the sprint eases to its top.
    if (this.burst) {
      const mag = Math.min(1, Math.hypot(cmd.x, cmd.z));
      const back = mag > 0.3 && (cmd.x * Math.sin(this.course) + cmd.z * Math.cos(this.course)) / mag < -0.3;
      if (back) { this.boostTo = 0; this.burstHold = 0; this.boundSpeed -= v.dashBrake * dt; }
      else if (this.boostTo > this.boundSpeed) this.boundSpeed = Math.min(this.boostTo, this.boundSpeed + v.dashBoostAccel * dt);
      else if (this.burstHold > 0) { this.boostTo = 0; this.burstHold -= this.boundSpeed * dt; }
      else { this.boostTo = 0; this.boundSpeed -= v.dashRolloff * dt; }
      const floor = mag * (cmd.sprint ? v.sprintSpeed : v.walkSpeed);
      if (this.boundSpeed <= Math.max(floor, 3)) { this.boundSpeed = Math.max(this.boundSpeed, 0); this.burst = false; this.boostTo = 0; }
    } else if (this.boostTo > this.boundSpeed) {
      this.boundSpeed = Math.min(this.boostTo, this.boundSpeed + v.dashBoostAccel * dt);
      if (this.boundSpeed >= this.boostTo) this.boostTo = 0;
    } else { this.boostTo = 0; this.boundSpeed += (top - this.boundSpeed) * Math.min(1, v.boundBuild * dt); }
    // Faster than the legs' top (a dash's boost) up a slope: gravity takes it off (Keith 2026-10-26: no flinging off ramps).
    if ((this.boundSpeed > top || this.boostTo > 0) && this.grade > 0) {
      const g = G * Math.sin(Math.atan(this.grade)) * dt;
      if (this.boundSpeed > top) this.boundSpeed = Math.max(top, this.boundSpeed - g);
      if (this.boostTo > 0) this.boostTo = this.grade > 0.4 ? 0 : Math.max(0, this.boostTo - g); // no boost up a steep face
    }
    const grip = (v.boundGrip * G) / Math.max(1, this.boundSpeed);
    const rc = Math.min(v.turnRate * D2R, grip), rh = Math.min(v.turnRate * D2R, grip * (1 + v.boundYaw));
    const mag = Math.min(1, Math.hypot(cmd.x, cmd.z));
    if (mag > 0.05) {
      const err = wrap(Math.atan2(cmd.x, cmd.z) - this.heading), m = rh * dt;
      const dh = clamp(err, -m, m);
      this.heading = wrap(this.heading + dh);
      this.turnSpeed = dh / dt;
    } else this.turnSpeed = 0;
    {
      const err = wrap(this.heading - this.course), m = rc * dt;
      this.course = wrap(this.course + clamp(err, -m, m));
      const drift = wrap(this.heading - this.course), dm = v.boundDriftMax * D2R;
      if (Math.abs(drift) > dm) this.heading = wrap(this.course + Math.sign(drift) * dm);
    }
    const drift = wrap(this.heading - this.course);
    this.boundSpeed *= 1 - Math.min(1, v.boundSkid * Math.abs(Math.sin(drift)) * dt);
    {
      const out = this.faceScrub(Math.sin(this.course) * this.boundSpeed, Math.cos(this.course) * this.boundSpeed, Math.min(1, v.wallScrub * dt), false);
      const s = Math.hypot(out.x, out.z);
      if (s < this.boundSpeed - 1e-6) { this.boundSpeed = s; if (s > 0.3) this.course = Math.atan2(out.x, out.z); }
    }
    const vx = Math.sin(this.course) * this.boundSpeed, vz = Math.cos(this.course) * this.boundSpeed;
    this.vel.set(vx, 0, vz);
    this.speed = this.boundSpeed;
    this.accelSmooth += ((this.boundSpeed - prev) / dt - this.accelSmooth) * Math.min(1, dt * 6);
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    // The feet slide across in a drift: the part of the motion across the body.
    const fw = forwardOf(this.heading, this.t.f);
    const along = vx * fw.x + vz * fw.z;
    const slipK = smooth(8 * D2R, 25 * D2R, Math.abs(drift));
    this.slip.set((vx - fw.x * along) * slipK, 0, (vz - fw.z * along) * slipK);
    this.footSlip = this.slip.length();
  }

  /**
   * The run's tucked swing (Keith 2026-10-26: "swing that thigh up so it tucks up nicely under the hull... as short as
   * possible... toes curl downwards and backwards"): the thigh raised runThighUp, the shin folded runShinBack back from
   * straight down, the cannon folded to runHockFold from the shin. Foot point relative to the hip and the cannon angle.
   */
  private tuckPose() {
    const v = this.v, tk = this.tuck;
    const ph = v.runThighUp * D2R, be = v.runShinBack * D2R, ga = v.runHockFold * D2R;
    const kx = v.femur * Math.sin(ph), ky = -v.femur * Math.cos(ph);
    const hx = kx - v.shin * Math.sin(be), hy = ky - v.shin * Math.cos(be);
    const ac = Math.atan2(ky - hy, kx - hx) - ga;
    const ax = hx + v.cannon * Math.cos(ac), ay = hy + v.cannon * Math.sin(ac);
    // Cannon angle back from the ankle-hip line (+ back), as the leg solve measures it.
    const kX = hx - ax, kY = hy - ay;
    tk.theta = Math.atan2(-ax * kY + ay * kX, -ax * kX - ay * kY);
    // The foot plate's ground point under the ankle, the foot hanging toes-down.
    const p = v.runFootDrop * D2R;
    tk.x = ax - v.ankleHeight * Math.sin(p) + v.ankleBack * Math.cos(p);
    tk.y = ay - v.ankleHeight * Math.cos(p) - v.ankleBack * Math.sin(p);
  }

  /**
   * The run's swing path, relative to the body: from the push-off the foot follows through back and up, swings forward
   * into the tuck high under the hull, reaches forward and sweeps back down into the plant under the hips. Writes the
   * foot's place to out and the pitch, toe and cannon angle the swing wants.
   */
  private runSwing(f: Foot, out: Vector3) {
    const v = this.v, d = this.dutyNow;
    const Tsw = (1 - d) / Math.max(MIN_CYCLE, this.cpsNow);
    const remain = (1 - f.u) * Tsw;
    const u = f.u;
    const fw = forwardOf(this.heading, this.t.f), lf = leftOf(this.heading, this.t.l);
    const hipY = this.bodyY.x;
    const A = f.runA, tk = this.tuck;
    const bx = f.target.x - (this.pos.x + this.vel.x * remain), bz = f.target.z - (this.pos.z + this.vel.z * remain);
    const Bx = bx * fw.x + bz * fw.z, Bs = bx * lf.x + bz * lf.z, By = f.target.y - hipY;
    const Cx = tk.x, Cs = f.side * this.spread(), Cy = tk.y;
    const sp = this.speed, uc = clamp(v.runTuckAt, 0.1, 0.9);
    const herm = (p0: number, m0: number, p1: number, m1: number, t: number) => {
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
    };
    let x: number, y: number, s: number;
    if (u < uc) {
      const t = u / uc;
      x = herm(A.x, -sp * Tsw * v.runFollow * uc, Cx, (Bx - A.x) * 1.6 * uc, t);
      y = herm(A.y, 2.5 * uc, Cy, 0, t);
      s = A.z + (Cs - A.z) * smooth(0, 1, t);
    } else {
      const t = (u - uc) / (1 - uc), seg = 1 - uc;
      x = herm(Cx, (Bx - A.x) * 1.6 * seg, Bx, -sp * Tsw * v.runPaw * seg, t);
      y = herm(Cy, 0, By, -2 * seg, t);
      s = Cs + (Bs - Cs) * smooth(0, 1, t);
    }
    // Never out of the leg's reach (the follow-through behind and the reach ahead grow with the swing's time: at Keith's
    // slower cadence they carried the foot past the leg's length, the dune sprint's reach misses).
    {
      const R = v.legReachMax * (v.femur + v.shin + v.cannon), hs = f.side * v.hipWidth;
      const ax = x, ay = y + v.ankleHeight, az = s - hs, d = Math.hypot(ax, ay, az);
      if (d > R) { const k = R / d; x = ax * k; y = ay * k - v.ankleHeight; s = az * k + hs; }
    }
    out.set(this.pos.x + fw.x * x + lf.x * s, hipY + y, this.pos.z + fw.z * x + lf.z * s);
    // Clear the ground under the foot and its toes.
    const env = Math.sin(Math.PI * u);
    const g = this.ground.height(out.x, out.z);
    const gToe = this.ground.height(out.x + fw.x * v.toeLength, out.z + fw.z * v.toeLength);
    const sk = this.sink(out.x, out.z);
    out.y = Math.max(out.y, Math.max(g, gToe) + v.footClear * env - sk * (1 - env), g - sk * (1 - env));
    // Orientation: from the push-off's rolled heel to hanging toes-down at the tuck to flat at the plant; the toes from
    // bent up (pushing) to curled down and back, opening flat for the plant; the cannon folding up and opening again.
    const a = smooth(0, uc, u), b = smooth(uc, 0.92, u);
    const drop = v.runFootDrop * D2R, curl = v.runToeCurl * D2R;
    f.runTheta = u < uc ? f.liftTheta + (tk.theta - f.liftTheta) * a : tk.theta + (v.cannonRake * D2R - tk.theta) * b;
    return {
      pitch: u < uc ? f.liftPitch + (drop - f.liftPitch) * a : drop * (1 - b),
      toe: u < uc ? f.liftToe + (curl - f.liftToe) * a : curl * (1 - b),
    };
  }

  /**
   * Does the ground fall away faster than the body can follow? Over a crest at speed s the path's curvature c (1/m)
   * needs a downward pull of c s²; past leaveG × gravity the mech takes off with the climb it carried to the crest.
   */
  private leaves() {
    const v = this.v;
    const mx = this.vel.x + this.pushEff.x + this.skid.x, mz = this.vel.z + this.pushEff.z + this.skid.z;
    const s = Math.hypot(mx, mz);
    if (s < Math.max(0.5, v.leaveMin) || (this.squatState !== null && this.squatState.t < AIR_MIN)) return false;
    const dx = mx / s, dz = mz / s, L = clamp(s * 0.12, 0.8, 2.5);
    const h0 = this.ground.height(this.pos.x, this.pos.z);
    const hf = this.ground.height(this.pos.x + dx * L, this.pos.z + dz * L);
    const hb = this.ground.height(this.pos.x - dx * L, this.pos.z - dz * L);
    const pull = -((hf - 2 * h0 + hb) / (L * L)) * s * s;
    if (pull <= G * v.leaveG) return false;
    // Off along the ground it was on: the walk (and any skid) is the flight; a dash's shove stays outside, added each step.
    // The climb it carries is capped: a steep face would otherwise turn all its speed upward (the wall fling).
    this.launch(this.vel.x + this.skid.x, Math.min(v.launchUpMax, s * ((h0 - hb) / L)), this.vel.z + this.skid.z);
    // Running off a crest: the gallop's flight and landing (lead foot reaching), then back into the run.
    if (this.running) { this.bLeap = true; this.course = Math.atan2(this.airVel.x, this.airVel.z); }
    return true;
  }

  /** One step in the air: ballistic hips, a little steering, the legs tucking or reaching, touchdown. */
  private fly(dt: number, cmd: MoveCommand) {
    const v = this.v, a = this.airVel;
    this.airT += dt;
    const mag = Math.min(1, Math.hypot(cmd.x, cmd.z));
    // A sprint leap steers as little as the air allows of what the feet could do on the ground.
    const rate = this.bLeap ? this.boundTurnRates().heading : v.turnRate * D2R;
    if (mag > 0.05 && v.airSteer > 0) {
      const err = wrap(Math.atan2(cmd.x, cmd.z) - this.heading);
      const max = rate * v.airSteer * dt;
      const dh = clamp(err, -max, max);
      this.heading = wrap(this.heading + dh);
      this.turnSpeed = dh / dt;
    } else this.turnSpeed = 0;
    if (this.bLeap) {
      // The line of run is the flight's: the body can only turn so far off it.
      this.course = Math.atan2(a.x, a.z);
      const drift = wrap(this.heading - this.course), m = v.boundDriftMax * D2R;
      if (Math.abs(drift) > m) this.heading = wrap(this.course + Math.sign(drift) * m);
    }
    a.y -= G * dt;
    // A booster's glide: falling slower out of a leap.
    if (this.bLeap && this.boundGlide > 0 && a.y < 0) a.y += G * this.boundGlide * dt;
    let px = this.push.x, pz = this.push.z;
    if (px * px + pz * pz > 1e-6) { this.faceScrub(px, pz, 1, true); px = this.t.a.x; pz = this.t.a.z; }
    this.pos.x += (a.x + px) * dt;
    this.pos.z += (a.z + pz) * dt;
    this.airY += a.y * dt;
    this.vel.set(a.x, 0, a.z);
    const fw = forwardOf(this.heading, this.t.f), lf = leftOf(this.heading, this.t.l);
    this.speed = Math.max(0, a.x * fw.x + a.z * fw.z);
    if (this.bLeap) this.boundSpeed = Math.hypot(a.x, a.z);

    // Legs: tucked while rising fast, reaching for the ground falling; a little wider than standing, left foot ahead.
    // In a sprint leap the feet reach for where they'll land, the lead foot further and held higher (the trailing foot
    // lands first), and a leg swinging forward draws its foot up.
    this.airExt = clamp((1.5 - a.y) / 4, 0, 1);
    const len = v.hipHeight * (v.airTuck + (v.airReach - v.airTuck) * this.airExt);
    let touch = false;
    for (const f of this.feet) {
      this.airFoot(f, dt, len);
      const g = this.ground.height(f.pos.x, f.pos.z);
      if (f.pos.y <= g + 0.01) {
        f.pos.y = g;
        if (a.y < 0 && this.airT > AIR_MIN) touch = true;
      }
      f.swinging = false; f.u = 0; f.stanceT = 0; f.bState = 0;
      f.up.copy(UP);
      f.yaw = this.heading + f.side * v.toeOut * D2R;
      // Toes droop while tucked, flat for the landing.
      f.pitch = 0.35 * (1 - this.airExt);
      f.toe = 0.3 * (1 - this.airExt);
      f.groundY = g;
      this.toesClear(f, 0.5);
    }
    void lf;
    if (this.airT > AIR_MIN) {
      // Against a face while still rising (a leap or a shove into a steep slope): the speed going into it goes, so the
      // body can't fly on into the ground; and if the hips come down to the ground whichever way it's moving, it lands.
      if (a.y >= 0 && this.feet.some((f) => f.pos.y <= f.groundY + 0.011)) {
        const o = this.faceScrub(a.x, a.z, 1, false);
        a.x = o.x; a.z = o.z;
      }
      if (this.airY - this.ground.height(this.pos.x, this.pos.z) < v.hipHeight * 0.6) touch = true;
    }

    // Body: pitches with the flight path, levels its roll, rides the flight; a sprint keeps its lean.
    const hs = Math.hypot(a.x, a.z);
    this.pitch.step(-v.airPitch * Math.atan2(a.y, Math.max(3, hs)) + this.leanPitch + (this.bLeap ? this.boundLeanNow() : 0), dt);
    this.roll.step(this.leanRoll, dt);
    this.lat.step(0, dt);
    this.impact.step(0, dt);
    this.bodyY.x = this.airY; this.bodyY.v = a.y;
    this.pelvis.set(this.pos.x, this.airY, this.pos.z);
    this.orient(this.heading);
    if (touch) this.touchDown();
  }

  /** Feet on the ground: plant them where they are, keep the speed the legs can run on with, skid the rest, squat. */
  private touchDown() {
    const v = this.v, a = this.airVel;
    this.airborne = false;
    this.stats.landings++;
    const n = new Vector3();
    for (const f of this.feet) {
      const gn = this.ground.normal(f.pos.x, f.pos.z, this.t.n);
      n.x += gn[0]; n.y += gn[1]; n.z += gn[2];
    }
    // How hard it hits is the speed into the ground: landing along a slip face it was flying down is gentle.
    n.normalize();
    const impact = Math.max(0, -(a.x * n.x + a.y * n.y + a.z * n.z));
    // What's left runs on along the ground (a slope turns some of the fall into speed down it).
    const tx = a.x + n.x * impact, ty = a.y + n.y * impact, tz = a.z + n.z * impact;
    const tl = Math.hypot(tx, ty, tz), hl = Math.hypot(tx, tz);
    const gx = hl > 1e-6 ? (tx / hl) * tl : 0, gz = hl > 1e-6 ? (tz / hl) * tl : 0;
    // Sprinting, a landing the legs can take is just the next stride.
    const wasLeap = this.bLeap;
    this.bLeap = false;
    if (this.bound && this.stagger <= 0 && impact <= v.boundAbsorb) { this.boundLand(impact, gx, gz, wasLeap); return; }
    // A real landing: the run starts over from what's left once the squat is done.
    this.running = false;
    this.prevYT = NaN; this.reachCap = NaN;
    for (const f of this.feet) {
      f.planted.copy(f.pos);
      this.groundAt(f.planted, f.plantedUp);
      f.pos.copy(f.planted); f.up.copy(f.plantedUp);
      f.plantedYaw = f.yaw;
      f.swinging = false; f.u = 0; f.stanceT = 0; f.pitch = 0; f.toe = 0; f.bState = 0;
      f.groundY = f.planted.y;
    }
    // The foot that reached ahead starts its stance, the other is late in its stance.
    this.phase = this.airLead >= 0 ? 0 : 0.5;
    const fw = forwardOf(this.heading, this.t.f);
    const along = gx * fw.x + gz * fw.z;
    this.speed = clamp(along, 0, Math.max(v.walkSpeed, v.sprintSpeed));
    this.vel.copy(fw).multiplyScalar(this.speed);
    this.skid.set(gx - this.vel.x, 0, gz - this.vel.z);
    const soft = Math.max(0.1, v.landSoft);
    const depth = Math.min(v.landSquatMax, impact <= soft ? (v.landDip * impact) / soft : v.landDip + v.landSquat * (impact - soft));
    const hard = clamp((impact - soft) / Math.max(0.1, v.landHard - soft), 0, 1);
    const stagger = impact >= v.landHard ? v.landStagger : 0;
    this.stagger = Math.max(this.stagger, stagger);
    // Dropping into the squat at about the speed it hit with, rising slower from deeper ones.
    this.squatState = {
      depth,
      down: Math.max(0.06, (depth * Math.PI) / (2 * Math.max(0.5, impact))),
      up: v.landRecover * (0.4 + 0.6 * depth / Math.max(0.1, v.landSquatMax)),
      t: 0,
    };
    this.bodyY.x = this.airY; this.bodyY.v = 0;
    this.impact.x = 0; this.impact.v = 0;
    const [l, r] = this.feet;
    this.lastLanding = {
      impact, speed: tl, airTime: this.airT, depth, hard, stagger,
      damage: Math.max(0, impact - v.landHurt) * v.landDamage,
      x: (l.planted.x + r.planted.x) / 2, y: (l.planted.y + r.planted.y) / 2, z: (l.planted.z + r.planted.z) / 2,
    };
    this.onLand?.(this.lastLanding);
  }

  // ---- The sprint (Keith 2026-10-26) ----

  /** The sprint's top speed here: the legs' (or what the controller set), less going uphill. */
  private boundTop(grade: number) {
    return (this.boundTopNow || this.v.boundTop) * (1 - this.v.uphillSlow * smooth(0, 0.35, grade));
  }
  /** 0 at the run, 1 at the legs' top speed. */
  private boundShare() {
    const top = this.boundTopNow || this.v.boundTop, run = this.v.sprintSpeed;
    return clamp((this.boundSpeed - run) / Math.max(0.5, top - run), 0, 1);
  }
  /** Forward lean at this speed (radians). */
  private boundLeanNow() { return this.v.boundLean * D2R * (0.35 + 0.65 * this.boundShare()); }
  /**
   * Turn rates while sprinting (rad/s): the line of run turns with the grip (grip × g / speed on average over a stride,
   * so harder while the feet are down), the body may turn boundYaw faster into a drift; never past the walk's turn rate.
   */
  private boundTurnRates() {
    const v = this.v, grip = (v.boundGrip * G) / Math.max(1, this.boundSpeed);
    const stance = clamp(v.boundStanceLen * (1 + v.boundStagger) / Math.max(4, this.boundSpeed), 0.05, 0.5);
    const flight = (2 * v.boundHop) / G;
    const course = Math.min(v.turnRate * D2R, grip * (stance + flight) / stance);
    // The body turns on the ground and (airSteer of that) in the air; on average boundYaw faster than the line.
    const heading = Math.min(v.turnRate * D2R, grip * (1 + v.boundYaw) * (stance + flight) / (stance + v.airSteer * flight));
    return { course, heading };
  }
  /** The highest ground from under the body to L metres ahead along the way it's moving. */
  private groundAhead(L: number) {
    const s = Math.hypot(this.vel.x, this.vel.z);
    const dx = s > 0.5 ? this.vel.x / s : Math.sin(this.heading), dz = s > 0.5 ? this.vel.z / s : Math.cos(this.heading);
    let m = -Infinity;
    for (let i = 0; i <= 4; i++) m = Math.max(m, this.ground.height(this.pos.x + dx * L * i / 4, this.pos.z + dz * L * i / 4));
    return m;
  }

  /** Ground rise per metre along (dx, dz) through the body (+ uphill). */
  private gradeAlong(dx: number, dz: number, L = 1.2) {
    return (this.ground.height(this.pos.x + dx * L, this.pos.z + dz * L) - this.ground.height(this.pos.x - dx * L, this.pos.z - dz * L)) / (2 * L);
  }

  /**
   * Velocity (vx, vz) against the ground a little ahead of the body, written to this.t.a (x, z). The part going up a face
   * steeper than wallGrade loses `share` of itself (scaled up to all of it at wallStop): a wall stops the speed going
   * into it and leaves the rest sliding along it. project: also lay an uphill shove onto the slope (a steep climb covers
   * less ground across), for one-off pushes; persistent speeds (skids, the sprint) pass a per-frame share instead.
   */
  private faceScrub(vx: number, vz: number, share: number, project: boolean) {
    const v = this.v, out = this.t.a.set(vx, 0, vz);
    const s = Math.hypot(vx, vz);
    if (s < 1e-6) return out;
    const L = clamp(s * 0.08, 0.6, 2.5);
    const n = this.ground.normal(this.pos.x + (vx / s) * L, this.pos.z + (vz / s) * L, this.t.n);
    const hn = Math.hypot(n[0], n[2]);
    if (hn < 1e-6) return out;
    // Uphill (horizontal) and the slope there.
    const ux = -n[0] / hn, uz = -n[2] / hn, slope = hn / Math.max(0.05, n[1]);
    const into = vx * ux + vz * uz;
    if (into <= 0) return out;
    let keep = 1;
    if (project) keep = 1 / Math.sqrt(1 + slope * slope);
    const k = smooth(v.wallGrade, Math.max(v.wallGrade + 0.01, v.wallStop), slope);
    if (k > 0) keep *= k >= 0.999 ? 0 : 1 - Math.min(1, k * share);
    out.x -= ux * into * (1 - keep);
    out.z -= uz * into * (1 - keep);
    return out;
  }

  /** A foot in the air: eased toward its place under the hips (the air pose; a sprint leap's own). */
  private airFoot(f: Foot, dt: number, len: number) {
    const v = this.v;
    const fw = forwardOf(this.heading, this.t.f), lf = leftOf(this.heading, this.t.l);
    const rel = this.t.b;
    let k: number;
    if (this.bLeap || this.bStance) {
      const lead = f.side * Math.sign(this.airLead || 1) > 0;
      const ahead = v.boundReach + (lead ? 0.5 : -0.5) * v.boundSplit;
      const side = this.spread() * f.side;
      rel.set(lf.x * side + fw.x * ahead, -len + (lead ? v.boundLeadLift * this.airExt : 0), lf.z * side + fw.z * ahead);
      // A leg swinging forward from behind draws its foot up.
      const behind = Math.hypot(rel.x - f.airRel.x, rel.z - f.airRel.z);
      rel.y += v.boundTuck * smooth(0.2, 1.6, behind);
      // The swing through is unhurried: the trailing leg stays out behind after the push-off before it comes forward.
      k = 1 - Math.exp(-dt * v.boundSwing);
    } else {
      const side = v.footSpread * v.airSpread * f.side, ahead = v.airFore + (f.side * this.airLead * v.airSplit) / 2;
      rel.set(lf.x * side + fw.x * ahead, -len, lf.z * side + fw.z * ahead);
      k = 1 - Math.exp(-dt * 12);
    }
    f.airRel.lerp(rel, k);
    f.pos.set(this.pelvis.x + f.airRel.x, this.pelvis.y + f.airRel.y, this.pelvis.z + f.airRel.z);
    // pelvis is last frame's in the air: use the body's own position for xz, the flight height for y.
    if (this.airborne) f.pos.set(this.pos.x + f.airRel.x, this.airY + f.airRel.y, this.pos.z + f.airRel.z);
  }

  /**
   * Start sprinting from the walk (or a stand, or the end of a dash): with the speed it has, at least the run's, into a
   * short stance on the feet as they are (a swinging foot comes down first), whose push-off is the first leap.
   */
  private boundStart(dt: number, cmd: MoveCommand) {
    const v = this.v;
    const mx = this.vel.x + this.skid.x + this.pushPrev.x, mz = this.vel.z + this.skid.z + this.pushPrev.z;
    const s = Math.hypot(mx, mz);
    this.boundSpeed = Math.max(s, v.sprintSpeed);
    this.course = s > 0.5 ? Math.atan2(mx, mz) : this.heading;
    this.skid.set(0, 0, 0);
    this.squatState = null;
    const Tc = clamp(v.boundStanceLen / Math.max(4, this.boundSpeed), 0.06, 0.45) * 0.6, lag = v.boundStagger * Tc;
    const under = this.ground.height(this.pos.x, this.pos.z);
    const fw = forwardOf(this.course, this.t.f), [a, b] = this.feet;
    // The planted foot behind goes first; a swinging foot lands late where it was heading.
    let first: Foot = a.swinging ? b : b.swinging ? a : (a.planted.x - b.planted.x) * fw.x + (a.planted.z - b.planted.z) * fw.z < 0 ? a : b;
    if (first.swinging) first = a;
    for (const f of this.feet) {
      f.u = 0; f.stanceT = 0;
      if (!f.swinging) { f.bState = 0; continue; }
      f.bState = 1;
      f.lift.copy(f.pos); f.liftUp.copy(f.up); f.liftTheta = f.theta;
      f.target.set(f.pos.x + Math.sin(this.course) * this.boundSpeed * lag, 0, f.pos.z + Math.cos(this.course) * this.boundSpeed * lag);
      this.groundAt(f.target, f.targetUp);
      f.targetYaw = this.heading + f.side * v.toeOut * D2R;
    }
    this.airLead = first.side;
    this.bStance = { t: 0, T: Tc + lag, Tc, lag, r0: this.pelvis.y - (under + this.boundStand()), A: (v.boundHop / 2) * (Tc + lag) / Math.PI, first };
    this.boundStep(dt, cmd);
  }

  /** Push off: both feet leave (whichever are still down), the lead foot swaps, the body flies on the air state. */
  private boundLaunch() {
    const v = this.v;
    const cx = Math.sin(this.course), cz = Math.cos(this.course);
    // Off the ground it's running on: the push-off is relative to the slope there, capped going up (no wall fling).
    const vy = Math.min(v.launchUpMax, v.boundHop + this.boundSpeed * clamp(this.gradeAlong(cx, cz), -1.5, 3));
    const k = clamp(0.4 + this.boundSpeed / 14, 0.5, 2);
    for (const f of this.feet) if (!f.swinging) this.onLiftOff?.(f, k);
    this.bStance = null;
    this.airLead = this.airLead >= 0 ? -1 : 1;
    this.stats.leaps++;
    const wasAir = this.airborne;
    this.launch(cx * this.boundSpeed, vy, cz * this.boundSpeed);
    if (!wasAir) this.stats.takeoffs--; // a stride, not a take-off
    this.bLeap = true;
    for (const f of this.feet) { f.bState = 0; f.swinging = false; }
  }

  /** A sprint leap (or any flight while sprinting) comes down softly enough: the stance of the next stride. */
  private boundLand(impact: number, gx: number, gz: number, wasLeap: boolean) {
    const v = this.v;
    const hs = Math.hypot(gx, gz);
    if (hs > 0.5) this.course = Math.atan2(gx, gz);
    this.boundSpeed = hs;
    const s = Math.max(4, this.boundSpeed);
    const Tc = clamp(v.boundStanceLen / s, 0.06, 0.45), lag = v.boundStagger * Tc;
    const under = this.ground.height(this.pos.x, this.pos.z);
    const r0 = this.airY - (under + this.boundStand());
    const A = ((impact + v.boundHop) / 2) * (Tc + lag) / Math.PI;
    // Plant whatever touches; a foot still in the air comes down a moment later where it's heading.
    const cx = Math.sin(this.course) * this.boundSpeed, cz = Math.cos(this.course) * this.boundSpeed;
    let first: Foot | null = null, firstH = Infinity;
    for (const f of this.feet) {
      const h = f.pos.y - this.ground.height(f.pos.x, f.pos.z);
      if (h < firstH) { firstH = h; first = f; }
    }
    const k = clamp(0.5 + impact / 5, 0.5, 1.6);
    for (const f of this.feet) {
      f.u = 0; f.stanceT = 0; f.pitch = 0; f.toe = 0;
      const h = f.pos.y - this.ground.height(f.pos.x, f.pos.z);
      if (f === first || h < 0.05) {
        this.plantBound(f, k);
      } else {
        f.bState = 1; f.swinging = true;
        f.lift.copy(f.pos); f.liftYaw = f.yaw; f.liftPitch = f.pitch; f.liftToe = f.toe; f.liftUp.copy(UP); f.liftTheta = f.theta;
        f.target.set(f.pos.x + cx * lag, 0, f.pos.z + cz * lag);
        this.groundAt(f.target, f.targetUp);
        f.targetYaw = this.heading + f.side * v.toeOut * D2R;
      }
    }
    // Both down together: the one behind goes first.
    if (this.feet.every((f) => f.bState === 0)) {
      const fw = forwardOf(this.course, this.t.f);
      const [a, b] = this.feet;
      first = (a.planted.x - b.planted.x) * fw.x + (a.planted.z - b.planted.z) * fw.z < 0 ? a : b;
    }
    this.skid.set(0, 0, 0);
    this.squatState = null;
    this.bStance = { t: 0, T: Tc + lag, Tc, lag, r0, A, first: first! };
    this.bodyY.x = this.airY; this.bodyY.v = 0;
    this.impact.x = 0; this.impact.v = 0;
    // A real landing (off a crest, or from higher): the stomp, the sound and the shake.
    if (!wasLeap || impact > v.landSoft) {
      const [l, r] = this.feet;
      this.lastLanding = {
        impact, speed: hs, airTime: this.airT, depth: A, hard: clamp((impact - v.landSoft) / Math.max(0.1, v.landHard - v.landSoft), 0, 1), stagger: 0,
        damage: 0, x: (l.pos.x + r.pos.x) / 2, y: under, z: (l.pos.z + r.pos.z) / 2, bound: true,
      };
      if (impact > v.landSoft) this.onLand?.(this.lastLanding);
    }
  }

  /** Hip height above the ground while sprinting (crouched with speed, and by any outside crouch). */
  private boundStand() { return this.v.hipHeight - this.v.boundCrouch * (0.4 + 0.6 * this.boundShare()) - this.crouch; }

  private plantBound(f: Foot, k: number) {
    f.bState = 0; f.swinging = false;
    f.planted.copy(f.pos);
    this.groundAt(f.planted, f.plantedUp);
    f.pos.copy(f.planted); f.up.copy(f.plantedUp);
    f.plantedYaw = this.heading + f.side * this.v.toeOut * D2R;
    f.yaw = f.plantedYaw;
    f.groundY = f.planted.y;
    this.stats.steps++;
    this.onFootfall?.(f, k);
  }

  /** One step of a sprint stance: the body runs over planted feet, dips and rises; the feet go down and up staggered. */
  private boundStep(dt: number, cmd: MoveCommand) {
    const v = this.v;
    if (!this.bStance) { this.boundStart(dt, cmd); return; }
    const st = this.bStance;
    st.t += dt;
    const cx = Math.sin(this.course), cz = Math.cos(this.course);
    const grade = this.gradeAlong(cx, cz);
    this.grade = grade;

    // Speed builds toward the top while the feet push (so a stride's average follows boundBuild).
    const rates = this.boundTurnRates();
    const share = clamp(st.T / (st.T + (2 * v.boundHop) / G), 0.08, 1);
    const top = this.boundTop(grade);
    this.boundSpeed += (top - this.boundSpeed) * Math.min(1, (v.boundBuild * dt) / share);

    // Steering: the body turns toward the stick, the line of run follows at the grip; the gap between them is a drift
    // that scrubs speed and skids the feet sideways.
    const mag = Math.min(1, Math.hypot(cmd.x, cmd.z));
    if (mag > 0.05) {
      const err = wrap(Math.atan2(cmd.x, cmd.z) - this.heading), m = rates.heading * dt;
      const dh = clamp(err, -m, m);
      this.heading = wrap(this.heading + dh);
      this.turnSpeed = dh / dt;
    } else this.turnSpeed = 0;
    {
      const err = wrap(this.heading - this.course), m = rates.course * dt;
      this.course = wrap(this.course + clamp(err, -m, m));
      const drift = wrap(this.heading - this.course), dm = v.boundDriftMax * D2R;
      if (Math.abs(drift) > dm) this.heading = wrap(this.course + Math.sign(drift) * dm);
    }
    const drift = wrap(this.heading - this.course);
    this.boundSpeed *= 1 - Math.min(1, v.boundSkid * Math.abs(Math.sin(drift)) * dt);
    // Walls ahead: the speed going into them goes.
    {
      const out = this.faceScrub(Math.sin(this.course) * this.boundSpeed, Math.cos(this.course) * this.boundSpeed, Math.min(1, v.wallScrub * dt), false);
      const s = Math.hypot(out.x, out.z);
      if (s < this.boundSpeed - 1e-6) { this.boundSpeed = s; if (s > 0.3) this.course = Math.atan2(out.x, out.z); }
    }
    const vx = Math.sin(this.course) * this.boundSpeed, vz = Math.cos(this.course) * this.boundSpeed;
    this.vel.set(vx, 0, vz);
    this.speed = this.boundSpeed;
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    // Feet slide sideways in a drift: the part of the motion across the body.
    const fw = forwardOf(this.heading, this.t.f);
    const along = vx * fw.x + vz * fw.z;
    const slipK = smooth(8 * D2R, 25 * D2R, Math.abs(drift));
    const slx = (vx - fw.x * along) * slipK, slz = (vz - fw.z * along) * slipK;
    this.footSlip = Math.hypot(slx, slz);

    // Body: the landing's height eases to the running height, dipping through the stance (soaking up the landing and
    // springing into the push-off) plus a little give at mid-stance.
    const u = clamp(st.t / st.T, 0, 1);
    const under = this.ground.height(this.pos.x, this.pos.z);
    const rel = st.r0 * (1 - smooth(0, 1, u)) - st.A * Math.sin(Math.PI * u) - v.boundSquat * Math.sin(Math.PI * u) ** 2;
    const y = under + this.boundStand() + rel;
    this.bodyY.v = (y - this.bodyY.x) / dt; this.bodyY.x = y;
    this.impact.step(0, dt);
    this.lat.step(0, dt);
    this.roll.step(this.leanRoll + clamp(-drift, -0.5, 0.5) * 0.3, dt);
    const slope = Math.atan(grade);
    this.pitch.step(-slope * (slope < 0 ? v.slopePitch * v.downhillLevel : v.slopePitch) + this.boundLeanNow() + this.leanPitch, dt);
    this.pelvis.set(this.pos.x, y, this.pos.z);
    this.orient(this.heading);

    // Feet: the first one down lifts first (at Tc), the other lands late (at lag) and pushes off last (at T).
    this.airExt = 0;
    const len = v.hipHeight * v.airTuck;
    const kStep = clamp(0.5 + this.boundSpeed / 20, 0.5, 1.4);
    for (const f of this.feet) {
      const isFirst = f === st.first;
      const start = isFirst ? 0 : st.lag, end = isFirst ? st.Tc : st.T;
      if (f.bState === 1) {
        const w = clamp(st.t / Math.max(0.02, st.lag), 0, 1), e = w * w * (3 - 2 * w);
        f.pos.lerpVectors(f.lift, f.target, e);
        f.pos.y = Math.max(f.pos.y, this.ground.height(f.pos.x, f.pos.z) - this.sink(f.pos.x, f.pos.z) * e);
        f.up.copy(f.liftUp).lerp(f.targetUp, e).normalize();
        f.yaw = f.targetYaw; f.pitch = 0; f.toe = 0;
        f.u = 0.85 + 0.15 * w;
        if (w >= 1) this.plantBound(f, kStep);
        else continue;
      }
      if (f.bState === 0) {
        f.planted.x += slx * dt; f.planted.z += slz * dt;
        if (slipK > 0) this.groundAt(f.planted, f.plantedUp);
        f.stanceT = clamp((st.t - start) / Math.max(0.02, end - start), 0, 1);
        if (st.t >= end && isFirst) {
          // Up early for the leap: from here it follows the air pose.
          f.bState = 2; f.swinging = true; f.u = 0; f.liftTheta = f.theta; f.stanceT = 0;
          f.airRel.subVectors(f.pos, this.pelvis);
          this.onLiftOff?.(f, kStep);
        } else { this.toeDrag(f, dt); this.moveFoot(f); continue; }
      }
      // Lifted: following the air pose, kept above the sand.
      this.airFoot(f, dt, len);
      f.pos.set(this.pelvis.x + f.airRel.x, this.pelvis.y + f.airRel.y, this.pelvis.z + f.airRel.z);
      const g = this.ground.height(f.pos.x, f.pos.z);
      if (f.pos.y < g + 0.05) { f.pos.y = g + 0.05; f.airRel.y = f.pos.y - this.pelvis.y; }
      f.up.copy(UP); f.yaw = this.heading + f.side * v.toeOut * D2R; f.pitch = 0.3; f.toe = 0.25;
      this.toesClear(f, 0.5);
      f.u = Math.min(0.3, f.u + dt * 2);
      f.groundY = g;
    }
    this.pose();
    if (st.t >= st.T) { if (this.v.boundGallop >= 0.5) this.boundLaunch(); else this.runFromStance(); }
  }

  // ---- The dash as footwork (Keith 2026-10-27; beats and curves in src/mech/dashSteps.ts) ----

  /**
   * The dash starts (its shove from outside, src/mech/dash.ts, gives the way; the steps move the body from here on and
   * the shove is ignored until it's gone): pick the kind, the push foot and the step foot, and the turn.
   */
  private dashBegin(x: number, z: number) {
    const v = this.v, l = Math.hypot(x, z) || 1, dx = x / l, dz = z / l;
    const yaw = Math.atan2(dx, dz);
    this.pushLatch = true; this.pushQuiet = 0;
    const mx = this.vel.x + this.skid.x, mz = this.vel.z + this.skid.z, ms = Math.hypot(mx, mz);
    const travel = ms > 1 ? Math.atan2(mx, mz) : this.heading;
    const kind = dashKind(wrap(yaw - travel), v);
    const [a, b] = this.feet;
    // The turn's side: toward the dash; straight back, so that the foot that's down is the outside one (it pushes).
    const rel = wrap(yaw - this.heading);
    let side = rel >= 0 ? 1 : -1;
    if (Math.abs(rel) > Math.PI * 0.9 && a.swinging !== b.swinging) side = -(a.swinging ? b : a).side;
    let I: Foot, O: Foot;
    if (kind === "burst") {
      // The foot further back along the dash pushes (the one that's down, if only one is).
      O = !a.swinging && b.swinging ? a : a.swinging && !b.swinging ? b : (a.pos.x - b.pos.x) * dx + (a.pos.z - b.pos.z) * dz < 0 ? a : b;
      I = O === a ? b : a;
    } else { I = a.side === side ? a : b; O = I === a ? b : a; }
    const turn = dashTurn(this.heading, yaw, side), B = dashBeats(kind, v);
    const carried = mx * dx + mz * dz;
    this.skid.set(0, 0, 0);
    this.dashMove = {
      t: 0, kind, dx, dz, yaw, side, I, O, B, h0: this.heading, turn, pre: kind === "burst" ? 0 : dashPreTurn(turn, v),
      carried, ax: mx - carried * dx, az: mz - carried * dz, slope: 0, covered: 0,
      iSw: null, oSw: null, iDown: false, oSet: !O.swinging, oUp: false,
    };
    for (const f of this.feet) { f.hang = false; f.short = false; f.bState = 0; }
    // Both in the air (a hurried step): the outside foot goes down where it is, to push.
    if (I.swinging && O.swinging) { this.plantFoot(O, O.pos.x, O.pos.z); this.dashMove.oSet = true; }
    // The outside foot trailing far behind (late in its stance): it steps in under its hip to push, not from back there.
    else if (!I.swinging && !O.swinging && O.stanceT > 0.7 && kind !== "burst") { this.dashMove.oSet = false; this.dashLift(O, true); }
    // The inside foot trailing: it lifts at once (it steps out toward the dash from wherever it is).
    else if (!I.swinging && !O.swinging && I.stanceT > 0.6) this.dashLift(I, true);
    // A foot already in the air carries on into its dash swing from where it is.
    if (I.swinging) this.dashLift(I, false);
    if (O.swinging) this.dashLift(O, false);
  }

  /** The legs can start a dash now (on the ground, not mid-dash, staggered or in a landing squat). */
  get canDash() { return !this.dashMove && !this.airborne && !this.squatState && this.stagger <= 0 && !this.bStance; }

  /**
   * Start a dash the way (x, z) points (src/mech/dash.ts keeps the charges); out of the sprint or a dash's short sprint
   * too. False if the legs can't now.
   */
  dash(x: number, z: number) {
    if (!this.canDash || x * x + z * z < 1e-6) return false;
    if (this.running) this.runEnd();
    this.burst = false; this.boostTo = 0;
    this.dashBegin(x, z);
    return true;
  }

  /** The body through the steps: the hips turn onto the dash, the speed comes round onto it, the lean and the crouch. */
  private dashSteer(dt: number) {
    const v = this.v, dm = this.dashMove!, B = dm.B;
    dm.t += dt;
    const t = dm.t;
    const h = wrap(dashYaw(t, dm.h0, dm.pre, dm.turn, B));
    this.turnSpeed = wrap(h - this.heading) / dt;
    this.heading = h;
    this.grade += (this.gradeAlong(dm.dx, dm.dz, 2) - this.grade) * Math.min(1, dt * 4);
    dm.slope -= G * this.grade * dt;
    dm.covered += this.speed * dt;
    const along = dashAlong(t, dm.carried, B, v) + dm.slope, k = dashAcross(t, B);
    const out = this.faceScrub(dm.dx * along + dm.ax * k, dm.dz * along + dm.az * k, Math.min(1, v.wallScrub * dt), false);
    this.vel.set(out.x, 0, out.z);
    this.speed = Math.hypot(out.x, out.z);
    this.pos.addScaledVector(this.vel, dt);
    // Lean into the dash (hips and shoulders, about the outside hip: orient), the rest of it forward as the hips come round.
    const lean = dashLeanK(t, B) * v.dashLeanSide * D2R, fw = forwardOf(h, this.t.f), lf = leftOf(h, this.t.l);
    this.dashRoll = -lean * (dm.dx * lf.x + dm.dz * lf.z);
    this.dashPitch = lean * 0.6 * Math.max(0, dm.dx * fw.x + dm.dz * fw.z);
    this.dashDipNow = dashDip(t, B, v);
  }

  /** Where the body will be in s seconds at its speed now. */
  private ahead(s: number, out: Vector3) { return out.copy(this.pos).addScaledVector(this.vel, Math.max(0, s)); }

  /** A foot starts its dash swing: the inside one to its step out toward the dash, the outside one to its set or through-step. */
  private dashLift(f: Foot, fromPlant: boolean) {
    const dm = this.dashMove!, B = dm.B, t = dm.t;
    if (fromPlant) this.onLiftOff?.(f, 1.3);
    f.swinging = true; f.u = 0; f.stanceT = 0;
    f.liftTheta = f.theta; f.liftPitch = f.pitch; f.liftToe = f.toe; f.liftUp.copy(f.up); f.liftYaw = f.yaw;
    const sw: DashSwing = { from: f.pos.clone(), to: new Vector3(), toYaw: 0, t0: t, t1: 0, lift: 0, under: false };
    if (f === dm.I) { sw.t1 = Math.max(t + 0.06, B.step); sw.lift = this.v.dashKnee; sw.under = true; dm.iSw = sw; }
    else if (!dm.oSet) { sw.t1 = Math.max(t + 0.05, B.load * 0.8); sw.lift = 0.15; dm.oSw = sw; }
    else { sw.t1 = Math.max(t + 0.08, B.through); sw.lift = this.v.dashThroughLift; dm.oSw = sw; }
    this.dashAim(f, sw);
  }

  /** The swing's landing spot, from where the body will be when it lands. */
  private dashAim(f: Foot, sw: DashSwing) {
    const v = this.v, dm = this.dashMove!, B = dm.B, spread = this.spread();
    const tl = sw.t1 - dm.t, hl = wrap(dashYaw(sw.t1, dm.h0, dm.pre, dm.turn, B));
    const at = this.ahead(tl, this.t.b);
    if (f === dm.I) {
      // Out toward the dash, a little to its own side.
      const lf = leftOf(hl, this.t.l);
      sw.to.set(at.x + dm.dx * v.dashStepOut + lf.x * f.side * spread * 0.6, 0, at.z + dm.dz * v.dashStepOut + lf.z * f.side * spread * 0.6);
      sw.toYaw = hl + f.side * v.toeOut * D2R;
    } else if (!dm.oSet) {
      // Set under the outside hip, a little wide, its length across the dash (a burst: along it, to push off the toes).
      const lf = leftOf(this.heading, this.t.l);
      sw.to.set(at.x + lf.x * f.side * (spread + 0.15), 0, at.z + lf.z * f.side * (spread + 0.15));
      sw.toYaw = this.pushYaw();
    } else {
      // Through in front along the dash, on its own side: the run's first stride.
      const lf = leftOf(dm.yaw, this.t.l);
      sw.to.set(at.x + dm.dx * v.runPlant + lf.x * f.side * spread, 0, at.z + dm.dz * v.runPlant + lf.z * f.side * spread);
      sw.toYaw = dm.yaw + f.side * v.toeOut * D2R;
    }
    sw.to.y = this.ground.height(sw.to.x, sw.to.z) - this.sink(sw.to.x, sw.to.z);
    // The body reads a swinging foot's landing spot (the run's reach cap): this one.
    f.target.copy(sw.to); this.groundAt(f.target, f.targetUp); f.targetYaw = sw.toYaw;
  }

  /** The push foot's yaw: its length across the dash (Keith 2026-10-27: the whole foot's traction sideways), nearest the legs'. */
  private pushYaw() {
    const dm = this.dashMove!;
    if (dm.kind === "burst") return this.heading;
    const a = dm.yaw - Math.PI / 2, b = dm.yaw + Math.PI / 2;
    return Math.abs(wrap(a - this.heading)) < Math.abs(wrap(b - this.heading)) ? a : b;
  }

  /** One step of the dash's feet: each down, lifting, swinging or planting on its beat; then the hand-over. */
  private dashFeet(dt: number) {
    const v = this.v, dm = this.dashMove!, B = dm.B, t = dm.t, { I, O } = dm;
    // The beats give way to the legs: a planted leg at full stretch can't push any longer (moving fast, the body passes
    // its foot before the beat comes), so the next foot comes down now, or the stretched one lifts if the other is down.
    if (!O.swinging && !dm.oUp && this.legStretch(O) > 0.95) {
      if (dm.iDown) { dm.oUp = true; this.dashLift(O, true); }
      else if (dm.iSw) dm.iSw.t1 = Math.min(dm.iSw.t1, t + 0.03);
    }
    if (dm.iDown && !I.swinging && dm.oSw && dm.oSet && this.legStretch(I) > 0.95) {
      // The turn onto the dash finishes with the through-step, whenever it comes.
      dm.oSw.t1 = Math.min(dm.oSw.t1, t + 0.04);
      dm.B.through = Math.min(dm.B.through, dm.oSw.t1);
    }
    // Inside foot: down through the load (if it was), lifts as the push starts, plants out toward the dash.
    if (!I.swinging && !dm.iDown && dm.oSet && t >= B.load * 0.7) this.dashLift(I, true);
    if (I.swinging && dm.iSw) {
      if (this.dashSwing(I, dm.iSw)) {
        this.plantFoot(I, dm.iSw.to.x, dm.iSw.to.z); I.plantedYaw = I.yaw = dm.iSw.toYaw;
        dm.iSw = null; dm.iDown = true; this.stats.steps++;
        this.impact.v -= v.impact * 0.3;
        this.onFootfall?.(I, 1.3 * v.dashStomp);
      }
    } else if (!I.swinging) {
      I.stanceT = dm.iDown ? 0.75 * smooth(B.step, B.through, t) : 0.05;
      this.moveFoot(I);
    }
    // Outside foot: set down if it was in the air, pivots its length across the dash, pushes (onto its edge, then the
    // ball and toes), lifts after the inside plant and comes through.
    if (O.swinging && dm.oSw) {
      if (this.dashSwing(O, dm.oSw)) {
        this.plantFoot(O, dm.oSw.to.x, dm.oSw.to.z); O.plantedYaw = O.yaw = dm.oSw.toYaw;
        dm.oSw = null; this.stats.steps++;
        if (!dm.oSet) { dm.oSet = true; this.onFootfall?.(O, 1); }
        else { this.onFootfall?.(O, 1.4 * v.dashStomp); this.dashHandOver(); return; }
      }
    } else if (!O.swinging) {
      if (!dm.oUp) {
        if (t < B.load) O.plantedYaw += wrap(this.pushYaw() - O.plantedYaw) * Math.min(1, dt * 10) * 0.5;
        O.stanceT = 0.3 + 0.7 * smooth(B.load, B.lift, t);
        this.moveFoot(O);
        this.edgeRoll(O, dashEdgeK(t, B) * v.dashEdge * D2R);
        if (t >= B.lift && dm.iDown) { dm.oUp = true; this.dashLift(O, true); }
      } else this.moveFoot(O);
    }
    // No splits: a swinging foot never further than dashSpreadMax from the other, nor out of the leg's reach.
    const lf = leftOf(this.heading, this.t.l), hipY = this.bodyY.x, R = v.legReachMax * (v.femur + v.shin + v.cannon);
    for (const f of this.feet) {
      if (!f.swinging) continue;
      const o = f === O ? I : O;
      const ox = f.pos.x - o.pos.x, oz = f.pos.z - o.pos.z, od = Math.hypot(ox, oz);
      if (od > v.dashSpreadMax) { f.pos.x = o.pos.x + (ox / od) * v.dashSpreadMax; f.pos.z = o.pos.z + (oz / od) * v.dashSpreadMax; }
      const jx = this.pos.x + lf.x * f.side * v.hipWidth, jz = this.pos.z + lf.z * f.side * v.hipWidth;
      const rx = f.pos.x - jx, ry = f.pos.y + v.ankleHeight - hipY, rz = f.pos.z - jz, rd = Math.hypot(rx, ry, rz);
      if (rd > R) { const s = R / rd; f.pos.set(jx + rx * s, hipY + ry * s - v.ankleHeight, jz + rz * s); }
      f.pos.y = Math.max(f.pos.y, this.ground.height(f.pos.x, f.pos.z) - this.sink(f.pos.x, f.pos.z) * f.u);
    }
    if (t > 2) this.dashHandOver();
  }

  /**
   * A dash swing for this frame; true when it lands. The inside foot rises under its hip first (the knee up, ready to
   * push down), then reaches out; the others go straight to their spot in an arc. Re-aimed until late.
   */
  private dashSwing(f: Foot, sw: DashSwing) {
    const v = this.v, dm = this.dashMove!;
    const k = clamp((dm.t - sw.t0) / Math.max(0.02, sw.t1 - sw.t0), 0, 1);
    if (k < 0.75) this.dashAim(f, sw);
    const e = smooth(0, 1, k);
    if (sw.under) {
      const lf = leftOf(this.heading, this.t.l);
      const ux = this.pos.x + lf.x * f.side * v.hipWidth, uz = this.pos.z + lf.z * f.side * v.hipWidth;
      const a = smooth(0, 0.45, k), b = smooth(0.4, 1, k);
      const mx = sw.from.x + (ux - sw.from.x) * a, mz = sw.from.z + (uz - sw.from.z) * a;
      f.pos.set(mx + (sw.to.x - mx) * b, 0, mz + (sw.to.z - mz) * b);
    } else f.pos.set(sw.from.x + (sw.to.x - sw.from.x) * e, 0, sw.from.z + (sw.to.z - sw.from.z) * e);
    const g = this.ground.height(f.pos.x, f.pos.z), base = sw.from.y + (sw.to.y - sw.from.y) * e;
    const rise = sw.under ? Math.pow(Math.sin(Math.PI * k), 0.6) : Math.sin(Math.PI * k);
    f.pos.y = Math.max(base + sw.lift * rise, g + v.footClear * rise - this.sink(f.pos.x, f.pos.z) * (1 - rise));
    f.u = k; f.stanceT = 0; f.groundY = g;
    f.up.copy(f.liftUp).lerp(UP, smooth(0, 0.4, k)).normalize();
    f.yaw = f.liftYaw + wrap(sw.toYaw - f.liftYaw) * e;
    const env = Math.sin(Math.PI * Math.min(1, k / 0.85)) * (1 - smooth(0.85, 1, k));
    f.pitch = f.liftPitch * (1 - smooth(0, 0.45, k)) + v.swingCurl * D2R * env;
    f.toe = f.liftToe * (1 - smooth(0, 0.3, k)) + v.toeCurl * D2R * env;
    // The cannon folds up as the leg comes through (blended in by the run share once the run's pose comes in).
    const rake = v.cannonRake * D2R;
    f.runTheta = f.liftTheta + (rake - f.liftTheta) * smooth(0, 0.5, k) + (v.swingTuck + v.runHockFold * 0.5) * D2R * env;
    return k >= 1;
  }

  /** Roll a planted foot onto its edge toward the dash by ang (radians): its up tips that way, pivoting on that edge. */
  private edgeRoll(f: Foot, ang: number) {
    if (ang <= 1e-4) return;
    const dm = this.dashMove!, fw = this.plateForward(f.up, f.yaw, this.t.f);
    const lf = this.t.a.crossVectors(f.up, fw).normalize();
    const toward = lf.x * dm.dx + lf.z * dm.dz >= 0 ? 1 : -1; // +1: the foot's left is toward the dash
    const edge = this.t.b.copy(f.pos).addScaledVector(lf, toward * 0.22);
    const axis = this.t.n3.copy(fw).multiplyScalar(-toward);
    f.pos.sub(edge).applyAxisAngle(axis, ang).add(edge);
    f.up.applyAxisAngle(axis, ang);
  }

  /** Put a foot down at (x, z) on the ground, flat, facing the way the legs do. */
  private plantFoot(f: Foot, x: number, z: number) {
    f.planted.set(x, 0, z);
    this.groundAt(f.planted, f.plantedUp);
    f.plantedYaw = this.heading + f.side * this.v.toeOut * D2R;
    f.pos.copy(f.planted); f.up.copy(f.plantedUp); f.yaw = f.plantedYaw;
    f.swinging = false; f.u = 0; f.hang = false; f.short = false; f.bState = 0;
    f.groundY = f.planted.y;
  }

  /**
   * The through-step is down: the run takes over along the dash. Held, the sprint; let go, a short sprint (dashBurst,
   * rolling off at dashRolloff) and then the walk. The outside foot has just planted; the inside one is late in its stance.
   */
  private dashHandOver() {
    const v = this.v, dm = this.dashMove!;
    this.dashMove = null;
    const s = Math.hypot(this.vel.x, this.vel.z);
    if (!this.bound && v.dashRun <= 0) {
      // Straight back to the walk with the speed the legs walk with; the rest skids off.
      for (const f of this.feet) if (f.swinging) this.plantFoot(f, f.pos.x, f.pos.z);
      const fw = forwardOf(this.heading, this.t.f);
      this.speed = clamp(this.vel.x * fw.x + this.vel.z * fw.z, 0, Math.max(v.walkSpeed, v.sprintSpeed));
      this.skid.set(this.vel.x - fw.x * this.speed, 0, this.vel.z - fw.z * this.speed);
      this.vel.copy(fw).multiplyScalar(this.speed);
      this.walkPhaseFromFeet(fw);
      return;
    }
    this.burst = !this.bound;
    this.boundSpeed = clamp(s, Math.min(s, v.walkSpeed), Math.max(v.sprintSpeed, v.dashIntoRun));
    // The boost: up to the peak from this footfall; let go, held there until the whole dash has covered about dashRun with
    // the boost and the roll-off down to the walk's pace.
    const peak = this.boostTo = Math.min(v.dashSpeedOut, Math.max(v.sprintSpeed, v.dashIntoRun));
    const boostRun = Math.max(0, peak * peak - this.boundSpeed * this.boundSpeed) / (2 * Math.max(1, v.dashBoostAccel));
    const rollRun = Math.max(0, peak * peak - v.walkSpeed * v.walkSpeed) / (2 * Math.max(0.5, v.dashRolloff));
    this.burstHold = Math.max(0, v.dashRun - dm.covered - boostRun - rollRun);
    this.course = wrap(this.heading + clamp(wrap(dm.yaw - this.heading), -v.boundDriftMax * D2R, v.boundDriftMax * D2R));
    this.skid.set(0, 0, 0);
    this.running = true;
    this.speed = this.boundSpeed;
    this.vel.set(Math.sin(this.course) * this.boundSpeed, 0, Math.cos(this.course) * this.boundSpeed);
    const cps = (v.runSteps + (v.runStepsTop - v.runSteps) * this.speedShare()) / 2;
    this.cpsNow = cps;
    const d = this.dutyNow = clamp((v.boundStanceLen * cps) / Math.max(1, this.speed), 0.2, 0.5);
    const { O, I } = dm;
    if (O.swinging) this.plantFoot(O, O.pos.x, O.pos.z);
    this.phase = (0.05 * d - O.offset + 2) % 1;
    O.stanceT = 0.05;
    const pI = (this.phase + I.offset) % 1;
    if (pI >= d) {
      if (!I.swinging) this.onLiftOff?.(I, 1.2);
      this.beginSwing(I);
      I.u = clamp((pI - d) / (1 - d), 0, 0.95);
      I.entryU = I.u;
      I.entryRel.copy(I.runA);
      this.aim(I);
    } else if (I.swinging) this.plantFoot(I, I.pos.x, I.pos.z);
    else I.stanceT = pI / d;
    this.prevYT = NaN; this.reachCap = NaN;
  }

  /**
   * A landing stance is over (a crest jump, a fall while sprinting): instead of the gallop's next leap, run on. The foot
   * still down is at its push-off; the one already lifted is coming through.
   */
  private runFromStance() {
    const st = this.bStance!;
    this.bStance = null;
    const v = this.v;
    this.speed = this.boundSpeed;
    this.vel.set(Math.sin(this.course) * this.boundSpeed, 0, Math.cos(this.course) * this.boundSpeed);
    const cps = (v.runSteps + (v.runStepsTop - v.runSteps) * this.speedShare()) / 2;
    this.cpsNow = cps;
    this.dutyNow = clamp((v.boundStanceLen * cps) / Math.max(1, this.speed), 0.2, 0.5);
    const d = this.dutyNow;
    const first = st.first, other = this.feet.find((f) => f !== first)!;
    // The foot still down lifts next step; the other is half a cycle on, in its swing.
    this.phase = (d - 0.001 - other.offset + 2) % 1;
    for (const f of this.feet) f.bState = 0;
    other.swinging = false; other.u = 0; other.stanceT = 1;
    if (!first.swinging) { first.planted.copy(first.pos); this.groundAt(first.planted, first.plantedUp); }
    else {
      // Joining the run's swing part way through: from where the foot is, eased onto the run's path.
      this.beginSwing(first);
      first.u = clamp(((this.phase + first.offset) % 1 - d) / (1 - d), 0, 0.95);
      first.entryU = first.u;
      first.entryRel.copy(first.runA);
      this.aim(first);
    }
    this.running = true;
    this.prevYT = NaN; this.reachCap = NaN;
  }

  /** Let go mid-stance: plant what's in the air, hand the speed to the run (up to the run's), skid the rest. */
  private endBound() {
    const v = this.v;
    this.bStance = null;
    for (const f of this.feet) {
      if (f.bState !== 0) { f.planted.copy(f.pos); this.groundAt(f.planted, f.plantedUp); f.pos.copy(f.planted); f.plantedYaw = this.heading + f.side * v.toeOut * D2R; f.yaw = f.plantedYaw; }
      f.bState = 0; f.swinging = false; f.u = 0; f.stanceT = 0;
    }
    const fw = forwardOf(this.heading, this.t.f);
    const vx = Math.sin(this.course) * this.boundSpeed, vz = Math.cos(this.course) * this.boundSpeed;
    this.speed = clamp(vx * fw.x + vz * fw.z, 0, Math.max(v.walkSpeed, v.sprintSpeed));
    this.vel.copy(fw).multiplyScalar(this.speed);
    this.skid.set(vx - this.vel.x, 0, vz - this.vel.z);
    // The foot behind steps first (if it's past its push-off), the front one carries on from where it stands.
    this.walkPhaseFromFeet(fw);
    this.bodyY.x = this.pelvis.y - this.impact.x; this.bodyY.v = 0;
    this.boundSpeed = 0;
    this.running = false;
  }

  /**
   * The body's orientation from its pitch and roll springs: the pelvis turned to `pelvisYaw`, the hull to the heading
   * and kept level by shoulderLevel; both rolled into a sprint's turn (turnRoll), and the hips moved a share of the way
   * toward the inside of it (turnLeanShift), as if the body leaned over its feet.
   */
  private orient(pelvisYaw: number) {
    const v = this.v, tr = this.turnRoll + this.dashRoll;
    const pitch = this.pitch.x + this.plantPitch;
    this.pelvisQ.setFromEuler(this.t.e.set(pitch, pelvisYaw, this.roll.x + tr, "YXZ"));
    this.hullQ.setFromEuler(this.t.e.set(pitch, this.heading, this.roll.x * (1 - v.shoulderLevel) + tr, "YXZ"));
    if (tr !== 0) {
      // Rolled about the outside hip, so the outside leg reaches no further than upright and the inside one folds.
      const H = v.hipHeight * v.turnLeanShift, l = leftOf(this.heading, this.t.l);
      this.pelvis.addScaledVector(l, -Math.sin(tr) * H);
      this.pelvis.y -= H * (1 - Math.cos(tr)) + v.hipWidth * Math.abs(Math.sin(tr));
    }
  }

  /**
   * The lean into a sprint's turn (Keith 2026-10-26 21:54): the true lean for the lateral acceleration (speed × the line
   * of run's turn rate) × turnRoll, capped at turnRollMax, eased in and out at turnRollEase. Nothing outside the sprint.
   */
  private turnLean(dt: number) {
    const v = this.v;
    const sprinting = this.bound && (this.running || this.bStance !== null || (this.airborne && this.bLeap));
    const dc = Number.isFinite(this.lastCourse) ? wrap(this.course - this.lastCourse) : 0;
    this.lastCourse = this.course;
    // A jump in the line (the start of a run off a dash) isn't a turn.
    if (sprinting && Math.abs(dc) < 0.15) this.courseRate += (dc / dt - this.courseRate) * Math.min(1, dt * 12);
    else this.courseRate *= Math.max(0, 1 - dt * 12);
    const max = v.turnRollMax * D2R;
    const want = sprinting ? -clamp(Math.atan((this.boundSpeed * this.courseRate) / G) * v.turnRoll, -max, max) : 0;
    this.turnRoll += (want - this.turnRoll) * Math.min(1, dt * v.turnRollEase);
    this.turnRoll = clamp(this.turnRoll, -max, max);
  }

  /** How close one leg is to full reach, read at the hips' wanted height off the run (as stretch()). */
  private legStretch(f: Foot) {
    const reach = this.v.femur + this.v.shin + this.v.cannon * 0.8, P = f.pose, up = this.running ? 0 : this.hipShort;
    const dx = P.hip.x - P.ankle.x, dy = P.hip.y + up - P.ankle.y, dz = P.hip.z - P.ankle.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) / reach;
  }

  /** How close the most stretched planted leg is to full reach (1 = straight). */
  private stretch() {
    const reach = this.v.femur + this.v.shin + this.v.cannon * 0.8;
    // Off the run, read at the hips' wanted height (Keith 2026-10-27, the splits letting go of the sprint): hips dragged
    // down after a trailing foot give it more reach, so the stretch never showed, the step never hurried, and the foot
    // trailed further. The run holds its hips low on purpose (its reach cap), so it reads them where they are.
    const up = this.running ? 0 : this.hipShort;
    let m = 0;
    for (const f of this.feet) if (!f.swinging) {
      const P = f.pose, dx = P.hip.x - P.ankle.x, dy = P.hip.y + up - P.ankle.y, dz = P.hip.z - P.ankle.z;
      m = Math.max(m, Math.sqrt(dx * dx + dy * dy + dz * dz) / reach);
    }
    return m;
  }

  /**
   * The idle flex (Keith 2026-10-26): with a pilot in (cmd.idle) and standing still a while, start a few slow steps on
   * the spot; any move, the sprint or a landing squat stops it and restarts the wait. Waits are seeded (rule 12).
   */
  private idleTick(dt: number, cmd: MoveCommand) {
    const v = this.v;
    const moving = cmd.x * cmd.x + cmd.z * cmd.z > 1e-4 || cmd.sprint || this.speed >= 0.08 || this.runK > 0;
    if (Number.isNaN(this.idleNext)) this.idleNext = this.idleWait(v.idleAfter);
    if (!cmd.idle || moving || this.squatState) { this.idleLeft = 0; this.stillT = 0; this.idleNext = this.idleWait(v.idleAfter); }
    else if (this.idleLeft <= 0 && !this.feet[0].swinging && !this.feet[1].swinging) {
      this.stillT += dt;
      if (this.stillT >= this.idleNext) {
        this.idleLeft = Math.max(1, Math.round(v.idleSteps));
        this.stillT = 0;
        this.idleNext = this.idleWait(v.idleEvery);
        // Either foot first: its swing starts now.
        const f = this.feet[this.idleRand() < 0.5 ? 0 : 1];
        this.phase = (this.dutyNow - f.offset + 1.0001) % 1;
      }
    }
    this.idleK += clamp((this.idleLeft > 0 ? 1 : 0) - this.idleK, -4 * dt, 4 * dt);
  }

  private idleWait(t: number) { return t * (1 + this.v.idleJitter * (2 * this.idleRand() - 1)); }

  /** Seeded 0..1 (mulberry32), for the idle's waits. */
  private idleRand() {
    let t = (this.idleSeed = (this.idleSeed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standing still with a foot out of place (after a turn or a stop): step it back under the body. */
  private settle(d: number) {
    const l = leftOf(this.heading, this.t.l);
    let worst: Foot | null = null, worstD = 0.45;
    for (const f of this.feet) {
      const rx = this.pos.x + l.x * f.side * this.v.footSpread, rz = this.pos.z + l.z * f.side * this.v.footSpread;
      const off = Math.hypot(f.planted.x - rx, f.planted.z - rz) + Math.abs(wrap(f.plantedYaw - this.heading - f.side * this.v.toeOut * D2R)) * 0.8;
      if (off > worstD) { worstD = off; worst = f; }
    }
    if (worst) this.phase = (d - worst.offset + 1.0001) % 1;
  }

  private liftOff(f: Foot) {
    if (this.idleLeft > 0) this.idleLeft--;
    this.beginSwing(f);
    this.onLiftOff?.(f, clamp(this.speed / Math.max(0.1, this.v.walkSpeed), 0, 2));
  }

  private beginSwing(f: Foot) {
    f.entryU = -1;
    f.short = false;
    f.hang = false;
    f.swinging = true;
    f.u = 0;
    f.lift.copy(f.pos);
    f.liftYaw = f.yaw;
    f.liftPitch = f.pitch;
    f.liftToe = f.toe;
    f.liftUp.copy(f.plantedUp);
    f.liftTheta = f.theta;
    // Where it leaves from relative to the body, for the run's swing path (along the heading, up from the hips, left).
    const fw = forwardOf(this.heading, this.t.f), lf = leftOf(this.heading, this.t.l);
    const rx = f.pos.x - this.pos.x, rz = f.pos.z - this.pos.z;
    f.runA.set(rx * fw.x + rz * fw.z, f.pos.y - this.bodyY.x, rx * lf.x + rz * lf.z);
    this.aim(f);
  }

  private land(f: Foot) {
    f.swinging = false;
    f.u = 0;
    f.planted.copy(f.target);
    f.plantedUp.copy(f.targetUp);
    f.plantedYaw = f.targetYaw;
    this.stats.steps++;
    const k = clamp(0.5 + this.speed / Math.max(0.1, this.v.walkSpeed) * 0.5, 0.4, 1.6) * (1 + this.v.stomp * 0.5) * (this.burst || this.boostTo > 0 ? this.v.dashStomp : 1);
    // Running, the footfalls come quickly and the body rides over them: only a share of the walk's thud.
    this.impact.v -= this.v.impact * 0.25 * k * (1 - this.runK * (1 - this.v.runThud));
    this.onFootfall?.(f, k);
  }

  /** Landing spot: where this foot belongs when the body gets there, on the ground. */
  private aim(f: Foot) {
    const v = this.v, d = this.dutyNow, S = this.stride();
    const cps = Math.max(this.speed / S + (this.cpsNow - this.speed / S) * this.gaitK, MIN_CYCLE);
    const remain = ((1 - f.u) * (1 - d)) / cps;
    const h = this.heading + this.turnSpeed * remain * 0.5;
    const fw = forwardOf(h, this.t.f), lf = leftOf(h, this.t.l);
    // Downhill the feet plant in closer under the body, so the legs don't reach out ahead and tiptoe down. Running they
    // land under the hips (runPlant).
    let ahead = d * S * (0.5 - v.stanceBack) * smooth(0, 0.6, this.speed);
    ahead += (v.runPlant - ahead) * this.gaitK;
    ahead *= 1 - v.downhillPlant * smooth(0, 0.35, -this.grade);
    f.target.copy(this.pos).addScaledVector(this.vel, remain).addScaledVector(fw, ahead).addScaledVector(lf, f.side * this.spread());
    this.groundAt(f.target, f.targetUp);
    f.targetYaw = h + f.side * v.toeOut * D2R;
    // Downhill past the leg's reach (Keith 2026-10-26 18:28: no yanking the legs to the ground): the foot reaches as far
    // as the longest leg goes, with the hips as low as the other planted leg lets them sink, and hangs there.
    const R = v.legReachMax * (v.femur + v.shin + v.cannon);
    let hipLow = this.bodyY.x;
    for (const o of this.feet) if (o !== f && !o.swinging) hipLow = Math.min(hipLow, o.planted.y + v.hipHeight * 0.6);
    // Running, the hips come down to their running height over the landing spot (the reach cap in body()): a run down a
    // slope lands its feet instead of hanging them in the flight and dropping (Keith 21:54: the run hopped downhill).
    if (this.gaitK > 0.5) hipLow = Math.min(hipLow, f.target.y + this.boundStand());
    const hx = this.pos.x + this.vel.x * remain + lf.x * f.side * v.hipWidth - f.target.x;
    const hz = this.pos.z + this.vel.z * remain + lf.z * f.side * v.hipWidth - f.target.z;
    const lowest = hipLow - Math.sqrt(Math.max(0, R * R - hx * hx - hz * hz)) - v.ankleHeight;
    f.short = f.target.y < lowest - 0.05;
    if (f.short) { f.target.y = lowest; f.targetUp.copy(UP); }
  }

  /** How far the legs are sprinting for the walk-or-sprint limits: all the way while Space holds the sprint, else the run share. */
  private get sprintK() { return this.bound ? 1 : this.runK; }
  /**
   * The run's share of the step timing (cadence, planted share, where feet land): off the moment the run ends, while the
   * pose blends back over runBlend (Keith 2026-10-27: timed like the run after letting go, the steps trailed and the
   * hips dropped into the splits).
   */
  private get gaitK() { return this.running ? this.runK : 0; }

  /**
   * Running, a planted leg at full stretch keeps its push-off look (the long straight leg, Keith 2026-10-27: main's
   * sprint shape) but is never pulled past its length: its toes drag on with the body instead (his 4 m stance at the
   * sprint's speeds stretched the cannon up to half a metre at every push-off, the reach misses; landing stances on dune
   * crests up to a metre and a half).
   */
  private toeDrag(f: Foot, dt: number) {
    const v = this.v, full = v.femur + v.shin + v.cannon - 0.04, P = f.pose;
    const hx = P.hip.x + this.vel.x * dt - P.ankle.x, hy = P.hip.y - P.ankle.y, hz = P.hip.z + this.vel.z * dt - P.ankle.z;
    const hd = Math.hypot(hx, hz);
    if (Math.hypot(hx, hy, hz) <= full || hd < 0.05) return;
    // The horizontal shift that brings the ankle back within full length (the height difference stays, as far as it can).
    const want = Math.sqrt(Math.max(0, full * full - hy * hy)), k = (hd - want) / hd;
    f.planted.x += hx * k; f.planted.z += hz * k;
    f.planted.y = this.ground.height(f.planted.x, f.planted.z) - this.sink(f.planted.x, f.planted.z);
    this.stats.toeDrag++;
  }

  /** The sink depth at (x, z) (0 without a sinkAt). */
  sink(x: number, z: number) { return this.sinkAt ? Math.max(0, this.sinkAt(x, z)) : 0; }

  /** Put p on the ground (a planted foot's depth into it) and write the tilt-limited ground normal into up. */
  private groundAt(p: Vector3, up: Vector3) {
    p.y = this.ground.height(p.x, p.z) - this.sink(p.x, p.z);
    const n = this.ground.normal(p.x, p.z, this.t.n);
    up.set(n[0], n[1], n[2]);
    const ang = Math.acos(clamp(up.y, -1, 1)), max = this.v.footTiltMax * D2R;
    if (ang > max && ang > 1e-4) {
      // Rotate partway from straight up toward the normal.
      const axis = this.t.a.crossVectors(UP, up).normalize();
      up.copy(UP).applyAxisAngle(axis, max);
    }
  }

  private moveFoot(f: Foot) {
    const v = this.v;
    if (!f.swinging) {
      // Planted; late in the stance the heel lifts and the foot rolls up over the ball of the foot, while the toes
      // stay flat on the ground and push (Keith 2026-10-24: push off from the toes).
      // Running, the heel rolls earlier and further: the toes push longer.
      const rk = this.runK;
      // The idle flex blends in its own heel lift (idleK).
      const ik = this.idleK;
      const rollDeg = v.rollOff + (v.runRollOff - v.rollOff) * rk, rollAt = v.rollStart + (v.runRollStart - v.rollStart) * rk;
      const roll = (rollDeg + (v.idleRoll - rollDeg) * ik) * D2R * smooth(rollAt + (v.idleRollStart - rollAt) * ik, 1, f.stanceT);
      f.up.copy(f.plantedUp);
      f.yaw = f.plantedYaw;
      f.pitch = roll;
      f.toe = -roll;
      f.pos.copy(f.planted);
      if (roll > 0) {
        // Pivot the plate centre about the toe hinge.
        const fw = this.plateForward(f.plantedUp, f.plantedYaw, this.t.f);
        const hinge = this.t.b.copy(f.planted).addScaledVector(fw, v.toeHinge);
        const axis = this.t.a.crossVectors(f.plantedUp, fw).normalize(); // points to the foot's left
        f.pos.sub(hinge).applyAxisAngle(axis, roll).add(hinge);
      }
      f.groundY = f.planted.y;
      // A rigid plate on curved ground: its toes bend up rather than into the ground (no deeper than the foot sinks).
      this.toesClear(f, 0, false);
      return;
    }

    const u = f.u;
    // The idle flex (idleK): no stomp and no hold, its own lift, clearance, ease and curls.
    const ik = this.idleK, mixI = (a: number, b: number) => a + (b - a) * ik;
    const stompT = v.stompShare * v.stomp * (1 - ik);
    // Uphill the foot goes forward early instead of rising straight up under the hips first: with the long thigh over
    // a short shin the knee can only come up toward the hull once the foot is out ahead (Keith 2026-10-26 18:28).
    const upK = smooth(0, 0.3, this.grade) * v.uphillLead;
    const hold = v.liftHold * (1 - upK) * (1 - ik);
    const travel = clamp((u - hold) / Math.max(0.05, 1 - hold - stompT), 0, 1);
    const pw = 1 + 2 * mixI(v.liftBox, v.idleEase) * (1 - upK);
    let e = travel < 0.5 ? 0.5 * Math.pow(2 * travel, pw) : 1 - 0.5 * Math.pow(2 - 2 * travel, pw);
    if (upK > 0) e = 1 - Math.pow(1 - e, 1 + 2 * upK);

    f.pos.lerpVectors(f.lift, f.target, e);
    const baseY = f.lift.y + (f.target.y - f.lift.y) * e;
    // Rises quickly, holds a flat top, then drops: straight down through the stomp.
    const up = smooth(0, Math.max(0.08, hold + 0.12), u);
    const down = stompT > 0 ? 1 - Math.pow(clamp((u - (1 - stompT)) / stompT, 0, 1), 2) : 1 - smooth(0.7, 1, u);
    const liftK = Math.min(up, down);
    let y = baseY + mixI(v.liftHeight, v.idleLift) * liftK;
    // Clear the ground under the foot (stepping up a dune face).
    const g = this.ground.height(f.pos.x, f.pos.z);
    const gToe = this.ground.height(f.pos.x + Math.sin(f.yaw) * v.toeLength, f.pos.z + Math.cos(f.yaw) * v.toeLength);
    const sk = this.sink(f.pos.x, f.pos.z);
    y = Math.max(y, Math.max(g, gToe) + mixI(v.footClear, v.idleClear) * liftK - sk * (1 - liftK));
    f.pos.y = y;
    if (y < g - sk - 0.02) this.stats.scuffs++;

    f.up.copy(f.liftUp).lerp(f.targetUp, e).normalize();
    f.yaw = f.liftYaw + wrap(f.targetYaw - f.liftYaw) * e;
    const swingEnv = Math.sin(Math.PI * Math.min(1, u / Math.max(0.3, 1 - stompT))) * (1 - smooth(1 - stompT, 1, u));
    f.pitch = f.liftPitch * (1 - smooth(0, 0.45, u)) + mixI(v.swingCurl, v.idleCurl) * D2R * swingEnv;
    // Toes: still bent up from the push-off as the foot leaves, curling under as the leg is pulled through, then
    // opening flat before the stomp.
    f.toe = f.liftToe * (1 - smooth(0, 0.3, u)) + mixI(v.toeCurl, v.idleToes) * D2R * swingEnv;
    f.groundY = baseY;
    // The run's swing, blended in by the run share.
    if (this.runK > 0) {
      const o = this.runSwing(f, this.t.b), rk = this.runK;
      f.pos.lerp(this.t.b, rk);
      f.pitch += (o.pitch - f.pitch) * rk;
      f.toe += (o.toe - f.toe) * rk;
    }
    // Joined part way through: ease from where it was (riding with the body) onto the path.
    if (f.entryU >= 0) {
      const w = smooth(f.entryU, Math.min(1, f.entryU + 0.2), u);
      const fw = forwardOf(this.heading, this.t.f), lf = leftOf(this.heading, this.t.l), e = f.entryRel;
      const ex = this.pos.x + fw.x * e.x + lf.x * e.z, ez = this.pos.z + fw.z * e.x + lf.z * e.z;
      const ey = Math.max(this.bodyY.x + e.y, this.ground.height(ex, ez));
      f.pos.set(ex + (f.pos.x - ex) * w, ey + (f.pos.y - ey) * w, ez + (f.pos.z - ez) * w);
      if (w >= 1) f.entryU = -1;
    }
    // Walking (Keith 2026-10-27: the walk looked bad with the foot flattened), only the toe tips are kept out of the sand,
    // just touching it; the sprint also eases the foot's pitch and keeps both clear by toeClear.
    this.toesClear(f, Math.sin(Math.PI * clamp(f.u, 0, 1)), this.sprintK > 0, this.sprintK);
  }

  /**
   * A swinging foot's toes never dig into the ground (Keith 2026-10-26: toes skimming the sand; leaving the push-off
   * pitched toes-down, the toes uncurled and curled under faster than the foot rose, up to 0.37 m into flat sand):
   * the pitch eases off so the ball of the foot clears, and the toes stay bent up as if still pushing.
   */
  private toesClear(f: Foot, env = Math.sin(Math.PI * clamp(f.u, 0, 1)), pitchToo = true, clearK = 1) {
    // env: 1 mid-swing (clear by toeClear) .. 0 planted (the toes may be in the sand as deep as the foot sinks).
    // clearK scales the margin over the ground (0: the tips just touch it).
    const v = this.v, m = (0.02 + v.toeClear) * env * clearK - this.sink(f.pos.x, f.pos.z) * (1 - env);
    const h = v.toeHinge, L = Math.max(0.01, v.toeLength - v.toeHinge);
    // On the plate's own frame (as pose() builds it): forward along its yaw over its up; pitch turns the toes down.
    const up = f.up, fw = this.plateForward(up, f.yaw, this.t.f);
    // Height over the ground of a point d along the plate pitched by a (from the plate centre, or from the ball).
    const over = (ox: number, oy: number, oz: number, a: number, d: number, out: number[]) => {
      const c = Math.cos(a), sn = Math.sin(a);
      out[0] = ox + (fw.x * c - up.x * sn) * d; out[1] = oy + (fw.y * c - up.y * sn) * d; out[2] = oz + (fw.z * c - up.z * sn) * d;
      return out[1] - this.ground.height(out[0], out[2]) - m;
    };
    const P = this.t.n, Q = [0, 0, 0];
    // The ball of the foot: ease the toes-down pitch until it clears.
    if (pitchToo && h > 0 && over(f.pos.x, f.pos.y, f.pos.z, f.pitch, h, P) < 0) {
      let lo = Math.min(f.pitch, 0) - 0.8, hi = f.pitch;
      if (over(f.pos.x, f.pos.y, f.pos.z, lo, h, P) >= 0) {
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (over(f.pos.x, f.pos.y, f.pos.z, mid, h, P) >= 0) lo = mid; else hi = mid; }
        f.pitch = lo;
      }
    }
    over(f.pos.x, f.pos.y, f.pos.z, f.pitch, h, P);
    // The toe tips: bend the toes up until they clear.
    const hx = P[0], hy = P[1], hz = P[2];
    if (over(hx, hy, hz, f.pitch + f.toe, L, Q) < 0) {
      let lo = Math.min(f.pitch + f.toe, 0) - 1.2, hi = f.pitch + f.toe;
      if (over(hx, hy, hz, lo, L, Q) >= 0) {
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (over(hx, hy, hz, mid, L, Q) >= 0) lo = mid; else hi = mid; }
        f.toe = lo - f.pitch;
      }
    }
  }

  private body(dt: number, d: number) {
    const v = this.v;
    const [a, b] = this.feet;
    const avg = (a.groundY + b.groundY) / 2, low = Math.min(a.groundY, b.groundY);
    // Walking, the ground under the body as deep as the feet sink in, so on sand the whole mech sits that much lower (the
    // legs keep their shape) rather than the hips dropping only part of the way (the sprint keeps its own heights).
    const under = this.ground.height(this.pos.x, this.pos.z) - this.sink(this.pos.x, this.pos.z) * (1 - this.sprintK);
    const ref = (avg + (low - avg) * v.downhillReach) * 0.7 + under * 0.3;
    // Walking the hips are highest over the planted foot (vaulting); running they sink onto it and spring off.
    const run = this.runShare(), rk = this.runK;
    // Running the hips are lowest at each mid-stance and highest in the flights between (a small bob: the hull rides
    // level at speed).
    const bob = v.bob * Math.cos(4 * Math.PI * (this.phase - d / 2)) * smooth(0.05, 1, this.speed) * (1 - 2 * v.runBounce * run) * (1 - rk)
      - v.runBob * Math.cos(4 * Math.PI * (this.phase - d / 2)) * rk;
    const down = smooth(0, 0.35, -this.grade);
    const sprintCrouch = v.boundCrouch * (0.4 + 0.6 * this.speedShare());
    if (!this.dashMove) { const e = Math.max(0, 1 - dt * 3); this.dashRoll *= e; this.dashPitch *= e; this.dashDipNow *= e; }
    let yT = ref + v.hipHeight - v.downhillCrouch * down - (v.runCrouch * run) * (1 - rk) - sprintCrouch * rk - this.crouch + this.dashDipNow;
    if (rk > 0) {
      // The hull never dips into rising ground: the hips keep runClear over the highest ground ahead (the legs take it).
      const clear = this.groundAhead(Math.max(1.5, this.speed * v.runLookAhead)) + v.runClear;
      yT += Math.max(0, clear - yT) * rk;
      // ...but never higher than the feet reach (Keith 21:54: up a climb the clearance held the hips past the legs'
      // reach, a step behind and below, and the over-stretched legs flicked the cadence): each planted foot and each
      // swinging foot's landing spot caps the hips at its leg's longest (legReachMax) plus runReachGive. Only the feet
      // that carry the body count (landing spots, the first half of a stance: a foot trailing to its push-off may stretch
      // out), and the cap is eased over a stride, so it doesn't bob the hips.
      const R = v.legReachMax * (v.femur + v.shin + v.cannon), l = leftOf(this.heading, this.t.l);
      let yMax = Infinity;
      for (const f of this.feet) {
        if (!f.swinging && f.stanceT > 0.5) continue;
        // A landing spot against where the hips will be when it lands.
        const p = f.swinging ? f.target : f.pos, ahead = f.swinging ? ((1 - f.u) * (1 - this.dutyNow)) / Math.max(MIN_CYCLE, this.cpsNow) : 0;
        const hx = this.pos.x + this.vel.x * ahead + l.x * f.side * v.hipWidth - p.x, hz = this.pos.z + this.vel.z * ahead + l.z * f.side * v.hipWidth - p.z;
        yMax = Math.min(yMax, p.y + v.ankleHeight + Math.sqrt(Math.max(0.04, R * R - hx * hx - hz * hz)));
      }
      if (Number.isFinite(yMax)) this.reachCap = Number.isFinite(this.reachCap) ? this.reachCap + (yMax - this.reachCap) * Math.min(1, dt * 4) : yMax;
      if (yT > this.reachCap + v.runReachGive) yT += (this.reachCap + v.runReachGive - yT) * rk;
    }
    // Following the ground's own rise (feed-forward) so a fast run up a slope doesn't lag under it.
    const yv = Number.isFinite(this.prevYT) ? clamp((yT - this.prevYT) / dt, -12, 12) : 0;
    this.prevYT = yT;
    this.bodyY.stepFF(yT, yv * rk, dt);
    this.hipShort = Math.max(0, yT - this.bodyY.x);
    this.impact.step(0, dt);

    // Weight onto the planted leg: shift over it, roll the pelvis down onto it (much less running).
    const shift = ((a.swinging ? 0 : 1) * a.side + (b.swinging ? 0 : 1) * b.side) * (1 - 0.7 * rk); // +1 left planted only, -1 right only
    this.lat.step(shift * v.weightShift, dt);
    this.roll.step(-shift * v.crunchRoll * D2R + this.leanRoll + (this.running ? clamp(-wrap(this.heading - this.course), -0.5, 0.5) * 0.3 : 0), dt);

    // Pitch with the ground along the heading, and lean into acceleration.
    // Downhill the body tips forward less (it keeps its weight back over the feet).
    const fw = forwardOf(this.heading, this.t.f);
    const slope = Math.atan(this.grade);
    const pitchShare = slope < 0 ? v.slopePitch * v.downhillLevel : v.slopePitch;
    const walkLean = (clamp(this.accelSmooth / 3, -1, 1) * v.speedLean + v.moveLean * clamp(this.speed / Math.max(0.1, v.walkSpeed), 0, 1.6)) * D2R;
    const runLean = v.boundLean * D2R * (0.35 + 0.65 * this.speedShare());
    this.pitch.step(-slope * pitchShare + walkLean + (runLean - walkLean) * rk + v.landPitch * D2R * Math.max(0, this.squat) / Math.max(0.1, v.landSquatMax) + this.leanPitch + this.dashPitch, dt);

    // Weight back over the feet downhill: the hips sit back from the body point the feet are placed around.
    const back = v.downhillSitBack * down;
    const l = leftOf(this.heading, this.t.l);
    // The hips never ride higher than the planted legs reach at their longest (legReachMax): down a slope the body comes
    // down with the low foot instead of the leg stretching out to it.
    {
      const R = v.legReachMax * (v.femur + v.shin + v.cannon);
      let yMax = Infinity;
      for (const f of this.feet) {
        if (f.swinging) continue;
        const hx = this.pos.x + l.x * (this.lat.x + f.side * v.hipWidth) - fw.x * back - f.pos.x;
        const hz = this.pos.z + l.z * (this.lat.x + f.side * v.hipWidth) - fw.z * back - f.pos.z;
        yMax = Math.min(yMax, f.pos.y + v.ankleHeight + Math.sqrt(Math.max(0.04, R * R - hx * hx - hz * hz)));
      }
      // Running, the hull's clearance over rising ground wins: the trailing leg may reach a little further for a moment.
      const extra = this.impact.x + bob - this.squat;
      const over = this.bodyY.x + extra - yMax;
      if (over > 0) { this.bodyY.x -= over * (1 - rk); if (rk < 0.5) this.bodyY.v = Math.min(0, this.bodyY.v); }
    }
    // Running, each plant compresses the body (Keith 2026-10-26 21:54: "communication of energy being pushed into the
    // ground"): a quick hip drop and the nose pitching down over the first half of the stance, then the hips rising a little
    // as the leg extends through the push-off.
    let comp = 0, ext = 0;
    if (rk > 0) for (const f of this.feet) {
      if (f.swinging) continue;
      const st = f.stanceT;
      comp = Math.max(comp, st < 0.5 ? Math.sin((Math.PI * st) / 0.5) : 0);
      ext = Math.max(ext, st >= 0.5 ? Math.sin((Math.PI * (st - 0.5)) / 0.5) : 0);
    }
    const plantY = (v.runPushRise * ext - v.runPlantDrop * comp) * rk;
    this.plantPitch = v.runPlantPitch * D2R * comp * rk;
    this.pelvis.set(this.pos.x + l.x * this.lat.x - fw.x * back, this.bodyY.x + this.impact.x + bob - this.squat + plantY, this.pos.z + l.z * this.lat.x - fw.z * back);
    // The dash turns the whole body itself (its heading): no extra opening of the hips.
    this.hipOpen += (0 - this.hipOpen) * Math.min(1, dt * 14);
    this.orient(this.heading + this.hipOpen);
    for (const f of this.feet) f.kneeYaw += (0 - f.kneeYaw) * Math.min(1, dt * 10);
  }

  /**
   * Thigh angle forward of straight down (radians) if the cannon sits at theta, or NaN if the hip can't reach.
   * Same geometry as the leg solve below.
   */
  private thighAngle(P: LegPose, planeUp: Vector3, theta: number) {
    const v = this.v;
    const hock = this.t.b.copy(P.ankle).addScaledVector(planeUp, Math.cos(theta) * v.cannon).addScaledVector(P.legFwd, -Math.sin(theta) * v.cannon);
    const toHock = this.t.a.subVectors(hock, P.hip);
    const dist = toHock.length();
    if (dist > v.femur + v.shin - 0.002 || dist < Math.abs(v.femur - v.shin) + 0.05) return NaN;
    toHock.divideScalar(dist);
    const cosA = clamp((v.femur * v.femur + dist * dist - v.shin * v.shin) / (2 * v.femur * dist), -1, 1);
    const fwd = P.legFwd.dot(toHock), dn = -toHock.y;
    // The thigh is the hip-hock line turned forward by the knee angle, in the leg plane.
    return Math.atan2(fwd, dn) + Math.acos(cosA);
  }

  /**
   * The cannon angle that puts the thigh at `want` forward of straight down with the foot where it is: the knee placed at
   * that angle, the hock where shin and cannon meet behind the knee-ankle line. NaN if the leg can't make it.
   */
  private foldTheta(P: LegPose, planeUp: Vector3, want: number) {
    const v = this.v, knee = this.t.a, d = this.t.b;
    for (let w = want; w >= want; w -= 1) {
      knee.copy(P.hip).addScaledVector(P.legFwd, v.femur * Math.sin(w)).addScaledVector(UP, -v.femur * Math.cos(w));
      d.subVectors(P.ankle, knee);
      const kd = d.length();
      if (kd > v.shin + v.cannon - 0.01 || kd < Math.abs(v.cannon - v.shin) + 0.05) continue;
      d.divideScalar(kd);
      const a = (v.shin * v.shin - v.cannon * v.cannon + kd * kd) / (2 * kd), h = Math.sqrt(Math.max(0, v.shin * v.shin - a * a));
      // Behind the knee-ankle line, in the leg plane.
      const bx = -P.legFwd.x + d.x * P.legFwd.dot(d), by = -P.legFwd.y + d.y * P.legFwd.dot(d), bz = -P.legFwd.z + d.z * P.legFwd.dot(d);
      const bl = Math.hypot(bx, by, bz) || 1;
      const hx = knee.x + d.x * a + (bx / bl) * h - P.ankle.x, hy = knee.y + d.y * a + (by / bl) * h - P.ankle.y, hz = knee.z + d.z * a + (bz / bl) * h - P.ankle.z;
      // The leg solve must land on the same knee: hip to hock within the thigh-and-shin's range, the knee ahead of that line.
      const qx = P.ankle.x + hx - P.hip.x, qy = P.ankle.y + hy - P.hip.y, qz = P.ankle.z + hz - P.hip.z, qd = Math.hypot(qx, qy, qz);
      if (qd < Math.abs(v.femur - v.shin) + 0.08 || qd > v.femur + v.shin - 0.01) continue;
      const kx = knee.x - P.hip.x, ky = knee.y - P.hip.y, kz = knee.z - P.hip.z, kq = (kx * qx + ky * qy + kz * qz) / (qd * qd);
      if ((kx - qx * kq) * P.legFwd.x + (ky - qy * kq) * P.legFwd.y + (kz - qz * kq) * P.legFwd.z < 0.02) continue;
      return Math.atan2(-(hx * P.legFwd.x + hy * P.legFwd.y + hz * P.legFwd.z), hx * planeUp.x + hy * planeUp.y + hz * planeUp.z);
    }
    return NaN;
  }

  private plateForward(up: Vector3, yaw: number, out: Vector3) {
    forwardOf(yaw, out);
    out.addScaledVector(up, -out.dot(up)).normalize();
    return out;
  }

  /** Solve every leg for the current body and feet. */
  private pose() {
    const v = this.v;
    const pl = this.t.l.set(1, 0, 0).applyQuaternion(this.pelvisQ);
    for (const f of this.feet) {
      const P = f.pose;
      P.hip.copy(this.pelvis).addScaledVector(pl, f.side * v.hipWidth);

      // Foot plate frame: up from the ground (or swing blend), forward along its yaw, then pitched toes-down.
      const fw = this.plateForward(f.up, f.yaw, this.t.f);
      const lf = this.t.a.crossVectors(f.up, fw).normalize();
      this.t.m.makeBasis(lf, f.up, fw);
      P.footQ.setFromRotationMatrix(this.t.m);
      if (f.pitch !== 0) P.footQ.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), f.pitch));
      const upNow = new Vector3(0, 1, 0).applyQuaternion(P.footQ);
      const fwNow = new Vector3(0, 0, 1).applyQuaternion(P.footQ);
      P.foot.copy(f.pos);
      P.toeHinge.copy(f.pos).addScaledVector(fwNow, v.toeHinge);
      P.toeQ.copy(P.footQ).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), f.toe));
      P.toe.copy(P.toeHinge).addScaledVector(new Vector3(0, 0, 1).applyQuaternion(P.toeQ), Math.max(0, v.toeLength - v.toeHinge));
      P.ankle.copy(f.pos).addScaledVector(upNow, v.ankleHeight).addScaledVector(fwNow, -v.ankleBack);

      // A squashed planted leg also turns its knee outward at the hip (thighSplay per unit of compression), so the
      // thigh angles out to the side instead of standing straight up and down (Keith 2026-10-24, side slopes).
      const rest = Math.max(0.5, v.hipHeight - v.ankleHeight);
      const squash = f.swinging || this.airborne ? 0 : clamp((rest - P.hip.distanceTo(P.ankle)) / rest, 0, 0.6);
      f.splay += ((v.thighSplay * squash) - f.splay) * 0.15;
      forwardOf(this.heading + this.hipOpen + f.side * (v.kneeOut + f.splay) * D2R + f.kneeYaw, P.legFwd);
      const reach = v.femur + v.shin - 0.002;

      // Cannon angle, measured back from the hip-ankle line in the leg plane, so the whole lower leg pitches as the
      // leg swings under the body. Planted: the rake, compressed a little under load, opening toward a straight
      // lower leg (cannon in line with the shin) as the foot trails into push-off. Swinging: back to the rake from
      // the lift-off angle, with a tuck in the middle that lifts the foot.
      const toHip = new Vector3().subVectors(P.hip, P.ankle);
      const planeUp = toHip.clone().addScaledVector(P.legFwd, -toHip.dot(P.legFwd)).normalize();
      const rake = v.cannonRake * D2R;
      let theta: number;
      if (this.airborne) {
        // In the air: the hocks fold as the legs tuck, open as they reach for the ground.
        theta = rake + v.airFold * D2R * (1 - this.airExt);
      } else if (f.swinging) {
        const t = f.u;
        theta = f.liftTheta + (rake - f.liftTheta) * smooth(0, 0.5, t) + v.swingTuck * D2R * Math.sin(Math.PI * Math.min(1, t / 0.85));
        // The run folds the cannon up into its tuck (runSwing).
        if (this.runK > 0 && f.bState === 0) theta += (f.runTheta - theta) * this.runK;
      } else {
        theta = rake + v.hockCompress * D2R * (1 + Math.max(0, -this.impact.x) * 20);
        // Running, the hock opens further at the push-off (Keith 2026-10-26: open it up more during the sprint).
        const ext = (v.hockExtend + (v.runHockExtend - v.hockExtend) * this.runK) * smooth(0.3, 1, f.stanceT);
        if (ext > 0) {
          // The cannon angle that lines it up with the shin: two-bone IK of thigh and (shin + cannon) to the ankle.
          const l2 = v.shin + v.cannon, dm = Math.min(v.femur + l2 - 0.002, Math.max(0.01, toHip.length()));
          const dirM = toHip.clone().negate().normalize(); // hip -> ankle
          const ca = clamp((v.femur * v.femur + dm * dm - l2 * l2) / (2 * v.femur * dm), -1, 1);
          const pp = P.legFwd.clone().addScaledVector(dirM, -P.legFwd.dot(dirM)).normalize();
          const knee = P.hip.clone().addScaledVector(dirM, v.femur * ca).addScaledVector(pp, v.femur * Math.sqrt(1 - ca * ca));
          const toK = knee.sub(P.ankle);
          theta += (Math.atan2(-toK.dot(P.legFwd), toK.dot(planeUp)) - theta) * ext;
        }
        // Never tip the cannon past vertical (hock ahead of the foot); how close it may get grows with speed.
        const minT = (v.hockMinSlow + (v.hockMinFast - v.hockMinSlow) * clamp(this.speed / Math.max(0.1, v.sprintSpeed), 0, 1)) * D2R;
        theta = Math.max(theta, minT - Math.atan2(toHip.dot(P.legFwd), toHip.dot(UP)));
      }
      // A planted leg that's compressed (the uphill leg on a side slope, the front leg climbing) folds at the hip:
      // pick the cannon angle that swings the thigh forward by thighFold per unit of compression, instead of letting
      // the short lower leg take it all while the long thigh hangs straight down (Keith 2026-10-24).
      // A swinging leg squashed more than a flat step squashes it (stepping uphill) lifts its knee through the hip too
      // (Keith 2026-10-26 18:28: uphill the thigh was held down vertical; it's fine for it to rise toward the hull).
      // The run's swing has its own tuck, so this fades out as the run blends in.
      const swingSquash = f.swinging && !this.airborne && f.bState === 0
        ? Math.max(0, clamp((rest - P.hip.distanceTo(P.ankle)) / rest, 0, 0.7) - v.swingFoldFrom) * (1 - this.runK) : 0;
      if (swingSquash > 0.005) {
        // Swinging, the knee folds shut long before the thigh moves (long thigh, short shin), so aim the thigh itself:
        // swingThighFold per unit of squash past the threshold, forward of straight down, over the whole cannon range;
        // eased so the fold can't flip between two solutions.
        // The thigh angle moves toward what's wanted at a capped rate and takes the nearest one the leg can make, so it
        // never jumps between poses.
        const want = Math.min(80 * D2R, v.swingThighFold * D2R * swingSquash);
        const aimW = clamp(want, f.foldW - 1.5 * D2R, f.foldW + 1.5 * D2R);
        let bestW = NaN, bestT = NaN;
        for (let w = 0; w <= 80 * D2R; w += 2.5 * D2R) {
          if (Number.isFinite(bestW) && Math.abs(w - aimW) >= Math.abs(bestW - aimW)) continue;
          const t = this.foldTheta(P, planeUp, w);
          if (Number.isFinite(t)) { bestW = w; bestT = t; }
        }
        if (Number.isFinite(bestT)) {
          f.foldW = bestW;
          // The cannon swings to it at a capped rate too: when the leg has to change pose, it does so over a few frames.
          const tw = theta + (bestT - theta) * smooth(0, 0.08, swingSquash);
          f.foldT += clamp(tw - f.foldT, -4 * D2R, 4 * D2R);
          theta = f.foldT;
        } else f.foldT = theta;
      } else { f.foldW = Math.max(0, this.thighAngle(P, planeUp, theta) || 0); f.foldT = theta; }
      if (!f.swinging && !this.airborne && v.thighFold > 0) {
        if (squash > 0.01) {
          const base = this.thighAngle(P, planeUp, theta);
          const want = base + v.thighFold * D2R * squash;
          let best = theta, bestCost = Infinity;
          // Folding the long thigh forward over the short shin tips the cannon forward of vertical: allowed while squashed.
          for (let k = -12; k <= 16; k++) {
            const t = theta + k * 3 * D2R;
            const ang = this.thighAngle(P, planeUp, t);
            if (!Number.isFinite(ang)) continue;
            const cost = Math.abs(ang - want) + 0.15 * Math.abs(t - theta);
            if (cost < bestCost) { bestCost = cost; best = t; }
          }
          theta = best;
        }
      }
      f.theta = theta;

      // If the hip is still out of reach, swing the cannon toward the hip until it isn't. A planted leg also stops short
      // of a straight knee (kneeMaxPlanted): at the end of a push-off the hock opens just enough instead (Keith
      // 2026-10-24 didn't want the knee going straight; with the hock not opening by itself, hockExtend 0, it did).
      const dirRake = planeUp.clone().multiplyScalar(Math.cos(theta)).addScaledVector(P.legFwd, -Math.sin(theta));
      const dirHip = toHip.clone().normalize();
      const kneeCap = clamp(v.kneeMaxPlanted, 90, 180) * D2R;
      const dKnee = Math.sqrt(v.femur * v.femur + v.shin * v.shin - 2 * v.femur * v.shin * Math.cos(kneeCap));
      const lim = !f.swinging && !this.airborne ? Math.min(reach, dKnee) : reach;
      P.hock.copy(P.ankle).addScaledVector(dirRake, v.cannon);
      if (P.hock.distanceTo(P.hip) > lim) {
        let lo = 0, hi = 1;
        const dir = new Vector3();
        for (let i = 0; i < 10; i++) {
          const w = (lo + hi) / 2;
          dir.copy(dirRake).lerp(dirHip, w).normalize();
          if (P.hock.copy(P.ankle).addScaledVector(dir, v.cannon).distanceTo(P.hip) > lim) lo = w; else hi = w;
        }
        dir.copy(dirRake).lerp(dirHip, hi).normalize();
        P.hock.copy(P.ankle).addScaledVector(dir, v.cannon);
        // The swing starts from the cannon as it really was.
        f.theta = Math.atan2(-dir.dot(P.legFwd), dir.dot(planeUp));
        if (P.hock.distanceTo(P.hip) > reach + 0.01) {
          this.stats.overreach++;
          P.hock.sub(P.hip).setLength(reach).add(P.hip);
        }
      }

      // Thigh and shin: two-bone IK in the leg plane, knee forward.
      const toHock = new Vector3().subVectors(P.hock, P.hip);
      let dist = toHock.length();
      const minD = Math.abs(v.femur - v.shin) + 0.05;
      if (dist < minD) { toHock.setLength(minD); P.hock.copy(P.hip).add(toHock); dist = minD; }
      const dir = toHock.divideScalar(dist);
      const cosA = clamp((v.femur * v.femur + dist * dist - v.shin * v.shin) / (2 * v.femur * dist), -1, 1);
      const perp = new Vector3().copy(P.legFwd).addScaledVector(dir, -P.legFwd.dot(dir)).normalize();
      P.knee.copy(P.hip).addScaledVector(dir, v.femur * cosA).addScaledVector(perp, v.femur * Math.sqrt(1 - cosA * cosA));
    }
  }
}
