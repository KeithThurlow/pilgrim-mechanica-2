// The POIs out in the sand for the expedition (glue, the POI lab's streaming without its showcase): the pure placement
// (src/world/pois.ts) with its pads stacked on the convoy's road, sites built and drawn within drawRadius of the mech,
// salvage with E, stripped spots remembered when a site streams out and back in. Each stripped spot hands its scrap
// to onLoot (the expedition's at-risk list) rather than a counter; stripping noise goes to onNoise (swarm camps).
// POIs the road has run over (or will: inside its reach when they stream in) aren't built.
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import { POI_DEFAULTS, POI_KINDS, PoiField, type PoiPlacement } from "../world/pois";
import { PoiPads, rawGround } from "../world/poiPads";
import { addModifier } from "../world/modifiers";
import { SITE_DEFAULTS, buildSite } from "../pois/kinds";
import { SiegeWalls, isSiege } from "../pois/fortressGround";
import type { PoiSite } from "../pois/site";
import { PoiDraw } from "../pois/poiDraw";
import { SalvageSim, SALVAGE_DEFAULTS, type SpotState } from "../pois/salvage";
import { SalvageDraw, SALVAGE_FX_DEFAULTS } from "../pois/salvageDraw";
import type { Battlefield } from "../game/battlefield";

// Out on expeditions the POIs sit a little closer together than the POI lab's defaults (2026-10-26, after Keith's
// playtest found the loop a bit slow): smaller cells, more of them filled.
export const SITES_DEFAULTS = { ...POI_DEFAULTS, poiCell: 330, poiChance: 0.85, ...SITE_DEFAULTS, ...SALVAGE_DEFAULTS, ...SALVAGE_FX_DEFAULTS, drawRadius: 700 };
export type SitesValues = typeof SITES_DEFAULTS;
export const SITES_PARAMS: Param[] = [
  { key: "drawRadius", label: "Build POIs within (m)", min: 200, max: 3000, step: 50, group: "POI placement", tip: "Generated POIs this close to the mech are built and drawn (the radar sees further)" },
];

export class FieldSites {
  readonly pois: PoiField;
  readonly pads: PoiPads;
  /** Fortress and hub walls in the ground (gates down kept in walls.down). */
  readonly walls: SiegeWalls;
  readonly salvage: SalvageSim;
  readonly fx: SalvageDraw;
  private raw: ReturnType<typeof rawGround>;
  private skipMemo = new Map<string, boolean>();
  private drawn = new Map<string, PoiDraw>();
  private memory = new Map<string, { progress: number; done: boolean }>();
  /** Sites made on the sand by what happens there (the wrecks a clash leaves): kept, built and drawn like any POI. */
  private extra = new Map<string, PoiSite>();
  private syncT = 0;
  /** A spot stripped: its POI's label and the scrap it paid. */
  onLoot: ((label: string, scrap: number, s: SpotState) => void) | null = null;
  /** Stripping noise (for the swarm camps). */
  onNoise: ((x: number, z: number, radius: number) => void) | null = null;

