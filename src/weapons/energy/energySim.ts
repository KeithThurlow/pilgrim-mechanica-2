// Energy weapons' timing and energy (Keith 2026-11-02), pure: what each kind does with the trigger and the energy bars
// each step. The glue (src/weapons/energy/energyGuns.ts) turns its shots into rays, damage and effects.
//   laser  pulse laser: a bolt every 1/rate s while held, each paying its energy.
//   beam   beam laser: on while held and paid for (energy per second), its damage landing in `rate` ticks a second.
//   lance  nova lance: held, it charges over `charge` s, paying as it goes (out of energy the charge holds); released at
//          `minCharge` or more it fires at that power (0..1), less fizzles. Then `cooldown`.
//   sunder sunder beam: a press commits it (paying all its energy then; not enough and it won't start): it charges for
//          `charge` s (charge 0..1), then burns for `channel` s (on, ticks at `rate`), then `cooldown`. Letting go
//          changes nothing; a dash or the sprint cuts it off (the energy is lost).
//   plasma, orb, arc  fire like the pulse laser (a shot every 1/rate s while held, each paying its energy); the glue
//          flies the plasma bolt and the orb and runs the arc's jumps.
// A dash or the sprint drops any charge and stops the beam (drop()). Ownership: the player's own (their weapons).
import type { EnergyValues } from "./energyTuning";

export type EnergyClass = "laser" | "beam" | "lance" | "plasma" | "orb" | "arc" | "sunder";
export const ENERGY_CLASSES: readonly EnergyClass[] = ["laser", "beam", "lance", "plasma", "orb", "arc", "sunder"];
export const isEnergy = (cls: string | undefined | null): cls is EnergyClass => !!cls && (ENERGY_CLASSES as readonly string[]).includes(cls);

/** Where the energy comes from (the hull's reactor, src/mech/reactor.ts). use(n) spends n bars' worth or nothing. */
export interface EnergyPool { readonly energy: number; use(n: number): boolean }

export interface EnergyStats {
  cls: EnergyClass;
  /** Per bolt, per beam tick, or the lance's hit at full charge. */
  damage: number;
  ap: number;
  range: number;
  /** Bolts per second, or a beam's ticks per second. */
  rate: number;
  /** Energy (bars): per bolt; per second for a beam; at full charge for a lance; for a sunder beam all of it, at the press. */
  energy: number;
  /** Lance: charge time (s), cooldown (s), least charge that fires, burst radius (m) and damage at full. */
  charge: number;
  cooldown: number;
  minCharge: number;
  blast: number;
  blastDamage: number;
  /** Plasma and orb: speed (m/s) and radius (splash, burn). Orb: burn ticks/s and its pop. Arc: jumps, their reach,
   *  the damage kept per jump and how close to the aim it seeks its first target. */
  speed: number;
  radius: number;
  ticks: number;
  hops: number;
  hopRange: number;
  keep: number;
  seek: number;
  /** Sunder: how long the blast burns (s). It also uses charge, cooldown, speed (its sweep, °/s) and radius (the cut's
   *  half-width). */
  channel: number;
}

/** A weapon's numbers: its rolled stats (own) or the sliders. */
export function energyStats(cls: EnergyClass, own: Record<string, number> | null | undefined, v: EnergyValues): EnergyStats {
  const o = own ?? {};
  const base = { cls, charge: 0, cooldown: 0, minCharge: 0, blast: 0, blastDamage: 0, speed: 0, radius: 0, ticks: 0, hops: 0, hopRange: 0, keep: 0, seek: 0, channel: 0 };
  if (cls === "plasma") return { ...base, damage: o.damage ?? v.plasmaDamage, ap: o.ap ?? v.plasmaAp, range: o.range ?? v.plasmaRange, rate: o.fireRate ?? v.plasmaRate, energy: o.energyShot ?? v.plasmaEnergy,
    speed: o.shellSpeed ?? v.plasmaSpeed, radius: o.splash ?? v.plasmaSplash };
  // An orb's damage is per second to each body inside it.
  if (cls === "orb") return { ...base, damage: o.damage ?? v.orbDps, ap: o.ap ?? v.orbAp, range: o.range ?? v.orbRange, rate: o.fireRate ?? v.orbRate, energy: o.energyShot ?? v.orbEnergy,
    speed: o.shellSpeed ?? v.orbSpeed, radius: o.splash ?? v.orbRadius, ticks: v.orbTicks, blastDamage: o.blastDamage ?? v.orbPop };
  if (cls === "arc") return { ...base, damage: o.damage ?? v.arcDamage, ap: o.ap ?? v.arcAp, range: o.range ?? v.arcRange, rate: o.fireRate ?? v.arcRate, energy: o.energyShot ?? v.arcEnergy,
    hops: Math.round(o.hops ?? v.arcHops), hopRange: o.hopRange ?? v.arcHopRange, keep: v.arcKeep, seek: v.arcAim };
  if (cls === "sunder") {
    const ticks = o.fireRate ?? v.sunderTicks;
    return { ...base, damage: o.damage ?? v.sunderDps / Math.max(1, ticks), ap: o.ap ?? v.sunderAp, range: o.range ?? v.sunderRange, rate: ticks, energy: o.energyShot ?? v.sunderEnergy,
      charge: o.charge ?? v.sunderCharge, cooldown: o.cooldown ?? v.sunderCooldown, channel: o.channel ?? v.sunderChannel, speed: v.sunderTrack, radius: v.sunderWidth };
  }
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
  /** Sunder: 0 ready, 1 charging, 2 blasting; seconds into the phase. */
  phase: 0 | 1 | 2 = 0;
  t = 0;
  /** Sunder: the blast's time left as a share (1 at its start). */
  left = 0;
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
    if (st.cls === "laser" || st.cls === "plasma" || st.cls === "orb" || st.cls === "arc") {
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
    if (st.cls === "sunder") {
      if (this.phase === 0) {
        if (!held || this.cool > 0) return out;
        if (!pay(st.energy)) { this.dry = true; return out; }
        this.phase = 1; this.t = 0; this.charge = 0; this.holding = true;
      }
      this.t += dt;
      if (this.phase === 1) {
        const ct = Math.max(0.05, st.charge);
        this.charge = Math.min(1, this.t / ct);
        if (this.t < ct) return out;
        this.phase = 2; this.t -= ct; this.on = true; this.tick = 0; this.holding = false;
      }
      const ch = Math.max(0.05, st.channel);
      this.tick -= dt;
      const gap = 1 / Math.max(1, st.rate);
      while (this.tick <= 0) { out.shots++; this.tick += gap; }
      this.left = Math.max(0, 1 - this.t / ch);
      if (this.t >= ch) { this.phase = 0; this.on = false; this.charge = 0; this.left = 0; this.cool = st.cooldown; }
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
  drop() { this.charge = 0; this.holding = false; this.on = false; this.tick = 0; this.phase = 0; this.t = 0; this.left = 0; }
}
