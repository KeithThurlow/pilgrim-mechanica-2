// Stress lab (Keith 2026-10-26): every combat system at scale on one battlefield, to see where a frame's time goes
// now. A one-off measurement, not a check (not in npm test). Robots in their three sizes, the bandit swarm, a war band
// of vehicles and bandit mechs, the player's Rampart firing both miniguns (it can't die here), and a barrage every few
// seconds: a missile swarm's blasts and a big mortar's, through Battlefield.blast like the real weapons. Each count is
// a slider; the HUD splits the frame by stage (src/core/costs.ts). Run ramps the counts up in steps (25, 50, 100,
// 150%), holds each, and prints a table of average and worst ms per stage per step (also on window.__stress).
//
// URL flags: ?run (start a run once loaded), ?steps=25,50,100,150, ?settle=s, ?hold=s, plus the combat-lab flags.
// Results from 2026-10-26: docs/perf-2026-10-26.md.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { Costs } from "../../src/core/costs";
import type { TargetCandidate } from "../../src/game/targeting";
import type { MoveCommand } from "../../src/mech/walker";
import type { Aim, Trigger } from "../../src/mech/upper";
import { ROBOT_DEFAULTS, ROBOT_PARAMS } from "../../src/combat/robots";
import { ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../../src/combat/robotTearFx";
import { INFANTRY_DEFAULTS, INFANTRY_PARAMS } from "../../src/combat/infantry";
import { BANDIT_LOOK_DEFAULTS, BANDIT_LOOK_PARAMS } from "../../src/combat/infantryDraw";
import { WARBAND_DEFAULTS, WARBAND_PARAMS } from "../../src/combat/warband";
import { StressRobots, StressBandits, StressWarband } from "./enemies";
import { StressRun } from "./run";

const STRESS_DEFAULTS = {
  stressRobots: 1000,
  stressBandits: 500,
  stressVehicles: 18,
  stressMechs: 2,
  stressSpawnFrom: 70,
  stressTracerShare: 0.3,
  stressRocketShare: 0.04,
  stressBarrageEvery: 4,
  stressMissiles: 10,
  stressGod: 1,
  stressBanditStomp: 2.4,
  stressRobotStomp: 2.6,
  stressSettle: 3,
  stressHold: 6,
};
const G = "Stress counts", GB = "Stress barrage", GR = "Stress run";
const STRESS_PARAMS: Param[] = [
  { key: "stressRobots", label: "Robots (three sizes)", min: 0, max: 1000, step: 10, group: G, tip: "Kept topped up; the size mix is the robot share sliders. A run's 150% step is capped at 1000 (the swarm's slots)" },
  { key: "stressBandits", label: "Bandits", min: 0, max: 1000, step: 10, group: G },
  { key: "stressVehicles", label: "War band vehicles", min: 0, max: 40, step: 1, group: G },
  { key: "stressMechs", label: "Bandit mechs", min: 0, max: 4, step: 1, group: G, tip: "Four are loaded at the start" },
  { key: "stressSpawnFrom", label: "They come from (m)", min: 20, max: 200, step: 5, group: G },
  { key: "stressTracerShare", label: "Enemy rounds drawn (share)", min: 0, max: 1, step: 0.01, group: G },
  { key: "stressRocketShare", label: "Bandit rocketeers (share)", min: 0, max: 0.5, step: 0.01, group: G },
  { key: "stressBanditStomp", label: "Stomp reach on bandits (m)", min: 0, max: 6, step: 0.1, group: G },
  { key: "stressRobotStomp", label: "Stomp reach on robots (m)", min: 0, max: 6, step: 0.1, group: G },
  { key: "stressGod", label: "Your mech can't die (0/1)", min: 0, max: 1, step: 1, group: G },
  { key: "stressBarrageEvery", label: "Barrage every (s)", min: 0, max: 20, step: 0.5, group: GB, tip: "A missile swarm then a big mortar on the nearest enemies, through Battlefield.blast (sizes from the weapon sliders); 0 off" },
  { key: "stressMissiles", label: "Missiles per swarm", min: 0, max: 40, step: 1, group: GB },
  { key: "stressSettle", label: "Settle before recording (s)", min: 0, max: 20, step: 0.5, group: GR },
  { key: "stressHold", label: "Record each step (s)", min: 1, max: 60, step: 1, group: GR },
];

const params = new URLSearchParams(location.search);
const steps = (params.get("steps") ?? "25,50,100,150").split(",").map(Number).filter((x) => x > 0);
const run = new StressRun(steps, 0, 0);
let robots: StressRobots | null = null, bandits: StressBandits | null = null, band: StressWarband | null = null;

const lab = await combatLab({
  id: "stress-lab",
  title: "Stress",
  defaults: { ...STRESS_DEFAULTS, ...ROBOT_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...INFANTRY_DEFAULTS, ...BANDIT_LOOK_DEFAULTS, ...WARBAND_DEFAULTS },
  params: [...STRESS_PARAMS, ...ROBOT_PARAMS, ...ROBOT_TEAR_PARAMS, ...INFANTRY_PARAMS, ...BANDIT_LOOK_PARAMS, ...WARBAND_PARAMS],
  topics: [
    { id: "stress", label: "Stress", groups: [G, GB, GR] },
    { id: "robots", label: "Robots", groups: ["Robots", "Robots: attack", "Robots: tearing", "Robots: medium", "Robots: big ones"] },
    { id: "bandits", label: "Bandits", groups: ["Bandits", "Bandits: guns", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: look"] },
    { id: "raiders", label: "Raiders", groups: ["Raider driving", "Raider guns", "Raider health", "Raider wrecks"] },
  ],
  selectables: [
    { topic: "robots", label: "Robots", objects: () => robots?.draw.group.children ?? [] },
    { topic: "bandits", label: "Bandits", objects: () => (bandits?.draw ? [bandits.draw.mesh] : []) },
    { topic: "raiders", label: "Raiders", objects: () => band?.wb.raiders.flatMap((r) => r.body.meshes()) ?? [] },
  ],
  actions: [{ label: "Run", onClick: () => startRun(), active: () => run.running }],
  report: () => ({ robots: robots?.sw.count ?? 0, bandits: bandits?.sw.count ?? 0, vehicles: band?.vehicles ?? 0, run: run.table }),
  demo: (t) => demo(t),
});
const { V, bf, player, app } = lab;
if (params.has("settle")) V.stressSettle = Number(params.get("settle"));
if (params.has("hold")) V.stressHold = Number(params.get("hold"));

// The frame split into stages: the shell marks its own (mech, deaths, streaming, battlefield effects); the enemies
// mark theirs below.
const costs = new Costs();
lab.costs = costs;

robots = new StressRobots(lab);
bandits = new StressBandits(lab);
await bandits.load();
band = new StressWarband(lab);
await band.load(4);
// The mech's dash and stomps reach both swarms, as in their labs.
player.onStomp = (x, z, k) => { robots!.sw.stomp(x, z, V.stressRobotStomp * Math.min(1.5, k)); bandits!.sw.stomp(x, z, V.stressBanditStomp * Math.min(1.5, k)); };

// Every live enemy the guns could take, built fresh on each call as the other labs do (its time is measured too).
let targetsMs = 0;
lab.targets = () => {
  const t0 = performance.now();
  const out: TargetCandidate[] = [];
  robots!.candidates(out); bandits!.candidates(out); band!.candidates(out);
  targetsMs += performance.now() - t0;
  return out;
};

/** The demo: slow loops, both miniguns on the nearest enemy. */
function demo(t: number): { cmd: MoveCommand; aim: Aim | null; trigger: Trigger; lock?: TargetCandidate | null } {
  const a = t * 0.12, p = player.sim.pos;
  const cmd = { x: Math.sin(a), z: Math.cos(a), sprint: false };
  let e: TargetCandidate | null = null, bd = Infinity;
  for (const c of lab.targets()) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; e = c; } }
  if (!e) return { cmd, aim: null, trigger: false };
  return { cmd, aim: { x: e.x + (e.vx ?? 0) * V.lockLead, y: e.y, z: e.z + (e.vz ?? 0) * V.lockLead }, trigger: bd < V.range + 5, lock: e };
}

// ---- The barrage: a missile swarm's blasts over ~0.6 s round the nearest enemy 15 m+ out, then a big mortar's ----
type Blast = { at: number; x: number; z: number; r: number; dmg: number };
const queue: Blast[] = [];
let barrageClock = 0, clock = 0;
const blastAt = new THREE.Vector3();
function barrage() {
  const p = player.sim.pos;
  let e: TargetCandidate | null = null, bd = Infinity;
  for (const c of lab.targets()) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d > 15 && d < bd) { bd = d; e = c; } }
  if (!e) return;
  for (let i = 0; i < V.stressMissiles; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * V.swarmRadius;
    queue.push({ at: clock + 0.4 + i * V.swarmRipple, x: e.x + Math.sin(a) * r, z: e.z + Math.cos(a) * r, r: V.swarmBlast, dmg: V.swarmDamage });
  }
  queue.push({ at: clock + 1.5, x: e.x, z: e.z, r: V.mortarBlast, dmg: V.mortarDamage });
}

