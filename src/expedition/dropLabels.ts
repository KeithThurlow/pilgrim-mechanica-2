// Labels over item drops on the sand (DOM, drawing only; the drops are drops.ts). Keith 2026-11-06: picking up is a
// choice, so every drop near you says what it is: its name in its rarity's colour, its level and power, DPS for a
// weapon, and ▲/▼ against the weakest fitted item of its kind. The drop E would take now gets a bright frame and
// "E take" (or "cargo full"). Nearest first, at most labelMax, out to labelRange.
import { canvasRect } from "../core/canvasRect";
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Item } from "../items/item";
import { RARITY, tierOf } from "../items/rarity";
import { levelOf } from "../items/level";
import { itemPower, itemDps, versusFitted } from "../items/power";
import { itemName, type Drop } from "./drops";

export const DROP_LABEL_DEFAULTS = { labelRange: 45, labelMax: 10, labelLift: 1.4, labelSize: 12, labelFar: 0.55 };
export type DropLabelValues = typeof DROP_LABEL_DEFAULTS;
export const DROP_LABEL_GROUP = "Loot labels";
const G = DROP_LABEL_GROUP;
export const DROP_LABEL_PARAMS: Param[] = [
  { key: "labelRange", label: "Labels within (m)", min: 5, max: 150, step: 1, group: G, tip: "Drops this close to you show their label" },
  { key: "labelMax", label: "Most labels shown", min: 1, max: 40, step: 1, group: G, tip: "The nearest this many" },
  { key: "labelLift", label: "Label above the crate (m)", min: 0, max: 5, step: 0.1, group: G },
  { key: "labelSize", label: "Label text size (px)", min: 8, max: 22, step: 1, group: G },
  { key: "labelFar", label: "Far labels fade to", min: 0.1, max: 1, step: 0.05, group: G, tip: "Opacity at the edge of the range (the one E takes is always full)" },
];

const GREEN = "#bdf0c8", RED = "#ff6a4a", DIM = "#9a958c";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The label's text for an item: name, then level · power · DPS and the change against what's fitted. */
export function labelHtml(it: Item, fitted: readonly (Item | null)[]): string {
  const col = RARITY[it.rarity].color, p = itemPower(it), dps = itemDps(it), vs = it.kind === "protocol" ? null : versusFitted(it, fitted);
  let cmp = "";
  if (vs) {
    const d = dps !== null && vs.dps !== null ? Math.round(dps - vs.dps) : Math.round(p - vs.power);
    cmp = d > 0 ? ` <span style="color:${GREEN}">▲${d}</span>` : d < 0 ? ` <span style="color:${RED}">▼${-d}</span>` : ` <span style="color:${DIM}">=</span>`;
  }
  const stats = `Lv ${levelOf(it)} · ${p} power${dps !== null ? ` · <b>${Math.round(dps)} dps</b>` : ""}${cmp}`;
  return `<div style="color:${col};font-weight:700">${esc(itemName(it))}</div><div style="color:#e8e2d6;font-weight:500">${stats}</div>`;
}

interface Shown { el: HTMLDivElement; body: HTMLDivElement; key: HTMLDivElement; html: string; state: string }

export class DropLabels {
  readonly root = document.createElement("div");
  private els = new Map<string, Shown>();
  private p = new THREE.Vector3();
  private order: { d: Drop; dist: number }[] = [];

  constructor(public v: DropLabelValues, private ground: (x: number, z: number) => number) {
    Object.assign(this.root.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "4" } as CSSStyleDeclaration);
    document.body.appendChild(this.root);
  }

  /** target: the drop E would take now (null: none); full: the cargo can't take it. */
  update(camera: THREE.Camera, canvas: HTMLCanvasElement, drops: readonly Drop[], from: { x: number; z: number }, target: Drop | null, full: boolean, fitted: readonly (Item | null)[], show: boolean) {
    const v = this.v, o = this.order;
    o.length = 0;
    if (show) for (const d of drops) { const dist = Math.hypot(d.x - from.x, d.z - from.z); if (dist <= v.labelRange || d === target) o.push({ d, dist }); }
    o.sort((a, b) => a.dist - b.dist);
    if (o.length > v.labelMax) o.length = Math.max(1, Math.round(v.labelMax));
    if (target && !o.some((q) => q.d === target)) o.push({ d: target, dist: 0 });
    const r = canvasRect(canvas);
    const seen = new Set<string>();
    for (const { d, dist } of o) {
      const p = this.p.set(d.x, this.ground(d.x, d.z) + v.labelLift, d.z).project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
      seen.add(d.id);
      let s = this.els.get(d.id);
      if (!s) {
        const el = document.createElement("div"), body = document.createElement("div"), key = document.createElement("div");
        Object.assign(el.style, {
          position: "absolute", transform: "translate(-50%, -100%)", textAlign: "center", whiteSpace: "nowrap",
          font: "12px/1.25 system-ui, 'Segoe UI', sans-serif", textShadow: "0 1px 3px #000d", padding: "3px 7px",
          borderRadius: "4px", background: "#0d0c0bb0",
        } as CSSStyleDeclaration);
        Object.assign(key.style, { fontWeight: "700", letterSpacing: "0.06em", marginTop: "1px" } as CSSStyleDeclaration);
        el.append(body, key);
        this.root.appendChild(el);
        s = { el, body, key, html: "", state: "" };
        this.els.set(d.id, s);
      }
      const html = labelHtml(d.item, fitted);
      if (s.html !== html) { s.body.innerHTML = html; s.html = html; }
      const isT = d === target, col = RARITY[d.item.rarity].color;
      const state = isT ? (full ? "full" : "take") : "";
      if (s.state !== state) {
        s.state = state;
        s.key.textContent = state === "take" ? "[E] TAKE" : state === "full" ? "CARGO FULL · I: drop something" : "";
        s.key.style.color = state === "full" ? RED : "#fff";
        s.key.style.display = state ? "block" : "none";
      }
      s.el.style.fontSize = `${v.labelSize}px`;
      s.el.style.border = `1px solid ${isT ? col : col + "55"}`;
      s.el.style.boxShadow = isT ? `0 0 ${6 + 3 * tierOf(d.item.rarity)}px ${col}aa` : "none";
      const k = Math.min(1, dist / Math.max(1, v.labelRange));
      s.el.style.opacity = String(isT ? 1 : 1 - (1 - v.labelFar) * k);
      s.el.style.zIndex = isT ? "2" : "1";
      s.el.style.left = `${r.left + (p.x * 0.5 + 0.5) * r.width}px`;
      s.el.style.top = `${r.top + (-p.y * 0.5 + 0.5) * r.height}px`;
    }
    for (const [id, s] of this.els) if (!seen.has(id)) { s.el.remove(); this.els.delete(id); }
  }

  clear() { for (const s of this.els.values()) s.el.remove(); this.els.clear(); }
}
