// Robot swarm lab (Keith 2026-10-24): hostile robots swarming across the dunes. Most are small four-legged starfish
// that scuttle in any direction: they pour in as a pack, leap onto the mech and cling on, tearing at its plating
// (sparks, scraps of plate, a grinding screech), until shot off, stomped off or shaken off at a run; a few hang back
// and shoot. A few big ones are War of the Worlds tripods that swing in from the side on long legs, stop at range
// and fire heavy bursts from high up, and take a lot of killing. Power and threat at once.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { RobotSwarm, ROBOT_DEFAULTS, ROBOT_PARAMS, DOWN, LATCHED, SMALL, robotCentre } from "../../src/combat/robots";
import { RobotsDraw } from "../../src/combat/robotsDraw";
import { RobotTarget } from "../../src/combat/robotTarget";
import { RobotTearFx, ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../../src/combat/robotTearFx";
import { robotRagdoll } from "../../src/physics/bodies";

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
  defaults: { ...ROBOT_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...WAVE_DEFAULTS },
  params: [...WAVE_PARAMS, ...ROBOT_PARAMS, ...ROBOT_TEAR_PARAMS],
  topics: [{ id: "robots", label: "Robots", groups: ["Robot waves", "Robots", "Robots: big ones", "Robots: attack", "Robots: tearing"] }],
  selectables: [{ topic: "robots", label: "Robots", objects: () => (draw ? draw.group.children : []) }],
  actions: [{ label: "Pack now", onClick: () => spawnPack() }],
  report: () => ({ robots: swarm?.count ?? 0, clinging: swarm?.latchedCount ?? 0 }),
});
const { V, bf, player, field } = lab;
const sw = new RobotSwarm(V, field);
// A dash throws clingers off and bowls over small ones in the way.
player.onDash = (x, z, dx, dz) => {
  const r2 = V.dashShoveRadius * V.dashShoveRadius;
  for (let i = 0; i < sw.hi; i++) {
    const st = sw.state[i];
    if (st === LATCHED) { sw.shake[i] = 1e3; continue; }
    if (st >= DOWN || sw.kind[i] !== SMALL) continue;
    const ox = sw.px[i] - x, oz = sw.pz[i] - z;
    if (ox * ox + oz * oz < r2) sw.damage(i, V.dashShoveDamage, dx, dz);
  }
};
swarm = sw;
draw = new RobotsDraw(sw);
lab.app.scene.add(draw.group);
const target = new RobotTarget(sw, 3);
bf.targets.push(target);
player.onStomp = (x, z, k) => sw.stomp(x, z, V.robotStompReach * Math.min(1.5, k));
// Deaths go to the physics: hub or hood and the legs fall apart loosely (small ones fly, tripods topple from height).
sw.hideDead = true;
sw.onDeath = (i, nx, nz, speed) => {
  const big = sw.kind[i] === 1;
  const { parts, joints } = robotRagdoll(sw, i, big ? 0x8e918f : 0xd6d3cc, big ? 0x34373b : 0x45484c);
  lab.deaths.ragdoll(parts, joints, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
    { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, big ? 1 : Math.max(3, speed));
};
// Tripod feet coming down kick up the sand; latched small ones tear at the plating.
sw.onFootfall = (_i, x, y, z) => bf.dust.stomp(x, y, z, 0.45);
const tear = new RobotTearFx(bf.gunFx, bf.sfx, field, V);
lab.app.scene.add(tear.group);

function spawnPack() {
  const a = Math.random() * Math.PI * 2;
  const p = player.sim.pos;
  sw.spawn(Math.round(V.robotGroupSize), p.x + Math.sin(a) * V.robotSpawnFrom, p.z + Math.cos(a) * V.robotSpawnFrom, 5 + Math.sqrt(V.robotGroupSize));
}

const from = new THREE.Vector3(), dir = new THREE.Vector3(), bitePos = new THREE.Vector3(), up = new THREE.Vector3(0, -1, 0);
let packClock = Infinity, slot = 2; // the first pack comes at once
lab.targets = () => {
  const out: TargetCandidate[] = [];
  for (let i = 0; i < sw.hi; i++) {
    if (sw.state[i] >= DOWN) continue; // skip down, dead, empty
    const c = { x: 0, y: 0, z: 0, r: 0, key: i as unknown };
    c.r = Math.max(0.6, robotCentre(sw, i, c)); // the hub, or a tripod's high body
    out.push(c);
  }
  return out;
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
        drawn ? { flashScale: big ? 1.2 : 0.35, voice: "other", hitScale: big ? 1 : 0.3 } : { tracer: false, voice: "none" });
    },
    (i, damage) => {
      if (!player.alive) return;
      player.damage(damage, bitePos.set(sw.px[i], sw.py[i], sw.pz[i]), up);
      tear.bite(sw.px[i], sw.py[i], sw.pz[i], p.x, p.z);
    });
  draw!.update(dt);
  tear.update(dt);
  lab.hud("robots", `robots ${sw.count} up · clinging ${sw.latchedCount} · destroyed ${target.kills}`);
});
