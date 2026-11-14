// Protocols (Keith 2026-10-25: they attach to items): socketed into an item's Protocol sockets, each a trade-off.
// Stat modifiers: "item" changes the host item's own rolled stat (if it has it); "mech" changes the resolved mech
// value (src/items/loadout.ts resolve keys, e.g. hull). Behaviour: `shot` fields go onto every round the gun fires
// (src/game/shots.ts: split, fire rate, area, ricochet, chain; scale step 4, 2026-10-26). A Protocol fits an item that
// carries any of its `fits` tags (and any of `also`, when given). Weapons carry traits (src/items/traits.ts, Keith
// 2026-11-04) that the fits name: what a Protocol needs from a weapon, not which weapon it is.
//
// Pricing (Keith 2026-10-31, docs/proposal-balance.md Answers): PoE2-style multipliers that stack MULTIPLICATIVELY
// with no cap (runaway builds are part of the fun). Each is worth about ×1.2-1.3 in its niche, with a downside: split
// is 3 rounds at 0.4 each (×1.2 total, more against crowds, ×0.4 on one target), fire rate ×2 at 0.6, a chain's hops
// paid for by the first hit.
// Munitions (Keith 2026-11-01): extra magazine use is deliberate, declared per Protocol as `cost`, never implied by
// its behaviour. Double shot (two rounds side by side) and Overclock (twice the rounds) cost 2 per shot, so the reload
// comes sooner; Splitter costs nothing extra (one round that splits); Caseless rounds cut it to 0.6. Costs multiply
// over sockets (src/weapons/magazine.ts). tools/balance-sheet.ts prints each one's multiplier against every target set (its niche is the best).
import type { Rarity } from "./rarity";
import type { ShotProtocols } from "../game/shots";

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
  /** Weapon traits (src/items/traits.ts) or item tags: it fits an item with any of these... */
  fits: string[];
  /** ...and, when given, any of these too (Overclock: rapid weapons that fire rounds). */
  also?: string[];
  rarity: Rarity;
  mods: StatMod[];
  /** What it does to the gun's rounds (combined over sockets: split, rate and area multiply; ricochet and chain add). */
  shot?: ShotProtocols;
  /** Extra munitions, declared (Keith 2026-11-01): magazine rounds each shot takes × (2: twice the munitions; below 1:
   * fewer). The only way a Protocol changes ammo use. Multiplies over sockets. */
  cost?: number;
  /** Energy weapons (later, Keith 2026-10-31): the energy each shot draws ×. A data hook: nothing reads it yet. */
  draw?: number;
  drop: number;
  /** Diminishing returns (2026-11-04, so nothing stacks far past the rest): each extra copy on one item does this share
   *  of the one before (0.5: the second half as much, the third a quarter). Unset: every copy in full. */
  stack?: number;
}

