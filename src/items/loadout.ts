// A loadout: what's fitted in each slot, the rules for what fits where, and `resolve`, which adds it all up into
// the walker, upper-body, mech, dash and radar values the mech runs with (applied by src/game/loadoutApply.ts).
//
// Slots (Keith 2026-10-26, his part structure; docs/asset-list.md "Mech parts and their mounts"):
// - legs, hull, and an optional sensor (radar range and seekers): a head at the front (it follows the aim) or a
//   cluster on top, and the hull says which of those sockets it has;
// - each hull mount (left and right, chosen per side) holds EITHER a hull weapon (a Medium gun, the whole mount) OR an
//   arm; an arm's side then has a held weapon (Light; a Heavy two-hander needs arms on both mounts and sits in heldR);
// - a shoulder slot per side (keys 1 and 2) on the hull top, whatever the hull mount holds (Keith 2026-10-30): a
//   launcher, a feed for that side's gun (its key overdrives it or loads special rounds) or power (src/weapons/gear.ts);
// - the pack mount, high on the back: a power pack, or a shoulder weapon as a back weapon (key 3) in its place;
// - the waist mounts, left and right: ammo drums (each feeds its own side's gun), cargo racks, small kit.
// The hull item says which mounts it offers and what each takes (`Base.mounts` in bases.ts). More mounts later: add
// a side to `MountSide` and its slots to `MOUNTS` and `SLOTS`; the rules below work per side.
// Loadouts are changed in place; fit and unfit return what came off, for the caller to put in stash.
import { isEnergy } from "../weapons/energy/energySim";
import { REACTOR_DEFAULTS } from "../mech/reactor";
import type { Param } from "../core/tweaks";
import { BASE_BY_ID, tagsOf, STATS, SENSOR_SOCKET, SHOULDER_FAMILY, type MountSide, type SensorStyle, type ShoulderFamily, type ShoulderWeapon } from "./bases";
import { PROTOCOL_BY_ID, protocolFits, shotProtocolsOf, shotCostOf, stackWeights, weighMod } from "./protocols";
import { itemWeight, lookFor, type Item, type SeekerMode } from "./item";
import { makeItem } from "./generate";
import type { GunStats } from "../mech/upper";
import { isRoundGun } from "../weapons/guns";

/** The slots of each hull mount side. */
export const MOUNTS = {
  L: { mount: "mountL", held: "heldL", shoulder: "shoulderL", waist: "waistL", key: 1 },
  R: { mount: "mountR", held: "heldR", shoulder: "shoulderR", waist: "waistR", key: 2 },
} as const;
export const SIDES: MountSide[] = ["L", "R"];

export const SLOTS = ["legs", "hull", "sensor", "mountL", "heldL", "shoulderL", "mountR", "heldR", "shoulderR", "pack", "waistL", "waistR"] as const;
export type SlotId = (typeof SLOTS)[number];
export type Loadout = Record<SlotId, Item | null>;

export const SLOT_NAMES: Record<SlotId, string> = {
  legs: "Legs", hull: "Hull", sensor: "Sensor",
  mountL: "Left hull mount", heldL: "Left held weapon (LMB)", shoulderL: "Left shoulder (key 1)",
  mountR: "Right hull mount", heldR: "Right held weapon (RMB)", shoulderR: "Right shoulder (key 2)",
  pack: "Pack mount (key 3: back weapon)", waistL: "Left waist", waistR: "Right waist",
};

/** Which side a mount, held, shoulder or waist slot is on (null for the others). */
export function sideOf(slot: SlotId): MountSide | null {
  for (const s of SIDES) { const m = MOUNTS[s]; if (slot === m.mount || slot === m.held || slot === m.shoulder || slot === m.waist) return s; }
  return null;
}

/** What a side's waist does for its gun's magazine: the bonus share and the reload speed. */
interface Feed { bonus: number; speed: number }

export const LOADOUT_DEFAULTS = {
  bareMagBonus: 0,
  bareDashCharges: 3, // Keith 2026-11-03: the player's mech starts with at least three energy bars
  rivalBareDashCharges: 3, // rival mechs (duel, HVT) get the same three bars; the rival AI uses the extra one
  bareDashRecharge: 4.6,
  bareRadar: 250,
};
export type LoadoutValues = typeof LOADOUT_DEFAULTS;
export const LOADOUT_PARAMS: Param[] = [
  { key: "bareMagBonus", label: "Magazine + without a drum", min: -0.9, max: 2, step: 0.05, group: "Bare mech", tip: "A belt-fed gun's magazine share added when its side's waist mount has no ammo drum (a drum adds its own)" },
  { key: "bareDashCharges", label: "Dash charges without a pack", min: 1, max: 8, step: 1, group: "Bare mech" },
  { key: "rivalBareDashCharges", label: "Rival dash charges without a pack", min: 1, max: 8, step: 1, group: "Bare mech", tip: "Rival mechs (duel, HVT) without a pack; the player's is above" },
  { key: "bareDashRecharge", label: "Dash recharge without a pack (s)", min: 0.2, max: 15, step: 0.1, group: "Bare mech" },
  { key: "bareRadar", label: "Mech radar without a sensor (m)", min: 20, max: 1000, step: 5, group: "Bare mech", tip: "The hull's own short scope when the sensor mount is empty; a sensor sets the mech radar range" },
];

