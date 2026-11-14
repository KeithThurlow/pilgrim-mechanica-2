// Repair kit pickups on the sand (Keith 2026-11-14: "repairs could be a type of drop out in the wilderness, like health
// orbs"). Pure and host-owned: a kill rolls (seeded by the world seed and the kill's stable id) whether it leaves one;
// a collector walking within kitOrbReach takes it (no key press, unlike item drops) unless its kits are full, in which
// case it stays; it burns out after kitOrbLife or when left far behind. Plain-data events (rule 12). Separate from
// the item drops (drops.ts) so loot tables don't care about it.
import { hashKey, threatScale, type DropValues } from "./drops";
import type { RepairValues } from "../game/repair";
import { rng } from "../items/generate";

export interface KitOrb { id: string; x: number; z: number; age: number }
export type KitOrbEvent = { type: "dropped"; orb: KitOrb } | { type: "taken"; orb: KitOrb } | { type: "gone"; id: string };
/** Someone who can take a pickup; full: their kits are full, so they can't. */
export interface KitCollector { x: number; z: number; full: boolean }

export class KitOrbs {
  readonly orbs: KitOrb[] = [];
  readonly events: KitOrbEvent[] = [];
  private rolled = new Set<string>();
  constructor(public v: RepairValues & DropValues, public seed: number) {}

  reset() { this.orbs.length = 0; this.rolled.clear(); this.events.length = 0; }

  /** Chance a kill of this threat leaves a kit. */
  chance(threat: number) {
    return Math.min(this.v.kitKillMax, this.v.kitKill + this.v.kitKillThreat * threatScale(this.v, threat));
  }

  /** A kill (stable key, e.g. `${i}.${gen}`): maybe leaves a kit beside (x, z). */
  fromKill(key: string, threat: number, x: number, z: number): KitOrb | null {
    const k = `kitorb:${key}`;
    if (this.rolled.has(k)) return null;
    this.rolled.add(k);
    const r = rng(hashKey(this.seed, k));
    if (r() >= this.chance(threat)) return null;
    const a = r() * Math.PI * 2, d = 1 + r() * 2;
    const orb: KitOrb = { id: k, x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, age: 0 };
    this.orbs.push(orb);
    this.events.push({ type: "dropped", orb });
    return orb;
  }

  /** Age them, burn out old or far ones, let collectors take them. Returns how many were taken. */
  update(dt: number, who: KitCollector[], near: { x: number; z: number }): number {
    let taken = 0;
    const v = this.v;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      if (o.age > v.kitOrbLife || Math.hypot(o.x - near.x, o.z - near.z) > v.dropForget) {
        this.orbs.splice(i, 1); this.events.push({ type: "gone", id: o.id }); continue;
      }
      if (who.some((c) => !c.full && Math.hypot(o.x - c.x, o.z - c.z) <= v.kitOrbReach)) {
        this.orbs.splice(i, 1); this.events.push({ type: "taken", orb: o }); taken++;
      }
    }
    return taken;
  }
}
