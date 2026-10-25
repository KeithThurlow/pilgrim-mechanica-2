// The painter (docs/proposal-weapons.md): what a held heavy weapon shows before it fires, like a military targeting
// laser. A beam from the launcher or muzzle to the aim, plus a mark on the sand: a strip (the line rocket salvo), a
// ring (the mortar) or nothing but the beam (the rail cannon's charge, which thickens). Pure: the weapons fill one of
// these every frame, src/weapons/painterDraw.ts draws it.

export interface Vec3 { x: number; y: number; z: number }

/** A strip on the sand: from its near end a to its far end b (ground x, z), this wide. */
export interface Strip { ax: number; az: number; bx: number; bz: number; width: number }

export interface Paint {
  /** Show anything at all. */
  on: boolean;
  /** The laser: from, to (world). Hidden when width is 0. */
  beamFrom: Vec3;
  beamTo: Vec3;
  /** Beam width as a share of the laser-width slider (the rail cannon thickens as it charges). */
  beamScale: number;
  /** "ready" paints red-orange; "cooling" paints dim grey (released now it wouldn't fire). */
  ready: boolean;
  strip: Strip | null;
  ring: { x: number; z: number; r: number } | null;
  /** A dotted arc (the mortar's lob), world points. */
  arc: Vec3[];
  /** Seconds this paint has been held (drives the pulse and the chevrons). */
  held: number;
  /** 0..1 how full the charge is (rail) or 1. */
  charge: number;
  /** A colour of its own (the rail's charge glows cyan), else red-orange when ready. */
  tint: number | null;
}

export const newPaint = (): Paint => ({
  on: false, beamFrom: { x: 0, y: 0, z: 0 }, beamTo: { x: 0, y: 0, z: 0 }, beamScale: 1, ready: true, strip: null, ring: null, arc: [], held: 0, charge: 1, tint: null,
});

export function clearPaint(p: Paint) { p.on = false; p.strip = null; p.ring = null; p.arc.length = 0; p.held = 0; p.charge = 1; p.beamScale = 1; }

/** Length of a strip (m). */
export const stripLength = (s: Strip) => Math.hypot(s.bx - s.ax, s.bz - s.az);

/**
 * Where a point sits on a strip: u from 0 (near end) to 1 (far end), and its signed distance off the centre line
 * (m, + to the left looking from a to b).
 */
export function onStrip(s: Strip, x: number, z: number): { u: number; off: number } {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L;
  const px = x - s.ax, pz = z - s.az;
  return { u: (px * ux + pz * uz) / L, off: px * uz - pz * ux };
}

/** Is (x, z) inside the strip (with an optional margin, m)? */
export function inStrip(s: Strip, x: number, z: number, margin = 0): boolean {
  const L = stripLength(s), q = onStrip(s, x, z);
  return q.u * L >= -margin && q.u * L <= L + margin && Math.abs(q.off) <= s.width / 2 + margin;
}
