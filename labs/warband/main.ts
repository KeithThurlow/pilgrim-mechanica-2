// War band lab (Keith 2026-10-24): the player's Rampart against a raider war band on the dunes. Pickups with
// machine guns and bigger gun trucks circle the mech and make gun runs a few at a time; bandit mechs (red Ramparts)
// hold off and trade fire. The mech takes damage and is rebuilt a few seconds after it's destroyed. Each band beaten
// brings the next. Until you take over, a demo walks, aims at the nearest raider and fires.
import "../../src/core/lab.css";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { MechUnit } from "../../src/game/mechUnit";
import type { RampartBody } from "../../src/mech/rampart";
import { Warband, WARBAND_DEFAULTS, WARBAND_PARAMS } from "../../src/combat/warband";

const RED = 0xc4523f;
let warband: Warband | null = null;
const lab = await combatLab({
  id: "warband-lab",
  title: "War band",
  defaults: WARBAND_DEFAULTS,
  params: WARBAND_PARAMS,
  topics: [{ id: "raiders", label: "Raiders", groups: ["War band", "Raider driving", "Raider guns", "Raider health", "Raider wrecks"] }],
  selectables: [{
    topic: "raiders", label: "Raiders",
    objects: () => warband ? [...warband.raiders.flatMap((r) => r.body.meshes()), ...warband.mechs.flatMap((m) => (m.body as RampartBody).regions().hull)] : [],
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

lab.targets = () => {
  const out: TargetCandidate[] = [];
  for (const r of wb.raiders) if (r.alive) out.push({ x: r.sim.pos.x, y: r.centreY, z: r.sim.pos.z, r: r.shape.radius + 0.5, key: r, vx: r.sim.vel.x, vz: r.sim.vel.z });
  for (const m of wb.mechs) if (m.alive) out.push({ x: m.sim.pelvis.x, y: m.sim.pelvis.y + 0.6, z: m.sim.pelvis.z, r: V.hitRadius, key: m, vx: m.sim.vel.x, vz: m.sim.vel.z });
  return out;
};
lab.onFrame((dt) => {
  // The band goes for the mech, or the pilot on foot when he's nearer to it (src/pilot/quarry.ts).
  let cx = 0, cz = 0, n = 0;
  for (const r of wb.raiders) if (r.alive) { cx += r.sim.pos.x; cz += r.sim.pos.z; n++; }
  wb.update(dt, n ? lab.prey(cx / n, cz / n) : player);
  const live = wb.raiders.filter((r) => r.alive).length;
  lab.hud("band", `band ${wb.waves} · raiders ${live} live, ${wb.raiders.length - live} wrecked · bandit mechs ${wb.mechs.filter((m) => m.alive).length}`);
});
