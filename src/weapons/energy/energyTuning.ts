// Energy weapons' feel values (Keith 2026-11-02: "energy weapons and having energy as a mechanic"). Every energy weapon
// spends the mech's energy bars (the same bars as the dash and the sprint, src/mech/dash.ts; the pack is the reactor:
// its bars are the capacity, its recharge the regen). Spending pauses the refill like the sprint does. An unrolled
// weapon (the weapons lab's picker) runs on these sliders; a rolled one carries its own damage, energy and timings
// (src/weapons/energy/energyBases.ts).
import type { Param } from "../../core/tweaks";

export const ENERGY_DEFAULTS = {
  /** 1: energy weapons spend the bars; 0: free (for tuning damage without the energy getting in the way). */
  energyCost: 1,
  energyLevel: 0.8,
  // Pulse laser: a hitscan bolt per shot, armour-piercing, long range.
  pulseDamage: 30,
  pulseAp: 0.45,
  pulseRate: 5,
  pulseRange: 60,
  pulseEnergy: 0.05,
  pulseFlash: 0.08,
  pulseWidth: 0.08,
  // Beam laser: held, a continuous beam that burns what it touches in ticks and heats the sand.
  beamDps: 220,
  beamAp: 0.6,
  beamTicks: 10,
  beamRange: 40,
  beamDrain: 0.4,
  beamTrack: 150,
  beamCore: 0.16,
  beamHeat: 1500,
  // Nova lance: hold to charge (paying as it charges), release fires a beam that bursts where it lands.
  lanceDamage: 420,
  lanceAp: 0.7,
  lanceCharge: 1.4,
  lanceCooldown: 0.8,
  lanceRange: 70,
  lanceEnergy: 0.9,
  lanceMin: 0.25,
  lanceBlast: 6,
  lanceBlastDamage: 220,
  lanceShake: 0.35,
};
export type EnergyValues = typeof ENERGY_DEFAULTS;

export const ENERGY_GROUP = "Energy", LASER_GROUP = "Pulse laser", BEAM_GROUP = "Beam laser", LANCE_GROUP = "Nova lance";
/** Their groups in the Weapons topic. */
export const ENERGY_GROUPS = [ENERGY_GROUP, LASER_GROUP, BEAM_GROUP, LANCE_GROUP];

const E = ENERGY_GROUP, LA = LASER_GROUP, BE = BEAM_GROUP, LN = LANCE_GROUP;
export const ENERGY_PARAMS: Param[] = [
  { key: "energyCost", label: "Energy weapons spend energy", min: 0, max: 1, step: 1, group: E, tip: "1: every energy weapon spends the energy bars (the dash's); 0: free, for tuning damage" },
  { key: "energyLevel", label: "Sound level", min: 0, max: 1.5, step: 0.01, group: E },
  { key: "pulseDamage", label: "Damage per bolt", min: 1, max: 200, step: 1, group: LA },
  { key: "pulseAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: LA },
  { key: "pulseRate", label: "Bolts/s", min: 0.5, max: 20, step: 0.1, group: LA },
  { key: "pulseRange", label: "Range (m)", min: 10, max: 120, step: 1, group: LA },
  { key: "pulseEnergy", label: "Energy per bolt (bars)", min: 0, max: 0.5, step: 0.005, group: LA },
  { key: "pulseFlash", label: "Bolt shows for (s)", min: 0.02, max: 0.3, step: 0.01, group: LA },
  { key: "pulseWidth", label: "Bolt width (m)", min: 0.02, max: 0.4, step: 0.01, group: LA },
  { key: "beamDps", label: "Damage/s", min: 10, max: 800, step: 5, group: BE },
  { key: "beamAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: BE },
  { key: "beamTicks", label: "Burn ticks/s", min: 2, max: 30, step: 1, group: BE, tip: "The damage lands in this many ticks a second (fewer: bigger ticks, which armour stops less)" },
  { key: "beamRange", label: "Range (m)", min: 5, max: 100, step: 1, group: BE },
  { key: "beamDrain", label: "Energy drain (bars/s)", min: 0, max: 2, step: 0.01, group: BE },
  { key: "beamTrack", label: "Sweep speed (°/s)", min: 20, max: 720, step: 5, group: BE, tip: "How fast the beam swings after the aim (0 lag at the top)" },
  { key: "beamCore", label: "Beam width (m)", min: 0.04, max: 0.6, step: 0.01, group: BE },
  { key: "beamHeat", label: "Sand heat", min: 0, max: 2500, step: 50, group: BE, tip: "How hot the sand glows where the beam touches it (0: none)" },
  { key: "lanceDamage", label: "Hit damage (full charge)", min: 10, max: 1500, step: 5, group: LN },
  { key: "lanceAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: LN },
  { key: "lanceCharge", label: "Charge (s)", min: 0.2, max: 4, step: 0.05, group: LN },
  { key: "lanceCooldown", label: "Cooldown (s)", min: 0, max: 4, step: 0.05, group: LN },
  { key: "lanceRange", label: "Range (m)", min: 10, max: 120, step: 1, group: LN },
  { key: "lanceEnergy", label: "Energy at full charge (bars)", min: 0, max: 3, step: 0.05, group: LN, tip: "Paid as it charges; out of energy, the charge holds where it is" },
  { key: "lanceMin", label: "Least charge that fires", min: 0, max: 1, step: 0.01, group: LN, tip: "Let go below this and the charge fizzles (its energy is lost)" },
  { key: "lanceBlast", label: "Burst radius (m, full)", min: 0, max: 15, step: 0.1, group: LN },
  { key: "lanceBlastDamage", label: "Burst damage (full)", min: 0, max: 1000, step: 5, group: LN },
  { key: "lanceShake", label: "Camera shake", min: 0, max: 1, step: 0.01, group: LN },
];
