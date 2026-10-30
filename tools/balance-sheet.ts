// Balance sheet (docs/proposal-balance.md): reads the live item, weapon and enemy tables and prints, for every weapon
// and shoulder item at level 1 Common (middle rolls): its effective DPS against five reference target sets, the share of
// its slot's budget that is, time to kill per enemy, what Protocols and feeds are worth, level and depth growth, and how
// long the player mech lasts against packs. A model, not the sim: hit chance and area are expected values from simple
// geometry (seeded Monte Carlo), so a change can be judged by numbers before anyone plays it.
//   npx tsx tools/balance-sheet.ts             today's values (armour 0 everywhere: there is no armour yet)
//   npx tsx tools/balance-sheet.ts --proposed  the proposal's values (armour on, retuned weapons and enemies)
//   npx tsx tools/balance-sheet.ts --check     exit 1 if any weapon is over 130% of its budget against its best set
// Every assumption the model makes (reference distances, densities, aim skill, juke) is in REF below.
import { BASE_BY_ID, type Base } from "../src/items/bases";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { UPPER_DEFAULTS } from "../src/mech/upper";
import { MECH_DEFAULTS } from "../src/game/mechUnit";
import { ROBOT_DEFAULTS } from "../src/combat/robots";
import { WARBAND_DEFAULTS } from "../src/combat/warband";
import { BUS_DEFAULTS } from "../src/combat/partyBus";
import { INFANTRY_DEFAULTS } from "../src/combat/infantry";
import { PEN_DEFAULTS } from "../src/game/sheet";
import { SHOT_DEFAULTS } from "../src/game/shots";
import { PROTOCOLS } from "../src/items/protocols";
import { LOOT_DEFAULTS } from "../src/items/generate";
import { levelMul } from "../src/items/level";
import { itemDps } from "../src/items/power";
import type { Item } from "../src/items/item";

const args = process.argv.slice(2);
const PROPOSED = args.includes("--proposed");
const CHECK = args.includes("--check");

// ---------------------------------------------------------------- reference assumptions (the model's knobs)
const REF = {
  /** Per-mount budget at level 1: effective DPS a Medium weapon should reach against its best target set. */
  budget: 150,
  /** Budget share by slot: a Light held weapon sits on one mount (the arm adds arc, tracking, salvage), a Heavy takes
   *  both mounts, a shoulder launcher is extra on top of the mounts (keyed, cooldown). */
  slotShare: { L: 0.9, M: 1, H: 1.9, shoulder: 0.5 } as Record<string, number>,
  /** Budget weight per target set: area weapons are expected to take about twice the hp per second out of a camp-density
   *  swarm that a single-target gun takes out of one body (the pack-clear target, docs/proposal-balance.md). */
  setWeight: { swarm: 2, cutter: 1, excavator: 1, raider: 1, rival: 1 } as Record<string, number>,
  /** Seconds of a typical engagement per target set (spin-up and first-volley latency are paid once per one). */
  aimSkill: 0.85, // share of no-assist shots (rail) that land on a still-ish target; ×0.8 more against a juking mech
  paint: 0.4, // seconds of hold-to-paint before a shoulder launcher fires
  mc: 4000, // Monte Carlo samples
  armourFloor: 0.15, // a hit keeps at least this share of its damage through armour (proposal)
};

// ---------------------------------------------------------------- seeded random (rule 12 habit; deterministic output)
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());

// ---------------------------------------------------------------- weapons
type Kind = "gun" | "rail" | "cannon" | "rocket" | "missiles" | "mortar" | "line" | "feed" | "power";
interface W {
  id: string; name: string; slot: "L" | "M" | "H" | "shoulder"; kind: Kind;
  dmg: number; n: number; cycle: number; latency: number;
  /** Splash or blast radius (m) and the share of dmg it does to others at its centre (half at its edge). */
  radius: number; share: number;
  pen: number; spread: number; speed: number; range: number; sheetHalf: number; flight?: number;
  /** Armour pierce 0..1: the share of a target's armour a hit ignores (proposal; 0 today). */
  ap: number;
  ammoSec?: number; weight: number; scatter: number;
  base: Base;
}

const WD = { ...WEAPON_DEFAULTS };
const MD = { ...MECH_DEFAULTS };
const mid = (b: Base, k: string) => b.stats[k]?.base;

