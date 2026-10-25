// The pilot on foot (pure, no rendering; docs/proposal-pilot.md, Keith 2026-10-26): a small capsule controller. WASD
// (relative to the screen, the lab turns it into a world stick), turning toward where he moves, walk or run (Shift).
// He stands on whatever src/world/walkable.ts says is under him: the sand, a convoy deck, a stair, a footbridge. On a
// moving surface he keeps his spot in its frame, so a turning, heaving deck carries him; he can't step down more than
// a drop limit (the rails: no walking off a deck or a bridge), can't walk into walls (huts, towers, decks seen from
// the sand) and climbs stairs slower along the slope. Very fragile: a little health, and dead is dead.
// Ownership (multiplayer later): his movement is the player's own (a command in: stick and run); his health is the
// host's (damage comes through quarry.ts). No randomness.
import type { Param } from "../core/tweaks";
import { WORLD, type Frame, type Surface, type Walkable, type WalkHit } from "../world/walkable";

export const PILOT_DEFAULTS = {
  pilotHeight: 1.8,
  pilotRadius: 0.3,
  pilotWalk: 1.6,
  pilotRun: 4.5,
  pilotAccel: 14,
  pilotTurn: 720,
  pilotStepUp: 0.45,
  pilotDrop: 0.6,
  pilotClimb: 0.6,
  pilotHealth: 30,
};
export type PilotValues = typeof PILOT_DEFAULTS;
const G = "Pilot";
export const PILOT_PARAMS: Param[] = [
  { key: "pilotHeight", label: "Height (m)", min: 1.4, max: 2.4, step: 0.01, group: G, tip: "Drawn height and where shots aim (chest at two thirds)" },
  { key: "pilotRadius", label: "Body radius (m)", min: 0.15, max: 0.6, step: 0.01, group: G, tip: "Keeps him off the mech's legs and the convoy's sides; what rounds hit" },
  { key: "pilotWalk", label: "Walk (m/s)", min: 0.5, max: 4, step: 0.05, group: G },
  { key: "pilotRun", label: "Run, Shift (m/s)", min: 1, max: 9, step: 0.05, group: G },
  { key: "pilotAccel", label: "Speed up and slow down (m/s²)", min: 1, max: 60, step: 0.5, group: G },
  { key: "pilotTurn", label: "Turn toward moving (°/s)", min: 60, max: 2000, step: 10, group: G },
  { key: "pilotStepUp", label: "Steps up to (m)", min: 0.1, max: 1, step: 0.01, group: G, tip: "Anything taller and solid is a wall" },
  { key: "pilotDrop", label: "Steps down to (m)", min: 0.1, max: 3, step: 0.05, group: G, tip: "He won't walk off anything higher than this (deck edges, bridges): the rails" },
  { key: "pilotClimb", label: "Stair speed ×", min: 0.2, max: 1.5, step: 0.05, group: G, tip: "Speed along a stair's slope against the flat" },
  { key: "pilotHealth", label: "Health", min: 1, max: 300, step: 1, group: G, tip: "Keith 2026-10-26: very vulnerable on foot" },
];

export interface Stick { x: number; z: number }

