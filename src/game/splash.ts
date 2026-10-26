// Explosives against everything on the battlefield (pure, host-owned damage): a blast's splash onto every target of
// another team, and the first body a flying projectile's step meets (so missiles go off on contact, as rockets do).
// Battlefield.blast and the arsenal's autocannon bursts go through here; tools/weapons-check.ts drives the same calls.
import * as THREE from "three/webgpu";
import type { Hittable } from "./battlefield";

/**
 * An explosive's blast at `at`: every live target of another team takes it through splash (as a blast: swarms measure
 * it to each unit's nearest part). `struck`: a swarm whose unit this projectile hit directly spares that unit; any
 * other struck target is skipped (it already took the hit).
 */
export function splashBlast(targets: readonly Hittable[], team: number, at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3, struck: Hittable | null = null): number {
  let n = 0;
  for (const t of targets) {
    if (!t.alive || t.team === team || !t.splash) continue;
    if (t === struck && !t.spares) continue;
    n += t.splash(at, radius, damage, dir, { blast: true, spare: t === struck });
  }
  return n;
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
