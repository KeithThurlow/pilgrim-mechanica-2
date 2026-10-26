// The autocannon (docs/proposal-weapons.md, assist mode): slower explosive shells that really fly, so lead matters.
// It fires on the minigun's clock (the upper-body sim), but each round is a shell with a speed and a little drop,
// aimed where the soft lock will be when it arrives (from the lock's velocity), bursting in a small splash where it
// meets a body or the sand. With a sweep (the arsenal's: a sheet along each step, src/game/sheet.ts) a shell hits
// what it flies over and carries a small penetration budget, bursting in the body it can't pay to pass.
// Pure: the arsenal draws the shells and plays the bursts.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { Vec3 } from "./painter";

interface Ground { height(x: number, z: number): number }

/** What an item can change. */
export interface CannonStats { damage: number; speed: number; splash: number; range: number; spread: number }

export interface Shell {
  pos: THREE.Vector3; vel: THREE.Vector3; travelled: number; range: number; live: boolean; damage: number; splash: number; team: number;
  /** Penetration left and at the start (m; the sweep spends it), and what it already went through (target, key). */
  pen: number; pen0: number; passed: { t: unknown; key: number }[];
}

/**
 * A sweep along one step of a shell's flight, from a to b: it applies damage to what it passes and returns where the
 * shell stops in a body (and what), or null to fly on.
 */
export type ShellSweep = (s: Shell, a: THREE.Vector3, b: THREE.Vector3) => { at: THREE.Vector3; t: Hittable | null } | null;

/**
 * Where to aim a shell of this speed from `from` to meet a target at `p` moving at `vel` (constant): the intercept
 * point, raised by the drop over the flight, and the flight time. `k` scales the lead (1: exact).
 */
export function leadPoint(from: Vec3, p: Vec3, vel: Vec3, speed: number, gravity: number, k = 1): { x: number; y: number; z: number; t: number } {
  const rx = p.x - from.x, ry = p.y - from.y, rz = p.z - from.z;
  const vx = vel.x * k, vy = vel.y * k, vz = vel.z * k;
  // |r + v t| = s t  ->  (v·v - s²) t² + 2 (r·v) t + r·r = 0
  const a = vx * vx + vy * vy + vz * vz - speed * speed, b = 2 * (rx * vx + ry * vy + rz * vz), c = rx * rx + ry * ry + rz * rz;
  let t: number;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : Math.sqrt(c) / speed;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) t = Math.sqrt(c) / speed;
    else {
      const s = Math.sqrt(disc), t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
      t = Math.min(...[t1, t2].filter((x) => x > 0), Infinity);
      if (!Number.isFinite(t)) t = Math.sqrt(c) / speed;
    }
  }
  return { x: p.x + vx * t, y: p.y + vy * t + 0.5 * gravity * t * t, z: p.z + vz * t, t };
}

export class CannonShells {
  readonly list: Shell[] = [];
  private seg = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private at = new THREE.Vector3();
  private end = new THREE.Vector3();

  /** Fire a shell from `from` along unit `dir` at `speed`. */
  fire(team: number, from: Vec3, dir: Vec3, st: CannonStats, pen = 0): Shell {
    let s = this.list.find((x) => !x.live);
    if (!s) { s = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), travelled: 0, range: 0, live: false, damage: 0, splash: 0, team, pen: 0, pen0: 0, passed: [] }; this.list.push(s); }
    s.pen = s.pen0 = pen; s.passed.length = 0;
    s.pos.set(from.x, from.y, from.z);
    s.vel.set(dir.x, dir.y, dir.z).normalize().multiplyScalar(st.speed);
    s.travelled = 0; s.range = st.range; s.live = true; s.damage = st.damage; s.splash = st.splash; s.team = team;
    return s;
  }

  /**
   * Move every shell under gravity; a shell that meets a live target of another team, or the sand, bursts there:
   * onHit(shell, where, what it hit or null). With a sweep, the sweep finds bodies (and has already damaged the one it
   * stops in: onHit's `swept` is true).
   */
  update(dt: number, gravity: number, ground: Ground, targets: readonly Hittable[], onHit: (s: Shell, at: THREE.Vector3, t: Hittable | null, swept?: boolean) => void, sweep: ShellSweep | null = null) {
    for (const s of this.list) {
      if (!s.live) continue;
      s.vel.y -= gravity * dt;
      this.seg.copy(s.vel).multiplyScalar(dt);
      const len = this.seg.length();
      this.dir.copy(this.seg).divideScalar(len || 1);
      if (sweep) {
        const end = this.end.copy(s.pos).add(this.seg);
        const stop = sweep(s, s.pos, end);
        if (stop) { s.live = false; onHit(s, stop.at, stop.t, true); continue; }
      }
      let near: Hittable | null = null, nearD = sweep ? -1 : len;
      if (!sweep) for (const t of targets) {
        if (!t.alive || t.team === s.team) continue;
        const d = t.hitRay(s.pos, this.dir, nearD);
        if (d >= 0 && d < nearD) { nearD = d; near = t; }
      }
      if (near) {
        near.hitRay(s.pos, this.dir, nearD + 1e-3);
        this.at.copy(s.pos).addScaledVector(this.dir, nearD);
        s.live = false; onHit(s, this.at, near); continue;
      }
      // The sand: bisect the step where it went under.
      const nx = s.pos.x + this.seg.x, ny = s.pos.y + this.seg.y, nz = s.pos.z + this.seg.z;
      if (ny <= ground.height(nx, nz)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 10; i++) {
          const m = (lo + hi) / 2;
          if (s.pos.y + this.seg.y * m > ground.height(s.pos.x + this.seg.x * m, s.pos.z + this.seg.z * m)) lo = m; else hi = m;
        }
        this.at.copy(s.pos).addScaledVector(this.seg, hi);
        s.live = false; onHit(s, this.at, null); continue;
      }
      s.pos.set(nx, ny, nz);
      s.travelled += len;
      // Past its range it burns out (no burst).
      if (s.travelled > s.range * 1.3) s.live = false;
    }
  }
}
