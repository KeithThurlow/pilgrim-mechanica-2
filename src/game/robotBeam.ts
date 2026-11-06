// An excavator's beam resolved on the battlefield (Keith 2026-10-31; the sim's event in src/combat/robots.ts). Host:
// the damage. It burns everything of another team along the line's low part, as a sheet with a penetration budget no
// body uses up (src/game/sheetFire.ts): the mech, the pilot, bandits and their vehicles in a robots-on-bandits fight
// (other robots are its own team). Cosmetic: a scorched furrow along the sand, dust and a crack. Terraforming (Keith
// 2026-11-01): the beam digs a trench of craters down its line (robotBeamDig), and the big walkers' pulse
// (fireRobotPulse) blasts a crater under them and shoves the mech away. A big walker's beam sweeps (Keith 2026-11-01): the
// release (tick 0) burns, scorches and digs the whole line with the crack and sound; each later tick burns the line for
// its share and scorches, digs and dusts only where it strikes, so the sweep leaves a trench along its path. Round 2
// (Keith 2026-11-01): big beams are live from the start of the charge (src/combat/beamCore.ts); the release is the tick
// flagged release, and every other tick blasts the sand by the beam's power, little while it charges, most once full.
import * as THREE from "three/webgpu";
import type { Battlefield } from "./battlefield";
import { SMALL, BIG, type RobotBeamEvent, type RobotDeathBlastEvent, type RobotPulseEvent, type RobotSwarm } from "../combat/robots";
import { sampleBankOf } from "../audio/sampleBank";
import { famOfTeam } from "../world/lamps";
import type { CoreWarnDraw } from "../fx/coreWarnDraw";

const ROBOTS = 3;
const from = new THREE.Vector3(), dir = new THREE.Vector3();
/** Where each beam (by robot id) struck on its last tick, so a sweep's red-hot trail joins up. Cosmetic. */
const lastStrike = new Map<number, { x: number; z: number }>();

/** Beams whose charge sound has played (by beam id), until they release. */
const charging = new Set<number>();
const live = (bf: Battlefield, sound: string) => sampleBankOf(bf.sfx)?.liveSound(sound) ?? false;

/**
 * A robot's death, heard (Keith 2026-11-02: the recorded robot death, remixed): a walker the full sound, a small one
 * higher, shorter and quieter (robotSmallDeath); a big one's sound is its core's death blast. Chained in front of
 * whatever the swarm does on a death. Cosmetic.
 */
