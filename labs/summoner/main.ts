// Summoner lab (Keith 2026-11-02: "the summoner archetype ... drones that can fly around the mech and target enemies",
// docs/proposal-summoner.md): the player's own units against the robot swarm. Attack drones orbit the mech and go for
// the target lock (Tab, or the soft lock under the cursor), else the nearest robots, circling them and firing bursts.
// Two turret companions (weapon quads: minigun and rockets) walk at your flanks and shoot what you lock or what's near;
// the scrap swarm trails you and bites what comes close, and Z throws it at the cursor (or your lock), C calls it back.
// Robot packs come in as in the robots lab (scrappers leap on and bite, cutters saw, weapon quads shoot); robots near
// your allies turn on them.
// Flags: ?drones=N (drones up, 4), ?comps=N (companions, 2), ?scrappers=N (the swarm, 16), ?send (the swarm thrown
// 30 m ahead at once), ?enemies=N (robots on the field, 60; 0 none), ?pack=N (pack size), ?still (one pack stands 25 m
// ahead and only shoots back: watch your units work), plus the combat-lab flags (?manual, ?zoom, ?flat...).
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { RobotSwarm, ROBOT_DEFAULTS, ROBOT_PARAMS, DOWN, LATCHED, SMALL, MID, BIG } from "../../src/combat/robots";
import { RobotsDraw } from "../../src/combat/robotsDraw";
import { RobotTarget } from "../../src/combat/robotTarget";
import { RobotTearFx, ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../../src/combat/robotTearFx";
import { robotRagdoll } from "../../src/physics/bodies";
import { ROBOT_RAG } from "../../src/combat/robotShapes";
import { robotFootfall } from "../../src/combat/robotPrints";
import { typing } from "../../src/core/input";
import { splashBlast } from "../../src/game/splash";
import { aggroOnAllies } from "../../src/summon/allies";
import { Summons, SUMMON_DEFAULTS, SUMMON_PARAMS, SUMMON_TOPIC } from "../../src/summon/summons";

const q = new URLSearchParams(location.search);
const WAVE_DEFAULTS = { sumEnemies: 60, sumPack: 20, sumPackEvery: 6, sumPackFrom: 90 };
const GW = "Summoner lab: robots";
const WAVE_PARAMS: Param[] = [
  { key: "sumEnemies", label: "Robots on the field", min: 0, max: 600, step: 10, group: GW, tip: "Packs keep coming until this many are up" },
  { key: "sumPack", label: "Pack size", min: 1, max: 120, step: 1, group: GW },
  { key: "sumPackEvery", label: "A pack every (s)", min: 0.5, max: 60, step: 0.5, group: GW },
  { key: "sumPackFrom", label: "They come from (m)", min: 20, max: 250, step: 5, group: GW },
];

let summons: Summons | null = null;
let draw: RobotsDraw | null = null;
let swarm: RobotSwarm | null = null;
const lab = await combatLab({
  id: "summoner-lab",
  title: "Summoner",
  defaults: { ...SUMMON_DEFAULTS, ...ROBOT_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...WAVE_DEFAULTS },
  params: [...SUMMON_PARAMS, ...WAVE_PARAMS, ...ROBOT_PARAMS, ...ROBOT_TEAR_PARAMS],
  topics: [SUMMON_TOPIC, { id: "robots", label: "Robots", groups: [GW, "Robots", "Robots: attack", "Robots: tearing", "Robots: medium", "Robots: big ones", "Robots: weapon quads"] }],
  selectables: [
    { topic: "summons", label: "Drones, companions and swarm", objects: () => summons?.meshes ?? [] },
    { topic: "robots", label: "Robots", objects: () => (draw ? draw.group.children : []) },
  ],
  actions: [{ label: "Pack now", onClick: () => spawnPack() }, { label: "Send the swarm (Z)", onClick: () => summons?.send() }, { label: "Recall (C)", onClick: () => summons?.recall() }],
  report: (): Record<string, unknown> => ({ drones: summons?.hud() ?? "", robots: swarm?.count ?? 0 }),
});
const { V, bf, player, field } = lab;
if (q.has("drones")) V.droneCount = Number(q.get("drones")) || 0;
if (q.has("enemies")) V.sumEnemies = Number(q.get("enemies")) || 0;
if (q.has("comps")) V.compCount = Number(q.get("comps")) || 0;
if (q.has("scrappers")) V.swarmCount = Number(q.get("scrappers")) || 0;
if (q.has("pack")) V.sumPack = Number(q.get("pack")) || V.sumPack;
const still = q.has("still");
if (still) {
  // They stand and shoot back.
  V.sumEnemies = 0;
  Object.assign(V, { robotRunSpeed: 0, robotMidSpeed: 0, robotQuadSpeed: 0, robotBigSpeed: 0, robotLeapRange: 0, robotShooterShare: 1 });
}
lab.refresh();

// The enemy swarm, as in the robots lab (shorter: no droids, striders or shot flags).
const sw = new RobotSwarm(V, field, 3);
swarm = sw;
sw.lookGround = bf.lookGround;
draw = new RobotsDraw(sw);
lab.app.scene.add(draw.group);
const target = new RobotTarget(sw, 3);
bf.targets.push(target);
bf.register.add(target);
const tear = new RobotTearFx(bf.gunFx, bf.sfx, field, V);
lab.app.scene.add(tear.group);
player.onStomp = (x, z, k) => sw.stomp(x, z, 2.6 * Math.min(1.5, k));
sw.hideDead = true;
sw.onDeath = (i, nx, nz, speed) => {
  const kind = sw.kind[i], [body, leg] = ROBOT_RAG[kind];
  const { parts, joints } = robotRagdoll(sw, i, body, leg);
  lab.deaths.ragdoll(parts, joints, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i], { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, kind === SMALL ? Math.max(3, speed) : 1);
};
sw.onFootfall = robotFootfall(bf, sw);
const lobFrom = new THREE.Vector3();
sw.onLob = (i, fx, fy, fz, x, z, flight) => { if (!player.alive) return; const l = sw.lobOf(i); bf.lob(3, lobFrom.set(fx, fy, fz), x, z, flight, l.arc, l.radius, l.damage); };
if (still) { const p = player.sim.pos; sw.spawn(Math.round(V.sumPack), p.x, p.z + 25, 6, { mid: 0.15, big: 0 }); }

// The summoner's units.
summons = new Summons(bf, lab.app.scene, V, field, player, lab.enemies, lab.deaths);
// Z sends the swarm (at the lock, else the cursor), C calls it back.
addEventListener("keydown", (e) => {
  if (typing(e) || e.repeat) return;
  if (e.code === "KeyZ") summons!.send();
  if (e.code === "KeyC") summons!.recall();
});
const sendAtStart = q.has("send");
// The demo throws the swarm at the nearest robots every 12 s.
let demoSend = 0;

let spawnSeed = 1;
function spawnPack() {
  const a = (spawnSeed++ * 2.39996) % (Math.PI * 2), p = player.sim.pos;
  sw.spawn(Math.round(V.sumPack), p.x + Math.sin(a) * V.sumPackFrom, p.z + Math.cos(a) * V.sumPackFrom, 5 + Math.sqrt(V.sumPack));
}

const aimAt = new THREE.Vector3(), from = new THREE.Vector3(), dir = new THREE.Vector3(), bitePos = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
const LOOK: Record<number, { flash: number; hit: number }> = { [SMALL]: { flash: 0.35, hit: 0.3 }, [MID]: { flash: 0.7, hit: 0.6 }, [BIG]: { flash: 1.2, hit: 1 } };
const aggroList: number[] = [];
let packClock = Infinity, slot = 2, lastPrey = "mech";
lab.onFrame((dt) => {
  packClock += dt;
  if (sw.count < V.sumEnemies && packClock >= V.sumPackEvery) { packClock = 0; spawnPack(); }
  let cx = 0, cz = 0, n = 0;
  for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DOWN) { cx += sw.px[i]; cz += sw.pz[i]; n++; }
  const prey = n ? lab.prey(cx / n, cz / n) : lab.prey(player.sim.pos.x, player.sim.pos.z);
  if (prey.kind !== lastPrey) for (let i = 0; i < sw.hi; i++) if (sw.state[i] === LATCHED) sw.shake[i] = 1e3;
  lastPrey = prey.kind;
  const p = prey.at;
  // Robots near your companions and scrappers (nearer them than you) turn on them, a share of them.
  aggroOnAllies(sw, summons!.allies, p, V.allyAggro, V.allyAggroShare, aggroList);
  sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: prey.radius, vx: prey.sim.vel.x, vz: prey.sim.vel.z, latchLow: prey.latchLow, latchHigh: prey.latchHigh },
    (fx, fy, fz, tx, ty, tz, kind, ri) => {
      // On an ally (a companion or scrapper it turned on), the round goes where it aims.
      const own = sw.hasT[ri] === 1;
      if (!own && !prey.alive) return;
      from.set(fx, fy, fz);
      if (!bf.canSee(from, own ? aimAt.set(tx, ty, tz) : p)) return;
      dir.set(tx - fx, ty - fy, tz - fz).normalize();
      const drawn = kind !== SMALL || Math.random() < 0.5;
      if (drawn) slot = slot >= 19 ? 2 : slot + 1;
      const look = LOOK[kind];
      bf.fire(slot, 3, from, dir, from.distanceTo(p) + 8, sw.shotDamage(ri), drawn ? { flashScale: look.flash, voice: "other", hitScale: look.hit } : { tracer: false, voice: "none" });
    },
    (i, damage) => { if (sw.hasT[i]) { splashBlast(bf.targets, 3, bitePos.set(sw.px[i], sw.py[i] + 0.4, sw.pz[i]), 1.6, damage, down); return; } if (!prey.alive) return; prey.unit.damage(damage, bitePos.set(sw.px[i], sw.py[i], sw.pz[i]), down); tear.bite(sw.px[i], sw.py[i], sw.pz[i], p.x, p.z); },
    (ci, damage, x, y, z) => { if (sw.hasT[ci]) { splashBlast(bf.targets, 3, bitePos.set(x, y, z), 1.8, damage, down); return; } if (!prey.alive) return; prey.unit.damage(damage, bitePos.set(x, y, z), down); tear.bite(x, y, z, p.x, p.z); });
  draw!.update(dt);
  tear.update(dt);
  summons!.update(dt);
  lab.hud("summons", summons!.hud());
  if (sendAtStart && lab.app && summons!.allies.sends === 0 && summons!.allies.scrappers >= Math.min(8, V.swarmCount)) {
    const h = player.sim.heading; summons!.allies.sendSwarm(player.sim.pos.x + Math.sin(h) * 30, player.sim.pos.z + Math.cos(h) * 30);
  }
  if (lab.demoOn() && (demoSend += dt) > 12 && n) { demoSend = 0; summons!.allies.sendSwarm(cx / n, cz / n); }
  lab.hud("robots", `robots ${sw.count} up · clinging ${sw.latchedCount} · destroyed ${target.kills}`);
});
