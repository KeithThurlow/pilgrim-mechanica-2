// The energy weapons as items (Keith 2026-11-02): hull weapons (Medium) that spend the energy bars instead of a
// magazine. Base values come from the energy sliders (src/weapons/energy/energyTuning.ts). Spread into BASES and
// STATS (src/items/bases.ts).
import type { Base, StatInfo, StatRange } from "../../items/bases";
import { ENERGY_DEFAULTS as E } from "./energyTuning";

const s = (base: number, spread: number): StatRange => ({ base, spread });

/** Stats only energy weapons carry. */
export const ENERGY_STATS: Record<string, StatInfo> = {
  energyShot: { label: "Energy per shot (bars)", better: -1, decimals: 3 },
  energyDrain: { label: "Energy drain (bars/s)", better: -1, decimals: 2 },
  blastDamage: { label: "Burst damage", better: 1, decimals: 0 },
};

const MAKERS = ["Novus-Lux", "Stratford-Aegis"];

export const ENERGY_BASES: Base[] = [
  {
    id: "laser-medium", name: "Pulse laser", kind: "weapon", size: "M", cls: "laser", tags: ["weapon", "energy", "laser"], weight: 1.9, makers: MAKERS, look: "rampart-railgun", drop: 0.9,
    stats: { damage: s(E.pulseDamage, 0.1), ap: s(E.pulseAp, 0), fireRate: s(E.pulseRate, 0.08), range: s(E.pulseRange, 0.06), energyShot: s(E.pulseEnergy, 0.12), arc: s(26, 0.08), track: s(11, 0.08) },
  },
  {
    // A beam's damage is per tick (fireRate ticks a second), so its DPS reads like any gun's.
    id: "beam-medium", name: "Beam laser", kind: "weapon", size: "M", cls: "beam", tags: ["weapon", "energy", "laser", "beam"], weight: 2.3, makers: MAKERS, look: "rampart-railgun", drop: 0.8,
    stats: { damage: s(E.beamDps / E.beamTicks, 0.1), ap: s(E.beamAp, 0), fireRate: s(E.beamTicks, 0), range: s(E.beamRange, 0.06), energyDrain: s(E.beamDrain, 0.12), arc: s(24, 0.08), track: s(10, 0.08) },
  },
  {
    id: "lance-medium", name: "Nova lance", kind: "weapon", size: "M", cls: "lance", tags: ["weapon", "energy", "charge"], weight: 2.8, makers: ["Novus-Lux"], look: "rampart-railgun", drop: 0.7,
    stats: { damage: s(E.lanceDamage, 0.1), ap: s(E.lanceAp, 0), charge: s(E.lanceCharge, 0.1), cooldown: s(E.lanceCooldown, 0.1), range: s(E.lanceRange, 0.06), energyShot: s(E.lanceEnergy, 0.12), blast: s(E.lanceBlast, 0.08), blastDamage: s(E.lanceBlastDamage, 0.1), arc: s(20, 0.08), track: s(8, 0.08) },
  },
];