const D2R = Math.PI / 180;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** Something to keep clear of on the ground (the mech's legs): a circle. */
export interface Blocker { x: number; z: number; r: number }

export class PilotSim {
  /** Feet position (world). */
  readonly pos = { x: 0, y: 0, z: 0 };
  /** Velocity over the surface he stands on (world axes, m/s), and its size. */
  readonly vel = { x: 0, z: 0 };
  speed = 0;
  /** Velocity in the world (surface motion included), for leading shots. */
  readonly worldVel = { x: 0, z: 0 };
  heading = 0;
  health: number;
  alive = true;
  /** Falling (the surface under him went away). */
  vy = 0;
  /** What he stands on (null: the ground) and his spot and heading in its frame. */
  on: Surface | null = null;
  private local = { x: 0, z: 0 };
  private relHeading = 0;
  /** Recent damage per second (HUD flash). */
  hurt = 0;
  /** Counts for the check: steps blocked by a wall or a drop. */
  blocked = 0;
  /** Running (Shift held while moving). */
  running = false;
  private hit: WalkHit = { y: 0, surface: null };
  private w = { x: 0, z: 0 };

  constructor(public v: PilotValues, readonly walk: Walkable) { this.health = v.pilotHealth; }

  get frame(): Frame { return this.on?.frame ?? WORLD; }

  /** Stand at world (x, z) facing heading, on whatever is there at about height y (or the highest thing below y + step up). */
  place(x: number, y: number, z: number, heading: number) {
    const h = this.walk.walkHeight(x, z, y, this.v.pilotStepUp, this.hit) ?? this.walk.floorBelow(x, z, y + this.v.pilotStepUp, this.hit);
    this.pos.x = x; this.pos.z = z; this.pos.y = h.y;
    this.on = h.surface;
    this.heading = heading;
    this.vel.x = this.vel.z = this.speed = this.vy = 0;
    this.remember();
  }

  /** Full health, alive. */
  revive() { this.health = this.v.pilotHealth; this.alive = true; this.hurt = 0; }

  damage(amount: number) {
    if (!this.alive) return;
    this.health -= amount;
    this.hurt += amount;
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  /** The surface moved since the last step: put him back on his spot in its frame. Call once per step before step(). */
  ride() {
    if (this.on?.off) {
      // A footbridge lifting clear: back on the nearer landing.
      const e = this.on.evict?.(this.pos.x, this.pos.z);
      this.on = null;
      if (e) this.place(e.x, e.y, e.z, this.heading);
      return;
    }
    if (!this.on?.frame) return;
    const f = this.on.frame, px = this.pos.x, pz = this.pos.z;
    f.toWorld(this.local.x, this.local.z, this.w);
    this.pos.x = this.w.x; this.pos.z = this.w.z;
    this.heading = wrap(f.heading() + this.relHeading);
    // Height: the surface's top where he now is (it heaves and tilts).
    const h = this.on.top(this.pos.x, this.pos.z);
    if (h === h) this.pos.y = h;
    this.carried.x = this.pos.x - px; this.carried.z = this.pos.z - pz;
  }
  /** How far the surface carried him this step (m). */
  readonly carried = { x: 0, z: 0 };

  /**
   * One step (call at 120 Hz). stick: where to go (world x/z, length up to 1); run: Shift. blockers: circles to keep
   * out of (the mech's legs). pushOut: on the sand, shove out of solid footprints (the convoy's cars).
   */
  step(dt: number, stick: Stick, run: boolean, blockers: Blocker[] = [], pushOut?: (x: number, z: number, r: number) => { x: number; z: number } | null) {
    const v = this.v;
    this.hurt = Math.max(0, this.hurt - dt * 30);
    if (!this.alive) { this.vel.x = this.vel.z = this.speed = 0; return; }
    const mag = Math.min(1, Math.hypot(stick.x, stick.z));
    this.running = run && mag > 0.1;
    const top = (this.running ? v.pilotRun : v.pilotWalk) * mag;
    const tx = mag > 1e-3 ? (stick.x / Math.hypot(stick.x, stick.z)) * top : 0, tz = mag > 1e-3 ? (stick.z / Math.hypot(stick.x, stick.z)) * top : 0;
    // Toward the wanted velocity at the acceleration limit.
    const ax = tx - this.vel.x, az = tz - this.vel.z, al = Math.hypot(ax, az), maxA = v.pilotAccel * dt;
    if (al > maxA) { this.vel.x += (ax / al) * maxA; this.vel.z += (az / al) * maxA; } else { this.vel.x = tx; this.vel.z = tz; }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // Falling: down to whatever is below, no walking.
    const below = this.walk.floorBelow(this.pos.x, this.pos.z, this.pos.y + 0.05, this.hit);
    if (this.pos.y > below.y + 0.05 || this.vy > 0) {
      this.vy -= 9.81 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= below.y) { this.pos.y = below.y; this.vy = 0; this.on = below.surface; }
      this.remember();
      return;
    }

    let dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (dx * dx + dz * dz > 1e-12) {
      // A step: whole, else along x or z alone (slides along walls and rails).
      let moved = this.tryStep(dx, dz) || this.tryStep(dx, 0) || this.tryStep(0, dz);
      if (!moved) { this.blocked++; this.vel.x = this.vel.z = 0; }
      // Turn toward where he goes.
      const want = Math.atan2(this.vel.x, this.vel.z), d = wrap(want - this.heading), m = v.pilotTurn * D2R * dt;
      if (this.speed > 0.05) this.heading = wrap(this.heading + Math.max(-m, Math.min(m, d)));
      void moved;
    } else {
      // Standing: settle onto whatever's under him (a heaving deck).
      const h = this.walk.walkHeight(this.pos.x, this.pos.z, this.pos.y, v.pilotStepUp, this.hit);
      if (h && h.y >= this.pos.y - v.pilotDrop) { this.pos.y = h.y; this.on = h.surface; }
    }
    // Keep off the mech's legs and (on the sand) out of the cars.
    for (const b of blockers) {
      const ox = this.pos.x - b.x, oz = this.pos.z - b.z, d = Math.hypot(ox, oz), m = b.r + v.pilotRadius;
      if (d >= m) continue;
      const nx = d > 1e-6 ? ox / d : 1, nz = d > 1e-6 ? oz / d : 0;
      const x = b.x + nx * m, z = b.z + nz * m;
      const h = this.walk.walkHeight(x, z, this.pos.y, v.pilotStepUp, this.hit);
      if (h && h.y >= this.pos.y - v.pilotDrop) { this.pos.x = x; this.pos.z = z; this.pos.y = h.y; this.on = h.surface; }
    }
    if (!this.on && pushOut) {
      const o = pushOut(this.pos.x, this.pos.z, v.pilotRadius);
      if (o) { this.pos.x = o.x; this.pos.z = o.z; this.pos.y = this.walk.ground.height(o.x, o.z); }
    }
    this.worldVel.x = this.vel.x + this.carried.x / Math.max(1e-4, dt);
    this.worldVel.z = this.vel.z + this.carried.z / Math.max(1e-4, dt);
    this.carried.x = this.carried.z = 0;
    this.remember();
  }

  /** Try moving by (dx, dz): true if he could (no wall, no drop past the limit); climbs slower on stairs. */
  private tryStep(dx: number, dz: number) {
    if (dx === 0 && dz === 0) return false;
    const v = this.v;
    let h = this.walk.walkHeight(this.pos.x + dx, this.pos.z + dz, this.pos.y, v.pilotStepUp, this.hit);
    if (!h || h.y < this.pos.y - v.pilotDrop) return false;
    // Steep (a stair): go slower along the slope.
    const run = Math.hypot(dx, dz), rise = Math.abs(h.y - this.pos.y);
    if (rise > run * 0.5) {
      const k = (v.pilotClimb * run) / Math.hypot(run, rise);
      dx *= k; dz *= k;
      h = this.walk.walkHeight(this.pos.x + dx, this.pos.z + dz, this.pos.y, v.pilotStepUp, this.hit);
      if (!h || h.y < this.pos.y - v.pilotDrop) return false;
    }
    this.pos.x += dx; this.pos.z += dz; this.pos.y = h.y;
    this.on = h.surface;
    return true;
  }

  /** Remember his spot and heading in the frame of what he stands on. */
  private remember() {
    const f = this.frame;
    f.toLocal(this.pos.x, this.pos.z, this.local);
    this.relHeading = wrap(this.heading - f.heading());
  }
}
