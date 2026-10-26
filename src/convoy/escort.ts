// Escort vehicles driving alongside the convoy (Keith 2026-10-24: they make it feel alive, and later help defend it
// when the player drags enemies home). Pure sim on the war band's car sim (src/vehicles/car.ts), no rendering.
//
// Each escort holds a station: a side of the train, a distance along it (spread over the train's length) and a
// distance out from the route (escortOut, each its own share of escortSpread in or out, weaving escortWeave either way
// on its own period around escortWeavePeriod). The plough cuts a road only as wide as the train (Keith 2026-10-26:
// "it's actually really nice having those vehicles kind of meander over rougher terrain"), so the stations lie out on
// the dunes past the berms and the escorts ride over them. Most ride the sides; with enough of them (Keith
// 2026-10-25: more trucks), two scout ahead of the plough's blade, out to the sides, and two trail behind the tail. It steers for a point a little ahead of its station on the route and matches the convoy's speed,
// faster when it has fallen back, each surging ahead and dropping back on its own slow rhythm (escortSurge) so they
// roll at different speeds.
// It keeps clear of the platforms and the plough at the front (a margin round each footprint), of the other escorts, and of the mech (it aims for
// a line grazing a clearance round it, and from inside turns out to the side its nose points, as the war band does),
// and drives round dune faces too steep to climb.
// TODO(defend): `mode` is the hook for the combat role: "defend" will break station toward threats near the convoy.
// Nothing reads it yet and nobody shoots.
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import { CarSim, carValues, type CarKind } from "../vehicles/car";
import type { Convoy } from "./platform";

/** Something escorts keep clear of: a platform, or the plough (its whole V). */
export interface Obstacle {
  toLocal(x: number, z: number): { x: number; z: number };
  readonly halfW: number;
  readonly spec: { length: number };
  readonly left: { x: number; z: number };
  /** Its own clear distance when it isn't a box (the plough's base and blade). */
  gapAt?(x: number, z: number): number;
}

export const ESCORT_DEFAULTS = {
  escortCount: 12,
  escortOut: 25,
  escortSpread: 5,
  escortBand: 7,
  escortWeave: 6,
  escortWeavePeriod: 26,
  escortCatchUp: 0.35,
  escortSurge: 1.2,
  escortScoutAhead: 26,
  escortScoutLead: 30,
  escortScoutOut: 24,
  escortTopSpeed: 12,
  escortPlatformClear: 4,
  escortMechClear: 10,
  escortSteep: 26,
};
export type EscortValues = typeof ESCORT_DEFAULTS;

