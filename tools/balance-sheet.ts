// Balance sheet (docs/proposal-balance.md): reads the live item, weapon, Protocol and enemy tables and prints, for every
// weapon and shoulder launcher at level 1 Common (middle rolls): its effective DPS against five reference target sets,
// the share of its slot's budget that is, time to kill per enemy, what each Protocol is worth against each set (its
// niche is the best one), magazines, level growth, and how long the player mech lasts under fire. A model, not the sim:
// hit chance and area are expected values from simple geometry (seeded Monte Carlo).
//   npx tsx tools/balance-sheet.ts           the live values
//   npx tsx tools/balance-sheet.ts --check   exit 1 if a weapon is over 130% of its budget against its best set, or a
//                                            behaviour Protocol's niche multiplier is outside ×1.1-1.5 (npm test)
// Cadence (damage, rounds per shot, sustained shots/s over the magazine and reload) comes from src/items/dps.ts, the
// same function the item cards show; armour from src/game/armour.ts. Every other assumption is in REF and targets().
import { BASE_BY_ID } from "../src/items/bases";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { MECH_DEFAULTS } from "../src/game/mechUnit";
import { ROBOT_DEFAULTS } from "../src/combat/robots";
import { WARBAND_DEFAULTS } from "../src/combat/warband";
import { BUS_DEFAULTS } from "../src/combat/partyBus";
import { INFANTRY_DEFAULTS } from "../src/combat/infantry";
import { PEN_DEFAULTS } from "../src/game/sheet";
import { SHOT_DEFAULTS, type ShotProtocols } from "../src/game/shots";
import { PROTOCOLS, PROTOCOL_BY_ID, protocolFits, shotProtocolsOf, shotCostOf } from "../src/items/protocols";
import { LOOT_DEFAULTS, makeItem, protocolItem } from "../src/items/generate";
import { levelPower } from "../src/items/level";
import { effectiveStats } from "../src/items/loadout";
import { cadenceOf, dpsOf, itemDpsPair, type Cadence } from "../src/items/dps";
import { armourHit } from "../src/game/armour";
import { roundPenFor } from "../src/game/mechUnit";
import type { Item } from "../src/items/item";

const proc = (globalThis as unknown as { process: { argv: string[]; exit(c: number): never } }).process;
const args = proc.argv.slice(2);
const CHECK = args.includes("--check");
if (args.includes("--proposed")) console.log("(--proposed is gone: the proposal's values are live since 2026-10-31)");

// ---------------------------------------------------------------- reference assumptions (the model's knobs)
const REF = {
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
};
const armourFloor = WEAPON_DEFAULTS.armourFloor;
const thru = (d: number, A: number, ap: number) => armourHit(d, A, ap, armourFloor);

// ---------------------------------------------------------------- seeded random (deterministic output)
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());

// ---------------------------------------------------------------- weapons (from items: the cards' cadence)
type Kind = "gun" | "rail" | "cannon" | "rocket" | "missiles" | "mortar" | "line";
interface W {
  id: string; name: string; slot: "L" | "M" | "H" | "shoulder"; kind: Kind;
  /** Damage per round, rounds per volley (missiles, shells; a split's rounds ride in `shot`), seconds per volley
   *  sustained (magazine and reload counted) and within a magazine (burst), first-volley latency. */
  dmg: number; n: number; cycle: number; burst: number; latency: number;
  radius: number; share: number; pen: number; spread: number; speed: number; range: number; sheetHalf: number; flight?: number;
  ap: number; scatter: number; stripLength: number;
  shot: ShotProtocols; cad: Cadence; item: Item;
}
const WD = { ...WEAPON_DEFAULTS };
const MD = { ...MECH_DEFAULTS };
const SLOT: Record<string, W["slot"]> = { L: "L", M: "M", H: "H" };

