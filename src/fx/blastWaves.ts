// Blast waves (Keith 2026-10-31: "all explosions should have a blast wave / distortion effect by default, and then we
// can expand it for specific kinds of explosions too"). Pure, cosmetic (rule 12: Math.random is fine here; nothing
// reads it back into the game).
//
// Every blast posts a wave from its kind's profile: the default profile (sliders) times the kind's multipliers (code
// table below) times the kind's own slider. A wave is a ring of bent air running out from the blast, fast then slow, and
// fading; big shells add a second, slower ring and leave the air shimmering over the spot for a moment. Waves posted
// close together in space and time merge into one bigger wave (like the night lights' clusters, src/world/lightCluster.ts),
// and no more than `wavePerFrame` new waves start in a frame nor `waveMax` live at once: the rest fold into the nearest.
// Heat shimmer: small puffs of bent air left behind rockets, missiles and shells in flight (`exhaust`) and held over hot
// things (`heat`: the excavator's beam while it charges and burns).
// Drawing: blastWavesDraw.ts (a screen-space bend of the frame, a quick bright ring on the ground, lit at night).
import type { Param } from "../core/tweaks";

/** What went off. Each kind has its own profile (WAVE_KINDS) and slider. */
export type WaveKind = "default" | "rocket" | "missile" | "lineMortar" | "mortar" | "cannon" | "turret" | "volley" | "beam" | "death";

interface Profile {
  /** The kind's slider (scales size and strength; 0 turns the kind off). */
  key: string;
  label: string;
  size: number; strength: number; life: number;
  /** A second, slower ring (big shells). */
  ring2: boolean;
  /** Lingering heat shimmer over the spot. */
  heat: boolean;
}

/** Per-kind multipliers on the default profile (Claude's pick 2026-10-31; each kind's slider scales the lot). */
export const WAVE_KINDS: Record<WaveKind, Profile> = {
  default:    { key: "waveDefaultK", label: "Other blasts", size: 1, strength: 1, life: 1, ring2: false, heat: false },
  rocket:     { key: "waveRocketK", label: "Rockets", size: 1, strength: 1, life: 1, ring2: false, heat: false },
  missile:    { key: "waveMissileK", label: "Missiles", size: 0.85, strength: 0.8, life: 0.9, ring2: false, heat: false },
  lineMortar: { key: "waveLineK", label: "Line mortar", size: 0.9, strength: 0.9, life: 1, ring2: false, heat: false },
  mortar:     { key: "waveMortarK", label: "Mortar shells", size: 1.25, strength: 1.3, life: 1.2, ring2: true, heat: true },
  cannon:     { key: "waveCannonK", label: "Autocannon shells", size: 0.7, strength: 0.6, life: 0.7, ring2: false, heat: false },
  turret:     { key: "waveTurretK", label: "Turret truck shells", size: 1.15, strength: 1.1, life: 1.1, ring2: true, heat: true },
  volley:     { key: "waveVolleyK", label: "Excavator volleys", size: 1.15, strength: 1.1, life: 1.1, ring2: true, heat: true },
  beam:       { key: "waveBeamK", label: "Beam release", size: 1.4, strength: 1.4, life: 1.3, ring2: true, heat: true },
  death:      { key: "waveDeathK", label: "Vehicles blowing up", size: 1.4, strength: 1.3, life: 1.3, ring2: true, heat: true },
};
export const WAVE_KIND_LIST = Object.keys(WAVE_KINDS) as WaveKind[];

export const BLAST_WAVE_DEFAULTS = {
  waveOn: 1,
  waveSize: 2.2,
  waveMinSize: 3,
  waveLife: 0.45,
  waveStrength: 0.45,
  waveThick: 0.22,
  waveEase: 2.2,
  waveRim: 0.25,
  waveRing2: 0.5,
  waveRing2Slow: 0.55,
  waveHeat: 1.4,
  waveHeatStrength: 0.08,
  waveGround: 1,
  waveGroundSize: 1.3,
  waveGroundLife: 0.3,
  waveGroundLight: 1,
  waveMergeDist: 0.8,
  waveMergeTime: 0.12,
  waveMergeGrow: 0.35,
  waveMax: 24,
  wavePerFrame: 6,
  waveTrail: 1,
  waveTrailStrength: 0.05,
  waveTrailSize: 1.1,
  waveTrailLife: 0.35,
  waveTrailRate: 18,
  waveHeatMax: 64,
  waveBeamHeat: 0.1,
  waveDefaultK: 1, waveRocketK: 1, waveMissileK: 1, waveLineK: 1, waveMortarK: 1, waveCannonK: 1,
  waveTurretK: 1, waveVolleyK: 1, waveBeamK: 1, waveDeathK: 1,
};
export type BlastWaveValues = typeof BLAST_WAVE_DEFAULTS;

