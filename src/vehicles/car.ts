// Raider vehicles: an arcade car sim, pure maths (no rendering). Give it a ground function and throttle/steer at a
// fixed 120 Hz; it drives the body over the ground and reports the wheel contacts for drawing and dust.
//
// Steering is a bicycle model (yaw rate = speed / wheelbase * tan(steer)), capped by what the tyres can hold plus a
// drift allowance, so hard turns at speed let the heading run ahead of the velocity and the truck slides. Tyres bleed
// off sideways velocity with `grip`, up to `cornerG`; once sliding they hold less (`drift`). Slopes pull along the
// surface (climbs slow it, descents speed it up a little). Spring-damper wheels carry the body: height, pitch and
// roll come out of them; a hard stop keeps the chassis off the ground, and a heavier fall when airborne keeps jumps
// rare and short.
//
// Axles: a kind has a steering group at the front (`frontAxles`, the second one steering `steer2` as much) and a
// driven group at the back (`rearAxles`), `axleGap` apart within a group; `wheelbase` runs between the two groups'
// centres. Tandem axles scrub in turns (`tandemScrub`), so six- and eight-wheelers turn wider. Wheels are listed
// axle by axle from the front, left then right (a four-wheeler is FL, FR, RL, RR as before).
// Tracked kinds (`tracked` 1) skid-steer: steer is a turn rate (`pivotRate`, also at a standstill), no drift; the
// "wheels" are the road wheels along each track (`roadWheels` per side over `wheelbase`).
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
  // Axles (layout values are per kind, not sliders: the body is built from them)
  frontAxles: 1,
  rearAxles: 1,
  axleGap: 1.4,
  steer2: 0.7,
  tandemScrub: 0.8,
  // Tracks (tracked kinds only)
  tracked: 0,
  roadWheels: 5,
  pivotRate: 40,
  pivotAtSpeed: 0.6,
  pivotDrag: 2,
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
  { key: "axleGap", label: "Axle gap (m)", min: 0.9, max: 2.5, step: 0.05, group: G, tip: "Between axles in a group (six- and eight-wheelers, road wheels)" },
  { key: "steer2", label: "Second axle steer share", min: 0, max: 1, step: 0.01, group: G, tip: "How much the second steering axle turns, of the first (eight-wheelers)" },
  { key: "tandemScrub", label: "Tandem scrub", min: 0, max: 2, step: 0.01, group: G, tip: "Extra wheelbase per extra axle: tandem axles fight the turn, so big trucks turn wider" },
  { key: "pivotRate", label: "Tracks: turn rate (°/s)", min: 5, max: 120, step: 1, group: G, tip: "Skid steering: how fast a tracked vehicle turns, also on the spot" },
  { key: "pivotAtSpeed", label: "Tracks: turn at top speed", min: 0.1, max: 1, step: 0.01, group: G, tip: "Share of the turn rate left at top speed" },
  { key: "pivotDrag", label: "Tracks: turning drag (m/s²)", min: 0, max: 10, step: 0.1, group: G, tip: "Slowdown while the tracks drive against each other" },
];

