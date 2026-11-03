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
import { isEnergyKind, preferredRange, type KitWeapon } from "./rivalKit";

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
  aiRailReaction: 0.15,
  aiRailLag: 0.08,
  aiRailTurn: 180,
  aiRailLead: 0.9,
  aiRailError: 0.5,
  aiSnapshot: 0.6,
  aiSnapJitter: 0,
  aiBurstAim: 0.6,
  aiBurst: 1,
  aiLead: 0.35,
  aiDodgeChance: 0.3,
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
  aiPaintSlew: 3,
  aiPressRange: 0.65,
  aiSwordPull: 0.95,
  aiSwordStrafe: 0.3,
  aiSwordFrom: 5,
  aiAimSweep: 8,
  aiSwordReaction: 0.25,
  aiSwordLag: 0.15,
  aiSwordTurn: 150,
  aiSwordLead: 0.6,
  aiSwordFace: 35,
  aiSwordTrackFrom: 14,
  aiSprintUse: 0.5,
  aiSprintFrom: 12,
  aiSprintArc: 70,
  aiSprintMax: 2.6,
  aiSprintSwerve: 0.5,
  aiSprintMirror: 0.6,
  aiReactorResume: 0.6,
  aiBarEdge: 2,
  aiPush: 0.2,
  aiPushTime: 4,
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
  recruit: { aiPush: 0.1, aiSprintUse: 0.35, aiSprintMirror: 0.4, aiAimSweep: 8, aiSwordReaction: 0.25, aiSwordLag: 0.15, aiSwordTurn: 150, aiSwordLead: 0.6, aiReaction: 0.45, aiAimLag: 0.5, aiAimTurn: 50, aiAimLead: 0.3, aiAimError: 1, aiMoveError: 0.25, aiReacquire: 1.2, aiRailReaction: 0.15, aiRailLag: 0.08, aiRailTurn: 180, aiRailLead: 0.9, aiRailError: 0.5, aiSnapshot: 0.6, aiRailDodge: 0.95, aiDodgeChance: 0.3, aiDashUse: 0.5, aiAggression: 0.5, aiLead: 0.35, rivalHull: 1 },
  veteran: { aiPush: 0.2, aiSprintUse: 0.5, aiSprintMirror: 0.6, aiAimSweep: 12, aiSwordReaction: 0.18, aiSwordLag: 0.1, aiSwordTurn: 220, aiSwordLead: 0.8, aiReaction: 0.3, aiAimLag: 0.25, aiAimTurn: 90, aiAimLead: 0.6, aiAimError: 0.8, aiMoveError: 0.15, aiReacquire: 0.7, aiRailReaction: 0.12, aiRailLag: 0.06, aiRailTurn: 220, aiRailLead: 0.95, aiRailError: 0.4, aiSnapshot: 0.55, aiRailDodge: 0.9, aiDodgeChance: 0.5, aiDashUse: 0.75, aiAggression: 0.6, aiLead: 0.85, rivalHull: 1.15 },
  ace: { aiPush: 0.35, aiSprintUse: 0.7, aiSprintMirror: 0.8, aiAimSweep: 18, aiSwordReaction: 0.12, aiSwordLag: 0.06, aiSwordTurn: 300, aiSwordLead: 1, aiReaction: 0.2, aiAimLag: 0.12, aiAimTurn: 160, aiAimLead: 0.9, aiAimError: 0.4, aiMoveError: 0.08, aiReacquire: 0.35, aiRailReaction: 0.08, aiRailLag: 0.04, aiRailTurn: 280, aiRailLead: 1, aiRailError: 0.25, aiSnapshot: 0.35, aiRailDodge: 0.85, aiDodgeChance: 0.75, aiDashUse: 0.9, aiAggression: 0.7, aiLead: 1, rivalHull: 1.3 },
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
  { key: "aiRailReaction", label: "Fast shots: reaction (s)", min: 0, max: 1, step: 0.01, group: G, tip: "Track then snapshot (Keith 2026-10-31): while a rail charges or an autocannon aims, it tracks you from what it saw this long ago (far tighter than the general reaction time)" },
  { key: "aiRailLag", label: "Fast shots: aim lag (s)", min: 0, max: 1, step: 0.01, group: G, tip: "Time constant of its aim while charging a rail or aiming a burst" },
  { key: "aiRailTurn", label: "Fast shots: swing speed (deg/s)", min: 5, max: 600, step: 5, group: G },
  { key: "aiRailLead", label: "Fast shots: lead (share)", min: 0, max: 1.5, step: 0.05, group: G, tip: "Share of your motion it leads a rail or burst by, out to the moment of the shot" },
  { key: "aiRailError", label: "Fast shots: aim error (m at 30 m)", min: 0, max: 4, step: 0.05, group: G },
  { key: "aiSnapshot", label: "Snapshot: aim freezes this long before the shot (s)", min: 0, max: 1.5, step: 0.01, group: G, tip: "The grace: this long before a rail fires (or an autocannon burst opens) its aim stops tracking and freezes on where it would hit, the line turning solid. Change direction or dash out of the line now and it misses" },
  { key: "aiSnapJitter", label: "Snapshot: random extra hold (s)", min: 0, max: 1, step: 0.01, group: G, tip: "A fully charged rail waits up to this long, frozen, before firing. 0: it fires the instant the charge is full, so the timing is readable" },
  { key: "aiBurstAim", label: "Autocannon: tracking time before a burst (s)", min: 0, max: 4, step: 0.05, group: G },
  { key: "aiBurst", label: "Autocannon: burst length (s)", min: 0.2, max: 4, step: 0.05, group: G, tip: "Fired along the frozen line" },
  { key: "aiLead", label: "Lead (share of the true lead)", min: 0, max: 1.5, step: 0.05, group: G, tip: "How much of the foe's motion it leads its rockets, shells and mortars by" },
  { key: "aiDodgeChance", label: "Dodge chance (per threat)", min: 0, max: 1, step: 0.05, group: G, tip: "Keith 2026-10-31: enemies only have a chance to dodge targeted abilities. Each telegraph rolls once (seeded) when it appears: it either reacts (after the reaction time) or carries on as if it never saw it" },
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
  { key: "aiPaintSlew", label: "Painted spot creeps at (m/s)", min: 0, max: 20, step: 0.5, group: G, tip: "It commits to a spot when it starts painting a shoulder weapon (your position plus lead then); the strip or ring then moves toward where you are no faster than this (0: stays put)" },
  { key: "aiSwordPull", label: "With a sword: range pulled in", min: 0, max: 1, step: 0.05, group: G, tip: "A rival carrying a sword fights this far of the way from its guns' range in to the sword's (Keith 2026-11-01: in your face); it also dashes in from its usual fight" },
  { key: "aiSwordStrafe", label: "With a sword: circling ×", min: 0, max: 1, step: 0.05, group: G, tip: "A sword rival circles this much of its usual strafe, coming straight on (and sprints in while far)" },
  { key: "aiSwordFrom", label: "With a sword: swings from (m past its reach)", min: 0, max: 15, step: 0.5, group: G, tip: "It starts a cut this far outside the blade's reach: the sword's lunge carries it in" },
  { key: "aiAimSweep", label: "Aim sweep floor (m/s across)", min: 0, max: 40, step: 0.5, group: G, tip: "Keith 2026-11-01 (rivals lost you up close): the aim line also sweeps at least this fast across at your range, so a foe circling close is followed like one far off. The swing speed above rules at range" },
  { key: "aiSwordReaction", label: "Up close with a sword: reaction (s)", min: 0, max: 1, step: 0.01, group: G, tip: "Keith 2026-11-01: a sword rival in blade range tracks you this tightly (its torso's own turn speed is the real limit), never freezing for a gun's snapshot" },
  { key: "aiSwordLag", label: "Up close with a sword: aim lag (s)", min: 0, max: 1, step: 0.01, group: G },
  { key: "aiSwordTurn", label: "Up close with a sword: swing speed (deg/s)", min: 20, max: 600, step: 5, group: G },
  { key: "aiSwordLead", label: "Up close with a sword: lead (share)", min: 0, max: 1.5, step: 0.05, group: G, tip: "How much of your motion over its reaction and lag it leads the cut and the lunge by" },
  { key: "aiSwordFace", label: "Swings only when facing you within (deg)", min: 5, max: 180, step: 5, group: G, tip: "It holds the cut until its torso is turned this close to you, so swings land instead of cutting air behind it" },
  { key: "aiSwordTrackFrom", label: "With a sword: tight tracking from (m past its swing range)", min: 0, max: 40, step: 1, group: G, tip: "Keith 2026-11-01 (rival 25, minigun and sword, hesitated on its minigun and lost you): a sword rival keeps its torso on you this far out from where it starts a cut, its gun firing along that aim" },
  { key: "aiSprintUse", label: "Sprints to reposition (chance per s when far off its range)", min: 0, max: 2, step: 0.05, group: G, tip: "Keith 2026-11-01: rivals sprint (dash, then Space held) to get into position, curving round you on the player's own sprint and drift. Its guns are off and its energy drains while it runs: fewer dodges after, so punish it" },
  { key: "aiSprintFrom", label: "Sprints when this far off its range (m)", min: 2, max: 40, step: 1, group: G },
  { key: "aiSprintArc", label: "Sprint: arcs round you by (deg)", min: 0, max: 150, step: 5, group: G, tip: "It aims for a spot at its range this far round you from where it starts, curving there" },
  { key: "aiSprintMax", label: "Sprint: at most (s)", min: 0.5, max: 6, step: 0.1, group: G },
  { key: "aiSprintSwerve", label: "Sprint: chance to cut back the other way", min: 0, max: 1, step: 0.05, group: G, tip: "Partway through, it flips to the other side of you: a hard change of direction with the sprint's drift" },
  { key: "aiSprintMirror", label: "Sprint: answers your sprint (chance)", min: 0, max: 1, step: 0.05, group: G, tip: "When you start sprinting, it may sprint too, to a new angle on you" },
  { key: "aiReactorResume", label: "Energy weapons: fires again at reactor share", min: 0.1, max: 1, step: 0.05, group: G, tip: "Its energy weapons fire until the reactor runs dry, then wait for it to refill to this share (regen is slow while it draws), so it shoots in bursts and lets the reactor catch up. A nova lance or sunder beam that's ready waits for its whole cost first" },
  { key: "aiBarEdge", label: "Presses when you have this many fewer bars (0 never)", min: 0, max: 4, step: 1, group: G, tip: "Keith 2026-11-03 (three bars each): a foe two bars down can't dodge as much as it can, so it presses (closes in, everything fires) and dashes in" },
  { key: "aiPush", label: "Pushes on a spare bar (chance per s)", min: 0, max: 2, step: 0.05, group: G, tip: "With its bars full (its dodge reserve plus two), it may take the initiative: a dash in on the spare bar and a press for the push time, keeping the rest for dodges" },
  { key: "aiPushTime", label: "Push lasts (s)", min: 0.5, max: 12, step: 0.25, group: G },
  { key: "aiPressRange", label: "Pressing: range share", min: 0.2, max: 1, step: 0.05, group: G, tip: "When the foe is exposed it closes to this share of its preferred range" },
];

