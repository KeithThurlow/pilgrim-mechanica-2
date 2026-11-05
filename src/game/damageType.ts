// Damage types (Keith 2026-11-05: "flame damage maybe doing more damage to human enemies ... more damage to creatures").
// A hook, pure: what a hit is (kinetic, explosive, energy, fire, cold) against what it lands on (metal, flesh, and
// creatures once the world has them). Only fire uses it so far: burns and napalm pools take typeMul("fire", ...) per
// target (src/game/burn.ts, src/game/firePools.ts). Rounds, blasts and beams stay at ×1 until someone wants them tuned.
// The cold row is for the freeze ray (planned). Values are sliders (Weapons › Damage types).
import type { Param } from "../core/tweaks";

export type DamageType = "kinetic" | "explosive" | "energy" | "fire" | "cold";
/** What a target is made of. Today: robots, mechs, vehicles, gates are metal; bandits and the pilot are flesh. */
export type Matter = "metal" | "flesh" | "creature";

export const DAMAGE_TYPE_DEFAULTS = {
  fireVsFlesh: 1.35,
  fireVsMetal: 0.7,
  fireVsCreature: 1.5,
  coldVsFlesh: 1,
  coldVsMetal: 1,
  coldVsCreature: 1.2,
};
export type DamageTypeValues = typeof DAMAGE_TYPE_DEFAULTS;

export const DAMAGE_TYPE_GROUP = "Damage types";
const G = DAMAGE_TYPE_GROUP;
export const DAMAGE_TYPE_PARAMS: Param[] = [
  { key: "fireVsFlesh", label: "Fire vs flesh (bandits, pilots) ×", min: 0, max: 3, step: 0.05, group: G, tip: "Burn and napalm damage on people" },
  { key: "fireVsMetal", label: "Fire vs metal (robots, mechs, vehicles) ×", min: 0, max: 3, step: 0.05, group: G, tip: "Metal shrugs off flames but heats up: hot metal cooks on its own (Burning and heat)" },
  { key: "fireVsCreature", label: "Fire vs creatures ×", min: 0, max: 3, step: 0.05, group: G, tip: "For when the world has creatures (none yet)" },
  { key: "coldVsFlesh", label: "Cold vs flesh ×", min: 0, max: 3, step: 0.05, group: G, tip: "The freeze ray (planned)" },
  { key: "coldVsMetal", label: "Cold vs metal ×", min: 0, max: 3, step: 0.05, group: G, tip: "The freeze ray (planned)" },
  { key: "coldVsCreature", label: "Cold vs creatures ×", min: 0, max: 3, step: 0.05, group: G, tip: "The freeze ray (planned)" },
];

/** What a target is made of: its own matter if it says, else by its hit surface (flesh, or metal for the rest). */
export function matterOf(t: { surface?: string; matter?: Matter }): Matter {
  return t.matter ?? (t.surface === "flesh" ? "flesh" : "metal");
}

/** The multiplier for a hit of this type on this matter (×1 for any pair without a slider). */
export function typeMul(type: DamageType, matter: Matter, v: Partial<DamageTypeValues> = DAMAGE_TYPE_DEFAULTS): number {
  if (type !== "fire" && type !== "cold") return 1;
  const key = `${type}Vs${matter === "flesh" ? "Flesh" : matter === "metal" ? "Metal" : "Creature"}` as keyof DamageTypeValues;
  const k = v[key] ?? DAMAGE_TYPE_DEFAULTS[key];
  return k >= 0 ? k : 0;
}
