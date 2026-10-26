// The line rocket salvo (Keith 2026-10-25: "fires a line of rockets with ground targeting"; it "just straight up
// didn't really work" in the old game). Hold the heavy button: a strip is painted on the sand, centred on the cursor
// along the aim line (the near end kept off the mech), and if targets lie near it the strip turns and slides toward
// the line through them (the snap assist). Release: the rockets leave the pod in a fast ripple, climb, arc a little
// and land one after another at their points along the strip, near end first, so the blasts walk up the line.
// Pure: the battlefield's blast, the drawing and the smoke are the arsenal's (src/weapons/arsenal.ts).
import { onStrip, inStrip, type Strip, type Vec3 } from "./painter";
import type { WeaponValues } from "./tuning";

/** What an item can change (the rest are the sliders). */
export interface SalvoStats { rockets: number; damage: number; cooldown: number; length: number; blast: number }

export interface Rocket {
  index: number;
  /** Where along the strip it lands (0 near end .. 1 far end). */
  u: number;
  /** Bezier: launch, two control points, impact. */
  p0: Vec3; p1: Vec3; p2: Vec3; p3: Vec3;
  launchAt: number;
  landAt: number;
  launched: boolean;
  live: boolean;
  pos: Vec3;
  prev: Vec3;
  damage: number;
  blast: number;
}

interface Ground { height(x: number, z: number): number }
export interface Spot { x: number; z: number }

const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** Small seeded generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The strip for a mech at `from` aiming at `cursor` (ground x, z): centred on the cursor along the aim line, its near
 * end at least salvoMinRange from the mech and its far end at most salvoMaxRange. With targets (`near`), the strip
 * turns and slides toward the line through those near it, by salvoSnap.
 */
export function planStrip(from: Spot, cursor: Spot, length: number, v: WeaponValues, near: readonly Spot[] = []): Strip {
  let dx = cursor.x - from.x, dz = cursor.z - from.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) { dx = 0; dz = 1; d = 1; }
  dx /= d; dz /= d;
  const half = length / 2;
  const lo = v.salvoMinRange + half, hi = Math.max(lo, v.salvoMaxRange - half);
  d = Math.min(hi, Math.max(lo, d));
  let cx = from.x + dx * d, cz = from.z + dz * d;
  let ux = dx, uz = dz;
  const raw: Strip = { ax: cx - ux * half, az: cz - uz * half, bx: cx + ux * half, bz: cz + uz * half, width: v.salvoWidth };
  // Snap: the targets near the strip, their centre and the line they make.
  const hits = near.filter((p) => inStrip(raw, p.x, p.z, v.salvoSnapReach));
  if (hits.length && v.salvoSnap > 0) {
    let mx = 0, mz = 0;
    for (const p of hits) { mx += p.x; mz += p.z; }
    mx /= hits.length; mz /= hits.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const p of hits) { const a = p.x - mx, b = p.z - mz; sxx += a * a; szz += b * b; sxz += a * b; }
    const k = v.salvoSnap;
    // Turn only if they make a line (one direction clearly longer than the other).
    const tr = sxx + szz, det = sxx * szz - sxz * sxz, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (hits.length >= 2 && l1 > 1 && l1 > 3 * Math.max(l2, 0.01)) {
      const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      let px = Math.cos(ang), pz = Math.sin(ang);
      if (px * ux + pz * uz < 0) { px = -px; pz = -pz; }
      const a0 = Math.atan2(ux, uz);
      let da = Math.atan2(px, pz) - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const a1 = a0 + da * k;
      ux = Math.sin(a1); uz = Math.cos(a1);
    }
    cx += (mx - cx) * k; cz += (mz - cz) * k;
  }
  let s: Strip = { ax: cx - ux * half, az: cz - uz * half, bx: cx + ux * half, bz: cz + uz * half, width: v.salvoWidth };
  // The near end is the one nearer the mech (after a snap broadside, either could be).
  if (Math.hypot(s.bx - from.x, s.bz - from.z) < Math.hypot(s.ax - from.x, s.az - from.z)) s = { ax: s.bx, az: s.bz, bx: s.ax, bz: s.az, width: s.width };
  // Keep the near end off the mech.
  const na = Math.hypot(s.ax - from.x, s.az - from.z);
  if (na < v.salvoMinRange) {
    const ex = (s.ax - from.x) / (na || 1), ez = (s.az - from.z) / (na || 1), push = v.salvoMinRange - na;
    s = { ax: s.ax + ex * push, az: s.az + ez * push, bx: s.bx + ex * push, bz: s.bz + ez * push, width: s.width };
  }
  return s;
}

/** Where each rocket of a salvo lands on a strip, in firing order (near end first), with a seeded scatter. */
export function impactPoints(s: Strip, n: number, v: WeaponValues, seed: number): { x: number; z: number; u: number }[] {
  const r = rng(seed);
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz) || 1;
  const lx = dz / L, lz = -dx / L; // left of the line
  const out: { x: number; z: number; u: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0.5;
    const off = (r() * 2 - 1) * (s.width / 2) * v.salvoScatter;
    out.push({ x: s.ax + dx * u + lx * off, z: s.az + dz * u + lz * off, u });
  }
  return out;
}

export class SalvoSim {
  rockets: Rocket[] = [];
  /** Seconds until it can fire again. */
  cooldown = 0;
  clock = 0;
  /** Salvos fired (seeds the scatter). */
  fired = 0;