// ---- The view (plain data the lab or the headless duel fills each frame) ----

export interface WeaponState {
  /** Index into the kit. */
  i: number;
  /** Ready to fire (cooldown over, not mid-volley). */
  ready: boolean;
  /** A rail's charge 0..1 while held (a nova lance's, a sunder beam's while it charges). */
  charge: number;
  /** A sunder beam charging or burning, a lance charging: a dash or the sprint would drop it. */
  busy?: boolean;
}

export interface DuelSelf {
  x: number; z: number; vx: number; vz: number; heading: number;
  /** The torso's yaw (radians), where the weapons face; absent (the headless duel), its aim is taken as its facing. */
  torso?: number;
  /** Hull share 0..1. */
  health: number;
  dashCharges: number;
  canDash: boolean;
  /** Mid-dash (its steps and the glide after). */
  dashing: boolean;
  walkSpeed: number;
  /** The reactor energy weapons draw on (bars) and its capacity; absent: no energy weapons to feed. */
  energy?: number;
  energyCap?: number;
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
export interface RivalStats { dodgeDashes: number; dodgeWalks: number; threatsSeen: number; threatsNoticed: number; states: Record<RivalState, number> }

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
  stats: RivalStats = { dodgeDashes: 0, dodgeWalks: 0, threatsSeen: 0, threatsNoticed: 0, states: { engage: 0, press: 0, cover: 0, retreat: 0 } };
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
  /** Track then snapshot: the frozen aim point (null: tracking) and, for an autocannon, its burst cycle. */
  private frozen: { x: number; z: number } | null = null;
  private acPhase: "aim" | "snap" | "burst" = "aim";
  private acUntil = 0;
  private acFireFrom = 0;
  /** The aim is frozen on the point the shot will go along (the lab draws the rail's line solid). */
  snapped = false;
  /** A sword rival in blade range (Keith 2026-11-01): tight tracking, no snapshots, guns fire along its aim. */
  melee = false;
  /** When each threat was first seen, and the decision made for it (dash or walk). */
  private seen = new Map<number, { t: number; notice: boolean; dash: boolean; delay: number; charged: number }>();
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
  /** Where the painted shoulder weapon points: committed at the start of the paint, then creeping (aiPaintSlew). */
  private hx = 0;
  private hz = 0;
  private paintAt: { x: number; z: number } | null = null;
  private shoulderIn = 2;
  /** Cover: the spot it's going for, and the peek timer. */
  private coverAt: { x: number; z: number } | null = null;
  private peekUntil = 0;
  /** Seconds at its cover spot, and seconds the foe has been out of sight. */
  private hidFor = 0;
  private blindFor = 0;
  private noiseA = 0;
  private noiseB = 0;
  /** A sprint to reposition (Keith 2026-11-01): the world bearing round the foe it's going for, which side it curves, since when, when it may cut back. */
  private sprint: { b: number; side: number; since: number; swerveAt: number; swerve: boolean } | null = null;
  private foeSprinting = false;
  /** Sprinting to reposition (HUD, checks). */
  sprinting = false;
  /** A push on a spare bar (Keith 2026-11-03): pressing until then, with one dash in owed at its start. */
  private pushUntil = -1;
  private pushDash = false;
  /** Pushes started (checks, HUD). */
  pushes = 0;
  /** Its energy weapons ran the reactor dry: holding fire until it's back to aiReactorResume (HUD, checks). */
  dry = false;

