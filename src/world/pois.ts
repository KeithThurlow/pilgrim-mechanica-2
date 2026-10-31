// Points of interest: where they are, as a pure function of position (like the ground). No rendering here.
//
// The world is cut into square cells on a few grid levels: tiers 1-2 on `poiCell` (about 400 m), tier 3 on cells
// twice that, tiers 4-5 four times (so big POIs are rarer and further apart). Each cell's hash decides whether it
// holds a POI (`poiChance`), which tier (the tier weights), which kind (the kinds' weights in the biome there), where
// in the cell (the flattest of a few tries), and its seed. Positions are kept `poiSpacing / 2` (and the POI's own
// reach) inside their cell, so two POIs are never closer than the spacing and a pad never crosses its cell's edge.
// A small POI that falls near a bigger one from a coarser level gives way. Any cell can be asked in any order.
//
// Tiers (docs/proposal-pois.md): 1 Glance, 2 Stop, 3 Fight, 4 Expedition, 5 Siege. Kinds for tiers 3-5 come later;
// their levels exist and stay empty until a kind is listed for them.
import type { Param } from "../core/tweaks";

export type PoiKind = "outcrop" | "wreckPart" | "supplyPod" | "debrisField" | "deadConvoy" | "fortress" | "hub";
export type Tier = 1 | 2 | 3 | 4 | 5;

/** Biome weights at a point (desert, rocky desolation, shallows); src/world/biomes.ts provides them when it lands. */
export interface BiomeWeights { desert: number; rocky: number; shallows: number }
export type BiomeAt = (x: number, z: number) => BiomeWeights;
const ALL_DESERT: BiomeAt = () => ({ desert: 1, rocky: 0, shallows: 0 });

/** One kind's placement data. Contents (sections, spots, props) are built by src/pois/<kind>.ts. */
export interface PoiKindDef {
  kind: PoiKind;
  label: string;
  tier: Tier;
  /** Relative chance among its tier's kinds, per biome. */
  biome: BiomeWeights;
  /** Radius it covers (m): kept inside its cell, used for spacing and for the flatness test. */
  footprint: number;
  /** Values key for its pad radius (0 or missing: no pad, it sits on the dunes as they are). */
  padKey?: string;
  /** Values key for the pad's half-length (a capsule along its heading, e.g. a line of vehicles). */
  padHalfKey?: string;
}

export const POI_KINDS: Record<PoiKind, PoiKindDef> = {
  outcrop: { kind: "outcrop", label: "Rock outcrop", tier: 1, biome: { desert: 0.6, rocky: 1.8, shallows: 1.2 }, footprint: 10 },
  wreckPart: { kind: "wreckPart", label: "Wreck part", tier: 1, biome: { desert: 1, rocky: 1, shallows: 0.8 }, footprint: 10 },
  supplyPod: { kind: "supplyPod", label: "Supply pod", tier: 1, biome: { desert: 1, rocky: 0.8, shallows: 0.7 }, footprint: 9 },
  debrisField: { kind: "debrisField", label: "Debris field", tier: 2, biome: { desert: 1, rocky: 0.9, shallows: 0.7 }, footprint: 30, padKey: "debrisPad" },
  deadConvoy: { kind: "deadConvoy", label: "Dead convoy", tier: 2, biome: { desert: 1.2, rocky: 0.5, shallows: 0.3 }, footprint: 28, padKey: "convoyPad", padHalfKey: "convoyPadHalf" },
  // Tier 5 (Keith 2026-10-31, docs/proposal-fortresses.md): where the bandits and war bands gather, and where the robots
  // are built. Footprints cover their pads (the walls stand inside).
  fortress: { kind: "fortress", label: "Bandit fortress", tier: 5, biome: { desert: 1.2, rocky: 0.8, shallows: 0 }, footprint: 112, padKey: "fortPad" },
  hub: { kind: "hub", label: "Manufacturing hub", tier: 5, biome: { desert: 0.6, rocky: 1.5, shallows: 0 }, footprint: 75, padKey: "hubPad" },
};
export const POI_KIND_LIST = Object.keys(POI_KINDS) as PoiKind[];

/** Grid levels: which tiers each places, and its cell size as a multiple of `poiCell`. Coarsest first. */
export const POI_LEVELS: { tiers: Tier[]; scale: number }[] = [
  { tiers: [4, 5], scale: 4 },
  { tiers: [3], scale: 2 },
  { tiers: [1, 2], scale: 1 },
];

