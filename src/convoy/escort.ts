// Escort vehicles driving alongside the convoy (Keith 2026-10-24: they make it feel alive, and later help defend it
// when the player drags enemies home). Pure sim on the war band's car sim (src/vehicles/car.ts), no rendering.
//
// Each escort holds a station: a side of the train, a distance along it (spread over the train's length) and a
// distance out from the route (escortOut, weaving escortWeave either way over escortWeavePeriod). Most ride the
// sides; with enough of them (Keith 2026-10-25: more trucks), two scout ahead of the lead and two trail behind the
// tail, closer in. It steers for a point a little ahead of its station on the route and matches the convoy's speed,
// faster when it has fallen back, each surging ahead and dropping back on its own slow rhythm (escortSurge) so they
// roll at different speeds.
// It keeps clear of the platforms (a margin round each footprint), of the other escorts, and of the mech (it aims for
// a line grazing a clearance round it, and from inside turns out to the side its nose points, as the war band does),
// and drives round dune faces too steep to climb.
// TODO(defend): `mode` is the hook for the combat role: "defend" will break station toward threats near the convoy.
// Nothing reads it yet and nobody shoots.
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import { CarSim, carValues, type CarKind } from "../vehicles/car";
import type { Convoy, Platform } from "./platform";

export const ESCORT_DEFAULTS = {
  escortCount: 12,
  escortOut: 26,
  escortBand: 7,
  escortWeave: 4,
  escortWeavePeriod: 22,
  escortCatchUp: 0.35,
  escortSurge: 1.2,
  escortScoutAhead: 26,
  escortScoutOut: 13,
  escortTopSpeed: 12,
  escortPlatformClear: 4,
  escortMechClear: 10,
  escortSteep: 26,
};
export type EscortValues = typeof ESCORT_DEFAULTS;

export const ESCORT_PARAMS: Param[] = [
  { key: "escortCount", label: "Escorts", min: 0, max: 16, step: 1, group: "Escorts", tip: "Vehicles driving alongside the convoy, alternating sides; from 8, two scout ahead, from 10 two trail behind" },
  { key: "escortScoutAhead", label: "Scouts ahead / behind (m)", min: 10, max: 60, step: 1, group: "Escorts", tip: "How far ahead of the lead's nose (and behind the last car's tail) the scouts and trailers drive" },
  { key: "escortScoutOut", label: "Scouts out (m)", min: 4, max: 30, step: 0.5, group: "Escorts", tip: "How far off the route the scouts and trailers drive" },
  { key: "escortOut", label: "Station out (m)", min: 12, max: 60, step: 0.5, group: "Escorts", tip: "How far from the route's centre line an escort holds station" },
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
  /** Half its length (m), for keeping clear. */
  readonly half: number;
  /** Its own surge rhythm (phase, and a rate share). */
  readonly surgePhase: number;
  readonly surgeRate: number;
  constructor(readonly kind: CarKind, readonly index: number, ground: DuneField) {
    const cv = carValues(kind);
    this.sim = new CarSim(cv, ground);
    this.half = cv.wheelbase / 2 + 1.2;
    this.side = index % 2 === 0 ? 1 : -1;
    this.phase = index * 1.9;
    this.surgePhase = index * 2.7 + 0.5;
    this.surgeRate = 0.6 + ((index * 0.37) % 1) * 0.8;
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
    const scouts = n >= 8 ? 2 : 0, trail = n >= 10 ? 2 : 0, sides = n - scouts - trail;
    const pairs = Math.ceil(sides / 2);
    this.list.forEach((e, i) => {
      if (i < sides) {
        const k = Math.floor(i / 2);
        e.along = head - 6 - (pairs > 1 ? (k * (L - 20)) / (pairs - 1) : L * 0.3) - (i % 2) * 8;
        e.stationOut = v.escortOut;
      } else if (i < sides + scouts) {
        e.along = head + v.escortScoutAhead + (i - sides) * 9;
        e.stationOut = v.escortScoutOut;
      } else {
        e.along = head - L - v.escortScoutAhead - (i - sides - scouts) * 9;
        e.stationOut = v.escortScoutOut;
      }
    });
  }

  /** Put every escort on its station, at the convoy's speed. */
  reset() { this.sync(); this.stations(); for (const e of this.list) this.place(e); }

  private place(e: Escort) {
    const r = this.convoy.route;
    const p = r.offsetAt(r.s + e.along, e.side * e.stationOut, this.pt);
    e.sim.reset(p.x, p.z, p.heading);
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
    const weave = v.escortWeave * Math.sin((2 * Math.PI * this.t) / Math.max(1, v.escortWeavePeriod) + e.phase);
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
    for (const p of this.convoy.platforms) {
      const d = rectGap(p, s.pos.x, s.pos.z, e.half * 0.6);
      const m = v.escortPlatformClear + 3;
      if (d < m) {
        // Away from the platform, outward from the train (its side of the route).
        const l = p.toLocal(s.pos.x, s.pos.z);
        const sx = Math.sign(l.x) || e.side;
        const k = (m - d) / m;
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
    desired = this.aroundSteep(s.pos.x, s.pos.z, desired);

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

    const err = wrap(desired - s.heading);
    const steer = clamp(err * 1.8, -1, 1);
    want *= 1 - 0.45 * Math.min(1, Math.abs(err) / 1.2);
    const throttle = clamp((want - s.speed) * 0.5, -1, 1);
    const bx = s.pos.x, bz = s.pos.z;
    s.update(dt, throttle, steer);
    e.moved = Math.hypot(s.pos.x - bx, s.pos.z - bz);
  }

  /** If the way ahead climbs a face steeper than escortSteep, take the nearest heading either side that doesn't. */
  private aroundSteep(x: number, z: number, heading: number) {
    const g = this.field, look = 7, limit = Math.tan(this.v.escortSteep * D2R);
    const climb = (h: number) => (g.height(x + Math.sin(h) * look, z + Math.cos(h) * look) - g.height(x, z)) / look;
    if (climb(heading) < limit) return heading;
    for (const off of [0.35, 0.7, 1.05, 1.4, 1.75]) {
      for (const sgn of [1, -1]) if (climb(heading + sgn * off) < limit) return heading + sgn * off;
    }
    return heading;
  }
}

/** Distance from (x, z) to a platform's footprint (0 inside), less r. */
export function rectGap(p: Platform, x: number, z: number, r = 0) {
  const l = p.toLocal(x, z);
  const dx = Math.max(0, Math.abs(l.x) - p.halfW), dz = Math.max(0, Math.abs(l.z) - p.spec.length / 2);
  return Math.hypot(dx, dz) - r;
}