  constructor(public v: WeaponValues) {}

  get ready() { return this.cooldown <= 0; }
  get flying() { return this.rockets.some((r) => r.live); }

  /**
   * Fire a salvo at a strip (false while cooling down). `launch(i, out)` gives the tube a rocket leaves from, asked
   * at the moment it leaves (the mech keeps moving through the ripple).
   */
  fire(strip: Strip, st: SalvoStats, ground: Ground, seed = this.fired + 1): boolean {
    if (!this.ready) return false;
    const v = this.v, n = Math.max(1, Math.round(st.rockets));
    const pts = impactPoints(strip, n, v, seed * 7919 + 13);
    this.rockets = this.rockets.filter((r) => r.live);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      this.rockets.push({
        index: i, u: p.u, p0: v3(), p1: v3(), p2: v3(), p3: v3(p.x, ground.height(p.x, p.z), p.z),
        launchAt: this.clock + i * v.salvoRipple, landAt: 0, launched: false, live: true, pos: v3(), prev: v3(), damage: st.damage, blast: st.blast,
      });
    }
    this.cooldown = st.cooldown;
    this.fired++;
    return true;
  }

  /**
   * Advance. `launch(i, out)` fills the tube rocket i leaves from; onLaunch and onLand are called as they leave and
   * as each lands (in order along the strip). `hit(a, b)`: the fraction of a step's way from a to b where it meets a
   * body (-1: none), tested on the way down; a shell that meets one goes off there, early (2026-10-26).
   */
  update(dt: number, launch: (i: number, out: Vec3) => void, onLand: (r: Rocket) => void, onLaunch?: (r: Rocket) => void, hit?: (a: Vec3, b: Vec3) => number) {
    const v = this.v;
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    let lastLand = -Infinity;
    for (const r of this.rockets) if (r.launched) lastLand = Math.max(lastLand, r.landAt);
    for (const r of this.rockets) {
      if (!r.live) continue;
      if (!r.launched) {
        if (this.clock < r.launchAt) continue;
        launch(r.index, r.p0);
        const tx = r.p3.x - r.p0.x, tz = r.p3.z - r.p0.z, flat = Math.hypot(tx, tz) || 1;
        const fx = tx / flat, fz = tz / flat;
        r.p1 = v3(r.p0.x + fx * v.salvoRise * 0.35, r.p0.y + v.salvoRise, r.p0.z + fz * v.salvoRise * 0.35);
        const back = Math.min(8, flat * 0.3);
        r.p2 = v3(r.p3.x - fx * back, Math.max(r.p3.y, r.p0.y) + v.salvoArc, r.p3.z - fz * back);
        // Flight from the path length at rocket speed; then at least a landing gap after the one before, so the
        // impacts always walk up the strip in order.
        const len = bezierLength(r);
        r.launchAt = this.clock;
        r.landAt = Math.max(this.clock + len / Math.max(1, v.salvoSpeed), lastLand + v.salvoLandGap + 1e-4);
        lastLand = r.landAt;
        r.launched = true;
        r.pos = { ...r.p0 }; r.prev = { ...r.p0 };
        onLaunch?.(r);
      }
      const s = Math.min(1, (this.clock - r.launchAt) / Math.max(1e-3, r.landAt - r.launchAt));
      r.prev.x = r.pos.x; r.prev.y = r.pos.y; r.prev.z = r.pos.z;
      // Ease in: slow off the rail, fast at the end.
      bezier(r, s * s * (1.6 - 0.6 * s), r.pos);
      const f = hit && r.pos.y < r.prev.y ? hit(r.prev, r.pos) : -1;
      if (f >= 0) {
        r.live = false;
        r.pos = { x: r.prev.x + (r.pos.x - r.prev.x) * f, y: r.prev.y + (r.pos.y - r.prev.y) * f, z: r.prev.z + (r.pos.z - r.prev.z) * f };
        onLand(r); continue;
      }
      if (s >= 1) { r.live = false; r.pos = { ...r.p3 }; onLand(r); }
    }
  }
}

export function bezier(r: Rocket, s: number, out: Vec3): Vec3 {
  const a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, c = 3 * (1 - s) * s * s, d = s ** 3;
  out.x = a * r.p0.x + b * r.p1.x + c * r.p2.x + d * r.p3.x;
  out.y = a * r.p0.y + b * r.p1.y + c * r.p2.y + d * r.p3.y;
  out.z = a * r.p0.z + b * r.p1.z + c * r.p2.z + d * r.p3.z;
  return out;
}

function bezierLength(r: Rocket) {
  const a = v3(), b = v3();
  bezier(r, 0, a);
  let len = 0;
  for (let i = 1; i <= 16; i++) { bezier(r, i / 16, b); len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); a.x = b.x; a.y = b.y; a.z = b.z; }
  return len;
}

/** For checks: does a set of blasts cover the strip's centre line (every point within some blast)? Returns the worst gap (m). */
export function stripGap(s: Strip, blasts: { x: number; z: number; r: number }[]): number {
  let worst = 0;
  for (let i = 0; i <= 100; i++) {
    const u = i / 100, x = s.ax + (s.bx - s.ax) * u, z = s.az + (s.bz - s.az) * u;
    let best = Infinity;
    for (const b of blasts) best = Math.min(best, Math.hypot(b.x - x, b.z - z) - b.r);
    worst = Math.max(worst, best);
  }
  return worst;
}

export { onStrip };
