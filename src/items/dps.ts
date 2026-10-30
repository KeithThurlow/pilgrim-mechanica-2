// A weapon's cadence and damage per second (Keith 2026-10-31: an item shows its base DPS and its DPS with its
// Protocols; the player judges sockets and potential). Pure. ONE formula: the item card, the pickup card, the bay and
// tools/balance-sheet.ts all read it (the sheet then adds hit chance, area, armour and uptime per target set).
//
//   DPS = damage per round × rounds per shot × sustained shots per second
//
// Sustained shots per second count the magazine and its reload (src/weapons/magazine.ts sustainedRate): a split shot
// of 3 costs 3 rounds, so it reaches the reload sooner. What depends on what's there isn't counted: area (splash,
// blasts), and chains and ricochets (their extra share when they find a target is `bonus`, shown as a note).
import { BASE_BY_ID } from "./bases";
import { effectiveStats } from "./loadout";
import { shotCostOf, shotProtocolsOf } from "./protocols";
import { sustainedRate, shotRounds } from "../weapons/magazine";
import type { ShotProtocols } from "../game/shots";
import type { Item } from "./item";

/** Kept share per chain hop and per ricochet (src/game/shots.ts SHOT_DEFAULTS; copied so this stays light). */
const CHAIN_KEEP = 0.6, RICOCHET_KEEP = 0.5;

export interface Cadence {
  /** Damage per round. */
  damage: number;
  /** Rounds per shot (a split shot's 3, an overclocked tick's 2, a missile salvo's 10). */
  rounds: number;
  /** Shots per second while it fires, and sustained over its magazine and reload. */
  rate: number;
  sustained: number;
  /** Magazine (rounds; 0: none, a volley launcher's cooldown is its reload) and reload (s). */
  magazine: number;
  reload: number;
  /** Magazine rounds per round fired. */
  cost: number;
  /** Extra damage share from chains and ricochets when they find a target. */
  bonus: number;
}

/** The cadence of a weapon or shoulder launcher from its stats and its Protocols' behaviour (null: not a weapon). */
export function cadenceOf(s: Record<string, number>, shot?: ShotProtocols, cost = 1): Cadence | null {
  if (s.damage === undefined) return null;
  let rounds: number, gap: number;
  if (s.fireRate !== undefined) { rounds = shotRounds(shot?.split, shot?.rate); gap = 1 / Math.max(0.01, s.fireRate); }
  else { rounds = (s.rockets ?? s.shells ?? 1) * shotRounds(shot?.split); gap = Math.max(0.05, (s.cooldown ?? 1) + (s.charge ?? 0)); }
  const magazine = s.magazine ?? 0, reload = s.reload ?? 0;
  const rate = 1 / gap;
  const sustained = magazine > 0 ? sustainedRate(magazine, rounds, cost, gap, reload) : rate;
  let bonus = 0, k = 1;
  for (let i = 0; i < (shot?.chain ?? 0); i++) { k *= CHAIN_KEEP; bonus += k; }
  bonus += (shot?.ricochet ?? 0) > 0 ? RICOCHET_KEEP : 0;
  return { damage: s.damage, rounds, rate, sustained, magazine, reload, cost, bonus };
}

export const dpsOf = (c: Cadence) => c.damage * c.rounds * c.sustained;

/** An item's own cadence: base (its rolled stats, no Protocols) or with its socketed Protocols. */
export function itemCadence(item: Item, withProtocols = true): Cadence | null {
  if (!BASE_BY_ID[item.base] && item.kind !== "weapon" && item.kind !== "shoulder") return null;
  if (!withProtocols) return cadenceOf(item.stats);
  return cadenceOf(effectiveStats(item), shotProtocolsOf(item.socketed), shotCostOf(item.socketed));
}

/** Base DPS and DPS with its Protocols (null for anything that isn't a weapon or launcher). */
export function itemDpsPair(item: Item): { base: number; withProtocols: number } | null {
  const a = itemCadence(item, false), b = itemCadence(item, true);
  return a && b ? { base: dpsOf(a), withProtocols: dpsOf(b) } : null;
}
