// War band lab (Keith 2026-10-24): the player's Rampart against a raider war band on the dunes. Pickups with
// machine guns and bigger gun trucks circle the mech and make gun runs a few at a time; bandit mechs (red Ramparts)
// hold off and trade fire. The mech takes damage and is rebuilt a few seconds after it's destroyed. Each band beaten
// brings the next. Until you take over, a demo walks, aims at the nearest raider and fires.
// Keith 2026-10-29: the tank is gone (bandits are scrappy salvage): a turret truck carries a salvaged tank turret; and
// a party bus, lit up and blaring music, brakes every so often and lets a wave of bandits out of its back door (the
// bandit swarm, baked Vanguard and all), until it's destroyed.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { InfantrySwarm, INFANTRY_DEFAULTS, INFANTRY_PARAMS, DEAD } from "../../src/combat/infantry";
import { InfantryDraw, BANDIT_LOOK_DEFAULTS, BANDIT_LOOK_PARAMS, CLOTH } from "../../src/combat/infantryDraw";
import { loadBanditVat } from "../../src/combat/banditVat";
import { InfantryTarget } from "../../src/combat/infantryTarget";
import { BANDIT_PARTS, BANDIT_JOINTS } from "../../src/physics/bodies";
import { MechUnit } from "../../src/game/mechUnit";
import type { RampartBody } from "../../src/mech/rampart";
import { Warband, WARBAND_DEFAULTS, WARBAND_PARAMS } from "../../src/combat/warband";

