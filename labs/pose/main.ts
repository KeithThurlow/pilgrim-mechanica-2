// Pose lab (Keith 2026-11-01: "a lab where you select your weapon ... attack with that weapon ... listen to the sound
// of that weapon hitting things ... a dummy ... grab something and use like a gizmo and rotate things ... adjust
// animations at various different points ... a pause"). One weapon in the left arm (or both), steel dummies and a few
// cutouts close by (Tab locks one, so the sword lunges and cuts at it), and two modes:
// - Play: the mech as in any combat lab. P (or Pause) freezes the sword where it is and goes to Pose.
// - Pose: the mech stands still and the sword is held at a point of a move: pick the move, scrub its time, or jump
//   to one of its keys (rest, the drive in, the cut's start, middle and end, where it ends up). On a key, a gizmo
//   grabs it: G moves the hand, T turns the blade, E swings the elbow. Close and far: a cut's keys have a form for
//   the close cut and one for the full sweep; the Reach buttons pick which is shown and posed.
// What's posed is kept in this browser and goes out with "Copy pose" (JSON on the clipboard, for chat) and with every
// Report. Applying it as the default: paste the JSON into SWORD_POSES (src/weapons/swordPoses.ts).
// Only swords pose for now; any weapon plays.
//
// URL flags: ?w=sword|buster|shortsword|minigun|... (the weapon; the weapons lab's names), ?both (the same in both
// arms), ?pose[=key] (start posing, on that key: rest, drive, aStart, aMid, aEnd, under, bStart, bMid, bEnd, cock,
// preRest, block, recoil), ?close (the close cut's form), ?dunes (dunes instead of flat ground), plus the combat-lab flags.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Param } from "../../src/core/tweaks";
import { copyText } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { KIND, FLAG } from "../../src/game/register";
import { listOwner } from "../../src/game/registerOwners";
import type { Hittable } from "../../src/game/battlefield";
import type { MoveCommand } from "../../src/mech/walker";
import type { Aim, Trigger } from "../../src/mech/upper";
import { applyLoadout } from "../../src/game/loadoutApply";
import { DummyRange, DUMMY_DEFAULTS, DUMMY_PARAMS, type Dummy } from "../../src/game/dummies";
import { DummiesDraw } from "../../src/game/dummiesDraw";
import { resolve, LOADOUT_DEFAULTS } from "../../src/items/loadout";
import { SIDE, loadoutFor, type Pick, type SidePick } from "../../src/items/weaponPick";
import { armIk, clipLength, clipPose, keyTime, type SwordClip, type SwordStats } from "../../src/weapons/sword";
import { SWORD_KEYS, SWORD_POSES, livePoses, poseKey, posesFor, setLivePose, setLivePoses, type KeyPose, type P3, type PoseSet } from "../../src/weapons/swordPoses";

const POSE_DEFAULTS = { posePlaySpeed: 0.25, poseGizmo: 0.7, poseOrbitDist: 9 };
const G = "Pose lab";
const POSE_PARAMS: Param[] = [
  { key: "posePlaySpeed", label: "Play the move at (× real time)", min: 0.02, max: 1, step: 0.01, group: G, tip: "Pose mode's ▶: the held move plays at this speed, looping" },
  { key: "poseGizmo", label: "Gizmo size", min: 0.2, max: 2, step: 0.05, group: G },
  { key: "poseOrbitDist", label: "Pose camera distance (m)", min: 3, max: 30, step: 0.5, group: G, tip: "Where the orbit camera starts when you go to Pose (scroll zooms)" },
];
const KEY_STORE = "pm2:pose-lab:poses", KEY_STATE = "pm2:pose-lab:state";
const NAMES: Record<string, string> = { "sword-light": "Breaker sword", "sword-heavy": "Buster sword", "sword-short": "Short sword" };
const CLIPS: [SwordClip, string][] = [["guard", "Rest"], ["A", "Cut 1"], ["B", "Cut 2"], ["R", "Return"], ["S", "Settle"], ["P", "Block"], ["K", "Recoil"]];

