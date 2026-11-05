// Weapon review lab (Keith 2026-11-03: "a lab where we can look at each weapon and review its theoretical scaling off
// protocols, review its sounds"). Pick a weapon: its numbers from the balance model (src/items/weaponScaling.ts, the
// balance sheet's own maths), four charts (the budget map of every weapon, Protocol scaling, reach and reliability),
// the mech firing it at the range's cutouts, and its sounds on buttons. Click + on a Protocol to socket it into the
// weapon the mech fires (repeats allowed, up to 4), and the charts mark that build.
// Flags: ?w=<base id> (mg-medium, flak-medium, sh-mortar...), ?protos=splitter,splitter (socketed at the start),
// ?armour=N (every single target's armour; -1 their own), ?nofire (the demo aims but holds fire), ?panel=0 (the review panel shut), plus the combat-lab flags.
// The test swarm (Keith 2026-11-04: measuring clear): a pen of still bodies off to the left (src/game/testSwarm.ts) with
// tiers (Fodder is the model's swarm, spread, horde, armoured, cutters, a column); ?pen[=tier] makes the demo shoot
// it, held trigger. The panel puts the live clear numbers beside the model's for the same pen, and logs runs.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { applyLoadout } from "../../src/game/loadoutApply";
import { resolve, LOADOUT_DEFAULTS } from "../../src/items/loadout";
import { loadoutForBase } from "../../src/items/weaponPick";
import { BASE_BY_ID } from "../../src/items/bases";
import { PROTOCOL_BY_ID } from "../../src/items/protocols";
import { TRAIT_BY_ID, traitsOf } from "../../src/items/traits";
import { itemCadence } from "../../src/items/dps";
import { makeItem } from "../../src/items/generate";
import { REF, ENERGY_IDS, MELEE_IDS, FIRE_IDS, wOf } from "../../src/items/balanceModel";
import {
  MODELLED, SCALING, armourCurve, relDist, bestBuilds, focusArea, itemWith, profileOf, protocolsFor, protocolStack, reachCurve, reliabilityCurve, scaleClass,
  type Profile,
} from "../../src/items/weaponScaling";
import { DummyRange, DUMMY_DEFAULTS, DUMMY_PARAMS } from "../../src/game/dummies";
import { DummiesDraw } from "../../src/game/dummiesDraw";
import { RangeGround, RANGE_DEFAULTS, RANGE_PARAMS, rangeSpots } from "../../src/game/firingRange";
import { addModifier } from "../../src/world/modifiers";
import { playBlast } from "../../src/weapons/weaponSound";
import type { Hittable } from "../../src/game/battlefield";
import { KIND, FLAG } from "../../src/game/register";
import { listOwner } from "../../src/game/registerOwners";
import { TestSwarm, TEST_SWARM_DEFAULTS, TEST_SWARM_PARAMS, TEST_SWARM_TIERS, type TestSwarmValues } from "../../src/game/testSwarm";
import { TestSwarmDraw } from "../../src/game/testSwarmDraw";
import { swarmModel } from "../../src/items/weaponScaling";

const KEY = "pm2:weaponreview:pick";
const LAB_DEFAULTS = { reviewFire: 2.5, reviewCycle: 4, reviewSoundAt: 12 };
const LAB_PARAMS: Param[] = [
  { key: "reviewFire", label: "Demo: fire for (s)", min: 0.2, max: 8, step: 0.1, group: "Weapon review", tip: "Each demo cycle holds the trigger (or paints a launcher) this long" },
  { key: "reviewCycle", label: "Demo: cycle (s)", min: 1, max: 12, step: 0.5, group: "Weapon review" },
  { key: "reviewSoundAt", label: "Sound buttons: played this far ahead (m)", min: 0, max: 60, step: 1, group: "Weapon review" },
];

/** What the review's sound buttons play for each weapon: one-shot sounds by name (the recordings where cut), and a
 *  blast of the weapon's radius. Miniguns' sound runs with their spin, so only firing plays it. */
const SOUNDS: Record<string, string[]> = {
  "smg-light": ["smg"], "rifle-light": ["rifle"], "shotgun-light": ["shotgun"], "sniper-medium": ["sniper"],
  "flak-medium": ["flak", "flakPop"], "cannon-medium": ["breach"], "rail-light": ["railCharge", "rail"], "rail-medium": ["railCharge", "rail"],
  "ac-medium": ["cannon"], "rpg-light": ["rocket"], "rpg-medium": ["rocket"], "sh-rpg": ["rocket"], "sh-missiles": ["rocket"],
  "sh-mortar": ["mortar"], "sh-linemortar": ["mortar"],
  "flamer-light": ["flameIgnite", "flameRoar"], "inferno-medium": ["flameIgnite", "flameRoar"], "sh-napalm": ["mortar", "napalmBurst"], "frost-light": ["cryoHiss"], "cryo-medium": ["cryoHiss"],
  "laser-medium": ["pulseZap"], "beam-medium": ["beamHum"], "lance-medium": ["lanceCharge", "lanceFire"], "plasma-medium": ["plasmaShot", "plasmaHit"],
  "orb-medium": ["orbLaunch"], "arc-medium": ["arcZap"], "sunder-medium": ["sunderCharge", "sunderHum"],
  "sword-light": ["swordSwing", "swordHit", "swordBlock"], "sword-heavy": ["swordSwing", "swordHit", "swordBlock"], "sword-short": ["swordSwing", "swordHit", "swordBlock"],
};
const ROUGH = new Set([...ENERGY_IDS, ...MELEE_IDS, ...FIRE_IDS]);

