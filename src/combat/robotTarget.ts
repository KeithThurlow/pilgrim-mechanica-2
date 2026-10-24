// The robot swarm as one target for the battlefield: rounds test every robot's body through the swarm's spatial
// hit test (hubs, medium and big chassis, the big ones' arm legs), and the nearest one hit takes the damage (steel:
// rounds spark off them); a big one hit in an arm leg takes only a share. Small ones are light (rounds carry on
// through, splash hurts them fully); medium and big ones stop rounds; medium ones take a share of splash, big ones none.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import { DOWN, SMALL, MID, type RobotSwarm } from "./robots";

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

  /** Small robots are light: a round carries on through one; medium and big ones stop it. */
  canPierce() { return this.last >= 0 && this.swarm.kind[this.last] === SMALL; }

  /**
   * Robots whose body is within radius of the point: small ones take it all, medium ones a share (robotMidSplash,
   * measured to the chassis' edge), big ones shrug it off.
   */
  splash(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3) {
    const sw = this.swarm, midK = sw.v.robotMidSplash;
    let n = 0;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= DOWN) continue;
      const kind = sw.kind[i];
      if (kind !== SMALL && (kind !== MID || midK <= 0)) continue;
      const dx = sw.px[i] - at.x, dy = sw.hubY[i] - at.y, dz = sw.pz[i] - at.z;
      const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - (kind === MID ? sw.size[i] * 0.4 : 0));
      if (d > radius) continue;
      const k = kind === MID ? midK : 1;
      if (sw.damage(i, damage * k * (1 - (0.5 * d) / radius), dir.x, dir.z)) this.kills++;
      n++;
    }
    return n;
  }

  /** A round into a big one's arm leg does only part of its damage (robotBigLegDamage). */
  damage(amount: number, _at: THREE.Vector3, dir: THREE.Vector3) {
    if (this.last < 0) return;
    const k = this.lastLeg ? this.swarm.v.robotBigLegDamage : 1;
    if (this.swarm.damage(this.last, amount * k, dir.x, dir.z)) this.kills++;
  }
}
