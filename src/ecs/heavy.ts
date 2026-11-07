// Heavy things as ECS entities (docs/architecture-review.md stage 5): mechs, vehicles, crushers, striders. Their sims
// aren't flat (a walker's legs, a car's wheels), so they stay objects (review §4.1: the `Sim` object component holds
// the thing itself) and each tick the world gets what the rest of the game reads from them: Transform (PrevTransform
// the tick before), Health, Team, Collider, Armour, and a Bar when it shows a health bar. A handful of these a tick
// costs nothing, unlike the swarms (which own their columns, src/ecs/swarmBlock.ts).
// Lifecycle: an entity while it is alive and on the battlefield (CombatRules.syncWorld calls `sync` each tick and
// `leave` when it leaves the targets); destroyed when it dies or leaves, a new one when it comes back (a respawn), so a
// kept id goes stale. Ownership: host (a mirror of host state). Pure.
import type { World, Entity } from "./world";
import { defineObjects } from "./world";
import { Transform, PrevTransform, Health, Team, Collider, Armour, Bar } from "./components";

/** The heavy sim itself (a MechUnit, a car...), by entity: the rest of the world reads the flat components. */
export const Sim = defineObjects<object>("Sim", { replicate: "local" });

/** What a heavy reports each tick. y: its body's centre or ground point, as its kind says; bar: null for none. */
export interface HeavyState {
  x: number; y: number; z: number; heading: number;
  hp: number; max: number; team: number; kind: number;
  radius: number; reach: number; height: number; armour: number;
  bar: { width: number; lift: number; always: boolean } | null;
}

/** A fresh state to fill each tick (kept by the heavy, so syncing allocates nothing). */
export function heavyState(kind: number, bar: HeavyState["bar"] = null): HeavyState {
  return { x: 0, y: 0, z: 0, heading: 0, hp: 0, max: 0, team: 0, kind, radius: 0, reach: 0, height: 0, armour: 0, bar };
}

export class HeavyLink {
  private world: World | null = null;
  private e: Entity | -1 = -1;

  /** The entity now (-1: none). */
  get entity(): Entity | -1 { return this.world && this.e !== -1 && this.world.exists(this.e) ? this.e : -1; }

  /** Each tick: alive, write its state (making the entity if it has none); dead, end it. */
  sync(world: World, alive: boolean, sim: object, s: HeavyState) {
    if (this.world !== world) { this.leave(); this.world = world; }
    if (!alive) { this.leave(); this.world = world; return; }
    let fresh = false;
    if (this.e === -1 || !world.exists(this.e)) {
      this.e = world.create();
      world.add(this.e, Transform); world.add(this.e, PrevTransform); world.add(this.e, Health); world.add(this.e, Team);
      world.add(this.e, Collider); world.add(this.e, Armour); world.addObject(this.e, Sim, sim);
      fresh = true;
    }
    const e = this.e, j = e & 0xfffff;
    // Columns fetched after create: a growing world replaces them.
    const T = world.columns(Transform), P = world.columns(PrevTransform);
    if (fresh) { P.x[j] = s.x; P.y[j] = s.y; P.z[j] = s.z; P.heading[j] = s.heading; }
    else { P.x[j] = T.x[j]; P.y[j] = T.y[j]; P.z[j] = T.z[j]; P.heading[j] = T.heading[j]; }
    T.x[j] = s.x; T.y[j] = s.y; T.z[j] = s.z; T.heading[j] = s.heading;
    const H = world.columns(Health); H.hp[j] = s.hp; H.max[j] = s.max;
    const M = world.columns(Team); M.team[j] = s.team; M.kind[j] = s.kind;
    const C = world.columns(Collider); C.radius[j] = s.radius; C.foot[j] = 0; C.reach[j] = s.reach; C.height[j] = s.height;
    world.columns(Armour).flat[j] = s.armour;
    if (s.bar) {
      if (!world.has(e, Bar)) world.add(e, Bar);
      const B = world.columns(Bar); B.width[j] = s.bar.width; B.lift[j] = s.bar.lift; B.always[j] = s.bar.always ? 1 : 0;
    } else if (world.has(e, Bar)) world.remove(e, Bar);
  }

  /** Off the battlefield or dead: the entity goes (its id goes stale). */
  leave() {
    if (this.world && this.e !== -1) this.world.destroy(this.e);
    this.e = -1;
  }
}
