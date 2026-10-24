// The dune field: ground height as a pure function of (x, z). Chunks, feet, vehicles and AI all read the same
// function, so nothing ever disagrees about where the ground is, and any chunk can be built in any order.
//
// Shape: transverse dunes at right angles to the wind, a long gentle windward slope and a short steep slip face
// (about 30 degrees, like real sand), crest lines that meander and break into separate dunes, flat interdune
// floors, a slow swell under it all and small bumps on top.
import type { Param } from "../core/tweaks";
import { Noise2, smoothstep, lerp } from "./noise";

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
  { key: "bumps", label: "Small bumps (m)", min: 0, max: 1, step: 0.01, group: "Shape", tip: "Metre-scale lumps: a good test for foot placement", onRelease: true },
];

export interface GroundSample {
  h: number;
  /** 0 in a trough, 1 on a crest: drives colour. */
  crest: number;
  /** 1 on the flat interdune floor. */
  flat: number;
}

export class DuneField {
  private n: Noise2;
  private seed = -1;
  private c = 1;
  private s = 0;

  constructor(public v: TerrainValues) {
    this.n = new Noise2(v.seed);
    this.update();
  }

  /** Call after changing values. */
  update() {
    if (this.v.seed !== this.seed) { this.n = new Noise2(this.v.seed * 7919); this.seed = this.v.seed; }
    const a = (this.v.windAngle * Math.PI) / 180;
    this.c = Math.cos(a);
    this.s = Math.sin(a);
  }

  /** Unit vector the wind blows toward (slip faces face this way). */
  wind(): [number, number] { return [this.c, this.s]; }

  height(x: number, z: number): number { return this.sample(x, z).h; }

  sample(x: number, z: number, out: GroundSample = { h: 0, crest: 0, flat: 0 }): GroundSample {
    const v = this.v, n = this.n;
    const main = this.duneSet(x, z, this.c, this.s, v.spacing, 0);
    let dune = main.h, flat = main.flat;
    if (v.cross > 0) {
      // A second, weaker set at an angle: crests cross and merge instead of running in parallel bands.
      const a = ((v.windAngle + 62) * Math.PI) / 180;
      const second = this.duneSet(x, z, Math.cos(a), Math.sin(a), v.spacing * 1.65, 1);
      dune = smoothMax(dune, second.h * v.cross, v.height * 0.25) ;
      flat = Math.min(flat, 1 - smoothstep(0, 0.2, second.h * v.cross / Math.max(0.1, v.height)));
    }
    const swell = v.swell * n.fbm(x / v.swellScale + 101, z / v.swellScale - 57, 3);
    const bumps = v.bumps * n.fbm(x / 7 + 13, z / 7 + 3, 2);

    out.h = swell + dune + bumps;
    out.crest = v.height > 0 ? Math.max(0, dune) / Math.max(0.01, v.height) : 0;
    out.flat = flat;
    return out;
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
    const ws = 1 - v.slip;
    let prof: number, flat = 0;
    if (f < ws) {
      const start = v.flats * ws;
      const t = (f - start) / (ws - start);
      prof = t <= 0 ? 0 : smoothstep(0, 1, t);
      flat = t <= 0 ? 1 : 1 - smoothstep(0, 0.15, t);
    } else {
      prof = 1 - smoothstep(0, 1, (f - ws) / v.slip);
    }

    const amp = v.height * (1 - v.variety * 0.6 + v.variety * 0.6 * n.fbm(x / (L * 2.3) + o, z / (L * 2.3), 2));
    // Breakup: each crest (index k) rises and falls along its length, so dunes come in separate pieces.
    const mask = smoothstep(-0.15, 0.35, n.fbm(w / (L * 0.95) + o, k * 1.73 + 0.5, 2));
    return { h: amp * prof * lerp(1 - v.breakup, 1, mask), flat };
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
