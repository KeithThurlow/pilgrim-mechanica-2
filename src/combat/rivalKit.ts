// A rival mech's kit (pure): a random loadout rolled from the item tables through the same fit rules as the bay
// (Keith 2026-10-29: "that mech spawns with random weapons"), and what a resolved loadout carries as the AI sees it:
// each weapon on its control (left or right trigger, keys 1-3), its kind, range, projectile speed, blast and rate,
// read from the item's own rolled stats or the weapon sliders exactly as the arsenal reads them (src/weapons/arsenal.ts),
// and the range the rival likes to fight at. Ownership: host (the rival's loadout is loot later: factions step 5).
import { BASES, BASE_BY_ID, type Base } from "../items/bases";
import { rng, rollItem, type LootValues } from "../items/generate";
import { RARITIES, type Rarity } from "../items/rarity";
import { emptyLoadout, fit, fitProblem, hullMount, MOUNTS, SIDES, SLOTS, type Loadout, type Resolved, type SlotId } from "../items/loadout";
import { itemName } from "../items/bayState";
import type { WeaponValues } from "../weapons/tuning";

export type KitKind = "minigun" | "rail" | "autocannon" | "rpg" | "mortar" | "linemortar" | "missiles" | "shrpg";
/** Which control fires it: a trigger side (0 left, 1 right) or a shoulder key (1-3). */
export type KitControl = { trigger: 0 | 1 } | { key: 1 | 2 | 3 };

export interface KitWeapon {
  ctl: KitControl;
  kind: KitKind;
  /** Reach (m), and the closest it can fire at (the line mortar's strip). */
  range: number;
  minRange: number;
  /** Projectile speed (m/s; Infinity: rounds, rails). */
  speed: number;
  /** Blast radius (m; 0: none) and damage per round / shell / slug. */
  blast: number;
  damage: number;
  /** Rounds per second (guns), rounds per volley (line mortar, missiles). */
  rate: number;
  count: number;
  /** Seconds between shots (rail, rockets, shoulders), charge time (rail), spin-up (miniguns). */
  cooldown: number;
  charge: number;
  spinUp: number;
  /** Spread (degrees, guns). */
  spread: number;
  /** Mortar flight (s). */
  flight: number;
  /** The range this weapon likes to be fired from (m). */
  ideal: number;
}

/** The range each kind likes (m), capped at 80% of its reach. */
export const IDEAL: Record<KitKind, number> = { minigun: 32, rail: 50, autocannon: 40, rpg: 34, shrpg: 36, mortar: 55, linemortar: 38, missiles: 42 };

/** What a resolved loadout carries, as the AI and the headless duel see it. */
export function kitOf(r: Resolved, v: WeaponValues): KitWeapon[] {
  const out: KitWeapon[] = [];
  const w = (ctl: KitControl, kind: KitKind, o: Partial<KitWeapon>): KitWeapon => {
    const range = o.range ?? 60;
    return { ctl, kind, range, minRange: 0, speed: Infinity, blast: 0, damage: 0, rate: 1, count: 1, cooldown: 0, charge: 0, spinUp: 0, spread: 0, flight: 0, ...o, ideal: Math.min(IDEAL[kind], range * 0.8) };
  };
  ([[0, r.guns.left], [1, r.guns.right]] as const).forEach(([i, g]) => {
    if (!g) return;
    const ctl = { trigger: i } as KitControl, o = g.own;
    if (!g.cls || g.cls === "minigun") out.push(w(ctl, "minigun", { range: g.range, damage: g.damage, rate: g.fireRate, spinUp: g.spinUp, spread: g.spread }));
    else if (g.cls === "rail") {
      const L = !!g.light;
      out.push(w(ctl, "rail", o ? { range: o.range, damage: o.damage, charge: o.charge, cooldown: o.cooldown }
        : { range: v.railRange * (L ? 0.85 : 1), damage: v.railDamage * (L ? v.railLightDamage : 1), charge: v.railCharge * (L ? v.railLightCharge : 1), cooldown: v.railCooldown }));
    } else if (g.cls === "autocannon") {
      out.push(w(ctl, "autocannon", o ? { range: o.range, damage: o.damage, speed: o.shellSpeed, blast: o.splash, rate: g.fireRate, spread: o.spread, spinUp: g.spinUp }
        : { range: v.acRange, damage: v.acDamage, speed: v.acSpeed, blast: v.acSplash, rate: v.acRate, spread: v.acSpread, spinUp: g.spinUp }));
    } else if (g.cls === "rpg") {
      out.push(w(ctl, "rpg", o ? { range: v.rpgRange, damage: o.damage, blast: o.blast, speed: o.shellSpeed, cooldown: o.cooldown }
        : { range: v.rpgRange, damage: v.rpgDamage, blast: v.rpgBlast, speed: v.rpgSpeed, cooldown: v.rpgCooldown }));
    }
  });
  for (const s of r.shoulders) {
    if (s.family !== "launcher") continue;
    const ctl = { key: s.key } as KitControl, o = s.own;
    if (s.weapon === "mortar") out.push(w(ctl, "mortar", { range: v.mortarMaxRange, minRange: 10, damage: o?.damage ?? v.mortarDamage, blast: o?.blast ?? v.mortarBlast, cooldown: o?.cooldown ?? v.mortarCooldown, flight: v.mortarFlight, count: v.mortarShells }));
    else if (s.weapon === "linemortar") out.push(w(ctl, "linemortar", { range: v.salvoMaxRange, minRange: v.salvoMinRange, damage: o?.damage ?? v.salvoDamage, blast: o?.blast ?? v.salvoBlast, cooldown: o?.cooldown ?? v.salvoCooldown, count: o?.shells ?? v.salvoRockets, speed: v.salvoSpeed }));
    else if (s.weapon === "missiles") out.push(w(ctl, "missiles", { range: v.rpgRange, damage: o?.damage ?? v.swarmDamage, blast: o?.blast ?? v.swarmBlast, cooldown: o?.cooldown ?? v.swarmCooldown, count: o?.rockets ?? v.swarmMissiles, speed: v.swarmSpeed }));
    else out.push(w(ctl, "shrpg", { range: v.rpgRange, damage: o?.damage ?? v.rpgDamage, blast: o?.blast ?? v.rpgBlast, speed: o?.shellSpeed ?? v.rpgSpeed, cooldown: o?.cooldown ?? v.rpgShoulderCooldown }));
  }
  return out;
}

