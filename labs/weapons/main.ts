// Weapons lab (docs/proposal-weapons.md, Keith 2026-10-25; the weapon review lab merged in, Keith 2026-11-06): a firing
// range for the weapons. A line and a column of plywood cutouts, a row of steel posts (one sliding), trucks driving a
// slow loop to lead, a dune across the range with cutouts behind it for the mortars, the test swarm's pen off to the
// left for area and clear (src/game/testSwarm.ts), a band of about 100 bandits running back and forth behind the mech
// (src/game/rangeRunners.ts) and an enemy mech walking up and down on the right (src/game/rangeMech.ts), both for
// tracking. Two ways to fit the mech: the picker bar along the bottom fits a loadout through the loadout (the mech the
// bay builds); the review panel on the left (./review.ts) fits one weapon with Protocols and shows its numbers from
// the balance model, charts, sounds and the swarm's live clear numbers. Whichever was used last is on the mech.
// Controls: left click fires the left side's weapon, right click the right side's (both can be held); launchers on
// keys 1-3: hold to paint, release to fire; feeds and power on keys 1-2: press.
//
// URL flags: ?left=, ?right=, ?k1=, ?k2=, ?k3= (the picker's loadout: see CLAUDE.md), ?w=<base id> (review that weapon
// and fit it), ?protos=splitter,splitter (socketed into it), ?review (start on the reviewed weapon), ?armour=N, ?panel=0
// (the review panel shut) / ?panel=1 (open), ?target=auto|cutouts|trucks|swarm|runners|mech (what the demo shoots),
// ?pen[=tier] (the demo shoots the test swarm, that tier), ?nofire (the demo aims, holds fire), ?hold=N:x,z (hold key N
// aimed there), ?lmb=x,z / ?rmb=x,z (hold a mouse button aimed there), ?aim=x,z, ?fireat=N (let go after N frames),
// ?lockcar (both guns on the first truck, locked), ?start=x,z (where the mech stands), ?manual (no demo).
import "../../src/core/lab.css";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { KIND, FLAG } from "../../src/game/register";
import { listOwner, mechOwner } from "../../src/game/registerOwners";
import type { Hittable } from "../../src/game/battlefield";
import type { MoveCommand } from "../../src/mech/walker";
import type { Aim, Trigger } from "../../src/mech/upper";
import { applyLoadout } from "../../src/game/loadoutApply";
import { DummyRange, DUMMY_DEFAULTS, DUMMY_PARAMS } from "../../src/game/dummies";
import { DummiesDraw } from "../../src/game/dummiesDraw";
import { RangeGround, RANGE_DEFAULTS, RANGE_PARAMS, rangeSpots } from "../../src/game/firingRange";
import { RangeCars, RANGE_CAR_DEFAULTS, RANGE_CAR_PARAMS } from "../../src/game/rangeVehicles";
import { RangeRunners, RUNNER_DEFAULTS, RUNNER_PARAMS, RUNNER_GROUPS, type RunnerValues } from "../../src/game/rangeRunners";
import { RangeMech, RANGE_MECH_DEFAULTS, RANGE_MECH_PARAMS } from "../../src/game/rangeMech";
import { TestSwarm, TEST_SWARM_DEFAULTS, TEST_SWARM_PARAMS, TEST_SWARM_TIERS, type TestSwarmValues } from "../../src/game/testSwarm";
import { TestSwarmDraw } from "../../src/game/testSwarmDraw";
import { hook } from "../../src/game/fronts/front";
import { addModifier } from "../../src/world/modifiers";
import { resolve, LOADOUT_DEFAULTS } from "../../src/items/loadout";
import { ROWS, choose, cleanPick, loadoutFor, loadoutForBase, pickFromParams, type Pick } from "../../src/items/weaponPick";
import { BASE_BY_ID } from "../../src/items/bases";
import { PROTOCOL_BY_ID } from "../../src/items/protocols";
import { makeItem } from "../../src/items/generate";
import { MELEE_IDS, wOf } from "../../src/items/balanceModel";
import { MODELLED } from "../../src/items/weaponScaling";
import { reviewPanel, DEMO_TARGETS, type DemoTarget, type ReviewState } from "./review";
const KEY = "pm2:weapons-lab:pick3";
const RKEY = "pm2:weapons-lab:review";

