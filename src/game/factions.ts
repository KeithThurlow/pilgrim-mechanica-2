// Factions and what happens when their groups meet (docs/proposal-factions.md, Keith 2026-10-28). Pure: no drawing, no
// Three.js; seeded and deterministic (a clash is arithmetic on the groups' numbers, no randomness).
//
// - Factions: robots (the clearance), raiders (the settled bandit camps and the roaming war band columns are ONE
//   faction with two behaviours, Keith 2026-10-28: allied, never fighting each other), the player and the convoy.
//   Rival military (later) will be hostile to all. One table of sliders says how hostile each pair is; at or above
//   fightAt they fight on sight, below it they ignore each other.
// - In view (FightDirector): every live group picks a target among its enemies in the register (src/game/register.ts)
//   by distance and threat, through each group's FightGroup adapter. At most maxEngaged groups fight another group at a
//   time; the rest keep to their usual business. A group fighting someone else sends a share of its members at the
//   player if he is in reach too, so a player arriving mid-fight sees both sides fighting each other and him.
// - Out of view (clashes): groups that are not simulated and meet drain each other's strength by size and type every
//   second until one breaks (Lanchester's square law); survivors keep the share of strength they have left (damaged).
// Ownership: host state (who fights whom, strengths, outcomes). Events are plain data.
import type { Param } from "../core/tweaks";
import { KIND, FLAG, kindBit, type Filter, type Register } from "./register";

export const FACTION = { robots: 0, raiders: 1, player: 2, convoy: 3 } as const;
export type Faction = 0 | 1 | 2 | 3;
export const FACTION_NAMES = ["robots", "raiders", "player", "convoy"] as const;
/** The battlefield team each faction's rounds carry (the player's mech is 1, the war band 2, the robots 3). */
export const TEAM = { player: 1, raiders: 2, robots: 3, convoy: 5 } as const;
export const factionOfTeam = (team: number): Faction | -1 =>
  team === TEAM.robots ? 0 : team === TEAM.raiders ? 1 : team === TEAM.player ? 2 : team === TEAM.convoy ? 3 : -1;

export const FACTION_DEFAULTS = {
  relRobotsRaiders: 1,
  relRobotsPlayer: 1,
  relRobotsConvoy: 1,
  relRaidersPlayer: 1,
  relRaidersConvoy: 1,
  relPlayerConvoy: 0,
  fightAt: 0.5,
  maxEngaged: 3,
  fightRange: 120,
  fightRetarget: 0.6,
  fightPlayerShare: 0.35,
  fightKeep: 1.3,
  clashRange: 90,
  clashRate: 0.03,
  clashBreak: 0.25,
  clashView: 700,
  clashLoot: 0.5,
  clashScrap: 6,
  powScrapper: 1,
  powCutter: 4,
  powExcavator: 12,
  powBandit: 1.2,
  powTechnical: 4,
  powGunTruck: 9,
  powSixWheeler: 14,
  powWarRig: 30,
  powTank: 36,
  powBanditMech: 20,
};
export type FactionValues = typeof FACTION_DEFAULTS;

