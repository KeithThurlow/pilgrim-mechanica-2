// High value targets (docs/proposal-quests.md, Keith 2026-10-31: "go into the area of a high value target and summon
// it by destroying enough enemies in the area of a given type... mini bosses or like quest targets"). Pure: lairs sit on
// swarm and bandit camps (seeded by the camp's id), kills of the lair's kind inside its circle count up, and at the
// count the HVT is summoned after a short warning. Walk past the leash and it goes back to ground (the count resets);
// once killed the lair is spent until restart(). The glue (questLoop.ts, hvtMech.ts) puts a rival mech on the field.
//
//   dormant --kills >= need--> stirring --hvtDelay--> summoned --killed--> dead
//                                 \______ past the leash: back to dormant, count 0 ______/
//
// Host owned (rule 12): lair ids hvt:<camp id>, events as plain data.
import type { Param } from "../core/tweaks";
import { rng } from "../world/pois";
import type { KillKind } from "./contracts";

export const HVT_DEFAULTS = {
  hvtSeed: 3,
  hvtShare: 0.35,
  hvtMinDepth: 400,
  hvtRadius: 180,
  hvtNeedScrapper: 20,
  hvtNeedCutter: 5,
  hvtNeedBandit: 12,
  hvtDelay: 6,
  hvtSpawn: 110,
  hvtArena: 260,
  hvtLeash: 420,
  hvtUp: 3,
  hvtHull: 2,
  hvtDrops: 3,
};
export type HvtValues = typeof HVT_DEFAULTS;

export const HVT_GROUP = "High value targets";
const G = HVT_GROUP;
export const HVT_PARAMS: Param[] = [
  { key: "hvtShare", label: "Camps with a lair", min: 0, max: 1, step: 0.05, group: G, tip: "Share of swarm and bandit camps (past the min depth) that hide a high value target" },
  { key: "hvtMinDepth", label: "Lairs from depth (m)", min: 0, max: 3000, step: 50, group: G, tip: "No lairs closer than this to the road" },
  { key: "hvtRadius", label: "Kills count within (m)", min: 30, max: 600, step: 10, group: G },
  { key: "hvtNeedScrapper", label: "Summon: scrappers", min: 1, max: 100, step: 1, group: G },
  { key: "hvtNeedCutter", label: "Summon: cutters", min: 1, max: 40, step: 1, group: G },
  { key: "hvtNeedBandit", label: "Summon: bandits", min: 1, max: 60, step: 1, group: G },
  { key: "hvtDelay", label: "Warning before it comes (s)", min: 0, max: 30, step: 0.5, group: G },
  { key: "hvtSpawn", label: "It walks in from (m)", min: 20, max: 300, step: 5, group: G },
  { key: "hvtArena", label: "It fights within (m of the lair)", min: 60, max: 800, step: 10, group: G },
  { key: "hvtLeash", label: "Gone to ground past (m)", min: 100, max: 1500, step: 10, group: G, tip: "Leave the lair this far and it leaves: the count starts again" },
  { key: "hvtUp", label: "Item levels above the area", min: -5, max: 20, step: 1, group: G },
  { key: "hvtHull", label: "Hull (× its parts')", min: 0.25, max: 8, step: 0.05, group: G },
  { key: "hvtDrops", label: "Items it drops", min: 0, max: 10, step: 1, group: G, tip: "At least rare" },
];

export type LairState = "dormant" | "stirring" | "summoned" | "dead";

export interface Lair {
  id: string;
  /** The camp it sits on. */
  camp: string;
  x: number; z: number;
  name: string;
  cull: KillKind;
  need: number;
  kills: number;
  state: LairState;
  /** Seconds left of the warning (stirring). */
  t: number;
  /** Rolls its mech's loadout. */
  seed: number;
}

export type HvtEvent =
  | { type: "counted"; lair: Lair }
  | { type: "stirring"; lair: Lair }
  | { type: "summon"; lair: Lair; x: number; z: number }
  | { type: "escaped"; lair: Lair }
  | { type: "killed"; lair: Lair };

/** A camp as the lairs see it (swarm camps and bandit camps alike). */
export interface CampRef { id: string; x: number; z: number; faction: "robot" | "bandit" }

const FIRST = ["Rust", "Widow", "Grin", "Ash", "Hollow", "Saint", "Cinder", "Iron", "Mother", "Dune", "Static", "Gallows"];
const LAST = ["jaw", " Nine", "reaper", " Tallow", " Marrow", " Vane", "back", " Hymn", " Shrike", "tooth", " Ruin", " Choir"];