export const ESCORT_PARAMS: Param[] = [
  { key: "escortCount", label: "Escorts", min: 0, max: 16, step: 1, group: "Escorts", tip: "Vehicles driving alongside the convoy, alternating sides; from 8, two scout ahead, from 10 two trail behind" },
  { key: "escortScoutLead", label: "Scouts ahead of the blade (m)", min: 0, max: 80, step: 1, group: "Escorts", tip: "How far ahead of the plough's blade the two scouts drive, out to the sides on the untouched dunes" },
  { key: "escortScoutAhead", label: "Trailers behind (m)", min: 10, max: 60, step: 1, group: "Escorts", tip: "How far behind the last car's tail the trailers drive" },
  { key: "escortScoutOut", label: "Scouts out (m)", min: 4, max: 40, step: 0.5, group: "Escorts", tip: "How far off the route the scouts and trailers drive (at least 8 m past the road's edge: on the dunes)" },
  { key: "escortOut", label: "Station out (m)", min: 12, max: 60, step: 0.5, group: "Escorts", tip: "How far from the route's centre line an escort holds station (the road's edge is routeHalfWidth out, its berms a little past it)" },
  { key: "escortSpread", label: "Station spread (m)", min: 0, max: 15, step: 0.5, group: "Escorts", tip: "Each escort's station line sits its own share of this in or out, so they don't ride in a row" },
  { key: "escortBand", label: "Station band (m)", min: 2, max: 20, step: 0.5, group: "Escorts", tip: "How far either side of its station line it counts as on station (the check)" },
  { key: "escortWeave", label: "Weave (m)", min: 0, max: 12, step: 0.1, group: "Escorts", tip: "Slow drift in and out of the station line" },
  { key: "escortWeavePeriod", label: "Weave period (s)", min: 4, max: 60, step: 0.5, group: "Escorts" },
  { key: "escortCatchUp", label: "Catch-up", min: 0, max: 1.5, step: 0.01, group: "Escort driving", tip: "Extra speed per metre behind (or less per metre ahead of) its station" },
  { key: "escortSurge", label: "Surge (m/s)", min: 0, max: 4, step: 0.05, group: "Escort driving", tip: "Each escort drifts faster and slower than the convoy by up to this, on its own slow rhythm" },
  { key: "escortTopSpeed", label: "Top speed (m/s)", min: 4, max: 20, step: 0.1, group: "Escort driving" },
  { key: "escortPlatformClear", label: "Clear of platforms (m)", min: 1, max: 12, step: 0.1, group: "Escort driving", tip: "Margin kept round every platform's footprint" },
  { key: "escortMechClear", label: "Clear of the mech (m)", min: 4, max: 20, step: 0.5, group: "Escort driving", tip: "Never drives inside this distance of the mech: grazes round it, or turns out" },
  { key: "escortSteep", label: "Avoid slopes over (°)", min: 10, max: 45, step: 0.5, group: "Escort driving", tip: "Steers round dune faces steeper than this" },
];

export type EscortMode = "escort" | "defend";

const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** How far ahead along the route an escort aims (m), plus a second per m/s. */
const LOOK = 10;
/** Kinds in turn: mostly light cars and gun trucks, a few six-wheelers, a war rig and a tank. */
const KINDS: CarKind[] = ["technical", "gunTruck", "sixWheeler", "technical", "gunTruck", "warRig", "technical", "tank", "sixWheeler", "gunTruck", "technical", "gunTruck", "warRig", "technical", "sixWheeler", "tank"];

export class Escort {
  readonly sim: CarSim;
  /** TODO(defend): the combat role's hook; only "escort" is driven. */
  mode: EscortMode = "escort";
  /** Station: side (+1 left of the route), along-route offset from the convoy's head. */
  side: 1 | -1;
  along = 0;
  /** Distance out from the route its station line runs (m). */
  stationOut = 26;
  /** Where along the route the escort is now (its projection), and its distance out from the route line (signed). */
  s = 0;
  out = 0;
  phase: number;
  /** Distance moved in the last step (for dust). */
  moved = 0;
  /** The line it picked over the dunes: an offset from the heading it wants (rad), re-picked every PLAN_EVERY s. */
  planOff = 0;
  planT = 0;
  /** How rough the picked line is (0 easy .. 1 at its climbing limit), for easing off. */
  planCost = 0;
  /** Stuck: seconds without moving while it wants to, and seconds left backing out. */
  stuckT = 0;
  backT = 0;
  backSteer = 0;
  /** Going round something on this side (+1 left) for commitT more seconds. */
  commitSide = 0;
  commitT = 0;
  /** Half its length (m), for keeping clear. */
  readonly half: number;
  /** Its own surge rhythm (phase, and a rate share). */
  readonly surgePhase: number;
  readonly surgeRate: number;
  /** Its own share of the station spread (-1..1) and of the weave period. */
  readonly spread: number;
  readonly weaveRate: number;
  constructor(readonly kind: CarKind, readonly index: number, ground: DuneField) {
    const cv = carValues(kind);
    this.sim = new CarSim(cv, ground);
    this.half = cv.wheelbase / 2 + 1.2;
    this.side = index % 2 === 0 ? 1 : -1;
    this.phase = index * 1.9;
    this.surgePhase = index * 2.7 + 0.5;
    this.surgeRate = 0.6 + ((index * 0.37) % 1) * 0.8;
    this.spread = ((index * 0.618) % 1) * 2 - 1;
    this.weaveRate = 0.7 + ((index * 0.43 + 0.2) % 1) * 0.6;
    this.planT = (index % 12) / 60;
  }
}

