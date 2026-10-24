// Headless robot swarm check: 300 robots (small scrappers, medium cutters, a few big excavators) rush a stationary
// mech over the tall dunes. Fails on NaN, robots off the ground (other than leaping, latched or flung), small ones
// piled on each other, nobody latching or firing, no saw strikes, a slow update, small ones' legs out of reach,
// walkers' planted feet off the sand or legs out of reach, walkers that never step or sag; then rays kill a small, a
// medium and a big one (bigger ones taking far more, the big one's arm legs hittable), and a stomp knocks latched
// ones off. Run: npm test (or npx tsx tools/robots-check.ts).
import { RobotSwarm, ROBOT_DEFAULTS, RUN, LEAP, LATCHED, FIRE, FLUNG, CUT, DOWN, DEAD, BIG, MID, SMALL, isAirborne, robotCentre } from "../src/combat/robots";
import { S_THIGH, S_SHIN, WALK_LEGS, type V3 } from "../src/combat/robotLegs";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const swarm = new RobotSwarm({ ...ROBOT_DEFAULTS }, field, 7);
const target = { x: 0, y: field.height(0, 0) + 3, z: 0, radius: 2 };
const dt = 1 / 120;
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const v3 = (): V3 => ({ x: 0, y: 0, z: 0 });

// Two packs so medium cutters reach the mech while others still walk in.
swarm.spawn(150, 70, 0, 14);
swarm.spawn(150, -40, 60, 14);
const kinds = [0, 0, 0];
for (let i = 0; i < swarm.hi; i++) kinds[swarm.kind[i]]++;
let shots = [0, 0, 0], bites = 0, biteDmg = 0, cuts = 0, cutDmg = 0, nan = 0, offGround = 0, maxOff = 0, crowdedWorst = 0, ms = 0, maxLatched = 0, sawCut = 0;
let legSamples = 0, legMiss = 0, legWorst = 0;
const walk = { samples: [0, 0, 0], miss: [0, 0, 0], worst: [0, 0, 0], footOff: [0, 0, 0], footOffMax: [0, 0, 0], low: [0, 0, 0], falls: [0, 0, 0] };
swarm.onFootfall = (i) => { walk.falls[swarm.kind[i]]++; };
// Big ones lob charges: each lands near the (still) mech after a flight that grows with distance.
let lobs = 0, lobMiss = 0, lobFlightMin = Infinity, lobFlightMax = 0;
swarm.onLob = (_i, fx, _fy, fz, x, z, flight) => {
  lobs++;
  lobFlightMin = Math.min(lobFlightMin, flight); lobFlightMax = Math.max(lobFlightMax, flight);
  if (Math.hypot(x - target.x, z - target.z) > ROBOT_DEFAULTS.robotBigLobScatter + 0.5) lobMiss++;
  if (Math.abs(flight - Math.max(0.6, Math.hypot(target.x - fx, target.z - fz) / ROBOT_DEFAULTS.robotBigLobSpeed)) > 0.01) lobMiss++;
};
const hips = new Float32Array(12), feet = new Float32Array(12);
const hip = v3(), knee = v3(), tip = v3(), foot = v3();
const steps = 40 * 120;

function crowded(): number {
  // Share of grounded live small ones overlapping another's hard body by more than a third (walkers shove them, so
  // only small-on-small counts).
  let n = 0, liveN = 0;
  for (let i = 0; i < swarm.hi; i++) {
    const s = swarm.state[i];
    if (s >= DEAD || isAirborne(s) || swarm.kind[i] !== SMALL) continue;
    liveN++;
    let close = false;
    const ri = swarm.size[i] * ROBOT_DEFAULTS.robotGap;
    swarm.near(swarm.px[i], swarm.pz[i], ri + 2.5, (j) => {
      if (j === i || swarm.kind[j] !== SMALL) return;
      const rj = swarm.size[j] * ROBOT_DEFAULTS.robotGap;
      if (Math.hypot(swarm.px[i] - swarm.px[j], swarm.pz[i] - swarm.pz[j]) < (ri + rj) * 0.66) close = true;
    });
    if (close) n++;
  }
  return liveN ? n / liveN : 0;
}

