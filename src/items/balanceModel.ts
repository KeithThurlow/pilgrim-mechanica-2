// The balance model (docs/proposal-balance.md), pure: from the live item, weapon, Protocol and enemy tables, a weapon's
// effective DPS against five reference target sets, its time to kill, and what Protocols do to it. A model, not the sim:
// hit chance and area are expected values from simple geometry (seeded Monte Carlo). Moved out of
// tools/balance-sheet.ts (2026-11-03) so the weapon review lab (labs/weaponreview/) and src/items/weaponScaling.ts read
// the same numbers the sheet prints.
// Cadence (damage, rounds per shot, sustained shots/s over the magazine and reload) comes from src/items/dps.ts, the
// same function the item cards show; armour from src/game/armour.ts. Every other assumption is in REF and targets().
// same function the item cards show; armour from src/game/armour.ts. Every other assumption is in REF and targets().
import { isRoundGun } from "../weapons/guns";
import { isEnergy } from "../weapons/energy/energySim";
import { ENERGY_DEFAULTS } from "../weapons/energy/energyTuning";
import { REACTOR_DEFAULTS } from "../mech/reactor";
import { SWORD_DEFAULTS } from "../weapons/sword";
import { BASE_BY_ID } from "./bases";
import { WEAPON_DEFAULTS } from "../weapons/tuning";
import { MECH_DEFAULTS } from "../game/mechUnit";
import { ROBOT_DEFAULTS } from "../combat/robots";
import { WARBAND_DEFAULTS } from "../combat/warband";
import { BUS_DEFAULTS } from "../combat/partyBus";
import { INFANTRY_DEFAULTS } from "../combat/infantry";
import { PEN_DEFAULTS } from "../game/sheet";
import { SHOT_DEFAULTS, type ShotProtocols } from "../game/shots";
import { PROTOCOL_BY_ID, shotProtocolsOf, shotCostOf } from "./protocols";
import { makeItem, protocolItem } from "./generate";
import { effectiveStats } from "./loadout";
import { cadenceOf, type Cadence } from "./dps";
import { armourHit } from "../game/armour";
import { roundPenFor } from "../game/mechUnit";
import type { Item } from "./item";


// ---------------------------------------------------------------- reference assumptions (the model's knobs)
export const REF = {
  /** Per-mount budget at level 1: effective DPS a Medium weapon should reach against its best target set. */
  budget: 150,
  /** Budget share by slot: Light on one mount (the arm adds arc, tracking, salvage), Heavy both mounts, a shoulder
   *  launcher extra on top of the mounts (keyed, cooldown). */
  slotShare: { L: 0.9, M: 1, H: 1.9, shoulder: 0.5 } as Record<string, number>,
  /** Budget weight per target set: area weapons should take about twice the hp per second out of a camp-density swarm
   *  that a single-target gun takes out of one body. */
  setWeight: { swarm: 2, cutter: 1, excavator: 1, raider: 1, rival: 1 } as Record<string, number>,
  aimSkill: 0.85, // share of no-assist shots (rail) that land on a still-ish target; ×0.8 more against a juking mech
  paint: 0.4, // seconds of hold-to-paint before a shoulder launcher fires
  mc: 4000, // Monte Carlo samples
  /** A behaviour Protocol's niche multiplier should land here (Keith 2026-10-31: about ×1.2-1.3; --check fails outside). */
  nicheLo: 1.1, nicheHi: 1.5,
  /** Weapons allowed over the 130% band against one set, by base id: the cap there (Keith 2026-11-03: flak is meant
   *  to be a crowd-clearing menace, so about twice its budget against a swarm; Claude's band, open). */
  bandOver: { "flak-medium": { swarm: 230 } } as Record<string, Record<string, number>>,
  /** Energy weapons (2026-11-03): the Rampart hull's reactor they draw on (its middle roll), and how long the fight
   *  lasts for the energy budget: fire until the reactor is empty at the busy regen, then wait for it to refill. */
  reactor: { cap: 4, regen: 0.4, busy: REACTOR_DEFAULTS.reactorBusy, delay: REACTOR_DEFAULTS.reactorDelay },
  /** Swords: the walk-in. The mech closes at its sprint speed less what the target backs off (speed × juke); swarms
   *  come to it. A swing that reaches lands this share (the rest dodged or parried; a juking mech dodges more). */
  closeSpeed: 8.5, swingLands: 0.9, swingLandsJuke: 0.7,
  /** ...and once in reach it stays there this share of the time, less this × the target's juke (a rival backs off). */
  meleeStick: 0.5,
  /** The sunder beam steered across a swarm: metres a second its line sweeps sideways through the pack. */
  sunderSweep: 3,
};
export const armourFloor = WEAPON_DEFAULTS.armourFloor;
export const thru = (d: number, A: number, ap: number) => armourHit(d, A, ap, armourFloor);

