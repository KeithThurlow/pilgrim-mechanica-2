// The dash as footwork (Keith 2026-10-27): a side step like rugby's, then a short sprint the way it went. Pure: the
// kind of dash, its beats and the curves the walker (src/mech/walker.ts) moves the body and feet along.
//
//   load      both legs flex: the weight comes off a little, then the hips drop; the hips turn part way toward the dash
//   push      the outside leg drives down onto the edge of its foot (its length across the dash for traction), rolling
//             onto the ball and toes; the inside knee lifts, the foot tucked under its hip; the body leans into the dash
//   step      the inside foot plants out toward the dash and takes the weight; the hips turn on toward the dash
//   through   the outside leg comes through in front along the dash and plants as a running stride: the hand-over
//
// The speed is a burst by time from the press (dashBurst), whatever the feet are doing: up to the peak in dashRise,
// held dashHold, down to the walk in dashStop. The run gait carries on along the dash after the through-step: held
// (Space), into the sprint; let go, until the burst is down, then the walk. Side steps between dashForwardMax and dashCutMin off the line of travel;
// closer to it a burst (two driving strides, no turn), further a cutback (the hips swing round, a little slower).
// Ownership: the player's own movement (a command), like the walk.
import type { WalkerValues } from "./walkerTuning";

const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type DashKind = "side" | "burst" | "cut";

/** Seconds from the start: the end of the load, the inside foot's plant, the outside foot's lift and its plant. */
export interface DashBeats { load: number; step: number; lift: number; through: number }

/** The kind of dash for its angle off the line of travel (radians, either side). */
export function dashKind(off: number, v: WalkerValues): DashKind {
  const a = Math.abs(off) / D2R;
  return a < v.dashForwardMax ? "burst" : a > v.dashCutMin ? "cut" : "side";
}

export function dashBeats(kind: DashKind, v: WalkerValues): DashBeats {
  const k = kind === "cut" ? v.dashCutSlow : 1;
  const load = v.dashLoad * k, step = load + v.dashPush * k, lift = step + v.dashOverlap * k;
  return { load, step, lift, through: lift + v.dashThrough * k };
}

/**
 * Where the hips point: from the heading h0, turned part way toward the dash over the load and the first half of the
 * push (until the dash sits dashPushAngle off them, at most dashPreTurn), then on to the dash by the through-step.
 * turn: the whole turn from h0 to the dash (signed, unwrapped: a cutback may go past half a turn).
 */
export function dashPreTurn(turn: number, v: WalkerValues) {
  const s = Math.sign(turn) || 1;
  return s * clamp(Math.abs(turn) - v.dashPushAngle * D2R, 0, v.dashPreTurn * D2R);
}
export function dashYaw(t: number, h0: number, pre: number, turn: number, B: DashBeats) {
  const mid = B.load + (B.step - B.load) * 0.5;
  return h0 + pre * smooth(0, mid, t) + (turn - pre) * smooth(mid, B.through, t);
}

/** The signed turn from heading h to yaw, going the way side says when it's near half a turn. */
export function dashTurn(h: number, yaw: number, side: number) {
  let d = wrap(yaw - h);
  if (side !== 0 && d * side < 0 && Math.abs(d) > Math.PI * 0.6) d += side * 2 * Math.PI;
  return d;
}

/**
 * Speed along the dash (m/s), by time from the press (Keith 2026-10-31: "Dash doesn't feel fast enough in its start and
 * stop"): a burst, not something the steps build up. From what it carried along the dash up to dashSpeedOut over
 * dashRise (hardest at the press), held for dashHold, then down to `to` (the stick's walk speed along it) over dashStop.
 * The steps only pose the legs under it; held, the sprint takes it from the hand-over.
 */
export function dashBurst(t: number, carried: number, to: number, v: WalkerValues) {
  const peak = Math.max(carried, v.dashSpeedOut), rise = Math.max(0.005, v.dashRise);
  if (t < rise) { const x = t / rise; return carried + (peak - carried) * (1 - (1 - x) * (1 - x)); }
  const e = t - rise - v.dashHold;
  if (e < 0) return peak;
  return e < v.dashStop ? peak + (to - peak) * smooth(0, v.dashStop, e) : to;
}
/** Seconds from the press until the burst is down at its end speed. */
export function dashBurstEnd(v: WalkerValues) { return Math.max(0.005, v.dashRise) + v.dashHold + v.dashStop; }
/** Share of the speed across the dash still left: gone over the burst's rise (the planted feet take it out). */
export function dashAcross(t: number, v: WalkerValues) { return 1 - smooth(0, Math.max(0.02, v.dashRise), t); }

/** The hips' height change (m): up as the weight comes off, down into the crouch, back up by the through-step. */
export function dashDip(t: number, B: DashBeats, v: WalkerValues) {
  const up = v.dashUnweight * Math.sin(Math.PI * clamp(t / Math.max(0.02, B.load * 0.5), 0, 1));
  const down = v.dashDip * smooth(B.load * 0.4, B.load + (B.step - B.load) * 0.5, t) * (1 - smooth(B.lift, B.through + 0.12, t));
  return up - down;
}
/** How far into its lean the body is (0..1): in over the load and push, held through the step, out after the through-step. */
export function dashLeanK(t: number, B: DashBeats) {
  return smooth(0, B.step, t) * (1 - smooth(B.through, B.through + 0.35, t));
}
/** How far onto its edge the pushing foot rolls (0..1): over the push, then off it as the heel lifts toward the lift. */
export function dashEdgeK(t: number, B: DashBeats) {
  return smooth(B.load * 0.5, B.load + (B.step - B.load) * 0.4, t) * (1 - smooth(B.step - 0.02, B.lift, t));
}
