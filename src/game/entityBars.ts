// Health bars from the ECS world (docs/architecture-review.md stage 4.3b): every entity with Transform, Health, Team, Armour
// and Bar on another team gives a bar (src/ui/healthBars.ts draws and fades them). Kinds that live in the world (the
// robot swarms today) get bars this way instead of each target adapter pushing its own; the rest still push theirs
// (Hittable.bars). Keyed by entity id, so a reused slot is a new bar. Pure (reads the world, no three).
import { World, entityIndex } from "../ecs/world";
import { Transform, Health, Team, Armour, Bar } from "../ecs/components";
import type { BarEntry } from "../ui/healthBars";

/** Push the bars of every entity in `world` not on `team` (the viewer's) into out. */
export function gatherBars(world: World, team: number, out: BarEntry[]) {
  const q = world.query(Transform, Health, Team, Armour, Bar);
  if (!q.count) return;
  const T = world.columns(Transform), H = world.columns(Health), M = world.columns(Team), A = world.columns(Armour), B = world.columns(Bar);
  for (let k = 0; k < q.count; k++) {
    const e = q.ids[k], j = entityIndex(e);
    if (M.team[j] === team) continue;
    out.push({ key: e, x: T.x[j], y: T.y[j] + B.lift[j], z: T.z[j], hp: H.hp[j], max: H.max[j] || H.hp[j], armour: A.flat[j], width: B.width[j], always: B.always[j] === 1 });
  }
}
