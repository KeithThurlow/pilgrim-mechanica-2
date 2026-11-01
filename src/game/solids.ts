// Solid bodies (Keith 2026-11-01: "I can just walk straight through this mech. We need collisions for mechs and for
// vehicles", with a sizable pillbox for mechs so placement matters in a sword fight). Pure: no drawing.
// Every mech and vehicle is a flat stadium on the ground (a segment along its heading, swept by a radius; a mech's
// segment is a point, so a circle) with a height range. Each body resolves itself right after it steps: out of every
// other live body it overlaps, the overlap shared by mass (vehicles) or by who walked into whom (mech against mech,
// `mechShove` of it by mass), and the motion into the other taken off, as a wall takes it.
// Nothing registers by hand: a body joins on its first resolve, and one that hasn't stepped for STALE seconds (parked,
// hanging from the crane, removed) is passed over, then dropped.
// Ownership: host (positions of everything it pushes); deterministic, no randomness.
import type { Param } from "../core/tweaks";

export interface SolidShape {
  /** Centre on the ground, and the segment's half vector (along the heading × half length; 0 for a mech). */
  x: number; z: number; hx: number; hz: number;
  /** Radius round the segment (m). */
  r: number;
  /** Bottom and top (m, world y): bodies apart in height (a mech on a deck over one on the sand) pass. */
  y0: number; y1: number;
  /** Tonnes; Infinity for a body nothing moves. */
  mass: number;
  /** Mechs share overlaps by who walked in (`mechShove`); everything else by mass. */
  mech: boolean;
}

export interface Solid {
  /** Its footprint now into `out`; false when it isn't solid (dead). */
  solidShape(out: SolidShape): boolean;
  /** Pushed by (dx, dz); (nx, nz) the outward unit from the other: motion into the other is taken off. */
  solidShove(dx: number, dz: number, nx: number, nz: number): void;
}

export interface SolidValues {
  solidsOn: number;
  bodyRadius: number;
  mechShove: number;
}

export const SOLID_DEFAULTS: SolidValues = {
  solidsOn: 1,
  bodyRadius: 2.4,
  mechShove: 0.3,
};

const G = "Body collisions";
export const SOLID_PARAMS: Param[] = [
  { key: "solidsOn", label: "Mechs and vehicles are solid", min: 0, max: 1, step: 1, group: G, tip: "0: everything walks and drives through each other, as before" },
  { key: "bodyRadius", label: "Mech body radius (m, × legs)", min: 1, max: 5, step: 0.05, group: G, tip: "The pillbox other mechs and vehicles can't enter, from the mech's centre; the legs' Trample stat scales it. Two Ramparts stand at least twice this apart" },
  { key: "mechShove", label: "Mech shoves mech", min: 0, max: 1, step: 0.05, group: G, tip: "Walking into another mech: 0 it stands like a wall, 1 you push it as hard as it pushes you (half each)" },
];

/** Seconds without a step before a body is passed over (parked, carried, gone); dropped after DROP. */
const STALE = 0.3;
const DROP = 5;

interface Entry { s: Solid; at: number; lx: number; lz: number; vx: number; vz: number }

const shapeA = (): SolidShape => ({ x: 0, z: 0, hx: 0, hz: 0, r: 0, y0: 0, y1: 0, mass: 1, mech: false });

