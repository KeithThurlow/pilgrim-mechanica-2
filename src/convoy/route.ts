// The convoy's route (pure, no rendering): where the convoy has been and where it's going, and the flattened road
// it leaves across the desert (Keith 2026-10-24: the road stays behind, so players can follow it back).
//
// The route is a polyline planned a stretch ahead of the convoy (routeAhead): each new point turns toward the
// heading slider plus a slow wander, at a capped turn rate. The convoy's head moves along it at convoySpeed. Changing
// the heading replans only the part well ahead of the head, so the ground under the convoy never jumps.
//
// The road: as a GroundModifier on the DuneField, the dunes blend down to a smooth floor (the swell plus routeLift)
// within routeHalfWidth of the polyline, through a smoothstep over routeBlend. The road is the plough's (Keith
// 2026-10-26): it exists only behind the blade, which runs a fixed distance ahead of the convoy's head, so its place
// is a pure function of the convoy clock (s); ahead of it the dunes are untouched. The blade is a V, so the cut edge
// trails toward the tips (bladeSweep), and the dune comes down to the floor over bladeRamp behind it. The sand cut
// goes into berms beside the road (wake.ts), sized by the material moved. Far behind, the road stays as it was.
// Still a pure function of position given the stored polyline and s. Segments sit in grid buckets so a height lookup
// only tests the few segments near it. As the blade advances, onChange gets small boxes of ground to patch.
import type { Param } from "../core/tweaks";
import type { GroundModifier, ModifierSample } from "../world/terrain";
import { Wake, WAKE_DEFAULTS, WAKE_PARAMS, sweepTan, type WakeGround, type Berm } from "./wake";

export const ROUTE_DEFAULTS = {
  convoySpeed: 3.3,
  convoyHeading: 0,
  convoyTurn: 2,
  convoyWander: 12,
  convoyWanderLength: 600,
  routeHalfWidth: 30,
  routeBlend: 15,
  routeAhead: 150,
  routeLift: 3,
  routeRough: 0.3,
  ...WAKE_DEFAULTS,
};
export type RouteValues = typeof ROUTE_DEFAULTS;