const LAB_DEFAULTS = { reviewFire: 2.5, reviewCycle: 4, reviewSoundAt: 12, runStomp: 2.4 };
const LAB_PARAMS: Param[] = [
  { key: "reviewFire", label: "Demo: fire for (s)", min: 0.2, max: 8, step: 0.1, group: "Weapon review", tip: "Each demo cycle on a picked target holds the trigger (or paints a launcher) this long" },
  { key: "reviewCycle", label: "Demo: cycle (s)", min: 1, max: 12, step: 0.5, group: "Weapon review" },
  { key: "reviewSoundAt", label: "Sound buttons: played this far ahead (m)", min: 0, max: 60, step: 1, group: "Weapon review" },
  { key: "runStomp", label: "Stomp reach on runners (m)", min: 0, max: 6, step: 0.1, group: "Running bandits", tip: "A footfall knocks down or kills runners this close" },
];

let draw: DummiesDraw | null = null;
let cars: RangeCars | null = null;
let tsDraw: TestSwarmDraw | null = null;
let runners: RangeRunners | null = null;
let mover: RangeMech | null = null;
type DemoOut = { cmd: MoveCommand; aim: Aim | null; trigger: Trigger; keys?: boolean[]; lock?: TargetCandidate | null };
let script: ((t: number, dt: number) => DemoOut) | null = null;

const lab = await combatLab({
  id: "weapons-lab",
  title: "Weapons",
  defaults: { ...LAB_DEFAULTS, ...RANGE_DEFAULTS, ...RANGE_CAR_DEFAULTS, ...DUMMY_DEFAULTS, ...TEST_SWARM_DEFAULTS, ...RUNNER_DEFAULTS, ...RANGE_MECH_DEFAULTS, ...LOADOUT_DEFAULTS },
  params: [...LAB_PARAMS, ...RANGE_PARAMS, ...RANGE_CAR_PARAMS, ...DUMMY_PARAMS, ...TEST_SWARM_PARAMS, ...RUNNER_PARAMS, ...RANGE_MECH_PARAMS],
  topics: [
    { id: "range", label: "Range", groups: ["Firing range", "Range vehicles", "Target dummies"] },
    { id: "review", label: "Review", groups: ["Weapon review", "Test swarm"] },
    { id: "runners", label: "Runners", groups: RUNNER_GROUPS },
    { id: "mover", label: "Target mech", groups: ["Target mech"] },
  ],
  selectables: [
    { topic: "range", label: "Targets", objects: () => [...(draw?.meshes() ?? []), ...(cars?.cars.map((c) => c.body.root) ?? [])] },
    { topic: "review", label: "Test swarm", objects: () => tsDraw?.meshes() ?? [] },
    { topic: "runners", label: "Runners", objects: () => (runners?.draw ? [runners.draw.mesh] : []) },
    { topic: "mover", label: "Target mech", objects: () => (mover?.unit ? [mover.unit.body.root] : []) },
  ],
  setup: (field, V) => { addModifier(field, new RangeGround(V)); },
  demo: (t, dt) => script?.(t, dt) ?? null,
  report: () => ({ ...pick, mode: state.mode, base: state.base, protos: state.protos.join(","), target: state.target, tier: state.tier }),
  onChange: (k) => {
    if (k in RANGE_DEFAULTS) { lab.field.update(); lab.craters.invalidate(); lab.streamer.rebuildAll(); rebuildRange(); }
    else if (k in DUMMY_DEFAULTS && k !== "dpsWindow") rebuildRange();
    else if (k in RANGE_CAR_DEFAULTS) { if (k === "carCount") { cars?.build(); sync(); } }
    else if (k in TEST_SWARM_DEFAULTS && k !== "tsWindow" && k !== "tsPause") { state.tier = "custom"; layoutSwarm(); panel.render(); }
    else if (k === "runX" || k === "runZ" || k === "runHalfWidth" || k === "runDepth") runners?.rebuild();
    else if (k === "moverX" || k === "moverZ") mover?.place();
  },
});
const { V, player, bf, app } = lab;
const params = app.params;