/** Closest points between two flat segments (centres ± half vectors): A's and B's into `out` [ax, az, bx, bz]. */
export function closestPoints(a: SolidShape, b: SolidShape, out: number[]): number[] {
  // Segment A: P0 + s·d1, s ∈ [0,1]; B: Q0 + t·d2.
  const p0x = a.x - a.hx, p0z = a.z - a.hz, d1x = 2 * a.hx, d1z = 2 * a.hz;
  const q0x = b.x - b.hx, q0z = b.z - b.hz, d2x = 2 * b.hx, d2z = 2 * b.hz;
  const rx = p0x - q0x, rz = p0z - q0z;
  const A = d1x * d1x + d1z * d1z, E = d2x * d2x + d2z * d2z, F = d2x * rx + d2z * rz;
  let s = 0, t = 0;
  if (A < 1e-9 && E < 1e-9) { s = 0; t = 0; }
  else if (A < 1e-9) { t = clamp01(F / E); }
  else {
    const C = d1x * rx + d1z * rz;
    if (E < 1e-9) { s = clamp01(-C / A); }
    else {
      const B = d1x * d2x + d1z * d2z, den = A * E - B * B;
      s = den > 1e-9 ? clamp01((B * F - C * E) / den) : 0;
      t = (B * s + F) / E;
      if (t < 0) { t = 0; s = clamp01(-C / A); } else if (t > 1) { t = 1; s = clamp01((B - C) / A); }
    }
  }
  out[0] = p0x + d1x * s; out[1] = p0z + d1z * s; out[2] = q0x + d2x * t; out[3] = q0z + d2z * t;
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * How two shapes overlap: depth (m, > 0 when they do) and the unit from B to A (nx, nz) to push A out along.
 * Exactly on top of each other: out from B's centre to A's, else +X.
 */
export function overlap(a: SolidShape, b: SolidShape, res: { depth: number; nx: number; nz: number }, pts: number[] = [0, 0, 0, 0]) {
  res.depth = 0;
  if (a.y1 <= b.y0 || b.y1 <= a.y0) return res;
  closestPoints(a, b, pts);
  let dx = pts[0] - pts[2], dz = pts[1] - pts[3], d = Math.hypot(dx, dz);
  const R = a.r + b.r;
  if (d >= R) return res;
  if (d < 1e-6) { dx = a.x - b.x; dz = a.z - b.z; d = Math.hypot(dx, dz); if (d < 1e-6) { dx = 1; dz = 0; d = 1; } res.depth = R; }
  else res.depth = R - d;
  res.nx = dx / d; res.nz = dz / d;
  return res;
}

/**
 * A's share of the push out (0..1). Mechs: by who closed in (A's speed into B over both), `shove` of it by mass;
 * anything else by mass alone. (va, vb: velocities; n from B to A.)
 */
export function shareOf(a: SolidShape, b: SolidShape, vax: number, vaz: number, vbx: number, vbz: number, nx: number, nz: number, shove: number): number {
  const byMass = a.mass === Infinity ? (b.mass === Infinity ? 0.5 : 0) : b.mass === Infinity ? 1 : b.mass / Math.max(1e-6, a.mass + b.mass);
  if (!(a.mech && b.mech)) return byMass;
  const inA = Math.max(0, -(vax * nx + vaz * nz)), inB = Math.max(0, vbx * nx + vbz * nz);
  const byMotion = inA + inB > 0.05 ? inA / (inA + inB) : 0.5;
  return byMotion + (byMass - byMotion) * shove;
}

/** The battlefield's solid bodies. */
export class Solids {
  private list: Entry[] = [];
  private byBody = new Map<Solid, Entry>();
  private now = 0;
  /** The values the last mech resolved with (vehicles have no sliders of their own). */
  v: SolidValues = { ...SOLID_DEFAULTS };
  /** Pushes this frame and in all (HUD, checks). */
  pushes = 0;
  private me = shapeA();
  private other = shapeA();
  private ov = { depth: 0, nx: 0, nz: 0 };
  private pts = [0, 0, 0, 0];

  /** Time passes (the battlefield's update, once a frame). */
  tick(dt: number) {
    this.now += dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (this.now - e.at > DROP) { this.byBody.delete(e.s); this.list.splice(i, 1); }
    }
  }

  get count() { return this.list.length; }

  /** Push `body` (just stepped) out of every other live body it overlaps. v: the sliders (a mech's own). */
  resolve(body: Solid, dt: number, v: SolidValues = this.v) {
    this.v = v;
    let e = this.byBody.get(body);
    const me = this.me;
    const solid = body.solidShape(me);
    if (!e) { e = { s: body, at: this.now, lx: me.x, lz: me.z, vx: 0, vz: 0 }; this.byBody.set(body, e); this.list.push(e); }
    e.at = this.now;
    if (!solid) { e.lx = NaN; return; }
    if (dt > 0 && Number.isFinite(e.lx)) {
      const vx = (me.x - e.lx) / dt, vz = (me.z - e.lz) / dt;
      if (vx * vx + vz * vz > 3600) { e.vx = 0; e.vz = 0; } else { e.vx = vx; e.vz = vz; }
    }
    if (v.solidsOn >= 0.5) {
      const o = this.other, ov = this.ov;
      for (const f of this.list) {
        if (f === e || this.now - f.at > STALE) continue;
        if (!f.s.solidShape(o)) continue;
        // Cheap reject: centres further apart than both reaches.
        const reach = me.r + o.r + Math.hypot(me.hx, me.hz) + Math.hypot(o.hx, o.hz);
        if (Math.abs(me.x - o.x) > reach || Math.abs(me.z - o.z) > reach) continue;
        overlap(me, o, ov, this.pts);
        if (ov.depth <= 0) continue;
        const k = shareOf(me, o, e.vx, e.vz, f.vx, f.vz, ov.nx, ov.nz, v.mechShove);
        const da = ov.depth * k, db = ov.depth - da;
        body.solidShove(ov.nx * da, ov.nz * da, ov.nx, ov.nz);
        f.s.solidShove(-ov.nx * db, -ov.nz * db, -ov.nx, -ov.nz);
        me.x += ov.nx * da; me.z += ov.nz * da;
        this.pushes++;
      }
    }
    body.solidShape(me);
    e.lx = me.x; e.lz = me.z;
  }
}
