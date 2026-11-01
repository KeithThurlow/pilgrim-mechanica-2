// Red-hot sand (Keith 2026-11-01, a friend's idea): beams leave glowing trails in the sand that cool over seconds, and
// the hotter the weapon, the hotter the sand (and the longer it glows). Explosions are barely warm. Cosmetic: nothing
// reads it but the ground's look, so it isn't seeded or networked; each peer paints its own from the same events.
//
// A grid of temperatures (°C above the air, roughly) around the camera focus, toroidal like the dents (a cell's texel is
// its world cell index mod the size), so following the focus copies nothing; cells that fall out of the window are
// cleared. Only hot cells are touched each frame (an active list), so an idle layer costs nothing. Pure: no Three.js
// here (the texture and glow live in src/fx/groundHeatTex.ts), so tools/heat-check.ts runs it headless.
//
// Cooling is Newton's law, T × exp(-dt / heatCool), so 2000° glows about three times as long as 900°. Sand hotter than
// heatCharFrom fuses dark (glassy) and that char fades much more slowly (heatCharLife).
import type { Param } from "../core/tweaks";

export const HEAT_DEFAULTS = {
  heatOn: 1,
  heatArea: 104,
  heatRes: 256,
  heatCool: 6,
  heatRise: 0.05,
  heatSpread: 1,
  heatGlowFrom: 480,
  heatGlow: 2.2,
  heatFlicker: 0.35,
  heatChar: 0.6,
  heatCharFrom: 950,
  heatCharLife: 40,
  heatBeam: 1700,
  heatStrider: 2100,
  heatRail: 1150,
  heatIgnited: 780,
  heatBlast: 560,
  heatLight: 900,
  heatLights: 6,
  heatLightBin: 6,
  heatLightPrio: 0.7,
};
export type HeatValues = typeof HEAT_DEFAULTS;

const G = "Hot sand", GW = "Hot sand: by weapon", GL = "Hot sand: night light";
/** The slider groups (the Light topic lists them, via src/world/look.ts LIGHT_GROUPS). */
export const HEAT_GROUPS = [G, GW, GL];
export const HEAT_PARAMS: Param[] = [
  { key: "heatOn", label: "Hot sand on", min: 0, max: 1, step: 1, group: G },
  { key: "heatArea", label: "Area (m)", min: 32, max: 200, step: 4, group: G, onRelease: true, tip: "Width of the square round the camera focus that keeps heat (only the fine ground patch shows it)" },
  { key: "heatRes", label: "Cells across", min: 64, max: 512, step: 32, group: G, onRelease: true, tip: "Area / cells = detail (256 over 104 m: 41 cm)" },
  { key: "heatCool", label: "Cools (time constant, s)", min: 0.5, max: 30, step: 0.1, group: G, tip: "Temperature falls by 63% in this time: 2000° glows about three times as long as 900°" },
  { key: "heatRise", label: "Heats up (s)", min: 0.01, max: 2, step: 0.01, group: G, tip: "A beam held on a spot: how fast the sand comes up to the beam's heat (beams fired as one shot heat at once)" },
  { key: "heatSpread", label: "Trail width ×", min: 0.2, max: 3, step: 0.05, group: G, tip: "× the beam's width" },
  { key: "heatGlowFrom", label: "Glows from (°)", min: 200, max: 1000, step: 10, group: G, tip: "Below this sand doesn't glow (real sand: a dull red from about 500°)" },
  { key: "heatGlow", label: "Glow brightness", min: 0, max: 8, step: 0.05, group: G },
  { key: "heatFlicker", label: "Flicker", min: 0, max: 1, step: 0.01, group: G, tip: "The glow crawls and breathes like embers" },
  { key: "heatChar", label: "Fused sand darkens", min: 0, max: 1, step: 0.01, group: G, tip: "How dark sand that got hotter than 'fuses from' goes (glassy, burnt)" },
  { key: "heatCharFrom", label: "Fuses from (°)", min: 300, max: 2500, step: 10, group: G },
  { key: "heatCharLife", label: "Fused sand fades (s)", min: 1, max: 300, step: 1, group: G },
  { key: "heatBeam", label: "Excavator beam (°)", min: 0, max: 3000, step: 10, group: GW, tip: "The hotter the weapon, the hotter the sand and the longer it glows" },
  { key: "heatStrider", label: "Strider beam (°)", min: 0, max: 3000, step: 10, group: GW },
  { key: "heatRail", label: "Rail slug strike (°)", min: 0, max: 3000, step: 10, group: GW, tip: "Where a rail slug stops in the sand (× its charge)" },
  { key: "heatIgnited", label: "Ignited rounds (°)", min: 0, max: 3000, step: 10, group: GW, tip: "Incendiary feed rounds into the sand" },
  { key: "heatBlast", label: "Explosions (°)", min: 0, max: 3000, step: 10, group: GW, tip: "The middle of a blast on the ground: explosions aren't that hot (Keith 2026-11-01), a brief dull ember at most" },
  { key: "heatLight", label: "Light (per m² glowing)", min: 0, max: 2000, step: 10, group: GL, tip: "Glowing sand lights the ground round it at night (Keith 2026-11-01): the glow is gathered into patches, each asks the night lights for a real light this bright per square metre of glow (0: no light)" },
  { key: "heatLights", label: "Lights at most", min: 0, max: 16, step: 1, group: GL, tip: "The brightest patches that ask for a light each frame (the night lights' pool decides which get a real one)" },
  { key: "heatLightBin", label: "Patch size (m)", min: 2, max: 20, step: 0.5, group: GL, tip: "Glow within a patch this wide shares one light: smaller is finer but asks for more" },
  { key: "heatLightPrio", label: "Priority", min: 0.1, max: 2, step: 0.05, group: GL, tip: "Against blasts (1) and beams for the real lights" },
];

