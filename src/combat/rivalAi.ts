// The rival mech's brain (Keith 2026-10-29: "a harder enemy, another rival mech, and make that feel scary"). Pure:
// it reads a plain-data view of the fight (itself, its foe, the threats in the air, the cover, a line-of-sight test)
// and returns the same commands the player's mech takes (multiplayer rule 12: sims take commands): move (WASD),
// aim and shotAt (the mouse: where the arms swing, where the rounds go), lock and cursor (the soft lock and the ground
// point the launchers use), a trigger per side (the mouse buttons), keys 1-3 (hold to paint, release to fire), a dash
// (Space) and the Shift run. It never moves a sim, never reads input, and its randomness is seeded.
//
// Scary and smart, not cheating: it notices things only after its reaction time, leads with a share of the true lead
// and a slowly wandering aim error (so a player who changes direction makes it miss), and dodges by the same dash the
// player has, on the same charges. States: engage (hold its range band, circle), press (the foe is exposed: close in,
// everything fires), cover (weapons cooling and hurt: behind a drift, peek out when ready), retreat (hull low: open
// the range, use cover, keep the mortars coming). Dodges ride over every state.
// Ownership: host (an enemy's decisions).
import type { Param } from "../core/tweaks";
import type { MoveCommand } from "../mech/walker";
import type { Aim } from "../mech/upper";
import type { TargetCandidate } from "../game/targeting";
import { rng } from "../items/generate";
import { preferredRange, type KitWeapon } from "./rivalKit";

export const RIVAL_AI_DEFAULTS = {
  aiAggression: 0.5,
  aiReaction: 0.6,
  aiAimError: 1.2,
  aiAimDrift: 0.6,
  aiAimLag: 0.8,
  aiAimTurn: 30,
  aiAimLead: 0.1,
  aiMoveError: 0.25,
  aiReacquire: 1.2,
  aiRailHold: 0.7,
  aiLead: 0.35,
  aiDashUse: 0.5,
  aiDashKeep: 1,
  aiRailDodge: 0.95,
  aiRange: 0,
  aiRangeBand: 8,
  aiStrafe: 0.7,
  aiStrafeFlip: 3.5,
  aiRetreatAt: 0.35,
  aiCover: 0.6,
  aiPeek: 2.5,
  aiPaintTime: 0.7,
  aiPressRange: 0.65,
};
export type RivalAiValues = typeof RIVAL_AI_DEFAULTS;

/**
 * Rival levels (Keith 2026-10-31: "varying levels of rival capability"): presets over the sliders above plus the hull
 * share. Recruit is the default and (Keith 2026-10-31: "definitely not strong enough") its hull and gear are on par with the player's default mech
 * (hull x1; it stays easy by its aim lag, reaction and lead, which is what makes it fair). Veteran and Ace add hull on top. A rival
 * can also roll its items N levels above the player's (the duel lab's rivalUp).
 */
export type RivalLevel = "recruit" | "veteran" | "ace";
export const RIVAL_LEVEL_IDS: RivalLevel[] = ["recruit", "veteran", "ace"];
export const RIVAL_LEVELS: Record<RivalLevel, Partial<RivalAiValues> & { rivalHull: number }> = {
  recruit: { aiReaction: 0.6, aiAimLag: 0.8, aiAimTurn: 30, aiAimLead: 0.1, aiAimError: 1.2, aiMoveError: 0.25, aiReacquire: 1.2, aiRailHold: 0.7, aiRailDodge: 0.95, aiDashUse: 0.5, aiAggression: 0.5, aiLead: 0.35, rivalHull: 1 },
  veteran: { aiReaction: 0.35, aiAimLag: 0.3, aiAimTurn: 70, aiAimLead: 0.5, aiAimError: 0.8, aiMoveError: 0.15, aiReacquire: 0.7, aiRailHold: 0.3, aiRailDodge: 0.9, aiDashUse: 0.75, aiAggression: 0.6, aiLead: 0.85, rivalHull: 1.15 },
  ace: { aiReaction: 0.2, aiAimLag: 0.12, aiAimTurn: 140, aiAimLead: 0.9, aiAimError: 0.4, aiMoveError: 0.08, aiReacquire: 0.35, aiRailHold: 0.1, aiRailDodge: 0.85, aiDashUse: 0.9, aiAggression: 0.7, aiLead: 1, rivalHull: 1.3 },
};

