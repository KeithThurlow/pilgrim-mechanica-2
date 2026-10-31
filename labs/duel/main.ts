// Duel lab (Keith 2026-10-29: "another lab where we can really hone in fighting a harder enemy, another rival mech,
// and make that feel scary ... that mech spawns with random weapons, and we can test how our loadout feels against
// it"). The first piece of factions step 5 (rival military, docs/proposal-factions.md).
//
// One rival Rampart in clean military paint, its loadout rolled from the item tables (src/combat/rivalKit.ts) and
// fitted through the bay's rules, driven by an AI that sends the same commands the player's mech takes
// (src/combat/rivalAi.ts). An arena of flattened desert with sand drifts banked against big steel wrecks for cover
// (src/game/duelGround.ts). Both mechs take damage; a round ends on a kill and restarts (R, or by itself after
// duelAutoRestart); the board keeps each round's time to kill and the damage both ways by weapon.
//
// URL flags: ?rival=seed (which rival; Reroll steps to the next), ?rivalfit=slot:base[:rarity],... (fit these over
// the roll, as the loadout lab's ?fit=), ?left= ?right= ?k1= ?k2= ?k3= (your weapons, as the weapons lab; else the
// loadout lab's bay save if there is one, else the weapons lab's last pick), ?bay (use the loadout lab's bay save),
// ?rivallevel=recruit|veteran|ace (the rival's preset; Recruit by default; buttons in the panel), plus the combat lab flags (?manual ?zoom ?dt ?flat ?time=).
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { combatLab } from "../../src/game/combatLab";
import { typing } from "../../src/core/input";
import { MechUnit } from "../../src/game/mechUnit";
import { mechOwner } from "../../src/game/registerOwners";
import { applyLoadout } from "../../src/game/loadoutApply";
import { Arsenal, type Shoulder } from "../../src/weapons/arsenal";
import { ArsenalDraw } from "../../src/weapons/arsenalDraw";
import { addModifier } from "../../src/world/modifiers";
import { WreckStandIns } from "../../src/world/wrecks";
import type { RampartBody } from "../../src/mech/rampart";
import { DuelGround, DUEL_GROUND_DEFAULTS, DUEL_GROUND_PARAMS, lineOfSight, wreckSpots } from "../../src/game/duelGround";
import { RivalAi, RIVAL_AI_DEFAULTS, RIVAL_AI_PARAMS, RIVAL_LEVELS, RIVAL_LEVEL_IDS, type MechCommand, type RivalLevel } from "../../src/combat/rivalAi";
import { applyFitSpec, describeLoadout, kitOf, preferredRange, rollRivalLoadout, type KitWeapon } from "../../src/combat/rivalKit";
import { ThreatIds, duelView, threatsFrom } from "../../src/combat/duelThreats";
import { DuelScore, type Side } from "../../src/combat/duelScore";
import { LOOT_DEFAULTS, LOOT_PARAMS } from "../../src/items/generate";
import { resolve, LOADOUT_DEFAULTS, type Loadout } from "../../src/items/loadout";
import { ROWS, choose, cleanPick, loadoutFor, pickFromParams, type Pick } from "../../src/items/weaponPick";
import { loadBay } from "../../src/ui/bay";
import type { Param } from "../../src/core/tweaks";

const DUEL_DEFAULTS = { rivalHull: RIVAL_LEVELS.recruit.rivalHull, duelAutoRestart: 3.5 };
const DUEL_PARAMS: Param[] = [
  { key: "rivalHull", label: "Rival hull (× its parts')", min: 0.25, max: 4, step: 0.05, group: "Rival", tip: "Its hull points from the rolled hull item, times this" },
  { key: "duelAutoRestart", label: "Next round after a kill (s, 0: R only)", min: 0, max: 15, step: 0.5, group: "Rival" },
];
/** Rival military: one clean uniform colour (the bandits are red). */
const RIVAL_PAINT = 0x56636f;
const PICK_KEY = "pm2:weapons-lab:pick3", BAY_KEY = "pm2:loadout-lab:bay", RIVAL_KEY = "pm2:duel-lab:rival";

