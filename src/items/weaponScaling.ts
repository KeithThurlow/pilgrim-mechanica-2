// Weapon scaling (Keith 2026-11-03: "formulas for area damage versus projectile speed versus DPS; some things scale
// better in damage, some in area"). Pure. Reads the balance model (src/items/balanceModel.ts, the sheet's numbers) and
// gives every weapon five axes and how Protocols move them. The weapon review lab (labs/weaponreview/) draws these;
// tools/weaponscaling-check.ts prints them.
//
//   Focus  F = eDPS against the best single target (cutter, excavator, raider or rival mech: whichever it kills best)
//   Area   A = hp per second taken out of a camp-density swarm (36 scrappers, 0.2 per m²)
//   (Every target is measured no further than 90% of the weapon's range, so short guns aren't zeroed by the sheet's
//   reference distances, 22-35 m. The sheet itself still uses them.)
//   Crowd  C = scrappers' worth of hp one shot (a volley, a swing) takes out of the swarm, at most the pack: how many
//            bodies each shot does for. A minigun round ~2.5, a rail slug through the pack ~5, a sword cut ~9.
//   Reliability R(v) = eDPS against a mech-sized body at 35 m (90% of a shorter gun's range) moving (juking) at v m/s ÷ the same body standing still.
//            Hitscan and rails stay flat; slow shells and blasts fall off with v: projectile speed is in here.
//   Reach  D½ = the distance where eDPS against a juking rival mech falls under half its best (spread, flight time and
//            range together); past `range` it is 0.
//   Budget: F% = F / (150 × slot share), A% = A / (150 × slot share × 2) (the sheet's budget, swarm weighted ×2).
//            The sheet caps the best of these at 130% (flak's swarm at 230%, open). Proposed here (Claude 2026-11-03,
//            open for Keith): Spend S = F% + A% ≤ 200, so a weapon good at both pays for it.
//   Scaling: a Protocol's × on F and on A per socket, stacked; the best build for F and for A at 0-4 sockets (greedy,
//            repeats allowed: the theoretical ceiling). Class = A ceiling ÷ F ceiling at 4 sockets: over 1.25 an
//            area scaler, under 0.8 a damage scaler, else even.
import { BASE_BY_ID } from "./bases";
import { PROTOCOLS, protocolFits, type Protocol } from "./protocols";
import { makeItem, protocolItem } from "./generate";
import { dpsOf, itemCadence } from "./dps";
import { REF, WEAPON_IDS, ENERGY_IDS, MELEE_IDS, FIRE_IDS, eDps, reseed, targets, ttk, volleySwarm, wOf, type T, type W } from "./balanceModel";
import type { Item } from "./item";

export const SCALING = {
  /** Armour on every single target (the lab's armour slider); below 0 each keeps its own (cutter 3, excavator 6.5,
   *  raider 2, rival mech 8). The swarm keeps its own (scrappers 0). */
  armour: -1,
  /** Armour values for the armour curve. */
  armours: [0, 2, 4, 6, 8, 10, 12, 14, 16],
  /** Distances (m) for the reach curve and speeds (m/s) for the reliability curve. */
  distances: [5, 10, 15, 20, 25, 30, 35, 45, 55, 65, 75, 90, 110],
  speeds: [0, 2, 4, 6, 8, 10, 12, 15],
  sockets: 4,
  spendCap: 200,
  areaClass: 1.25,
  damageClass: 0.8,
};

/** Every weapon the model covers: the sheet's checked list, then the energy weapons and swords (report only). */
export const MODELLED = [...WEAPON_IDS, ...ENERGY_IDS, ...MELEE_IDS, ...FIRE_IDS];

const SINGLE = ["cutter", "excavator", "raider", "rival"];

export interface Profile {
  id: string; name: string; slot: string; kind: string;
  /** The item card's DPS (damage × rounds × sustained rate, no hit chance). */
  card: number;
  focus: number; focusSet: string; rival: number;
  area: number; crowd: number;
  reliability: number; reach: number;
  focusPct: number; areaPct: number; spend: number;
  range: number; speed: number; radius: number;
}

