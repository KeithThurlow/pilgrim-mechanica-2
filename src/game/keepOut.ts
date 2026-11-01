// A place enemies keep out of (Keith 2026-11-01: they should "semi-avoid" the convoy). Pure. The sims (robots,
// bandits, war band vehicles and mechs) take an optional KeepOut and bend their wanted velocity with steerOut; what
// the place is (the convoy's safe zone, src/convoy/safeZone.ts) lives with its owner.

export interface KeepOut {
  /** How hard to keep out at (x, z): 0 outside, up to 1 deep in (avoid strength already in it); out = outward unit. */
  weight(x: number, z: number, out: { x: number; z: number }): number;
  /** Speed (m/s) a fully weighted thing is pushed outward on top of losing its inward motion. */
  readonly push: number;
}

/**
 * Bend a wanted velocity (wx, wz) by a keep-out weight w and outward unit (ox, oz): w of its inward part is taken off,
 * and w × push is added outward. Writes the result into `res`.
 */
export function steerOut(w: number, ox: number, oz: number, push: number, wx: number, wz: number, res: { x: number; z: number }) {
  const into = wx * ox + wz * oz;
  if (into < 0) { wx -= ox * into * w; wz -= oz * into * w; }
  res.x = wx + ox * push * w;
  res.z = wz + oz * push * w;
  return res;
}
