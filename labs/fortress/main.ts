// Fortress lab (Keith 2026-10-31, docs/proposal-fortresses.md): one bandit fortress (or a manufacturing hub) ahead of
// the mech on its levelled pad. Rings of sand-and-wreck wall nothing walks up; steel gates the only ways in, each with
// health; a garrison per yard (sentries on the walls, the rest at posts in the yard) that wakes a yard at a time;
// salvage in every yard and the vault in the keep (E to strip). Blow a gate, fight through the yard, on to the next.
//
// Flags: ?kind=fortress|hub, ?seed=N (the layout), ?ring=N (start in yard N with the gates out to it down),
// ?gates=open (every gate down from the start), ?near (start just outside the outer wall), plus the combat-lab flags
// (?manual, ?zoom, ?dt, ?flat, ?left= ?right= ?k1-3= for the weapons). Shift+R puts it all back up. The demo (until you
// take over) shoots the nearest gate down from 30 m and walks in.
import "../../src/core/lab.css";
import { combatLab, type CombatLab } from "../../src/game/combatLab";
import { POI_DEFAULTS, POI_PARAMS, PoiField, type PoiKind, type PoiPlacement } from "../../src/world/pois";
import { PoiPads, rawGround } from "../../src/world/poiPads";
import { addModifier } from "../../src/world/modifiers";
import { SiegeWalls } from "../../src/pois/fortressGround";
import { SITE_DEFAULTS, KIND_PARAMS, buildSite } from "../../src/pois/kinds";
import { PoiDraw } from "../../src/pois/poiDraw";
import { SalvageSim, SALVAGE_DEFAULTS, SALVAGE_PARAMS } from "../../src/pois/salvage";
import { SalvageDraw, SALVAGE_FX_DEFAULTS, SALVAGE_FX_PARAMS } from "../../src/pois/salvageDraw";
import { SalvageHud } from "../../src/pois/salvageHud";
import { Fortresses, FORT_LIFE_DEFAULTS, FORT_LIFE_PARAMS } from "../../src/expedition/fortresses";
import type { GateState } from "../../src/pois/gates";
import { Warlord } from "../../src/expedition/warlord";
import { MechUnit } from "../../src/game/mechUnit";
import { INFANTRY_DEFAULTS, INFANTRY_PARAMS } from "../../src/combat/infantry";
import { BANDIT_LOOK_DEFAULTS, BANDIT_LOOK_PARAMS } from "../../src/combat/infantryDraw";
import { loadBanditVat } from "../../src/combat/banditVat";
import { BodyContact } from "../../src/game/bodyContact";

const params = new URLSearchParams(location.search);
const KIND: PoiKind = params.get("kind") === "hub" ? "hub" : "fortress";
const SEED = Number(params.get("seed") ?? 3) >>> 0;
/** The fortress's centre: straight ahead, its outer wall a little past the wake distance. */
const CZ = 250;

const LAB_DEFAULTS = { ...POI_DEFAULTS, ...SITE_DEFAULTS, ...SALVAGE_DEFAULTS, ...SALVAGE_FX_DEFAULTS, ...FORT_LIFE_DEFAULTS, ...INFANTRY_DEFAULTS, ...BANDIT_LOOK_DEFAULTS };
const LAYOUT_KEYS = new Set([...KIND_PARAMS.fortress, ...KIND_PARAMS.hub, ...POI_PARAMS].map((p) => p.key));

let pois!: PoiField;
let walls!: SiegeWalls;
let pads!: PoiPads;
let place!: PoiPlacement;
let drawn: PoiDraw | null = null;
let forts: Fortresses | null = null;
let salvageDraw: SalvageDraw | null = null;

