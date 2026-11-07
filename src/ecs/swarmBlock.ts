// A swarm's block of entities in a fixed-capacity world (docs/architecture-review.md stages 4.3 and 4.4). A swarm with
// N slots reserves N contiguous entity indices (`World.reserve`) and keeps `subarray` views of the block's columns as
// its own slot arrays, so slot i IS entity index base + i: one copy of the state, no sync, and the world's queries,
// snapshots and (later) the network see it. The shared components every swarm member has are viewed here; a kind adds
// its own (RobotBlock, InfantryBlock).
// - Transform (x, y, z, heading), PrevTransform (copied at the start of each update: `keepPrevious`), Velocity, Health
//   (hp, max), Status.pace; Team, Collider and Armour.flat written as the swarm publishes to the register (`publish`).
// - Lifecycle: an entity lives from a member's spawn to its death (`link`, `unlink`); its index then comes back with the
//   next generation, so a kept id goes stale. `relink` rebuilds that from the swarm's state after a snapshot overwrote it.
// - No world given, or no room in it: the block makes a world of its own (`own`), so a swarm always has columns.
// Pure.
import { World, type Entity, type AnyComponent, type Component } from "./world";
import { packBlock, applyBlock, type BlockSnapshot } from "./snapshot";
import { Transform, PrevTransform, Velocity, Health, Status, Team, Collider, Armour } from "./components";

/** The components every live swarm member has. */
export const SWARM_COMPONENTS = [Transform, PrevTransform, Velocity, Health, Status, Team, Collider, Armour] as const;

const warned = new Set<string>();

export class SwarmBlock {
  readonly world: World;
  /** True when the swarm made a world of its own: nothing else sees it (its target adapter covers what the world
   *  would, e.g. RobotTarget.bars). */
  readonly own: boolean;
  /** The block's first entity index: slot i is index base + i. */
  readonly base: number;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array; readonly heading: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly hp: Float32Array; readonly max: Float32Array; readonly pace: Float32Array;
  readonly team: Uint8Array; readonly unitKind: Uint8Array;
  readonly radius: Float32Array; readonly foot: Float32Array; readonly reach: Float32Array; readonly height: Float32Array;
  readonly armour: Float32Array;
  private prev: { x: Float32Array; y: Float32Array; z: Float32Array; heading: Float32Array };
  /** The components a snapshot of the block carries (stage 7a): the simulated ones. Team, Collider, Armour and Bar
   *  aren't: whoever publishes to the register writes them. A kind adds its own (Robot, Infantry). */
  readonly shipped: Component[] = [Transform, Velocity, Health, Status];
  /** The uid each slot's entity was made for. */
  private linked: Uint32Array;

  /** A block of `slots` in `world` (a fixed one with room), else in a world of its own. `label` names it in the
   *  warning when the world is full. */
  constructor(readonly slots: number, world: World | undefined, label: string) {
    let w = world instanceof World && world.fixed ? world : null, base = w ? w.reserve(slots) : -1;
    if (base < 0) {
      if (world instanceof World && !warned.has(label)) { warned.add(label); console.warn(`${label}: the world has no room for a swarm; it gets its own world`); }
      w = new World({ capacity: slots });
      base = w.reserve(slots);
    }
    this.world = w!; this.base = base;
    this.own = this.world !== world;
    this.linked = new Uint32Array(slots);
    const T = this.world.columns(Transform), P = this.world.columns(PrevTransform), V = this.world.columns(Velocity);
    const H = this.world.columns(Health), S = this.world.columns(Status), M = this.world.columns(Team);
    const C = this.world.columns(Collider), A = this.world.columns(Armour);
    this.x = this.view(T.x); this.y = this.view(T.y); this.z = this.view(T.z); this.heading = this.view(T.heading);
    this.prev = { x: this.view(P.x), y: this.view(P.y), z: this.view(P.z), heading: this.view(P.heading) };
    this.vx = this.view(V.x); this.vy = this.view(V.y); this.vz = this.view(V.z);
    this.hp = this.view(H.hp); this.max = this.view(H.max); this.pace = this.view(S.pace);
    this.team = this.view(M.team); this.unitKind = this.view(M.kind);
    this.radius = this.view(C.radius); this.foot = this.view(C.foot); this.reach = this.view(C.reach); this.height = this.view(C.height);
    this.armour = this.view(A.flat);
    // A fresh block holds old data if the world was used before: start it as a swarm's own arrays always did.
    for (const a of [this.x, this.y, this.z, this.heading, this.vx, this.vy, this.vz, this.hp, this.max]) a.fill(0);
    this.pace.fill(1);
  }

