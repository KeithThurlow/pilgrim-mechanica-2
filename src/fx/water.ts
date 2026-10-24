// Water effects for the shallows (Keith 2026-10-25: ripples that wave out from units as they travel through the
// water). Pure sim: ripple rings that spread and fade on the water surface, and splash droplets thrown up by
// footfalls, wheels and rounds. Drawn by waterDraw.ts. Sources call ripple / wake / splash; whether a point is in the
// water is the ground's business (Battlefield.inWater).
import type { Param } from "../core/tweaks";

export const WATER_FX_DEFAULTS = {
  rippleSpeed: 2.2,
  rippleLife: 2.2,
  rippleSize: 1,
  rippleWidth: 0.18,
  rippleStrength: 0.8,
  wakeEvery: 1.2,
  splashDrops: 14,
  splashSpeed: 4.5,
  splashSize: 1,
};
export type WaterFxValues = typeof WATER_FX_DEFAULTS;

const G = "Water effects";
export const WATER_FX_PARAMS: Param[] = [
  { key: "rippleSpeed", label: "Ripples spread (m/s)", min: 0.3, max: 8, step: 0.05, group: G },
  { key: "rippleLife", label: "Ripples last (s)", min: 0.3, max: 6, step: 0.05, group: G },
  { key: "rippleSize", label: "Ripple size ×", min: 0.2, max: 3, step: 0.05, group: G },
  { key: "rippleWidth", label: "Ring width (m)", min: 0.03, max: 0.8, step: 0.01, group: G },
  { key: "rippleStrength", label: "Ring brightness", min: 0, max: 1, step: 0.01, group: G },
  { key: "wakeEvery", label: "Wake ring every (m)", min: 0.3, max: 5, step: 0.05, group: G, tip: "Moving vehicles and wading units drop a ring this often; the rings overlap into a V behind them" },
  { key: "splashDrops", label: "Splash drops", min: 0, max: 60, step: 1, group: G },
  { key: "splashSpeed", label: "Splash speed (m/s)", min: 0.5, max: 15, step: 0.1, group: G },
  { key: "splashSize", label: "Splash drop size ×", min: 0.2, max: 3, step: 0.05, group: G },
];

export const RIPPLE_MAX = 600;
export const DROP_MAX = 1500;

export class WaterFx {
  /** Ripples: centre, age, life, strength (0..1), and how far they spread. */
  readonly rx = new Float32Array(RIPPLE_MAX); readonly rz = new Float32Array(RIPPLE_MAX);
  readonly rAge = new Float32Array(RIPPLE_MAX).fill(1e9); readonly rLife = new Float32Array(RIPPLE_MAX).fill(1);
  readonly rStr = new Float32Array(RIPPLE_MAX); readonly rReach = new Float32Array(RIPPLE_MAX);
  /** Drops: ballistic, gone when they fall back to the water. */
  readonly dx = new Float32Array(DROP_MAX); readonly dy = new Float32Array(DROP_MAX); readonly dz = new Float32Array(DROP_MAX);
  readonly vx = new Float32Array(DROP_MAX); readonly vy = new Float32Array(DROP_MAX); readonly vz = new Float32Array(DROP_MAX);
  readonly dAge = new Float32Array(DROP_MAX).fill(1e9); readonly dLife = new Float32Array(DROP_MAX).fill(1);
  readonly dSize = new Float32Array(DROP_MAX);
  private nr = 0;
  private nd = 0;
  ripplesAlive = 0;
  dropsAlive = 0;

  constructor(public v: WaterFxValues, public level: number) {}

  /** A ring spreading from (x, z); strength about 1 for a mech footfall. */
  ripple(x: number, z: number, strength = 1, reach = 1) {
    const i = this.nr; this.nr = (this.nr + 1) % RIPPLE_MAX;
    this.rx[i] = x; this.rz[i] = z; this.rAge[i] = 0;
    this.rLife[i] = this.v.rippleLife * (0.7 + 0.3 * Math.min(2, strength));
    this.rStr[i] = Math.min(1, strength); this.rReach[i] = reach;
  }

  /**
   * Something moving through the water: drops a ring every wakeEvery metres travelled (pass the distance moved this
   * frame and an accumulator you keep; returns the new accumulator). The overlapping rings make a V behind it.
   */
  wake(x: number, z: number, moved: number, acc: number, strength = 0.6, reach = 1): number {
    acc += moved;
    const every = Math.max(0.1, this.v.wakeEvery);
    while (acc >= every) { acc -= every; this.ripple(x, z, strength, reach); }
    return acc;
  }

  /** Water thrown up at (x, z): drops in a crown (and along dirX, dirZ if given), plus rings. */
  splash(x: number, z: number, strength = 1, dirX = 0, dirZ = 0, up = 1) {
    const v = this.v, n = Math.round(v.splashDrops * Math.min(3, strength));
    for (let k = 0; k < n; k++) {
      const i = this.nd; this.nd = (this.nd + 1) % DROP_MAX;
      const a = Math.random() * Math.PI * 2, out = (0.3 + Math.random() * 0.7) * v.splashSpeed * Math.sqrt(strength);
      this.dx[i] = x + Math.cos(a) * 0.3; this.dz[i] = z + Math.sin(a) * 0.3; this.dy[i] = this.level + 0.05;
      this.vx[i] = Math.cos(a) * out * 0.45 + dirX * out * 0.6;
      this.vz[i] = Math.sin(a) * out * 0.45 + dirZ * out * 0.6;
      this.vy[i] = (1.2 + Math.random() * 1.6) * v.splashSpeed * up * Math.sqrt(strength) * 0.6;
      this.dAge[i] = 0; this.dLife[i] = 2;
      this.dSize[i] = (0.06 + Math.random() * 0.1) * v.splashSize * (0.7 + 0.3 * strength);
    }
    this.ripple(x, z, strength);
    if (strength > 0.6) this.ripple(x, z, strength * 0.6, 0.6);
  }

  update(dt: number) {
    let r = 0, d = 0;
    for (let i = 0; i < RIPPLE_MAX; i++) {
      if (this.rAge[i] >= this.rLife[i]) continue;
      this.rAge[i] += dt; r++;
    }
    for (let i = 0; i < DROP_MAX; i++) {
      if (this.dAge[i] >= this.dLife[i]) continue;
      this.dAge[i] += dt;
      this.vy[i] -= 9.8 * dt;
      this.dx[i] += this.vx[i] * dt; this.dy[i] += this.vy[i] * dt; this.dz[i] += this.vz[i] * dt;
      // Back in the water: gone, with a tiny ring now and then.
      if (this.dy[i] < this.level && this.vy[i] < 0) {
        this.dAge[i] = this.dLife[i];
        if (Math.random() < 0.15) this.ripple(this.dx[i], this.dz[i], 0.15, 0.3);
        continue;
      }
      d++;
    }
    this.ripplesAlive = r; this.dropsAlive = d;
  }

  /** A ripple's radius now (m). */
  radius(i: number) { return (0.3 + this.v.rippleSpeed * this.rAge[i] * this.rReach[i]) * this.v.rippleSize * (0.6 + 0.4 * this.rStr[i]); }
}
