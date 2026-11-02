// The hover drive (Keith 2026-11-02: "a type of floating leg that can't support heavy hulls... hovers instead of walking
// around"): legs that fly the hips on a cushion over the ground and let the feet hang under them. Pure maths, like
// walker.ts, which runs it in place of the walk when `hover` is on (the Hover legs item sets it; WalkerSim.hoverUpdate).
// Floaty on purpose: the stick sets a velocity the drive chases at a capped push, so it builds and coasts; letting go
// it drifts to a stop; the hips ride a soft spring over the highest ground just ahead, with a slow bob; the body banks
// into its acceleration. Space taps a dash (a shove along the stick, coasting), held on it boosts to the legs' top speed.
// Only light hulls ride on it (src/items/loadout.ts: the legs' "lifts hulls up to" stat).
// Ownership: player (own movement), as the walk.
import type { Param } from "../core/tweaks";

export const HOVER_DEFAULTS = {
  /** 1: the legs hover (set by the legs item; the walk is off). */
  hover: 0,
  hoverLift: 0.7,
  hoverBob: 0.12,
  hoverBobRate: 0.35,
  hoverSpring: 10,
  hoverDamp: 4,
  hoverFall: 0.6,
  hoverClimb: 35,
  hoverLook: 0.45,
  hoverAccel: 11,
  hoverResponse: 2.2,
  hoverCoast: 3,
  hoverBoostAccel: 14,
  hoverDash: 17,
  hoverDashTime: 0.4,
  hoverTurn: 160,
  hoverTilt: 1.6,
  hoverTiltMax: 14,
  hoverTiltEase: 5,
  hoverTuck: 0.62,
  hoverSpread: 0.75,
  hoverTrail: 0.07,
  hoverFootLag: 6,
  hoverToe: 30,
  hoverSway: 0.12,
  hoverDust: 0.35,
  hoverDustRate: 14,
  hoverDustReach: 3,
};
export type HoverValues = typeof HOVER_DEFAULTS;