/** Proposal patches, applied with --proposed (docs/proposal-balance.md, "Proposed level-1 values"). */
const P_WEAPON: Record<string, Partial<W>> = {
  "mg-light": { dmg: 9, cycle: 1 / 15, ap: 0 },
  "mg-medium": { dmg: 12, cycle: 1 / 12, ap: 0.1 },
  "mg-heavy": { dmg: 20, cycle: 1 / 14, ap: 0.25 },
  "rail-light": { dmg: 300, ap: 0.8 },
  "rail-medium": { dmg: 450, ap: 0.9 },
  "ac-medium": { dmg: 50, ap: 0.5 },
  "rpg-medium": { dmg: 300, ap: 0.6 },
  "sh-rpg": { dmg: 300, ap: 0.6 },
  "sh-missiles": { dmg: 60, ap: 0.3 },
  "sh-mortar": { dmg: 650, cycle: 8.4, ap: 0.4 },
  "sh-linemortar": { dmg: 140, cycle: 4.4, radius: 3.2, ap: 0.3 },
};

function weapons(): W[] {
  const out: W[] = [];
  const add = (w: W) => out.push(PROPOSED && P_WEAPON[w.id] ? { ...w, ...P_WEAPON[w.id] } : w);
  const mgPen = (pierce: number) => MD.roundPen * Math.pow(pierce / MD.roundPierce, MD.roundPenCurve);
  for (const id of ["mg-light", "mg-medium", "mg-heavy"]) {
    const b = BASE_BY_ID[id];
    add({ id, name: b.name, slot: b.size as "L", kind: "gun", dmg: mid(b, "damage"), n: 1, cycle: 1 / mid(b, "fireRate"), latency: mid(b, "spinUp"),
      radius: MD.roundSplash, share: MD.roundSplashShare, pen: mgPen(mid(b, "pierce")), spread: mid(b, "spread"), speed: Infinity, range: mid(b, "range"),
      sheetHalf: MD.roundSheetHalf, ap: 0, ammoSec: UPPER_DEFAULTS.ammoPerGun / mid(b, "fireRate"), weight: b.weight, scatter: 0, base: b });
  }
  for (const id of ["rail-light", "rail-medium"]) {
    const b = BASE_BY_ID[id];
    const pen = WD.railPen * (id === "rail-light" ? WD.railLightPen : 1);
    add({ id, name: b.name, slot: b.size as "L", kind: "rail", dmg: mid(b, "damage"), n: 1, cycle: mid(b, "charge") + mid(b, "cooldown"), latency: mid(b, "charge"),
      radius: 0, share: 0, pen, spread: 0, speed: Infinity, range: mid(b, "range"), sheetHalf: WD.railSheetHalf, ap: 0, weight: b.weight, scatter: 0, base: b });
  }
  {
    const b = BASE_BY_ID["ac-medium"];
    add({ id: b.id, name: b.name, slot: "M", kind: "cannon", dmg: mid(b, "damage"), n: 1, cycle: 1 / mid(b, "fireRate"), latency: mid(b, "spinUp"),
      radius: mid(b, "splash"), share: WD.acSplashShare, pen: WD.acPen, spread: mid(b, "spread"), speed: mid(b, "shellSpeed"), range: mid(b, "range"),
      sheetHalf: WD.acSheetHalf, ap: 0, weight: b.weight, scatter: 0, base: b });
  }
  for (const id of ["rpg-medium", "sh-rpg"]) {
    const b = BASE_BY_ID[id], sh = id.startsWith("sh");
    add({ id, name: b.name, slot: sh ? "shoulder" : "M", kind: "rocket", dmg: mid(b, "damage"), n: 1, cycle: mid(b, "cooldown") + (sh ? REF.paint : 0), latency: sh ? REF.paint : 0,
      radius: mid(b, "blast"), share: 1, pen: 0, spread: 0, speed: mid(b, "shellSpeed"), range: WD.rpgRange, sheetHalf: 0, ap: 0, weight: b.weight, scatter: 0.5, base: b });
  }
  {
    const b = BASE_BY_ID["sh-missiles"];
    add({ id: b.id, name: b.name, slot: "shoulder", kind: "missiles", dmg: mid(b, "damage"), n: mid(b, "rockets"), cycle: mid(b, "cooldown") + REF.paint, latency: REF.paint + 1,
      radius: mid(b, "blast"), share: 1, pen: 0, spread: 0, speed: WD.swarmSpeed, range: 70, sheetHalf: 0, ap: 0, weight: b.weight, scatter: WD.swarmFan * 0.5, base: b });
  }
  {
    const b = BASE_BY_ID["sh-mortar"];
    add({ id: b.id, name: b.name, slot: "shoulder", kind: "mortar", dmg: mid(b, "damage"), n: WD.mortarShells, cycle: mid(b, "cooldown") + REF.paint, latency: REF.paint + WD.mortarFlight,
      radius: mid(b, "blast"), share: 1, pen: 0, spread: 0, speed: Infinity, flight: WD.mortarFlight, range: WD.mortarMaxRange, sheetHalf: 0, ap: 0, weight: b.weight, scatter: WD.mortarRing * 0.5, base: b });
  }
  {
    const b = BASE_BY_ID["sh-linemortar"];
    add({ id: b.id, name: b.name, slot: "shoulder", kind: "line", dmg: mid(b, "damage"), n: mid(b, "shells"), cycle: mid(b, "cooldown") + REF.paint, latency: REF.paint + 1.2,
      radius: mid(b, "blast"), share: 1, pen: 0, spread: 0, speed: WD.salvoSpeed, range: WD.salvoMaxRange, sheetHalf: 0, ap: 0, weight: b.weight, scatter: WD.salvoScatter, base: b });
  }
  return out;
}