export function robotDeathSound(bf: Battlefield, sw: RobotSwarm) {
  const prev = sw.onDeath, at = new THREE.Vector3();
  sw.onDeath = (i, nx, nz, speed) => {
    const small = sw.kind[i] === SMALL, share = (bf.v as { robotSmallDeath?: number }).robotSmallDeath ?? 0.3;
    if (sw.kind[i] !== BIG && live(bf, "robotDeath") && (!small || share > 0))
      bf.sfx.playSound("robotDeath", at.set(sw.px[i], sw.py[i], sw.pz[i]), small ? share : 1, small ? 1.6 + Math.random() * 0.3 : 0.9 + Math.random() * 0.2);
    prev?.(i, nx, nz, speed);
  };
}

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
  // The charge (the first tick of a big beam, from the start of its charge) and the release: the recorded robot sounds
  // when they're in (src/audio/samples.ts).
  if (!e.release && !charging.has(e.id)) { charging.add(e.id); if (live(bf, "robotCharge")) bf.sfx.playSound("robotCharge", from.set(e.from.x, e.from.y, e.from.z), 1); from.set(s.x, s.y, s.z); }
  if (e.release) charging.delete(e.id);
  if (!e.release) {
    // A charge or sweep tick: a short scorch and a dent where it strikes, a puff of dust, all by the beam's power.
    const k = Math.max(0, 1 - Math.min(flat, 3) / flat), p = e.power ?? 1;
    bf.marks.furrow(s.x + (t.x - s.x) * k, s.z + (t.z - s.z) * k, t.x, t.z, e.width * 0.8, 0);
    if (p > 0.08 || (e.tick & 3) === 0) bf.dust.stomp(t.x, t.y, t.z, 0.15 + 0.6 * p);
    // Smoke off the melt (Keith 2026-11-02: read as doing damage), more as the beam powers up.
    if (p > 0.3 && (e.tick & 1) === 0) bf.dust.emit(1, t.x, t.y + 0.3, t.z, (Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 1 + p, 2 + Math.random() * 2, 0.9);
    if (dig > 0 && p > 0.3 && (e.tick & 1) === 0) bf.queueDent(t.x, t.z, (e.width * dig) / Math.max(0.05, (bf.v as { craterRadiusShare?: number }).craterRadiusShare ?? 0.7));
    // Red-hot sand: the strike dragged from where the last tick struck to here, and the last few metres of the line.
    const hk = heat * (e.heat ?? 1), dtk = Math.max(0.02, (bf.v as { robotBeamTick?: number }).robotBeamTick ?? 0.1);
    const was = lastStrike.get(e.id);
    if (was) burnBeam(bf, was.x, was.z, t.x, t.z, e.width, hk, dtk);
    burnBeam(bf, s.x + (t.x - s.x) * k, s.z + (t.z - s.z) * k, t.x, t.z, e.width, hk, dtk);
    lastStrike.set(e.id, { x: t.x, z: t.z });
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
  // Red-hot sand down the line, hottest where it strikes (src/fx/groundHeat.ts); the sweep's ticks drag it on. Keith
  // 2026-11-02: cooler toward the start (robotBeamMeltRamp), so the start is already fading while the strike still burns.
  burnBeamRamp(bf, s.x, s.z, t.x, t.z, e.width, heat * (e.heat ?? 1), (bf.v as { robotBeamMeltRamp?: number }).robotBeamMeltRamp ?? 0.5);
  lastStrike.set(e.id, { x: t.x, z: t.z });
  // The trench: craters down the low part of the line, one per width or so (queued, so a long line doesn't stall).
  if (dig > 0) {
    const r = e.width * dig, step = Math.max(1, r * 1.2), m = Math.min(60, Math.floor(flat / step));
    for (let k = 0; k <= m; k++) { const a = m ? k / m : 1; bf.queueDent(s.x + (t.x - s.x) * a, s.z + (t.z - s.z) * a, r / Math.max(0.05, (bf.v as { craterRadiusShare?: number }).craterRadiusShare ?? 0.7)); }
  }
  // The release: a blast wave off the emitter and where it strikes (src/fx/blastWaves.ts, the beam kind).
  bf.waves?.post("beam", e.from.x, e.from.y, e.from.z, 2.5, { ground: false, fam: 2 });
  bf.waves?.post("beam", t.x, t.y, t.z, 3, { fam: 2 });
  if (live(bf, "robotBeam")) bf.sfx.playSound("robotBeam", from.set(e.from.x, e.from.y, e.from.z), 1);
  else bf.sfx.play("brap", from.set(e.from.x, e.from.y, e.from.z), 1.6, 0.28, false);
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
  scorchBeam(bf, x0, z0, x1, z1, width);
}

type HeatV = { heatScorchW?: number; heatScorch?: number; heatPulse?: number; heatDeath?: number; heatSlam?: number };

/** A dark burn either side of a beam's melt (Keith 2026-11-02: big beams leave scorch marks), lasting the fused sand's fade. */
export function scorchBeam(bf: Battlefield, x0: number, z0: number, x1: number, z1: number, width: number) {
  const h = bf.heat, v = bf.v as HeatV;
  if (!h) return;
  const w = (v.heatScorchW ?? 2.2) * width / 2, k = v.heatScorch ?? 0.85;
  h.scorch(x0, z0, x1, z1, w, k);
  h.scorchSpot(x1, z1, w * 1.3, k);
}

/**
 * A big robot blast cooks the sand under it (Keith 2026-11-02): a hot disc `heat` degrees at its middle over `share` of
 * the radius, and a scorch over most of it.
 */
export function cookGround(bf: Battlefield, x: number, z: number, radius: number, heat: number, share = 0.55) {
  const h = bf.heat;
  if (!h || heat <= 0 || radius <= 0) return;
  h.spot(x, z, radius * share, heat);
  h.spot(x, z, radius * share * 0.4, heat * 1.15);
  h.scorchSpot(x, z, radius * share * 1.3, (bf.v as HeatV).heatScorch ?? 0.85);
}

/** burnBeam in pieces, `start` × the heat at (x0, z0) rising to the full heat at the strike (a one-shot line). */
export function burnBeamRamp(bf: Battlefield, x0: number, z0: number, x1: number, z1: number, width: number, heat: number, start: number) {
  const h = bf.heat;
  if (!h || heat <= 0) return;
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.min(12, Math.ceil(L / 3)));
  for (let k = 0; k < n; k++) {
    const a = k / n, b = (k + 1) / n, f = start + (1 - start) * (b * b);
    h.line(x0 + (x1 - x0) * a, z0 + (z1 - z0) * a, x0 + (x1 - x0) * b, z0 + (z1 - z0) * b, width * 0.45, heat * f);
  }
  h.spot(x1, z1, width * 0.8, heat * 1.1);
  scorchBeam(bf, x0, z0, x1, z1, width);
}