let ground: DuelGround | null = null;
let rivalBody: RampartBody | null = null;
let rivalArsenal: Arsenal | null = null;
let wrecks: WreckStandIns | null = null;
const lab = await combatLab({
  id: "duel-lab",
  title: "Duel",
  defaults: { ...DUEL_GROUND_DEFAULTS, ...RIVAL_AI_DEFAULTS, ...DUEL_DEFAULTS, ...LOOT_DEFAULTS, ...LOADOUT_DEFAULTS },
  params: [...RIVAL_AI_PARAMS, ...DUEL_PARAMS, ...DUEL_GROUND_PARAMS, ...LOOT_PARAMS],
  topics: [
    { id: "rival", label: "Rival", groups: ["Rival AI", "Rival", "Loot rolls"] },
    { id: "arena", label: "Arena", groups: ["Duel arena"] },
  ],
  selectables: [
    { topic: "rival", label: "Rival", objects: () => { if (!rivalBody) return []; const r = rivalBody.regions(); return [...r.legs, ...r.hull, ...r.gunLeft, ...r.gunRight, ...(rivalArsenal?.meshes() ?? [])]; } },
    { topic: "arena", label: "Cover", objects: () => wrecks?.meshes ?? [] },
  ],
  actions: [...RIVAL_LEVEL_IDS.map((id) => ({ label: id[0].toUpperCase() + id.slice(1), onClick: () => setLevel(id) })), { label: "Reroll rival", onClick: () => reroll(1) }, { label: "Restart (R)", onClick: () => startRound() }],
  setup: (field, V) => { ground = new DuelGround(V); addModifier(field, ground); },
  wrecks: (field, V) => (wrecks = new WreckStandIns(field, wreckSpots(ground!.spots, V))),
  report: (): Record<string, unknown> => ({ rivalSeed, rivalfit: fitSpec, rivalState: ai.state, ...score.tally() }),
  onChange: (k) => {
    if (k in DUEL_GROUND_DEFAULTS && k !== "duelStart") {
      ground!.rebuild();
      lab.field.update(); lab.craters.invalidate(); lab.streamer.rebuildAll();
      wrecks?.rebuild(lab.field, wreckSpots(ground!.spots, V));
    } else if (k === "rivalHull") fitRival();
    else if (!RESOLVED.has(k)) (RV as Record<string, number>)[k] = (V as Record<string, number>)[k];
  },
});
const { V, bf, player, app, field, toon } = lab;
const params = app.params;

// ---- The rival: its own tuning values (its parts change them), body, weapons and brain ----
const RV = { ...V };
const RESOLVED = new Set(Object.keys(resolve(rollRivalLoadout(1, LOOT_DEFAULTS)).values));
const body = await lab.loadRampart();
rivalBody = body;
app.scene.add(body.root);
const rival = new MechUnit(bf, RV, body, toon, 2, 20, false);
rival.paint = RIVAL_PAINT;
body.paint(toon, RIVAL_PAINT);
bf.targets.push(rival);
bf.register.add(mechOwner("rival", () => [rival]));
const foeCandidate = () => ({ x: player.sim.pelvis.x, y: player.sim.pelvis.y + 0.6, z: player.sim.pelvis.z, r: V.hitRadius, key: "foe", vx: player.sim.vel.x, vz: player.sim.vel.z });
rivalArsenal = new Arsenal(bf, rival, RV, toon, () => (player.alive ? [foeCandidate()] : []));
rivalArsenal.findTarget = (key) => (key === "foe" && player.alive ? foeCandidate() : null);
rival.weapons = rivalArsenal;
const rivalDraw = new ArsenalDraw(rivalArsenal, field);
app.scene.add(rivalDraw.group);
const ai: RivalAi = new RivalAi(V, 1);
const ids = new ThreatIds();
let kit: KitWeapon[] = [];
let rivalLo: Loadout | null = null;
let rivalSeed: number = Math.max(1, Math.round(Number(params.get("rival")) || 0)) || (() => { try { return Number(localStorage.getItem(RIVAL_KEY)) || 1; } catch { return 1; } })();
const fitSpec = params.get("rivalfit") ?? "";
let fitNotes: string[] = [];

