// The robot swarm's state in the ECS world (docs/architecture-review.md stage 4.3). The swarm reserves a block of
// ROBOT_MAX entity indices in a fixed-capacity world (src/ecs/swarmBlock.ts) and its slot arrays ARE views of that block's
// columns: slot i is entity index base + i. So there is one copy of where each robot is and how hurt it is, and the
// world's queries, snapshots and (later) the network see the swarm without a sync.
// - Shared components: Transform (x = px, y = hubY the body centre, z = pz, heading), Velocity (vx, vy, vz), Health
//   (hp, maxHp), Status.pace (pace). PrevTransform is last tick's Transform (copied at the start of each update).
//   Team, Collider, Armour (flat) and Bar are written where the register is published (they depend on the publisher's
//   team and the sliders). Only cutters and excavators get a Bar (scrappers die to a hit); excavators' always show.
// - The kind's own component, Robot: kind, state, stateTime, size, variant, weapon, uid, frozen.
// - The rest (the AI's clocks, leg arrays, latch slots...) stays in the swarm's own arrays, an opaque sim (review §4.1),
//   until something outside needs it.
// - Lifecycle: an entity lives while its robot does (spawn to death); a dead or empty slot has none, and its index
//   comes back with the next generation, so an id kept past death goes stale. `relink` rebuilds that from the state
//   array after a snapshot overwrote the swarm (the sim worker's view).
// Ownership: host (enemies). Pure.
import { defineComponent, type World } from "../ecs/world";
import { Bar } from "../ecs/components";
import { SwarmBlock } from "../ecs/swarmBlock";

/** A robot's kind and state (src/combat/robots.ts constants: SMALL/MID/BIG, RUN..DEAD, EMPTY). */
export const Robot = defineComponent("Robot", {
  kind: "u8", state: "u8", stateTime: "f32", size: "f32", variant: "u8", weapon: "u8", uid: "u32", frozen: "u8",
}, { defaults: { state: 255 } });

/** Entity indices a world needs per robot swarm, and a capacity that fits a few swarms plus other things. */
export const swarmWorldCapacity = (slots: number, swarms = 8) => slots * swarms + 4096;

export class RobotBlock extends SwarmBlock {
  readonly kind: Uint8Array; readonly state: Uint8Array; readonly stateTime: Float32Array; readonly size: Float32Array;
  readonly variant: Uint8Array; readonly weapon: Uint8Array; readonly uid: Uint32Array; readonly frozen: Uint8Array;
  private barW: Float32Array; private barLift: Float32Array; private barAlways: Uint8Array;

  /** A block of `slots` in `world` (a fixed one with room), else in a world of its own. */
  constructor(slots: number, world?: World) {
    super(slots, world, "robots");
    const R = this.world.columns(Robot), B = this.world.columns(Bar);
    this.kind = this.view(R.kind); this.state = this.view(R.state); this.stateTime = this.view(R.stateTime); this.size = this.view(R.size);
    this.variant = this.view(R.variant); this.weapon = this.view(R.weapon); this.uid = this.view(R.uid); this.frozen = this.view(R.frozen);
    this.barW = this.view(B.width); this.barLift = this.view(B.lift); this.barAlways = this.view(B.always);
    for (const a of [this.kind, this.stateTime, this.size, this.variant, this.weapon, this.uid, this.frozen]) a.fill(0);
    this.state.fill(255);
  }

  /** Slot i's robot came to life: its entity (with a Bar unless it's a scrapper, SMALL). */
  linkRobot(i: number) {
    const e = this.link(i, this.uid[i], Robot);
    if (this.kind[i] !== 0) this.world.attach(e, Bar);
  }

  /** Entities to match the state array after a snapshot (the sim worker's view). */
  relinkRobots(hi: number, dead: number) { this.relink(hi, (i) => this.state[i] < dead, this.uid, (i) => this.linkRobot(i)); }

  /** Slot i's health bar (only read where it has a Bar). */
  bar(i: number, width: number, lift: number, always: boolean) { this.barW[i] = width; this.barLift[i] = lift; this.barAlways[i] = always ? 1 : 0; }
}