export type CarKind = "technical" | "gunTruck" | "sixWheeler" | "warRig" | "tank";
/** Per-kind overrides on CAR_DEFAULTS (the defaults are the technical). */
export const CAR_KINDS: Record<CarKind, Partial<CarValues>> = {
  technical: {},
  gunTruck: {
    topSpeed: 14, accel: 4, brake: 9, reverseSpeed: 4.5, maxSteer: 28, maxYawRate: 80, yawResponse: 6,
    grip: 5.5, cornerG: 0.8, drift: 0.22, wheelbase: 4.6, track: 2.3, rideHeight: 1.15, wheelRadius: 0.6,
    suspFreq: 1.4, travel: 0.35, droop: 0.7,
  },
  // A heavier gun truck on three axles (one steering, two driven), an autocannon on a ring; about 7.5 m long.
  sixWheeler: {
    topSpeed: 12, accel: 3.2, brake: 8, reverseSpeed: 4, maxSteer: 30, maxYawRate: 65, yawResponse: 5,
    grip: 6, cornerG: 0.75, drift: 0.15, wheelbase: 4.3, track: 2.3, rideHeight: 1.2, wheelRadius: 0.6,
    suspFreq: 1.3, travel: 0.35, droop: 0.7, rearAxles: 2, axleGap: 1.4, maxClimb: 34, climb: 0.6,
  },
  // The war band's lead truck: an armoured hauler on four axles, the front two steering; about 11.5 m long.
  warRig: {
    topSpeed: 11, accel: 2.6, brake: 6, reverseSpeed: 3, coast: 1.2, maxSteer: 30, steerRate: 100, maxYawRate: 45,
    yawResponse: 3.5, grip: 6, cornerG: 0.6, drift: 0.1, maxSlide: 25, wheelbase: 6.4, track: 2.5, rideHeight: 1.35,
    wheelRadius: 0.7, suspFreq: 1.2, suspDamp: 0.6, travel: 0.4, droop: 0.8, frontAxles: 2, rearAxles: 2,
    axleGap: 1.55, steer2: 0.7, maxClimb: 32, climb: 0.45, airGravity: 3,
  },
  // A makeshift tank on tracks: turns on the spot, slow, very heavy, a big slow turret.
  tank: {
    topSpeed: 8, accel: 3, brake: 7, reverseSpeed: 3.5, coast: 1.5, climb: 0.5, yawResponse: 4, grip: 12, cornerG: 1.2,
    drift: 0, maxSlide: 12, wheelbase: 4.4, track: 2.9, rideHeight: 0.95, wheelRadius: 0.36, suspFreq: 1.5,
    suspDamp: 0.8, travel: 0.25, droop: 0.35, maxClimb: 40, bog: 8, airGravity: 3, tracked: 1, roadWheels: 5,
    pivotRate: 36, pivotAtSpeed: 0.6, pivotDrag: 0.8,
  },
};

/** Tuning values for a kind: defaults with that kind's overrides. */
export function carValues(kind: CarKind): CarValues { return { ...CAR_DEFAULTS, ...CAR_KINDS[kind] }; }

export interface Axle {
  /** Offset from the body centre along the body, metres (+ forward). */
  z: number;
  /** Share of the steering angle (0 = fixed). */
  steer: number;
  drive: boolean;
}

/** The axles front to back, from a kind's layout values (two wheels each: left then right). */
export function carAxles(v: CarValues): Axle[] {
  const out: Axle[] = [];
  if (v.tracked) {
    const n = Math.max(2, Math.round(v.roadWheels));
    for (let k = 0; k < n; k++) out.push({ z: v.wheelbase / 2 - (k * v.wheelbase) / (n - 1), steer: 0, drive: true });
    return out;
  }
  const nF = clamp(Math.round(v.frontAxles), 1, 3), nR = clamp(Math.round(v.rearAxles), 1, 4);
  for (let k = 0; k < nF; k++) out.push({ z: v.wheelbase / 2 + ((nF - 1) / 2 - k) * v.axleGap, steer: v.steer2 ** k, drive: false });
  for (let k = 0; k < nR; k++) out.push({ z: -v.wheelbase / 2 + ((nR - 1) / 2 - k) * v.axleGap, steer: 0, drive: true });
  return out;
}

/** Overall length over the outer axles (for hit capsules and wrecks): add the overhangs. */
export function axleSpan(v: CarValues) {
  const a = carAxles(v);
  return a[0].z - a[a.length - 1].z;
}

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

