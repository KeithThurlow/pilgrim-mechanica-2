// The shared shape of a big terraforming beam (Keith 2026-11-01: "less telegraphing on the ground and just more like
// charging up a small version of the beam ... it just gets bigger and bigger"). Pure maths, used by the big walkers
// (robots.ts) and the striders (strider.ts) so every big beam behaves the same; each keeps its own sliders.
// From the first moment of the charge the beam is live: thin and weak, its strike dragging across the ground toward the
// prey; it grows in width, damage and blast as the charge fills, releases at full power (the crack), then keeps firing
// for the sweep, still dragging, before it fades. Damage comes in ticks: each is the full-power rate (damage over the
// sweep) times the beam's power then, so the charge does little and the sweep does most.

/** A beam's shape, as numbers from a sim's sliders. */
export interface BeamShape {
  /** Charge time (s): from the first thin beam to the release. */
  charge: number;
  /** Sweep (s): how long it fires at full power after the release. */
  sweep: number;
  /** Drag (m/s): how fast the strike slides toward the prey over the ground once released, through the sweep. */
  drag: number;
  /** Drag while charging (m/s): slower, so a mech that moves off early clears the beam before it is at full power. */
  chargeDrag: number;
  /** Tick (s) between burns. */
  tick: number;
  /** Width share at the start of the charge (of the full width). */
  startWidth: number;
  /** Power share at the start of the charge (of full damage and blast). */
  startPower: number;
  /** Growth curve of the power and width over the charge (1 even; higher stays small and swells late). */
  growth: number;
}

/** The beam's power at time t into it (0..1): grows over the charge, full through the sweep. */
export function beamPower(t: number, s: BeamShape): number {
  if (t >= s.charge) return 1;
  const u = Math.max(0, t) / Math.max(0.01, s.charge);
  return s.startPower + (1 - s.startPower) * Math.pow(u, Math.max(0.1, s.growth));
}

/** The beam's width share at time t (0..1). */
export function beamWidthShare(t: number, s: BeamShape): number {
  if (t >= s.charge) return 1;
  const u = Math.max(0, t) / Math.max(0.01, s.charge);
  return s.startWidth + (1 - s.startWidth) * Math.pow(u, Math.max(0.1, s.growth));
}

/** Total time the beam is live (charge plus sweep). */
export const beamLive = (s: BeamShape) => s.charge + Math.max(0, s.sweep);

/** Damage of one tick at time t of a beam whose full-power damage over the sweep is `damage`. */
export function beamTickDamage(t: number, damage: number, s: BeamShape): number {
  const rate = damage / Math.max(s.tick, s.sweep);
  return rate * Math.max(0.02, s.tick) * beamPower(t, s);
}

/**
 * Ticks that fall in (was, now]: calls fn(k, tk) for each tick index k at time tk = k * tick, while tk < the live time.
 * The release (t = charge) gets a tick of its own, flagged.
 */
export function beamTicks(was: number, now: number, s: BeamShape, fn: (k: number, tk: number, release: boolean) => void) {
  const T = Math.max(0.02, s.tick), end = beamLive(s);
  const k0 = was <= 0 ? 0 : Math.floor(was / T) + 1;
  for (let k = k0; k * T <= now && k * T < end + 1e-6; k++) {
    const tk = k * T;
    // The release falls between ticks k-1 and k (or on k): give it to the first tick at or after it.
    const release = tk >= s.charge && (k === 0 || (k - 1) * T < s.charge);
    fn(k, tk, release);
  }
}

/** The drag speed at time t into the beam. */
export const beamDrag = (t: number, s: BeamShape) => (t < s.charge ? s.chargeDrag : s.drag);

/** Slide an aim point (x, z) toward a target over the ground at speed for dt; returns the new point in out. */
export function dragAim(ax: number, az: number, tx: number, tz: number, speed: number, dt: number, out: { x: number; z: number }) {
  const dx = tx - ax, dz = tz - az, L = Math.hypot(dx, dz), step = Math.min(L, Math.max(0, speed) * dt);
  out.x = L > 1e-6 ? ax + (dx / L) * step : ax; out.z = L > 1e-6 ? az + (dz / L) * step : az;
  return out;
}