// ---- What's on the mech: the picker's loadout or the reviewed weapon ----
// The picker's mounts (Keith 2026-10-30): key 1's missile pod over the left hull minigun, the hull rocket launcher on
// the right, the big mortar the back weapon on key 3.
const pick: Pick = { left: "minigun", right: "rpg", k1: "missiles", k2: "none", k3: "mortar" };
try { Object.assign(pick, JSON.parse(localStorage.getItem(KEY) || "{}")); cleanPick(pick); } catch { /* no saved pick */ }
const picked = pickFromParams(pick, params);
if (picked) cleanPick(pick);
const state: ReviewState = { mode: "pick", base: "mg-medium", protos: [], armour: -1, target: "auto", tier: "fodder" };
try { Object.assign(state, JSON.parse(localStorage.getItem(RKEY) || "{}")); } catch { /* none saved */ }
if (picked) state.mode = "pick";
if (params.get("w")) state.base = params.get("w")!;
if (params.has("protos")) state.protos = params.get("protos")!.split(",").filter((p) => PROTOCOL_BY_ID[p]);
if (params.get("w") || params.has("protos") || params.has("review")) state.mode = "review";
if (params.has("armour")) state.armour = Number(params.get("armour"));
if (params.has("pen")) { state.target = "swarm"; const t = params.get("pen"); if (t && TEST_SWARM_TIERS.some((x) => x.id === t)) state.tier = t; }
{ const t = params.get("target"); if (t && DEMO_TARGETS.some((x) => x.id === t)) state.target = t as DemoTarget; }
if (!MODELLED.includes(state.base)) state.base = "mg-medium";
const isShoulder = () => BASE_BY_ID[state.base].kind === "shoulder";
const save = () => { try { localStorage.setItem(RKEY, JSON.stringify(state)); localStorage.setItem(KEY, JSON.stringify({ ...pick, protos: undefined })); } catch { /* private window */ } };

/** Where the mech stands, and the test swarm's anchor. */
const START = { x: 0, z: -8 };

/** The picker's loadout onto the mech. */
function usePicker() {
  state.mode = "pick";
  applyLoadout(player, resolve(loadoutFor(pick), V));
  lab.refresh();
  save();
  for (const b of buttons) b.el.classList.toggle("on", (pick as unknown as Record<string, string>)[b.row] === b.id);
  bar.classList.remove("off");
  layoutSwarm();
}
/** The reviewed weapon (with its Protocols) onto the mech, standing where it can reach the demo's target. */
function useReview() {
  state.mode = "review";
  const melee = MELEE_IDS.includes(state.base);
  if (melee && state.target === "swarm") {
    // A sword on the swarm: it stands at the pen's near edge, facing in.
    const R = Math.sqrt(V.tsCount / Math.max(0.01, V.tsDensity) / Math.PI), d = Math.max(0, V.tsDist - R - 2);
    player.reset(START.x + ts.fx * d, START.z + ts.fz * d, Math.atan2(ts.fx, ts.fz));
  } else player.reset(START.x, melee ? V.lineZ - 4.5 : START.z, 0);
  applyLoadout(player, resolve(loadoutForBase(state.base, state.protos), V));
  lab.refresh();
  save();
  bar.classList.add("off");
  layoutSwarm();
}