const G = "Blast waves", GK = "Blast waves by kind", GH = "Heat shimmer";
/** The slider groups (a lab's Light topic lists them, via src/world/look.ts LIGHT_GROUPS). */
export const BLAST_WAVE_GROUPS = [G, GK, GH];
export const BLAST_WAVE_PARAMS: Param[] = [
  { key: "waveOn", label: "Blast waves on", min: 0, max: 1, step: 1, group: G, tip: "Off: no screen bend and no ground ring (the pass costs nothing)" },
  { key: "waveSize", label: "Wave reach (× blast radius)", min: 0.5, max: 6, step: 0.05, group: G },
  { key: "waveMinSize", label: "Smallest wave reach (m)", min: 0, max: 10, step: 0.1, group: G },
  { key: "waveLife", label: "Wave time (s)", min: 0.1, max: 1.5, step: 0.01, group: G },
  { key: "waveStrength", label: "Bend (m)", min: 0, max: 2, step: 0.01, group: G, tip: "How far the ring pushes the picture outward at its start, in metres at the blast" },
  { key: "waveThick", label: "Ring thickness (× reach)", min: 0.03, max: 0.6, step: 0.01, group: G },
  { key: "waveEase", label: "Fast then slow", min: 1, max: 5, step: 0.05, group: G, tip: "1: the ring runs out at a steady speed; higher: it bursts out and slows" },
  { key: "waveRim", label: "Hot rim on the ring", min: 0, max: 1.5, step: 0.01, group: G, tip: "A faint bright edge on the bend" },
  { key: "waveRing2", label: "Second ring (big shells)", min: 0, max: 1.5, step: 0.01, group: G, tip: "Strength of a slower second ring on mortars, turret shells, excavator volleys, the beam, vehicles; 0 off" },
  { key: "waveRing2Slow", label: "Second ring speed (×)", min: 0.2, max: 1, step: 0.01, group: G },
  { key: "waveGround", label: "Ground ring brightness", min: 0, max: 3, step: 0.01, group: G, tip: "A quick bright ring on the sand (blasts on the ground only)" },
  { key: "waveGroundSize", label: "Ground ring reach (× blast radius)", min: 0.3, max: 4, step: 0.05, group: G },
  { key: "waveGroundLife", label: "Ground ring time (s)", min: 0.05, max: 1, step: 0.01, group: G },
  { key: "waveGroundLight", label: "Ground ring light at night", min: 0, max: 3, step: 0.01, group: G },
  { key: "waveMergeDist", label: "Merge distance (× reach)", min: 0, max: 2, step: 0.01, group: G, tip: "Waves this close (and within the merge time) become one bigger wave; 0 never merges" },
  { key: "waveMergeTime", label: "Merge time (s)", min: 0, max: 0.5, step: 0.01, group: G },
  { key: "waveMergeGrow", label: "Merged wave growth", min: 0, max: 1, step: 0.01, group: G, tip: "How much a wave grows per wave it swallows (as the square root of their strength)" },
  { key: "waveMax", label: "Most live waves", min: 1, max: 64, step: 1, group: G },
  { key: "wavePerFrame", label: "Most new waves a frame", min: 1, max: 32, step: 1, group: G, tip: "More than this in one frame fold into the nearest" },
  ...WAVE_KIND_LIST.map((k): Param => ({ key: WAVE_KINDS[k].key, label: `${WAVE_KINDS[k].label} (×)`, min: 0, max: 3, step: 0.01, group: GK })),
  { key: "waveTrail", label: "Exhaust shimmer on", min: 0, max: 1, step: 1, group: GH, tip: "Bent air behind rockets, missiles and shells in flight" },
  { key: "waveTrailStrength", label: "Exhaust shimmer bend (m)", min: 0, max: 0.4, step: 0.005, group: GH },
  { key: "waveTrailSize", label: "Exhaust puff size (m)", min: 0.2, max: 4, step: 0.05, group: GH },
  { key: "waveTrailLife", label: "Exhaust puff time (s)", min: 0.05, max: 1.5, step: 0.01, group: GH },
  { key: "waveTrailRate", label: "Exhaust puffs a second", min: 1, max: 60, step: 1, group: GH },
  { key: "waveHeat", label: "Heat after big blasts (s)", min: 0, max: 5, step: 0.05, group: GH, tip: "The air shimmers over the spot after a big shell; 0 off" },
  { key: "waveHeatStrength", label: "Heat bend (m)", min: 0, max: 0.5, step: 0.005, group: GH },
  { key: "waveBeamHeat", label: "Beam heat bend (m)", min: 0, max: 0.5, step: 0.005, group: GH, tip: "Over the excavator's emitter while it charges, and down the beam while it burns" },
  { key: "waveHeatMax", label: "Most heat puffs", min: 0, max: 256, step: 1, group: GH },
];

