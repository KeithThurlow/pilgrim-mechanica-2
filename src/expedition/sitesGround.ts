// The expedition's sites' part of the ground (split from sites.ts so the sim worker can build it without the drawing):
// where POIs go, their pads and the fortress and hub walls, stacked on the field's modifiers.
import type { DuneField } from "../world/terrain";
import { PoiField, type PoiPlacement, type PoiValues } from "../world/pois";
import { PoiPads, rawGround } from "../world/poiPads";
import { addModifier } from "../world/modifiers";
import { SiegeWalls, type SiegeValues } from "../pois/fortressGround";

/** Where the road keeps POIs off: its corridor, laid or still to be cut (the expedition's `blocked`). */
export const roadBlocks = (route: { corridor(x: number, z: number): number }) => (x: number, z: number) => route.corridor(x, z) > 0.02;

/**
 * The sites' part of the ground: placement (its own raw copy of the dunes), the POI pads and the fortress and hub walls,
 * stacked on the field's modifiers. Pure given the calls made on it, so the sim worker builds its own from the same
 * calls (src/sim/groundMirror.ts).
 */
export class SitesGround {
  readonly raw: ReturnType<typeof rawGround>;
  readonly pois: PoiField;
  readonly pads: PoiPads;
  readonly walls: SiegeWalls;
  private skipMemo = new Map<string, boolean>();
  /** A placement's skip worked out (for the ground mirror: the worker takes the main thread's answer). */
  onSkip: ((id: string, skip: boolean) => void) | null = null;

  constructor(v: PoiValues & SiegeValues, field: DuneField, private blocked: (x: number, z: number) => boolean) {
    this.raw = rawGround(field);
    this.pois = new PoiField(v, this.raw);
    this.pads = new PoiPads(this.pois);
    addModifier(field, this.pads);
    this.walls = new SiegeWalls(this.pois, v);
    addModifier(field, this.walls);
    // Asked for every ground sample near a fortress or hub (perf pass 2026-10-31: 13 road lookups per sample made a chunk
    // there cost 30+ ms), so remembered per placement until the road grows (roadGrew) or the sites rebuild.
    this.walls.skip = (p) => {
      let b = this.skipMemo.get(p.id);
      if (b === undefined) { b = this.blocked(p.x, p.z) || this.edgeBlocked(p); this.skipMemo.set(p.id, b); this.onSkip?.(p.id, b); }
      return b;
    };
    SitesGround.made?.(this, field);
  }

  /** Told of every SitesGround made (the ground recorder takes the convoy lab's one from here). */
  static made: ((g: SitesGround, field: DuneField) => void) | null = null;

  /** Keep generated POIs clear of a circle (call rebuild after). */
  keepClear(x: number, z: number, r: number) { this.pois.keepClear = [{ x, z, r }]; }
  /** The road has new points: forget which fortresses and hubs it runs into. */
  roadGrew() { this.skipMemo.clear(); }
  /** Placement or dune values changed: placed again. */
  rebuild() {
    this.skipMemo.clear();
    this.raw.refresh();
    this.pois.reset();
    this.walls.reset();
  }
  /** Take another thread's answer for a placement's skip. */
  setSkip(id: string, skip: boolean) { this.skipMemo.set(id, skip); }

  /** A fortress or hub the road runs into anywhere round its pad's edge (not only at its centre). */
  edgeBlocked(p: PoiPlacement) {
    const r = p.pad ? p.pad.r + p.pad.blend : p.reach;
    for (let k = 0; k < 12; k++) if (this.blocked(p.x + Math.sin(k * 0.5236) * r, p.z + Math.cos(k * 0.5236) * r)) return true;
    return false;
  }
}
