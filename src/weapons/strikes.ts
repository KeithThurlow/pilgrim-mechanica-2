// Shoulder strikes (Keith 2026-11-14: "more shoulder weapons, and they need to feel really strong. They're activated
// weapons. They need to have some sort of drastic effect. They have a cooldown"). One key, one big moment, a long
// cooldown. Five kinds:
// - quake: the Quake hammer. Press: the mech winds up and slams; rings of force race out from its feet, each one a
//   blast over everything inside it (so the middle takes every ring), and what's left standing is staggered.
// - orbital: the Orbital lance. Hold to paint the ring, release: a targeting beam for a moment, then a beam from the
//   sky that burns the spot (drifting onto the nearest enemy) and ends in one huge blast.
// - stasis: the Cryo bomb. Press: a freezing shockwave from the mech; rings of cold freeze everything they reach solid.
// - gravity: the Singularity. Hold to paint, release: an orb flies to the spot and opens a well that holds everything
//   inside it nearly still and crushes it, then implodes in a big blast.
// - artillery: the Artillery beacon. Hold to paint, release: a flare goes up, then a barrage of shells rains over the
//   ring for a few seconds.
// Pure timing (no drawing, no damage): the sim says what happens when as plain events; src/weapons/strikeFire.ts turns
// them into damage, effects and sound, src/weapons/strikesDraw.ts draws the beams, orbs and rings.
// Ownership: host (damage, timing). Randomness: seeded (the barrage's shell spots).
import type { Param } from "../core/tweaks";
import { Rng } from "../core/rng";

export type StrikeKind = "quake" | "orbital" | "stasis" | "gravity" | "artillery";
export const STRIKE_KINDS: StrikeKind[] = ["quake", "orbital", "stasis", "gravity", "artillery"];
/** Self strikes go off round the mech on a press; the others are aimed (hold paints the ring, release fires). */
export const isSelfStrike = (k: StrikeKind) => k === "quake" || k === "stasis";

export const STRIKE_DEFAULTS = {
  // Quake hammer
  quakeDamage: 320,
  quakeRadius: 22,
  quakeRings: 3,
  quakeGap: 0.12,
  quakeWindup: 0.25,
  quakeStun: 1.6,
  quakeStunPace: 0.15,
  quakeCooldown: 14,
  quakeAp: 0.5,
  quakeShake: 0.9,
  // Orbital lance
  orbitalDelay: 1.1,
  orbitalTime: 2.4,
  orbitalTick: 0.1,
  orbitalTickDamage: 110,
  orbitalBeamRadius: 5,
  orbitalFinalDamage: 1600,
  orbitalFinalRadius: 16,
  orbitalTrack: 5,
  orbitalSeek: 10,
  orbitalRange: 110,
  orbitalCooldown: 30,
  orbitalAp: 0.8,
  orbitalWidth: 2.2,
  // Cryo bomb
  stasisRadius: 20,
  stasisRings: 3,
  stasisGap: 0.1,
  stasisWindup: 0.12,
  stasisDamage: 220,
  stasisChill: 1.5,
  stasisColdDps: 60,
  stasisCooldown: 22,
  // Singularity
  gravityRadius: 13,
  gravityFlight: 0.55,
  gravityTime: 2.8,
  gravityTick: 0.25,
  gravityDps: 160,
  gravityHold: 0.05,
  gravityFinalDamage: 1300,
  gravityFinalRadius: 15,
  gravityRange: 80,
  gravityCooldown: 26,
  gravityAp: 0.7,
  // Artillery beacon
  artilleryDelay: 1.5,
  artilleryTime: 3.2,
  artilleryShells: 28,
  artilleryRadius: 15,
  artilleryBlast: 5,
  artilleryDamage: 260,
  artilleryFlight: 1.1,
  artilleryRange: 100,
  artilleryCooldown: 28,
  artilleryAp: 0.4,
  // Look and sound (all strikes)
  strikeLevel: 1,
  strikeShake: 1,
  strikeGlow: 1,
};
export type StrikeValues = typeof STRIKE_DEFAULTS;