/** A live wave: a ring of bent air running out from (x, y, z). */
export interface Wave {
  x: number; y: number; z: number;
  /** Reach (m) at the end of its life. */
  reach: number;
  /** Bend (m) at its start. */
  strength: number;
  /** Seconds lived (negative: waiting to start, the second ring), and its whole life. */
  t: number; life: number;
  /** Ring thickness (× reach). */
  thick: number;
  /** How many posts it holds (merges). */
  n: number;
  /** Frame it was posted in. */
  frame: number;
  /** A ground ring with it (blasts on the ground), its reach (m), and the side's light family. */
  ground: boolean; groundReach: number; fam: number;
  /** The slower second ring of a big shell (merges only with other second rings). */
  ring2: boolean;
}

/** A puff of bent air (exhaust, heat over a blast, the beam): noisy, fading, drifting up. */
export interface Puff {
  x: number; y: number; z: number;
  size: number; strength: number;
  t: number; life: number;
  seed: number;
}

export interface WavePost {
  /** Ground ring (the blast is on the ground). Default true. */
  ground?: boolean;
  /** Light family of whose fire it was (src/world/lamps.ts). */
  fam?: number;
}

export class BlastWaves {
  readonly waves: Wave[] = [];
  readonly puffs: Puff[] = [];
  /** Counts for checks and the HUD: posts, merges, folded (over the caps), puffs dropped. */
  readonly stats = { posted: 0, merged: 0, folded: 0, started: 0, puffsDropped: 0 };
  private frame = 0;
  private newThisFrame = 0;

  constructor(public v: BlastWaveValues) {}

  /** Any wave or puff live (the draw skips the frame copy when not). */
  get active(): boolean { return this.v.waveOn > 0.5 && (this.waves.length > 0 || this.puffs.length > 0); }

  /** A blast of this radius (m) at (x, y, z), of this kind. */
  post(kind: WaveKind, x: number, y: number, z: number, radius: number, o: WavePost = {}) {
    const v = this.v;
    if (v.waveOn < 0.5) return;
    const p = WAVE_KINDS[kind] ?? WAVE_KINDS.default;
    const k = (v as unknown as Record<string, number>)[p.key] ?? 1;
    if (k <= 0) return;
    this.stats.posted++;
    const reach = Math.max(v.waveMinSize, v.waveSize * radius) * p.size * k;
    const strength = v.waveStrength * p.strength * k;
    const life = v.waveLife * p.life;
    const ground = o.ground ?? true, fam = o.fam ?? 0;
    const groundReach = v.waveGroundSize * radius * p.size * k;
    this.add({ x, y, z, reach, strength, t: 0, life, thick: v.waveThick, n: 1, frame: this.frame, ground, groundReach, fam, ring2: false });
    if (p.ring2 && v.waveRing2 > 0) {
      // The slower second ring starts with the first and runs out a little further, later.
      const slow = Math.max(0.2, v.waveRing2Slow);
      this.add({ x, y, z, reach: reach * 1.25, strength: strength * v.waveRing2, t: -0.04, life: life / slow, thick: v.waveThick * 1.4, n: 1, frame: this.frame, ground: false, groundReach: 0, fam, ring2: true });
    }
    if (p.heat && v.waveHeat > 0 && v.waveHeatStrength > 0) {
      const s = Math.max(1.5, radius * 0.9 * p.size);
      for (let i = 0; i < 2; i++) this.puff(x + (Math.random() - 0.5) * s * 0.6, y + 0.5 + i * s * 0.4, z + (Math.random() - 0.5) * s * 0.6, s, v.waveHeatStrength * k, v.waveHeat * (0.8 + 0.4 * Math.random()));
    }
  }

