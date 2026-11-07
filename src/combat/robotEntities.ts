// The robot swarm's live robots as ECS entities (docs/architecture-review.md stage 4.1): each tick their shared
// components are written from the swarm's own arrays: Transform (body centre, heading), PrevTransform (last tick's),
// Health, Team (and KIND.Unit), Collider (as the register measures them). Nothing reads them yet; readers move over in
// 4.2, and the swarm writes them itself in 4.3. Ownership: host (a mirror of host state). Pure.
import { World, entityIndex } from "../ecs/world";
import { SlotEntities } from "../ecs/slots";
import { Transform, PrevTransform, Health, Team, Collider } from "../ecs/components";
import { KIND } from "../game/register";
import { DEAD, SMALL, robotFootprint, type RobotSwarm } from "./robots";

export class RobotEntities {
  readonly slots: SlotEntities;
  constructor(readonly world: World, readonly swarm: RobotSwarm, readonly team: number) { this.slots = new SlotEntities(world); }

  private lastHi = 0;

  sync() {
    const w = this.world, sw = this.swarm;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= DEAD) { this.slots.clear(i); continue; }
      const e = this.slots.at(i, sw.uid[i]), j = entityIndex(e);
      const fresh = !w.has(e, Transform);
      if (fresh) { w.add(e, Transform); w.add(e, PrevTransform); w.add(e, Health); w.add(e, Team); w.add(e, Collider); }
      // Fetched after the entity is made: the world's columns are replaced when it grows.
      const T = w.columns(Transform), P = w.columns(PrevTransform), H = w.columns(Health), M = w.columns(Team), C = w.columns(Collider);
      const k = sw.kind[i];
      if (fresh) { P.x[j] = sw.px[i]; P.y[j] = sw.hubY[i]; P.z[j] = sw.pz[i]; P.heading[j] = sw.heading[i]; }
      else { P.x[j] = T.x[j]; P.y[j] = T.y[j]; P.z[j] = T.z[j]; P.heading[j] = T.heading[j]; }
      T.x[j] = sw.px[i]; T.y[j] = sw.hubY[i]; T.z[j] = sw.pz[i]; T.heading[j] = sw.heading[i];
      H.hp[j] = sw.hp[i]; H.max[j] = sw.maxHp[i];
      M.team[j] = this.team; M.kind[j] = KIND.Unit;
      C.radius[j] = sw.bodyRadius(i);
      C.foot[j] = k === SMALL ? 0 : robotFootprint(sw, i);
      C.reach[j] = sw.hitReach(i);
      C.height[j] = sw.heightOf(i);
    }
    for (let i = sw.hi; i < this.lastHi; i++) this.slots.clear(i);
    this.lastHi = sw.hi;
  }
}
