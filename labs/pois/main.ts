// POI lab (docs/proposal-pois.md, step 1): one of each tier 1-2 kind in a ring near the start (a rock outcrop with
// scrap caught in it, a lone wreck part, a crashed supply pod, a debris field, a dead convoy), the generated POIs of
// the pure placement further out, and salvage: walk the mech up to a marker and hold E to strip it (sparks, bits,
// loud), scrap counting up on the HUD. The picker (Kind) puts the mech beside the next kind; M (or ?view=map) shows
// the overhead map of the placement over a few km. Until you take over, the demo walks to spots and strips them.
//
// Flags: ?kind=outcrop|wreckPart|supplyPod|debrisField|deadConvoy (start beside it), ?strip (start in reach of its
// first spot), ?view=map, plus the combat lab flags (?manual, ?zoom, ?dt, ?flat).
import "../../src/core/lab.css";
import { combatLab, type CombatLab } from "../../src/game/combatLab";
import { POI_DEFAULTS, POI_PARAMS, POI_KINDS, POI_KIND_LIST, PoiField, hash4, type PoiKind, type PoiPlacement } from "../../src/world/pois";
import { PoiPads, rawGround } from "../../src/world/poiPads";
import { addModifier } from "../../src/world/modifiers";
import { SITE_DEFAULTS, SITE_PARAMS, buildSite, kindGroup } from "../../src/pois/kinds";
import { PoiDraw } from "../../src/pois/poiDraw";
import { SalvageSim, SALVAGE_DEFAULTS, SALVAGE_PARAMS, type SpotState } from "../../src/pois/salvage";
import { SalvageDraw, SALVAGE_FX_DEFAULTS, SALVAGE_FX_PARAMS } from "../../src/pois/salvageDraw";
import { SalvageHud } from "../../src/pois/salvageHud";
import { MapView, MAP_DEFAULTS, MAP_PARAMS } from "../../src/pois/mapView";
import type { MoveCommand } from "../../src/mech/walker";

const params = new URLSearchParams(location.search);
const LAB_DEFAULTS = { ...POI_DEFAULTS, ...SITE_DEFAULTS, ...SALVAGE_DEFAULTS, ...SALVAGE_FX_DEFAULTS, ...MAP_DEFAULTS, showRing: 60, drawRadius: 900 };
const LAB_PARAMS = [
  ...POI_PARAMS, ...SITE_PARAMS, ...SALVAGE_PARAMS, ...SALVAGE_FX_PARAMS, ...MAP_PARAMS,
  { key: "showRing", label: "Showcase ring (m)", min: 30, max: 150, step: 1, group: "POI map", tip: "How far from the start the five showcase POIs sit", onRelease: true },
  { key: "drawRadius", label: "Draw POIs within (m)", min: 200, max: 3000, step: 50, group: "POI map", tip: "Generated POIs this close to the mech are built and drawn" },
];
const SHOW_CLEAR = 190;

let poiField!: PoiField;
let pads!: PoiPads;
let raw!: ReturnType<typeof rawGround>;
const drawn = new Map<string, PoiDraw>();
let salvageDraw: SalvageDraw | null = null;
let map: MapView | null = null;

const lab: CombatLab<typeof LAB_DEFAULTS> = await combatLab<typeof LAB_DEFAULTS>({
  id: "pois-lab",
  title: "Points of interest",
  defaults: LAB_DEFAULTS,
  params: LAB_PARAMS,
  topics: [
    { id: "pois", label: "POIs", groups: ["POI placement", "Pads", "POI map"] },
    { id: "salvage", label: "Salvage", groups: ["Salvage", "Salvage: look"] },
    ...POI_KIND_LIST.map((k) => ({ id: `poi-${k}`, label: POI_KINDS[k].label, groups: [kindGroup(k), "Salvage"] })),
  ],
  selectables: [
    ...POI_KIND_LIST.map((k) => ({ topic: `poi-${k}`, label: POI_KINDS[k].label, objects: () => [...drawn.values()].filter((d) => d.site.place.kind === k).flatMap((d) => d.meshes) })),
    { topic: "salvage", label: "Salvage spots", objects: () => salvageDraw?.objects() ?? [] },
  ],
  actions: [
    { label: "Kind ▸", onClick: () => focusKind(focus + 1, true) },
    { label: "Map (M)", onClick: () => map?.toggle(), active: () => !!map?.open },
    { label: "Restock", onClick: () => restock() },
  ],
  report: () => ({ scrap: salvage.scrap, focus: POI_KIND_LIST[focus] }),
  setup: (field, V) => {
    raw = rawGround(field);
    poiField = new PoiField(V, raw);
    poiField.keepClear = [{ x: 0, z: 0, r: SHOW_CLEAR }];
    placeShowcase();
    pads = new PoiPads(poiField);
    addModifier(field, pads);
  },
  demo: (_t, dt) => demo(dt),
  onChange: (k) => {
    if (POI_PARAMS.some((p) => p.key === k) || SITE_PARAMS.some((p) => p.key === k) || k === "showRing" || isDuneKey(k)) rebuildAll();
  },
});
const { V, field, bf, player, app } = lab;

