// Heal zones (Keith 2026-10-31: "put down areas that can heal or regenerate", co-op healers later). Pure: a list of
// circles on the ground, each repairing a share of every friendly target's max health per second while it lasts.
// A zone can follow its owner (the Nanite field) or be self-only (the Siege's Field weld). Owners heal themselves at
// a self share (healSelf) and allies at full, so a medic is worth running solo and better with friends. At most
// zoneStack zones heal one target at once (the strongest), so two healers don't make anyone immortal.
// Ownership: host (zones, who they heal, by how much); drawing is cosmetic (zonesDraw.ts).

export interface HealTarget {
  /** Stable id (the mech's or pilot's), so peers agree on who is healed. */
  id: string;
  team: number;
  x: number; z: number;
  alive: boolean;
  max: number;
  /** Repair: returns what it added (capped at the max). */
  heal(amount: number): number;
}

export interface Zone {
  id: number;
  /** The id of the target who placed it. */
  owner: string;
  team: number;
  x: number; z: number;
  radius: number;
  /** Share of a target's max health per second. */
  rate: number;
  /** Seconds left. */
  left: number;
  /** Seconds it lasts in all (for the drawing's fade). */
  life: number;
  /** Moves with its owner each step. */
  follow: boolean;
  /** Heals only its owner, at full rate. */
  selfOnly: boolean;
  /** Which ability made it (for the drawing). */
  kind: string;
}

export interface ZoneValues { healSelf: number; zoneStack: number }

export type ZoneEvent = { kind: "zoneOpened"; zone: number; owner: string } | { kind: "zoneClosed"; zone: number } | { kind: "healed"; target: string; amount: number };

export class HealZones {
  readonly zones: Zone[] = [];
  readonly events: ZoneEvent[] = [];
  /** Health added per target in the last step (for HUD flashes). */
  readonly lastHeal = new Map<string, number>();
  private nextId = 1;
  private rates: number[] = [];

  constructor(private v: ZoneValues) {}

  add(z: Omit<Zone, "id" | "life">): Zone {
    const zone: Zone = { ...z, id: this.nextId++, life: z.left };
    this.zones.push(zone);
    this.events.push({ kind: "zoneOpened", zone: zone.id, owner: zone.owner });
    return zone;
  }

  /** Advance: follow owners, heal everyone inside, close zones that ran out. */
  step(dt: number, targets: readonly HealTarget[]) {
    this.lastHeal.clear();
    for (const z of this.zones) {
      if (!z.follow) continue;
      const o = targets.find((t) => t.id === z.owner);
      if (o) { z.x = o.x; z.z = o.z; }
    }
    for (const t of targets) {
      if (!t.alive) continue;
      const rates = this.rates;
      rates.length = 0;
      for (const z of this.zones) {
        if (z.left <= 0 || z.team !== t.team) continue;
        if (z.selfOnly ? z.owner !== t.id : Math.hypot(t.x - z.x, t.z - z.z) > z.radius) continue;
        rates.push(z.selfOnly ? z.rate : z.owner === t.id ? z.rate * this.v.healSelf : z.rate);
      }
      if (!rates.length) continue;
      rates.sort((a, b) => b - a);
      let r = 0;
      for (let i = 0; i < Math.min(rates.length, Math.max(1, Math.round(this.v.zoneStack))); i++) r += rates[i];
      const add = t.heal(r * t.max * dt);
      if (add > 0) { this.lastHeal.set(t.id, add); this.events.push({ kind: "healed", target: t.id, amount: add }); }
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.left -= dt;
      if (z.left <= 0) { this.zones.splice(i, 1); this.events.push({ kind: "zoneClosed", zone: z.id }); }
    }
    // Keep the event list from growing when nobody drains it (heals are frequent).
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }

  /** Everything closed (a restart). */
  clear() { this.zones.length = 0; }
}