const budgetOf = (w: W) => REF.budget * REF.slotShare[w.slot];
/** eDPS with the seeded random restarted, so two calls differ only by what they're given (ratios without noise). */
const e = (w: W, t: T) => { reseed(); return eDps(w, t); };
/** A target no further than 90% of the weapon's range (short guns are measured where they can reach). */
const near = (w: W, t: T): T => (w.kind !== "melee" && t.dist > w.range * 0.9 ? { ...t, dist: Math.floor(w.range * 0.9) } : t);
const tById = () => Object.fromEntries(targets().map((t) => [t.id, !t.swarm && SCALING.armour >= 0 ? { ...t, armour: SCALING.armour } : t])) as Record<string, T>;

/** A weapon's item with these Protocols socketed (repeats allowed). */
export function itemWith(base: string, protos: string[]): Item {
  const it = makeItem(base);
  for (const id of protos) it.socketed.push(protocolItem(PROTOCOLS.find((p) => p.id === id)!, 1));
  return it;
}

/** Focus and area eDPS of an item (sustained). */
export function focusArea(item: Item): { focus: number; focusSet: string; area: number } {
  const w = wOf(item), T_ = tById();
  let focus = 0, focusSet = "rival";
  for (const id of SINGLE) { const x = e(w, near(w, T_[id])); if (x > focus) { focus = x; focusSet = id; } }
  return { focus, focusSet, area: e(w, near(w, T_.swarm)) };
}

/** The rival mech at distance d moving at v (juke kept). */
const rivalAt = (T_: Record<string, T>, d: number, v?: number): T => ({ ...T_.rival, dist: d, speed: v ?? T_.rival.speed });
/** Where reliability is measured: 35 m, or 90% of a shorter gun's range (a sword walks in from 35 m). */
export const relDist = (w: W) => (w.kind === "melee" ? 35 : Math.min(35, Math.floor(w.range * 0.9)));

export function profileOf(item: Item): Profile {
  const w = wOf(item), T_ = tById(), b = budgetOf(w);
  const { focus, focusSet, area } = focusArea(item);
  const sw = near(w, T_.swarm);
  reseed();
  const crowd = Math.min(sw.swarm!.n, volleySwarm(w, sw) / sw.hp);
  const dRel = relDist(w), still = e(w, rivalAt(T_, dRel, 0)), moving = e(w, rivalAt(T_, dRel, 8));
  const curve = reachCurve(item), peak = Math.max(...curve.map((p) => p.moving));
  let reach = 0;
  for (const p of curve) if (p.moving >= peak * 0.5 && peak > 0) reach = p.d;
  if (w.kind === "melee") reach = w.range; // it walks in: its reach is the blade's
  const focusPct = (100 * focus) / b, areaPct = (100 * area) / (b * REF.setWeight.swarm);
  const c = itemCadence(item);
  return {
    id: w.id, name: w.name, slot: w.slot, kind: w.kind, card: c ? dpsOf(c) : 0,
    focus, focusSet, rival: e(w, T_.rival), area, crowd,
    reliability: still > 0 ? moving / still : 0, reach,
    focusPct, areaPct, spend: focusPct + areaPct,
    range: w.range, speed: w.flight ? T_.rival.dist / w.flight : w.speed, radius: w.radius,
  };
}

/** eDPS against the rival mech by distance: standing still and juking (its own speed). */
export function reachCurve(item: Item): { d: number; still: number; moving: number }[] {
  const w = wOf(item), T_ = tById();
  return SCALING.distances.map((d) => ({ d, still: e(w, rivalAt(T_, d, 0)), moving: e(w, rivalAt(T_, d)) }));
}

/** Reliability by target speed: eDPS on a rival-sized body at 35 m moving at v, ÷ standing still. */
export function reliabilityCurve(item: Item): { v: number; r: number }[] {
  const w = wOf(item), T_ = tById(), d = relDist(w), still = e(w, rivalAt(T_, d, 0));
  return SCALING.speeds.map((v) => ({ v, r: still > 0 ? e(w, rivalAt(T_, d, v)) / still : 0 }));
}

