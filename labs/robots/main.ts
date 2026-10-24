// Robot swarm lab (Keith 2026-10-24): hostile quadruped robots swarming across the dunes. Most are small and fast:
// they pour in as a pack, leap onto the mech and cling on, biting, until shot off, stomped off or shaken off at a run;
// a few hang back and shoot. A few big ones stalk in slowly, stop at range and fire heavy bursts, and take a lot of
// killing. Power and threat at once.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { RobotSwarm, ROBOT_DEFAULTS, ROBOT_PARAMS, DOWN } from "../../src/combat/robots";
import { RobotsDraw } from "../../src/combat/robotsDraw";
import { RobotTarget } from "../../src/combat/robotTarget";
import { ROBOT_PARTS, ROBOT_JOINTS } from "../../src/physics/bodies";

const WAVE_DEFAULTS = {
  robotSwarmSize: 220,
  robotGroupSize: 30,
  robotGroupEvery: 4,
  robotSpawnFrom: 100,
  robotTracerShare: 0.5,
  robotStompReach: 2.6,
};
const WAVE_PARAMS: Param[] = [
  { key: "robotSwarmSize", label: "Robots on the field", min: 0, max: 1000, step: 10, group: "Robot waves", tip: "Packs keep coming until this many are up" },
  { key: "robotGroupSize", label: "Pack size", min: 1, max: 200, step: 1, group: "Robot waves" },
  { key: "robotGroupEvery", label: "A pack every (s)", min: 0.2, max: 30, step: 0.1, group: "Robot waves" },
  { key: "robotSpawnFrom", label: "They come from (m)", min: 30, max: 250, step: 5, group: "Robot waves" },
  { key: "robotTracerShare", label: "Share of rounds drawn", min: 0, max: 1, step: 0.01, group: "Robot waves", tip: "Only this share of the small ones' rounds draw a tracer and sound; the rest still hit. Big ones' rounds always show" },
  { key: "robotStompReach", label: "Stomp reach (m)", min: 0, max: 6, step: 0.1, group: "Robot waves", tip: "A footfall knocks off clingers and crushes small ones this close" },
];

let swarm: RobotSwarm | null = null;
let draw: RobotsDraw | null = null;
const lab = await combatLab({
  id: "robots-lab",
  title: "Robot swarm",
  defaults: { ...ROBOT_DEFAULTS, ...WAVE_DEFAULTS },
  params: [...WAVE_PARAMS, ...ROBOT_PARAMS],
  topics: [{ id: "robots", label: "Robots", groups: ["Robot waves", "Robots", "Robots: big ones", "Robots: attack"] }],
  selectables: [{ topic: "robots", label: "Robots", objects: () => (draw ? draw.group.children : []) }],
  actions: [{ label: "Pack now", onClick: () => spawnPack() }],
  report: () => ({ robots: swarm?.count ?? 0, clinging: swarm?.latchedCount ?? 0 }),
});
const { V, bf, player, field } = lab;
const sw = new RobotSwarm(V, field);
swarm = sw;
draw = new RobotsDraw(sw);
lab.app.scene.add(draw.group);
const target = new RobotTarget(sw, 3);
bf.targets.push(target);
player.onStomp = (x, z, k) => sw.stomp(x, z, V.robotStompReach * Math.min(1.5, k));
// Deaths go to the physics: the body and its four legs fall apart loosely (small ones fly, big ones fold).
sw.hideDead = true;
sw.onDeath = (i, nx, nz, speed) => {
  const s = sw.size[i], big = sw.kind[i] === 1;
  lab.deaths.ragdoll(ROBOT_PARTS(s, 0xd6d3cc, 0x34363a), ROBOT_JOINTS(s), sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
    { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, big ? 1 : Math.max(3, speed));
};

function spawnPack() {
  const a = Math.random() * Math.PI * 2;
  const p = player.sim.pos;
  sw.spawn(Math.round(V.robotGroupSize), p.x + Math.sin(a) * V.robotSpawnFrom, p.z + Math.cos(a) * V.robotSpawnFrom, 5 + Math.sqrt(V.robotGroupSize));
}

const from = new THREE.Vector3(), dir = new THREE.Vector3(), bitePos = new THREE.Vector3(), up = new THREE.Vector3(0, -1, 0);
let packClock = Infinity, slot = 2; // the first pack comes at once
lab.nearestEnemy = () => {
  let bi = -1, bd = Infinity;
  const p = player.sim.pos;
  for (let i = 0; i < sw.hi; i++) {
    if (sw.state[i] >= DOWN) continue; // skip down, dead, empty
    const d = (sw.px[i] - p.x) ** 2 + (sw.pz[i] - p.z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi < 0 ? null : new THREE.Vector3(sw.px[bi], sw.py[bi] + 0.5, sw.pz[bi]);
};
lab.onFrame((dt) => {
  packClock += dt;
  if (sw.count < V.robotSwarmSize && packClock >= V.robotGroupEvery) { packClock = 0; spawnPack(); }
  const p = player.sim.pelvis;
  sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: 2, vx: player.sim.vel.x, vz: player.sim.vel.z },
    (fx, fy, fz, tx, ty, tz, big) => {
      if (!player.alive) return;
      from.set(fx, fy, fz);
      if (!bf.canSee(from, p)) return;
      dir.set(tx - fx, ty - fy, tz - fz).normalize();
      const drawn = big || Math.random() < V.robotTracerShare;
      if (drawn) slot = slot >= 19 ? 2 : slot + 1;
      bf.fire(slot, 3, from, dir, from.distanceTo(p) + 8, big ? V.robotBigShotDamage : V.robotShotDamage,
        drawn ? { flashScale: big ? 1.2 : 0.35, voice: "other" } : { tracer: false, voice: "none" });
    },
    (i, damage) => { if (player.alive) player.damage(damage, bitePos.set(sw.px[i], sw.py[i], sw.pz[i]), up); });
  draw!.update(dt);
  lab.hud("robots", `robots ${sw.count} up · clinging ${sw.latchedCount} · destroyed ${target.kills}`);
});
