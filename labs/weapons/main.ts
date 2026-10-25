// Weapons lab (docs/proposal-weapons.md, Keith 2026-10-25): a firing range for the new weapons, each with its own
// targeting. A line and a column of plywood cutouts, a row of steel posts (one sliding), trucks driving a slow loop to
// lead, a dune across the range with cutouts behind it for the mortar. The picker fits weapons through the loadout
// (so this is the mech the bay builds): guns (miniguns, a rail cannon on the hull, a pair, Light rails in the hands,
// autocannons) and the back mount (drums, the line rocket pod, the mortar). Left button: the guns (a rail cannon
// charges while held and fires on release). Right button: hold to paint the back weapon's strip or ring, release fires.
// The HUD shows damage per second on the range and what the last shot of each weapon did.
//
// URL flags (for shots): ?guns=minigun|rail|rails|lightrails|autocannon, ?back=drums|salvo|mortar,
// ?aimhold=x,z (hold the right button aimed there), ?charge=x,z (hold the left button aimed there), ?aim=x,z (aim
// only), ?fireat=N (let go of both after N frames, aim held after), ?lockcar (guns on the first truck, locked),
// ?start=x,z (where the mech stands), ?manual (no demo).
import "../../src/core/lab.css";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import type { Hittable } from "../../src/game/battlefield";
import type { MoveCommand } from "../../src/mech/walker";
import type { Aim } from "../../src/mech/upper";
import { applyLoadout } from "../../src/game/loadoutApply";
import { DummyRange, DUMMY_DEFAULTS, DUMMY_PARAMS } from "../../src/game/dummies";
import { DummiesDraw } from "../../src/game/dummiesDraw";
import { RangeGround, RANGE_DEFAULTS, RANGE_PARAMS, rangeSpots } from "../../src/game/firingRange";
import { RangeCars, RANGE_CAR_DEFAULTS, RANGE_CAR_PARAMS } from "../../src/game/rangeVehicles";
import { addModifier } from "../../src/world/modifiers";
import { defaultLoadout, fit, resolve, type Loadout, type SlotId } from "../../src/items/loadout";
import { makeItem } from "../../src/items/generate";
import { LOADOUT_DEFAULTS } from "../../src/items/loadout";

const GUNS = { minigun: "Miniguns", rail: "Rail cannon (hull, right)", rails: "Two rail cannons", lightrails: "Light rails (hands)", autocannon: "Autocannons" } as const;
const BACKS = { drums: "Ammo drums", salvo: "Line rocket pod", mortar: "Mortar" } as const;
type GunPick = keyof typeof GUNS;
type BackPick = keyof typeof BACKS;
const KEY = "pm2:weapons-lab:pick";


let draw: DummiesDraw | null = null;
let cars: RangeCars | null = null;
type DemoOut = { cmd: MoveCommand; aim: Aim | null; trigger: boolean; heavy?: boolean; lock?: TargetCandidate | null };
let script: ((t: number, dt: number) => DemoOut) | null = null;

const lab = await combatLab({
  id: "weapons-lab",
  title: "Weapons",
  defaults: { ...RANGE_DEFAULTS, ...RANGE_CAR_DEFAULTS, ...DUMMY_DEFAULTS, ...LOADOUT_DEFAULTS },
  params: [...RANGE_PARAMS, ...RANGE_CAR_PARAMS, ...DUMMY_PARAMS],
  topics: [{ id: "range", label: "Range", groups: ["Firing range", "Range vehicles", "Target dummies"] }],
  selectables: [
    { topic: "range", label: "Targets", objects: () => [...(draw?.meshes() ?? []), ...(cars?.cars.map((c) => c.body.root) ?? [])] },
  ],
  setup: (field, V) => { addModifier(field, new RangeGround(V)); },
  demo: (t, dt) => script?.(t, dt) ?? null,
  report: () => ({ guns: pick.guns, back: pick.back }),
  onChange: (k) => {
    if (k in RANGE_DEFAULTS) { lab.field.update(); lab.craters.invalidate(); lab.streamer.rebuildAll(); rebuildRange(); }
    else if (k in DUMMY_DEFAULTS && k !== "dpsWindow") rebuildRange();
    else if (k in RANGE_CAR_DEFAULTS) { if (k === "carCount") { cars?.build(); sync(); } }
  },
});
const { V, player, bf, app } = lab;
const params = app.params;

