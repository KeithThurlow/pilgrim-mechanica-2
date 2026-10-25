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
  stats: WalkerStats = { steps: 0, takeoffs: 0, landings: 0, airFrames: 0, overreach: 0, scuffs: 0, frames: 0 };
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
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.phase = 0.05;
    const f = forwardOf(heading), l = leftOf(heading);
    for (const ft of this.feet) {
      ft.swinging = false;
      ft.u = 0;
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
      move(f.planted); move(f.lift); move(f.target); move(f.pos);
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
    if (!this.airborne) {
      this.airborne = true;
      this.airT = 0;
      this.airY = this.pelvis.y;
      this.squatState = null;
      this.stats.takeoffs++;
      for (const f of this.feet) { f.airRel.subVectors(f.pos, this.pelvis); f.swinging = false; f.u = 0; f.stanceT = 0; }
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
    if (this.airborne) { this.stats.airFrames++; this.fly(dt, cmd); this.pose(); return; }
    if (this.squatState) { this.squatState.t += dt; if (this.squatState.t >= this.squatState.down + this.squatState.up) this.squatState = null; }

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
    this.accelSmooth += ((this.speed - prev) / dt - this.accelSmooth) * Math.min(1, dt * 6);
    forwardOf(this.heading, this.vel).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    // Landing skid: dies off at landFriction.
    const sk = this.skid.length();
    if (sk > 1e-4) this.skid.multiplyScalar(Math.max(0, sk - v.landFriction * dt) / sk);
    const sx = (this.push.x + this.skid.x) * dt, sz = (this.push.z + this.skid.z) * dt;
    if (sx * sx + sz * sz > 1e-12) {
      // Skid: the body is shoved and the planted feet slide with it, kept on the sand.
      this.pos.x += sx; this.pos.z += sz;
      for (const f of this.feet) {
        if (f.swinging) { f.lift.x += sx; f.lift.z += sz; f.target.x += sx; f.target.z += sz; this.groundAt(f.target, f.targetUp); continue; }
        f.planted.x += sx; f.planted.z += sz;
        this.groundAt(f.planted, f.plantedUp);
      }
    }
    if (this.leaves()) { this.stats.airFrames++; this.fly(dt, cmd); this.pose(); return; }

    // Gait phase.
    const S = this.stride(), d = this.duty();
    const anySwing = this.feet[0].swinging || this.feet[1].swinging;
    let cps = this.speed / S;
    if (anySwing) cps = Math.max(cps, MIN_CYCLE);
    // Standing: step a foot back under the body if it's out of place, once any landing squat is over (both feet stay
    // planted through the squat).
    else if (this.speed < 0.08) { cps = 0; if (!this.squatState) this.settle(d); }
    // A planted leg near full stretch (sharp turns, steep ground) hurries the steps instead of overreaching.
    cps *= 1 + 1.5 * smooth(0.9, 1, this.stretch());
    this.phase = (this.phase + cps * dt) % 1;

    for (const f of this.feet) {
      const p = (this.phase + f.offset) % 1;
      const swing = p >= d;
      if (swing && !f.swinging) this.liftOff(f);
      else if (!swing && f.swinging) this.land(f);
      if (f.swinging) {
        f.u = (p - d) / (1 - d);
        f.stanceT = 0;
        if (f.u < RE_AIM_UNTIL) this.aim(f);
      } else {
        f.stanceT = p / d;
      }
      this.moveFoot(f);
    }

    this.body(dt, d);
    this.pose();
  }

  /**
   * Does the ground fall away faster than the body can follow? Over a crest at speed s the path's curvature c (1/m)
   * needs a downward pull of c s²; past leaveG × gravity the mech takes off with the climb it carried to the crest.
   */
  private leaves() {
    const v = this.v;
    const mx = this.vel.x + this.push.x + this.skid.x, mz = this.vel.z + this.push.z + this.skid.z;
    const s = Math.hypot(mx, mz);
    if (s < Math.max(0.5, v.leaveMin) || (this.squatState !== null && this.squatState.t < AIR_MIN)) return false;
    const dx = mx / s, dz = mz / s, L = clamp(s * 0.12, 0.8, 2.5);
    const h0 = this.ground.height(this.pos.x, this.pos.z);
    const hf = this.ground.height(this.pos.x + dx * L, this.pos.z + dz * L);
    const hb = this.ground.height(this.pos.x - dx * L, this.pos.z - dz * L);
    const pull = -((hf - 2 * h0 + hb) / (L * L)) * s * s;
    if (pull <= G * v.leaveG) return false;
    // Off along the ground it was on: the walk (and any skid) is the flight; a dash's shove stays outside, added each step.
    this.launch(this.vel.x + this.skid.x, s * ((h0 - hb) / L), this.vel.z + this.skid.z);
    return true;
  }

  /** One step in the air: ballistic hips, a little steering, the legs tucking or reaching, touchdown. */
  private fly(dt: number, cmd: MoveCommand) {
    const v = this.v, a = this.airVel;
    this.airT += dt;
    const mag = Math.min(1, Math.hypot(cmd.x, cmd.z));
    if (mag > 0.05 && v.airSteer > 0) {
      const err = wrap(Math.atan2(cmd.x, cmd.z) - this.heading);
      const max = v.turnRate * v.airSteer * D2R * dt;
      const dh = clamp(err, -max, max);
      this.heading = wrap(this.heading + dh);
      this.turnSpeed = dh / dt;
    } else this.turnSpeed = 0;
    a.y -= G * dt;
    this.pos.x += (a.x + this.push.x) * dt;
    this.pos.z += (a.z + this.push.z) * dt;
    this.airY += a.y * dt;
    this.vel.set(a.x, 0, a.z);
    const fw = forwardOf(this.heading, this.t.f), lf = leftOf(this.heading, this.t.l);
    this.speed = Math.max(0, a.x * fw.x + a.z * fw.z);

    // Legs: tucked while rising fast, reaching for the ground falling; a little wider than standing, left foot ahead.
    this.airExt = clamp((1.5 - a.y) / 4, 0, 1);
    const len = v.hipHeight * (v.airTuck + (v.airReach - v.airTuck) * this.airExt);
    const k = 1 - Math.exp(-dt * 12);
    let touch = false;
    for (const f of this.feet) {
      const side = v.footSpread * v.airSpread * f.side, ahead = v.airFore + (f.side * this.airLead * v.airSplit) / 2;
      const rel = this.t.b.set(lf.x * side + fw.x * ahead, -len, lf.z * side + fw.z * ahead);
      f.airRel.lerp(rel, k);
      f.pos.set(this.pos.x + f.airRel.x, this.airY + f.airRel.y, this.pos.z + f.airRel.z);
      const g = this.ground.height(f.pos.x, f.pos.z);
      if (f.pos.y <= g + 0.01) {
        f.pos.y = g;
        if (a.y < 0 && this.airT > AIR_MIN) touch = true;
      }
      f.swinging = false; f.u = 0; f.stanceT = 0;
      f.up.copy(UP);
      f.yaw = this.heading + f.side * v.toeOut * D2R;
      // Toes droop while tucked, flat for the landing.
      f.pitch = 0.35 * (1 - this.airExt);
      f.toe = 0.3 * (1 - this.airExt);
      f.groundY = g;
    }

    // Body: pitches with the flight path, levels its roll, rides the flight.
    const hs = Math.hypot(a.x, a.z);
    this.pitch.step(-v.airPitch * Math.atan2(a.y, Math.max(3, hs)) + this.leanPitch, dt);
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
      f.planted.copy(f.pos);
      this.groundAt(f.planted, f.plantedUp);
      f.pos.copy(f.planted); f.up.copy(f.plantedUp);
      f.plantedYaw = f.yaw;
      f.swinging = false; f.u = 0; f.stanceT = 0; f.pitch = 0; f.toe = 0;
      f.groundY = f.planted.y;
      const gn = this.ground.normal(f.planted.x, f.planted.z, this.t.n);
      n.x += gn[0]; n.y += gn[1]; n.z += gn[2];
    }
    // How hard it hits is the speed into the ground: landing along a slip face it was flying down is gentle.
    n.normalize();
    const impact = Math.max(0, -(a.x * n.x + a.y * n.y + a.z * n.z));
    // The foot that reached ahead starts its stance, the other is late in its stance.
    this.phase = this.airLead >= 0 ? 0 : 0.5;
    // What's left runs on along the ground (a slope turns some of the fall into speed down it).
    const fw = forwardOf(this.heading, this.t.f);
    const tx = a.x + n.x * impact, ty = a.y + n.y * impact, tz = a.z + n.z * impact;
    const tl = Math.hypot(tx, ty, tz), hl = Math.hypot(tx, tz);
    const gx = hl > 1e-6 ? (tx / hl) * tl : 0, gz = hl > 1e-6 ? (tz / hl) * tl : 0;
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
    f.swinging = true;
    f.u = 0;
    f.lift.copy(f.pos);
    f.liftYaw = f.yaw;
    f.liftPitch = f.pitch;
    f.liftToe = f.toe;
    f.liftUp.copy(f.plantedUp);
    f.liftTheta = f.theta;
    this.aim(f);
    this.onLiftOff?.(f, clamp(this.speed / Math.max(0.1, this.v.walkSpeed), 0, 2));
  }

  private land(f: Foot) {
    f.swinging = false;
    f.u = 0;
    f.planted.copy(f.target);
    f.plantedUp.copy(f.targetUp);
    f.plantedYaw = f.targetYaw;
    this.stats.steps++;
    const k = clamp(0.5 + this.speed / Math.max(0.1, this.v.walkSpeed) * 0.5, 0.4, 1.6) * (1 + this.v.stomp * 0.5);
    this.impact.v -= this.v.impact * 0.25 * k;
    this.onFootfall?.(f, k);
  }

  /** Landing spot: where this foot belongs when the body gets there, on the ground. */
  private aim(f: Foot) {
    const v = this.v, d = this.duty(), S = this.stride();
    const cps = Math.max(this.speed / S, MIN_CYCLE);
    const remain = ((1 - f.u) * (1 - d)) / cps;
    const h = this.heading + this.turnSpeed * remain * 0.5;
    const fw = forwardOf(h, this.t.f), lf = leftOf(h, this.t.l);
    // Downhill the feet plant in closer under the body, so the legs don't reach out ahead and tiptoe down.
    const ahead = d * S * (0.5 - v.stanceBack) * smooth(0, 0.6, this.speed) * (1 - v.downhillPlant * smooth(0, 0.35, -this.grade));
    f.target.copy(this.pos).addScaledVector(this.vel, remain).addScaledVector(fw, ahead).addScaledVector(lf, f.side * this.spread());
    this.groundAt(f.target, f.targetUp);
    f.targetYaw = h + f.side * v.toeOut * D2R;
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
      const roll = v.rollOff * D2R * smooth(v.rollStart, 1, f.stanceT);
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
    const hold = v.liftHold;
    const travel = clamp((u - hold) / Math.max(0.05, 1 - hold - stompT), 0, 1);
    const pw = 1 + 2 * v.liftBox;
    const e = travel < 0.5 ? 0.5 * Math.pow(2 * travel, pw) : 1 - 0.5 * Math.pow(2 - 2 * travel, pw);

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
  }

  private body(dt: number, d: number) {
    const v = this.v;
    const [a, b] = this.feet;
    const avg = (a.groundY + b.groundY) / 2, low = Math.min(a.groundY, b.groundY);
    const under = this.ground.height(this.pos.x, this.pos.z);
    const ref = (avg + (low - avg) * v.downhillReach) * 0.7 + under * 0.3;
    // Walking the hips are highest over the planted foot (vaulting); running they sink onto it and spring off.
    const run = this.runShare();
    const bob = v.bob * Math.cos(4 * Math.PI * (this.phase - d / 2)) * smooth(0.05, 1, this.speed) * (1 - 2 * v.runBounce * run);
    const down = smooth(0, 0.35, -this.grade);
    this.bodyY.step(ref + v.hipHeight - v.downhillCrouch * down - v.runCrouch * run - this.crouch, dt);
    this.impact.step(0, dt);

    // Weight onto the planted leg: shift over it, roll the pelvis down onto it.
    const shift = (a.swinging ? 0 : 1) * a.side + (b.swinging ? 0 : 1) * b.side; // +1 left planted only, -1 right only
    this.lat.step(shift * v.weightShift, dt);
    this.roll.step(-shift * v.crunchRoll * D2R + this.leanRoll, dt);

    // Pitch with the ground along the heading, and lean into acceleration.
    // Downhill the body tips forward less (it keeps its weight back over the feet).
    const fw = forwardOf(this.heading, this.t.f);
    const slope = Math.atan(this.grade);
    const pitchShare = slope < 0 ? v.slopePitch * v.downhillLevel : v.slopePitch;
    this.pitch.step(-slope * pitchShare + (clamp(this.accelSmooth / 3, -1, 1) * v.speedLean + v.moveLean * clamp(this.speed / Math.max(0.1, v.walkSpeed), 0, 1.6) + v.landPitch * Math.max(0, this.squat) / Math.max(0.1, v.landSquatMax)) * D2R + this.leanPitch, dt);

    // Weight back over the feet downhill: the hips sit back from the body point the feet are placed around.
    const back = v.downhillSitBack * down;
    const l = leftOf(this.heading, this.t.l);
    this.pelvis.set(this.pos.x + l.x * this.lat.x - fw.x * back, this.bodyY.x + this.impact.x + bob - this.squat, this.pos.z + l.z * this.lat.x - fw.z * back);
    this.pelvisQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x, "YXZ"));
    this.hullQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x * (1 - v.shoulderLevel), "YXZ"));
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
      forwardOf(this.heading + f.side * (v.kneeOut + f.splay) * D2R, P.legFwd);
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
      } else {
        theta = rake + v.hockCompress * D2R * (1 + Math.max(0, -this.impact.x) * 20);
        const ext = v.hockExtend * smooth(0.3, 1, f.stanceT);
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