for (let s = 0; s < steps; s++) {
  const t0 = performance.now();
  swarm.update(dt, target, (_a, _b, _c, _d, _e, _f, kind) => { shots[kind]++; }, (_i, d) => { bites++; biteDmg += d; }, (_i, d) => { cuts++; cutDmg += d; });
  ms += performance.now() - t0;
  maxLatched = Math.max(maxLatched, swarm.latchedCount);
  for (let i = 0; i < swarm.hi; i++) {
    const st = swarm.state[i];
    if (st >= DEAD) continue;
    const x = swarm.px[i], y = swarm.py[i], z = swarm.pz[i];
    if (!Number.isFinite(x + y + z + swarm.vx[i] + swarm.vz[i] + swarm.heading[i] + swarm.gait[i] + swarm.hubY[i])) { nan++; continue; }
    if (st === CUT) sawCut++;
    if (isAirborne(st)) continue;
    const off = Math.abs(y - field.height(x, z));
    maxOff = Math.max(maxOff, off);
    if (off > 0.15) offGround++;
    if (s % 10 !== 0) continue;
    const kind = swarm.kind[i], S = swarm.size[i];
    if (kind !== SMALL) {
      // Walkers: planted feet on the sand, every leg within reach of its hip, the body well up.
      const H = swarm.hubY[i] - y;
      if (H < swarm.heightOf(i) * 0.7) walk.low[kind]++;
      for (let k = 0; k < WALK_LEGS; k++) {
        const f = i * WALK_LEGS + k;
        if (!Number.isFinite(swarm.footX[f] + swarm.footY[f] + swarm.footZ[f])) nan++;
        if (swarm.stepT[f] < 0) {
          const fo = Math.abs(swarm.footY[f] - field.height(swarm.footX[f], swarm.footZ[f]));
          walk.footOffMax[kind] = Math.max(walk.footOffMax[kind], fo);
          if (fo > 0.05) walk.footOff[kind]++;
        }
        const d = swarm.legPose(i, k, hip, knee, tip, foot);
        walk.samples[kind]++; walk.worst[kind] = Math.max(walk.worst[kind], d);
        if (d > 1) walk.miss[kind]++;
        if (!Number.isFinite(knee.x + knee.y + knee.z)) nan++;
      }
    } else if (st === RUN || st === FIRE) {
      // Small ones: every foot within reach of its hip.
      swarm.smallLegPose(i, hips, feet);
      const reach = (S_THIGH + S_SHIN) * S;
      for (let k = 0; k < 4; k++) {
        const d = Math.hypot(feet[k * 3] - hips[k * 3], feet[k * 3 + 1] - hips[k * 3 + 1], feet[k * 3 + 2] - hips[k * 3 + 2]) / reach;
        legSamples++; legWorst = Math.max(legWorst, d);
        if (d > 1) legMiss++;
      }
    }
  }
  if (s % 60 === 59) crowdedWorst = Math.max(crowdedWorst, crowded());
}
const per = ms / steps;
const states = new Array(DEAD + 1).fill(0);
for (let i = 0; i < swarm.hi; i++) if (swarm.state[i] <= DEAD) states[swarm.state[i]]++;
const fireDist = (kind: number) => {
  let lo = Infinity, hi = 0;
  for (let i = 0; i < swarm.hi; i++) if (swarm.kind[i] === kind && swarm.state[i] === FIRE) {
    const d = Math.hypot(swarm.px[i] - target.x, swarm.pz[i] - target.z); lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return `${lo.toFixed(1)}-${hi.toFixed(1)} m`;
};
const pct = (a: number, b: number) => ((a / Math.max(1, b)) * 100).toFixed(2) + "%";
console.log(`rush: 300 robots (${kinds[SMALL]} small, ${kinds[MID]} medium, ${kinds[BIG]} big), 40 s: ${per.toFixed(3)} ms/step`);
console.log(`      states run ${states[RUN]} leap ${states[LEAP]} latched ${states[LATCHED]} (max ${maxLatched}) fire ${states[FIRE]} cut ${states[CUT]} flung ${states[FLUNG]} down ${states[DOWN]}`);
console.log(`      firing: medium at ${fireDist(MID)}, big at ${fireDist(BIG)}; rounds small ${shots[SMALL]} medium ${shots[MID]}; ${lobs} charges lobbed (flights ${lobFlightMin.toFixed(1)}-${lobFlightMax.toFixed(1)} s); ${bites} bites (${biteDmg.toFixed(0)} damage); ${cuts} saw strikes (${cutDmg.toFixed(0)} damage)`);
console.log(`      max off ground ${maxOff.toFixed(4)} m, worst crowding ${(crowdedWorst * 100).toFixed(2)}%`);
console.log(`      small legs: ${pct(legMiss, legSamples)} out of reach (worst ${(legWorst * 100).toFixed(0)}% of reach)`);
for (const [kind, name] of [[MID, "medium"], [BIG, "big"]] as const) {
  console.log(`      ${name}: ${walk.falls[kind]} footfalls, planted feet off the sand ${walk.footOff[kind]} (max ${walk.footOffMax[kind].toFixed(3)} m), legs out of reach ${pct(walk.miss[kind], walk.samples[kind])} (worst ${(walk.worst[kind] * 100).toFixed(0)}%), body low ${walk.low[kind]}`);
  if (walk.footOff[kind]) fail(`${walk.footOff[kind]} planted ${name} feet off the sand (max ${walk.footOffMax[kind].toFixed(3)} m)`);
  if (walk.miss[kind] / Math.max(1, walk.samples[kind]) > 0.01) fail(`${name} feet out of reach more than 1% of the time`);
  if (walk.falls[kind] < kinds[kind] * WALK_LEGS) fail(`${name} ones hardly stepped (${walk.falls[kind]} footfalls)`);
  if (walk.low[kind]) fail(`${walk.low[kind]} samples of a ${name} one's body sagging below 70% of its height`);
}
if (legMiss / Math.max(1, legSamples) > 0.02) fail("small ones' feet out of reach more than 2% of the time");
if (nan) fail(`${nan} NaN samples`);
if (offGround) fail(`${offGround} samples more than 0.15 m off the ground (max ${maxOff.toFixed(3)})`);
if (crowdedWorst > 0.05) fail(`crowding ${(crowdedWorst * 100).toFixed(1)}% > 5%`);
if (maxLatched === 0 || bites === 0) fail("nobody latched on and bit");
if (lobs === 0) fail("no big one lobbed a charge");
if (shots[BIG] > 0) fail(`big ones fired ${shots[BIG]} hitscan rounds (they should only lob)`);
if (lobMiss) fail(`${lobMiss} charges aimed off the mech or with the wrong flight time`);
if (lobFlightMin < 1) fail(`a charge flew only ${lobFlightMin.toFixed(2)} s: too quick to dodge`);
if (shots[MID] === 0) fail("no medium one fired");
if (shots[SMALL] === 0) fail("no small shooter fired");
if (cuts === 0) fail(`no medium one landed a saw strike (${sawCut} samples winding up or lunging)`);
if (kinds[BIG] < 6 || kinds[BIG] > 16) fail(`${kinds[BIG]} big ones of 300: want a few`);
if (per > 2) fail(`update too slow: ${per.toFixed(3)} ms per step > 2`);

// Kills: rounds of 9 at a standing small, medium and big one, from 12 m off, aimed at the body centre.
function roundsToKill(kind: number): number {
  const sw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotBigShare: kind === BIG ? 1 : 0, robotMidShare: kind === MID ? 1 : 0 }, field, 5);
  sw.spawn(1, 30, 30, 0);
  if (sw.kind[0] !== kind) { fail(`spawned a ${sw.kind[0]} asking for a ${kind}`); return -1; }
  const far = { x: 400, y: 0, z: 400, radius: 2 };
  sw.update(dt, far, () => {});
  const i = 0;
  let rounds = 0;
  const c = { x: 0, y: 0, z: 0 };
  while (sw.state[i] < DEAD && rounds < 1000) {
    robotCentre(sw, i, c);
    const ox = c.x + 12, oy = c.y + 2, oz = c.z + 1;
    const h = sw.hitRay(ox, oy, oz, c.x - ox, c.y - oy, c.z - oz, 100);
    if (!h || h.index !== i || h.leg) return -1;
    sw.damage(i, 9, -1, 0);
    rounds++;
  }
  // The wreck settles on the ground.
  for (let s = 0; s < 3 * 120; s++) sw.update(dt, far, () => {});
  const off = Math.abs(sw.py[i] - field.height(sw.px[i], sw.pz[i]));
  if (off > 0.05) fail(`a kind ${kind} wreck stayed ${off.toFixed(2)} m off the ground`);
  return rounds;
}
// A big one's arm leg: a ray across the stick low down, and one through the bucket, hit it as a leg.
{
  const sw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotBigShare: 1 }, field, 5);
  sw.spawn(1, 30, 30, 0);
  sw.update(dt, { x: 400, y: 0, z: 400, radius: 2 }, () => {});
  sw.legPose(0, 0, hip, knee, tip, foot);
  const mx = tip.x + (knee.x - tip.x) * 0.2, my = tip.y + (knee.y - tip.y) * 0.2, mz = tip.z + (knee.z - tip.z) * 0.2;
  const h = sw.hitRay(mx + 20, my, mz + 3, -20, 0, -3, 100);
  const by = (tip.y + foot.y) / 2;
  const hb = sw.hitRay(foot.x + 20, by, foot.z + 3, -20, 0, -3, 100);
  console.log(`legs: a ray at arm 0's stick ${h ? (h.leg ? "hits the leg" : "hits the body") : "misses"}, at its bucket ${hb ? (hb.leg ? "hits the leg" : "hits the body") : "misses"}`);
  if (!h || !h.leg) fail("a ray across a big one's stick didn't hit it");
  if (!hb || !hb.leg) fail("a ray through a big one's bucket didn't hit it");
  // The elbow stands above the chassis: the arms read as excavator booms.
  console.log(`      arm 0: hip ${(hip.y - sw.py[0]).toFixed(1)} m, elbow ${(knee.y - sw.py[0]).toFixed(1)} m, stick end ${(tip.y - foot.y).toFixed(1)} m over the bucket's foot`);
  if (knee.y < sw.hubY[0]) fail("a big one's elbow sits below its chassis");
}
const smallR = roundsToKill(SMALL), midR = roundsToKill(MID), bigR = roundsToKill(BIG);
console.log(`kills: small one ${smallR} rounds, medium one ${midR}, big one ${bigR} (9 damage each)`);
if (smallR < 0 || midR < 0 || bigR < 0) fail("aimed rays missed");
else {
  if (midR < smallR * 3) fail("medium one not much tougher than a small one");
  if (bigR < midR * 3) fail("big one not much tougher than a medium one");
}

