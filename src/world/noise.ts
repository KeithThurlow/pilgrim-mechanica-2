// Seeded 2D gradient noise and fBm. Pure functions of (x, z, seed): the same point always gives the same value,
// which is what lets terrain stream in any order and lets feet query exact ground heights.

export class Noise2 {
  private perm = new Uint8Array(512);
  private gx = new Float32Array(256);
  private gz = new Float32Array(256);

  constructor(seed: number) {
    let s = (seed >>> 0) || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; this.gx[i] = Math.cos(a); this.gz[i] = Math.sin(a); }
  }

  /** Gradient noise, roughly -1..1. */
  get(x: number, z: number): number {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const X = xi & 255, Z = zi & 255, P = this.perm, gx = this.gx, gz = this.gz;
    const a = P[P[X] + Z], b = P[P[X + 1] + Z], c = P[P[X] + Z + 1], d = P[P[X + 1] + Z + 1];
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const n00 = gx[a] * xf + gz[a] * zf;
    const n10 = gx[b] * (xf - 1) + gz[b] * zf;
    const n01 = gx[c] * xf + gz[c] * (zf - 1);
    const n11 = gx[d] * (xf - 1) + gz[d] * (zf - 1);
    const x0 = n00 + u * (n10 - n00), x1 = n01 + u * (n11 - n01);
    return (x0 + v * (x1 - x0)) * 1.4;
  }

  /** Fractal sum of octaves, roughly -1..1. */
  fbm(x: number, z: number, octaves = 4, lacunarity = 2.03, gain = 0.5): number {
    let sum = 0, amp = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.get(x, z) * amp;
      norm += amp;
      amp *= gain;
      x = x * lacunarity + 17.3;
      z = z * lacunarity - 9.1;
    }
    return sum / norm;
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