// ---------------------------------------------------------------- targets
interface T {
  id: string; name: string; hp: number; r: number; speed: number; juke: number; dist: number; engage: number;
  /** Flat armour per hit (proposal; 0 today) and pen-material density (sheet.ts). */
  armour: number; penDensity: number;
  /** Damage share by how it lands: direct (part mix), a round's splash, an explosive's blast. */
  directK: number; roundSplashK: number; blastK: number;
  swarm?: { n: number; rho: number };
}
const RB = ROBOT_DEFAULTS, WB = WARBAND_DEFAULTS;
const robotR = (size: number, k: number) => size * k * RB.robotHitScale;

/** Proposal patches for enemies (docs/proposal-balance.md, "Enemy health and armour"). */
const P_TARGET: Record<string, Partial<T>> = {
  swarm: { hp: 12, armour: 0 },
  cutter: { hp: 220, armour: 3 },
  excavator: { hp: 1800, armour: 8, blastK: 0.8 },
  raider: { hp: 140, armour: 2 },
  // Mechs take half from mech weapons (one value, like banditMechDamage): a 1500 hull reads as 3000 here.
  rival: { hp: 3000, armour: 8 },
};

function targets(): T[] {
  const t: T[] = [
    { id: "swarm", name: "Swarm cluster", hp: RB.robotHp, r: robotR(RB.robotSize, 0.45), speed: RB.robotRunSpeed, juke: 0.25, dist: 25, engage: 8,
      armour: 0, penDensity: PEN_DEFAULTS.penScrapper, directK: 1, roundSplashK: 1, blastK: 1, swarm: { n: 36, rho: 0.2 } },
    { id: "cutter", name: "Lone cutter", hp: RB.robotMidHp, r: robotR(RB.robotMidSize, 0.44), speed: RB.robotMidSpeed, juke: 0.35, dist: 22, engage: 4,
      armour: 0, penDensity: PEN_DEFAULTS.penCutter, directK: 0.95, roundSplashK: RB.robotMidSplash, blastK: RB.robotMidBlast },
    { id: "excavator", name: "Excavator", hp: RB.robotBigHp, r: robotR(RB.robotBigSize, 0.5), speed: RB.robotBigSpeed, juke: 0.3, dist: 30, engage: 12,
      armour: 0, penDensity: PEN_DEFAULTS.penExcavator, directK: 0.85 + 0.15 * RB.robotLegDamage, roundSplashK: 0, blastK: RB.robotBigBlast },
    { id: "raider", name: "Raider technical", hp: WB.techHull, r: 1.25, speed: 15, juke: 0.5, dist: 28, engage: 6,
      armour: 0, penDensity: PEN_DEFAULTS.penVehicle, directK: 1, roundSplashK: 0, blastK: 1 },
    { id: "rival", name: "Rival mech @35 m", hp: 1500, r: MD.hitRadius, speed: 6, juke: 0.6, dist: 35, engage: 25,
      armour: 0, penDensity: PEN_DEFAULTS.penVehicle, directK: 1, roundSplashK: 0, blastK: 1 },
  ];
  return PROPOSED ? t.map((x) => ({ ...x, ...(P_TARGET[x.id] ?? {}) })) : t;
}

