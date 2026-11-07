// The shared components every kind of thing uses (docs/architecture-review.md §4.1). Kind-specific ones live with their
// kind (a robot's brain beside the robot systems). Units: metres, seconds, radians (CLAUDE.md). Pure.
import { defineComponent, type World } from "./world";

/** Where it is now (after the last tick). heading: radians, 0 faces +Z. */
export const Transform = defineComponent("Transform", { x: "f32", y: "f32", z: "f32", heading: "f32" });
/** Where it was the tick before, for drawing between ticks (alpha from src/core/clock.ts). Each side keeps its own. */
export const PrevTransform = defineComponent("PrevTransform", { x: "f32", y: "f32", z: "f32", heading: "f32" }, { replicate: "local" });
export const Velocity = defineComponent("Velocity", { x: "f32", y: "f32", z: "f32" });
/** Team (src/game/factions.ts numbers) and kind (src/game/register.ts KIND). */
export const Team = defineComponent("Team", { team: "u8", kind: "u8" });
export const Health = defineComponent("Health", { hp: "f32", max: "f32" });
/** Flat armour per hit and the armour type (src/game/armour.ts); matter for damage types (src/game/damageType.ts). */
export const Armour = defineComponent("Armour", { flat: "f32", type: "u8", matter: "u8" });
/** What hit tests and the register measure: body radius, footprint, hit reach, height. */
export const Collider = defineComponent("Collider", { radius: "f32", foot: "f32", reach: "f32", height: "f32" });
/** A health bar over it (src/game/entityBars.ts gathers them for src/ui/healthBars.ts): width (m), height above
 *  Transform.y (m), always shown (1) or only after a hit (0). Only things worth a bar have one. */
export const Bar = defineComponent("Bar", { width: "f32", lift: "f32", always: "u8" }, { replicate: "cosmetic" });
/** Status effects: burning (heat 0..1, seconds left), chill (pace 0..1: 1 normal, 0 frozen solid). */
export const Status = defineComponent("Status", { heat: "f32", burnLeft: "f32", pace: "f32" }, { defaults: { pace: 1 } });

/** Copy Transform into PrevTransform for every entity with both: the first thing a tick does. */
export function keepPrevious(world: World) {
  const q = world.query(Transform, PrevTransform), t = world.columns(Transform), p = world.columns(PrevTransform);
  for (let k = 0; k < q.count; k++) {
    const i = q.ids[k] & 0xfffff;
    p.x[i] = t.x[i]; p.y[i] = t.y[i]; p.z[i] = t.z[i]; p.heading[i] = t.heading[i];
  }
}

/** Where to draw entity index i between ticks: lerp from PrevTransform to Transform by alpha (heading the short way). */
export function drawnAt(world: World, i: number, alpha: number, out: { x: number; y: number; z: number; heading: number }) {
  const t = world.columns(Transform), p = world.columns(PrevTransform);
  out.x = p.x[i] + (t.x[i] - p.x[i]) * alpha;
  out.y = p.y[i] + (t.y[i] - p.y[i]) * alpha;
  out.z = p.z[i] + (t.z[i] - p.z[i]) * alpha;
  let d = t.heading[i] - p.heading[i];
  d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  out.heading = p.heading[i] + d * alpha;
  return out;
}
