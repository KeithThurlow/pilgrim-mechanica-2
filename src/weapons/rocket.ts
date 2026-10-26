// The RPG rocket (Keith 2026-10-25): fired in a straight line from the launcher to the ground point under the cursor
// (ground targeted), a big blast where it lands, and it goes off early if it meets something on the way: a body, a
// wreck, or the sand or rock rising into its path. A hull item (fired with its side's mouse button) and a shoulder item
// (a number key: hold to paint, release to fire). Pure: the arsenal blasts, draws and plays it.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { Vec3 } from "./painter";

interface Ground { height(x: number, z: number): number }

/** What an item can change. */
export interface RocketStats { damage: number; blast: number; speed: number; cooldown: number }

export interface Rocket {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  dir: THREE.Vector3;
  to: THREE.Vector3;
  /** Metres left to the aim point. */
  left: number;
  speed: number;
  damage: number;
  blast: number;
  team: number;
  live: boolean;
}

/** Why a rocket went off: it reached its point, or something got in the way first. */
export type RocketEnd = "target" | "body" | "steel" | "ground";

/** Other things that stop a rocket (steel wrecks): distance along the ray, or -1. */
export type Blocker = (o: THREE.Vector3, d: THREE.Vector3, maxDist: number) => number;

/**
 * Where a rocket from `from` goes: the ground under the cursor, out to range; but with a soft lock whose footprint the
 * cursor is on (a robot, a bandit), its body's centre (2026-10-26: a rocket at the sand under a 10 m excavator flew
 * under its chassis and burst out of reach).
 */
export function rocketAim(from: Vec3, cur: Vec3, lock: { x: number; y: number; z: number; r: number; foot?: number } | null, range: number, ground: Ground): Vec3 {
  if (lock && Math.hypot(cur.x - lock.x, cur.z - lock.z) <= Math.max(lock.r, lock.foot ?? 0) + 0.5) {
    const dx = lock.x - from.x, dz = lock.z - from.z;
    if (Math.hypot(dx, dz) <= range) return { x: lock.x, y: lock.y, z: lock.z };
  }
  const dx = cur.x - from.x, dz = cur.z - from.z, d = Math.hypot(dx, dz), k = d > range ? range / d : 1;
  const x = from.x + dx * k, z = from.z + dz * k;
  return { x, y: ground.height(x, z), z };
}

export class Rockets {
  readonly list: Rocket[] = [];
  private at = new THREE.Vector3();

  /** Fire from `from` straight at `to` (a ground point). */
  fire(team: number, from: Vec3, to: Vec3, st: RocketStats): Rocket {
    let r = this.list.find((x) => !x.live);
    if (!r) { r = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), dir: new THREE.Vector3(), to: new THREE.Vector3(), left: 0, speed: 0, damage: 0, blast: 0, team, live: false }; this.list.push(r); }
    r.pos.set(from.x, from.y, from.z); r.prev.copy(r.pos);
    r.to.set(to.x, to.y, to.z);
    r.dir.subVectors(r.to, r.pos);
    r.left = r.dir.length();
    r.dir.divideScalar(r.left || 1);
    r.speed = st.speed; r.damage = st.damage; r.blast = st.blast; r.team = team; r.live = true;
    return r;
  }

  /**
   * Fly every rocket; the first of a body of another team, a blocker, the sand, or its aim point that it meets this
   * step sets it off there: onEnd(rocket, where, why, the body it hit or null).
   */
  update(dt: number, ground: Ground, targets: readonly Hittable[], blocker: Blocker | null, onEnd: (r: Rocket, at: THREE.Vector3, why: RocketEnd, t: Hittable | null) => void) {
    for (const r of this.list) {
      if (!r.live) continue;
      r.prev.copy(r.pos);
      const step = Math.min(r.left, r.speed * dt);
      let near: Hittable | null = null, nearD = step, why: RocketEnd = "target";
      for (const t of targets) {
        if (!t.alive || t.team === r.team) continue;
        const d = t.hitRay(r.pos, r.dir, nearD);
        if (d >= 0 && d < nearD) { nearD = d; near = t; why = "body"; }
      }
      if (blocker) { const d = blocker(r.pos, r.dir, nearD); if (d >= 0 && d < nearD) { nearD = d; near = null; why = "steel"; } }
      // The sand or rock rising into the path (a dune between): march the step.
      const n = Math.max(1, Math.ceil(nearD / 0.5));
      for (let i = 1; i <= n; i++) {
        const s = (nearD * i) / n;
        const x = r.pos.x + r.dir.x * s, y = r.pos.y + r.dir.y * s, z = r.pos.z + r.dir.z * s;
        // Into the ground before the aim point (a little slack at the very end, where it meets its own point).
        if (y < ground.height(x, z) - 0.05 && r.left - s > 0.6) { nearD = s; near = null; why = "ground"; break; }
      }
      if (near) near.hitRay(r.pos, r.dir, nearD + 1e-3);
      if (why !== "target" || nearD >= r.left - 1e-6) {
        this.at.copy(r.pos).addScaledVector(r.dir, nearD);
        r.pos.copy(this.at);
        r.live = false;
        onEnd(r, this.at, why, near);
        continue;
      }
      r.pos.addScaledVector(r.dir, step);
      r.left -= step;
    }
  }
}
