// What the convoy's radar has to say about the sand (pure, seeded, a function of position like the POIs):
// - swarm camps: groups of robots out in the desert, each with a size (how many) and the convoy radar's rough
//   estimate of its danger (Keith 2026-10-25: heat blobs, a rough estimate, nothing exact; off by up to campGuess);
// - unknown areas: patches the convoy radar says nothing about, no estimate at all; only going there tells you.
// Both on square cells: each cell's hash decides 0-1 of them, where (inset in the cell), and how big.
import type { Param } from "../core/tweaks";
import { hash4, rng } from "../world/pois";

export const CAMP_DEFAULTS = {
  campSeed: 7,
  campCell: 650,
  campChance: 0.5,
  campMin: 8,
  campMax: 36,
  campGuess: 0.4,
  campClear: 350,
  fogCell: 1100,
  fogChance: 0.3,
  fogMin: 180,
  fogMax: 420,
};
export type CampValues = typeof CAMP_DEFAULTS;

const G = "Swarm camps", F = "Unknown areas";
export const CAMP_PARAMS: Param[] = [
  { key: "campSeed", label: "Seed", min: 1, max: 999, step: 1, group: G, onRelease: true },
  { key: "campCell", label: "Cell size (m)", min: 200, max: 2000, step: 10, group: G, tip: "At most one camp per cell", onRelease: true },
  { key: "campChance", label: "Chance per cell", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "campMin", label: "Smallest camp (robots)", min: 1, max: 100, step: 1, group: G, onRelease: true },
  { key: "campMax", label: "Biggest camp (robots)", min: 1, max: 200, step: 1, group: G, onRelease: true },
  { key: "campGuess", label: "Radar's guess off by (±share)", min: 0, max: 1, step: 0.01, group: G, tip: "How wrong the convoy radar's danger estimate can be", onRelease: true },
  { key: "campClear", label: "None within (m) of the start", min: 0, max: 1500, step: 10, group: G, onRelease: true },
  { key: "fogCell", label: "Cell size (m)", min: 300, max: 4000, step: 10, group: F, onRelease: true },
  { key: "fogChance", label: "Chance per cell", min: 0, max: 1, step: 0.01, group: F, onRelease: true },
  { key: "fogMin", label: "Smallest radius (m)", min: 30, max: 1000, step: 5, group: F, onRelease: true },
  { key: "fogMax", label: "Biggest radius (m)", min: 30, max: 1500, step: 5, group: F, onRelease: true },
];

export interface Camp {
  id: string;
  x: number; z: number;
  /** Robots in it (the truth). */
  size: number;
  /** What the convoy radar thinks (the size, off by up to campGuess). */
  guess: number;
  /** Spread of the group round its centre (m). */
  radius: number;
  seed: number;
}

export interface Unknown { id: string; x: number; z: number; r: number }

export class CampField {
  private camps = new Map<string, Camp | null>();
  private fog = new Map<string, Unknown | null>();
  /** Where the lab starts (no camps near it). */
  start = { x: 0, z: 0 };

  constructor(public v: CampValues) {}

  reset() { this.camps.clear(); this.fog.clear(); }

  camp(i: number, j: number): Camp | null {
    const k = i + ":" + j;
    let c = this.camps.get(k);
    if (c === undefined) { c = this.placeCamp(i, j); this.camps.set(k, c); }
    return c;
  }

  unknown(i: number, j: number): Unknown | null {
    const k = i + ":" + j;
    let u = this.fog.get(k);
    if (u === undefined) { u = this.placeFog(i, j); this.fog.set(k, u); }
    return u;
  }

  /** Camps whose centre is within r of (x, z). */
  campsNear(x: number, z: number, r: number, out: Camp[] = []): Camp[] {
    const C = this.v.campCell;
    for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++)
      for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) {
        const c = this.camp(i, j);
        if (c && Math.hypot(c.x - x, c.z - z) <= r) out.push(c);
      }
    return out;
  }

  /** Unknown areas touching the circle (x, z, r). */
  unknownNear(x: number, z: number, r: number, out: Unknown[] = []): Unknown[] {
    const C = this.v.fogCell, R = r + this.v.fogMax;
    for (let j = Math.floor((z - R) / C); j <= Math.floor((z + R) / C); j++)
      for (let i = Math.floor((x - R) / C); i <= Math.floor((x + R) / C); i++) {
        const u = this.unknown(i, j);
        if (u && Math.hypot(u.x - x, u.z - z) <= r + u.r) out.push(u);
      }
    return out;
  }

  /** Inside an unknown area? */
  hidden(x: number, z: number): boolean {
    const C = this.v.fogCell, ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const u = this.unknown(i, j);
      if (u && Math.hypot(u.x - x, u.z - z) < u.r) return true;
    }
    return false;
  }

  private placeCamp(i: number, j: number): Camp | null {
    const v = this.v, C = v.campCell, r = rng(hash4(v.campSeed, 31, i, j));
    if (r() >= v.campChance) return null;
    const inset = C * 0.2;
    const x = i * C + inset + r() * (C - 2 * inset), z = j * C + inset + r() * (C - 2 * inset);
    if (Math.hypot(x - this.start.x, z - this.start.z) < v.campClear) return null;
    const lo = Math.min(v.campMin, v.campMax), hi = Math.max(v.campMin, v.campMax);
    // Sizes lean small: most camps a handful, a few big.
    const size = Math.round(lo + (hi - lo) * r() * r());
    const guess = Math.max(1, size * (1 + (r() * 2 - 1) * v.campGuess));
    return { id: `camp:${i}:${j}`, x, z, size, guess, radius: 6 + Math.sqrt(size) * 2.5, seed: hash4(v.campSeed, i, j, 97) };
  }

  private placeFog(i: number, j: number): Unknown | null {
    const v = this.v, C = v.fogCell, r = rng(hash4(v.campSeed, 53, i, j));
    if (r() >= v.fogChance) return null;
    const lo = Math.min(v.fogMin, v.fogMax), hi = Math.max(v.fogMin, v.fogMax);
    const rad = lo + (hi - lo) * r();
    const x = i * C + C / 2 + (r() * 2 - 1) * C * 0.3, z = j * C + C / 2 + (r() * 2 - 1) * C * 0.3;
    // Not over the start: the convoy knows where it is.
    if (Math.hypot(x - this.start.x, z - this.start.z) < rad + 250) return null;
    return { id: `fog:${i}:${j}`, x, z, r: rad };
  }
}
