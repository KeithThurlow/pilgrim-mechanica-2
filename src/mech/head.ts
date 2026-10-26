// The sensor head's motion (Keith 2026-10-26: "heads ... mounted as sensors at the front that turn and follow ...
// mouse targeting, or ... clusters of sensors that sit up on top"). Pure maths, cosmetic: nothing in the game reads
// it, so it lives with the drawing (src/mech/rampart.ts drives it), never in the walker or upper sims' state.
//
// A head turns toward the aim point at its own rate, yaw then pitch, inside limits relative to the hull. It follows
// through a damped spring (`headLag` how slow it is to start, `headSettle` how much it overshoots and settles), capped
// at `headTurnRate`. It turns faster than the torso, so it gets there first and the mech reads as looking before it
// turns; `headLead` pushes it a little further into a turn the torso hasn't made yet, and `headLookAhead` looks along
// a sweeping aim (where the aim will be that many seconds on), so it reads as looking first. With no aim it scans.
// A cluster has no head; its sweep (a dish going round) turns at the item's own rate times `clusterSweep`.
import type { Param } from "../core/tweaks";

export const HEAD_DEFAULTS = {
  headTurnRate: 260,
  headYawMax: 75,
  headPitchUp: 25,
  headPitchDown: 35,
  headLag: 0.09,
  headSettle: 0.7,
  headLead: 0.5,
  headLookAhead: 0.3,
  headLookAheadMax: 30,
  headScanWidth: 40,
  headScanPeriod: 7,
  headScanAfter: 1.2,
  clusterSweep: 1,
  headSize: 0.33,
  headDrop: 0.35,
};
export type HeadValues = typeof HEAD_DEFAULTS;

const G = "Sensor head";
export const HEAD_PARAMS: Param[] = [
  { key: "headTurnRate", label: "Turn rate (°/s)", min: 30, max: 720, step: 5, group: G, tip: "Fastest the head swings; above the torso's turn so it looks first" },
  { key: "headYawMax", label: "Yaw limit either side (°)", min: 0, max: 170, step: 1, group: G, tip: "How far the head turns from the hull's nose" },
  { key: "headPitchUp", label: "Pitch up limit (°)", min: 0, max: 80, step: 1, group: G },
  { key: "headPitchDown", label: "Pitch down limit (°)", min: 0, max: 80, step: 1, group: G },
  { key: "headLag", label: "Lag (s)", min: 0.01, max: 0.6, step: 0.01, group: G, tip: "How slow it is to start toward a new aim (the spring's time constant)" },
  { key: "headSettle", label: "Settle (damping, 1 = no overshoot)", min: 0.2, max: 1.5, step: 0.05, group: G, tip: "Under 1 it swings a little past the aim and settles back" },
  { key: "headLead", label: "Lead the torso", min: 0, max: 1, step: 0.05, group: G, tip: "Share of the torso's remaining turn the head adds on top, so it looks round before the hull follows" },
  { key: "headLookAhead", label: "Look ahead along a sweep (s)", min: 0, max: 1, step: 0.02, group: G, tip: "While the aim sweeps round, the head looks where it will be this long from now" },
  { key: "headLookAheadMax", label: "Look ahead at most (°)", min: 0, max: 90, step: 1, group: G },
  { key: "headScanWidth", label: "Idle scan width either side (°)", min: 0, max: 90, step: 1, group: G },
  { key: "headScanPeriod", label: "Idle scan period (s)", min: 1, max: 30, step: 0.5, group: G },
  { key: "headScanAfter", label: "Scan after no aim for (s)", min: 0, max: 10, step: 0.1, group: G },
  { key: "headSize", label: "Head size ×", min: 0.1, max: 1.5, step: 0.01, group: G, tip: "Scale of a fitted head on its socket (Keith 2026-10-26: a third of the first stand-in in each dimension)" },
  { key: "headDrop", label: "Head lower by (m)", min: -0.5, max: 1.2, step: 0.01, group: G, tip: "How far below the front socket the head sits (Keith 2026-10-26: a little lower)" },
  { key: "clusterSweep", label: "Cluster sweep speed ×", min: 0, max: 4, step: 0.05, group: G, tip: "Times each cluster item's own sweep (a survey dish turns; a mast or an array stays still)" },
];

