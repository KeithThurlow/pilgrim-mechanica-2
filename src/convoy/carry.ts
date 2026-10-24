// Crane pick-up, life on the deck, and launch (pure, no rendering): the state machine around the mech and the crane.
//
// Pick-up is automatic (Keith 2026-10-24): once the mech has been inside craneRange of the crane for craneDwell, the
// crane swings out, lowers its cradle and connects. Leave the range before the cradle grips and nothing happens.
// Once gripped the mech hangs on the rope (the walker isn't stepped; its body hangs under the cradle, leaning with
// the swing, feet dangling), is lifted over the rail, swung over the deck, held over the set-down pad until the swing
// settles, and set down. Then control comes back (Keith 2026-10-24): the mech walks on the moving deck (deck.ts).
// Parking: in a parking bay, E settles the mech (kneels); E again stands it up.
// Launch: stand on a launch pad beside the crane for craneLaunchDwell and the crane comes for the mech there, lifts
// it, swings it out over that side, steadies it, lowers it to the sand and lets go at the convoy's velocity:
// craneFollow seconds of forced walking along the convoy's heading, then WASD again. Step off the pad before the
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
  craneDwell: 1,
  craneGrip: 1.7,
  craneGripTol: 1.2,
  craneClear: 1.5,
  craneDeployReach: 21,
  craneFollow: 2,
  craneCarryTurn: 25,
  craneLaunchDwell: 0.8,
  craneHover: 0.8,
  craneSwingLean: 0.6,
  deckParkTime: 1.6,
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
  { key: "craneSwingLean", label: "Body leans with swing", min: 0, max: 1, step: 0.05, group: "Crane swing", tip: "How much of the rope's angle the hanging mech's body takes (1 = hangs rigidly in line with the rope)" },
  { key: "deckParkTime", label: "Park settle (s)", min: 0.3, max: 5, step: 0.1, group: "Deck", tip: "How long the mech takes to kneel in a parking bay (and stand up again)" },
  { key: "deckCrouch", label: "Park crouch (m)", min: 0, max: 1.6, step: 0.05, group: "Deck", tip: "How far the hips drop when parked" },
  { key: "deckParkPitch", label: "Park nose-down (°)", min: -10, max: 25, step: 0.5, group: "Deck", tip: "How far the hull tips forward when parked" },
];

export type CarryState = "walking" | "inRange" | "pickup" | "lifting" | "aboard" | "parked" | "launching" | "deploying" | "landing";
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

  constructor(public v: Values, readonly crane: Crane, readonly field: DuneField) {
    this.ground = new DeckGround(field, crane.platform);
  }

  get platform(): Platform { return this.crane.platform; }
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
      case "parked": return this.phase === "rise" ? "standing up" : "parked, the pilot can climb out here (not built yet) · E to stand up";
      case "launching": return "on the launch pad: crane coming (step off to cancel)";
      case "deploying": return { lift: "lifted off the deck", swing: "swinging out", hover: "steadying over the sand", drop: "lowering to the sand" }[this.phase as "lift"] ?? "launching";
      case "landing": return "launched: keep pace";
    }
  }

  /** Distance (horizontal) from the crane's mast to the mech. */
  distance(sim: WalkerSim) { return Math.hypot(sim.pos.x - this.crane.base.x, sim.pos.z - this.crane.base.z); }

  /** Start aboard (lab flag): the mech stands on the set-down pad. */
  putAboard(sim: WalkerSim) {
    const p = this.platform, w = p.toWorld(0, 0, this.v.craneSetDown);
    this.toDeck(sim, w.x, w.z, p.heading);
  }

  /** Lab start-up: the cradle already gripping the mech where it stands on the sand, about to lift. */
  grab(sim: WalkerSim) {
    const r = this.crane.rel(sim.pos.x, sim.pos.z);
    this.crane.snapTo(r.slew, r.radius, sim.pelvis.y + this.v.craneGrip);
    this.state = "lifting"; this.phase = "lift"; this.attached = true; this.pickups++;
    this.relHeading = wrap(sim.heading - this.platform.heading);
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
    const v = this.v, cr = this.crane, p = this.platform;
    if (sim.ground !== this.ground) sim.ground = this.ground;
    const hip = sim.v.hipHeight;
    const dist = this.distance(sim);
    const setDown = cr.relLocal(0, v.craneSetDown);
    const deckY = () => p.toWorld(0, p.deck, v.craneSetDown).y;
    const liftY = () => Math.max(deckY(), p.y + p.deck) + RAIL + v.craneClear + hangDrop(sim) + v.craneGrip;
    const stow = () => cr.aim(setDown.slew, setDown.radius, null);
    let out: MoveCommand | null = cmd;
    cr.steadying = false;
    this.spot = this.onDeck ? spotAt(sim, p, v) : null;

    switch (this.state) {
      case "walking":
        stow();
        if (!this.armed && dist > v.craneRange + 2) this.armed = true;
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
          if (cr.settled(Math.PI, 0.15)) this.phase = "swing";
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
        const side = cr.relLocal(this.side * v.craneDeployReach, v.craneMount);
        const g = this.field.height(cr.cradle.x, cr.cradle.z);
        if (this.phase === "lift") {
          cr.aim(cr.slew, cr.radius, liftY());
          if (cr.settled(Math.PI, 0.15)) this.phase = "swing";
        } else if (this.phase === "swing") {
          cr.aim(side.slew, side.radius, liftY());
          if (cr.settled(1.5 * D2R, 0.3)) this.phase = "hover";
        } else if (this.phase === "hover") {
          cr.steadying = true;
          cr.aim(side.slew, side.radius, g + hip + v.craneGrip + v.craneHover);
          if (cr.settled(1.5 * D2R, 0.1) && cr.steady(0.15)) this.phase = "drop";
        } else {
          cr.steadying = true;
          cr.aim(side.slew, side.radius, g + hip + v.craneGrip - 0.2);
          if (cr.cradle.y - v.craneGrip <= g + hip + 0.03) { this.release(sim); out = this.follow(sim); }
        }
        break;
      }
      case "parked": {
        out = null;
        stow();
        const n = this.kneel;
        n.crouch = v.deckCrouch; n.pitch = v.deckParkPitch;
        n.k = Math.max(0, Math.min(1, n.k + (this.phase === "rise" ? -dt : dt) / Math.max(0.1, v.deckParkTime)));
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
        if (dist > v.craneRange + 2) this.armed = true;
        if (this.timer <= 0) this.state = "walking";
        else out = this.follow(sim);
        break;
    }
    this.ground.onDeck = this.onDeck || this.state === "parked";

    cr.step(dt);

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

  /** Let go onto the sand at the convoy's speed, facing along it. */
  private release(sim: WalkerSim) {
    const p = this.platform;
    this.attached = false;
    this.state = "landing"; this.phase = ""; this.timer = this.v.craneFollow;
    this.armed = false;
    this.deploys++;
    this.ground.onDeck = false;
    sim.reset(this.crane.cradle.x, this.crane.cradle.z, p.heading);
    sim.speed = p.speed;
    sim.vel.set(Math.sin(p.heading) * p.speed, 0, Math.cos(p.heading) * p.speed);
  }

  /** The forced walk after a launch: along the convoy at its speed. */
  private follow(sim: WalkerSim): MoveCommand {
    const p = this.platform, s = p.speed, sprint = s > sim.v.walkSpeed + 0.05;
    const mag = Math.min(1, s / (sprint ? sim.v.sprintSpeed : sim.v.walkSpeed));
    return { x: Math.sin(p.heading) * mag, z: Math.cos(p.heading) * mag, sprint };
  }
}

