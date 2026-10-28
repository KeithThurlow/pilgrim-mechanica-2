// Bandit camps out in the sand (pure, seeded; Keith 2026-10-28, docs/proposal-factions.md): the settled half of the
// raider faction. A camp sits at a point of interest or a wreck (src/world/pois.ts; a function of the POI, so every peer
// agrees), with a size, more and bigger the further from the road (src/expedition/depth.ts). The glue
// (src/expedition/humans.ts) brings a camp to life as infantry that hold it, patrol near it and stop chasing past a
// leash. Nothing here is drawn or stepped; it only answers "which camps are near here".
import type { Param } from "../core/tweaks";
import { hash4, rng, type PoiKind, type PoiPlacement } from "../world/pois";
import { DEPTH_GROUP, scaled, type DangerFn } from "./depth";

export const BANDIT_DEFAULTS = {
  banditSeed: 5,
  banditRock: 0.1,
  banditPod: 0.2,
  banditWreck: 0.35,
  banditDebris: 0.5,
  banditConvoy: 0.6,
  banditMin: 4,
  banditMax: 14,
  banditTier: 0.25,
  banditClear: 260,
  banditChanceFar: 2,
  banditSizeFar: 2.5,
  banditGuess: 0.4,
  banditSpawn: 650,
  banditDrop: 950,
  banditActive: 300,
  banditWake: 110,
  banditHear: 1,
  banditLeash: 140,
  banditGiveUp: 260,
  banditPatrolShare: 0.3,
  banditPatrolRadius: 45,
  banditPatrolPause: 4,
};
export type BanditValues = typeof BANDIT_DEFAULTS;

const G = "Bandit camps", B = "Bandit camps: behaviour";
export const BANDIT_PARAMS: Param[] = [
  { key: "banditSeed", label: "Seed", min: 1, max: 999, step: 1, group: G, onRelease: true },
  { key: "banditRock", label: "Chance at a rock outcrop", min: 0, max: 1, step: 0.01, group: G, tip: "Every point of interest and wreck rolls for a camp by its kind", onRelease: true },
  { key: "banditPod", label: "Chance at a supply pod", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "banditWreck", label: "Chance at a wreck part", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "banditDebris", label: "Chance at a debris field", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "banditConvoy", label: "Chance at a dead convoy", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "banditMin", label: "Smallest camp (bandits)", min: 1, max: 60, step: 1, group: G, onRelease: true },
  { key: "banditMax", label: "Biggest camp (bandits)", min: 1, max: 120, step: 1, group: G, onRelease: true },
  { key: "banditTier", label: "Bigger per POI tier above 1 (share)", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "banditClear", label: "None within (m) of the start", min: 0, max: 1500, step: 10, group: G, onRelease: true },
  { key: "banditGuess", label: "Radar's guess off by (±share)", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "banditChanceFar", label: "Bandit camps × at full depth (chance)", min: 1, max: 5, step: 0.05, group: DEPTH_GROUP, onRelease: true },
  { key: "banditSizeFar", label: "Bandit camp size × at full depth", min: 1, max: 6, step: 0.05, group: DEPTH_GROUP, onRelease: true },
  { key: "banditSpawn", label: "Stream in within (m)", min: 200, max: 2000, step: 10, group: B, tip: "Camps this close are on the field, asleep" },
  { key: "banditDrop", label: "Stream out past (m)", min: 300, max: 3000, step: 10, group: B },
  { key: "banditActive", label: "Stir within (m)", min: 50, max: 1000, step: 10, group: B, tip: "Closer than this the camp is up: some on patrol, the rest standing guard" },
  { key: "banditWake", label: "Alert within (m)", min: 10, max: 500, step: 5, group: B, tip: "The camp opens fire when the mech gets this close" },
  { key: "banditHear", label: "Hears stripping (× noise radius)", min: 0, max: 3, step: 0.05, group: B },
  { key: "banditLeash", label: "Leash: chase no further than (m from camp)", min: 20, max: 600, step: 5, group: B, tip: "Territorial: past this they stop chasing and walk home" },
  { key: "banditGiveUp", label: "Stand down when the mech is past (m)", min: 50, max: 1000, step: 10, group: B },
  { key: "banditPatrolShare", label: "Share on patrol", min: 0, max: 1, step: 0.05, group: B },
  { key: "banditPatrolRadius", label: "Patrol round the camp (m)", min: 5, max: 200, step: 1, group: B },
  { key: "banditPatrolPause", label: "Patrol pause at each point (s)", min: 0, max: 30, step: 0.5, group: B },
];
export const BANDIT_GROUPS = [G, B];

export interface BanditCamp {
  id: string;
  poi: string;
  kind: PoiKind;
  x: number; z: number;
  /** Bandits in it (the truth) and what the radar thinks. */
  size: number; guess: number;
  /** Spread of the camp round its centre (m). */
  radius: number;
  seed: number;
  danger: number;
}

export class BanditField {
  private cache = new Map<string, BanditCamp | null>();
  start = { x: 0, z: 0 };
  danger: DangerFn | null = null;

  constructor(public v: BanditValues, private poisIn: (x0: number, z0: number, x1: number, z1: number) => PoiPlacement[]) {}

  reset() { this.cache.clear(); }

  private chanceOf(k: PoiKind): number {
    const v = this.v;
    return k === "outcrop" ? v.banditRock : k === "supplyPod" ? v.banditPod : k === "wreckPart" ? v.banditWreck : k === "debrisField" ? v.banditDebris : v.banditConvoy;
  }

  /** The camp at a POI, or null. */
  campAt(p: PoiPlacement): BanditCamp | null {
    let c = this.cache.get(p.id);
    if (c === undefined) { c = this.place(p); this.cache.set(p.id, c); }
    return c;
  }

  /** Camps whose centre is within r of (x, z). */
  campsNear(x: number, z: number, r: number, out: BanditCamp[] = []): BanditCamp[] {
    for (const p of this.poisIn(x - r - 40, z - r - 40, x + r + 40, z + r + 40)) {
      const c = this.campAt(p);
      if (c && Math.hypot(c.x - x, c.z - z) <= r) out.push(c);
    }
    return out;
  }

  private place(p: PoiPlacement): BanditCamp | null {
    const v = this.v, r = rng(hash4(v.banditSeed, 71, Math.round(p.x), Math.round(p.z)));
    const d = this.danger ? this.danger(p.x, p.z) : 0;
    const roll = r();
    if (roll >= Math.min(0.95, this.chanceOf(p.kind) * scaled(v.banditChanceFar, d))) return null;
    if (Math.hypot(p.x - this.start.x, p.z - this.start.z) < v.banditClear) return null;
    const lo = Math.min(v.banditMin, v.banditMax), hi = Math.max(v.banditMin, v.banditMax);
    const size = Math.max(1, Math.round((lo + (hi - lo) * r() * r()) * (1 + v.banditTier * (p.tier - 1)) * scaled(v.banditSizeFar, d)));
    const a = r() * Math.PI * 2, off = 14 + r() * 10;
    return {
      id: `bandit:${p.id}`, poi: p.id, kind: p.kind,
      x: p.x + Math.sin(a) * off, z: p.z + Math.cos(a) * off,
      size, guess: Math.max(1, size * (1 + (r() * 2 - 1) * v.banditGuess)), radius: 4 + Math.sqrt(size) * 1.8,
      seed: hash4(v.banditSeed, 97, Math.round(p.x), Math.round(p.z)), danger: d,
    };
  }
}