// ---- The weapon picker: fits items through the loadout, so the mech is what the bay would build ----
const pick: { guns: GunPick; back: BackPick } = { guns: "rail", back: "salvo" };
try { Object.assign(pick, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* no saved pick */ }
if (params.get("guns") && params.get("guns")! in GUNS) pick.guns = params.get("guns") as GunPick;
if (params.get("back") && params.get("back")! in BACKS) pick.back = params.get("back") as BackPick;

function loadoutFor(guns: GunPick, back: BackPick): Loadout {
  const lo = defaultLoadout();
  const put = (slot: SlotId, base: string) => fit(lo, slot, makeItem(base, "common", `range-${slot}-${base}`));
  if (guns === "rail") put("armR", "rail-medium");
  if (guns === "rails") { put("armL", "rail-medium"); put("armR", "rail-medium"); }
  if (guns === "lightrails") { put("armL", "arm-rampart"); put("armR", "arm-rampart"); put("handL", "rail-light"); put("handR", "rail-light"); }
  if (guns === "autocannon") { put("armL", "ac-medium"); put("armR", "ac-medium"); }
  if (back === "salvo") put("back", "back-salvo");
  if (back === "mortar") put("back", "back-mortar");
  return lo;
}
function refit() {
  applyLoadout(player, resolve(loadoutFor(pick.guns, pick.back), V));
  lab.refresh();
  try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch { /* private window */ }
  for (const b of buttons) b.el.classList.toggle("on", pick[b.row] === b.id);
}

const style = document.createElement("style");
style.textContent = `
.wpick { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 5; display: flex; flex-direction: column; gap: 4px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; max-width: calc(100vw - 20px); }
.wpick-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.wpick-row span { color: var(--muted); font-size: 12px; width: 40px; }
.wpick button { background: #1f2226; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 3px 8px; font: 12px var(--sans); cursor: pointer; }
.wpick button.on { border-color: var(--accent); color: var(--accent); }
`;
document.head.appendChild(style);
const bar = document.createElement("div");
bar.className = "wpick";
const buttons: { row: "guns" | "back"; id: string; el: HTMLButtonElement }[] = [];
for (const [row, label, opts] of [["guns", "Guns", GUNS], ["back", "Back", BACKS]] as const) {
  const r = document.createElement("div");
  r.className = "wpick-row";
  const l = document.createElement("span"); l.textContent = label; r.appendChild(l);
  for (const [id, name] of Object.entries(opts)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = name;
    b.addEventListener("click", () => { (pick as Record<string, string>)[row] = id; refit(); });
    r.appendChild(b);
    buttons.push({ row, id, el: b });
  }
  bar.appendChild(r);
}
document.body.appendChild(bar);
refit();
// Start a little back from the range's near targets (?start=x,z to stand elsewhere, e.g. closer for shots).
{ const s = (params.get("start") ?? "").split(",").map(Number); player.reset(Number.isFinite(s[0]) && s.length === 2 ? s[0] : 4, Number.isFinite(s[1]) && s.length === 2 ? s[1] : -10, 0); }

// ---- The range: cutouts, posts and vehicles ----
const rng = new DummyRange(V, rangeSpots(V));

const dd = new DummiesDraw(rng, lab.toon);
draw = dd;
app.scene.add(dd.group);
const cs = new RangeCars(lab.field, V);
cars = cs;
cs.onDamage = (a) => rng.record(a);
app.scene.add(cs.group);
let registered: Hittable[] = [];
function sync() {
  const keep = bf.targets.filter((t) => !registered.includes(t));
  bf.targets.splice(0, bf.targets.length, ...keep, ...rng.dummies, ...cs.cars);
  registered = [...rng.dummies, ...cs.cars];
}
function rebuildRange() { rng.layout = rangeSpots(V); rng.build(); dd.rebuild(); sync(); }
sync();

lab.targets = () => {
  const out: TargetCandidate[] = [];
  for (const d of rng.dummies) if (d.alive) out.push({ x: d.x, y: d.y + d.height * 0.6, z: d.z, r: d.radius + 0.4, key: d });
  for (const c of cs.cars) if (c.alive) out.push({ x: c.sim.pos.x, y: c.centreY, z: c.sim.pos.z, r: 2, key: c, vx: c.sim.vel.x, vz: c.sim.vel.z });
  return out;
};

// ---- Per-shot readouts: damage landing after a weapon fires is that shot's (while the miniguns aren't firing) ----
const WINDOW: Record<string, number> = { rail: 0.3, autocannon: 1.5, salvo: 4, mortar: 5.5 };
const NAME: Record<string, string> = { rail: "rail beam", autocannon: "autocannon shell", salvo: "salvo", mortar: "mortar volley" };
let clock = 0;
let shot: { kind: string; t: number; dealt: number; hits: number } | null = null;
const lastOf: Record<string, { dealt: number; hits: number }> = {};
let total0 = 0, hits0 = 0;
lab.arsenal.onFire = (kind) => {
  // A new salvo or volley ends the last; autocannon shells are counted as a stream.
  if (kind === "autocannon" && shot?.kind === "autocannon" && clock - shot.t < WINDOW.autocannon) { shot.t = clock; return; }
  shot = { kind, t: clock, dealt: 0, hits: 0 };
  lastOf[kind] = { dealt: 0, hits: 0 };
};

lab.onFrame((dt) => {
  clock += dt;
  rng.update(dt, lab.field);
  cs.update(dt);
  dd.update();
  const dTotal = rng.total - total0, dHits = rng.hits - hits0;
  total0 = rng.total; hits0 = rng.hits;
  const minigunsFiring = player.upper.guns.some((g) => g.firing && (!g.stats?.cls || g.stats.cls === "minigun"));
  if (shot && clock - shot.t < WINDOW[shot.kind] && !minigunsFiring) { shot.dealt += dTotal; shot.hits += dHits; lastOf[shot.kind] = { dealt: shot.dealt, hits: shot.hits }; }
  const lines = Object.entries(lastOf).map(([k, s]) => `${NAME[k]} ${Math.round(s.dealt)} (${s.hits} hit${s.hits === 1 ? "" : "s"})`);
  const g = player.upper.guns.filter((x) => x.enabled && (!x.stats?.cls || x.stats.cls === "minigun"));
  if (g.length) lines.unshift(`minigun round ${(g[0].stats?.damage ?? V.roundDamage).toFixed(1)}`);
  lab.hud("range", `damage/s ${Math.round(rng.dps())} (over ${V.dpsWindow} s) · down ${rng.kills}`);
  lab.hud("shots", `last shot: ${lines.join(" · ") || "none yet"}`);
});

// ---- The demo, and the shot flags ----
const pt = (k: string) => { const s = params.get(k); if (!s) return null; const [x, z] = s.split(",").map(Number); return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null; };
function makeScript(): (t: number, dt: number) => DemoOut {
  const hold = pt("aimhold"), charge = pt("charge"), aimOnly = pt("aim");
  const fireAt = params.has("fireat") ? Number(params.get("fireat")) : Infinity;
  let frame = 0;
  const at = (p: { x: number; z: number }) => ({ x: p.x, y: lab.field.height(p.x, p.z) + 1.2, z: p.z });
  const still = { x: 0, z: 0, sprint: false };
  if (hold || charge || aimOnly) {
    return (_t: number, _dt: number) => {
      frame++;
      const p = (hold ?? charge ?? aimOnly)!;
      const live = frame < fireAt;
      return { cmd: still, aim: at(p), trigger: !!charge && live, heavy: !!hold && live };
    };
  }
  if (params.has("lockcar")) {
    // Hold the guns on the first truck with the lock on it (the autocannon leads it).
    return () => { const c = carLock(); return { cmd: still, aim: c ? { x: c.x + (c.vx ?? 0) * V.lockLead, y: c.y, z: c.z + (c.vz ?? 0) * V.lockLead } : null, trigger: !!c, lock: c }; };
  }
  // The demo: paint the column and fire the back weapon, charge a rail across the line, then the trucks.
  return (t: number, _dt: number) => {
    const ph = t % 9;
    const column = { x: V.columnX, z: V.lineZ - 4 + (V.columnCount - 1) * V.columnGap / 2 };
    if (ph < 2.4) {
      const target = pick.back === "mortar" ? { x: 0, z: V.behindZ } : column;
      return { cmd: still, aim: at(target), trigger: false, heavy: ph < 1.6 && pick.back !== "drums" };
    }
    if (ph < 5) return { cmd: still, aim: at({ x: -2, z: V.lineZ }), trigger: ph < 4.3, heavy: false };
    const car = carLock();
    if (car) return { cmd: still, aim: { x: car.x + (car.vx ?? 0) * V.lockLead, y: car.y, z: car.z + (car.vz ?? 0) * V.lockLead }, trigger: ph < 8.2, heavy: false, lock: car };
    return { cmd: still, aim: at({ x: 8, z: V.postsZ }), trigger: ph < 8, heavy: false };
  };
}
/** The first live truck as a lock (the demo and ?lockcar: as if the cursor were on it). */
function carLock(): TargetCandidate | null {
  const c = cs.cars.find((x) => x.alive);
  return c ? { x: c.sim.pos.x, y: c.centreY, z: c.sim.pos.z, r: 2, key: c, vx: c.sim.vel.x, vz: c.sim.vel.z } : null;
}
script = makeScript();
