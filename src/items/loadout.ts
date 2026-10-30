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
import type { Param } from "../core/tweaks";
import { BASE_BY_ID, STATS, SENSOR_SOCKET, SHOULDER_FAMILY, type MountSide, type SensorStyle, type ShoulderFamily, type ShoulderWeapon } from "./bases";
import { PROTOCOL_BY_ID, protocolFits, shotProtocolsOf } from "./protocols";
import { itemWeight, type Item, type SeekerMode } from "./item";
import { makeItem } from "./generate";
import type { GunStats } from "../mech/upper";

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

export const LOADOUT_DEFAULTS = {
  bareAmmo: 300,
  bareDashCharges: 2,
  bareDashRecharge: 4.6,
  bareRadar: 90,
};
export type LoadoutValues = typeof LOADOUT_DEFAULTS;
export const LOADOUT_PARAMS: Param[] = [
  { key: "bareAmmo", label: "Rounds per gun without a drum", min: 0, max: 2000, step: 10, group: "Bare mech", tip: "What a gun's own feed holds when its side's waist mount has no ammo drum" },
  { key: "bareDashCharges", label: "Dash charges without a pack", min: 1, max: 8, step: 1, group: "Bare mech" },
  { key: "bareDashRecharge", label: "Dash recharge without a pack (s)", min: 0.2, max: 15, step: 0.1, group: "Bare mech" },
  { key: "bareRadar", label: "Mech radar without a sensor (m)", min: 20, max: 400, step: 5, group: "Bare mech", tip: "The hull's own short scope when the sensor mount is empty; a sensor sets the mech radar range" },
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
    case "legs": return item.kind === "legs" ? null : "only legs go here";
    case "hull": return item.kind === "hull" ? null : "only a hull goes here";
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
      if (item.size === "H") return hasArm(lo, "L") && hasArm(lo, "R") ? null : "a two-handed weapon needs an arm on both hull mounts";
      return hasArm(lo, side!) ? null : "a held weapon needs an arm on this hull mount";
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

/** A sensor item's style (an unknown base counts as a cluster, the old default). */
export const sensorStyleOf = (item: Item): SensorStyle => BASE_BY_ID[item.base]?.sensor?.style ?? "cluster";

/** Slots this item could go in as the loadout stands. */
export const slotsFor = (lo: Loadout, item: Item) => SLOTS.filter((s) => !fitProblem(lo, s, item));

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
  if (isTwoHander(item)) { take("heldL"); take("heldR"); lo.heldR = item; }
  else {
    // A one-hander in either hand drops a two-hander.
    if ((slot === "heldL" || slot === "heldR") && isTwoHander(lo.heldR)) take("heldR");
    take(slot);
    lo[slot] = item;
  }
  return removed.concat(settle(lo));
}

/** Take an item off (legs and the hull can only be swapped). Returns it and anything that no longer fits. */
export function unfit(lo: Loadout, slot: SlotId): Item[] {
  if (slot === "legs" || slot === "hull") return [];
  const target = slot === "heldL" && isTwoHander(lo.heldR) ? "heldR" : slot;
  const it = lo[target];
  lo[target] = null;
  return (it ? [it] : []).concat(settle(lo));
}