// ---------------------------------------------------------------- seeded random (deterministic output)
let seed = 12345;
/** Restart the seeded random (the same numbers on every call that does the same work). */
export const reseed = (s = 12345) => { seed = s; };
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());

// ---------------------------------------------------------------- weapons (from items: the cards' cadence)
export type Kind = "gun" | "rail" | "cannon" | "rocket" | "missiles" | "mortar" | "line" | "lance" | "orb" | "arc" | "sunder" | "melee";
export interface W {
  id: string; name: string; slot: "L" | "M" | "H" | "shoulder"; kind: Kind;
  /** Damage per round, rounds per volley (missiles, shells; a split's rounds ride in `shot`), seconds per volley
   *  sustained (magazine and reload counted) and within a magazine (burst), first-volley latency. */
  dmg: number; n: number; cycle: number; burst: number; latency: number;
  radius: number; share: number; pen: number; spread: number; speed: number; range: number; sheetHalf: number; flight?: number;
  ap: number; scatter: number; stripLength: number;
  /** Energy weapons and swords (2026-11-03): extra numbers by kind (blast, hops, keep, cleave, arc...). */
  x?: Record<string, number>;
  /** Share of the time an energy weapon can fire on the reactor (1: never runs dry). */
  duty?: number;
  shot: ShotProtocols; cad: Cadence; item: Item;
}
const WD = { ...WEAPON_DEFAULTS };
const MD = { ...MECH_DEFAULTS };
const SLOT: Record<string, W["slot"]> = { L: "L", M: "M", H: "H" };