  constructor(public v: RivalAiValues, seed = 1) {
    this.r = rng(seed * 2654435761 + 7);
    this.noiseA = this.r() * 100; this.noiseB = this.r() * 100;
    this.flipIn = this.flipTime();
  }

  reset() {
    this.state = "engage"; this.stateFor = 0; this.seen.clear(); this.evade = null; this.unstick = null; this.painting = null; this.paintAt = null;
    this.coverAt = null; this.slow = 0; this.hidFor = 0; this.blindFor = 0; this.peekUntil = 0; this.fvx = 0; this.fvz = 0; this.fx = NaN; this.fz = NaN;
    this.hist.length = 0; this.aimInit = false; this.seenAt = -1e9; this.prevSees = true; this.railSince = -1;
    this.frozen = null; this.acPhase = "aim"; this.acUntil = 0; this.snapped = false; this.sprint = null; this.sprinting = false; this.foeSprinting = false; this.dry = false; this.pushUntil = -1; this.pushDash = false;
  }

  private flipTime() { return this.v.aiStrafeFlip * (0.4 + 1.2 * this.r()); }

  /** One decision. dt: seconds since the last. */
  decide(view: DuelView, dt: number): MechCommand {
    const v = this.v, s = view.self, f = view.foe;
    const cmd: MechCommand = { move: { x: 0, z: 0, sprint: false }, aim: null, shotAt: null, cursor: null, lock: null, trigger: [false, false], keys: [false, false, false, false], dash: null, dashHold: false };
    this.stateFor += dt;
    if (!f.alive) { this.painting = null; this.paintAt = null; return cmd; }
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
      const maxDelay = Math.max(v.aiReaction, v.aiRailReaction, v.aiSwordReaction);
      while (this.hist.length > 1 && this.hist[1].t <= view.t - maxDelay) this.hist.shift();
      const h0 = this.noticed(view.t, v.aiReaction) ?? this.hist[0];
      if (this.noticed(view.t, v.aiReaction) || !Number.isFinite(this.fx)) { this.fx = h0.x; this.fz = h0.z; this.fvx = h0.vx; this.fvz = h0.vz; }
    } else this.hist.length = 0;
    if (!Number.isFinite(this.fx)) { this.fx = f.x; this.fz = f.z; this.fvx = f.vx; this.fvz = f.vz; } // round start: it knows where you are