// Dodging the tells: a medium one's slug goes where the mech was when the tell began, and its saw lunge goes where
// the mech was when the wind-up ended, so a dash (a jump of 9 m here) during either takes the mech clear.
{
  const tellMid = (cutter: boolean) => {
    const sw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotBigShare: 0, robotMidShare: 1, robotMidCutterShare: cutter ? 1 : 0 }, field, 21);
    const t = { x: 200, y: field.height(200, 200) + 3, z: 200, radius: 2 };
    sw.spawn(1, cutter ? 207 : 212, 200, 0);
    let tellSeen = 0, dashed = false, hitNear = 0, hitFar = 0, struck = 0;
    for (let s = 0; s < 12 * 120; s++) {
      sw.update(dt, t, (fx, fy, fz, tx, ty, tz) => {
        // Closest approach of the slug's line to the mech now.
        const dx = tx - fx, dy = ty - fy, dz = tz - fz, L = Math.hypot(dx, dy, dz);
        const wx = t.x - fx, wy = t.y - fy, wz = t.z - fz, k = (wx * dx + wy * dy + wz * dz) / (L * L);
        const miss = Math.hypot(wx - dx * k, wy - dy * k, wz - dz * k);
        if (miss < t.radius) hitNear++; else hitFar++;
      }, undefined, () => { struck++; });
      if (sw.tell[0]) tellSeen++;
      // Dash 9 m sideways a third of a second into the first tell.
      if (!dashed && tellSeen * dt >= 0.3) { t.z += 9; t.y = field.height(t.x, t.z) + 3; dashed = true; }
      // Done once the attack has gone off (the slug fired, or the saw attack over).
      if (dashed && (cutter ? sw.state[0] !== CUT : hitNear + hitFar > 0)) break;
    }
    return { tellSeen: tellSeen * dt, dashed, hitNear, hitFar, struck };
  };
  const shot = tellMid(false), saw = tellMid(true);
  console.log(`tells: medium shot tell ${shot.tellSeen.toFixed(2)} s, after a dash its slug ${shot.hitFar ? "misses" : "still hits"}; saw wind-up ${saw.tellSeen.toFixed(2)} s, after a dash the saw ${saw.struck ? "still strikes" : "misses"}`);
  if (shot.tellSeen < 0.5) fail(`a medium one's shot tell lasted ${shot.tellSeen.toFixed(2)} s (< 0.5)`);
  if (!shot.dashed || shot.hitNear || !shot.hitFar) fail("a dash during a medium one's shot tell didn't dodge the slug");
  if (saw.tellSeen < 0.5) fail(`a medium one's saw wind-up lasted ${saw.tellSeen.toFixed(2)} s (< 0.5)`);
  if (!saw.dashed || saw.struck) fail("a dash during a medium one's saw wind-up didn't dodge the saw");
}

