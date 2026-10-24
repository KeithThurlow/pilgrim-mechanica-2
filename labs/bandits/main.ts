// Bandit swarm lab (Keith 2026-10-24): a classic swarm on foot for the power fantasy. Bandits pour in over the dunes
// in groups, stop at range and shoot; the mech mows them down in swathes, stomps the ones that get close, and their
// nerve breaks when their friends drop around them. Most of their rounds resolve without a tracer (hundreds fire
// at once); every Nth draws one.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { InfantrySwarm, INFANTRY_DEFAULTS, INFANTRY_PARAMS, DEAD } from "../../src/combat/infantry";
import { InfantryDraw, BANDIT_LOOK_DEFAULTS, BANDIT_LOOK_PARAMS, CLOTH } from "../../src/combat/infantryDraw";
import { loadBanditVat } from "../../src/combat/banditVat";
import { InfantryTarget } from "../../src/combat/infantryTarget";
import { BANDIT_PARTS, BANDIT_JOINTS } from "../../src/physics/bodies";

const WAVE_DEFAULTS = {
  swarmSize: 300,
  groupSize: 40,
  groupEvery: 3,
  spawnFrom: 90,
  banditDamage: 0.6,
  tracerShare: 0.3,
  stompReach: 2.4,
};
const WAVE_PARAMS: Param[] = [
  { key: "swarmSize", label: "Bandits on the field", min: 0, max: 1000, step: 10, group: "Bandit waves", tip: "Groups keep coming until this many are up" },
  { key: "groupSize", label: "Group size", min: 1, max: 200, step: 1, group: "Bandit waves" },
  { key: "groupEvery", label: "A group every (s)", min: 0.2, max: 30, step: 0.1, group: "Bandit waves" },
  { key: "spawnFrom", label: "They come from (m)", min: 30, max: 250, step: 5, group: "Bandit waves" },
  { key: "banditDamage", label: "Damage per bandit round", min: 0, max: 20, step: 0.1, group: "Bandit waves" },
  { key: "tracerShare", label: "Share of rounds drawn", min: 0, max: 1, step: 0.01, group: "Bandit waves", tip: "Hundreds fire at once: only this share draw a tracer and make a sound; the rest still hit" },
  { key: "stompReach", label: "Stomp reach (m)", min: 0, max: 6, step: 0.1, group: "Bandit waves", tip: "A footfall knocks down or kills bandits this close" },
];

let swarm: InfantrySwarm | null = null;
let draw: InfantryDraw | null = null;
const lab = await combatLab({
  id: "bandits-lab",
  title: "Bandit swarm",
  defaults: { ...INFANTRY_DEFAULTS, ...WAVE_DEFAULTS, ...BANDIT_LOOK_DEFAULTS },
  params: [...WAVE_PARAMS, ...INFANTRY_PARAMS, ...BANDIT_LOOK_PARAMS],
  topics: [{ id: "bandits", label: "Bandits", groups: ["Bandit waves", "Bandits", "Bandits: guns", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: look"] }],
  selectables: [{ topic: "bandits", label: "Bandits", objects: () => (draw ? [draw.mesh] : []) }],
  actions: [{ label: "Group now", onClick: () => spawnGroup() }],
  report: () => ({ bandits: swarm?.count ?? 0 }),
});
const { V, bf, player, field } = lab;
const sw = new InfantrySwarm(V, field);
// A dash ploughs through them.
player.onDash = (x, z, dx, dz) => { if (sw.shove(x, z, V.dashShoveRadius, dx, dz, V.dashShove, V.dashShoveDamage)) bf.sfx.play("brap", player.sim.pelvis, 0.6, 0.6, false); };
swarm = sw;
// Vanguard baked to an animation texture (Keith 2026-10-24); boxes if it fails to load.
const vat = await loadBanditVat().catch((e) => { console.warn("bandit bake not loaded, boxes instead:", e); return null; });
draw = new InfantryDraw(sw, V, vat);
lab.app.scene.add(draw.group);
const target = new InfantryTarget(sw, 2);
bf.targets.push(target);
player.onStomp = (x, z, k) => sw.stomp(x, z, V.stompReach * Math.min(1.5, k));
// Deaths go to the physics as ragdolls (Keith 2026-10-24), in the bandit's cloth colour.
sw.hideDead = true;
sw.onDeath = (i, nx, nz, speed) => {
  lab.deaths.ragdoll(BANDIT_PARTS(CLOTH[sw.look[i] & 3]), BANDIT_JOINTS, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
    { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, speed);
};

function spawnGroup() {
  const a = Math.random() * Math.PI * 2;
  const p = player.sim.pos;
  sw.spawn(Math.round(V.groupSize), p.x + Math.sin(a) * V.spawnFrom, p.z + Math.cos(a) * V.spawnFrom, 4 + Math.sqrt(V.groupSize));
}

const from = new THREE.Vector3(), dir = new THREE.Vector3();
let groupClock = Infinity, slot = 2; // the first group comes at once
lab.targets = () => {
  const out: TargetCandidate[] = [];
  for (let i = 0; i < sw.hi; i++) {
    if (sw.state[i] >= DEAD - 1) continue; // skip down, dead, empty
    out.push({ x: sw.px[i], y: sw.py[i] + V.banditHeight * 0.55, z: sw.pz[i], r: Math.max(0.6, V.banditRadius), key: i });
  }
  return out;
};
lab.onFrame((dt) => {
  groupClock += dt;
  if (sw.count < V.swarmSize && groupClock >= V.groupEvery) { groupClock = 0; spawnGroup(); }
  const p = player.sim.pelvis;
  sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: 3 }, (fx, fy, fz, tx, ty, tz) => {
    if (!player.alive) return;
    from.set(fx, fy, fz);
    // Only with a clear line: no shooting through the dunes.
    if (!bf.canSee(from, p)) return;
    dir.set(tx - fx, ty - fy, tz - fz).normalize();
    const drawn = Math.random() < V.tracerShare;
    if (drawn) slot = slot >= 19 ? 2 : slot + 1;
    bf.fire(slot, 2, from, dir, V.fireRange + 5, V.banditDamage, drawn ? { flashScale: 0.35, voice: "other", hitScale: 0.3 } : { tracer: false, voice: "none" });
  });
  draw!.update(dt);
  lab.hud("bandits", `bandits ${sw.count} up · killed ${target.kills} · rounds at you ${sw.shots}`);
});
