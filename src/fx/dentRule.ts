// The dent layer's rules, as plain maths (after the Snowflow demo's deformation buffer, docs/research-snowflow.md).
// The GPU pass (src/fx/dents.ts) and the CPU reference here (DentGrid, used by tools/dents-check.ts) follow the same
// rules; change one, change the other.
//
// A dent texel holds four numbers:
//   dep   depression, metres pushed down (>= 0)
//   berm  displaced mass, metres piled up (>= 0): the rim either side of a print or a rut
//   comp  compression 0..1 (packed ground reads darker)
//   surf  the surface id that last marked it (sand, dirt, gravel, snow, set), which picks the relax rates
// The ground drawn is the true height plus (berm - dep).
//
// Each frame, per texel: scroll (texels that just came into the window are zeroed), relax (diffusion, berms slump
// back into the hollows, slow decay; per surface; the time is banked and spent in steps, because a slow decay is
// below a half float's precision per frame), splat the frame's brushes, clamp.

export const SURFACE_IDS = { sand: 0, dirt: 1, gravel: 2, snow: 3, set: 4 } as const;
export type DentSurface = keyof typeof SURFACE_IDS;
export const SURFACE_COUNT = 5;

/** Relax rates of one surface, already in the units the pass uses. */
export interface RelaxRates {
  /** Diffusion of the depression and of the berms, in texels² per second (berms are loose: faster). */
  difDep: number;
  difBerm: number;
  /** Share of min(berm, dep) slumping back each second. */
  slump: number;
  /** Decay per second (1 / time constant) of the depression; berms and compression decay a little faster. */
  decay: number;
}

/** Per-surface feel values, as the sliders hold them. */
export interface SurfaceFeel {
  /** Depth multiplier (sand 1). */
  depth: number;
  /** Share of the pushed-down mass that piles up in the berm (1 conserves it; packed snow and dirt less). */
  berm: number;
  /** How far an edge softens in a minute (cm), from diffusion: sqrt(2 D t). */
  soften: number;
  /** Share of the berm that slumps back into the hollow per minute. */
  slump: number;
  /** Time constant of the slow healing (s); 0 never heals. */
  life: number;
}

/** Feel values to pass rates, for a texel size in metres. */
export function relaxRates(f: SurfaceFeel, texel: number): RelaxRates {
  const L = Math.max(0, f.soften) / 100;
  const D = (L * L) / (2 * 60); // m²/s
  const difBerm = D / (texel * texel);
  return { difDep: difBerm / 3, difBerm, slump: Math.max(0, f.slump) / 60, decay: f.life > 0 ? 1 / f.life : 0 };
}

/** The relax rates of the "set" surface (POI ruts laid down once): they stay as they are. */
export const SET_RATES: RelaxRates = { difDep: 0, difBerm: 0, slump: 0, decay: 0 };

/** Berms and compression heal this much faster than the depression. */
export const BERM_DECAY = 1.4, COMP_DECAY = 1.2;
/** Explicit diffusion is stable below 0.25 per step; keep clear of it. */
export const MAX_DIF = 0.22;

// ---------------------------------------------------------------------------------------------------- brush shape
// A brush is a capsule: radius r across, a straight middle of half-length r * (elong - 1) along its yaw, round ends.
// In the brush's own units (distance from the middle segment / r): the depression has a flat-ish floor and a fast
// shoulder (a foot compresses a floor, it doesn't dimple); the berm is a ring just outside the rim.

export const CORE_IN = 0.42, CORE_OUT = 1.0, RING_AT = 1.04, RING_K = 3.4, REACH = 1.6;

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export const coreAt = (d: number) => 1 - smoothstep(CORE_IN, CORE_OUT, d);
export const ringAt = (d: number) => { const q = (d - RING_AT) * RING_K; return Math.exp(-q * q); };

/** Distance (in radii) of a point at offset (px, pz) from a brush's middle segment. sy, cy: sin and cos of the yaw. */
export function brushDist(px: number, pz: number, sy: number, cy: number, r: number, elong: number) {
  const along = px * sy + pz * cy, across = px * cy - pz * sy;
  const hl = r * Math.max(0, elong - 1);
  const a = Math.max(0, Math.abs(along) - hl);
  return Math.hypot(a, across) / r;
}

