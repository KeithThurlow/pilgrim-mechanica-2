// Protocols (Keith 2026-10-25: they attach to items): socketed into an item's Protocol sockets, each a trade-off.
// Data only for now: stat modifiers. "item" changes the host item's own rolled stat (if it has it); "mech" changes
// the resolved mech value (src/items/loadout.ts resolve keys, e.g. hull). Behaviour changes (ricochet, bouncing
// rounds) come with the guns that need them. A Protocol fits an item that carries any of its `fits` tags.
import type { Rarity } from "./rarity";

export interface StatMod {
  stat: string;
  /** Multiply by this (applied before add). */
  mul?: number;
  add?: number;
  scope: "item" | "mech";
}

export interface Protocol {
  id: string;
  name: string;
  /** What it does, for the item card. */
  text: string;
  fits: string[];
  rarity: Rarity;
  mods: StatMod[];
  drop: number;
}

export const PROTOCOLS: Protocol[] = [
  { id: "overpressure", name: "Overpressure", text: "+35% damage, 40% slower spin-up", fits: ["ballistic"], rarity: "rare", drop: 1,
    mods: [{ stat: "damage", mul: 1.35, scope: "item" }, { stat: "spinUp", mul: 1.4, scope: "item" }] },
  { id: "shredder", name: "Shredder", text: "Pierce +2, −15% damage", fits: ["ballistic"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "pierce", add: 2, scope: "item" }, { stat: "damage", mul: 0.85, scope: "item" }] },
  { id: "choke", name: "Choke", text: "−40% spread, −15% rounds/s", fits: ["minigun"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "spread", mul: 0.6, scope: "item" }, { stat: "fireRate", mul: 0.85, scope: "item" }] },
  { id: "hairTrigger", name: "Hair trigger", text: "Half the spin-up, −15% range", fits: ["minigun"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "spinUp", mul: 0.5, scope: "item" }, { stat: "range", mul: 0.85, scope: "item" }] },
  { id: "coolant", name: "Coolant loop", text: "Dash recharges 30% faster, −10% hull", fits: ["power"], rarity: "rare", drop: 1,
    mods: [{ stat: "dashRecharge", mul: 0.7, scope: "item" }, { stat: "hull", mul: 0.9, scope: "mech" }] },
  { id: "servoBoost", name: "Servo boost", text: "+8% walk and sprint, carries 20% less", fits: ["legs"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "walkSpeed", mul: 1.08, scope: "item" }, { stat: "sprintSpeed", mul: 1.08, scope: "item" }, { stat: "carry", mul: 0.8, scope: "item" }] },
  { id: "plating", name: "Extra plating", text: "+20% hull, 15% slower torso", fits: ["hull"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "hull", mul: 1.2, scope: "item" }, { stat: "torsoTurnRate", mul: 0.85, scope: "item" }] },
  { id: "extendedFeed", name: "Extended feed", text: "+50% rounds per gun, −3% walk speed", fits: ["ammo"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "ammoPerGun", mul: 1.5, scope: "item" }, { stat: "walkSpeed", mul: 0.97, scope: "mech" }] },
];

export const PROTOCOL_BY_ID: Record<string, Protocol> = Object.fromEntries(PROTOCOLS.map((p) => [p.id, p]));

/** Does this Protocol fit an item with these tags? */
export const protocolFits = (p: Protocol, tags: readonly string[]) => p.fits.some((t) => tags.includes(t));
