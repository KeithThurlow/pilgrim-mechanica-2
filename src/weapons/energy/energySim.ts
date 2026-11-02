// Energy weapons' timing and energy (Keith 2026-11-02), pure: what each kind does with the trigger and the energy bars
// each step. The glue (src/weapons/energy/energyGuns.ts) turns its shots into rays, damage and effects.
//   laser  pulse laser: a bolt every 1/rate s while held, each paying its energy.
//   beam   beam laser: on while held and paid for (energy per second), its damage landing in `rate` ticks a second.
//   lance  nova lance: held, it charges over `charge` s, paying as it goes (out of energy the charge holds); released at
//          `minCharge` or more it fires at that power (0..1), less fizzles. Then `cooldown`.
// A dash or the sprint drops any charge and stops the beam (drop()). Ownership: the player's own (their weapons).
import type { EnergyValues } from "./energyTuning";

export type EnergyClass = "laser" | "beam" | "lance";
export const ENERGY_CLASSES: readonly EnergyClass[] = ["laser", "beam", "lance"];
export const isEnergy = (cls: string | undefined | null): cls is EnergyClass => !!cls && (ENERGY_CLASSES as readonly string[]).includes(cls);

/** Where the energy comes from (the mech's energy bars, src/mech/dash.ts). use(n) spends n bars' worth or nothing. */
export interface EnergyPool { readonly energy: number; use(n: number): boolean }

export interface EnergyStats {
  cls: EnergyClass;
  /** Per bolt, per beam tick, or the lance's hit at full charge. */
  damage: number;
  ap: number;
  range: number;
  /** Bolts per second, or a beam's ticks per second. */
  rate: number;
  /** Energy (bars): per bolt; per second for a beam; at full charge for a lance. */
  energy: number;
  /** Lance: charge time (s), cooldown (s), least charge that fires, burst radius (m) and damage at full. */
  charge: number;
  cooldown: number;
  minCharge: number;
  blast: number;
  blastDamage: number;
}

/** A weapon's numbers: its rolled stats (own) or the sliders. */
export function energyStats(cls: EnergyClass, own: Record<string, number> | null | undefined, v: EnergyValues): EnergyStats {
  const o = own ?? {};
  const base = { cls, charge: 0, cooldown: 0, minCharge: 0, blast: 0, blastDamage: 0 };
  if (cls === "laser") return { ...base, damage: o.damage ?? v.pulseDamage, ap: o.ap ?? v.pulseAp, range: o.range ?? v.pulseRange, rate: o.fireRate ?? v.pulseRate, energy: o.energyShot ?? v.pulseEnergy };
  if (cls === "beam") {
    const ticks = o.fireRate ?? v.beamTicks;
    return { ...base, damage: o.damage ?? v.beamDps / Math.max(1, ticks), ap: o.ap ?? v.beamAp, range: o.range ?? v.beamRange, rate: ticks, energy: o.energyDrain ?? v.beamDrain };
  }
  return { ...base, damage: o.damage ?? v.lanceDamage, ap: o.ap ?? v.lanceAp, range: o.range ?? v.lanceRange, rate: 0, energy: o.energyShot ?? v.lanceEnergy,
    charge: o.charge ?? v.lanceCharge, cooldown: o.cooldown ?? v.lanceCooldown, minCharge: v.lanceMin, blast: o.blast ?? v.lanceBlast, blastDamage: o.blastDamage ?? v.lanceBlastDamage };
}

/** What a step did: bolts or beam ticks fired, a lance's power fired (0: none), a charge that fizzled. */
export interface EnergyOut { shots: number; power: number; fizzled: boolean }

export class EnergySim {
  /** Seconds until it can fire again (bolts, the lance's cooldown). */
  cool = 0;
  /** Lance: the charge 0..1 and whether the trigger is charging it. */
  charge = 0;
  holding = false;
  /** Beam: firing now, and seconds to its next tick. */
  on = false;
  private tick = 0;
  /** The trigger is held but there's no energy to pay (the HUD says so). */
  dry = false;
  readonly out: EnergyOut = { shots: 0, power: 0, fizzled: false };

  /** One step: `held` the trigger, `free` energy costs nothing (the Energy slider at 0). */
  step(dt: number, held: boolean, st: EnergyStats, pool: EnergyPool, free = false): EnergyOut {
    const out = this.out;
    out.shots = 0; out.power = 0; out.fizzled = false;
    this.dry = false;
    this.cool = Math.max(-1, this.cool - dt);
    const pay = (n: number) => free || n <= 0 || pool.use(n);
    if (st.cls === "laser") {
      if (!held) { this.cool = Math.max(0, this.cool); return out; }
      const gap = 1 / Math.max(0.05, st.rate);
      while (this.cool <= 0) {
        if (!pay(st.energy)) { this.dry = true; this.cool = 0; break; }
        out.shots++;
        this.cool += gap;
      }
      return out;
    }
    if (st.cls === "beam") {
      if (!held) { this.on = false; this.tick = 0; return out; }
      if (!pay(st.energy * dt)) { this.on = false; this.dry = true; return out; }
      this.on = true;
      this.tick -= dt;
      const gap = 1 / Math.max(1, st.rate);
      while (this.tick <= 0) { out.shots++; this.tick += gap; }
      return out;
    }
    // Lance.
    if (held && this.cool <= 0) {
      this.holding = true;
      const dc = Math.min(1 - this.charge, dt / Math.max(0.05, st.charge));
      if (dc > 0) { if (pay(dc * st.energy)) this.charge += dc; else this.dry = true; }
      return out;
    }
    if (!held && this.holding) {
      this.holding = false;
      if (this.charge >= st.minCharge && this.charge > 0) { out.power = this.charge; this.cool = st.cooldown; }
      else out.fizzled = this.charge > 0;
      this.charge = 0;
    }
    return out;
  }

  /** A dash or the sprint: the charge is lost, the beam stops. */
  drop() { this.charge = 0; this.holding = false; this.on = false; this.tick = 0; }
}
