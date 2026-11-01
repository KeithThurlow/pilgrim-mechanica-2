// The mech's sword (Keith 2026-11-01: "a big chonky sword ... wield it with a mech and cleave through things"): a held
// weapon in an arm (`sword-light`, src/items/bases.ts), on that side's mouse button. A click swings once; held, it keeps
// swinging, forehand then backhand. Each swing is a wind-up (the blade cocks back outboard and lifts), a fast slash
// across the front of the mech through `swordArc` degrees, and a recovery. While it slashes, the blade is a vertical
// sheet from the hand out to `swordReach` (src/game/sheet.ts), swept across the arc; every body it crosses is hit once
// per swing, until the swing's cleave budget (m of steel equivalent, the same costs as penetration) is spent. The first
// body it bites stalls the blade for `swordHitch` s (and, for the local player, the whole fight for `swordStop` s:
// src/game/hitStop.ts), so a hit lands with weight.
//
// Pure: the swing's timing and angles only. The arsenal (src/weapons/arsenal.ts) turns the swept angles into sheets and
// hits, sound, sparks and shake; the model (src/weapons/models.ts swordModel) follows `angle` and `lift`.
// Ownership: player (the swing is the player's command; its hits are host-decided when networked, like any shot).
import type { Param } from "../core/tweaks";
import type { PenMaterial, SheetHit } from "../game/sheet";

export const SWORD_DEFAULTS = {
  swordDamage: 900,
  swordAp: 0.5,
  swordReach: 4.7,
  swordArc: 150,
  swordWindup: 0.2,
  swordSlash: 0.16,
  swordRecover: 0.32,
  swordComboAt: 0.45,
  swordCleave: 4,
  swordHeight: 5,
  swordHalf: 0.5,
  swordKnock: 9,
  swordLunge: 14,
  swordLungeNear: 5,
  swordLungeFar: 16,
  swordHitch: 0.06,
  swordStop: 0.07,
  swordStopScale: 0.08,
  swordShake: 0.55,
  swordRest: 35,
  swordLift: 40,
  swordLength: 1,
  swordTrail: 1,
  swordLevel: 0.7,
  // The arm and the pose (Keith 2026-11-01: "the arms to actually animate"; at rest "over the shoulder ... samurai
  // Ronin style"). Hull-local metres off the shoulder; +x toward the mech's left, mirrored for the right arm.
  swordUpperArm: 1.25,
  swordForearm: 1.3,
  swordArcIn: 0.55,
  swordArcDrop: 0.35,
  swordArcFwd: 0.35,
  swordArcRadius: 1.55,
  swordLiftHand: 0.9,
  swordDroop: 24,
  swordGuardIn: 0.3,
  swordGuardUp: 0.25,
  swordGuardFwd: 0.85,
  swordGuardTilt: 32,
  swordGuardOut: 12,
};
export type SwordValues = typeof SWORD_DEFAULTS;

