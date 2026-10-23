// Procedural digitigrade walker: pure simulation, no rendering. Give it a ground function and a stick each frame;
// it moves the body, times the steps, places each foot on the ground, and solves the legs.
//
//   hip -> knee (bends forward) -> hock (bends back) -> ankle -> foot plate, three toes
//
// Gait: one phase drives both feet half a cycle apart. A foot is planted (world-locked) for `duty` of the cycle and
// swings for the rest. At lift-off it picks a landing spot where the body will be when it lands, on the ground
// there, tilted to the slope; it re-aims while the body turns, then locks before the stomp.
// Body: rides on the feet (dropping toward the lower one on slopes), shifts and rolls onto the planted leg,
// thuds on each footfall; the hull counter-rolls to stay level.
import { Vector3, Quaternion, Euler, Matrix4 } from "three";
import type { WalkerValues } from "./walkerTuning";

export interface Ground {
  height(x: number, z: number): number;
  normal(x: number, z: number, out?: number[]): number[];
}

/** Desired move direction in world x/z; length 0..1 is the stick amount. */
export interface MoveCommand { x: number; z: number; sprint: boolean }

export interface LegPose {
  hip: Vector3; knee: Vector3; hock: Vector3; ankle: Vector3; foot: Vector3; toe: Vector3;
  /** Foot plate orientation (y up off the sole, z toward the toes). */
  footQ: Quaternion;
  /** The leg's bending plane forward direction. */
  legFwd: Vector3;
}

const D2R = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const TOE_LEN = 0.55;
const MIN_CYCLE = 0.55; // cycles/s used to finish a step when the body has stopped
const RE_AIM_UNTIL = 0.72; // swing progress after which the landing spot is locked
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
  /** Stance progress 0..1 (0 while swinging). */
  stanceT = 0;
  planted = new Vector3(); plantedUp = new Vector3(0, 1, 0); plantedYaw = 0;
  lift = new Vector3(); liftYaw = 0; liftPitch = 0; liftUp = new Vector3(0, 1, 0);
  target = new Vector3(); targetUp = new Vector3(0, 1, 0); targetYaw = 0;
  /** Current plate centre, up, yaw and toe-down pitch. */
  pos = new Vector3(); up = new Vector3(0, 1, 0); yaw = 0; pitch = 0;
  /** Ground height the body rides on for this foot. */
  groundY = 0;
  /** Cannon angle back from the hip-ankle line (radians), and its value at lift-off. */
  theta = 0;
  liftTheta = 0;
  pose: LegPose = {
    hip: new Vector3(), knee: new Vector3(), hock: new Vector3(), ankle: new Vector3(), foot: new Vector3(), toe: new Vector3(),
    footQ: new Quaternion(), legFwd: new Vector3(),
  };
  constructor(public side: 1 | -1, public offset: number) {}
}

export interface WalkerStats {
  steps: number;
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
  stats: WalkerStats = { steps: 0, overreach: 0, scuffs: 0, frames: 0 };
  /** Called on each footfall with the foot and a strength around 1. */
  onFootfall: ((f: Foot, strength: number) => void) | null = null;

  private bodyY = new Spring(70, 16);
  private impact = new Spring(260, 30);
  private lat = new Spring(140, 24);
  private roll = new Spring(120, 22);
  private pitch = new Spring(60, 15);
  private accelSmooth = 0;
  private t = { f: new Vector3(), l: new Vector3(), a: new Vector3(), b: new Vector3(), n: [0, 1, 0], e: new Euler(), m: new Matrix4() };

  constructor(public v: WalkerValues, public ground: Ground) {
    this.reset(0, 0, 0);
  }

  /** Body pitch (nose down +) and roll (left side up +), radians: for an upper body riding on the hips. */
  get bodyPitch() { return this.pitch.x; }
  get bodyRoll() { return this.roll.x; }