/** Today's mech: Rampart legs and hull, the Rampart visor head (Keith 2026-10-26: hulls have heads), a Medium minigun on each hull mount, the stand-in power
 *  pack, an ammo drum on each waist mount (the half drum per gun the model always had), and (Keith 2026-10-30, Claude's
 *  suggestion) a missile pod on the left shoulder (key 1) and a belt feed on the right (key 2: overdrive the right gun),
 *  so a fresh player has a keyed weapon and a keyed boost from the start. */
export function defaultLoadout(): Loadout {
  return {
    legs: makeItem("legs-rampart"), hull: makeItem("hull-rampart"), sensor: makeItem("sensor-visor"),
    mountL: makeItem("mg-medium", "common", "default-mg-medium-L"), heldL: null, shoulderL: makeItem("sh-missiles", "common", "default-sh-missiles-L"),
    mountR: makeItem("mg-medium", "common", "default-mg-medium-R"), heldR: null, shoulderR: makeItem("sh-beltfeed", "common", "default-sh-beltfeed-R"),
    pack: makeItem("pack-standin"),
    waistL: makeItem("waist-drums", "common", "default-waist-drums-L"), waistR: makeItem("waist-drums", "common", "default-waist-drums-R"),
  };
}

export const emptyLoadout = (): Loadout => Object.fromEntries(SLOTS.map((s) => [s, null])) as Loadout;

export const isArm = (i: Item | null) => !!i && i.kind === "arm";
export const isHullWeapon = (i: Item | null) => !!i && i.kind === "weapon" && i.size === "M";
export const isTwoHander = (i: Item | null) => !!i && i.kind === "weapon" && i.size === "H";
/** Does this side have an arm (so its held and shoulder slots exist)? */
export const hasArm = (lo: Loadout, s: MountSide) => isArm(lo[MOUNTS[s].mount]);

// ---- Arms come with the hull (Keith 2026-11-03) ----
// Arms aren't items the player finds or fits: each hull names its arm (Base.arm) and it goes on every hull mount that
// takes an arm and holds no hull weapon. Fitting a held weapon puts the arm back (a hull weapon there comes off);
// taking a hull weapon off puts the arm back; a new hull brings its own arms. These arms never go to the stash.
export const BUILTIN_TAG = "builtin";
export const isBuiltinArm = (i: Item | null) => isArm(i) && i!.tags.includes(BUILTIN_TAG);
/** The arm base a hull comes with (null: none). */
export const hullArmBase = (hull: Item | null) => (hull ? BASE_BY_ID[hull.base]?.arm ?? null : null);
/** The hull's own arm for a side (base values, no sockets). */
export function hullArm(lo: Loadout, s: MountSide): Item | null {
  const base = hullArmBase(lo.hull);
  if (!base || !lo.hull) return null;
  const it = makeItem(base, "common", `${lo.hull.id}/arm-${s}`);
  it.sockets = 0;
  it.level = lo.hull.level ?? 1;
  it.tags.push(BUILTIN_TAG);
  return it;
}
/** Can this side hold a weapon: an arm there now, or the hull's arm can go on. */
export function armable(lo: Loadout, s: MountSide): boolean {
  if (hasArm(lo, s)) return true;
  return !!hullArmBase(lo.hull) && !!hullMount(lo, s)?.takes.includes("arm");
}
/** Put the hull's arm on every mount that takes one and is empty, and swap another hull's arms for this one's. */
function armUp(lo: Loadout) {
  for (const s of ["L", "R"] as MountSide[]) {
    const slot = MOUNTS[s].mount, it = lo[slot];
    if (!hullMount(lo, s)?.takes.includes("arm")) continue;
    if (!it || (isBuiltinArm(it) && lo.hull && !it.id.startsWith(lo.hull.id + "/"))) lo[slot] = hullArm(lo, s);
  }
}
const notBuiltin = (xs: Item[]) => xs.filter((x) => !isBuiltinArm(x));
/** A held weapon sitting in a hand with no arm on that mount now (fitProblem allows it, since fit puts the arm on). */
function armless(lo: Loadout, s: SlotId, it: Item): boolean {
  if (s !== "heldL" && s !== "heldR") return false;
  return isTwoHander(it) ? !hasArm(lo, "L") || !hasArm(lo, "R") : !hasArm(lo, sideOf(s)!);
}

/** The hull's mount on a side, or null if it has none there. */
export function hullMount(lo: Loadout, s: MountSide) {
  const hull = lo.hull ? BASE_BY_ID[lo.hull.base] : null;
  return hull?.mounts?.hull.find((m) => m.side === s) ?? null;
}