const params = new URLSearchParams(location.search);
const state = { base: "mg-medium", protos: [] as string[], armour: -1, target: "cutouts" as "cutouts" | "swarm", tier: "fodder" };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* none saved */ }
if (params.has("pen")) { state.target = "swarm"; const t = params.get("pen"); if (t && TEST_SWARM_TIERS.some((x) => x.id === t)) state.tier = t; }
if (params.get("w")) state.base = params.get("w")!;
if (params.has("armour")) state.armour = Number(params.get("armour"));
if (params.has("protos")) state.protos = params.get("protos")!.split(",").filter((p) => PROTOCOL_BY_ID[p]);
if (!MODELLED.includes(state.base)) state.base = "mg-medium";
const isShoulder = () => BASE_BY_ID[state.base].kind === "shoulder";

let draw: DummiesDraw | null = null;
let ts: TestSwarm | null = null, tsDraw: TestSwarmDraw | null = null;
let ground: ((x: number, z: number) => number) | null = null;
let cfg: { lineZ: number; reviewCycle: number; reviewFire: number } | null = null;
const lab = await combatLab({
  id: "weaponreview-lab",
  title: "Weapon review",
  defaults: { ...LAB_DEFAULTS, ...RANGE_DEFAULTS, ...DUMMY_DEFAULTS, ...TEST_SWARM_DEFAULTS, ...LOADOUT_DEFAULTS },
  params: [...LAB_PARAMS, ...RANGE_PARAMS, ...DUMMY_PARAMS, ...TEST_SWARM_PARAMS],
  topics: [{ id: "review", label: "Review", groups: ["Weapon review", "Firing range", "Target dummies", "Test swarm"] }],
  selectables: [{ topic: "review", label: "Targets", objects: () => draw?.meshes() ?? [] }, { topic: "review", label: "Test swarm", objects: () => tsDraw?.meshes() ?? [] }],
  setup: (field, V) => { addModifier(field, new RangeGround(V)); ground = (x, z) => field.height(x, z); cfg = V; },
  demo: (t: number) => {
    if (!cfg) return null;
    let aim = { x: 0, y: (ground?.(0, cfg.lineZ) ?? 0) + 1.2, z: cfg.lineZ + 0.5 };
    let on = !params.has("nofire") && t % cfg.reviewCycle < cfg.reviewFire;
    if (state.target === "swarm" && ts && ts.bodies.length) {
      // On the test swarm: the live body nearest its centre (where a player would put the cursor), trigger held
      // (a shoulder launcher still paints and lets go on the cycle).
      const b = ts.aimBody();
      aim = b ? { x: b.x, y: b.y + b.height * 0.5, z: b.z } : { x: ts.cx, y: (ground?.(ts.cx, ts.cz) ?? 0) + 0.5, z: ts.cz };
      if (!isShoulder()) on = !params.has("nofire");
    }
    const two = BASE_BY_ID[state.base].size === "H";
    if (isShoulder()) return { cmd: { x: 0, z: 0, sprint: false }, aim, trigger: false, keys: [on, false, false, false] };
    return { cmd: { x: 0, z: 0, sprint: false }, aim, trigger: [on, on && two] };
  },
  report: () => ({ base: state.base, protos: state.protos.join(","), target: state.target, tier: state.tier }),
  onChange: (k) => {
    if (k in RANGE_DEFAULTS || (k in DUMMY_DEFAULTS && k !== "dpsWindow")) { lab.field.update(); lab.streamer.rebuildAll(); rebuildRange(); }
    if (k in TEST_SWARM_DEFAULTS && k !== "tsWindow" && k !== "tsPause") { state.tier = "custom"; layoutSwarm(); render(); }
  },
});
const { V, bf, player, app } = lab;

// ---- The range: the weapons lab's cutouts and posts ----
const rng = new DummyRange(V, rangeSpots(V));
const dd = new DummiesDraw(rng, lab.toon);
draw = dd;
app.scene.add(dd.group);
let registered: Hittable[] = [];
function sync() {
  const keep = bf.targets.filter((t) => !registered.includes(t));
  const mine = [...rng.dummies, ...(ts?.bodies ?? [])];
  bf.targets.splice(0, bf.targets.length, ...keep, ...mine);
  registered = mine;
}
function rebuildRange() { rng.layout = rangeSpots(V); rng.build(); dd.rebuild(); sync(); }
sync();
bf.register.add(listOwner("dummies", () => rng.dummies, (reg, d, k, s) =>
  reg.put(k, s, KIND.Prop, d.team, FLAG.Hittable | (d.light ? FLAG.Light : 0), d.x, d.y + d.height * 0.6, d.z, d.radius + 0.4)));

// ---- The test swarm: a pen off to the left ----
const START = { x: 0, z: -6 };
ts = new TestSwarm(V as unknown as TestSwarmValues, START);
tsDraw = new TestSwarmDraw(ts);
app.scene.add(tsDraw.group);
bf.register.add(listOwner("testswarm", () => ts!.bodies, (reg, b, k, s) =>
  reg.put(k, s, KIND.Prop, b.team, FLAG.Hittable | FLAG.Light, b.x, b.y + b.height * 0.5, b.z, b.radius + Math.max(0.4, b.height * 0.5))));
/** The pen's distance for this weapon: the slider's, or 90% of a shorter gun's range (as the model measures it). */
function swarmDist() {
  const w = wOf(makeItem(state.base));
  return MELEE_IDS.includes(state.base) ? V.tsDist : Math.max(6, Math.min(V.tsDist, Math.floor(w.range * 0.9)));
}
function layoutSwarm() { ts!.dist = swarmDist(); ts!.build(); sync(); }
function applyTier(id: string) {
  const t = TEST_SWARM_TIERS.find((x) => x.id === id);
  if (!t) return;
  Object.assign(V, t.set);
  state.tier = id;
  lab.refresh();
  layoutSwarm();
}
if (state.tier !== "custom") applyTier(state.tier); else layoutSwarm();