const G = "Rival AI";
export const RIVAL_AI_PARAMS: Param[] = [
  { key: "aiAggression", label: "Aggression (0 careful, 1 reckless)", min: 0, max: 1, step: 0.05, group: G, tip: "How readily it presses an exposed foe, how often it uses its shoulder weapons, how late it backs off" },
  { key: "aiReaction", label: "Reaction time (s)", min: 0, max: 1.5, step: 0.05, group: G, tip: "Before it notices a new threat in the air, and how far behind the foe's changes of direction its aim runs" },
  { key: "aiAimError", label: "Aim error (m at 30 m)", min: 0, max: 6, step: 0.1, group: G, tip: "A slowly wandering offset on its aim point, growing with range: readable misses, not perfect tracking" },
  { key: "aiAimDrift", label: "Aim error wander (per s)", min: 0.05, max: 3, step: 0.05, group: G },
  { key: "aiAimLag", label: "Aim lag (s)", min: 0, max: 2, step: 0.05, group: G, tip: "Its aim point chases where it last saw you with this time constant: strafe or dash and it trails behind" },
  { key: "aiAimTurn", label: "Aim swing speed (deg/s)", min: 5, max: 360, step: 5, group: G, tip: "The fastest its aim line can sweep round it; the rail's line moves no faster" },
  { key: "aiAimLead", label: "Aim lead (share)", min: 0, max: 1.5, step: 0.05, group: G, tip: "How much it leads your motion with direct fire and the rail: partial and late, from what it saw a reaction ago" },
  { key: "aiMoveError", label: "Extra miss per m/s you move across it", min: 0, max: 1, step: 0.05, group: G, tip: "Spread grows with your sideways speed (m of error at 30 m per m/s)" },
  { key: "aiReacquire", label: "Re-acquire after cover (s)", min: 0, max: 4, step: 0.1, group: G, tip: "Once you break its line of sight it aims at the last spot it saw you and holds fire; it needs this long after seeing you again" },
  { key: "aiRailHold", label: "Rail holds the full charge (s)", min: 0, max: 2, step: 0.05, group: G, tip: "A fully charged rail waits this long (jittered) before it fires, the line showing where it points" },
  { key: "aiLead", label: "Lead (share of the true lead)", min: 0, max: 1.5, step: 0.05, group: G, tip: "How much of the foe's motion it leads its rockets, shells and mortars by" },
  { key: "aiDashUse", label: "Dash use (share of dodges)", min: 0, max: 1, step: 0.05, group: G, tip: "Share of threats it can't walk out of in time that it dashes out of" },
  { key: "aiDashKeep", label: "Dash charges kept for dodges", min: 0, max: 4, step: 1, group: G, tip: "It won't dash to reposition below this many charges" },
  { key: "aiRailDodge", label: "Dodges a charging rail at (charge)", min: 0.3, max: 1, step: 0.05, group: G, tip: "A rail charging along a line through it: it dashes across once the charge passes this" },
  { key: "aiRange", label: "Preferred range (m, 0: its weapons')", min: 0, max: 90, step: 1, group: G },
  { key: "aiRangeBand", label: "Range band (± m)", min: 1, max: 30, step: 1, group: G },
  { key: "aiStrafe", label: "Strafe (circling share)", min: 0, max: 1, step: 0.05, group: G },
  { key: "aiStrafeFlip", label: "Strafe flips every (s, mean)", min: 0.5, max: 15, step: 0.25, group: G },
  { key: "aiRetreatAt", label: "Backs off at hull share", min: 0, max: 1, step: 0.05, group: G },
  { key: "aiCover", label: "Uses cover (0 never)", min: 0, max: 1, step: 0.05, group: G },
  { key: "aiPeek", label: "Peeks out of cover for (s)", min: 0.5, max: 8, step: 0.25, group: G },
  { key: "aiPaintTime", label: "Holds a shoulder paint (s)", min: 0.1, max: 3, step: 0.05, group: G, tip: "Its mortar rings and strips show this long before they fire: the player's chance to read them" },
  { key: "aiPressRange", label: "Pressing: range share", min: 0.2, max: 1, step: 0.05, group: G, tip: "When the foe is exposed it closes to this share of its preferred range" },
];