/** A weapon as the model sees it, from an item (its Protocols included: their stat mods, split, rate, cost). */
function wOf(item: Item): W {
  const b = BASE_BY_ID[item.base], s = effectiveStats(item), shot = shotProtocolsOf(item.socketed) ?? {};
  const cad = cadenceOf(s, shot, shotCostOf(item.socketed))!;
  const sh = b.kind === "shoulder";
  const common = { id: b.id, name: b.name + (item.socketed.length ? ` +${item.socketed.map((p) => PROTOCOL_BY_ID[p.base].name).join("+")}` : ""), slot: sh ? "shoulder" as const : SLOT[b.size ?? "M"],
    dmg: s.damage, cycle: 1 / cad.sustained, burst: 1 / cad.rate, ap: s.ap ?? 0, shot, cad, item, stripLength: 0 };
  const cls = b.cls ?? (sh ? b.shoulder : "minigun");
  if (cls === "minigun") return { ...common, kind: "gun", n: 1, latency: s.spinUp, radius: MD.roundSplash, share: MD.roundSplashShare, pen: roundPenFor(MD, s.pierce),
    spread: s.spread, speed: Infinity, range: s.range, sheetHalf: MD.roundSheetHalf, scatter: 0 };
  if (cls === "rail") {
    const light = b.size === "L";
    return { ...common, kind: "rail", n: 1, latency: s.charge, radius: 0, share: 0, pen: WD.railPen * (light ? WD.railLightPen : 1), spread: 0, speed: Infinity, range: s.range, sheetHalf: WD.railSheetHalf, scatter: 0 };
  }
  if (cls === "autocannon") return { ...common, kind: "cannon", n: 1, latency: s.spinUp, radius: s.splash, share: WD.acSplashShare, pen: WD.acPen, spread: s.spread, speed: s.shellSpeed, range: s.range, sheetHalf: WD.acSheetHalf, scatter: 0 };
  if (cls === "rpg") return { ...common, kind: "rocket", n: 1, cycle: common.cycle + (sh ? REF.paint / Math.max(1, s.magazine ?? 1) : 0), latency: sh ? REF.paint : 0, radius: s.blast, share: 1, pen: 0, spread: 0, speed: s.shellSpeed, range: WD.rpgRange, sheetHalf: 0, scatter: 0.5 };
  if (cls === "missiles") return { ...common, kind: "missiles", n: s.rockets, cycle: common.cycle + REF.paint, latency: REF.paint + 1, radius: s.blast, share: 1, pen: 0, spread: 0, speed: WD.swarmSpeed, range: 70, sheetHalf: 0, scatter: WD.swarmFan * 0.5 };
  if (cls === "mortar") return { ...common, kind: "mortar", n: WD.mortarShells, cycle: common.cycle + REF.paint, latency: REF.paint + WD.mortarFlight, radius: s.blast, share: 1, pen: 0, spread: 0, speed: Infinity, flight: WD.mortarFlight, range: WD.mortarMaxRange, sheetHalf: 0, scatter: WD.mortarRing * 0.5 };
  return { ...common, kind: "line", n: s.shells, cycle: common.cycle + REF.paint, latency: REF.paint + 0.9, radius: s.blast, share: 1, pen: 0, spread: 0, speed: WD.salvoSpeed, range: WD.salvoMaxRange, sheetHalf: 0, scatter: WD.salvoScatter, stripLength: s.stripLength };
}

const withProtos = (base: string, ids: string[]): Item => {
  const it = makeItem(base);
  for (const id of ids) it.socketed.push(protocolItem(PROTOCOL_BY_ID[id], 1));
  return it;
};
const WEAPON_IDS = ["mg-light", "mg-medium", "mg-heavy", "rail-light", "rail-medium", "ac-medium", "rpg-light", "rpg-medium", "sh-rpg", "sh-missiles", "sh-mortar", "sh-linemortar"];

// ---------------------------------------------------------------- targets (live hp and armour)
interface T {
  id: string; name: string; hp: number; r: number; speed: number; juke: number; dist: number; engage: number;
  armour: number; penDensity: number;
  /** Damage share by how it lands: direct (part mix), a round's splash, an explosive's blast. */
  directK: number; roundSplashK: number; blastK: number;
  swarm?: { n: number; rho: number };
}
const RB = ROBOT_DEFAULTS, WB = WARBAND_DEFAULTS;
const robotR = (size: number, k: number) => size * k * RB.robotHitScale;
const HULL = BASE_BY_ID["hull-rampart"].stats;

