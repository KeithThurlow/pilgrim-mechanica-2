// Your vitals on the screen (Keith 2026-10-31: "more UI around health for the player"): a hull bar at the bottom left
// with the number and armour, a pale ghost of what the last hits took that drains after a beat, repair kit pips (Q),
// a red edge that flashes on a hit and stays faint at low hull, and short red arcs round the mech pointing where hits
// came from. On foot the bar is the pilot's and the mech's hull shrinks to a thin bar under it. Plain DOM plus one 2D
// canvas for the arcs. Reads a VitalsView and the mech's hit list; owns nothing in the game.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";

export const VITALS_DEFAULTS = {
  /** Seconds the ghost holds before it drains. */
  ghostHold: 0.45,
  /** Share of the max hull the ghost drains per second. */
  ghostDrain: 0.6,
  /** Red edge strength per share of the max hull one hit takes (a 10% hit: 10 × this). */
  hurtFlash: 4,
  /** Below this share of hull the red edge stays faintly on and pulses. */
  lowHull: 0.3,
  /** Seconds a hit arc stays. */
  arcTime: 0.9,
  /** Arc ring radius round the mech (px). */
  arcRadius: 110,
};
export type VitalsValues = typeof VITALS_DEFAULTS;

const G = "Health HUD";
export const VITALS_PARAMS: Param[] = [
  { key: "ghostHold", label: "Damage ghost holds (s)", min: 0, max: 2, step: 0.05, group: G, tip: "The pale chunk of what the last hits took stays this long before draining" },
  { key: "ghostDrain", label: "Damage ghost drain (hull/s)", min: 0.05, max: 3, step: 0.05, group: G },
  { key: "hurtFlash", label: "Red edge per hit", min: 0, max: 20, step: 0.5, group: G, tip: "Red edge flash per share of max hull a hit takes" },
  { key: "lowHull", label: "Low hull (share)", min: 0, max: 0.8, step: 0.01, group: G, tip: "Below this the edge stays faintly red and pulses, and the warning sounds" },
  { key: "arcTime", label: "Hit arc time (s)", min: 0, max: 3, step: 0.05, group: G },
  { key: "arcRadius", label: "Hit arc radius (px)", min: 40, max: 300, step: 5, group: G },
];

export interface VitalsView {
  hull: number; max: number; armour: number; alive: boolean;
  /** Kits carried, most carried, the kit at work (0..1, null none), whether Q would start one now. */
  kits: number; kitMax: number; kitProgress: number | null; kitReady: boolean;
  /** On foot: the pilot's health (the big bar shows it; the mech's hull goes thin under it). */
  pilot?: { hp: number; max: number } | null;
  /** A short note beside the kits (why Q did nothing, a patch in progress). */
  note?: string;
  /** Being repaired by a zone right now: the bar glows. */
  healing?: boolean;
  /** Abilities: name, key, 0..1 ready (1 = ready), active. */
  abilities?: { key: string; name: string; ready: number; active: boolean }[];
}

const COL = { hull: "#8fd18a", mid: "#f0c14b", low: "#f06a4b", ghost: "rgba(255, 240, 220, 0.75)", back: "rgba(18, 14, 10, 0.62)", line: "rgba(255, 220, 160, 0.35)", kit: "#7fd6c8" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>, parent?: HTMLElement) {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  parent?.appendChild(e);
  return e;
}

let shared: VitalsHud | null = null;
/** The one vitals HUD on the page (made on first use). */
export function vitalsHud(v: VitalsValues) { return (shared ??= new VitalsHud(v)); }

/** Set a style only when it changes: the HUD updates every frame and every write can cost a style recalc. */
function st(e: HTMLElement, k: string, v: string) {
  const c = ((e as unknown as { _st?: Record<string, string> })._st ??= {});
  if (c[k] === v) return;
  c[k] = v;
  (e.style as unknown as Record<string, string>)[k] = v;
}
/** Set innerHTML only when it changes. */
function html(e: HTMLElement, h: string) {
  const o = e as unknown as { _html?: string };
  if (o._html === h) return;
  o._html = h;
  e.innerHTML = h;
}