/** Why this item can't go in this slot as the loadout stands, or null if it fits. */
export function fitProblem(lo: Loadout, slot: SlotId, item: Item): string | null {
  const hull = lo.hull ? BASE_BY_ID[lo.hull.base] : null;
  const side = sideOf(slot);
  switch (slot) {
    case "legs": {
      if (item.kind !== "legs") return "only legs go here";
      return liftProblem(item, lo.hull);
    }
    case "hull": {
      if (item.kind !== "hull") return "only a hull goes here";
      return liftProblem(lo.legs, item);
    }
    case "sensor": {
      if (item.kind !== "sensor") return "only a sensor goes here";
      const has = hull?.mounts?.sensor ?? [];
      if (!has.length) return "the hull has no sensor mount";
      const style = sensorStyleOf(item);
      if (has.includes(SENSOR_SOCKET[style])) return null;
      return style === "head" ? "a head needs a front sensor socket: this hull has only a top one" : "a cluster needs a top sensor socket: this hull has only a front one";
    }
    case "mountL": case "mountR": {
      const arm = item.kind === "arm", gun = isHullWeapon(item);
      if (!arm && !gun) return item.kind === "weapon" ? (item.size === "H" ? "a two-handed weapon: fit an arm on both mounts, then hold it" : "a held weapon: fit an arm here, then hold it") : "a hull weapon or an arm";
      const m = hullMount(lo, side!);
      if (!m) return "the hull has no mount here";
      if (arm && !m.takes.includes("arm")) return "this hull mount takes no arm";
      if (gun && !m.takes.includes("hullWeapon")) return "this hull mount takes no hull weapon";
      return null;
    }
    case "heldL": case "heldR": {
      if (item.kind !== "weapon") return "only weapons are held";
      if (item.size === "M") return "a hull weapon: it takes a whole hull mount, not a hand";
      if (item.size === "H") return armable(lo, "L") && armable(lo, "R") ? null : "a two-handed weapon needs arms on both hull mounts (this hull has none there)";
      return armable(lo, side!) ? null : "this hull has no arm on this mount";
    }
    case "shoulderL": case "shoulderR": {
      // Whatever the hull mount holds (Keith 2026-10-30): no arm needed.
      return item.kind === "shoulder" ? null : "only shoulder gear goes here";
    }
    case "pack": {
      if (item.kind !== "pack" && item.kind !== "shoulder") return "a power pack, or a launcher as a back weapon";
      if (item.kind === "shoulder" && BASE_BY_ID[item.base]?.family !== "launcher") return "feeds and power ride on a shoulder, not the back";
      return hull?.mounts?.pack ? null : "the hull has no pack mount";
    }
    case "waistL": case "waistR": {
      if (item.kind !== "waist") return "only waist kit goes here (drums, racks, kit)";
      return hull?.mounts?.waist.includes(side!) ? null : "the hull has no waist mount here";
    }
  }
}

/**
 * Legs that can only lift so much (hover legs, Keith 2026-11-02: they "can't support heavy hulls"): why this hull is
 * too heavy for these legs, or null. The hull's own weight counts (with its Protocols), not what hangs on it.
 */
export function liftProblem(legs: Item | null, hull: Item | null): string | null {
  if (!legs || !hull) return null;
  const lifts = effectiveStats(legs).lifts;
  if (lifts === undefined) return null;
  const w = itemWeight(hull);
  return w > lifts + 1e-6 ? `too heavy: ${BASE_BY_ID[legs.base]?.name ?? "these legs"} lift hulls up to ${lifts.toFixed(1)} t, this hull is ${w.toFixed(1)} t` : null;
}

/** A sensor item's style (an unknown base counts as a cluster, the old default). */
export const sensorStyleOf = (item: Item): SensorStyle => BASE_BY_ID[item.base]?.sensor?.style ?? "cluster";

/**
 * Fit an item (throws if it doesn't fit). Returns everything that came off: what was in the slot, and anything that
 * no longer fits after the change (a hull weapon in place of an arm bounces that side's held weapon and a two-hander,
 * not its shoulder gear; an arm in place of a hull weapon bounces the hull weapon).
 */
export function fit(lo: Loadout, slot: SlotId, item: Item): Item[] {
  const why = fitProblem(lo, slot, item);
  if (why) throw new Error(`${item.base} in ${slot}: ${why}`);
  const removed: Item[] = [];
  const take = (s: SlotId) => { const it = lo[s]; if (it) removed.push(it); lo[s] = null; };
  // A held weapon brings back the hull's arm on its side (a hull weapon there comes off).
  const arm = (s: MountSide) => { if (!hasArm(lo, s)) { take(MOUNTS[s].mount); lo[MOUNTS[s].mount] = hullArm(lo, s); } };
  if (item.kind === "weapon" && (slot === "heldL" || slot === "heldR")) { if (isTwoHander(item)) { arm("L"); arm("R"); } else arm(sideOf(slot)!); }
  if (isTwoHander(item)) { take("heldL"); take("heldR"); lo.heldR = item; }
  else {
    // A one-hander in either hand drops a two-hander.
    if ((slot === "heldL" || slot === "heldR") && isTwoHander(lo.heldR)) take("heldR");
    take(slot);
    lo[slot] = item;
  }
  return notBuiltin(removed.concat(settle(lo)));
}

/** Take an item off (legs and the hull can only be swapped). Returns it and anything that no longer fits. */
export function unfit(lo: Loadout, slot: SlotId): Item[] {
  if (slot === "legs" || slot === "hull") return [];
  const target = slot === "heldL" && isTwoHander(lo.heldR) ? "heldR" : slot;
  const it = lo[target];
  lo[target] = null;
  return notBuiltin((it ? [it] : []).concat(settle(lo)));
}

