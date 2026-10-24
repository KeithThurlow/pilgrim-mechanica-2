// Robot swarm lab (Keith 2026-10-24): autonomous terraforming machines swarming across the dunes, in three sizes.
// Most are small four-legged scrappers that scuttle any way: they pour in as a pack, leap onto the mech and cling on,
// tearing at its plating (sparks, scraps of plate, a grinding screech), until shot off, stomped off or shaken off at
// a run; a few hang back and shoot. Medium cutters walk in on four crab legs: some hold at range firing slugs, the
// rest close in, rear back with the saw spinning up and lunge. A few big excavators swing in from the side on four
// long excavator-arm legs, stop at range and fire heavy bursts from high up, and take a lot of killing.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { RobotSwarm, ROBOT_DEFAULTS, ROBOT_PARAMS, DOWN, LATCHED, BIG, MID, SMALL, robotCentre } from "../../src/combat/robots";
import { RobotsDraw } from "../../src/combat/robotsDraw";
import { RobotTarget } from "../../src/combat/robotTarget";
import { RobotTearFx, ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../../src/combat/robotTearFx";
import { robotRagdoll } from "../../src/physics/bodies";
import { YELLOW, YELLOW_DIRTY, GREY } from "../../src/combat/robotShapes";

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
  { key: "robotTracerShare", label: "Share of rounds drawn", min: 0, max: 1, step: 0.01, group: "Robot waves", tip: "Only this share of the small ones' rounds draw a tracer and sound; the rest still hit. Medium and big ones' rounds always show" },
  { key: "robotStompReach", label: "Stomp reach (m)", min: 0, max: 6, step: 0.1, group: "Robot waves", tip: "A footfall knocks off clingers and crushes small ones this close" },
];

let swarm: RobotSwarm | null = null;
let draw: RobotsDraw | null = null;
const lab = await combatLab({
  id: "robots-lab",
  title: "Robot swarm",
  defaults: { ...ROBOT_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...WAVE_DEFAULTS },
  params: [...WAVE_PARAMS, ...ROBOT_PARAMS, ...ROBOT_TEAR_PARAMS],
  topics: [{ id: "robots", label: "Robots", groups: ["Robot waves", "Robots", "Robots: attack", "Robots: tearing", "Robots: medium", "Robots: big ones"] }],
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
// Deaths go to the physics: the body and its leg parts fall apart loosely (small ones fly, walkers fold where they
// stand, excavators topple from height).
sw.hideDead = true;
const RAG = [[0x9a9c9e, 0x4a4d51], [YELLOW, YELLOW_DIRTY], [YELLOW, GREY]];
sw.onDeath = (i, nx, nz, speed) => {
  const kind = sw.kind[i], [body, leg] = RAG[kind];
  const { parts, joints } = robotRagdoll(sw, i, body, leg);
  lab.deaths.ragdoll(parts, joints, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
    { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, kind === SMALL ? Math.max(3, speed) : 1);
};
// Walkers' feet coming down kick up the sand (a bucket a lot, a medium foot a little); latched small ones tear at the
// plating, medium ones' saws bite.
sw.onFootfall = (i, x, y, z) => bf.dust.stomp(x, y, z, sw.kind[i] === BIG ? 0.5 : 0.12);
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
    c.r = Math.max(0.6, robotCentre(sw, i, c)); // the hub, or a walker's chassis
    out.push(c);
  }
  return out;
};
const SHOT = {
  [SMALL]: { flash: 0.35, hit: 0.3 },
  [MID]: { flash: 0.7, hit: 0.6 },
  [BIG]: { flash: 1.2, hit: 1 },
} as Record<number, { flash: number; hit: number }>;
lab.onFrame((dt) => {
  packClock += dt;
  if (sw.count < V.robotSwarmSize && packClock >= V.robotGroupEvery) { packClock = 0; spawnPack(); }
  const p = player.sim.pelvis;
  sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: 2, vx: player.sim.vel.x, vz: player.sim.vel.z },
    (fx, fy, fz, tx, ty, tz, kind) => {
      if (!player.alive) return;
      from.set(fx, fy, fz);
      if (!bf.canSee(from, p)) return;
      dir.set(tx - fx, ty - fy, tz - fz).normalize();
      const drawn = kind !== SMALL || Math.random() < V.robotTracerShare;
      if (drawn) slot = slot >= 19 ? 2 : slot + 1;
      const damage = kind === BIG ? V.robotBigShotDamage : kind === MID ? V.robotMidShotDamage : V.robotShotDamage;
      const look = SHOT[kind];
      bf.fire(slot, 3, from, dir, from.distanceTo(p) + 8, damage,
        drawn ? { flashScale: look.flash, voice: "other", hitScale: look.hit } : { tracer: false, voice: "none" });
    },
    (i, damage) => {
      if (!player.alive) return;
      player.damage(damage, bitePos.set(sw.px[i], sw.py[i], sw.pz[i]), up);
      tear.bite(sw.px[i], sw.py[i], sw.pz[i], p.x, p.z);
    },
    (_i, damage, x, y, z) => {
      if (!player.alive) return;
      // A saw strike: the damage plus a heavier spray of sparks and a torn plate where the blade bites the hull.
      player.damage(damage, bitePos.set(x, y, z), up);
      tear.bite(x, y, z, p.x, p.z);
      tear.bite(x, y, z, p.x, p.z);
    });
  draw!.update(dt);
  tear.update(dt);
  lab.hud("robots", `robots ${sw.count} up · clinging ${sw.latchedCount} · saw strikes ${sw.cuts} · destroyed ${target.kills}`);
});
