// Headless robot danger check (Keith 2026-10-29: "robots don't feel dangerous"; the excavators should be a must-answer
// threat, the cutters should take a real bite). Measures what each robot kind deals to a standing player mech in
// reach (damage per second, one robot at a time), and how long a pack of 30 takes to destroy a standing mech (the
// mech's hull, MECH_DEFAULTS.hull), then holds the numbers to targets. Standing still is the worst case: every tell is
// readable and dodgeable (robots-check covers the dodges). Run: npm test (or npx tsx tools/robot-danger-check.ts).
import { RobotSwarm, ROBOT_DEFAULTS, BIG, MID, SMALL, DEAD } from "../src/combat/robots";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { MECH_DEFAULTS } from "../src/game/mechUnit";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const dt = 1 / 120;
const HULL = MECH_DEFAULTS.hull, HIT_R = MECH_DEFAULTS.hitRadius;
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
type V = typeof ROBOT_DEFAULTS;

/** Runs a swarm at a standing mech; returns damage taken per second over time (rounds that pass within the mech's
 *  radius hit; charges land after their flight and hurt with the battlefield's falloff; bites and saw strikes hit). */
function run(v: V, spawn: (sw: RobotSwarm, t: { x: number; z: number }) => void, seconds: number, seed: number, until = Infinity) {
  const sw = new RobotSwarm(v, field, seed);
  const t = { x: 300 + seed * 37, y: 0, z: -200, radius: 2 };
  t.y = field.height(t.x, t.z) + 3;
  spawn(sw, t);
  let dmg = 0, first = -1, time = 0, dead = -1;
  const by = { bite: 0, shot: 0, slug: 0, cut: 0, lob: 0, beam: 0 };
  const pending: { at: number; x: number; z: number }[] = [];
  sw.onLob = (_i, _fx, _fy, _fz, x, z, flight) => { pending.push({ at: time + flight, x, z }); };
  const hit = (d: number, k: keyof typeof by) => { dmg += d; by[k] += d; if (first < 0) first = time; };
  // The excavator's beam: the sim's own rule (within half its width plus the mech's radius of the line's low part).
  sw.onBeam = (e) => {
    const b = { ex: e.from.x, ey: e.from.y, ez: e.from.z, sx: e.start.x, sy: e.start.y, sz: e.start.z, x1: e.end.x, y1: e.end.y, z1: e.end.z };
    if (RobotSwarm.beamReaches(b, e.width, t.x, t.z, t.radius)) hit(e.damage, "beam");
  };
  for (let s = 0; s < seconds * 120; s++) {
    time = s * dt;
    sw.update(dt, t, (fx, fy, fz, tx, ty, tz, kind) => {
      const dx = tx - fx, dy = ty - fy, dz = tz - fz, L2 = dx * dx + dy * dy + dz * dz;
      const wx = t.x - fx, wy = t.y - fy, wz = t.z - fz, k = (wx * dx + wy * dy + wz * dz) / L2;
      if (Math.hypot(wx - dx * k, wy - dy * k, wz - dz * k) < t.radius) {
        hit(kind === MID ? v.robotMidShotDamage : kind === BIG ? v.robotBigShotDamage : v.robotShotDamage, kind === MID ? "slug" : "shot");
      }
    }, (_i, d) => hit(d, "bite"), (_i, d) => hit(d, "cut"));
    for (let j = pending.length - 1; j >= 0; j--) {
      const p = pending[j];
      if (p.at > time) continue;
      pending.splice(j, 1);
      const d = Math.max(0, Math.hypot(p.x - t.x, p.z - t.z) - HIT_R);
      if (d <= v.robotBigLobRadius) hit(v.robotBigShotDamage * (1 - 0.5 * d / v.robotBigLobRadius), "lob");
    }
    if (dead < 0 && dmg >= HULL) { dead = time; if (until < Infinity) break; }
    if (time > until) break;
  }
  const span = first < 0 ? 1 : time - first;
  return { dps: dmg / Math.max(1e-3, span), dmg, first, dead, by, sw };
}