const R = "Factions", F = "Fights", C = "Clashes out of view";
export const FACTION_PARAMS: Param[] = [
  { key: "relRobotsRaiders", label: "Robots ↔ raiders", min: 0, max: 1, step: 0.05, group: R, tip: "Hostility 0-1: at or above 'Fight on sight at' they fight, below it they ignore each other" },
  { key: "relRobotsPlayer", label: "Robots ↔ player", min: 0, max: 1, step: 0.05, group: R },
  { key: "relRobotsConvoy", label: "Robots ↔ convoy", min: 0, max: 1, step: 0.05, group: R },
  { key: "relRaidersPlayer", label: "Raiders ↔ player", min: 0, max: 1, step: 0.05, group: R, tip: "Bandit camps and war bands are one faction: allied with each other, never fighting" },
  { key: "relRaidersConvoy", label: "Raiders ↔ convoy", min: 0, max: 1, step: 0.05, group: R },
  { key: "relPlayerConvoy", label: "Player ↔ convoy", min: 0, max: 1, step: 0.05, group: R },
  { key: "fightAt", label: "Fight on sight at", min: 0.05, max: 1, step: 0.05, group: R },
  { key: "maxEngaged", label: "Groups fighting each other at once", min: 0, max: 12, step: 1, group: F, tip: "In view, at most this many groups fight another group; the rest carry on as before" },
  { key: "fightRange", label: "Pick enemies within (m)", min: 20, max: 400, step: 5, group: F },
  { key: "fightRetarget", label: "Look again every (s)", min: 0.1, max: 5, step: 0.05, group: F },
  { key: "fightPlayerShare", label: "Share that still go for you", min: 0, max: 1, step: 0.05, group: F, tip: "A group fighting another one sends this share of its members at the player when he is in reach too" },
  { key: "fightKeep", label: "Stick to the current enemy (×)", min: 1, max: 3, step: 0.05, group: F, tip: "A group keeps its enemy unless another scores this many times better" },
  { key: "clashRange", label: "Groups meet within (m)", min: 20, max: 400, step: 5, group: C },
  { key: "clashRate", label: "Strength lost per enemy strength (/s)", min: 0.002, max: 0.3, step: 0.002, group: C, tip: "Each side loses this share of the other's strength every second" },
  { key: "clashBreak", label: "Breaks below (share of start)", min: 0.02, max: 0.8, step: 0.01, group: C },
  { key: "clashView", label: "In view within (m)", min: 100, max: 2000, step: 10, group: C, tip: "Groups nearer the player than this are simulated, not resolved by numbers" },
  { key: "clashLoot", label: "Item drops per 10 lost", min: 0, max: 3, step: 0.05, group: C },
  { key: "clashScrap", label: "Scrap per fighter lost", min: 0, max: 40, step: 0.5, group: C, tip: "What the wrecks left by a clash pay when stripped" },
  { key: "powScrapper", label: "Strength: scrapper", min: 0.1, max: 50, step: 0.1, group: C },
  { key: "powCutter", label: "Strength: cutter", min: 0.1, max: 80, step: 0.1, group: C },
  { key: "powExcavator", label: "Strength: excavator", min: 0.1, max: 200, step: 0.5, group: C },
  { key: "powBandit", label: "Strength: bandit", min: 0.1, max: 50, step: 0.1, group: C },
  { key: "powTechnical", label: "Strength: technical", min: 0.1, max: 80, step: 0.1, group: C },
  { key: "powGunTruck", label: "Strength: gun truck", min: 0.1, max: 150, step: 0.5, group: C },
  { key: "powSixWheeler", label: "Strength: six-wheeler", min: 0.1, max: 200, step: 0.5, group: C },
  { key: "powWarRig", label: "Strength: War Rig", min: 0.1, max: 400, step: 1, group: C },
  { key: "powTank", label: "Strength: tank", min: 0.1, max: 500, step: 1, group: C },
  { key: "powBanditMech", label: "Strength: bandit mech", min: 0.1, max: 300, step: 1, group: C },
];
export const FACTION_GROUPS = [R, F, C];

/** The relation table: how hostile two factions are (0-1), and whether they fight. */
export class Relations {
  constructor(public v: FactionValues) {}
  level(a: number, b: number): number {
    if (a === b || a < 0 || b < 0) return 0;
    const lo = Math.min(a, b), hi = Math.max(a, b), v = this.v;
    if (lo === 0) return hi === 1 ? v.relRobotsRaiders : hi === 2 ? v.relRobotsPlayer : v.relRobotsConvoy;
    if (lo === 1) return hi === 2 ? v.relRaidersPlayer : v.relRaidersConvoy;
    return v.relPlayerConvoy;
  }
  hostile(a: number, b: number): boolean { return this.level(a, b) >= this.v.fightAt; }
  hostileTeams(a: number, b: number): boolean { return this.hostile(factionOfTeam(a), factionOfTeam(b)); }
}

// ---- Strength (what a group is worth in a clash) ----