  /** Add a wave: merge with a close recent one, else start it (within the caps, else fold into the nearest). */
  private add(w: Wave) {
    const v = this.v, second = w.ring2;
    // Merge: a wave started within the merge time and close (× the bigger reach) swallows the new one.
    if (v.waveMergeDist > 0) {
      let best: Wave | null = null, bd = Infinity;
      for (const o of this.waves) {
        if (o.t > v.waveMergeTime || o.ring2 !== second) continue;
        const d = Math.hypot(o.x - w.x, o.y - w.y, o.z - w.z);
        if (d < v.waveMergeDist * Math.max(o.reach, w.reach) && d < bd) { bd = d; best = o; }
      }
      if (best) { this.merge(best, w); this.stats.merged++; return; }
    }
    const cap = Math.max(1, Math.round(v.waveMax)), perFrame = Math.max(1, Math.round(v.wavePerFrame));
    if (this.waves.length >= cap || (!second && this.newThisFrame >= perFrame)) {
      // Over a cap: fold into the nearest live wave (it grows), never a new one.
      let best: Wave | null = null, bd = Infinity;
      for (const o of this.waves) { const d = Math.hypot(o.x - w.x, o.z - w.z); if (d < bd) { bd = d; best = o; } }
      if (best) { this.merge(best, w); this.stats.folded++; }
      return;
    }
    if (!second) this.newThisFrame++;
    this.stats.started++;
    this.waves.push(w);
  }

  /** Fold b into a: the stronger's place weighted, strength as the root of their squares, reach grown. */
  private merge(a: Wave, b: Wave) {
    const v = this.v;
    const wa = a.strength * a.strength, wb = b.strength * b.strength, ws = wa + wb || 1;
    a.x += (b.x - a.x) * (wb / ws); a.y += (b.y - a.y) * (wb / ws); a.z += (b.z - a.z) * (wb / ws);
    const s = Math.sqrt(ws);
    const grow = 1 + v.waveMergeGrow * (s / Math.max(1e-6, Math.max(a.strength, b.strength)) - 1);
    a.reach = Math.max(a.reach, b.reach) * grow;
    a.strength = Math.min(s, Math.max(a.strength, b.strength) * 2);
    a.life = Math.max(a.life, b.life);
    a.ground = a.ground || b.ground;
    a.groundReach = Math.max(a.groundReach, b.groundReach) * (b.ground ? grow : 1);
    a.n += b.n;
  }

  /** A puff of bent air (size m, bend m, life s); dropped past the cap. */
  puff(x: number, y: number, z: number, size: number, strength: number, life: number) {
    if (this.v.waveOn < 0.5 || strength <= 0 || life <= 0) return;
    if (this.puffs.length >= Math.round(this.v.waveHeatMax)) { this.stats.puffsDropped++; return; }
    this.puffs.push({ x, y, z, size, strength, t: 0, life, seed: Math.random() * 100 });
  }

  /**
   * A rocket, missile or shell in flight this frame at (x, y, z) moving along (dx, dy, dz) (k its size): leaves exhaust
   * puffs behind it at the trail rate (shared across everything in flight, so a barrage leaves fewer per rocket).
   */
  exhaust(x: number, y: number, z: number, dx: number, dy: number, dz: number, k = 1) {
    const v = this.v;
    if (v.waveTrail < 0.5 || v.waveTrailStrength <= 0) return;
    if (Math.random() > this.trailChance) return;
    const L = Math.hypot(dx, dy, dz) || 1, back = 0.8 * k;
    this.puff(x - (dx / L) * back, y - (dy / L) * back, z - (dz / L) * back, v.waveTrailSize * k, v.waveTrailStrength * k, v.waveTrailLife);
  }
  /** This frame's chance an exhaust call leaves a puff (the rate over the frame, and fewer as puffs fill up). */
  private trailChance = 1;

  /** Heat held over a hot thing this frame (the beam): a puff now and then (bend m, size m). */
  heat(x: number, y: number, z: number, size: number, strength: number) {
    if (strength <= 0 || Math.random() > this.trailChance) return;
    this.puff(x + (Math.random() - 0.5) * size * 0.5, y, z + (Math.random() - 0.5) * size * 0.5, size, strength, this.v.waveTrailLife * 1.5);
  }

  update(dt: number) {
    this.frame++;
    this.newThisFrame = 0;
    const v = this.v;
    if (v.waveOn < 0.5) { this.waves.length = 0; this.puffs.length = 0; return; }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      if (w.t >= w.life) this.waves.splice(i, 1);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt; p.y += dt * 1.2;
      if (p.t >= p.life) this.puffs.splice(i, 1);
    }
    const fill = this.puffs.length / Math.max(1, v.waveHeatMax);
    this.trailChance = Math.min(1, dt * v.waveTrailRate) * Math.max(0, 1 - fill * fill);
  }

  /** A wave's front (0..1 of its reach) and fade (1 at the start, 0 at the end) at its age. */
  static shape(w: Wave, ease: number): { front: number; fade: number } {
    const u = Math.max(0, Math.min(1, w.t / w.life));
    if (w.t < 0) return { front: 0, fade: 0 };
    return { front: 1 - Math.pow(1 - u, ease), fade: (1 - u) * (1 - u) };
  }
}
