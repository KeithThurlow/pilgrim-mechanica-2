// Timed abilities from fitted items (Keith 2026-10-31: "some hulls or maybe backpacks coming with the ability to put
// down, on a timed ability, areas that can heal or regenerate"; co-op healers later). Pure: which abilities a mech
// has (a pack's on key 3, the pack mount's own key; a hull's on key 4), their cooldowns, and the useAbility command,
// which opens a heal zone (zones.ts) and, for the Field weld, braces the mech (rooted, taking less damage).
// Ownership: host (cooldowns, zones); the command comes from the player.
import type { Param } from "../core/tweaks";
import type { HealZones } from "./zones";

export type AbilityId = "beacon" | "nanite" | "weld";

export const ABILITY_DEFAULTS = {
  /** Owners heal themselves at this share of a zone's rate (allies at full). */
  healSelf: 0.6,
  /** Zones healing one target at once (the strongest count). */
  zoneStack: 2,
  beaconRate: 0.02, beaconTime: 10, beaconRadius: 8, beaconRange: 20, beaconCooldown: 30,
  naniteRate: 0.03, naniteTime: 6, naniteRadius: 6, naniteCooldown: 25,
  weldRate: 0.05, weldTime: 4, weldCut: 0.4, weldCooldown: 35,
};
export type AbilityValues = typeof ABILITY_DEFAULTS;

const G = "Abilities";
export const ABILITY_PARAMS: Param[] = [
  { key: "healSelf", label: "Self heal share", min: 0, max: 1, step: 0.05, group: G, tip: "A zone heals its owner at this share of its rate, allies at full (Field weld always full: it heals only you)" },
  { key: "zoneStack", label: "Zones stacking on one target", min: 1, max: 5, step: 1, group: G },
  { key: "beaconRate", label: "Repair beacon: hull/s (share)", min: 0, max: 0.2, step: 0.005, group: "Ability: Repair beacon" },
  { key: "beaconTime", label: "Repair beacon: lasts (s)", min: 1, max: 30, step: 0.5, group: "Ability: Repair beacon" },
  { key: "beaconRadius", label: "Repair beacon: radius (m)", min: 2, max: 20, step: 0.5, group: "Ability: Repair beacon" },
  { key: "beaconRange", label: "Repair beacon: throw (m)", min: 0, max: 50, step: 1, group: "Ability: Repair beacon", tip: "Lands at the cursor, at most this far" },
  { key: "beaconCooldown", label: "Repair beacon: cooldown (s)", min: 1, max: 120, step: 1, group: "Ability: Repair beacon" },
  { key: "naniteRate", label: "Nanite field: hull/s (share)", min: 0, max: 0.2, step: 0.005, group: "Ability: Nanite field" },
  { key: "naniteTime", label: "Nanite field: lasts (s)", min: 1, max: 30, step: 0.5, group: "Ability: Nanite field" },
  { key: "naniteRadius", label: "Nanite field: radius (m)", min: 2, max: 20, step: 0.5, group: "Ability: Nanite field" },
  { key: "naniteCooldown", label: "Nanite field: cooldown (s)", min: 1, max: 120, step: 1, group: "Ability: Nanite field" },
  { key: "weldRate", label: "Field weld: hull/s (share)", min: 0, max: 0.3, step: 0.005, group: "Ability: Field weld" },
  { key: "weldTime", label: "Field weld: braced (s)", min: 0.5, max: 15, step: 0.5, group: "Ability: Field weld", tip: "Rooted this long: no walking" },
  { key: "weldCut", label: "Field weld: damage cut", min: 0, max: 0.9, step: 0.05, group: "Ability: Field weld" },
  { key: "weldCooldown", label: "Field weld: cooldown (s)", min: 1, max: 120, step: 1, group: "Ability: Field weld" },
];
export const ABILITY_TOPIC = { id: "abilities", label: "Abilities", groups: [G, "Ability: Repair beacon", "Ability: Nanite field", "Ability: Field weld"] };

export const ABILITY_NAMES: Record<AbilityId, string> = { beacon: "Repair beacon", nanite: "Nanite field", weld: "Field weld" };

export interface AbilitySlot { key: 3 | 4; id: AbilityId; cooldown: number }

/** What the useAbility command needs: who, where, where the cursor is. */
export interface AbilityUser { id: string; team: number; x: number; z: number; alive: boolean }

export type AbilityRefusal = "none" | "cooling" | "dead";

export class Abilities {
  slots: AbilitySlot[] = [];
  /** Field weld: seconds braced left (the mech stands rooted and takes less damage). */
  braced = 0;

  constructor(private v: AbilityValues) {}

  /** Fit the loadout's abilities (cooldowns start ready). */
  fit(list: { key: 3 | 4; id: AbilityId }[]) {
    this.slots = list.map((a) => ({ ...a, cooldown: this.slots.find((s) => s.id === a.id)?.cooldown ?? 0 }));
  }

  slot(key: number) { return this.slots.find((s) => s.key === key) ?? null; }

  cooldownOf(id: AbilityId) { return this.v[`${id}Cooldown` as const]; }

  /** 0..1 ready (1: ready now). */
  ready(s: AbilitySlot) { return 1 - s.cooldown / Math.max(0.01, this.cooldownOf(s.id)); }

  /** The useAbility command: key 3 or 4, aimed at (ax, az) for a thrown one. */
  use(key: number, u: AbilityUser, ax: number, az: number, zones: HealZones): AbilityRefusal | null {
    const s = this.slot(key);
    if (!s) return "none";
    if (!u.alive) return "dead";
    if (s.cooldown > 0) return "cooling";
    const v = this.v;
    s.cooldown = this.cooldownOf(s.id);
    if (s.id === "beacon") {
      let dx = ax - u.x, dz = az - u.z;
      const d = Math.hypot(dx, dz);
      if (d > v.beaconRange) { dx *= v.beaconRange / d; dz *= v.beaconRange / d; }
      zones.add({ owner: u.id, team: u.team, x: u.x + dx, z: u.z + dz, radius: v.beaconRadius, rate: v.beaconRate, left: v.beaconTime, follow: false, selfOnly: false, kind: "beacon" });
    } else if (s.id === "nanite") {
      zones.add({ owner: u.id, team: u.team, x: u.x, z: u.z, radius: v.naniteRadius, rate: v.naniteRate, left: v.naniteTime, follow: true, selfOnly: false, kind: "nanite" });
    } else {
      this.braced = v.weldTime;
      zones.add({ owner: u.id, team: u.team, x: u.x, z: u.z, radius: 3, rate: v.weldRate, left: v.weldTime, follow: true, selfOnly: true, kind: "weld" });
    }
    return null;
  }

  step(dt: number) {
    for (const s of this.slots) s.cooldown = Math.max(0, s.cooldown - dt);
    this.braced = Math.max(0, this.braced - dt);
  }

  /** Damage taken × this (the weld's cut while braced). */
  get damageScale() { return this.braced > 0 ? 1 - this.v.weldCut : 1; }
}