/** Drop whatever no longer fits (until nothing changes); returns what came off. */
export function settle(lo: Loadout): Item[] {
  const out: Item[] = [];
  armUp(lo);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const s of SLOTS) {
      const it = lo[s];
      if (!it || s === "legs" || s === "hull") continue;
      // A two-hander sits in the right hand; the left hand stays empty.
      if (s === "heldL" && isTwoHander(lo.heldR)) { lo.heldL = null; out.push(it); changed = true; continue; }
      lo[s] = null;
      if (fitProblem(lo, s, it) || armless(lo, s, it)) { out.push(it); changed = true; } else lo[s] = it;
    }
    if (!changed) break;
  }
  armUp(lo);
  return notBuiltin(out);
}

/** Every rule this loadout breaks (empty when it's sound). */
export function problems(lo: Loadout): string[] {
  const out: string[] = [];
  if (!lo.legs) out.push("no legs");
  if (!lo.hull) out.push("no hull");
  if (isTwoHander(lo.heldR) && lo.heldL) out.push("a two-hander and a left held weapon together");
  for (const s of SLOTS) {
    const it = lo[s];
    if (!it) continue;
    if (s === "heldL" && isTwoHander(lo.heldR)) continue;
    lo[s] = null;
    const why = fitProblem(lo, s, it) ?? (armless(lo, s, it) ? "a held weapon with no arm to hold it" : null);
    lo[s] = it;
    if (why) out.push(`${SLOT_NAMES[s]}: ${why}`);
    if (it.socketed.length > it.sockets) out.push(`${it.base}: more Protocols than sockets`);
    for (const p of it.socketed) { const why2 = socketProblemOf(it, p, true); if (why2) out.push(`${it.base}: ${why2}`); }
  }
  return out;
}

const RARITY_ORDER = ["legendary", "epic", "rare", "uncommon", "common"];

/**
 * The held weapon to put in a new arm's hand (Keith 2026-10-25: an arm on its own left an empty mount): the rarest
 * one-handed weapon in the pool that fits that side, or null.
 */
export function bestHeld(lo: Loadout, side: MountSide, pool: Item[]): Item | null {
  const slot = MOUNTS[side].held;
  if (lo[slot]) return null;
  return pool.filter((c) => c.kind === "weapon" && c.size === "L" && !fitProblem(lo, slot, c))
    .sort((p, q) => RARITY_ORDER.indexOf(p.rarity) - RARITY_ORDER.indexOf(q.rarity))[0] ?? null;
}

// ---- Protocols in sockets ----

function socketProblemOf(item: Item, proto: Item, already: boolean): string | null {
  if (proto.kind !== "protocol") return "not a Protocol";
  const p = PROTOCOL_BY_ID[proto.base];
  if (!p) return "unknown Protocol";
  if (!already && item.socketed.length >= item.sockets) return item.sockets ? "all sockets full" : "no sockets (Common)";
  if (!protocolFits(p, tagsOf(item))) return `fits ${p.fits.join(" or ")} items`;
  if (!already && item.socketed.some((q) => q.base === proto.base)) return "already socketed";
  return null;
}
/** Why this Protocol can't be socketed into this item, or null. */
export const socketProblem = (item: Item, proto: Item) => socketProblemOf(item, proto, false);

export function socket(item: Item, proto: Item) {
  const why = socketProblem(item, proto);
  if (why) throw new Error(`${proto.base} into ${item.base}: ${why}`);
  item.socketed.push(proto);
}

/** Take the Protocol in socket i out (returned for the stash). */
export function unsocket(item: Item, i: number): Item | null {
  return item.socketed.splice(i, 1)[0] ?? null;
}

/** An item's stats with its Protocols' item-scope changes applied. */
export function effectiveStats(item: Item): Record<string, number> {
  const out = { ...item.stats };
  const ws = stackWeights(item.socketed);
  for (let i = 0; i < item.socketed.length; i++) {
    for (const m0 of PROTOCOL_BY_ID[item.socketed[i].base]?.mods ?? []) {
      if (m0.scope !== "item" || !(m0.stat in out)) continue;
      const m = weighMod(m0, ws[i]);
      let x = out[m.stat] * (m.mul ?? 1) + (m.add ?? 0);
      if (STATS[m.stat]?.whole) x = Math.round(x);
      out[m.stat] = x;
    }
  }
  return out;
}

// ---- Adding it up ----

/** The values a loadout gives the mech: keys of the walker, upper-body, mech, dash, radar and salvage tuning. */
export interface ResolvedValues {
  walkSpeed: number; sprintSpeed: number; accel: number; strideBase: number; stridePerSpeed: number; impact: number; turnRate: number;
  /** The legs' trample reach and damage, × the Trample sliders (src/combat/trample.ts; Keith 2026-10-31). */
  trample: number; crush: number;
  /** 1: the legs hover (src/mech/hover.ts) instead of walking. */
  hover: number;
  hull: number; torsoTurnRate: number;
  /** The hull's armour (src/game/armour.ts). */
  armour: number;
  dashCharges: number; dashRecharge: number; boostFuel: number;
  /** The hull's reactor (Keith 2026-11-02): what energy weapons draw on, apart from the pack's kinetic bars. */
  reactorCap: number; reactorRegen: number;
  ammoPerGun: number;
  /** The first gun's reload (s). */
  reloadTime: number;
  /** The shared gun sliders, from the first fitted gun (each gun also has its own in `guns`). */
  fireRate: number; spinUp: number; spread: number; range: number; roundDamage: number; roundPierce: number; podYawMax: number; podTrack: number;
  /** The mech radar's range (src/expedition/radar.ts): the sensor's, or the bare hull's. */
  mechRadar: number;
  /** Salvage speed from the gear (arms, held weapons, a cutting kit): multiplies the strip speed (src/pois/salvage.ts). */
  gearSalvage: number;
  /** A head's aim help: degrees added to the soft lock's line-of-fire cone (src/game/targeting.ts); 0 without one. */
  sensorLock: number;
}