/** Other enemies for the time-to-kill table: [name, hp today, hp proposed, armour proposed, like which target set]. */
const OTHERS: [string, number, number, number, string][] = [
  ["Bandit (foot)", INFANTRY_DEFAULTS.hp, INFANTRY_DEFAULTS.hp, 0, "swarm"],
  ["Gun truck", WB.truckHull, WB.truckHull, 4, "raider"],
  ["Six-wheeler", WB.sixHull, WB.sixHull, 6, "raider"],
  ["War Rig", WB.rigHull, WB.rigHull, 8, "raider"],
  ["Turret truck", WB.turretHull, WB.turretHull, 12, "raider"],
  ["Party bus", BUS_DEFAULTS.busHull, BUS_DEFAULTS.busHull, 5, "raider"],
  ["Bandit mech", WB.banditMechHull, 1800, 6, "rival"],
];

// ---------------------------------------------------------------- the model
/** Damage a hit of d does through armour A with armour pierce ap (proposal: flat per hit, floored). */
const thru = (d: number, A: number, ap: number) => (A <= 0 ? d : Math.max(REF.armourFloor * d, d - A * (1 - ap)));
const fall = (x: number, r: number) => (x > r ? 0 : 1 - (0.5 * x) / Math.max(1e-6, r));
const inRange = (w: W, t: T) => w.range >= t.dist;

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

/** Expected damage of one volley on a single target. */
function volleySingle(w: W, t: T, proto?: Proto): number {
  if (!inRange(w, t)) return 0;
  const A = t.armour, ap = w.ap + (proto?.ap ?? 0);
  if (w.kind === "gun") {
    const pr = proto ?? NONE;
    const p = hitscanP(w, t);
    // Split rounds fan protoFan° apart: only those whose offset lands on the target count.
    let rounds = 0;
    for (let i = 0; i < pr.split; i++) {
      const off = (i - (pr.split - 1) / 2) * t.dist * Math.tan((SHOT_DEFAULTS.protoFan * Math.PI) / 180);
      if (Math.abs(off) < t.r + w.sheetHalf) rounds++;
    }
    const d = w.dmg * pr.dmgK * t.directK;
    return p * rounds * pr.rate * (thru(d, A, ap) + pr.burn);
  }
  if (w.kind === "rail") {
    const skill = REF.aimSkill * (t.juke >= 0.5 ? 0.8 : 1);
    return skill * thru(w.dmg * t.directK, A, ap);
  }
  // Projectiles and blasts: Monte Carlo over the aim error.
  const s = sigma(w, t);
  let sum = 0;
  for (let i = 0; i < REF.mc; i++) {
    const ex = gauss() * s, ez = gauss() * s;
    if (w.kind === "line") {
      // Shells every L/n along a strip snapped through the target; the target sits at a random point along it.
      const L = mid(w.base, "stripLength"), gap = L / w.n, at = rnd() * gap;
      for (let k = -2; k <= 2; k++) {
        const x = Math.max(0, Math.hypot(ex, ez + at + k * gap) - t.r);
        sum += thru(w.dmg * t.blastK * fall(x, w.radius), A, ap);
      }
      continue;
    }
    const e = Math.hypot(ex, ez);
    if (w.kind === "cannon") {
      if (e < t.r + w.sheetHalf) sum += thru(w.dmg * t.directK, A, ap);
      else sum += thru(w.dmg * w.share * t.blastK * fall(e - t.r, w.radius), A, ap);
      continue;
    }
    sum += thru(w.dmg * t.blastK * fall(Math.max(0, e - t.r), w.radius), A, ap) * w.n;
  }
  return sum / REF.mc;
}

