// The run's threat level (pure; host state, Keith 2026-11-14: "the game progressively gets harder the further away you
// go from the convoy... permanently difficult until you return to the convoy"). Depth (depth.ts) is a property of a
// place, so on the way back the sand got easier and enemies dropped level-1 gear. Threat is a property of the run: it
// is measured in metres of depth, ratchets up to the deepest the player has been from the convoy this run (rising at
// threatRise m/s toward it), never drops while out, and only falls once the mech is home (aboard, or anywhere near the
// convoy: within threatHome, past its guns' reach), at threatDecay m/s. Places that near play at their own depth only. Everything live (enemy power, loot level and rarity, packs and raids) reads the
// deeper of the place's own depth and the threat: effectiveDepth(). A threat level is depth turned into an item level
// with the loot's own curve (1 + metres / levelMetres), so the HUD's number is the level drops roll at.
// Time out there adds to it too (Keith 2026-11-16: "if you get your threat level high, and then the player starts
// heading back towards the convoy, that would hopefully maybe stop the threat level from escalating as fast. But they
// still have to survive whatever the threat level is, and the threat level only starts going down once you're in range
// of the convoy"): it creeps up every minute out, faster the further out you are, and heading home (closing on the
// convoy) slows the creep to threatHomeRise of itself. It never drops until home. trend says which for the HUD.
import type { Param } from "../core/tweaks";

export const RUN_THREAT_GROUP = "Threat level";
export const RUN_THREAT_DEFAULTS = {
  threatOn: 1,
  threatRise: 60,
  threatTimeRise: 20,
  threatDeepRise: 60,
  threatHomeRise: 0.25,
  threatHomeSpeed: 3,
  threatHeadingSmooth: 1.5,
  threatDecay: 12,
  threatHome: 250,
  threatShare: 1,
};
export type RunThreatValues = typeof RUN_THREAT_DEFAULTS;
export const RUN_THREAT_PARAMS: Param[] = [
  { key: "threatOn", label: "Threat level on (0/1)", min: 0, max: 1, step: 1, group: RUN_THREAT_GROUP, tip: "1: difficulty and loot follow the deepest you've been this run until you're home; 0: only where you stand (the old way)" },
  { key: "threatRise", label: "Rises toward depth at (m/s)", min: 1, max: 500, step: 1, group: RUN_THREAT_GROUP, tip: "How fast the threat catches up with a new deepest point; it never falls while out" },
  { key: "threatTimeRise", label: "Creeps up while out (m per min)", min: 0, max: 200, step: 5, group: RUN_THREAT_GROUP, tip: "Extra depth the threat gains for every minute out, wherever you are (0: distance only). 20 m/min: a level (150 m) every 7.5 min by the convoy" },
  { key: "threatDeepRise", label: "Creeps faster per km out (m per min)", min: 0, max: 300, step: 5, group: RUN_THREAT_GROUP, tip: "Added to the creep for every km from the convoy (60: at 1 km out the threat creeps 80 m a minute, a level in under 2 min)" },
  { key: "threatHomeRise", label: "Creep heading home (share)", min: 0, max: 1, step: 0.05, group: RUN_THREAT_GROUP, tip: "Heading back toward the convoy, the creep slows to this share of itself (0: stops; 1: no difference). The level you reached stays until you're in range (Keith 2026-11-16)" },
  { key: "threatHomeSpeed", label: "Heading home from (m/s closing)", min: 0.5, max: 12, step: 0.5, group: RUN_THREAT_GROUP, tip: "Closing on the convoy this fast counts fully as heading home; slower closes count partly (walk 6 m/s)" },
  { key: "threatHeadingSmooth", label: "Heading home smoothing (s)", min: 0.1, max: 6, step: 0.1, group: RUN_THREAT_GROUP, tip: "How long the closing speed is averaged over, so a dodge or a sidestep doesn't flip it" },
  { key: "threatDecay", label: "Falls at home at (m/s)", min: 0.5, max: 200, step: 0.5, group: RUN_THREAT_GROUP, tip: "Aboard or by the convoy the threat falls this fast (12: 1.5 km of threat gone in about 2 min)" },
  { key: "threatHome", label: "Home within (m of the convoy)", min: 0, max: 800, step: 10, group: RUN_THREAT_GROUP, tip: "This close to the convoy counts as home: the threat starts falling, and enemies and drops here ignore it (only the place's own depth), so luring a high-threat pack into the convoy's guns pays nothing extra (Keith 2026-11-14). 250: past the tanks' 140 m reach with room for escorts driving out" },
  { key: "threatShare", label: "Threat counts (share)", min: 0, max: 1, step: 0.05, group: RUN_THREAT_GROUP, tip: "Effective depth = the deeper of the place's own depth and this share of the threat" },
];