/**
 * Resolve a big walker's terraform pulse: a blast on the ground under it (damage to everything of another team, a
 * crater, dust, the blast wave in the beam's kind) and a shove outward through shove(x, z, radius, speed) for whoever
 * can be pushed (the player's mech).
 */
export function fireRobotPulse(bf: Battlefield, e: RobotPulseEvent, shove?: (x: number, z: number, radius: number, speed: number) => void) {
  from.set(e.at.x, e.at.y, e.at.z);
  bf.blast(ROBOTS, from, e.radius, e.damage, e.pierce, "beam");
  cookGround(bf, e.at.x, e.at.z, e.radius, (bf.v as HeatV).heatPulse ?? 1300);
  // A second, wider ring of dust thrown outward.
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, r = e.radius * 0.6;
    const x = e.at.x + Math.sin(a) * r, z = e.at.z + Math.cos(a) * r;
    bf.dust.emit(1, x, bf.field.height(x, z) + 0.3, z, Math.sin(a) * 9, 3 + Math.random() * 3, Math.cos(a) * 9, 1.2, 2.5 + Math.random() * 2, 0.9);
  }
  bf.waves?.post("beam", e.from.x, e.from.y, e.from.z, 3, { ground: false, fam: 2 });
  shove?.(e.at.x, e.at.z, e.radius, e.shove);
}

/**
 * Resolve a reactor going up in a falling wreck (Keith 2026-11-02: "a really big, significant boom"; 2026-11-06: from
 * the hull as it tips over, the tall walkers' an airburst like a nova): a big blast on the ground under the hull
 * (everything of another team in reach; the swarm hurt its own robots already), its crater, the nova at the hull
 * (src/fx/nova.ts: flash, fireball shell, shockwave ring), a blast wave and a flash of light up there, a burst of debris
 * and smoke from the hull, a ring of dust along the ground, a deep extra layer of the explosion sound (boom) and the
 * shove outward.
 */
