// A platform's deck outline (pure, no rendering): not a plain rectangle (Keith 2026-10-25: "a little more
// hexagonal") but a convex octagon, the corners cut at an angle: bigger cuts at the front, small ones at the back,
// and a pointed prow on the lead car. Everything that needs the deck's edge reads it from here: the deck as ground
// and what keeps the mech on it (deck.ts), the push-out footprint (platform.ts), the drawing (platformBody.ts) and
// the pipes along the edges (pipes.ts).
// Frame: the platform's local x (left) and z (forward), metres.
import type { PlatformSpec } from "./platform";

/** One edge as a half-plane: inside where nx * x + nz * z <= d (n is the outward unit normal). */
export interface Edge { nx: number; nz: number; d: number }
export interface Outline {
  /** Corners, counter-clockwise seen from above (x left, z forward), starting at the front left of the nose. */
  pts: [number, number][];
  edges: Edge[];
  halfW: number;
  halfL: number;
  /** Corner cuts (across x, along z) at the front and the back. */
  front: [number, number];
  rear: [number, number];
}

/** Corner cuts for a platform: [across, along] at the front and the back (m). */
export function cuts(spec: PlatformSpec): { front: [number, number]; rear: [number, number] } {
  const W = spec.width;
  if (spec.prow) return { front: [W * 0.3, 6], rear: [W * 0.1, W * 0.1] };
  const f = W * 0.2;
  return { front: [f, f * 1.25], rear: [W * 0.1, W * 0.1] };
}

/**
 * The outline of a platform's deck, or of its footprint when extraHalfW widens the sides (the crawler tracks stand
 * out past the deck; the cuts stay the same size).
 */
export function deckOutline(spec: PlatformSpec, extraHalfW = 0): Outline {
  const hw = spec.width / 2 + extraHalfW, hl = spec.length / 2;
  const { front, rear } = cuts(spec);
  const [fx, fz] = front, [rx, rz] = rear;
  const pts: [number, number][] = [
    [hw - fx, hl], [-(hw - fx), hl], [-hw, hl - fz], [-hw, -hl + rz],
    [-(hw - rx), -hl], [hw - rx, -hl], [hw, -hl + rz], [hw, hl - fz],
  ];
  const edges: Edge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    // Outward normal of a counter-clockwise (seen from +y with x left) edge.
    let nx = bz - az, nz = -(bx - ax);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    // Make sure it points away from the middle.
    if (nx * (ax + bx) + nz * (az + bz) < 0) { nx = -nx; nz = -nz; }
    edges.push({ nx, nz, d: nx * ax + nz * az });
  }
  return { pts, edges, halfW: hw, halfL: hl, front, rear };
}

/** How far (x, z) is outside the outline (negative inside): the worst edge. Exact inside, a slight under-estimate outside past a corner. */
export function outside(o: Outline, x: number, z: number) {
  let m = -Infinity;
  for (const e of o.edges) m = Math.max(m, e.nx * x + e.nz * z - e.d);
  return m;
}

/** Half the outline's width at z (0 past the ends). */
export function halfWidthAt(o: Outline, z: number) {
  const { halfW: hw, halfL: hl, front: [fx, fz], rear: [rx, rz] } = o;
  if (z > hl || z < -hl) return 0;
  if (z > hl - fz) return hw - fx * ((z - (hl - fz)) / fz);
  if (z < -hl + rz) return hw - rx * ((-hl + rz - z) / rz);
  return hw;
}

/** The straight stretch of the sides (z from, to), clear of the corner cuts. */
export function sideSpan(o: Outline): [number, number] { return [-o.halfL + o.rear[1], o.halfL - o.front[1]]; }

/** A long side edge (straight along z, the outward normal across)? */
export const isSide = (e: Edge) => Math.abs(e.nz) < 1e-6;

/** A circle of radius r at (x, z) kept inside the outline: returns the clamped spot. `open` sides aren't kept to. */
export function keepInside(o: Outline, x: number, z: number, r: number, open = false) {
  for (let it = 0; it < 4; it++) {
    let worst: Edge | null = null, wd = 0;
    for (const e of o.edges) { if (open && isSide(e)) continue; const d = e.nx * x + e.nz * z - (e.d - r); if (d > wd) { wd = d; worst = e; } }
    if (!worst) break;
    x -= worst.nx * wd; z -= worst.nz * wd;
  }
  return { x, z };
}

/** A circle of radius r at (x, z) pushed out of the outline through its nearest edge, or null when already clear. */
export function pushOutOf(o: Outline, x: number, z: number, r: number) {
  let best: Edge | null = null, bd = -Infinity;
  for (const e of o.edges) {
    const d = e.nx * x + e.nz * z - (e.d + r);
    if (d >= 0) return null;
    if (d > bd) { bd = d; best = e; }
  }
  if (!best) return null;
  return { x: x - best.nx * bd, z: z - best.nz * bd };
}
