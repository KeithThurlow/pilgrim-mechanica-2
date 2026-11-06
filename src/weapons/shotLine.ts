// Where a shot leaves from and which way it flies (Keith 2026-11-06: "the handheld minigun has negative knockback").
// A gun fires from its muzzle straight at the aim point. A held gun's muzzle sits 3-4 m out in front of the hull, so an
// enemy closer than that (a robot at the mech's feet, a bandit in its face) is *behind* the muzzle along the barrel:
// aimed from the muzzle, the round flew back toward the mech and threw what it killed at you. Here a point-blank aim
// moves the round's start back along the barrel (up to pullBack m) until the aim is in front of it, so the round
// always flies outward; past that (a body pressed against the hull) it flies along the barrel. Pure: no state.
import * as THREE from "three/webgpu";

type V3 = { x: number; y: number; z: number };

/** How far ahead of the round's start (in plan, along the barrel) the aim must be, metres. */
const AHEAD = 1;
/** A direction within this many metres of the aim in plan is too short to trust: along the barrel (the default). */
const MIN_FLAT = 1;

/**
 * The round's start (from) and direction (dir, unit) for a gun at `muzzle` pointing along `barrel` at `at` (null: no
 * aim). `flat` lays the direction level (rails and beams aim in plan). Never returns a direction pointing back against
 * the barrel in plan. `from` may be the muzzle vector itself (it is read before it moves). Returns how far the start was moved back (0 for any shot that isn't point blank).
 */
export function shotLine(muzzle: V3, barrel: V3, at: V3 | null, pullBack: number, from: THREE.Vector3, dir: THREE.Vector3, flat = false, minFlat = MIN_FLAT): number {
  from.set(muzzle.x, muzzle.y, muzzle.z);
  const bl = Math.hypot(barrel.x, barrel.z);
  const alongBarrel = () => { dir.set(barrel.x, flat ? 0 : barrel.y, barrel.z); if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1); dir.normalize(); };
  if (!at) { alongBarrel(); return 0; }
  // The barrel in plan (straight up or down: no "behind", aim from the muzzle).
  const bx = bl > 1e-6 ? barrel.x / bl : 0, bz = bl > 1e-6 ? barrel.z / bl : 0;
  const along = (at.x - muzzle.x) * bx + (at.z - muzzle.z) * bz;
  const back = bl > 1e-6 ? Math.min(Math.max(0, pullBack), Math.max(0, AHEAD - along)) : 0;
  from.x -= bx * back; from.z -= bz * back;
  const dx = at.x - from.x, dy = at.y - from.y, dz = at.z - from.z, fl = Math.hypot(dx, dz);
  // Too close to trust, or still behind the start (pressed against the hull): along the barrel.
  if (fl <= minFlat || (bl > 1e-6 && dx * bx + dz * bz < 0.25 * fl)) { alongBarrel(); return back; }
  dir.set(dx, flat ? 0 : dy, dz).normalize();
  return back;
}