const params = new URLSearchParams(location.search);
// The lab's state: the weapon, both arms, the reach shown.
const state = { w: "sword" as SidePick, both: false, close: false };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY_STATE) || "{}")); } catch { /* none saved */ }
if (params.get("w") && params.get("w")! in SIDE) state.w = params.get("w") as SidePick;
if (params.has("both")) state.both = true;
if (params.has("close")) state.close = true;
if (!(state.w in SIDE)) state.w = "sword";
try { setLivePoses(JSON.parse(localStorage.getItem(KEY_STORE) || "{}")); } catch { /* none saved */ }

type DemoOut = { cmd: MoveCommand; aim: Aim | null; trigger: Trigger; keys?: boolean[]; lock?: TargetCandidate | null };
let draw: DummiesDraw | null = null;
let driveFn: ((t: number, dt: number) => DemoOut | null) | null = null;
let demoFn: ((t: number, dt: number) => DemoOut) | null = null;

const lab = await combatLab({
  id: "pose-lab",
  title: "Weapon poses",
  defaults: { ...POSE_DEFAULTS, ...DUMMY_DEFAULTS, dummyHealth: 6000, dummyRespawn: 1.5, cutoutHealth: 400, ...LOADOUT_DEFAULTS },
  params: [...POSE_PARAMS, ...DUMMY_PARAMS],
  topics: [{ id: "pose", label: "Pose lab", groups: [G, "Target dummies"] }],
  selectables: [{ topic: "pose", label: "Dummies", objects: () => draw?.meshes() ?? [] }],
  // Flat ground by default, so the feet and the blade read against a level floor (?dunes for the dunes).
  setup: (field, V) => { if (!params.has("dunes")) { field.v = { ...V, height: 0, swell: 0, bumps: 0 }; field.update(); } },
  demo: (t, dt) => demoFn?.(t, dt) ?? null,
  drive: (t, dt) => driveFn?.(t, dt) ?? null,
  report: () => ({ weapon: state.w, both: state.both, mode, hold: { ...hold }, key: keySel, poses: livePoses() }),
  onChange: (k) => { if (k in DUMMY_DEFAULTS && k !== "dpsWindow") { rng.build(); dd.rebuild(); sync(); } },
});
const { V, player, bf, app, arsenal, iso } = lab;
const { scene, camera } = app;
const canvas = app.renderer.domElement;

// ---- The weapon: in the left arm (or both), through the loadout like the weapons lab ----
function refit() {
  const pick: Pick = { left: state.w, right: state.both ? state.w : "minigun", k1: "none", k2: "none", k3: "pack" };
  applyLoadout(player, resolve(loadoutFor(pick), V));
  lab.refresh();
  saveState();
  render();
}
function saveState() { try { localStorage.setItem(KEY_STATE, JSON.stringify(state)); } catch { /* private window */ } }
player.reset(0, 0, 0);

// ---- The dummies: a steel post close in (a close cut), one further out (the lunge and the full sweep), cutouts to cleave ----
const rng = new DummyRange(V, [{ x: 0, z: 7.5 }, { x: -7, z: 19 }, { x: 3.2, z: 8.5, light: true }, { x: -3.2, z: 8.5, light: true }, { x: 5, z: 6, light: true }]);
const dd = new DummiesDraw(rng, lab.toon);
draw = dd;
scene.add(dd.group);
let registered: Hittable[] = [];
function sync() {
  const keep = bf.targets.filter((t) => !registered.includes(t));
  bf.targets.splice(0, bf.targets.length, ...keep, ...rng.dummies);
  registered = [...rng.dummies];
}
sync();
bf.register.add(listOwner("dummies", () => rng.dummies, (reg, d, k, s) =>
  reg.put(k, s, KIND.Prop, d.team, FLAG.Hittable | (d.light ? FLAG.Light : 0), d.x, d.y + d.height * 0.6, d.z, d.radius + 0.4)));
const asLock = (d: Dummy): TargetCandidate => ({ x: d.x, y: d.y + d.height * 0.6, z: d.z, r: d.radius, key: d });
let lastHit = "";
let hitAt = 0, clock = 0;

// ---- The demo (until you touch anything): cut at the near post, a burst of two, a pause ----
demoFn = (t) => {
  const d = rng.dummies.find((x) => x.alive && !x.light) ?? rng.dummies[0];
  const lock = asLock(d);
  return { cmd: { x: 0, z: 0, sprint: false }, aim: { x: lock.x, y: lock.y, z: lock.z }, trigger: [t % 3.5 < 1.2, false], lock };
};