export class EscortGroup {
  readonly list: Escort[] = [];
  private t = 0;
  private pt = { x: 0, z: 0, heading: 0 };

  constructor(readonly v: EscortValues, readonly convoy: Convoy, readonly field: DuneField) {}

  /** Make or drop escorts to match the slider; returns true if the list changed. */
  sync(): boolean {
    const n = Math.round(this.v.escortCount);
    if (n === this.list.length) return false;
    while (this.list.length > n) this.list.pop();
    while (this.list.length < n) {
      const e = new Escort(KINDS[this.list.length % KINDS.length], this.list.length, this.field);
      this.list.push(e);
      this.stations();
      this.place(e);
    }
    this.stations();
    return true;
  }

  /**
   * Spread the stations: pairs either side from beside the lead back toward the tail; with 8 or more the last two
   * scout ahead of the lead, with 10 or more two more trail the tail (one each side, closer in).
   */
  private stations() {
    const v = this.v, n = this.list.length, L = this.convoy.length, head = this.convoy.platforms[0].spec.length / 2;
    // Scouts ahead of the plough's blade, a side each, out past where the blade reaches (on the untouched dunes).
    const r = this.convoy.route, lead = r.blade - r.s + v.escortScoutLead;
    const scoutOut = Math.max(v.escortScoutOut, r.v.routeHalfWidth + 8);
    const scouts = n >= 8 ? 2 : 0, trail = n >= 10 ? 2 : 0, sides = n - scouts - trail;
    const pairs = Math.ceil(sides / 2);
    this.list.forEach((e, i) => {
      if (i < sides) {
        const k = Math.floor(i / 2);
        e.along = head - 6 - (pairs > 1 ? (k * (L - 20)) / (pairs - 1) : L * 0.3) - (i % 2) * 8;
        e.stationOut = v.escortOut + e.spread * v.escortSpread;
      } else if (i < sides + scouts) {
        e.along = lead;
        e.stationOut = scoutOut;
      } else {
        e.along = head - L - v.escortScoutAhead - (i - sides - scouts) * 9;
        e.stationOut = scoutOut;
      }
    });
  }

  /** Put every escort on its station, at the convoy's speed. */
  reset() { this.sync(); this.stations(); for (const e of this.list) this.place(e); }

  private place(e: Escort) {
    const r = this.convoy.route;
    // On the dunes: the gentlest spot near its station (not wedged on a slip face).
    let bx = 0, bz = 0, bh = 0, best = Infinity;
    for (let da = -12; da <= 12; da += 3) for (let dout = -6; dout <= 6; dout += 2) {
      const p = r.offsetAt(r.s + e.along + da, e.side * (e.stationOut + dout), this.pt);
      const sc = this.steepAt(p.x, p.z, e.half) + (Math.abs(da) + Math.abs(dout)) * 0.004;
      if (sc < best) { best = sc; bx = p.x; bz = p.z; bh = p.heading; }
    }
    e.sim.reset(bx, bz, bh);
    e.sim.speed = this.convoy.route.v.convoySpeed;
    e.s = r.s + e.along;
  }

  /** One fixed step. mech: the player's mech position (or null when it's aboard or held). */
  update(dt: number, mech: { x: number; z: number } | null) {
    this.t += dt;
    this.sync();
    this.stations();
    for (const e of this.list) this.drive(e, dt, mech);
  }