/** The range a kit likes (m): the mean of its weapons' (the trigger guns count double: they do most of the work). */
export function preferredRange(kit: readonly KitWeapon[]): number {
  let s = 0, n = 0;
  for (const k of kit) { const wt = "trigger" in k.ctl ? 2 : 1; s += k.ideal * wt; n += wt; }
  return n ? s / n : 35;
}

// ---- Rolling a rival ----

/** One base of these, by drop weight. */
function pickBase(r: () => number, pool: Base[]): Base {
  const total = pool.reduce((a, b) => a + b.drop, 0);
  let x = r() * total;
  for (const b of pool) { x -= b.drop; if (x < 0) return b; }
  return pool[pool.length - 1];
}

// A rival's shoulders are launchers (its AI knows no feeds or power yet, Keith 2026-10-30: shoulder gear is the player's).
const ofKind = (kind: string, size?: string) => BASES.filter((b) => b.kind === kind && (!size || b.size === size) && (kind !== "shoulder" || b.family === "launcher"));

/**
 * A random rival loadout from a seed (the same seed always rolls the same mech): legs, hull, a sensor that fits it, each
 * hull mount a hull weapon or an arm with a held weapon (and often a shoulder weapon), sometimes a two-hander across
 * both arms, a power pack or a back weapon, ammo drums. Every item rolls its rarity and stats (src/items/generate.ts).
 */
export function rollRivalLoadout(seed: number, v: LootValues, o: { rarity?: Rarity } = {}): Loadout {
  const r = rng(seed * 7919 + 13);
  let k = 0;
  const roll = (base: string) => rollItem((seed * 1000 + ++k) >>> 0, v, { base, rarity: o.rarity });
  const lo = emptyLoadout();
  const put = (slot: SlotId, base: string) => {
    const it = roll(base);
    if (!fitProblem(lo, slot, it)) { fit(lo, slot, it); return true; }
    return false;
  };
  put("legs", pickBase(r, ofKind("legs")).id);
  put("hull", pickBase(r, ofKind("hull")).id);
  // A sensor that fits the hull's sockets (a few tries).
  for (let i = 0; i < 4 && !lo.sensor; i++) put("sensor", pickBase(r, ofKind("sensor")).id);
  for (const s of SIDES) {
    const m = MOUNTS[s], mount = hullMount(lo, s);
    if (!mount) continue;
    const gun = mount.takes.includes("hullWeapon") && (!mount.takes.includes("arm") || r() < 0.5);
    if (gun) { put(m.mount, pickBase(r, ofKind("weapon", "M")).id); continue; }
    put(m.mount, pickBase(r, ofKind("arm")).id);
    put(m.held, pickBase(r, ofKind("weapon", "L")).id);
    if (r() < 0.6) put(m.shoulder, pickBase(r, ofKind("shoulder")).id);
  }
  // Arms on both mounts: now and then a two-hander across them.
  if (lo.mountL?.kind === "arm" && lo.mountR?.kind === "arm" && r() < 0.25) put("heldR", pickBase(r, ofKind("weapon", "H")).id);
  put("pack", pickBase(r, r() < 0.45 ? ofKind("shoulder") : ofKind("pack")).id);
  for (const s of SIDES) put(MOUNTS[s].waist, pickBase(r, ofKind("waist").filter((b) => b.tags.includes("ammo"))).id);
  return lo;
}

/** `?rivalfit=slot:base[:rarity],...`: fit these rolled items over the rolled loadout, in order (bad ones skipped). */
export function applyFitSpec(lo: Loadout, spec: string, v: LootValues, seed: number): string[] {
  const notes: string[] = [];
  let n = 0;
  for (const part of spec.split(",").filter(Boolean)) {
    const [slot, base, rarity] = part.split(":") as [SlotId, string, string | undefined];
    if (!SLOTS.includes(slot) || !BASE_BY_ID[base]) { notes.push(`${part}: no such slot or base`); continue; }
    const it = rollItem((seed * 31 + ++n) >>> 0, v, { base, rarity: RARITIES.includes(rarity as Rarity) ? (rarity as Rarity) : "common" });
    const why = fitProblem(lo, slot, it);
    if (why) { notes.push(`${part}: ${why}`); continue; }
    fit(lo, slot, it);
  }
  return notes;
}

/** One line per fitted slot: "Left hull mount: Rail cannon (epic)". */
export function describeLoadout(lo: Loadout): string[] {
  const NAMES: Partial<Record<SlotId, string>> = { legs: "Legs", hull: "Hull", sensor: "Sensor", mountL: "L mount", heldL: "L held", shoulderL: "Key 1", mountR: "R mount", heldR: "R held", shoulderR: "Key 2", pack: "Pack / key 3", waistL: "L waist", waistR: "R waist" };
  return SLOTS.filter((s) => lo[s]).map((s) => `${NAMES[s]}: ${itemName(lo[s]!)} (${lo[s]!.rarity})`);
}