export const SWORD_GROUP = "Sword", SWORD_ARM_GROUP = "Sword arm";
const G = SWORD_GROUP, GA = SWORD_ARM_GROUP;
export const SWORD_PARAMS: Param[] = [
  { key: "swordDamage", label: "Damage per hit", min: 0, max: 3000, step: 5, group: G, tip: "Every body the blade crosses in one swing takes this (a rolled sword carries its own)" },
  { key: "swordAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: G },
  { key: "swordReach", label: "Reach from the hand (m)", min: 2, max: 14, step: 0.1, group: G, tip: "The blade's sheet runs from the hand out to this; the model's blade is drawn to match" },
  { key: "swordArc", label: "Swing arc (°)", min: 30, max: 260, step: 1, group: G, tip: "How far the slash sweeps across the front, centred on the aim" },
  { key: "swordWindup", label: "Wind-up (s)", min: 0.02, max: 1, step: 0.01, group: G, tip: "Cocking the blade back outboard before the slash" },
  { key: "swordSlash", label: "Slash (s)", min: 0.04, max: 0.6, step: 0.01, group: G, tip: "The cut itself: the only time it hits" },
  { key: "swordRecover", label: "Recover (s)", min: 0.05, max: 1.2, step: 0.01, group: G },
  { key: "swordComboAt", label: "Next swing from (share of recover)", min: 0, max: 1, step: 0.01, group: G, tip: "Held, the next swing (the other way) starts this far into the recovery" },
  { key: "swordCleave", label: "Cleave budget (m)", min: 0, max: 30, step: 0.1, group: G, tip: "Each body costs its chord × its density (Penetration group), like a rail slug: once spent, the rest of the swing passes over them" },
  { key: "swordHeight", label: "Blade reaches up (m)", min: 1, max: 16, step: 0.1, group: G, tip: "The sheet's top over the ground: higher reaches big walkers' bodies" },
  { key: "swordHalf", label: "Blade half-width (m)", min: 0, max: 2, step: 0.05, group: G },
  { key: "swordKnock", label: "Knockback (m/s)", min: 0, max: 40, step: 0.5, group: G, tip: "Light bodies are thrown along the swing" },
  { key: "swordLunge", label: "Lunge (m/s)", min: 0, max: 40, step: 0.5, group: G, tip: "The mech steps into the swing at up to this speed toward the aim, through the end of the wind-up and the slash" },
  { key: "swordLungeNear", label: "No lunge within (m)", min: 0, max: 30, step: 0.5, group: G, tip: "Aiming (the lock, else the cursor) this close: no lunge, so you can kite in close" },
  { key: "swordLungeFar", label: "Full lunge from (m)", min: 1, max: 60, step: 0.5, group: G, tip: "Aiming this far or farther: the full lunge; in between it grows with the distance" },
  { key: "swordHitch", label: "Blade stalls on a hit (s)", min: 0, max: 0.3, step: 0.005, group: G, tip: "The swing freezes this long on its first body" },
  { key: "swordStop", label: "Hit stop (s)", min: 0, max: 0.3, step: 0.005, group: G, tip: "The whole fight slows this long on the first body (the player's own swings only)" },
  { key: "swordStopScale", label: "Hit stop speed", min: 0, max: 1, step: 0.01, group: G, tip: "How fast time runs during the hit stop (0 frozen, 1 off)" },
  { key: "swordShake", label: "Camera shake on a hit", min: 0, max: 2, step: 0.01, group: G },
  { key: "swordRest", label: "Rest angle outboard (°)", min: -60, max: 90, step: 1, group: G },
  { key: "swordLift", label: "Wind-up lift (°)", min: 0, max: 90, step: 1, group: G, tip: "The blade raises this much as it cocks, and comes down flat through the slash" },
  { key: "swordLength", label: "Blade drawn × reach", min: 0.3, max: 1.5, step: 0.01, group: G, tip: "The model's blade length as a share of the reach" },
  { key: "swordTrail", label: "Swing trail", min: 0, max: 3, step: 0.05, group: G },
  { key: "swordLevel", label: "Sound level", min: 0, max: 1.5, step: 0.01, group: G },
  { key: "swordUpperArm", label: "Upper arm (m)", min: 0.5, max: 3, step: 0.05, group: GA },
  { key: "swordForearm", label: "Forearm (m)", min: 0.5, max: 3, step: 0.05, group: GA },
  { key: "swordArcIn", label: "Swing centre: in from the shoulder (m)", min: -1, max: 2, step: 0.05, group: GA, tip: "The hand swings round a point this far toward the mech's middle" },
  { key: "swordArcDrop", label: "Swing centre: below the shoulder (m)", min: -1, max: 2, step: 0.05, group: GA },
  { key: "swordArcFwd", label: "Swing centre: ahead of the shoulder (m)", min: -1, max: 2, step: 0.05, group: GA },
  { key: "swordArcRadius", label: "Hand's swing radius (m)", min: 0.3, max: 3, step: 0.05, group: GA },
  { key: "swordLiftHand", label: "Hand raised in the wind-up (m)", min: 0, max: 2, step: 0.05, group: GA },
  { key: "swordDroop", label: "Blade tipped down in the slash (°)", min: -20, max: 70, step: 1, group: GA, tip: "So the tip sweeps low through small enemies" },
  { key: "swordGuardIn", label: "At rest: hand in (m)", min: -1, max: 2, step: 0.05, group: GA, tip: "The rest pose (the blade over the shoulder): the hand's place off the shoulder" },
  { key: "swordGuardUp", label: "At rest: hand up (m)", min: -1.5, max: 1.5, step: 0.05, group: GA },
  { key: "swordGuardFwd", label: "At rest: hand forward (m)", min: -0.5, max: 2, step: 0.05, group: GA },
  { key: "swordGuardTilt", label: "At rest: blade up from level (°)", min: -10, max: 80, step: 1, group: GA, tip: "The blade points back over the shoulder, raised this much" },
  { key: "swordGuardOut", label: "At rest: blade out (°)", min: -45, max: 45, step: 1, group: GA },
];

export interface SwordStats { damage: number; ap: number; reach: number; arc: number; windup: number; slash: number; recover: number; cleave: number }

export type SwordPhase = "idle" | "windup" | "slash" | "recover";

const D2R = Math.PI / 180;
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
/** The slash: slow out of the cock, fastest through the middle (where it bites). */
const slashEase = (x: number) => x * x * (3 - 2 * x);

/** A swept stretch of the slash this step: from and to (radians off the aim, + toward the mech's left). */
export interface Sweep { from: number; to: number }

/**
 * One arm's sword. `side`: 1 left, -1 right; a forehand swing starts outboard (the left arm from its left) and cuts
 * across; the next held swing comes back the other way.
 */
export class SwordSim {
  phase: SwordPhase = "idle";
  t = 0;
  /** +1: this swing cuts from + (left) to −; −1 the other way. */
  dir = 1;
  /** Swings started (the arsenal clears its per-swing hit list when this changes). */
  swings = 0;
  /** Seconds the blade is stalled in a body. */
  hitch = 0;
  /** The blade now: radians off the aim (+ toward the mech's left), and its lift 0..1 (raised in the wind-up). */
  angle = 0;
  lift = 0;
  /** How far the arm is in its rest pose (the blade over the shoulder): 1 at rest, 0 through the slash. */
  guard = 1;
  /** The swing's lead-in share for the lunge: the wind-up's last half and the slash, 0..1 (0 elsewhere). */
  lungeK = 0;
  /** The slash's progress 0..1 this step (for the lunge), 0 outside it. */
  slashK = 0;
  /** A swing started this step (the whoosh). */
  started = false;
  private cocked = 0;
  private ended = 0;

  constructor(readonly side: 1 | -1, private rest = () => 35) { this.angle = this.restAngle(); }

  restAngle() { return this.side * this.rest() * D2R; }

  /** Stall the blade (a body bit it). */
  bite(seconds: number) { this.hitch = Math.max(this.hitch, seconds); }

  /** Let go of everything (weapons cold): back to rest, no swing. */
  stop() { this.phase = "idle"; this.t = 0; this.hitch = 0; this.lift = 0; this.slashK = 0; this.lungeK = 0; this.guard = 1; this.angle = this.restAngle(); }

  /**
   * Step: `held` the trigger (a press starts a swing; held, the next comes `comboAt` into the recovery). Returns the
   * stretch of the slash swept this step, or null outside the slash.
   */
  update(dt: number, held: boolean, st: SwordStats, comboAt: number): Sweep | null {
    this.started = false;
    const half = (st.arc * D2R) / 2, rest = this.restAngle();
    if (this.hitch > 0) {
      const h = Math.min(this.hitch, dt);
      this.hitch -= h; dt -= h;
      if (dt <= 0) return null;
    }
    if (this.phase === "idle" || (this.phase === "recover" && this.t >= comboAt * st.recover)) {
      if (held) {
        // A new swing: the first forehand (from outboard), then alternate.
        this.dir = this.phase === "idle" ? this.side : -this.dir;
        this.phase = "windup"; this.t = 0; this.swings++; this.started = true;
        this.ended = this.angle;
      } else if (this.phase === "idle") { this.angle = rest; this.lift = 0; this.slashK = 0; this.lungeK = 0; this.guard = 1; return null; }
    }
    this.t += dt;
    const start = this.dir * half * 1.08, end = -this.dir * half;
    if (this.phase === "windup") {
      const k = Math.min(1, this.t / Math.max(1e-3, st.windup));
      this.angle = this.ended + (start - this.ended) * easeOut(k);
      this.lift = easeOut(k);
      this.guard = 1 - easeOut(Math.min(1, k * 1.4));
      this.lungeK = k > 0.5 ? (k - 0.5) * 2 * 0.6 : 0;
      this.slashK = 0;
      if (k >= 1) { this.phase = "slash"; this.t -= st.windup; this.cocked = this.angle; }
      else return null;
    }
    if (this.phase === "slash") {
      const from = this.angle;
      const k = Math.min(1, this.t / Math.max(1e-3, st.slash));
      this.angle = this.cocked + (end - this.cocked) * slashEase(k);
      this.lift = 1 - k;
      this.guard = 0;
      this.slashK = k;
      this.lungeK = Math.sin(Math.PI * Math.min(1, 0.5 + k * 0.5)) * 0.4 + 0.6 * (1 - k);
      if (k >= 1) { this.phase = "recover"; this.t -= st.slash; this.ended = this.angle; this.slashK = 0; }
      return { from, to: this.angle };
    }
    // Recover: back to rest (a held trigger picks up the next swing from wherever it is).
    const k = Math.min(1, this.t / Math.max(1e-3, st.recover));
    this.angle = this.ended + (rest - this.ended) * easeInOut(k);
    this.lift = 0;
    this.lungeK = 0;
    this.guard = easeInOut(Math.min(1, k * 1.15));
    if (k >= 1) { this.phase = "idle"; this.t = 0; this.ended = this.angle; }
    return null;
  }
}

/** Angles to test across a swept stretch, at most `step` radians apart (the blade's sheets this step). */
export function sweepAngles(s: Sweep, step = 6 * D2R): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(s.to - s.from) / step));
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(s.from + ((s.to - s.from) * i) / n);
  return out;
}

