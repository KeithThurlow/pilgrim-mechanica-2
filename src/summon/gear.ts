// Summoner gear onto the summons (Keith 2026-11-02: "the backpack provides your core summons ... drone summons come
// out of your shoulders, and ... the swarms come out of there too"). Pure: a resolved loadout's summons
// (src/items/loadout.ts Resolved.summons) become the summons' counts and build times, and the shoulder keys that
// throw the swarm. With no summoner gear fitted every count is 0, so the summons sit idle.
// Ownership: host (what the owner's loadout brings out).
import type { Resolved } from "../items/loadout";
import type { SummonValues } from "./summons";

/** The summons' values a loadout sets (everything else stays on the sliders). */
export type GearValues = Pick<SummonValues, "repCount" | "repBuild" | "repRebuild" | "droneCount" | "droneRebuild" | "swarmCount" | "swarmRebuild" | "compCount">;

export function gearValues(r: Resolved): GearValues {
  const s = r.summons;
  return {
    repCount: s.replicas, repBuild: s.replicaBuild, repRebuild: s.replicaRebuild,
    droneCount: s.drones, droneRebuild: s.droneRebuild,
    swarmCount: s.scrappers, swarmRebuild: s.swarmRebuild,
    compCount: 0,
  };
}

/** Put a loadout's summoner gear into the values the summons read. */
export function applyGear(v: SummonValues, r: Resolved) { Object.assign(v, gearValues(r)); }

/** Does a press of shoulder key `key` (1 or 2) throw or call back the swarm? (A swarm hive is fitted on that side.) */
export function isSwarmKey(r: Resolved, key: number) { return (r.summons.swarmKeys as number[]).includes(key); }
