// Raider vehicles: an arcade car sim, pure maths (no rendering). Give it a ground function and throttle/steer at a
// fixed 120 Hz; it drives the body over the ground and reports the wheel contacts for drawing and dust.
//
// Steering is a bicycle model (yaw rate = speed / wheelbase * tan(steer)), capped by what the tyres can hold plus a
// drift allowance, so hard turns at speed let the heading run ahead of the velocity and the truck slides. Tyres bleed
// off sideways velocity with `grip`, up to `cornerG`; once sliding they hold less (`drift`). Slopes pull along the
// surface (climbs slow it, descents speed it up a little). Four spring-damper wheels carry the body: height, pitch
// and roll come out of them; a hard stop keeps the chassis off the ground, and a heavier fall when airborne keeps
// jumps rare and short.
//
// Conventions: heading 0 faces +Z, +X is the vehicle's left; steer + turns left. pitch + is nose up, roll + is the
// left side up.
import { Vector3, Quaternion, Euler } from "three";
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";

export const CAR_DEFAULTS = {
  // Drive
  topSpeed: 20,
  accel: 7,
  brake: 12,
  reverseSpeed: 6,
  coast: 1.5,
  // Steering and tyres
  maxSteer: 32,
  steerRate: 160,
  steerAtSpeed: 0.45,
  maxYawRate: 120,
  yawResponse: 9,
  grip: 5,
  cornerG: 0.95,
  drift: 0.35,
  maxSlide: 40,
  // Slopes
  climb: 0.85,
  descent: 0.35,
  maxClimb: 36,
  bog: 12,
  // Body and suspension
  wheelbase: 3.2,
  track: 1.9,
  rideHeight: 0.9,
  wheelRadius: 0.45,
  suspFreq: 1.7,
  suspDamp: 0.55,
  travel: 0.3,
  droop: 0.6,
  bumpLoss: 0.25,
  stick: 2.5,
  stickRange: 3,
  airGravity: 2.5,
  airLevel: 1.5,
};
export type CarValues = typeof CAR_DEFAULTS;