// Stomp: let a pack latch on, then stomp right by the mech.
const lsw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotBigShare: 0, robotMidShare: 0, robotShooterShare: 0 }, field, 11);
const lt = { x: 100, y: field.height(100, 100) + 3, z: 100, radius: 2 };
lsw.spawn(40, 115, 100, 4);
for (let s = 0; s < 8 * 120 && lsw.latchedCount < 12; s++) lsw.update(dt, lt, () => {});
const before = lsw.latchedCount;
let low = 0;
for (let i = 0; i < lsw.hi; i++) if (lsw.state[i] === LATCHED && lsw.py[i] - lsw.baseY < ROBOT_DEFAULTS.robotStompReach) low++;
lsw.stomp(lt.x + 1, lt.z, 2.5);
const after = lsw.latchedCount;
let flung = 0;
for (let i = 0; i < lsw.hi; i++) if (lsw.state[i] === FLUNG) flung++;
for (let s = 0; s < 3 * 120; s++) lsw.update(dt, { ...lt, x: lt.x + 0.0001 }, () => {});
let stuck = 0;
for (let i = 0; i < lsw.hi; i++) if (lsw.state[i] === FLUNG) stuck++;
if (stuck) fail(`${stuck} knocked-off robots still in the air after 3 s`);
console.log(`stomp: ${before} latched (${low} low), ${before - after} knocked off, ${flung} in the air`);
if (before === 0) fail("nobody latched for the stomp test");
else if (before - after === 0) fail("stomp knocked nobody off");

// Shake: latched ones come off a mech running fast.
const ssw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotBigShare: 0, robotMidShare: 0, robotShooterShare: 0 }, field, 13);
const st = { x: -100, y: field.height(-100, -100) + 3, z: -100, radius: 2 };
ssw.spawn(30, -112, -100, 3);
for (let s = 0; s < 8 * 120 && ssw.latchedCount < 8; s++) ssw.update(dt, st, () => {});
const held = ssw.latchedCount;
const heldIdx: number[] = [];
for (let i = 0; i < ssw.hi; i++) if (ssw.state[i] === LATCHED) heldIdx.push(i);
for (let s = 0; s < 6 * 120; s++) {
  st.x += 6.5 * dt; st.y = field.height(st.x, st.z) + 3;
  ssw.update(dt, st, () => {});
}
const shaken = heldIdx.filter((i) => ssw.state[i] !== LATCHED).length;
console.log(`shake: ${held} latched, ${shaken} shaken off after 6 s at 6.5 m/s (${ssw.latchedCount} on now, counting new ones)`);
if (held === 0) fail("nobody latched for the shake test");
else if (shaken < held / 2) fail("a fast mech shook fewer than half off");

if (failed) throw new Error("robots check failed");
console.log("robots check passed");