// Areas under the core and the ring (unit radius): 1D across the straight part, 2D over the round ends. The berm's
// height is set so the ring holds as much as the hollow lost (times the surface's berm share).
const I = (() => {
  let c1 = 0, r1 = 0, c2 = 0, r2 = 0;
  const h = 0.0005;
  for (let x = h / 2; x < REACH + 0.5; x += h) {
    c1 += 2 * coreAt(x) * h; r1 += 2 * ringAt(x) * h;
    c2 += 2 * Math.PI * x * coreAt(x) * h; r2 += 2 * Math.PI * x * ringAt(x) * h;
  }
  return { c1, r1, c2, r2 };
})();
/** Ring height per metre of depth that keeps the mass (berm volume = depression volume) for a capsule of this elongation. */
export function bermRatio(elong: number) {
  const s = 2 * Math.max(0, elong - 1);
  return (s * I.c1 + I.c2) / (s * I.r1 + I.r2);
}

/** One brush, as the pass reads it. */
export interface Brush {
  x: number; z: number;
  /** Radius across (m) and length / width (1 round). */
  r: number; elong: number;
  /** sin and cos of the yaw (the long axis runs along heading yaw: +Z at 0). */
  sy: number; cy: number;
  /** Depression at the middle (m) and berm height at the ring (m). */
  dep: number; berm: number;
  /** Compression added (0..1), surface id, seed, mode (0 press: deepens only to its own depth; 1 add: churns deeper). */
  comp: number; surf: number; seed: number; mode: number;
}

/** Floats per brush in the brush texture: three rows of four. */
export const BRUSH_ROWS = 3;
export function packBrush(b: Brush, data: Float32Array, i: number, width: number) {
  const s = width * 4, a = i * 4;
  data[a] = b.x; data[a + 1] = b.z; data[a + 2] = b.r; data[a + 3] = b.elong;
  data[s + a] = b.sy; data[s + a + 1] = b.cy; data[s + a + 2] = b.dep; data[s + a + 3] = b.berm;
  data[2 * s + a] = b.comp; data[2 * s + a + 1] = b.surf; data[2 * s + a + 2] = b.seed; data[2 * s + a + 3] = b.mode;
}

/**
 * Apply one brush to one texel's state (in place: st = [dep, berm, comp, surf]). px, pz: the texel's offset from the
 * brush (wrapped). wob: the rim's edge noise (1 none), grain: the berm's grain (1 none). Mirrors the pass.
 */
export function splat(st: Float32Array | number[], o: number, b: Brush, px: number, pz: number, wob = 1, grain = 1) {
  const reach = b.r * Math.max(1, b.elong) * REACH;
  if (Math.abs(px) > reach || Math.abs(pz) > reach) return;
  const d = brushDist(px, pz, b.sy, b.cy, b.r, b.elong) / wob;
  if (d > REACH) return;
  const core = coreAt(d), ring = ringAt(d) * grain;
  const add = b.dep * core;
  if (b.mode > 0.5) st[o] += add;
  else st[o] = Math.max(st[o], add);
  // A foot pressed into an old berm pushes it away, then the new rim piles up round the hollow.
  st[o + 1] = Math.max(st[o + 1] * (1 - core), b.berm * ring);
  st[o + 2] = Math.max(st[o + 2], b.comp * core);
  if (core > 0.05 || ring > 0.3) st[o + 3] = b.surf;
}

/** Clamp one texel's state. */
export function clampTexel(st: Float32Array | number[], o: number, maxDepth: number, maxBerm: number) {
  st[o] = Math.min(maxDepth, Math.max(0, st[o]));
  st[o + 1] = Math.min(maxBerm, Math.max(0, st[o + 1]));
  st[o + 2] = Math.min(1, Math.max(0, st[o + 2]));
}

/**
 * Relax one texel for dt seconds (dt is banked time; 0 leaves it exactly as is). c: its state, sums of the four
 * neighbours' depression and berm. Writes into out at o.
 */