const G = "Vehicle";
export const CAR_PARAMS: Param[] = [
  { key: "topSpeed", label: "Top speed (m/s)", min: 4, max: 40, step: 0.5, group: G },
  { key: "accel", label: "Acceleration (m/s²)", min: 1, max: 20, step: 0.1, group: G },
  { key: "brake", label: "Braking (m/s²)", min: 2, max: 30, step: 0.5, group: G },
  { key: "reverseSpeed", label: "Reverse speed (m/s)", min: 1, max: 12, step: 0.5, group: G },
  { key: "coast", label: "Coasting drag (m/s²)", min: 0, max: 6, step: 0.1, group: G, tip: "Slowdown with no throttle (sand)" },
  { key: "maxSteer", label: "Steering lock (°)", min: 10, max: 45, step: 1, group: G },
  { key: "steerRate", label: "Steering speed (°/s)", min: 30, max: 400, step: 5, group: G, tip: "How fast the front wheels turn to the stick" },
  { key: "steerAtSpeed", label: "Lock at top speed", min: 0.1, max: 1, step: 0.01, group: G, tip: "Share of the steering lock left at top speed" },
  { key: "maxYawRate", label: "Max turn rate (°/s)", min: 30, max: 170, step: 1, group: G },
  { key: "yawResponse", label: "Turn response", min: 1, max: 30, step: 0.5, group: G, tip: "How fast the body follows the steering" },
  { key: "grip", label: "Tyre grip", min: 0.5, max: 15, step: 0.1, group: G, tip: "How fast the tyres kill sideways sliding" },
  { key: "cornerG", label: "Cornering limit (g)", min: 0.2, max: 2, step: 0.01, group: G, tip: "Most sideways force the tyres hold" },
  { key: "drift", label: "Drift", min: 0, max: 1, step: 0.01, group: G, tip: "How far the heading runs ahead of the velocity in hard turns, and how much grip goes once sliding" },
  { key: "maxSlide", label: "Max slide angle (°)", min: 10, max: 80, step: 1, group: G, tip: "The slide never gets wider than this (no spin-outs)" },
  { key: "climb", label: "Uphill pull", min: 0, max: 1.5, step: 0.01, group: G, tip: "Share of gravity slowing it on climbs" },
  { key: "descent", label: "Downhill push", min: 0, max: 1.5, step: 0.01, group: G, tip: "Share of gravity speeding it up on descents" },
  { key: "maxClimb", label: "Steepest climb (°)", min: 10, max: 70, step: 1, group: G, tip: "Past this the wheels dig into the sand instead of driving" },
  { key: "bog", label: "Bog on steep faces (m/s²)", min: 0, max: 40, step: 0.5, group: G, tip: "Extra slowdown climbing faces steeper than the steepest climb" },
  { key: "wheelbase", label: "Wheelbase (m)", min: 2, max: 7, step: 0.05, group: G },
  { key: "track", label: "Track width (m)", min: 1.2, max: 3.5, step: 0.05, group: G },
  { key: "rideHeight", label: "Ride height (m)", min: 0.4, max: 2, step: 0.01, group: G, tip: "Body centre above the ground at rest" },
  { key: "wheelRadius", label: "Wheel radius (m)", min: 0.25, max: 1, step: 0.01, group: G },
  { key: "suspFreq", label: "Suspension stiffness (Hz)", min: 0.6, max: 4, step: 0.05, group: G },
  { key: "suspDamp", label: "Suspension damping", min: 0.1, max: 1.5, step: 0.01, group: G },
  { key: "travel", label: "Bump travel (m)", min: 0.05, max: 0.8, step: 0.01, group: G, tip: "Compression before the hard stop" },
  { key: "droop", label: "Droop (m)", min: 0.05, max: 1, step: 0.01, group: G, tip: "How far a wheel hangs down to stay on the ground" },
  { key: "bumpLoss", label: "Bump speed loss", min: 0, max: 1, step: 0.01, group: G, tip: "Forward speed lost per m/s of bottoming out: steep faces slow it like a wall" },
  { key: "stick", label: "Stick to ground (g)", min: 0, max: 5, step: 0.05, group: G, tip: "Extra pull down while the body rides above its rest height, so trucks hug the dunes (0 = launches like a real truck)" },
  { key: "stickRange", label: "Stick range (m)", min: 0.5, max: 10, step: 0.1, group: G, tip: "Above this height over the ground the stick lets go" },
  { key: "airGravity", label: "Air gravity", min: 1, max: 4, step: 0.05, group: G, tip: "Heavier fall when off the ground: short, punchy jumps" },
  { key: "airLevel", label: "Air levelling", min: 0, max: 6, step: 0.1, group: G, tip: "How fast the body levels out in the air" },
];

export type CarKind = "technical" | "gunTruck";
/** Per-kind overrides on CAR_DEFAULTS (the defaults are the technical). */
export const CAR_KINDS: Record<CarKind, Partial<CarValues>> = {
  technical: {},
  gunTruck: {
    topSpeed: 14, accel: 4, brake: 9, reverseSpeed: 4.5, maxSteer: 28, maxYawRate: 80, yawResponse: 6,
    grip: 5.5, cornerG: 0.8, drift: 0.22, wheelbase: 4.6, track: 2.3, rideHeight: 1.15, wheelRadius: 0.6,
    suspFreq: 1.4, travel: 0.35, droop: 0.7,
  },
};

/** Tuning values for a kind: defaults with that kind's overrides. */
export function carValues(kind: CarKind): CarValues { return { ...CAR_DEFAULTS, ...CAR_KINDS[kind] }; }

export interface Wheel {
  /** Contact point on the ground (when airborne: the bottom of the hanging wheel). */
  pos: Vector3;
  /** 0..1: how much it's sliding or spinning (for dust). */
  slip: number;
  /** Spring compression from rest, metres (+ squashed, - hanging). */
  compress: number;
  /** Steering angle, radians (+ left). */
  steer: number;
  /** Rolling angle, radians. */
  spin: number;
  grounded: boolean;
}

const D2R = Math.PI / 180;
const GRAV = 9.81;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Lowest the body centre may sit above the ground right under it. */
const MIN_CENTRE_CLEAR = 0.25;
/** Fastest the body may be thrown upward by the ground (m/s): a safety net, not a feel value. */
const MAX_RISE = 10;

