// Light clustering (Keith 2026-10-31: "lights going off near each other at once merge into one brighter light"). Pure.
// Short bright lights asked for this frame (rockets in flight, blasts, launch flashes) that sit close together become
// one light at their brightness-weighted centre, so the busier the fight the fewer real lights it needs. Greedy: the
// brightest request seeds a cluster, every later one joins the first cluster whose seed is within the radius, else
// seeds its own. A cluster's brightness is its brightest member grown by the sum (curve 0.5: sqrt, 1: plain sum), then
// softly capped so twenty blasts don't white out; its reach grows a little with it. Cosmetic.

export interface LightReq {
  x: number; y: number; z: number;
  /** Intensity this frame (already faded). */
  power: number;
  /** Reach (m). */
  range: number;
  /** Colour (linear). */
  r: number; g: number; b: number;
  /** How much it wants a real light over others of its power (1 a blast; the beam's charge more). Default 1. */
  prio?: number;
}

export interface LightCluster extends LightReq {
  /** How many requests it holds. */
  n: number;
  /** Their summed power, and the brightest one's. */
  sum: number;
  peak: number;
  /** The seed (the brightest member), which others join by distance. */
  sx: number; sy: number; sz: number;
  /** Free for the caller (the night lights rank clusters by it). */
  score: number;
  /** The highest priority among its members. */
  prio: number;
}

export interface ClusterOpts {
  /** Requests this close to a cluster's seed join it (m). 0: no merging. */
  radius: number;
  /** 0.5: brightness grows as the square root of the summed power over the brightest member; 1: the plain sum. */
  curve: number;
  /** The soft cap on a cluster's intensity (nothing ever reaches it). */
  cap: number;
  /** 0..1: how much a cluster's reach grows with its brightness (1: as its square root, as a light really would). */
  grow: number;
}

/** A cluster's intensity from its summed and brightest power: the curve, then the soft cap. */
export function clusterPower(sum: number, peak: number, o: ClusterOpts): number {
  if (sum <= 0 || peak <= 0) return 0;
  const b = peak * Math.pow(sum / peak, o.curve);
  if (o.cap <= 0) return b;
  const k = b / o.cap;
  return b / Math.pow(1 + k * k * k * k, 0.25);
}

const order: number[] = [];

/** Group `count` requests into `out` (reused; grown as needed). Returns the number of clusters. */
export function clusterLights(reqs: LightReq[], count: number, o: ClusterOpts, out: LightCluster[]): number {
  order.length = 0;
  for (let i = 0; i < count; i++) if (reqs[i].power > 0) order.push(i);
  order.sort((a, b) => reqs[b].power - reqs[a].power);
  const R2 = o.radius * o.radius;
  let nc = 0;
  for (const i of order) {
    const q = reqs[i];
    let c: LightCluster | null = null;
    if (R2 > 0) for (let j = 0; j < nc; j++) {
      const k = out[j], dx = q.x - k.sx, dy = q.y - k.sy, dz = q.z - k.sz;
      if (dx * dx + dy * dy + dz * dz <= R2) { c = k; break; }
    }
    if (!c) {
      if (nc >= out.length) out.push({ x: 0, y: 0, z: 0, power: 0, range: 0, r: 0, g: 0, b: 0, n: 0, sum: 0, peak: 0, sx: 0, sy: 0, sz: 0, score: 0, prio: 1 });
      c = out[nc++];
      c.sx = q.x; c.sy = q.y; c.sz = q.z; c.peak = q.power;
      c.x = c.y = c.z = c.r = c.g = c.b = c.sum = c.range = 0; c.n = 0; c.prio = 0;
    }
    const pr = q.prio ?? 1;
    if (pr > c.prio) c.prio = pr;
    const p = q.power;
    c.x += q.x * p; c.y += q.y * p; c.z += q.z * p;
    c.r += q.r * p; c.g += q.g * p; c.b += q.b * p;
    c.sum += p; c.n++;
    if (q.range > c.range) c.range = q.range;
  }
  for (let j = 0; j < nc; j++) {
    const c = out[j], s = c.sum;
    c.x /= s; c.y /= s; c.z /= s; c.r /= s; c.g /= s; c.b /= s;
    c.power = clusterPower(s, c.peak, o);
    c.range *= Math.min(3, Math.pow(Math.max(1, c.power / c.peak), 0.5 * o.grow));
  }
  return nc;
}