  reset(x: number, z: number, heading: number) {
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

  stride() { return this.v.strideBase + this.v.stridePerSpeed * this.speed; }
  /** Each foot's distance from the centre line: footSpread standing, coming in to walkSpread once moving. */
  spread() { return this.v.footSpread + (this.v.walkSpread - this.v.footSpread) * clamp(this.speed / 1.5, 0, 1); }
  duty() { return this.v.duty + (this.v.dutyFast - this.v.duty) * clamp(this.speed / Math.max(0.1, this.v.sprintSpeed), 0, 1); }

  update(dt: number, cmd: MoveCommand) {
    if (dt <= 0) return;
    const v = this.v;
    this.stats.frames++;

    // Heading swings toward the stick at a capped rate, and the walk slows through the turn.
    const mag = Math.min(1, Math.hypot(cmd.x, cmd.z));
    let want = 0;
    if (mag > 0.05) {
      const err = wrap(Math.atan2(cmd.x, cmd.z) - this.heading);
      const max = v.turnRate * D2R * dt;
      const dh = clamp(err, -max, max);
      this.heading = wrap(this.heading + dh);
      this.turnSpeed = dh / dt;
      want = mag * (cmd.sprint ? v.sprintSpeed : v.walkSpeed) * (1 - v.turnSlow * Math.min(1, Math.abs(err) / (Math.PI / 2)));
    } else this.turnSpeed = 0;
    const prev = this.speed;
    const rate = want > this.speed ? v.accel : v.decel;
    this.speed += clamp(want - this.speed, -rate * dt, rate * dt);
    this.accelSmooth += ((this.speed - prev) / dt - this.accelSmooth) * Math.min(1, dt * 6);
    forwardOf(this.heading, this.vel).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);

    // Gait phase.
    const S = this.stride(), d = this.duty();
    const anySwing = this.feet[0].swinging || this.feet[1].swinging;
    let cps = this.speed / S;
    if (anySwing) cps = Math.max(cps, MIN_CYCLE);
    else if (this.speed < 0.08) { cps = 0; this.settle(d); }
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
    f.liftUp.copy(f.plantedUp);
    f.liftTheta = f.theta;
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
    const ahead = d * S * (0.5 - v.stanceBack) * smooth(0, 0.6, this.speed);
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
      // Planted; late in the stance the heel lifts and the foot rolls over its toes.
      const roll = v.rollOff * D2R * smooth(0.78, 1, f.stanceT);
      f.up.copy(f.plantedUp);
      f.yaw = f.plantedYaw;
      f.pitch = roll;
      f.pos.copy(f.planted);
      if (roll > 0) {
        // Pivot the plate centre about the toe tip.
        const fw = this.plateForward(f.plantedUp, f.plantedYaw, this.t.f);
        const tip = this.t.b.copy(f.planted).addScaledVector(fw, TOE_LEN);
        const axis = this.t.a.crossVectors(f.plantedUp, fw).normalize(); // points to the foot's left
        f.pos.sub(tip).applyAxisAngle(axis, roll).add(tip);
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
    const gToe = this.ground.height(f.pos.x + Math.sin(f.yaw) * TOE_LEN, f.pos.z + Math.cos(f.yaw) * TOE_LEN);
    y = Math.max(y, Math.max(g, gToe) + v.footClear * liftK);
    f.pos.y = y;
    if (y < g - 0.02) this.stats.scuffs++;

    f.up.copy(f.liftUp).lerp(f.targetUp, e).normalize();
    f.yaw = f.liftYaw + wrap(f.targetYaw - f.liftYaw) * e;
    f.pitch = f.liftPitch * (1 - smooth(0, 0.45, u)) + v.swingCurl * D2R * Math.sin(Math.PI * Math.min(1, u / Math.max(0.3, 1 - stompT))) * (1 - smooth(1 - stompT, 1, u));
    f.groundY = baseY;
  }

  private body(dt: number, d: number) {
    const v = this.v;
    const [a, b] = this.feet;
    const avg = (a.groundY + b.groundY) / 2, low = Math.min(a.groundY, b.groundY);
    const under = this.ground.height(this.pos.x, this.pos.z);
    const ref = (avg + (low - avg) * v.downhillReach) * 0.7 + under * 0.3;
    const bob = v.bob * Math.cos(4 * Math.PI * (this.phase - d / 2)) * smooth(0.05, 1, this.speed);
    this.bodyY.step(ref + v.hipHeight, dt);
    this.impact.step(0, dt);

    // Weight onto the planted leg: shift over it, roll the pelvis down onto it.
    const shift = (a.swinging ? 0 : 1) * a.side + (b.swinging ? 0 : 1) * b.side; // +1 left planted only, -1 right only
    this.lat.step(shift * v.weightShift, dt);
    this.roll.step(-shift * v.crunchRoll * D2R, dt);

    // Pitch with the ground along the heading, and lean into acceleration.
    const fw = forwardOf(this.heading, this.t.f);
    const hA = this.ground.height(this.pos.x + fw.x * 2, this.pos.z + fw.z * 2);
    const hB = this.ground.height(this.pos.x - fw.x * 2, this.pos.z - fw.z * 2);
    const slope = Math.atan((hA - hB) / 4);
    this.pitch.step(-slope * v.slopePitch + clamp(this.accelSmooth / 3, -1, 1) * v.speedLean * D2R, dt);

    const l = leftOf(this.heading, this.t.l);
    this.pelvis.set(this.pos.x + l.x * this.lat.x, this.bodyY.x + this.impact.x + bob, this.pos.z + l.z * this.lat.x);
    this.pelvisQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x, "YXZ"));
    this.hullQ.setFromEuler(this.t.e.set(this.pitch.x, this.heading, this.roll.x * (1 - v.shoulderLevel), "YXZ"));
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
      P.toe.copy(f.pos).addScaledVector(fwNow, TOE_LEN);
      P.ankle.copy(f.pos).addScaledVector(upNow, v.ankleHeight).addScaledVector(fwNow, -v.ankleBack);

      forwardOf(this.heading + f.side * v.kneeOut * D2R, P.legFwd);
      const reach = v.femur + v.shin - 0.002;

      // Cannon angle, measured back from the hip-ankle line in the leg plane, so the whole lower leg pitches as the
      // leg swings under the body. Planted: the rake, compressed a little under load, opening toward a straight
      // lower leg (cannon in line with the shin) as the foot trails into push-off. Swinging: back to the rake from
      // the lift-off angle, with a tuck in the middle that lifts the foot.
      const toHip = new Vector3().subVectors(P.hip, P.ankle);
      const planeUp = toHip.clone().addScaledVector(P.legFwd, -toHip.dot(P.legFwd)).normalize();
      const rake = v.cannonRake * D2R;
      let theta: number;
      if (f.swinging) {
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
