// The robot swarm as one target for the battlefield: rounds test every robot's body through the swarm's spatial
// hit test (hubs, tripod bodies and legs), and the nearest one hit takes the damage (steel: rounds spark off them);
// a tripod hit in a leg takes only a share.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import { DOWN, SMALL, type RobotSwarm } from "./robots";

export class RobotTarget implements Hittable {
  readonly surface: HitSurface = "metal";
  alive = true;
  kills = 0;
  private last = -1;

  constructor(private swarm: RobotSwarm, readonly team: number) {}

  private lastLeg = false;

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const h = this.swarm.hitRay(o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
    this.last = h ? h.index : -1;
    this.lastLeg = h ? h.leg : false;
    return h ? h.dist : -1;
  }

  /** Small robots are light: a round carries on through one; the big ones stop it. */
  canPierce() { return this.last >= 0 && this.swarm.kind[this.last] === SMALL; }

  /** Small robots whose hub is within radius of the point (the big ones shrug off splash). */
  splash(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3) {
    const sw = this.swarm, r2 = radius * radius;
    let n = 0;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= DOWN || sw.kind[i] !== SMALL) continue;
      const dx = sw.px[i] - at.x, dy = sw.hubY[i] - at.y, dz = sw.pz[i] - at.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      if (sw.damage(i, damage * (1 - 0.5 * Math.sqrt(d2) / radius), dir.x, dir.z)) this.kills++;
      n++;
    }
    return n;
  }

  /** A round into a tripod's leg does only part of its damage (robotBigLegDamage). */
  damage(amount: number, _at: THREE.Vector3, dir: THREE.Vector3) {
    if (this.last < 0) return;
    const k = this.lastLeg ? this.swarm.v.robotBigLegDamage : 1;
    if (this.swarm.damage(this.last, amount * k, dir.x, dir.z)) this.kills++;
  }
}
