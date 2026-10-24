// Convoy platforms (pure, no rendering): big vehicles following the route at formation offsets. Each one samples
// the ground under its wheels (or along its tracks), fits a plane through them, and rides toward it on springs, so
// it heaves, pitches and rolls with the ground like the cars do.
//
// Frame: local x = left, y = up, z = forward (heading convention: heading 0 faces +Z, +X is left). The origin sits on
// the ground plane under the platform's middle; the deck top is at convoyDeckHeight (bay: convoyBayDeck).
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import type { ConvoyRoute, RoutePoint } from "./route";

export const PLATFORM_DEFAULTS = {
  convoyGap: 22,
  convoySide: 11,
  convoyDeckHeight: 3.2,
  convoyBayDeck: 3.6,
  convoySpringHz: 0.7,
  convoyDamping: 0.7,
  convoyTrackSprings: 1.6,
  convoyPush: 1,
};
export type PlatformValues = typeof PLATFORM_DEFAULTS;

export const PLATFORM_PARAMS: Param[] = [
  { key: "convoyGap", label: "Row gap (m)", min: 6, max: 60, step: 1, group: "Formation", tip: "Clear gap between rows of platforms" },
  { key: "convoySide", label: "Column offset (m)", min: 6, max: 24, step: 0.5, group: "Formation", tip: "Paired platforms sit this far either side of the route" },
  { key: "convoyDeckHeight", label: "Deck height (m)", min: 1.5, max: 6, step: 0.1, group: "Platforms", tip: "Wheeled platforms' deck above the ground" },
  { key: "convoyBayDeck", label: "Bay deck height (m)", min: 1.5, max: 6, step: 0.1, group: "Platforms", tip: "The tracked mech-bay platform's deck above the ground" },
  { key: "convoySpringHz", label: "Suspension (Hz)", min: 0.2, max: 3, step: 0.05, group: "Platforms", tip: "How quickly a platform follows the ground's heave, pitch and roll" },
  { key: "convoyDamping", label: "Suspension damping", min: 0.1, max: 2, step: 0.05, group: "Platforms", tip: "1 = no overshoot" },
  { key: "convoyTrackSprings", label: "Tracks stiffer by", min: 0.5, max: 4, step: 0.05, group: "Platforms", tip: "The tracked platform's suspension frequency over the wheeled ones'" },
  { key: "convoyPush", label: "Platforms shove the mech", min: 0, max: 1, step: 1, group: "Platforms", tip: "A walking mech can't pass through a platform" },
];

export type PlatformKind = "bay" | "workshop" | "housing" | "fuel";

export interface PlatformSpec {
  name: string;
  kind: PlatformKind;
  length: number;
  width: number;
  tracked: boolean;
  /** Formation row (0 leads) and column (-1 right, 0 middle, +1 left). */
  row: number;
  col: -1 | 0 | 1;
}

/** The convoy: one big tracked mech-bay platform leading, wheeled ones in pairs behind. */
export const CONVOY_LAYOUT: PlatformSpec[] = [
  { name: "Mech bay", kind: "bay", length: 40, width: 16, tracked: true, row: 0, col: 0 },
  { name: "Workshop", kind: "workshop", length: 24, width: 10, tracked: false, row: 1, col: 1 },
  { name: "Housing", kind: "housing", length: 24, width: 10, tracked: false, row: 1, col: -1 },
  { name: "Fuel", kind: "fuel", length: 24, width: 10, tracked: false, row: 2, col: 1 },
  { name: "Housing", kind: "housing", length: 24, width: 10, tracked: false, row: 2, col: -1 },
  { name: "Housing", kind: "housing", length: 24, width: 10, tracked: false, row: 3, col: 0 },
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
  /** Along-route offset from the convoy's head and side offset (m). */
  along = 0;
  side = 0;
  /** Support points (local x, z) the ground is sampled under. */
  readonly supports: [number, number][] = [];
  /** Highest |pitch| and |roll| seen (degrees), for the check. */
  maxTilt = 0;
  private hY = new Spring();
  private hRoll = new Spring();
  private hPitch = new Spring();
  private started = false;
  private moved = false;
  private p: RoutePoint = { x: 0, z: 0, heading: 0 };

  constructor(readonly spec: PlatformSpec, public v: PlatformValues, private field: DuneField) {
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

  /** Place in the formation: along-route offset from the head and side offset for its row and column. */
  layout(all: PlatformSpec[]) {
    const lead = all.find((s) => s.row === 0)?.length ?? 40;
    const rowLen = (r: number) => Math.max(...all.filter((s) => s.row === r).map((s) => s.length), 0);
    let a = 0;
    for (let r = 1; r <= this.spec.row; r++) a -= (r === 1 ? lead : rowLen(r - 1)) / 2 + this.v.convoyGap + rowLen(r) / 2;
    this.along = a;
    this.side = this.spec.col * this.v.convoySide;
  }

  update(dt: number, route: ConvoyRoute, all: PlatformSpec[]) {
    this.layout(all);
    const p = route.offsetAt(route.s + this.along, this.side, this.p);
    const px = this.x, pz = this.z, py = this.y;
    this.x = p.x; this.z = p.z; this.heading = p.heading;
    const s = Math.sin(p.heading), c = Math.cos(p.heading);

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

  /**
   * Keep a body of radius r out of the platform's footprint: returns the pushed x/z, or null when it's clear.
   */
  pushOut(x: number, z: number, r: number): { x: number; z: number } | null {
    const p = this.toLocal(x, z), hw = this.spec.width / 2 + r, hl = this.spec.length / 2 + r;
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

/** The whole convoy: the route and its platforms. */
export class Convoy {
  readonly platforms: Platform[];
  constructor(readonly route: ConvoyRoute, v: PlatformValues, field: DuneField, readonly layout: PlatformSpec[] = CONVOY_LAYOUT) {
    this.platforms = layout.map((s) => new Platform(s, v, field));
  }
  get bay() { return this.platforms.find((p) => p.spec.kind === "bay") ?? this.platforms[0]; }
  /** Start over with the head at (x, z). */
  reset(x: number, z: number) {
    this.route.reset(x, z);
    for (const p of this.platforms) { p.reset(); p.update(0, this.route, this.layout); }
  }
  update(dt: number) {
    this.route.update(dt);
    for (const p of this.platforms) p.update(dt, this.route, this.layout);
  }
}
