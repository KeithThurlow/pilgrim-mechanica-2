// The sprint's input and kit (Keith 2026-10-26; docs/proposal-bound.md). Pure: no input reading, no drawing.
// Space pressed dashes at once (src/mech/dash.ts); keep holding (dashHoldRun) and the dash's push-off flows straight into
// the sprint's run, which builds toward the legs' top speed while held (the gait itself is the walker's, `bound`).
// Let go and it lands out of its stride and runs on, skidding off what the run can't hold.
// Energy (Keith 2026-10-27): the sprint only ever comes out of a held dash, and drains the energy bars (src/mech/dash.ts:
// the dash took a full one, the sprint takes the rest slowly); out of energy, it ends. Without a full bar there's no
// dash, so no sprint (boundTap is no longer used). Weapons are off the moment the sprint runs (sprintGunsAfter 0;
// Keith: "lose the grace"); the dash and its short sprint still fire.
// The booster pack (simple version, Keith's answer: the rocket slide goes, the booster later adds thrust and glide):
// while its tank lasts, the sprint's top speed is boostTop higher and leaps fall boostGlide slower; it burns boostBurn
// tank-seconds a second while sprinting and refills when not.
// Weapons while sprinting (Keith 2026-10-26 21:54: "once you're sprinting, you can't use your weapons, and the mech
// inherently starts looking forward and leaning forward... give a bit of a timer for the turn forward, the player might
// be mid fight"): for sprintGunsAfter seconds into the sprint they still fire (with extra spread in the air), then the
// weapons are off: `gunsOff`, a state the mech unit reads (src/game/mechUnit.ts) to hold the triggers, cancel paints and
// charges, and turn the torso and head to the line of travel with the hull leaning forward. Let go and they're back.
// Ownership: the player's own movement (a command), like the walk and the dash.
import type { Param } from "../core/tweaks";
import type { WalkerSim } from "./walker";
import type { Dash } from "./dash";

export const BOUND_DEFAULTS = {
  boundTap: 0.2,
  dashHoldRun: 0.15,
  boostTop: 8,
  boostGlide: 0,
  boostBurn: 0.25,
  sprintGunsAfter: 0,
  sprintFaceDrift: 0.5,
  sprintHullLean: 8,
  airGunSpread: 3,
  sprintPushDust: 0.8,
  sprintToeDig: 1.2,
  sprintShake: 0.05,
  sprintThump: 0.35,
  boundDust: 0.5,
};
export type BoundValues = typeof BOUND_DEFAULTS;

const G = "Sprint kit";
export const BOUND_PARAMS: Param[] = [
  { key: "dashHoldRun", label: "Held this long, the dash becomes the run (s)", min: 0.03, max: 0.5, step: 0.01, group: G, tip: "Space still down this long into a dash: its push-off flows into the sprint instead of a slide" },
  { key: "boostTop", label: "Booster: top speed + (m/s)", min: 0, max: 12, step: 0.5, group: G, tip: "With a booster pack fitted (a booster tank above 0, Dash group), while its tank lasts" },
  { key: "boostGlide", label: "Booster: glide (share of gravity)", min: 0, max: 0.9, step: 0.01, group: G, tip: "Falling out of a leap this much slower: more hang time off crests" },
  { key: "boostBurn", label: "Booster: tank burn sprinting (s/s)", min: 0, max: 2, step: 0.01, group: G },
  { key: "sprintGunsAfter", label: "Weapons off after sprinting for (s)", min: 0, max: 3, step: 0.05, group: G, tip: "Keith 2026-10-26 21:54: sprinting the weapons go off and the torso turns to face the way it runs; for this long into the sprint they still fire, so a mid-fight sprint keeps shooting a moment. Let go of Space and they're back, the torso turning to the aim at its normal rate" },
  { key: "sprintFaceDrift", label: "Weapons off: torso follows the drift (share)", min: 0, max: 1, step: 0.01, group: G, tip: "The torso faces the line of travel (0) or turns that share of the way with the legs into a drift (1: straight ahead of the legs)" },
  { key: "sprintHullLean", label: "Weapons off: hull leans forward (°)", min: 0, max: 25, step: 0.5, group: G, tip: "On top of the body's own lean, at the legs' top speed (from nothing at the walk)" },
  { key: "airGunSpread", label: "Extra spread in the air (°)", min: 0, max: 15, step: 0.1, group: G, tip: "Firing while the mech is off the ground (a leap, a jump)" },
  { key: "sprintPushDust", label: "Sprint: push-off sand burst ×", min: 0, max: 4, step: 0.05, group: G, tip: "At each push-off, as the toes leave, a burst of sand thrown back from them (on top of the toe kick): the leg throwing the mech forward (Keith 2026-10-26 21:54)" },
  { key: "sprintToeDig", label: "Sprint: toes dig in at push-off ×", min: 0, max: 3, step: 0.05, group: G, tip: "A short deep scoop at the toes, in the ground dents (× the footprint depth)" },
  { key: "sprintShake", label: "Sprint: camera shake per footfall (m)", min: 0, max: 0.5, step: 0.005, group: G, tip: "Labs that shake the camera; subtle by default" },
  { key: "sprintThump", label: "Sprint: footfall thump volume", min: 0, max: 2, step: 0.05, group: G, tip: "A low thud on each sprinting footfall (the landing's sound, quieter; the walk has no footfall sound yet)" },
  { key: "boundDust", label: "Sprint: footfall and toe kick dust ×", min: 0, max: 3, step: 0.05, group: G, tip: "On top of Running dust × (Dust: sources), for each sprint step's footfall and toe kick. Landings off jumps throw their own burst" },
];

export class Bound {
  /** Sprinting: Space held past the dash. */
  on = false;
  /** Seconds Space has been held. */
  heldFor = 0;
  /** Seconds sprinting (0 when not). */
  onFor = 0;
  /** Sprinting long enough that the weapons are off (sprintGunsAfter): the torso faces the travel line. */
  get gunsOff() { return this.on && this.onFor > 0 && this.onFor >= this.v.sprintGunsAfter; }

  constructor(public v: BoundValues) {}

  /** Each step before the dash and the walker: held is Space (only while driving), so the walker knows to sprint. */
  update(dt: number, held: boolean, sim: WalkerSim, dash: Dash) {
    const v = this.v;
    this.heldFor = held ? this.heldFor + dt : 0;
    // Held through a dash (Keith 2026-10-26 18:28: a long press becomes a run, not a sliding dash), while there's energy:
    // the run takes the dash's speed (src/mech/walker.ts); the sprint drains the bars as it goes.
    let want = held && (this.on || (sim.dashing && this.heldFor >= v.dashHoldRun));
    if (want && !dash.drain(dt)) want = false;
    if (want && !this.on) dash.cut();
    this.on = want;
    // Weapons off once the sprint actually runs (not while the dash's steps are still going).
    this.onFor = want && sim.running ? this.onFor + dt : 0;
    const booster = dash.v.boostFuel > 0 && dash.fuel > 0.02;
    dash.boosting = this.on && booster;
    if (dash.boosting) dash.fuel = Math.max(0, dash.fuel - v.boostBurn * dt);
    sim.bound = this.on;
    sim.boundTopNow = sim.v.boundTop + (dash.boosting ? v.boostTop : 0);
    sim.boundGlide = dash.boosting ? v.boostGlide : 0;
  }
}