/** One robot of a kind (and role) put in reach, measured over 40 s from its first hit, averaged over seeds. */
function solo(v0: V, kind: number, shooter: boolean) {
  const v = {
    ...v0,
    robotBigShare: kind === BIG ? 1 : 0, robotMidShare: kind === MID ? 1 : 0,
    robotShooterShare: shooter ? 1 : 0, robotMidCutterShare: shooter ? 0 : 1,
  };
  // Start where it would fight from: excavators and holders at their range, the rest a few metres out.
  const from = kind === BIG ? (v.robotBigNear + v.robotBigFar) / 2 : kind === MID ? (shooter ? (v.robotMidNear + v.robotMidFar) / 2 : 7) : shooter ? 16 : 6;
  let sum = 0, n = 0;
  for (const seed of [3, 5, 9, 14]) {
    const r = run(v, (sw, t) => sw.spawn(1, t.x + from, t.z, 0), 45, seed);
    if (r.first >= 0) { sum += r.dps; n++; }
  }
  return n ? sum / n : 0;
}

/** A pack of 30 at the default mix from 45 m: seconds until it has done a standing mech's hull in. */
function pack(v: V) {
  const times: number[] = [];
  const share = { bite: 0, shot: 0, slug: 0, cut: 0, lob: 0, beam: 0 };
  for (const seed of [2, 4, 6, 8, 10, 12]) {
    const r = run(v, (sw, t) => sw.spawn(30, t.x + 45, t.z, 6), 120, seed, 120);
    times.push(r.dead < 0 ? 120 : r.dead);
    for (const k in share) share[k as keyof typeof share] += r.by[k as keyof typeof share];
  }
  times.sort((a, b) => a - b);
  const tot = Object.values(share).reduce((a, b) => a + b, 0) || 1;
  const mix = Object.entries(share).map(([k, d]) => `${k} ${Math.round((d / tot) * 100)}%`).join(", ");
  return { median: times[times.length >> 1], min: times[0], max: times[times.length - 1], mix };
}

const V0 = { ...ROBOT_DEFAULTS };
const dps = {
  biter: solo(V0, SMALL, false), smallShooter: solo(V0, SMALL, true),
  cutter: solo(V0, MID, false), midShooter: solo(V0, MID, true), excavator: solo(V0, BIG, true),
};
const p = pack(V0);
const f = (x: number) => x.toFixed(1);
console.log(`in reach, damage per second to a standing mech (hull ${HULL}): scrapper biter ${f(dps.biter)}, scrapper shooter ${f(dps.smallShooter)}, cutter (saw) ${f(dps.cutter)}, cutter (slugs) ${f(dps.midShooter)}, excavator ${f(dps.excavator)}`);
console.log(`excavator: a volley of ${V0.robotBigBurst} × ${V0.robotBigShotDamage} every ${f(V0.robotBigPause + V0.robotBigRoundInterval * (V0.robotBigBurst - 1))} s on average, ${V0.robotBigWindup} s tell, ${V0.robotBigLobRadius} m ring`);
console.log(`pack of 30 vs a standing mech: destroyed in ${f(p.median)} s (median; ${f(p.min)}-${f(p.max)}), damage from ${p.mix}`);

// Targets (2026-10-29): the excavator a must-answer threat (a volley every couple of seconds, a third or more of the
// biters' pace each), the cutter's saw 2-3x what it was (2 dps), its slugs well up from 1.25; scrappers stay as they
// were (they are already the scary ones); the tells stay readable.
const BIG_PERIOD = V0.robotBigPause + V0.robotBigRoundInterval * (V0.robotBigBurst - 1);
if (dps.excavator < 12) fail(`an excavator in reach deals ${f(dps.excavator)} dps (< 12): not a threat`);
if (dps.excavator > 40) fail(`an excavator in reach deals ${f(dps.excavator)} dps (> 40): unfair`);
if (BIG_PERIOD > 3.5) fail(`excavator volleys every ${f(BIG_PERIOD)} s (> 3.5)`);
if (V0.robotBigWindup < 0.6) fail(`excavator tell ${V0.robotBigWindup} s (< 0.6): not readable`);
if (V0.robotBigShotDamage < 25) fail(`excavator charge ${V0.robotBigShotDamage} (< 25): not chunky`);
if (dps.cutter < 4 || dps.cutter > 9) fail(`a cutter's saw deals ${f(dps.cutter)} dps (want 4-9: 2-3x the old 2)`);
if (dps.midShooter < 2.5) fail(`a cutter's slugs deal ${f(dps.midShooter)} dps (< 2.5)`);
if (V0.robotMidCutWindup < 0.5 || V0.robotMidShotWindup < 0.5) fail("a cutter's tells under 0.5 s: not readable");
// Balance pass (2026-10-31): hulls doubled (3000), robot damage ×1.5-1.75; the biter holds its share of the hull.
const HK = HULL / 1500;
if (dps.biter < 1.5 * HK || dps.biter > 3 * HK) fail(`a scrapper biter deals ${f(dps.biter)} dps (want about 2 per 1500 hull: ${f(2 * HK)})`);
if (p.median < 10) fail(`a pack of 30 destroys a standing mech in ${f(p.median)} s (< 10): too quick to react`);
if (p.median > 30) fail(`a pack of 30 takes ${f(p.median)} s to destroy a standing mech (> 30): not dangerous`);