export const POI_DEFAULTS = {
  poiSeed: 1,
  poiCell: 400,
  poiChance: 0.75,
  poiSpacing: 140,
  poiTries: 6,
  tier1Weight: 1,
  tier2Weight: 0.5,
  tier3Weight: 1,
  tier4Weight: 1,
  tier5Weight: 0.25,
  bigChance: 0.6,
  padBlend: 14,
  padRough: 0.15,
  debrisPad: 20,
  convoyPad: 8,
  convoyPadHalf: 18,
  fortPad: 104,
  hubPad: 68,
  siegeClear: 900,
};
export type PoiValues = typeof POI_DEFAULTS;

const G = "POI placement", P = "Pads";
export const POI_PARAMS: Param[] = [
  { key: "poiSeed", label: "Seed", min: 1, max: 999, step: 1, group: G, onRelease: true },
  { key: "poiCell", label: "Cell size (m)", min: 150, max: 1200, step: 10, group: G, tip: "Tiers 1-2 get at most one POI per cell; tier 3 cells are twice this, tiers 4-5 four times", onRelease: true },
  { key: "poiChance", label: "Chance per cell", min: 0, max: 1, step: 0.01, group: G, tip: "Share of small cells holding a tier 1-2 POI", onRelease: true },
  { key: "bigChance", label: "Chance per big cell", min: 0, max: 1, step: 0.01, group: G, tip: "Share of tier 3 and tier 4-5 cells holding one (once those kinds exist)", onRelease: true },
  { key: "poiSpacing", label: "Minimum spacing (m)", min: 40, max: 400, step: 5, group: G, tip: "No two POIs closer than this", onRelease: true },
  { key: "poiTries", label: "Flat-ground tries", min: 1, max: 16, step: 1, group: G, tip: "Spots tried in each cell; the flattest wins (so POIs favour the flats between dunes)", onRelease: true },
  { key: "tier1Weight", label: "Tier 1 (glance) weight", min: 0, max: 3, step: 0.05, group: G, onRelease: true },
  { key: "tier2Weight", label: "Tier 2 (stop) weight", min: 0, max: 3, step: 0.05, group: G, onRelease: true },
  { key: "siegeClear", label: "Fortresses and hubs none within (m) of the start", min: 0, max: 4000, step: 10, group: G, tip: "Added to the start's own clear circle", onRelease: true },
  { key: "padBlend", label: "Pad edge blend (m)", min: 4, max: 40, step: 0.5, group: P, tip: "Width of the slope from a pad back up (or down) to the dunes", onRelease: true },
  { key: "padRough", label: "Pad roughness", min: 0, max: 1, step: 0.01, group: P, tip: "Share of the small bumps left on a pad", onRelease: true },
];

/** A levelled pad: a capsule (segment of half-length `half` along `yaw`, radius `r`) at height `h`. */
export interface Pad {
  x: number; z: number; yaw: number;
  r: number; half: number; blend: number;
  /** Pad height (world). */
  h: number;
  /**
   * The swell under the pad as a quadratic about its centre (value, slopes, curvatures), so the pad's floor can cancel
   * it and stay level: swell ~ s0 + sx dx + sz dz + sxx dx^2 + szz dz^2 + sxz dx dz.
   */
  s0: number; sx: number; sz: number; sxx: number; szz: number; sxz: number;
  rough: number;
}

export interface PoiPlacement {
  /** Stable id: level and cell (or "show:N" for placed by hand). */
  id: string;
  kind: PoiKind;
  tier: Tier;
  x: number; z: number; yaw: number;
  seed: number;
  pad: Pad | null;
  /** Grid level index (POI_LEVELS), -1 for hand-placed. */
  level: number;
  /** Its reach (footprint + pad blend), for spacing. */
  reach: number;
}

/** What placement reads of the ground: the dunes without any modifier, and the slow swell under them. */
export interface RawGround {
  height(x: number, z: number): number;
  swell(x: number, z: number): number;
}

// ---- hashing: integer hash per (seed, level, i, j), then a small seeded generator ----