export function fireRobotDeathBlast(bf: Battlefield, e: RobotDeathBlastEvent, shove?: (x: number, z: number, radius: number, speed: number) => void) {
  from.set(e.at.x, e.at.y, e.at.z);
  bf.blast(ROBOTS, from, e.radius, e.damage, e.pierce, "death");
  // A huge crater on top of the blast's own dent (on dry ground; in water the blast splashes instead).
  if (e.craterR > 0.5 && e.craterDepth > 0 && !bf.inWater(e.at.x, e.at.z)) bf.crater(e.at.x, e.at.z, e.craterR, e.craterDepth);
  cookGround(bf, e.at.x, e.at.z, e.radius, (bf.v as HeatV).heatDeath ?? 1500, 0.45);
  const hy = Math.max(e.at.y + 1, e.hubY), air = hy - e.at.y, nova = e.nova ?? 0;
  bf.novas.post(e.at.x, hy, e.at.z, e.at.y, e.radius, nova);
  bf.waves?.post("death", e.at.x, hy, e.at.z, e.radius * (0.6 + 0.4 * Math.min(1, nova)), { ground: false, fam: 2 });
  bf.nightLights?.flash(e.at.x, hy, e.at.z, e.radius * (1.5 + ((bf.v as { novaLight?: number }).novaLight ?? 0) * Math.min(1.5, nova) * 0.5), famOfTeam(ROBOTS));
  // Debris and smoke thrown out every way from the hull (an airburst: some of it straight down onto the sand), and a
  // wide ring thrown out along the ground.
  const n = Math.round(30 + 30 * Math.min(1.5, nova));
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, up = Math.random() * 2 - 1, sp = 6 + Math.random() * 14, c = Math.sqrt(1 - up * up);
    bf.dust.emit(1, e.at.x, hy, e.at.z, Math.cos(a) * c * sp, up * sp + 3, Math.sin(a) * c * sp, 1.6, 2.5 + Math.random() * 3, 0.9);
  }
  if (air < 3) for (let k = 0; k < 24; k++) {
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
    bf.dust.emit(1, e.at.x, e.at.y + Math.random() * 2, e.at.z, Math.cos(a) * sp, 8 + Math.random() * 14, Math.sin(a) * sp, 1.6, 3 + Math.random() * 3, 0.9);
  }
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2, r = e.radius * 0.5;
    const x = e.at.x + Math.sin(a) * r, z = e.at.z + Math.cos(a) * r;
    bf.dust.emit(1, x, bf.field.height(x, z) + 0.3, z, Math.sin(a) * 14, 2 + Math.random() * 4, Math.cos(a) * 14, 1.4, 2.5 + Math.random() * 2.5, 0.9);
  }
  if (e.boom > 0) {
    from.set(e.at.x, hy, e.at.z);
    bf.sfx.playSound("blastBoom", from, e.boom, 0.7 + Math.random() * 0.1);
    if (live(bf, "robotBigDeath")) bf.sfx.playSound("robotBigDeath", from, Math.min(1.5, 0.6 + e.boom * 0.4), 0.95 + Math.random() * 0.1);
    else bf.sfx.playSound("blast", from, e.boom * 0.5, 0.55 + Math.random() * 0.1);
  }
  shove?.(e.at.x, e.at.z, e.radius, e.shove);
}

const SPARK_AT = new THREE.Vector3(), SPARK_UP = new THREE.Vector3(0, 1, 0);
/**
 * A dying walker's core going unstable (src/fx/coreWarnDraw.ts), heard and seen on the battlefield (cosmetic): a
 * rising whine stretched over the countdown when it starts, and on each blink a beep (higher toward the end), a spit
 * of sparks off the wreck, a puff of dust and a flicker of light.
 */
export function coreWarnFx(bf: Battlefield, warn: CoreWarnDraw) {
  warn.onStart = (x, y, z, delay) => { bf.sfx.playSound("coreWhine", SPARK_AT.set(x, y + 1.5, z), 1, Math.max(0.4, Math.min(2.5, 2.8 / Math.max(0.1, delay)))); };
  warn.onBeep = (x, y, z, k) => {
    SPARK_AT.set(x, y, z);
    bf.sfx.playSound("coreBeep", SPARK_AT, 0.6 + 0.6 * k, 1 + 0.6 * k);
    bf.gunFx.sparksAt(SPARK_AT, SPARK_UP, Math.round(6 + 18 * k), 5 + 6 * k);
    bf.dust.emit(1, x, y - 1, z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.8, 1 + Math.random(), 0.9);
    bf.nightLights?.flash(x, y, z, 3 + 5 * k, famOfTeam(ROBOTS));
  };
}

/**
 * Every big-walker attack and death of a robot swarm resolved on a battlefield, in one call for any lab that adds a
 * swarm (Keith 2026-11-02: in the summoner lab the death blasts never went off): beams, pulses, death blasts (with the
 * crater) and the unstable core's warning. shove pushes whoever can be pushed (the player's mech).
 */
export function wireRobotBlasts(bf: Battlefield, sw: RobotSwarm, warn: CoreWarnDraw, beamReach: number, shove?: (x: number, z: number, radius: number, speed: number) => void) {
  sw.onBeam = (e) => fireRobotBeam(bf, e, beamReach);
  sw.onPulse = (e) => fireRobotPulse(bf, e, shove);
  sw.onDeathBlast = (e) => fireRobotDeathBlast(bf, e, shove);
  coreWarnFx(bf, warn);
}
