// Salvage (pure sim, no drawing): spots of scrap the mech strips by standing within reach and holding E (Keith
// 2026-10-25: hold E for now; one currency, scrap; item drops of various rarities later). A bar fills over the spot's
// strip time; walking out of reach pauses it (the progress stays); a finished spot pays its scrap at once, and when
// every spot in a section is done the section is banked (so leaving a POI half done still pays).
//
// Stripping is loud: while it runs, `onNoise` fires every `noiseEvery` seconds with the spot and a radius, for swarms
// and war bands to hear (nothing listens yet).
import type { Param } from "../core/tweaks";
import type { PoiSite, SpotDef } from "./site";
import { DEPTH_GROUP } from "../expedition/depth";

export const SALVAGE_DEFAULTS = {
  salvageReach: 7, stripSpeed: 1, scrapScale: 1, noiseEvery: 0.6, noiseRadius: 160,
  // Salvage heat (Keith 2026-10-28: scrapping should feel risky, likely to attract things).
  heatRef: 25, heatRise: 0.025, heatHold: 3, heatDecay: 0.012, heatNoise: 1.0, noiseSize: 0.5, stripSizeSlow: 0.25,
  heatPack: 0.35, heatRaid: 0.75, heatMax: 1.5, heatRearm: 0.5,
  // Scrap per spot at full depth (src/expedition/depth.ts).
  scrapFar: 3,
};
/** Plus the gear's salvage speed (arms, held weapons, a cutting kit: src/items/loadout.ts resolve), when a loadout is fitted. */
export type SalvageValues = typeof SALVAGE_DEFAULTS & { gearSalvage?: number };
const G = "Salvage", H = "Salvage heat";
export const SALVAGE_PARAMS: Param[] = [
  { key: "salvageReach", label: "Reach (m)", min: 2, max: 15, step: 0.1, group: G, tip: "From the mech's hips to a spot, flat distance: closer than this and E strips it" },
  { key: "stripSpeed", label: "Strip speed", min: 0.1, max: 5, step: 0.05, group: G, tip: "Multiplies every spot's strip rate (2 = twice as fast)" },
  { key: "scrapScale", label: "Scrap multiplier", min: 0.1, max: 5, step: 0.05, group: G, tip: "Multiplies the scrap every spot pays" },
  { key: "noiseEvery", label: "Noise every (s)", min: 0.1, max: 3, step: 0.05, group: G, tip: "How often stripping sends out a noise other systems can hear" },
  { key: "noiseRadius", label: "Heard within (m)", min: 10, max: 600, step: 5, group: G },
  { key: "scrapFar", label: "Scrap × at full depth", min: 1, max: 8, step: 0.05, group: DEPTH_GROUP, tip: "Each spot pays 1× at the road, this much at danger 1" },
  { key: "heatRef", label: "Spot size that counts as 1 (scrap)", min: 5, max: 100, step: 1, group: H, tip: "A spot worth this heats and sounds at the base rates; richer ones more, poorer less" },
  { key: "heatRise", label: "Heat rise (per s stripping)", min: 0, max: 0.5, step: 0.005, group: H, tip: "Heat goes 0..heatMax; × the spot's size, × the stripper's noise (the pilot's less)" },
  { key: "heatHold", label: "Heat holds for (s)", min: 0, max: 20, step: 0.5, group: H, tip: "After stripping stops, before it starts to fall" },
  { key: "heatDecay", label: "Heat falls (per s)", min: 0, max: 0.2, step: 0.001, group: H },
  { key: "heatNoise", label: "Noise radius + (× at heat 1)", min: 0, max: 5, step: 0.05, group: H, tip: "The strip noise carries (1 + this × heat) times as far" },
  { key: "noiseSize", label: "Noise + per size above 1", min: 0, max: 2, step: 0.05, group: H, tip: "Richer spots are louder" },
  { key: "stripSizeSlow", label: "Strip time + per size above 1", min: 0, max: 1.5, step: 0.05, group: H, tip: "Richer spots take longer to strip" },
  { key: "heatPack", label: "Pulls in a pack at heat", min: 0.05, max: 1.5, step: 0.01, group: H },
  { key: "heatRaid", label: "Sends a raid at heat", min: 0.05, max: 1.5, step: 0.01, group: H },
  { key: "heatMax", label: "Heat tops out at", min: 0.5, max: 3, step: 0.05, group: H },
  { key: "heatRearm", label: "Re-arms below (share of the threshold)", min: 0, max: 1, step: 0.05, group: H, tip: "A pack or raid triggers again only after the heat has fallen below this share of its threshold" },
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
  /** Salvage heat, 0..heatMax: up while stripping, down slowly after. */
  heat = 0;
  private heatIdle = 0;
  private packArmed = true; private raidArmed = true;
  /** Heat crossed a threshold while stripping at (x, z). */
  onHeat: ((what: "pack" | "raid", x: number, z: number) => void) | null = null;
  /** Danger at a place (src/expedition/depth.ts); null: no depth. */
  danger: ((x: number, z: number) => number) | null = null;
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
  nearest(x: number, z: number, reach = this.v.salvageReach): SpotState | null {
    let best: SpotState | null = null, bd = reach;
    for (const s of this.spots) {
      if (s.done) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d <= bd) { bd = d; best = s; }
    }
    return best;
  }

  /**
   * One step: the mech's hips (or the pilot on foot) at (x, z), E held or not. reach, rate and noise: the pilot's
   * own (a shorter reach, slower, quieter); the mech's by default.
   */
  /** gear: the mech's salvage gear counts (false for the pilot stripping by hand). */
  update(dt: number, x: number, z: number, holding: boolean, reach = this.v.salvageReach, rate = 1, noise = 1, gear = true) {
    // Keep stripping the same spot while it stays in reach; else the nearest.
    const keep = this.active && !this.active.done && Math.hypot(this.active.x - x, this.active.z - z) <= reach ? this.active : null;
    this.inReach = keep ?? this.nearest(x, z, reach);
    this.active = holding ? this.inReach : null;
    const s = this.active, v = this.v;
    if (!s) {
      this.noiseT = 0;
      this.heatIdle += dt;
      if (this.heatIdle > v.heatHold) this.heat = Math.max(0, this.heat - v.heatDecay * dt);
      this.rearm();
      return;
    }
    const size = this.size(s);
    s.progress = Math.min(1, s.progress + (dt * v.stripSpeed * (gear ? this.v.gearSalvage ?? 1 : 1) * rate) / (s.time * (1 + v.stripSizeSlow * (size - 1))));
    // Heat: up by spot size and how loud the stripper is.
    this.heatIdle = 0;
    this.heat = Math.min(v.heatMax, this.heat + dt * v.heatRise * size * noise);
    if (this.packArmed && this.heat >= v.heatPack) { this.packArmed = false; this.onHeat?.("pack", s.x, s.z); }
    if (this.raidArmed && this.heat >= v.heatRaid) { this.raidArmed = false; this.onHeat?.("raid", s.x, s.z); }
    this.noiseT -= dt;
    if (this.noiseT <= 0) {
      this.noiseT += v.noiseEvery;
      if (noise > 0) this.onNoise?.(s.x, s.z, this.noiseRadius(s) * noise);
    }
    if (s.progress >= 1) {
      s.done = true;
      this.scrap += this.pay(s);
      this.onDone?.(s);
      const sec = this.sections.find((q) => q.poi === s.poi && q.spots.includes(s));
      if (sec && !sec.banked && sec.spots.every((q) => q.done)) { sec.banked = true; this.onBanked?.(sec); }
      this.active = null;
    }
  }

  /** How big a spot is against heatRef (richer: hotter, louder, slower). */
  size(s: SpotDef) { return Math.max(0.2, s.value / Math.max(1, this.v.heatRef)); }

  /** How far a spot's strip noise carries now: grows with the heat and the spot's size. */
  noiseRadius(s: SpotDef) {
    const v = this.v;
    return v.noiseRadius * (1 + v.heatNoise * this.heat) * (1 + v.noiseSize * (this.size(s) - 1));
  }

  private rearm() {
    const v = this.v;
    if (this.heat < v.heatPack * v.heatRearm) this.packArmed = true;
    if (this.heat < v.heatRaid * v.heatRearm) this.raidArmed = true;
  }

  /** Scrap a spot pays (its value times the multiplier and the depth's, whole). */
  pay(s: SpotDef) {
    const d = this.danger ? this.danger(s.x, s.z) : 0;
    return Math.max(1, Math.round(s.value * this.v.scrapScale * (1 + (this.v.scrapFar - 1) * d)));
  }

  /** Scrap still to be had in a POI (unfinished spots). */
  left(poi: string) { let n = 0; for (const s of this.spots) if (s.poi === poi && !s.done) n += this.pay(s); return n; }
}