export class CarSim {
  pos = new Vector3();
  heading = 0;
  /** Forward speed along the surface, m/s (signed). */
  speed = 0;
  /** Sideways speed along the surface, m/s (+ left). */
  lateral = 0;
  vel = new Vector3();
  yawRate = 0;
  pitch = 0;
  roll = 0;
  quat = new Quaternion();
  wheels: Wheel[] = [0, 1, 2, 3].map(() => ({ pos: new Vector3(), slip: 0, compress: 0, steer: 0, spin: 0, grounded: true }));
  /** Wheels on the ground this step (0..4). */
  contacts = 4;
  /** Current front wheel angle, radians (+ left). */
  steerAngle = 0;

  private vy = 0;
  private pitchRate = 0;
  private rollRate = 0;
  private groundH = [0, 0, 0, 0];
  private prevGroundH = [0, 0, 0, 0];
  /** Where the wheel spots were sampled (x, z pairs), for the ground slope. */
  private spotX = [0, 0, 0, 0];
  private spotZ = [0, 0, 0, 0];
  private slope = [0, 0];
  private t = { e: new Euler(0, 0, 0, "YXZ"), a: new Vector3(), f: new Vector3(), l: new Vector3() };

  constructor(public v: CarValues, public ground: Ground) {
    this.reset(0, 0, 0);
  }

  /** Wheel mount offsets in the body frame (x left, z forward): FL, FR, RL, RR. */
  private mount(i: number, out: Vector3) {
    const v = this.v;
    return out.set((i % 2 === 0 ? 1 : -1) * v.track / 2, 0, (i < 2 ? 1 : -1) * v.wheelbase / 2);
  }

  reset(x: number, z: number, heading: number) {
    this.heading = heading;
    this.speed = 0; this.lateral = 0; this.yawRate = 0; this.vy = 0; this.steerAngle = 0;
    this.pitchRate = 0; this.rollRate = 0;
    // Start on a plane fitted to the four wheel spots.
    const v = this.v, s = Math.sin(heading), c = Math.cos(heading);
    for (let i = 0; i < 4; i++) {
      const m = this.mount(i, this.t.a);
      this.spotX[i] = x + m.x * c + m.z * s; this.spotZ[i] = z - m.x * s + m.z * c;
      this.groundH[i] = this.ground.height(this.spotX[i], this.spotZ[i]);
      this.prevGroundH[i] = this.groundH[i];
    }
    const [fl, fr, rl, rr] = this.groundH;
    this.groundSlope();
    this.pitch = Math.atan(this.slope[0]);
    this.roll = Math.atan(this.slope[1]);
    this.pos.set(x, (fl + fr + rl + rr) / 4 + v.rideHeight, z);
    this.updateQuat();
    this.vel.set(0, 0, 0);
    this.placeWheels(0, 0);
  }