lab.onFrame((dt) => {
  rng.update(dt, lab.field);
  dd.update();
  ts!.update(dt, lab.field);
  tsDraw!.update();
  lab.hud("review", `${BASE_BY_ID[state.base].name}${state.protos.length ? " + " + state.protos.map((p) => PROTOCOL_BY_ID[p].name).join(" + ") : ""} · on the cutouts ${Math.round(rng.dps())} dmg/s (${V.dpsWindow} s) · down ${rng.kills}`);
  const st = ts!.stats();
  lab.hud("swarm", st.n ? `test swarm (${tierName()}): ${Math.round(st.hps)} hp/s · ${st.kps.toFixed(1)} kills/s · ${st.perImpact.toFixed(1)} per impact · clear ${Number.isFinite(st.clearMean) ? st.clearMean.toFixed(1) + " s" : "–"} · up ${st.up}/${st.n}` : "");
  liveT += dt;
  if (liveT > 0.25) { liveT = 0; renderLive(); }
});
let liveT = 0;

function refit() {
  // A sword stands at the line of cutouts (it can't reach them from the shooting spot).
  if (MELEE_IDS.includes(state.base) && state.target === "swarm" && ts) {
    // A sword on the swarm: it stands at the pen's near edge, facing in.
    const R = Math.sqrt(V.tsCount / Math.max(0.01, V.tsDensity) / Math.PI);
    player.reset(START.x + ts.fx * Math.max(0, V.tsDist - R - 2), START.z + ts.fz * Math.max(0, V.tsDist - R - 2), Math.atan2(ts.fx, ts.fz));
  } else player.reset(0, MELEE_IDS.includes(state.base) ? V.lineZ - 4.5 : START.z, 0);
  applyLoadout(player, resolve(loadoutForBase(state.base, state.protos), V));
  lab.refresh();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private window */ }
  if (ts) layoutSwarm();
}

// ---- Sounds ----
const at = new THREE.Vector3();
function spot() {
  const p = player.sim.pos, h = player.sim.heading ?? 0;
  return at.set(p.x + Math.sin(h) * V.reviewSoundAt, p.y + 1, p.z + Math.cos(h) * V.reviewSoundAt);
}
function playName(n: string) { bf.sfx.playSound(n, spot(), 1); }

// ---- The panel ----
const css = document.createElement("style");
css.textContent = `
.wr { position: fixed; left: 10px; bottom: 10px; z-index: 6; width: 440px; max-width: calc(100vw - 20px); max-height: calc(100vh - 150px); overflow: auto;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: 12px/1.4 var(--sans); color: var(--fg); }
.wr.shut > :not(.wr-head) { display: none; }
.wr-head { display: flex; gap: 6px; align-items: center; }
.wr-head b { flex: 1; font-size: 13px; }
.wr select, .wr button { background: #1f2226; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; font: 12px var(--sans); cursor: pointer; }
.wr button:hover { border-color: var(--accent); }
.wr h4 { margin: 10px 0 3px; font-size: 12px; color: var(--muted); font-weight: 600; }
.wr table { border-collapse: collapse; width: 100%; font: 11.5px/1.35 var(--mono); font-variant-numeric: tabular-nums; }
.wr td { padding: 1px 4px; } .wr td:first-child { color: var(--muted); font-family: var(--sans); }
.wr td.n { text-align: right; }
.wr .dim { color: var(--muted); } .wr .bad { color: var(--bad); } .wr .ok { color: var(--ok); } .wr .warn { color: var(--warn); }
.wr svg { display: block; width: 100%; height: auto; }
.wr svg text { font: 10px var(--sans); fill: var(--muted); }
.wr .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; }
.wr .chip { border: 1px solid var(--muted); border-radius: 3px; padding: 1px 6px; cursor: help; }
.wr .key { display: inline-block; width: 14px; height: 3px; vertical-align: middle; margin-right: 4px; }
.wr p { margin: 3px 0; }
`;
document.head.appendChild(css);
const box = document.createElement("div");
box.className = "wr" + (params.get("panel") === "0" ? " shut" : "");
document.body.appendChild(box);

