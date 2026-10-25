// The rail cannon (docs/proposal-weapons.md): a skill shot. Hold the trigger to charge (a thin beam preview that
// thickens), release to fire a straight beam along the gun's aim that pierces everything on its line, losing a little
// damage per body, throwing light ones back. No assist: big damage for good aim. The beam hugs the sand at a set
// height (so it runs through a whole line of bandits from the high camera's point of view) and stops at a dune crest
// that rises well above the mech's feet. Pure: the arsenal draws the beam and trail and plays it.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { Vec3 } from "./painter";
import type { WeaponValues } from "./tuning";

interface Ground { height(x: number, z: number): number }

/** What an item can change. */
export interface RailStats { damage: number; charge: number; cooldown: number; range: number }

export class RailSim {
  /** 0..1 how full the charge is. */
  charge = 0;
  /** Seconds until it can charge again. */
  cooldown = 0;
  holding = false;

  constructor(public v: WeaponValues) {}

  /**
   * Advance with the trigger held or not. Returns the charge it fires with on release (full or partial past the
   * minimum), else null (still charging, idle, or a fizzle below the minimum).
   */
  update(dt: number, held: boolean, st: RailStats): number | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (held) {
      if (this.cooldown <= 0) { this.holding = true; this.charge = Math.min(1, this.charge + dt / Math.max(0.05, st.charge)); }
      return null;
    }
    if (!this.holding) return null;
    this.holding = false;
    const c = this.charge;
    this.charge = 0;
    if (c < this.v.railMinCharge) return null;
    this.cooldown = st.cooldown;
    return c;
  }
}

/**
 * The beam's path: a polyline from `from` (ground x, z) along `dir` (flat, any length), every 2 m, at railHeight over
 * the sand, out to range or until the sand rises more than railClimb above the ground under the mech.
 */
export function railPath(ground: Ground, from: { x: number; z: number }, dir: { x: number; z: number }, range: number, v: WeaponValues): Vec3[] {
  const l = Math.hypot(dir.x, dir.z) || 1, dx = dir.x / l, dz = dir.z / l;
  const base = ground.height(from.x, from.z);
  const pts: Vec3[] = [];
  const step = 2;
  for (let t = 1.5; t <= range + 1e-6; t += step) {
    const x = from.x + dx * t, z = from.z + dz * t, h = ground.height(x, z);
    if (h > base + v.railClimb) break;
    pts.push({ x, y: h + v.railHeight, z });
  }
  return pts;
}

export interface RailHit { target: Hittable; at: THREE.Vector3; damage: number; along: number }

/**
 * Fire the beam along a path: every live target of another team its segments pass through is hit in order along the
 * line (a swarm's units one by one), each for the damage left after the bodies before it (railPierceKeep each), and
 * thrown along the beam if it can be (knock). Returns the hits.
 */
export function railFire(path: Vec3[], targets: readonly Hittable[], team: number, damage: number, v: WeaponValues): RailHit[] {
  const hits: RailHit[] = [];
  const o = new THREE.Vector3(), d = new THREE.Vector3(), at = new THREE.Vector3();
  let dmg = damage, along = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k], b = path[k + 1];
    d.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = d.length();
    if (len < 1e-4) continue;
    d.divideScalar(len);
    // Each segment starts a metre back along the last, so a body standing on a joint isn't missed (met twice, it's
    // skipped below).
    const back = k > 0 ? 1 : 0;
    o.set(a.x - d.x * back, a.y - d.y * back, a.z - d.z * back);
    let used = -back;
    for (let guard = 0; guard < 64; guard++) {
      let near: Hittable | null = null, nearD = len - used;
      for (const t of targets) {
        if (!t.alive || t.team === team) continue;
        const dist = t.hitRay(o, d, nearD);
        if (dist >= 0 && dist < nearD) { nearD = dist; near = t; }
      }
      if (!near) break;
      near.hitRay(o, d, nearD + 1e-3);
      at.copy(o).addScaledVector(d, nearD);
      // The same body met again across a segment joint: skip it.
      const again = hits.some((h) => h.target === near && h.at.distanceTo(at) < 1.6);
      if (!again) {
        near.damage(dmg, at, d);
        near.knock?.(at, d, v.railKnock);
        hits.push({ target: near, at: at.clone(), damage: dmg, along: along + used + nearD });
        dmg *= v.railPierceKeep;
      }
      used += nearD + 0.8;
      if (used >= len) break;
      o.copy(at).addScaledVector(d, 0.8);
    }
    along += len;
  }
  return hits;
}