// ---- The view (plain data the lab or the headless duel fills each frame) ----

export interface WeaponState {
  /** Index into the kit. */
  i: number;
  /** Ready to fire (cooldown over, not mid-volley). */
  ready: boolean;
  /** A rail's charge 0..1 while held. */
  charge: number;
}

export interface DuelSelf {
  x: number; z: number; vx: number; vz: number; heading: number;
  /** Hull share 0..1. */
  health: number;
  dashCharges: number;
  canDash: boolean;
  /** Mid-dash (its steps and the glide after). */
  dashing: boolean;
  walkSpeed: number;
  kit: readonly KitWeapon[];
  weapons: readonly WeaponState[];
}

export interface DuelFoe {
  x: number; y: number; z: number; vx: number; vz: number;
  health: number;
  dashCharges: number;
  alive: boolean;
  /** Sprinting with the weapons off, in the air, staggered by a landing. */
  gunsOff: boolean;
  airborne: boolean;
  staggered: boolean;
  /** Its hit radius (m). */
  r: number;
}

/**
 * Something coming that covers ground: a ring (a mortar's landing, a rocket's blast, a missile swarm's area), a line
 * (a painted strip, a charging rail's line, a rocket's path). `t`: seconds until it hits (Infinity: unknown, a rail
 * still charging); `charge` for a rail. Ids are stable for its life (the AI remembers when it first saw each).
 */
export interface Threat {
  id: number;
  kind: "ring" | "line";
  /** Ring centre, or the line's far end. */
  x: number; z: number;
  /** Line start. */
  ax?: number; az?: number;
  /** Ring radius, or the line's half width. */
  r: number;
  t: number;
  rail?: boolean;
  charge?: number;
  /** Follows it down (a missile swarm): no getting out, but a dash as it lands halves the damage (the shove's cut). */
  homing?: boolean;
}

export interface DuelView {
  /** Seconds since the round began. */
  t: number;
  self: DuelSelf;
  foe: DuelFoe;
  threats: readonly Threat[];
  /** Cover drifts (centre, half length, half width, heading). */
  cover: readonly { x: number; z: number; yaw: number; hl: number; hw: number }[];
  /** Can a mech at a see one at b? */
  sees: (ax: number, az: number, bx: number, bz: number) => boolean;
  /** Keep inside this circle. */
  arena: { x: number; z: number; r: number };
}

/** The commands a mech takes: the player's controls, as data. */
export interface MechCommand {
  move: MoveCommand;
  /** Where the arms swing (null: forward) and where the rounds go. */
  aim: Aim | null;
  shotAt: Aim | null;
  /** The ground point the launchers paint (the cursor) and the body it locks (the soft lock). */
  cursor: Aim | null;
  lock: TargetCandidate | null;
  trigger: [boolean, boolean];
  keys: [boolean, boolean, boolean, boolean];
  /** Dash this way this frame (null: no). */
  dash: { x: number; z: number } | null;
  /** Space held after the dash: carry on into the sprint. */
  dashHold: boolean;
}

export type RivalState = "engage" | "press" | "cover" | "retreat";

/** What it did, for the HUD and the checks. */
export interface RivalStats { dodgeDashes: number; dodgeWalks: number; threatsSeen: number; states: Record<RivalState, number> }

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Distance from (px, pz) to the segment a-b, and which side (+1 left of a->b, -1 right). */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  const side = dx * (pz - az) - dz * (px - ax) >= 0 ? 1 : -1;
  return { d: Math.hypot(px - cx, pz - cz), side, t };
}

