// Leg archetypes (Keith 2026-10-24: be ready for different legs and leg configurations, as the old game had).
// Each is a preset of walker tuning: proportions, stance, gait and feet. Models measure their own bone lengths from
// their joint markers at load (RampartBody.legValues), so a preset holds what a model can't tell us: how it walks
// and how its feet work. The old game's other types (Humanoid, Short humanoid, Stilt; old walker lab LEG_PRESETS)
// come in here when they have models.
import type { WalkerValues } from "./walkerTuning";

export interface LegType {
  id: string;
  name: string;
  notes: string;
  values: Partial<WalkerValues>;
}

export const LEG_TYPES: Record<string, LegType> = {
  standin: {
    id: "standin",
    name: "Stand-in digitigrade",
    notes: "The box walker: the walker tuning defaults.",
    values: {},
  },
  rampart: {
    id: "rampart",
    name: "Rampart",
    notes:
      "The old project's v4 study. Bone lengths come from rampart.glb's joint markers (copied here for the headless " +
      "check). Stance widths are the old game's for this size (old lab 1.4 / 0.95 x 3.05 / 4.4), not the model's wide " +
      "rest pose. Toe hinge where the foot's tall block ends and the low splayed toes begin (profile of Part_Foot_L, " +
      "2026-10-24); toes reach 0.85 m ahead of the foot point.",
    values: {
      hipHeight: 3.05, hipWidth: 0.78,
      femur: 1.717, shin: 0.749, cannon: 1.083, cannonRake: 22.4, ankleHeight: 0.153, ankleBack: 0,
      footSpread: 0.97, walkSpread: 0.66,
      toeHinge: 0.14, toeLength: 0.85, toeCurl: 40,
      // A shorter stride than the stand-in's: with its short shin, a long stance trails the foot until the leg runs
      // straight (Keith 2026-10-24: the thigh swung too far back). Walk check: thigh back and knee at push-off.
      strideBase: 2.3, stridePerSpeed: 0.4,
    },
  },
  // Rampart variants (src/mech/variants.ts) whose legs differ from the Rampart's; values from their modelling agents.
  "rampart-stilt": {
    id: "rampart-stilt",
    name: "Stilt (Rampart Stilt)",
    notes:
      "The old game's legs.stilt x 0.693: a short shin kicked back over a long raked cannon, small feet, high knee " +
      "lift. Bone lengths from rampart-stilt.glb's markers; a longer stride suits the long cannon.",
    values: {
      hipHeight: 3.05, hipWidth: 0.64,
      femur: 1.247, shin: 0.82, cannon: 1.298, cannonRake: 14.3, ankleHeight: 0.153, ankleBack: 0,
      footSpread: 0.82, walkSpread: 0.56,
      toeHinge: 0.12, toeLength: 0.47, toeCurl: 35,
      strideBase: 2.5, stridePerSpeed: 0.5, liftHeight: 0.9,
    },
  },
  "rampart-siege": {
    id: "rampart-siege",
    name: "Heavy walker (Rampart Siege)",
    notes:
      "The old game's legs.heavywalker: short thick legs on wide-set hips (0.92 m), stance 1.25x the Rampart's, three " +
      "toes on one hinge line 0.24 m ahead of the foot point (the foot mesh splits there, so it must match).",
    values: {
      hipHeight: 2.72, hipWidth: 0.92,
      femur: 1.441, shin: 0.679, cannon: 1.017, cannonRake: 18.4, ankleHeight: 0.136, ankleBack: 0,
      footSpread: 1.2, walkSpread: 0.95,
      toeHinge: 0.24, toeLength: 0.8, toeCurl: 35,
      strideBase: 2.1, stridePerSpeed: 0.36,
    },
  },
};
