// The bandit swarm as one target for the battlefield: rounds test every bandit's capsule through the swarm's spatial
// hit test, and the nearest one hit takes the damage.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import { DOWN, type InfantrySwarm } from "./infantry";

export class InfantryTarget implements Hittable {
  readonly surface: HitSurface = "flesh";
  alive = true;
  kills = 0;
  private last = -1;

  constructor(private swarm: InfantrySwarm, readonly team: number) {}

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const h = this.swarm.hitRay(o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
    this.last = h ? h.index : -1;
    return h ? h.dist : -1;
  }

  /** Bandits are light: a round carries on through one. */
  canPierce() { return true; }

  /** Every standing bandit whose body (a vertical line from feet to head) is within radius of the point. */
  splash(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3) {
    const sw = this.swarm, H = sw.v.banditHeight, r2 = radius * radius;
    let n = 0;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= DOWN) continue;
      const dx = sw.px[i] - at.x, dz = sw.pz[i] - at.z;
      const dy = Math.max(sw.py[i] - at.y, 0, at.y - (sw.py[i] + H));
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 > r2) continue;
      // Full share at the centre, half at the edge.
      if (sw.damage(i, damage * (1 - 0.5 * Math.sqrt(d2) / radius), dir.x, dir.z)) this.kills++;
      n++;
    }
    return n;
  }

  damage(amount: number, _at: THREE.Vector3, dir: THREE.Vector3) {
    if (this.last < 0) return;
    if (this.swarm.damage(this.last, amount, dir.x, dir.z)) this.kills++;
  }
}