export const ROUTE_PARAMS: Param[] = [
  { key: "convoySpeed", label: "Convoy speed (m/s)", min: 0, max: 6, step: 0.1, group: "Convoy route", tip: "The mech walks 4 and sprints 6.5: deploying at speed is the drama" },
  { key: "convoyHeading", label: "Heading (°)", min: -180, max: 180, step: 1, group: "Convoy route", tip: "Where the convoy heads (0 = +Z). Replans the road beyond the next 40 m" },
  { key: "convoyTurn", label: "Turn rate (°/s)", min: 0.2, max: 10, step: 0.1, group: "Convoy route", tip: "How fast the convoy can swing onto a new heading" },
  { key: "convoyWander", label: "Wander (°)", min: 0, max: 45, step: 1, group: "Convoy route", tip: "Slow drift either side of the heading" },
  { key: "convoyWanderLength", label: "Wander length (m)", min: 100, max: 3000, step: 10, group: "Convoy route", tip: "Distance of one slow wander swing" },
  { key: "routeHalfWidth", label: "Road and blade half-width (m)", min: 5, max: 60, step: 1, group: "Road", tip: "Half the plough blade's width: the road floor it leaves", onRelease: true },
  { key: "routeBlend", label: "Edge blend (m)", min: 2, max: 40, step: 0.5, group: "Road", tip: "Width of the slope from the road floor back up to the dunes", onRelease: true },
  { key: "routeLift", label: "Floor height (m)", min: -4, max: 10, step: 0.1, group: "Road", tip: "Road floor above the slow swell (dunes are cut down to it, troughs filled up)", onRelease: true },
  { key: "routeRough", label: "Floor roughness", min: 0, max: 1, step: 0.01, group: "Road", tip: "Share of the small bumps left on the road floor", onRelease: true },
  { key: "routeAhead", label: "Planned ahead (m)", min: 40, max: 400, step: 10, group: "Road", tip: "How far ahead of the convoy the route is planned (at least past the plough's blade; the road itself starts at the blade)" },
  ...WAKE_PARAMS,
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
/** Patch boxes are cut this wide across the road (m), so a diagonal road doesn't make one huge box. */
const PATCH_PIECE = 16;
/** The plough's length from its tail to the blade's middle (m); plough.ts drives and draws it to this. */
export const PLOUGH_REACH = 22;

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
  /** Called with a box (x0, z0, x1, z1) whose ground changed as the blade advanced (patch those chunks). */
  onChange: ((x0: number, z0: number, x1: number, z1: number) => void) | null = null;
  /** The sand the plough moves (berms beside the road). */
  readonly wake: Wake;
  /** Distance from the head (the lead car's middle) to the blade, less ploughGap: the lead's half-length plus the plough. */
  bladeOffset = 20 + PLOUGH_REACH;
  /** The blade's distance when the ground was last patched. */
  private patchedTo = 0;
  private wakeKey = "";
  private bm: Berm = { h: 0, w: 0, c: 0 };

  constructor(public v: RouteValues, x = 0, z = 0) {
    this.wake = new Wake(this, v);
    this.reset(x, z);
  }

  /** The original ground the plough cuts (set by the Convoy, or whoever puts the route in a field). */
  set ground(g: WakeGround | null) { if (this.wake.ground !== g) { this.wake.ground = g; this.wake.clear(); } }
  get ground() { return this.wake.ground; }

  /** Distance along the route of the blade's middle: the convoy clock plus a fixed lead, so every peer agrees. */
  get blade() { return this.s + this.bladeOffset + this.v.ploughGap; }
  /** How far the blade's tips trail its middle (m). */
  get tipLag() { return this.v.routeHalfWidth * sweepTan(this.v); }

  get count() { return this.xs.length; }
  /** Distance along the route of the last planned point. */
  get end() { return this.s0 + (this.xs.length - 1) * ROUTE_STEP; }

  /** Start over at (x, z) heading convoyHeading, with a straight road behind. */
  reset(x: number, z: number) {
    this.xs = []; this.zs = []; this.hs = [];
    this.grid.clear();
    this.reach = this.reachFor();
    const h = this.v.convoyHeading * D2R;
    const n = Math.round(BEHIND / ROUTE_STEP);
    this.s0 = -n * ROUTE_STEP;
    this.s = 0;
    this.wake.reset(this.s0);
    this.wakeKey = this.wakeKeyNow();
    for (let i = 0; i <= n; i++) {
      const back = (n - i) * ROUTE_STEP;
      this.push(x - Math.sin(h) * back, z - Math.cos(h) * back, h);
    }
    this.plan = this.planKey();
    this.extend();
    this.patchedTo = this.blade;
  }

  /**
   * Jump the convoy clock to s (the route laid up to it the way driving there lays it): for starting a lab at a
   * given place. The ground behind the new blade is the road at once; whoever holds chunks rebuilds them.
   */
  jump(s: number) {
    this.s = s;
    this.extend();
    this.patchedTo = this.blade;
  }

  /** Move the head along at convoySpeed, replan if the steering changed, and lay road ahead. */
  update(dt: number) {
    // Road shape sliders change every bucket's reach: re-index (the lab rebuilds the chunks on release).
    if (this.reachFor() !== this.reach) this.reindex();
    const wk = this.wakeKeyNow();
    if (wk !== this.wakeKey) { this.wakeKey = wk; this.wake.clear(); }
    const key = this.planKey();
    if (key !== this.plan) {
      this.fcKey = "";
      this.plan = key;
      // Never replan under the blade or the stretch the berms behind it read.
      this.truncate(this.s + Math.max(KEEP, this.keepAhead()));
    }
    this.s += this.v.convoySpeed * dt;
    this.extend();
    this.patch();
  }

  /** Planned route kept ahead of the head: past the blade and the stations its berms smear over. */
  private keepAhead() { return this.bladeOffset + this.v.ploughGap + this.v.bermCarry + 3 * ROUTE_STEP; }

  private reachFor() { return this.v.routeHalfWidth + Math.max(this.v.routeBlend, this.wake.reach() - this.v.routeHalfWidth); }

  private wakeKeyNow() {
    const v = this.v;
    return `${v.routeHalfWidth}|${v.routeBlend}|${v.routeLift}|${v.routeRough}|${v.bermSpread}|${v.bermOut}|${v.bermCurve}|${v.bermLumps}|${v.bermCarry}`;
  }

  /**
   * As the blade advances, the ground changes from the cut edge back over the berms' growth: once it has gone
   * ploughPatchEvery metres, hand out that strip in pieces PATCH_PIECE wide across the road (each piece's box covers
   * the cut edge's lag at its distance out).
   */
  private patch() {
    const v = this.v, b = this.blade;
    if (b - this.patchedTo < Math.max(0.5, v.ploughPatchEvery)) return;
    if (b - this.patchedTo > 200) { this.patchedTo = b; return; }
    const from = this.patchedTo;
    this.patchedTo = b;
    if (!this.onChange) return;
    const R = this.reach, tan = sweepTan(v), hw = v.routeHalfWidth, back = Math.max(v.bladeRamp, v.bermGrow) + 1;
    const p = { x: 0, z: 0, heading: 0 };
    for (let d0 = -R; d0 < R; d0 += PATCH_PIECE) {
      const d1 = Math.min(R, d0 + PATCH_PIECE);
      const near = d0 <= 0 && d1 >= 0 ? 0 : Math.min(Math.abs(d0), Math.abs(d1)), far = Math.max(Math.abs(d0), Math.abs(d1));
      const sa = from - Math.min(far, hw) * tan - back, sb = b - Math.min(near, hw) * tan + 1;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let s = sa; ; s = Math.min(sb, s + 4)) {
        for (const d of [d0, d1]) {
          this.offsetAt(s, d, p);
          x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
        }
        if (s >= sb) break;
      }
      this.onChange(x0, z0, x1, z1);
    }
  }

  /**
   * The road corridor at (x, z) whether or not the blade has got there yet (0..1, 1 on the floor): for keeping things
   * off the road to be (POIs, camps).
   */
  corridor(x: number, z: number): number {
    const n = this.nearest(x, z, this.v.routeHalfWidth + this.v.routeBlend);
    if (!n) return 0;
    return 1 - smooth((n.d - this.v.routeHalfWidth) / Math.max(0.01, this.v.routeBlend));
  }

  private near = { d: 0, s: 0, side: 1 };
  /** Nearest point of the route within R of (x, z): distance, distance along the route, side (+1 left). */
  private nearest(x: number, z: number, R: number) {
    const list = this.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let best = R * R, bi = -1, bt = 0, bdx = 0, bdz = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const ax = this.xs[i], az = this.zs[i], bx = this.xs[i + 1], bz = this.zs[i + 1];
      const ex = bx - ax, ez = bz - az, px = x - ax, pz = z - az;
      let t = (px * ex + pz * ez) / (ex * ex + ez * ez);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex * t, dz = pz - ez * t, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; bt = t; bdx = dx; bdz = dz; }
    }
    if (bi < 0) return null;
    const n = this.near, ex = this.xs[bi + 1] - this.xs[bi], ez = this.zs[bi + 1] - this.zs[bi];
    n.d = Math.sqrt(best);
    // Distance along: not the nearest point's (it jumps across the inside of a bend and sticks at a vertex on the
    // outside, which would tear the berms), but between the lines square to the route through each vertex, which
    // adjacent segments share, so it runs on smoothly out to the side.
    let i = bi, t = bt;
    for (let it = 0; it < 4; it++) {
      const sa = (x - this.xs[i]) * Math.sin(this.hs[i]) + (z - this.zs[i]) * Math.cos(this.hs[i]);
      const sb = (x - this.xs[i + 1]) * Math.sin(this.hs[i + 1]) + (z - this.zs[i + 1]) * Math.cos(this.hs[i + 1]);
      if (sa < 0 && i > 0) { i--; continue; }
      if (sb > 0 && i < this.xs.length - 2) { i++; continue; }
      // Past where the square lines cross (far inside a tight bend): keep the nearest point's.
      if (sa - sb > ROUTE_STEP * 0.1) { const q = sa / (sa - sb); t = q < 0 ? 0 : q > 1 ? 1 : q; }
      else i = bi;
      break;
    }
    n.s = this.s0 + (i + t) * ROUTE_STEP;
    // Left of the segment (heading 0 faces +Z, left is +X): (ez, -ex).
    n.side = bdx * ez - bdz * ex >= 0 ? 1 : -1;
    return n;
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

  /**
   * Where the route will be at distance s, also past the laid road: the plan is carried on with the same steering
   * (heading slider, wander, turn rate) as extend() will use, so it matches what gets laid unless a slider changes.
   * For the expedition's return point (src/expedition/returnPoint.ts). Forecast kept in FORECAST_STEP points.
   */
  ahead(s: number, out: RoutePoint = { x: 0, z: 0, heading: 0 }): RoutePoint {
    if (s <= this.end) return this.pointAt(s, out);
    const n = this.xs.length, key = `${this.planKey()}|${this.v.convoySpeed}|${n}|${this.xs[n - 1]}|${this.zs[n - 1]}`;
    const need = s - this.end;
    if (key !== this.fcKey || need > (this.fx.length - 1) * ROUTE_STEP) this.forecast(key, Math.max(need * 1.5, 2000));
    const f = need / ROUTE_STEP, i = Math.min(this.fx.length - 2, Math.floor(f)), t = f - i;
    if (f >= this.fx.length - 1) {
      const j = this.fx.length - 1, h = this.fh[j], d = (f - j) * ROUTE_STEP;
      out.x = this.fx[j] + Math.sin(h) * d; out.z = this.fz[j] + Math.cos(h) * d; out.heading = h;
      return out;
    }
    out.x = this.fx[i] + (this.fx[i + 1] - this.fx[i]) * t;
    out.z = this.fz[i] + (this.fz[i + 1] - this.fz[i]) * t;
    out.heading = wrap(this.fh[i] + wrap(this.fh[i + 1] - this.fh[i]) * t);
    return out;
  }

  /** ahead() beside the route (like offsetAt). */
  aheadOffset(s: number, side: number, out: RoutePoint = { x: 0, z: 0, heading: 0 }): RoutePoint {
    this.ahead(s, out);
    out.x += Math.cos(out.heading) * side;
    out.z -= Math.sin(out.heading) * side;
    return out;
  }

  private fx: number[] = [];
  private fz: number[] = [];
  private fh: number[] = [];
  private fcKey = "";
  /** Carry the plan on from the last laid point for `length` metres, the way extend() would. */
  private forecast(key: string, length: number) {
    const v = this.v, perM = (v.convoyTurn * D2R) / Math.max(0.5, v.convoySpeed), max = perM * ROUTE_STEP;
    const n = this.xs.length;
    let x = this.xs[n - 1], z = this.zs[n - 1], h = this.hs[n - 1], d = this.end;
    this.fx = [x]; this.fz = [z]; this.fh = [h];
    for (let k = 0; k < Math.ceil(length / ROUTE_STEP); k++) {
      d += ROUTE_STEP;
      const dh = Math.max(-max, Math.min(max, wrap(this.target(d) - h)));
      const hm = h + dh / 2;
      x += Math.sin(hm) * ROUTE_STEP; z += Math.cos(hm) * ROUTE_STEP; h = wrap(h + dh);
      this.fx.push(x); this.fz.push(z); this.fh.push(h);
    }
    this.fcKey = key;
  }

  /** A point beside the route: side metres to the left (+) or right (-) of the route at distance s. */
  offsetAt(s: number, side: number, out: RoutePoint = { x: 0, z: 0, heading: 0 }): RoutePoint {
    this.pointAt(s, out);
    out.x += Math.cos(out.heading) * side;
    out.z -= Math.sin(out.heading) * side;
    return out;
  }

  /**
   * The road as a ground modifier at (x, z): behind the blade, the weight toward the floor (the cut edge easing in
   * over bladeRamp behind the V) and the berm of the sand moved (growing in over bermGrow behind the tips).
   */
  at(x: number, z: number, out: ModifierSample): boolean {
    const n = this.nearest(x, z, this.reach);
    if (!n) return false;
    const v = this.v, d = n.d, hw = v.routeHalfWidth, lag = Math.min(d, hw) * sweepTan(v);
    const behind = this.blade - lag - n.s;
    if (behind <= 0) return false;
    // t: 0 at the road's edge, 1 where the dunes are back to themselves.
    const t = (d - hw) / Math.max(0.01, v.routeBlend);
    const w = (1 - smooth(t)) * smooth(behind / Math.max(0.01, v.bladeRamp));
    let berm = 0;
    if (d > hw) {
      const grow = smooth((this.blade - this.tipLag - n.s) / Math.max(0.01, v.bermGrow));
      if (grow > 0) berm = Wake.profile(this.wake.berm(n.s, n.side, this.bm), d) * grow;
    }
    if (w <= 0 && berm <= 0) return false;
    out.w = w;
    out.berm = berm;
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
    // Always planned past the blade and what its berms read, so the cut never rides on an extrapolated end.
    const ahead = Math.max(v.routeAhead, this.keepAhead() + 2 * ROUTE_STEP);
    while (this.end < this.s + ahead) {
      const i = this.xs.length - 1, d = this.end + ROUTE_STEP;
      const h0 = this.hs[i], max = perM * ROUTE_STEP;
      const dh = Math.max(-max, Math.min(max, wrap(this.target(d) - h0)));
      // Move along the mean heading of the step, so the polyline follows the arc.
      const hm = h0 + dh / 2, h1 = wrap(h0 + dh);
      this.push(this.xs[i] + Math.sin(hm) * ROUTE_STEP, this.zs[i] + Math.cos(hm) * ROUTE_STEP, h1);
    }
  }

  /** Drop the plan beyond distance s (keeping at least the point before it). */
  private truncate(s: number) {
    const keep = Math.max(2, Math.floor((s - this.s0) / ROUTE_STEP) + 1);
    if (keep >= this.xs.length) return;
    for (let i = this.xs.length - 2; i >= keep - 1; i--) this.unindex(i);
    this.xs.length = keep; this.zs.length = keep; this.hs.length = keep;
    // Stations past the kept stretch read the old plan: work them out again.
    this.wake.forget(this.s0 + (keep - 2) * ROUTE_STEP);
  }

  private push(x: number, z: number, h: number) {
    this.xs.push(x); this.zs.push(z); this.hs.push(h);
    const i = this.xs.length - 2;
    if (i >= 0) this.index(i);
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
    this.reach = this.reachFor();
    for (let i = 0; i < this.xs.length - 1; i++) this.index(i);
  }
}

const cellKey = (cx: number, cz: number) => (cx + 65536) * 131072 + (cz + 65536);
