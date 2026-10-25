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
  // Leaving the ground off a crest (Keith 2026-10-26): rare at a walk, small hops at a run.
  if (r.name === "walk straight" && s.takeoffs > 1) problems.push(`left the ground ${s.takeoffs} times at a walk`);
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
if (failed) throw new Error("walker check failed");
console.log("walker check passed");
