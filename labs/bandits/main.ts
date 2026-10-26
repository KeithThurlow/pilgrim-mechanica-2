// Bandit swarm lab (Keith 2026-10-24): a classic swarm on foot for the power fantasy. Bandits pour in over the dunes
// in groups, stop at range and shoot; the mech mows them down in swathes, stomps the ones that get close, and their
// nerve breaks when their friends drop around them. Most of their rounds resolve without a tracer (hundreds fire
// at once); every Nth draws one.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { InfantrySwarm, INFANTRY_DEFAULTS, INFANTRY_PARAMS, DEAD, INFANTRY_MAX } from "../../src/combat/infantry";
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
  rocketShare: 0.06,
  rocketEvery: 6,
  rocketSpeed: 16,
  rocketArc: 2.5,
  rocketRadius: 2.8,
  rocketDamage: 18,
  rocketLead: 0.5,
};
const WAVE_PARAMS: Param[] = [
  { key: "swarmSize", label: "Bandits on the field", min: 0, max: 1000, step: 10, group: "Bandit waves", tip: "Groups keep coming until this many are up" },
  { key: "groupSize", label: "Group size", min: 1, max: 200, step: 1, group: "Bandit waves" },
  { key: "groupEvery", label: "A group every (s)", min: 0.2, max: 30, step: 0.1, group: "Bandit waves" },
  { key: "spawnFrom", label: "They come from (m)", min: 30, max: 250, step: 5, group: "Bandit waves" },
  { key: "rocketShare", label: "Rocketeers (share)", min: 0, max: 0.5, step: 0.01, group: "Bandit rockets", tip: "Some bandits carry a launcher: a slow rocket whose landing spot is marked, so you can dash out" },
  { key: "rocketEvery", label: "A rocket every (s)", min: 1, max: 30, step: 0.5, group: "Bandit rockets" },
  { key: "rocketSpeed", label: "Rocket speed (m/s)", min: 4, max: 60, step: 1, group: "Bandit rockets" },
  { key: "rocketArc", label: "Rocket arc (m)", min: 0, max: 20, step: 0.5, group: "Bandit rockets" },
  { key: "rocketRadius", label: "Blast radius (m)", min: 0.5, max: 8, step: 0.1, group: "Bandit rockets" },
  { key: "rocketDamage", label: "Blast damage", min: 0, max: 200, step: 1, group: "Bandit rockets" },
  { key: "rocketLead", label: "Lead on a moving mech (0-1)", min: 0, max: 1.5, step: 0.05, group: "Bandit rockets", tip: "How much of your walk they aim ahead for; a dash isn't predicted" },
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
  topics: [{ id: "bandits", label: "Bandits", groups: ["Bandit waves", "Bandits", "Bandits: guns", "Bandit rockets", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: look"] }],
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

const rocketClock = new Float32Array(INFANTRY_MAX);
const from = new THREE.Vector3(), dir = new THREE.Vector3();
let groupClock = Infinity, slot = 2; // the first group comes at once
// Into the register for the soft lock and the weapons: every standing bandit.
bf.register.add(target);
let wadeTick = 0;
lab.onFrame((dt) => {
  groupClock += dt;
  if (sw.count < V.swarmSize && groupClock >= V.groupEvery) { groupClock = 0; spawnGroup(); }
  // The swarm goes for the mech, or the pilot on foot when he's nearer to it (src/pilot/quarry.ts).
  let cx = 0, cz = 0, n = 0;
  for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DEAD - 1) { cx += sw.px[i]; cz += sw.pz[i]; n++; }
  const prey = n ? lab.prey(cx / n, cz / n) : lab.prey(player.sim.pos.x, player.sim.pos.z);
  const p = prey.at;
  for (let i = 0; i < rocketClock.length; i++) rocketClock[i] -= dt;
  sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: prey.kind === "pilot" ? 1 : 3 }, (fx, fy, fz, tx, ty, tz, i) => {
    if (!prey.alive) return;
    from.set(fx, fy, fz);
    // Only with a clear line: no shooting through the dunes.
    if (!bf.canSee(from, p)) return;
    // Rocketeers (every Nth bandit by its slot) lob a slow rocket at where you'll be instead of the burst.
    if ((i * 0.618034) % 1 < V.rocketShare) {
      if (rocketClock[i] > 0) return;
      rocketClock[i] = V.rocketEvery * (0.8 + Math.random() * 0.4);
      const dist = Math.hypot(p.x - fx, p.z - fz), flight = dist / Math.max(1, V.rocketSpeed);
      const v = prey.sim.vel;
      bf.lob(2, from, p.x + v.x * flight * V.rocketLead, p.z + v.z * flight * V.rocketLead, flight, V.rocketArc, V.rocketRadius, V.rocketDamage);
      return;
    }
    dir.set(tx - fx, ty - fy, tz - fz).normalize();
    const drawn = Math.random() < V.tracerShare;
    if (drawn) slot = slot >= 19 ? 2 : slot + 1;
    bf.fire(slot, 2, from, dir, V.fireRange + 5, V.banditDamage, drawn ? { flashScale: 0.35, voice: "other", hitScale: 0.3 } : { tracer: false, voice: "none" });
  });
  // Wading: a sixth of the swarm a frame checks for water and leaves rings as it moves.
  if (bf.water) {
    wadeTick = (wadeTick + 1) % 6;
    for (let i = wadeTick; i < sw.hi; i += 6) {
      if (!(sw.state[i] < DEAD - 1)) continue;
      const sp = Math.hypot(sw.vx[i], sw.vz[i]);
      if (sp < 0.3 || Math.random() > sp * dt * 6 / Math.max(0.3, V.wakeEvery)) continue;
      if (bf.inWater(sw.px[i], sw.pz[i])) bf.water.ripple(sw.px[i], sw.pz[i], 0.3, 0.8);
    }
  }
  draw!.update(dt);
  lab.hud("bandits", `bandits ${sw.count} up · killed ${target.kills} · rounds at you ${sw.shots}`);
});