  constructor(
    readonly v: SitesValues, private field: DuneField, bf: Battlefield, private scene: THREE.Scene,
    /** True where a POI shouldn't be (the road). */
    private blocked: (x: number, z: number) => boolean,
  ) {
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
      if (b === undefined) { b = this.blocked(p.x, p.z) || this.edgeBlocked(p); this.skipMemo.set(p.id, b); }
      return b;
    };
    this.salvage = new SalvageSim(v);
    this.fx = new SalvageDraw(this.salvage, bf, v);
    scene.add(this.fx.group);
    this.salvage.onNoise = (x, z, r) => { this.fx.pulse(x, z); this.onNoise?.(x, z, r); };
    this.salvage.onDone = (s) => {
      this.fx.burst(s);
      const d = this.drawn.get(s.poi);
      this.onLoot?.(d ? POI_KINDS[d.site.place.kind].label : "Salvage", this.salvage.pay(s), s);
    };
  }

  /** Keep clear of the start (the convoy rolls out from there). */
  keepClear(x: number, z: number, r: number) { this.pois.keepClear = [{ x, z, r }]; this.rebuild(); }

  /** Placement or dune values changed: start over (stripped spots forgotten). */
  /** The road has new points: forget which fortresses and hubs it runs into. */
  roadGrew() { this.skipMemo.clear(); }

  rebuild() {
    this.skipMemo.clear();
    this.extra.clear();
    this.raw.refresh();
    this.pois.reset();
    this.walls.reset();
    for (const id of [...this.drawn.keys()]) this.drop(id);
    this.memory.clear();
    this.syncT = 0;
  }

  /** Generated POIs in a box, without the ones the road has taken. */
  poisIn(x0: number, z0: number, x1: number, z1: number): PoiPlacement[] {
    const out = this.pois.poisIn(x0, z0, x1, z1).filter((p) => !this.blocked(p.x, p.z) && !(isSiege(p) && this.edgeBlocked(p)));
    for (const s of this.extra.values()) { const p = s.place; if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) out.push(p); }
    return out;
  }

  /** A fortress or hub the road runs into anywhere round its pad's edge (not only at its centre). */
  private edgeBlocked(p: PoiPlacement) {
    const r = p.pad ? p.pad.r + p.pad.blend : p.reach;
    for (let k = 0; k < 12; k++) if (this.blocked(p.x + Math.sin(k * 0.5236) * r, p.z + Math.cos(k * 0.5236) * r)) return true;
    return false;
  }

  /** A site made on the sand (a clash's wreckage): from now on it is a POI with spots to strip. */
  addExtra(site: PoiSite) {
    this.extra.set(site.place.id, site);
    if (!this.drawn.has(site.place.id)) this.add(site.place);
  }

  /** Is this POI stripped bare (every spot done, as far as we've seen)? */
  stripped(p: PoiPlacement): boolean {
    let any = false;
    for (const s of this.salvage.spots) if (s.poi === p.id) { any = true; if (!s.done) return false; }
    if (any) return true;
    for (const [k, m] of this.memory) if (k.startsWith(p.id + "#")) { if (!m.done) return false; any = true; }
    return any;
  }

  /** One frame: stream sites round the mech's hips and strip with E held. */
  update(dt: number, x: number, z: number, holding: boolean, camera: THREE.Camera, foot?: { reach: number; rate: number; noise: number }) {
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 0.5; this.sync(x, z); }
    if (foot) this.salvage.update(dt, x, z, holding, foot.reach, foot.rate, foot.noise, false);
    else this.salvage.update(dt, x, z, holding);
    this.fx.update(dt, camera, x, z);
  }

  get count() { return this.drawn.size; }
  /** Every built POI's meshes (hold-V). */
  meshes(): THREE.Object3D[] { return [...this.drawn.values()].flatMap((d) => d.meshes); }

  private sync(x: number, z: number) {
    const R = this.v.drawRadius;
    const want = this.poisIn(x - R, z - R, x + R, z + R);
    const ids = new Set(want.map((w) => w.id));
    for (const id of [...this.drawn.keys()]) if (!ids.has(id)) this.drop(id);
    for (const w of want) if (!this.drawn.has(w.id)) this.add(w);
  }

  private add(p: PoiPlacement) {
    const site = this.extra.get(p.id) ?? buildSite(p, this.v);
    const d = new PoiDraw(site, this.field);
    this.scene.add(d.group);
    this.drawn.set(p.id, d);
    this.salvage.add(site);
    for (const s of this.salvage.spots) {
      const m = s.poi === p.id ? this.memory.get(s.id) : undefined;
      if (m) { s.progress = m.progress; s.done = m.done; }
    }
  }

  private drop(id: string) {
    for (const s of this.salvage.spots) if (s.poi === id && (s.progress > 0 || s.done)) this.memory.set(s.id, { progress: s.progress, done: s.done });
    this.salvage.remove(id);
    const d = this.drawn.get(id);
    d?.dispose();
    this.drawn.delete(id);
  }
}