export class RivalAi {
  state: RivalState = "engage";
  /** Why it's in that state (HUD). */
  note = "";
  stats: RivalStats = { dodgeDashes: 0, dodgeWalks: 0, threatsSeen: 0, states: { engage: 0, press: 0, cover: 0, retreat: 0 } };
  private r: () => number;
  private stateFor = 0;
  private strafe = 1;
  private flipIn = 2;
  /** The foe as it has noticed it (what it saw a reaction time ago; frozen while it can't see you). */
  private fvx = 0;
  private fvz = 0;
  private hist: { t: number; x: number; z: number; vx: number; vz: number }[] = [];
  /** The aim point, in polar round the rival: bearing and range, chasing the noticed foe with a lag and a swing limit. */
  private ab = 0;
  private ar = 30;
  private aimInit = false;
  private seenAt = -1e9;
  private prevSees = true;
  private railSince = -1;
  private railWait = 0;
  /** When each threat was first seen, and the decision made for it (dash or walk). */
  private seen = new Map<number, { t: number; dash: boolean; delay: number; charged: number }>();
  /** Where it has noticed the foe to be (eased toward the truth over the reaction time). */
  private fx = NaN;
  private fz = NaN;
  /** Walking out of a threat: this way until then. */
  private evade: { x: number; z: number; until: number } | null = null;
  /** Stuck: asked to move but barely moving. */
  private slow = 0;
  private unstick: { x: number; z: number; until: number } | null = null;
  /** The shoulder weapon being painted (kit index), since when and for how long. */
  private painting: { i: number; since: number; hold: number } | null = null;
  private shoulderIn = 2;
  /** Cover: the spot it's going for, and the peek timer. */
  private coverAt: { x: number; z: number } | null = null;
  private peekUntil = 0;
  /** Seconds at its cover spot, and seconds the foe has been out of sight. */
  private hidFor = 0;
  private blindFor = 0;
  private noiseA = 0;
  private noiseB = 0;

  constructor(public v: RivalAiValues, seed = 1) {
    this.r = rng(seed * 2654435761 + 7);
    this.noiseA = this.r() * 100; this.noiseB = this.r() * 100;
    this.flipIn = this.flipTime();
  }

  reset() {
    this.state = "engage"; this.stateFor = 0; this.seen.clear(); this.evade = null; this.unstick = null; this.painting = null;
    this.coverAt = null; this.slow = 0; this.hidFor = 0; this.blindFor = 0; this.peekUntil = 0; this.fvx = 0; this.fvz = 0; this.fx = NaN; this.fz = NaN;
    this.hist.length = 0; this.aimInit = false; this.seenAt = -1e9; this.prevSees = true; this.railSince = -1;
  }

  private flipTime() { return this.v.aiStrafeFlip * (0.4 + 1.2 * this.r()); }