const G = "Hover";
export const HOVER_PARAMS: Param[] = [
  { key: "hover", label: "Hover drive on (1) or walk (0)", min: 0, max: 1, step: 1, group: G, tip: "Set by the legs: Hover legs fly; every other leg walks. Flip it here to try the drive on any legs" },
  { key: "hoverLift", label: "Hips ride above standing height (m)", min: 0, max: 3, step: 0.05, group: G },
  { key: "hoverBob", label: "Bob (m)", min: 0, max: 0.6, step: 0.01, group: G, tip: "A slow rise and fall on the cushion" },
  { key: "hoverBobRate", label: "Bob rate (per s)", min: 0.05, max: 2, step: 0.01, group: G },
  { key: "hoverSpring", label: "Cushion stiffness", min: 1, max: 60, step: 0.5, group: G, tip: "How hard the drive pulls the hips to their height. Low: floaty, lags over dunes" },
  { key: "hoverDamp", label: "Cushion damping", min: 0, max: 20, step: 0.1, group: G, tip: "Low: bounces after a bump; about 2×√stiffness settles without bouncing" },
  { key: "hoverFall", label: "Falls at most (share of gravity)", min: 0.1, max: 1, step: 0.01, group: G, tip: "High above its height (a drop, a crest), it sinks this softly" },
  { key: "hoverClimb", label: "Lifts at most (m/s²)", min: 5, max: 120, step: 1, group: G },
  { key: "hoverLook", label: "Reads the ground ahead (s)", min: 0, max: 1.5, step: 0.05, group: G, tip: "It rides the highest ground this far ahead along its travel, so it rises before a dune instead of after" },
  { key: "hoverAccel", label: "Push (m/s²)", min: 1, max: 60, step: 0.5, group: G, tip: "The most the drive changes its velocity by: low drifts wide through turns" },
  { key: "hoverResponse", label: "Response (per s)", min: 0.2, max: 12, step: 0.1, group: G, tip: "How eagerly it chases the stick's velocity (below the push cap): low eases in" },
  { key: "hoverCoast", label: "Let go: slows at (m/s²)", min: 0, max: 30, step: 0.25, group: G, tip: "Stick let go, it drifts to a stop at this rate" },
  { key: "hoverBoostAccel", label: "Boost: push (m/s²)", min: 1, max: 60, step: 0.5, group: G, tip: "Space held: toward the legs' top speed (Sprint › top speed)" },
  { key: "hoverDash", label: "Dash: shove (m/s)", min: 0, max: 40, step: 0.5, group: G, tip: "Added along the dash; it then coasts on it" },
  { key: "hoverDashTime", label: "Dash: coasts for (s)", min: 0.05, max: 1.5, step: 0.01, group: G, tip: "The drive doesn't brake the shove for this long; Space still held then, the boost" },
  { key: "hoverTurn", label: "Turns to its travel at (°/s)", min: 20, max: 720, step: 5, group: G },
  { key: "hoverTilt", label: "Banks into its push (° per m/s²)", min: 0, max: 5, step: 0.05, group: G },
  { key: "hoverTiltMax", label: "Banks at most (°)", min: 0, max: 40, step: 0.5, group: G },
  { key: "hoverTiltEase", label: "Bank ease (per s)", min: 0.5, max: 20, step: 0.1, group: G },
  { key: "hoverTuck", label: "Feet hang (share of the leg)", min: 0.3, max: 0.98, step: 0.01, group: G, tip: "How far below the hips the feet hang: 1 straight legs, low tucked up" },
  { key: "hoverSpread", label: "Feet apart (× stance)", min: 0.2, max: 1.5, step: 0.01, group: G },
  { key: "hoverTrail", label: "Feet trail behind (s of travel)", min: 0, max: 0.3, step: 0.005, group: G },
  { key: "hoverFootLag", label: "Feet follow (per s)", min: 0.5, max: 30, step: 0.1, group: G, tip: "Low: the feet swing on after a turn or a stop" },
  { key: "hoverToe", label: "Toes point down (°)", min: 0, max: 80, step: 1, group: G },
  { key: "hoverSway", label: "Feet sway (m)", min: 0, max: 0.6, step: 0.01, group: G, tip: "The hanging feet drift a little with the bob, out of step" },
  { key: "hoverDust", label: "Downwash sand ×", min: 0, max: 2, step: 0.05, group: G, tip: "Sand blown out from under the drive (src/game/mechUnit.ts); 0: none" },
  { key: "hoverDustRate", label: "Downwash puffs per s", min: 1, max: 60, step: 1, group: G },
  { key: "hoverDustReach", label: "Downwash fades out by (m above its ride height)", min: 0.5, max: 10, step: 0.1, group: G },
];

/** What the drive moves: the walker's own body fields (so carry, shove and the deck keep working on it). */
export interface HoverBody {
  pos: { x: number; z: number };
  vel: { x: number; z: number };
  heading: number;
  /** The hips' height and vertical speed. */
  y: number;
  vy: number;
}

/** The drive's own state: bob clock, the dash's coast, the bank. */
export class HoverState {
  t = 0;
  /** Seconds into a dash's coast (-1: none). */
  dashT = -1;
  /** The bank: pitch (nose down +) and roll (left side up +), radians. */
  pitch = 0;
  roll = 0;
  /** Last step's push (m/s², world x/z), for the bank. */
  ax = 0;
  az = 0;
  get dashing() { return this.dashT >= 0; }
}

const D2R = Math.PI / 180;
const G0 = 9.81;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export interface HoverInput {
  /** The stick (world x/z, 0..1). */
  x: number; z: number;
  /** Shift (the run speed) and Space held past a dash (the boost). */
  run: boolean; boost: boolean;
  /** The torso's aim (radians), for which way to face standing still. */
  face?: number;
}

export interface HoverLegs {
  walkSpeed: number; sprintSpeed: number; boundTop: number; hipHeight: number;
}

/** A dash: shove the body along (x, z) and coast. */
export function hoverDash(h: HoverState, b: HoverBody, x: number, z: number, v: HoverValues) {
  const l = Math.hypot(x, z);
  if (l < 1e-6) return;
  b.vel.x += (x / l) * v.hoverDash; b.vel.z += (z / l) * v.hoverDash;
  h.dashT = 0;
}

/**
 * One step of the drive: velocity toward the stick's at a capped push (scrub: the walker's wall rule, which takes off the
 * part going into a face too steep to climb), the hips on their cushion over `groundY(x, z)`, the heading and the bank.
 * Returns the hips' target height (for the feet and checks).
 */