// ---- Pose mode: the mech frozen, the sword held ----
let mode: "play" | "pose" = "play";
const hold = { clip: "guard" as SwordClip, t: 0, span: 1 };
let keySel: string | null = null;
let playing = false;
let frozenAim: Aim | null = null;
let tool: "hand" | "blade" | "elbow" = "hand";
const swordSide = () => arsenal.swordStatsOf(0) ? 0 : arsenal.swordStatsOf(1) ? 1 : -1;
const isSword = () => swordSide() >= 0;
arsenal.swordHold = (side) => (mode === "pose" && (side === 1 || state.both) ? { clip: hold.clip, t: hold.t, span: hold.span } : null);
driveFn = () => (mode === "pose" ? { cmd: { x: 0, z: 0, sprint: false }, aim: frozenAim, trigger: false, keys: [false, false, false, false] } : null);

const orbit = new OrbitControls(camera, canvas);
orbit.enabled = false;
orbit.enableDamping = false;
const gizmo = new TransformControls(camera, canvas);
gizmo.setSpace("local");
const gizmoHelper = gizmo.getHelper();
scene.add(gizmoHelper);
gizmo.addEventListener("dragging-changed", (e) => { orbit.enabled = mode === "pose" && !(e as unknown as { value: boolean }).value; });
// The grabbed things: a handle at the hand (move it, or turn it for the blade) and one at the elbow. They hang in the
// hull's frame, where a sword's pose is.
const handle = new THREE.Object3D(), elbowHandle = new THREE.Object3D();
const elbowDot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb040, depthTest: false, transparent: true, opacity: 0.85 }));
elbowDot.renderOrder = 10;
elbowHandle.add(elbowDot);
const hullGroup = () => (player.body as { hullGroup?: () => THREE.Object3D }).hullGroup?.() ?? null;

function enterPose(fromNow: boolean) {
  if (mode === "pose") return;
  mode = "pose";
  playing = false;
  const i = Math.max(0, swordSide()), fr = arsenal.swordFrame[i];
  // Pause: hold the sword where it is now; else on the selected (or rest) key.
  if (fromNow && fr) { hold.clip = fr.clip; hold.t = fr.t; hold.span = fr.span; snap(); }
  else { hold.span = state.close ? 0 : 1; }
  state.close = hold.span < 0.5;
  const c = player.cursor;
  frozenAim = c ? { x: c.x, y: c.y + 1.2, z: c.z } : (() => { const d = asLock(rng.dummies[0]); return { x: d.x, y: d.y, z: d.z }; })();
  // The orbit camera: from ahead and to the left of the mech, looking at the hull.
  iso.enabled = false;
  orbit.enabled = true;
  const p = player.sim.pelvis, h = player.sim.heading, dist = V.poseOrbitDist;
  orbit.target.set(p.x, p.y + 0.8, p.z);
  camera.position.set(p.x + Math.sin(h + 0.7) * dist, p.y + dist * 0.35, p.z + Math.cos(h + 0.7) * dist);
  orbit.update();
  render();
}
function enterPlay() {
  if (mode === "play") return;
  mode = "play";
  playing = false;
  orbit.enabled = false;
  iso.enabled = true;
  gizmo.detach();
  render();
}

/** Select the key the hold sits on (within a hair) and sit on it exactly; or none. */
function snap() {
  keySel = keyAt();
  const st = stats(), k = SWORD_KEYS.find((q) => q.name === keySel);
  if (st && k) hold.t = keyTime(k.clip, k.name, st, V, hold.span) ?? hold.t;
}
/** The key the hold sits on now (within a hair), or null. */
function keyAt(): string | null {
  const st = stats();
  if (!st) return null;
  const len = Math.max(0.05, clipLength(hold.clip, st, V, hold.span));
  let best: string | null = null, bd = Infinity;
  for (const k of SWORD_KEYS) {
    const t = keyTime(hold.clip, k.name, st, V, hold.span);
    if (t === null || (k.clip !== hold.clip && !(hold.clip === "guard" && k.name === "rest"))) continue;
    const d = Math.abs(t - hold.t);
    if (d < bd) { bd = d; best = k.name; }
  }
  return bd <= len * 0.012 ? best : null;
}
const stats = (): SwordStats | null => arsenal.swordStatsOf(Math.max(0, swordSide()));
const baseId = () => stats()?.pose ?? "sword-light";
function goKey(name: string) {
  const st = stats(), k = SWORD_KEYS.find((q) => q.name === name);
  if (!st || !k) return;
  const t = keyTime(k.clip, name, st, V, hold.span);
  if (t === null) { status(`${NAMES[baseId()] ?? baseId()} has no "${k.label}" key`); return; }
  hold.clip = k.clip; hold.t = t; keySel = name; playing = false;
  render();
}