/** Strength of n robots with these shares of cutters and excavators (the rest scrappers). */
export function robotPower(v: FactionValues, n: number, mid: number, big: number): number {
  const nb = n * Math.min(1, Math.max(0, big)), nm = n * Math.min(1 - Math.min(1, Math.max(0, big)), Math.max(0, mid));
  return nb * v.powExcavator + nm * v.powCutter + Math.max(0, n - nb - nm) * v.powScrapper;
}
/** Strength of a war band column by its vehicle kinds. */
export function columnPower(v: FactionValues, kinds: readonly string[]): number {
  const p: Record<string, number> = { technical: v.powTechnical, gunTruck: v.powGunTruck, sixWheeler: v.powSixWheeler, warRig: v.powWarRig, tank: v.powTank };
  let s = 0;
  for (const k of kinds) s += p[k] ?? v.powTechnical;
  return s;
}
export const banditPower = (v: FactionValues, n: number) => n * v.powBandit;

// ---- Out of view: a clash resolved by numbers ----

/** One side of a clash. */
export interface Side { id: string; faction: Faction; count: number; power: number; start: number }
export const sideOf = (id: string, faction: Faction, count: number, power: number): Side => ({ id, faction, count, power, start: power });

export interface Clash {
  id: string;
  a: Side; b: Side;
  /** Seconds fought. */
  t: number;
  done: boolean;
  /** "a" or "b" once one side broke (or both, "none", when both went at once). */
  winner: "a" | "b" | "none" | null;
  x: number; z: number;
}

export function newClash(a: Side, b: Side, x: number, z: number): Clash {
  return { id: `${a.id}~${b.id}`, a, b, t: 0, done: false, winner: null, x, z };
}

/** One step of Lanchester's square law: each side loses clashRate × the other's strength per second. */
export function stepClash(c: Clash, dt: number, v: FactionValues) {
  if (c.done) return;
  c.t += dt;
  const pa = c.a.power, pb = c.b.power;
  c.a.power = Math.max(0, pa - v.clashRate * pb * dt);
  c.b.power = Math.max(0, pb - v.clashRate * pa * dt);
  const ba = c.a.power <= c.a.start * v.clashBreak, bb = c.b.power <= c.b.start * v.clashBreak;
  if (!ba && !bb) return;
  c.done = true;
  c.winner = ba && bb ? (c.a.power >= c.b.power ? "a" : "b") : ba ? "b" : "a";
}

/** What is left of a side after a clash: its heads (rounded up from the strength share) and how hurt they are (0-1). */
export function survivors(s: Side, lost: boolean): { count: number; hurt: number } {
  if (lost) return { count: 0, hurt: 1 };
  const share = s.start > 0 ? s.power / s.start : 0;
  return { count: Math.max(1, Math.ceil(s.count * share)), hurt: 1 - share };
}

// ---- In view: who fights whom ----

/** An enemy as a group sees it (refreshed every frame from the register). */
export interface FightTarget { id: number; x: number; y: number; z: number; r: number; vx: number; vz: number; faction: number }

/**
 * A group the director can steer: robots of a camp or pack, a bandit camp, a war band column. The adapters live next to
 * each sim (src/game/fightGroups.ts).
 */
export interface FightGroup {
  readonly id: string;
  readonly faction: Faction;
  readonly team: number;
  /** Where it is now; false when it is gone or asleep (not simulated, nothing to steer). */
  at(out: { x: number; z: number }): boolean;
  /** Point its members at t, except `share` of them (by member number) who keep their usual enemy; null: back to usual. */
  aim(t: FightTarget | null, share: number): void;
}

const UNITS = kindBit(KIND.Unit) | kindBit(KIND.Vehicle) | kindBit(KIND.Mech);

export class FightDirector {
  /** group id → the register id of the enemy it fights now. */
  readonly engaged = new Map<string, number>();
  private clock = 0;
  private near: number[] = [];
  private filter: Filter = { kinds: UNITS, all: FLAG.Hittable, none: FLAG.Down };
  private c = { x: 0, z: 0 };
  private t: FightTarget = { id: 0, x: 0, y: 0, z: 0, r: 1, vx: 0, vz: 0, faction: 0 };
  private cand: { g: FightGroup; id: number; score: number; share: number }[] = [];
  private had = new Set<string>();