/** The Protocols that fit a weapon. */
export const protocolsFor = (base: string): Protocol[] => PROTOCOLS.filter((p) => protocolFits(p, BASE_BY_ID[base].tags));

/** One Protocol stacked 0..sockets times: × on focus and area. */
export function protocolStack(base: string, id: string): { n: number; focus: number; area: number }[] {
  const f0 = focusArea(makeItem(base));
  const out = [];
  for (let n = 0; n <= SCALING.sockets; n++) {
    const s = focusArea(itemWith(base, Array(n).fill(id)));
    out.push({ n, focus: f0.focus > 0 ? s.focus / f0.focus : 0, area: f0.area > 0 ? s.area / f0.area : 0 });
  }
  return out;
}

export interface Build { n: number; protos: string[]; focus: number; area: number }

/** The best build for one axis at 0..sockets (greedy, repeats allowed; a socket left empty if nothing helps). */
export function bestBuilds(base: string, axis: "focus" | "area"): Build[] {
  const f0 = focusArea(makeItem(base)), ids = protocolsFor(base).map((p) => p.id);
  const rel = (s: { focus: number; area: number }) => ({ focus: f0.focus > 0 ? s.focus / f0.focus : 0, area: f0.area > 0 ? s.area / f0.area : 0 });
  let protos: string[] = [], cur = rel(f0);
  const out: Build[] = [{ n: 0, protos: [], ...cur }];
  for (let n = 1; n <= SCALING.sockets; n++) {
    let best = { protos, ...cur };
    for (const id of ids) {
      const s = rel(focusArea(itemWith(base, [...protos, id])));
      if (s[axis] > best[axis]) best = { protos: [...protos, id], ...s };
    }
    protos = best.protos; cur = { focus: best.focus, area: best.area };
    out.push({ n, protos, ...cur });
  }
  return out;
}

export type ScaleClass = "area" | "damage" | "even" | "fixed";
/** Area ceiling, focus ceiling (× at full sockets on its own axis) and the class. */
export function scaleClass(base: string): { areaCeil: number; focusCeil: number; cls: ScaleClass } {
  if (!protocolsFor(base).length) return { areaCeil: 1, focusCeil: 1, cls: "fixed" };
  const a = bestBuilds(base, "area")[SCALING.sockets].area, f = bestBuilds(base, "focus")[SCALING.sockets].focus;
  const r = a / Math.max(1e-6, f);
  return { areaCeil: a, focusCeil: f, cls: r > SCALING.areaClass ? "area" : r < SCALING.damageClass ? "damage" : "even" };
}

/** Raw (card) DPS and eDPS on the rival-sized body standing still at relDist, by its armour: what armour takes. */
export function armourCurve(item: Item): { a: number; e: number }[] {
  const w = wOf(item), T_ = tById(), d = relDist(w);
  return SCALING.armours.map((a) => ({ a, e: e(w, { ...rivalAt(T_, d, 0), armour: a }) }));
}

/** The test swarm as the model sees it (Keith 2026-11-04: measuring clear): a swarm of n bodies of this hp, armour
 *  and hit radius at density rho, standing still at dist (or 90% of a shorter gun's range). Area eDPS (hp/s taken
 *  out, capped per body), Crowd (bodies' worth a shot) and the time to clear the whole pack. Fodder at the swarm's
 *  own speed gives the profile's Area A; the lab's pen stands still, so pass speed 0 to compare with it. */
export function swarmModel(item: Item, s: { n: number; hp: number; armour: number; r: number; rho: number; dist: number; speed?: number }): { area: number; crowd: number; clear: number } {
  const w = wOf(item), sw = targets().find((t) => t.id === "swarm")!;
  const t = near(w, { ...sw, hp: s.hp, armour: s.armour, r: s.r, dist: s.dist, speed: s.speed ?? 0, juke: s.speed ? sw.juke : 0, swarm: { n: Math.max(1, s.n), rho: s.rho } });
  reseed();
  const area = eDps(w, t);
  reseed();
  const crowd = Math.min(t.swarm!.n, volleySwarm(w, t) / t.hp);
  reseed();
  return { area, crowd, clear: ttk(w, t, t.hp) };
}
