// The convoy's plough (Keith 2026-10-26): a giant tracked bulldozer at the very front with a wide V blade, cutting the
// road the convoy rolls on (route.ts) and throwing the sand aside into berms (wake.ts). Pure sim, no rendering
// (ploughBody.ts draws it, ploughFx.ts throws its sand). Host-owned like the convoy: its place is a pure function of
// the convoy clock (route.s), so every peer has it in the same spot.
//
// Frame: local x = left, y = up, z = forward, origin on the ground under the middle of its tracked base. The blade's
// middle (its V point) sits at route.blade; the base's front is BLADE_AHEAD behind it, its tail PLOUGH_REACH behind.
// The base rides the flat road behind the blade: the ground under its track corners fits a plane, as the platforms do.
import type { DuneField } from "../world/terrain";
import { PLOUGH_REACH, type ConvoyRoute, type RoutePoint } from "./route";
import { sweepTan, roadHalf } from "./wake";

/** The base: tracked hull length and half-width (m); the blade's V point is BLADE_AHEAD ahead of the base's front. */
export const PLOUGH_BASE_LENGTH = 17;
export const PLOUGH_BASE_HALF = 7.5;
export const BLADE_AHEAD = PLOUGH_REACH - PLOUGH_BASE_LENGTH;
/** Blade face height (m). */
export const BLADE_HEIGHT = 4.2;

export class Plough {
  /** Ground-plane origin under the middle of the base. */
  x = 0; y = 0; z = 0;
  heading = 0;
  vel = { x: 0, y: 0, z: 0 };
  left = { x: 1, y: 0, z: 0 };
  up = { x: 0, y: 1, z: 0 };
  fwd = { x: 0, y: 0, z: 1 };
  travelled = 0;
  /** Distance of the blade's middle along the route. */
  bladeS = 0;
  /** Sand being moved now off each side (m³/s, left and right; smoothed), and the cut at the blade (m², both sides). */
  rate = { left: 0, right: 0 };
  cut = 0;
  /** Blade half-width and how far its tips trail its middle (m), as the route has them. */
  halfBlade = 30;
  tipLag = 0;
  /** As an obstacle (escorts keep clear): the base's half-width and the length to the blade (gapAt has the shape). */
  get halfW() { return PLOUGH_BASE_HALF; }
  readonly spec = { length: PLOUGH_REACH };
  private pf: RoutePoint = { x: 0, z: 0, heading: 0 };
  private pb: RoutePoint = { x: 0, z: 0, heading: 0 };
  private started = false;

  constructor(readonly route: ConvoyRoute, private field: DuneField) {}

  reset() { this.started = false; this.travelled = 0; this.vel = { x: 0, y: 0, z: 0 }; this.rate = { left: 0, right: 0 }; }

  update(dt: number) {
    const r = this.route;
    this.bladeS = r.blade;
    this.halfBlade = roadHalf(r.v);
    this.tipLag = this.halfBlade * sweepTan(r.v);
    // The base's middle and its heading along the chord of its length (as a platform rides its bogies).
    const mid = this.bladeS - BLADE_AHEAD - PLOUGH_BASE_LENGTH / 2, bg = PLOUGH_BASE_LENGTH * 0.4;
    const f = r.pointAt(mid + bg, this.pf), b = r.pointAt(mid - bg, this.pb);
    const px = this.x, py = this.y, pz = this.z;
    this.x = (f.x + b.x) / 2; this.z = (f.z + b.z) / 2;
    this.heading = Math.atan2(f.x - b.x, f.z - b.z);
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    // Plane through the ground under the four track ends.
    const lx = PLOUGH_BASE_HALF - 1.5, lz = PLOUGH_BASE_LENGTH * 0.42;
    const g = (ax: number, az: number) => this.field.height(this.x + c * ax + s * az, this.z - s * ax + c * az);
    const fl = g(lx, lz), fr = g(-lx, lz), bl = g(lx, -lz), br = g(-lx, -lz);
    const y = (fl + fr + bl + br) / 4, pitch = (fl + fr - bl - br) / (4 * lz), roll = (fl + bl - fr - br) / (4 * lx);
    // A heavy machine: eased toward the ground plane rather than snapped.
    const k = this.started ? Math.min(1, dt * 4) : 1;
    this.y += (y - this.y) * k;
    const fw = norm(s, pitch, c), l0 = norm(c, roll, -s);
    const u = norm(fw.y * l0.z - fw.z * l0.y, fw.z * l0.x - fw.x * l0.z, fw.x * l0.y - fw.y * l0.x);
    const l = norm(u.y * fw.z - u.z * fw.y, u.z * fw.x - u.x * fw.z, u.x * fw.y - u.y * fw.x);
    this.fwd = fw; this.up = u; this.left = l;
    if (this.started && dt > 0) {
      this.vel.x = (this.x - px) / dt; this.vel.y = (this.y - py) / dt; this.vel.z = (this.z - pz) / dt;
      this.travelled += Math.hypot(this.x - px, this.z - pz);
    }
    // Material moved now: the cut each side at the blade's mid-wing, times the speed. Smoothed (a load builds up and
    // spills over a second or so).
    const [L, R] = r.wake.netAt(this.bladeS - this.tipLag * 0.5);
    const sp = r.v.convoySpeed, e = this.started ? Math.min(1, dt * 1.5) : 1;
    this.rate.left += (Math.max(0, L) * sp - this.rate.left) * e;
    this.rate.right += (Math.max(0, R) * sp - this.rate.right) * e;
    this.cut = r.wake.cutAt(this.bladeS);
    this.started = true;
  }