function isDuneKey(k: string) { return ["seed", "windAngle", "spacing", "height", "slip", "flats", "meander", "warp", "breakup", "cross", "variety", "swell", "swellScale", "crestSoft", "bumps"].includes(k); }

/** One of each kind in a ring round the start. */
function placeShowcase() {
  const V = poiField.v as typeof LAB_DEFAULTS;
  poiField.extra.length = 0;
  POI_KIND_LIST.forEach((k, i) => {
    const a = (i / POI_KIND_LIST.length) * Math.PI * 2 + 0.35;
    const r = V.showRing + (POI_KINDS[k].tier === 2 ? 25 : 0);
    poiField.extra.push(poiField.placeAt(`show:${k}`, k, Math.sin(a) * r, Math.cos(a) * r, a + Math.PI / 2, hash4(V.poiSeed, i, 77, 5)));
  });
}

// ---- salvage ----
const salvage = new SalvageSim(V);
const memory = new Map<string, { progress: number; done: boolean }>();
salvageDraw = new SalvageDraw(salvage, bf, V);
app.scene.add(salvageDraw.group);
const hud = new SalvageHud(salvage);
let noises = 0;
salvage.onNoise = (x, z) => { noises++; salvageDraw?.pulse(x, z); };
salvage.onDone = (s) => salvageDraw?.burst(s);
salvage.onBanked = (s) => hud.banked(s);

function addSite(p: PoiPlacement) {
  const site = buildSite(p, V);
  // Ruts as lasting dents (a disc's radii: across and along its yaw), else decals.
  const dents = lab.bf.marks.denting ? lab.bf.dents! : null;
  const d = new PoiDraw(site, field, dents ? (r) => {
    const [rx, , rz] = r.size, along = rz >= rx;
    const w = Math.min(rx, rz), l = Math.max(rx, rz);
    dents.persist(p.id, r.x, r.z, w, r.yaw + (along ? 0 : Math.PI / 2), l / w, Math.min(0.2, 0.05 + 0.04 * w));
    return true;
  } : undefined);
  app.scene.add(d.group);
  drawn.set(p.id, d);
  salvage.add(site);
  for (const s of salvage.spots) {
    const m = s.poi === p.id ? memory.get(s.id) : undefined;
    if (m) { s.progress = m.progress; s.done = m.done; }
  }
}
function dropSite(id: string) {
  for (const s of salvage.spots) if (s.poi === id && (s.progress > 0 || s.done)) memory.set(s.id, { progress: s.progress, done: s.done });
  salvage.remove(id);
  drawn.get(id)?.dispose();
  drawn.delete(id);
  lab.bf.dents?.forget(id);
}
function syncSites() {
  const p = player.sim.pos, R = V.drawRadius;
  const want = poiField.poisIn(p.x - R, p.z - R, p.x + R, p.z + R);
  const ids = new Set(want.map((w) => w.id));
  for (const id of [...drawn.keys()]) if (!ids.has(id)) dropSite(id);
  for (const w of want) if (!drawn.has(w.id)) addSite(w);
}
function rebuildAll() {
  raw.refresh();
  poiField.reset();
  placeShowcase();
  pads.reindex();
  lab.streamer.rebuildAll();
  for (const id of [...drawn.keys()]) dropSite(id);
  memory.clear();
  map?.invalidate();
  syncSites();
}
function restock() {
  memory.clear();
  for (const s of salvage.spots) { s.progress = 0; s.done = false; }
  for (const sec of salvage.sections) sec.banked = false;
}

