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

export interface Ground {
  height(x: number, z: number): number;
  normal(x: number, z: number, out?: number[]): number[];
}

/** Desired move direction in world x/z; length 0..1 is the stick amount. */
export interface MoveCommand { x: number; z: number; sprint: boolean }

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
  stats: WalkerStats = { steps: 0, takeoffs: 0, landings: 0, airFrames: 0, overreach: 0, scuffs: 0, frames: 0, leaps: 0 };
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
  /** In the sprint's gait: the run, a landing stance, or one of its leaps. */
  get bounding() { return this.running || this.bStance !== null || (this.airborne && this.bLeap); }
  /** The sprint's run gait is on (steering like a vehicle); runK is how far the gait has blended from the walk (0..1). */
  running = false;
  runK = 0;
  /** The gait's planted share and cycles per second now (the planted share eases, so steps never jump). */
  dutyNow = 0.6;
  cpsNow = 0;
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
  private dashMove: { t: number; dx: number; dz: number; yaw: number; sg: number; P: Foot; L: Foot; released: boolean; relT: number; pRel: Vector3; lRel: Vector3 } | null = null;
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
  private t = { f: new Vector3(), l: new Vector3(), a: new Vector3(), b: new Vector3(), n: [0, 1, 0], e: new Euler(), m: new Matrix4() };

  constructor(public v: WalkerValues, public ground: Ground) {
    this.reset(0, 0, 0);
  }

  /** Body pitch (nose down +) and roll (left side up +), radians: for an upper body riding on the hips. */
  get bodyPitch() { return this.pitch.x; }
  get bodyRoll() { return this.roll.x; }

  reset(x: number, z: number, heading: number) {
    this.airborne = false; this.airVel.set(0, 0, 0); this.squatState = null; this.stagger = 0; this.skid.set(0, 0, 0);
    this.bStance = null; this.bLeap = false; this.boundSpeed = 0; this.course = heading; this.footSlip = 0; this.pushPrev.set(0, 0, 0);
    this.running = false; this.runK = 0; this.dutyNow = this.v.duty; this.cpsNow = 0; this.prevYT = NaN; this.slip.set(0, 0, 0);
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
    this.bodyY.x += dy;
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
    this.dashMove = null;
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
    if (this.stagger > 0) { this.stagger = Math.max(0, this.stagger - dt); cmd = { x: 0, z: 0, sprint: false }; }
    this.footSlip = 0;
    this.slip.set(0, 0, 0);
    this.tuckPose();
    // The sprint, once any stagger and landing squat are over. Its ground gait is the run (left, right, left, right);
    // the gallop's stance is the way down out of the air (a crest jump's landing), and the whole gait with boundGallop.
    const gallop = v.boundGallop >= 0.5;
    const sprinting = this.bound && this.stagger <= 0 && !this.squatState;
    this.runK = clamp(this.runK + (sprinting && !gallop ? dt : -dt) / Math.max(0.02, v.runBlend), 0, 1);
    if (this.airborne) { this.stats.airFrames++; this.fly(dt, cmd); this.pose(); this.pushPrev.copy(this.push); this.trackSlides(dt); return; }
    if (this.squatState) { this.squatState.t += dt; if (this.squatState.t >= this.squatState.down + this.squatState.up) this.squatState = null; }
    if (this.bound && this.stagger <= 0 && !this.squatState && (gallop || this.bStance)) { this.boundStep(dt, cmd); this.pushPrev.copy(this.push); this.trackSlides(dt); return; }
    if (this.bStance) this.endBound();
    this.prevPos.copy(this.pos);
    if (this.bound && this.stagger <= 0 && !this.squatState) { if (!this.running) { if (this.dashMove) this.runFromDash(); else this.runStart(); } }
    else if (this.running) this.runEnd();
    this.pushPrev.copy(this.push);
    // A dash's shove (from outside, src/mech/dash.ts) starting: the push-off.
    if (!this.dashMove && !this.running && this.push.lengthSq() > 4) this.dashBegin();

    if (this.running) this.runSteer(dt, cmd);
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

    // Gait phase. The run (sprinting) and the walk share it: the run's cadence rises with speed and its planted share
    // is the ground per stance over the stride, so the flights grow with speed; the planted share eases toward what's
    // wanted (never jumping a foot from stance to swing and back).
    const S = this.stride(), rk = this.runK;
    let dWant = this.duty(), cps = this.speed / S;
    if (rk > 0) {
      const cpsR = (v.runSteps + (v.runStepsTop - v.runSteps) * this.speedShare()) / 2;
      const dR = clamp((v.boundStanceLen * cpsR) / Math.max(1, this.speed), 0.2, 0.5);
      dWant += (dR - dWant) * rk;
      cps += (cpsR - cps) * rk;
    }
    this.dutyNow += clamp(dWant - this.dutyNow, -0.5 * dt, 0.5 * dt);
    const d = this.dutyNow;
    const anySwing = this.feet[0].swinging || this.feet[1].swinging;
    if (anySwing) cps = Math.max(cps, MIN_CYCLE);
    // Standing: step a foot back under the body if it's out of place, once any landing squat is over (both feet stay
    // planted through the squat).
    else if (this.speed < 0.08) { cps = 0; if (!this.squatState) this.settle(d); }
    // A planted leg near full stretch (sharp turns, steep ground) hurries the steps instead of overreaching.
    cps *= 1 + 1.5 * smooth(0.9, 1, this.stretch());
    this.cpsNow = cps;
    this.phase = (this.phase + cps * dt) % 1;

    for (const f of this.feet) {
      const p = (this.phase + f.offset) % 1;
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
    this.boundSpeed += (top - this.boundSpeed) * Math.min(1, v.boundBuild * dt);
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
    const v = this.v, u = f.u, d = this.dutyNow;
    const Tsw = (1 - d) / Math.max(MIN_CYCLE, this.cpsNow);
    const remain = (1 - u) * Tsw;
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
    out.set(this.pos.x + fw.x * x + lf.x * s, hipY + y, this.pos.z + fw.z * x + lf.z * s);
    // Clear the ground under the foot and its toes.
    const env = Math.sin(Math.PI * u);
    const g = this.ground.height(out.x, out.z);
    const gToe = this.ground.height(out.x + fw.x * v.toeLength, out.z + fw.z * v.toeLength);
    out.y = Math.max(out.y, Math.max(g, gToe) + v.footClear * env, g);
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
    this.pelvisQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x, "YXZ"));
    this.hullQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x * (1 - v.shoulderLevel), "YXZ"));
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
    this.prevYT = NaN;
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
    this.pelvisQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x, "YXZ"));
    this.hullQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x * (1 - v.shoulderLevel), "YXZ"));

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
        f.pos.y = Math.max(f.pos.y, this.ground.height(f.pos.x, f.pos.z));
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
        } else { this.moveFoot(f); continue; }
      }
      // Lifted: following the air pose, kept above the sand.
      this.airFoot(f, dt, len);
      f.pos.set(this.pelvis.x + f.airRel.x, this.pelvis.y + f.airRel.y, this.pelvis.z + f.airRel.z);
      const g = this.ground.height(f.pos.x, f.pos.z);
      if (f.pos.y < g + 0.05) { f.pos.y = g + 0.05; f.airRel.y = f.pos.y - this.pelvis.y; }
      f.up.copy(UP); f.yaw = this.heading + f.side * v.toeOut * D2R; f.pitch = 0.3; f.toe = 0.25;
      f.u = Math.min(0.3, f.u + dt * 2);
      f.groundY = g;
    }
    this.pose();
    if (st.t >= st.T) { if (this.v.boundGallop >= 0.5) this.boundLaunch(); else this.runFromStance(); }
  }

  // ---- The dash as a push-off (Keith 2026-10-26 18:28) ----

  /**
   * The shove starts: whatever the step, the foot that's down (the one further back along the dash if both are, the
   * nearer to the ground if neither) pushes off; the other steps out toward the dash and lands to slide on.
   */
  private dashBegin() {
    const v = this.v, l = Math.hypot(this.push.x, this.push.z), dx = this.push.x / l, dz = this.push.z / l;
    const [a, b] = this.feet;
    const above = (f: Foot) => f.pos.y - this.ground.height(f.pos.x, f.pos.z);
    let P: Foot;
    if (!a.swinging && b.swinging) P = a;
    else if (a.swinging && !b.swinging) P = b;
    else if (!a.swinging && !b.swinging) P = (a.planted.x - b.planted.x) * dx + (a.planted.z - b.planted.z) * dz < 0 ? a : b;
    else P = above(a) <= above(b) ? a : b;
    const L = P === a ? b : a;
    // The push foot is down (a foot nearly down is put down where it is).
    if (P.swinging) this.plantFoot(P, P.pos.x, P.pos.z);
    P.hang = false; L.hang = false; L.short = false;
    const lRel = new Vector3(L.pos.x - this.pos.x, L.pos.y - this.bodyY.x, L.pos.z - this.pos.z);
    // The lead foot leaves at once.
    if (!L.swinging) this.onLiftOff?.(L, 1.2);
    L.swinging = true; L.u = 0; L.liftTheta = L.theta; L.liftPitch = L.pitch; L.liftToe = L.toe;
    // Which side of the push foot the lead foot is, across the dash (it stays there).
    const sg = (L.pos.x - P.pos.x) * -dz + (L.pos.z - P.pos.z) * dx >= 0 ? 1 : -1;
    this.dashMove = { t: 0, dx, dz, yaw: Math.atan2(dx, dz), sg, P, L, released: v.dashPushTime <= 0, relT: 0, pRel: new Vector3(P.pos.x - this.pos.x, P.pos.y - this.bodyY.x, P.pos.z - this.pos.z), lRel };
    if (this.dashMove.released) { P.swinging = true; P.u = 0; P.liftTheta = P.theta; P.liftPitch = P.pitch; P.liftToe = P.toe; }
    P.stanceT = Math.max(P.stanceT, 0.55);
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

  /** One step of the dash: the push foot holds then lets go and comes back under; the lead foot lands and slides. */
  private dashFeet(dt: number) {
    const v = this.v, dm = this.dashMove!;
    dm.t += dt;
    const mx = this.pos.x - this.prevPos.x, mz = this.pos.z - this.prevPos.z;
    const lf = leftOf(this.heading, this.t.l);
    const hipY = this.bodyY.x, spread = this.spread();
    const R = v.legReachMax * (v.femur + v.shin + v.cannon);
    const { P, L, dx, dz } = dm;
    // Where the lead foot slides: out toward the dash; where the push foot comes back to. The two sit apart across the
    // dash's direction, each keeping its side of the other (no crossing, whichever leg leads).
    const px = -dz, pz = dx, sg = dm.sg;
    const leadX = this.pos.x + dx * v.dashLeadReach + px * sg * spread, leadZ = this.pos.z + dz * v.dashLeadReach + pz * sg * spread;
    const backX = this.pos.x + dx * v.dashLeadReach * 0.3 - px * sg * spread, backZ = this.pos.z + dz * v.dashLeadReach * 0.3 - pz * sg * spread;
    const slide = (f: Foot) => {
      f.planted.x += mx; f.planted.z += mz;
      this.groundAt(f.planted, f.plantedUp);
      f.stanceT = Math.min(f.stanceT, 0.3);
      this.moveFoot(f);
    };
    // A swinging foot from its start (riding with the body) to a spot, lifted in an arc, over the ground.
    const swingTo = (f: Foot, rel: Vector3, tx: number, tz: number, k: number, lift: number) => {
      const e = smooth(0, 1, k);
      const sx = this.pos.x + rel.x, sz = this.pos.z + rel.z, sy = hipY + rel.y;
      f.pos.set(sx + (tx - sx) * e, 0, sz + (tz - sz) * e);
      const g = this.ground.height(f.pos.x, f.pos.z);
      f.pos.y = Math.max(g, sy + (g - sy) * e) + lift * Math.sin(Math.PI * k);
      f.u = k; f.stanceT = 0;
      f.up.copy(UP); f.yaw = this.heading + f.side * v.toeOut * D2R;
      f.groundY = g;
    };
    // Lead foot.
    if (L.swinging) {
      const k = clamp(dm.t / Math.max(0.02, v.dashLeadTime), 0, 1);
      swingTo(L, dm.lRel, leadX, leadZ, k, v.dashLeadLift);
      L.pitch = L.liftPitch * (1 - k); L.toe = L.liftToe * (1 - k);
      if (k >= 1) { this.plantFoot(L, L.pos.x, L.pos.z); this.stats.steps++; this.onFootfall?.(L, 1.3); }
    } else slide(L);
    // Push foot: holds while the leg extends (heel rolling, hock opening), lets go at full stretch or after dashPushTime.
    if (!dm.released) {
      P.stanceT = Math.min(1, Math.max(P.stanceT, 0.55 + 0.45 * dm.t / Math.max(0.02, v.dashPushTime)));
      this.moveFoot(P);
      const hx = this.pos.x + lf.x * P.side * v.hipWidth - P.pos.x, hz = this.pos.z + lf.z * P.side * v.hipWidth - P.pos.z, hy = hipY - P.pos.y - v.ankleHeight;
      const apart = Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z);
      if (dm.t >= v.dashPushTime || Math.hypot(hx, hy, hz) >= R || apart > v.dashSpreadMax) {
        dm.released = true; dm.relT = dm.t;
        dm.pRel.set(P.pos.x - this.pos.x, P.pos.y - hipY, P.pos.z - this.pos.z);
        P.swinging = true; P.u = 0; P.liftTheta = P.theta; P.liftPitch = P.pitch; P.liftToe = P.toe;
        this.onLiftOff?.(P, 1.4);
      }
    } else if (P.swinging) {
      const k = clamp((dm.t - dm.relT) / Math.max(0.05, v.dashRecover), 0, 1);
      swingTo(P, dm.pRel, backX, backZ, k, 0.25);
      // Toes trail down as the foot is dragged in, then flatten for the plant.
      P.pitch = P.liftPitch * (1 - smooth(0, 0.6, k)); P.toe = P.liftToe * (1 - smooth(0, 0.5, k));
      if (k >= 1) { this.plantFoot(P, P.pos.x, P.pos.z); this.stats.steps++; this.onFootfall?.(P, 1); }
    } else slide(P);
    // No splits: a swinging foot never further than dashSpreadMax from the other, nor out of the leg's reach.
    for (const f of this.feet) {
      if (!f.swinging) continue;
      const o = f === P ? L : P;
      const ox = f.pos.x - o.pos.x, oz = f.pos.z - o.pos.z, od = Math.hypot(ox, oz);
      if (od > v.dashSpreadMax) { f.pos.x = o.pos.x + (ox / od) * v.dashSpreadMax; f.pos.z = o.pos.z + (oz / od) * v.dashSpreadMax; }
      const jx = this.pos.x + lf.x * f.side * v.hipWidth, jz = this.pos.z + lf.z * f.side * v.hipWidth;
      const rx = f.pos.x - jx, ry = f.pos.y + v.ankleHeight - hipY, rz = f.pos.z - jz, rd = Math.hypot(rx, ry, rz);
      if (rd > R) { const s = R / rd; f.pos.set(jx + rx * s, hipY + ry * s - v.ankleHeight, jz + rz * s); }
      f.pos.y = Math.max(f.pos.y, this.ground.height(f.pos.x, f.pos.z));
    }
    // The lead knee drives toward the dash.
    const toward = wrap(dm.yaw - this.heading);
    const kneeWant = clamp(toward - this.hipOpen, -v.dashKneeOut * D2R, v.dashKneeOut * D2R);
    L.kneeYaw += (kneeWant * (1 - smooth(0.25, 0.6, dm.t)) - L.kneeYaw) * Math.min(1, dt * 14);
    P.kneeYaw += (0 - P.kneeYaw) * Math.min(1, dt * 14);
    // Done: the shove and its glide are over and both feet are down (or it's gone on too long).
    if ((this.push.lengthSq() < 0.36 && !P.swinging && !L.swinging) || dm.t > 2.5) this.dashEnd();
  }

  /** Back to the gait after the slide: the foot further back steps first, so it regains its footing. */
  private dashEnd() {
    const dm = this.dashMove!;
    this.dashMove = null;
    for (const f of this.feet) if (f.swinging) this.plantFoot(f, f.pos.x, f.pos.z);
    const fw = forwardOf(this.heading, this.t.f), [a, b] = this.feet, d = this.dutyNow;
    const behind = (a.planted.x - b.planted.x) * fw.x + (a.planted.z - b.planted.z) * fw.z < 0 ? a : b;
    this.phase = (d - 0.04 - behind.offset + 2) % 1;
    for (const f of this.feet) { f.u = 0; f.stanceT = ((this.phase + f.offset) % 1) / d; }
    void dm;
  }

  /** Held through the dash: its push-off is the first stride of the run, at up to dashIntoRun, along the dash. */
  private runFromDash() {
    const v = this.v, dm = this.dashMove!;
    this.dashMove = null;
    const mx = this.vel.x + this.skid.x + this.pushPrev.x, mz = this.vel.z + this.skid.z + this.pushPrev.z;
    const s = Math.hypot(mx, mz);
    this.boundSpeed = clamp(s, v.sprintSpeed, Math.max(v.sprintSpeed, v.dashIntoRun));
    // The line of run starts along the dash, as far as the body can drift off its heading.
    this.course = wrap(this.heading + clamp(wrap(dm.yaw - this.heading), -v.boundDriftMax * D2R, v.boundDriftMax * D2R));
    this.skid.set(0, 0, 0);
    this.running = true;
    this.speed = this.boundSpeed;
    this.vel.set(Math.sin(this.course) * this.boundSpeed, 0, Math.cos(this.course) * this.boundSpeed);
    // The lead foot is down early in its stance; the push foot comes through.
    const cps = (v.runSteps + (v.runStepsTop - v.runSteps) * this.speedShare()) / 2;
    this.cpsNow = cps;
    const d = this.dutyNow = clamp((v.boundStanceLen * cps) / Math.max(1, this.speed), 0.2, 0.5);
    const { P, L } = dm;
    if (L.swinging) this.plantFoot(L, L.pos.x, L.pos.z);
    this.phase = (0.25 * d - L.offset + 2) % 1;
    L.stanceT = 0.25;
    if (P.swinging) {
      this.beginSwing(P);
      P.u = clamp(((this.phase + P.offset) % 1 - d) / (1 - d), 0, 0.95);
      P.entryU = P.u;
      P.entryRel.copy(P.runA);
      this.aim(P);
    }
    this.prevYT = NaN;
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
    this.prevYT = NaN;
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
    // The foot behind steps first.
    const d = this.duty(), [a, b] = this.feet;
    const aBehind = (a.planted.x - b.planted.x) * fw.x + (a.planted.z - b.planted.z) * fw.z < 0;
    this.phase = aBehind ? d - 0.02 : (d - 0.02 + 0.5) % 1;
    this.bodyY.x = this.pelvis.y - this.impact.x; this.bodyY.v = 0;
    this.boundSpeed = 0;
    this.running = false;
  }

  /** How close the most stretched planted leg is to full reach (1 = straight). */
  private stretch() {
    const reach = this.v.femur + this.v.shin + this.v.cannon * 0.8;
    let m = 0;
    for (const f of this.feet) if (!f.swinging) m = Math.max(m, f.pose.hip.distanceTo(f.pose.ankle) / reach);
    return m;
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
    const k = clamp(0.5 + this.speed / Math.max(0.1, this.v.walkSpeed) * 0.5, 0.4, 1.6) * (1 + this.v.stomp * 0.5);
    // Running, the footfalls come quickly and the body rides over them: only a share of the walk's thud.
    this.impact.v -= this.v.impact * 0.25 * k * (1 - this.runK * (1 - this.v.runThud));
    this.onFootfall?.(f, k);
  }

  /** Landing spot: where this foot belongs when the body gets there, on the ground. */
  private aim(f: Foot) {
    const v = this.v, d = this.dutyNow, S = this.stride();
    const cps = Math.max(this.speed / S + (this.cpsNow - this.speed / S) * this.runK, MIN_CYCLE);
    const remain = ((1 - f.u) * (1 - d)) / cps;
    const h = this.heading + this.turnSpeed * remain * 0.5;
    const fw = forwardOf(h, this.t.f), lf = leftOf(h, this.t.l);
    // Downhill the feet plant in closer under the body, so the legs don't reach out ahead and tiptoe down. Running they
    // land under the hips (runPlant).
    let ahead = d * S * (0.5 - v.stanceBack) * smooth(0, 0.6, this.speed);
    ahead += (v.runPlant - ahead) * this.runK;
    ahead *= 1 - v.downhillPlant * smooth(0, 0.35, -this.grade);
    f.target.copy(this.pos).addScaledVector(this.vel, remain).addScaledVector(fw, ahead).addScaledVector(lf, f.side * this.spread());
    this.groundAt(f.target, f.targetUp);
    f.targetYaw = h + f.side * v.toeOut * D2R;
    // Downhill past the leg's reach (Keith 2026-10-26 18:28: no yanking the legs to the ground): the foot reaches as far
    // as the longest leg goes, with the hips as low as the other planted leg lets them sink, and hangs there.
    const R = v.legReachMax * (v.femur + v.shin + v.cannon);
    let hipLow = this.bodyY.x;
    for (const o of this.feet) if (o !== f && !o.swinging) hipLow = Math.min(hipLow, o.planted.y + v.hipHeight * 0.6);
    const hx = this.pos.x + this.vel.x * remain + lf.x * f.side * v.hipWidth - f.target.x;
    const hz = this.pos.z + this.vel.z * remain + lf.z * f.side * v.hipWidth - f.target.z;
    const lowest = hipLow - Math.sqrt(Math.max(0, R * R - hx * hx - hz * hz)) - v.ankleHeight;
    f.short = f.target.y < lowest - 0.05;
    if (f.short) { f.target.y = lowest; f.targetUp.copy(UP); }
  }

  /** Put p on the ground and write the tilt-limited ground normal into up. */
  private groundAt(p: Vector3, up: Vector3) {
    p.y = this.ground.height(p.x, p.z);
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
      const roll = (v.rollOff + (v.runRollOff - v.rollOff) * rk) * D2R * smooth(v.rollStart + (v.runRollStart - v.rollStart) * rk, 1, f.stanceT);
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
      return;
    }

    const u = f.u;
    const stompT = v.stompShare * v.stomp;
    // Uphill the foot goes forward early instead of rising straight up under the hips first: with the long thigh over
    // a short shin the knee can only come up toward the hull once the foot is out ahead (Keith 2026-10-26 18:28).
    const upK = smooth(0, 0.3, this.grade) * v.uphillLead;
    const hold = v.liftHold * (1 - upK);
    const travel = clamp((u - hold) / Math.max(0.05, 1 - hold - stompT), 0, 1);
    const pw = 1 + 2 * v.liftBox * (1 - upK);
    let e = travel < 0.5 ? 0.5 * Math.pow(2 * travel, pw) : 1 - 0.5 * Math.pow(2 - 2 * travel, pw);
    if (upK > 0) e = 1 - Math.pow(1 - e, 1 + 2 * upK);

    f.pos.lerpVectors(f.lift, f.target, e);
    const baseY = f.lift.y + (f.target.y - f.lift.y) * e;
    // Rises quickly, holds a flat top, then drops: straight down through the stomp.
    const up = smooth(0, Math.max(0.08, hold + 0.12), u);
    const down = stompT > 0 ? 1 - Math.pow(clamp((u - (1 - stompT)) / stompT, 0, 1), 2) : 1 - smooth(0.7, 1, u);
    const liftK = Math.min(up, down);
    let y = baseY + v.liftHeight * liftK;
    // Clear the ground under the foot (stepping up a dune face).
    const g = this.ground.height(f.pos.x, f.pos.z);
    const gToe = this.ground.height(f.pos.x + Math.sin(f.yaw) * v.toeLength, f.pos.z + Math.cos(f.yaw) * v.toeLength);
    y = Math.max(y, Math.max(g, gToe) + v.footClear * liftK);
    f.pos.y = y;
    if (y < g - 0.02) this.stats.scuffs++;

    f.up.copy(f.liftUp).lerp(f.targetUp, e).normalize();
    f.yaw = f.liftYaw + wrap(f.targetYaw - f.liftYaw) * e;
    const swingEnv = Math.sin(Math.PI * Math.min(1, u / Math.max(0.3, 1 - stompT))) * (1 - smooth(1 - stompT, 1, u));
    f.pitch = f.liftPitch * (1 - smooth(0, 0.45, u)) + v.swingCurl * D2R * swingEnv;
    // Toes: still bent up from the push-off as the foot leaves, curling under as the leg is pulled through, then
    // opening flat before the stomp.
    f.toe = f.liftToe * (1 - smooth(0, 0.3, u)) + v.toeCurl * D2R * swingEnv;
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
  }

  private body(dt: number, d: number) {
    const v = this.v;
    const [a, b] = this.feet;
    const avg = (a.groundY + b.groundY) / 2, low = Math.min(a.groundY, b.groundY);
    const under = this.ground.height(this.pos.x, this.pos.z);
    const ref = (avg + (low - avg) * v.downhillReach) * 0.7 + under * 0.3;
    // Walking the hips are highest over the planted foot (vaulting); running they sink onto it and spring off.
    const run = this.runShare(), rk = this.runK;
    // Running the hips are lowest at each mid-stance and highest in the flights between (a small bob: the hull rides
    // level at speed).
    const bob = v.bob * Math.cos(4 * Math.PI * (this.phase - d / 2)) * smooth(0.05, 1, this.speed) * (1 - 2 * v.runBounce * run) * (1 - rk)
      - v.runBob * Math.cos(4 * Math.PI * (this.phase - d / 2)) * rk;
    const down = smooth(0, 0.35, -this.grade);
    const sprintCrouch = v.boundCrouch * (0.4 + 0.6 * this.speedShare());
    let yT = ref + v.hipHeight - v.downhillCrouch * down - (v.runCrouch * run) * (1 - rk) - sprintCrouch * rk - this.crouch;
    if (rk > 0) {
      // The hull never dips into rising ground: the hips keep runClear over the highest ground ahead (the legs take it).
      const clear = this.groundAhead(Math.max(1.5, this.speed * v.runLookAhead)) + v.runClear;
      yT += Math.max(0, clear - yT) * rk;
    }
    // Following the ground's own rise (feed-forward) so a fast run up a slope doesn't lag under it.
    const yv = Number.isFinite(this.prevYT) ? clamp((yT - this.prevYT) / dt, -12, 12) : 0;
    this.prevYT = yT;
    this.bodyY.stepFF(yT, yv * rk, dt);
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
    this.pitch.step(-slope * pitchShare + walkLean + (runLean - walkLean) * rk + v.landPitch * D2R * Math.max(0, this.squat) / Math.max(0.1, v.landSquatMax) + this.leanPitch, dt);

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
    this.pelvis.set(this.pos.x + l.x * this.lat.x - fw.x * back, this.bodyY.x + this.impact.x + bob - this.squat, this.pos.z + l.z * this.lat.x - fw.z * back);
    // The dash opens the hips toward where it's going (the hull above keeps facing the heading).
    const dm = this.dashMove;
    const open = dm ? clamp(wrap(dm.yaw - this.heading), -60 * D2R, 60 * D2R) * v.dashHipOpen * (1 - smooth(0.3, 0.7, dm.t)) : 0;
    this.hipOpen += (open - this.hipOpen) * Math.min(1, dt * 14);
    this.pelvisQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading + this.hipOpen, this.roll.x, "YXZ"));
    this.hullQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x * (1 - v.shoulderLevel), "YXZ"));
    if (!dm) for (const f of this.feet) f.kneeYaw += (0 - f.kneeYaw) * Math.min(1, dt * 10);
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

      // If the hip is still out of reach, swing the cannon toward the hip until it isn't.
      const dirRake = planeUp.clone().multiplyScalar(Math.cos(theta)).addScaledVector(P.legFwd, -Math.sin(theta));
      const dirHip = toHip.clone().normalize();
      P.hock.copy(P.ankle).addScaledVector(dirRake, v.cannon);
      if (P.hock.distanceTo(P.hip) > reach) {
        let lo = 0, hi = 1;
        const dir = new Vector3();
        for (let i = 0; i < 10; i++) {
          const w = (lo + hi) / 2;
          dir.copy(dirRake).lerp(dirHip, w).normalize();
          if (P.hock.copy(P.ankle).addScaledVector(dir, v.cannon).distanceTo(P.hip) > reach) lo = w; else hi = w;
        }
        dir.copy(dirRake).lerp(dirHip, hi).normalize();
        P.hock.copy(P.ankle).addScaledVector(dir, v.cannon);
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
