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
};
