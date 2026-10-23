// Headless walker check: drive the walker over the dune field (walk, sprint, zigzag, stop) and fail on the things
// that break the illusion: legs that can't reach their feet, swing feet through the ground, both feet in the air,
// knees bending backwards, planted feet sliding. Run: npm test (or npx tsx tools/walker-check.ts).
import { Vector3 } from "three";
import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
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
for (const r of runs) {
  const terrain = { ...TERRAIN_DEFAULTS };
  if (r.name === "flat ground") { terrain.height = 0; terrain.swell = 0; terrain.bumps = 0; }
  const field = new DuneField(terrain);
  const sim = new WalkerSim({ ...WALKER_DEFAULTS }, field);
  sim.reset(13, -40, 0.3);
  let bothAir = 0, kneeBack = 0, slide = 0, maxSlide = 0, minClear = Infinity, maxHipToGround = 0, minHipToGround = Infinity;
  const lastPlant = sim.feet.map(() => new Vector3());
  const wasPlanted = sim.feet.map(() => false);
  const frames = Math.round(r.seconds / dt);
  for (let i = 0; i < frames; i++) {
    sim.update(dt, r.cmd(i * dt));
    if (sim.feet[0].swinging && sim.feet[1].swinging) bothAir++;
    sim.feet.forEach((f, k) => {
      const P = f.pose;
      // Knee on the forward side of the hip-hock line (and the solve not degenerate).
      const line = new Vector3().subVectors(P.hock, P.hip).normalize();
      const off = new Vector3().subVectors(P.knee, P.hip);
      off.addScaledVector(line, -off.dot(line));
      if (!Number.isFinite(P.knee.x) || off.dot(P.legFwd) < -0.01) kneeBack++;
      if (!f.swinging) {
        if (wasPlanted[k]) { const s = lastPlant[k].distanceTo(f.planted); maxSlide = Math.max(maxSlide, s); if (s > 0.001) slide++; }
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
  if (over > 0.01) problems.push(`legs out of reach ${(over * 100).toFixed(1)}% of leg-frames`);
  if (s.scuffs > 0) problems.push(`${s.scuffs} swing-foot frames under the ground`);
  if (bothAir > 0) problems.push(`${bothAir} frames with both feet in the air`);
  if (kneeBack > 0) problems.push(`${kneeBack} knee-backwards frames`);
  if (slide > 0) problems.push(`planted feet slid ${slide} frames (max ${maxSlide.toFixed(3)} m)`);
  if (r.name !== "start and stop" && s.steps < r.seconds * 1.2) problems.push(`only ${s.steps} steps`);
  const line = `${r.name.padEnd(16)} steps ${String(s.steps).padStart(4)} · reach misses ${(over * 100).toFixed(2)}% · ` +
    `min swing clearance ${minClear === Infinity ? "-" : minClear.toFixed(2)} m · hip above ground ${minHipToGround.toFixed(2)}..${maxHipToGround.toFixed(2)} m · moved ${sim.pos.length().toFixed(0)} m`;
  console.log((problems.length ? "FAIL " : "ok   ") + line + (problems.length ? "\n       " + problems.join("; ") : ""));
  if (problems.length) failed = true;
}
if (failed) throw new Error("walker check failed");
console.log("walker check passed");
