// Loot out in the field (glue; the rules are drops.ts and expedition.ts, the rest is drawing and sound): stripped
// spots burst into scrap clumps that fly to the mech with a coin jingle each, and may drop an item; killed robots may
// drop one by size. Drops lie on the sand with a beam (dropsDraw.ts) and a label (dropLabels.ts: name, level, power,
// DPS) until the mech or the pilot takes one with E (Keith 2026-11-06: a choice, not a walk-over), then join the
// at-risk list. The loot panel (lootHud.ts) shows the list, the banking count-in and the loss.
// Ownership: drops, pick-ups and the at-risk list are host state (seeded, events); clumps, beams, sounds and the panel
// are cosmetic.
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import { MID, QUAD_WEAPON, QUAD_DROP, type RobotSwarm } from "../combat/robots";
import type { Expedition } from "./expedition";
import type { SpotState } from "../pois/salvage";
import type { Rarity } from "../items/rarity";
import { tierOf } from "../items/rarity";
import { itemWeight } from "../items/item";
import { VALUE_DEFAULTS, VALUE_PARAMS } from "../items/value";
import type { LootValues } from "../items/generate";
import { DropField, DROP_DEFAULTS, DROP_PARAMS, hashKey, itemName, type Collector, type DropContext } from "./drops";
import { DropsDraw, DROP_FX_DEFAULTS, DROP_FX_PARAMS } from "./dropsDraw";
import { DropLabels, DROP_LABEL_DEFAULTS, DROP_LABEL_PARAMS } from "./dropLabels";
import type { Drop } from "./drops";
import { ScrapClumps, CLUMP_DEFAULTS, CLUMP_PARAMS } from "./scrapClumps";
import { LootHud, LOOT_HUD_DEFAULTS, LOOT_HUD_PARAMS } from "./lootHud";
import { LootSound, LOOT_SOUND_DEFAULTS, LOOT_SOUND_PARAMS } from "../audio/lootSound";
import { robotThreat } from "./threat";

export const FIELD_LOOT_DEFAULTS = {
  ...VALUE_DEFAULTS, ...DROP_DEFAULTS, ...DROP_FX_DEFAULTS, ...DROP_LABEL_DEFAULTS, ...CLUMP_DEFAULTS, ...LOOT_HUD_DEFAULTS, ...LOOT_SOUND_DEFAULTS,
  bigHaul: 40, streakGap: 0.4,
  dropHearFull: 50, dropHearMax: 160,
  cargoLimit: 1, scrapWeight: 0.02, cargoWarn: 0.85, cargoFullNote: 3,
};
export type FieldLootValues = typeof FIELD_LOOT_DEFAULTS;
export const FIELD_LOOT_PARAMS: Param[] = [
  ...VALUE_PARAMS, ...DROP_PARAMS, ...DROP_FX_PARAMS, ...DROP_LABEL_PARAMS, ...CLUMP_PARAMS, ...LOOT_HUD_PARAMS, ...LOOT_SOUND_PARAMS,
  { key: "bigHaul", label: "A big haul is (scrap)", min: 5, max: 500, step: 5, group: "Loot", tip: "A stripped spot worth this much ends its clumps on a bigger chime" },
  { key: "dropHearFull", label: "Drop sound: full volume within (m)", min: 0, max: 300, step: 5, group: "Loot", tip: "Keith 2026-10-31: drops far off were heard from the convoy. Closer to you than this, a drop's riff plays in full" },
  { key: "dropHearMax", label: "Drop sound: silent past (m)", min: 10, max: 1000, step: 5, group: "Loot", tip: "Fades out between the two; a drop further off than this makes no sound" },
  // Cargo (Keith 2026-11-01: manage the cargo, drop things, rather than let it rack up).
  { key: "cargoLimit", label: "Cargo limit on", min: 0, max: 1, step: 1, group: "Cargo", tip: "1: the at-risk cargo can't go over the mech's cargo capacity (legs' carry + hull and waist racks). 0: carry anything, as before" },
  { key: "scrapWeight", label: "Scrap weight (t each)", min: 0, max: 0.2, step: 0.005, group: "Cargo", tip: "What one scrap weighs in the cargo. 0.02: 100 scrap is 2 t; the default Rampart carries 12 t" },
  { key: "cargoWarn", label: "Cargo nearly full at (share)", min: 0.3, max: 1, step: 0.01, group: "Cargo", tip: "The cargo bar turns amber past this share of capacity" },
  { key: "cargoFullNote", label: "\"Cargo full\" note every (s)", min: 0.5, max: 15, step: 0.5, group: "Cargo", tip: "Standing by a drop with a full cargo says so at most this often" },
  { key: "streakGap", label: "Clink streak breaks after (s)", min: 0.05, max: 2, step: 0.05, group: "Loot", tip: "Clumps landing closer together than this climb the scale" },
];

/** Who's out there this frame (the glue's view). */
export interface LootFrame {
  /** The mech's hull (clumps fly here) and whether it can grab drops (driven, alive, on the sand). */
  mech: { x: number; y: number; z: number; grabs: boolean };
  /** The pilot on foot (alive), else null: clumps fly to him and he grabs drops. */
  pilot: { x: number; y: number; z: number } | null;
  /** E pressed this frame for a drop (the glue decided E goes to the drop, not a salvage spot): take the nearest in reach. */
  grab?: boolean;
  /** For the labels over the drops (none drawn without them). */
  camera?: THREE.Camera; canvas?: HTMLCanvasElement;
}

