// The dune field: ground height as a pure function of (x, z). Chunks, feet, vehicles and AI all read the same
// function, so nothing ever disagrees about where the ground is, and any chunk can be built in any order.
//
// Shape: transverse dunes at right angles to the wind, a long gentle windward slope and a short steep slip face
// (about 30 degrees, like real sand), crest lines that meander and break into separate dunes, flat interdune
// floors, a slow swell under it all and small bumps on top.
import type { Param } from "../core/tweaks";
import { Noise2, smoothstep, lerp } from "./noise";
import { BiomeMap, type BiomeValues, type BiomeWeights } from "./biomes";
import { RockGround, type RockValues, type RockSample } from "./rock";
import { ShallowsGround, type ShallowsValues, type ShallowsSample } from "./shallows";

/** The biome sliders, when a lab has them: without them the ground is all desert, as before. */
export type WorldValues = TerrainValues & Partial<BiomeValues & RockValues & ShallowsValues>;

export const TERRAIN_DEFAULTS = {
  seed: 7,
  windAngle: 25,
  spacing: 44,
  height: 14,
  slip: 0.24,
  flats: 0.25,
  meander: 0.7,
  warp: 0.45,
  breakup: 0.85,
  cross: 0.55,
  variety: 0.6,
  swell: 5,
  swellScale: 420,
  bumps: 0.25,
  crestSoft: 0.06,
};
export type TerrainValues = typeof TERRAIN_DEFAULTS;

export const TERRAIN_PARAMS: Param[] = [
  { key: "seed", label: "Seed", min: 1, max: 99, step: 1, group: "Dunes", onRelease: true },
  { key: "windAngle", label: "Wind direction", min: 0, max: 180, step: 1, group: "Dunes", tip: "Dune crests run across the wind", onRelease: true },
  { key: "spacing", label: "Dune spacing (m)", min: 30, max: 160, step: 1, group: "Dunes", onRelease: true },
  { key: "height", label: "Dune height (m)", min: 0, max: 18, step: 0.1, group: "Dunes", onRelease: true },
  { key: "slip", label: "Slip face share", min: 0.1, max: 0.5, step: 0.01, group: "Dunes", tip: "Share of each dune that is the steep downwind face", onRelease: true },
  { key: "flats", label: "Interdune flats", min: 0, max: 0.7, step: 0.01, group: "Dunes", tip: "Flat floor between dunes", onRelease: true },
  { key: "meander", label: "Crest meander", min: 0, max: 1, step: 0.01, group: "Shape", onRelease: true },
  { key: "warp", label: "Warp", min: 0, max: 1, step: 0.01, group: "Shape", onRelease: true },
  { key: "breakup", label: "Crest breakup", min: 0, max: 1, step: 0.01, group: "Shape", tip: "How much crests break into separate dunes", onRelease: true },
  { key: "cross", label: "Crossing dunes", min: 0, max: 1, step: 0.01, group: "Shape", tip: "A second dune set at an angle, so crests cross and merge", onRelease: true },
  { key: "variety", label: "Height variety", min: 0, max: 1, step: 0.01, group: "Shape", onRelease: true },
  { key: "swell", label: "Swell (m)", min: 0, max: 20, step: 0.1, group: "Shape", tip: "Slow rise and fall under the dunes", onRelease: true },
  { key: "swellScale", label: "Swell scale (m)", min: 100, max: 1200, step: 10, group: "Shape", onRelease: true },
  { key: "crestSoft", label: "Rounded crests", min: 0, max: 0.2, step: 0.005, group: "Shape", tip: "Rounds the crest and the foot of each slip face (share of the dune spacing), for the soft simple shapes of Keith's reference video", onRelease: true },
  { key: "bumps", label: "Small bumps (m)", min: 0, max: 1, step: 0.01, group: "Shape", tip: "Metre-scale lumps: a good test for foot placement", onRelease: true },
];

export interface GroundSample {
  h: number;
  /** 0 in a trough, 1 on a crest: drives colour. */
  crest: number;
  /** 1 on the flat interdune floor. */
  flat: number;
  /** Biome weights here (desert = 1 - rocky - shallows). */
  wr?: number;
  ws?: number;
  /** 0..1 how much bare rock shows (rocky shelves, outcrops). */
  rock?: number;
}

/**
 * Something that reshapes the dunes in places (the convoy's flattened road, src/convoy/route.ts). It must be a pure
 * function of position given its stored data, so feet, wheels and chunks still agree.
 */
export interface GroundModifier {
  /** Fill out for (x, z); return false (fast) where it has no effect. */
  at(x: number, z: number, out: ModifierSample): boolean;
}
export interface ModifierSample {
  /** 0: the dunes untouched .. 1: the flat floor. */
  w: number;
  /** Height added on top (berms at the road's edges), metres. */
  berm: number;
  /** Floor height above the swell, metres. */
  lift: number;
  /** Share of the small bumps kept on the floor. */
  rough: number;
}

/**
 * A height added on top of everything else (blast craters, src/world/craters.ts): pure given its stored data, and
 * 0 (fast) where it has no effect.
 */