/** HP removed from a swarm by an area of radius r and damage d at its centre (a ring integral at density rho,
 *  each unit's share capped at its hp), less the unit at the centre when `skipCentre`. */
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
function volleySwarm(w: W, t: T, proto?: Proto): number {
  if (!inRange(w, t) || !t.swarm) return 0;
  const sw = t.swarm, ap = w.ap + (proto?.ap ?? 0), cap = (x: number) => Math.min(t.hp, thru(x, t.armour, ap));
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
    const pr = proto ?? NONE;
    const d = w.dmg * pr.dmgK;
    let per = line(d, w.pen, w.sheetHalf) + ringHp(d * w.share * t.roundSplashK, w.radius * pr.area, t, ap, true);
    per += cap(d) * (chainSum(pr.chain) + pr.ricochet * SHOT_DEFAULTS.protoRicochetKeep * 0.6);
    per += Math.min(pr.burn, t.hp);
    return per * pr.split * pr.rate;
  }
  if (w.kind === "rail") return line(w.dmg, w.pen, w.sheetHalf);
  if (w.kind === "cannon") return line(w.dmg, w.pen, w.sheetHalf) + ringHp(w.dmg * w.share, w.radius, t, ap, true);
  if (w.kind === "line") {
    const L = Math.min(mid(w.base, "stripLength"), 2 * Rc);
    return Math.min(sw.n, L * 2 * w.radius * sw.rho) * cap(w.dmg);
  }
  // Rocket, mortar, missiles: each blast's ring (missiles spread over the swarm: blasts rarely overlap).
  return Math.min(sw.n * t.hp, ringHp(w.dmg, w.radius, t, ap, false) * w.n);
}

/** Uptime over an engagement: spin-up or charge paid once per engagement for guns. */
const uptime = (w: W, t: T) => (w.kind === "gun" || w.kind === "cannon" ? t.engage / (t.engage + w.latency) : 1);

function eDps(w: W, t: T, proto?: Proto): number {
  const v = t.swarm ? volleySwarm(w, t, proto) : volleySingle(w, t, proto);
  return (v / w.cycle) * uptime(w, t) * (proto?.uptimeK ?? 1);
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
  const flight = w.flight ?? (Number.isFinite(w.speed) ? t.dist / w.speed : 0);
  return w.latency + flight + (vol - 1) * w.cycle;
}

// ---------------------------------------------------------------- Protocols, feeds
interface Proto { name: string; dmgK: number; split: number; rate: number; area: number; chain: number; ricochet: number; burn: number; ap: number; uptimeK: number; note?: string }
const NONE: Proto = { name: "plain", dmgK: 1, split: 1, rate: 1, area: 1, chain: 0, ricochet: 0, burn: 0, ap: 0, uptimeK: 1 };
const chainSum = (c: number) => { let s = 0, k = 1; for (let i = 0; i < c; i++) { k *= SHOT_DEFAULTS.protoChainKeep; s += k; } return s; };

function protoOf(id: string): Proto {
  const p = PROTOCOLS.find((x) => x.id === id)!;
  const o: Proto = { ...NONE, name: p.name };
  for (const m of p.mods) if (m.stat === "damage" && m.mul) o.dmgK *= m.mul;
  if (p.shot?.split) o.split = p.shot.split;
  if (p.shot?.rate) o.rate = p.shot.rate;
  if (p.shot?.area) o.area = p.shot.area;
  if (p.shot?.chain) o.chain = p.shot.chain;
  if (p.shot?.ricochet) o.ricochet = p.shot.ricochet;
  return o;
}
/** Proposed Protocol prices (docs/proposal-balance.md, "Modifiers"). */
const P_PROTO: Record<string, Partial<Proto>> = {
  splitter: { dmgK: 0.43 }, overclock: { dmgK: 0.6 }, arcLink: { dmgK: 0.75 }, ricochet: { dmgK: 0.95 }, overpressure: { dmgK: 1.25 },
};
function protos(): Proto[] {
  const ids = ["overpressure", "shredder", "splitter", "overclock", "wideBore", "ricochet", "arcLink"];
  const list = ids.map((id) => {
    const o = protoOf(id);
    return PROPOSED && P_PROTO[id] ? { ...o, ...P_PROTO[id] } : o;
  });
  // Feeds on the side's gun: passive rate +, and the key's effect averaged over its cooldown.
  const belt = BASE_BY_ID["sh-beltfeed"].stats, inc = BASE_BY_ID["sh-incendiary"].stats;
  const beltAvg = (1 + belt.feedRate.base) * (1 + (belt.boost.base * belt.effectTime.base) / belt.cooldown.base);
  list.push({ ...NONE, name: "Belt feed (avg)", rate: beltAvg, note: "passive rate + overdrive averaged over its cooldown" });
  const burnShare = (inc.effectTime.base + inc.burnTime.base) / inc.cooldown.base;
  list.push({ ...NONE, name: "Incendiary feed (avg)", rate: 1 + inc.feedRate.base, burn: 0, note: "burn added per target below" });
  list.push({ ...NONE, name: "AP rounds (+0.5 pierce)", ap: 0.5, note: "a feed key's armour-piercing rounds, later" });
  (list[list.length - 2] as Proto & { burnDps?: number }).burnDps = inc.burnDps.base * burnShare;
  return list;
}