function fitRival() {
  rivalLo = rollRivalLoadout(rivalSeed, V);
  fitNotes = fitSpec ? applyFitSpec(rivalLo, fitSpec, V, rivalSeed) : [];
  const r = resolve(rivalLo, V);
  rival.hullOverride = Math.round(r.values.hull * V.rivalHull);
  applyLoadout(rival, r);
  kit = kitOf(r, RV);
  ai.reset();
  board();
}
/** A rival level: its preset over the AI sliders and the hull share (the sliders stay free to change after). */
function setLevel(id: RivalLevel) {
  const p = RIVAL_LEVELS[id] as Record<string, number>;
  for (const k of Object.keys(p)) { (V as Record<string, number>)[k] = p[k]; (RV as Record<string, number>)[k] = p[k]; }
  lab.refresh();
  fitRival();
  noteLevel = id;
}
let noteLevel = "recruit";
function reroll(step: number) {
  rivalSeed = Math.max(1, rivalSeed + step);
  try { localStorage.setItem(RIVAL_KEY, String(rivalSeed)); } catch { /* private window */ }
  fitRival();
  startRound();
}

// ---- Your mech: the weapons lab's picker, or the loadout lab's bay save ----
const pick: Pick = { left: "minigun", right: "rpg", k1: "missiles", k2: "none", k3: "mortar" };
try { Object.assign(pick, JSON.parse(localStorage.getItem(PICK_KEY) || "{}")); cleanPick(pick); } catch { /* no saved pick */ }
const urlPick = pickFromParams(pick, params);
if (urlPick) cleanPick(pick);
const bayLo = loadBay(BAY_KEY)?.loadout ?? null;
let useBay = !!bayLo && (params.has("bay") || !urlPick);
function refit() {
  applyLoadout(player, resolve(useBay && bayLo ? bayLo : loadoutFor(pick), V));
  // The rival's tuning follows the shared sliders the loadout doesn't set.
  lab.refresh();
  for (const b of pickButtons) b.el.classList.toggle("on", !useBay && (pick as unknown as Record<string, string>)[b.row] === b.id);
  bayBtn.classList.toggle("on", useBay);
  if (!useBay) try { localStorage.setItem(PICK_KEY, JSON.stringify({ ...pick, protos: undefined })); } catch { /* private window */ }
}

const style = document.createElement("style");
style.textContent = `
.wpick { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 5; display: flex; flex-direction: column; gap: 3px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; max-width: calc(100vw - 20px); }
.wpick-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.wpick-row span { color: var(--muted); font-size: 12px; width: 42px; }
.wpick button, .duel-box button { background: #1f2226; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px; font: 12px var(--sans); cursor: pointer; }
.wpick button.on { border-color: var(--accent); color: var(--accent); }
.duel-bars { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); z-index: 5; display: grid; grid-template-columns: auto 220px auto; gap: 3px 8px;
  align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; font: 12px var(--mono); color: var(--fg); }
.duel-bars .bar { height: 8px; background: #2a2d32; border-radius: 3px; overflow: hidden; }
.duel-bars .bar i { display: block; height: 100%; background: var(--ok); transition: width 0.1s; }
.duel-bars .bar.rival i { background: var(--bad); }
.duel-bars .note { grid-column: 1 / -1; color: var(--muted); text-align: center; }
.duel-box { position: fixed; left: 10px; bottom: 84px; z-index: 5; width: 330px; max-height: 45vh; overflow: auto; background: var(--panel); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 9px; font: 12px var(--sans); color: var(--fg); }
.duel-box .muted { color: var(--muted); }
.duel-box .row { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.duel-box ul { margin: 2px 0 6px; padding-left: 14px; }
@media (max-width: 899px) { .duel-box { display: none; } }
`;
document.head.appendChild(style);
const bar = document.createElement("div");
bar.className = "wpick";
const pickButtons: { row: string; id: string; el: HTMLButtonElement }[] = [];
for (const [row, label, opts] of ROWS) {
  const r = document.createElement("div");
  r.className = "wpick-row";
  const l = document.createElement("span"); l.textContent = label; r.appendChild(l);
  for (const [id, name] of Object.entries(opts)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = name;
    b.addEventListener("click", () => { useBay = false; choose(pick, row, id); refit(); });
    r.appendChild(b);
    pickButtons.push({ row, id, el: b });
  }
  bar.appendChild(r);
}
const bayRow = document.createElement("div");
bayRow.className = "wpick-row";
const bayBtn = document.createElement("button");
bayBtn.type = "button";
bayBtn.textContent = bayLo ? "Use the loadout lab's bay" : "No bay saved (loadout lab)";
bayBtn.disabled = !bayLo;
bayBtn.addEventListener("click", () => { useBay = !useBay; refit(); });
bayRow.append(document.createElement("span"), bayBtn);
bar.appendChild(bayRow);
document.body.appendChild(bar);