/** A weapon as the model sees it, from an item (its Protocols included: their stat mods, split, rate, cost). */
export function wOf(item: Item): W {
  const b = BASE_BY_ID[item.base], s = effectiveStats(item), shot = shotProtocolsOf(item.socketed) ?? {};
  const cad = cadenceOf(s, shot, shotCostOf(item.socketed))!;
  const sh = b.kind === "shoulder";
  const common = { id: b.id, name: b.name + (item.socketed.length ? ` +${item.socketed.map((p) => PROTOCOL_BY_ID[p.base].name).join("+")}` : ""), slot: sh ? "shoulder" as const : SLOT[b.size ?? "M"],
    dmg: s.damage, cycle: 1 / cad.sustained, burst: 1 / cad.rate, ap: s.ap ?? 0, shot, cad, item, stripLength: 0 };
  const cls = b.cls ?? (sh ? b.shoulder : "minigun");
  if (isEnergy(cls)) return energyW(common, cls, s);
  if (cls === "melee") {
    const gap = Math.max(0.05, (s.windup ?? 0) + (s.slash ?? 0) + (s.recover ?? 0));
    return { ...common, kind: "melee", n: 1, cycle: gap, burst: gap, latency: s.windup ?? 0, radius: 0, share: 0, pen: s.cleave ?? SWORD_DEFAULTS.swordCleave, spread: 0, speed: Infinity,
      range: s.reach ?? SWORD_DEFAULTS.swordReach, sheetHalf: 0.3, scatter: 0, x: { arc: s.swing ?? SWORD_DEFAULTS.swordArc } };
  }
  // Round guns (src/weapons/guns.ts): the minigun's rounds, n pellets a shot, flak's shrapnel splash on each.
  if (isRoundGun(cls)) return { ...common, kind: "gun", n: Math.max(1, s.pellets ?? 1), latency: 0, radius: s.splash ?? MD.roundSplash, share: s.splash ? s.splashShare ?? 0 : MD.roundSplashShare, pen: roundPenFor(MD, s.pierce),
    spread: s.spread, speed: Infinity, range: s.range, sheetHalf: MD.roundSheetHalf, scatter: 0 };
  if (cls === "minigun") return { ...common, kind: "gun", n: 1, latency: s.spinUp, radius: MD.roundSplash, share: MD.roundSplashShare, pen: roundPenFor(MD, s.pierce),
    spread: s.spread, speed: Infinity, range: s.range, sheetHalf: MD.roundSheetHalf, scatter: 0 };
  if (cls === "rail") {
    const light = b.size === "L";
    return { ...common, kind: "rail", n: 1, latency: s.charge, radius: 0, share: 0, pen: WD.railPen * (light ? WD.railLightPen : 1), spread: 0, speed: Infinity, range: s.range, sheetHalf: WD.railSheetHalf, scatter: 0 };
  }
  if (cls === "cannon") return { ...common, kind: "cannon", n: 1, latency: 0, radius: s.blast, share: WD.cannonBlastShare, pen: 0, spread: s.spread, speed: s.shellSpeed, range: s.range, sheetHalf: WD.acSheetHalf, scatter: 0 };
  if (cls === "autocannon") return { ...common, kind: "cannon", n: 1, latency: s.spinUp, radius: s.splash, share: WD.acSplashShare, pen: WD.acPen, spread: s.spread, speed: s.shellSpeed, range: s.range, sheetHalf: WD.acSheetHalf, scatter: 0 };
  if (cls === "rpg") return { ...common, kind: "rocket", n: 1, cycle: common.cycle + (sh ? REF.paint / Math.max(1, s.magazine ?? 1) : 0), latency: sh ? REF.paint : 0, radius: s.blast, share: 1, pen: 0, spread: 0, speed: s.shellSpeed, range: WD.rpgRange, sheetHalf: 0, scatter: 0.5 };
  if (cls === "missiles") return { ...common, kind: "missiles", n: s.rockets, cycle: common.cycle + REF.paint, latency: REF.paint + 1, radius: s.blast, share: 1, pen: 0, spread: 0, speed: WD.swarmSpeed, range: 70, sheetHalf: 0, scatter: WD.swarmFan * 0.5 };
  if (cls === "mortar") return { ...common, kind: "mortar", n: WD.mortarShells, cycle: common.cycle + REF.paint, latency: REF.paint + WD.mortarFlight, radius: s.blast, share: 1, pen: 0, spread: 0, speed: Infinity, flight: WD.mortarFlight, range: WD.mortarMaxRange, sheetHalf: 0, scatter: WD.mortarRing * 0.5 };
  return { ...common, kind: "line", n: s.shells, cycle: common.cycle + REF.paint, latency: REF.paint + 0.9, radius: s.blast, share: 1, pen: 0, spread: 0, speed: WD.salvoSpeed, range: WD.salvoMaxRange, sheetHalf: 0, scatter: WD.salvoScatter, stripLength: s.stripLength };
}

/** Share of the time a weapon drawing `draw` bars/s can fire: until the reactor empties at the busy regen, then it
 *  waits out the delay and refills at the full regen. */