// Hull frame <-> the left arm's key frame (off its shoulder, the aim's turn taken out, the right arm mirrored back).
const turn = (q: THREE.Vector3, a: number) => q.set(q.x * Math.cos(a) + q.z * Math.sin(a), q.y, -q.x * Math.sin(a) + q.z * Math.cos(a));
function toKey(q: THREE.Vector3, side: 1 | -1, aimYaw: number, shoulder: THREE.Vector3 | null): P3 {
  const v = q.clone();
  if (shoulder) v.sub(shoulder);
  turn(v, -aimYaw);
  v.x *= side;
  return [v.x, v.y, v.z];
}
const r3 = (p: P3): P3 => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000, Math.round(p[2] * 1000) / 1000];
const unit = (p: P3): P3 => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };

/** The key as it stands now, in the left arm's key frame (the rest without the "hand higher" slider). */
function keyNow(): KeyPose | null {
  const st = stats();
  if (!st || !keySel) return null;
  const p = clipPose(hold.clip, hold.t, 1, { x: 0, y: 0, z: 0 }, 0, st, V, hold.span);
  const hand: P3 = [p.hand.x, p.hand.y - (keySel === "rest" ? V.swordGuardUp : 0), p.hand.z];
  return { hand: r3(hand), fwd: r3([p.fwd.x, p.fwd.y, p.fwd.z]), up: r3([p.up.x, p.up.y, p.up.z]), pole: r3([p.pole.x, p.pole.y, p.pole.z]) };
}
const keyName = () => (keySel ? poseKey(keySel, !!SWORD_KEYS.find((k) => k.name === keySel)?.span && hold.span < 0.5) : "");

/** A handle was dragged: the key takes the change (the rest of it as it stood). */
function onDrag() {
  const i = swordSide(), fr = arsenal.swordFrame[i], now = keyNow();
  if (i < 0 || !fr || !now || !keySel || (gizmo.object !== handle && gizmo.object !== elbowHandle)) return;
  const side: 1 | -1 = i === 0 ? 1 : -1;
  const next: KeyPose = { ...now };
  if (gizmo.object === handle) {
    const hand = toKey(handle.position, side, fr.aimYaw, fr.shoulder);
    if (keySel === "rest") hand[1] -= V.swordGuardUp;
    next.hand = r3(hand);
    const q = handle.quaternion;
    next.fwd = r3(unit(toKey(new THREE.Vector3(0, 0, 1).applyQuaternion(q), side, fr.aimYaw, null)));
    next.up = r3(unit(toKey(new THREE.Vector3(0, 1, 0).applyQuaternion(q), side, fr.aimYaw, null)));
  } else if (gizmo.object === elbowHandle) {
    next.pole = r3(unit(toKey(elbowHandle.position, side, fr.aimYaw, fr.shoulder)));
  }
  setLivePose(baseId(), keyName(), next);
  save();
}
gizmo.addEventListener("objectChange", onDrag);
gizmo.addEventListener("mouseUp", () => render());