/** Drop whatever no longer fits (until nothing changes); returns what came off. */
export function settle(lo: Loadout): Item[] {
  const out: Item[] = [];
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const s of SLOTS) {
      const it = lo[s];
      if (!it || s === "legs" || s === "hull") continue;
      // A two-hander sits in the right hand; the left hand stays empty.
      if (s === "heldL" && isTwoHander(lo.heldR)) { lo.heldL = null; out.push(it); changed = true; continue; }
      lo[s] = null;
      if (fitProblem(lo, s, it)) { out.push(it); changed = true; } else lo[s] = it;
    }
    if (!changed) break;
  }
  return out;
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
    const why = fitProblem(lo, s, it);
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
  if (!protocolFits(p, item.tags)) return `fits ${p.fits.join(" or ")} items`;
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
  for (const pi of item.socketed) {
    for (const m of PROTOCOL_BY_ID[pi.base]?.mods ?? []) {
      if (m.scope !== "item" || !(m.stat in out)) continue;
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
  hull: number; torsoTurnRate: number;
  /** The hull's armour (src/game/armour.ts). */
  armour: number;
  dashCharges: number; dashRecharge: number; boostFuel: number;
  ammoPerGun: number;
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
  parts: { drums: boolean; drumsL: boolean; drumsR: boolean; pack: boolean; sensor: boolean; sensorId: string | null; sensorStyle: SensorStyle | null; mountL: "gun" | "arm" | null; mountR: "gun" | "arm" | null };
  /** Shoulder weapons on their keys: the arms' shoulders 1 and 2, the back weapon on the pack mount 3 (mount "back"
   *  is the model's top of the back); their own rolled stats (null: an unrolled base item, on the weapon sliders). */
  shoulders: { key: 1 | 2 | 3; mount: ShoulderMount; weapon: ShoulderWeapon; family: ShoulderFamily; own: Record<string, number> | null }[];
  /** The sensor's seeker modes (empty without a sensor). */
  seekers: SeekerMode[];
  /** Cargo the mech can carry (t): the legs' carry plus the hull's and the waist racks. */
  cargoCapacity: number;
  /** Everything fitted (t). */
  weight: number;
}

export function resolve(lo: Loadout, bare: LoadoutValues = LOADOUT_DEFAULTS): Resolved {
  const legs = lo.legs ? effectiveStats(lo.legs) : BASE_STATS("legs-rampart");
  const hull = lo.hull ? effectiveStats(lo.hull) : BASE_STATS("hull-rampart");
  const pack = lo.pack?.kind === "pack" ? effectiveStats(lo.pack) : null;
  const sensor = lo.sensor ? effectiveStats(lo.sensor) : null;
  const eff = (s: SlotId) => (lo[s] ? effectiveStats(lo[s]!) : null);
  const ammoOf = (s: MountSide) => eff(MOUNTS[s].waist)?.ammoPerGun ?? bare.bareAmmo;
  // A head's tracking help: every gun's tracking times this.
  const trackK = 1 + (sensor?.trackAssist ?? 0);

  const gunFrom = (item: Item, w: Record<string, number>, arc: number, track: number, ammo: number): GunStats => {
    const cls = BASE_BY_ID[item.base]?.cls ?? "minigun";
    if (cls === "minigun") return { fireRate: w.fireRate, spinUp: w.spinUp, ammo, arc, track, damage: w.damage, spread: w.spread, range: w.range, pierce: w.pierce, ap: w.ap, proto: shotProtocolsOf(item.socketed) };
    // The new guns (src/weapons): a rail cannon's "rate" is one shot per charge and cooldown (for damage/s readouts);
    // an unrolled base item runs on the weapon sliders (own: null).
    const own = item.seed ? w : null, light = item.size === "L";
    if (cls === "rpg") return { fireRate: 1 / Math.max(0.1, w.cooldown), spinUp: 0.1, ammo, arc, track, damage: w.damage, spread: 0, range: 70, pierce: 0, ap: w.ap, cls, own, light };
    if (cls === "rail") return { fireRate: 1 / Math.max(0.1, w.charge + w.cooldown), spinUp: 0.1, ammo, arc, track, damage: w.damage, spread: 0, range: w.range, pierce: 99, ap: w.ap, cls, own, light };
    return { fireRate: w.fireRate, spinUp: w.spinUp ?? 0.15, ammo, arc, track, damage: w.damage, spread: w.spread, range: w.range, pierce: 0, ap: w.ap, cls, own, light };
  };
  // A side's gun: its hull weapon, or the weapon its arm holds (the arm's arc plus the weapon's, the arm's tracking
  // times the weapon's handling).
  const side = (s: MountSide): GunStats | null => {
    const m = MOUNTS[s], mount = lo[m.mount];
    if (isHullWeapon(mount)) { const w = effectiveStats(mount!); return gunFrom(mount!, w, w.arc, w.track * trackK, ammoOf(s)); }
    const h = lo[m.held];
    if (isArm(mount) && h?.kind === "weapon" && h.size === "L") {
      const a = effectiveStats(mount!), w = effectiveStats(h);
      return gunFrom(h, w, a.arc + (w.arcBonus ?? 0), a.track * (w.handling ?? 1) * trackK, ammoOf(s));
    }
    return null;
  };
  let left = side("L"), right = side("R");
  if (isTwoHander(lo.heldR) && hasArm(lo, "L") && hasArm(lo, "R")) {
    // A two-hander fires from the right side, aimed by both arms: their mean arc, their mean tracking times its
    // handling; fed by the bigger of the two waist drums.
    const w = effectiveStats(lo.heldR!), a = effectiveStats(lo.mountL!), b = effectiveStats(lo.mountR!);
    right = gunFrom(lo.heldR!, w, (a.arc + b.arc) / 2, ((a.track + b.track) / 2) * (w.handling ?? 1) * trackK, Math.max(ammoOf("L"), ammoOf("R")));
    left = null;
  }
  const first = right ?? left;
  const D = BASE_STATS("mg-medium");
  // Salvage speed: arms' hands, held weapons' handles, waist kit.
  let salvage = 1;
  for (const s of SLOTS) { const x = lo[s] ? effectiveStats(lo[s]!).salvage : undefined; if (x !== undefined) salvage += x; }
  const values: ResolvedValues = {
    walkSpeed: legs.walkSpeed, sprintSpeed: legs.sprintSpeed, accel: legs.accel, strideBase: legs.strideBase, stridePerSpeed: legs.stridePerSpeed, impact: legs.impact, turnRate: legs.turnRate,
    hull: hull.hull, torsoTurnRate: hull.torsoTurnRate, armour: hull.armour ?? 0,
    dashCharges: pack?.dashCharges ?? bare.bareDashCharges, dashRecharge: pack?.dashRecharge ?? bare.bareDashRecharge, boostFuel: pack?.boostFuel ?? 0,
    ammoPerGun: first?.ammo ?? bare.bareAmmo,
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
    parts: { drums: drum("waistL") || drum("waistR"), drumsL: drum("waistL"), drumsR: drum("waistR"), pack: !!pack, sensor: !!lo.sensor, sensorId: lo.sensor?.base ?? null, sensorStyle: lo.sensor ? sensorStyleOf(lo.sensor) : null, mountL: mountPart("L"), mountR: mountPart("R") },
    shoulders: ([["shoulderL", 1, "shoulderL"], ["shoulderR", 2, "shoulderR"], ["pack", 3, "back"]] as const).flatMap(([slot, key, mount]) => {
      const it = lo[slot], w = it?.kind === "shoulder" ? BASE_BY_ID[it.base]?.shoulder : undefined;
      return it && w ? [{ key, mount, weapon: w, family: SHOULDER_FAMILY[w], own: it.seed ? effectiveStats(it) : null }] : [];
    }),
    seekers: lo.sensor?.seekers ? [...lo.sensor.seekers] : [],
    cargoCapacity: legs.carry + (hull.carryBonus ?? 0) + racks,
    weight: SLOTS.reduce((w, s) => w + (lo[s] ? itemWeight(lo[s]!) : 0), 0),
  };
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
    line("cargo", "Cargo (t)", r.cargoCapacity, 1, 1), line("hull", "Hull", v.hull, 1, 0), line("armour", "Armour", v.armour, 1, 1), line("torsoTurnRate", "Torso turn (°/s)", v.torsoTurnRate, 1, 0),
    line("dashCharges", "Dash charges", v.dashCharges, 1, 0), line("dashRecharge", "Dash recharge (s)", v.dashRecharge, -1, 2), line("boostFuel", "Boost fuel (s)", v.boostFuel, 1, 1),
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
      line(`${name}ammo`, `${name} rounds`, g?.ammo ?? null, 1, 0),
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