/** A model socket a part hangs on (docs/asset-list.md: HullMount_L/R, Sensor, Pack, Waist_L/R, Shoulder, Grip). */
export type ShoulderMount = "shoulderL" | "shoulderR" | "back";

export interface Resolved {
  values: ResolvedValues;
  /** Left (the mech's +X side, upper gun 0) and right (gun 1); null: no gun on that side. */
  guns: { left: GunStats | null; right: GunStats | null };
  /** Parts to show on the model: each side's mount ("gun": a hull weapon, "arm", or null), drums per waist side, the
   *  pack (a power pack, not a back weapon), the sensor (and which: its base id, for the model, and its style).
   *  `drums` is either side (older bodies). */
  parts: { legsLook: string; hullLook: string; drums: boolean; drumsL: boolean; drumsR: boolean; pack: boolean; packId: string | null; sensor: boolean; sensorId: string | null; sensorStyle: SensorStyle | null; mountL: "gun" | "arm" | null; mountR: "gun" | "arm" | null };
  /** Shoulder weapons on their keys: the arms' shoulders 1 and 2, the back weapon on the pack mount 3 (mount "back"
   *  is the model's top of the back); their own rolled stats (null: an unrolled base item, on the weapon sliders). */
  shoulders: { key: 1 | 2 | 3; mount: ShoulderMount; weapon: ShoulderWeapon; family: ShoulderFamily; own: Record<string, number> | null; proto?: import("../game/shots").ShotProtocols; cost?: number }[];
  /** The sensor's seeker modes (empty without a sensor). */
  seekers: SeekerMode[];
  /** Timed abilities (src/abilities/abilities.ts): the pack's on key 3, the hull's on key 4. */
  abilities: { key: 3 | 4; id: import("../abilities/abilities").AbilityId }[];
  /** Summoner gear (Keith 2026-11-02; src/summon/gear.ts): what the pack and shoulders bring out. A replica bay on the
   *  pack builds `replicas`, one every `replicaBuild` s, a lost one rebuilt after `replicaRebuild` s; drone racks on the
   *  shoulders add their drones; swarm hives their scrappers, and their keys (1 or 2) send and recall the swarm. */
  summons: { replicas: number; replicaBuild: number; replicaRebuild: number; drones: number; droneRebuild: number; scrappers: number; swarmRebuild: number; swarmKeys: (1 | 2)[]; droneKeys: (1 | 2)[] };
  /** Rows the waist racks add to the cargo grid (cargoCapacity in src/items/cargoSpace.ts turns it into cells). */
  cargoRackRows: number;
}

