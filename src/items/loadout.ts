// A loadout: what's fitted in each slot, the rules for what fits where, and `resolve`, which adds it all up into
// the walker, upper-body, mech and dash values the mech runs with (applied by src/game/loadoutApply.ts).
// Slots (docs/proposal-loadout.md): legs, hull, an arm mount each side (an arm, or a Medium hull weapon in its
// place), a hand each side (a Light weapon, only with an arm on that side; a Heavy two-hander takes both hands and
// needs both arms), a power pack (needs the hull's pack mount) and the back mount under it.
// Loadouts are changed in place; fit and unfit return what came off, for the caller to put in stash.
import type { Param } from "../core/tweaks";
import { BASE_BY_ID, STATS } from "./bases";
import { PROTOCOL_BY_ID, protocolFits } from "./protocols";
import { itemWeight, type Item } from "./item";
import { makeItem } from "./generate";
import type { GunStats } from "../mech/upper";

export const SLOTS = ["legs", "hull", "armL", "armR", "handL", "handR", "pack", "back"] as const;
export type SlotId = (typeof SLOTS)[number];
export type Loadout = Record<SlotId, Item | null>;

export const SLOT_NAMES: Record<SlotId, string> = {
  legs: "Legs", hull: "Hull", armL: "Left arm mount", armR: "Right arm mount", handL: "Left hand", handR: "Right hand", pack: "Power pack", back: "Back mount",
};

export const LOADOUT_DEFAULTS = {
  bareAmmo: 300,
  bareDashCharges: 1,
  bareDashRecharge: 6,
};
export type LoadoutValues = typeof LOADOUT_DEFAULTS;
export const LOADOUT_PARAMS: Param[] = [
  { key: "bareAmmo", label: "Rounds per gun without drums", min: 0, max: 2000, step: 10, group: "Bare mech", tip: "What a gun's own feed holds when nothing is on the back mount" },
  { key: "bareDashCharges", label: "Dash charges without a pack", min: 1, max: 5, step: 1, group: "Bare mech" },
  { key: "bareDashRecharge", label: "Dash recharge without a pack (s)", min: 0.2, max: 15, step: 0.1, group: "Bare mech" },
];

/** Today's mech: Rampart legs and hull, a Medium minigun on each arm mount, the stand-in power pack, ammo drums. */
export function defaultLoadout(): Loadout {
  return {
    legs: makeItem("legs-rampart"), hull: makeItem("hull-rampart"),
    armL: makeItem("mg-medium", "common", "default-mg-medium-L"), armR: makeItem("mg-medium", "common", "default-mg-medium-R"),
    handL: null, handR: null, pack: makeItem("pack-standin"), back: makeItem("back-drums"),
  };
}

export const emptyLoadout = (): Loadout => ({ legs: null, hull: null, armL: null, armR: null, handL: null, handR: null, pack: null, back: null });

const isArm = (i: Item | null) => !!i && i.kind === "arm";
const isTwoHander = (i: Item | null) => !!i && i.kind === "weapon" && i.size === "H";

/** Why this item can't go in this slot as the loadout stands, or null if it fits. */
export function fitProblem(lo: Loadout, slot: SlotId, item: Item): string | null {
  const hull = lo.hull ? BASE_BY_ID[lo.hull.base] : null;
  switch (slot) {
    case "legs": return item.kind === "legs" ? null : "only legs go here";
    case "hull": return item.kind === "hull" ? null : "only a hull goes here";
    case "armL": case "armR": {
      if (!(item.kind === "arm" || (item.kind === "weapon" && item.size === "M"))) return item.kind === "weapon" ? "only Medium weapons mount on the hull" : "an arm or a Medium hull weapon";
      if (!hull?.mounts || hull.mounts.arms < (slot === "armL" ? 1 : 2)) return "the hull has no mount here";
      return null;
    }
    case "handL": case "handR": {
      if (item.kind !== "weapon") return "only weapons go in a hand";
      if (item.size === "M") return "Medium weapons mount on the hull, not in a hand";
      if (item.size === "H") return isArm(lo.armL) && isArm(lo.armR) ? null : "a two-handed weapon needs an arm on both sides";
      return isArm(lo[slot === "handL" ? "armL" : "armR"]) ? null : "a hand weapon needs an arm on that side";
    }
    case "pack": return item.kind !== "pack" ? "only a power pack goes here" : hull?.mounts?.pack ? null : "the hull has no pack mount";
    case "back": {
      if (item.kind !== "back") return "only back items go here";
      const pack = lo.pack ? BASE_BY_ID[lo.pack.base] : null;
      return (pack?.backMounts ?? 0) > 0 ? null : "needs a power pack with a back mount";
    }
  }
}

