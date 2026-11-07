// The robot swarm's state in the ECS world (docs/architecture-review.md stage 4.3). The swarm reserves a block of
// ROBOT_MAX entity indices in a fixed-capacity world (src/ecs/world.ts) and its slot arrays ARE views of that block's
// columns: slot i is entity index base + i. So there is one copy of where each robot is and how hurt it is, and the
// world's queries, snapshots and (later) the network see the swarm without a sync.
// - Shared components: Transform (x = px, y = hubY the body centre, z = pz, heading), Velocity (vx, vy, vz), Health
//   (hp, maxHp), Status.pace (pace). PrevTransform is last tick's Transform (copied at the start of each update).
//   Team and Collider are written where the register is published (they depend on the publisher's team and sliders).
// - The kind's own component, Robot: kind, state, stateTime, size, variant, weapon, uid, frozen.
// - The rest (the AI's clocks, leg arrays, latch slots...) stays in the swarm's own arrays, an opaque sim (review §4.1),
//   until something outside needs it.
// - Lifecycle: an entity lives while its robot does (spawn to death); a dead or empty slot has none, and its index
//   comes back with the next generation, so an id kept past death goes stale. `relink` rebuilds that from the state
//   array after a snapshot overwrote the swarm (the sim worker's view).
// Ownership: host (enemies). Pure.
import { World, defineComponent, type Entity } from "../ecs/world";
import { Transform, PrevTransform, Velocity, Health, Status, Team, Collider } from "../ecs/components";

/** A robot's kind and state (src/combat/robots.ts constants: SMALL/MID/BIG, RUN..DEAD, EMPTY). */
export const Robot = defineComponent("Robot", {
  kind: "u8", state: "u8", stateTime: "f32", size: "f32", variant: "u8", weapon: "u8", uid: "u32", frozen: "u8",
}, { defaults: { state: 255 } });

/** The components every live robot has. */
export const ROBOT_COMPONENTS = [Transform, PrevTransform, Velocity, Health, Status, Team, Collider, Robot] as const;

/** Entity indices a world needs per robot swarm, and a capacity that fits a few swarms plus other things. */
export const swarmWorldCapacity = (slots: number, swarms = 8) => slots * swarms + 4096;

let warned = false;

export class RobotBlock {
  readonly world: World;
  /** The block's first entity index: slot i is index base + i. */
  readonly base: number;
  readonly px: Float32Array; readonly hubY: Float32Array; readonly pz: Float32Array; readonly heading: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly hp: Float32Array; readonly maxHp: Float32Array; readonly pace: Float32Array;
  readonly kind: Uint8Array; readonly state: Uint8Array; readonly stateTime: Float32Array; readonly size: Float32Array;
  readonly variant: Uint8Array; readonly weapon: Uint8Array; readonly uid: Uint32Array; readonly frozen: Uint8Array;
  private prev: { x: Float32Array; y: Float32Array; z: Float32Array; heading: Float32Array };
  private team: Uint8Array; private unitKind: Uint8Array;
  /** The uid each slot's entity was made for. */
  private linked: Uint32Array;
  readonly radius: Float32Array; readonly foot: Float32Array; readonly reach: Float32Array; readonly height: Float32Array;

  /** A block of `slots` in `world` (a fixed one with room), else in a world of its own. */
  constructor(readonly slots: number, world?: World) {
    let w = world instanceof World && world.fixed ? world : null, base = w ? w.reserve(slots) : -1;
    if (base < 0) {
      if (world instanceof World && !warned) { warned = true; console.warn("robots: the world has no room for a swarm; it gets its own world"); }
      w = new World({ capacity: slots });
      base = w.reserve(slots);
    }
    this.world = w!; this.base = base;
    this.linked = new Uint32Array(slots);
    const v = <T extends { subarray(a: number, b: number): T }>(a: T) => a.subarray(base, base + slots);
    const T = this.world.columns(Transform), P = this.world.columns(PrevTransform), Vl = this.world.columns(Velocity);
    const H = this.world.columns(Health), S = this.world.columns(Status), R = this.world.columns(Robot);
    const M = this.world.columns(Team), C = this.world.columns(Collider);
    this.px = v(T.x); this.hubY = v(T.y); this.pz = v(T.z); this.heading = v(T.heading);
    this.prev = { x: v(P.x), y: v(P.y), z: v(P.z), heading: v(P.heading) };
    this.vx = v(Vl.x); this.vy = v(Vl.y); this.vz = v(Vl.z);
    this.hp = v(H.hp); this.maxHp = v(H.max); this.pace = v(S.pace);
    this.kind = v(R.kind); this.state = v(R.state); this.stateTime = v(R.stateTime); this.size = v(R.size);
    this.variant = v(R.variant); this.weapon = v(R.weapon); this.uid = v(R.uid); this.frozen = v(R.frozen);
    this.team = v(M.team); this.unitKind = v(M.kind);
    this.radius = v(C.radius); this.foot = v(C.foot); this.reach = v(C.reach); this.height = v(C.height);
    // A fresh block holds old data if the world was used before: start it as the swarm's arrays always did.
    for (const a of [this.px, this.hubY, this.pz, this.heading, this.vx, this.vy, this.vz, this.hp, this.maxHp, this.kind,
      this.stateTime, this.size, this.variant, this.weapon, this.uid, this.frozen]) a.fill(0);
    this.pace.fill(1);
    this.state.fill(255);
  }

  /** The entity of slot i, or -1 (empty or dead). */
  entity(i: number): Entity | -1 { return this.world.at(this.base + i); }

  /** Slot i's robot came to life (its fields are written): its entity, PrevTransform where it is now. */
  link(i: number) {
    const j = this.base + i, w = this.world;
    if (w.at(j) !== -1) w.destroy(w.at(j) as Entity);
    w.attach(w.createAt(j), ...ROBOT_COMPONENTS);
    this.linked[i] = this.uid[i];
    this.prev.x[i] = this.px[i]; this.prev.y[i] = this.hubY[i]; this.prev.z[i] = this.pz[i]; this.prev.heading[i] = this.heading[i];
  }

  /** Slot i's robot died or went: its entity goes (the id goes stale). */
  unlink(i: number) {
    const e = this.world.at(this.base + i);
    if (e !== -1) this.world.destroy(e);
  }

  /** Entities to match the state array (after a snapshot overwrote it); a slot whose uid changed since its entity was
   *  made (reused between snapshots) gets a new entity. */
  relink(hi: number, dead: number) {
    for (let i = 0; i < this.slots; i++) {
      const live = i < hi && this.state[i] < dead, has = this.world.at(this.base + i) !== -1;
      if (live && (!has || this.linked[i] !== this.uid[i])) this.link(i);
      else if (!live && has) this.unlink(i);
    }
  }

  /** Last tick's Transform: the start of each update. */
  keepPrevious(hi: number) {
    const p = this.prev;
    p.x.set(this.px.subarray(0, hi)); p.y.set(this.hubY.subarray(0, hi)); p.z.set(this.pz.subarray(0, hi)); p.heading.set(this.heading.subarray(0, hi));
  }

  /** Team and Collider of slot i, as the register is published. */
  publish(i: number, team: number, unitKind: number, radius: number, foot: number, reach: number, height: number) {
    this.team[i] = team; this.unitKind[i] = unitKind;
    this.radius[i] = radius; this.foot[i] = foot; this.reach[i] = reach; this.height[i] = height;
  }
}
