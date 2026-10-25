// Where someone on foot can stand (pure, no rendering): the true ground (DuneField.height, craters included) plus
// registered surfaces with moving frames: convoy decks, furniture tops, landing towers, stairs, footbridges
// (src/convoy/walkways.ts builds those). One query, walkHeight(x, z, fromY), answers for all of them, so the same
// walking code works on the sand and on a deck rolling along at 3 m/s.
//
// Rules: from height fromY you can stand on the highest top no more than stepUp above you. A solid surface (a deck, a
// hut, a tower: something you can't walk under) rising more than stepUp above you is a wall. Thin surfaces (a
// footbridge 3 m up) you simply walk under. Whether you may step down to what's found (and how far) is the walker's
// rule (pilot.ts: a drop limit acts as the rails).
//
// Moving frames: a surface hangs on a frame (a platform, a bridge between two cars). Someone standing on it keeps
// their spot in the frame's local coordinates; next step the frame's new pose puts them back in the world, so they
// ride a turning, heaving deck without sliding off.

/** A point. */
export interface Vec3 { x: number; y: number; z: number }

/**
 * A moving frame on the ground plane: world x/z to local and back (exact inverses), and its heading, so a rider turns
 * with it. Heights come from the surface, not the frame.
 */
export interface Frame {
  heading(): number;
  toLocal(x: number, z: number, out: { x: number; z: number }): { x: number; z: number };
  toWorld(lx: number, lz: number, out: { x: number; z: number }): { x: number; z: number };
}

export interface Surface {
  name: string;
  /** The frame it moves with (null: fixed in the world). */
  frame: Frame | null;
  /** Top height at world (x, z), or NaN when (x, z) isn't over it. */
  top(x: number, z: number): number;
  /** Solid under the top: a wall to anyone lower than top - stepUp. */
  solid: boolean;
  /** Not walkable right now (a footbridge lifted clear). */
  off?: boolean;
  /** Where to put someone standing on it when it goes off (the nearer landing of a lifted bridge). */
  evict?(x: number, z: number): Vec3;
  /** A rough bound (world x, z, radius) for skipping it cheaply; updated by whoever owns it. */
  bound?: { x: number; z: number; r: number };
}

/** What a query found: the height to stand at and the surface (null: the ground itself). */
export interface WalkHit { y: number; surface: Surface | null }

/** The ground as a frame: the world itself. */
export const WORLD: Frame = {
  heading: () => 0,
  toLocal: (x, z, out) => { out.x = x; out.z = z; return out; },
  toWorld: (x, z, out) => { out.x = x; out.z = z; return out; },
};

export class Walkable {
  /** Registered surfaces (owners add, remove and update them). */
  readonly surfaces: Surface[] = [];
  /** Surfaces looked at in the last query (for the frame cost line). */
  checked = 0;

  constructor(readonly ground: { height(x: number, z: number): number }) {}

  /**
   * The surface (or ground) someone at height fromY stands on at (x, z): the highest top no more than stepUp above
   * fromY. Null when a solid surface there rises more than stepUp above fromY (a wall).
   */
  walkHeight(x: number, z: number, fromY: number, stepUp = 0.45, out: WalkHit = { y: 0, surface: null }): WalkHit | null {
    let best = this.ground.height(x, z), on: Surface | null = null;
    const reach = fromY + stepUp;
    this.checked = 0;
    for (const s of this.surfaces) {
      if (s.off) continue;
      const b = s.bound;
      if (b && (x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) > b.r * b.r) continue;
      this.checked++;
      const h = s.top(x, z);
      if (h !== h) continue; // NaN: not over it
      if (h > reach) { if (s.solid) return null; continue; }
      if (h > best) { best = h; on = s; }
    }
    out.y = best; out.surface = on;
    return out;
  }

  /** The highest surface top (or the ground) at or below y at (x, z): where something falling from y lands. */
  floorBelow(x: number, z: number, y: number, out: WalkHit = { y: 0, surface: null }): WalkHit {
    let best = this.ground.height(x, z), on: Surface | null = null;
    for (const s of this.surfaces) {
      if (s.off) continue;
      const b = s.bound;
      if (b && (x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) > b.r * b.r) continue;
      const h = s.top(x, z);
      if (h !== h || h > y + 1e-3) continue;
      if (h > best) { best = h; on = s; }
    }
    out.y = best; out.surface = on;
    return out;
  }
}