export interface GroundLayer { at(x: number, z: number): number }

export class DuneField {
  /** Optional reshaping (the convoy road). Null: plain dunes. */
  modifier: GroundModifier | null = null;
  /** Optional dents added after the modifier (blast craters). Null: none. */
  dents: GroundLayer | null = null;
  private mod: ModifierSample = { w: 0, berm: 0, lift: 0, rough: 0 };
  private n: Noise2;
  private seed = -1;
  private c = 1;
  private s = 0;

  /** Biomes (Keith 2026-10-25): null when the values carry no biome sliders (all desert). */
  biomes: BiomeMap | null = null;
  rock: RockGround | null = null;
  shallows: ShallowsGround | null = null;
  private bw: BiomeWeights = { desert: 1, rocky: 0, shallows: 0 };
  private rs: RockSample = { h: 0, bare: 0 };
  private ss: ShallowsSample = { h: 0, rock: 0 };

  constructor(public v: WorldValues) {
    this.n = new Noise2(v.seed);
    this.update();
  }

  private surf: GroundSample = { h: 0, crest: 0, flat: 0 };
  /** What the ground is made of here, for dust and marks: bare rock and water throw no dust, rocky sand is gravelly. */
  surfaceAt(x: number, z: number): "sand" | "gravel" | "dirt" | "concrete" {
    if (!this.biomes) return "sand";
    const s = this.sample(x, z, this.surf);
    const w = this.waterLevel;
    if ((s.rock ?? 0) > 0.5) return "concrete";
    if (w !== null && (s.ws ?? 0) > 0.3 && s.h < w + 0.05) return "concrete";
    if ((s.wr ?? 0) > 0.5) return "gravel";
    if ((s.ws ?? 0) > 0.5) return "dirt";
    return "sand";
  }

  /** Water level when there are shallows, else null. */
  get waterLevel(): number | null { return this.shallows ? this.shallows.v.waterLevel : null; }

  /** Call after changing values. */
  update() {
    if (this.v.seed !== this.seed) { this.n = new Noise2(this.v.seed * 7919); this.seed = this.v.seed; }
    const v = this.v;
    if (v.biomeSize !== undefined) {
      if (!this.biomes) {
        this.biomes = new BiomeMap(v as BiomeValues, v.seed);
        this.rock = new RockGround(v as RockValues, v.seed);
        this.shallows = new ShallowsGround(v as ShallowsValues, v.seed);
      }
      this.biomes.v = v as BiomeValues; this.rock!.v = v as RockValues; this.shallows!.v = v as ShallowsValues;
      this.biomes.reseed(v.seed); this.rock!.reseed(v.seed); this.shallows!.reseed(v.seed);
    } else this.biomes = this.rock = this.shallows = null;
    const a = (this.v.windAngle * Math.PI) / 180;
    this.c = Math.cos(a);
    this.s = Math.sin(a);
  }

  /** Unit vector the wind blows toward (slip faces face this way). */
  wind(): [number, number] { return [this.c, this.s]; }

  height(x: number, z: number): number { return this.sample(x, z).h; }

  sample(x: number, z: number, out: GroundSample = { h: 0, crest: 0, flat: 0 }): GroundSample {
    const v = this.v, n = this.n;
    // Biome weights: inside a region exactly one biome, so only its own ground is worked out.
    const bw = this.biomes ? this.biomes.weights(x, z, this.bw) : null;
    const wr = bw ? bw.rocky : 0, ws = bw ? bw.shallows : 0;
    const land = 1 - ws;
    // Rocky's share of the land (desert and rocky meet first; then the land meets the water).
    const wrL = land > 1e-6 ? wr / land : 0;
    let dune = 0, flat = 1;
    if (wrL < 1 && land > 0) {
      const d = this.dunes(x, z);
      dune = d.h; flat = d.flat;
    }
    const swell = v.swell * n.fbm(x / v.swellScale + 101, z / v.swellScale - 57, 3);
    const bumps = v.bumps * n.fbm(x / 7 + 13, z / 7 + 3, 2);
    out.wr = wr; out.ws = ws; out.rock = 0;

    if (!bw || (wr === 0 && ws === 0)) {
      out.h = swell + dune + bumps;
      out.crest = v.height > 0 ? Math.max(0, dune) / Math.max(0.01, v.height) : 0;
      out.flat = flat;
    } else {
      let h = swell + dune + bumps;
      let rockShow = 0;
      if (wrL > 0 && land > 0) {
        // Desert into rocky: the rock rises through the sand. The dunes flatten toward the rocky land's sand floor
        // as the rock comes up, and the rock is sunk by however far it is from being fully rocky, so at the border
        // only its highest shelves break through and the sand banks against them.
        const rk = this.rock!, r = rk.sample(x, z, this.rs);
        const t = smoothstep(0, 1, wrL);
        const sandFloor = swell * 0.6 + rk.sandLevel() * t + bumps * 0.5;
        const sand = lerp(h, sandFloor, t);
        const sink = (1 - t) * (rk.v.rockHeight + 8);
        const rockH = swell * 0.6 + r.h - sink;
        h = smoothMax(sand, rockH, 1.2);
        rockShow = r.bare * smoothstep(sand - 0.2, sand + 0.8, rockH);
        dune *= 1 - t;
      }
      if (ws > 0) {
        // The land sinks into the shallows: the last dunes become sandbars, rock steps down into the water.
        const sh = this.shallows!.sample(x, z, this.ss);
        const t = smoothstep(0, 1, ws);
        const sunk = lerp(h, Math.min(h, sh.h + (h - sh.h) * 0.25), t);
        h = lerp(sunk, sh.h, t);
        rockShow = lerp(rockShow, sh.rock, t);
        dune *= 1 - t;
      }
      out.h = h;
      out.crest = v.height > 0 ? Math.max(0, dune) / Math.max(0.01, v.height) : 0;
      out.flat = lerp(flat, 1, Math.max(wrL, ws));
      out.rock = rockShow;
    }
    const m = this.mod;
    if (this.modifier && this.modifier.at(x, z, m)) {
      // Blend toward a smooth floor that rides the swell, plus berms at the edges.
      const floor = swell + m.lift + bumps * m.rough;
      out.h = lerp(out.h, floor, m.w) + m.berm;
      out.crest *= 1 - m.w;
      out.flat = Math.max(out.flat, m.w);
    }
    if (this.dents) out.h += this.dents.at(x, z);
    return out;
  }

