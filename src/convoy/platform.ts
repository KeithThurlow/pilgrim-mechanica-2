// Convoy platforms (pure, no rendering): big vehicles following the route as a train (train.ts). Each one rides on
// two bogie points on the route (40% of its length ahead of and behind its middle, on its line), so it sits on the
// chord of the curve and the train snakes through turns. Each one samples
// the ground under its wheels (or along its tracks), fits a plane through them, and rides toward it on springs, so
// it heaves, pitches and rolls with the ground like the cars do.
//
// Frame: local x = left, y = up, z = forward (heading convention: heading 0 faces +Z, +X is left). The origin sits on
// the ground plane under the platform's middle; the deck top is at convoyDeckHeight (bay: convoyBayDeck).
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import type { ConvoyRoute, RoutePoint } from "./route";
import { arrange, type TrainValues } from "./train";

export const PLATFORM_DEFAULTS = {
  convoyDeckHeight: 3.2,
  convoyBayDeck: 3.6,
  convoySpringHz: 0.7,
  convoyDamping: 0.7,
  convoyTrackSprings: 1.6,
  convoyPush: 1,
};
export type PlatformValues = typeof PLATFORM_DEFAULTS;

export const PLATFORM_PARAMS: Param[] = [
  { key: "convoyDeckHeight", label: "Deck height (m)", min: 1.5, max: 6, step: 0.1, group: "Platforms", tip: "Wheeled platforms' deck above the ground" },
  { key: "convoyBayDeck", label: "Bay deck height (m)", min: 1.5, max: 6, step: 0.1, group: "Platforms", tip: "The tracked mech-bay platform's deck above the ground" },
  { key: "convoySpringHz", label: "Suspension (Hz)", min: 0.2, max: 3, step: 0.05, group: "Platforms", tip: "How quickly a platform follows the ground's heave, pitch and roll" },
  { key: "convoyDamping", label: "Suspension damping", min: 0.1, max: 2, step: 0.05, group: "Platforms", tip: "1 = no overshoot" },
  { key: "convoyTrackSprings", label: "Tracks stiffer by", min: 0.5, max: 4, step: 0.05, group: "Platforms", tip: "The tracked platform's suspension frequency over the wheeled ones'" },
  { key: "convoyPush", label: "Platforms shove the mech", min: 0, max: 1, step: 1, group: "Platforms", tip: "A walking mech can't pass through a platform" },
];

export type PlatformKind = "bay" | "workshop" | "housing" | "fuel" | "motorpool";

export interface PlatformSpec {
  name: string;
  kind: PlatformKind;
  length: number;
  width: number;
  tracked: boolean;
}

/** The convoy in train order: the tracked mech bay leads, the tracked workshop next, wheeled cars behind. */
export const CONVOY_LAYOUT: PlatformSpec[] = [
  { name: "Mech bay", kind: "bay", length: 40, width: 16, tracked: true },
  { name: "Workshop", kind: "workshop", length: 30, width: 14, tracked: true },
  { name: "Housing", kind: "housing", length: 24, width: 10, tracked: false },
  { name: "Motor pool", kind: "motorpool", length: 26, width: 11, tracked: false },
  { name: "Fuel", kind: "fuel", length: 24, width: 10, tracked: false },
  { name: "Housing", kind: "housing", length: 24, width: 10, tracked: false },
];