  /** Where the escort is along the route and how far out from it: search near its last projection. */
  private project(e: Escort) {
    const r = this.convoy.route, x = e.sim.pos.x, z = e.sim.pos.z;
    let best = Infinity, bs = e.s;
    for (let d = -12; d <= 12; d += 1.5) {
      const p = r.pointAt(e.s + d, this.pt), dd = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (dd < best) { best = dd; bs = e.s + d; }
    }
    // Refine.
    for (let d = -1.5; d <= 1.5; d += 0.25) {
      const p = r.pointAt(bs + d, this.pt), dd = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (dd < best) { best = dd; bs = bs + d; }
    }
    e.s = bs;
    const p = r.pointAt(bs, this.pt);
    // Signed: + left of the route.
    e.out = (x - p.x) * Math.cos(p.heading) - (z - p.z) * Math.sin(p.heading);
  }

  private drive(e: Escort, dt: number, mech: { x: number; z: number } | null) {
    const v = this.v, s = e.sim, r = this.convoy.route;
    const top = Math.min(v.escortTopSpeed, carValues(e.kind).topSpeed);
    s.v.topSpeed = top;
    this.project(e);
    const weave = v.escortWeave * Math.sin((2 * Math.PI * this.t * e.weaveRate) / Math.max(1, v.escortWeavePeriod) + e.phase);
    const station = r.s + e.along;
    const behind = station - e.s;
    const cv = this.convoy.route.v.convoySpeed;
    const surge = v.escortSurge * Math.sin((2 * Math.PI * this.t * e.surgeRate) / 40 + e.surgePhase);
    let want = clamp(cv + surge + behind * v.escortCatchUp, 0, top);
    const look = LOOK + Math.abs(s.speed);
    const tgt = r.offsetAt(e.s + look, e.side * (e.stationOut + weave), this.pt);
    let tx = tgt.x, tz = tgt.z;

    // Keep clear of the platforms and the other escorts: push the aim point away.
    let ax = 0, az = 0;
    for (const p of this.obstacles()) {
      const d = rectGap(p, s.pos.x, s.pos.z, e.half * 0.6);
      const m = v.escortPlatformClear + 3;
      if (d < m) {
        // Away from the platform, outward from the train (its side of the route).
        const l = p.toLocal(s.pos.x, s.pos.z);
        const k = (m - d) / m;
        if (p === this.convoy.plough && this.convoy.plough.ahead(s.pos.x, s.pos.z)) {
          // Ahead of the plough (a scout it's catching): get out in front of the blade, never slow down for it.
          const f = this.convoy.plough.fwd;
          ax += f.x * k * 14; az += f.z * k * 14;
          want = Math.max(want, Math.min(top, cv * 1.3 + 2));
          continue;
        }
        const sx = Math.sign(l.x) || e.side;
        ax += (p.left.x * sx) * k * 14; az += (p.left.z * sx) * k * 14;
        if (d < v.escortPlatformClear) want = Math.min(want, cv);
      }
    }
    for (const o of this.list) {
      if (o === e) continue;
      const ox = s.pos.x - o.sim.pos.x, oz = s.pos.z - o.sim.pos.z, d2 = ox * ox + oz * oz;
      if (d2 < 100 && d2 > 1e-4) { const d = Math.sqrt(d2); ax += (ox / d) * (10 - d); az += (oz / d) * (10 - d); }
    }
    tx += ax; tz += az;
    let desired = Math.atan2(tx - s.pos.x, tz - s.pos.z);
    e.planT -= dt;
    e.commitT -= dt;
    if (e.planT <= 0) { e.planT = PLAN_EVERY; this.plan(e, desired); }
    desired += e.planOff;
    // Ease off over rough ground (the picked line, or the ground under it now, near its climbing limit): crawl
    // across a steep face rather than flying over it.
    const soft = v.escortSteep * D2R, now = clamp((this.steepAt(s.pos.x, s.pos.z, e.half * 0.7) - soft * 0.7) / (soft * 0.6), 0, 1);
    const rough = Math.max(e.planCost, now);
    want = Math.min(want * (1 - 0.3 * rough), top - (top - Math.min(top, cv + 1.5)) * rough);

    // Never into the mech: graze round its clearance from out there; from inside, out along the side the nose points.
    if (mech) {
      const dx = s.pos.x - mech.x, dz = s.pos.z - mech.z, dist = Math.hypot(dx, dz) || 1, clear = v.escortMechClear;
      const toMech = Math.atan2(-dx, -dz);
      if (dist >= clear && dist < clear + 25) {
        const graze = Math.asin(Math.min(1, clear / dist));
        const off = wrap(desired - toMech);
        if (Math.abs(off) < graze) desired = toMech + (off >= 0 ? 1 : -1) * graze;
      }
      if (dist < clear) {
        const sd = wrap(s.heading - toMech) >= 0 ? 1 : -1;
        const t = Math.max(0, (dist - 2) / (clear - 2));
        desired = toMech + sd * (Math.PI / 2 + (1 - t) * 0.7);
        want = Math.max(cv * 0.5, Math.min(want, top * (0.45 + 0.35 * t)));
      }
    }

    // Hard rule last (over the mech's): never into a platform or the plough; inside the clearance, turn away.
    for (const p of this.obstacles()) {
      const d = rectGap(p, s.pos.x, s.pos.z, e.half * 0.6);
      if (d >= v.escortPlatformClear || (p === this.convoy.plough && this.convoy.plough.ahead(s.pos.x, s.pos.z))) continue;
      const l = p.toLocal(s.pos.x, s.pos.z), sx = Math.sign(l.x) || e.side;
      const away = Math.atan2(p.left.x * sx, p.left.z * sx), fwd = Math.atan2(-p.left.z, p.left.x);
      // Out to the side, still rolling forward with the train.
      const outHd = fwd + wrap(away - fwd) * 0.6;
      const k = 1 - Math.max(0, d) / v.escortPlatformClear;
      desired = desired + wrap(outHd - desired) * Math.min(1, 0.4 + k);
    }
    const err = wrap(desired - s.heading);
    let steer = clamp(err * 1.8, -1, 1);
    want *= 1 - 0.45 * Math.min(1, Math.abs(err) / 1.2);
    let throttle = clamp((want - s.speed) * 0.5, -1, 1);
    // Stuck (nosed into a face it can't climb, or wedged): back out with the wheel the other way, then try again.
    if (e.backT > 0) {
      e.backT -= dt;
      throttle = -0.8; steer = e.backSteer;
    } else if (want > 1 && Math.abs(s.speed) < 0.6) {
      e.stuckT += dt;
      if (e.stuckT > STUCK_AFTER) {
        e.stuckT = 0; e.backT = BACK_FOR; e.backSteer = -Math.sign(err || e.side); e.planT = 0;
        // Then go round on the other side from the one that got it stuck.
        e.commitSide = -Math.sign(e.planOff || err || 1); e.commitT = COMMIT_FOR;
      }
    } else e.stuckT = Math.max(0, e.stuckT - dt);
    const bx = s.pos.x, bz = s.pos.z;
    s.update(dt, throttle, steer);
    e.moved = Math.hypot(s.pos.x - bx, s.pos.z - bz);
  }