export function resolve(lo: Loadout, bare: LoadoutValues = LOADOUT_DEFAULTS): Resolved {
  const legs = lo.legs ? effectiveStats(lo.legs) : BASE_STATS("legs-rampart");
  const hull = lo.hull ? effectiveStats(lo.hull) : BASE_STATS("hull-rampart");
  const pack = lo.pack?.kind === "pack" ? effectiveStats(lo.pack) : null;
  const sensor = lo.sensor ? effectiveStats(lo.sensor) : null;
  const eff = (s: SlotId) => (lo[s] ? effectiveStats(lo[s]!) : null);
  // A side's waist feeds its gun's magazine (Keith 2026-10-31: magazines and reloads): a drum's magazine bonus (an old
  // drum's rounds read as a bonus, 1200 rounds +50%), an autoloader's reload speed.
  const feedOf = (s: MountSide): Feed => {
    const w = eff(MOUNTS[s].waist);
    return { bonus: w?.magBonus ?? (w?.ammoPerGun !== undefined ? w.ammoPerGun / 2400 : bare.bareMagBonus), speed: w?.reloadSpeed ?? 0 };
  };
  // A head's tracking help: every gun's tracking times this.
  const trackK = 1 + (sensor?.trackAssist ?? 0);

  const gunFrom = (item: Item, w: Record<string, number>, arc: number, track: number, feed: Feed): GunStats => {
    const b = BASE_BY_ID[item.base], cls = b?.cls ?? "minigun";
    // The magazine: the weapon's own (an item saved before magazines: its base's), a belt-fed gun's grown by its drum;
    // the reload cut by reload speed. What each shot costs from its Protocols.
    const magOf = (belt: boolean) => Math.max(1, Math.round((w.magazine ?? b?.stats.magazine?.base ?? 1) * (belt ? 1 + feed.bonus : 1)));
    const reload = (w.reload ?? b?.stats.reload?.base ?? 2) / Math.max(0.1, 1 + feed.speed);
    const proto = shotProtocolsOf(item.socketed), cost = shotCostOf(item.socketed);
    const ammo = magOf(cls === "minigun" || cls === "autocannon");
    if (cls === "minigun") return { fireRate: w.fireRate, spinUp: w.spinUp, ammo, reload, cost, energy: 0, arc, track, damage: w.damage, spread: w.spread, range: w.range, pierce: w.pierce, ap: w.ap, proto };
    // The new guns (src/weapons): a rail cannon's "rate" is one shot per charge and cooldown (for damage/s readouts);
    // an unrolled base item runs on the weapon sliders (own: null).
    // Other swords than the Breaker always run on their own stats (Keith 2026-11-01: "they all just have the same
    // animation"), so a quick pick of a buster or a short sword is that sword, not the Breaker's sliders.
    // An item with Protocols socketed runs on its own stats too, so their stat mods (Splitter's 40% on a lance) count.
    const own = item.seed || item.socketed.length || (cls === "melee" && item.base !== "sword-light") ? w : null, light = item.size === "L";
    if (cls === "rpg") return { fireRate: 1 / Math.max(0.1, w.cooldown), spinUp: 0.1, ammo, reload, cost, energy: 0, arc, track, damage: w.damage, spread: 0, range: 70, pierce: 0, ap: w.ap, cls, own, light, proto };
    // The rail charges on energy-tagged coils but spends nothing yet (the energy hook, later): no magazine.
    // The sword (src/weapons/sword.ts): no magazine; its "rate" is one swing per wind-up, slash and recovery, its range
    // the reach.
    if (cls === "melee") return { fireRate: 1 / Math.max(0.1, w.windup + w.slash + w.recover), spinUp: 0.1, ammo: 1, reload: 0, cost: 0, energy: 0, arc, track, damage: w.damage, spread: 0, range: w.reach, pierce: 99, ap: w.ap, cls, own, base: item.base, light };
    // Energy weapons (Keith 2026-11-02, src/weapons/energy/): no magazine, they spend the energy bars; a beam's rate is
    // its ticks, a lance's one shot per charge and cooldown.
    if (isEnergy(cls)) {
      const rate = w.fireRate ?? 1 / Math.max(0.1, (w.charge ?? 0) + (w.cooldown ?? 0));
      return { fireRate: rate, spinUp: 0.1, ammo: 1, reload: 0, cost: 0, energy: w.energyShot ?? w.energyDrain ?? 0, arc, track, damage: w.damage, spread: 0, range: w.range, pierce: 0, ap: w.ap, cls, own, light, proto };
    }
    // A round gun (src/weapons/guns.ts): the minigun's path with its own pellets and splash; magazine-fed (no drum).
    if (isRoundGun(cls)) return { fireRate: w.fireRate, spinUp: 0.05, ammo, reload, cost, energy: 0, arc, track, damage: w.damage, spread: w.spread, range: w.range, pierce: w.pierce, ap: w.ap, cls, own, light, proto,
      pellets: Math.max(1, Math.round(w.pellets ?? 1)), splash: w.splash ?? 0, splashShare: w.splashShare ?? 0, burnTime: w.burnTime ?? 0, burnDps: w.burnDps ?? 0, chill: w.chill ?? 0, coldDps: w.coldDps ?? 0 };
    if (cls === "rail") return { fireRate: 1 / Math.max(0.1, w.charge + w.cooldown), spinUp: 0.1, ammo: 1, reload: 0, cost: 0, energy: 0, arc, track, damage: w.damage, spread: 0, range: w.range, pierce: 99, ap: w.ap, cls, own, light };
    return { fireRate: w.fireRate, spinUp: w.spinUp ?? 0.15, ammo, reload, cost, energy: 0, arc, track, damage: w.damage, spread: w.spread, range: w.range, pierce: 0, ap: w.ap, cls, own, light, proto };
  };
  // A side's gun: its hull weapon, or the weapon its arm holds (the arm's arc plus the weapon's, the arm's tracking
  // times the weapon's handling).
  const side = (s: MountSide): GunStats | null => {
    const m = MOUNTS[s], mount = lo[m.mount];
    if (isHullWeapon(mount)) { const w = effectiveStats(mount!); return gunFrom(mount!, w, w.arc, w.track * trackK, feedOf(s)); }
    const h = lo[m.held];
    if (isArm(mount) && h?.kind === "weapon" && h.size === "L") {
      const a = effectiveStats(mount!), w = effectiveStats(h);
      return { ...gunFrom(h, w, a.arc + (w.arcBonus ?? 0), a.track * (w.handling ?? 1) * trackK, feedOf(s)), held: true };
    }
    return null;
  };
  let left = side("L"), right = side("R");
  if (isTwoHander(lo.heldR) && hasArm(lo, "L") && hasArm(lo, "R")) {
    // A two-hander fires from the right side, aimed by both arms: their mean arc, their mean tracking times its
    // handling; fed by the bigger of the two waist drums.
    const w = effectiveStats(lo.heldR!), a = effectiveStats(lo.mountL!), b = effectiveStats(lo.mountR!);
    const fl = feedOf("L"), fr = feedOf("R");
    right = { ...gunFrom(lo.heldR!, w, (a.arc + b.arc) / 2, ((a.track + b.track) / 2) * (w.handling ?? 1) * trackK, { bonus: Math.max(fl.bonus, fr.bonus), speed: Math.max(fl.speed, fr.speed) }), held: true };
    left = null;
  }
  const first = right ?? left;
  const D = BASE_STATS("mg-medium");
  // Salvage speed: arms' hands, held weapons' handles, waist kit.
  let salvage = 1;
  for (const s of SLOTS) { const x = lo[s] ? effectiveStats(lo[s]!).salvage : undefined; if (x !== undefined) salvage += x; }
  const values: ResolvedValues = {
    walkSpeed: legs.walkSpeed, sprintSpeed: legs.sprintSpeed, accel: legs.accel, strideBase: legs.strideBase, stridePerSpeed: legs.stridePerSpeed, impact: legs.impact, turnRate: legs.turnRate,
    trample: legs.trample ?? 1, crush: legs.crush ?? 1,
    hover: legs.hover ?? 0,
    hull: hull.hull, torsoTurnRate: hull.torsoTurnRate, armour: hull.armour ?? 0,
    dashCharges: pack?.dashCharges ?? bare.bareDashCharges, dashRecharge: pack?.dashRecharge ?? bare.bareDashRecharge, boostFuel: pack?.boostFuel ?? 0,
    reactorCap: hull.reactorCap ?? REACTOR_DEFAULTS.reactorCap, reactorRegen: hull.reactorRegen ?? REACTOR_DEFAULTS.reactorRegen,
    ammoPerGun: first?.ammo ?? BASE_STATS("mg-medium").magazine,
    reloadTime: first?.reload ?? D.reload,
    fireRate: first?.fireRate ?? D.fireRate, spinUp: first?.spinUp ?? D.spinUp, spread: first?.spread ?? D.spread, range: first?.range ?? D.range,
    roundDamage: first?.damage ?? D.damage, roundPierce: first?.pierce ?? D.pierce, podYawMax: first?.arc ?? D.arc, podTrack: first?.track ?? D.track,
    mechRadar: sensor?.radarRange ?? bare.bareRadar,
    gearSalvage: salvage,
    sensorLock: sensor?.lockAssist ?? 0,
  };
  // Protocols that change the whole mech (Coolant loop's hull, Extended feed's walk).
  for (const s of SLOTS) for (const pi of lo[s]?.socketed ?? []) for (const m of PROTOCOL_BY_ID[pi.base]?.mods ?? []) {
    if (m.scope !== "mech" || !(m.stat in values)) continue;
    const k = m.stat as keyof ResolvedValues;
    values[k] = values[k] * (m.mul ?? 1) + (m.add ?? 0);
  }
  values.dashCharges = Math.max(1, Math.round(values.dashCharges));
  const drum = (s: SlotId) => lo[s]?.tags.includes("ammo") ?? false;
  const mountPart = (s: MountSide) => (isHullWeapon(lo[MOUNTS[s].mount]) ? "gun" : isArm(lo[MOUNTS[s].mount]) ? "arm" : null);
  let racks = 0;
  for (const s of SIDES) racks += eff(MOUNTS[s].waist)?.carryBonus ?? 0;
  return {
    values,
    guns: { left, right },
    parts: { legsLook: lo.legs ? lookFor(lo.legs) : "rampart", hullLook: lo.hull ? lookFor(lo.hull) : "rampart", drums: drum("waistL") || drum("waistR"), drumsL: drum("waistL"), drumsR: drum("waistR"), pack: !!pack, packId: lo.pack?.kind === "pack" ? lo.pack.base : null, sensor: !!lo.sensor, sensorId: lo.sensor?.base ?? null, sensorStyle: lo.sensor ? sensorStyleOf(lo.sensor) : null, mountL: mountPart("L"), mountR: mountPart("R") },
    shoulders: ([["shoulderL", 1, "shoulderL"], ["shoulderR", 2, "shoulderR"], ["pack", 3, "back"]] as const).flatMap(([slot, key, mount]) => {
      const it = lo[slot], w = it?.kind === "shoulder" ? BASE_BY_ID[it.base]?.shoulder : undefined;
      return it && w ? [{ key, mount, weapon: w, family: SHOULDER_FAMILY[w], own: it.seed ? effectiveStats(it) : null, proto: shotProtocolsOf(it.socketed), cost: shotCostOf(it.socketed) }] : [];
    }),
    seekers: lo.sensor?.seekers ? [...lo.sensor.seekers] : [],
    abilities: ([["pack", 3], ["hull", 4]] as const).flatMap(([slot, key]) => {
      const a = lo[slot] ? BASE_BY_ID[lo[slot]!.base]?.ability : undefined;
      return a && (slot !== "pack" || lo.pack?.kind === "pack") ? [{ key, id: a }] : [];
    }),
    summons: summonsOf(lo),
    cargoRackRows: Math.round(racks),
  };
}