export class RunThreat {
  /** The threat, in metres of depth. */
  m = 0;
  /** The deepest depth seen this run (m), the ratchet's target. */
  peak = 0;
  /** Falling (home) this tick. */
  falling = false;
  /** How much the mech is heading home (0..1): its smoothed closing speed on the convoy over threatHomeSpeed. */
  homeward = 0;
  /** The threat's change this tick (m/s): positive rising, negative falling. */
  rate = 0;
  /** For the HUD: rising (full pace), slowed (heading home), holding (not rising, not home) or falling (home). */
  trend: "rising" | "slowed" | "holding" | "falling" = "holding";
  private closing = 0;
  private lastDepth = NaN;
  constructor(public v: RunThreatValues) {}

  /**
   * One tick: depth is the player's live depth from the convoy (m), out whether an expedition is on, home whether the
   * mech is aboard or by the convoy.
   */
  update(dt: number, depth: number, out: boolean, home: boolean) {
    const v = this.v;
    if (v.threatOn <= 0) { this.m = 0; this.peak = 0; this.falling = false; this.rate = 0; this.trend = "holding"; this.homeward = 0; return; }
    const before = this.m;
    // Closing speed on the convoy (m/s), smoothed; reset when not out.
    if (out && dt > 0 && Number.isFinite(this.lastDepth)) {
      const raw = (this.lastDepth - depth) / dt, a = 1 - Math.exp(-dt / Math.max(0.05, v.threatHeadingSmooth));
      this.closing += (raw - this.closing) * a;
    } else if (!out) this.closing = 0;
    this.lastDepth = out ? depth : NaN;
    this.homeward = Math.max(0, Math.min(1, this.closing / Math.max(0.1, v.threatHomeSpeed)));
    this.falling = !out || home;
    if (this.falling) {
      this.m = Math.max(0, this.m - Math.max(0, v.threatDecay) * dt);
      this.peak = this.m;
      this.rate = dt > 0 ? (this.m - before) / dt : 0;
      this.trend = this.m > 0 || before > 0 ? "falling" : "holding";
      return;
    }
    const creep = (Math.max(0, v.threatTimeRise) + Math.max(0, v.threatDeepRise) * Math.max(0, depth) / 1000) / 60;
    const slow = 1 - this.homeward * (1 - Math.max(0, Math.min(1, v.threatHomeRise)));
    this.peak = Math.max(this.peak + creep * slow * dt, depth);
    if (this.m < this.peak) this.m = Math.min(this.peak, this.m + Math.max(0.1, v.threatRise) * dt);
    this.rate = dt > 0 ? (this.m - before) / dt : 0;
    this.trend = this.rate <= 1e-4 ? "holding" : this.homeward > 0.5 && this.m >= this.peak - 1 ? "slowed" : "rising";
  }

  /** Where the threat is within its current level (0..1), for the HUD's bar. */
  levelShare(levelMetres: number): number {
    const l = this.level(levelMetres);
    return l - Math.floor(l);
  }

  /**
   * The depth (m) a place plays at: the deeper of its own and the threat's share. A place by the convoy (home: within
   * threatHome) plays at its own depth only, so enemies lured into the convoy's guns drop and fight at the place's level.
   */
  effective(placeDepth: number, home = false): number {
    return this.v.threatOn > 0 && !home ? Math.max(placeDepth, this.m * Math.max(0, Math.min(1, this.v.threatShare))) : placeDepth;
  }

  /** The threat as an item level (the loot's curve: 1 + metres / levelMetres), unrounded. */
  level(levelMetres: number): number {
    return 1 + this.m / Math.max(1, levelMetres);
  }

  /** Set the threat (labs: ?runthreat=metres). */
  set(m: number) { this.m = this.peak = Math.max(0, m); this.lastDepth = NaN; this.closing = 0; }
}