export function stepHover(
  h: HoverState, b: HoverBody, cmd: HoverInput, v: HoverValues & HoverLegs, dt: number,
  groundY: (x: number, z: number) => number, scrub: (vx: number, vz: number) => { x: number; z: number },
) {
  h.t += dt;
  if (h.dashT >= 0) { h.dashT += dt; if (h.dashT > v.hoverDashTime) h.dashT = -1; }
  // Velocity: toward the stick's, at most the push; coasting the dash off, at most the let-go slowdown.
  const mag = Math.min(1, Math.hypot(cmd.x, cmd.z)), l = Math.hypot(cmd.x, cmd.z) || 1;
  const top = cmd.boost ? Math.max(v.sprintSpeed, v.boundTop) : cmd.run ? v.sprintSpeed : v.walkSpeed;
  const wx = mag > 0.05 ? (cmd.x / l) * mag * top : 0, wz = mag > 0.05 ? (cmd.z / l) * mag * top : 0;
  let dx = wx - b.vel.x, dz = wz - b.vel.z;
  const dl = Math.hypot(dx, dz);
  const cap = h.dashing ? (mag > 0.05 ? v.hoverAccel * 0.25 : 0) : mag > 0.05 ? (cmd.boost ? v.hoverBoostAccel : v.hoverAccel) : v.hoverCoast;
  const want = Math.min(dl * v.hoverResponse, cap);
  let ax = 0, az = 0;
  if (dl > 1e-6) { ax = (dx / dl) * want; az = (dz / dl) * want; }
  // Never past the stick's velocity in one step.
  if (Math.hypot(ax, az) * dt > dl) { ax = dx / dt; az = dz / dt; }
  b.vel.x += ax * dt; b.vel.z += az * dt;
  const s = scrub(b.vel.x, b.vel.z);
  b.vel.x = s.x; b.vel.z = s.z;
  b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt;
  h.ax = ax; h.az = az;

  // The cushion: the highest of the ground under it and along its travel.
  const look = v.hoverLook;
  let g = groundY(b.pos.x, b.pos.z);
  if (look > 0) {
    g = Math.max(g, groundY(b.pos.x + b.vel.x * look * 0.5, b.pos.z + b.vel.z * look * 0.5));
    g = Math.max(g, groundY(b.pos.x + b.vel.x * look, b.pos.z + b.vel.z * look));
  }
  const bob = v.hoverBob * Math.sin(2 * Math.PI * v.hoverBobRate * h.t);
  const yT = g + v.hipHeight + v.hoverLift + bob;
  // Rising it slows as any thrown body does (gravity at least); falling it sinks softly, the drive taking the rest.
  const ay = clamp(v.hoverSpring * (yT - b.y) - v.hoverDamp * b.vy, b.vy > 0 ? -G0 : -G0 * v.hoverFall, v.hoverClimb);
  b.vy += ay * dt;
  b.y += b.vy * dt;
  // Never scraping: the hips at least most of a standing height over the ground right under it.
  const floor = groundY(b.pos.x, b.pos.z) + v.hipHeight * 0.75;
  if (b.y < floor) { b.y = floor; if (b.vy < 0) b.vy = 0; }

  // Heading: round to the travel, or to the aim standing still.
  const sp = Math.hypot(b.vel.x, b.vel.z);
  const aim = sp > 1 ? Math.atan2(b.vel.x, b.vel.z) : cmd.face;
  if (aim !== undefined) {
    const err = wrap(aim - b.heading), m = v.hoverTurn * D2R * dt;
    b.heading = wrap(b.heading + clamp(err, -m, m));
  }

  // Bank into the push, in the body's frame (eased).
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading), lx = Math.cos(b.heading), lz = -Math.sin(b.heading);
  const tMax = v.hoverTiltMax * D2R, k = 1 - Math.exp(-dt * v.hoverTiltEase);
  const pitchT = clamp((ax * fx + az * fz) * v.hoverTilt * D2R, -tMax, tMax);
  const rollT = clamp(-(ax * lx + az * lz) * v.hoverTilt * D2R, -tMax, tMax);
  h.pitch += (pitchT - h.pitch) * k;
  h.roll += (rollT - h.roll) * k;
  return yT;
}