/** The summoner gear fitted (Resolved.summons): the pack's replicas, the shoulders' drones and scrappers (rebuild
 *  times: the quickest of the fitted racks or hives). */
function summonsOf(lo: Loadout): Resolved["summons"] {
  const out: Resolved["summons"] = { replicas: 0, replicaBuild: 10, replicaRebuild: 25, drones: 0, droneRebuild: 6, scrappers: 0, swarmRebuild: 3, swarmKeys: [], droneKeys: [] };
  const pack = lo.pack, pb = pack ? BASE_BY_ID[pack.base] : undefined;
  if (pack && pb?.summon === "replicas") {
    const w = effectiveStats(pack);
    out.replicas = Math.max(0, Math.round(w.replicas ?? 0)); out.replicaBuild = w.replicaBuild ?? out.replicaBuild; out.replicaRebuild = w.summonRebuild ?? out.replicaRebuild;
  }
  let dr = Infinity, sr = Infinity;
  for (const [slot, key] of [["shoulderL", 1], ["shoulderR", 2]] as const) {
    const it = lo[slot], b = it ? BASE_BY_ID[it.base] : undefined;
    if (!it || !b?.summon) continue;
    const w = effectiveStats(it);
    if (b.summon === "drones") { out.drones += Math.max(0, Math.round(w.drones ?? 0)); dr = Math.min(dr, w.summonRebuild ?? out.droneRebuild); out.droneKeys.push(key); }
    if (b.summon === "swarm") { out.scrappers += Math.max(0, Math.round(w.scrappers ?? 0)); sr = Math.min(sr, w.summonRebuild ?? out.swarmRebuild); out.swarmKeys.push(key); }
  }
  if (Number.isFinite(dr)) out.droneRebuild = dr;
  if (Number.isFinite(sr)) out.swarmRebuild = sr;
  return out;
}