// The excavator's beam (Keith 2026-10-31): dodgeable. One excavator at range, volleys off, the beam alone. A mech that
// side-steps at walking pace once the aim locks is never burnt; one that stands still is burnt by every beam.
function beamDuel(dodge: boolean, seed: number) {
  const v = { ...V0, robotBigShare: 1, robotMidShare: 0, robotBigBurst: 1, robotBigShotDamage: 0, robotBeamFirst: 1, robotBeamCooldown: 5 };
  const sw = new RobotSwarm(v, field, seed);
  const t = { x: 300 + seed * 37, y: 0, z: -200, radius: HIT_R };
  t.y = field.height(t.x, t.z) + 3;
  sw.spawn(1, t.x + 26, t.z + 6, 0);
  let hits = 0, fired = 0, side = 0;
  sw.onBeam = (e) => {
    fired++;
    const b = { ex: e.from.x, ey: e.from.y, ez: e.from.z, sx: e.start.x, sy: e.start.y, sz: e.start.z, x1: e.end.x, y1: e.end.y, z1: e.end.z };
    if (RobotSwarm.beamReaches(b, e.width, t.x, t.z, t.radius)) hits++;
  };
  const lockAt = v.robotBeamCharge * v.robotBeamLock, WALK = 6;
  for (let s = 0; s < 40 * 120; s++) {
    sw.update(dt, t, () => {});
    // Once locked, step sideways (across the line from the robot) until the burn is over.
    const bt = sw.beamT[0];
    if (dodge && bt >= lockAt) {
      if (side === 0) side = (s & 1) ? 1 : -1;
      const ax = t.x - sw.px[0], az = t.z - sw.pz[0], L = Math.hypot(ax, az) || 1;
      t.x += (-az / L) * side * WALK * dt; t.z += (ax / L) * side * WALK * dt;
      t.y = field.height(t.x, t.z) + 3;
    } else side = 0;
  }
  return { hits, fired };
}
let dodged = 0, stood = 0, firedD = 0, firedS = 0;
for (const seed of [1, 7, 11]) {
  const a = beamDuel(true, seed), b = beamDuel(false, seed);
  dodged += a.hits; firedD += a.fired; stood += b.hits; firedS += b.fired;
}
console.log(`beam: ${V0.robotBeamDamage} damage, ${V0.robotBeamCharge} s charge (aim locks at ${f(V0.robotBeamCharge * V0.robotBeamLock)} s), ${V0.robotBeamWidth} m wide, every ${V0.robotBeamCooldown} s; side-stepping after the lock: burnt by ${dodged} of ${firedD}; standing: ${stood} of ${firedS}`);
if (firedD < 6 || firedS < 6) fail(`too few beams fired in the duel (${firedD}, ${firedS})`);
if (dodged > 0) fail(`a mech side-stepping after the lock was still burnt ${dodged} times: not dodgeable`);
if (stood < firedS) fail(`a standing mech was missed by ${firedS - stood} of ${firedS} beams`);
const sideStep = (V0.robotBeamCharge * (1 - V0.robotBeamLock)) * 6;
if (sideStep < V0.robotBeamWidth / 2 + HIT_R + 1) fail(`after the lock a walking mech covers only ${f(sideStep)} m: too little to clear the beam`);
void DEAD;
if (failed) throw new Error("robot danger check failed");
console.log("robot danger check passed");