const C_FOCUS = "#e8892b", C_AREA = "#4bc0d9", C_GRID = "#30343b", C_SEL = "#f0c14b";
const f0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toString() : "–");
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A small line chart: series of [x, y] with a colour and dash. */
function lineChart(o: { w?: number; h?: number; xs: number[]; series: { pts: [number, number][]; color: string; dash?: string; width?: number }[]; xLabel: string; yLabel: string; yMax?: number; yMin?: number; marks?: { x: number; label: string }[] }): string {
  const W = o.w ?? 420, H = o.h ?? 130, L = 34, R = 8, T = 8, B = 22;
  const all = o.series.flatMap((s) => s.pts.map((p) => p[1])).filter(Number.isFinite);
  const yMin = o.yMin ?? 0, yMax = o.yMax ?? Math.max(1e-6, ...all) * 1.08;
  const x0 = Math.min(...o.xs), x1 = Math.max(...o.xs);
  const X = (x: number) => L + ((x - x0) / Math.max(1e-6, x1 - x0)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - yMin) / Math.max(1e-6, yMax - yMin)) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let i = 0; i <= 4; i++) {
    const y = yMin + ((yMax - yMin) * i) / 4;
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}" stroke="${C_GRID}" stroke-width="1"/><text x="${L - 4}" y="${Y(y) + 3}" text-anchor="end">${yMax - yMin < 5 ? y.toFixed(1) : Math.round(y)}</text>`;
  }
  for (const x of o.xs) s += `<text x="${X(x)}" y="${H - 9}" text-anchor="middle">${x}</text>`;
  for (const m of o.marks ?? []) s += `<line x1="${X(m.x)}" x2="${X(m.x)}" y1="${T}" y2="${H - B}" stroke="${C_SEL}" stroke-dasharray="2 3"/><text x="${X(m.x) + 3}" y="${T + 9}" style="fill:${C_SEL}">${esc(m.label)}</text>`;
  for (const se of o.series) {
    const d = se.pts.filter((p) => Number.isFinite(p[1])).map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width ?? 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""}/>`;
  }
  s += `<text x="${W - R}" y="${H - 1}" text-anchor="end">${esc(o.xLabel)}</text><text x="2" y="${T + 2}" transform="rotate(90 2 ${T + 2})">${esc(o.yLabel)}</text></svg>`;
  return s;
}

/** The budget map: every weapon at (focus %, area %) of its slot's budget, the 130% caps and the proposed spend line. */
function budgetMap(all: Profile[], sel: Profile, builds: { f: Profile | null; a: Profile | null; mine: Profile | null }): string {
  const W = 420, H = 250, L = 34, R = 10, T = 10, B = 24, max = Math.max(260, ...all.map((p) => Math.max(p.focusPct, p.areaPct)) , ...[builds.a, builds.f, builds.mine].filter(Boolean).map((p) => Math.max(p!.focusPct, p!.areaPct))) * 1.05;
  const X = (x: number) => L + (x / max) * (W - L - R), Y = (y: number) => T + (1 - y / max) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let v = 0; v <= max; v += 50) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="${C_GRID}"/><line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C_GRID}"/><text x="${X(v)}" y="${H - 11}" text-anchor="middle">${v}</text><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  s += `<line x1="${X(130)}" x2="${X(130)}" y1="${T}" y2="${H - B}" stroke="#f06a4b" stroke-dasharray="4 3"/><line x1="${L}" x2="${W - R}" y1="${Y(130)}" y2="${Y(130)}" stroke="#f06a4b" stroke-dasharray="4 3"/>`;
  const c = SCALING.spendCap;
  s += `<line x1="${X(0)}" y1="${Y(c)}" x2="${X(c)}" y2="${Y(0)}" stroke="${C_SEL}" stroke-dasharray="2 3"/><text x="${X(c * 0.55) + 4}" y="${Y(c * 0.45) - 4}" style="fill:${C_SEL}">spend ${c}</text>`;
  for (const p of all) {
    const me = p.id === sel.id;
    s += `<circle cx="${X(p.focusPct)}" cy="${Y(p.areaPct)}" r="${me ? 5 : 3.2}" fill="${me ? C_SEL : p.slot === "shoulder" ? "#9a958c" : "#e8e4dc"}" opacity="${me ? 1 : 0.75}"><title>${esc(p.name)}: focus ${f0(p.focusPct)}%, area ${f0(p.areaPct)}%</title></circle>`;
    if (me || p.spend > c) s += `<text x="${X(p.focusPct) + 6}" y="${Y(p.areaPct) + 3}" style="fill:${me ? C_SEL : "#e8e4dc"}">${esc(p.name)}</text>`;
  }
  const arrow = (to: Profile | null, color: string, label: string) => {
    if (!to) return;
    s += `<line x1="${X(sel.focusPct)}" y1="${Y(sel.areaPct)}" x2="${X(to.focusPct)}" y2="${Y(to.areaPct)}" stroke="${color}" stroke-width="1.5"/><circle cx="${X(to.focusPct)}" cy="${Y(to.areaPct)}" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><text x="${X(to.focusPct) + 5}" y="${Y(to.areaPct) - 4}" style="fill:${color}">${label}</text>`;
  };
  arrow(builds.f, C_FOCUS, "best focus build");
  arrow(builds.a, C_AREA, "best area build");
  arrow(builds.mine, "#8fd18a", "fitted");
  s += `<text x="${W - R}" y="${H - 1}" text-anchor="end">focus: % of budget vs its best single target</text><text x="2" y="${T + 2}" transform="rotate(90 2 ${T + 2})">area: % vs the swarm</text></svg>`;
  return s;
}

let all: Profile[] | null = null, allArmour = NaN;

