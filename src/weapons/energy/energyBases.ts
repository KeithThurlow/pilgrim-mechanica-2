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
  hops: { label: "Arc jumps", better: 1, decimals: 0, whole: true },
  hopRange: { label: "Jump reach (m)", better: 1, decimals: 1 },
  channel: { label: "Blast lasts (s)", better: 1, decimals: 1 },
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
  {
    id: "plasma-medium", name: "Plasma cannon", kind: "weapon", size: "M", cls: "plasma", tags: ["weapon", "energy", "plasma"], weight: 2.5, makers: ["Suzaku", "Novus-Lux"], look: "rampart-railgun", drop: 0.8,
    stats: { damage: s(E.plasmaDamage, 0.1), ap: s(E.plasmaAp, 0), fireRate: s(E.plasmaRate, 0.08), range: s(E.plasmaRange, 0.06), shellSpeed: s(E.plasmaSpeed, 0.08), splash: s(E.plasmaSplash, 0.1), energyShot: s(E.plasmaEnergy, 0.12), arc: s(24, 0.08), track: s(10, 0.08) },
  },
  {
    // An orb's damage is per second to each body inside it (its DPS readout: one body, one orb at a time).
    id: "orb-medium", name: "Particle orb projector", kind: "weapon", size: "M", cls: "orb", tags: ["weapon", "energy", "plasma", "orb"], weight: 2.9, makers: ["Novus-Lux"], look: "rampart-railgun", drop: 0.6,
    stats: { damage: s(E.orbDps, 0.1), ap: s(E.orbAp, 0), fireRate: s(E.orbRate, 0.08), range: s(E.orbRange, 0.06), shellSpeed: s(E.orbSpeed, 0.08), splash: s(E.orbRadius, 0.08), blastDamage: s(E.orbPop, 0.1), energyShot: s(E.orbEnergy, 0.12), arc: s(20, 0.08), track: s(8, 0.08) },
  },
  {
    id: "arc-medium", name: "Arc caster", kind: "weapon", size: "M", cls: "arc", tags: ["weapon", "energy", "arc", "chain"], weight: 2.1, makers: ["Stratford-Aegis", "Novus-Lux"], look: "rampart-railgun", drop: 0.8,
    stats: { damage: s(E.arcDamage, 0.1), ap: s(E.arcAp, 0), fireRate: s(E.arcRate, 0.08), range: s(E.arcRange, 0.06), hops: s(E.arcHops, 0.25), hopRange: s(E.arcHopRange, 0.1), energyShot: s(E.arcEnergy, 0.12), arc: s(30, 0.08), track: s(12, 0.08) },
  },
  {
    // Charge, then a heavy beam for its channel time (Keith 2026-11-02: like the walkers' beam). Damage per tick, to every
    // body under the beam.
    id: "sunder-medium", name: "Sunder beam", kind: "weapon", size: "M", cls: "sunder", tags: ["weapon", "energy", "beam", "charge"], weight: 3.4, makers: ["Novus-Lux"], look: "rampart-railgun", drop: 0.5,
    stats: { damage: s(E.sunderDps / E.sunderTicks, 0.1), ap: s(E.sunderAp, 0), fireRate: s(E.sunderTicks, 0), range: s(E.sunderRange, 0.06), charge: s(E.sunderCharge, 0.1), channel: s(E.sunderChannel, 0.1), cooldown: s(E.sunderCooldown, 0.1), energyShot: s(E.sunderEnergy, 0.1), arc: s(18, 0.08), track: s(7, 0.08) },
  },
];
