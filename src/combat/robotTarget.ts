// The robot swarm as one target for the battlefield: rounds test every robot's body through the swarm's spatial
// hit test (hubs, medium and big chassis, walkers' legs and feet), the nearest part hit stops the round (steel: rounds
// spark off it there) and its robot takes the damage scaled by the part (Keith 2026-10-26: the body full, legs a
// share, feet less; robotLegDamage, robotFootDamage). Small ones are light (rounds carry on through, splash hurts them
// fully); medium and big ones stop rounds; medium ones take a share of splash, big ones none.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { TargetCandidate } from "../game/targeting";
import { DOWN, SMALL, MID, PART_BODY, robotCentre, robotFootprint, type RobotSwarm } from "./robots";

export class RobotTarget implements Hittable {
  readonly surface: HitSurface = "metal";
  alive = true;
  kills = 0;
  /** Rounds that landed on each part since construction (body, leg, foot), for HUDs and checks. */
  readonly partHits = [0, 0, 0];
  private last = -1;
  private lastPart = PART_BODY;

  constructor(private swarm: RobotSwarm, readonly team: number) {}

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const h = this.swarm.hitRay(o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
    this.last = h ? h.index : -1;
    this.lastPart = h ? h.part : PART_BODY;
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

  /** The round's damage, scaled by the part it struck (body full, legs and feet a share). */
  damage(amount: number, _at: THREE.Vector3, dir: THREE.Vector3) {
    if (this.last < 0) return;
    this.partHits[this.lastPart]++;
    if (this.swarm.damage(this.last, amount * this.swarm.partShare(this.lastPart), dir.x, dir.z)) this.kills++;
  }
}

/**
 * Every live robot as a soft-lock candidate: its body's centre (the hub, or a walker's chassis), body radius, ground
 * velocity, and for walkers the footprint of its planted feet (a cursor on the sand under a tall one locks its body).
 */
export function robotCandidates(sw: RobotSwarm, out: TargetCandidate[] = [], skip?: (i: number) => boolean): TargetCandidate[] {
  out.length = 0;
  for (let i = 0; i < sw.hi; i++) {
    if (sw.state[i] >= DOWN || skip?.(i)) continue; // skip down, dead, empty
    const c: TargetCandidate = { x: 0, y: 0, z: 0, r: 0, key: i * 1024 + (sw.gen[i] % 1024), vx: sw.vx[i], vz: sw.vz[i] };
    c.r = Math.max(0.6, robotCentre(sw, i, c));
    if (sw.kind[i] !== SMALL) c.foot = robotFootprint(sw, i);
    out.push(c);
  }
  return out;
}