// ---- The test swarm's readout: live against the model, and a log of runs ----
const LOG_KEY = "pm2:weaponreview:swarmlog";
interface LogRow { weapon: string; tier: string; hps: number; kps: number; perImpact: number; clear: number; overkill: number; mArea: number; mClear: number; secs: number }
let log: LogRow[] = [];
try { log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { /* none */ }
const saveLog = () => { try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch { /* private window */ } };
let model = { area: 0, crowd: 0, clear: Infinity };
function tierName() { return TEST_SWARM_TIERS.find((t) => t.id === state.tier)?.name ?? "custom"; }
function weaponLabel() { return BASE_BY_ID[state.base].name + (state.protos.length ? " + " + state.protos.map((p) => PROTOCOL_BY_ID[p].name).join(" + ") : ""); }
function swarmModelNow() {
  // The pen as the model sees it: standing still, at the pen's distance (the model moves short guns in the same way).
  const item = state.protos.length ? itemWith(state.base, state.protos) : makeItem(state.base);
  return swarmModel(item, { n: Math.round(V.tsCount), hp: V.tsHp, armour: V.tsArmour, r: V.tsRadius, rho: V.tsDensity, dist: ts?.dist ?? V.tsDist, speed: 0 });
}
const fs = (x: number) => (Number.isFinite(x) ? x.toFixed(1) + " s" : "–");
function renderLive() {
  const el = box.querySelector<HTMLElement>("#wr-live");
  if (!el || !ts) return;
  const st = ts.stats();
  const ratio = (live: number, m: number) => (m > 0 && live > 0 ? `<span class="dim">×${(live / m).toFixed(2)}</span>` : "");
  el.innerHTML = `<table>
<tr><td></td><td class="n">last ${V.tsWindow} s</td><td class="n">since reset</td><td class="n">model</td><td></td></tr>
<tr><td title="Damage that counted: each hit capped at the health the body had left">Clear hp/s</td><td class="n">${f0(st.hps)}</td><td class="n">${f0(st.avgHps)}</td><td class="n">${f0(model.area)}</td><td>${ratio(st.avgHps, model.area)}</td></tr>
<tr><td>Kills/s</td><td class="n">${st.kps.toFixed(2)}</td><td class="n">${st.avgKps.toFixed(2)}</td><td class="n">${(model.area / Math.max(1e-6, V.tsHp)).toFixed(2)}</td><td>${ratio(st.avgKps, model.area / Math.max(1e-6, V.tsHp))}</td></tr>
<tr><td title="Bodies hurt in each sim step that had a hit: 1 for a single round, the bodies in it for a blast, a pierce or a pellet spread">Bodies per impact</td><td class="n">${st.perImpact.toFixed(1)}</td><td class="n"></td><td class="n" title="The model's Crowd C: bodies' worth of hp a shot (volley) takes out">C ${f2(model.crowd)}</td><td></td></tr>
<tr><td title="The share of what landed past a body's last hp (wasted on the dead)">Overkill</td><td class="n">${Math.round(st.overkill * 100)}%</td><td class="n"></td><td class="n"></td><td></td></tr>
<tr><td title="From the wave standing up to its last body down (waves only: 'Each stands up after' at 0)">Clear a wave</td><td class="n">${fs(st.clears[st.clears.length - 1] ?? NaN)}</td><td class="n">${fs(st.clearMean)} <span class="dim">(${st.clears.length})</span></td><td class="n">${fs(model.clear)}</td><td>${ratio(model.clear, st.clearMean)}</td></tr>
</table><p class="dim">${st.up}/${st.n} up · ${st.kills} down in ${st.since.toFixed(0)} s · at ${ts.dist ?? V.tsDist} m</p>`;
}
function logRun() {
  if (!ts) return;
  const st = ts.stats();
  log.push({ weapon: weaponLabel(), tier: tierName(), hps: st.avgHps, kps: st.avgKps, perImpact: st.perImpact, clear: st.clearMean, overkill: st.overkill, mArea: model.area, mClear: model.clear, secs: st.since });
  if (log.length > 40) log.shift();
  saveLog();
}
function logTable(): string {
  if (!log.length) return `<p class="dim">No runs logged. Let it run a few waves, then Log this run; switch weapon or tier and log again to compare.</p>`;
  let h = `<table><tr><td>Weapon</td><td>Swarm</td><td class="n">hp/s</td><td class="n">kills/s</td><td class="n">per imp.</td><td class="n">clear</td><td class="n">model hp/s</td></tr>`;
  for (const r of log) h += `<tr><td>${esc(r.weapon)}</td><td>${esc(r.tier)}</td><td class="n">${f0(r.hps)}</td><td class="n">${r.kps.toFixed(2)}</td><td class="n">${r.perImpact.toFixed(1)}</td><td class="n">${fs(r.clear)}</td><td class="n">${f0(r.mArea)}</td></tr>`;
  return h + "</table>";
}

/** Raw (card) DPS against eDPS for every weapon: under the line is what misses, armour and waiting cost it. */
function rawMap(all: Profile[], sel: Profile): string {
  const W = 420, H = 230, L = 34, R = 10, T = 10, B = 24;
  const max = Math.max(...all.map((p) => Math.max(p.card, p.focus))) * 1.05;
  const X = (x: number) => L + (x / max) * (W - L - R), Y = (y: number) => T + (1 - y / max) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let v = 0; v <= max; v += 100) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="${C_GRID}"/><line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C_GRID}"/><text x="${X(v)}" y="${H - 11}" text-anchor="middle">${v}</text><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(max)}" y2="${Y(max)}" stroke="${C_SEL}" stroke-dasharray="2 3"/><text x="${X(max * 0.8)}" y="${Y(max * 0.8) - 5}" style="fill:${C_SEL}">eDPS = raw</text>`;
  for (const p of all) {
    const me = p.id === sel.id;
    s += `<circle cx="${X(p.card)}" cy="${Y(p.focus)}" r="${me ? 5 : 3.2}" fill="${me ? C_SEL : p.slot === "shoulder" ? "#9a958c" : "#e8e4dc"}" opacity="${me ? 1 : 0.75}"><title>${esc(p.name)}: raw ${f0(p.card)}, eDPS ${f0(p.focus)} (${p.focusSet})</title></circle>`;
    if (me) s += `<text x="${X(p.card) + 6}" y="${Y(p.focus) + 3}" style="fill:${C_SEL}">${esc(p.name)}</text>`;
  }
  s += `<text x="${W - R}" y="${H - 1}" text-anchor="end">raw DPS (the item card)</text><text x="2" y="${T + 2}" transform="rotate(90 2 ${T + 2})">eDPS vs its best single</text></svg>`;
  return s;
}