  private obs: Obstacle[] = [];
  /** The platforms and the plough. */
  obstacles(): Obstacle[] {
    const o = this.obs;
    o.length = 0;
    for (const p of this.convoy.platforms) o.push(p);
    o.push(this.convoy.plough);
    return o;
  }

  /** Steepest ground (rad) under a vehicle of half-length r at (x, z): its middle and four points round it. */
  private steepAt(x: number, z: number, r: number) {
    let worst = 0;
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) worst = Math.max(worst, this.slopeAt(x + ox, z + oz));
    return worst;
  }

  private slopeAt(x: number, z: number) {
    const g = this.field, h0 = g.height(x, z);
    return Math.atan(Math.hypot(g.height(x + 1.2, z) - h0, g.height(x, z + 1.2) - h0) / 1.2);
  }

  /**
   * Pick a line over the dunes: fan out headings either side of the one it wants and score a short drive along each
   * by how steep the ground is under it (any way: climbs, descents and side slopes alike, so it neither bogs, noses
   * down a slip face nor rolls across one), how far it strays from the heading it wants and from its last pick, and
   * whether it runs onto the road (allowed, but the dunes are preferred) or near a platform (never).
   */
  private plan(e: Escort, desired: number) {
    const v = this.v, s = e.sim, cv = carValues(e.kind);
    const soft = v.escortSteep * D2R, hard = Math.max(soft + 4 * D2R, Math.min(cv.maxClimb - 4, v.escortSteep + 10) * D2R);
    const reach = clamp(12 + Math.abs(s.speed) * 2.5, 16, 30), r = this.convoy.route;
    let best = Infinity, bestOff = 0, bestRough = 0;
    for (let k = 0; k < PLAN_FAN.length; k++) {
      const off = PLAN_FAN[k], h = desired + off, sx = Math.sin(h), cz = Math.cos(h);
      let cost = Math.abs(off) * 1.2 + Math.abs(off - e.planOff) * 0.4, rough = 0;
      // Going round something: keep going round it on the side picked (no dithering at a long face).
      if (e.commitT > 0 && off * e.commitSide < 0) cost += 2;
      for (let j = 1; j <= PLAN_STEPS; j++) {
        const d = (reach * j) / PLAN_STEPS, x = s.pos.x + sx * d, z = s.pos.z + cz * d;
        const near = j <= 2 ? 1.5 : 1;
        const a = this.slopeAt(x, z);
        if (a > soft) {
          const q = Math.min(1, (a - soft) / (hard - soft));
          rough = Math.max(rough, q);
          cost += near * (a < hard ? q * q * 3 : 6 + (a - hard) * 20);
        }
        // The road and its cut edge: fine to cross, but the dunes beside it are where escorts ride.
        if (r.corridor(x, z) > 0.5) cost += 0.6;
        for (const p of this.convoy.platforms) if (rectGap(p, x, z, e.half * 0.6) < v.escortPlatformClear + 3) cost += 8 * near;
        if (rectGap(this.convoy.plough, x, z, e.half * 0.6) < v.escortPlatformClear) cost += 8 * near;
      }
      if (cost < best) { best = cost; bestOff = off; bestRough = rough; }
    }
    // A big turn off its heading to get round something: commit to that side for a while.
    if (Math.abs(bestOff) >= 0.6 && e.commitT <= 0) { e.commitSide = Math.sign(bestOff); e.commitT = COMMIT_FOR; }
    e.planOff = bestOff;
    e.planCost = bestRough;
  }
}

/** Headings tried either side of the one wanted (rad), and the points scored along each line. */
const PLAN_FAN = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.85, -0.85, 1.1, -1.1, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1];
const PLAN_STEPS = 6;
/** Seconds it keeps going round on the side it picked. */
const COMMIT_FOR = 4;
/** Seconds between picks (staggered across the escorts). */
const PLAN_EVERY = 0.2;
/** Stuck after this long not moving while it wants to; then backs out for BACK_FOR. */
const STUCK_AFTER = 1.5, BACK_FOR = 1.6;

/** Distance from (x, z) to a platform's (or the plough's) footprint (0 inside), less r. */
export function rectGap(p: Obstacle, x: number, z: number, r = 0) {
  if (p.gapAt) return p.gapAt(x, z) - r;
  const l = p.toLocal(x, z);
  const dx = Math.max(0, Math.abs(l.x) - p.halfW), dz = Math.max(0, Math.abs(l.z) - p.spec.length / 2);
  return Math.hypot(dx, dz) - r;
}
