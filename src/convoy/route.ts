// The convoy's route (pure, no rendering): where the convoy has been and where it's going, and the flattened road
// it leaves across the desert (Keith 2026-10-24: the road stays behind, so players can follow it back).
//
// The route is a polyline planned a stretch ahead of the convoy (routeAhead): each new point turns toward the
// heading slider plus a slow wander, at a capped turn rate. The convoy's head moves along it at convoySpeed. Changing
// the heading replans only the part well ahead of the head, so the ground under the convoy never jumps.
//
// The road: as a GroundModifier on the DuneField, the dunes blend down to a smooth floor (the swell plus routeLift)
// within routeHalfWidth of the polyline, through a smoothstep over routeBlend, with low berms pushed up at the edges.
// Still a pure function of position given the stored polyline. Segments sit in grid buckets so a height lookup only
// tests the few segments near it.
import type { Param } from "../core/tweaks";
import type { GroundModifier, ModifierSample } from "../world/terrain";

export const ROUTE_DEFAULTS = {
  convoySpeed: 3.3,
  convoyHeading: 0,
  convoyTurn: 2,
  convoyWander: 12,
  convoyWanderLength: 600,
  routeHalfWidth: 30,
  routeBlend: 15,
  routeBerm: 1,
  routeAhead: 150,
  routeLift: 3,
  routeRough: 0.3,
};
export type RouteValues = typeof ROUTE_DEFAULTS;

export const ROUTE_PARAMS: Param[] = [
  { key: "convoySpeed", label: "Convoy speed (m/s)", min: 0, max: 6, step: 0.1, group: "Convoy route", tip: "The mech walks 4 and sprints 6.5: deploying at speed is the drama" },
  { key: "convoyHeading", label: "Heading (°)", min: -180, max: 180, step: 1, group: "Convoy route", tip: "Where the convoy heads (0 = +Z). Replans the road beyond the next 40 m" },
  { key: "convoyTurn", label: "Turn rate (°/s)", min: 0.2, max: 10, step: 0.1, group: "Convoy route", tip: "How fast the convoy can swing onto a new heading" },
  { key: "convoyWander", label: "Wander (°)", min: 0, max: 45, step: 1, group: "Convoy route", tip: "Slow drift either side of the heading" },
  { key: "convoyWanderLength", label: "Wander length (m)", min: 100, max: 3000, step: 10, group: "Convoy route", tip: "Distance of one slow wander swing" },
  { key: "routeHalfWidth", label: "Road half-width (m)", min: 5, max: 60, step: 1, group: "Road", onRelease: true },
  { key: "routeBlend", label: "Edge blend (m)", min: 2, max: 40, step: 0.5, group: "Road", tip: "Width of the slope from the road floor back up to the dunes", onRelease: true },
  { key: "routeBerm", label: "Berm height (m)", min: 0, max: 4, step: 0.05, group: "Road", tip: "Low ridges of shoved sand at the road's edges", onRelease: true },
  { key: "routeLift", label: "Floor height (m)", min: -4, max: 10, step: 0.1, group: "Road", tip: "Road floor above the slow swell (dunes are cut down to it, troughs filled up)", onRelease: true },
  { key: "routeRough", label: "Floor roughness", min: 0, max: 1, step: 0.01, group: "Road", tip: "Share of the small bumps left on the road floor", onRelease: true },
  { key: "routeAhead", label: "Flattened ahead (m)", min: 40, max: 400, step: 10, group: "Road", tip: "How far ahead of the convoy the road is laid" },
];

const D2R = Math.PI / 180;
/** Spacing of the route's points (m). Not a feel value: the road is a smooth polyline at this resolution. */
export const ROUTE_STEP = 8;
/** Grid bucket size for the road lookup (m). */
const CELL = 32;
/** Straight road laid behind the start, so trailing platforms have ground. */
const BEHIND = 400;
/** The plan nearer than this ahead of the head is kept when the heading changes. */
const KEEP = 40;
/** Flush changed ground to the chunks every this many new points. */
const FLUSH = 4;

const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const smooth = (x: number) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

export interface RoutePoint { x: number; z: number; heading: number }