const Q = "Quake hammer", O = "Orbital lance", C = "Cryo bomb", G = "Singularity", A = "Artillery beacon", L = "Strikes: look and sound";
export const STRIKE_GROUPS = [Q, O, C, G, A, L];
export const STRIKE_PARAMS: Param[] = [
  { key: "quakeDamage", label: "Damage per ring", min: 0, max: 2000, step: 10, group: Q, tip: "Each ring is a blast over everything inside it (full at the middle, half at its edge), so the middle takes every ring" },
  { key: "quakeRadius", label: "Reach (m)", min: 4, max: 50, step: 0.5, group: Q },
  { key: "quakeRings", label: "Rings", min: 1, max: 6, step: 1, group: Q },
  { key: "quakeGap", label: "Between rings (s)", min: 0.02, max: 0.5, step: 0.01, group: Q },
  { key: "quakeWindup", label: "Wind-up (s)", min: 0, max: 1, step: 0.01, group: Q, tip: "The mech crouches before the slam" },
  { key: "quakeStun", label: "Stagger (s)", min: 0, max: 5, step: 0.05, group: Q, tip: "What's left in reach moves at the stagger pace this long" },
  { key: "quakeStunPace", label: "Stagger pace", min: 0, max: 1, step: 0.01, group: Q },
  { key: "quakeCooldown", label: "Cooldown (s)", min: 0.5, max: 60, step: 0.5, group: Q },
  { key: "quakeAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: Q },
  { key: "quakeShake", label: "Camera shake", min: 0, max: 2, step: 0.05, group: Q },
  { key: "orbitalDelay", label: "Targeting (s)", min: 0, max: 4, step: 0.05, group: O, tip: "The thin red beam before the lance comes down" },
  { key: "orbitalTime", label: "Beam lasts (s)", min: 0.2, max: 8, step: 0.1, group: O },
  { key: "orbitalTick", label: "Burn tick (s)", min: 0.03, max: 0.5, step: 0.01, group: O },
  { key: "orbitalTickDamage", label: "Damage a tick", min: 0, max: 600, step: 5, group: O },
  { key: "orbitalBeamRadius", label: "Burn radius (m)", min: 1, max: 15, step: 0.1, group: O },
  { key: "orbitalFinalDamage", label: "Final blast damage", min: 0, max: 5000, step: 10, group: O },
  { key: "orbitalFinalRadius", label: "Final blast radius (m)", min: 2, max: 40, step: 0.5, group: O },
  { key: "orbitalTrack", label: "Drift (m/s)", min: 0, max: 20, step: 0.5, group: O, tip: "The beam slides toward the nearest enemy this fast" },
  { key: "orbitalSeek", label: "Drift reach (m)", min: 0, max: 30, step: 0.5, group: O, tip: "Enemies this close to the beam pull it" },
  { key: "orbitalRange", label: "Range (m)", min: 20, max: 250, step: 1, group: O },
  { key: "orbitalCooldown", label: "Cooldown (s)", min: 0.5, max: 90, step: 0.5, group: O },
  { key: "orbitalAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: O },
  { key: "orbitalWidth", label: "Beam width (m)", min: 0.3, max: 8, step: 0.1, group: O },
  { key: "stasisRadius", label: "Reach (m)", min: 4, max: 50, step: 0.5, group: C },
  { key: "stasisRings", label: "Rings", min: 1, max: 6, step: 1, group: C },
  { key: "stasisGap", label: "Between rings (s)", min: 0.02, max: 0.5, step: 0.01, group: C },
  { key: "stasisWindup", label: "Wind-up (s)", min: 0, max: 1, step: 0.01, group: C },
  { key: "stasisDamage", label: "Damage (once)", min: 0, max: 2000, step: 10, group: C, tip: "Cold damage to each body as its ring reaches it" },
  { key: "stasisChill", label: "Chill a ring", min: 0, max: 3, step: 0.05, group: C, tip: "1 or more freezes solid at once (the freeze ray's Freeze time)" },
  { key: "stasisColdDps", label: "Cold damage /s while chilled", min: 0, max: 400, step: 5, group: C },
  { key: "stasisCooldown", label: "Cooldown (s)", min: 0.5, max: 60, step: 0.5, group: C },
  { key: "gravityRadius", label: "Well radius (m)", min: 2, max: 30, step: 0.5, group: G },
  { key: "gravityFlight", label: "Orb flight (s)", min: 0.1, max: 2, step: 0.05, group: G },
  { key: "gravityTime", label: "Well lasts (s)", min: 0.2, max: 8, step: 0.1, group: G },
  { key: "gravityTick", label: "Crush tick (s)", min: 0.05, max: 1, step: 0.01, group: G },
  { key: "gravityDps", label: "Crush damage /s", min: 0, max: 1000, step: 5, group: G },
  { key: "gravityHold", label: "Pace inside", min: 0, max: 1, step: 0.01, group: G, tip: "What's in the well moves at this share of its speed" },
  { key: "gravityFinalDamage", label: "Implosion damage", min: 0, max: 5000, step: 10, group: G },
  { key: "gravityFinalRadius", label: "Implosion radius (m)", min: 2, max: 40, step: 0.5, group: G },
  { key: "gravityRange", label: "Range (m)", min: 10, max: 200, step: 1, group: G },
  { key: "gravityCooldown", label: "Cooldown (s)", min: 0.5, max: 90, step: 0.5, group: G },
  { key: "gravityAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: G },
  { key: "artilleryDelay", label: "Flare to first shell (s)", min: 0, max: 5, step: 0.05, group: A },
  { key: "artilleryTime", label: "Barrage lasts (s)", min: 0.2, max: 10, step: 0.1, group: A },
  { key: "artilleryShells", label: "Shells", min: 1, max: 80, step: 1, group: A },
  { key: "artilleryRadius", label: "Ring radius (m)", min: 3, max: 40, step: 0.5, group: A },
  { key: "artilleryBlast", label: "Shell blast radius (m)", min: 0.5, max: 15, step: 0.1, group: A },
  { key: "artilleryDamage", label: "Damage a shell", min: 0, max: 2000, step: 10, group: A },
  { key: "artilleryFlight", label: "Shell fall (s)", min: 0.3, max: 3, step: 0.05, group: A, tip: "Each shell's telegraph ring shows this long before it lands" },
  { key: "artilleryRange", label: "Range (m)", min: 20, max: 250, step: 1, group: A },
  { key: "artilleryCooldown", label: "Cooldown (s)", min: 0.5, max: 90, step: 0.5, group: A },
  { key: "artilleryAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: A },
  { key: "strikeLevel", label: "Sound level", min: 0, max: 2, step: 0.05, group: L },
  { key: "strikeShake", label: "Camera shake ×", min: 0, max: 3, step: 0.05, group: L },
  { key: "strikeGlow", label: "Beam and orb glow ×", min: 0, max: 3, step: 0.05, group: L },
];

/** One strike's numbers: an item's own when rolled, else the sliders (strikeStats). */
export interface StrikeStats {
  kind: StrikeKind;
  /** quake/stasis: per ring; orbital: a tick; gravity: per second; artillery: a shell. */
  damage: number;
  /** quake/stasis: reach; orbital: burn radius; gravity: well radius; artillery: ring radius. */
  radius: number;
  cooldown: number;
  /** orbital/gravity: the final blast. */
  finalDamage: number;
  finalRadius: number;
  /** orbital/gravity/artillery: how long it runs; quake/stasis: unused. */
  time: number;
  /** artillery: shells; quake/stasis: rings. */
  count: number;
  ap: number;
}

/** A strike's stats from its item (own) or the sliders. */
export function strikeStats(kind: StrikeKind, o: Record<string, number> | null, v: StrikeValues): StrikeStats {
  const g = (k: string, d: number) => o?.[k] ?? d;
  switch (kind) {
    case "quake": return { kind, damage: g("damage", v.quakeDamage), radius: g("blast", v.quakeRadius), cooldown: g("cooldown", v.quakeCooldown), finalDamage: 0, finalRadius: 0, time: 0, count: Math.max(1, Math.round(v.quakeRings)), ap: g("ap", v.quakeAp) };
    case "stasis": return { kind, damage: g("damage", v.stasisDamage), radius: g("blast", v.stasisRadius), cooldown: g("cooldown", v.stasisCooldown), finalDamage: 0, finalRadius: 0, time: g("effectTime", 0), count: Math.max(1, Math.round(v.stasisRings)), ap: 1 };
    case "orbital": return { kind, damage: g("damage", v.orbitalTickDamage), radius: v.orbitalBeamRadius, cooldown: g("cooldown", v.orbitalCooldown), finalDamage: g("finalDamage", v.orbitalFinalDamage), finalRadius: g("blast", v.orbitalFinalRadius), time: g("effectTime", v.orbitalTime), count: 0, ap: g("ap", v.orbitalAp) };
    case "gravity": return { kind, damage: g("damage", v.gravityDps), radius: g("wellRadius", v.gravityRadius), cooldown: g("cooldown", v.gravityCooldown), finalDamage: g("finalDamage", v.gravityFinalDamage), finalRadius: g("blast", v.gravityFinalRadius), time: g("effectTime", v.gravityTime), count: 0, ap: g("ap", v.gravityAp) };
    default: return { kind, damage: g("damage", v.artilleryDamage), radius: v.artilleryRadius, cooldown: g("cooldown", v.artilleryCooldown), finalDamage: 0, finalRadius: g("blast", v.artilleryBlast), time: v.artilleryTime, count: Math.max(1, Math.round(g("shells", v.artilleryShells))), ap: g("ap", v.artilleryAp) };
  }
}

/** What a strike does now, for the glue (damage, effects) and the draw. */
export type StrikeEvent =
  /** Fired: the wind-up (quake, stasis), the targeting beam (orbital), the orb's flight (gravity), the flare (artillery). */
  | { type: "start"; x: number; z: number }
  /** The beam lands, the well opens, the barrage starts. */
  | { type: "live"; x: number; z: number }
  /** A ring (quake, stasis): ring i of n, out to r. */
  | { type: "ring"; x: number; z: number; r: number; i: number; n: number }
  /** A burn or crush tick (orbital, gravity) at the beam's or well's spot, over dt seconds. */
  | { type: "tick"; x: number; z: number; dt: number }
  /** One barrage shell to land at (x, z). */
  | { type: "shell"; x: number; z: number }
  /** The last blast (orbital, gravity) or the end of a self strike's rings. */
  | { type: "final"; x: number; z: number }
  | { type: "end"; x: number; z: number };

export type StrikePhase = "idle" | "warn" | "live";

/**
 * One fitted strike: its cooldown and, while it runs, where it is and how far along. fire() takes the spot (the
 * mech's feet for self strikes); update() steps it and calls out its events. The orbital lance's beam can be steered
 * each step (steer) toward the nearest enemy.
 */
export class StrikeSim {
  cool = 0;
  phase: StrikePhase = "idle";
  /** Seconds into the current phase. */
  t = 0;
  x = 0; z = 0;
  /** Where it was fired from (the gravity orb's flight starts here). */
  fx = 0; fz = 0;
  /** Rings or shells out so far, tick clock. */
  done = 0;
  acc = 0;
  stats: StrikeStats;
  private rng: Rng;
  /** Times fired (checks). */
  fired = 0;

  constructor(readonly kind: StrikeKind, stats: StrikeStats, seed: number) { this.stats = stats; this.rng = new Rng(seed >>> 0 || 1); }

  get ready() { return this.cool <= 0 && this.phase === "idle"; }
  get busy() { return this.phase !== "idle"; }
  /** Share of the warning phase done (the draw's targeting beam, the orb's flight). */
  warnShare(v: StrikeValues) { return this.phase === "warn" ? Math.min(1, this.t / Math.max(1e-3, this.warnTime(v))) : this.phase === "live" ? 1 : 0; }
  /** Share of the live phase done. */
  liveShare() { return this.phase === "live" ? Math.min(1, this.t / Math.max(1e-3, this.liveTime())) : 0; }

  warnTime(v: StrikeValues) {
    switch (this.kind) {
      case "quake": return v.quakeWindup;
      case "stasis": return v.stasisWindup;
      case "orbital": return v.orbitalDelay;
      case "gravity": return v.gravityFlight;
      default: return v.artilleryDelay;
    }
  }
  liveTime() {
    const s = this.stats;
    if (this.kind === "quake" || this.kind === "stasis") return Math.max(1e-3, (s.count - 1) * this.ringGap + 1e-3);
    return Math.max(0.05, s.time);
  }
  private ringGap = 0.1;

  /** Fire at (x, z) from (fx, fz) with these stats; false while it cools or runs. */
  fire(x: number, z: number, fx: number, fz: number, stats: StrikeStats, emit: (e: StrikeEvent) => void): boolean {
    if (!this.ready) return false;
    this.stats = stats;
    this.x = x; this.z = z; this.fx = fx; this.fz = fz;
    this.phase = "warn"; this.t = 0; this.done = 0; this.acc = 0;
    this.cool = stats.cooldown;
    this.fired++;
    emit({ type: "start", x, z });
    return true;
  }

  /** Slide the spot toward (tx, tz) at up to speed m/s (the orbital lance's drift). */
  steer(tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz), step = speed * dt;
    if (d < 1e-6) return;
    const k = Math.min(1, step / d);
    this.x += dx * k; this.z += dz * k;
  }

  update(dt: number, v: StrikeValues, emit: (e: StrikeEvent) => void) {
    if (this.phase === "idle") { this.cool = Math.max(0, this.cool - dt); return; }
    this.cool = Math.max(0, this.cool - dt);
    this.t += dt;
    const s = this.stats;
    if (this.phase === "warn") {
      if (this.t < this.warnTime(v)) return;
      this.t -= this.warnTime(v);
      this.phase = "live";
      this.ringGap = this.kind === "quake" ? v.quakeGap : v.stasisGap;
      emit({ type: "live", x: this.x, z: this.z });
    }
    // Live.
    if (this.kind === "quake" || this.kind === "stasis") {
      const n = s.count;
      while (this.done < n && this.t >= this.done * this.ringGap) {
        const i = this.done++;
        emit({ type: "ring", x: this.x, z: this.z, r: s.radius * (i + 1) / n, i, n });
      }
      if (this.done >= n) { emit({ type: "final", x: this.x, z: this.z }); this.end(emit); }
      return;
    }
    if (this.kind === "artillery") {
      const n = s.count, gap = s.time / n;
      while (this.done < n && this.t >= this.done * gap) {
        this.done++;
        // Spread over the disc, a little denser toward the middle.
        const a = this.rng.next() * Math.PI * 2, r = s.radius * Math.pow(this.rng.next(), 0.6);
        emit({ type: "shell", x: this.x + Math.cos(a) * r, z: this.z + Math.sin(a) * r });
      }
      if (this.done >= n) this.end(emit);
      return;
    }
    // Orbital and gravity: ticks while it lasts, then the big one.
    const tick = this.kind === "orbital" ? v.orbitalTick : v.gravityTick;
    this.acc += dt;
    const end = this.t >= s.time;
    while (this.acc >= tick) { this.acc -= tick; emit({ type: "tick", x: this.x, z: this.z, dt: tick }); }
    if (end) { emit({ type: "final", x: this.x, z: this.z }); this.end(emit); }
  }

  private end(emit: (e: StrikeEvent) => void) {
    emit({ type: "end", x: this.x, z: this.z });
    this.phase = "idle"; this.t = 0; this.done = 0; this.acc = 0;
  }

  /** Stop at once (refitted, the unit died). */
  stop() { this.phase = "idle"; this.t = 0; this.done = 0; this.acc = 0; }
}
