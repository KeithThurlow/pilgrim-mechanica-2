// The robot swarm as one target for the battlefield: rounds test every robot's body through the swarm's spatial
// hit test, and the nearest one hit takes the damage (steel: rounds spark off them).
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { RobotSwarm } from "./robots";

export class RobotTarget implements Hittable {
  readonly surface: HitSurface = "metal";
  alive = true;
  kills = 0;
  private last = -1;

  constructor(private swarm: RobotSwarm, readonly team: number) {}

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const h = this.swarm.hitRay(o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
    this.last = h ? h.index : -1;
    return h ? h.dist : -1;
  }

  damage(amount: number, _at: THREE.Vector3, dir: THREE.Vector3) {
    if (this.last < 0) return;
    if (this.swarm.damage(this.last, amount, dir.x, dir.z)) this.kills++;
  }
}
