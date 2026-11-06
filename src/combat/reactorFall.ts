// A dying machine's reactor (Keith 2026-11-06: "the explosion actually originated from the hull as if it had a reactor
// in it, and so when they die, they tip over and that explodes"): the big walkers, the weapon quads and the striders.
// The wreck tips over and the reactor in its hull goes up as it falls: when the hull has come down to `share` of its
// standing height, or at the latest after `delay` seconds, but never before `min` (the warning).
//
// Where the hull is: from the death physics' wreck when the host tracks one (track), else this file's own fall, a
// stiff body toppling about its feet (an inverted pendulum: θ'' = g/h · sin θ, from a push of `spin` rad/s), so the
// headless checks and labs without physics see the same timing. Pure; host state (the blast is the host's).

/** A reactor counting down. CoreView (src/fx/coreWarnDraw.ts) reads id, x, y, z, hy, t, delay, radius. */
export interface Reactor {
  id: number;
  /** Where the hull is now (x, z), the ground under it (y) and the hull's height (hy). */
  x: number; z: number; y: number; hy: number;
  /** Where it stood (the pivot) and the way it falls (unit, flat). */
  bx: number; bz: number; fx: number; fz: number;
  /** Its standing hull height above the ground, the fall angle (rad from upright) and its rate. */
  h0: number; ang: number; angV: number;
  /** Seconds since it died; seconds left of the latest delay; the latest delay; the earliest; the height share. */
  age: number; t: number; delay: number; min: number; share: number;
  radius: number;
}

export interface ReactorSpec { delay: number; min: number; share: number; spin: number; radius: number }

interface Ground { height(x: number, z: number): number }

/** A reactor for a machine that just died at (x, z) with its hull at hy, falling along heading `fall` (radians). */
export function makeReactor(id: number, x: number, z: number, hy: number, fall: number, ground: Ground, s: ReactorSpec): Reactor {
  const y = ground.height(x, z);
  const delay = Math.max(0, s.delay);
  return {
    id, x, z, y, hy, bx: x, bz: z, fx: Math.sin(fall), fz: Math.cos(fall),
    h0: Math.max(0.5, hy - y), ang: 0.04, angV: Math.max(0, s.spin),
    age: 0, t: delay, delay, min: Math.min(delay, Math.max(0, s.min)), share: s.share, radius: s.radius,
  };
}

/** The hull's height above the ground under it, as a share of its standing height. */
export const reactorDrop = (r: Reactor) => (r.hy - r.y) / r.h0;

/**
 * Step a reactor dt seconds; true when it goes up now. track(out) gives the wreck's hull position when the host has
 * one (false: this file's own fall).
 */
export function stepReactor(r: Reactor, dt: number, ground: Ground, track?: ((out: { x: number; y: number; z: number }) => boolean) | null): boolean {
  r.age += dt; r.t -= dt;
  if (track && track(AT)) {
    r.x = AT.x; r.z = AT.z; r.hy = AT.y; r.y = ground.height(r.x, r.z);
  } else {
    // Topple about the feet: stiff, so the hull swings down on a circle; it comes to rest lying on the sand.
    if (r.ang < Math.PI / 2) {
      r.angV += (9.81 / r.h0) * Math.sin(r.ang) * dt;
      r.ang = Math.min(Math.PI / 2, r.ang + r.angV * dt);
    }
    const out = Math.sin(r.ang) * r.h0;
    r.x = r.bx + r.fx * out; r.z = r.bz + r.fz * out;
    const by = ground.height(r.bx, r.bz);
    r.y = ground.height(r.x, r.z);
    r.hy = Math.max(r.y + 0.3, by + Math.cos(r.ang) * r.h0);
  }
  if (r.t <= 0) return true;
  return r.age >= r.min && reactorDrop(r) <= r.share;
}

const AT = { x: 0, y: 0, z: 0 };
