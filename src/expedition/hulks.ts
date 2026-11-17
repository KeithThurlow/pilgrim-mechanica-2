// Mech salvage (Keith 2026-11-16, after the old project's targeted salvage, Keith 2026-10-13/14): a beaten bandit
// mech leaves a hulk with the parts it had fitted. Stand by it, open it (E) and pull the part you want: the pull
// channels a moment (the mech rips it off fast and loud, the pilot on foot unbolts it slowly with a better chance),
// then rolls. The first pull is sure, or close to it when the part outlevels you; each later pull is less likely; a
// failed pull jams the hulk: nothing more comes off it, and what's left pays a share of its scrap value. Nothing
// explodes, it just gets harder to get parts off.
//   chance(first) = max(pullFirstMin, pullFirst − pullLevel × gap) + pilot
//   chance(n ≥ 2) = pullSecond × pullDecay^(n−2) − pullRarity × tier − pullTonne × weight − pullLevel × gap + pilot
//   gap = the part's level over the player's (0 when it's at or under); pilot = pullPilot on foot; clamped to pullMin..1.
// At the defaults, parts at your level: 100%, then 60/36/22/13% less a little for rare and heavy parts.
// Pure; host owned (rule 12): the hulks, their parts, every pull's roll (seeded from the hulk's stable id and how many
// pulls it has had) and the jam. What happens is plain-data events, drained by the glue.
import type { Param } from "../core/tweaks";
import type { Item } from "../items/item";
import { tierOf } from "../items/rarity";
import { levelOf } from "../items/level";
import { itemValue, VALUE_DEFAULTS, type ValueValues } from "../items/value";
import { rng } from "../items/generate";
import { hashKey } from "./drops";

export const HULK_DEFAULTS = {
  pullFirst: 1,
  pullFirstMin: 0.75,
  pullSecond: 0.6,
  pullDecay: 0.6,
  pullRarity: 0.03,
  pullTonne: 0.01,
  pullLevel: 0.03,
  pullPilot: 0.1,
  pullMin: 0.02,
  pullMech: 1.5,
  pullHand: 4,
  hulkReachMech: 8,
  hulkReachPilot: 5,
  jamScrap: 0.5,
  hulkForget: 600,
};
export type HulkValues = typeof HULK_DEFAULTS;

export const HULK_GROUP = "Mech salvage";
const G = HULK_GROUP;
export const HULK_PARAMS: Param[] = [
  { key: "pullFirst", label: "First pull: chance", min: 0, max: 1, step: 0.01, group: G, tip: "Keith 2026-11-16: the first part off a hulk is sure, or close to it. Less the level gap below" },
  { key: "pullFirstMin", label: "First pull: never under", min: 0, max: 1, step: 0.01, group: G, tip: "However far the part outlevels you, the first pull is at least this" },
  { key: "pullSecond", label: "Second pull: chance", min: 0, max: 1, step: 0.01, group: G, tip: "Before the part's own penalties (rarity, weight, level)" },
  { key: "pullDecay", label: "Each later pull ×", min: 0.1, max: 1, step: 0.01, group: G, tip: "0.6: 60, 36, 22, 13%..." },
  { key: "pullRarity", label: "Later pulls − per rarity tier", min: 0, max: 0.2, step: 0.005, group: G, tip: "Rarer parts are harder to get off (Common 0, Legendary 4 tiers)" },
  { key: "pullTonne", label: "Later pulls − per tonne", min: 0, max: 0.05, step: 0.001, group: G, tip: "Heavy parts (legs, hulls) are harder to get off" },
  { key: "pullLevel", label: "Every pull − per level over yours", min: 0, max: 0.2, step: 0.005, group: G, tip: "A part above your mech's item level is harder to get off, the first pull too (Keith: 'maybe dependent on level')" },
  { key: "pullPilot", label: "On foot + chance", min: 0, max: 0.5, step: 0.01, group: G, tip: "The pilot unbolts it carefully (slower, quieter); the mech rips it off" },
  { key: "pullMin", label: "Later pulls never under", min: 0, max: 0.5, step: 0.01, group: G },
  { key: "pullMech", label: "Pull time: mech (s)", min: 0.1, max: 10, step: 0.1, group: G },
  { key: "pullHand", label: "Pull time: on foot (s)", min: 0.1, max: 20, step: 0.1, group: G },
  { key: "hulkReachMech", label: "Mech reaches a hulk within (m)", min: 2, max: 20, step: 0.5, group: G },
  { key: "hulkReachPilot", label: "Pilot reaches a hulk within (m)", min: 1, max: 10, step: 0.5, group: G },
  { key: "jamScrap", label: "Jammed: scrap × the parts left", min: 0, max: 2, step: 0.05, group: G, tip: "A failed pull jams the hulk; the parts still on it pay this share of their scrap value" },
  { key: "hulkForget", label: "Hulks forgotten past (m)", min: 50, max: 3000, step: 10, group: G },
];

export interface Hulk {
  /** Stable (the mech's own id): every peer agrees on it, and the rolls are seeded from it. */
  id: string;
  label: string;
  x: number; z: number;
  /** The parts still on it. */
  parts: Item[];
  /** Pulls tried so far (the first is the sure one). */
  pulls: number;
  jammed: boolean;
}

export type HulkEvent =
  | { type: "pulled"; hulk: Hulk; item: Item; chance: number; onFoot: boolean }
  | { type: "jammed"; hulk: Hulk; item: Item; chance: number; scrap: number }
  | { type: "cancelled"; hulk: Hulk; item: Item };

export interface PullCtx { playerLevel: number; onFoot: boolean }
export interface Pulling { hulk: Hulk; item: Item; t: number; time: number; onFoot: boolean }