const RAD = Math.PI / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** What the head is told each frame: where the aim is in the hull's frame, if anywhere. */
export interface HeadInput {
  /** The aim point in the head socket's frame (+Z the hull's nose, +Y up, +X the mech's left); null: no aim. */
  aim: { x: number; y: number; z: number } | null;
  /** How far the torso still has to turn toward the aim (radians, + to the left); 0 if unknown. */
  torsoBehind: number;
  /** How fast the aim's bearing turns round the mech (rad/s, + to the left); 0 if unknown. */
  aimRate?: number;
}

export class HeadDriver {
  /** Head yaw and pitch relative to the hull (radians; yaw + to the mech's left, pitch + up). */
  yaw = 0;
  pitch = 0;
  /** A cluster's sweep angle (radians). */
  sweep = 0;
  private yawVel = 0;
  private pitchVel = 0;
  private noAim = 99;
  private scanT = 0;

  /** sweepRate: the fitted cluster's own sweep (°/s), 0 for still ones. */
  step(dt: number, inp: HeadInput, v: HeadValues, sweepRate = 0) {
    if (dt <= 0) return;
    this.sweep = wrap(this.sweep + sweepRate * v.clusterSweep * RAD * dt);
    let ty: number, tp: number;
    if (inp.aim) {
      this.noAim = 0;
      const { x, y, z } = inp.aim;
      const ahead = Math.max(-v.headLookAheadMax * RAD, Math.min(v.headLookAheadMax * RAD, (inp.aimRate ?? 0) * v.headLookAhead));
      ty = Math.atan2(x, z) + inp.torsoBehind * v.headLead + ahead;
      tp = Math.atan2(y, Math.hypot(x, z));
    } else {
      this.noAim += dt;
      // Hold where it last looked for a moment, then a slow side to side scan, a little nose down.
      if (this.noAim < v.headScanAfter) { ty = this.yaw; tp = this.pitch; this.scanT = Math.asin(Math.max(-1, Math.min(1, this.yaw / Math.max(1e-3, v.headScanWidth * RAD)))) / (2 * Math.PI) * v.headScanPeriod; }
      else {
        this.scanT += dt;
        ty = v.headScanWidth * RAD * Math.sin((2 * Math.PI * this.scanT) / v.headScanPeriod);
        tp = -6 * RAD;
      }
    }
    ty = Math.max(-v.headYawMax * RAD, Math.min(v.headYawMax * RAD, wrap(ty)));
    tp = Math.max(-v.headPitchDown * RAD, Math.min(v.headPitchUp * RAD, tp));
    // Yaw first, then pitch: the pitch spring is a touch slower so the turn leads.
    [this.yaw, this.yawVel] = spring(this.yaw, this.yawVel, ty, dt, v.headLag, v.headSettle, v.headTurnRate * RAD);
    [this.pitch, this.pitchVel] = spring(this.pitch, this.pitchVel, tp, dt, v.headLag * 1.4, v.headSettle, v.headTurnRate * RAD * 0.6);
    this.yaw = Math.max(-v.headYawMax * RAD, Math.min(v.headYawMax * RAD, this.yaw));
  }

  reset() { this.yaw = this.pitch = this.yawVel = this.pitchVel = 0; this.noAim = 99; }
}

/** A damped spring toward `to` (time constant `lag`, damping ratio `zeta`), its speed capped. Sub-stepped, so a long
 *  frame stays stable. Returns [x, v]. */
export function spring(x: number, vel: number, to: number, dt: number, lag: number, zeta: number, maxRate: number): [number, number] {
  const w = 1 / Math.max(0.005, lag);
  const n = Math.max(1, Math.ceil(dt * w * 4));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = w * w * (to - x) - 2 * zeta * w * vel;
    vel += a * h;
    vel = Math.max(-maxRate, Math.min(maxRate, vel));
    x += vel * h;
  }
  return [x, vel];
}
