// Weapons lab (docs/proposal-weapons.md, Keith 2026-10-25): a firing range for the weapons, each with its own
// targeting. A line and a column of plywood cutouts, a row of steel posts (one sliding), trucks driving a slow loop to
// lead, a dune across the range with cutouts behind it for the mortars. The picker fits items through the loadout (so
// this is the mech the bay builds). Controls (Keith 2026-10-25): left click fires the left side's weapon, right click
// the right side's (F both); shoulder weapons on keys 1-3: hold to paint, release to fire. The HUD shows which button
// or key fires what and its cooldown, damage per second on the range, what the last shot of each weapon did, and what
// the blasts' craters cost.
//
// URL flags (for shots): ?left=, ?right= (minigun|rail|lightrail|autocannon|rpg), ?k1=, ?k2=, ?k3= (none|rpg|missiles|
// mortar|linemortar; k3 also drums), ?hold=N:x,z (hold key N aimed there), ?lmb=x,z / ?rmb=x,z (hold a mouse button
// aimed there), ?aim=x,z, ?fireat=N (let go after N frames, aim held after), ?lockcar (both guns on the first truck,
// locked), ?start=x,z (where the mech stands), ?manual (no demo).
import "../../src/core/lab.css";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import type { Hittable } from "../../src/game/battlefield";
import type { MoveCommand } from "../../src/mech/walker";
import type { Aim, Trigger } from "../../src/mech/upper";
import { applyLoadout } from "../../src/game/loadoutApply";
import { DummyRange, DUMMY_DEFAULTS, DUMMY_PARAMS } from "../../src/game/dummies";
import { DummiesDraw } from "../../src/game/dummiesDraw";
import { RangeGround, RANGE_DEFAULTS, RANGE_PARAMS, rangeSpots } from "../../src/game/firingRange";
import { RangeCars, RANGE_CAR_DEFAULTS, RANGE_CAR_PARAMS } from "../../src/game/rangeVehicles";
import { addModifier } from "../../src/world/modifiers";
import { resolve, LOADOUT_DEFAULTS } from "../../src/items/loadout";
import { ROWS, loadoutFor, pickFromParams, type Pick } from "../../src/items/weaponPick";
const KEY = "pm2:weapons-lab:pick2";

let draw: DummiesDraw | null = null;
let cars: RangeCars | null = null;
type DemoOut = { cmd: MoveCommand; aim: Aim | null; trigger: Trigger; keys?: boolean[]; lock?: TargetCandidate | null };
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
  report: () => ({ ...pick }),
  onChange: (k) => {
    if (k in RANGE_DEFAULTS) { lab.field.update(); lab.craters.invalidate(); lab.streamer.rebuildAll(); rebuildRange(); }
    else if (k in DUMMY_DEFAULTS && k !== "dpsWindow") rebuildRange();
    else if (k in RANGE_CAR_DEFAULTS) { if (k === "carCount") { cars?.build(); sync(); } }
  },
});
const { V, player, bf, app } = lab;
const params = app.params;