export class ConvoyRoute implements GroundModifier {
  /** Distance along the route of the convoy's head (m). */
  s = 0;
  /** Point i sits at distance s0 + i * ROUTE_STEP. */
  private s0 = 0;
  private xs: number[] = [];
  private zs: number[] = [];
  private hs: number[] = [];
  private grid = new Map<number, number[]>();
  /** Reach the grid was built for (half-width + blend). */
  private reach = 0;
  private plan = "";
  private sinceFlush = 0;
  private dirty: number[] | null = null;
  /** Called with a box (x0, z0, x1, z1) whose ground changed (rebuild those chunks). */
  onChange: ((x0: number, z0: number, x1: number, z1: number) => void) | null = null;

  constructor(public v: RouteValues, x = 0, z = 0) { this.reset(x, z); }

  get count() { return this.xs.length; }
  /** Distance along the route of the last planned point. */
  get end() { return this.s0 + (this.xs.length - 1) * ROUTE_STEP; }

  /** Start over at (x, z) heading convoyHeading, with a straight road behind. */
  reset(x: number, z: number) {
    this.xs = []; this.zs = []; this.hs = [];
    this.grid.clear();
    this.reach = this.v.routeHalfWidth + this.v.routeBlend;
    const h = this.v.convoyHeading * D2R;
    const n = Math.round(BEHIND / ROUTE_STEP);
    this.s0 = -n * ROUTE_STEP;
    this.s = 0;
    for (let i = 0; i <= n; i++) {
      const back = (n - i) * ROUTE_STEP;
      this.push(x - Math.sin(h) * back, z - Math.cos(h) * back, h);
    }
    this.plan = this.planKey();
    this.extend();
    this.dirty = null;
    this.sinceFlush = 0;
  }

  /** Move the head along at convoySpeed, replan if the steering changed, and lay road ahead. */
  update(dt: number) {
    // Road shape sliders change every bucket's reach: re-index (the lab rebuilds the chunks on release).
    if (this.v.routeHalfWidth + this.v.routeBlend !== this.reach) this.reindex();
    const key = this.planKey();
    if (key !== this.plan) {
      this.plan = key;
      this.truncate(this.s + KEEP);
    }
    this.s += this.v.convoySpeed * dt;
    this.extend();
  }

  /** Point and heading on the route at distance s (extrapolated straight past the ends). */
  pointAt(s: number, out: RoutePoint = { x: 0, z: 0, heading: 0 }): RoutePoint {
    const n = this.xs.length;
    const f = (s - this.s0) / ROUTE_STEP;
    if (f <= 0 || f >= n - 1) {
      const i = f <= 0 ? 0 : n - 1, h = this.hs[i], d = (f <= 0 ? f : f - (n - 1)) * ROUTE_STEP;
      out.x = this.xs[i] + Math.sin(h) * d; out.z = this.zs[i] + Math.cos(h) * d; out.heading = h;
      return out;
    }
    const i = Math.floor(f), t = f - i;
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    out.z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    out.heading = wrap(this.hs[i] + wrap(this.hs[i + 1] - this.hs[i]) * t);
    return out;
  }

  /** A point beside the route: side metres to the left (+) or right (-) of the route at distance s. */
  offsetAt(s: number, side: number, out: RoutePoint = { x: 0, z: 0, heading: 0 }): RoutePoint {
    this.pointAt(s, out);
    out.x += Math.cos(out.heading) * side;
    out.z -= Math.sin(out.heading) * side;
    return out;
  }

  /** The road as a ground modifier: weight toward the floor and the berm at (x, z). */
  at(x: number, z: number, out: ModifierSample): boolean {
    const list = this.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    const v = this.v, R = this.reach;
    let best = R * R;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const ax = this.xs[i], az = this.zs[i], bx = this.xs[i + 1], bz = this.zs[i + 1];
      const ex = bx - ax, ez = bz - az, px = x - ax, pz = z - az;
      let t = (px * ex + pz * ez) / (ex * ex + ez * ez);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex * t, dz = pz - ez * t, d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    if (best >= R * R) return false;
    const d = Math.sqrt(best);
    // t: 0 at the road's edge, 1 where the dunes are back to themselves.
    const t = (d - v.routeHalfWidth) / Math.max(0.01, v.routeBlend);
    out.w = 1 - smooth(t);
    // Berm: a smooth bump straddling the edge, out on the blend.
    const b = (t - 0.15) / 0.45;
    out.berm = Math.abs(b) < 1 ? v.routeBerm * (1 - b * b) * (1 - b * b) : 0;
    out.lift = v.routeLift;
    out.rough = v.routeRough;
    return true;
  }