function BASE_STATS(id: string): Record<string, number> {
  const b = BASE_BY_ID[id], out: Record<string, number> = {};
  for (const k in b.stats) out[k] = b.stats[k].base;
  return out;
}

// ---- For the bay screen: a flat list of what a loadout gives, to compare two ----

export interface SummaryLine { key: string; label: string; value: number | null; better: 1 | -1; decimals: number }

export function summary(r: Resolved): SummaryLine[] {
  const v = r.values;
  const line = (key: string, label: string, value: number | null, better: 1 | -1, decimals: number): SummaryLine => ({ key, label, value, better, decimals });
  const out = [
    line("walkSpeed", "Walk (m/s)", v.walkSpeed, 1, 2), line("sprintSpeed", "Sprint (m/s)", v.sprintSpeed, 1, 2),
    line("turnRate", "Turn (°/s)", v.turnRate, 1, 0), line("strideBase", "Stride (m)", v.strideBase, 1, 2), line("impact", "Stomp", v.impact, 1, 2),
    line("trample", "Trample reach ×", v.trample, 1, 2), line("crush", "Trample damage ×", v.crush, 1, 2),
    line("cargo", "Cargo rack rows", r.cargoRackRows, 1, 0), line("hull", "Hull", v.hull, 1, 0), line("armour", "Armour", v.armour, 1, 1), line("torsoTurnRate", "Torso turn (°/s)", v.torsoTurnRate, 1, 0),
    line("dashCharges", "Dash charges", v.dashCharges, 1, 0), line("dashRecharge", "Dash recharge (s)", v.dashRecharge, -1, 2), line("boostFuel", "Boost fuel (s)", v.boostFuel, 1, 1),
    line("reactorCap", "Reactor (bars)", v.reactorCap, 1, 1), line("reactorRegen", "Reactor regen (bars/s)", v.reactorRegen, 1, 2),
    line("mechRadar", "Mech radar (m)", v.mechRadar, 1, 0), line("sensorLock", "Lock cone + (°)", v.sensorLock, 1, 1), line("seekers", "Seeker modes", r.seekers.length, 1, 0), line("gearSalvage", "Salvage speed ×", v.gearSalvage, 1, 2),
  ];
  for (const [name, g] of [["L", r.guns.left], ["R", r.guns.right]] as const) {
    out.push(
      line(`${name}dps`, `${name} gun damage/s`, g ? g.fireRate * g.damage : null, 1, 0),
      line(`${name}damage`, `${name} damage/round`, g?.damage ?? null, 1, 1),
      line(`${name}rate`, `${name} rounds/s`, g?.fireRate ?? null, 1, 1),
      line(`${name}spin`, `${name} spin-up (s)`, g?.spinUp ?? null, -1, 2),
      line(`${name}spread`, `${name} spread (°)`, g?.spread ?? null, -1, 2),
      line(`${name}range`, `${name} range (m)`, g?.range ?? null, 1, 0),
      line(`${name}pierce`, `${name} penetration`, g?.pierce ?? null, 1, 0),
      line(`${name}ap`, `${name} armour pierce`, g?.ap ?? null, 1, 2),
      line(`${name}arc`, `${name} arc (°)`, g?.arc ?? null, 1, 0),
      line(`${name}track`, `${name} tracking`, g?.track ?? null, 1, 1),
      line(`${name}ammo`, `${name} magazine`, g?.ammo ?? null, 1, 0),
      line(`${name}reload`, `${name} reload (s)`, g?.reload ?? null, -1, 2),
    );
  }
  return out;
}

/** A copy of a loadout (items shared; for trying a fit without changing the real one). */
export const copyLoadout = (lo: Loadout): Loadout => ({ ...lo });

// ---- Saved loadouts from before the mounts (v1: armL/R, handL/R, shoulderL/R, back) ----

/** Old slot -> new slot. The old back mount's drums go to the left waist; a back shoulder weapon to the pack mount
 *  only if no pack was fitted (else it bounces to the stash, never lost). */
export const V1_SLOTS: Record<string, SlotId> = { legs: "legs", hull: "hull", armL: "mountL", armR: "mountR", handL: "heldL", handR: "heldR", shoulderL: "shoulderL", shoulderR: "shoulderR", pack: "pack" };