  /** Ground rise per metre forward and to the left, fitted through the four wheel spots (into this.slope). */
  private groundSlope() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const X = this.spotX, Z = this.spotZ, H = this.groundH;
    const df = ((X[0] + X[1] - X[2] - X[3]) * fx + (Z[0] + Z[1] - Z[2] - Z[3]) * fz) / 2;
    const dl = ((X[0] + X[2] - X[1] - X[3]) * fz - (Z[0] + Z[2] - Z[1] - Z[3]) * fx) / 2;
    this.slope[0] = (H[0] + H[1] - H[2] - H[3]) / 2 / Math.max(0.3, df);
    this.slope[1] = (H[0] + H[2] - H[1] - H[3]) / 2 / Math.max(0.3, dl);
    return this.slope;
  }

  private updateQuat() {
    this.t.e.set(-this.pitch, this.heading, this.roll, "YXZ");
    this.quat.setFromEuler(this.t.e);
  }

  /** throttle -1..1 (negative brakes, then reverses slowly), steer -1..1 (+ = turn left). Call at a fixed 120 Hz. */
  update(dt: number, throttle: number, steer: number) {
    const v = this.v, t = this.t;
    throttle = clamp(Number.isFinite(throttle) ? throttle : 0, -1, 1);
    steer = clamp(Number.isFinite(steer) ? steer : 0, -1, 1);
    const top = Math.max(0.1, v.topSpeed);
    const traction = this.contacts / 4;

    // --- Steering: front wheels slew toward the stick; less lock at speed.
    const spd = Math.abs(this.speed);
    const lock = v.maxSteer * D2R * (1 - (1 - v.steerAtSpeed) * smooth(0, 1, spd / top));
    const want = steer * lock, rate = v.steerRate * D2R * dt;
    this.steerAngle += clamp(want - this.steerAngle, -rate, rate);

    // --- Ground slope under the wheels (rise per metre forward and to the left).
    const [slopeF, slopeL] = this.groundSlope();
    const sinF = slopeF / Math.sqrt(1 + slopeF * slopeF), sinL = slopeL / Math.sqrt(1 + slopeL * slopeL);

    // --- Drive, brake, coast.
    let a = 0;
    if (throttle > 0) {
      if (this.speed < -0.2) a = v.brake * throttle;
      else a = v.accel * throttle * clamp(1 - (this.speed / top) ** 2, 0, 1);
    } else if (throttle < 0) {
      if (this.speed > 0.2) a = v.brake * throttle;
      else a = v.accel * 0.6 * throttle * clamp(1 - (this.speed / v.reverseSpeed) ** 2, 0, 1);
    }
    // Gravity along the surface: climbs pull harder than descents push.
    const pull = -GRAV * sinF;
    const goingUp = pull * Math.sign(this.speed || 1) < 0;
    // Loose sand: past `maxClimb` the wheels dig in instead of driving, and steeper still (slip faces) it bogs down,
    // so trucks go round the slip faces or take them at an angle; only the mech walks straight up.
    const climbAng = goingUp ? Math.asin(Math.min(1, Math.abs(sinF))) : 0;
    const dig = smooth((v.maxClimb - 8) * D2R, v.maxClimb * D2R, climbAng);
    if (goingUp && a * this.speed >= 0) a *= 1 - 0.8 * dig;
    a *= traction;
    a += pull * traction * (goingUp ? v.climb : v.descent);
    // Coasting drag (and the same drag holds the car on a gentle slope when stopped), plus the bog on steep climbs.
    const bog = v.bog * smooth(v.maxClimb * D2R, (v.maxClimb + 20) * D2R, climbAng);
    const drag = ((throttle === 0 ? v.coast : v.coast * 0.3) + bog) * traction;
    let next = this.speed + a * dt;
    if (Math.abs(next) <= drag * dt) next = 0; else next -= Math.sign(next) * drag * dt;
    // Never past top speed (descents push it toward a soft ceiling) or reverse speed.
    if (next > top) next = Math.max(top, next - (next - top) * 4 * dt);
    this.speed = clamp(next, -v.reverseSpeed * 1.05, top * 1.06);

    // --- Yaw: bicycle model, capped by what the tyres hold plus a drift allowance that lets the heading run ahead
    // of the velocity; the allowance closes as the slide widens, so a held drift settles instead of spinning out.
    const bike = (this.speed / v.wheelbase) * Math.tan(this.steerAngle);
    const cornerA = v.cornerG * GRAV;
    const slide0 = Math.atan2(Math.abs(this.lateral), Math.max(0.5, spd));
    const holdA = cornerA * (1 - v.drift * smooth(6 * D2R, 22 * D2R, slide0));
    const allow = 1 + 2 * v.drift * (1 - smooth(0.3 * v.maxSlide * D2R, 0.8 * v.maxSlide * D2R, slide0));
    const yawCap = Math.min(v.maxYawRate * D2R, (holdA / Math.max(1, spd)) * allow);
    const yawTarget = clamp(bike, -yawCap, yawCap);
    if (traction > 0) this.yawRate += (yawTarget - this.yawRate) * (1 - Math.exp(-v.yawResponse * traction * dt));
    else this.yawRate *= Math.exp(-0.5 * dt);
    const dpsi = this.yawRate * dt;
    this.heading += dpsi;
    if (this.heading > Math.PI) this.heading -= 2 * Math.PI; else if (this.heading < -Math.PI) this.heading += 2 * Math.PI;
    // The velocity stays put in the world while the body turns under it.
    const vf = this.speed, vl = this.lateral;
    const cs = Math.cos(dpsi), sn = Math.sin(dpsi);
    this.speed = vf * cs + vl * sn;
    this.lateral = vl * cs - vf * sn;

    // --- Tyres: kill the slide, up to the cornering limit; less grip once sliding (the drift).
    const slideAng = Math.atan2(Math.abs(this.lateral), Math.max(0.5, Math.abs(this.speed)));
    const sliding = smooth(6 * D2R, 22 * D2R, slideAng);
    const latLimit = cornerA * (1 - v.drift * sliding);
    let latA = clamp(-this.lateral * v.grip, -latLimit, latLimit);
    latA -= GRAV * sinL * v.descent; // side slopes push it downhill
    const before = this.lateral;
    this.lateral += latA * traction * dt;
    if (before !== 0 && Math.sign(this.lateral) !== Math.sign(before) && Math.abs(latA) > 0 && traction > 0 && Math.abs(this.lateral) < Math.abs(latA * dt)) this.lateral = 0;
    // Never wider than the max slide angle.
    const maxLat = Math.tan(v.maxSlide * D2R) * Math.max(1, Math.abs(this.speed));
    this.lateral = clamp(this.lateral, -maxLat, maxLat);

    // --- Move over the ground along the body's own axes (so steep climbs cover less ground).
    this.updateQuat();
    const f = t.f.set(0, 0, 1).applyQuaternion(this.quat), l = t.l.set(1, 0, 0).applyQuaternion(this.quat);
    const vx = this.speed * f.x + this.lateral * l.x, vz = this.speed * f.z + this.lateral * l.z;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    // --- Suspension: four spring-dampers carry the body (heave, pitch, roll per unit mass).
    const w0 = 2 * Math.PI * v.suspFreq, kw = (w0 * w0) / 4, cw = (2 * v.suspDamp * w0) / 4;
    const Ip = (v.wheelbase / 2) ** 2, Ir = (v.track / 2) ** 2;
    let fy = 0, tp = 0, tr = 0, contacts = 0, maxGroundRate = -Infinity;
    const cp = Math.cos(this.pitch), cr = Math.cos(this.roll);
    for (let i = 0; i < 4; i++) {
      const m = this.mount(i, t.a);
      const lx = m.x, lz = m.z;
      m.applyQuaternion(this.quat);
      this.prevGroundH[i] = this.groundH[i];
      this.spotX[i] = this.pos.x + m.x; this.spotZ[i] = this.pos.z + m.z;
      const gh = this.ground.height(this.spotX[i], this.spotZ[i]);
      this.groundH[i] = gh;
      const cornerY = this.pos.y + m.y;
      const comp = gh + v.rideHeight - cornerY; // + squashed
      const grounded = comp > -v.droop;
      if (grounded) {
        contacts++;
        const groundRate = (gh - this.prevGroundH[i]) / dt;
        maxGroundRate = Math.max(maxGroundRate, groundRate);
        const cornerRate = this.vy + this.pitchRate * lz * cp + this.rollRate * lx * cr;
        const F = Math.max(0, GRAV / 4 + kw * comp + cw * (groundRate - cornerRate));
        fy += F; tp += F * lz * cp; tr += F * lx * cr;
      }
      this.wheels[i].compress = comp;
      this.wheels[i].grounded = grounded;
    }
    this.contacts = contacts;
    const g = contacts === 0 ? GRAV * v.airGravity : GRAV;
    this.vy += (fy - g) * dt;
    // Stick: an arcade pull toward the ground whenever the body rides above its rest height (cresting, a slip face
    // falling away), fading out higher up, so trucks hug the dunes and only real ramps throw them.
    const gap = this.pos.y - (this.ground.height(this.pos.x, this.pos.z) + v.rideHeight);
    if (gap > 0 && this.vy < 6) this.vy -= v.stick * GRAV * smooth(0, 0.4, gap) * (1 - smooth(v.stickRange * 0.6, v.stickRange, gap)) * dt;
    this.pitchRate += (tp / Ip) * dt;
    this.rollRate += (tr / Ir) * dt;
    if (contacts === 0) {
      // In the air: turn toward the ground below so it lands on its wheels.
      const [sf, sl] = this.groundSlope();
      const pT = Math.atan(sf), rT = Math.atan(sl);
      const k = v.airLevel;
      this.pitchRate += ((pT - this.pitch) * k * k - this.pitchRate * k) * dt;
      this.rollRate += ((rT - this.roll) * k * k - this.rollRate * k) * dt;
    }
    this.pos.y += this.vy * dt;
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -1.4, 1.4);
    this.roll = clamp(this.roll + this.rollRate * dt, -1.0, 1.0);
    this.updateQuat();

    // --- Hard stops: no corner past its bump travel. A corner that bottoms out is pushed up by the body rising and
    // tipping a third each (so a slip face ahead tilts the nose up instead of vaulting the whole truck), and the
    // bump costs forward speed (`bumpLoss`): running into a steep face slows it like a wall would.
    for (let pass = 0; pass < 2; pass++) {
      let hit = false;
      for (let i = 0; i < 4; i++) {
        const m = this.mount(i, t.a);
        const lx = m.x, lz = m.z;
        m.applyQuaternion(this.quat);
        const over = this.groundH[i] + v.rideHeight - v.travel - (this.pos.y + m.y);
        if (over <= 0) continue;
        hit = true;
        const cp2 = Math.max(0.2, Math.cos(this.pitch)), cr2 = Math.max(0.2, Math.cos(this.roll));
        this.pos.y += over / 3;
        this.pitch += over / 3 / (lz * cp2);
        this.roll += over / 3 / (lx * cr2);
        if (pass > 0) continue;
        const groundRate = (this.groundH[i] - this.prevGroundH[i]) / dt;
        const cornerRate = this.vy + this.pitchRate * lz * cp2 + this.rollRate * lx * cr2;
        // Velocity: only stop the corner sinking further (moving it up with the ground is done by position, so a
        // steep face never throws the body into the air); the bump's size still costs speed.
        const dv = Math.min(0, groundRate) - cornerRate;
        const loss = Math.min(Math.abs(this.speed), Math.max(0, groundRate - cornerRate) * v.bumpLoss);
        this.speed -= Math.sign(this.speed) * loss;
        if (dv > 0) {
          this.vy += dv / 3;
          this.pitchRate += dv / 3 / lz;
          this.rollRate += dv / 3 / lx;
        }
      }
      if (!hit) break;
      this.pitch = clamp(this.pitch, -1.4, 1.4);
      this.roll = clamp(this.roll, -1.0, 1.0);
      this.updateQuat();
    }
    if (this.vy > MAX_RISE) this.vy = MAX_RISE;
    // The body centre never into the ground.
    const centreFloor = this.ground.height(this.pos.x, this.pos.z) + MIN_CENTRE_CLEAR;
    if (this.pos.y < centreFloor) { this.pos.y = centreFloor; if (this.vy < 0) this.vy = 0; }

    // Bumps cost forward speed, so hold the slide angle again.
    const latMax = Math.tan(v.maxSlide * D2R) * Math.max(1, Math.abs(this.speed));
    this.lateral = clamp(this.lateral, -latMax, latMax);
    this.vel.set(vx, this.vy, vz);
    this.placeWheels(dt, throttle);
  }

  /** Wheel contacts, steer, spin and slip for drawing and dust. */
  private placeWheels(dt: number, throttle: number) {
    const v = this.v, t = this.t, top = Math.max(0.1, v.topSpeed);
    // Wheelspin pulling away hard, lock-up braking hard.
    const spinUp = throttle > 0 && this.speed >= 0 ? throttle * clamp(1 - this.speed / (top * 0.45), 0, 1) : 0;
    const lockUp = throttle < 0 && this.speed > 1 ? -throttle * 0.6 : 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const m = this.mount(i, t.a);
      const lz = m.z;
      m.applyQuaternion(this.quat);
      const x = this.pos.x + m.x, z = this.pos.z + m.z;
      const front = i < 2;
      w.steer = front ? this.steerAngle : 0;
      if (w.grounded) {
        w.pos.set(x, this.ground.height(x, z), z);
      } else {
        const hang = this.pos.y + m.y - v.rideHeight - v.droop;
        w.pos.set(x, hang, z);
      }
      const roll = this.speed / v.wheelRadius;
      const spinExtra = spinUp * (front ? 0.3 : 1) * 25;
      w.spin += (roll + (w.grounded ? spinExtra : 0)) * dt * (lockUp > 0.5 && w.grounded ? 0.2 : 1);
      if (w.spin > 1e4 || w.spin < -1e4) w.spin %= 2 * Math.PI;
      if (!w.grounded) { w.slip = 0; continue; }
      // Sideways speed of this wheel in its own heading.
      const side = this.lateral + this.yawRate * lz;
      const st = w.steer;
      const across = side * Math.cos(st) - this.speed * Math.sin(st);
      const latSlip = clamp(Math.abs(across) / 5, 0, 1);
      const longSlip = (front ? 0.3 : 1) * spinUp * 0.9 + lockUp;
      w.slip = clamp(latSlip + longSlip, 0, 1);
    }
  }
}