/** How loud a drop this far (m) from you plays: 1 within dropHearFull, easing to 0 at dropHearMax. */
export function dropHearing(v: { dropHearFull: number; dropHearMax: number }, dist: number): number {
  const a = Math.max(0, v.dropHearFull), b = Math.max(a + 1, v.dropHearMax);
  if (dist <= a) return 1;
  if (dist >= b) return 0;
  const t = 1 - (dist - a) / (b - a);
  return t * t * (3 - 2 * t);
}

export class FieldLoot {
  readonly drops: DropField;
  readonly draw: DropsDraw;
  readonly labels: DropLabels;
  readonly clumps: ScrapClumps;
  readonly sound: LootSound;
  readonly hud: LootHud;
  private streak = 0;
  private lastCoin = -1;
  private t = 0;
  private forced = 0;
  private collectors: Collector[] = [];
  private fullT = 0;
  /** The cargo refused a drop (the glue shows a note; throttled by cargoFullNote). */
  onFull: ((text: string) => void) | null = null;

  constructor(
    readonly v: FieldLootValues & LootValues & { bankShow: number }, scene: THREE.Scene, private field: DuneField, ctx: AudioContext, hudSlot: HTMLElement,
    private exp: Expedition, private at: (x: number, z: number) => DropContext, seed = 0x10a7,
  ) {
    this.drops = new DropField(v, seed);
    this.draw = new DropsDraw(v, field);
    this.labels = new DropLabels(v, (x, z) => field.height(x, z));
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
      this.drops.fromKill(`${i}.${sw.gen[i]}`, robotThreat(sw.kind[i], sw.v), x, z, this.at(x, z));
      // A weapon quad drops its weapon (Keith 2026-11-01) now and then, on top of the usual roll.
      if (sw.kind[i] === MID && sw.variant[i] === QUAD_WEAPON) this.drops.roll(`gun:${i}.${sw.gen[i]}`, sw.v.robotQuadDrop, x, z, this.at(x, z), { base: QUAD_DROP[sw.weapon[i]] });
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

  /** The drop E would take now: the nearest in reach of the pilot on foot, else of the mech (null: none, or not out). */
  target(f: Pick<LootFrame, "mech" | "pilot">): Drop | null {
    if (this.exp.state !== "out") return null;
    if (f.pilot) return this.drops.nearest(f.pilot.x, f.pilot.z, this.drops.reach("pilot"));
    return f.mech.grabs ? this.drops.nearest(f.mech.x, f.mech.z, this.drops.reach("mech")) : null;
  }

  update(dt: number, f: LootFrame) {
    this.t += dt;
    const c = this.collectors, grab = !!f.grab;
    c.length = 0;
    if (f.pilot) c.push({ x: f.pilot.x, z: f.pilot.z, by: "pilot", grab });
    else if (f.mech.grabs) c.push({ x: f.mech.x, z: f.mech.z, by: "mech", grab });
    const exp = this.exp;
    exp.scrapWeight = this.v.cargoLimit ? this.v.scrapWeight : 0;
    if (!this.v.cargoLimit) exp.capacity = Infinity;
    this.drops.update(c, exp.state === "out", (d) => exp.fits({ kind: "item", item: d.item, label: "" }));
    const ear = f.pilot ?? f.mech;
    this.fullT -= dt;
    // Dropped from the cargo (the inventory): an item goes down as a crate beside whoever dropped it.
    for (const ev of exp.events) {
      if (ev.type !== "dropped" || ev.loot.kind !== "item") continue;
      const a = (hashKey(0x1a1d, ev.loot.item.id) / 2 ** 32) * Math.PI * 2;
      this.drops.place(ev.loot.item, ear.x + Math.sin(a) * 2.5, ear.z + Math.cos(a) * 2.5);
    }
    for (const ev of this.drops.events) {
      if (ev.type === "refused") {
        if (this.fullT <= 0) { this.fullT = this.v.cargoFullNote; this.onFull?.(`Cargo full · ${itemName(ev.drop.item)} needs ${itemWeight(ev.drop.item).toFixed(1)} t, ${Math.max(0, exp.room).toFixed(1)} t free · I: drop something`); }
        continue;
      }
      if (ev.type === "dropped") {
        this.draw.add(ev.drop);
        const g = dropHearing(this.v, Math.hypot(ev.drop.x - ear.x, ev.drop.z - ear.z));
        if (g > 0) this.sound.drop(tierOf(ev.drop.item.rarity), g);
      }
      else if (ev.type === "picked") {
        this.draw.picked(ev.drop.id);
        this.exp.add({ kind: "item", item: ev.drop.item, label: itemName(ev.drop.item) });
        this.sound.pickup(tierOf(ev.drop.item.rarity));
      } else if (ev.type === "forgotten") this.draw.remove(ev.id);
    }
    this.drops.events.length = 0;
    this.clumps.update(dt, ear.x, ear.y, ear.z);
    this.draw.update(dt);
    if (f.camera && f.canvas) {
      const t = this.v.autoPickup >= 0.5 ? null : this.target(f);
      const full = !!t && !exp.fits({ kind: "item", item: t.item, label: "" });
      this.labels.update(f.camera, f.canvas, this.drops.drops, ear, t, full, this.hud.fitted(), exp.state === "out");
    }
    if (this.exp.events.some((e) => e.type === "lost")) this.clumps.clear();
    this.hud.events(this.exp.events, this.exp);
    this.exp.events.length = 0;
    this.hud.update(dt, this.exp, this.clumps.inFlight);
  }
}