/** Glow channel: temperature up to this maps to 0..255. */
export const HEAT_MAX = 3000;
/** Below this a cell is cold (and its char gone): it drops off the active list. */
const COLD = 15;
/** Lines are painted in pieces this long or shorter, so a long diagonal beam touches only cells near it. */
const PIECE = 4;
/** Cold, charred cells fade this often (s), and are dropped below this char. */
const CHAR_STEP = 0.25, CHAR_GONE = 0.01;

export class GroundHeat {
  /** Temperature (°) and char (0..1) per cell. */
  readonly temp: Float32Array;
  readonly char: Float32Array;
  /** The world cell each texel holds now (so an aliased far cell isn't mistaken for it). */
  private ownX: Int32Array;
  private ownZ: Int32Array;
  private live: Uint8Array;
  /** Indices of cells that are warm or charred. */
  readonly active: number[] = [];
  /** The texture's bytes (R glow 0..255 over HEAT_MAX, G char 0..255, B 0, A 255), toroidal. */
  readonly bytes: Uint8Array;
  /** Bumped when bytes changed (the texture uploads then). */
  version = 0;
  readonly res: number;
  readonly area: number;
  readonly cell: number;
  /** The window's centre (last update's focus). */
  cx = 0; cz = 0;
  /** What the last update and painting cost: cells touched by paint since the last update, cells kept (warm or charred), cells warm, the update's ms. */
  readonly stats = { painted: 0, active: 0, hot: 0, ms: 0 };
  private dirty = false;
  private charAcc = 0;
  private bins = new Map<number, number>();
  private binData = new Float32Array(6 * 256);

  constructor(public v: HeatValues) {
    this.res = Math.max(16, Math.round(v.heatRes));
    this.area = Math.max(8, v.heatArea);
    this.cell = this.area / this.res;
    const n = this.res * this.res;
    this.temp = new Float32Array(n); this.char = new Float32Array(n);
    this.ownX = new Int32Array(n); this.ownZ = new Int32Array(n); this.live = new Uint8Array(n);
    this.bytes = new Uint8Array(n * 4);
    for (let i = 3; i < this.bytes.length; i += 4) this.bytes[i] = 255;
  }

  /** Does this layer still match the sliders (area, cells)? */
  fits(v: HeatValues) { return Math.max(16, Math.round(v.heatRes)) === this.res && Math.max(8, v.heatArea) === this.area; }

  private inWindow(ix: number, iz: number) {
    const h = this.area / 2 - this.cell;
    return Math.abs((ix + 0.5) * this.cell - this.cx) < h && Math.abs((iz + 0.5) * this.cell - this.cz) < h;
  }

