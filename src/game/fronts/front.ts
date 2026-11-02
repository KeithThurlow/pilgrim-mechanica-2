// A front: one kind of enemy on the swarm lab's field (Keith 2026-11-02: "collapse our swarm labs into one, where we can
// just adjust the kind of swarm based on enemy type, and potentially have all enemies turn up in a swarm").
// Each front gives its tuning (defaults, sliders, topics, hold-V entries, buttons) before the lab is made, then starts on
// the lab. Fronts share the field: the mech's body contact is one (stepped once a frame between the fronts' update and
// touch), and the mech's dash and stomp hooks are chained so every front's enemies get trampled.
import type * as THREE from "three/webgpu";
import type { Param } from "../../core/tweaks";
import type { CombatLab, CombatLabOptions, SelectEntry } from "../combatLab";
import type { BodyContact } from "../bodyContact";
import type { MechUnit } from "../mechUnit";
import type { DroidSquads } from "../droidFight";
import type { Summons } from "../../summon/summons";

export type FrontId = "robots" | "bandits" | "warband" | "droids" | "crusher";
export const FRONT_IDS: FrontId[] = ["robots", "bandits", "warband", "droids", "crusher"];
export const FRONT_LABELS: Record<FrontId, string> = { robots: "Robots", bandits: "Bandits", warband: "War band", droids: "Humanoids", crusher: "Crushers" };

export interface Topic { id: string; label: string; groups: string[] }
type Action = { label: string; onClick: () => void; active?: () => boolean };

export interface FrontSpec {
  defaults: Record<string, number>;
  params: Param[];
  topics: Topic[];
  selectables?: SelectEntry[];
  actions?: Action[];
  report?: () => Record<string, unknown>;
  onChange?: (key: string) => void;
  /** A scripted demo this front wants (null: none this frame). */
  demo?: CombatLabOptions<object>["demo"];
}

export interface FrontCtx {
  // The lab's values are the merge of every front's defaults: a front reads its own keys.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lab: CombatLab<any>;
  contact: BodyContact;
  q: URLSearchParams;
  /** The one set of humanoid squads on the field (the droids front and the robots' packs share it). */
  droids: () => Promise<DroidSquads>;
  /** The summoner's units on this field (?summon), or null: robots near them turn on them. */
  summons: () => Summons | null;
  /** Every front on this field, so one can stand down when another asks for a set piece. */
  fronts: ReadonlySet<FrontId>;
}

export interface Running {
  /** Each frame, before the mech's body contact steps. */
  update: (dt: number) => void;
  /** Each frame, after the body contact stepped: trampling, dodging, rams. */
  touch?: (dt: number) => void;
}

export interface Front {
  spec: FrontSpec;
  start: (ctx: FrontCtx) => Promise<Running>;
}

/** Add to one of the mech's hooks without dropping what another front put there. */
export function hook<K extends "onDash" | "onStomp">(unit: MechUnit, key: K, fn: NonNullable<MechUnit[K]>) {
  const prev = unit[key] as ((...a: number[]) => void) | null;
  const next = fn as (...a: number[]) => void;
  (unit as unknown as Record<K, (...a: number[]) => void>)[key] = prev ? (...a: number[]) => { prev(...a); next(...a); } : next;
}

export type Meshes = () => THREE.Object3D[];
