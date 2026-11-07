// The infantry swarm's state in the ECS world (docs/architecture-review.md stage 4.4; the robots' way, stage 4.3): the
// swarm reserves a block of INFANTRY_MAX entity indices (src/ecs/swarmBlock.ts) and its slot arrays ARE views of the
// block's columns: slot i is entity index base + i. Bandits on foot, war band riders, the humans' camps, the range's
// runners and fortress garrisons all run on it.
// - Shared: Transform (x = px, y = py the feet, z = pz, heading), Velocity (vx, vz), Health (hp; max is the spawn health,
//   written by the swarm), Status.pace; PrevTransform, Team, Collider (radius, height) as SwarmBlock writes them.
// - The kind's own component, Infantry: state, stateTime, look, uid, frozen. The AI's clocks (fear, fire clock, dodge...)
//   stay swarm arrays, an opaque sim (review §4.1).
// - An entity lives from spawn to death (a downed bandit is alive); no health bars (they die to a hit or two).
// Ownership: host (enemies). Pure.
import { defineComponent, type World } from "../ecs/world";
import { SwarmBlock } from "../ecs/swarmBlock";

/** A bandit's state (src/combat/infantry.ts constants: ADVANCE..DEAD, EMPTY) and looks. */
export const Infantry = defineComponent("Infantry", {
  state: "u8", stateTime: "f32", look: "u8", uid: "u32", frozen: "u8",
}, { defaults: { state: 255 } });

export class InfantryBlock extends SwarmBlock {
  readonly state: Uint8Array; readonly stateTime: Float32Array; readonly look: Uint8Array; readonly uid: Uint32Array; readonly frozen: Uint8Array;

  constructor(slots: number, world?: World) {
    super(slots, world, "infantry");
    const I = this.world.columns(Infantry);
    this.state = this.view(I.state); this.stateTime = this.view(I.stateTime); this.look = this.view(I.look);
    this.uid = this.view(I.uid); this.frozen = this.view(I.frozen);
    for (const a of [this.stateTime, this.look, this.uid, this.frozen]) a.fill(0);
    this.state.fill(255);
  }

  /** Slot i's bandit came to life: its entity. */
  linkBandit(i: number) { this.link(i, this.uid[i], Infantry); }

  /** Entities to match the state array after a snapshot overwrote it. */
  relinkBandits(hi: number, dead: number) { this.relink(hi, (i) => this.state[i] < dead, this.uid, (i) => this.linkBandit(i)); }
}