/** Slots this item could go in as the loadout stands. */
export const slotsFor = (lo: Loadout, item: Item) => SLOTS.filter((s) => !fitProblem(lo, s, item));

/**
 * Fit an item (throws if it doesn't fit). Returns everything that came off: what was in the slot, and anything that
 * no longer fits after the change (a hand weapon whose arm was replaced by a hull weapon, a two-hander's other hand).
 */
export function fit(lo: Loadout, slot: SlotId, item: Item): Item[] {
  const why = fitProblem(lo, slot, item);
  if (why) throw new Error(`${item.base} in ${slot}: ${why}`);
  const removed: Item[] = [];
  const take = (s: SlotId) => { const it = lo[s]; if (it) removed.push(it); lo[s] = null; };
  if (isTwoHander(item)) { take("handL"); take("handR"); lo.handR = item; }
  else {
    // Fitting a one-hander in either hand drops a two-hander.
    if ((slot === "handL" || slot === "handR") && isTwoHander(lo.handR)) take("handR");
    take(slot);
    lo[slot] = item;
  }
  return removed.concat(settle(lo));
}

/** Take an item off (legs and the hull can only be swapped). Returns it and anything that no longer fits. */
export function unfit(lo: Loadout, slot: SlotId): Item[] {
  if (slot === "legs" || slot === "hull") return [];
  const target = slot === "handL" && isTwoHander(lo.handR) ? "handR" : slot;
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
      if (s === "handL" && isTwoHander(lo.handR)) { lo.handL = null; out.push(it); changed = true; continue; }
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
  if (isTwoHander(lo.handR) && lo.handL) out.push("a two-hander and a left-hand weapon together");
  for (const s of SLOTS) {
    const it = lo[s];
    if (!it) continue;
    if (s === "handL" && isTwoHander(lo.handR)) continue;
    lo[s] = null;
    const why = fitProblem(lo, s, it);
    lo[s] = it;
    if (why) out.push(`${SLOT_NAMES[s]}: ${why}`);
    if (it.socketed.length > it.sockets) out.push(`${it.base}: more Protocols than sockets`);
    for (const p of it.socketed) { const why2 = socketProblemOf(it, p, true); if (why2) out.push(`${it.base}: ${why2}`); }
  }
  return out;
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

/** The values a loadout gives the mech: keys of the walker, upper-body, mech and dash tuning. */
export interface ResolvedValues {
  walkSpeed: number; sprintSpeed: number; accel: number; strideBase: number; stridePerSpeed: number; impact: number; turnRate: number;
  hull: number; torsoTurnRate: number;
  dashCharges: number; dashRecharge: number;
  ammoPerGun: number;
  /** The shared gun sliders, from the first fitted gun (each gun also has its own in `guns`). */
  fireRate: number; spinUp: number; spread: number; range: number; roundDamage: number; roundPierce: number; podYawMax: number; podTrack: number;
}

export interface Resolved {
  values: ResolvedValues;
  /** Left (the mech's +X side, upper gun 0) and right (gun 1); null: no gun on that side. */
  guns: { left: GunStats | null; right: GunStats | null };
  /** Parts to show on the model. */
  parts: { drums: boolean; pack: boolean };
  /** Cargo the mech can carry (t): the legs' carry plus the hull's racks. */
  cargoCapacity: number;
  /** Everything fitted (t). */
  weight: number;
}

export function resolve(lo: Loadout, bare: LoadoutValues = LOADOUT_DEFAULTS): Resolved {
  const legs = lo.legs ? effectiveStats(lo.legs) : BASE_STATS("legs-rampart");
  const hull = lo.hull ? effectiveStats(lo.hull) : BASE_STATS("hull-rampart");
  const pack = lo.pack ? effectiveStats(lo.pack) : null;
  const back = lo.back ? effectiveStats(lo.back) : null;
  const ammo = back?.ammoPerGun ?? bare.bareAmmo;

  const gunFrom = (w: Record<string, number>, arc: number, track: number): GunStats => ({
    fireRate: w.fireRate, spinUp: w.spinUp, ammo, arc, track, damage: w.damage, spread: w.spread, range: w.range, pierce: w.pierce,
  });
  const side = (arm: SlotId, hand: SlotId): GunStats | null => {
    const mount = lo[arm];
    if (mount?.kind === "weapon") { const w = effectiveStats(mount); return gunFrom(w, w.arc, w.track); }
    const h = lo[hand];
    if (isArm(mount) && h?.kind === "weapon" && h.size === "L") { const a = effectiveStats(mount!); return gunFrom(effectiveStats(h), a.arc, a.track); }
    return null;
  };
  let left = side("armL", "handL"), right = side("armR", "handR");
  if (isTwoHander(lo.handR) && isArm(lo.armL) && isArm(lo.armR)) {
    // A two-hander fires from the right side, aimed by both arms: their mean arc, their mean tracking times its handling.
    const w = effectiveStats(lo.handR!), a = effectiveStats(lo.armL!), b = effectiveStats(lo.armR!);
    right = gunFrom(w, (a.arc + b.arc) / 2, ((a.track + b.track) / 2) * (w.handling ?? 1));
    left = null;
  }
  const first = right ?? left;
  const D = BASE_STATS("mg-medium");
  const values: ResolvedValues = {
    walkSpeed: legs.walkSpeed, sprintSpeed: legs.sprintSpeed, accel: legs.accel, strideBase: legs.strideBase, stridePerSpeed: legs.stridePerSpeed, impact: legs.impact, turnRate: legs.turnRate,
    hull: hull.hull, torsoTurnRate: hull.torsoTurnRate,
    dashCharges: pack?.dashCharges ?? bare.bareDashCharges, dashRecharge: pack?.dashRecharge ?? bare.bareDashRecharge,
    ammoPerGun: ammo,
    fireRate: first?.fireRate ?? D.fireRate, spinUp: first?.spinUp ?? D.spinUp, spread: first?.spread ?? D.spread, range: first?.range ?? D.range,
    roundDamage: first?.damage ?? D.damage, roundPierce: first?.pierce ?? D.pierce, podYawMax: first?.arc ?? D.arc, podTrack: first?.track ?? D.track,
  };
  // Protocols that change the whole mech (Coolant loop's hull, Extended feed's walk).
  for (const s of SLOTS) for (const pi of lo[s]?.socketed ?? []) for (const m of PROTOCOL_BY_ID[pi.base]?.mods ?? []) {
    if (m.scope !== "mech" || !(m.stat in values)) continue;
    const k = m.stat as keyof ResolvedValues;
    values[k] = values[k] * (m.mul ?? 1) + (m.add ?? 0);
  }
  values.dashCharges = Math.max(1, Math.round(values.dashCharges));
  return {
    values,
    guns: { left, right },
    parts: { drums: !!lo.back, pack: !!lo.pack },
    cargoCapacity: legs.carry + (hull.carryBonus ?? 0),
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
    line("cargo", "Cargo (t)", r.cargoCapacity, 1, 1), line("hull", "Hull", v.hull, 1, 0), line("torsoTurnRate", "Torso turn (°/s)", v.torsoTurnRate, 1, 0),
    line("dashCharges", "Dash charges", v.dashCharges, 1, 0), line("dashRecharge", "Dash recharge (s)", v.dashRecharge, -1, 2),
  ];
  for (const [name, g] of [["L", r.guns.left], ["R", r.guns.right]] as const) {
    out.push(
      line(`${name}dps`, `${name} gun damage/s`, g ? g.fireRate * g.damage : null, 1, 0),
      line(`${name}damage`, `${name} damage/round`, g?.damage ?? null, 1, 1),
      line(`${name}rate`, `${name} rounds/s`, g?.fireRate ?? null, 1, 1),
      line(`${name}spin`, `${name} spin-up (s)`, g?.spinUp ?? null, -1, 2),
      line(`${name}spread`, `${name} spread (°)`, g?.spread ?? null, -1, 2),
      line(`${name}range`, `${name} range (m)`, g?.range ?? null, 1, 0),
      line(`${name}pierce`, `${name} pierce`, g?.pierce ?? null, 1, 0),
      line(`${name}arc`, `${name} arc (°)`, g?.arc ?? null, 1, 0),
      line(`${name}ammo`, `${name} rounds`, g?.ammo ?? null, 1, 0),
    );
  }
  return out;
}

/** A copy of a loadout (items shared; for trying a fit without changing the real one). */
export const copyLoadout = (lo: Loadout): Loadout => ({ ...lo });
