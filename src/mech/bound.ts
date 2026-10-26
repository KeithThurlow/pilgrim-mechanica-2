// The sprint's input and kit (Keith 2026-10-26; docs/proposal-bound.md). Pure: no input reading, no drawing.
// Space pressed dashes at once (src/mech/dash.ts); keep holding (dashHoldRun) and the dash's push-off flows straight into
// the sprint's run, which builds toward the legs' top speed while held (the gait itself is the walker's, `bound`).
// Let go and it lands out of its stride and runs on, skidding off what the run can't hold. With no dash charge, holding
// Space for boundTap starts the sprint from the walk.
// The booster pack (simple version, Keith's answer: the rocket slide goes, the booster later adds thrust and glide):
// while its tank lasts, the sprint's top speed is boostTop higher and leaps fall boostGlide slower; it burns boostBurn
// tank-seconds a second while sprinting and refills when not.
// Guns may fire while sprinting, in the air too, with extra spread there (Claude's default until Keith has played it;
// boundGuns 0 switches them off while sprinting).
// Ownership: the player's own movement (a command), like the walk and the dash.
import type { Param } from "../core/tweaks";
import type { WalkerSim } from "./walker";
import type { Dash } from "./dash";

export const BOUND_DEFAULTS = {
  boundTap: 0.2,
  dashHoldRun: 0.15,
  boostTop: 3,
  boostGlide: 0.3,
  boostBurn: 0.25,
  boundGuns: 1,
  airGunSpread: 3,
  boundDust: 1.9,
};
export type BoundValues = typeof BOUND_DEFAULTS;

const G = "Sprint kit";
export const BOUND_PARAMS: Param[] = [
  { key: "boundTap", label: "Hold to sprint without a dash (s)", min: 0, max: 1, step: 0.01, group: G, tip: "With a dash charge, the sprint follows the dash as soon as its shove ends; without one, after holding Space this long" },
  { key: "dashHoldRun", label: "Held this long, the dash becomes the run (s)", min: 0.03, max: 0.5, step: 0.01, group: G, tip: "Space still down this long into a dash: its push-off flows into the sprint instead of a slide" },
  { key: "boostTop", label: "Booster: top speed + (m/s)", min: 0, max: 12, step: 0.5, group: G, tip: "With a booster pack fitted (a booster tank above 0, Dash group), while its tank lasts" },
  { key: "boostGlide", label: "Booster: glide (share of gravity)", min: 0, max: 0.9, step: 0.01, group: G, tip: "Falling out of a leap this much slower: more hang time off crests" },
  { key: "boostBurn", label: "Booster: tank burn sprinting (s/s)", min: 0, max: 2, step: 0.01, group: G },
  { key: "boundGuns", label: "Guns fire while sprinting (1 on, 0 off)", min: 0, max: 1, step: 1, group: G, tip: "Keith hasn't decided: on by default, revisit after play" },
  { key: "airGunSpread", label: "Extra spread in the air (°)", min: 0, max: 15, step: 0.1, group: G, tip: "Firing while the mech is off the ground (a leap, a jump)" },
  { key: "boundDust", label: "Sprint: footfall and toe kick dust ×", min: 0, max: 3, step: 0.05, group: G, tip: "On top of Running dust × (Dust: sources), for each sprint step's footfall and toe kick. Landings off jumps throw their own burst" },
];

export class Bound {
  /** Sprinting: Space held past the dash. */
  on = false;
  /** Seconds Space has been held. */
  heldFor = 0;

  constructor(public v: BoundValues) {}

  /** Each step before the dash and the walker: held is Space (only while driving), so the walker knows to sprint. */
  update(dt: number, held: boolean, sim: WalkerSim, dash: Dash) {
    const v = this.v;
    this.heldFor = held ? this.heldFor + dt : 0;
    // Held through the dash (Keith 2026-10-26 18:28: a long press becomes a run, not a sliding dash): once its push-off
    // has gone, the shove ends and the run takes the speed (src/mech/walker.ts, at most dashIntoRun).
    const want = held && this.heldFor >= (dash.shoving ? v.dashHoldRun : v.boundTap);
    if (want && !this.on) dash.cut();
    this.on = want;
    const booster = dash.v.boostFuel > 0 && dash.fuel > 0.02;
    dash.boosting = this.on && booster;
    if (dash.boosting) dash.fuel = Math.max(0, dash.fuel - v.boostBurn * dt);
    sim.bound = this.on;
    sim.boundTopNow = sim.v.boundTop + (dash.boosting ? v.boostTop : 0);
    sim.boundGlide = dash.boosting ? v.boostGlide : 0;
  }
}