  /** One decision. dt: seconds since the last. */
  decide(view: DuelView, dt: number): MechCommand {
    const v = this.v, s = view.self, f = view.foe;
    const cmd: MechCommand = { move: { x: 0, z: 0, sprint: false }, aim: null, shotAt: null, cursor: null, lock: null, trigger: [false, false], keys: [false, false, false, false], dash: null, dashHold: false };
    this.stateFor += dt;
    if (!f.alive) { this.painting = null; return cmd; }
    const dx = f.x - s.x, dz = f.z - s.z, dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist, uz = dz / dist;
    const sees = view.sees(s.x, s.z, f.x, f.z);
    // Line of sight broken: it keeps the last spot it saw you, holds fire, and needs aiReacquire after you show again.
    if (sees && !this.prevSees) this.seenAt = view.t;
    this.prevSees = sees;
    const acquired = sees && view.t - this.seenAt >= v.aiReacquire;
    // What it has noticed of the foe: the position and motion from a reaction time ago (only fed while it can see you).
    if (acquired) {
      this.hist.push({ t: view.t, x: f.x, z: f.z, vx: f.vx, vz: f.vz });
      while (this.hist.length > 1 && this.hist[1].t <= view.t - v.aiReaction) this.hist.shift();
      const h0 = this.hist[0];
      if (h0.t <= view.t - v.aiReaction || !Number.isFinite(this.fx)) { this.fx = h0.x; this.fz = h0.z; this.fvx = h0.vx; this.fvz = h0.vz; }
    } else this.hist.length = 0;
    if (!Number.isFinite(this.fx)) { this.fx = f.x; this.fz = f.z; this.fvx = f.vx; this.fvz = f.vz; } // round start: it knows where you are

    // ---- Which state ----
    const base = v.aiRange > 0 ? v.aiRange : preferredRange(s.kit);
    const exposed = f.gunsOff || f.airborne || f.staggered || f.dashCharges === 0 || f.health < 0.3;
    const cooling = s.weapons.length > 0 && s.weapons.every((w) => !w.ready);
    let want: RivalState = "engage";
    const peeking = view.t < this.peekUntil;
    if (!peeking && s.health < v.aiRetreatAt * (1.3 - v.aiAggression * 0.6) && f.health > s.health * 0.7) want = "retreat";
    else if (exposed && v.aiAggression + (f.health < s.health ? 0.2 : 0) >= 0.45) want = "press";
    else if (!peeking && v.aiCover > 0 && view.cover.length && (cooling || s.health < 0.7) && (this.state === "cover" || this.r() < v.aiCover * dt * 2)) want = "cover";
    // Hold a state a little (no flicker), except to retreat or press at once.
    if (want !== this.state && (this.stateFor > 1.2 || want === "retreat" || want === "press")) {
      this.state = want; this.stateFor = 0; this.coverAt = null; this.hidFor = 0;
    }
    // Cover (and a retreat to it) is held only while it's useful: hidden a while with something ready, or too long,
    // and it steps out to fight for aiPeek before it may go back (hull doesn't come back by hiding).
    if ((this.state === "cover" || this.state === "retreat") && (this.hidFor > (cooling ? 4 : 1.5) || this.stateFor > 10)) {
      this.state = "engage"; this.stateFor = 0; this.peekUntil = view.t + v.aiPeek; this.coverAt = null; this.hidFor = 0;
    }
    // The foe out of sight while fighting: work round to an angle on it.
    this.blindFor = sees ? 0 : this.blindFor + dt;
    this.stats.states[this.state] += dt;
    const range = this.state === "press" ? base * v.aiPressRange : this.state === "retreat" ? base * 1.4 : base;

    // ---- Movement ----
    let mx = 0, mz = 0;
    // Strafe: circle the foe, flipping now and then.
    this.flipIn -= dt;
    if (this.flipIn <= 0) { this.strafe = -this.strafe; this.flipIn = this.flipTime(); }
    const tx = -uz * this.strafe, tz = ux * this.strafe;
    const off = dist - range;
    const radial = Math.abs(off) < v.aiRangeBand ? off / v.aiRangeBand * 0.3 : Math.sign(off);
    mx = ux * radial * (1 - v.aiStrafe * 0.5) + tx * v.aiStrafe;
    mz = uz * radial * (1 - v.aiStrafe * 0.5) + tz * v.aiStrafe;
    // Lost sight in a fight: circle harder and close a little to get an angle round the cover.
    if (this.blindFor > 1.5 && (this.state === "engage" || this.state === "press")) { mx = tx + ux * 0.4; mz = tz + uz * 0.4; }
    this.note = this.state === "press" ? "pressing: you're exposed" : this.state === "retreat" ? "hurt: backing off" : `range ${Math.round(dist)} / ${Math.round(range)} m`;
    if (this.state === "cover" || (this.state === "retreat" && v.aiCover > 0)) {
      const c = this.coverAt ?? (this.coverAt = this.pickCover(view));
      if (c) {
        const cx = c.x - s.x, cz = c.z - s.z, cd = Math.hypot(cx, cz);
        if (cd > 1.5) { mx = cx / cd; mz = cz / cd; cmd.move.sprint = cd > 20; }
        else { mx = 0; mz = 0; this.hidFor += dt; }
        this.note = this.state === "cover" ? "into cover (weapons cooling)" : "hurt: backing off to cover";
      }
    }
    // Keep inside the arena, out of the drifts.
    const ar = view.arena, ad = Math.hypot(s.x - ar.x, s.z - ar.z);
    if (ad > ar.r - 12) { const kIn = clamp((ad - (ar.r - 12)) / 8, 0, 1.5); mx -= (s.x - ar.x) / ad * kIn * 2; mz -= (s.z - ar.z) / ad * kIn * 2; }
    ({ x: mx, z: mz } = this.avoidCover(view, s.x, s.z, mx, mz));
    // Stuck: asked to walk but hardly moving (against a face): try another way for a moment.
    const askSp = Math.hypot(mx, mz), sp = Math.hypot(s.vx, s.vz);
    if (askSp > 0.5 && sp < 1 && !s.dashing) this.slow += dt; else this.slow = Math.max(0, this.slow - dt * 2);
    if (this.slow > 1.5 && !this.unstick) {
      const a = this.r() * Math.PI * 2;
      this.unstick = { x: Math.sin(a), z: Math.cos(a), until: view.t + 1.2 };
      this.strafe = -this.strafe; this.slow = 0; this.coverAt = null;
    }
    if (this.unstick) { if (view.t > this.unstick.until) this.unstick = null; else { mx = this.unstick.x; mz = this.unstick.z; } }

    // ---- Dodges: over every state ----
    const dodge = this.dodge(view, cmd);
    if (dodge) { mx = dodge.x; mz = dodge.z; }
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) { cmd.move.x = mx / Math.max(1, ml); cmd.move.z = mz / Math.max(1, ml); }