export function relaxTexel(c: ArrayLike<number>, co: number, nDep: number, nBerm: number, r: RelaxRates, dt: number, out: Float32Array | number[], o: number) {
  let dep = c[co], berm = c[co + 1], comp = c[co + 2];
  if (dt > 0) {
    dep += (nDep - 4 * c[co]) * Math.min(MAX_DIF, r.difDep * dt);
    berm += (nBerm - 4 * c[co + 1]) * Math.min(MAX_DIF, r.difBerm * dt);
    const s = Math.max(0, Math.min(berm, dep)) * Math.min(0.6, r.slump * dt);
    dep -= s; berm -= s;
    dep *= Math.exp(-dt * r.decay);
    berm *= Math.exp(-dt * r.decay * BERM_DECAY);
    comp *= Math.exp(-dt * r.decay * COMP_DECAY);
  }
  out[o] = dep; out[o + 1] = berm; out[o + 2] = comp; out[o + 3] = c[co + 3];
}

/** World position (one axis) of texel i's centre in a toroidal window of `size` m and n texels centred on `centre`. */
export function texelWorld(i: number, n: number, size: number, centre: number) {
  const base = ((i + 0.5) / n) * size;
  return base + size * Math.round((centre - base) / size);
}

/** Wrap an offset into (-size/2, size/2]. */
export const wrap = (p: number, size: number) => p - size * Math.round(p / size);

/**
 * The CPU reference: a small toroidal dent window running the same frame step as the pass (for the headless check).
 */
export class DentGrid {
  a: Float32Array;
  private b: Float32Array;
  readonly texel: number;
  cx = 0; cz = 0;
  private pcx = 0; private pcz = 0;
  private owed = 0;
  constructor(readonly n: number, readonly size: number, public rates: RelaxRates[], public maxDepth = 0.6, public maxBerm = 0.4, public relaxStep = 0.3) {
    this.a = new Float32Array(n * n * 4);
    this.b = new Float32Array(n * n * 4);
    this.texel = size / n;
  }

  /** Follow a focus (snapped to texels). */
  follow(x: number, z: number) {
    this.cx = Math.round(x / this.texel) * this.texel;
    this.cz = Math.round(z / this.texel) * this.texel;
  }

  step(dt: number, brushes: Brush[]) {
    const { n, size } = this, half = size / 2;
    this.owed += dt;
    let rdt = 0;
    if (this.owed >= this.relaxStep) { rdt = this.owed; this.owed = 0; }
    const A = this.a, B = this.b;
    for (let j = 0; j < n; j++) {
      const wz = texelWorld(j, n, size, this.cz);
      const zin = Math.abs(wz - this.pcz) <= half;
      for (let i = 0; i < n; i++) {
        const o = (j * n + i) * 4;
        const wx = texelWorld(i, n, size, this.cx);
        if (zin && Math.abs(wx - this.pcx) <= half) {
          const il = ((i + n - 1) % n), ir = (i + 1) % n, jd = (j + n - 1) % n, ju = (j + 1) % n;
          const L = (j * n + il) * 4, R = (j * n + ir) * 4, D = (jd * n + i) * 4, U = (ju * n + i) * 4;
          const surf = Math.round(A[o + 3]);
          relaxTexel(A, o, A[L] + A[R] + A[D] + A[U], A[L + 1] + A[R + 1] + A[D + 1] + A[U + 1], this.rates[surf] ?? SET_RATES, rdt, B, o);
        } else { B[o] = 0; B[o + 1] = 0; B[o + 2] = 0; B[o + 3] = 0; }
        for (const br of brushes) splat(B, o, br, wrap(wx - br.x, size), wrap(wz - br.z, size));
        clampTexel(B, o, this.maxDepth, this.maxBerm);
      }
    }
    this.a = B; this.b = A;
    this.pcx = this.cx; this.pcz = this.cz;
  }

  /** Total depression and berm volume (m³). */
  volumes() {
    let dep = 0, berm = 0;
    const A = this.a, t2 = this.texel * this.texel;
    for (let i = 0; i < A.length; i += 4) { dep += A[i]; berm += A[i + 1]; }
    return { dep: dep * t2, berm: berm * t2 };
  }
}