  private planKey() {
    const v = this.v;
    return `${v.convoyHeading}|${v.convoyTurn}|${v.convoyWander}|${v.convoyWanderLength}`;
  }

  /** Heading the plan steers toward at distance d along the route: the slider plus a slow wander. */
  private target(d: number) {
    const v = this.v, L = Math.max(10, v.convoyWanderLength), a = (2 * Math.PI * d) / L;
    return (v.convoyHeading + v.convoyWander * (0.65 * Math.sin(a + 0.3) + 0.35 * Math.sin(a / 0.41 + 1.7))) * D2R;
  }

  private extend() {
    const v = this.v;
    // Turn rate per metre at the current speed (the slider is per second).
    const perM = (v.convoyTurn * D2R) / Math.max(0.5, v.convoySpeed);
    while (this.end < this.s + v.routeAhead) {
      const i = this.xs.length - 1, d = this.end + ROUTE_STEP;
      const h0 = this.hs[i], max = perM * ROUTE_STEP;
      const dh = Math.max(-max, Math.min(max, wrap(this.target(d) - h0)));
      // Move along the mean heading of the step, so the polyline follows the arc.
      const hm = h0 + dh / 2, h1 = wrap(h0 + dh);
      this.push(this.xs[i] + Math.sin(hm) * ROUTE_STEP, this.zs[i] + Math.cos(hm) * ROUTE_STEP, h1);
    }
    if (this.dirty && this.sinceFlush >= FLUSH) this.flush();
  }

  /** Drop the plan beyond distance s (keeping at least the point before it). */
  private truncate(s: number) {
    const keep = Math.max(2, Math.floor((s - this.s0) / ROUTE_STEP) + 1);
    if (keep >= this.xs.length) return;
    for (let i = this.xs.length - 2; i >= keep - 1; i--) { this.unindex(i); this.markDirty(i); }
    this.xs.length = keep; this.zs.length = keep; this.hs.length = keep;
    this.flush();
  }

  private push(x: number, z: number, h: number) {
    this.xs.push(x); this.zs.push(z); this.hs.push(h);
    const i = this.xs.length - 2;
    if (i >= 0) { this.index(i); this.markDirty(i); this.sinceFlush++; }
  }

  private markDirty(i: number) {
    const R = this.reach;
    const x0 = Math.min(this.xs[i], this.xs[i + 1]) - R, x1 = Math.max(this.xs[i], this.xs[i + 1]) + R;
    const z0 = Math.min(this.zs[i], this.zs[i + 1]) - R, z1 = Math.max(this.zs[i], this.zs[i + 1]) + R;
    const d = this.dirty;
    if (!d) this.dirty = [x0, z0, x1, z1];
    else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], z0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], z1); }
  }

  private flush() {
    const d = this.dirty;
    this.dirty = null;
    this.sinceFlush = 0;
    if (d) this.onChange?.(d[0], d[1], d[2], d[3]);
  }

  /** Cells a segment's reach overlaps. */
  private cells(i: number, fn: (key: number) => void) {
    const R = this.reach;
    const a = Math.floor((Math.min(this.xs[i], this.xs[i + 1]) - R) / CELL), b = Math.floor((Math.max(this.xs[i], this.xs[i + 1]) + R) / CELL);
    const c = Math.floor((Math.min(this.zs[i], this.zs[i + 1]) - R) / CELL), d = Math.floor((Math.max(this.zs[i], this.zs[i + 1]) + R) / CELL);
    for (let cz = c; cz <= d; cz++) for (let cx = a; cx <= b; cx++) fn(cellKey(cx, cz));
  }

  private index(i: number) {
    this.cells(i, (k) => { const l = this.grid.get(k); if (l) l.push(i); else this.grid.set(k, [i]); });
  }

  private unindex(i: number) {
    this.cells(i, (k) => {
      const l = this.grid.get(k);
      if (!l) return;
      const j = l.lastIndexOf(i);
      if (j >= 0) l.splice(j, 1);
      if (!l.length) this.grid.delete(k);
    });
  }

  private reindex() {
    this.grid.clear();
    this.reach = this.v.routeHalfWidth + this.v.routeBlend;
    for (let i = 0; i < this.xs.length - 1; i++) this.index(i);
  }
}

const cellKey = (cx: number, cz: number) => (cx + 65536) * 131072 + (cz + 65536);
