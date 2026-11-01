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
  swordDamage: 260,
  swordAp: 0.5,
  swordReach: 7,
  swordArc: 150,
  swordWindup: 0.2,
  swordSlash: 0.16,
  swordRecover: 0.32,
  swordComboAt: 0.45,
  swordCleave: 4,
  swordHeight: 5,
  swordHalf: 0.5,
  swordKnock: 9,
  swordLunge: 7,
  swordHitch: 0.06,
  swordStop: 0.07,
  swordStopScale: 0.08,
  swordShake: 0.55,
  swordRest: 35,
  swordLift: 40,
  swordLength: 1,
  swordTrail: 1,
  swordLevel: 0.7,
};
export type SwordValues = typeof SWORD_DEFAULTS;

export const SWORD_GROUP = "Sword";
const G = SWORD_GROUP;
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
  { key: "swordLunge", label: "Lunge (m/s)", min: 0, max: 25, step: 0.5, group: G, tip: "The mech steps into the slash at this speed toward the aim" },
  { key: "swordHitch", label: "Blade stalls on a hit (s)", min: 0, max: 0.3, step: 0.005, group: G, tip: "The swing freezes this long on its first body" },
  { key: "swordStop", label: "Hit stop (s)", min: 0, max: 0.3, step: 0.005, group: G, tip: "The whole fight slows this long on the first body (the player's own swings only)" },
  { key: "swordStopScale", label: "Hit stop speed", min: 0, max: 1, step: 0.01, group: G, tip: "How fast time runs during the hit stop (0 frozen, 1 off)" },
  { key: "swordShake", label: "Camera shake on a hit", min: 0, max: 2, step: 0.01, group: G },
  { key: "swordRest", label: "Rest angle outboard (°)", min: -60, max: 90, step: 1, group: G },
  { key: "swordLift", label: "Wind-up lift (°)", min: 0, max: 90, step: 1, group: G, tip: "The blade raises this much as it cocks, and comes down flat through the slash" },
  { key: "swordLength", label: "Blade drawn × reach", min: 0.3, max: 1.5, step: 0.01, group: G, tip: "The model's blade length as a share of the reach" },
  { key: "swordTrail", label: "Swing trail", min: 0, max: 3, step: 0.05, group: G },
  { key: "swordLevel", label: "Sound level", min: 0, max: 1.5, step: 0.01, group: G },
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
  stop() { this.phase = "idle"; this.t = 0; this.hitch = 0; this.lift = 0; this.slashK = 0; this.angle = this.restAngle(); }

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
      } else if (this.phase === "idle") { this.angle = rest; this.lift = 0; this.slashK = 0; return null; }
    }
    this.t += dt;
    const start = this.dir * half * 1.08, end = -this.dir * half;
    if (this.phase === "windup") {
      const k = Math.min(1, this.t / Math.max(1e-3, st.windup));
      this.angle = this.ended + (start - this.ended) * easeOut(k);
      this.lift = easeOut(k);
      this.slashK = 0;
      if (k >= 1) { this.phase = "slash"; this.t -= st.windup; this.cocked = this.angle; }
      else return null;
    }
    if (this.phase === "slash") {
      const from = this.angle;
      const k = Math.min(1, this.t / Math.max(1e-3, st.slash));
      this.angle = this.cocked + (end - this.cocked) * slashEase(k);
      this.lift = 1 - k;
      this.slashK = k;
      if (k >= 1) { this.phase = "recover"; this.t -= st.slash; this.ended = this.angle; this.slashK = 0; }
      return { from, to: this.angle };
    }
    // Recover: back to rest (a held trigger picks up the next swing from wherever it is).
    const k = Math.min(1, this.t / Math.max(1e-3, st.recover));
    this.angle = this.ended + (rest - this.ended) * easeInOut(k);
    this.lift = 0;
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
