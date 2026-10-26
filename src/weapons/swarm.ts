// The missile pod (Keith 2026-10-25): missiles go up over the shoulder, then 8-12 of them curve down and swarm onto
// the ground round the target point, each a blast. Enemies inside the swarm's reach are shared out among the missiles
// (nearest first) and tracked as they fall; with none there, the missiles scatter over the area. Hold the key to
// paint the ring, release to fire. Pure: the arsenal blasts, draws and plays it.
import { bezier, type Rocket as Curve } from "./salvo";
import type { Vec3 } from "./painter";
import type { WeaponValues } from "./tuning";

interface Ground { height(x: number, z: number): number }

/** What an item can change. */
export interface SwarmStats { missiles: number; damage: number; blast: number; cooldown: number; radius: number }

/**
 * An enemy the swarm can pick: where it is, a key to follow it by, and its body's centre height (y; else the sand):
 * missiles come down onto the body, so a tall robot's chassis takes them rather than the sand under it.
 */
export interface Pick { x: number; y?: number; z: number; key: unknown }

export interface Missile extends Curve {
  /** The enemy it follows down (null: a point on the ground). */
  key: unknown;
}

const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** Where each missile goes: enemies within reach nearest first, shared round; else a scatter over the area. */
export function swarmAims(cx: number, cz: number, n: number, radius: number, enemies: readonly Pick[], seed: number): { x: number; y?: number; z: number; key: unknown }[] {
  const near = enemies.filter((e) => Math.hypot(e.x - cx, e.z - cz) <= radius).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  const out: { x: number; y?: number; z: number; key: unknown }[] = [];
  const turn = (seed * 2.399963) % (Math.PI * 2);
  for (let i = 0; i < n; i++) {
    if (near.length) { const e = near[i % near.length]; out.push({ x: e.x, y: e.y, z: e.z, key: e.key }); continue; }
    const r = radius * 0.85 * Math.sqrt((i + 0.5) / n), a = turn + i * 2.399963;
    out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, key: null });
  }
  return out;
}

export class SwarmSim {
  missiles: Missile[] = [];
  cooldown = 0;
  clock = 0;
  fired = 0;

  constructor(public v: WeaponValues) {}

  get ready() { return this.cooldown <= 0; }
  get flying() { return this.missiles.some((m) => m.live); }

  /** Fire at a point (false while cooling down). */
  fire(cx: number, cz: number, st: SwarmStats, enemies: readonly Pick[], ground: Ground): boolean {
    if (!this.ready) return false;
    const v = this.v, n = Math.max(1, Math.round(st.missiles));
    this.fired++;
    const aims = swarmAims(cx, cz, n, st.radius, enemies, this.fired);
    this.missiles = this.missiles.filter((m) => m.live);
    aims.forEach((a, i) => this.missiles.push({
      index: i, u: n > 1 ? i / (n - 1) : 0.5, p0: v3(), p1: v3(), p2: v3(), p3: v3(a.x, a.y ?? ground.height(a.x, a.z), a.z),
      launchAt: this.clock + i * v.swarmRipple, landAt: 0, launched: false, live: true, pos: v3(), prev: v3(), damage: st.damage, blast: st.blast, key: a.key,
    }));
    this.cooldown = st.cooldown;
    return true;
  }

  /**
   * Advance. `launch(i, out)`: the tube missile i leaves from. `track(key)`: where a followed enemy is now (null: gone,
   * the missile keeps its last point). onLand for each as it comes down (pos: where it bursts). `hit(a, b)`: the
   * fraction of a step's way from a to b where it meets a body (-1: none), tested on the way down; a missile that
   * meets one goes off there (2026-10-26: one coming down on a tall robot bursts on its chassis or a leg, not on the
   * sand under it).
   */
  update(dt: number, ground: Ground, launch: (i: number, out: Vec3) => void, track: (key: unknown) => { x: number; y?: number; z: number } | null,
    onLand: (m: Missile) => void, onLaunch?: (m: Missile) => void, hit?: (a: Vec3, b: Vec3) => number) {
    const v = this.v;
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const m of this.missiles) {
      if (!m.live) continue;
      if (!m.launched) {
        if (this.clock < m.launchAt) continue;
        launch(m.index, m.p0);
        // Up over the shoulder, fanned out a little sideways so the swarm spreads before it turns down.
        const fan = ((m.index % 5) - 2) * v.swarmFan;
        const tx = m.p3.x - m.p0.x, tz = m.p3.z - m.p0.z, flat = Math.hypot(tx, tz) || 1;
        const lx = tz / flat, lz = -tx / flat;
        m.p1 = v3(m.p0.x + lx * fan - (tx / flat) * 2, m.p0.y + v.swarmRise, m.p0.z + lz * fan - (tz / flat) * 2);
        const len = flat + v.swarmRise * 2;
        m.launchAt = this.clock;
        m.landAt = this.clock + len / Math.max(1, v.swarmSpeed);
        m.launched = true;
        m.pos = { ...m.p0 }; m.prev = { ...m.p0 };
        onLaunch?.(m);
      }
      // Follow the enemy it's after: the end of the curve moves with it.
      // Gone: down onto the sand where it was.
      if (m.key !== null && m.key !== undefined) {
        const p = track(m.key);
        if (p) { m.p3.x = p.x; m.p3.z = p.z; m.p3.y = p.y ?? ground.height(p.x, p.z); } else m.p3.y = ground.height(m.p3.x, m.p3.z);
      }
      m.p2 = v3(m.p3.x, m.p3.y + v.swarmDrop, m.p3.z);
      const s = Math.min(1, (this.clock - m.launchAt) / Math.max(1e-3, m.landAt - m.launchAt));
      m.prev.x = m.pos.x; m.prev.y = m.pos.y; m.prev.z = m.pos.z;
      bezier(m, s, m.pos);
      const f = hit && m.pos.y < m.prev.y ? hit(m.prev, m.pos) : -1;
      if (f >= 0) {
        m.live = false;
        m.pos = { x: m.prev.x + (m.pos.x - m.prev.x) * f, y: m.prev.y + (m.pos.y - m.prev.y) * f, z: m.prev.z + (m.pos.z - m.prev.z) * f };
        onLand(m); continue;
      }
      if (s >= 1) { m.live = false; m.pos = { ...m.p3 }; onLand(m); }
    }
  }
}
