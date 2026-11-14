// The run's threat level (pure; host state, Keith 2026-11-14: "the game progressively gets harder the further away you
// go from the convoy... permanently difficult until you return to the convoy"). Depth (depth.ts) is a property of a
// place, so on the way back the sand got easier and enemies dropped level-1 gear. Threat is a property of the run: it
// is measured in metres of depth, ratchets up to the deepest the player has been from the convoy this run (rising at
// threatRise m/s toward it), never drops while out, and only falls once the mech is home (aboard, or within threatHome
// of the convoy), at threatDecay m/s. Everything live (enemy power, loot level and rarity, packs and raids) reads the
// deeper of the place's own depth and the threat: effectiveDepth(). A threat level is depth turned into an item level
// with the loot's own curve (1 + metres / levelMetres), so the HUD's number is the level drops roll at.
import type { Param } from "../core/tweaks";

export const RUN_THREAT_GROUP = "Threat level";
export const RUN_THREAT_DEFAULTS = {
  threatOn: 1,
  threatRise: 60,
  threatTimeRise: 0,
  threatDecay: 12,
  threatHome: 80,
  threatShare: 1,
};
export type RunThreatValues = typeof RUN_THREAT_DEFAULTS;
export const RUN_THREAT_PARAMS: Param[] = [
  { key: "threatOn", label: "Threat level on (0/1)", min: 0, max: 1, step: 1, group: RUN_THREAT_GROUP, tip: "1: difficulty and loot follow the deepest you've been this run until you're home; 0: only where you stand (the old way)" },
  { key: "threatRise", label: "Rises toward depth at (m/s)", min: 1, max: 500, step: 1, group: RUN_THREAT_GROUP, tip: "How fast the threat catches up with a new deepest point; it never falls while out" },
  { key: "threatTimeRise", label: "Creeps up while out (m per min)", min: 0, max: 200, step: 5, group: RUN_THREAT_GROUP, tip: "Extra depth the threat gains for every minute out, wherever you are (0: distance only)" },
  { key: "threatDecay", label: "Falls at home at (m/s)", min: 0.5, max: 200, step: 0.5, group: RUN_THREAT_GROUP, tip: "Aboard or by the convoy the threat falls this fast (12: 1.5 km of threat gone in about 2 min)" },
  { key: "threatHome", label: "Home within (m of the convoy)", min: 0, max: 400, step: 5, group: RUN_THREAT_GROUP, tip: "On the sand this close to the convoy counts as home: the threat starts falling" },
  { key: "threatShare", label: "Threat counts (share)", min: 0, max: 1, step: 0.05, group: RUN_THREAT_GROUP, tip: "Effective depth = the deeper of the place's own depth and this share of the threat" },
];

export class RunThreat {
  /** The threat, in metres of depth. */
  m = 0;
  /** The deepest depth seen this run (m), the ratchet's target. */
  peak = 0;
  /** Falling (home) this tick. */
  falling = false;
  constructor(public v: RunThreatValues) {}

  /**
   * One tick: depth is the player's live depth from the convoy (m), out whether an expedition is on, home whether the
   * mech is aboard or by the convoy.
   */
  update(dt: number, depth: number, out: boolean, home: boolean) {
    const v = this.v;
    if (v.threatOn <= 0) { this.m = 0; this.peak = 0; this.falling = false; return; }
    this.falling = !out || home;
    if (this.falling) {
      this.m = Math.max(0, this.m - Math.max(0, v.threatDecay) * dt);
      this.peak = this.m;
      return;
    }
    this.peak = Math.max(this.peak + (Math.max(0, v.threatTimeRise) / 60) * dt, depth);
    if (this.m < this.peak) this.m = Math.min(this.peak, this.m + Math.max(0.1, v.threatRise) * dt);
  }

  /** The depth (m) a place plays at: the deeper of its own and the threat's share. */
  effective(placeDepth: number): number {
    return this.v.threatOn > 0 ? Math.max(placeDepth, this.m * Math.max(0, Math.min(1, this.v.threatShare))) : placeDepth;
  }

  /** The threat as an item level (the loot's curve: 1 + metres / levelMetres), unrounded. */
  level(levelMetres: number): number {
    return 1 + this.m / Math.max(1, levelMetres);
  }

  /** Set the threat (labs: ?runthreat=metres). */
  set(m: number) { this.m = this.peak = Math.max(0, m); }
}