/** Put the handles where the held pose is (all but the one being dragged), and the gizmo on the tool's handle. */
function placeHandles() {
  const hg = hullGroup(), i = swordSide(), fr = i >= 0 ? arsenal.swordFrame[i] : null, st = stats();
  const show = mode === "pose" && !!keySel && !playing && !!hg && !!fr && !!st;
  if (!show) { if (gizmo.object) gizmo.detach(); elbowHandle.visible = false; return; }
  if (handle.parent !== hg) hg!.add(handle);
  if (elbowHandle.parent !== hg) hg!.add(elbowHandle);
  const side: 1 | -1 = i === 0 ? 1 : -1;
  const p = clipPose(hold.clip, hold.t, side, fr!.shoulder, fr!.aimYaw, st!, V, hold.span);
  const ik = armIk(fr!.shoulder, p.hand, V.swordUpperArm, V.swordForearm, p.pole);
  const dragging = gizmo.dragging;
  if (!(dragging && gizmo.object === handle)) {
    handle.position.set(ik.hand.x, ik.hand.y, ik.hand.z);
    const z = new THREE.Vector3(p.fwd.x, p.fwd.y, p.fwd.z), y = new THREE.Vector3(p.up.x, p.up.y, p.up.z);
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    handle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y.crossVectors(z, x), z));
  }
  if (!(dragging && gizmo.object === elbowHandle)) elbowHandle.position.set(ik.elbow.x, ik.elbow.y, ik.elbow.z);
  elbowHandle.visible = true;
  const want = tool === "elbow" ? elbowHandle : handle;
  if (gizmo.object !== want) gizmo.attach(want);
  gizmo.setMode(tool === "blade" ? "rotate" : "translate");
  gizmo.setSpace(tool === "blade" ? "local" : "world");
  gizmo.setSize(V.poseGizmo);
}

// ---- Saving and the way out ----
function save() { try { localStorage.setItem(KEY_STORE, JSON.stringify(livePoses())); } catch { /* private window */ } }
/** The posed keys as SWORD_POSES wants them (defaults merged with the lab's edits), for one sword or all. */
function exportJson(id: string | null): { text: string; n: number } {
  const ids = id ? [id] : [...new Set([...Object.keys(SWORD_POSES), ...Object.keys(livePoses())])];
  const out: Record<string, PoseSet> = {};
  for (const s of ids) { const set = posesFor(s); if (Object.keys(set).length) out[s] = set; }
  // One key per line: short enough to paste into chat, easy to read.
  const lines = Object.entries(out).map(([s, set]) => `  "${s}": {\n${Object.entries(set).map(([k, p]) => `    "${k}": ${JSON.stringify(p)}`).join(",\n")}\n  }`);
  return { text: `{\n${lines.join(",\n")}\n}`, n: Object.values(out).reduce((a, set) => a + Object.keys(set).length, 0) };
}
async function copy(id: string | null) {
  const { text, n } = exportJson(id);
  if (!n) { status("Nothing posed yet"); return; }
  if (await copyText(text)) status(`Copied ${n} posed key${n === 1 ? "" : "s"}: paste it to Claude in chat`);
  else prompt("Posed keys (copy this):", text);
}
function load() {
  const text = prompt("Paste posed keys (JSON from Copy pose):");
  if (!text) return;
  try {
    const all = JSON.parse(text) as Record<string, PoseSet>;
    const live = { ...livePoses() };
    for (const [id, set] of Object.entries(all)) live[id] = { ...(live[id] ?? {}), ...set };
    setLivePoses(live); save(); status("Loaded"); render();
  } catch { status("That isn't pose JSON"); }
}

