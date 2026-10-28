// Loot out in the field (glue; the rules are drops.ts and expedition.ts, the rest is drawing and sound): stripped
// spots burst into scrap clumps that fly to the mech with a coin jingle each, and may drop an item; killed robots may
// drop one by size. Drops lie on the sand with a beam (dropsDraw.ts) until the mech or the pilot walks over them, then
// join the at-risk list. The loot panel (lootHud.ts) shows the list, the banking count-in and the loss.
// Ownership: drops, pick-ups and the at-risk list are host state (seeded, events); clumps, beams, sounds and the panel
// are cosmetic.
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import type { RobotSwarm } from "../combat/robots";
import type { Expedition } from "./expedition";
import type { SpotState } from "../pois/salvage";
import type { Rarity } from "../items/rarity";
import { tierOf } from "../items/rarity";
import type { LootValues } from "../items/generate";
import { DropField, DROP_DEFAULTS, DROP_PARAMS, itemName, type Collector, type DropContext } from "./drops";
import { DropsDraw, DROP_FX_DEFAULTS, DROP_FX_PARAMS } from "./dropsDraw";
import { ScrapClumps, CLUMP_DEFAULTS, CLUMP_PARAMS } from "./scrapClumps";
import { LootHud, LOOT_HUD_DEFAULTS, LOOT_HUD_PARAMS } from "./lootHud";
import { LootSound, LOOT_SOUND_DEFAULTS, LOOT_SOUND_PARAMS } from "../audio/lootSound";

export const FIELD_LOOT_DEFAULTS = {
  ...DROP_DEFAULTS, ...DROP_FX_DEFAULTS, ...CLUMP_DEFAULTS, ...LOOT_HUD_DEFAULTS, ...LOOT_SOUND_DEFAULTS,
  bigHaul: 40, streakGap: 0.4,
};
export type FieldLootValues = typeof FIELD_LOOT_DEFAULTS;
export const FIELD_LOOT_PARAMS: Param[] = [
  ...DROP_PARAMS, ...DROP_FX_PARAMS, ...CLUMP_PARAMS, ...LOOT_HUD_PARAMS, ...LOOT_SOUND_PARAMS,
  { key: "bigHaul", label: "A big haul is (scrap)", min: 5, max: 500, step: 5, group: "Loot", tip: "A stripped spot worth this much ends its clumps on a bigger chime" },
  { key: "streakGap", label: "Clink streak breaks after (s)", min: 0.05, max: 2, step: 0.05, group: "Loot", tip: "Clumps landing closer together than this climb the scale" },
];

/** Who's out there this frame (the glue's view). */
export interface LootFrame {
  /** The mech's hull (clumps fly here) and whether it can grab drops (driven, alive, on the sand). */
  mech: { x: number; y: number; z: number; grabs: boolean };
  /** The pilot on foot (alive), else null: clumps fly to him and he grabs drops. */
  pilot: { x: number; y: number; z: number } | null;
}

export class FieldLoot {
  readonly drops: DropField;
  readonly draw: DropsDraw;
  readonly clumps: ScrapClumps;
  readonly sound: LootSound;
  readonly hud: LootHud;
  private streak = 0;
  private lastCoin = -1;
  private t = 0;
  private forced = 0;
  private collectors: Collector[] = [];

  constructor(
    readonly v: FieldLootValues & LootValues & { bankShow: number }, scene: THREE.Scene, private field: DuneField, ctx: AudioContext, hudSlot: HTMLElement,
    private exp: Expedition, private at: (x: number, z: number) => DropContext, seed = 0x10a7,
  ) {
    this.drops = new DropField(v, seed);
    this.draw = new DropsDraw(v, field);
    this.clumps = new ScrapClumps(v);
    scene.add(this.draw.group, this.clumps.group);
    this.sound = new LootSound(ctx, v);
    this.hud = new LootHud(v, this.sound, hudSlot);
    this.clumps.onArrive = (_amount, last, total) => {
      this.streak = this.t - this.lastCoin < this.v.streakGap ? this.streak + 1 : 0;
      this.lastCoin = this.t;
      this.sound.coin(this.streak, last && total >= this.v.bigHaul);
    };
  }

  /** Robots dying may drop items (chained onto the swarm's onDeath). */
  watch(sw: RobotSwarm) {
    const prev = sw.onDeath;
    sw.onDeath = (i, nx, nz, speed) => {
      prev?.(i, nx, nz, speed);
      if (this.exp.state !== "out") return;
      const x = sw.px[i], z = sw.pz[i];
      this.drops.fromKill(`${i}.${sw.gen[i]}`, sw.kind[i], x, z, this.at(x, z));
    };
  }

  /** A spot stripped: its scrap flies in, and it may drop an item. */
  spotDone(s: SpotState, scrap: number) {
    this.clumps.burst(s.x, this.field.height(s.x, s.z), s.z, scrap);
    this.drops.fromSpot(s.id, s.x, s.z, this.at(s.x, s.z));
  }

  /** A drop of this rarity (and level) a few metres ahead of (x, z) (the lab's ?drop=rarity,level). */
  force(rarity: Rarity, x: number, z: number, heading: number, level?: number) {
    const k = this.forced++, a = heading + (k % 5 - 2) * 0.35;
    const px = x + Math.sin(a) * 14, pz = z + Math.cos(a) * 14;
    return this.drops.roll(`forced:${k}`, 1, px, pz, this.at(px, pz), { rarity, level: level ?? this.drops.levelAt(Math.random, this.at(px, pz).depth) });
  }

  update(dt: number, f: LootFrame) {
    this.t += dt;
    const c = this.collectors;
    c.length = 0;
    if (f.pilot) c.push({ x: f.pilot.x, z: f.pilot.z, by: "pilot" });
    else if (f.mech.grabs) c.push({ x: f.mech.x, z: f.mech.z, by: "mech" });
    this.drops.update(c, this.exp.state === "out");
    for (const ev of this.drops.events) {
      if (ev.type === "dropped") { this.draw.add(ev.drop); this.sound.drop(tierOf(ev.drop.item.rarity)); }
      else if (ev.type === "picked") {
        this.draw.picked(ev.drop.id);
        this.exp.add({ kind: "item", item: ev.drop.item, label: itemName(ev.drop.item) });
        this.sound.pickup(tierOf(ev.drop.item.rarity));
      } else this.draw.remove(ev.id);
    }
    this.drops.events.length = 0;
    const to = f.pilot ?? f.mech;
    this.clumps.update(dt, to.x, to.y, to.z);
    this.draw.update(dt);
    if (this.exp.events.some((e) => e.type === "lost")) this.clumps.clear();
    this.hud.events(this.exp.events, this.exp);
    this.exp.events.length = 0;
    this.hud.update(dt, this.exp, this.clumps.inFlight);
  }
}