// Health bars and the rival's state, top middle.
const bars = document.createElement("div");
bars.className = "duel-bars";
bars.innerHTML = `<span>you</span><div class="bar"><i></i></div><span class="hp"></span><span>rival</span><div class="bar rival"><i></i></div><span class="hp"></span><span class="note"></span>`;
document.body.appendChild(bars);
const [barYou, barRival] = [...bars.querySelectorAll<HTMLElement>(".bar i")];
const [hpYou, hpRival] = [...bars.querySelectorAll<HTMLElement>(".hp")];
const noteEl = bars.querySelector<HTMLElement>(".note")!;

// The rival's loadout and the scoreboard, bottom left.
const box = document.createElement("div");
box.className = "duel-box";
document.body.appendChild(box);
const KIND_NAME: Record<string, string> = { minigun: "minigun", rail: "rail cannon", autocannon: "autocannon", rpg: "rocket launcher", shrpg: "shoulder rocket", mortar: "big mortar", linemortar: "line mortar", missiles: "missile pod" };
function board() {
  if (!rivalLo) return;
  const ctl = (k: KitWeapon) => ("trigger" in k.ctl ? (k.ctl.trigger === 0 ? "L" : "R") : `key ${k.ctl.key}`);
  box.innerHTML = `<div class="row"><b>Rival ${rivalSeed}</b><button data-a="prev">◀</button><button data-a="next">Reroll ▶</button></div>`
    + `<div class="muted">${kit.map((k) => `${ctl(k)} ${KIND_NAME[k.kind]}`).join(" · ")} · likes ${Math.round(V.aiRange || preferredRange(kit))} m · hull ${rival.maxHealth}</div>`
    + `<ul>${describeLoadout(rivalLo).map((l) => `<li>${l}</li>`).join("")}</ul>`
    + (fitNotes.length ? `<div class="muted">?rivalfit: ${fitNotes.join("; ")}</div>` : "")
    + `<div class="score"></div>`;
  box.querySelector<HTMLButtonElement>('[data-a="prev"]')!.onclick = () => reroll(-1);
  box.querySelector<HTMLButtonElement>('[data-a="next"]')!.onclick = () => reroll(1);
}

// ---- Rounds and the score ----
const score = new DuelScore();
let clock = 0, roundStart = 0, roundOver = -1;
function startRound() {
  const S = V.duelStart;
  player.reset(0, -S, 0);
  rival.reset(0, S, Math.PI);
  player.upper.resupply(); rival.upper.resupply();
  rival.dash.charges = Math.round(RV.dashCharges);
  player.dash.charges = Math.round(V.dashCharges);
  ai.reset();
  roundStart = clock; roundOver = -1;
  score.start(clock, String(rivalSeed));
}
addEventListener("keydown", (e) => { if (e.code === "KeyR" && !e.repeat && !typing(e)) startRound(); });