/** A damped spring toward a target, by frequency (Hz) and damping ratio. */
class Spring {
  x = 0; v = 0;
  step(target: number, hz: number, zeta: number, dt: number) {
    const w = 2 * Math.PI * hz;
    this.v += (w * w * (target - this.x) - 2 * zeta * w * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export class Platform {
  /** Ground-plane origin under the middle (y = the sprung ride height). */
  x = 0; y = 0; z = 0;
  heading = 0;
  /** Velocity (m/s), from the motion. */
  vel = { x: 0, y: 0, z: 0 };
  /** Basis: left, up, forward (unit vectors, world). */
  left = { x: 1, y: 0, z: 0 };
  up = { x: 0, y: 1, z: 0 };
  fwd = { x: 0, y: 0, z: 1 };
  /** Distance travelled (for spinning wheels). */
  travelled = 0;
  /** Along-route offset of its middle from the convoy's head and side offset (m), its line, the car it follows. */
  along = 0;
  side = 0;
  lane = 0;
  follows = -1;
  /** Extra spacing behind the car it follows (m): grows in turns so the inside corners keep the gap open. */
  spread = 0;
  /** Support points (local x, z) the ground is sampled under. */
  readonly supports: [number, number][] = [];
  /** Highest |pitch| and |roll| seen (degrees), for the check. */
  maxTilt = 0;
  private hY = new Spring();
  private hRoll = new Spring();
  private hPitch = new Spring();
  private started = false;
  private moved = false;
  private pf: RoutePoint = { x: 0, z: 0, heading: 0 };
  private pb: RoutePoint = { x: 0, z: 0, heading: 0 };
  private pm: RoutePoint = { x: 0, z: 0, heading: 0 };

  constructor(readonly spec: PlatformSpec, public v: PlatformValues & { trackOut?: number }, private field: DuneField) {
    const { length: L, width: W, tracked } = spec;
    if (tracked) {
      for (const sx of [1, -1]) for (let i = 0; i < 6; i++) this.supports.push([sx * (W / 2 - 1.6), -0.44 * L + (0.88 * L * i) / 5]);
    } else {
      for (const sx of [1, -1]) for (const sz of [0.36, 0, -0.36]) this.supports.push([sx * (W / 2 - 0.7), sz * L]);
    }
  }

  /** Forget the motion (after the route resets). */
  reset() { this.started = false; this.moved = false; this.maxTilt = 0; this.travelled = 0; this.vel = { x: 0, y: 0, z: 0 }; }

  /** Deck top above the origin. */
  get deck() { return this.spec.tracked ? this.v.convoyBayDeck : this.v.convoyDeckHeight; }

  /** Bogie points along the route either side of the middle, as a share of the length. */
  static readonly BOGIE = 0.4;

  /** Follow the route: the middle between the two bogies, heading along the chord between them (along/side set). */
  update(dt: number, route: ConvoyRoute) {
    const bg = this.spec.length * Platform.BOGIE;
    const fr = route.offsetAt(route.s + this.along + bg, this.side, this.pf);
    const rr = route.offsetAt(route.s + this.along - bg, this.side, this.pb);
    const px = this.x, pz = this.z, py = this.y;
    // The middle on its line's path, turned along the chord between the bogies (the tangent there on an even curve).
    const mid = route.offsetAt(route.s + this.along, this.side, this.pm);
    this.x = mid.x; this.z = mid.z;
    this.heading = Math.atan2(fr.x - rr.x, fr.z - rr.z);
    const s = Math.sin(this.heading), c = Math.cos(this.heading);

    // Fit a plane h = a + b * lx + k * lz through the ground under the supports (they're symmetric about the middle).
    let sum = 0, sxh = 0, sxx = 0, szh = 0, szz = 0;
    for (const [lx, lz] of this.supports) {
      const h = this.field.height(this.x + c * lx + s * lz, this.z - s * lx + c * lz);
      sum += h; sxh += lx * h; sxx += lx * lx; szh += lz * h; szz += lz * lz;
    }
    const n = this.supports.length;
    const a = sum / n, b = sxh / sxx, k = szh / szz;
    const hz = this.v.convoySpringHz * (this.spec.tracked ? this.v.convoyTrackSprings : 1), zeta = this.v.convoyDamping;
    if (!this.started) { this.hY.x = a; this.hRoll.x = b; this.hPitch.x = k; this.started = true; }
    else { this.hY.step(a, hz, zeta, dt); this.hRoll.step(b, hz, zeta, dt); this.hPitch.step(k, hz, zeta, dt); }
    this.y = this.hY.x;
    const roll = this.hRoll.x, pitch = this.hPitch.x;

    // Basis from the slopes: forward rises by pitch per metre, left by roll per metre.
    const f = norm(s, pitch, c), l0 = norm(c, roll, -s);
    const u = norm(f.y * l0.z - f.z * l0.y, f.z * l0.x - f.x * l0.z, f.x * l0.y - f.y * l0.x);
    const l = norm(u.y * f.z - u.z * f.y, u.z * f.x - u.x * f.z, u.x * f.y - u.y * f.x);
    this.fwd = f; this.up = u; this.left = l;
    this.maxTilt = Math.max(this.maxTilt, (Math.atan(Math.abs(pitch)) * 180) / Math.PI, (Math.atan(Math.abs(roll)) * 180) / Math.PI);

    if (this.moved && dt > 0) {
      this.vel.x = (this.x - px) / dt; this.vel.y = (this.y - py) / dt; this.vel.z = (this.z - pz) / dt;
      this.travelled += Math.hypot(this.x - px, this.z - pz);
    }
    this.moved = true;
  }

  /** Horizontal speed (m/s). */
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  /** Local point (left, up, forward) to world. */
  toWorld(lx: number, ly: number, lz: number, out = { x: 0, y: 0, z: 0 }) {
    const { left: l, up: u, fwd: f } = this;
    out.x = this.x + l.x * lx + u.x * ly + f.x * lz;
    out.y = this.y + l.y * lx + u.y * ly + f.y * lz;
    out.z = this.z + l.z * lx + u.z * ly + f.z * lz;
    return out;
  }

  /** World x/z to local (left, forward), on the ground plane. */
  toLocal(x: number, z: number, out = { x: 0, z: 0 }) {
    const dx = x - this.x, dz = z - this.z, s = Math.sin(this.heading), c = Math.cos(this.heading);
    out.x = dx * c - dz * s;
    out.z = dx * s + dz * c;
    return out;
  }

  /** Half the overall width: the deck's, plus the crawler tracks where they stand out past its edges. */
  get halfW() { return this.spec.width / 2 + (this.spec.tracked ? Math.max(0, this.v.trackOut ?? 0) : 0); }

  /** Distance from (x, z) to the footprint (0 inside). */
  gapAt(x: number, z: number) {
    const l = this.toLocal(x, z);
    return Math.hypot(Math.max(0, Math.abs(l.x) - this.halfW), Math.max(0, Math.abs(l.z) - this.spec.length / 2));
  }

  /** Clear distance between this footprint and another's (0 if they touch): each one's corners against the other. */
  gapTo(o: Platform) {
    let d = Infinity;
    for (const [a, b] of [[this, o], [o, this]] as const) {
      for (const sx of [1, -1]) for (const sz of [1, -1]) {
        const w = a.toWorld(sx * a.halfW, 0, (sz * a.spec.length) / 2, this.cw);
        d = Math.min(d, b.gapAt(w.x, w.z));
      }
    }
    return d;
  }
  private cw = { x: 0, y: 0, z: 0 };

  /**
   * Keep a body of radius r out of the platform's footprint: returns the pushed x/z, or null when it's clear.
   */
  pushOut(x: number, z: number, r: number): { x: number; z: number } | null {
    const p = this.toLocal(x, z), hw = this.halfW + r, hl = this.spec.length / 2 + r;
    if (Math.abs(p.x) >= hw || Math.abs(p.z) >= hl) return null;
    // Out through the nearest side.
    const ox = hw - Math.abs(p.x), oz = hl - Math.abs(p.z);
    if (ox < oz) p.x = Math.sign(p.x || 1) * hw; else p.z = Math.sign(p.z || 1) * hl;
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    return { x: this.x + c * p.x + s * p.z, z: this.z - s * p.x + c * p.z };
  }
}

function norm(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

/** Fastest a car drops back from or closes up on the one ahead to keep the gap in turns (m/s). */
const SPREAD_RATE = 1.5;

/** The whole convoy: the route and its platforms, laid out as a train. */
export class Convoy {
  readonly platforms: Platform[];
  constructor(readonly route: ConvoyRoute, readonly v: PlatformValues & TrainValues, field: DuneField, readonly layout: PlatformSpec[] = CONVOY_LAYOUT) {
    this.platforms = layout.map((s) => new Platform(s, v, field));
    arrange(this.platforms, v);
  }
  get bay() { return this.platforms.find((p) => p.spec.kind === "bay") ?? this.platforms[0]; }
  /** Along-route distance from the lead's nose to the last car's tail (m). */
  get length() { return Math.max(...this.platforms.map((p) => p.spec.length / 2 - p.along)) + this.platforms[0].spec.length / 2; }
  /** Start over with the head at (x, z). */
  reset(x: number, z: number) {
    this.route.reset(x, z);
    for (const p of this.platforms) p.spread = 0;
    arrange(this.platforms, this.v);
    for (const p of this.platforms) { p.reset(); p.update(0, this.route); }
  }
  update(dt: number) {
    this.route.update(dt);
    // Sliders apply live: the gaps and lines are laid out again every step.
    arrange(this.platforms, this.v);
    for (const p of this.platforms) p.update(dt, this.route);
    // In a turn the inside corners of neighbouring cars close up: each car drops back (or closes up again) toward
    // the spacing that keeps trainGap clear at the nearest corners, at no more than SPREAD_RATE m/s.
    for (const p of this.platforms) {
      if (p.follows < 0) continue;
      const want = Math.max(0, p.spread + this.v.trainGap - p.gapTo(this.platforms[p.follows]));
      p.spread += Math.max(-SPREAD_RATE * dt, Math.min(SPREAD_RATE * dt, (want - p.spread) * 4 * dt));
    }
  }
}