export function energyDuty(draw: number): number {
  const R = REF.reactor, busy = R.regen * R.busy;
  if (draw <= busy) return 1;
  const fire = R.cap / (draw - busy), refill = R.delay + R.cap / Math.max(1e-6, R.regen);
  return fire / (fire + refill);
}

/** An energy weapon as the model sees it (src/weapons/energy/energyGuns.ts: what each kind does with a shot). */
function energyW(common: Omit<W, "kind" | "n" | "latency" | "radius" | "share" | "pen" | "spread" | "speed" | "range" | "sheetHalf" | "scatter">, cls: string, s: Record<string, number>): W {
  const E = ENERGY_DEFAULTS, base = { ...common, n: 1, latency: 0, radius: 0, share: 0, pen: 0, spread: 0, speed: Infinity, range: s.range, sheetHalf: 0.15, scatter: 0 };
  // Seconds a shot (or a beam tick) and the energy it draws per second while firing.
  const shotGap = (g: number, draw: number) => { const duty = energyDuty(draw); return { cycle: g / duty, burst: g, duty }; };
  const rate = s.fireRate ?? 1;
  switch (cls) {
    case "laser": return { ...base, kind: "gun", ...shotGap(1 / rate, rate * s.energyShot) };
    case "beam": return { ...base, kind: "gun", ...shotGap(1 / rate, s.energyDrain) };
    case "plasma": return { ...base, kind: "cannon", radius: s.splash, share: 0.6, speed: s.shellSpeed, ...shotGap(1 / rate, rate * s.energyShot) };
    case "orb": return { ...base, kind: "orb", radius: s.splash, speed: s.shellSpeed, x: { pop: s.blastDamage ?? 0 }, ...shotGap(1 / rate, rate * s.energyShot) };
    case "arc": return { ...base, kind: "arc", x: { hops: Math.round(s.hops ?? E.arcHops), keep: E.arcKeep, splash: 1.2 }, ...shotGap(1 / rate, rate * s.energyShot) };
    case "lance": { const g = (s.charge ?? 0) + (s.cooldown ?? 0); return { ...base, kind: "lance", latency: s.charge ?? 0, radius: s.blast ?? 0, x: { blast: s.blastDamage ?? 0 }, ...shotGap(g, s.energyShot / g) }; }
    default: { // sunder: one press is a charge, a channel of ticks, a cooldown
      const g = (s.charge ?? 0) + (s.channel ?? 0) + (s.cooldown ?? 0);
      return { ...base, kind: "sunder", latency: s.charge ?? 0, sheetHalf: E.sunderWidth, x: { ticks: rate * (s.channel ?? 0) }, ...shotGap(g, s.energyShot / g) };
    }
  }
}

export const withProtos = (base: string, ids: string[]): Item => {
  const it = makeItem(base);
  for (const id of ids) it.socketed.push(protocolItem(PROTOCOL_BY_ID[id], 1));
  return it;
};
/** Energy weapons and swords (2026-11-03): modelled, printed by the sheet, not held to its bands yet. */
export const ENERGY_IDS = ["laser-medium", "beam-medium", "lance-medium", "plasma-medium", "orb-medium", "arc-medium", "sunder-medium"];
export const MELEE_IDS = ["sword-light", "sword-heavy", "sword-short"];
export const WEAPON_IDS = ["mg-light", "mg-medium", "mg-heavy", "smg-light", "rifle-light", "shotgun-light", "sniper-medium", "flak-medium", "cannon-medium", "rail-light", "rail-medium", "ac-medium", "rpg-light", "rpg-medium", "sh-rpg", "sh-missiles", "sh-mortar", "sh-linemortar"];

// ---------------------------------------------------------------- targets (live hp and armour)
export interface T {
  id: string; name: string; hp: number; r: number; speed: number; juke: number; dist: number; engage: number;
  armour: number; penDensity: number;
  /** Damage share by how it lands: direct (part mix), a round's splash, an explosive's blast. */
  directK: number; roundSplashK: number; blastK: number;
  swarm?: { n: number; rho: number };
}
export const RB = ROBOT_DEFAULTS, WB = WARBAND_DEFAULTS;
const robotR = (size: number, k: number) => size * k * RB.robotHitScale;
export const HULL = BASE_BY_ID["hull-rampart"].stats;

