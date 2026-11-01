// Explosives against everything on the battlefield (pure, host-owned damage): a blast's splash onto every target of
// another team, and the first body a flying projectile's step meets (so missiles go off on contact, as rockets do).
// Battlefield.blast and the arsenal's autocannon bursts go through here; tools/weapons-check.ts drives the same calls.
import * as THREE from "three/webgpu";
import type { Hittable, SplashOpts } from "./battlefield";

/**
 * An explosive's blast at `at`: every live target of another team takes it through splash (as a blast: swarms measure
 * it to each unit's nearest part). `struck`: a swarm whose unit this projectile hit directly spares that unit; any
 * other struck target is skipped (it already took the hit).
 */
export function splashBlast(targets: readonly Hittable[], team: number, at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3, struck: Hittable | null = null, pierce?: number, cover?: SplashOpts["cover"]): number {
  let n = 0;
  for (const t of targets) {
    if (!t.alive || t.team === team || !t.splash) continue;
    if (t === struck && !t.spares) continue;
    n += t.splash(at, radius, damage, dir, { blast: true, spare: t === struck, pierce, cover });
  }
  return n;
}

interface Ground { height(x: number, z: number): number }
/** Steel in the way (wrecks): distance along the ray, or -1. */
export type SteelRay = (o: THREE.Vector3, d: THREE.Vector3, max: number) => number;

const CO = new THREE.Vector3(), CD = new THREE.Vector3();
/** How far up from the blast point the cover line starts (m): a blast on the sand isn't hidden by its own ground. */
export const COVER_LIFT = 0.4;
/** Closer than this (flat, m) a unit is in the blast whatever stands round it. */
export const COVER_NEAR = 1.5;

/**
 * Cover from a blast at `at` (Keith 2026-11-01: "I do expect things to be able to take cover behind walls"): a test
 * for SplashOpts.cover, true when the line from just above the blast to a unit's middle (x, y, z) dips into the ground
 * (a dune, a fortress wall: the walls are ground) or meets steel (a wreck). The ground is marched every half metre;
 * steel is one ray. Units right at the blast are never covered. Pure but for the steel ray.
 */
export function blastCover(ground: Ground, steel: SteelRay | null, at: THREE.Vector3): (x: number, y: number, z: number) => boolean {
  const ax = at.x, ay = at.y + COVER_LIFT, az = at.z;
  return (x, y, z) => {
    const dx = x - ax, dy = y - ay, dz = z - az;
    if (dx * dx + dz * dz < COVER_NEAR * COVER_NEAR) return false;
    const len = Math.hypot(dx, dy, dz);
    // March from past the blast's own spot to short of the unit (its feet are on the sand).
    const n = Math.floor((len - 0.6) / 0.5);
    for (let i = 2; i <= n; i++) {
      const t = (i * 0.5) / len;
      if (ay + dy * t < ground.height(ax + dx * t, az + dz * t) - 0.15) return true;
    }
    if (steel) {
      CO.set(ax, ay, az); CD.set(dx / len, dy / len, dz / len);
      const h = steel(CO, CD, len - 0.6);
      if (h >= 0) return true;
    }
    return false;
  };
}

const D = new THREE.Vector3();

/**
 * The first live body of another team on the segment a to b (a projectile's step): the target and the fraction of
 * the way along (0-1), or null. Leaves the target's "last hit" on that body (its part), so damage lands there.
 */
export function firstBody(targets: readonly Hittable[], team: number, a: THREE.Vector3, b: THREE.Vector3): { t: Hittable; f: number } | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  const d = D.set(dx / len, dy / len, dz / len);
  let near: Hittable | null = null, nearD = len;
  for (const t of targets) {
    if (!t.alive || t.team === team) continue;
    const h = t.hitRay(a, d, nearD);
    if (h >= 0 && h < nearD) { nearD = h; near = t; }
  }
  if (!near) return null;
  near.hitRay(a, d, nearD + 1e-3);
  return { t: near, f: nearD / len };
}
