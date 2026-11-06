// A high value target on the field (glue; docs/proposal-quests.md): one rival Rampart (src/game/fieldRival.ts: the
// duel lab's brain on a rolled loadout), put down where hvt.ts summons it and fighting the player's mech inside its
// lair's circle, at Veteran.
// Host owned (rule 12): its health, its loadout (seeded by the lair), its brain and its summons; drawing is cosmetic.
import type * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import { FieldRival, type FieldRivalValues, type RivalSetup } from "../game/fieldRival";
import type { Lair, HvtValues } from "./hvt";

/** HVT paint: soot black (the rival military is blue-grey, bandits red). */
export const HVT_PAINT = 0x2b2622;

export type HvtSetup = RivalSetup;

export class HvtMech extends FieldRival {
  lair: Lair | null = null;

  constructor(bf: Battlefield, scene: THREE.Scene, private hv: FieldRivalValues & HvtValues, player: MechUnit) {
    super(bf, scene, hv, player);
  }

  /**
   * Put the lair's mech down at (x, z), facing the lair, its items rolled at `level` (seeded by the lair). Resolves
   * false when it can't (no setup: headless, or the body failed to load).
   */
  async spawn(lair: Lair, x: number, z: number, level: number): Promise<boolean> {
    const ok = await this.put({ seed: lair.seed, x, z, face: Math.atan2(lair.x - x, lair.z - z), level, arena: { x: lair.x, z: lair.z, r: this.hv.hvtArena }, hull: this.hv.hvtHull, ai: "veteran", paint: HVT_PAINT });
    if (ok) this.lair = lair;
    return ok;
  }

  /** Off the field (gone to ground, or its wreck cleared). */
  override despawn() { super.despawn(); this.lair = null; }
}