/**
 * The rule for one sheet of the blade: of its hits (any order), the ones this swing still cuts, nearest the hand
 * first. A body (target and unit key) is cut once per swing; each cut pays its chord × density out of the swing's
 * cleave budget, and once that's spent nothing more is cut (the body that spends it is still cut).
 */
export function swordCuts<T>(hits: SheetHit<T>[], seen: Map<T, Set<number>>, budget: { left: number }, density: (m: PenMaterial) => number): SheetHit<T>[] {
  const out: SheetHit<T>[] = [];
  hits.sort((a, b) => a.along - b.along);
  for (const h of hits) {
    if (budget.left <= 0) break;
    let s = seen.get(h.target);
    if (!s) { s = new Set(); seen.set(h.target, s); }
    if (s.has(h.key)) continue;
    s.add(h.key);
    budget.left -= h.chord * density(h.material);
    out.push(h);
  }
  return out;
}

type V = { x: number; y: number; z: number };
/** A held sword's pose in the hull's frame: where the hand is, the way the blade points, the way its spine faces (the
 *  edge faces the other way). */
export interface SwordPose { hand: V; fwd: V; up: V }

const norm = (v: V): V => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const lerpV = (a: V, b: V, k: number): V => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
/** `up` made square to `fwd`. */
const square = (fwd: V, up: V): V => { const d = up.x * fwd.x + up.y * fwd.y + up.z * fwd.z; return norm({ x: up.x - fwd.x * d, y: up.y - fwd.y * d, z: up.z - fwd.z * d }); };

