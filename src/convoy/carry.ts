// Crane pick-up and deploy (pure, no rendering): the state machine that has the crane fetch the mech, set it in the
// bay, and lower it back to the sand beside the moving convoy.
//
// Pick-up is automatic (Keith 2026-10-24): once the mech has been inside craneRange of the crane for craneDwell, the
// crane swings out, lowers its cradle and connects. Leave the range before the cradle grips and nothing happens.
// Once gripped, the legs hang (the walker isn't stepped; its body is placed under the cradle and the feet dangle),
// it's lifted over the rail, swung over the bay and set down standing on the deck, riding the platform.
// Deploy (a key in the lab) runs it backwards over the chosen side, down to the sand, and releases the mech with the
// convoy's velocity: craneFollow seconds of forced walking along the convoy's heading, then WASD again.
// After a deploy the mech has to leave the range once before the crane will pick it up again.
//
// The walker is driven externally while held: its pose is written here (holdPose) and its leg solve run directly;
// on release WalkerSim.reset puts it back on the ground with its springs settled.
import { Quaternion, Matrix4, Vector3, Euler } from "three";
import type { Param } from "../core/tweaks";
import type { WalkerSim, MoveCommand } from "../mech/walker";
import type { Platform } from "./platform";
import type { Crane } from "./crane";

export const CARRY_DEFAULTS = {
  craneRange: 21,
  craneDwell: 1,
  craneGrip: 1.7,
  craneGripTol: 1.2,
  craneClear: 1.5,
  craneDeployReach: 21,
  craneFollow: 2,
  craneCarryTurn: 40,
  craneBaySlot: -7,
};
export type CarryValues = typeof CARRY_DEFAULTS;

export const CARRY_PARAMS: Param[] = [
  { key: "craneRange", label: "Pick-up range (m)", min: 5, max: 40, step: 0.5, group: "Pick-up and deploy", tip: "Inside this distance of the crane, the crane comes for the mech" },
  { key: "craneDwell", label: "Wait in range (s)", min: 0, max: 5, step: 0.1, group: "Pick-up and deploy", tip: "How long the mech must be in range before the crane moves" },
  { key: "craneGrip", label: "Grip above hips (m)", min: 0.5, max: 3, step: 0.05, group: "Pick-up and deploy", tip: "Where the cradle grips the hull" },
  { key: "craneGripTol", label: "Grip tolerance (m)", min: 0.3, max: 3, step: 0.05, group: "Pick-up and deploy", tip: "How close the cradle must get to connect" },
  { key: "craneClear", label: "Clearance over rail (m)", min: 0, max: 5, step: 0.1, group: "Pick-up and deploy", tip: "How high the hanging feet clear the deck rail" },
  { key: "craneDeployReach", label: "Deploy reach (m)", min: 8, max: 40, step: 0.5, group: "Pick-up and deploy", tip: "How far out to the side the mech is set down" },
  { key: "craneFollow", label: "Forced follow (s)", min: 0, max: 6, step: 0.1, group: "Pick-up and deploy", tip: "After release the mech walks with the convoy this long before WASD comes back" },
  { key: "craneCarryTurn", label: "Carried turn (°/s)", min: 0, max: 120, step: 1, group: "Pick-up and deploy", tip: "How fast a carried mech is turned to face along the platform" },
  { key: "craneBaySlot", label: "Bay slot (m)", min: -18, max: 18, step: 0.5, group: "Pick-up and deploy", tip: "Where the mech stands on the bay platform, forward of its middle" },
];

export type CarryState = "walking" | "inRange" | "pickup" | "lifting" | "aboard" | "deploying" | "landing";
type Phase = "reach" | "lower" | "lift" | "swing" | "set" | "drop" | "";

const D2R = Math.PI / 180;
/** Deck rail height (m): the hanging feet clear this. */
export const RAIL = 1.1;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export interface CarryGround { height(x: number, z: number): number }

export class CraneCarry {
  state: CarryState = "walking";
  phase: Phase = "";
  /** The mech hangs from the cradle. */
  attached = false;
  /** False after a deploy until the mech has left the range once. */
  armed = true;
  /** Seconds in range (inRange), or forced follow left (landing). */
  timer = 0;
  /** Deploy side: +1 left, -1 right of the platform. */
  side: 1 | -1 = 1;
  /** Counts for the check and HUD. */
  pickups = 0;
  deploys = 0;
  aborts = 0;
  /** The mech's heading relative to the platform while held. */
  private relHeading = 0;
  private t = { q: new Quaternion(), q2: new Quaternion(), m: new Matrix4(), e: new Euler(), a: new Vector3(), b: new Vector3(), c: new Vector3() };

  constructor(public v: CarryValues, readonly crane: Crane, readonly ground: CarryGround) {}

  get platform(): Platform { return this.crane.platform; }

