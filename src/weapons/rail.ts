// The rail cannon (docs/proposal-weapons.md; Keith 2026-10-26: a rail gun, not a laser). Hold the trigger to charge
// (a rising whine, the coils along the rails lighting in turn, a thin aim line on the sand and a meter at the
// reticle), release to fire one near-instant slug: a direct-fire sheet (src/game/sheet.ts) with a big penetration
// budget, so it punches through everything on its line (and a dune lip, not a dune), each body taking damage by the
// budget left. Released short of full it still fires at partial power (past the minimum); released within the grace
// window of full it counts as full. No assist: big damage for timing and a good line.
// Pure: the arsenal resolves the sheet through the battlefield and draws and plays the shot.
import type { SheetFire } from "../game/sheetFire";
import type { WeaponValues } from "./tuning";

/** What an item can change. */
/** What an item can change. `ap`: armour pierce 0..1 (src/game/armour.ts). */
export interface RailStats { damage: number; charge: number; cooldown: number; range: number; pen: number; ap?: number }

export class RailSim {
  /** 0..1 how full the charge is. */
  charge = 0;
  /** Seconds until it can charge again. */
  cooldown = 0;
  holding = false;

  constructor(public v: WeaponValues) {}

  /**
   * Advance with the trigger held or not. Returns the power it fires with on release (1 within the grace window of
   * full, else the charge, past the minimum), else null (still charging, idle, or a fizzle below the minimum).
   */
  update(dt: number, held: boolean, st: RailStats): number | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (held) {
      if (this.cooldown <= 0) { this.holding = true; this.charge = Math.min(1, this.charge + dt / Math.max(0.05, st.charge)); }
      return null;
    }
    if (!this.holding) return null;
    this.holding = false;
    const c = this.charge;
    this.charge = 0;
    if (c < this.v.railMinCharge) return null;
    this.cooldown = st.cooldown;
    return railPower(c, this.v);
  }
}

/** The power a release at charge c fires with: full inside the grace window, else c. */
export function railPower(c: number, v: WeaponValues): number {
  return c >= 1 - v.railGrace ? 1 : c;
}

/** Which coil (of n along the rails) is lit and how brightly at charge c: they light in turn from the breech. */
export function coilGlow(c: number, i: number, n: number): number {
  const step = 1 / Math.max(1, n);
  return Math.min(1, Math.max(0, (c - i * step) / step));
}

/** The rail's sheet: flat out to range, its floor from the mech's feet to the ground under the aim; the slug flies at
 *  its slug height over that floor, so sand above that costs penetration (not just sand above the tall sheet's top). */
export function railSheet(v: WeaponValues, st: RailStats, aim: { x: number; y: number; z: number } | null): SheetFire {
  return { half: v.railSheetHalf, height: v.railSheetHeight, line: v.railSlugHeight, pen: st.pen, aim, flat: true, knock: v.railKnock, pierce: st.ap ?? v.railAp };
}