// ---- The picker bar ----
const style = document.createElement("style");
style.textContent = `
.wpick { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 5; display: flex; flex-direction: column; gap: 3px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; max-width: calc(100vw - 20px); }
.wpick.off { opacity: 0.6; }
.wpick.min .wpick-row { display: none; }
.wpick-top { display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 12px; }
.wpick-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.wpick-row span { color: var(--muted); font-size: 12px; width: 42px; }
.wpick button { background: #1f2226; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px; font: 12px var(--sans); cursor: pointer; }
.wpick button.on { border-color: var(--accent); color: var(--accent); }
`;
document.head.appendChild(style);
const bar = document.createElement("div");
bar.className = "wpick";
bar.title = "The picker's loadout (clicking one fits it all)";
// Hide folds it to one line, so the runners behind the mech show (remembered).
const top = document.createElement("div");
top.className = "wpick-top";
top.innerHTML = `<span>Loadout picker</span>`;
const fold = document.createElement("button");
fold.type = "button";
const folded = (on: boolean) => { bar.classList.toggle("min", on); fold.textContent = on ? "show" : "hide"; try { localStorage.setItem(KEY + ":min", on ? "1" : ""); } catch { /* private window */ } };
fold.addEventListener("click", () => folded(!bar.classList.contains("min")));
top.appendChild(fold);
bar.appendChild(top);
try { folded(!!localStorage.getItem(KEY + ":min")); } catch { folded(false); }
const buttons: { row: string; id: string; el: HTMLButtonElement }[] = [];
for (const [row, label, opts] of ROWS) {
  const r = document.createElement("div");
  r.className = "wpick-row";
  const l = document.createElement("span"); l.textContent = label; r.appendChild(l);
  for (const [id, name] of Object.entries(opts)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = name;
    b.addEventListener("click", () => { choose(pick, row, id); usePicker(); panel.render(); });
    r.appendChild(b);
    buttons.push({ row, id, el: b });
  }
  bar.appendChild(r);
}
document.body.appendChild(bar);

// ---- The range: cutouts, posts, trucks, the test swarm, the runners and the target mech ----
const rng = new DummyRange(V, rangeSpots(V));
const dd = new DummiesDraw(rng, lab.toon);
draw = dd;
app.scene.add(dd.group);
const cs = new RangeCars(lab.field, V);
cars = cs;
cs.onDamage = (a) => rng.record(a);
app.scene.add(cs.group);
const ts = new TestSwarm(V as unknown as TestSwarmValues, START);
tsDraw = new TestSwarmDraw(ts);
app.scene.add(tsDraw.group);
const rr = new RangeRunners(V as unknown as RunnerValues, lab.field, lab.deaths, 11, lab.bf.rules.world);
runners = rr;
await rr.show(app.scene);
if (rr.draw) { const d = rr.draw; d.chillMap = () => { d.frostLook = (bf.v as { frostLook?: number } | undefined)?.frostLook ?? 1; return bf.chills?.chillsOf(rr.target) ?? null; }; }
hook(player, "onStomp", (x, z, k) => rr.sw.stomp(x, z, V.runStomp * Math.min(1.5, k)));
const mm = new RangeMech(bf, V as never);
mover = mm;
await mm.load(lab.loadRampart, lab.toon, app.scene).catch((e) => console.warn("target mech not loaded:", e));

let registered: Hittable[] = [];
function sync() {
  const keep = bf.targets.filter((t) => !registered.includes(t));
  const mine = [...rng.dummies, ...cs.cars, ...ts.bodies];
  bf.targets.splice(0, bf.targets.length, ...keep, ...mine);
  registered = mine;
}
function rebuildRange() { rng.layout = rangeSpots(V); rng.build(); dd.rebuild(); sync(); }
bf.targets.push(rr.target);
sync();

// Into the register for the soft lock and the weapons.
bf.register.add(listOwner("dummies", () => rng.dummies, (reg, d, k, s) =>
  reg.put(k, s, KIND.Prop, d.team, FLAG.Hittable | (d.light ? FLAG.Light : 0), d.x, d.y + d.height * 0.6, d.z, d.radius + 0.4)));
bf.register.add(listOwner("trucks", () => cs.cars, (reg, c, k, s) =>
  reg.put(k, s, KIND.Vehicle, c.team, FLAG.Hittable | FLAG.Detectable, c.sim.pos.x, c.centreY, c.sim.pos.z, 2, 0, c.sim.vel.x, c.sim.vel.z, 3.4 + 1.4))); // reach: the longest truck's capsule
bf.register.add(listOwner("testswarm", () => ts.bodies, (reg, b, k, s) =>
  reg.put(k, s, KIND.Prop, b.team, FLAG.Hittable | FLAG.Light, b.x, b.y + b.height * 0.5, b.z, b.radius + Math.max(0.4, b.height * 0.5))));
bf.register.add(rr.target);
bf.register.add(mechOwner("rangemech", () => mm.list()));