function render() {
  SCALING.armour = state.armour;
  if (allArmour !== state.armour) { all = null; allArmour = state.armour; }
  const base = state.base, item = makeItem(base), p = profileOf(item), cad = itemCadence(item)!;
  all ??= MODELLED.map((id) => profileOf(makeItem(id)));
  const protos = protocolsFor(base), sc = scaleClass(base);
  const bf_ = protos.length ? bestBuilds(base, "focus") : null, ba = protos.length ? bestBuilds(base, "area") : null;
  const full = SCALING.sockets;
  const mine = state.protos.length ? profileOf(itemWith(base, state.protos)) : null;
  const buildF = bf_ ? profileOf(itemWith(base, bf_[full].protos)) : null, buildA = ba ? profileOf(itemWith(base, ba[full].protos)) : null;
  const reach = reachCurve(item), rel = reliabilityCurve(item);
  const mineFA = state.protos.length ? focusArea(itemWith(base, state.protos)) : null;
  const pct = (x: number, cap = 130) => `<span class="${x > cap ? "bad" : x > 100 ? "warn" : ""}">${f0(x)}%</span>`;
  const cls = { area: "area scaler", damage: "damage scaler", even: "even", fixed: "no Protocols fit" }[sc.cls];
  const sounds = SOUNDS[base] ?? [];

  let h = `<div class="wr-head"><b>Weapon review</b><select id="wr-w">${MODELLED.map((id) => `<option value="${id}"${id === base ? " selected" : ""}>${esc(BASE_BY_ID[id].name)}</option>`).join("")}</select><button id="wr-shut">${box.classList.contains("shut") ? "open" : "hide"}</button></div>`;
  h += `<p class="dim">${esc(BASE_BY_ID[base].name)} · ${p.slot === "shoulder" ? "shoulder launcher (key 1)" : `${{ L: "Light", M: "Medium", H: "Heavy" }[p.slot]} weapon`} · level 1 Common, middle rolls.${ROUGH.has(base) ? ` <span class="warn">Rough model: ${MELEE_IDS.includes(base) ? "a sword's walk-in and how long a target stays in reach are guesses (REF.closeSpeed, meleeStick)" : "energy weapons fire on the Rampart's reactor (duty " + f2(wOf(item).duty ?? 1) + " of the time); their hits are simplified"}; not held to the sheet's bands yet.</span>` : ""}</p>`;
  h += `<table>
<tr><td>Card DPS</td><td class="n">${f0(p.card)}</td><td>Damage × rounds × shots/s</td><td class="n">${f0(cad.damage)} × ${cad.rounds} × ${f2(cad.sustained)}</td></tr>
<tr><td>Focus F</td><td class="n">${f0(p.focus)}</td><td>vs its best single (${p.focusSet})</td><td class="n">${pct(p.focusPct)}</td></tr>
<tr><td>Area A</td><td class="n">${f0(p.area)}</td><td>hp/s out of a swarm</td><td class="n">${pct(p.areaPct, base === "flak-medium" ? 230 : 130)}</td></tr>
<tr><td>Crowd C</td><td class="n">${p.crowd.toFixed(1)}</td><td>bodies' worth a shot</td><td class="n">Spend ${pct(p.spend, SCALING.spendCap)}</td></tr>
<tr><td>Reliability</td><td class="n">${f2(p.reliability)}</td><td>at 8 m/s vs still</td><td class="n">Reach ${f0(p.reach)} m</td></tr>
<tr><td>Range</td><td class="n">${f0(p.range)} m</td><td>Shell speed · blast</td><td class="n">${Number.isFinite(p.speed) ? f0(p.speed) + " m/s" : "instant"} · ${p.radius ? p.radius.toFixed(1) + " m" : "–"}</td></tr>
<tr><td>Magazine</td><td class="n">${cad.magazine || "–"}</td><td>Reload</td><td class="n">${cad.reload ? cad.reload.toFixed(1) + " s" : "–"}</td></tr>
<tr><td>Scaling</td><td class="n">${cls}</td><td>Ceilings at ${full} sockets</td><td class="n"><span style="color:${C_FOCUS}">F ×${f2(sc.focusCeil)}</span> · <span style="color:${C_AREA}">A ×${f2(sc.areaCeil)}</span></td></tr>
${mineFA ? `<tr><td>Fitted</td><td class="n" colspan="2">${esc(state.protos.map((x) => PROTOCOL_BY_ID[x].name).join(" + "))}</td><td class="n"><span style="color:${C_FOCUS}">F ×${f2(mineFA.focus / Math.max(1e-6, p.focus))}</span> · <span style="color:${C_AREA}">A ×${f2(mineFA.area / Math.max(1e-6, p.area))}</span></td></tr>` : ""}
</table>`;
  // Keith 2026-11-04: its traits first (what Protocols fit by), then what's fitted, then the Protocol table.
  h += `<h4>Traits <span class="dim">Protocols fit by these</span></h4><div class="chips">${traitsOf(base).map((t) => `<span class="chip" title="${esc(TRAIT_BY_ID[t].text)}">${esc(TRAIT_BY_ID[t].name)}</span>`).join("") || '<span class="dim">none</span>'}</div>`;
  h += `<h4>Fitted Protocols (${state.protos.length}/${full}) <span class="dim">on the weapon the mech fires; + in the Protocol table adds one</span></h4>`;
  h += state.protos.length ? `<div class="chips">${state.protos.map((x, i) => `<button data-del="${i}" title="take it off">${esc(PROTOCOL_BY_ID[x].name)} −</button>`).join("")}<button id="wr-clear">clear all</button></div>` : `<p class="dim">None fitted.${protos.length ? "" : " No Protocol fits this weapon."}</p>`;
  h += `<h4>Armour on the targets: <b>${state.armour < 0 ? "each its own" : state.armour}</b></h4><input id="wr-arm" type="range" min="-1" max="16" step="0.5" value="${state.armour}" style="width:100%"><p class="dim">−1 (far left): cutter 3, excavator 6.5, raider 2, rival mech 8. Otherwise every single target gets this armour (the swarm keeps 0). Every number and chart here follows it.</p>`;
  model = swarmModelNow();
  h += `<h4>Test swarm <span class="dim">clear, on the pen off to the left</span></h4>`;
  h += `<div class="chips"><span class="dim">Demo shoots:</span><button data-tgt="cutouts"${state.target === "cutouts" ? ' style="border-color:var(--accent)"' : ""}>the cutouts</button><button data-tgt="swarm"${state.target === "swarm" ? ' style="border-color:var(--accent)"' : ""}>the test swarm</button></div>`;
  h += `<div class="chips">${TEST_SWARM_TIERS.map((t) => `<button data-tier="${t.id}" title="${esc(t.tip)}"${t.id === state.tier ? ' style="border-color:var(--accent)"' : ""}>${esc(t.name)}</button>`).join("")}${state.tier === "custom" ? '<span class="chip">custom (sliders)</span>' : ""}</div>`;
  h += `<p class="dim">${Math.round(V.tsCount)} bodies · ${V.tsHp} hp · armour ${V.tsArmour} · ${V.tsDensity} a m² · ${["blob", "column at you", "line across"][Math.round(V.tsShape)] ?? "blob"}. More in the Test swarm sliders.</p>`;
  h += `<div id="wr-live"></div>`;
  h += `<div class="chips"><button id="wr-reset">reset counts</button><button id="wr-log">log this run</button><button id="wr-copylog">copy log</button><button id="wr-clearlog">clear log</button></div>`;
  h += logTable();
  h += `<details><summary class="dim">How to read the swarm numbers</summary><p>Clear hp/s is the useful damage: every hit capped at the health the body had left, so overkill doesn't count, and armour is taken off first. Kills/s is that over the body's health. Bodies per impact is how many bodies each sim step with a hit touched (a minigun round about 1, a blast or a rail slug many). The model column is the balance model (src/items/balanceModel.ts) for this same pen standing still: if live and model part a lot, either the weapon or the model is off. The demo aims at the live body nearest the pen's centre and holds the trigger. Fodder is the swarm the budget map's area axis uses (moving at 8 m/s there, so slow shells score lower on the map than here).</p></details>`;
  h += `<details><summary class="dim">What eDPS means</summary><p>Raw DPS is the item card: damage × rounds a shot × shots a second over the magazine (or reactor) and reload. eDPS is what the model expects to land: raw × the share that hits (spread, and lead error from shell speed against a dodging target) × what armour lets through each hit (max(15%, damage − armour × (1 − pierce))) × the time it is firing (spin-up, charge, a sword's walk-in, the reactor running dry). Area eDPS adds what splash, blasts, penetration and chains do to the bodies round the one hit, each capped at that body's hp. Light, fast hits lose most to armour; big hits lose little.</p></details>`;
  h += `<h4>Sounds</h4><div class="chips">${sounds.map((n) => `<button data-snd="${n}">▶ ${n}</button>`).join("")}${p.radius > 0 && (BASE_BY_ID[base].tags.includes("explosive") || p.kind === "lance") ? `<button data-blast="${p.radius}">▶ blast ${p.radius.toFixed(1)} m</button>` : ""}</div>${sounds.length ? "" : `<p class="dim">Miniguns: the sound runs with the spin, so fire to hear it.</p>`}`;
  h += `<h4>Budget map: every weapon (dot), this one in yellow</h4>${budgetMap(all, p, { f: buildF, a: buildA, mine })}<p class="dim">Red: the sheet's 130% caps (flak's swarm 230%, open). Yellow line: proposed Spend = F% + A% ≤ ${SCALING.spendCap}. Arrows: where Protocols take it at ${full} sockets.</p>`;
  if (bf_ && ba) {
    h += `<h4>Protocol scaling: best build by sockets (× the plain weapon)</h4>`;
    h += lineChart({ xs: [0, 1, 2, 3, 4], xLabel: "sockets", yLabel: "×", yMin: 0, series: [
      { pts: bf_.map((b) => [b.n, b.focus]), color: C_FOCUS }, { pts: bf_.map((b) => [b.n, b.area]), color: C_FOCUS, dash: "3 3", width: 1 },
      { pts: ba.map((b) => [b.n, b.area]), color: C_AREA }, { pts: ba.map((b) => [b.n, b.focus]), color: C_AREA, dash: "3 3", width: 1 },
    ] });
    h += `<p><span class="key" style="background:${C_FOCUS}"></span>focus build: ${esc(bf_[full].protos.map((x) => PROTOCOL_BY_ID[x].name).join(", ") || "nothing helps")} &nbsp; <span class="key" style="background:${C_AREA}"></span>area build: ${esc(ba[full].protos.map((x) => PROTOCOL_BY_ID[x].name).join(", ") || "nothing helps")}<br><span class="dim">Solid: the axis the build is for; dashed: what it does to the other one.</span></p>`;
    h += `<h4>Each Protocol stacked (× focus / × area at 1 and 4 sockets); + sockets it on the mech</h4><table>`;
    for (const pr of protos) {
      const st = protocolStack(base, pr.id), one = st[1], four = st[full];
      const col = (x: number) => `<span class="${x > 1.005 ? "ok" : x < 0.995 ? "bad" : "dim"}">×${f2(x)}</span>`;
      h += `<tr><td>${esc(pr.name)}</td><td class="n">${col(one.focus)} / ${col(one.area)}</td><td class="n">${col(four.focus)} / ${col(four.area)}</td><td class="n"><button data-add="${pr.id}">+</button></td></tr>`;
    }
    h += `</table><p class="dim">${state.protos.length}/${full} fitted (repeats allowed; the lab ignores the item's own sockets). A fifth replaces the oldest.</p>`;
  } else h += `<h4>Protocol scaling</h4><p class="dim">No Protocol fits this weapon yet: it doesn't scale with sockets (only with level, like everything).</p>`;
  const arm = armourCurve(item);
  h += `<h4>Raw DPS vs eDPS: every weapon</h4>${rawMap(all, p)}<p class="dim">The further under the line, the more it loses to misses, armour and waiting.</p>`;
  h += `<h4>Armour: raw and eDPS on the rival mech (standing, ${relDist(wOf(item))} m) by its armour</h4>${lineChart({ xs: SCALING.armours, xLabel: "armour", yLabel: "DPS", yMin: 0, series: [
    { pts: arm.map((r) => [r.a, p.card]), color: "#e8e4dc", dash: "4 3", width: 1 }, { pts: arm.map((r) => [r.a, r.e]), color: C_FOCUS },
  ], marks: state.armour >= 0 ? [{ x: state.armour, label: "slider" }] : [{ x: 8, label: "rival 8" }] })}<p class="dim">Dashed: raw. Solid: eDPS. Pierce ${f2(wOf(item).ap)}.</p>`;
  h += `<h4>Reach: eDPS vs the rival mech by distance</h4>${lineChart({ xs: SCALING.distances.filter((_, i) => i % 2 === 0), xLabel: "metres", yLabel: "eDPS", series: [
    { pts: reach.map((r) => [r.d, r.still]), color: C_FOCUS, dash: "4 3", width: 1.5 }, { pts: reach.map((r) => [r.d, r.moving]), color: C_FOCUS },
  ], marks: [{ x: Math.min(p.range, 110), label: "range" }] })}<p class="dim">Solid: the rival juking at 6 m/s; dashed: standing still. The gap is lead error from shell speed.</p>`;
  h += `<h4>Reliability: share kept against a moving mech</h4>${lineChart({ xs: SCALING.speeds, xLabel: "target speed m/s", yLabel: "share", yMin: 0, yMax: 1.05, series: [{ pts: rel.map((r) => [r.v, r.r]), color: C_AREA }] })}`;
  h += `<p class="dim">Formulas in src/items/weaponScaling.ts; the model (hit chance, blasts, armour, magazines) is the balance sheet's, src/items/balanceModel.ts. Budget ${REF.budget} eDPS a Medium mount.</p>`;
  box.innerHTML = h;

  box.querySelector<HTMLSelectElement>("#wr-w")!.onchange = (e) => { state.base = (e.target as HTMLSelectElement).value; state.protos = []; refit(); render(); };
  box.querySelector<HTMLButtonElement>("#wr-shut")!.onclick = () => { box.classList.toggle("shut"); render(); };
  box.querySelector<HTMLButtonElement>("#wr-clear")?.addEventListener("click", () => { state.protos = []; refit(); render(); });
  box.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => (b.onclick = () => { state.protos.splice(Number(b.dataset.del), 1); refit(); render(); }));
  box.querySelector<HTMLInputElement>("#wr-arm")!.onchange = (e) => { state.armour = Number((e.target as HTMLInputElement).value); render(); };
  box.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((b) => (b.onclick = () => {
    if (state.protos.length >= full) state.protos.shift();
    state.protos.push(b.dataset.add!); refit(); render();
  }));
  box.querySelectorAll<HTMLButtonElement>("[data-tgt]").forEach((b) => (b.onclick = () => { state.target = b.dataset.tgt as "cutouts" | "swarm"; refit(); render(); }));
  box.querySelectorAll<HTMLButtonElement>("[data-tier]").forEach((b) => (b.onclick = () => { applyTier(b.dataset.tier!); refit(); render(); }));
  box.querySelector<HTMLButtonElement>("#wr-reset")!.onclick = () => { ts?.reset(); renderLive(); };
  box.querySelector<HTMLButtonElement>("#wr-log")!.onclick = () => { logRun(); render(); };
  box.querySelector<HTMLButtonElement>("#wr-clearlog")!.onclick = () => { log = []; saveLog(); render(); };
  box.querySelector<HTMLButtonElement>("#wr-copylog")!.onclick = () => {
    const rows = log.map((r) => [r.weapon, r.tier, r.hps.toFixed(0), r.kps.toFixed(2), r.perImpact.toFixed(1), Number.isFinite(r.clear) ? r.clear.toFixed(1) : "", (r.overkill * 100).toFixed(0), r.mArea.toFixed(0), Number.isFinite(r.mClear) ? r.mClear.toFixed(1) : "", r.secs.toFixed(0)].join("\t"));
    void navigator.clipboard?.writeText(["weapon\tswarm\thp/s\tkills/s\tper impact\tclear s\toverkill %\tmodel hp/s\tmodel clear s\tseconds", ...rows].join("\n"));
  };
  box.querySelectorAll<HTMLButtonElement>("[data-snd]").forEach((b) => (b.onclick = () => playName(b.dataset.snd!)));
  box.querySelectorAll<HTMLButtonElement>("[data-blast]").forEach((b) => (b.onclick = () => playBlast(bf.sfx, spot(), Number(b.dataset.blast), V)));
  renderLive();
}

refit();
render();