const newWheel = (): Wheel => ({ pos: new Vector3(), slip: 0, compress: 0, steer: 0, spin: 0, grounded: true });
/** Wheels nearer the body centre than this (along it) bottom out by lifting the body, not tipping it. */
const CENTRE_BAND = 0.5;
/** Corner a wheel bottoms out in: front/back/middle x left/right. */
const cornerOf = (mx: number, mz: number) => (Math.abs(mz) < CENTRE_BAND ? 2 : mz > 0 ? 0 : 1) * 2 + (mx > 0 ? 0 : 1);

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
  /** Axle by axle from the front, left then right (a four-wheeler: FL, FR, RL, RR). Tracked: road wheels. */
  wheels: Wheel[] = [];
  /** The axles front to back (from the layout values; the wheel list is rebuilt if their number changes). */
  axles: Axle[] = [];
  /** Wheels on the ground this step (0..wheels.length). */
  contacts = 4;
  /** Current steering angle of the front axle, radians (+ left); 0 on tracked kinds. */
  steerAngle = 0;

  private vy = 0;
  private pitchRate = 0;
  private rollRate = 0;
  private groundH: number[] = [];
  private prevGroundH: number[] = [];
  /** Where the wheel spots were sampled (x, z), for the ground slope. */
  private spotX: number[] = [];
  private spotZ: number[] = [];
  /** Per wheel: mount offset in the body frame (x left, z forward), steer share, driven. */
  private mx: number[] = [];
  private mz: number[] = [];
  private share: number[] = [];
  private driven: boolean[] = [];
  private over: number[] = [];
  private worst: number[] = [-1, -1, -1, -1, -1, -1];
  /** Wheelbase the bicycle model turns on: the groups' spacing plus tandem scrub. */
  private wbEff = 1;
  private slope = [0, 0];
  private t = { e: new Euler(0, 0, 0, "YXZ"), a: new Vector3(), f: new Vector3(), l: new Vector3() };

  constructor(public v: CarValues, public ground: Ground) {
    this.reset(0, 0, 0);
  }

  /** Indices of the rearmost axle's wheels (left, right): where the tyre ruts are laid. */
  rearWheels(): number[] {
    const n = this.wheels.length;
    return [n - 2, n - 1];
  }

  /** Axles and wheel mounts from the current values (every step, so the sliders apply live). */
  private layout() {
    const v = this.v;
    this.axles = carAxles(v);
    const n = this.axles.length * 2;
    if (this.wheels.length !== n) {
      this.wheels = Array.from({ length: n }, newWheel);
      for (const a of [this.groundH, this.prevGroundH, this.spotX, this.spotZ, this.mx, this.mz, this.share, this.over]) a.length = n;
      this.driven.length = n;
    }
    for (let k = 0; k < this.axles.length; k++) {
      const a = this.axles[k];
      for (let sd = 0; sd < 2; sd++) {
        const i = k * 2 + sd;
        this.mx[i] = (sd === 0 ? 1 : -1) * v.track / 2;
        this.mz[i] = a.z;
        this.share[i] = a.steer;
        this.driven[i] = a.drive;
      }
    }
    this.wbEff = v.tracked ? v.wheelbase : v.wheelbase + v.tandemScrub * v.axleGap * Math.max(0, this.axles.length - 2);
  }

  /** Wheel mount offset in the body frame (x left, z forward). */
  private mount(i: number, out: Vector3) {
    return out.set(this.mx[i], 0, this.mz[i]);
  }

  reset(x: number, z: number, heading: number) {
    this.layout();
    this.heading = heading;
    this.speed = 0; this.lateral = 0; this.yawRate = 0; this.vy = 0; this.steerAngle = 0;
    this.pitchRate = 0; this.rollRate = 0;
    // Start on a plane fitted to the wheel spots.
    const v = this.v, s = Math.sin(heading), c = Math.cos(heading), n = this.wheels.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const m = this.mount(i, this.t.a);
      this.spotX[i] = x + m.x * c + m.z * s; this.spotZ[i] = z - m.x * s + m.z * c;
      this.groundH[i] = this.ground.height(this.spotX[i], this.spotZ[i]);
      this.prevGroundH[i] = this.groundH[i];
      sum += this.groundH[i];
    }
    this.groundSlope();
    this.pitch = Math.atan(this.slope[0]);
    this.roll = Math.atan(this.slope[1]);
    this.pos.set(x, sum / n + v.rideHeight, z);
    this.updateQuat();
    this.vel.set(0, 0, 0);
    this.placeWheels(0, 0);
  }

  /** Ground rise per metre forward and to the left, a least-squares fit through the wheel spots (into this.slope). */
  private groundSlope() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const X = this.spotX, Z = this.spotZ, H = this.groundH, n = this.wheels.length;
    let cx = 0, cz = 0, ch = 0;
    for (let i = 0; i < n; i++) { cx += X[i]; cz += Z[i]; ch += H[i]; }
    cx /= n; cz /= n; ch /= n;
    let ff = 0, fh = 0, ll = 0, lh = 0;
    for (let i = 0; i < n; i++) {
      const dx = X[i] - cx, dz = Z[i] - cz, h = H[i] - ch;
      const f = dx * fx + dz * fz, l = dx * fz - dz * fx;
      ff += f * f; fh += f * h; ll += l * l; lh += l * h;
    }
    // Spread of the spots along and across (the wheelbase and track on a four-wheeler), never under 0.3 m.
    const sf = 2 * Math.sqrt(ff / n), sl = 2 * Math.sqrt(ll / n);
    this.slope[0] = fh / ((Math.max(1e-6, sf) * Math.max(0.3, sf) * n) / 4);
    this.slope[1] = lh / ((Math.max(1e-6, sl) * Math.max(0.3, sl) * n) / 4);
    return this.slope;
  }

  /** Height of the plane fitted through the ground under the wheels (groundSlope), at the body's middle. */
  private planeUnder() {
    const [sf, sl] = this.groundSlope(), n = this.wheels.length;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let cx = 0, cz = 0, ch = 0;
    for (let i = 0; i < n; i++) { cx += this.spotX[i]; cz += this.spotZ[i]; ch += this.groundH[i]; }
    cx /= n; cz /= n; ch /= n;
    const dx = this.pos.x - cx, dz = this.pos.z - cz;
    return ch + sf * (dx * fx + dz * fz) + sl * (dx * fz - dz * fx);
  }

  private updateQuat() {
    this.t.e.set(-this.pitch, this.heading, this.roll, "YXZ");
    this.quat.setFromEuler(this.t.e);
  }

  /**
   * throttle -1..1 (negative brakes, then reverses slowly), steer -1..1 (+ = turn left; on tracks a turn rate, also
   * standing still). Call at a fixed 120 Hz.
   */
  update(dt: number, throttle: number, steer: number) {
    const v = this.v, t = this.t;
    this.layout();
    const n = this.wheels.length, tracked = v.tracked > 0.5;
    throttle = clamp(Number.isFinite(throttle) ? throttle : 0, -1, 1);
    steer = clamp(Number.isFinite(steer) ? steer : 0, -1, 1);
    const top = Math.max(0.1, v.topSpeed);
    const traction = this.contacts / n;

    // --- Steering: front wheels slew toward the stick; less lock at speed. Tracks have no steering wheels.
    const spd = Math.abs(this.speed);
    const lock = v.maxSteer * D2R * (1 - (1 - v.steerAtSpeed) * smooth(0, 1, spd / top));
    const want = tracked ? 0 : steer * lock, rate = v.steerRate * D2R * dt;
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
    // Coasting drag (and the same drag holds the car on a gentle slope when stopped), plus the bog on steep climbs,
    // plus the tracks scrubbing while they turn.
    const bog = v.bog * smooth(v.maxClimb * D2R, (v.maxClimb + 20) * D2R, climbAng);
    const scrub = tracked ? v.pivotDrag * Math.min(1, Math.abs(this.yawRate) / Math.max(1e-3, v.pivotRate * D2R)) : 0;
    const drag = ((throttle === 0 ? v.coast : v.coast * 0.3) + bog + scrub) * traction;
    let next = this.speed + a * dt;
    if (Math.abs(next) <= drag * dt) next = 0; else next -= Math.sign(next) * drag * dt;
    // Never past top speed (descents push it toward a soft ceiling) or reverse speed.
    if (next > top) next = Math.max(top, next - (next - top) * 4 * dt);
    this.speed = clamp(next, -v.reverseSpeed * 1.05, top * 1.06);

    // --- Yaw. Wheels: bicycle model, capped by what the tyres hold plus a drift allowance that lets the heading run
    // ahead of the velocity; the allowance closes as the slide widens, so a held drift settles instead of spinning
    // out. Tracks: the stick is a turn rate, less of it at speed.
    const cornerA = v.cornerG * GRAV;
    let yawTarget: number;
    if (tracked) {
      yawTarget = steer * v.pivotRate * D2R * (1 - (1 - v.pivotAtSpeed) * smooth(0, 1, spd / top));
    } else {
      const bike = (this.speed / this.wbEff) * Math.tan(this.steerAngle);
      const slide0 = Math.atan2(Math.abs(this.lateral), Math.max(0.5, spd));
      const holdA = cornerA * (1 - v.drift * smooth(6 * D2R, 22 * D2R, slide0));
      const allow = 1 + 2 * v.drift * (1 - smooth(0.3 * v.maxSlide * D2R, 0.8 * v.maxSlide * D2R, slide0));
      const yawCap = Math.min(v.maxYawRate * D2R, (holdA / Math.max(1, spd)) * allow);
      yawTarget = clamp(bike, -yawCap, yawCap);
    }
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

    // --- Suspension: spring-dampers carry the body (heave, pitch, roll per unit mass), shared over the wheels.
    const w0 = 2 * Math.PI * v.suspFreq, kw = (w0 * w0) / n, cw = (2 * v.suspDamp * w0) / n;
    let Ip = 0, Ir = 0;
    for (let i = 0; i < n; i++) { Ip += this.mz[i] ** 2; Ir += this.mx[i] ** 2; }
    Ip = Math.max(0.05, Ip / n); Ir = Math.max(0.05, Ir / n);
    let fy = 0, tp = 0, tr = 0, contacts = 0;
    const cp = Math.cos(this.pitch), cr = Math.cos(this.roll);
    for (let i = 0; i < n; i++) {
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
        const cornerRate = this.vy + this.pitchRate * lz * cp + this.rollRate * lx * cr;
        const F = Math.max(0, GRAV / n + kw * comp + cw * (groundRate - cornerRate));
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
    // Measured from the plane through the ground under the wheels (at the body's middle), not from the ground right
    // under the middle: in a hollow (the foot of a dune, a trough) that is lower than the wheels' and pulling the body
    // down to it bottomed the wheels and stalled trucks on the next gentle climb (2026-10-26, escorts driving the
    // dunes beside the convoy). A plain mean of the wheels would do the same to a six-wheeler on a slope (its wheels
    // sit mostly behind its middle).
    const gap = this.pos.y - (this.planeUnder() + v.rideHeight);
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

    // --- Hard stops: no wheel past its bump travel. The worst-bottomed wheel of each corner (front, back or middle,
    // left or right) pushes the body up by rising and tipping a third each (so a slip face ahead tilts the nose up
    // instead of vaulting the whole truck; a middle wheel lifts instead of tipping), and the bump costs forward speed
    // (`bumpLoss`): running into a steep face slows it like a wall would.
    const worst = this.worst;
    for (let pass = 0; pass < 2; pass++) {
      worst.fill(-1);
      for (let i = 0; i < n; i++) {
        const m = this.mount(i, t.a).applyQuaternion(this.quat);
        const o = (this.over[i] = this.groundH[i] + v.rideHeight - v.travel - (this.pos.y + m.y));
        if (o <= 0) continue;
        const q = cornerOf(this.mx[i], this.mz[i]);
        if (worst[q] < 0 || o > this.over[worst[q]]) worst[q] = i;
      }
      let hit = false;
      for (let i = 0; i < n; i++) {
        if (worst[cornerOf(this.mx[i], this.mz[i])] !== i) continue;
        const m = this.mount(i, t.a);
        const lx = m.x, lz = m.z, mid = Math.abs(lz) < CENTRE_BAND;
        m.applyQuaternion(this.quat);
        const over = this.groundH[i] + v.rideHeight - v.travel - (this.pos.y + m.y);
        if (over <= 0) continue;
        hit = true;
        const cp2 = Math.max(0.2, Math.cos(this.pitch)), cr2 = Math.max(0.2, Math.cos(this.roll));
        this.pos.y += mid ? (over * 2) / 3 : over / 3;
        if (!mid) this.pitch += over / 3 / (lz * cp2);
        this.roll += over / 3 / (lx * cr2);
        if (pass > 0) continue;
        const groundRate = (this.groundH[i] - this.prevGroundH[i]) / dt;
        const cornerRate = this.vy + this.pitchRate * lz * cp2 + this.rollRate * lx * cr2;
        // Velocity: only stop the corner sinking further (moving it up with the ground is done by position, so a
        // steep face never throws the body into the air); the bump's size still costs speed, but only while the
        // ground under the wheel rises (a long truck resting bottomed in a hollow isn't held there).
        const dv = Math.min(0, groundRate) - cornerRate;
        // Crawling (under about 2 m/s) a bottomed wheel costs little: a long truck easing out of a hollow onto a
        // climb rides on its stops without stalling (the climb itself is still limited by maxClimb's dig and bog).
        const crawl = 0.15 + 0.85 * smooth(0.8, 2.5, Math.abs(this.speed));
        const loss = Math.min(Math.abs(this.speed), Math.max(0, Math.min(groundRate, groundRate - cornerRate)) * v.bumpLoss * crawl);
        this.speed -= Math.sign(this.speed) * loss;
        if (dv > 0) {
          this.vy += mid ? (dv * 2) / 3 : dv / 3;
          if (!mid) this.pitchRate += dv / 3 / lz;
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
    const v = this.v, t = this.t, top = Math.max(0.1, v.topSpeed), tracked = v.tracked > 0.5;
    // Wheelspin pulling away hard, lock-up braking hard.
    const spinUp = throttle > 0 && this.speed >= 0 ? throttle * clamp(1 - this.speed / (top * 0.45), 0, 1) : 0;
    const lockUp = throttle < 0 && this.speed > 1 ? -throttle * 0.6 : 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      const m = this.mount(i, t.a);
      const lx = m.x, lz = m.z;
      m.applyQuaternion(this.quat);
      const x = this.pos.x + m.x, z = this.pos.z + m.z;
      const front = !this.driven[i];
      w.steer = this.steerAngle * this.share[i];
      if (w.grounded) {
        w.pos.set(x, this.ground.height(x, z), z);
      } else {
        const hang = this.pos.y + m.y - v.rideHeight - v.droop;
        w.pos.set(x, hang, z);
      }
      // Tracks run at their own side's speed (the inside one slower in a turn, backwards in a pivot).
      const roll = (tracked ? this.speed - this.yawRate * lx : this.speed) / v.wheelRadius;
      const spinExtra = spinUp * (front ? 0.3 : 1) * 25;
      w.spin += (roll + (w.grounded ? spinExtra : 0)) * dt * (lockUp > 0.5 && w.grounded ? 0.2 : 1);
      if (w.spin > 1e4 || w.spin < -1e4) w.spin %= 2 * Math.PI;
      if (!w.grounded) { w.slip = 0; continue; }
      // Sideways speed of this wheel in its own heading.
      const side = this.lateral + this.yawRate * lz;
      const st = w.steer;
      const across = side * Math.cos(st) - this.speed * Math.sin(st);
      const longSlip = (front ? 0.3 : 1) * spinUp * 0.9 + lockUp;
      if (tracked) {
        // Skid steering scrubs the tracks sideways along their length and drags them against each other.
        w.slip = clamp((Math.abs(across) + (Math.abs(this.yawRate) * v.track) / 2) / 3 + longSlip * 0.5, 0, 1);
      } else {
        const latSlip = clamp(Math.abs(across) / 5, 0, 1);
        w.slip = clamp(latSlip + longSlip, 0, 1);
      }
    }
  }
}