/** A string to a seed (stable across runs and peers). */
export function strSeed(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0 || 1;
}

export class Lairs {
  private cache = new Map<string, Lair | null>();
  readonly events: HvtEvent[] = [];
  /** Metres from the road at a place (src/expedition/depth.ts); none: everywhere counts as deep. */
  depth: ((x: number, z: number) => number) | null = null;

  constructor(public v: HvtValues) {}

  /** New run or new world: every lair dormant again (the dead ones too). */
  reset() { this.cache.clear(); this.events.length = 0; }

  /** The lair at a camp, or null (seeded by the camp's id). */
  at(c: CampRef): Lair | null {
    let l = this.cache.get(c.id);
    if (l === undefined) { l = this.place(c); this.cache.set(c.id, l); }
    return l;
  }

  /** Lairs looked at so far (the ones near where anyone has been). */
  known(): Lair[] { const out: Lair[] = []; for (const l of this.cache.values()) if (l) out.push(l); return out; }
  get(id: string): Lair | null { for (const l of this.cache.values()) if (l && l.id === id) return l; return null; }
  /** The one on the field (summoned), if any. */
  get summoned(): Lair | null { for (const l of this.cache.values()) if (l && l.state === "summoned") return l; return null; }

  private place(c: CampRef): Lair | null {
    const v = this.v, r = rng(strSeed(c.id, v.hvtSeed));
    if (r() >= v.hvtShare) return null;
    if (this.depth && this.depth(c.x, c.z) < v.hvtMinDepth) return null;
    const cull: KillKind = c.faction === "bandit" ? "bandit" : r() < 0.7 ? "scrapper" : "cutter";
    const need = cull === "bandit" ? v.hvtNeedBandit : cull === "cutter" ? v.hvtNeedCutter : v.hvtNeedScrapper;
    const name = FIRST[Math.floor(r() * FIRST.length)] + LAST[Math.floor(r() * LAST.length)];
    return { id: `hvt:${c.id}`, camp: c.id, x: c.x, z: c.z, name, cull, need: Math.max(1, Math.round(need)), kills: 0, state: "dormant", t: 0, seed: strSeed(c.id, 977) };
  }

  /** Something died: counts toward every dormant lair of that kind whose circle it fell in. */
  kill(kind: KillKind, x: number, z: number) {
    const v = this.v;
    for (const l of this.cache.values()) {
      if (!l || l.state !== "dormant" || l.cull !== kind || Math.hypot(x - l.x, z - l.z) > v.hvtRadius) continue;
      l.kills++;
      this.events.push({ type: "counted", lair: l });
      if (l.kills >= l.need) { l.state = "stirring"; l.t = v.hvtDelay; this.events.push({ type: "stirring", lair: l }); }
    }
  }

  /**
   * Time passes with the player at (x, z): the warning counts down and the HVT walks in on the far side of the lair
   * from the player (one on the field at a time; a second waits); past the leash a stirring or summoned one leaves.
   */
  step(dt: number, x: number, z: number) {
    const v = this.v, busy = !!this.summoned;
    for (const l of this.cache.values()) {
      if (!l || l.state === "dormant" || l.state === "dead") continue;
      if (Math.hypot(x - l.x, z - l.z) > v.hvtLeash) {
        l.state = "dormant"; l.kills = 0; l.t = 0;
        this.events.push({ type: "escaped", lair: l });
        continue;
      }
      if (l.state === "stirring" && !busy) {
        l.t -= dt;
        if (l.t <= 0) {
          const dx = l.x - x, dz = l.z - z, d = Math.hypot(dx, dz) || 1;
          l.state = "summoned";
          this.events.push({ type: "summon", lair: l, x: l.x + (dx / d) * v.hvtSpawn, z: l.z + (dz / d) * v.hvtSpawn });
          return;
        }
      }
    }
  }

  /** Its mech died. */
  killed(id: string) {
    const l = this.get(id);
    if (!l || l.state !== "summoned") return false;
    l.state = "dead";
    this.events.push({ type: "killed", lair: l });
    return true;
  }

  /** The mech couldn't be put on the field (or was taken off it): back to dormant without a fight. */
  stand(id: string) { const l = this.get(id); if (l && l.state === "summoned") { l.state = "dormant"; l.kills = 0; } }
}