    // ---- Which state ----
    const base = v.aiRange > 0 ? v.aiRange : preferredRange(s.kit, v.aiSwordPull);
    const sword = s.kit.some((k) => k.kind === "sword");
    // Exposed: sprinting, in the air, staggered, out of bars or nearly dead, or (three bars each since 2026-11-03) far
    // enough behind on bars that it can't answer a push the way the rival can.
    const exposed = f.gunsOff || f.airborne || f.staggered || f.dashCharges === 0 || f.health < 0.3 || (v.aiBarEdge > 0 && s.dashCharges - f.dashCharges >= v.aiBarEdge);
    // A push on a spare bar: bars full (the reserve plus two), the foe in sight, fighting at range: take the initiative.
    if (this.state === "engage" && acquired && view.t >= this.pushUntil && s.dashCharges >= v.aiDashKeep + 2 && !this.sprint && !this.railCharging(s) && this.r() < v.aiPush * dt) {
      this.pushUntil = view.t + v.aiPushTime; this.pushDash = true; this.pushes++;
    }
    const pushing = view.t < this.pushUntil;
    const cooling = s.weapons.length > 0 && s.weapons.every((w) => !w.ready);
    let want: RivalState = "engage";
    const peeking = view.t < this.peekUntil;
    if (!peeking && s.health < v.aiRetreatAt * (1.3 - v.aiAggression * 0.6) && f.health > s.health * 0.7) want = "retreat";
    else if (pushing || (exposed && v.aiAggression + (f.health < s.health ? 0.2 : 0) >= 0.45)) want = "press";
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
    // A sword rival doesn't ease into its band: it walks straight in to blade range (and backs off only when too close).
    const radial = sword ? (off > 0.5 ? 1 : off < -2 ? -0.5 : 0) : Math.abs(off) < v.aiRangeBand ? off / v.aiRangeBand * 0.3 : Math.sign(off);
    // A sword rival circles less and comes straight on (aiSwordStrafe of the strafe), sprinting while far.
    const strafeW = sword ? v.aiStrafe * v.aiSwordStrafe : v.aiStrafe;
    mx = ux * radial * (1 - strafeW * 0.5) + tx * strafeW;
    mz = uz * radial * (1 - strafeW * 0.5) + tz * strafeW;
    if (sword && off > v.aiSwordFrom) cmd.move.sprint = true;
    // Lost sight in a fight: circle harder and close a little to get an angle round the cover.
    if (this.blindFor > 1.5 && (this.state === "engage" || this.state === "press")) { mx = tx + ux * 0.4; mz = tz + uz * 0.4; }
    this.note = this.state === "press" ? (pushing ? "pushing in on a spare bar" : "pressing: you're exposed") : this.state === "retreat" ? "hurt: backing off" : `range ${Math.round(dist)} / ${Math.round(range)} m`;
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
    if (dodge) { mx = dodge.x; mz = dodge.z; this.sprint = null; }
    else {
      const run = this.sprintStep(view, dist, range, sword, cmd, dt);
      if (run) { mx = run.x; mz = run.z; }
    }
    this.sprinting = !!this.sprint;
    if (this.sprint) this.note = "sprinting round you (guns off)";
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) { cmd.move.x = mx / Math.max(1, ml); cmd.move.z = mz / Math.max(1, ml); }

    // A reckless rival dashes in to press a foe that's out of dashes (keeping its reserve); never with its own rail
    // charging (Keith 2026-10-31: a dash drops the charge).
    // A sword rival (Keith 2026-11-01: "more aggressive at getting in your face") dashes in from its usual fight too.
    // A push opens with a dash in on its spare bar (once per push).
    if (pushing && this.pushDash && this.state === "press" && !cmd.dash && !this.sprint && !this.railCharging(s) && s.canDash && !s.dashing && s.dashCharges > v.aiDashKeep && sees && dist > range + 3) {
      cmd.dash = { x: ux + tx * 0.6, z: uz + tz * 0.6 }; this.pushDash = false;
    }
    if (!cmd.dash && !this.sprint && !this.railCharging(s) && (this.state === "press" || (sword && this.state === "engage")) && s.canDash && s.dashCharges > v.aiDashKeep && dist > range + (sword ? 3 : 10) && sees && this.r() < v.aiAggression * dt * 0.8) {
      cmd.dash = { x: ux + tx * 0.6, z: uz + tz * 0.6 };
    }

    // ---- Aim: it chases what it noticed, with a lag and a swing limit; lead is partial; error grows as you move ----
    this.noiseA += dt * v.aiAimDrift; this.noiseB += dt * v.aiAimDrift * 1.37;
    // Your speed across its line of fire.
    const across = Math.abs(f.vx * -uz + f.vz * ux);
    const err = (v.aiAimError + v.aiMoveError * across) * (dist / 30) * (this.state === "press" ? 0.8 : 1);
    const ex = Math.sin(this.noiseA * 2.1) * 0.6 + Math.sin(this.noiseA * 0.77 + 1.3) * 0.4;
    const ez = Math.sin(this.noiseB * 1.7 + 0.4) * 0.6 + Math.sin(this.noiseB * 0.53 + 2.2) * 0.4;
    // Track, then snapshot (Keith 2026-10-31): a rail charging or an autocannon aiming tracks the foe tightly (lead and
    // swing close to the best), then aiSnapshot s before the shot the aim freezes on where it would hit and the shot goes
    // along that. Everything else keeps the lag-and-spread aim above.
    // Up close with a sword (Keith 2026-11-01: "as soon as it's firing a gun and then starts sweeping its sword, it just
    // loses track"): a gun's snapshot froze the aim, and the slow swing speed couldn't follow a foe circling at 6 m. In
    // blade range it tracks tightly instead (its torso's turn speed is the limit) and every gun fires along that aim.
    const swordK = s.kit.find((k) => k.kind === "sword");
    this.melee = acquired && !!swordK && dist < swordK.range + v.aiSwordFrom + v.aiSwordTrackFrom;
    const fast = acquired && !this.melee ? this.fastWeapon(s, dist) : null;
    if (!fast) { this.frozen = null; this.acPhase = "aim"; this.acUntil = view.t + v.aiBurstAim; }
    this.snapped = false;
    let lag = v.aiAimLag, turn = v.aiAimTurn, ox = this.fx + this.fvx * v.aiAimLead * 0.5, oz = this.fz + this.fvz * v.aiAimLead * 0.5, perr = err;
    if (this.melee) {
      const e3 = this.noticed(view.t, v.aiSwordReaction) ?? this.hist[0];
      const ahead = (v.aiSwordReaction + v.aiSwordLag) * v.aiSwordLead;
      ox = e3.x + e3.vx * ahead; oz = e3.z + e3.vz * ahead;
      lag = v.aiSwordLag; turn = v.aiSwordTurn;
    }
    // A sunder beam charging or burning (Keith 2026-11-02: a heavy beam you steer for 2.5 s): it steers it after you
    // with the fast shots' tight tracking, never frozen.
    const steer = !fast && acquired && s.weapons.some((w) => w.busy && s.kit[w.i]?.kind === "sunder");
    if (steer) {
      const e2 = this.noticed(view.t, v.aiRailReaction) ?? this.hist[0];
      const ahead = (v.aiRailReaction + v.aiRailLag) * v.aiRailLead;
      ox = e2.x + e2.vx * ahead; oz = e2.z + e2.vz * ahead;
      lag = v.aiRailLag; turn = v.aiRailTurn; perr = v.aiRailError * (dist / 30);
    }
    if (fast) {
      const e2 = this.noticed(view.t, v.aiRailReaction) ?? this.hist[0];
      const flight = fast.kind === "ac" ? dist / Math.max(1, fast.k.speed) : 0;
      const horizon = v.aiRailReaction + v.aiSnapshot + flight;
      ox = e2.x + e2.vx * v.aiRailLead * horizon; oz = e2.z + e2.vz * v.aiRailLead * horizon;
      lag = v.aiRailLag; turn = v.aiRailTurn; perr = v.aiRailError * (dist / 30);
    }
    const tb = Math.atan2(ox - s.x, oz - s.z), tr = Math.hypot(ox - s.x, oz - s.z);
    if (!this.aimInit) { this.ab = tb; this.ar = tr; this.aimInit = true; }
    const ka = 1 - Math.exp(-dt / Math.max(0.01, lag));
    let dB = tb - this.ab; dB -= Math.round(dB / (Math.PI * 2)) * Math.PI * 2;
    // The swing limit: its degrees a second, or the sweep floor across at the aim's range, whichever is faster.
    const maxStep = Math.max(turn * Math.PI / 180, v.aiAimSweep / Math.max(2, this.ar)) * dt;
    this.ab += clamp(dB * ka, -maxStep, maxStep);
    this.ar += (tr - this.ar) * ka;
    let hx = s.x + Math.sin(this.ab) * this.ar + ex * perr, hz = s.z + Math.cos(this.ab) * this.ar + ez * perr;
    if (fast) {
      // When does the aim freeze? A rail: the charge has this long left. An autocannon: its tracking time is up.
      const freezeNow = fast.kind === "rail"
        ? fast.w.charge > 0.02 && (1 - fast.w.charge) * fast.k.charge <= v.aiSnapshot
        : this.acPhase !== "aim" || view.t >= this.acUntil;
      if (fast.kind === "rail" && fast.w.charge <= 0.02) this.frozen = null;
      if (fast.kind === "ac") {
        if (this.acPhase === "aim" && view.t >= this.acUntil) { this.acPhase = "snap"; this.acUntil = view.t + v.aiSnapshot; this.acFireFrom = view.t + Math.max(0, v.aiSnapshot - fast.k.spinUp); this.frozen = null; }
        else if (this.acPhase === "snap" && view.t >= this.acUntil) { this.acPhase = "burst"; this.acUntil = view.t + v.aiBurst; }
        else if (this.acPhase === "burst" && view.t >= this.acUntil) { this.acPhase = "aim"; this.acUntil = view.t + v.aiBurstAim; this.frozen = null; }
      }
      // The snapshot is where it would hit (the prediction itself, not the lagging line): the aim snaps there.
      if (freezeNow && !this.frozen && (fast.kind === "rail" || this.acPhase !== "aim")) this.frozen = { x: ox + ex * perr, z: oz + ez * perr };
      if (this.frozen) { hx = this.frozen.x; hz = this.frozen.z; this.snapped = true; }
      // The weapon leads nothing itself: the lead is in the point.
      cmd.lock = { x: hx, y: f.y, z: hz, r: f.r, key: "foe", vx: 0, vz: 0 };
    }
    cmd.shotAt = { x: hx, y: f.y, z: hz };
    cmd.aim = { x: hx, y: f.y, z: hz };
    if (!fast) cmd.lock = { x: hx, y: f.y, z: hz, r: f.r, key: "foe", vx: this.fvx * v.aiLead, vz: this.fvz * v.aiLead };
    // The launchers' ground point: led by the flight of what's being fired (the slowest painted one, else rockets).
    const lead = (speed: number, flight = 0) => (speed === Infinity ? 0 : dist / Math.max(1, speed)) + flight;
    const paintK = this.painting ? s.kit[this.painting.i] : s.kit.find((w) => w.kind === "rpg") ?? null;
    const lt = paintK ? lead(paintK.speed, paintK.flight) * v.aiLead : 0;
    this.hx = hx; this.hz = hz;
    const wantX = hx + this.fvx * lt, wantZ = hz + this.fvz * lt;
    if (this.painting) {
      // Painting: the spot was committed when the paint began; it creeps toward the new aim, never jumps.
      const pa = this.paintAt ?? (this.paintAt = { x: wantX, z: wantZ });
      const ddx = wantX - pa.x, ddz = wantZ - pa.z, dd = Math.hypot(ddx, ddz), step = Math.min(dd, v.aiPaintSlew * dt);
      if (dd > 1e-6) { pa.x += ddx / dd * step; pa.z += ddz / dd * step; }
      cmd.cursor = { x: pa.x, y: f.y - 1.5, z: pa.z };
    } else { this.paintAt = null; cmd.cursor = { x: wantX, y: f.y - 1.5, z: wantZ }; }

    // ---- Fire ----
    this.fire(view, cmd, dist, acquired, dt);
    return cmd;
  }

  /**
   * Sprint to reposition (Keith 2026-11-01: "if enemy mechs leverage not just dodges, but also a sprint to reposition
   * themselves ... curving, changing direction"): a dash with Space held after it, through the same sprint and drift
   * the player's mech has, steered round the foe to a spot at its range `aiSprintArc` further round, sometimes cutting
   * back the other way partway. Its guns are off and the bars drain while it runs, so it starts only with two bars
   * spare beyond its dodge reserve. Starts: far off its range (`aiSprintFrom`), or the foe just started sprinting
   * (`aiSprintMirror`, one roll per foe sprint). Returns the move while sprinting, else null.
   */
  private sprintStep(view: DuelView, dist: number, range: number, sword: boolean, cmd: MechCommand, dt: number): { x: number; z: number } | null {
    const v = this.v, s = view.self, f = view.foe, now = view.t;
    const foeRun = f.gunsOff && !f.airborne;
    const mirror = foeRun && !this.foeSprinting && this.r() < v.aiSprintMirror;
    this.foeSprinting = foeRun;
    const swordStrike = sword && dist < range + v.aiSwordFrom;
    if (!this.sprint) {
      const free = !this.painting && !this.railCharging(s) && s.canDash && !s.dashing && s.dashCharges >= 2 + v.aiDashKeep && this.state !== "cover" && !(sword && dist < range + 2);
      const far = Math.abs(dist - range) > v.aiSprintFrom && this.r() < v.aiSprintUse * dt;
      if (!free || !(mirror || far)) return null;
      const b0 = Math.atan2(s.x - f.x, s.z - f.z), side = this.strafe;
      this.sprint = { b: b0 + side * v.aiSprintArc * Math.PI / 180, side, since: now, swerveAt: now + 0.6 + this.r() * 0.8, swerve: this.r() < v.aiSprintSwerve };
    }
    const sp = this.sprint;
    // The goal: at its range round the foe, on the bearing it chose (the foe moves; the goal goes with it).
    const R = this.state === "retreat" ? range : Math.max(sword ? 3 : 8, range);
    if (sp.swerve && now >= sp.swerveAt) {
      const bNow = Math.atan2(s.x - f.x, s.z - f.z);
      sp.side = -sp.side; sp.b = bNow + sp.side * v.aiSprintArc * Math.PI / 180; sp.swerve = false;
    }
    const gx = f.x + Math.sin(sp.b) * R, gz = f.z + Math.cos(sp.b) * R;
    const dx = gx - s.x, dz = gz - s.z, d = Math.hypot(dx, dz) || 1;
    const ran = now - sp.since;
    // Done: there, out of time, out of energy, or (a sword) close enough to cut.
    const stalled = ran > 0.4 && !s.dashing && Math.hypot(s.vx, s.vz) < s.walkSpeed * 0.9;
    if (d < 5 || ran > v.aiSprintMax || stalled || (swordStrike && ran > 0.5) || (ran > 0.3 && s.dashCharges === 0 && !s.dashing && Math.hypot(s.vx, s.vz) < s.walkSpeed)) { this.sprint = null; return null; }
    // Curve: head for the goal, bent round the foe on its side while far from it (the walker's sprint turn and drift
    // make the arc).
    const ox = s.x - f.x, oz = s.z - f.z, ol = Math.hypot(ox, oz) || 1;
    const tx = (oz / ol) * sp.side, tz = (-ox / ol) * sp.side;
    const bend = 0.7 * clamp(d / 20, 0, 1);
    let mx = dx / d + tx * bend, mz = dz / d + tz * bend;
    // Don't run through the foe: push out if the line passes inside 6 m of it.
    if (ol < 8) { mx += ox / ol * (8 - ol) / 4; mz += oz / ol * (8 - ol) / 4; }
    ({ x: mx, z: mz } = this.avoidCover(view, s.x, s.z, mx, mz));
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    if (ran === 0) cmd.dash = { x: mx, z: mz };
    cmd.dashHold = true;
    return { x: mx, z: mz };
  }
  /** The newest sample of the foe at least `delay` old (null: none that old yet). */
  private noticed(now: number, delay: number) {
    let e: (typeof this.hist)[number] | null = null;
    for (const h of this.hist) { if (h.t <= now - delay) e = h; else break; }
    return e;
  }

  /** Which fast direct-fire weapon is in play (a rail ready or charging, else an autocannon), if the foe is in its reach. */
  private fastWeapon(s: DuelSelf, dist: number) {
    let ac: { kind: "rail" | "ac"; k: KitWeapon; w: WeaponState } | null = null;
    for (const w of s.weapons) {
      const k = s.kit[w.i];
      if (!("trigger" in k.ctl) || dist >= k.range * 0.95 || dist <= k.minRange) continue;
      // A nova lance charges and fires like a rail (an instant beam on the release): the same track then snapshot.
      if ((k.kind === "rail" || k.kind === "lance") && (w.ready || w.charge > 0)) return { kind: "rail" as const, k, w };
      if (k.kind === "autocannon" && !ac) ac = { kind: "ac", k, w };
    }
    return ac;
  }

  /** One of its own rails or lances is charging, or a sunder beam is up (a dash or the sprint would drop it). */
  private railCharging(s: DuelSelf) { return s.weapons.some((w) => (w.charge > 0.05 && (s.kit[w.i]?.kind === "rail" || s.kit[w.i]?.kind === "lance")) || (w.busy && s.kit[w.i]?.kind === "sunder")); }

  /** Threats it has noticed that cover where it is: walk or dash out. Returns a move to override with, or null. */
  private dodge(view: DuelView, cmd: MechCommand): { x: number; z: number } | null {
    const v = this.v, s = view.self;
    const now = view.t;
    for (const id of [...this.seen.keys()]) if (!view.threats.some((t) => t.id === id)) this.seen.delete(id);
    let best: { x: number; z: number; urgency: number; need: number; t: number; id: number; rail: boolean } | null = null;
    for (const th of view.threats) {
      let mem = this.seen.get(th.id);
      if (!mem) {
        // One seeded roll per threat, when it first appears: does it notice and react at all?
        mem = { t: now, notice: this.r() < v.aiDodgeChance, dash: this.r() < v.aiDashUse, delay: this.r() * 1.0, charged: -1 };
        this.seen.set(th.id, mem); this.stats.threatsSeen++; if (mem.notice) this.stats.threatsNoticed++;
      }
      if (!mem.notice || now - mem.t < v.aiReaction) continue;
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
    // The reactor (energy weapons): fire until it runs dry, then wait for it to refill to aiReactorResume, so it shoots
    // in bursts and the regen (slow while it draws) catches up. A ready lance or sunder in reach waits for its whole cost.
    const e = s.energy ?? Infinity, cap = s.energyCap ?? 1;
    let minCost = Infinity, bigCost = 0;
    for (const w of s.weapons) {
      const k = s.kit[w.i], st = k.energy;
      if (!st) continue;
      if (k.kind === "lance" || k.kind === "sunder") { if (w.ready && !w.busy && dist < k.range * 0.95 && sees) bigCost = Math.max(bigCost, st.energy); }
      else minCost = Math.min(minCost, k.kind === "beam" ? st.energy * 0.15 : st.energy);
    }
    if (e < minCost * 1.5) this.dry = true;
    else if (this.dry && e >= Math.min(cap, Math.max(cap * v.aiReactorResume, bigCost))) this.dry = false;
    const saving = bigCost > 0 && e < bigCost;
    for (const w of s.weapons) {
      const k = s.kit[w.i];
      if (!("trigger" in k.ctl)) continue;
      const side = k.ctl.trigger;
      const inRange = k.kind === "sword" ? dist < k.range + v.aiSwordFrom : dist < k.range * 0.95 && dist > k.minRange;
      if (!sees || !inRange) {
        // A charged rail (or lance) keeps its charge while the foe is hidden (released when it shows, or let go after a while).
        if ((k.kind === "rail" || k.kind === "lance") && w.charge > 0 && w.charge < 1) cmd.trigger[side] = true;
        if (k.kind === "sunder" && w.busy) cmd.trigger[side] = true;
        continue;
      }
      if (k.kind === "lance") {
        // Starts only with the whole charge's energy in the reactor; lets go at full, or early (past the least charge
        // that fires) if the reactor runs out partway.
        const st = k.energy!, left = (1 - w.charge) * st.energy;
        if (w.charge <= 0.02) cmd.trigger[side] = w.ready && e >= st.energy;
        else cmd.trigger[side] = w.charge < 1 && !(e < Math.min(left, 0.02) && w.charge >= st.minCharge);
        continue;
      }
      if (k.kind === "sunder") {
        // A press commits it; the beam then burns for its channel, steered after the foe (see the aim).
        cmd.trigger[side] = !!w.busy || (w.ready && e >= k.energy!.energy);
        continue;
      }
      if (isEnergyKind(k.kind)) {
        // Pulse laser, beam, plasma, orb, arc: held while the reactor lasts (bursts, see above).
        cmd.trigger[side] = !this.dry && !saving;
        continue;
      }
      if (k.kind === "rail") {
        // Charge, and let go the moment it is full (aiSnapJitter: after a random extra beat, frozen).
        const full = w.charge >= 1;
        if (!full) this.railSince = -1;
        else if (this.railSince < 0) { this.railSince = view.t; this.railWait = v.aiSnapJitter * this.r(); }
        cmd.trigger[side] = (w.ready || w.charge > 0) && (!full || view.t - this.railSince < this.railWait);
      } else if (k.kind === "sword") {
        // Swing while the foe is in the blade's reach (the lunge closes the last metres), once its torso has come round
        // to face where it's aiming (Keith 2026-11-01: cuts into the air behind it read as the AI losing you).
        const a = cmd.aim!, want = Math.atan2(a.x - s.x, a.z - s.z);
        let off = (s.torso ?? this.ab) - want; off -= Math.round(off / (Math.PI * 2)) * Math.PI * 2;
        cmd.trigger[side] = Math.abs(off) <= v.aiSwordFace * Math.PI / 180;
      } else if (k.kind === "autocannon" && this.melee) {
        // Up close it fires along its tracking aim, no snapshot.
        cmd.trigger[side] = true;
      } else if (k.kind === "autocannon") {
        // Bursts along the frozen line: the trigger goes down in time for the spin-up to end at the snapshot's end.
        cmd.trigger[side] = this.acPhase === "burst" || (this.acPhase === "snap" && view.t >= this.acFireFrom);
      } else cmd.trigger[side] = w.ready || k.kind === "minigun";
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
    if (this.shoulderIn > 0 || this.sprint) return;
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
    // Commit the aim now: the foe's noticed position plus its lead for this weapon's flight, held (see decide).
    const lt = (k.speed === Infinity ? 0 : dist / Math.max(1, k.speed)) + (k.flight ?? 0);
    const px = this.hx + this.fvx * lt * v.aiLead, pz = this.hz + this.fvz * lt * v.aiLead;
    this.paintAt = { x: px, z: pz };
    cmd.cursor = { x: px, y: f.y - 1.5, z: pz };
  }
}