  constructor(public v: FactionValues, public rel: Relations) {}

  /** Groups fighting another group right now. */
  get count() { return this.engaged.size; }

  /** One frame. groups: the live ones (the adapters), reg: rebuilt this tick. */
  update(dt: number, groups: readonly FightGroup[], reg: Register) {
    const v = this.v;
    this.clock += dt;
    if (this.clock >= v.fightRetarget) { this.clock = 0; this.pick(groups, reg); }
    // Aim every engaged group at its enemy's current place; a vanished enemy frees the group until the next look.
    for (const g of groups) {
      const id = this.engaged.get(g.id);
      if (id === undefined) { if (this.had.delete(g.id)) g.aim(null, 0); continue; }
      const e = reg.find(id);
      if (e < 0) { this.engaged.delete(g.id); this.had.delete(g.id); g.aim(null, 0); continue; }
      const t = this.t;
      t.id = id; t.x = reg.x[e]; t.y = reg.y[e]; t.z = reg.z[e]; t.r = reg.r[e]; t.vx = reg.vx[e]; t.vz = reg.vz[e]; t.faction = factionOfTeam(reg.team[e]);
      this.had.add(g.id);
      g.aim(t, this.shareOf.get(g.id) ?? 0);
    }
    // Groups that left the list are forgotten.
    if (this.engaged.size > groups.length) for (const id of [...this.engaged.keys()]) if (!groups.some((g) => g.id === id)) { this.engaged.delete(id); this.had.delete(id); }
  }
  private shareOf = new Map<string, number>();

  private pick(groups: readonly FightGroup[], reg: Register) {
    const v = this.v, rel = this.rel, cand = this.cand, c = this.c;
    cand.length = 0;
    for (const g of groups) {
      if (!g.at(c)) continue;
      this.filter.notTeam = g.team;
      reg.near(c.x, c.z, v.fightRange, this.filter, this.near);
      let best = -1, bs = 0, playerNear = false;
      const cur = this.engaged.get(g.id);
      for (const e of this.near) {
        const f = factionOfTeam(reg.team[e]);
        if (f < 0 || !rel.hostile(g.faction, f)) continue;
        if (f === FACTION.player) { playerNear = true; continue; }
        // Nearer and bigger score higher; the enemy it already fights gets the benefit of the doubt.
        let s = (0.6 + 0.15 * reg.r[e]) / (20 + Math.hypot(reg.x[e] - c.x, reg.z[e] - c.z));
        if (reg.id[e] === cur) s *= v.fightKeep;
        if (s > bs) { bs = s; best = e; }
      }
      if (best >= 0) cand.push({ g, id: reg.id[best], score: bs, share: playerNear ? v.fightPlayerShare : 0 });
    }
    // The cap: the best-scoring pairs fight, the rest carry on as before.
    cand.sort((a, b) => b.score - a.score || (a.g.id < b.g.id ? -1 : 1));
    this.engaged.clear();
    this.shareOf.clear();
    for (let k = 0; k < cand.length && k < Math.max(0, Math.round(v.maxEngaged)); k++) {
      this.engaged.set(cand[k].g.id, cand[k].id);
      this.shareOf.set(cand[k].g.id, cand[k].share);
    }
  }
}

// ---- Groups that are not on the field (what the clashes act on) ----

/**
 * A group away from the field, as the clash sees it: where, how many, what it is worth. apply() writes the outcome back
 * to its owner (survivors and how hurt they are; 0 survivors: gone); hold() keeps it still while it fights.
 */
export interface AbstractGroup {
  id: string;
  faction: Faction;
  x: number; z: number;
  count: number;
  power: number;
  /** Vehicles (wrecks of cars) rather than bodies or machines. */
  vehicles: boolean;
  apply(count: number, hurt: number): void;
  hold(on: boolean): void;
}