  /** The dunes alone (both sets), without swell or bumps. */
  private dunes(x: number, z: number) {
    const v = this.v;
    const main = this.duneSet(x, z, this.c, this.s, v.spacing, 0);
    let dune = main.h, flat = main.flat;
    if (v.cross > 0) {
      // A second, weaker set at an angle: crests cross and merge instead of running in parallel bands.
      const a = ((v.windAngle + 62) * Math.PI) / 180;
      const second = this.duneSet(x, z, Math.cos(a), Math.sin(a), v.spacing * 1.65, 1);
      dune = smoothMax(dune, second.h * v.cross, v.height * 0.25) ;
      flat = Math.min(flat, 1 - smoothstep(0, 0.2, second.h * v.cross / Math.max(0.1, v.height)));
    }
    return { h: dune, flat };
  }

  /** One set of transverse dunes running across direction (c, s). */
  private duneSet(x: number, z: number, c: number, s: number, L: number, salt: number) {
    const v = this.v, n = this.n, o = salt * 53.1;
    let u = x * c + z * s;
    const w = -x * s + z * c;
    // Crests meander along their length, and the spacing varies locally so crests merge and split.
    u += v.meander * L * n.fbm(w / (L * 2.6) + o, u / (L * 7), 2);
    u += v.warp * L * n.fbm(x / (L * 1.9) + 31.7 + o, z / (L * 1.9) - 7.3, 3);

    const su = u / L, k = Math.floor(su), f = su - k;
    // The profile, softened by averaging it across crestSoft of the spacing: rounds the crest and the slip face's foot.
    const d = v.crestSoft;
    const P = d > 0 ? (this.profile(f - d) + 2 * this.profile(f) + this.profile(f + d)) / 4 : this.profile(f);
    const prof = P, flat = this.flatAt(f);
    const amp = v.height * (1 - v.variety * 0.6 + v.variety * 0.6 * n.fbm(x / (L * 2.3) + o, z / (L * 2.3), 2));
    // Breakup: each crest (index k) rises and falls along its length, so dunes come in separate pieces.
    const mask = smoothstep(-0.15, 0.35, n.fbm(w / (L * 0.95) + o, k * 1.73 + 0.5, 2));
    return { h: amp * prof * lerp(1 - v.breakup, 1, mask), flat };
  }

  /** Height of one dune across its period (f in 0..1, wraps): flat floor, windward rise, steep slip face. */
  private profile(f: number) {
    const v = this.v;
    f = f - Math.floor(f);
    const ws = 1 - v.slip;
    if (f < ws) {
      const start = v.flats * ws;
      const t = (f - start) / (ws - start);
      return t <= 0 ? 0 : smoothstep(0, 1, t);
    }
    return 1 - smoothstep(0, 1, (f - ws) / v.slip);
  }

  private flatAt(f: number) {
    const v = this.v, ws = 1 - v.slip;
    if (f >= ws) return 0;
    const start = v.flats * ws, t = (f - start) / (ws - start);
    return t <= 0 ? 1 : 1 - smoothstep(0, 0.15, t);
  }

  /** Surface normal by central differences; written into out = [x, y, z]. */
  normal(x: number, z: number, out: number[] = [0, 1, 0], e = 0.35): number[] {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }
}

/** Smooth maximum: like Math.max but rounded over width k, so merging dunes have no crease. */
function smoothMax(a: number, b: number, k: number) {
  if (k <= 0) return Math.max(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (a - b) / (2 * k)));
  return lerp(b, a, h) + k * h * (1 - h);
}
