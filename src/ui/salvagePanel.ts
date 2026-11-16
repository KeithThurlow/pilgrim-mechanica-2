// The mech salvage panel (DOM, drawing only; the rules are src/expedition/hulks.ts). Keith 2026-10-14 in the old
// project: looting a mech looks like an equipment screen. Opened with E by a hulk: every part still on it, each with
// its level, power, DPS and the change against what you have fitted, and the exact chance of pulling it now (a visible
// gamble is a decision). Click a part to pull it; the bar shows the pull; E, Esc or ✕ closes it, walking off too.
import type { Item } from "../items/item";
import { labelHtml } from "../expedition/dropLabels";

export interface SalvageRow { item: Item; chance: number }
export interface SalvageView {
  title: string;
  pulls: number;
  rows: SalvageRow[];
  /** The part being pulled and how far along (0..1). */
  pulling: { item: Item; share: number } | null;
  onFoot: boolean;
  fitted: readonly (Item | null)[];
  /** Cells left in the cargo (a pulled part that doesn't fit is laid on the sand). */
  full: (item: Item) => boolean;
}

const SLOT_KIND_NAMES: Record<string, string> = {
  legs: "Legs", hull: "Hull", sensor: "Sensor", arm: "Arm", weapon: "Weapon", shoulder: "Shoulder gear", pack: "Pack", waist: "Waist kit", protocol: "Protocol",
};
const pct = (c: number) => `${Math.round(c * 100)}%`;
const chanceColour = (c: number) => (c >= 0.95 ? "#9dffb0" : c >= 0.5 ? "#ffd27a" : c >= 0.25 ? "#ffaa5a" : "#ff6a4a");

export class SalvagePanel {
  readonly root = document.createElement("div");
  onPull: ((item: Item) => void) | null = null;
  onClose: (() => void) | null = null;
  private body = document.createElement("div");
  private bar = document.createElement("div");
  private fill = document.createElement("div");
  private html = "";
  private rows: SalvageRow[] = [];

  constructor() {
    Object.assign(this.root.style, {
      position: "fixed", right: "18px", top: "50%", transform: "translateY(-50%)", width: "330px", zIndex: "20",
      background: "rgba(18,16,13,0.92)", border: "1px solid #6a5a40", borderRadius: "6px", padding: "10px 12px",
      font: "13px system-ui, sans-serif", color: "#e8e2d6", pointerEvents: "auto", userSelect: "none",
    } as CSSStyleDeclaration);
    this.root.hidden = true;
    Object.assign(this.bar.style, { height: "6px", background: "#2a251d", borderRadius: "3px", margin: "8px 0 2px", overflow: "hidden" } as CSSStyleDeclaration);
    Object.assign(this.fill.style, { height: "100%", width: "0%", background: "#ffb347" } as CSSStyleDeclaration);
    this.bar.appendChild(this.fill);
    this.root.append(this.body, this.bar);
    this.root.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      if (t.dataset.act === "close") { this.onClose?.(); return; }
      const row = this.rows[Number(t.dataset.i)];
      if (row) this.onPull?.(row.item);
    });
    addEventListener("keydown", (e) => { if (e.code === "Escape" && this.isOpen) this.onClose?.(); });
    document.body.appendChild(this.root);
  }

  get isOpen() { return !this.root.hidden; }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; this.html = ""; }

  update(v: SalvageView) {
    if (!this.isOpen) return;
    this.rows = v.rows;
    const head = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">`
      + `<b style="color:#ffb347">${v.title}</b><span data-act="close" style="cursor:pointer;padding:0 4px">✕</span></div>`
      + `<div style="color:#9a958c;margin-bottom:6px">${v.pulls === 0 ? "First pull is the safe one: take what you want most." : `${v.pulls} pulled · a failed pull jams it`}`
      + ` · ${v.onFoot ? "by hand (slower, +chance)" : "by the mech (fast, loud)"}</div>`;
    const rows = v.rows.map((r, i) => {
      const busy = v.pulling?.item === r.item, kind = SLOT_KIND_NAMES[r.item.kind] ?? r.item.kind;
      return `<div data-act="pull" data-i="${i}" style="display:flex;gap:8px;align-items:center;padding:5px 6px;margin:2px 0;border-radius:4px;cursor:pointer;`
        + `background:${busy ? "rgba(255,179,71,0.18)" : "rgba(255,255,255,0.04)"}">`
        + `<div style="flex:1;min-width:0">${labelHtml(r.item, v.fitted)}<div style="color:#9a958c;font-size:11px">${kind}${v.full(r.item) ? " · cargo full: lands on the sand" : ""}</div></div>`
        + `<div style="font-weight:700;font-size:15px;color:${chanceColour(r.chance)}">${pct(r.chance)}</div></div>`;
    }).join("");
    const html = head + (rows || `<div style="color:#9a958c">Nothing left on it.</div>`);
    if (html !== this.html) { this.body.innerHTML = html; this.html = html; }
    this.fill.style.width = `${Math.round((v.pulling?.share ?? 0) * 100)}%`;
  }
}