export function targets(): T[] {
  return [
    { id: "swarm", name: "Swarm cluster", hp: RB.robotHp, r: robotR(RB.robotSize, 0.45), speed: RB.robotRunSpeed, juke: 0.25, dist: 25, engage: 8,
      armour: RB.robotArmour, penDensity: PEN_DEFAULTS.penScrapper, directK: 1, roundSplashK: 1, blastK: 1, swarm: { n: 36, rho: 0.2 } },
    { id: "cutter", name: "Lone cutter", hp: RB.robotMidHp, r: robotR(RB.robotMidSize, 0.44), speed: RB.robotMidSpeed, juke: 0.35, dist: 22, engage: 4,
      armour: RB.robotMidArmour, penDensity: PEN_DEFAULTS.penCutter, directK: 0.95, roundSplashK: RB.robotMidSplash, blastK: RB.robotMidBlast },
    { id: "excavator", name: "Excavator", hp: RB.robotBigHp, r: robotR(RB.robotBigSize, 0.5), speed: RB.robotBigSpeed, juke: 0.3, dist: 30, engage: 12,
      armour: RB.robotBigArmour, penDensity: PEN_DEFAULTS.penExcavator, directK: 0.85 + 0.15 * RB.robotLegDamage, roundSplashK: 0, blastK: RB.robotBigBlast },
    { id: "raider", name: "Raider technical", hp: WB.techHull, r: 1.25, speed: 15, juke: 0.5, dist: 28, engage: 6,
      armour: WB.techArmour, penDensity: PEN_DEFAULTS.penVehicle, directK: 1, roundSplashK: 0, blastK: 1 },
    { id: "rival", name: "Rival mech @35 m", hp: HULL.hull.base, r: MD.hitRadius, speed: 6, juke: 0.6, dist: 35, engage: 25,
      armour: HULL.armour.base, penDensity: PEN_DEFAULTS.penVehicle, directK: 1, roundSplashK: 0, blastK: 1 },
  ];
}

/** Other enemies for the time-to-kill table: [name, hp, armour, like which target set]. */
export const OTHERS: [string, number, number, string][] = [
  ["Bandit (foot)", INFANTRY_DEFAULTS.hp, 0, "swarm"],
  ["Gun truck", WB.truckHull, WB.truckArmour, "raider"],
  ["Six-wheeler", WB.sixHull, WB.sixArmour, "raider"],
  ["War Rig", WB.rigHull, WB.rigArmour, "raider"],
  ["Turret truck", WB.turretHull, WB.turretArmour, "raider"],
  ["Party bus", BUS_DEFAULTS.busHull, WB.busArmour, "raider"],
  ["Bandit mech", WB.banditMechHull, WB.banditMechArmour, "rival"],
];

// ---------------------------------------------------------------- the model
export const fall = (x: number, r: number) => (x > r ? 0 : 1 - (0.5 * x) / Math.max(1e-6, r));
export const inRange = (w: W, t: T) => w.kind === "melee" || w.range >= t.dist;
export const split = (w: W) => Math.max(1, Math.round(w.shot.split ?? 1));
export const rate = (w: W) => Math.max(1, Math.round(w.shot.rate ?? 1));
/** Double shot's side-by-side copies (0.5 m apart: every copy lands where the one would). */
export const multi = (w: W) => Math.max(1, Math.round(w.shot.multi ?? 1));
export const fanAt = (d: number, rocket = false) => d * Math.tan(((rocket ? SHOT_DEFAULTS.protoRocketFan : SHOT_DEFAULTS.protoFan) * Math.PI) / 180);