  /** Slots 0..n of the shipped components, one buffer each (src/ecs/snapshot.ts packBlock). */
  pack(n: number): BlockSnapshot { return packBlock(this.world, this.base, n, this.shipped); }

  /** A snapshot of another copy of this swarm's block into this one (its relink is the kind's to call). */
  apply(s: BlockSnapshot) { applyBlock(this.world, this.base, s, this.shipped); }

  /** True when `a` is a view of one of the shipped components' columns (a swarm's own field that pack() carries). */
  isShipped(a: ArrayBufferView): boolean {
    if (!this.bufs) {
      this.bufs = new Set();
      for (const c of this.shipped) for (const col of Object.values(this.world.columns(c))) this.bufs.add((col as ArrayBufferView).buffer);
    }
    return this.bufs.has(a.buffer);
  }
  private bufs: Set<ArrayBufferLike> | null = null;

  /** This block's slice of a column. */
  view<T extends { subarray(a: number, b: number): T }>(col: T): T { return col.subarray(this.base, this.base + this.slots); }

  /** The entity of slot i, or -1 (empty or dead). */
  entity(i: number): Entity | -1 { return this.world.at(this.base + i); }

  /** Slot i's member came to life (its fields are written): its entity with the shared and `extra` components,
   *  PrevTransform where it is now. */
  link(i: number, uid: number, ...extra: AnyComponent[]): Entity {
    const j = this.base + i, w = this.world, old = w.at(j);
    if (old !== -1) w.destroy(old);
    const e = w.attach(w.createAt(j), ...SWARM_COMPONENTS, ...extra);
    this.linked[i] = uid;
    this.prev.x[i] = this.x[i]; this.prev.y[i] = this.y[i]; this.prev.z[i] = this.z[i]; this.prev.heading[i] = this.heading[i];
    return e;
  }

  /** Slot i's member died or went: its entity goes (the id goes stale). */
  unlink(i: number) {
    const e = this.world.at(this.base + i);
    if (e !== -1) this.world.destroy(e);
  }

  /** Entities to match `live` (after a snapshot overwrote the swarm): a slot whose uid changed since its entity was made
   *  (reused between snapshots) gets a new one, through `make` (the kind's own link). */
  relink(hi: number, live: (i: number) => boolean, uid: ArrayLike<number>, make: (i: number) => void) {
    for (let i = 0; i < this.slots; i++) {
      const on = i < hi && live(i), has = this.world.at(this.base + i) !== -1;
      if (on && (!has || this.linked[i] !== uid[i])) make(i);
      else if (!on && has) this.unlink(i);
    }
  }

  /** Last tick's Transform: the start of each update. */
  keepPrevious(hi: number) {
    const p = this.prev;
    p.x.set(this.x.subarray(0, hi)); p.y.set(this.y.subarray(0, hi)); p.z.set(this.z.subarray(0, hi)); p.heading.set(this.heading.subarray(0, hi));
  }

  /** Team, Collider and armour of slot i, as the register is published. */
  publish(i: number, team: number, unitKind: number, radius: number, foot: number, reach: number, height: number, armour: number) {
    this.team[i] = team; this.unitKind[i] = unitKind;
    this.radius[i] = radius; this.foot[i] = foot; this.reach[i] = reach; this.height[i] = height;
    this.armour[i] = armour;
  }
}
