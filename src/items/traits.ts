// Weapon traits (Keith 2026-11-04: "logically adding in traits, so like tags, so that protocols can be fitted to
// them"). Pure data. A trait says what a weapon is or does; a Protocol fits a weapon that has any of the traits in its
// `fits` (src/items/protocols.ts). Traits are joined onto each base's tags (src/items/bases.ts), so items, the bay and
// the balance model all read them the same way. Claude's set (2026-11-04, open for Keith):
//   How it delivers (one each): rounds, shells, rockets, slug, bolt, beam, blade.
//   What it does: rapid (many light hits a second), spin (spins up), spread (fires in a cone), splash (its hits burst),
//   split (one shot that can split), chain (hits can jump to the next enemy), pierce (goes deep through bodies),
//   ricochet (solid rounds that can bounce), magazine (reloads a magazine or clip), cased (cased ammunition), melee.
// Every Protocol fit on a trait must work in the sim for every weapon with that trait (tools/traits-check.ts).

export interface Trait { id: string; name: string; text: string }

export const TRAITS: Trait[] = [
  { id: "rounds", name: "Rounds", text: "Fires solid rounds" },
  { id: "shells", name: "Shells", text: "Fires explosive shells" },
  { id: "rockets", name: "Rockets", text: "Fires rockets" },
  { id: "slug", name: "Slug", text: "Fires a charged slug" },
  { id: "bolt", name: "Bolt", text: "Fires energy bolts" },
  { id: "beam", name: "Beam", text: "A continuous beam" },
  { id: "blade", name: "Blade", text: "A blade" },
  { id: "rapid", name: "Rapid", text: "Many light hits a second" },
  { id: "spin", name: "Spin-up", text: "Spins up before it fires" },
  { id: "spread", name: "Spread", text: "Fires in a cone" },
  { id: "splash", name: "Splash", text: "Its hits burst round them" },
  { id: "split", name: "Splittable", text: "One shot that can split into several" },
  { id: "chain", name: "Conductive", text: "Hits can jump on to the next enemy" },
  { id: "pierce", name: "Piercing", text: "Goes deep through bodies and armour" },
  { id: "ricochet", name: "Ricochet", text: "Solid rounds that can bounce" },
  { id: "magazine", name: "Magazine", text: "Reloads a magazine or clip" },
  { id: "cased", name: "Cased", text: "Cased ammunition" },
  { id: "melee", name: "Melee", text: "Hits what it reaches" },
];
export const TRAIT_BY_ID: Record<string, Trait> = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

const MG = ["rounds", "rapid", "spin", "spread", "splash", "split", "chain", "ricochet", "magazine", "cased"];
const SWORD = ["blade", "melee"];

/** Each weapon's traits by base id. */
export const WEAPON_TRAITS: Record<string, string[]> = {
  "mg-light": MG, "mg-medium": MG, "mg-heavy": MG,
  "smg-light": ["rounds", "rapid", "spread", "split", "ricochet", "magazine", "cased"],
  "rifle-light": ["rounds", "spread", "split", "ricochet", "magazine", "cased"],
  "shotgun-light": ["rounds", "spread", "magazine", "cased"],
  "sniper-medium": ["rounds", "pierce", "ricochet", "magazine", "cased"],
  "flak-medium": ["rounds", "spread", "splash", "magazine", "cased"],
  "cannon-medium": ["shells", "splash", "magazine", "cased"],
  "ac-medium": ["shells", "spin", "splash", "magazine", "cased"],
  "rail-light": ["slug", "pierce"], "rail-medium": ["slug", "pierce"],
  "rpg-light": ["rockets", "splash", "split", "magazine"], "rpg-medium": ["rockets", "splash", "split", "magazine"],
  "sh-rpg": ["rockets", "splash", "split", "magazine"], "sh-missiles": ["rockets", "splash"],
  "sh-mortar": ["shells", "splash"], "sh-linemortar": ["shells", "splash"],
  "laser-medium": ["bolt", "rapid"], "beam-medium": ["beam"],
  // Keith 2026-11-04: the lance takes area and split Protocols but not chain; the arc caster and the orb chain.
  "lance-medium": ["bolt", "splash", "split", "pierce"],
  "plasma-medium": ["bolt", "splash"],
  "orb-medium": ["bolt", "splash", "chain"],
  "arc-medium": ["bolt", "chain"],
  "sunder-medium": ["beam", "pierce"],
  "sword-light": SWORD, "sword-heavy": [...SWORD, "pierce"], "sword-short": [...SWORD, "rapid"],
};

/** A weapon's traits (none for parts). */
export const traitsOf = (base: string): string[] => WEAPON_TRAITS[base] ?? [];
