// SPIKE (walker lab only, ?bound): a rough "bound", the sprint Keith described 2026-10-26, to check the approach in
// docs/proposal-bound.md before building it properly. Not the system: no items, fuel, camera or combat-lab wiring.
//
// Hold Space: the mech leaps from both feet, flies on the walker's air state (legs tucking and reaching, the lead foot
// swapping each leap), lands on both feet with a small squat, skids a moment on its momentum, and leaps again. Speed
// builds toward the top while held. Turning is limited by grip (lateral pull × gravity / speed), and the flight keeps
// some of its old direction (drift). Crests throw it further by themselves: the walker leaves the ground wherever the
// ground falls away faster than gravity can follow. With glide > 0 (a booster), falling is slowed.
// Pure: drives a WalkerSim, no rendering, so a headless probe can run it.
import type { WalkerSim, MoveCommand } from "../../src/mech/walker";
import type { Param } from "../../src/core/tweaks";

export const BOUND_SPIKE_DEFAULTS = {
  boundTop: 16,
  boundBuild: 0.35,
  boundHop: 3.2,
  boundStance: 0.12,
  boundGrip: 0.6,
  boundDrift: 0.5,
  boundGlide: 0,
  boundSplit: 3,
};
export type BoundSpikeValues = typeof BOUND_SPIKE_DEFAULTS;

const G = "Bound (spike)";
export const BOUND_SPIKE_PARAMS: Param[] = [
  { key: "boundTop", label: "Top speed (m/s)", min: 8, max: 35, step: 0.5, group: G, tip: "Spike: legs gear would set this (about 14 early, 20-26 late)" },
  { key: "boundBuild", label: "Speed build (share/s)", min: 0.05, max: 2, step: 0.01, group: G, tip: "Each second held closes this share of the gap to top speed" },
  { key: "boundHop", label: "Leap (m/s up)", min: 0.5, max: 8, step: 0.1, group: G, tip: "Upward speed of each push-off: 3.2 is about 0.65 s in the air and 0.5 m up" },
  { key: "boundStance", label: "Feet down between leaps (s)", min: 0.03, max: 0.5, step: 0.01, group: G },
  { key: "boundGrip", label: "Grip (× gravity)", min: 0.1, max: 2, step: 0.05, group: G, tip: "Sideways pull the feet can make: turn rate is grip × g / speed, so the turning circle grows with speed squared" },
  { key: "boundDrift", label: "Flight keeps its line", min: 0, max: 1, step: 0.01, group: G, tip: "At each push-off the flight turns only partway to the heading: the rest is drift" },
  { key: "boundSplit", label: "Stride in the air (× split)", min: 0, max: 5, step: 0.1, group: G, tip: "How far the lead foot reaches ahead and the other trails while bounding, × the air split" },
  { key: "boundGlide", label: "Glide (share of gravity)", min: 0, max: 0.9, step: 0.01, group: G, tip: "A booster's lift while falling: hang time off crests" },
];

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class BoundSpike {
  active = false;
  speed = 0;
  /** The flight's direction (radians, like a heading); lags the heading in turns. */
  course = 0;
  leaps = 0;
  private stance = 0;
  private wasAir = false;

  constructor(public v: BoundSpikeValues) {}

  /**
   * Before the mech steps: hold (Space down), the stick (world x/z), and the frame's dt. Returns the command for the
   * legs (zero while bounding: the spike moves the body itself).
   */
  update(dt: number, hold: boolean, stick: MoveCommand, sim: WalkerSim): MoveCommand {
    const v = this.v;
    if (!hold || sim.stagger > 0) {
      if (this.active) sim.airLead = 1;
      this.active = false;
      return stick;
    }
    if (!this.active) {
      this.active = true;
      this.speed = Math.max(sim.speed, sim.v.sprintSpeed * 0.8);
      this.course = sim.heading;
      this.stance = v.boundStance; // leap at once
    }
    this.speed += (v.boundTop - this.speed) * Math.min(1, v.boundBuild * dt);
    // Turn toward the stick, no faster than grip allows at this speed.
    if (stick.x * stick.x + stick.z * stick.z > 0.01) {
      const maxTurn = (v.boundGrip * 9.81) / Math.max(1, this.speed);
      const err = wrap(Math.atan2(stick.x, stick.z) - sim.heading);
      sim.heading = wrap(sim.heading + Math.max(-maxTurn * dt, Math.min(maxTurn * dt, err)));
    }
    if (sim.airborne) {
      if (v.boundGlide > 0 && sim.airVel.y < 0) sim.airVel.y += 9.81 * v.boundGlide * dt;
      this.wasAir = true;
      return { x: 0, z: 0, sprint: false };
    }
    if (this.wasAir) {
      // Just landed: both feet down, skidding on the speed carried.
      this.wasAir = false;
      this.stance = 0;
    }
    sim.speed = 0;
    sim.vel.set(0, 0, 0);
    sim.skid.set(Math.sin(this.course) * this.speed, 0, Math.cos(this.course) * this.speed);
    this.stance += dt;
    if (this.stance >= v.boundStance) {
      this.course = wrap(this.course + wrap(sim.heading - this.course) * (1 - v.boundDrift));
      sim.airLead = (sim.airLead > 0 ? -1 : 1) * this.v.boundSplit;
      sim.launch(Math.sin(this.course) * this.speed, v.boundHop, Math.cos(this.course) * this.speed);
      this.leaps++;
      this.wasAir = true;
    }
    return { x: 0, z: 0, sprint: false };
  }
}