  /** Words for the HUD. */
  get label() {
    switch (this.state) {
      case "walking": return this.armed ? "walking" : "walking (leave crane range to re-arm)";
      case "inRange": return "in range";
      case "pickup": return "crane coming";
      case "lifting": return "being picked up";
      case "aboard": return "aboard";
      case "deploying": return "deploying";
      case "landing": return "deployed: keep pace";
    }
  }

  /** Distance (horizontal) from the crane's mast to the mech. */
  distance(sim: WalkerSim) { return Math.hypot(sim.pos.x - this.crane.base.x, sim.pos.z - this.crane.base.z); }

  /** Start aboard (lab flag): the mech stands in the bay. */
  putAboard(sim: WalkerSim) {
    this.state = "aboard"; this.phase = ""; this.attached = false; this.relHeading = 0;
    this.standAboard(sim);
  }

  /** Begin a deploy over the given side (only from aboard). */
  deploy(side: 1 | -1) {
    if (this.state !== "aboard") return false;
    this.state = "deploying"; this.phase = "reach"; this.side = side;
    return true;
  }

  /**
   * One step. cmd is what the player (or demo) asks of the legs. Returns the command to step the walker with, or
   * null when the walker is held (its pose has been written here; don't step it).
   */
  update(dt: number, sim: WalkerSim, cmd: MoveCommand): MoveCommand | null {
    const v = this.v, cr = this.crane, p = this.platform;
    const hip = sim.v.hipHeight;
    const dist = this.distance(sim);
    const slot = cr.relLocal(0, v.craneBaySlot);
    const deckY = () => p.toWorld(0, p.deck, v.craneBaySlot).y;
    const liftY = () => Math.max(deckY(), p.y + p.deck) + RAIL + v.craneClear + this.hang(sim) + v.craneGrip;
    const stow = () => cr.aim(slot.slew, slot.radius, null);
    let out: MoveCommand | null = cmd;

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
        const r = cr.rel(sim.pos.x, sim.pos.z);
        const gripY = sim.pelvis.y + v.craneGrip;
        const dx = cr.cradle.x - sim.pelvis.x, dz = cr.cradle.z - sim.pelvis.z, off = Math.hypot(dx, dz);
        if (this.phase === "reach") {
          cr.aim(r.slew, r.radius, gripY + 3);
          if (off < 1.5) this.phase = "lower";
        } else {
          cr.aim(r.slew, r.radius, gripY);
          if (off > 3) this.phase = "reach";
          else if (off < v.craneGripTol && Math.abs(cr.cradle.y - gripY) < 0.35) {
            this.state = "lifting"; this.phase = "lift"; this.attached = true; this.pickups++;
            this.relHeading = wrap(sim.heading - p.heading);
          }
        }
        break;
      }
      case "lifting":
        out = null;
        if (this.phase === "lift") {
          cr.aim(cr.slew, cr.radius, liftY());
          if (cr.settled(Math.PI, 0.15)) this.phase = "swing";
        } else if (this.phase === "swing") {
          cr.aim(slot.slew, slot.radius, liftY());
          if (cr.settled(1.5 * D2R, 0.3)) this.phase = "set";
        } else {
          cr.aim(slot.slew, slot.radius, deckY() + hip + v.craneGrip);
          if (cr.settled(1.5 * D2R, 0.05)) { this.state = "aboard"; this.phase = ""; this.attached = false; }
        }
        break;
      case "aboard":
        out = null;
        stow();
        break;
      case "deploying": {
        out = null;
        const side = cr.relLocal(this.side * v.craneDeployReach, cr.v.craneMount);
        const gripY = deckY() + hip + v.craneGrip;
        if (this.phase === "reach") {
          cr.aim(slot.slew, slot.radius, gripY + 2);
          if (cr.settled(1.5 * D2R, 0.3)) this.phase = "lower";
        } else if (this.phase === "lower") {
          cr.aim(slot.slew, slot.radius, gripY);
          if (cr.settled(1.5 * D2R, 0.05)) { this.phase = "lift"; this.attached = true; }
        } else if (this.phase === "lift") {
          cr.aim(slot.slew, slot.radius, liftY());
          if (cr.settled(Math.PI, 0.15)) this.phase = "swing";
        } else if (this.phase === "swing") {
          cr.aim(side.slew, side.radius, liftY());
          if (cr.settled(1.5 * D2R, 0.3)) this.phase = "drop";
        } else {
          const g = this.ground.height(cr.cradle.x, cr.cradle.z);
          cr.aim(side.slew, side.radius, g + hip + v.craneGrip - 0.2);
          if (cr.cradle.y - v.craneGrip <= g + hip + 0.03) { this.release(sim); out = this.follow(sim); }
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

    cr.step(dt);

    // Place a held mech.
    if (this.attached) {
      const want = this.state === "deploying" || this.state === "lifting" ? 0 : this.relHeading;
      const max = v.craneCarryTurn * D2R * dt;
      this.relHeading = wrap(this.relHeading + Math.max(-max, Math.min(max, wrap(want - this.relHeading))));
      const py = cr.cradle.y - v.craneGrip;
      // Feet dangle, or stand on the deck once lowered onto it.
      const floor = this.overDeck(cr.cradle.x, cr.cradle.z) ? deckY() : this.ground.height(cr.cradle.x, cr.cradle.z);
      this.holdPose(sim, cr.cradle.x, py, cr.cradle.z, wrap(p.heading + this.relHeading), floor, false);
    } else if (out === null) this.standAboard(sim);
    return out;
  }

  /** Feet below the hips while hanging (legs nearly straight). */
  hang(sim: WalkerSim) { return sim.v.hipHeight * 1.04; }

  private overDeck(x: number, z: number) {
    const l = this.platform.toLocal(x, z);
    return Math.abs(l.x) < this.platform.spec.width / 2 && Math.abs(l.z) < this.platform.spec.length / 2;
  }

  private standAboard(sim: WalkerSim) {
    const p = this.platform, w = p.toWorld(0, p.deck, this.v.craneBaySlot);
    this.holdPose(sim, w.x, w.y + sim.v.hipHeight, w.z, wrap(p.heading + this.relHeading), w.y, true);
  }

  /** Let go onto the sand at the convoy's speed, facing along it. */
  private release(sim: WalkerSim) {
    const p = this.platform;
    this.attached = false;
    this.state = "landing"; this.phase = ""; this.timer = this.v.craneFollow;
    this.armed = false;
    this.deploys++;
    sim.reset(this.crane.cradle.x, this.crane.cradle.z, p.heading);
    sim.speed = p.speed;
    sim.vel.set(Math.sin(p.heading) * p.speed, 0, Math.cos(p.heading) * p.speed);
  }

  /** The forced walk after a deploy: along the convoy at its speed. */
  private follow(sim: WalkerSim): MoveCommand {
    const p = this.platform, s = p.speed, sprint = s > sim.v.walkSpeed + 0.05;
    const mag = Math.min(1, s / (sprint ? sim.v.sprintSpeed : sim.v.walkSpeed));
    return { x: Math.sin(p.heading) * mag, z: Math.cos(p.heading) * mag, sprint };
  }

  /**
   * Write the walker's pose directly: body at (x, pelvisY, z) facing heading, feet hanging below the hips or standing
   * on floorY, then run its leg solve. aboard: tilt with the platform, feet flat on the deck.
   */
  holdPose(sim: WalkerSim, x: number, pelvisY: number, z: number, heading: number, floorY: number, aboard: boolean) {
    const v = sim.v, t = this.t, p = this.platform;
    sim.pos.set(x, 0, z);
    sim.heading = heading;
    sim.speed = 0;
    sim.vel.set(0, 0, 0);
    sim.turnSpeed = 0;
    sim.pelvis.set(x, pelvisY, z);
    t.q2.setFromEuler(t.e.set(0, heading, 0, "YXZ"));
    if (aboard) {
      // Platform tilt times the heading within it.
      t.m.makeBasis(t.a.set(p.left.x, p.left.y, p.left.z), t.b.set(p.up.x, p.up.y, p.up.z), t.c.set(p.fwd.x, p.fwd.y, p.fwd.z));
      t.q.setFromRotationMatrix(t.m).multiply(t.q2.setFromEuler(t.e.set(0, wrap(heading - p.heading), 0, "YXZ")));
    } else t.q.copy(t.q2);
    sim.pelvisQ.copy(t.q);
    sim.hullQ.copy(t.q);
    const lx = Math.cos(heading), lz = -Math.sin(heading), fx = Math.sin(heading), fz = Math.cos(heading);
    const hang = this.hang(sim);
    const standing = pelvisY - hang <= floorY + 0.01;
    for (const f of sim.feet) {
      const spread = standing ? v.footSpread : v.hipWidth * 0.9;
      f.swinging = false; f.u = 0; f.stanceT = 0;
      f.pos.set(x + lx * f.side * spread + fx * 0.15, Math.max(floorY, pelvisY - hang), z + lz * f.side * spread + fz * 0.15);
      f.planted.copy(f.pos);
      f.yaw = heading + f.side * v.toeOut * D2R;
      f.plantedYaw = f.yaw;
      if (aboard || standing) f.up.set(p.up.x, p.up.y, p.up.z); else f.up.set(0, 1, 0);
      f.plantedUp.copy(f.up);
      // Hanging: toes droop.
      const droop = standing ? 0 : Math.min(1, (pelvisY - hang - floorY) / 0.6);
      f.pitch = 0.45 * droop;
      f.toe = 0.35 * droop;
      f.groundY = f.pos.y;
    }
    (sim as unknown as { pose(): void }).pose();
  }
}