export class VitalsHud {
  private root: HTMLDivElement;
  private fill: HTMLDivElement;
  private ghostEl: HTMLDivElement;
  private label: HTMLDivElement;
  private mechRow: HTMLDivElement;
  private mechFill: HTMLDivElement;
  private kitRow: HTMLDivElement;
  private pips: { box: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private noteEl: HTMLSpanElement;
  private abilityRow: HTMLDivElement;
  private edge: HTMLDivElement;
  private arcs: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** The ghost's share and how long since the last drop. */
  private ghost = 1;
  private sinceHit = 0;
  private last = -1;
  private flash = 0;
  private clock = 0;
  private live: { a: number; t: number; k: number }[] = [];
  private p = new THREE.Vector3();
  private q = new THREE.Vector3();
  /** Low hull crossed this frame (the lab plays the warning). */
  lowNow = false;
  private wasLow = false;
  /** The arcs canvas has something on it (clear it next frame). */
  private drawn = false;

  constructor(private v: VitalsValues, parent: HTMLElement = document.body) {
    this.root = el("div", { position: "fixed", left: "14px", bottom: "14px", width: "280px", pointerEvents: "none", zIndex: "20", font: "600 12px system-ui, sans-serif", color: "#f3e6d0", textShadow: "0 1px 2px #000" }, parent);
    this.label = el("div", { display: "flex", justifyContent: "space-between", marginBottom: "3px" }, this.root);
    const bar = el("div", { position: "relative", height: "14px", background: COL.back, border: `1px solid ${COL.line}`, borderRadius: "3px", overflow: "hidden" }, this.root);
    this.ghostEl = el("div", { position: "absolute", left: "0", top: "0", bottom: "0", background: COL.ghost }, bar);
    this.fill = el("div", { position: "absolute", left: "0", top: "0", bottom: "0" }, bar);
    this.mechRow = el("div", { position: "relative", height: "5px", marginTop: "3px", background: COL.back, border: `1px solid ${COL.line}`, borderRadius: "2px", overflow: "hidden", display: "none" }, this.root);
    this.mechFill = el("div", { position: "absolute", left: "0", top: "0", bottom: "0" }, this.mechRow);
    this.kitRow = el("div", { display: "flex", alignItems: "center", gap: "4px", marginTop: "6px" }, this.root);
    el("span", { marginRight: "4px", color: COL.kit }, this.kitRow).textContent = "Q repair";
    this.noteEl = el("span", { marginLeft: "6px", color: "rgba(243, 230, 208, 0.7)", fontWeight: "500" }, this.kitRow);
    this.abilityRow = el("div", { display: "flex", gap: "6px", marginTop: "6px" }, this.root);
    this.edge = el("div", { position: "fixed", inset: "0", pointerEvents: "none", opacity: "0", zIndex: "19", willChange: "opacity", boxShadow: "inset 0 0 140px 36px rgba(200, 40, 20, 0.85)" }, parent);
    this.arcs = el("canvas", { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "19" }, parent);
    this.ctx = this.arcs.getContext("2d")!;
  }

  /** hits: the mech's hit list (drained here); camera and at (the mech's hull) place the arcs. */
  update(dt: number, view: VitalsView, hits: { dx: number; dz: number; amount: number }[], camera: THREE.Camera, at: THREE.Vector3, show = true) {
    const v = this.v;
    this.clock += dt;
    st(this.root, "display", show ? "" : "none");
    const onFoot = !!view.pilot;
    const hp = onFoot ? view.pilot!.hp : view.hull, max = Math.max(1, onFoot ? view.pilot!.max : view.max);
    const share = Math.max(0, Math.min(1, hp / max));
    // The ghost: jumps to where the bar was on a drop, holds, then drains to the bar; a repair pulls it up at once.
    if (this.last >= 0 && share < this.last - 1e-4) { this.ghost = Math.max(this.ghost, this.last); this.sinceHit = 0; this.flash += (this.last - share) * v.hurtFlash; }
    this.sinceHit += dt;
    if (this.sinceHit > v.ghostHold) this.ghost = Math.max(share, this.ghost - v.ghostDrain * dt);
    if (this.ghost < share) this.ghost = share;
    this.last = share;
    const col = share > 0.5 ? COL.hull : share > 0.25 ? COL.mid : COL.low;
    st(this.fill, "width", `${share * 100}%`);
    st(this.fill, "background", col);
    st(this.fill, "boxShadow", view.healing || view.kitProgress !== null ? "0 0 8px 2px rgba(127, 240, 200, 0.85)" : "none");
    st(this.ghostEl, "width", `${this.ghost * 100}%`);
    const name = onFoot ? "Pilot" : view.alive ? "Hull" : "Destroyed";
    html(this.label, `<span>${name}</span><span>${Math.max(0, Math.round(hp))} / ${Math.round(max)}${onFoot ? "" : ` &nbsp;<span style="opacity:.75">⛨ ${Math.round(view.armour)}</span>`}</span>`);
    st(this.mechRow, "display", onFoot ? "" : "none");
    if (onFoot) {
      const ms = Math.max(0, Math.min(1, view.hull / Math.max(1, view.max)));
      st(this.mechFill, "width", `${ms * 100}%`);
      st(this.mechFill, "background", ms > 0.5 ? COL.hull : ms > 0.25 ? COL.mid : COL.low);
    }
    // Kit pips: full, the one at work (filling), empty.
    while (this.pips.length < view.kitMax) {
      const box = el("div", { position: "relative", width: "16px", height: "16px", borderRadius: "3px", border: `1px solid ${COL.line}`, background: COL.back, overflow: "hidden" }, this.kitRow);
      const fill = el("div", { position: "absolute", left: "0", right: "0", bottom: "0", background: COL.kit }, box);
      this.kitRow.insertBefore(box, this.noteEl);
      this.pips.push({ box, fill });
    }
    this.pips.forEach((p, i) => {
      st(p.box, "display", i < view.kitMax ? "" : "none");
      const working = view.kitProgress !== null && i === view.kits;
      const h = i < view.kits ? 1 : working ? 1 - view.kitProgress! : 0;
      st(p.fill, "height", `${h * 100}%`);
      st(p.fill, "opacity", i < view.kits ? (view.kitReady ? "1" : "0.55") : "0.8");
    });
    const note = view.note ?? (view.kits === 0 ? "none left" : "");
    if (this.noteEl.textContent !== note) this.noteEl.textContent = note;
    // Abilities (none yet in most labs).
    const ab = view.abilities ?? [];
    st(this.abilityRow, "display", ab.length ? "flex" : "none");
    html(this.abilityRow, ab.map((a) => `<div style="padding:2px 6px;border:1px solid ${COL.line};border-radius:3px;background:linear-gradient(90deg, rgba(127,214,200,${a.ready >= 1 ? 0.45 : 0.18}) ${a.ready * 100}%, ${COL.back} ${a.ready * 100}%);${a.active ? "outline:1px solid #7fd6c8" : ""}">${a.key} ${a.name}</div>`).join(""));

    // The red edge: a flash per hit, faint and pulsing at low hull (not on a wreck).
    const low = view.alive && share < v.lowHull;
    this.lowNow = low && !this.wasLow;
    this.wasLow = low;
    this.flash = Math.max(0, Math.min(1.2, this.flash) - dt * 2.2);
    const pulse = low ? 0.22 + 0.12 * Math.sin(this.clock * 6) : 0;
    st(this.edge, "opacity", show ? Math.min(0.9, this.flash + pulse).toFixed(2) : "0");

    // Hit arcs: each new hit's direction on the screen round the mech.
    const W = innerWidth, H = innerHeight; // the canvas fills the window (reading its size would force a layout)
    for (const h of hits) {
      this.p.copy(at).project(camera);
      this.q.set(at.x + h.dx * 6, at.y, at.z + h.dz * 6).project(camera);
      const a = Math.atan2(-(this.q.y - this.p.y) * H, (this.q.x - this.p.x) * W);
      this.live.push({ a, t: 0, k: Math.min(1, 0.35 + (h.amount / max) * 12) });
    }
    hits.length = 0;
    if (this.arcs.width !== W || this.arcs.height !== H) { this.arcs.width = W; this.arcs.height = H; }
    // Clear and draw only while there are arcs: an idle full-screen canvas costs nothing to composite, a redrawn one
    // is a full-screen upload every frame (perf pass 2026-10-31).
    const c = this.ctx;
    if (this.drawn) { c.clearRect(0, 0, W, H); this.drawn = false; }
    if (!show) { this.live.length = 0; return; }
    if (!this.live.length) return;
    this.drawn = true;
    this.p.copy(at).project(camera);
    const cx = (this.p.x * 0.5 + 0.5) * W, cy = (-this.p.y * 0.5 + 0.5) * H;
    c.lineCap = "round";
    for (let i = this.live.length - 1; i >= 0; i--) {
      const h = this.live[i];
      h.t += dt;
      if (h.t > v.arcTime) { this.live.splice(i, 1); continue; }
      const f = 1 - h.t / Math.max(0.01, v.arcTime);
      c.strokeStyle = `rgba(240, 70, 40, ${0.85 * f * h.k})`;
      c.lineWidth = 3 + 5 * h.k;
      c.beginPath();
      c.arc(cx, cy, v.arcRadius, h.a - 0.28, h.a + 0.28);
      c.stroke();
    }
    if (this.live.length > 12) this.live.splice(0, this.live.length - 12);
  }
}
