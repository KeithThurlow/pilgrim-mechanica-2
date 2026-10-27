// Crane pick-up, life on the deck, and launch (pure, no rendering): the state machine around the mech and the crane.
//
// Pick-up is automatic (Keith 2026-10-24): once the mech has been inside craneRange of a crane for craneDwell, the
// crane swings out, lowers its cradle and connects. With two mech bays (front and rear, Keith 2026-10-25) the nearer
// crane comes; the mech then lives on that bay's deck until it is launched again. Leave the range before the cradle grips and nothing happens.
// Once gripped the mech hangs on the rope (the walker isn't stepped; its body hangs under the cradle, leaning with
// the swing, feet dangling), is lifted over the rail, swung over the deck, held over the set-down pad until the swing
// settles, and set down. Then control comes back (Keith 2026-10-24): the mech walks on the moving deck (deck.ts).
// Parking: in a parking bay, E settles the mech (kneels); E again stands it up.
// Launch: stand on a launch pad beside the crane for craneLaunchDwell and the crane comes for the mech there, lifts
// it, swings it out over that side, steadies it a few metres over the sand and lets go (Keith 2026-10-25: drop it
// from a bit higher and let it fall): the walker's own air state takes over (Keith 2026-10-26: landing on its legs is
// something every mech does): it flies keeping the convoy's velocity, legs reaching for the ground, and lands with a
// squat by how hard it hit (onTouchdown for the crater and shake; the mech's own landing does the dust), then craneFollow seconds of forced
// walking along the convoy's heading, then WASD again. Step off the pad before the
// grip and it's off. The crane's motion is the countdown. After a launch the mech has to leave the range once before
// the crane will pick it up again.
import type { Param } from "../core/tweaks";
import type { WalkerSim, MoveCommand } from "../mech/walker";
import type { DuneField } from "../world/terrain";
import type { Platform } from "./platform";
import type { Crane, CraneValues } from "./crane";
import { DeckGround, PoseSnap, rideDeck, keepOnDeck, spotAt, type DeckValues, type Spot } from "./deck";
import { hangPose, hangDrop, kneelPose, type Kneel } from "./hold";

export const CARRY_DEFAULTS = {
  craneRange: 21,
  craneDwell: 0.4,
  craneGrip: 1.7,
  craneGripTol: 1.2,
  craneClear: 1.5,
  craneDeployReach: 13,
  craneFollow: 2,
  craneCarryTurn: 25,
  craneLaunchDwell: 0.4,
  craneDropHeight: 3,
  craneDropSteady: 0.35,
  craneLandShake: 0.5,
  craneHover: 0.8,
  craneSwingLean: 0.6,
  deckParkTime: 0.8,
  deckRiseTime: 1,
  deckCrouch: 0.85,
  deckParkPitch: 6,
};
export type CarryValues = typeof CARRY_DEFAULTS;