export const PROTOCOLS: Protocol[] = [
  // Damage: worth more the more armour there is (each hit keeps more over the armour), so its niche is heavies.
  { id: "overpressure", name: "Overpressure", text: "+10% damage (more through armour), 40% slower spin-up", fits: ["rounds", "shells", "rockets"], rarity: "rare", drop: 1,
    mods: [{ stat: "damage", mul: 1.1, scope: "item" }, { stat: "spinUp", mul: 1.4, scope: "item" }] },
  { id: "shredder", name: "Shredder", text: "Penetration +2, −10% damage", fits: ["rounds"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "pierce", add: 2, scope: "item" }, { stat: "damage", mul: 0.9, scope: "item" }] },
  { id: "choke", name: "Choke", text: "−40% spread, −15% rounds/s", fits: ["spread"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "spread", mul: 0.6, scope: "item" }, { stat: "fireRate", mul: 0.85, scope: "item" }] },
  { id: "hairTrigger", name: "Hair trigger", text: "Half the spin-up, −15% range", fits: ["spin"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "spinUp", mul: 0.5, scope: "item" }, { stat: "range", mul: 0.85, scope: "item" }] },
  { id: "coolant", name: "Coolant loop", text: "Dash recharges 30% faster, −10% hull", fits: ["power"], rarity: "rare", drop: 1,
    mods: [{ stat: "dashRecharge", mul: 0.7, scope: "item" }, { stat: "hull", mul: 0.9, scope: "mech" }] },
  { id: "servoBoost", name: "Servo boost", text: "+8% walk and sprint, carries 20% less", fits: ["legs"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "walkSpeed", mul: 1.05, scope: "item" }, { stat: "sprintSpeed", mul: 1.05, scope: "item" }, { stat: "carry", mul: 0.8, scope: "item" }] },
  { id: "plating", name: "Extra plating", text: "+20% hull, 15% slower torso", fits: ["hull"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "hull", mul: 1.2, scope: "item" }, { stat: "torsoTurnRate", mul: 0.85, scope: "item" }] },
  // Behaviour Protocols on the rounds (src/game/shots.ts; rockets in src/weapons/arsenal.ts), each with its price.
  { id: "splitter", name: "Splitter", text: "Each shot splits into 3 at 40% damage (×1.2, more on crowds); no extra munitions", fits: ["split"], rarity: "rare", drop: 0.7,
    mods: [{ stat: "damage", mul: 0.4, scope: "item" }, { stat: "blastDamage", mul: 0.4, scope: "item" }], shot: { split: 3 } },
  { id: "overclock", name: "Overclock", text: "Twice the rounds at 60% damage, +40% spread; uses twice the munitions", fits: ["rapid"], also: ["rounds"], rarity: "rare", drop: 0.7,
    mods: [{ stat: "damage", mul: 0.6, scope: "item" }, { stat: "spread", mul: 1.4, scope: "item" }], shot: { rate: 2 }, cost: 2 },
  { id: "doubleShot", name: "Double shot", text: "Fires two rounds side by side at 70% damage; uses twice the munitions", fits: ["rapid"], also: ["rounds"], rarity: "rare", drop: 0.7,
    mods: [{ stat: "damage", mul: 0.7, scope: "item" }], shot: { multi: 2 }, cost: 2 },
  { id: "wideBore", name: "Wide bore", text: "Rounds splash 1.6× wider, −12% damage, −15% range", fits: ["splash"], also: ["rounds", "bolt"], rarity: "uncommon", drop: 0.9, stack: 0.35,
    mods: [{ stat: "damage", mul: 0.88, scope: "item" }, { stat: "range", mul: 0.85, scope: "item" }], shot: { area: 1.6 } },
  { id: "ricochet", name: "Ricochet rounds", text: "Rounds bounce once off what they hit (half damage), −15% range", fits: ["ricochet"], rarity: "uncommon", drop: 0.9,
    mods: [{ stat: "range", mul: 0.85, scope: "item" }], shot: { ricochet: 1 } },
  { id: "arcLink", name: "Arc link", text: "Hits jump on to 2 more enemies (60%, then 36%), −15% damage", fits: ["chain"], rarity: "epic", drop: 0.4,
    mods: [{ stat: "damage", mul: 0.85, scope: "item" }], shot: { chain: 2 } },
  // Piercing (Keith 2026-11-04: "more armour negation, the more piercing there is"): the pierce trait. Armour negation
  // is the `ap` stat, the share of armour a hit ignores (src/game/armour.ts); the cadence price lands on whichever of
  // fireRate, charge or windup the weapon has.
  { id: "hardenedCore", name: "Hardened core", text: "Ignores 10% more armour, +15% damage, 10% slower to fire, charge or swing", fits: ["pierce"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "ap", add: 0.1, scope: "item" }, { stat: "damage", mul: 1.15, scope: "item" }, { stat: "fireRate", mul: 0.9, scope: "item" }, { stat: "charge", mul: 1.1, scope: "item" }, { stat: "windup", mul: 1.1, scope: "item" }] },
  { id: "shatterPoint", name: "Shatter point", text: "Ignores 20% more armour, −12% damage", fits: ["pierce"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "ap", add: 0.2, scope: "item" }, { stat: "damage", mul: 0.88, scope: "item" }] },
  // Melee (Keith 2026-11-04): swords' own stats (src/weapons/sword.ts).
  { id: "honedEdge", name: "Honed edge", text: "+15% cut damage, 15% slower recovery", fits: ["melee"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "damage", mul: 1.15, scope: "item" }, { stat: "recover", mul: 1.15, scope: "item" }] },
  { id: "longHaft", name: "Long haft", text: "+20% reach, 15% slower wind-up", fits: ["melee"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "reach", mul: 1.2, scope: "item" }, { stat: "windup", mul: 1.15, scope: "item" }] },
  { id: "quickHands", name: "Quick hands", text: "25% faster wind-up and recovery, −15% damage", fits: ["melee"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "windup", mul: 0.75, scope: "item" }, { stat: "recover", mul: 0.75, scope: "item" }, { stat: "damage", mul: 0.85, scope: "item" }] },
  { id: "cleaver", name: "Cleaver", text: "Cuts through 50% more bodies, −10% damage", fits: ["melee"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "cleave", mul: 1.5, scope: "item" }, { stat: "damage", mul: 0.9, scope: "item" }] },
  // Energy (Keith 2026-11-04): bolts and beams on the reactor, charged shots, light that bends.
  { id: "efficiencyCoil", name: "Efficiency coil", text: "Draws 25% less energy, −10% damage", fits: ["bolt", "beam"], rarity: "uncommon", drop: 1, stack: 0.5,
    mods: [{ stat: "energyShot", mul: 0.75, scope: "item" }, { stat: "energyDrain", mul: 0.75, scope: "item" }, { stat: "damage", mul: 0.9, scope: "item" }] },
  { id: "focusLens", name: "Focusing lens", text: "+25% range, +10% damage, draws 20% more energy", fits: ["bolt", "beam"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "range", mul: 1.25, scope: "item" }, { stat: "damage", mul: 1.1, scope: "item" }, { stat: "energyShot", mul: 1.2, scope: "item" }, { stat: "energyDrain", mul: 1.2, scope: "item" }] },
  { id: "overcharge", name: "Overcharge", text: "Charges 30% faster, 20% longer cooldown, draws 25% more energy", fits: ["charged"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "charge", mul: 0.7, scope: "item" }, { stat: "cooldown", mul: 1.2, scope: "item" }, { stat: "energyShot", mul: 1.25, scope: "item" }] },
  { id: "prism", name: "Prism", text: "Hits reflect on to the nearest enemy (half damage), −10% damage", fits: ["reflect"], rarity: "epic", drop: 0.5,
    mods: [{ stat: "damage", mul: 0.9, scope: "item" }], shot: { ricochet: 1 } },
  // Projectiles (Keith 2026-11-04: "some energy weapons can be considered projectiles"): shots with a flight time.
  { id: "accelerator", name: "Accelerator", text: "Shots fly 40% faster (easier to land on movers), −10% damage", fits: ["projectile"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "shellSpeed", mul: 1.4, scope: "item" }, { stat: "damage", mul: 0.9, scope: "item" }] },
  // Magazines (Keith 2026-10-31): reload speed and cost are stats to build round.
  { id: "quickLoader", name: "Quick loader", text: "Reloads 30% faster, −15% magazine", fits: ["magazine"], rarity: "uncommon", drop: 1,
    mods: [{ stat: "reload", mul: 0.7, scope: "item" }, { stat: "magazine", mul: 0.85, scope: "item" }] },
  { id: "caseless", name: "Caseless rounds", text: "Each round takes 40% less of the magazine, −15% range, +20% spread", fits: ["cased"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "range", mul: 0.85, scope: "item" }, { stat: "spread", mul: 1.2, scope: "item" }], cost: 0.6 },
  { id: "extendedFeed", name: "Extended feed", text: "+50% magazine bonus, −3% walk speed", fits: ["ammo"], rarity: "rare", drop: 0.8,
    mods: [{ stat: "magBonus", mul: 1.5, scope: "item" }, { stat: "ammoPerGun", mul: 1.5, scope: "item" }, { stat: "walkSpeed", mul: 0.97, scope: "mech" }] },
];