export function hash4(a: number, b: number, c: number, d: number) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d) ^ Math.imul(d | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** mulberry32: a seeded random generator (0..1). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pad radius and half-length a kind asks for (0 radius: no pad). */
export function padSize(kind: PoiKind, v: PoiValues): { r: number; half: number } {
  const d = POI_KINDS[kind];
  const vv = v as unknown as Record<string, number>;
  return { r: d.padKey ? vv[d.padKey] ?? 0 : 0, half: d.padHalfKey ? vv[d.padHalfKey] ?? 0 : 0 };
}

/**
 * The world's POIs. Pure: every answer is a function of the values, the raw ground and the biome map. Cells are
 * cached as they're asked for; `reset()` after changing any value or the ground.
 */
export class PoiField {
  private cache = new Map<string, PoiPlacement | null>();
  /** Hand-placed POIs (a lab's showcase); kept clear of the generated ones by `keepClear`. */
  readonly extra: PoiPlacement[] = [];
  /** Circles no generated POI may reach into (x, z, radius). */
  keepClear: { x: number; z: number; r: number }[] = [];
  biomeAt: BiomeAt;

  constructor(public v: PoiValues, public ground: RawGround, biomeAt?: BiomeAt) {
    this.biomeAt = biomeAt ?? ALL_DESERT;
  }

  reset() { this.cache.clear(); }

  /** Cell size of a level (m). */
  cellSize(level: number) { return this.v.poiCell * POI_LEVELS[level].scale; }

  /** The POI in cell (i, j) of a level, or null. */
  cell(level: number, i: number, j: number): PoiPlacement | null {
    const key = level + ":" + i + ":" + j;
    let p = this.cache.get(key);
    if (p === undefined) { p = this.place(level, i, j); this.cache.set(key, p); }
    return p;
  }

  /** Every POI (generated and hand-placed) whose position is inside the box. */
  poisIn(x0: number, z0: number, x1: number, z1: number, out: PoiPlacement[] = []): PoiPlacement[] {
    for (let l = 0; l < POI_LEVELS.length; l++) {
      const C = this.cellSize(l);
      for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) {
        const p = this.cell(l, i, j);
        if (p && p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) out.push(p);
      }
    }
    for (const p of this.extra) if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) out.push(p);
    return out;
  }

  /** The generated POI of each level whose cell holds (x, z) (pads never cross their cell, so only these can reach it). */
  cellsAt(x: number, z: number, out: (PoiPlacement | null)[]): (PoiPlacement | null)[] {
    for (let l = 0; l < POI_LEVELS.length; l++) {
      const C = this.cellSize(l);
      out[l] = this.cell(l, Math.floor(x / C), Math.floor(z / C));
    }
    return out;
  }

  /** Place a POI of a kind by hand at (x, z) (a lab's showcase), its pad levelled the same way. */
  placeAt(id: string, kind: PoiKind, x: number, z: number, yaw: number, seed: number): PoiPlacement {
    const d = POI_KINDS[kind];
    const p: PoiPlacement = { id, kind, tier: d.tier, x, z, yaw, seed: seed >>> 0, pad: null, level: -1, reach: d.footprint + this.v.padBlend };
    p.pad = this.makePad(kind, x, z, yaw);
    return p;
  }

  private place(level: number, i: number, j: number): PoiPlacement | null {
    const v = this.v, lv = POI_LEVELS[level], C = this.cellSize(level);
    const r = rng(hash4(v.poiSeed, level + 1, i, j));
    const chance = lv.scale === 1 ? v.poiChance : v.bigChance;
    if (r() >= chance) return null;
    // Which tier: by the tier weights, among tiers that have kinds.
    const vv = v as unknown as Record<string, number>;
    const tiers = lv.tiers.filter((t) => POI_KIND_LIST.some((k) => POI_KINDS[k].tier === t));
    if (!tiers.length) return null;
    const tier = pick(tiers, (t) => vv[`tier${t}Weight`] ?? 0, r());
    if (tier === undefined) return null;
    // Where: the flattest of a few tries inside the cell's inset (the kind isn't known yet; use the tier's widest).
    const kinds = POI_KIND_LIST.filter((k) => POI_KINDS[k].tier === tier);
    const wide = Math.max(...kinds.map((k) => POI_KINDS[k].footprint)) + v.padBlend;
    const inset = Math.min(C * 0.45, Math.max(v.poiSpacing / 2, wide));
    const ox = i * C, oz = j * C;
    let bx = 0, bz = 0, best = Infinity;
    const tries = Math.max(1, Math.round(v.poiTries));
    for (let t = 0; t < tries; t++) {
      const x = ox + inset + r() * (C - 2 * inset), z = oz + inset + r() * (C - 2 * inset);
      const rough = this.roughness(x, z, wide * 0.7);
      if (rough < best) { best = rough; bx = x; bz = z; }
    }
    // Which kind: by its weights in the biome there.
    const b = this.biomeAt(bx, bz);
    const ku = r();
    const kind = pick(kinds, (k) => { const w = POI_KINDS[k].biome; return w.desert * b.desert + w.rocky * b.rocky + w.shallows * b.shallows; }, ku);
    if (!kind) return null;
    const d = POI_KINDS[kind];
    const reach = d.footprint + v.padBlend;
    // Keep clear of hand-placed areas and of bigger POIs on coarser levels.
    for (const c of this.keepClear) if (Math.hypot(bx - c.x, bz - c.z) < c.r + reach + (d.tier === 5 ? v.siegeClear : 0)) return null;
    for (let l = 0; l < level; l++) {
      const Cl = this.cellSize(l), ci = Math.floor(bx / Cl), cj = Math.floor(bz / Cl);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const q = this.cell(l, ci + di, cj + dj);
        if (q && Math.hypot(q.x - bx, q.z - bz) < Math.max(v.poiSpacing, q.reach + reach)) return null;
      }
    }
    const yaw = r() * Math.PI * 2;
    const seed = hash4(v.poiSeed, i, j, level * 7 + 3);
    const p: PoiPlacement = { id: `${level}:${i}:${j}`, kind, tier: d.tier, x: bx, z: bz, yaw, seed, pad: null, level, reach };
    p.pad = this.makePad(kind, bx, bz, yaw);
    return p;
  }

  /** Spread of the raw ground over a circle (m): low on the flats between dunes. */
  private roughness(x: number, z: number, R: number) {
    const g = this.ground;
    let s = 0, s2 = 0, n = 0;
    for (const [a, k] of SAMPLES) {
      const h = g.height(x + Math.cos(a) * R * k, z + Math.sin(a) * R * k);
      s += h; s2 += h * h; n++;
    }
    const m = s / n;
    return Math.sqrt(Math.max(0, s2 / n - m * m));
  }

  /** A level pad where the kind needs one: at the mean height of the ground it covers (cut and fill balance). */
  private makePad(kind: PoiKind, x: number, z: number, yaw: number): Pad | null {
    const { r, half } = padSize(kind, this.v);
    if (r <= 0) return null;
    const g = this.ground, ax = Math.sin(yaw), az = Math.cos(yaw);
    let s = 0, n = 0;
    for (let t = -1; t <= 1; t += 0.5) for (const [a, k] of SAMPLES) {
      const cx = x + ax * half * t, cz = z + az * half * t;
      s += g.height(cx + Math.cos(a) * (r + this.v.padBlend * 0.5) * k, cz + Math.sin(a) * (r + this.v.padBlend * 0.5) * k);
      n++;
    }
    // Fit the swell over the pad's reach: 3 x 3 samples give the quadratic.
    const e = Math.max(8, r + half + this.v.padBlend * 0.5), s0 = g.swell(x, z);
    const xp = g.swell(x + e, z), xm = g.swell(x - e, z), zp = g.swell(x, z + e), zm = g.swell(x, z - e);
    const pp = g.swell(x + e, z + e), pm = g.swell(x + e, z - e), mp = g.swell(x - e, z + e), mm = g.swell(x - e, z - e);
    return {
      x, z, yaw, r, half, blend: this.v.padBlend, h: s / n, rough: this.v.padRough,
      s0, sx: (xp - xm) / (2 * e), sz: (zp - zm) / (2 * e),
      sxx: (xp - 2 * s0 + xm) / (2 * e * e), szz: (zp - 2 * s0 + zm) / (2 * e * e), sxz: (pp - pm - mp + mm) / (4 * e * e),
    };
  }
}

/** Sample ring: the centre and two rings (angle, share of the radius). */
const SAMPLES: [number, number][] = [[0, 0]];
for (let i = 0; i < 6; i++) SAMPLES.push([(i / 6) * Math.PI * 2, 0.5]);
for (let i = 0; i < 8; i++) SAMPLES.push([((i + 0.5) / 8) * Math.PI * 2, 1]);

function pick<T>(items: T[], weight: (t: T) => number, u: number): T | undefined {
  let sum = 0;
  for (const it of items) sum += Math.max(0, weight(it));
  if (sum <= 0) return undefined;
  let acc = 0;
  for (const it of items) { acc += Math.max(0, weight(it)) / sum; if (u < acc) return it; }
  return items[items.length - 1];
}