/** The pen's distance: the slider's, or for a reviewed gun 90% of a shorter range (as the model measures it). */
function swarmDist() {
  if (state.mode !== "review" || MELEE_IDS.includes(state.base)) return V.tsDist;
  return Math.max(6, Math.min(V.tsDist, Math.floor(wOf(makeItem(state.base)).range * 0.9)));
}
function layoutSwarm() { ts.dist = swarmDist(); ts.build(); sync(); }
function applyTier(id: string) {
  const t = TEST_SWARM_TIERS.find((x) => x.id === id);
  if (!t) return;
  Object.assign(V, t.set);
  state.tier = id;
  lab.refresh();
  layoutSwarm();
}

const panelParam = params.get("panel");
const panel = reviewPanel({
  state, V, bf, player, ts, refit: useReview, usePicker, shut: panelParam === "0" || (panelParam !== "1" && state.mode === "pick"),
  applyTier: (id) => { applyTier(id); if (state.mode === "review") useReview(); },
});
if (state.tier !== "custom") applyTier(state.tier);
if (state.mode === "review") useReview(); else usePicker();
panel.sync();
panel.render();
// ?start=x,z stands the mech elsewhere (e.g. closer for shots).
{ const s = (params.get("start") ?? "").split(",").map(Number); if (s.length === 2 && s.every(Number.isFinite)) player.reset(s[0], s[1], 0); else if (state.mode === "pick") player.reset(START.x, START.z, 0); }

// ---- Per-shot readouts: damage landing after a weapon fires is that shot's (while the miniguns aren't firing) ----
const WINDOW: Record<string, number> = { rail: 0.3, autocannon: 1.5, rpg: 3, missiles: 5, mortar: 6, linemortar: 5 };
const NAME: Record<string, string> = { rail: "rail slug", autocannon: "autocannon shell", rpg: "rocket", missiles: "missile swarm", mortar: "big mortar", linemortar: "line mortar" };
let clock = 0, liveT = 0;
let shot: { kind: string; t: number; dealt: number; hits: number } | null = null;
const lastOf: Record<string, { dealt: number; hits: number }> = {};
let total0 = 0, hits0 = 0;
lab.arsenal.onFire = (kind) => {
  if (!(kind in WINDOW)) return;
  if (kind === "autocannon" && shot?.kind === "autocannon" && clock - shot.t < WINDOW.autocannon) { shot.t = clock; return; }
  shot = { kind, t: clock, dealt: 0, hits: 0 };
  lastOf[kind] = { dealt: 0, hits: 0 };
};

lab.onFrame((dt) => {
  clock += dt;
  rng.update(dt, lab.field);
  cs.update(dt);
  dd.update();
  ts.update(dt, lab.field);
  tsDraw!.update();
  const pp = player.sim.pelvis;
  rr.update(dt, { x: pp.x, y: pp.y, z: pp.z });
  rr.draw?.update(dt);
  mm.update(dt, { x: pp.x, y: pp.y, z: pp.z });
  const dTotal = rng.total - total0, dHits = rng.hits - hits0;
  total0 = rng.total; hits0 = rng.hits;
  const minigunsFiring = player.upper.guns.some((g) => g.firing && (!g.stats?.cls || g.stats.cls === "minigun"));
  if (shot && clock - shot.t < WINDOW[shot.kind] && !minigunsFiring) { shot.dealt += dTotal; shot.hits += dHits; lastOf[shot.kind] = { dealt: shot.dealt, hits: shot.hits }; }
  const lines = Object.entries(lastOf).map(([k, s]) => `${NAME[k]} ${Math.round(s.dealt)} (${s.hits} hit${s.hits === 1 ? "" : "s"})`);
  const on = state.mode === "review" ? BASE_BY_ID[state.base].name + (state.protos.length ? " + " + state.protos.map((p) => PROTOCOL_BY_ID[p].name).join(" + ") : "") : "picker loadout";
  lab.hud("range", `${on} · on the range ${Math.round(rng.dps())} dmg/s (over ${V.dpsWindow} s) · down ${rng.kills}`);
  lab.hud("shots", `last shot: ${lines.join(" · ") || "none yet"}`);
  const st = ts.stats();
  lab.hud("swarm", st.n ? `test swarm: ${Math.round(st.hps)} hp/s · ${st.kps.toFixed(1)} kills/s · ${st.perImpact.toFixed(1)} per impact · clear ${Number.isFinite(st.clearMean) ? st.clearMean.toFixed(1) + " s" : "–"} · up ${st.up}/${st.n}` : "");
  const u = mm.unit;
  lab.hud("movers", `runners ${rr.sw.count} up · killed ${rr.target.kills}${u && V.moverOn > 0 ? ` · target mech ${u.alive ? `hull ${Math.round(u.health)}/${u.maxHealth}` : "down"} · destroyed ${mm.kills}` : ""}`);
  liveT += dt;
  if (liveT > 0.25) { liveT = 0; panel.renderLive(); }
});

