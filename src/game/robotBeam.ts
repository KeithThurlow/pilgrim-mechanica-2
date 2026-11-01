// An excavator's beam resolved on the battlefield (Keith 2026-10-31; the sim's event in src/combat/robots.ts). Host:
// the damage. It burns everything of another team along the line's low part, as a sheet with a penetration budget no
// body uses up (src/game/sheetFire.ts): the mech, the pilot, bandits and their vehicles in a robots-on-bandits fight
// (other robots are its own team). Cosmetic: a scorched furrow along the sand, dust and a crack. Terraforming (Keith
// 2026-11-01): the beam digs a trench of craters down its line (robotBeamDig), and the big walkers' pulse
// (fireRobotPulse) blasts a crater under them and shoves the mech away. A big walker's beam sweeps (Keith 2026-11-01): the
// release (tick 0) burns, scorches and digs the whole line with the crack and sound; each later tick burns the line for
// its share and scorches, digs and dusts only where it strikes, so the sweep leaves a trench along its path.
import * as THREE from "three/webgpu";
import type { Battlefield } from "./battlefield";
import type { RobotBeamEvent, RobotPulseEvent } from "../combat/robots";

const ROBOTS = 3;
const from = new THREE.Vector3(), dir = new THREE.Vector3();

/** Resolve a beam: damage along the line (returns the bodies burnt), scorch the sand, kick up dust, sound it. */
export function fireRobotBeam(bf: Battlefield, e: RobotBeamEvent, reach: number, dig = (bf.v as { robotBeamDig?: number }).robotBeamDig ?? 0,
  heat = (bf.v as { heatBeam?: number }).heatBeam ?? 0): number {
  const s = e.start, t = e.end;
  from.set(s.x, s.y, s.z);
  dir.set(t.x - s.x, t.y - s.y, t.z - s.z);
  const flat = Math.hypot(dir.x, dir.z);
  if (flat < 0.5) return 0;
  dir.normalize();
  const f = { half: e.width / 2, height: reach, pen: 1e4, flat: true, aim: { x: t.x, y: t.y, z: t.z }, pierce: e.pierce };
  const sheet = bf.makeSheet(from, dir, flat, f);
  const shot = bf.resolveSheet(ROBOTS, sheet, e.damage, f, dir);
  if (e.tick > 0) {
    // A sweep tick: a short scorch and a dent where it strikes, a puff of dust.
    const k = Math.max(0, 1 - Math.min(flat, 3) / flat);
    bf.marks.furrow(s.x + (t.x - s.x) * k, s.z + (t.z - s.z) * k, t.x, t.z, e.width * 0.8, 0);
    bf.dust.stomp(t.x, t.y, t.z, 0.6);
    if (dig > 0 && (e.tick & 1) === 0) bf.queueDent(t.x, t.z, (e.width * dig) / Math.max(0.05, (bf.v as { craterRadiusShare?: number }).craterRadiusShare ?? 0.7));
    return shot.result.steps.length;
  }
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
  // Red-hot sand down the line, hottest where it strikes (src/fx/groundHeat.ts; a sweeping beam would paint each tick
  // with dt so the sand heats as the beam dwells).
  burnBeam(bf, s.x, s.z, t.x, t.z, e.width, heat);
  // The trench: craters down the low part of the line, one per width or so (queued, so a long line doesn't stall).
  if (dig > 0) {
    const r = e.width * dig, step = Math.max(1, r * 1.2), m = Math.min(60, Math.floor(flat / step));
    for (let k = 0; k <= m; k++) { const a = m ? k / m : 1; bf.queueDent(s.x + (t.x - s.x) * a, s.z + (t.z - s.z) * a, r / Math.max(0.05, (bf.v as { craterRadiusShare?: number }).craterRadiusShare ?? 0.7)); }
  }
  // The release: a blast wave off the emitter and where it strikes (src/fx/blastWaves.ts, the beam kind).
  bf.waves?.post("beam", e.from.x, e.from.y, e.from.z, 2.5, { ground: false, fam: 2 });
  bf.waves?.post("beam", t.x, t.y, t.z, 3, { fam: 2 });
  bf.sfx.play("brap", from.set(e.from.x, e.from.y, e.from.z), 1.6, 0.28, false);
  bf.sfx.play("brap", from.set(t.x, t.y, t.z), 1.4, 0.5, false);
  return shot.result.steps.length;
}

/**
 * Red-hot sand along a beam's line on the ground, `heat` degrees (the hotter the weapon, the longer it glows), a hotter
 * spot where it strikes. dt > 0: the beam held there for dt (a beam that sweeps calls this every tick).
 */
export function burnBeam(bf: Battlefield, x0: number, z0: number, x1: number, z1: number, width: number, heat: number, dt = 0) {
  const h = bf.heat;
  if (!h || heat <= 0) return;
  h.line(x0, z0, x1, z1, width * 0.45, heat, dt);
  h.spot(x1, z1, width * 0.8, heat * 1.1, dt);
}

/**
 * Resolve a big walker's terraform pulse: a blast on the ground under it (damage to everything of another team, a
 * crater, dust, the blast wave in the beam's kind) and a shove outward through shove(x, z, radius, speed) for whoever
 * can be pushed (the player's mech).
 */
export function fireRobotPulse(bf: Battlefield, e: RobotPulseEvent, shove?: (x: number, z: number, radius: number, speed: number) => void) {
  from.set(e.at.x, e.at.y, e.at.z);
  bf.blast(ROBOTS, from, e.radius, e.damage, e.pierce, "beam");
  // A second, wider ring of dust thrown outward.
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, r = e.radius * 0.6;
    const x = e.at.x + Math.sin(a) * r, z = e.at.z + Math.cos(a) * r;
    bf.dust.emit(1, x, bf.field.height(x, z) + 0.3, z, Math.sin(a) * 9, 3 + Math.random() * 3, Math.cos(a) * 9, 1.2, 2.5 + Math.random() * 2, 0.9);
  }
  bf.waves?.post("beam", e.from.x, e.from.y, e.from.z, 3, { ground: false, fam: 2 });
  shove?.(e.at.x, e.at.z, e.radius, e.shove);
}
