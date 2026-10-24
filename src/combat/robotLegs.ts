// Robot shapes and leg maths, pure numbers (no drawing): the sim, the drawer, the hit test, the ragdolls and the
// checks all build from these, so what you see is what gets hit and what falls over.
// Keith 2026-10-24: the robots are autonomous terraforming machines in three sizes.
// Small scrappers: a low hub with four legs splayed out on the diagonals like a starfish, scuttling in any direction
// without turning. Medium cutters: a crab-like chassis on four legs, knees up over the body, a circular saw at the
// front and a scrap bin on its back. Big excavators: a small chassis high up on four very long legs that are
// excavator arms (boom, stick and bucket; the bucket is the foot), stepping one at a time.

/** Small hub (× size): radius, thickness, centre height when standing; hips on the rim, feet out at FOOT_R. */
export const HUB_R = 0.24, HUB_H = 0.15, HUB_Y = 0.3;
export const HIP_R = 0.2, FOOT_R = 0.62, S_THIGH = 0.3, S_SHIN = 0.42;
/** Small legs sit on the diagonals: leg k at heading + 45° + k·90°. Opposite legs (0+2, 1+3) step together. */
export const SMALL_LEGS = 4;
export const SMALL_PHASE = [0, Math.PI, 0, Math.PI];

/** Legs per walker (medium and big): planted feet that step (the sim keeps them). */
export const WALK_LEGS = 4;

/**
 * A walker's legs. Hips sit on the chassis at `angles` from the heading, `hipR` × size out and `hipDrop` × size below
 * the body centre; feet want to be `footR` × height out on the same spoke. The leg is two bones (`L1`, `L2` × height:
 * thigh and shin, or boom and stick) with the knee pushed out along the spoke and up by `bendUp`; the second bone ends
 * `toe` × height above the foot (an excavator's bucket hangs below it; 0 is a pointed foot). Lengths are measured
 * from the body's height above the ground, so a taller one has longer legs.
 */
export interface WalkSpec { angles: number[]; hipR: number; hipDrop: number; footR: number; L1: number; L2: number; toe: number; bendUp: number }

const DEG = Math.PI / 180;
/** Medium cutters: legs out to the sides like a crab (front and rear pairs), the front left clear for the saw. */
export const MID_SPEC: WalkSpec = { angles: [55, 125, 235, 305].map((d) => d * DEG), hipR: 0.34, hipDrop: 0.06, footR: 1.25, L1: 0.8, L2: 1.15, toe: 0, bendUp: 0.9 };
/** Big excavators: an X of four booms off the chassis corners, sticks dropping steeply to buckets planted on the sand. */
export const BIG_SPEC: WalkSpec = { angles: [45, 135, 225, 315].map((d) => d * DEG), hipR: 0.4, hipDrop: 0.1, footR: 0.82, L1: 0.78, L2: 0.95, toe: 0.13, bendUp: 0.45 };

/** Small body (centre to a cutting disc's edge, × size): for the drawer and sparks. */
export const SMALL_DISC = 0.33;
/** Medium body dims (× size): saw centre ahead of and beside the body centre, saw radius; big gun muzzle ahead. */
export const MID_SAW_Z = 0.62, MID_SAW_X = -0.2, MID_SAW_Y = -0.02, MID_SAW_R = 0.27;
export const MID_BODY_H = 0.24, BIG_BODY_H = 0.3;

/** Angle of small leg k (radians, 0 = +Z) for a robot facing h. */
export const smallLegAngle = (h: number, k: number) => h + Math.PI / 4 + k * (Math.PI / 2);

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

/** Height of a walker's body centre above the ground for body size S (scaled from the height slider at the size slider). */
export const walkHeight = (S: number, heightAt: number, sizeAt: number) => heightAt * (S / Math.max(0.1, sizeAt));

/** A walker's hip k (world) for body centre (x, y, z), facing h, body size S. */
export function walkHip(spec: WalkSpec, x: number, y: number, z: number, S: number, h: number, k: number, out: V3): V3 {
  const a = h + spec.angles[k];
  out.x = x + Math.sin(a) * spec.hipR * S; out.y = y - spec.hipDrop * S; out.z = z + Math.cos(a) * spec.hipR * S;
  return out;
}

/** Where foot k wants to stand (x, z) for a walker at (x, z) of height H facing h. */
export function walkHome(spec: WalkSpec, x: number, z: number, H: number, h: number, k: number, out: V3): V3 {
  const a = h + spec.angles[k];
  out.x = x + Math.sin(a) * spec.footR * H; out.z = z + Math.cos(a) * spec.footR * H;
  return out;
}

/**
 * Leg k's knee (or elbow) and the end of its second bone (`tip`: the stick's end above the bucket, or the foot itself)
 * for a hip and a foot on the sand. The knee goes out along the hip's spoke and up. Returns the hip-tip distance over
 * the reach (above 1: the foot is out of reach and the tip was pulled in).
 */
export function walkLeg(spec: WalkSpec, hip: V3, foot: V3, H: number, h: number, k: number, knee: V3, tip: V3): number {
  const a = h + spec.angles[k];
  tip.x = foot.x; tip.y = foot.y + spec.toe * H; tip.z = foot.z;
  const L1 = spec.L1 * H, L2 = spec.L2 * H;
  const d = solveKnee(hip, tip, L1, L2, Math.sin(a), spec.bendUp, Math.cos(a), knee);
  return d / (L1 + L2);
}
