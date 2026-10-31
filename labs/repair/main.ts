// Repair lab (Keith 2026-10-31: health UI, a repair kit on Q, abilities that put down heal zones; co-op healers
// later). Your mech stands on the dunes with a turret ahead chipping at it; the vitals HUD shows the hull, the damage
// ghost, the red edge and the hit arcs. Q uses a repair kit; keys 3 and 4 the abilities your pack and hull bring:
// by default a Medic pack (Repair beacon, thrown at the cursor) and a Salvager hull (Nanite field round you).
// Flags: ?hurt=0.4 (start at 40% hull), ?kits=N, ?ability=beacon|nanite|weld (fit just that one: Medic pack,
// Salvager or Siege hull), ?ally (a friendly mech parked 10 m off at 15% hull), ?chip=dps (the turret's damage per
// second; 0 stops it), ?onfoot, plus the combat-lab flags. Until you take over, a demo stands, uses a kit below half
// hull and drops its zones when they're ready.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { MechUnit } from "../../src/game/mechUnit";
import { applyLoadout } from "../../src/game/loadoutApply";
import { defaultLoadout, resolve } from "../../src/items/loadout";
import { makeItem } from "../../src/items/generate";

const CHIP_DEFAULTS = { chipDps: 90, chipEvery: 0.25, chipDistance: 26 };
const CHIP_PARAMS: Param[] = [
  { key: "chipDps", label: "Chipper damage per second", min: 0, max: 600, step: 5, group: "Chipper", tip: "The test turret's damage on your mech (before armour)" },
  { key: "chipEvery", label: "Chipper: seconds between rounds", min: 0.05, max: 2, step: 0.05, group: "Chipper" },
  { key: "chipDistance", label: "Chipper distance (m)", min: 5, max: 60, step: 1, group: "Chipper" },
];

const params0 = new URLSearchParams(location.search);
let turret: THREE.Mesh | null = null;
let chipZ: number = CHIP_DEFAULTS.chipDistance, kitsLeft = 0;
const lab = await combatLab({
  id: "repair-lab",
  title: "Repair",
  defaults: CHIP_DEFAULTS,
  params: CHIP_PARAMS,
  topics: [{ id: "chipper", label: "Chipper", groups: ["Chipper"] }],
  selectables: [{ topic: "chipper", label: "Chipper turret", objects: () => (turret ? [turret] : []) }],
  // The demo stands still and aims at the turret (the onFrame below uses kits and zones for it).
  demo: () => ({ cmd: { x: 0, z: 0, sprint: false }, aim: { x: 0, y: 2, z: chipZ }, trigger: false }),
  report: () => ({ kits: kitsLeft }),
});
const { V, bf, player, field } = lab;

// The loadout: today's mech with a Medic pack and a Salvager hull, or just the asked-for ability.
const lo = defaultLoadout();
const which = params0.get("ability");
lo.pack = makeItem("pack-medic");
lo.hull = makeItem(which === "weld" ? "hull-siege" : which === "beacon" ? "hull-rampart" : "hull-salvager");
if (which === "nanite" || which === "weld") lo.pack = makeItem("pack-standin");
applyLoadout(player, resolve(lo));
if (params0.has("chip")) V.chipDps = Number(params0.get("chip")) || 0;
if (params0.has("kits")) { player.kits.count = 0; player.kits.restock(Number(params0.get("kits")) || 0); }
if (params0.has("hurt")) player.health = player.maxHealth * Math.max(0.01, Math.min(1, Number(params0.get("hurt"))));
lab.refresh();

// The chipper: a squat block ahead firing tracers at the mech (team 2: hits the player's team).
turret = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 2), new THREE.MeshStandardMaterial({ color: 0x5a4a3c }));
lab.app.scene.add(turret);
const from = new THREE.Vector3(), dir = new THREE.Vector3();
let chipT = 0, slot = 2;

// ?ally: a friendly mech (the player's team) parked off to the side, badly hurt, for the zones to heal.
let ally: MechUnit | null = null;
if (params0.has("ally")) {
  const b = await lab.loadRampart();
  ally = new MechUnit(bf, V, b, lab.toon, player.team, 30, false);
  lab.app.scene.add(b.root);
  b.paint(lab.toon, 0x6f8fb0);
  ally.paint = 0x6f8fb0;
  ally.uid = "ally";
  ally.ally = true;
  ally.reset(10, 2, 0);
  ally.health = ally.maxHealth * 0.15;
  lab.abilities.allies.push(ally);
}

lab.onFrame((dt) => {
  const tz = V.chipDistance;
  chipZ = tz;
  kitsLeft = player.kits.count;
  turret!.position.set(0, field.height(0, tz) + 0.7, tz);
  if (V.chipDps > 0 && player.alive) {
    chipT += dt;
    while (chipT >= V.chipEvery) {
      chipT -= V.chipEvery;
      from.set(turret!.position.x, turret!.position.y + 0.6, turret!.position.z);
      const p = player.sim.pelvis;
      dir.set(p.x - from.x + (Math.random() - 0.5) * 0.8, p.y - 0.5 - from.y, p.z - from.z).normalize();
      slot = slot >= 19 ? 2 : slot + 1;
      bf.fire(slot, 2, from, dir, tz + 30, V.chipDps * V.chipEvery, { flashScale: 0.5, voice: "other", hitScale: 0.5 });
    }
  }
  if (ally) ally.step(dt, { x: 0, z: 0, sprint: false }, null, false);
  // The demo: a kit below half hull, the zones whenever they're ready (the beacon at its feet).
  if (lab.demoOn() && player.alive) {
    if (player.health < player.maxHealth * 0.5) player.useKit();
    for (const s of player.abilities.slots) {
      if (s.cooldown > 0 || player.health > player.maxHealth * 0.8) continue;
      const p = player.sim.pelvis;
      player.abilities.use(s.key, { id: player.uid, team: player.team, x: p.x, z: p.z, alive: true }, p.x + 3, p.z + 3, lab.abilities.zones);
    }
    if (player.kits.count === 0 && player.health > player.maxHealth * 0.95) player.kits.restock(V.kitMax);
  }
  const ab = player.abilities.slots.map((s) => `${s.key} ${s.id} ${s.cooldown > 0 ? s.cooldown.toFixed(0) + " s" : "ready"}`).join(", ");
  lab.hud("repair", `kits ${player.kits.count}/${V.kitMax}${player.kits.progress !== null ? " (repairing)" : ""} · abilities: ${ab || "none"} · zones ${lab.abilities.zones.zones.length}${ally ? ` · ally hull ${Math.round(ally.health)}/${ally.maxHealth}` : ""}${player.abilities.braced > 0 ? " · braced" : ""}`);
});