// ---------------------------------------------------------------- printing
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lp = (s: string | number, n: number) => String(s).padStart(n);
const f0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toString() : "-");
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "-");

const W_ = weapons(), T_ = targets();
const tag = PROPOSED ? "PROPOSED" : "TODAY";
console.log(`(eDPS budget % uses set weights: ${JSON.stringify(REF.setWeight)})`);
console.log(`\n=== Balance sheet (${tag}), level 1 Common, middle rolls; budget ${REF.budget} eDPS per mount ===`);
console.log(`targets: ${T_.map((t) => `${t.name} hp ${t.hp}${t.armour ? ` arm ${t.armour}` : ""}`).join(" | ")}\n`);

// 1. Audit: raw numbers per item, and what the item card shows today.
console.log("-- Items (raw) --");
console.log(pad("item", 20) + lp("slot", 5) + lp("dmg", 7) + lp("/vol", 5) + lp("cycle", 7) + lp("lat", 6) + lp("raw", 6) + lp("card", 6) + lp("area", 6) + lp("pen", 6) + lp("ap", 5) + lp("speed", 7) + lp("range", 6) + lp("t", 5) + "  ammo");
for (const w of W_) {
  const raw = (w.dmg * w.n) / w.cycle;
  const it = { id: "x", base: w.id, kind: w.base.kind, rarity: "common", stats: Object.fromEntries(Object.entries(w.base.stats).map(([k, v]) => [k, v.base])), tags: w.base.tags, sockets: 0, socketed: [], maker: "", look: "rampart", weight: w.weight, seed: 0 } as unknown as Item;
  const card = itemDps(it);
  console.log(pad(w.name, 20) + lp(w.slot, 5) + lp(f1(w.dmg), 7) + lp(w.n, 5) + lp(w.cycle.toFixed(2), 7) + lp(w.latency.toFixed(2), 6) + lp(f0(raw), 6) + lp(card === null ? "-" : f0(card), 6)
    + lp(f1(w.radius), 6) + lp(f1(w.pen), 6) + lp(w.ap.toFixed(1), 5) + lp(Number.isFinite(w.speed) ? f0(w.speed) : w.flight ? `${w.flight}s` : "inst", 7) + lp(w.range, 6) + lp(w.weight, 5) + (w.ammoSec ? `  ${f0(w.ammoSec)} s of fire` : ""));
}

// 2. Effective DPS matrix and budget share.
console.log("\n-- Effective DPS (sustained) by target set; [% of slot budget]; role = best set --");
console.log(pad("item", 20) + T_.map((t) => lp(t.id, 14)).join("") + "   best   off-role mean");
const over: string[] = [];
for (const w of W_) {
  const budget = REF.budget * REF.slotShare[w.slot];
  const e = T_.map((t) => eDps(w, t));
  const pct = e.map((x, i) => (100 * x) / (budget * (REF.setWeight[T_[i].id] ?? 1)));
  const best = Math.max(...pct), bi = pct.indexOf(best);
  const off = pct.filter((_, i) => i !== bi), offMean = off.reduce((a, b) => a + b, 0) / off.length;
  if (best > 130) over.push(`${w.name} ${f0(best)}% vs ${T_[bi].id}`);
  console.log(pad(w.name, 20) + e.map((x, i) => lp(`${f0(x)} [${f0(pct[i])}]`, 14)).join("") + `   ${pad(T_[bi].id, 9)} ${f0(offMean)}%`);
}