// ---- The demo, and the shot flags ----
const pt = (s: string | null) => { if (!s) return null; const [x, z] = s.split(",").map(Number); return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null; };
/** The first live truck as a lock (the demo and ?lockcar: as if the cursor were on it). */
function carLock(): TargetCandidate | null {
  const c = cs.cars.find((x) => x.alive);
  return c ? { x: c.sim.pos.x, y: c.centreY, z: c.sim.pos.z, r: 2, key: c, vx: c.sim.vel.x, vz: c.sim.vel.z } : null;
}
const led = (c: TargetCandidate): Aim => ({ x: c.x + (c.vx ?? 0) * V.lockLead, y: c.y, z: c.z + (c.vz ?? 0) * V.lockLead });
function makeScript(): (t: number, dt: number) => DemoOut {
  const holdRaw = params.get("hold");
  const holdKey = holdRaw ? Number(holdRaw.split(":")[0]) : 0, hold = holdRaw ? pt(holdRaw.split(":")[1] ?? null) : null;
  const lmb = pt(params.get("lmb")), rmb = pt(params.get("rmb")), aimOnly = pt(params.get("aim"));
  const fireAt = params.has("fireat") ? Number(params.get("fireat")) : Infinity;
  const nofire = params.has("nofire");
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
    return () => { const c = carLock(); return { cmd: still, aim: c ? led(c) : null, trigger: !!c, lock: c }; };
  }
  // The tour (the picker's loadout): each shoulder key in turn on a target group, then the left and right guns.
  const tour = (t: number): DemoOut => {
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
    if (car) return { cmd: still, aim: led(car), trigger: [false, ph % 3 < 2.5], lock: car };
    return { cmd: still, aim: at({ x: 8, z: V.postsZ }), trigger: [false, ph % 3 < 2.5] };
  };
  return (t: number) => {
    if (state.target === "auto" && state.mode === "pick") return tour(t);
    const tgt = state.target === "auto" ? "cutouts" : state.target;
    let aim: Aim | null = null, lock: TargetCandidate | null = null;
    let on = !nofire && t % V.reviewCycle < V.reviewFire;
    if (tgt === "swarm" && ts.bodies.length) {
      // The live body nearest the pen's centre (where a player would put the cursor), trigger held.
      const b = ts.aimBody();
      aim = b ? { x: b.x, y: b.y + b.height * 0.5, z: b.z } : at({ x: ts.cx, z: ts.cz });
      if (state.mode === "pick" || !isShoulder()) on = !nofire;
    } else if (tgt === "trucks") lock = carLock();
    else if (tgt === "runners") lock = rr.lock();
    else if (tgt === "mech") lock = mm.lock();
    if (lock) aim = led(lock);
    aim ??= at({ x: 0, z: V.lineZ + 0.5 });
    if (state.mode === "review") {
      if (isShoulder()) return { cmd: still, aim, trigger: false, keys: [on, false, false, false], lock };
      return { cmd: still, aim, trigger: [on, on && BASE_BY_ID[state.base].size === "H"], lock };
    }
    // The picker's loadout on one target: both guns, and the shoulder keys one a cycle.
    const k = Math.floor(t / V.reviewCycle) % 3, slot = [pick.k1, pick.k2, pick.k3][k];
    const keyOn = on && slot !== "none" && slot !== "pack";
    return { cmd: still, aim, trigger: [on, on], keys: [0, 1, 2, 3].map((i) => i === k && keyOn), lock };
  };
}
script = makeScript();