export const PROTOCOL_BY_ID: Record<string, Protocol> = Object.fromEntries(PROTOCOLS.map((p) => [p.id, p]));

/** Each socketed Protocol's weight on its item: 1, or `stack` to the power of the copies before it. */
export function stackWeights(socketed: readonly { base: string }[]): number[] {
  const seen: Record<string, number> = {};
  return socketed.map((pi) => {
    const n = seen[pi.base] ?? 0, st = PROTOCOL_BY_ID[pi.base]?.stack;
    seen[pi.base] = n + 1;
    return st === undefined ? 1 : Math.pow(st, n);
  });
}

/** A mod at a weight: its change from nothing scaled (mul 0.75 at 0.5 is 0.875; add 0.2 is 0.1). */
export const weighMod = (m: StatMod, w: number): StatMod =>
  w === 1 ? m : { ...m, mul: m.mul === undefined ? undefined : 1 + (m.mul - 1) * w, add: m.add === undefined ? undefined : m.add * w };

/** What an item's socketed Protocols do to its rounds (undefined: nothing). Split, rate, multi and area multiply
 *  (area at its stack weight). */
export function shotProtocolsOf(socketed: readonly { base: string }[]): ShotProtocols | undefined {
  let p: ShotProtocols | undefined;
  const ws = stackWeights(socketed);
  for (let i = 0; i < socketed.length; i++) {
    const s = PROTOCOL_BY_ID[socketed[i].base]?.shot, w = ws[i];
    if (!s) continue;
    p ??= {};
    if (s.split) p.split = (p.split ?? 1) * s.split;
    if (s.rate) p.rate = (p.rate ?? 1) * s.rate;
    if (s.multi) p.multi = (p.multi ?? 1) * s.multi;
    if (s.area) p.area = (p.area ?? 1) * (1 + (s.area - 1) * w);
    if (s.ricochet) p.ricochet = (p.ricochet ?? 0) + s.ricochet;
    if (s.chain) p.chain = (p.chain ?? 0) + s.chain;
  }
  return p;
}

/** Magazine rounds per shot (1 plain; the Protocols' declared costs multiply). */
export function shotCostOf(socketed: readonly { base: string }[]): number {
  let k = 1;
  for (const pi of socketed) k *= PROTOCOL_BY_ID[pi.base]?.cost ?? 1;
  return k;
}

/** Does this Protocol fit an item with these tags? */
export const protocolFits = (p: Protocol, tags: readonly string[]) => p.fits.some((t) => tags.includes(t)) && (!p.also || p.also.some((t) => tags.includes(t)));