/** Parts a hulk offers: everything fitted but the arms (they come with the hull, Keith 2026-11-03). */
export function hulkParts(fitted: readonly (Item | null)[]): Item[] {
  return fitted.filter((i): i is Item => !!i && i.kind !== "arm" && i.kind !== "protocol");
}

/** The chance the next pull of this part off this hulk succeeds. */
export function pullChance(v: HulkValues, pulls: number, item: Item, ctx: PullCtx): number {
  const gap = Math.max(0, levelOf(item) - Math.max(1, ctx.playerLevel));
  const pilot = ctx.onFoot ? v.pullPilot : 0;
  if (pulls <= 0) return Math.min(1, Math.max(v.pullFirstMin, v.pullFirst - v.pullLevel * gap) + pilot);
  const base = v.pullSecond * Math.pow(v.pullDecay, pulls - 1);
  const c = base - v.pullRarity * tierOf(item.rarity) - v.pullTonne * Math.max(0, item.weight) - v.pullLevel * gap + pilot;
  return Math.min(1, Math.max(v.pullMin, c));
}

/** The roll for a hulk's nth pull (0..1), seeded: the same on every peer and every replay. */
export function pullRoll(seed: number, id: string, pulls: number): number {
  return rng(hashKey(seed, `hulk:${id}:${pulls}`))();
}

export class Hulks {
  readonly list: Hulk[] = [];
  readonly events: HulkEvent[] = [];
  pulling: Pulling | null = null;
  private known = new Set<string>();

  constructor(public v: HulkValues, public seed = 1, public value: ValueValues = VALUE_DEFAULTS) {}

  reset() { this.list.length = 0; this.known.clear(); this.pulling = null; this.events.length = 0; }

  /** A mech went down: its hulk, once per id (a wreck that streams out and back in isn't a second hulk). */
  add(id: string, label: string, x: number, z: number, fitted: readonly (Item | null)[]): Hulk | null {
    if (this.known.has(id)) return null;
    const parts = hulkParts(fitted);
    if (!parts.length) return null;
    this.known.add(id);
    const h: Hulk = { id, label, x, z, parts: parts.slice(), pulls: 0, jammed: false };
    this.list.push(h);
    return h;
  }

  /** Its wreck is gone (freed off the field): the hulk with it. */
  remove(id: string) {
    const k = this.list.findIndex((h) => h.id === id);
    if (k < 0) return;
    if (this.pulling?.hulk === this.list[k]) this.cancel();
    this.list.splice(k, 1);
  }

  /** Parts left to pull off this hulk (0 when picked clean, jammed or gone). */
  left(id: string) { const h = this.list.find((q) => q.id === id); return h && !h.jammed ? h.parts.length : 0; }

  /** The nearest hulk with parts left in reach of (x, z), or null; jammed: jammed ones count too (to look at). */
  nearest(x: number, z: number, reach: number, jammed = false): Hulk | null {
    let best: Hulk | null = null, bd = reach;
    for (const h of this.list) {
      if ((h.jammed && !jammed) || !h.parts.length) continue;
      const d = Math.hypot(h.x - x, h.z - z);
      if (d <= bd) { bd = d; best = h; }
    }
    return best;
  }

  chance(h: Hulk, item: Item, ctx: PullCtx) { return pullChance(this.v, h.pulls, item, ctx); }

  /** Scrap a jammed hulk pays for the parts left on it. */
  jamPay(parts: readonly Item[]) { return Math.round(this.v.jamScrap * parts.reduce((s, i) => s + itemValue(i, this.value), 0)); }

  /** Start pulling a part (not while another pull is under way: a click again doesn't start it over). */
  begin(h: Hulk, item: Item, onFoot: boolean): boolean {
    if (this.pulling || h.jammed || !h.parts.includes(item)) return false;
    this.pulling = { hulk: h, item, t: 0, time: Math.max(0.05, onFoot ? this.v.pullHand : this.v.pullMech), onFoot };
    return true;
  }

  cancel() {
    const p = this.pulling;
    if (p) this.events.push({ type: "cancelled", hulk: p.hulk, item: p.item });
    this.pulling = null;
  }

  /**
   * One frame. who: the puller's place (the pilot on foot, else the mech; null: nobody can pull, the pull stops);
   * a pull under way stops when the puller leaves reach or changes between mech and foot.
   */
  update(dt: number, who: { x: number; z: number; onFoot: boolean } | null, playerLevel: number) {
    const v = this.v;
    // Hulks left far behind are gone.
    if (who) for (let k = this.list.length - 1; k >= 0; k--) if (Math.hypot(this.list[k].x - who.x, this.list[k].z - who.z) > v.hulkForget) this.list.splice(k, 1);
    const p = this.pulling;
    if (!p) return;
    const reach = p.onFoot ? v.hulkReachPilot : v.hulkReachMech;
    if (!who || who.onFoot !== p.onFoot || Math.hypot(p.hulk.x - who.x, p.hulk.z - who.z) > reach + 0.5 || !this.list.includes(p.hulk)) { this.cancel(); return; }
    p.t += dt;
    if (p.t < p.time) return;
    this.pulling = null;
    const h = p.hulk, chance = pullChance(v, h.pulls, p.item, { playerLevel, onFoot: p.onFoot });
    const roll = pullRoll(this.seed, h.id, h.pulls);
    h.pulls++;
    if (roll < chance) {
      h.parts.splice(h.parts.indexOf(p.item), 1);
      this.events.push({ type: "pulled", hulk: h, item: p.item, chance, onFoot: p.onFoot });
    } else {
      h.jammed = true;
      const scrap = this.jamPay(h.parts);
      this.events.push({ type: "jammed", hulk: h, item: p.item, chance, scrap });
    }
  }
}