const RED = 0xc4523f;
// The bus's bandits on foot: their rounds, how many draw a tracer, how far a stomp reaches.
const RIDER_DEFAULTS = { banditDamage: 0.6, riderTracers: 0.15, riderStomp: 2.4 };
const RIDER_PARAMS: Param[] = [
  { key: "banditDamage", label: "Bus bandits: damage per round", min: 0, max: 10, step: 0.05, group: "Party bus" },
  { key: "riderTracers", label: "Bus bandits: share of rounds drawn", min: 0, max: 1, step: 0.01, group: "Party bus" },
  { key: "riderStomp", label: "Bus bandits: stomp reach (m)", min: 0, max: 6, step: 0.1, group: "Party bus" },
];
let warband: Warband | null = null;
let riderDraw: InfantryDraw | null = null;
const lab = await combatLab({
  id: "warband-lab",
  title: "War band",
  defaults: { ...WARBAND_DEFAULTS, ...INFANTRY_DEFAULTS, ...BANDIT_LOOK_DEFAULTS, ...RIDER_DEFAULTS },
  params: [...WARBAND_PARAMS, ...RIDER_PARAMS, ...INFANTRY_PARAMS, ...BANDIT_LOOK_PARAMS],
  topics: [
    { id: "raiders", label: "Raiders", groups: ["War band", "Raider driving", "Raider guns", "Raider health", "Raider wrecks"] },
    { id: "bus", label: "Party bus", groups: ["Party bus", "Bandits", "Bandits: guns", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: look"] },
  ],
  selectables: [{
    topic: "raiders", label: "Raiders",
    objects: () => warband ? [...warband.raiders.filter((r) => r.kind !== "partyBus").flatMap((r) => r.body.meshes()), ...warband.mechs.flatMap((m) => (m.body as RampartBody).regions().hull)] : [],
  }, {
    topic: "bus", label: "Party bus and its bandits",
    objects: () => [...(warband ? warband.raiders.filter((r) => r.kind === "partyBus").flatMap((r) => r.body.meshes()) : []), ...(riderDraw ? [riderDraw.mesh] : [])],
  }],
  actions: [{ label: "Next band", onClick: () => warband?.spawn(lab.player.sim.pelvis) }],
  report: () => ({ band: warband?.waves ?? 0 }),
});
const { V, bf, toon, player } = lab;

// Bandit mechs: red Ramparts, loaded ahead so a band can field them at once.
const spare: MechUnit[] = [];
for (let i = 0; i < 2; i++) {
  const b = await lab.loadRampart();
  const m = new MechUnit(bf, V, b, toon, 2, 20 + i * 2, false);
  m.paint = RED;
  b.paint(toon, RED);
  spare.push(m);
}
const wb: Warband = new Warband(bf, V, (): MechUnit | null => spare.find((m) => !wb.mechs.includes(m)) ?? null, lab.deaths);
warband = wb;
lab.app.scene.add(wb.group);

// The party bus's bandits: one infantry swarm (seeded), drawn as the baked Vanguard, stomped and dashed through, dying
// as ragdolls, in the register for the soft lock.
const riders = new InfantrySwarm(V, lab.field, 41);
wb.riders = riders;
const vat = await loadBanditVat().catch((e) => { console.warn("bandit bake not loaded, boxes instead:", e); return null; });
riderDraw = new InfantryDraw(riders, V, vat);
lab.app.scene.add(riderDraw.group);
const riderTarget = new InfantryTarget(riders, 2);
bf.targets.push(riderTarget);
bf.register.add(riderTarget);
player.onStomp = (x, z, k) => riders.stomp(x, z, V.riderStomp * Math.min(1.5, k));
player.onDash = (x, z, dx, dz) => { riders.shove(x, z, V.dashShoveRadius, dx, dz, V.dashShove, V.dashShoveDamage); };
riders.hideDead = true;
riders.onDeath = (i, nx, nz, speed) => {
  lab.deaths.ragdoll(BANDIT_PARTS(CLOTH[riders.look[i] & 3]), BANDIT_JOINTS, riders.px[i], riders.py[i], riders.pz[i], riders.heading[i],
    { x: riders.vx[i] * 0.3, y: 0, z: riders.vz[i] * 0.3 }, nx, nz, speed);
};
const from = new THREE.Vector3(), dir = new THREE.Vector3();
let slot = 2;

// Into the register for the soft lock and the weapons: raiders and bandit mechs.
bf.register.add({ name: "warband", publish: (r) => wb.publish(r) });
lab.onFrame((dt) => {
  // The band goes for the mech, or the pilot on foot when he's nearer to it (src/pilot/quarry.ts).
  let cx = 0, cz = 0, n = 0;
  for (const r of wb.raiders) if (r.alive) { cx += r.sim.pos.x; cz += r.sim.pos.z; n++; }
  wb.update(dt, n ? lab.prey(cx / n, cz / n) : player);
  // The bus's bandits run at whoever is nearer them and shoot.
  let rx = 0, rz = 0, rn = 0;
  for (let i = 0; i < riders.hi; i++) if (riders.state[i] < DEAD) { rx += riders.px[i]; rz += riders.pz[i]; rn++; }
  const prey = rn ? lab.prey(rx / rn, rz / rn) : lab.prey(player.sim.pos.x, player.sim.pos.z);
  const p = prey.at;
  riders.update(dt, { x: p.x, y: p.y, z: p.z, radius: prey.kind === "pilot" ? 1 : 3 }, (fx, fy, fz, tx, ty, tz) => {
    if (!prey.alive) return;
    from.set(fx, fy, fz);
    if (!bf.canSee(from, p)) return;
    dir.set(tx - fx, ty - fy, tz - fz).normalize();
    const drawn = Math.random() < V.riderTracers;
    if (drawn) slot = slot >= 19 ? 2 : slot + 1;
    bf.fire(slot, 2, from, dir, V.fireRange + 5, V.banditDamage, drawn ? { flashScale: 0.35, voice: "other", hitScale: 0.3 } : { tracer: false, voice: "none" });
  });
  riderDraw!.update(dt);
  const live = wb.raiders.filter((r) => r.alive).length;
  const buses = wb.raiders.filter((r) => r.kind === "partyBus");
  const busText = buses.map((b) => `${b.alive ? Math.round(b.hp) + " hp" : "wrecked"}, ${b.crew!.alive(riders)} of its ${b.crew!.dropped} out`).join("; ");
  lab.hud("band", `band ${wb.waves} · raiders ${live} live, ${wb.raiders.length - live} wrecked · bandit mechs ${wb.mechs.filter((m) => m.alive).length}${buses.length ? ` · party bus: ${busText}` : ""} · on foot ${riders.count}`);
});
