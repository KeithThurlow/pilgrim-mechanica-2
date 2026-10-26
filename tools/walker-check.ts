// Headless walker check: drive the walker over the dune field (walk, sprint, zigzag, stop) and fail on the things
// that break the illusion: legs that can't reach their feet, swing feet through the ground, both feet in the air,
// knees bending backwards, planted feet sliding. Run: npm test (or npx tsx tools/walker-check.ts).
import { Vector3 } from "three";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

interface Run { name: string; seconds: number; cmd: (t: number) => { x: number; z: number; sprint: boolean } }

const runs: Run[] = [
  { name: "walk straight", seconds: 40, cmd: () => ({ x: 0.3, z: 1, sprint: false }) },
  { name: "sprint straight", seconds: 40, cmd: () => ({ x: 1, z: 0.2, sprint: true }) },
  { name: "zigzag", seconds: 50, cmd: (t) => { const a = Math.floor(t / 2.2) * 2.4; return { x: Math.sin(a), z: Math.cos(a), sprint: Math.floor(t / 7) % 2 === 1 }; } },
  { name: "start and stop", seconds: 40, cmd: (t) => (t % 6 < 3.5 ? { x: -0.6, z: 0.8, sprint: false } : { x: 0, z: 0, sprint: false }) },
  { name: "flat ground", seconds: 20, cmd: () => ({ x: 0, z: 1, sprint: false }) },
];