function targets(): T[] {
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
const OTHERS: [string, number, number, string][] = [
  ["Bandit (foot)", INFANTRY_DEFAULTS.hp, 0, "swarm"],
  ["Gun truck", WB.truckHull, WB.truckArmour, "raider"],
  ["Six-wheeler", WB.sixHull, WB.sixArmour, "raider"],
  ["War Rig", WB.rigHull, WB.rigArmour, "raider"],
  ["Turret truck", WB.turretHull, WB.turretArmour, "raider"],
  ["Party bus", BUS_DEFAULTS.busHull, WB.busArmour, "raider"],
  ["Bandit mech", WB.banditMechHull, WB.banditMechArmour, "rival"],
];

// ---------------------------------------------------------------- the model
const fall = (x: number, r: number) => (x > r ? 0 : 1 - (0.5 * x) / Math.max(1e-6, r));
const inRange = (w: W, t: T) => w.range >= t.dist;
const split = (w: W) => Math.max(1, Math.round(w.shot.split ?? 1));
const rate = (w: W) => Math.max(1, Math.round(w.shot.rate ?? 1));
/** Double shot's side-by-side copies (0.5 m apart: every copy lands where the one would). */
const multi = (w: W) => Math.max(1, Math.round(w.shot.multi ?? 1));
const fanAt = (d: number, rocket = false) => d * Math.tan(((rocket ? SHOT_DEFAULTS.protoRocketFan : SHOT_DEFAULTS.protoFan) * Math.PI) / 180);

/** Aim error σ (m, each axis) at the target for a projectile: lead error from the target's juke over the flight. */
function sigma(w: W, t: T): number {
  const flight = w.flight ?? (Number.isFinite(w.speed) ? t.dist / w.speed : 0);
  const homing = w.kind === "missiles" ? 0.3 : 1;
  return Math.hypot(t.speed * flight * t.juke * homing, w.scatter, t.dist * Math.tan((w.spread * Math.PI) / 180) * 0.5);
}

/** Share of rounds within reach of a single target for a hitscan gun (the mech spread: radius tan(spread)·U). */
function hitscanP(w: W, t: T): number {
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
function volleySingle(w: W, t: T): number {
  if (!inRange(w, t)) return 0;
  const A = t.armour, ap = w.ap, ns = split(w);
  // Split rounds (rockets too) fan protoFan° apart: their offsets at the target.
  const offs = Array.from({ length: ns }, (_, i) => (i - (ns - 1) / 2) * fanAt(t.dist, w.kind !== "gun"));
  if (w.kind === "gun") {
    const p = hitscanP(w, t);
    const rounds = offs.filter((o) => Math.abs(o) < t.r + w.sheetHalf).length;
    return p * rounds * rate(w) * multi(w) * thru(w.dmg * t.directK, A, ap);
  }
  if (w.kind === "rail") return REF.aimSkill * (t.juke >= 0.5 ? 0.8 : 1) * thru(w.dmg * t.directK, A, ap);
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
function ringHp(d: number, r: number, t: T, ap: number, skipCentre: boolean): number {
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
function volleySwarm(w: W, t: T): number {
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
    return per * split(w) * rate(w) * multi(w);
  }
  if (w.kind === "rail") return line(w.dmg, w.pen, w.sheetHalf);
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
const uptime = (w: W, t: T) => (w.kind === "gun" || w.kind === "cannon" ? t.engage / (t.engage + w.latency) : 1);
/** Effective DPS, sustained (magazines and reloads counted) or within a magazine (`burst`: the Protocols' price tag). */
function eDps(w: W, t: T, burst = false): number {
  const v = t.swarm ? volleySwarm(w, t) : volleySingle(w, t);
  return (v / (burst ? w.burst : w.cycle)) * uptime(w, t);
}

/** Time to kill one target of hp (first volley after the latency, then every cycle). */
function ttk(w: W, t: T, hp: number): number {
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

// ---------------------------------------------------------------- printing
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lp = (s: string | number, n: number) => String(s).padStart(n);
const f0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toString() : "-");
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const problems: string[] = [];

const W_ = WEAPON_IDS.map((id) => wOf(makeItem(id))), T_ = targets();
console.log(`=== Balance sheet (live values), level 1 Common, middle rolls; budget ${REF.budget} eDPS per mount; armour floor ${armourFloor} ===`);
console.log(`targets: ${T_.map((t) => `${t.name} hp ${t.hp}${t.armour ? ` arm ${t.armour}` : ""}`).join(" | ")}`);
console.log(`(budget % uses set weights ${JSON.stringify(REF.setWeight)})\n`);

// 1. Items: cadence (the cards' numbers) and the rest of what the model reads.
console.log("-- Items (cadence from src/items/dps.ts: the card's DPS is damage × rounds × sustained shots/s) --");
console.log(pad("item", 20) + lp("slot", 5) + lp("dmg", 7) + lp("/vol", 5) + lp("shots/s", 8) + lp("sust", 6) + lp("mag", 5) + lp("reload", 7) + lp("card", 6) + lp("area", 6) + lp("pen", 6) + lp("ap", 5) + lp("speed", 7) + lp("range", 6));
for (const w of W_) {
  const c = w.cad;
  console.log(pad(w.name, 20) + lp(w.slot, 5) + lp(f1(w.dmg), 7) + lp(c.rounds, 5) + lp(c.rate.toFixed(2), 8) + lp(c.sustained.toFixed(2), 6) + lp(c.magazine || "-", 5) + lp(c.reload ? c.reload.toFixed(1) : "-", 7)
    + lp(f0(dpsOf(c)), 6) + lp(f1(w.radius), 6) + lp(f1(w.pen), 6) + lp(w.ap.toFixed(2), 5) + lp(Number.isFinite(w.speed) ? f0(w.speed) : w.flight ? `${w.flight}s` : "inst", 7) + lp(w.range, 6));
}

// 2. Effective DPS matrix and budget share.
console.log("\n-- Effective DPS (sustained) by target set; [% of slot budget]; role = best set --");
console.log(pad("item", 20) + T_.map((t) => lp(t.id, 14)).join("") + "   best   off-role mean");
for (const w of W_) {
  const budget = REF.budget * REF.slotShare[w.slot];
  const e = T_.map((t) => eDps(w, t));
  const pct = e.map((x, i) => (100 * x) / (budget * (REF.setWeight[T_[i].id] ?? 1)));
  const best = Math.max(...pct), bi = pct.indexOf(best);
  const off = pct.filter((_, i) => i !== bi), offMean = off.reduce((a, b) => a + b, 0) / off.length;
  if (best > 130) problems.push(`${w.name} ${f0(best)}% of budget vs ${T_[bi].id}`);
  console.log(pad(w.name, 20) + e.map((x, i) => lp(`${f0(x)} [${f0(pct[i])}]`, 14)).join("") + `   ${pad(T_[bi].id, 9)} ${f0(offMean)}%`);
}

// 3. Time to kill.
console.log("\n-- Time to kill, one weapon alone (s; '-' out of range or no damage) --");
const ttkRows: [string, number, T][] = T_.filter((t) => t.id !== "swarm").map((t) => [t.name, t.hp, t]);
ttkRows.unshift(["Scrapper (one)", T_[0].hp, { ...T_[0], swarm: undefined, dist: 20 }]);
ttkRows.unshift(["Scrapper pack (36)", T_[0].hp * T_[0].swarm!.n, T_[0]]);
for (const [name, hp, arm, like] of OTHERS) {
  const b = T_.find((t) => t.id === like)!;
  ttkRows.push([name, hp, { ...b, swarm: undefined, armour: arm, hp, r: like === "swarm" ? INFANTRY_DEFAULTS.banditRadius : b.r, penDensity: like === "swarm" ? PEN_DEFAULTS.penFlesh : b.penDensity }]);
}
console.log(pad("enemy", 20) + lp("hp", 6) + lp("arm", 4) + W_.map((w) => lp(w.id.replace("sh-", "").slice(0, 9), 10)).join(""));
for (const [name, hp, t] of ttkRows) console.log(pad(name, 20) + lp(hp, 6) + lp(t.armour, 4) + W_.map((w) => lp(f1(ttk(w, t, hp)), 10)).join(""));
const PAIRS: [string, string][] = [["mg-medium", "mg-medium"], ["mg-medium", "rail-medium"], ["ac-medium", "rpg-medium"], ["rail-medium", "ac-medium"], ["mg-medium", "rpg-medium"]];
console.log("\n-- Time to kill with a pair on the two mounts (both firing: 1/(1/a + 1/b) of the single times; s) --");
console.log(pad("enemy", 20) + PAIRS.map(([a, b]) => lp(`${a.split("-")[0]}+${b.split("-")[0]}`, 11)).join(""));
for (const [name, hp, t] of ttkRows) {
  console.log(pad(name, 20) + PAIRS.map(([a, b]) => {
    const wa = W_.find((x) => x.id === a)!, wb = W_.find((x) => x.id === b)!;
    return lp(f1(1 / (1 / ttk(wa, t, hp) + 1 / ttk(wb, t, hp))), 11);
  }).join(""));
}

// 4. Protocols: × each one gives its weapon against every set; its niche is the best. Cards show base → with.
console.log("\n-- Protocols (multiply; Keith 2026-10-31): × the plain weapon's eDPS per target set within a magazine; niche = best set;");
console.log("   sust = the niche × over magazines and reloads (the cost of extra rounds); card = the item card's DPS, base → with --");
const HOSTS = ["mg-medium", "ac-medium", "rpg-light", "rpg-medium", "sh-rpg"];
console.log(pad("host + Protocol", 34) + T_.map((t) => lp(t.id, 10)).join("") + lp("niche", 9) + lp("", 10) + lp("sust", 7) + "   card");
for (const host of HOSTS) {
  const plain = W_.find((x) => x.id === host)!, base = T_.map((t) => eDps(plain, t, true)), baseS = T_.map((t) => eDps(plain, t));
  for (const p of PROTOCOLS) {
    if (!protocolFits(p, BASE_BY_ID[host].tags)) continue;
    const item = withProtos(host, [p.id]), w = wOf(item);
    const mul = T_.map((t, i) => (base[i] > 0 ? eDps(w, t, true) / base[i] : 0));
    const best = Math.max(...mul), bi = mul.indexOf(best);
    const sust = baseS[bi] > 0 ? eDps(w, T_[bi]) / baseS[bi] : 0;
    const card = itemDpsPair(item)!;
    console.log(pad(`${BASE_BY_ID[host].name} + ${p.name}`, 34) + mul.map((x) => lp(`×${x.toFixed(2)}`, 10)).join("") + lp(`×${best.toFixed(2)}`, 9) + ` ${T_[bi].id.padEnd(9)} ×${sust.toFixed(2)}   ${f0(card.base)} → ${f0(card.withProtocols)}`);
    // Behaviour Protocols (split, rate, area, chain, ricochet) and the damage one are held to Keith's ×1.2-1.3 band.
    if ((p.shot || p.id === "overpressure") && (best < REF.nicheLo || best > REF.nicheHi)) problems.push(`${p.name} on the ${BASE_BY_ID[host].name}: niche ×${best.toFixed(2)} (want ×${REF.nicheLo}-${REF.nicheHi})`);
  }
}
// Stacking multiplies: two Protocols on one gun against their shared niche set (no cap, Keith 2026-10-31).
{
  const host = "mg-medium", ids = ["splitter", "overclock"], sw = T_[0];
  const plain = eDps(W_.find((x) => x.id === host)!, sw, true);
  const a = eDps(wOf(withProtos(host, [ids[0]])), sw, true) / plain, b = eDps(wOf(withProtos(host, [ids[1]])), sw, true) / plain;
  const both = eDps(wOf(withProtos(host, ids)), sw, true) / plain;
  console.log(`Stack on the ${BASE_BY_ID[host].name} vs the swarm (within a magazine): ${ids.join(" × ")} = ×${a.toFixed(2)} × ×${b.toFixed(2)} → ×${both.toFixed(2)} measured (product ×${(a * b).toFixed(2)})`);
  const four = ["splitter", "overclock", "arcLink", "wideBore"], w4 = wOf(withProtos(host, four)), p0 = W_.find((x) => x.id === host)!;
  console.log(`Legendary stack (${four.join(", ")}) vs swarm: ×${(eDps(w4, sw, true) / plain).toFixed(2)} within a magazine, ×${(eDps(w4, sw) / eDps(p0, sw)).toFixed(2)} sustained; vs rival ×${(eDps(w4, T_[4], true) / eDps(p0, T_[4], true)).toFixed(2)}`);
}

// 5. Armour: what each weapon keeps per hit against each armour value.
console.log("\n-- Armour: damage kept per hit at armour 0 / 3 / 8 / 10 / 12 (floor " + armourFloor + ") --");
console.log(pad("item", 20) + lp("ap", 6) + [0, 3, 8, 10, 12].map((a) => lp(`arm ${a}`, 9)).join(""));
for (const w of W_) console.log(pad(w.name, 20) + lp(w.ap.toFixed(2), 6) + [0, 3, 8, 10, 12].map((a) => lp(`${f0((100 * thru(w.dmg, a, w.ap)) / w.dmg)}%`, 9)).join(""));

// 6. Level: one curve for items and enemies (src/items/level.ts).
console.log(`\n-- Level: P(n) = 1 + ${LOOT_DEFAULTS.levelGrowth} × (n − 1) on item damage and hull, and on robots' hp and damage at the area's level (1 + depth / 100 m) --`);
console.log([1, 6, 11, 21, 41, 60].map((n) => `L${n} ×${levelPower(n, LOOT_DEFAULTS.levelGrowth).toFixed(2)}`).join("  ") + "   (time to kill holds at level; deeper camps are bigger, not tougher per robot)");

// 7. The player mech under fire.
const hull = HULL.hull.base, arm = HULL.armour.base;
console.log(`\n-- The player mech (hull ${hull}, armour ${arm}) under fire: incoming DPS (expected), seconds to live --`);
const MG = BASE_BY_ID["mg-medium"].stats;
const mg = (n: number, k: number) => n * MG.fireRate.base * thru(MG.damage.base * k, arm, MG.ap.base) * 0.4;
const rows: [string, number][] = [
  ["24 scrappers (20% shooters, biters latched)", 24 * 0.8 * (RB.robotBiteDamage / RB.robotBiteInterval) + 24 * RB.robotShooterShare * (RB.robotShotDamage / RB.robotShotInterval) * 0.6],
  ["3 cutters (half shoot, half cut)", 1.5 * (RB.robotMidShotDamage / RB.robotMidShotInterval) * 0.6 + 1.5 * RB.robotMidCutDamage / (RB.robotMidCutWindup + RB.robotMidLungeTime + RB.robotMidCutRecover)],
  ["1 excavator (lobs)", (RB.robotBigBurst * RB.robotBigShotDamage) / (RB.robotBigBurst * RB.robotBigRoundInterval + RB.robotBigPause) * 0.5],
  // The charging beam (2026-10-31): through armour by its pierce; half of them dodged (a side step after the lock).
  ["1 excavator (beam, half dodged)", thru(RB.robotBeamDamage, arm, RB.robotBeamPierce) / (RB.robotBeamCooldown + RB.robotBeamCharge + RB.robotBeamBurn) * 0.5],
  ["War band (5 tech, 2 truck, 1 six, 1 turret)", (5 * WB.techRate * WB.techDamage + 2 * WB.truckRate * WB.truckDamage + WB.sixRate * WB.sixDamage + WB.turretRate * WB.turretDamage) * 0.5],
  ["Bandit mech (2 miniguns, through armour)", mg(2, WB.banditMechDamage)],
  ["Rival mech (2 miniguns, through armour)", mg(2, 1)],
  ["Rival mech (minigun + rail)", mg(1, 1) + (REF.aimSkill * 0.8 * thru(WD.railDamage, arm, WD.railAp)) / (WD.railCharge + WD.railCooldown)],
];
for (const [n, d] of rows) console.log(pad(n, 50) + lp(f0(d), 6) + " dps" + lp(f1(hull / d), 8) + " s");
console.log("(bites, saws, raider guns and burns name no pierce: they ignore armour; mech guns pay it)");

if (problems.length) console.log(`\nOut of band: ${problems.join("; ")}`);
if (CHECK && problems.length) proc.exit(1);
if (CHECK) console.log("\nbalance sheet check passed");
