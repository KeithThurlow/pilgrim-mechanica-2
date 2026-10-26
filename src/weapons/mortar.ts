// The mortar (docs/proposal-weapons.md, point mode): hold the heavy button for a ring at the cursor and a dotted arc;
// release lobs a few shells that land inside the ring, high enough to clear the dunes between (the arc rises by itself
// where the sand is in the way). With a soft lock near the ring, the ring leads the target's walk over the flight.
// Pure: shells fly through the battlefield's lob (src/game/shells.ts), which bursts them through its blast.
import type { Vec3 } from "./painter";
import type { WeaponValues } from "./tuning";

interface Ground { height(x: number, z: number): number }

/** What an item can change. */
export interface MortarStats { shells: number; damage: number; cooldown: number; blast: number }

/** A target the ring can lead: where it is and how it moves (m/s). */
export interface Moving { x: number; z: number; vx?: number; vz?: number }

/**
 * The ring's centre: the cursor, or (with a lock within a ring and a half of it, or further for a big ring) where the
 * lock will be after the flight, by mortarLead; never beyond range.
 */
export function mortarAim(from: { x: number; z: number }, cursor: { x: number; z: number }, lock: Moving | null, v: WeaponValues): { x: number; z: number } {
  let x = cursor.x, z = cursor.z;
  if (lock && Math.hypot(lock.x - cursor.x, lock.z - cursor.z) < v.mortarRing * 1.5 + 2) {
    x = lock.x + (lock.vx ?? 0) * v.mortarFlight * v.mortarLead;
    z = lock.z + (lock.vz ?? 0) * v.mortarFlight * v.mortarLead;
  }
  const dx = x - from.x, dz = z - from.z, d = Math.hypot(dx, dz);
  if (d > v.mortarMaxRange) { x = from.x + (dx / d) * v.mortarMaxRange; z = from.z + (dz / d) * v.mortarMaxRange; }
  return { x, z };
}

/**
 * How high a shell coming down at (x, z) should land: on the body of the lock when (x, z) is under it (its centre,
 * 2026-10-26: a shell aimed at the sand under a 10 m excavator's chassis came down past it, out of reach), else on
 * the sand (undefined).
 */
export function mortarHeight(x: number, z: number, lock: { x: number; y: number; z: number; r: number; vx?: number; vz?: number } | null, v: WeaponValues): number | undefined {
  if (!lock) return undefined;
  const lx = lock.x + (lock.vx ?? 0) * v.mortarFlight * v.mortarLead, lz = lock.z + (lock.vz ?? 0) * v.mortarFlight * v.mortarLead;
  return Math.hypot(x - lx, z - lz) <= lock.r + v.mortarRing ? lock.y : undefined;
}

/** Where each shell lands: spread inside the ring (a sunflower, turned by the seed), never outside it. */
export function mortarPoints(cx: number, cz: number, n: number, ring: number, seed: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const turn = (seed * 2.399963) % (Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const r = n > 1 ? ring * 0.8 * Math.sqrt((i + 0.5) / n) : 0;
    const a = turn + i * 2.399963;
    out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return out;
}

/**
 * The arc a shell needs from `from` to `to` (as src/game/shells.ts flies it: the straight line plus 4·arc·u·(1-u)) to
 * stay mortarClear above the sand all the way: at least `base`.
 */
export function lobArc(ground: Ground, from: Vec3, to: Vec3, base: number, clear: number): number {
  let arc = base;
  for (let i = 1; i < 24; i++) {
    const u = i / 24;
    const x = from.x + (to.x - from.x) * u, z = from.z + (to.z - from.z) * u, y = from.y + (to.y - from.y) * u;
    const need = ground.height(x, z) + clear - y;
    if (need > 0) arc = Math.max(arc, need / (4 * u * (1 - u)));
  }
  return arc;
}

/** A point on a lob (for the dotted arc). */
export function lobPoint(from: Vec3, to: Vec3, arc: number, u: number, out: Vec3): Vec3 {
  out.x = from.x + (to.x - from.x) * u;
  out.y = from.y + (to.y - from.y) * u + 4 * arc * u * (1 - u);
  out.z = from.z + (to.z - from.z) * u;
  return out;
}

export class MortarSim {
  cooldown = 0;
  fired = 0;
  private clock = 0;
  /** Shells still to leave the tube: when, and where they land. */
  queue: { at: number; x: number; z: number }[] = [];

  constructor(public v: WeaponValues) {}

  get ready() { return this.cooldown <= 0; }

  /** Fire a volley at a ring centre (false while cooling down). */
  fire(cx: number, cz: number, st: MortarStats): boolean {
    if (!this.ready) return false;
    const n = Math.max(1, Math.round(st.shells));
    this.fired++;
    mortarPoints(cx, cz, n, this.v.mortarRing, this.fired).forEach((p, i) => this.queue.push({ at: this.clock + i * this.v.mortarGap, x: p.x, z: p.z }));
    this.cooldown = st.cooldown;
    return true;
  }

  /** Advance; `launch(x, z)` is called for each shell as it leaves the tube. */
  update(dt: number, launch: (x: number, z: number) => void) {
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    while (this.queue.length && this.queue[0].at <= this.clock) { const q = this.queue.shift()!; launch(q.x, q.z); }
  }
}