export const CARRY_PARAMS: Param[] = [
  { key: "craneRange", label: "Pick-up range (m)", min: 5, max: 40, step: 0.5, group: "Pick-up and launch", tip: "Inside this distance of the crane, the crane comes for the mech" },
  { key: "craneDwell", label: "Wait in range (s)", min: 0, max: 5, step: 0.1, group: "Pick-up and launch", tip: "How long the mech must be in range before the crane moves" },
  { key: "craneLaunchDwell", label: "Wait on launch pad (s)", min: 0, max: 4, step: 0.1, group: "Pick-up and launch", tip: "How long the mech stands on a launch pad before the crane comes for it" },
  { key: "craneGrip", label: "Grip above hips (m)", min: 0.5, max: 3, step: 0.05, group: "Pick-up and launch", tip: "Where the cradle grips the hull" },
  { key: "craneGripTol", label: "Grip tolerance (m)", min: 0.3, max: 3, step: 0.05, group: "Pick-up and launch", tip: "How close the cradle must get to connect" },
  { key: "craneClear", label: "Clearance over rail (m)", min: 0, max: 5, step: 0.1, group: "Pick-up and launch", tip: "How high the hanging feet clear the deck rail" },
  { key: "craneHover", label: "Steady above spot (m)", min: 0.2, max: 3, step: 0.05, group: "Pick-up and launch", tip: "The crane holds the mech this high over where it sets it down until the swing settles" },
  { key: "craneDeployReach", label: "Launch reach (m)", min: 8, max: 40, step: 0.5, group: "Pick-up and launch", tip: "How far out to the side the mech is set down on the sand" },
  { key: "craneFollow", label: "Forced follow (s)", min: 0, max: 6, step: 0.1, group: "Pick-up and launch", tip: "After release the mech walks with the convoy this long before WASD comes back" },
  { key: "craneCarryTurn", label: "Carried turn (°/s)", min: 0, max: 120, step: 1, group: "Pick-up and launch", tip: "How fast a carried mech is turned to face along the platform" },
  { key: "craneDropHeight", label: "Drop height (m)", min: 0, max: 8, step: 0.1, group: "Drop-off", tip: "How far the mech's feet fall to the sand when the crane lets go on a launch" },
  { key: "craneDropSteady", label: "Let go within (m)", min: 0.05, max: 2, step: 0.05, group: "Drop-off", tip: "The crane lets go once the swing is smaller than this (bigger: quicker, less tidy)" },
  { key: "craneLandShake", label: "Landing shake (m)", min: 0, max: 2, step: 0.05, group: "Drop-off", tip: "Camera shake on touchdown (scaled by how hard it landed)" },
  { key: "craneSwingLean", label: "Body leans with swing", min: 0, max: 1, step: 0.05, group: "Crane swing", tip: "How much of the rope's angle the hanging mech's body takes (1 = hangs rigidly in line with the rope)" },
  { key: "deckParkTime", label: "Park settle (s)", min: 0.3, max: 5, step: 0.1, group: "Deck", tip: "How long the mech takes to kneel in a parking bay (Keith 2026-10-26: quicker; was 1.6)" },
  { key: "deckRiseTime", label: "Stand up (s)", min: 0.3, max: 5, step: 0.1, group: "Deck", tip: "How long the parked mech takes to stand up again" },
  { key: "deckCrouch", label: "Park crouch (m)", min: 0, max: 1.6, step: 0.05, group: "Deck", tip: "How far the hips drop when parked" },
  { key: "deckParkPitch", label: "Park nose-down (°)", min: -10, max: 25, step: 0.5, group: "Deck", tip: "How far the hull tips forward when parked" },
];

export type CarryState = "walking" | "inRange" | "pickup" | "lifting" | "aboard" | "parked" | "launching" | "deploying" | "falling" | "landing";
type Phase = "reach" | "lower" | "lift" | "swing" | "hover" | "set" | "drop" | "settle" | "rise" | "";
type Values = CarryValues & DeckValues & CraneValues;