// ---- the picker: the mech beside a kind ----
let focus = Math.max(0, POI_KIND_LIST.indexOf((params.get("kind") ?? "") as PoiKind));
function focusPlace() { return poiField.extra[focus]; }
function focusKind(i: number, teleport: boolean) {
  focus = ((i % POI_KIND_LIST.length) + POI_KIND_LIST.length) % POI_KIND_LIST.length;
  target = null;
  if (!teleport) return;
  const p = focusPlace();
  // Stand on the side toward the start, outside its footprint, facing it.
  const d = Math.hypot(p.x, p.z) || 1, back = POI_KINDS[p.kind].footprint * 0.6 + 5;
  const x = p.x - (p.x / d) * back, z = p.z - (p.z / d) * back;
  player.reset(x, z, Math.atan2(p.x - x, p.z - z));
  syncSites();
}

// ---- E to strip ----
let eHeld = false;
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === "KeyE") eHeld = true;
  if (e.code === "KeyM" && !e.repeat) map?.toggle();
});
addEventListener("keyup", (e) => { if (e.code === "KeyE") eHeld = false; });
addEventListener("blur", () => { eHeld = false; });

// ---- demo: walk to the focused POI's spots and strip them, then on to the next kind ----
let target: SpotState | null = null;
let demoHold = false;
let idle = 0;
function demo(dt: number): { cmd: MoveCommand; aim: { x: number; y: number; z: number } | null; trigger: boolean } {
  const p = player.sim.pelvis;
  const id = focusPlace().id;
  if (!target || target.done || !salvage.spots.includes(target)) {
    target = null;
    let bd = Infinity;
    for (const s of salvage.spots) if (s.poi === id && !s.done) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; target = s; } }
  }
  if (!target) {
    // All stripped: wait a moment, restock it for next time and walk on to the next kind.
    demoHold = false;
    idle += dt;
    if (idle > 1.5) { idle = 0; for (const s of salvage.spots) if (s.poi === id) { s.progress = 0; s.done = false; } focusKind(focus + 1, false); }
    return { cmd: { x: 0, z: 0, sprint: false }, aim: null, trigger: false };
  }
  const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
  const stop = V.salvageReach * 0.55;
  demoHold = d < V.salvageReach * 0.95;
  const far = d > 40;
  const cmd = d > stop ? { x: dx / d, z: dz / d, sprint: far } : { x: 0, z: 0, sprint: false };
  return { cmd, aim: { x: target.x, y: field.height(target.x, target.z) + target.h, z: target.z }, trigger: false };
}

// ---- map ----
map = new MapView(poiField, field, V);
if (params.get("view") === "map") map.toggle(true);

// Start beside a kind if asked (and in reach of its first spot with ?strip).
syncSites();
if (params.has("kind")) focusKind(focus, true);
if (params.has("strip")) {
  const s = salvage.spots.find((q) => q.poi === focusPlace().id);
  if (s) {
    const d = Math.hypot(s.x, s.z) || 1, back = V.salvageReach * 0.5;
    const x = s.x - (s.x / d) * back, z = s.z - (s.z / d) * back;
    player.reset(x, z, Math.atan2(s.x - x, s.z - z));
  }
}

let syncT = 0;
lab.onFrame((dt) => {
  syncT -= dt;
  if (syncT <= 0) { syncT = 0.5; syncSites(); }
  const p = player.sim.pelvis;
  const holding = lab.demoOn() ? demoHold : eHeld;
  salvage.update(dt, p.x, p.z, holding && player.alive);
  salvageDraw!.update(dt, app.camera, p.x, p.z);
  hud.update(dt);
  map!.draw(p.x, p.z, p.x, p.z, player.sim.heading);
  const left = salvage.left(focusPlace().id);
  const banked = salvage.sections.filter((s) => s.banked).length;
  lab.hud("pois", `POIs drawn ${drawn.size} · focus ${POI_KINDS[POI_KIND_LIST[focus]].label} (${left} scrap left) · sections banked ${banked} · noise pulses ${noises}`);
});