// ---- Each frame: top the counts up, step the enemies (each marks its stages), the barrage ----
lab.onFrame((dt) => {
  clock += dt;
  const mark = (s: string) => costs.mark(s);
  const k = run.share;
  robots!.topUp(V.stressRobots * k);
  bandits!.topUp(V.stressBandits * k);
  band!.topUp(V.stressVehicles * k, V.stressMechs * k, dt);
  mark("spawning");
  robots!.update(dt, mark);
  bandits!.update(dt, mark);
  band!.update(dt, mark);
  if (V.stressBarrageEvery > 0 && (barrageClock += dt) >= V.stressBarrageEvery) { barrageClock = 0; barrage(); }
  for (let i = queue.length - 1; i >= 0; i--) {
    const b = queue[i];
    if (b.at > clock) continue;
    queue.splice(i, 1);
    bf.blast(1, blastAt.set(b.x, lab.field.height(b.x, b.z), b.z), b.r, b.dmg);
  }
  mark("barrage blasts");
  if (V.stressGod && player.alive) player.health = player.maxHealth;
});

// ---- After the whole tick: one sample for the run, and the HUD ----
const out = document.createElement("pre");
out.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:5;max-width:calc(100vw - 20px);max-height:45vh;overflow:auto;margin:0;padding:8px;background:var(--panel);border:1px solid var(--line);border-radius:6px;font:11px/1.35 ui-monospace,monospace;color:var(--fg);display:none";
document.body.appendChild(out);
function startRun() {
  run.settle = V.stressSettle; run.hold = V.stressHold;
  run.start();
  out.style.display = "none";
}
(globalThis as unknown as { __stress: unknown }).__stress = run;
app.onTick((rawDt) => {
  const dt = Number(params.get("dt")) || rawDt;
  const last = app.last;
  const ms = new Map(costs.frame);
  ms.set("frame", last.frame);
  ms.set("tick (all sim)", last.tick);
  ms.set("render (submit)", last.render);
  ms.set("gpu/wait", Math.max(0, last.frame - last.tick - last.render));
  ms.set("  inside the above: target lists", targetsMs);
  targetsMs = 0;
  const counts = {
    robots: robots!.sw.count, bandits: bandits!.sw.count, vehicles: band!.vehicles, "bandit mechs": band!.mechs,
    bodies: lab.deaths.dead.length, "dust particles": bf.dust.alive, "draw calls": last.calls, "triangles (k)": last.tris / 1000,
  };
  if (run.frame(dt, { ms, counts })) {
    out.textContent = run.table;
    out.style.display = "block";
    console.log("stress run\n" + run.table);
  }
  lab.hud("stress", `robots ${counts.robots} · bandits ${counts.bandits} · vehicles ${counts.vehicles} · bandit mechs ${counts["bandit mechs"]} · bodies ${counts.bodies}${run.phase ? ` · ${run.phase}` : ""}`);
});
if (params.has("run")) startRun();