const lab: CombatLab<typeof LAB_DEFAULTS> = await combatLab<typeof LAB_DEFAULTS>({
  id: "fortress-lab",
  title: KIND === "hub" ? "Manufacturing hub" : "Bandit fortress",
  defaults: LAB_DEFAULTS,
  params: [...KIND_PARAMS.fortress, ...KIND_PARAMS.hub, ...FORT_LIFE_PARAMS, ...POI_PARAMS.filter((p) => p.group === "Pads"), ...SALVAGE_PARAMS, ...SALVAGE_FX_PARAMS, ...INFANTRY_PARAMS, ...BANDIT_LOOK_PARAMS],
  topics: [
    { id: "fortress", label: "Fortress", groups: ["Fortress: layout", "Fortress: salvage", "Fortress: gates", "Fortress: garrison", "Fortress: warlord", "Pads"] },
    { id: "hub", label: "Manufacturing hub", groups: ["Manufacturing hub: layout", "Manufacturing hub: salvage", "Pads"] },
    { id: "bandits", label: "Bandits", groups: ["Fortress: garrison", "Bandits", "Bandits: guns", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: dodge", "Bandits: look"] },
    { id: "salvage", label: "Salvage", groups: ["Salvage", "Salvage: look"] },
  ],
  selectables: [
    { topic: KIND === "hub" ? "hub" : "fortress", label: KIND === "hub" ? "Hub walls and towers" : "Walls and yards", objects: () => drawn?.meshes ?? [] },
    { topic: "fortress", label: "Gates", objects: () => forts?.gatesDraw.meshes() ?? [] },
    { topic: "bandits", label: "Garrison", objects: () => forts ? [forts.draw.group] : [] },
    { topic: "salvage", label: "Salvage spots", objects: () => salvageDraw?.objects() ?? [] },
  ],
  actions: [{ label: "Put it back up (Shift+R)", onClick: () => restart() }],
  report: () => ({ kind: KIND, seed: SEED, scrap: salvage.scrap, gatesDown: [...walls.down] }),
  setup: (field, V) => {
    // Only the hand-placed one: nothing generated (the chances off on the field's own copy).
    pois = new PoiField({ ...V, poiChance: 0, bigChance: 0 }, rawGround(field));
    pads = new PoiPads(pois);
    addModifier(field, pads);
    walls = new SiegeWalls(pois, V);
    addModifier(field, walls);
    placeIt(V);
  },
  onChange: (k) => { if (LAYOUT_KEYS.has(k)) rebuild(); },
  // The demo: stand off the nearest standing gate and shoot it down, then walk in through the gap (null: the shared demo).
  demo: () => gateDemo(),
});
const { V, field, bf, player, arsenal } = lab;

function placeIt(v: typeof V) {
  pois.v = { ...v, poiChance: 0, bigChance: 0 };
  pois.extra.length = 0;
  place = pois.placeAt(`lab:${KIND}`, KIND, 0, CZ, 0.4, SEED * 7919 + 13);
  pois.extra.push(place);
  pads.reindex();
  walls.reset();
}

// ---- the site: walls' wreckage, yards, salvage ----
const salvage = new SalvageSim(V);
const sd = new SalvageDraw(salvage, bf, V);
salvageDraw = sd;
lab.app.scene.add(sd.group);
const hud = new SalvageHud(salvage);
salvage.onDone = (s) => sd.burst(s);
salvage.onBanked = (s) => hud.banked(s);
salvage.onNoise = (x, z, r) => { sd.pulse(x, z); forts?.noise(x, z, r); };
function buildIt() {
  if (drawn) { salvage.remove(place.id); drawn.dispose(); }
  const site = buildSite(place, V);
  drawn = new PoiDraw(site, field);
  lab.app.scene.add(drawn.group);
  salvage.add(site);
}

// ---- the garrison and the gates ----
const vat = await loadBanditVat().catch((e) => { console.warn("bandit bake not loaded, boxes instead:", e); return null; });
forts = new Fortresses(V, field, bf, lab.app.scene, walls, player, vat, () => [place],
  (x0, z0, x1, z1) => lab.streamer.rebuildArea(x0, z0, x1, z1));
const F = forts;
bf.register.add(F.target);
// The keep's warlord: a dark red Rampart (src/expedition/warlord.ts); killed, a burst of drops (the lab just notes it).
{
  const wb = await lab.loadRampart();
  const wl = new MechUnit(bf, V, wb, lab.toon, 2, 20, false);
  wl.paint = 0x8e2a1e;
  wb.paint(lab.toon, 0x8e2a1e);
  const w = new Warlord(V, bf, lab.app.scene, wl);
  F.warlord = w;
  bf.register.add(w);
  w.onEvent = (e) => { if (e.type === "warlordDown") { warlordKills++; lab.shake(0.8); } };
}
const contact = new BodyContact(player, bf);
player.onDash = (x, z, dx, dz) => { F.dashed(x, z, dx, dz, V.dashShoveRadius, V.dashShove, V.dashShoveDamage); };
let downs = 0, warlordKills = 0;
F.onGate = (e) => { if (e.type === "gateDown") { downs++; lab.shake(0.6); } };

function rebuild() {
  placeIt(V);
  buildIt();
  startPose();
}
function restart() {
  for (const s of salvage.spots) { s.progress = 0; s.done = false; }
  for (const sec of salvage.sections) sec.banked = false;
  startPose();
}

/** Where the mech starts: ?ring=N inside yard N (gates out to it down), ?near at the outer wall, else well outside. */
function startPose() {
  // Everything back up, then the gates the flags ask for down before the garrison and the gates stream in.
  F.reset();
  const L = walls.layout(place), rings = L.rings;
  const ringN = params.has("ring") ? Math.max(0, Math.min(rings.length - 1, Number(params.get("ring")))) : -1;
  if (params.get("gates") === "open") for (const r of rings) for (const g of r.gates) walls.down.add(g.id);
  for (let k = 0; k < ringN + 1 && k < rings.length; k++) for (const g of rings[k].gates) walls.down.add(g.id);
  lab.streamer.rebuildAll();
  player.reset(0, 0, 0);
  F.update(0, false);
  if (ringN >= 0) {
    // Just inside the first gate of ring N, facing in.
    const g = rings[ringN].gates[0], d = rings[ringN].r - rings[ringN].top - rings[ringN].face - 6;
    const x = place.x + Math.sin(g.a) * d, z = place.z + Math.cos(g.a) * d;
    player.reset(x, z, g.a + Math.PI);
  } else if (params.has("near")) {
    const g = rings[0].gates[0], d = rings[0].r + 25;
    player.reset(place.x + Math.sin(g.a) * d, place.z + Math.cos(g.a) * d, g.a + Math.PI);
  } else player.reset(0, 0, 0);
}

buildIt();
startPose();

/** Shoot the nearest standing gate from about 30 m, both guns; once it's down, walk through toward the centre. */
let demoGate: GateState | null = null;
function gateDemo() {
  if (!forts) return null;
  const p = player.sim.pelvis;
  if (!demoGate || demoGate.down) {
    demoGate = null;
    let bd = Infinity;
    for (const s of forts.gates.list) if (!s.down) { const d = Math.hypot(s.gate.x - p.x, s.gate.z - p.z); if (d < bd) { bd = d; demoGate = s; } }
    if (demoGate && bd > 120) demoGate = null;
  }
  const g = demoGate;
  if (!g) {
    const dx = place.x - p.x, dz = place.z - p.z, d = Math.hypot(dx, dz) || 1;
    return { cmd: { x: dx / d, z: dz / d, sprint: false }, aim: null, trigger: false };
  }
  // Stand on the gate's outer side (the side the mech is on), 30 m off.
  const ux = Math.sin(g.gate.a), uz = Math.cos(g.gate.a), side = Math.sign((p.x - g.gate.x) * ux + (p.z - g.gate.z) * uz) || 1;
  const sx = g.gate.x + ux * side * 30, sz = g.gate.z + uz * side * 30;
  const dx = sx - p.x, dz = sz - p.z, d = Math.hypot(dx, dz);
  const cmd = d > 3 ? { x: dx / d, z: dz / d, sprint: false } : { x: 0, z: 0, sprint: false };
  return { cmd, aim: { x: g.gate.x, y: g.floor + g.ring.h * 0.45, z: g.gate.z }, trigger: [d < 12, d < 12] as const };
}

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === "KeyE") eHeld = true;
  if (e.code === "KeyR" && !e.repeat && e.shiftKey) restart();
});
addEventListener("keyup", (e) => { if (e.code === "KeyE") eHeld = false; });
addEventListener("blur", () => { eHeld = false; });
let eHeld = false;