/** Aim error σ (m, each axis) at the target for a projectile: lead error from the target's juke over the flight. */
export function sigma(w: W, t: T): number {
  const flight = w.flight ?? (Number.isFinite(w.speed) ? t.dist / w.speed : 0);
  const homing = w.kind === "missiles" ? 0.3 : 1;
  return Math.hypot(t.speed * flight * t.juke * homing, w.scatter, t.dist * Math.tan((w.spread * Math.PI) / 180) * 0.5);
}

/** Share of rounds within reach of a single target for a hitscan gun (the mech spread: radius tan(spread)·U). */
export function hitscanP(w: W, t: T): number {
  const S = t.dist * Math.tan((w.spread * Math.PI) / 180), R = t.r + w.sheetHalf;
  if (S <= 0) return 1;
  let hit = 0;
  for (let i = 0; i < REF.mc; i++) {
    const vx = rnd() - 0.5, vy = rnd() - 0.5, vz = rnd() - 0.5, l = Math.hypot(vx, vy, vz) || 1;
    if (Math.abs((vx / l) * S * rnd()) < R) hit++;
  }
  return hit / REF.mc;
}

/** Expected damage of one volley on a single target (armour per hit). */
export function volleySingle(w: W, t: T): number {
  if (!inRange(w, t)) return 0;
  const A = t.armour, ap = w.ap, ns = split(w);
  // Split rounds (rockets too) fan protoFan° apart: their offsets at the target.
  const offs = Array.from({ length: ns }, (_, i) => (i - (ns - 1) / 2) * fanAt(t.dist, w.kind !== "gun"));
  if (w.kind === "gun") {
    const p = hitscanP(w, t);
    const rounds = offs.filter((o) => Math.abs(o) < t.r + w.sheetHalf).length;
    return p * rounds * rate(w) * multi(w) * thru(w.dmg * t.directK, A, ap) * w.n;
  }
  if (w.kind === "rail") return REF.aimSkill * (t.juke >= 0.5 ? 0.8 : 1) * thru(w.dmg * t.directK, A, ap);
  const x = w.x ?? {};
  if (w.kind === "melee") return (t.juke >= 0.5 ? REF.swingLandsJuke : REF.swingLands) * thru(w.dmg * t.directK, A, ap);
  if (w.kind === "lance") return REF.aimSkill * (t.juke >= 0.5 ? 0.8 : 1) * (thru(w.dmg * t.directK, A, ap) + thru(x.blast * t.blastK, A, ap));
  if (w.kind === "sunder") return REF.aimSkill * x.ticks * thru(w.dmg * t.directK, A, ap);
  if (w.kind === "arc") return thru(w.dmg * t.directK, A, ap); // it seeks the nearest enemy to the aim: no aim error
  if (w.kind === "orb") {
    // A slow orb burning everything within its radius as it passes: ticks while the body is inside its path.
    const sg = sigma(w, t), R = w.radius + t.r, per = thru(w.dmg / ENERGY_DEFAULTS.orbTicks, A, ap);
    let sum = 0;
    for (let i = 0; i < REF.mc; i++) { const e = Math.abs(gauss() * sg); if (e < R) sum += (2 * Math.sqrt(R * R - e * e) / w.speed) * ENERGY_DEFAULTS.orbTicks * per; }
    return sum / REF.mc;
  }
  // Projectiles and blasts: Monte Carlo over the aim error.
  const s = sigma(w, t);
  let sum = 0;
  for (let i = 0; i < REF.mc; i++) {
    const ex = gauss() * s, ez = gauss() * s;
    if (w.kind === "line") {
      // Shells every L/n along a strip snapped through the target; the target sits at a random point along it.
      const gap = w.stripLength / w.n, at = rnd() * gap;
      for (let k = -2; k <= 2; k++) sum += thru(w.dmg * t.blastK * fall(Math.max(0, Math.hypot(ex, ez + at + k * gap) - t.r), w.radius), A, ap);
      continue;
    }
    if (w.kind === "cannon") {
      const e = Math.hypot(ex, ez);
      if (e < t.r + w.sheetHalf) sum += thru(w.dmg * t.directK, A, ap);
      else sum += thru(w.dmg * w.share * t.blastK * fall(e - t.r, w.radius), A, ap);
      continue;
    }
    for (const o of offs) sum += thru(w.dmg * t.blastK * fall(Math.max(0, Math.hypot(ex + o, ez) - t.r), w.radius), A, ap) * w.n;
  }
  return (sum / REF.mc) * multi(w);
}