// Who hurt whom with what: each weapon's work runs inside a tag (the arsenal's rail, shells, rockets and shoulders, the
// battlefield's lobbed shells); what lands outside any is the miniguns' rounds (resolved with the battlefield's shots).
let tag: string | null = null;
type Fn = (...a: unknown[]) => unknown;
const within = (obj: object, name: string, kind: (args: unknown[]) => string) => {
  const o = obj as Record<string, Fn>, f = o[name].bind(obj);
  o[name] = (...args: unknown[]) => { const prev = tag; tag = kind(args); try { return f(...args); } finally { tag = prev; } };
};
for (const a of [lab.arsenal, rivalArsenal]) {
  within(a, "fireRail", () => "rail");
  within(a.shells, "update", () => "autocannon");
  within(a.rockets, "update", () => "rocket");
  within(a, "stepShoulder", (args) => { const w = (args[0] as Shoulder).weapon; return w === "rpg" ? "rocket" : w === "mortar" ? "mortar" : w; });
}
within(bf.shells, "update", () => "mortar");
const ledger = (u: MechUnit, victim: Side) => {
  const hurt = u.damage.bind(u);
  u.damage = (amount, at, dir) => {
    const h0 = u.health;
    hurt(amount, at, dir);
    if (roundOver < 0) score.hit(victim, tag ?? "minigun", h0 - Math.max(0, u.health), clock);
  };
};
ledger(player, "player");
ledger(rival, "rival");

// ---- Each frame: the rival's view, its commands, its step ----
const cursor = new THREE.Vector3();
const sees = (ax: number, az: number, bx: number, bz: number) => lineOfSight((x, z) => field.height(x, z), ground!.spots, ax, az, bx, bz);
let last: MechCommand | null = null;
lab.onFrame((dt: number) => {
  clock += dt;
  const t = clock - roundStart;
  const threats = threatsFrom(lab.arsenal, player.team, bf.shells, V, ids);
  const view = duelView(t, rival, kit, rivalArsenal!, player, threats, ground!.spots, sees, { x: 0, z: 0, r: V.duelRadius });
  const cmd = rival.alive ? ai.decide(view, dt) : null;
  last = cmd;
  rival.keys = cmd ? cmd.keys : [false, false, false, false];
  rival.cursor = cmd?.cursor ? cursor.set(cmd.cursor.x, field.height(cmd.cursor.x, cmd.cursor.z), cmd.cursor.z) : null;
  rival.lock = cmd?.lock ?? null;
  rival.dashHold = !!cmd?.dashHold;
  if (cmd?.dash) rival.tryDash(cmd.dash.x, cmd.dash.z);
  rival.step(dt, cmd?.move ?? { x: 0, z: 0, sprint: false }, cmd?.aim ?? null, cmd?.trigger ?? false, cmd?.shotAt ?? null);
  // (Magazines reload by themselves since 2026-10-31: no more topping the rival up.)
  rivalDraw.update();

  // A kill ends the round; the next starts after duelAutoRestart (or R).
  if (roundOver < 0 && (!rival.alive || !player.alive)) {
    roundOver = clock;
    score.end(clock, rival.alive ? "rival" : "player");
  }
  if (roundOver >= 0 && V.duelAutoRestart > 0 && clock - roundOver > V.duelAutoRestart) startRound();

  // Bars, the rival's state, the board.
  barYou.style.width = `${(100 * Math.max(0, player.health)) / player.maxHealth}%`;
  barRival.style.width = `${(100 * Math.max(0, rival.health)) / rival.maxHealth}%`;
  hpYou.textContent = `${Math.max(0, Math.round(player.health))}`;
  hpRival.textContent = `${Math.max(0, Math.round(rival.health))}`;
  noteEl.textContent = roundOver >= 0 ? `${rival.alive ? "it killed you" : "you killed it"} in ${(roundOver - roundStart).toFixed(1)} s · R for the next round`
    : `rival: ${ai.state} · ${ai.note}`;
  const sc = box.querySelector<HTMLElement>(".score");
  if (sc) sc.innerHTML = score.lines(clock).join("<br>");
  const st = ai.stats;
  lab.hud("rival", `rival ${noteLevel} ${ai.state} · dodges ${st.dodgeDashes} dashed, ${st.dodgeWalks} walked of ${st.threatsSeen} seen · dash ${rival.dash.charges}${last?.keys.some(Boolean) ? " · painting" : ""}`);
});

const urlLevel = params.get("rivallevel");
if (urlLevel && (RIVAL_LEVEL_IDS as string[]).includes(urlLevel)) setLevel(urlLevel as RivalLevel);
fitRival();
refit();
startRound();