// 3. Time to kill (one weapon alone, and a pair of the same on both mounts where it is a mount weapon).
console.log("\n-- Time to kill, one weapon alone (s; '-' out of range or no damage) --");
const ttkRows: [string, number, T][] = T_.filter((t) => t.id !== "swarm").map((t) => [t.name, t.hp, t]);
ttkRows.unshift(["Scrapper (one)", T_[0].hp, { ...T_[0], swarm: undefined, dist: 20 }]);
ttkRows.unshift(["Scrapper pack (36)", T_[0].hp * T_[0].swarm!.n, T_[0]]);
for (const [name, hpT, hpP, arm, like] of OTHERS) {
  const b = T_.find((t) => t.id === like)!;
  ttkRows.push([name, PROPOSED ? hpP : hpT, { ...b, swarm: undefined, armour: PROPOSED ? arm : 0, hp: PROPOSED ? hpP : hpT, r: like === "swarm" ? INFANTRY_DEFAULTS.banditRadius : b.r, penDensity: like === "swarm" ? PEN_DEFAULTS.penFlesh : b.penDensity }]);
}
console.log(pad("enemy", 20) + lp("hp", 6) + W_.map((w) => lp(w.id.replace("sh-", "").slice(0, 9), 10)).join(""));
for (const [name, hp, t] of ttkRows) console.log(pad(name, 20) + lp(hp, 6) + W_.map((w) => lp(f1(ttk(w, t, hp)), 10)).join(""));
const PAIRS: [string, string][] = [["mg-medium", "mg-medium"], ["mg-medium", "rail-medium"], ["ac-medium", "rpg-medium"], ["rail-medium", "ac-medium"]];
console.log("\n-- Time to kill with a pair on the two mounts (both firing: 1/(1/a + 1/b) of the single times; s) --");
console.log(pad("enemy", 20) + PAIRS.map(([a, b]) => lp(`${a.split("-")[0]}+${b.split("-")[0]}`, 11)).join(""));
for (const [name, hp, t] of ttkRows) {
  console.log(pad(name, 20) + PAIRS.map(([a, b]) => {
    const wa = W_.find((x) => x.id === a)!, wb = W_.find((x) => x.id === b)!;
    const ta = ttk(wa, t, hp), tb = ttk(wb, t, hp);
    return lp(f1(1 / (1 / ta + 1 / tb)), 11);
  }).join(""));
}

// 4. Modifiers on the Medium minigun: multiplier on its eDPS against each set.
console.log("\n-- Modifiers on the Medium minigun (× its plain eDPS per target set) --");
const mg = W_.find((x) => x.id === "mg-medium")!;
console.log(pad("modifier", 26) + T_.map((t) => lp(t.id, 11)).join(""));
for (const p of protos()) {
  const burn = (p as Proto & { burnDps?: number }).burnDps ?? 0;
  const row = T_.map((t) => {
    const base = eDps(mg, t);
    let v = eDps(mg, t, p);
    if (burn) v += t.swarm ? 0 : burn; // the burn on the focused target (swarm units die to the round anyway)
    return base > 0 ? v / base : 0;
  });
  console.log(pad(p.name, 26) + row.map((x) => lp(`×${x.toFixed(2)}`, 11)).join(""));
}
// Stacking: the four behaviour Protocols on one legendary minigun, as built (they multiply).
{
  const ids = ["splitter", "overclock", "arcLink", "ricochet"];
  const ps = ids.map((id) => { const o = protoOf(id); return PROPOSED && P_PROTO[id] ? { ...o, ...P_PROTO[id] } : o; });
  const all: Proto = { ...NONE, name: "4 stacked" };
  for (const p of ps) { all.dmgK *= p.dmgK; all.split *= p.split; all.rate *= p.rate; all.chain += p.chain; all.ricochet += p.ricochet; }
  const sw = eDps(mg, T_[0], all) / eDps(mg, T_[0]), rv = eDps(mg, T_[4], all) / eDps(mg, T_[4]);
  const gains = ps.map((p) => eDps(mg, T_[0], p) / eDps(mg, T_[0]) - 1);
  console.log(`Legendary stack (${ids.join(", ")}): multiplied ×${sw.toFixed(2)} vs swarm, ×${rv.toFixed(2)} vs rival; additive rule would give ×${(1 + gains.reduce((a, b) => a + b, 0)).toFixed(2)} vs swarm`);
}