/** HP removed from a swarm by an area of radius r and damage d at its centre (a ring integral at density rho, each
 *  unit's share capped at its hp), less the unit at the centre when `skipCentre`. */
export function ringHp(d: number, r: number, t: T, ap: number, skipCentre: boolean): number {
  const sw = t.swarm!, Rc = Math.sqrt(sw.n / sw.rho / Math.PI), R = Math.min(r + t.r, Rc);
  let s = 0;
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const a = (i + 0.5) * (R / steps), x = Math.max(0, a - t.r);
    s += Math.min(t.hp, thru(d * fall(x, r), t.armour, ap)) * sw.rho * 2 * Math.PI * a * (R / steps);
  }
  if (skipCentre) s = Math.max(0, s - Math.min(t.hp, thru(d, t.armour, ap)));
  return s;
}

/** Expected HP removed from a swarm cluster by one volley. */
export function volleySwarm(w: W, t: T): number {
  if (!inRange(w, t) || !t.swarm) return 0;
  const sw = t.swarm, ap = w.ap, cap = (x: number) => Math.min(t.hp, thru(x, t.armour, ap));
  const Rc = Math.sqrt(sw.n / sw.rho / Math.PI);
  const line = (d0: number, pen: number, half: number) => {
    // Bodies along a line through the cluster, each paying its chord × density from the budget; damage by budget left.
    const perM = sw.rho * 2 * (t.r + half), gap = 1 / perM, cost = ((Math.PI * t.r) / 2) * t.penDensity;
    let left = pen, s = 0, along = 0, first = true;
    while (along < Rc * 1.2) {
      if (!first && left <= 0) break;
      const k = first ? 1 : Math.pow(Math.max(0, left) / Math.max(1e-6, pen), PEN_DEFAULTS.penCurve);
      s += cap(d0 * k);
      left -= cost; along += gap; first = false;
    }
    return s;
  };
  if (w.kind === "gun") {
    const d = w.dmg, sh = w.shot;
    let per = line(d, w.pen, w.sheetHalf) + ringHp(d * w.share * t.roundSplashK, w.radius * (sh.area ?? 1), t, ap, true);
    let chain = 0, k = 1;
    for (let i = 0; i < (sh.chain ?? 0); i++) { k *= SHOT_DEFAULTS.protoChainKeep; chain += k; }
    per += cap(d) * chain + cap(d * SHOT_DEFAULTS.protoRicochetKeep) * (sh.ricochet ? 0.6 : 0);
    return per * split(w) * rate(w) * multi(w) * w.n;
  }
  if (w.kind === "rail") return line(w.dmg, w.pen, w.sheetHalf);
  const x = w.x ?? {};
  if (w.kind === "melee") {
    // One cut sweeps a sector of its reach; the cleave budget stops it after so many bodies.
    const sector = Math.PI * (w.range + t.r) ** 2 * (x.arc / 360) * sw.rho, cleaveBodies = 1 + w.pen / (((Math.PI * t.r) / 2) * t.penDensity);
    return REF.swingLands * Math.min(sw.n, sector, cleaveBodies) * cap(w.dmg);
  }
  if (w.kind === "lance") return cap(w.dmg) + ringHp(x.blast, w.radius, t, ap, true);
  if (w.kind === "sunder") {
    const area = 2 * Rc * (2 * (w.sheetHalf + t.r) + REF.sunderSweep * x.ticks / Math.max(1, ENERGY_DEFAULTS.sunderTicks));
    return Math.min(sw.n, area * sw.rho) * cap(w.dmg * x.ticks);
  }
  if (w.kind === "arc") {
    let s = 0, d = w.dmg;
    for (let h = 0; h <= x.hops; h++) { s += ringHp(d, x.splash, t, ap, false); d *= x.keep; }
    return Math.min(sw.n * t.hp, s);
  }
  if (w.kind === "orb") {
    const bodies = Math.min(sw.n, 2 * (w.radius + t.r) * 2 * Rc * sw.rho);
    return bodies * cap((w.dmg * (Math.PI / 2) * w.radius) / w.speed);
  }
  if (w.kind === "cannon") return (line(w.dmg, w.pen, w.sheetHalf) + ringHp(w.dmg * w.share, w.radius, t, ap, true)) * multi(w);
  if (w.kind === "line") {
    const L = Math.min(w.stripLength, 2 * Rc);
    return Math.min(sw.n, L * 2 * w.radius * sw.rho) * cap(w.dmg);
  }
  // Rocket, mortar, missiles: each blast's ring; split rockets' blasts overlap, so the units in their union at most.
  const ns = split(w), one = ringHp(w.dmg, w.radius, t, ap, false);
  if (ns > 1) {
    const r = w.radius + t.r, s = fanAt(t.dist, true), union = Math.PI * r * r + (ns - 1) * Math.min(2 * r, s) * 2 * r;
    return Math.min(sw.n * t.hp, one * ns, union * sw.rho * Math.min(t.hp, thru(w.dmg * 0.75, t.armour, ap)));
  }
  return Math.min(sw.n * t.hp, one * w.n);
}