// ---- The weapon picker: fits items through the loadout, so the mech is what the bay would build ----
const pick: Pick = { left: "minigun", right: "rpg", k1: "missiles", k2: "mortar", k3: "linemortar" };
try { Object.assign(pick, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* no saved pick */ }
pickFromParams(pick, params);

function refit() {
  applyLoadout(player, resolve(loadoutFor(pick), V));
  lab.refresh();
  try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch { /* private window */ }
  for (const b of buttons) b.el.classList.toggle("on", (pick as unknown as Record<string, string>)[b.row] === b.id);
}

const style = document.createElement("style");
style.textContent = `
.wpick { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 5; display: flex; flex-direction: column; gap: 3px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; max-width: calc(100vw - 20px); }
.wpick-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.wpick-row span { color: var(--muted); font-size: 12px; width: 42px; }
.wpick button { background: #1f2226; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px; font: 12px var(--sans); cursor: pointer; }
.wpick button.on { border-color: var(--accent); color: var(--accent); }
`;
document.head.appendChild(style);
const bar = document.createElement("div");
bar.className = "wpick";
const buttons: { row: string; id: string; el: HTMLButtonElement }[] = [];
for (const [row, label, opts] of ROWS) {
  const r = document.createElement("div");
  r.className = "wpick-row";
  const l = document.createElement("span"); l.textContent = label; r.appendChild(l);
  for (const [id, name] of Object.entries(opts)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = name;
    b.addEventListener("click", () => { (pick as unknown as Record<string, string>)[row] = id; refit(); });
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
const WINDOW: Record<string, number> = { rail: 0.3, autocannon: 1.5, rpg: 3, missiles: 5, mortar: 6, linemortar: 5 };
const NAME: Record<string, string> = { rail: "rail beam", autocannon: "autocannon shell", rpg: "rocket", missiles: "missile swarm", mortar: "big mortar", linemortar: "line mortar" };
let clock = 0;
let shot: { kind: string; t: number; dealt: number; hits: number } | null = null;
const lastOf: Record<string, { dealt: number; hits: number }> = {};
let total0 = 0, hits0 = 0;
lab.arsenal.onFire = (kind) => {
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
  lab.hud("range", `damage/s ${Math.round(rng.dps())} (over ${V.dpsWindow} s) · down ${rng.kills}`);
  lab.hud("shots", `last shot: ${lines.join(" · ") || "none yet"}`);
});

// ---- The demo, and the shot flags ----
const pt = (s: string | null) => { if (!s) return null; const [x, z] = s.split(",").map(Number); return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null; };
/** The first live truck as a lock (the demo and ?lockcar: as if the cursor were on it). */
function carLock(): TargetCandidate | null {
  const c = cs.cars.find((x) => x.alive);
  return c ? { x: c.sim.pos.x, y: c.centreY, z: c.sim.pos.z, r: 2, key: c, vx: c.sim.vel.x, vz: c.sim.vel.z } : null;
}
function makeScript(): (t: number, dt: number) => DemoOut {
  const holdRaw = params.get("hold");
  const holdKey = holdRaw ? Number(holdRaw.split(":")[0]) : 0, hold = holdRaw ? pt(holdRaw.split(":")[1] ?? null) : null;
  const lmb = pt(params.get("lmb")), rmb = pt(params.get("rmb")), aimOnly = pt(params.get("aim"));
  const fireAt = params.has("fireat") ? Number(params.get("fireat")) : Infinity;
  let frame = 0;
  const at = (p: { x: number; z: number }) => ({ x: p.x, y: lab.field.height(p.x, p.z) + 1.2, z: p.z });
  const still = { x: 0, z: 0, sprint: false };
  if (hold || lmb || rmb || aimOnly) {
    return () => {
      frame++;
      const p = (hold ?? lmb ?? rmb ?? aimOnly)!;
      const live = frame < fireAt;
      const keys = [1, 2, 3, 4].map((k) => !!hold && live && k === holdKey);
      return { cmd: still, aim: at(p), trigger: [!!lmb && live, !!rmb && live], keys };
    };
  }
  if (params.has("lockcar")) {
    return () => { const c = carLock(); return { cmd: still, aim: c ? { x: c.x + (c.vx ?? 0) * V.lockLead, y: c.y, z: c.z + (c.vz ?? 0) * V.lockLead } : null, trigger: !!c, lock: c }; };
  }
  // The demo: each shoulder key in turn on a target group, then the left and right guns.
  return (t: number) => {
    const ph = t % 15;
    const column = { x: V.columnX, z: V.lineZ - 4 + (V.columnCount - 1) * V.columnGap / 2 };
    const targets = [column, { x: 0, z: V.behindZ }, { x: 0, z: V.lineZ }];
    const k = Math.floor(ph / 3);
    if (k < 3) {
      const which = [pick.k1, pick.k2, pick.k3][k];
      const target = which === "mortar" ? { x: 0, z: V.behindZ } : which === "linemortar" ? column : targets[k];
      return { cmd: still, aim: at(target), trigger: false, keys: [0, 1, 2, 3].map((i) => i === k && ph % 3 < 1.6) };
    }
    if (k === 3) return { cmd: still, aim: at({ x: -2, z: V.lineZ }), trigger: [ph % 3 < 2.2, false] };
    const car = carLock();
    if (car) return { cmd: still, aim: { x: car.x + (car.vx ?? 0) * V.lockLead, y: car.y, z: car.z + (car.vz ?? 0) * V.lockLead }, trigger: [false, ph % 3 < 2.5], lock: car };
    return { cmd: still, aim: at({ x: 8, z: V.postsZ }), trigger: [false, ph % 3 < 2.5] };
  };
}
script = makeScript();