const D2R = Math.PI / 180;
/** Deck rail height (m): the hanging feet clear this. */
export const RAIL = 1.1;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export class CraneCarry {
  state: CarryState = "walking";
  phase: Phase = "";
  /** The mech hangs from the cradle. */
  attached = false;
  /** False after a launch until the mech has left the range once. */
  armed = true;
  /** Seconds in range (inRange), on the pad (aboard), or forced follow left (landing). */
  timer = 0;
  /** Launch side: +1 left, -1 right of the platform. */
  side: 1 | -1 = 1;
  /** Counts for the check and HUD. */
  pickups = 0;
  deploys = 0;
  aborts = 0;
  parks = 0;
  /** The walker's ground: the deck while aboard, the dunes otherwise. Assign it to the walker (done on update). */
  readonly ground: DeckGround;
  /** The spot (deck-local) the mech is on, if any, as of the last update. */
  spot: Spot | null = null;
  /** The mech's heading relative to the platform while held. */
  private relHeading = 0;
  private snap = new PoseSnap();
  private kneel: Kneel = { x: 0, z: 0, relHeading: 0, k: 0, crouch: 0, pitch: 0, from: null };
  /** Where (deck-local) the launch was called. */
  private launchAt = { x: 0, z: 0 };
  /** The falling mech (after a launch lets go): hips position and velocity, seconds falling. */
  readonly fall = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, heading: 0 };
  /** Last touchdown: how fast it hit (m/s down) and how long it fell; for the check and HUD. */
  lastLanding = { speed: 0, time: 0 };
  /** Called on touchdown with where (the hips' spot on the ground) and the fall speed (m/s): dust, marks, shake, sound. */
  onTouchdown: ((x: number, y: number, z: number, speed: number) => void) | null = null;

  /** Every crane (one per mech bay), and the one in use: the nearest while walking, the one whose deck the mech is on. */
  readonly cranes: Crane[];
  crane: Crane;

  constructor(public v: Values, cranes: Crane | Crane[], readonly field: DuneField) {
    this.cranes = Array.isArray(cranes) ? cranes : [cranes];
    this.crane = this.cranes[0];
    this.ground = new DeckGround(field, this.crane.platform);
  }

  /** Switch to another crane (and its bay's deck). */
  private use(c: Crane) {
    if (c === this.crane) return;
    this.crane = c;
    this.ground.bay = c.platform;
    this.snap.take(c.platform);
  }

  /** Distance from the nearest crane's mast, and that crane. */
  nearest(sim: WalkerSim) {
    let best = this.crane, bd = Infinity;
    for (const c of this.cranes) { const d = Math.hypot(sim.pos.x - c.base.x, sim.pos.z - c.base.z); if (d < bd) { bd = d; best = c; } }
    return { crane: best, d: bd };
  }

  /** A crane's stowed aim: over its own set-down pad. */
  private stowCrane(c: Crane) {
    const s = c.relLocal(0, this.v.craneSetDown * c.platform.craneEnd);
    c.aim(s.slew, s.radius, null);
  }

  get platform(): Platform { return this.crane.platform; }
  /** Parked and fully knelt in a bay (the pilot can climb out). */
  get settled() { return this.state === "parked" && this.phase === "settle" && this.kneel.k >= 1; }
  /** The mech is walking on the deck (its own legs, riding the platform). */
  get onDeck() { return this.state === "aboard" || this.state === "launching"; }

  /** Words for the HUD. */
  get label() {
    switch (this.state) {
      case "walking": return this.armed ? "walking" : "walking (leave crane range to re-arm)";
      case "inRange": return "in range";
      case "pickup": return "crane reaching for you";
      case "lifting": return { lift: "lifted", swing: "swinging aboard", hover: "steadying over the deck", set: "setting down" }[this.phase as "lift"] ?? "lifted";
      case "aboard":
        if (this.spot?.kind === "park") return "aboard, in a parking bay: E to park";
        if (this.spot?.kind === "launch") return "aboard, on the launch pad";
        return "aboard: walk to a parking bay (E parks) or a launch pad";
      case "parked": return this.phase === "rise" ? "standing up" : "parked · hold F to climb out · E to stand up";
      case "launching": return "on the launch pad: crane coming (step off to cancel)";
      case "deploying": return { lift: "lifted off the deck", swing: "swinging out", hover: "steadying over the sand" }[this.phase as "lift"] ?? "launching";
      case "falling": return "dropped";
      case "landing": return "launched: keep pace";
    }
  }

  /** Distance (horizontal) from the crane's mast to the mech. */
  distance(sim: WalkerSim) { return Math.hypot(sim.pos.x - this.crane.base.x, sim.pos.z - this.crane.base.z); }

  /** Start aboard (lab flag): the mech stands on the set-down pad (of the given crane's bay, or the one in use). */
  putAboard(sim: WalkerSim, crane: Crane = this.crane) {
    this.use(crane);
    const p = this.platform, w = p.toWorld(0, 0, this.v.craneSetDown * p.craneEnd);
    this.toDeck(sim, w.x, w.z, p.heading);
  }

  /** Lab start-up: the cradle already gripping the mech where it stands on the sand, about to lift. */
  grab(sim: WalkerSim) {
    const r = this.crane.rel(sim.pos.x, sim.pos.z);
    this.crane.snapTo(r.slew, r.radius, sim.pelvis.y + this.v.craneGrip);
    this.state = "lifting"; this.phase = "lift"; this.attached = true; this.pickups++;
    this.relHeading = wrap(sim.heading - this.platform.heading);
  }

  /** Lab start-up (?drop): the crane has just let go of the mech out over the sand on this side, feet craneDropHeight up. */
  dropBeside(sim: WalkerSim, side: 1 | -1) {
    const cr = this.crane, p = this.platform, v = this.v;
    const w = p.toWorld(side * v.craneDeployReach, 0, cr.mount), g = this.field.height(w.x, w.z);
    sim.reset(w.x, w.z, p.heading);
    const y = g + hangDrop(sim) + v.craneGrip + v.craneDropHeight;
    const r = cr.rel(w.x, w.z);
    cr.snapTo(r.slew, r.radius, y);
    this.state = "deploying"; this.phase = "hover"; this.attached = true; this.side = side; this.relHeading = 0;
    hangPose(sim, { x: cr.cradle.x, y: cr.cradle.y, z: cr.cradle.z, grip: v.craneGrip, heading: p.heading, floorY: g, leanX: 0, leanZ: 0, deck: null });
    this.drop(sim);
  }

  /** Launch from where the mech stands on the deck (a shortcut; normally walk onto a launch pad). */
  deploy(sim: WalkerSim, side: 1 | -1) {
    if (this.state !== "aboard") return false;
    this.startLaunch(sim, side);
    return true;
  }

  /** E: park in the bay the mech stands in, or stand up again. */
  togglePark(sim: WalkerSim) {
    const p = this.platform, v = this.v;
    if (this.state === "parked") { this.phase = this.phase === "rise" ? "settle" : "rise"; return true; }
    if (this.state !== "aboard") return false;
    const s = spotAt(sim, p, v);
    if (s?.kind !== "park") return false;
    const l = p.toLocal(sim.pos.x, sim.pos.z);
    const from = sim.feet.map((f) => { const q = p.toLocal(f.planted.x, f.planted.z); return { x: q.x, z: q.z }; }) as Kneel["from"];
    this.kneel = { x: l.x, z: l.z, relHeading: wrap(sim.heading - p.heading), k: 0, crouch: v.deckCrouch, pitch: v.deckParkPitch, from };
    this.state = "parked"; this.phase = "settle"; this.parks++;
    return true;
  }

  /**
   * Once a frame before the walker steps: carry a mech walking on the deck with the platform's motion since the last
   * call (and remember the platform's pose either way).
   */
  ride(sim: WalkerSim) {
    if (this.onDeck) rideDeck(sim, this.platform, this.snap);
    else this.snap.take(this.platform);
  }

  /** After the walker steps: keep a mech walking on the deck on it. */
  keep(sim: WalkerSim) {
    if (this.onDeck) keepOnDeck(sim, this.platform, this.v);
  }

  /**
   * One step (120 Hz). cmd is what the player (or demo) asks of the legs. Returns the command to step the walker
   * with, or null when the walker is held (its pose has been written here; don't step it).
   */
  update(dt: number, sim: WalkerSim, cmd: MoveCommand): MoveCommand | null {
    const v = this.v;
    if (sim.ground !== this.ground) sim.ground = this.ground;
    // Walking on the sand: the nearest crane is the one that will come.
    if (this.state === "walking" || this.state === "inRange") {
      const n = this.nearest(sim);
      if (n.crane !== this.crane) { this.use(n.crane); if (this.state === "inRange") this.timer = 0; }
      if (!this.armed && n.d > v.craneRange + 2) this.armed = true;
    }
    const cr = this.crane, p = this.platform;
    for (const c of this.cranes) { c.steadying = false; if (c !== cr) this.stowCrane(c); }
    const hip = sim.v.hipHeight;
    const dist = this.distance(sim);
    const setZ = v.craneSetDown * p.craneEnd;
    const setDown = cr.relLocal(0, setZ);
    const deckY = () => p.toWorld(0, p.deck, setZ).y;
    const liftY = () => Math.max(deckY(), p.y + p.deck) + RAIL + v.craneClear + hangDrop(sim) + v.craneGrip;
    const stow = () => cr.aim(setDown.slew, setDown.radius, null);
    let out: MoveCommand | null = cmd;
    this.spot = this.onDeck ? spotAt(sim, p, v) : null;

    switch (this.state) {
      case "walking":
        stow();
        if (this.armed && dist < v.craneRange) { this.state = "inRange"; this.timer = 0; }
        break;
      case "inRange":
        stow();
        this.timer += dt;
        if (dist > v.craneRange + 1) this.state = "walking";
        else if (this.timer >= v.craneDwell) { this.state = "pickup"; this.phase = "reach"; }
        break;
      case "pickup": {
        // Leave before the grip and it's off.
        if (dist > v.craneRange + 2) { this.state = "walking"; this.phase = ""; this.aborts++; stow(); break; }
        if (this.reachFor(sim)) {
          this.state = "lifting"; this.phase = "lift"; this.attached = true; this.pickups++;
          this.relHeading = wrap(sim.heading - p.heading);
        }
        break;
      }
      case "lifting":
        out = null;
        if (this.phase === "lift") {
          cr.aim(cr.slew, cr.radius, liftY());
          // Swing once nearly up (the rope keeps paying in on the way; craneClear keeps the feet over the rail).
          if (cr.settled(Math.PI, 0.8)) this.phase = "swing";
        } else if (this.phase === "swing") {
          cr.aim(setDown.slew, setDown.radius, liftY());
          if (cr.settled(1.5 * D2R, 0.3)) this.phase = "hover";
        } else if (this.phase === "hover") {
          cr.steadying = true;
          cr.aim(setDown.slew, setDown.radius, deckY() + hip + v.craneGrip + v.craneHover);
          if (cr.settled(1.5 * D2R, 0.1) && cr.steady(0.12)) this.phase = "set";
        } else {
          cr.steadying = true;
          cr.aim(setDown.slew, setDown.radius, deckY() + hip + v.craneGrip);
          if (cr.settled(1.5 * D2R, 0.04)) {
            this.attached = false;
            this.toDeck(sim, cr.cradle.x, cr.cradle.z, p.heading + this.relHeading);
            out = null;
          }
        }
        break;
      case "aboard": {
        stow();
        const s = this.spot;
        if (s?.kind === "launch") {
          this.timer += dt;
          if (this.timer >= v.craneLaunchDwell) this.startLaunch(sim, s.side ?? 1);
        } else this.timer = 0;
        break;
      }
      case "launching": {
        const l = p.toLocal(sim.pos.x, sim.pos.z);
        if (Math.hypot(l.x - this.launchAt.x, l.z - this.launchAt.z) > v.deckPadRadius + 1.2) {
          this.state = "aboard"; this.phase = ""; this.timer = 0; this.aborts++; stow(); break;
        }
        if (this.reachFor(sim)) {
          this.state = "deploying"; this.phase = "lift"; this.attached = true;
          this.relHeading = wrap(sim.heading - p.heading);
          out = null;
        }
        break;
      }
      case "deploying": {
        out = null;
        const side = cr.relLocal(this.side * v.craneDeployReach, cr.mount);
        const g = this.field.height(cr.cradle.x, cr.cradle.z);
        if (this.phase === "lift") {
          cr.aim(cr.slew, cr.radius, liftY());
          // Swing once nearly up (the rope keeps paying in on the way; craneClear keeps the feet over the rail).
          if (cr.settled(Math.PI, 0.8)) this.phase = "swing";
        } else if (this.phase === "swing") {
          cr.aim(side.slew, side.radius, liftY());
          if (cr.settled(1.5 * D2R, 0.3)) this.phase = "hover";
        } else {
          // Steady with the feet craneDropHeight over the sand, then let go.
          cr.steadying = true;
          const want = g + hangDrop(sim) + v.craneGrip + v.craneDropHeight;
          cr.aim(side.slew, side.radius, want);
          if (cr.settled(3 * D2R, 0.25) && cr.steady(v.craneDropSteady)) this.drop(sim);
        }
        break;
      }
      case "falling": {
        // The walker flies and lands itself (its air state); this waits for the feet to touch.
        stow();
        const f = this.fall;
        f.x = sim.pelvis.x; f.y = sim.pelvis.y; f.z = sim.pelvis.z;
        if (sim.airborne) { f.vx = sim.airVel.x; f.vy = sim.airVel.y; f.vz = sim.airVel.z; f.t = sim.airT; }
        else this.touchdown(sim);
        out = this.follow(sim);
        break;
      }
      case "parked": {
        out = null;
        stow();
        const n = this.kneel;
        n.crouch = v.deckCrouch; n.pitch = v.deckParkPitch;
        n.k = Math.max(0, Math.min(1, n.k + (this.phase === "rise" ? -dt / Math.max(0.1, v.deckRiseTime) : dt / Math.max(0.1, v.deckParkTime))));
        if (this.phase === "rise" && n.k <= 0) {
          const w = p.toWorld(n.x, 0, n.z);
          this.toDeck(sim, w.x, w.z, p.heading + n.relHeading);
          out = null;
        }
        break;
      }
      case "landing":
        stow();
        this.timer -= dt;
        if (this.nearest(sim).d > v.craneRange + 2) this.armed = true;
        if (this.timer <= 0) this.state = "walking";
        else out = this.follow(sim);
        break;
    }
    this.ground.onDeck = this.onDeck || this.state === "parked";

    for (const c of this.cranes) c.step(dt);

    // Pose a held mech.
    if (this.attached) {
      const want = this.state === "deploying" || this.state === "lifting" ? 0 : this.relHeading;
      const max = v.craneCarryTurn * D2R * dt;
      this.relHeading = wrap(this.relHeading + Math.max(-max, Math.min(max, wrap(want - this.relHeading))));
      const over = this.ground.over(cr.cradle.x, cr.cradle.z);
      hangPose(sim, {
        x: cr.cradle.x, y: cr.cradle.y, z: cr.cradle.z, grip: v.craneGrip, heading: wrap(p.heading + this.relHeading),
        floorY: over ? this.ground.deckHeight(cr.cradle.x, cr.cradle.z) : this.field.height(cr.cradle.x, cr.cradle.z),
        leanX: cr.swing.x * v.craneSwingLean, leanZ: cr.swing.z * v.craneSwingLean, deck: over ? p : null,
      });
    } else if (this.state === "parked") kneelPose(sim, p, this.kneel);
    return out;
  }

  /** The crane reaches for the mech where it stands and lowers onto it; true once the cradle grips. */
  private reachFor(sim: WalkerSim) {
    const cr = this.crane, v = this.v;
    const r = cr.rel(sim.pos.x, sim.pos.z);
    const gripY = sim.pelvis.y + v.craneGrip;
    const off = Math.hypot(cr.cradle.x - sim.pelvis.x, cr.cradle.z - sim.pelvis.z);
    if (this.phase === "reach") {
      cr.steadying = true;
      cr.aim(r.slew, r.radius, gripY + 3);
      if (off < 1.2 && cr.settled(4 * D2R, 1)) this.phase = "lower";
      return false;
    }
    cr.steadying = true;
    cr.aim(r.slew, r.radius, gripY);
    if (off > 3) this.phase = "reach";
    return off < v.craneGripTol && Math.abs(cr.cradle.y - gripY) < 0.35;
  }

  private startLaunch(sim: WalkerSim, side: 1 | -1) {
    const l = this.platform.toLocal(sim.pos.x, sim.pos.z);
    this.state = "launching"; this.phase = "reach"; this.side = side; this.timer = 0;
    this.launchAt = { x: l.x, z: l.z };
  }

  /** Stand the mech on the deck at world (x, z) and hand it back to its legs. */
  private toDeck(sim: WalkerSim, x: number, z: number, heading: number) {
    this.state = "aboard"; this.phase = ""; this.attached = false; this.timer = 0; this.relHeading = 0;
    this.ground.onDeck = true;
    sim.ground = this.ground;
    sim.reset(x, z, heading);
    this.snap.take(this.platform);
  }

  /** Let go over the sand: the mech falls from the cradle with the convoy's velocity (and the cradle's sink rate). */
  private drop(sim: WalkerSim) {
    const p = this.platform, f = this.fall;
    this.attached = false;
    this.state = "falling"; this.phase = ""; this.armed = false;
    this.deploys++;
    this.ground.onDeck = false;
    f.x = sim.pelvis.x; f.y = sim.pelvis.y; f.z = sim.pelvis.z;
    f.vx = p.vel.x; f.vz = p.vel.z; f.vy = Math.min(0, this.crane.cradleVel.y);
    f.t = 0;
    f.heading = wrap(p.heading + this.relHeading);
    // The hang pose is the take-off pose: the walker's air state flies it from here.
    sim.launch(f.vx, f.vy, f.vz);
  }

  /** Feet on the sand (the walker landed itself, squatting by how hard): craneFollow seconds along the convoy. */
  private touchdown(sim: WalkerSim) {
    const v = this.v, l = sim.lastLanding;
    this.state = "landing"; this.phase = ""; this.timer = v.craneFollow;
    const speed = l?.impact ?? 0;
    this.lastLanding = { speed, time: l?.airTime ?? this.fall.t };
    this.onTouchdown?.(l?.x ?? sim.pos.x, l?.y ?? this.field.height(sim.pos.x, sim.pos.z), l?.z ?? sim.pos.z, speed);
  }

  /** The forced walk after a launch: along the convoy at its speed. */
  private follow(sim: WalkerSim): MoveCommand {
    const p = this.platform, s = p.speed, sprint = s > sim.v.walkSpeed + 0.05;
    const mag = Math.min(1, s / (sprint ? sim.v.sprintSpeed : sim.v.walkSpeed));
    return { x: Math.sin(p.heading) * mag, z: Math.cos(p.heading) * mag, sprint };
  }
}