// 5. Armour: today's weapons against an armoured excavator (proposal armour), per hit and per second.
console.log("\n-- Armour: damage per hit kept and eDPS against an excavator at armour 0 / 6 / 12 / 20 --");
const ex = T_.find((t) => t.id === "excavator")!;
console.log(pad("item", 20) + [0, 6, 12, 20].map((a) => lp(`arm ${a}`, 16)).join(""));
for (const w of W_) {
  console.log(pad(w.name, 20) + [0, 6, 12, 20].map((a) => {
    const t = { ...ex, armour: a }, d = w.dmg * (w.kind === "rocket" || w.kind === "missiles" || w.kind === "mortar" || w.kind === "line" ? ex.blastK : ex.directK);
    return lp(`${f0((100 * thru(d, a, w.ap)) / Math.max(1e-6, d))}% ${f0(eDps(w, t))}`, 16);
  }).join(""));
}
{
  const t = { ...ex, armour: 12 }, ap = protos().find((p) => p.ap > 0)!;
  console.log(`AP rounds on the Medium minigun vs excavator at armour 12: ×${(eDps(mg, t, ap) / Math.max(1e-6, eDps(mg, t))).toFixed(2)}`);
}

// 6. Level and depth: what an item's DPS and an enemy pack's total HP do as you go deeper.
console.log("\n-- Level growth (today: levelGrowth " + LOOT_DEFAULTS.levelGrowth + "; drop level = 1 + depth/100 m) --");
console.log(pad("level", 8) + lp("dmg×", 7) + lp("rate×", 7) + lp("DPS×", 7) + lp("hull×", 7) + "   proposal: one power curve P(n)=1.06^(n-1) for item DPS and enemy hp/damage");
for (const n of [1, 6, 11, 21, 41, 60]) {
  const d = levelMul("damage", n, LOOT_DEFAULTS.levelGrowth), r = levelMul("fireRate", n, LOOT_DEFAULTS.levelGrowth), h = levelMul("hull", n, LOOT_DEFAULTS.levelGrowth);
  console.log(pad(n, 8) + lp(d.toFixed(2), 7) + lp(r.toFixed(2), 7) + lp((d * r).toFixed(2), 7) + lp(h.toFixed(2), 7) + `   P=${Math.pow(1.06, n - 1).toFixed(2)}`);
}

// 7. The player mech under fire: incoming DPS and seconds to live on a 1500 hull.
console.log("\n-- The player mech (hull 1500) under fire: incoming DPS (expected), seconds to live --");
const hull = 1500;
const rows: [string, number][] = [
  ["24 scrappers (20% shooters, all biters latched)", 24 * 0.8 * (RB.robotBiteDamage / RB.robotBiteInterval) + 24 * RB.robotShooterShare * (RB.robotShotDamage / RB.robotShotInterval) * 0.6],
  ["3 cutters (half shoot, half cut)", 1.5 * (RB.robotMidShotDamage / RB.robotMidShotInterval) * 0.6 + 1.5 * RB.robotMidCutDamage / (RB.robotMidCutWindup + RB.robotMidLungeTime + RB.robotMidCutRecover)],
  ["1 excavator (lobs)", (RB.robotBigBurst * RB.robotBigShotDamage) / (RB.robotBigBurst * RB.robotBigRoundInterval + RB.robotBigPause) * 0.5],
  ["War band (5 tech, 2 truck, 1 six, 1 turret)", (5 * WB.techRate * WB.techDamage + 2 * WB.truckRate * WB.truckDamage + WB.sixRate * WB.sixDamage + WB.turretRate * WB.turretDamage) * 0.5],
  ["Bandit mech (2 miniguns × 0.2)", 2 * UPPER_DEFAULTS.fireRate * MD.roundDamage * WB.banditMechDamage * 0.4],
  ["Rival mech (2 miniguns, full)", 2 * UPPER_DEFAULTS.fireRate * MD.roundDamage * 0.4],
];
for (const [n, d] of rows) console.log(pad(n, 50) + lp(f0(d), 6) + " dps" + lp(f1(hull / d), 8) + " s");

if (over.length) console.log(`\nOver 130% of budget at level 1: ${over.join("; ")}`);
if (CHECK && over.length) process.exit(1);