const dt = 1 / 60;
let failed = false;
const builds = [
  { name: "stand-in", values: { ...WALKER_DEFAULTS, ...LEG_TYPES.standin.values } },
  { name: "rampart", values: { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values } },
];
for (const build of builds) {
console.log(`-- ${build.name} legs`);
for (const r of runs) {
  const terrain = { ...TERRAIN_DEFAULTS };
  if (r.name === "flat ground") { terrain.height = 0; terrain.swell = 0; terrain.bumps = 0; }
  const field = new DuneField(terrain);
  const sim = new WalkerSim({ ...build.values }, field);
  sim.reset(13, -40, 0.3);
  let underAir = 0, bothAir = 0, kneeBack = 0, slide = 0, maxSlide = 0, minClear = Infinity, maxHipToGround = 0, minHipToGround = Infinity;
  // Push-off shape (Keith 2026-10-24: the thigh swung too far back and the knee went straight): measured late in each stance.
  let thighBackMax = 0, kneeMax = 0;
  const lastPlant = sim.feet.map(() => new Vector3());
  const wasPlanted = sim.feet.map(() => false);
  const frames = Math.round(r.seconds / dt);
  for (let i = 0; i < frames; i++) {
    sim.update(dt, r.cmd(i * dt));
    if (sim.feet[0].swinging && sim.feet[1].swinging) bothAir++;
    for (const f of sim.feet) if (f.pos.y < field.height(f.pos.x, f.pos.z) - 0.05) underAir++;
    sim.feet.forEach((f, k) => {
      const P = f.pose;
      // Knee on the forward side of the hip-hock line (and the solve not degenerate).
      const line = new Vector3().subVectors(P.hock, P.hip).normalize();
      const off = new Vector3().subVectors(P.knee, P.hip);
      off.addScaledVector(line, -off.dot(line));
      if (!Number.isFinite(P.knee.x) || off.dot(P.legFwd) < -0.01) kneeBack++;
      if (!f.swinging && f.stanceT > 0.85) {
        const th = new Vector3().subVectors(P.knee, P.hip);
        const back = (Math.atan2(-th.dot(P.legFwd), -th.y) * 180) / Math.PI;
        thighBackMax = Math.max(thighBackMax, back);
        const a = new Vector3().subVectors(P.hip, P.knee).normalize(), b = new Vector3().subVectors(P.hock, P.knee).normalize();
        kneeMax = Math.max(kneeMax, (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI);
      }
      // In the air nothing is planted; after a landing the feet may skid on purpose (sim.skid), so only count the rest.
      if (sim.airborne) wasPlanted[k] = false;
      else if (!f.swinging) {
        if (wasPlanted[k] && sim.skid.lengthSq() < 1e-6) { const s = lastPlant[k].distanceTo(f.planted); maxSlide = Math.max(maxSlide, s); if (s > 0.001) slide++; }
        lastPlant[k].copy(f.planted);
        wasPlanted[k] = true;
      } else {
        wasPlanted[k] = false;
        minClear = Math.min(minClear, f.pos.y - field.height(f.pos.x, f.pos.z));
      }
    });
    const g = field.height(sim.pos.x, sim.pos.z);
    maxHipToGround = Math.max(maxHipToGround, sim.pelvis.y - g);
    minHipToGround = Math.min(minHipToGround, sim.pelvis.y - g);
  }
  const s = sim.stats;
  const over = s.overreach / (frames * 2);
  const problems: string[] = [];
  // Tall dunes (Keith 2026-10-24: height 14 m, spacing 44 m) put feet on slip faces the legs can't fully reach and
  // straighten the knee on steep push-offs, so dune runs get looser limits; flat ground keeps the strict ones.
  const dunes = r.name !== "flat ground";
  if (over > (dunes ? 0.15 : 0.01)) problems.push(`legs out of reach ${(over * 100).toFixed(1)}% of leg-frames`);
  if (s.scuffs > 0) problems.push(`${s.scuffs} swing-foot frames under the ground`);
  if (bothAir > 0) problems.push(`${bothAir} frames with both feet in the air`);
  if (underAir > 0) problems.push(`${underAir} foot-frames under the ground`);
  // Leaving the ground off a crest (Keith 2026-10-26): rare at a walk, small hops at a run. Since 18:28 a foot that
  // can't reach down a steep brink hangs and the mech drops the rest, so a walk over the dunes may drop a few times.
  if (r.name === "walk straight" && s.takeoffs > 3) problems.push(`left the ground ${s.takeoffs} times at a walk`);
  if (kneeBack > 0) problems.push(`${kneeBack} knee-backwards frames`);
  if (!dunes && kneeMax > 172) problems.push(`knee nearly straight at push-off (${kneeMax.toFixed(0)}°)`);
  if (slide > 0) problems.push(`planted feet slid ${slide} frames (max ${maxSlide.toFixed(3)} m)`);
  if (r.name !== "start and stop" && s.steps < r.seconds * 1.2) problems.push(`only ${s.steps} steps`);
  const line = `${r.name.padEnd(16)} steps ${String(s.steps).padStart(4)} · reach misses ${(over * 100).toFixed(2)}% · ` +
    `min swing clearance ${minClear === Infinity ? "-" : minClear.toFixed(2)} m · off the ground ${s.takeoffs}× (${(s.airFrames * dt).toFixed(1)} s) · hip above ground ${minHipToGround.toFixed(2)}..${maxHipToGround.toFixed(2)} m · push-off: thigh back ${thighBackMax.toFixed(0)}°, knee ${kneeMax.toFixed(0)}° · moved ${sim.pos.length().toFixed(0)} m`;
  console.log((problems.length ? "FAIL " : "ok   ") + line + (problems.length ? "\n       " + problems.join("; ") : ""));
  if (problems.length) failed = true;
}
}

// Drops (Keith 2026-10-26: every mech lands on its legs): from 1, 3 and 6 m, standing and moving. Feet never through
// the ground, nothing non-finite, the squat deeper the higher the drop, a stagger only from the hard one, and back to
// a normal stance within RECOVER seconds.
const RECOVER = 1.5;
for (const build of builds) {
  console.log(`-- ${build.name} drops`);
  const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
  const lows: number[] = [];
  for (const [h, fwd] of [[1, 0], [3, 0], [6, 0], [3, 5]]) {
    const sim = new WalkerSim({ ...build.values }, flat);
    sim.reset(0, 0, 0);
    for (let i = 0; i < 120; i++) sim.update(dt, { x: 0, z: 0, sprint: false });
    const stand = sim.pelvis.y;
    sim.pelvis.y += h; for (const f of sim.feet) f.pos.y += h;
    sim.launch(0, 0, fwd);
    let under = 0, nan = 0, low = Infinity, landedAt = -1, settledAt = -1, wasAir = true;
    const cmd = { x: 0, z: fwd / build.values.walkSpeed, sprint: false };
    for (let i = 0; i < 6 / dt; i++) {
      sim.update(dt, cmd);
      for (const f of sim.feet) if (f.pos.y < -0.02 || f.planted.y < -0.02) under++;
      if (!Number.isFinite(sim.pelvis.y + sim.feet[0].pose.knee.x + sim.feet[1].pose.knee.x + sim.feet[0].pose.hock.y)) nan++;
      if (wasAir && !sim.airborne) landedAt = i * dt;
      wasAir = sim.airborne;
      if (landedAt >= 0) {
        low = Math.min(low, sim.pelvis.y);
        // Settled: the squat is over and the hips are back within 0.15 m of standing.
        if (settledAt < 0 && !sim.landing && !sim.airborne && Math.abs(sim.pelvis.y - stand) < 0.15) settledAt = i * dt - landedAt;
      }
    }
    const l = sim.lastLanding;
    const problems: string[] = [];
    if (!l || landedAt < 0) problems.push("never landed");
    if (under) problems.push(`${under} foot-frames under the ground`);
    if (nan) problems.push(`${nan} non-finite frames`);
    if (settledAt < 0 || settledAt > RECOVER) problems.push(`not back to a normal stance within ${RECOVER} s (${settledAt.toFixed(2)})`);
    if (l && (l.stagger > 0) !== (h >= 6)) problems.push(`stagger ${l.stagger} s from a ${h} m drop`);
    if (fwd === 0) lows.push(stand - low);
    console.log(`${problems.length ? "FAIL " : "ok   "}${h} m drop${fwd ? ` moving ${fwd} m/s` : ""}: hit at ${l?.impact.toFixed(1)} m/s · squat ${(stand - low).toFixed(2)} m · stagger ${l?.stagger ?? 0} s · damage ${l?.damage.toFixed(0)} · settled in ${settledAt.toFixed(2)} s` + (problems.length ? "\n       " + problems.join("; ") : ""));
    if (problems.length) failed = true;
  }
  if (!(lows[0] + 0.1 < lows[1] && lows[1] + 0.1 < lows[2])) { console.log(`FAIL squat doesn't deepen with the drop: ${lows.map((x) => x.toFixed(2)).join(", ")}`); failed = true; }
}
// Sprint (Keith 2026-10-26: hold Space and the mech runs on, faster and faster, jumping off dunes but not
// exaggeratedly; hard landings hurt). Rampart (14 m/s) and Stilt (18 m/s) legs.
const shaped = (h: (x: number, z: number) => number) => ({
  height: h,
  normal: (x: number, z: number, o: number[] = [0, 0, 0]) => {
    const e = 0.05, dx = (h(x + e, z) - h(x - e, z)) / (2 * e), dz = (h(x, z + e) - h(x, z - e)) / (2 * e), l = Math.hypot(dx, 1, dz);
    o[0] = -dx / l; o[1] = 1 / l; o[2] = -dz / l; return o;
  },
});
for (const leg of ["rampart", "rampart-stilt"] as const) {
  const values = { ...WALKER_DEFAULTS, ...LEG_TYPES[leg].values };
  const top = values.boundTop;
  console.log(`-- ${leg} sprint (top ${top} m/s)`);
  const problems: string[] = [];
  const sdt = 1 / 120;
  // A minute on the dunes, straight then weaving: no feet under the sand, nothing non-finite, legs in reach.
  {
    const field = new DuneField({ ...TERRAIN_DEFAULTS });
    const sim = new WalkerSim({ ...values }, field);
    sim.reset(13, -40, 0.3);
    let under = 0, nan = 0, air = 0, hurt = 0, worst = 0, flight = 0, longest = 0;
    sim.onLand = (l) => { worst = Math.max(worst, l.impact); hurt += l.damage; };
    for (let i = 0; i < 60 * 120; i++) {
      const t = i * sdt, a = 0.3 + (t > 30 ? 0.9 * Math.sin(t * 0.35) : 0);
      sim.bound = true;
      sim.update(sdt, { x: Math.sin(a), z: Math.cos(a), sprint: true });
      for (const f of sim.feet) if (f.pos.y < field.height(f.pos.x, f.pos.z) - 0.05) under++;
      if (!Number.isFinite(sim.pelvis.x + sim.pelvis.y + sim.feet[0].pose.knee.y + sim.feet[1].pose.hock.y + sim.feet[0].pos.y)) nan++;
      if (sim.airborne) { air++; flight += sdt; longest = Math.max(longest, flight); } else flight = 0;
    }
    const s = sim.stats, over = s.overreach / (s.frames * 2);
    if (under) problems.push(`${under} foot-frames under the sand sprinting`);
    if (nan) problems.push(`${nan} non-finite frames sprinting`);
    if (over > 0.03) problems.push(`legs out of reach ${(over * 100).toFixed(1)}% of leg-frames sprinting`);
    if (s.steps < 120) problems.push(`only ${s.steps} footfalls in a minute`);
    console.log(`  dunes 60 s: ${s.steps} footfalls · in the air ${((100 * air) / (60 * 120)).toFixed(0)}% · longest flight ${longest.toFixed(2)} s · hardest landing ${worst.toFixed(1)} m/s (${hurt.toFixed(0)} damage) · reach misses ${(over * 100).toFixed(2)}% · feet under ${under} · NaN ${nan}`);
  }
  // The run's cadence (Keith 2026-10-26 18:28: "an actual running animation where the foot cadence hits at the same
  // time", not bang-bang, hop, bang-bang): on the flat at 10 m/s and at top speed, footfalls alternate left/right at
  // even intervals, the flights between them are short, and the hull rides level.
  for (const speed of [10, top]) {
    const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
    const sim = new WalkerSim({ ...values, boundTop: speed, boundBuild: 3 }, flat);
    sim.reset(0, 0, 0);
    const falls: { side: number; t: number }[] = [];
    let t = 0, both = 0, flight = 0, longest = 0, yMin = Infinity, yMax = -Infinity, n = 0;
    sim.onFootfall = (f) => { if (t > 6) falls.push({ side: f.side, t }); };
    for (let i = 0; i < 12 * 120; i++, t += sdt) {
      sim.bound = true;
      sim.update(sdt, { x: 0, z: 1, sprint: true });
      if (t < 6) continue;
      n++;
      const air = sim.feet.every((f) => f.swinging) || sim.airborne;
      if (air) { both++; flight += sdt; longest = Math.max(longest, flight); } else flight = 0;
      yMin = Math.min(yMin, sim.pelvis.y); yMax = Math.max(yMax, sim.pelvis.y);
    }
    let same = 0;
    const gaps: number[] = [];
    for (let i = 1; i < falls.length; i++) { if (falls[i].side === falls[i - 1].side) same++; gaps.push(falls[i].t - falls[i - 1].t); }
    const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
    const spread = Math.max(...gaps.map((g) => Math.abs(g - mean))) / Math.max(1e-6, mean);
    const label = `${speed} m/s`;
    if (same > 0) problems.push(`run at ${label}: ${same} footfalls by the same foot twice running`);
    if (spread > 0.15) problems.push(`run at ${label}: footfall intervals uneven (worst ${(spread * 100).toFixed(0)}% off the mean)`);
    if (both === 0) problems.push(`run at ${label}: no flight phase`);
    if (longest > 0.22) problems.push(`run at ${label}: flights up to ${longest.toFixed(2)} s (not short)`);
    if (yMax - yMin > 0.3) problems.push(`run at ${label}: hips rise and fall ${(yMax - yMin).toFixed(2)} m`);
    console.log(`  run at ${label}: ${(1 / mean).toFixed(2)} steps/s, alternating (${same} repeats), intervals within ${(spread * 100).toFixed(0)}% · flights ${((100 * both) / n).toFixed(0)}% of the time, longest ${longest.toFixed(2)} s · hips move ${(yMax - yMin).toFixed(2)} m`);
  }
  // Up a ramp at top speed (Keith 2026-10-26 18:28: the torso dipped into rising ground): the hips stay well over the
  // highest ground under the hull (from the hips to 2 m ahead), so the hull doesn't plough in.
  {
    const HULL_CLEAR = 1.9;
    for (const deg of [12, 18, 25]) {
      const k = Math.tan((deg * Math.PI) / 180);
      const g = shaped((_x, z) => Math.max(0, (z - 50) * k));
      const sim = new WalkerSim({ ...values, boundBuild: 3 }, g);
      sim.reset(0, 0, 0);
      let low = Infinity;
      for (let i = 0; i < 9 * 120; i++) {
        sim.bound = true;
        sim.update(sdt, { x: 0, z: 1, sprint: true });
        if (sim.pos.z < 40 || sim.airborne) continue;
        let ahead = -Infinity;
        for (let a = 0; a <= 2; a += 0.25) ahead = Math.max(ahead, g.height(0, sim.pos.z + a));
        low = Math.min(low, sim.pelvis.y - ahead);
      }
      if (low < HULL_CLEAR) problems.push(`sprinting up a ${deg}° ramp the hips came within ${low.toFixed(2)} m of the ground under the hull (limit ${HULL_CLEAR})`);
      console.log(`  up a ${deg}° ramp: hips at least ${low.toFixed(2)} m over the ground under the hull`);
    }
  }
  // Speed builds from the run toward the legs' top speed while held, on the flat.
  {
    const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
    const sim = new WalkerSim({ ...values }, flat);
    sim.reset(0, 0, 0);
    for (let i = 0; i < 120; i++) sim.update(sdt, { x: 0, z: 1, sprint: true });
    const at: number[] = [];
    for (let i = 1; i <= 15 * 120; i++) {
      sim.bound = true;
      sim.update(sdt, { x: 0, z: 1, sprint: true });
      if (i === 120 || i === 3 * 120 || i === 6 * 120 || i === 15 * 120) at.push(sim.boundSpeed);
    }
    if (!(at[0] < at[1] && at[1] < at[2] && at[2] <= at[3] + 0.05)) problems.push(`speed doesn't build: ${at.map((x) => x.toFixed(1)).join(", ")}`);
    if (!(at[0] < top * 0.85)) problems.push(`at top speed too soon (${at[0].toFixed(1)} after 1 s)`);
    if (Math.abs(at[3] - top) > top * 0.05) problems.push(`settles at ${at[3].toFixed(1)} m/s, not the legs' ${top}`);
    console.log(`  speed held 1/3/6/15 s: ${at.map((x) => x.toFixed(1)).join(", ")} m/s`);
  }
  // The turning circle grows with speed (like a vehicle).
  {
    const radius = (speed: number) => {
      const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
      const sim = new WalkerSim({ ...values, boundTop: speed }, flat);
      sim.reset(0, 0, 0);
      sim.bound = true;
      for (let i = 0; i < 12 * 120; i++) sim.update(sdt, { x: 0, z: 1, sprint: true });
      const c0 = sim.course;
      let turned = 0, prev = c0;
      for (let i = 0; i < 2 * 120; i++) {
        sim.update(sdt, { x: Math.sin(sim.heading + 1.4), z: Math.cos(sim.heading + 1.4), sprint: true });
        let d = sim.course - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); turned += d; prev = sim.course;
      }
      return (sim.boundSpeed * 2) / Math.max(1e-3, Math.abs(turned));
    };
    const r10 = radius(10), r16 = radius(16);
    if (!(r16 > r10 * 1.8)) problems.push(`turning circle at 16 m/s (${r16.toFixed(0)} m) not much wider than at 10 (${r10.toFixed(0)} m)`);
    console.log(`  turning radius: ${r10.toFixed(0)} m at 10 m/s, ${r16.toFixed(0)} m at 16 m/s`);
  }
  // Walls: sprinting at top speed into a 40-60° face (2 or 8 m high), the hips never rise more than 2.5 m over
  // standing above the ground under them (Keith 2026-10-26: no fling into the sky).
  {
    let worst = 0, at = "";
    for (const H of [2, 8]) for (const deg of [40, 50, 60]) {
      const k = Math.tan((deg * Math.PI) / 180);
      const g = shaped((_x, z) => Math.min(H, Math.max(0, (z - 40) * k)));
      const sim = new WalkerSim({ ...values }, g);
      sim.reset(0, 0, 0);
      sim.boundSpeed = top;
      for (let i = 0; i < 8 * 120; i++) {
        sim.bound = true;
        sim.update(sdt, { x: 0, z: 1, sprint: true });
        const rise = sim.pelvis.y - g.height(0, sim.pos.z) - values.hipHeight;
        if (rise > worst) { worst = rise; at = `${H} m at ${deg}°`; }
        if (!Number.isFinite(sim.pelvis.y)) { problems.push(`NaN sprinting into a wall`); break; }
      }
    }
    if (worst > 2.5) problems.push(`sprinting into a wall rose ${worst.toFixed(1)} m over standing (${at})`);
    console.log(`  into 40-60° walls: hips at most ${worst.toFixed(1)} m over standing (${at})`);
  }
  // A dune: a long 18° windward climb to 8 m over a brink rounded across about 4 m, and a 32° slip face. At top speed
  // the mech flies off it a good way (best of a few stride timings); walking over it, it stays on the ground.
  {
    const up = Math.tan((18 * Math.PI) / 180), down = Math.tan((32 * Math.PI) / 180), zc = 20 + 8 / up, K = 2.5;
    const smin = (a: number, b: number) => { const h = Math.max(K - Math.abs(a - b), 0) / K; return Math.min(a, b) - (h * h * K) / 4; };
    const g = shaped((_x, z) => Math.max(0, smin(Math.max(0, (z - 20) * up), 8 - (z - zc) * down)));
    const run = (sprint: boolean, z0: number) => {
      const sim = new WalkerSim({ ...values }, g);
      sim.reset(0, z0, 0);
      let longest = 0, dist = 0, t = 0, zt = 0, worst = 0;
      sim.onLand = (l) => { worst = Math.max(worst, l.impact); };
      for (let i = 0; i < 10 * 120; i++) {
        sim.bound = sprint;
        // Held at top speed into the climb (the uphill would otherwise slow it).
        if (sprint && !sim.airborne) sim.boundSpeed = Math.max(sim.boundSpeed, top);
        const was = sim.airborne;
        sim.update(sdt, { x: 0, z: 1, sprint: false });
        if (sim.airborne && !was) { t = 0; zt = sim.pos.z; }
        if (sim.airborne) { t += sdt; if (t > longest) { longest = t; dist = sim.pos.z - zt; } }
      }
      return { longest, dist, worst };
    };
    let fast = { longest: 0, dist: 0, worst: 0 }, slow = 0;
    for (const z0 of [-12, -9, -6, -3, 0]) {
      const f = run(true, z0);
      if (f.dist > fast.dist) fast = f;
      slow = Math.max(slow, run(false, z0).longest);
    }
    if (fast.longest < 0.9 || fast.dist < 12) problems.push(`top speed off the crest flew only ${fast.longest.toFixed(2)} s, ${fast.dist.toFixed(1)} m`);
    if (slow > 0.3) problems.push(`walking over the crest flew ${slow.toFixed(2)} s`);
    console.log(`  off a dune crest: at ${top} m/s up to ${fast.longest.toFixed(2)} s, ${fast.dist.toFixed(1)} m (landing ${fast.worst.toFixed(1)} m/s) · walking ${slow.toFixed(2)} s`);
  }
  // Landing damage scales with the drop: none until landHurt, then more the higher.
  {
    const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
    const dmg: number[] = [];
    for (const h of [3, 6.5, 9, 12]) {
      const sim = new WalkerSim({ ...values }, flat);
      sim.reset(0, 0, 0);
      for (let i = 0; i < 60; i++) sim.update(sdt, { x: 0, z: 0, sprint: false });
      sim.pelvis.y += h; for (const f of sim.feet) f.pos.y += h;
      sim.launch(0, 0, 0);
      for (let i = 0; i < 4 * 120 && !sim.lastLanding; i++) sim.update(sdt, { x: 0, z: 0, sprint: false });
      dmg.push(sim.lastLanding?.damage ?? -1);
    }
    if (!(dmg[0] === 0 && dmg[1] > 0 && dmg[2] > dmg[1] && dmg[3] > dmg[2])) problems.push(`landing damage doesn't scale with the drop: ${dmg.map((x) => x.toFixed(0)).join(", ")}`);
    console.log(`  landing damage from 3 / 6.5 / 9 / 12 m: ${dmg.map((x) => x.toFixed(0)).join(", ")}`);
  }
  if (problems.length) { console.log("FAIL " + problems.join("; ")); failed = true; }
}

if (failed) throw new Error("walker check failed");
console.log("walker check passed");