/**
 * The pose for a swing state (pure; hull frame, +x the mech's left, +z ahead). In the swing the hand runs round an arc
 * centred a little in from, below and ahead of the shoulder, at the swing's angle; the blade points out along the
 * same angle, raised by the wind-up's lift and tipped down through the slash, its edge leading the way it cuts. At rest
 * (guard 1) the hand sits in front of the shoulder with the blade back over it, edge up. Between them it blends.
 * `aimYaw`: the aim off the hull's heading (the swing is centred on it). `side` mirrors the left arm's values.
 */
export function swordPose(angle: number, lift: number, guard: number, dir: number, side: 1 | -1, aimYaw: number, shoulder: V, v: SwordValues): SwordPose {
  const a = angle + aimYaw;
  const pitch = lift * v.swordLift * D2R - (1 - lift) * v.swordDroop * D2R;
  const c = { x: shoulder.x - side * v.swordArcIn, y: shoulder.y - v.swordArcDrop + lift * v.swordLiftHand, z: shoulder.z + v.swordArcFwd };
  const sHand = { x: c.x + Math.sin(a) * v.swordArcRadius, y: c.y, z: c.z + Math.cos(a) * v.swordArcRadius };
  const sFwd = { x: Math.sin(a) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(a) * Math.cos(pitch) };
  // The way it moves (the angle falls for dir +1): the edge leads, so the spine faces back against it.
  const sUp = square(sFwd, { x: Math.cos(a) * dir, y: 0.15, z: -Math.sin(a) * dir });
  const gHand = { x: shoulder.x - side * v.swordGuardIn, y: shoulder.y + v.swordGuardUp, z: shoulder.z + v.swordGuardFwd };
  const t = v.swordGuardTilt * D2R, o = side * v.swordGuardOut * D2R;
  const gFwd = norm({ x: Math.sin(o) * Math.cos(t), y: Math.sin(t), z: -Math.cos(o) * Math.cos(t) });
  const gUp = square(gFwd, { x: 0, y: -1, z: 0 });
  const k = Math.max(0, Math.min(1, guard));
  const fwd = norm(lerpV(sFwd, gFwd, k));
  // Blend the spine through the swing's when they'd cancel (rest's spine faces down, the swing's sideways).
  const up = square(fwd, lerpV(sUp, gUp, k));
  return { hand: lerpV(sHand, gHand, k), fwd, up: Number.isFinite(up.x) ? up : square(fwd, cross(fwd, { x: 1, y: 0, z: 0 })) };
}

/**
 * Two-bone reach (pure): the elbow for a shoulder, a hand and the bones' lengths, bent toward `pole`. The hand is pulled
 * in to the arm's reach when it's farther; returns the hand used too.
 */
export function armIk(s: V, h: V, upper: number, fore: number, pole: V): { elbow: V; hand: V } {
  const dx = h.x - s.x, dy = h.y - s.y, dz = h.z - s.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-6;
  const u = { x: dx / dist, y: dy / dist, z: dz / dist };
  const d = Math.max(Math.abs(upper - fore) + 1e-3, Math.min(upper + fore - 1e-3, dist));
  const hand = { x: s.x + u.x * d, y: s.y + u.y * d, z: s.z + u.z * d };
  const x = (upper * upper - fore * fore + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, upper * upper - x * x));
  const q = square(u, pole);
  return { elbow: { x: s.x + u.x * x + q.x * hgt, y: s.y + u.y * x + q.y * hgt, z: s.z + u.z * x + q.z * hgt }, hand };
}