lab.onFrame((dt) => {
  const p = player.sim.pelvis;
  salvage.update(dt, p.x, p.z, eHeld && player.alive && !lab.demoOn());
  sd.update(dt, lab.app.camera, p.x, p.z);
  hud.update(dt);
  F.mechReach = contact.body.reach;
  contact.step(dt);
  F.sw.dodge(contact.threats(arsenal, bf.shells, V));
  contact.infantry(F.sw, F.target);
  F.update(dt, player.alive, lab.prey(p.x, p.z));
  const f = F.live.get(place.id);
  const yards = f ? f.yards.map((y, k) => `${["outer", "inner", "keep"][f.yards.length === 2 && k === 1 ? 2 : k]} ${F.aliveIn(place.id, k)} ${y.state}`).join(" · ") : "not streamed";
  const gates = F.gates.list.map((s) => (s.down ? "down" : Math.round(s.hp))).join(" / ");
  lab.hud("fortress", `${KIND} seed ${SEED} · ${yards} · gates ${gates} (${downs} blown) · warlord ${F.warlord?.unit ? (F.warlord.unit.alive ? `${Math.round(F.warlord.unit.health)} hp${F.warlord.awake ? " awake" : ""}` : "down") : "-"}${warlordKills ? ` (${warlordKills} killed)` : ""} · scrap ${salvage.scrap} · shift+R: put it back up`);
});