    // A reckless rival dashes in to press a foe that's out of dashes (keeping its reserve); never with its own rail
    // charging (Keith 2026-10-31: a dash drops the charge).
    if (!cmd.dash && !this.railCharging(s) && this.state === "press" && s.canDash && s.dashCharges > v.aiDashKeep && dist > range + 10 && sees && this.r() < v.aiAggression * dt * 0.8) {
      cmd.dash = { x: ux + tx * 0.6, z: uz + tz * 0.6 };
    }

    // ---- Aim: it chases what it noticed, with a lag and a swing limit; lead is partial; error grows as you move ----
    this.noiseA += dt * v.aiAimDrift; this.noiseB += dt * v.aiAimDrift * 1.37;
    // Your speed across its line of fire.
    const across = Math.abs(f.vx * -uz + f.vz * ux);
    const err = (v.aiAimError + v.aiMoveError * across) * (dist / 30) * (this.state === "press" ? 0.8 : 1);
    const ex = Math.sin(this.noiseA * 2.1) * 0.6 + Math.sin(this.noiseA * 0.77 + 1.3) * 0.4;
    const ez = Math.sin(this.noiseB * 1.7 + 0.4) * 0.6 + Math.sin(this.noiseB * 0.53 + 2.2) * 0.4;
    const tgx = this.fx + this.fvx * v.aiAimLead * 0.5, tgz = this.fz + this.fvz * v.aiAimLead * 0.5;
    const tb = Math.atan2(tgx - s.x, tgz - s.z), tr = Math.hypot(tgx - s.x, tgz - s.z);
    if (!this.aimInit) { this.ab = tb; this.ar = tr; this.aimInit = true; }
    const ka = 1 - Math.exp(-dt / Math.max(0.01, v.aiAimLag));
    let dB = tb - this.ab; dB -= Math.round(dB / (Math.PI * 2)) * Math.PI * 2;
    const maxStep = v.aiAimTurn * Math.PI / 180 * dt;
    this.ab += clamp(dB * ka, -maxStep, maxStep);
    this.ar += (tr - this.ar) * ka;
    const hx = s.x + Math.sin(this.ab) * this.ar + ex * err, hz = s.z + Math.cos(this.ab) * this.ar + ez * err;
    cmd.shotAt = { x: hx, y: f.y, z: hz };
    cmd.aim = { x: hx, y: f.y, z: hz };
    cmd.lock = { x: hx, y: f.y, z: hz, r: f.r, key: "foe", vx: this.fvx * v.aiLead, vz: this.fvz * v.aiLead };
    // The launchers' ground point: led by the flight of what's being fired (the slowest painted one, else rockets).
    const lead = (speed: number, flight = 0) => (speed === Infinity ? 0 : dist / Math.max(1, speed)) + flight;
    const paintK = this.painting ? s.kit[this.painting.i] : s.kit.find((w) => w.kind === "rpg") ?? null;
    const lt = paintK ? lead(paintK.speed, paintK.flight) * v.aiLead : 0;
    cmd.cursor = { x: hx + this.fvx * lt, y: f.y - 1.5, z: hz + this.fvz * lt };

