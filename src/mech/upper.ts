// Upper body: a torso that turns on the waist toward the aim point, independent of where the legs walk
// (twin-stick: WASD drives the legs, the mouse drives the torso and guns), plus two hull-mounted miniguns
// that track within a small arc, spin up before they fire, alternate shots and kick back.
// Pure simulation like the legs: no rendering.
import type { Param } from "../core/tweaks";

export const UPPER_DEFAULTS = {
  torsoTurnRate: 150,
  torsoLimit: 120,
  podYawMax: 30,
  podPitchMax: 20,
  podTrack: 12,
  spinUp: 0.5,
  spinDown: 1.4,
  spinRpm: 900,
  fireFrom: 0.65,
  fireRate: 16,
  spread: 3,
  range: 26,
  recoil: 0.03,
  recoilReturn: 9,
  recoilMax: 0.14,
  torsoKick: 0.25,
};
export type UpperValues = typeof UPPER_DEFAULTS;

export const UPPER_PARAMS: Param[] = [
  { key: "torsoTurnRate", label: "Torso turn rate (°/s)", min: 30, max: 600, step: 5, group: "Torso & guns" },
  { key: "torsoLimit", label: "Torso turn limit (°)", min: 20, max: 180, step: 1, group: "Torso & guns", tip: "How far the torso can turn from the legs" },
  { key: "podYawMax", label: "Gun arc (°)", min: 0, max: 60, step: 1, group: "Torso & guns", tip: "Guns swing this far on their own before the torso has to turn" },
  { key: "podPitchMax", label: "Gun pitch limit (°)", min: 0, max: 45, step: 1, group: "Torso & guns" },
  { key: "podTrack", label: "Gun tracking", min: 1, max: 40, step: 0.5, group: "Torso & guns" },
  { key: "spinUp", label: "Spin-up (s)", min: 0.05, max: 2, step: 0.05, group: "Minigun" },
  { key: "spinDown", label: "Spin-down (s)", min: 0.1, max: 4, step: 0.05, group: "Minigun" },
  { key: "spinRpm", label: "Barrel rpm", min: 100, max: 3000, step: 10, group: "Minigun" },
  { key: "fireFrom", label: "Fires from spin", min: 0, max: 1, step: 0.01, group: "Minigun", tip: "Share of full spin before rounds come out" },
  { key: "fireRate", label: "Rounds/s per gun", min: 1, max: 60, step: 0.5, group: "Minigun" },
  { key: "spread", label: "Spread (°)", min: 0, max: 15, step: 0.1, group: "Minigun" },
  { key: "range", label: "Range (m)", min: 5, max: 80, step: 1, group: "Minigun" },
  { key: "recoil", label: "Kick per shot (m)", min: 0, max: 0.2, step: 0.005, group: "Minigun" },
  { key: "recoilReturn", label: "Kick return", min: 1, max: 30, step: 0.5, group: "Minigun" },
  { key: "recoilMax", label: "Kick limit (m)", min: 0, max: 0.5, step: 0.01, group: "Minigun" },
  { key: "torsoKick", label: "Torso shake (°)", min: 0, max: 2, step: 0.01, group: "Minigun" },
];

const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export interface Gun {
  /** +1 left, -1 right (the mech's sides). */
  side: 1 | -1;
  /** Aim relative to the torso, radians. */
  yaw: number;
  pitch: number;
  /** Barrel spin angle, radians. */
  spinAngle: number;
  /** Recoil push back along the barrel, metres. */
  kick: number;
}

export interface Aim {
  /** Point on the ground to aim at, or null to face forward. */
  x: number; y: number; z: number;
}

export class UpperSim {
  /** Torso yaw in world space (radians, heading convention). */
  torsoYaw = 0;
  /** 0..1 barrel spin. */
  spin = 0;
  guns: [Gun, Gun] = [
    { side: 1, yaw: 0, pitch: 0, spinAngle: 0, kick: 0 },
    { side: -1, yaw: 0, pitch: 0, spinAngle: 0, kick: 0 },
  ];
  /** Small torso jitter from firing, radians. */
  shake = 0;
  private shotClock = 0;
  private next = 0;
  /** True while the aim point is inside the guns' reach (arc and turn limit). */
  onTarget = false;

  constructor(public v: UpperValues) {}

  reset(yaw: number) { this.torsoYaw = yaw; this.spin = 0; this.shotClock = 0; }

  /**
   * legsHeading: where the legs face. shoulder: world position of the gun line (x, y, z). aim: target or null.
   * Returns the sides that fired a round this step (one entry per round).
   */
  update(dt: number, legsHeading: number, shoulder: { x: number; y: number; z: number }, aim: Aim | null, trigger: boolean): (1 | -1)[] {
    const v = this.v;
    // Torso: turn toward the aim at a capped rate, never more than the limit from the legs.
    let want = legsHeading;
    if (aim) want = Math.atan2(aim.x - shoulder.x, aim.z - shoulder.z);
    const lim = v.torsoLimit * D2R;
    const rel = clamp(wrap(want - legsHeading), -lim, lim);
    const target = legsHeading + rel;
    const step = v.torsoTurnRate * D2R * dt;
    const err = wrap(target - this.torsoYaw);
    this.torsoYaw = wrap(this.torsoYaw + clamp(err, -step, step));
    // Keep the torso inside the limit even when the legs swing under it.
    const now = wrap(this.torsoYaw - legsHeading);
    if (Math.abs(now) > lim) this.torsoYaw = wrap(legsHeading + Math.sign(now) * lim);

    // Guns: the rest of the aim, inside their own arc.
    const yawLeft = aim ? wrap(want - this.torsoYaw) : 0;
    const dist = aim ? Math.hypot(aim.x - shoulder.x, aim.z - shoulder.z) : 10;
    const pitchWant = aim ? -Math.atan2(aim.y - shoulder.y, Math.max(1, dist)) : 0;
    const ymax = v.podYawMax * D2R, pmax = v.podPitchMax * D2R;
    const k = 1 - Math.exp(-v.podTrack * dt);
    for (const g of this.guns) {
      g.yaw += (clamp(yawLeft, -ymax, ymax) - g.yaw) * k;
      g.pitch += (clamp(pitchWant, -pmax, pmax) - g.pitch) * k;
      g.kick += (0 - g.kick) * (1 - Math.exp(-v.recoilReturn * dt));
    }
    this.onTarget = !!aim && Math.abs(yawLeft) <= ymax + 0.02;

    // Spin up while the trigger is held, wind down after; rounds once spun past fireFrom.
    this.spin = trigger ? Math.min(1, this.spin + dt / v.spinUp) : Math.max(0, this.spin - dt / v.spinDown);
    const spinRate = (v.spinRpm / 60) * Math.PI * 2 * this.spin;
    for (const g of this.guns) g.spinAngle = (g.spinAngle + spinRate * dt) % (Math.PI * 2);
    this.shake *= Math.exp(-dt * 18);

    const shots: (1 | -1)[] = [];
    if (trigger && this.spin >= v.fireFrom) {
      // Both guns at fireRate each, alternating.
      this.shotClock += dt * v.fireRate * 2 * (0.6 + 0.4 * this.spin);
      while (this.shotClock >= 1) {
        this.shotClock -= 1;
        const g = this.guns[this.next];
        this.next = 1 - this.next;
        g.kick = Math.min(v.recoilMax, g.kick + v.recoil);
        this.shake = Math.min(3 * D2R, this.shake + v.torsoKick * D2R);
        shots.push(g.side);
      }
    } else this.shotClock = Math.min(this.shotClock, 0.99);
    return shots;
  }
}