/** Uptime over an engagement: spin-up paid once per engagement for guns. */
export const uptime = (w: W, t: T) => {
  // A sword walks in first: the mech at its sprint, less what the target backs off (a swarm runs at it).
  if (w.kind === "melee") {
    const gap = Math.max(0, t.dist - w.range), close = gap / Math.max(1, t.swarm ? REF.closeSpeed + t.speed : REF.closeSpeed - t.speed * t.juke);
    return (t.engage / (t.engage + close + w.latency)) * (t.swarm ? 1 : 1 - REF.meleeStick * t.juke);
  }
  return w.kind === "gun" || w.kind === "cannon" ? t.engage / (t.engage + w.latency) : 1;
};
/** Effective DPS, sustained (magazines and reloads counted) or within a magazine (`burst`: the Protocols' price tag). */
export function eDps(w: W, t: T, burst = false): number {
  const v = t.swarm ? volleySwarm(w, t) : volleySingle(w, t);
  return (v / (burst ? w.burst : w.cycle)) * uptime(w, t);
}

/** Time to kill one target of hp (first volley after the latency, then every cycle). */
export function ttk(w: W, t: T, hp: number): number {
  const flight0 = w.flight ?? (Number.isFinite(w.speed) ? t.dist / w.speed : 0);
  if (t.swarm) {
    // Clear a whole pack: the cluster keeps its area as it thins, so area damage falls with the units left.
    const A = t.swarm.n / t.swarm.rho;
    let n = t.swarm.n, time = w.latency + flight0, guard = 0;
    while (n > 0.5 && guard++ < 10000) {
      const v = volleySwarm(w, { ...t, swarm: { n, rho: n / A } }) * uptime(w, t);
      if (v <= 1e-6) return Infinity;
      n -= v / t.hp;
      if (n > 0.5) time += w.cycle;
    }
    return time;
  }
  const v = volleySingle(w, t);
  if (v <= 0) return Infinity;
  const vol = Math.ceil(hp / v - 1e-9);
  return w.latency + flight0 + (vol - 1) * w.cycle;
}