    // ---- Fire ----
    this.fire(view, cmd, dist, acquired, dt);
    return cmd;
  }

  /** One of its own rails is charging (a dash would drop the charge). */
  private railCharging(s: DuelSelf) { return s.weapons.some((w) => w.charge > 0.05 && s.kit[w.i]?.kind === "rail"); }

  /** Threats it has noticed that cover where it is: walk or dash out. Returns a move to override with, or null. */
  private dodge(view: DuelView, cmd: MechCommand): { x: number; z: number } | null {
    const v = this.v, s = view.self;
    const now = view.t;
    for (const id of [...this.seen.keys()]) if (!view.threats.some((t) => t.id === id)) this.seen.delete(id);
    let best: { x: number; z: number; urgency: number; need: number; t: number; id: number; rail: boolean } | null = null;
    for (const th of view.threats) {
      let mem = this.seen.get(th.id);
      if (!mem) { mem = { t: now, dash: this.r() < v.aiDashUse, delay: this.r() * 1.0, charged: -1 }; this.seen.set(th.id, mem); this.stats.threatsSeen++; }
      if (now - mem.t < v.aiReaction) continue;
      // Homing: brace with a dash across the foe's line just as it comes down.
      if (th.homing) {
        if (th.t < 0.3 && mem.dash && s.canDash && s.dashCharges > 0 && !s.dashing) {
          const fx = view.foe.x - s.x, fz = view.foe.z - s.z, l = Math.hypot(fx, fz) || 1, sd = th.id % 2 ? 1 : -1;
          cmd.dash = { x: (-fz / l) * sd, z: (fx / l) * sd };
          mem.dash = false;
          this.stats.dodgeDashes++;
        }
        continue;
      }
      const margin = 2.2;
      let out: { x: number; z: number; need: number } | null = null;
      if (th.kind === "ring") {
        const ddx = s.x - th.x, ddz = s.z - th.z, d = Math.hypot(ddx, ddz);
        if (d < th.r + margin) {
          const nx = d > 0.3 ? ddx / d : Math.cos(th.id), nz = d > 0.3 ? ddz / d : Math.sin(th.id);
          out = { x: nx, z: nz, need: th.r + margin - d };
        }
      } else {
        const q = segDist(s.x, s.z, th.ax!, th.az!, th.x, th.z);
        if (q.d < th.r + margin && q.t > 0.02) {
          const lx = th.x - th.ax!, lz = th.z - th.az!, l = Math.hypot(lx, lz) || 1;
          // Across the line, to whichever side it's on (a coin for dead centre).
          const side = q.d < 0.3 ? (th.id % 2 ? 1 : -1) : q.side;
          out = { x: (-lz / l) * side, z: (lx / l) * side, need: th.r + margin - q.d };
        }
      }
      if (!out) continue;
      // A rail still charging: dash across once its charge passes aiRailDodge (it can't be walked out of).
      // A rail can't be outrun (the slug is instant): once it's charged past aiRailDodge, dash after a random beat (so
      // the shooter can't time the release to it), hoping to be mid-shove (half damage) or off the line of a manual aim.
      const rail = !!th.rail;
      if (rail && (th.charge ?? 0) >= v.aiRailDodge && mem.charged < 0) mem.charged = now;
      const t = rail ? (mem.charged >= 0 && now - mem.charged >= mem.delay ? 0 : Infinity) : th.t;
      const urgency = t === Infinity ? 0 : 1 / Math.max(0.05, t);
      if (!best || urgency > best.urgency) best = { ...out, urgency, t, id: th.id, rail };
    }
    if (!best) { this.evade = this.evade && this.evade.until > now ? this.evade : null; return this.evade; }
    const walkT = best.need / Math.max(1, s.walkSpeed * 0.8) + 0.15;
    const mem = this.seen.get(best.id)!;
    // Out of time to walk: dash (if it chose to for this one and has a charge), else walk and hope. With its own rail
    // charging (Keith 2026-10-31: a dash drops it) it keeps the charge against a foe's rail (that dash is a gamble on the
    // timing) and only throws it away for a hit it can't walk out of.
    if (best.t < walkT && mem.dash && s.canDash && s.dashCharges > 0 && !s.dashing && !(best.rail && this.railCharging(s))) {
      cmd.dash = { x: best.x, z: best.z };
      mem.dash = false; // one dash per threat
      this.stats.dodgeDashes++;
      this.evade = { x: best.x, z: best.z, until: now + 0.6 };
      return this.evade;
    }
    if (best.t !== Infinity || best.rail) {
      if (!this.evade || this.evade.until < now) this.stats.dodgeWalks++;
      this.evade = { x: best.x, z: best.z, until: now + 0.4 };
      return this.evade;
    }
    return null;
  }

  /** The drift spot that hides it from the foe best: behind a drift (from the foe's side), nearest first. */
  private pickCover(view: DuelView): { x: number; z: number } | null {
    const s = view.self, f = view.foe;
    let best: { x: number; z: number } | null = null, bestScore = Infinity;
    for (const c of view.cover) {
      const ax = c.x - f.x, az = c.z - f.z, ad = Math.hypot(ax, az) || 1;
      const back = Math.max(c.hl, c.hw) * 0.6 + 5;
      const x = c.x + (ax / ad) * back, z = c.z + (az / ad) * back;
      if (Math.hypot(x - view.arena.x, z - view.arena.z) > view.arena.r - 8) continue;
      const travel = Math.hypot(x - s.x, z - s.z);
      // Not past the foe to get there.
      const toward = ((x - s.x) * (f.x - s.x) + (z - s.z) * (f.z - s.z)) / Math.max(1, Math.hypot(f.x - s.x, f.z - s.z));
      const score = travel + Math.max(0, toward) * 1.5 + (view.sees(x, z, f.x, f.z) ? 30 : 0);
      if (score < bestScore && travel < 60) { bestScore = score; best = { x, z }; }
    }
    return best;
  }

  /** Steer round the drifts: a move into one slides along it. */
  private avoidCover(view: DuelView, x: number, z: number, mx: number, mz: number) {
    for (const c of view.cover) {
      const rr = Math.max(c.hl, c.hw) + 3;
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
      if (d > rr || d < 1e-3) continue;
      const nx = dx / d, nz = dz / d, into = -(mx * nx + mz * nz);
      if (into > 0) { mx += nx * into * 1.2; mz += nz * into * 1.2; }
    }
    return { x: mx, z: mz };
  }

  /** Which weapons fire this frame. */
  private fire(view: DuelView, cmd: MechCommand, dist: number, sees: boolean, dt: number) {
    const v = this.v, s = view.self, f = view.foe;
    const press = this.state === "press";
    for (const w of s.weapons) {
      const k = s.kit[w.i];
      if (!("trigger" in k.ctl)) continue;
      const side = k.ctl.trigger;
      const inRange = dist < k.range * 0.95 && dist > k.minRange;
      if (!sees || !inRange) {
        // A charged rail keeps its charge while the foe is hidden (released when it shows, or let go after a while).
        if (k.kind === "rail" && w.charge > 0 && w.charge < 1) cmd.trigger[side] = true;
        continue;
      }
      if (k.kind === "rail") {
        // Charge, and let go once full (or a little early when pressing).
        const full = w.charge >= (press ? 0.85 : 1);
        if (!full) this.railSince = -1;
        else if (this.railSince < 0) { this.railSince = view.t; this.railWait = v.aiRailHold * (0.6 + this.r() * 0.8); }
        cmd.trigger[side] = (w.ready || w.charge > 0) && (!full || view.t - this.railSince < this.railWait);
      } else cmd.trigger[side] = w.ready || k.kind === "minigun" || k.kind === "autocannon";
    }
    // Shoulder weapons: one painted at a time, held long enough to read, then released.
    if (this.painting) {
      const p = this.painting, k = s.kit[p.i];
      if (view.t - p.since < p.hold) { if ("key" in k.ctl) cmd.keys[k.ctl.key - 1] = true; return; }
      this.painting = null; // released this frame (the key goes up)
      this.shoulderIn = (2.5 - v.aiAggression * 1.8) * (0.6 + this.r() * 0.8);
      return;
    }
    this.shoulderIn -= dt * (press ? 2 : 1);
    if (this.shoulderIn > 0) return;
    const ready = s.weapons.filter((w) => {
      const k = s.kit[w.i];
      if (!("key" in k.ctl) || !w.ready || dist > k.range * 0.95 || dist < k.minRange + 2) return false;
      // The mortar lobs over cover; the rest need to see.
      return k.kind === "mortar" || sees;
    });
    if (!ready.length) return;
    // A mortar loves a still or cornered foe; anything goes on an exposed one.
    const pick = ready[Math.floor(this.r() * ready.length)];
    const hold = v.aiPaintTime * (press ? 0.6 : 1) * (0.8 + this.r() * 0.5);
    this.painting = { i: pick.i, since: view.t, hold };
    const k = s.kit[pick.i];
    if ("key" in k.ctl) cmd.keys[k.ctl.key - 1] = true;
    void f;
  }
}