// ---- The panel ----
const style = document.createElement("style");
style.textContent = `
.pose { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 5; display: flex; flex-direction: column; gap: 4px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: min(760px, calc(100vw - 20px)); font: 12px var(--sans); }
.pose-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.pose-row > span.l { color: var(--muted); width: 54px; }
.pose button { background: #1f2226; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px; font: 12px var(--sans); cursor: pointer; }
.pose button.on { border-color: var(--accent); color: var(--accent); }
.pose button.posed::after { content: " ●"; color: var(--ok); }
.pose input[type=range] { flex: 1; min-width: 160px; }
.pose .msg { color: var(--muted); }
.pose .vals { color: var(--muted); font-family: ui-monospace, monospace; font-size: 11px; white-space: pre; }
`;
document.head.appendChild(style);
const panel = document.createElement("div");
panel.className = "pose";
document.body.appendChild(panel);
let msg = "";
function status(s: string) { msg = s; render(); }
function btn(row: HTMLElement, label: string, on: boolean, click: () => void, tip?: string, cls?: string) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = label;
  if (on) b.classList.add("on");
  if (cls) b.classList.add(cls);
  if (tip) b.title = tip;
  b.addEventListener("click", (e) => { e.stopPropagation(); click(); (b as HTMLButtonElement).blur(); });
  row.appendChild(b);
  return b;
}
function row(label: string) {
  const r = document.createElement("div");
  r.className = "pose-row";
  if (label) { const l = document.createElement("span"); l.className = "l"; l.textContent = label; r.appendChild(l); }
  panel.appendChild(r);
  return r;
}
let scrub: HTMLInputElement | null = null, scrubText: HTMLSpanElement | null = null;
function render() {
  panel.textContent = "";
  const wr = row("Weapon");
  for (const [id, name] of Object.entries(SIDE)) btn(wr, name.replace(" (arm)", ""), state.w === id, () => { state.w = id as SidePick; refit(); });
  btn(wr, "Both arms", state.both, () => { state.both = !state.both; refit(); }, "The same weapon in the right arm too (it mirrors the left's poses)");
  const mr = row("Mode");
  btn(mr, "Play", mode === "play", enterPlay, "Fight the dummies: left click swings or fires, Tab locks the dummy under the cursor");
  btn(mr, "Pause / pose (P)", mode === "pose", () => enterPose(true), "Freeze the sword where it is and pose it");
  if (isSword()) {
    if (mode === "pose") btn(mr, "Close cut", hold.span < 0.5, () => { hold.span = 0; state.close = true; saveState(); if (keySel) goKey(keySel); else render(); }, "Show and pose the close cut's keys (the bent-elbow cut, aimed within the close-cut distance)");
    if (mode === "pose") btn(mr, "Full sweep", hold.span >= 0.5, () => { hold.span = 1; state.close = false; saveState(); if (keySel) goKey(keySel); else render(); }, "Show and pose the full sweep's keys");
  }
  if (mode === "play") {
    const t = document.createElement("span"); t.className = "msg";
    t.textContent = isSword() ? "Left click cuts, hold for a combo · Tab on a dummy locks it · P pauses the sword where it is" : "Left click fires · posing is for swords for now";
    mr.appendChild(t);
  }
  if (mode === "pose" && isSword()) {
    const st = stats()!;
    const cr = row("Move");
    for (const [c, label] of CLIPS) btn(cr, label, hold.clip === c, () => { hold.clip = c; hold.t = 0; snap(); playing = false; render(); });
    btn(cr, playing ? "❚❚ Stop" : "▶ Play the move", playing, () => { playing = !playing; if (!playing) snap(); render(); }, "Loops the held move at the Pose lab speed slider");
    const sr = row("Time");
    const len = clipLength(hold.clip, st, V, hold.span);
    btn(sr, "◀", false, () => { hold.t = Math.max(0, hold.t - len / 60); snap(); playing = false; render(); }, "Step back (1/60 of the move)");
    scrub = document.createElement("input");
    scrub.type = "range"; scrub.min = "0"; scrub.max = "1"; scrub.step = "0.001"; scrub.value = String(len > 0 ? hold.t / len : 0);
    scrub.addEventListener("input", () => { hold.t = Number(scrub!.value) * len; playing = false; keySel = keyAt(); updateScrubText(); });
    scrub.addEventListener("change", () => { snap(); render(); });
    sr.appendChild(scrub);
    btn(sr, "▶", false, () => { hold.t = Math.min(len, hold.t + len / 60); snap(); playing = false; render(); }, "Step on (1/60 of the move)");
    scrubText = document.createElement("span"); scrubText.className = "msg"; sr.appendChild(scrubText);
    updateScrubText();
    const kr = row("Keys");
    const posed = posesFor(baseId());
    for (const k of SWORD_KEYS) {
      if (k.clip !== hold.clip && !(k.name === "rest")) continue;
      if (keyTime(k.clip, k.name, st, V, hold.span) === null) continue;
      const stored = poseKey(k.name, k.span && hold.span < 0.5);
      btn(kr, k.label.replace(/^Cut \d: /, ""), keySel === k.name, () => goKey(k.name), `Jump to ${k.label}${k.span ? (hold.span < 0.5 ? " (close cut)" : " (full sweep)") : ""} and grab it`, posed[stored] ? "posed" : undefined);
    }
    if (keySel) {
      const tr = row("Grab");
      btn(tr, "Move hand (G)", tool === "hand", () => { tool = "hand"; render(); });
      btn(tr, "Turn blade (T)", tool === "blade", () => { tool = "blade"; render(); });
      btn(tr, "Swing elbow (E)", tool === "elbow", () => { tool = "elbow"; render(); });
      btn(tr, "Reset this key", false, () => { setLivePose(baseId(), keyName(), null); save(); status(`${keyName()} back to the code's`); }, "Back to the code's key (or the committed default)");
      const v = keyNow();
      if (v) { const s = document.createElement("span"); s.className = "vals"; s.textContent = `${keyName()}  hand ${v.hand!.join(", ")}  fwd ${v.fwd!.join(", ")}`; tr.appendChild(s); }
    } else {
      const t = document.createElement("span"); t.className = "msg"; t.textContent = "Jump to a key to grab it (between keys the swing only shows)"; kr.appendChild(t);
    }
  }
  const er = row("Poses");
  btn(er, `Copy pose (${NAMES[baseId()] ?? baseId()})`, false, () => void copy(baseId()), "The posed keys of this sword as JSON on the clipboard: paste it to Claude in chat");
  btn(er, "Copy all swords", false, () => void copy(null));
  btn(er, "Paste…", false, load, "Load posed keys from JSON");
  btn(er, "Reset sword", false, () => { if (confirm(`Clear every posed key of the ${NAMES[baseId()] ?? baseId()} in this browser?`)) { const live = { ...livePoses() }; delete live[baseId()]; setLivePoses(live); save(); status("Cleared"); } }, "Clear this sword's edits in this browser (committed defaults stay)");
  if (msg) { const m = document.createElement("span"); m.className = "msg"; m.textContent = msg; er.appendChild(m); }
}
function updateScrubText() {
  const st = stats();
  if (!scrubText || !st) return;
  const len = clipLength(hold.clip, st, V, hold.span);
  scrubText.textContent = `${hold.t.toFixed(3)} / ${len.toFixed(3)} s${keySel ? ` · on ${SWORD_KEYS.find((k) => k.name === keySel)?.label}` : ""}`;
}

addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.repeat) return;
  if (e.code === "KeyP") { if (mode === "play") enterPose(true); else enterPlay(); }
  if (mode !== "pose") return;
  if (e.code === "KeyG") { tool = "hand"; render(); }
  if (e.code === "KeyT") { tool = "blade"; render(); }
  if (e.code === "KeyE") { tool = "elbow"; render(); }
  if (e.code === "Escape") enterPlay();
});

// ---- Each frame ----
let lastTotal = 0;
lab.onFrame((dt) => {
  clock += dt;
  rng.update(dt, lab.field);
  dd.update();
  // The last hit on a dummy (the sword's sound plays from the arsenal; this shows what it did).
  const d = rng.total - lastTotal;
  lastTotal = rng.total;
  if (d > 0.5) { lastHit = `${Math.round(d)}`; hitAt = clock; }
  lab.hud("pose", `${mode === "pose" ? "POSE" : "play"} · ${NAMES[baseId()] ?? state.w}${isSword() ? ` · ${hold.span < 0.5 ? "close cut" : "full sweep"}` : ""} · last hit ${clock - hitAt < 4 ? lastHit : "—"} · damage/s ${Math.round(rng.dps())}`);
  if (mode === "pose" && playing && isSword()) {
    const st = stats()!, len = Math.max(0.05, clipLength(hold.clip, st, V, hold.span));
    hold.t = (hold.t + dt * V.posePlaySpeed) % len;
    if (scrub) scrub.value = String(hold.t / len);
    updateScrubText();
  }
  if (mode === "pose") { const p = player.sim.pelvis; orbit.target.lerp(new THREE.Vector3(p.x, p.y + 0.8, p.z), Math.min(1, dt * 4)); orbit.update(); }
  placeHandles();
});

// The console (and headless checks): the hold, the handles, a drag, the JSON.
(window as unknown as { __pose: unknown }).__pose = { hold, state, handle, elbowHandle, drag: onDrag, json: (all = false) => exportJson(all ? null : baseId()).text, key: () => keySel };

refit();
// ?pose[=key]: start posing (on that key).
if (params.has("pose")) {
  hold.span = state.close ? 0 : 1;
  // A frame first, so the arm's frame is known.
  setTimeout(() => { enterPose(false); const k = params.get("pose"); goKey(k && SWORD_KEYS.some((q) => q.name === k) ? k : "rest"); }, 300);
}
