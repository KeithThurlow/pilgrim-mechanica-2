// Robot shapes and leg maths, pure numbers (no drawing): the sim, the drawer, the hit test, the ragdolls and the
// checks all build from these, so what you see is what gets hit and what falls over.
// Small ones (Keith 2026-10-24): a low hub with four legs splayed out on the diagonals like a starfish, scuttling
// in any direction without turning. Big ones: War of the Worlds tripods, a small body high up on three very long
// thin legs that step one at a time.

/** Small hub (× size): radius, thickness, centre height when standing; hips on the rim, feet out at FOOT_R. */
export const HUB_R = 0.24, HUB_H = 0.15, HUB_Y = 0.3;
export const HIP_R = 0.2, FOOT_R = 0.62, S_THIGH = 0.3, S_SHIN = 0.42;
/** Small legs sit on the diagonals: leg k at heading + 45° + k·90°. Opposite legs (0+2, 1+3) step together. */
export const SMALL_LEGS = 4;
export const SMALL_PHASE = [0, Math.PI, 0, Math.PI];

/** Tripod (big): body radius and height × size; hips × size out from the centre; feet × height out; legs × height. */
export const BIG_LEGS = 3;
export const B_BODY_H = 0.5, B_HIP_R = 0.32, B_FOOT_R = 0.42, B_THIGH = 0.5, B_SHIN = 0.78;

/** Angle of small leg k (radians, 0 = +Z) for a robot facing h. */
export const smallLegAngle = (h: number, k: number) => h + Math.PI / 4 + k * (Math.PI / 2);
/** Angle of tripod leg k for a robot facing h (one leg straight back, two forward on the sides). */
export const bigLegAngle = (h: number, k: number) => h + Math.PI / 3 + k * ((Math.PI * 2) / 3);

export interface V3 { x: number; y: number; z: number }

/**
 * Two-bone knee: hip to foot with segments L1 and L2, the knee pushed along bend (any length). Writes the knee and
 * returns the hip-foot distance before clamping (callers compare it with L1 + L2 for reach). The foot is pulled in to
 * the reach if it's too far.
 */
export function solveKnee(hip: V3, foot: V3, L1: number, L2: number, bx: number, by: number, bz: number, knee: V3): number {
  let dx = foot.x - hip.x, dy = foot.y - hip.y, dz = foot.z - hip.z;
  const d0 = Math.hypot(dx, dy, dz);
  let d = d0;
  if (d < 1e-6) { dx = 0; dy = -1; dz = 0; d = 1e-6; } else { dx /= d; dy /= d; dz /= d; }
  const reach = (L1 + L2) * 0.999;
  if (d > reach) { d = reach; foot.x = hip.x + dx * d; foot.y = hip.y + dy * d; foot.z = hip.z + dz * d; }
  d = Math.max(d, Math.abs(L1 - L2) + 1e-4);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const kh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const along = bx * dx + by * dy + bz * dz;
  let px = bx - dx * along, py = by - dy * along, pz = bz - dz * along;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-8) { px = 0; py = 1; pz = 0; } else { px /= pl; py /= pl; pz /= pl; }
  knee.x = hip.x + dx * a + px * kh; knee.y = hip.y + dy * a + py * kh; knee.z = hip.z + dz * a + pz * kh;
  return d0;
}

/**
 * A standing small robot's legs on the ground (world space). Centre (x, y, z) is the point on the sand under the
 * hub; (gx, gz) the ground slope (rise per metre) the hub rides; gait the cycle; (mx, mz) the run direction times
 * how much it's moving (0..1); stride the ground covered per cycle (m); lift the foot lift (m); bob the hub's lift.
 * Hips and feet go into flat arrays of 3 × SMALL_LEGS.
 */
export function smallLegs(x: number, y: number, z: number, S: number, h: number, gx: number, gz: number, gait: number,
  mx: number, mz: number, stride: number, lift: number, bob: number, hips: Float32Array | number[], feet: Float32Array | number[]) {
  const hy = HUB_Y * S - HUB_H * 0.25 * S + bob;
  // Each foot sweeps back and forth along the run (a quarter of a stride each way), lifted on the way forward.
  const amp = stride * 0.25;
  for (let k = 0; k < SMALL_LEGS; k++) {
    const a = smallLegAngle(h, k), sa = Math.sin(a), ca = Math.cos(a);
    const hx = sa * HIP_R * S, hz = ca * HIP_R * S;
    hips[k * 3] = x + hx; hips[k * 3 + 1] = y + hy + hx * gx + hz * gz; hips[k * 3 + 2] = z + hz;
    const ph = gait + SMALL_PHASE[k];
    const sw = Math.sin(ph) * amp, up = Math.max(0, Math.cos(ph)) * lift;
    const fx = sa * FOOT_R * S + mx * sw, fz = ca * FOOT_R * S + mz * sw;
    feet[k * 3] = x + fx; feet[k * 3 + 1] = y + fx * gx + fz * gz + up; feet[k * 3 + 2] = z + fz;
  }
}

/** Height of a tripod's body centre above the ground for body size S (scaled from the height slider at the size slider). */
export const bigHeight = (S: number, heightAt: number, sizeAt: number) => heightAt * (S / Math.max(0.1, sizeAt));

/** A tripod's hip k (world) for body centre (x, y, z), facing h, body size S. */
export function bigHip(x: number, y: number, z: number, S: number, h: number, k: number, out: V3): V3 {
  const a = bigLegAngle(h, k);
  out.x = x + Math.sin(a) * B_HIP_R * S; out.y = y - B_BODY_H * S * 0.35; out.z = z + Math.cos(a) * B_HIP_R * S;
  return out;
}

/** A tripod's knee bends out from the body and up: the stilt's high joint. */
export function bigBend(h: number, k: number, out: V3): V3 {
  const a = bigLegAngle(h, k);
  out.x = Math.sin(a); out.y = 0.6; out.z = Math.cos(a);
  return out;
}
