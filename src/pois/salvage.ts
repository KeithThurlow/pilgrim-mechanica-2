// Salvage (pure sim, no drawing): spots of scrap the mech strips by standing within reach and holding E (Keith
// 2026-10-25: hold E for now; one currency, scrap; item drops of various rarities later). A bar fills over the spot's
// strip time; walking out of reach pauses it (the progress stays); a finished spot pays its scrap at once, and when
// every spot in a section is done the section is banked (so leaving a POI half done still pays).
//
// Stripping is loud: while it runs, `onNoise` fires every `noiseEvery` seconds with the spot and a radius, for swarms
// and war bands to hear (nothing listens yet).
import type { Param } from "../core/tweaks";
import type { PoiSite, SpotDef } from "./site";

export const SALVAGE_DEFAULTS = { salvageReach: 7, stripSpeed: 1, scrapScale: 1, noiseEvery: 0.6, noiseRadius: 160 };
export type SalvageValues = typeof SALVAGE_DEFAULTS;
const G = "Salvage";
export const SALVAGE_PARAMS: Param[] = [
  { key: "salvageReach", label: "Reach (m)", min: 2, max: 15, step: 0.1, group: G, tip: "From the mech's hips to a spot, flat distance: closer than this and E strips it" },
  { key: "stripSpeed", label: "Strip speed", min: 0.1, max: 5, step: 0.05, group: G, tip: "Multiplies every spot's strip rate (2 = twice as fast)" },
  { key: "scrapScale", label: "Scrap multiplier", min: 0.1, max: 5, step: 0.05, group: G, tip: "Multiplies the scrap every spot pays" },
  { key: "noiseEvery", label: "Noise every (s)", min: 0.1, max: 3, step: 0.05, group: G, tip: "How often stripping sends out a noise other systems can hear" },
  { key: "noiseRadius", label: "Heard within (m)", min: 10, max: 600, step: 5, group: G },
];

export interface SpotState extends SpotDef {
  poi: string;
  /** 0..1 */
  progress: number;
  done: boolean;
}

export interface SectionState { poi: string; index: number; name: string; value: number; spots: SpotState[]; banked: boolean }

export class SalvageSim {
  readonly spots: SpotState[] = [];
  readonly sections: SectionState[] = [];
  scrap = 0;
  /** The spot being stripped this step (E held, in reach), else null. */
  active: SpotState | null = null;
  /** The nearest unfinished spot in reach (what E would strip), else null. */
  inReach: SpotState | null = null;
  private noiseT = 0;
  /** A noise from stripping: where, and how far it carries (m). */
  onNoise: ((x: number, z: number, radius: number) => void) | null = null;
  onDone: ((s: SpotState) => void) | null = null;
  onBanked: ((s: SectionState) => void) | null = null;

  constructor(public v: SalvageValues) {}

  /** Add a POI's spots (sections keep their order). */
  add(site: PoiSite) {
    const id = site.place.id;
    site.sections.forEach((sec, index) => {
      const st: SectionState = { poi: id, index, name: sec.name, value: sec.value, spots: [], banked: false };
      for (const s of sec.spots) {
        const ss: SpotState = { ...s, poi: id, progress: 0, done: false };
        st.spots.push(ss);
        this.spots.push(ss);
      }
      this.sections.push(st);
    });
  }

  /** Drop a POI's spots (out of range, or rebuilt). */
  remove(poi: string) {
    for (let i = this.spots.length - 1; i >= 0; i--) if (this.spots[i].poi === poi) this.spots.splice(i, 1);
    for (let i = this.sections.length - 1; i >= 0; i--) if (this.sections[i].poi === poi) this.sections.splice(i, 1);
    if (this.active?.poi === poi) this.active = null;
  }

  has(poi: string) { return this.sections.some((s) => s.poi === poi); }

  /** The nearest unfinished spot within reach of (x, z), else null. */
  nearest(x: number, z: number): SpotState | null {
    let best: SpotState | null = null, bd = this.v.salvageReach;
    for (const s of this.spots) {
      if (s.done) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d <= bd) { bd = d; best = s; }
    }
    return best;
  }

  /** One step: the mech's hips at (x, z), E held or not. */
  update(dt: number, x: number, z: number, holding: boolean) {
    // Keep stripping the same spot while it stays in reach; else the nearest.
    const keep = this.active && !this.active.done && Math.hypot(this.active.x - x, this.active.z - z) <= this.v.salvageReach ? this.active : null;
    this.inReach = keep ?? this.nearest(x, z);
    this.active = holding ? this.inReach : null;
    const s = this.active;
    if (!s) { this.noiseT = 0; return; }
    s.progress = Math.min(1, s.progress + (dt * this.v.stripSpeed) / s.time);
    this.noiseT -= dt;
    if (this.noiseT <= 0) { this.noiseT += this.v.noiseEvery; this.onNoise?.(s.x, s.z, this.v.noiseRadius); }
    if (s.progress >= 1) {
      s.done = true;
      this.scrap += this.pay(s);
      this.onDone?.(s);
      const sec = this.sections.find((q) => q.poi === s.poi && q.spots.includes(s));
      if (sec && !sec.banked && sec.spots.every((q) => q.done)) { sec.banked = true; this.onBanked?.(sec); }
      this.active = null;
    }
  }

  /** Scrap a spot pays (its value times the multiplier, whole). */
  pay(s: SpotDef) { return Math.max(1, Math.round(s.value * this.v.scrapScale)); }

  /** Scrap still to be had in a POI (unfinished spots). */
  left(poi: string) { let n = 0; for (const s of this.spots) if (s.poi === poi && !s.done) n += this.pay(s); return n; }
}
