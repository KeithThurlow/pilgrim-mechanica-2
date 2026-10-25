// Seekers (pure, Keith 2026-10-26): the sensor part carries seeker modes that point you to the nearest thing you're
// after; you switch which mode is active (Tab in the convoy lab). First version: items don't lie in the world yet, so
// every mode seeks POIs the radar can know about (not stripped, not inside an unknown area):
// - scrap: any POI with salvage left;
// - wreck: wreck parts, dead convoys and debris fields;
// - rare: POIs of tier `seekRareTier` and up, legendary: tier `seekLegendaryTier` and up (stand-ins for "the nearest rare
//   or legendary item" until items drop in the world; tiers 3-5 have no kinds yet, so legendary finds nothing today).
// Ownership: the player's own (what his sensor shows); reads the host's POI list.
import type { Param } from "../core/tweaks";
import type { SeekerMode } from "../items/item";
import type { RadarWorld } from "./radar";

export const SEEKER_DEFAULTS = { seekRareTier: 2, seekLegendaryTier: 3 };
export type SeekerValues = typeof SEEKER_DEFAULTS;
export const SEEKER_PARAMS: Param[] = [
  { key: "seekRareTier", label: "Rare seeker: POI tier from", min: 1, max: 5, step: 1, group: "Radar", tip: "Until items lie in the world, the rare seeker points at POIs this tier and up" },
  { key: "seekLegendaryTier", label: "Legendary seeker: POI tier from", min: 1, max: 5, step: 1, group: "Radar", tip: "Until items lie in the world, the legendary seeker points at POIs this tier and up (tiers 3-5 have no kinds yet)" },
];

export const SEEKER_NAMES: Record<SeekerMode, string> = { scrap: "Scrap", wreck: "Wrecks", rare: "Rare", legendary: "Legendary" };
const WRECK_KINDS = new Set(["wreckPart", "deadConvoy", "debrisField"]);

/** What the active seeker points at: offset from the mech, distance, bearing (world radians, 0 = +Z). */
export interface SeekTarget { id: string; x: number; z: number; dist: number; bearing: number; mode: SeekerMode }

/** Does a POI match a mode? */
export function seekMatches(mode: SeekerMode, p: RadarWorld["pois"][number], v: SeekerValues) {
  if (p.stripped) return false;
  if (mode === "wreck") return !!p.kind && WRECK_KINDS.has(p.kind);
  if (mode === "rare") return p.tier >= v.seekRareTier;
  if (mode === "legendary") return p.tier >= v.seekLegendaryTier;
  return true;
}

/** The nearest POI the mode matches that the radar can know about (outside unknown areas), or null. */
export function seekNearest(mode: SeekerMode, v: SeekerValues, w: RadarWorld): SeekTarget | null {
  let best: SeekTarget | null = null;
  for (const p of w.pois) {
    if (!seekMatches(mode, p, v) || w.unknown.some((u) => Math.hypot(u.x - p.x, u.z - p.z) < u.r)) continue;
    const dx = p.x - w.mech.x, dz = p.z - w.mech.z, d = Math.hypot(dx, dz);
    if (!best || d < best.dist) best = { id: p.id, x: dx, z: dz, dist: d, bearing: Math.atan2(dx, dz), mode };
  }
  return best;
}

/** The modes a sensor carries and which is active. Cycling is a command (the lab binds a key). */
export class Seeker {
  modes: SeekerMode[] = [];
  private i = 0;
  /** The fitted sensor changed: keep the active mode if the new sensor has it. */
  setModes(modes: SeekerMode[]) {
    const was = this.mode;
    this.modes = [...modes];
    this.i = Math.max(0, was ? this.modes.indexOf(was) : 0);
  }
  get mode(): SeekerMode | null { return this.modes[this.i] ?? null; }
  cycle() { if (this.modes.length) this.i = (this.i + 1) % this.modes.length; }
  /** A line for the HUD. */
  label(t: SeekTarget | null): string {
    const m = this.mode;
    if (!m) return "";
    const what = `${SEEKER_NAMES[m]}${this.modes.length > 1 ? ` (${this.i + 1}/${this.modes.length}, Tab)` : ""}`;
    const tail = m === "rare" || m === "legendary" ? " · POIs by tier until items drop" : "";
    return t ? `Seeker ${what}: ${t.dist >= 1000 ? (t.dist / 1000).toFixed(1) + " km" : Math.round(t.dist / 10) * 10 + " m"}${tail}` : `Seeker ${what}: nothing known${tail}`;
  }
}