  /** Horizontal speed (m/s). */
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  toWorld(lx: number, ly: number, lz: number, out = { x: 0, y: 0, z: 0 }) {
    const { left: l, up: u, fwd: f } = this;
    out.x = this.x + l.x * lx + u.x * ly + f.x * lz;
    out.y = this.y + l.y * lx + u.y * ly + f.y * lz;
    out.z = this.z + l.z * lx + u.z * ly + f.z * lz;
    return out;
  }

  /** World x/z to local (left, forward) on the ground plane, relative to the base's middle. */
  toLocal(x: number, z: number, out = { x: 0, z: 0 }) {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const dx = x - this.x, dz = z - this.z;
    out.x = dx * c - dz * s;
    out.z = dx * s + dz * c;
    return out;
  }

  private lc = { x: 0, z: 0 };
  /** Clear distance from (x, z) to the plough: its base, or the blade's wings (thin walls along the V). */
  gapAt(x: number, z: number) {
    const l = this.toLocal(x, z, this.lc), ax = Math.abs(l.x);
    const base = Math.hypot(Math.max(0, ax - PLOUGH_BASE_HALF), Math.max(0, Math.abs(l.z) - PLOUGH_BASE_LENGTH / 2));
    // The wing on this side: from the point (0, tip) to (hw, tip - hw tan).
    const tip = PLOUGH_BASE_LENGTH / 2 + BLADE_AHEAD, hw = this.halfBlade, tz = hw * sweepTan(this.route.v);
    const ex = hw, ez = -tz, px = ax, pz = l.z - tip;
    const t = Math.max(0, Math.min(1, (px * ex + pz * ez) / (ex * ex + ez * ez)));
    const wing = Math.max(0, Math.hypot(px - ex * t, pz - ez * t) - 0.5);
    return Math.min(base, wing);
  }

  /** Is (x, z) out in front of the blade (where only a scout running ahead could be)? */
  ahead(x: number, z: number) {
    const l = this.toLocal(x, z, this.lc), tip = PLOUGH_BASE_LENGTH / 2 + BLADE_AHEAD;
    return l.z > tip - Math.min(Math.abs(l.x), this.halfBlade) * sweepTan(this.route.v);
  }

  /** Keep a body of radius r out of the base and the blade: returns the pushed x/z, or null when clear. */
  pushOut(x: number, z: number, r: number): { x: number; z: number } | null {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const dx = x - this.x, dz = z - this.z;
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    // The base: a box.
    const hx = PLOUGH_BASE_HALF + r, hz = PLOUGH_BASE_LENGTH / 2 + r;
    let moved = false;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
      const ex = hx - Math.abs(lx), ez = hz - Math.abs(lz);
      if (ex < ez) lx = Math.sign(lx || 1) * hx; else lz = Math.sign(lz || 1) * hz;
      moved = true;
    }
    // The blade: a thin wall along the V (pushed out ahead of it or behind it).
    const tip = PLOUGH_BASE_LENGTH / 2 + BLADE_AHEAD, tan = sweepTan(this.route.v);
    if (Math.abs(lx) < this.halfBlade) {
      const bz = tip - Math.abs(lx) * tan, gap = lz - bz, th = 0.6 + r;
      if (Math.abs(gap) < th) { lz = bz + Math.sign(gap || 1) * th; moved = true; }
    }
    if (!moved) return null;
    return { x: this.x + c * lx + s * lz, z: this.z - s * lx + c * lz };
  }
}

function norm(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
