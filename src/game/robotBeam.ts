// An excavator's beam resolved on the battlefield (Keith 2026-10-31; the sim's event in src/combat/robots.ts). Host:
// the damage. It burns everything of another team along the line's low part, as a sheet with a penetration budget no
// body uses up (src/game/sheetFire.ts): the mech, the pilot, bandits and their vehicles in a robots-on-bandits fight
// (other robots are its own team). Cosmetic: a scorched furrow along the sand, dust and a crack.
import * as THREE from "three/webgpu";
import type { Battlefield } from "./battlefield";
import type { RobotBeamEvent } from "../combat/robots";

const ROBOTS = 3;
const from = new THREE.Vector3(), dir = new THREE.Vector3();

/** Resolve a beam: damage along the line (returns the bodies burnt), scorch the sand, kick up dust, sound it. */
export function fireRobotBeam(bf: Battlefield, e: RobotBeamEvent, reach: number): number {
  const s = e.start, t = e.end;
  from.set(s.x, s.y, s.z);
  dir.set(t.x - s.x, t.y - s.y, t.z - s.z);
  const flat = Math.hypot(dir.x, dir.z);
  if (flat < 0.5) return 0;
  dir.normalize();
  const f = { half: e.width / 2, height: reach, pen: 1e4, flat: true, aim: { x: t.x, y: t.y, z: t.z }, pierce: e.pierce };
  const sheet = bf.makeSheet(from, dir, flat, f);
  const shot = bf.resolveSheet(ROBOTS, sheet, e.damage, f, dir);
  // A furrow burnt along the sand in pieces, dust thrown up along it, and a crack at the emitter and where it strikes.
  const n = Math.max(1, Math.ceil(flat / 8));
  for (let k = 0; k < n; k++) {
    const a = k / n, b = (k + 1) / n;
    const x0 = s.x + (t.x - s.x) * a, z0 = s.z + (t.z - s.z) * a, x1 = s.x + (t.x - s.x) * b, z1 = s.z + (t.z - s.z) * b;
    bf.marks.furrow(x0, z0, x1, z1, e.width * 0.8, 0);
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    bf.dust.stomp(xm, bf.field.height(xm, zm), zm, 0.7);
  }
  bf.dust.stomp(t.x, t.y, t.z, 1.4);
  bf.sfx.play("brap", from.set(e.from.x, e.from.y, e.from.z), 1.6, 0.28, false);
  bf.sfx.play("brap", from.set(t.x, t.y, t.z), 1.4, 0.5, false);
  return shot.result.steps.length;
}