  /** Temperature at a world point (the cell it falls in; 0 if the texel holds another cell). */
  at(x: number, z: number): number {
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell), i = this.index(ix, iz);
    return this.live[i] && this.ownX[i] === ix && this.ownZ[i] === iz ? this.temp[i] : 0;
  }
  charAt(x: number, z: number): number {
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell), i = this.index(ix, iz);
    return this.live[i] && this.ownX[i] === ix && this.ownZ[i] === iz ? this.char[i] : 0;
  }

  private index(ix: number, iz: number) {
    const n = this.res;
    return (((iz % n) + n) % n) * n + (((ix % n) + n) % n);
  }

  /** Heat one cell toward `target`: at once (rise 1) or by the share `rise` of the way (a beam held for a tick). */
  private heatCell(ix: number, iz: number, target: number, rise: number) {
    if (target < COLD || !this.inWindow(ix, iz)) return;
    const i = this.index(ix, iz);
    if (!this.live[i] || this.ownX[i] !== ix || this.ownZ[i] !== iz) {
      this.temp[i] = 0; this.char[i] = 0; this.ownX[i] = ix; this.ownZ[i] = iz;
      if (!this.live[i]) { this.live[i] = 1; this.active.push(i); }
    }
    const T = this.temp[i];
    if (target <= T) return;
    const t = T + (target - T) * rise;
    this.temp[i] = t;
    const cf = this.v.heatCharFrom;
    if (t > cf) this.char[i] = Math.max(this.char[i], Math.min(1, (t - cf) / Math.max(100, cf * 0.6)));
    this.stats.painted++;
    this.dirty = true;
  }

  /** The share of the way to its heat a cell gets in dt (0: at once). */
  private rise(dt: number) { return dt > 0 ? 1 - Math.exp(-dt / Math.max(0.005, this.v.heatRise)) : 1; }

  /** A round hot spot of radius r (m), `temp` at its middle falling to nothing at its edge. dt > 0: held there for dt. */
  spot(x: number, z: number, r: number, temp: number, dt = 0) {
    if (!this.v.heatOn || temp <= 0 || r <= 0) return;
    const c = this.cell, R = Math.max(r, c * 0.75), rise = this.rise(dt);
    const i0 = Math.floor((x - R) / c), i1 = Math.floor((x + R) / c), j0 = Math.floor((z - R) / c), j1 = Math.floor((z + R) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot((i + 0.5) * c - x, (j + 0.5) * c - z) / R;
      if (d < 1) this.heatCell(i, j, temp * falloff(d), rise);
    }
  }

  /**
   * A hot line from (x0, z0) to (x1, z1), `half` m either side of it (× the Trail width slider), `temp` along its
   * middle falling off to its edges. dt > 0: a beam held on it for dt (a sweeping beam paints every tick).
   */
  line(x0: number, z0: number, x1: number, z1: number, half: number, temp: number, dt = 0) {
    if (!this.v.heatOn || temp <= 0) return;
    const c = this.cell, H = Math.max(half * this.v.heatSpread, c * 0.75), rise = this.rise(dt);
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-3) { this.spot(x0, z0, H, temp, dt); return; }
    const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    const n = Math.max(1, Math.ceil(len / PIECE));
    for (let k = 0; k < n; k++) {
      const a = (len * k) / n, b = (len * (k + 1)) / n;
      const ax = x0 + dx * a, az = z0 + dz * a, bx = x0 + dx * b, bz = z0 + dz * b;
      const i0 = Math.floor((Math.min(ax, bx) - H) / c), i1 = Math.floor((Math.max(ax, bx) + H) / c);
      const j0 = Math.floor((Math.min(az, bz) - H) / c), j1 = Math.floor((Math.max(az, bz) + H) / c);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * c - x0, pz = (j + 0.5) * c - z0;
        const along = Math.min(b, Math.max(a, px * dx + pz * dz));
        const d = Math.hypot(px - dx * along, pz - dz * along) / H;
        if (d < 1) this.heatCell(i, j, temp * falloff(d), rise);
      }
    }
  }

  /**
   * The glowing sand gathered into patches heatLightBin wide (for lighting the ground at night), the brightest
   * heatLights of them into out as x, z, power (m² of full glow), mean glow 0..1 (for the colour), size (m). Returns
   * how many. Only warm cells are read.
   */
  lights(out: Float32Array): number {
    const v = this.v, max = Math.min(Math.floor(out.length / 5), Math.round(v.heatLights));
    if (max <= 0 || !this.stats.hot || !v.heatOn) return 0;
    const bin = Math.max(1, v.heatLightBin), from = v.heatGlowFrom, a2 = this.cell * this.cell, m = this.bins;
    m.clear();
    let n = 0;
    const b = this.binData;
    for (const i of this.active) {
      const T = this.temp[i];
      if (T <= from) continue;
      const u = Math.min(1, (T - from) / 1400), p = u * Math.sqrt(Math.sqrt(u)) * a2;
      const x = (this.ownX[i] + 0.5) * this.cell, z = (this.ownZ[i] + 0.5) * this.cell;
      const key = Math.floor(x / bin) * 73856093 ^ Math.floor(z / bin) * 19349663;
      let k = m.get(key);
      if (k === undefined) {
        if (n * 6 >= b.length) continue;
        k = n++ * 6; m.set(key, k);
        b[k] = b[k + 1] = b[k + 2] = b[k + 3] = b[k + 4] = 0;
      }
      b[k] += x * p; b[k + 1] += z * p; b[k + 2] += p; b[k + 3] += u * p; b[k + 4] += a2;
    }
    // The brightest few (n is small: a handful of patches per beam).
    let w = 0;
    for (let r = 0; r < max; r++) {
      let best = -1, bp = 0;
      for (let k = 0; k < n * 6; k += 6) if (b[k + 2] > bp) { bp = b[k + 2]; best = k; }
      if (best < 0) break;
      const o = w++ * 5, p = b[best + 2];
      out[o] = b[best] / p; out[o + 1] = b[best + 1] / p; out[o + 2] = p; out[o + 3] = b[best + 3] / p; out[o + 4] = Math.sqrt(b[best + 4]);
      b[best + 2] = 0;
    }
    return w;
  }

  /**
   * Cool every warm cell, follow the focus (clearing what left the window), refresh the bytes. Cells that are cold but
   * still charred only fade a few times a second (CHAR_STEP), so the long char fade doesn't upload every frame.
   */
  update(dt: number, fx: number, fz: number) {
    const t0 = performance.now();
    this.cx = fx; this.cz = fz;
    this.charAcc += dt;
    const slow = this.charAcc >= CHAR_STEP, dts = this.charAcc;
    if (slow) this.charAcc = 0;
    const k = Math.exp(-dt / Math.max(0.05, this.v.heatCool));
    const kc = Math.exp(-dt / Math.max(0.5, this.v.heatCharLife)), kcs = Math.exp(-dts / Math.max(0.5, this.v.heatCharLife));
    const a = this.active, b = this.bytes, scale = 255 / HEAT_MAX, on = !!this.v.heatOn;
    let w = 0, hot = 0;
    for (let r = 0; r < a.length; r++) {
      const i = a[r];
      let T = this.temp[i], ch = this.char[i];
      const out = !on || !this.inWindow(this.ownX[i], this.ownZ[i]);
      if (T > 0 || slow || out) {
        if (T > 0) { T *= k; ch *= kc; if (T < COLD) T = 0; } else ch *= kcs;
        if (out || (T === 0 && ch < CHAR_GONE)) { T = 0; ch = 0; }
        this.temp[i] = T; this.char[i] = ch;
        b[i * 4] = Math.min(255, Math.round(T * scale)); b[i * 4 + 1] = Math.min(255, Math.round(ch * 255));
        this.dirty = true;
      }
      if (T > 0) hot++;
      if (T === 0 && ch === 0) this.live[i] = 0;
      else a[w++] = i;
    }
    a.length = w;
    if (this.dirty) { this.version++; this.dirty = false; }
    this.stats.active = w; this.stats.hot = hot;
    this.stats.ms = performance.now() - t0;
    this.stats.painted = 0;
  }
}

/** The heat across a spot or a line: flat-topped, easing to nothing at the edge. */
function falloff(d: number) {
  const s = 1 - d * d;
  return s * s * (1.4 - 0.4 * s);
}
