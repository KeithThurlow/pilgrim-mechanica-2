// The mech doll (Keith 2026-11-01: "the mech kind of represented as a doll down on the bottom right... in the future,
// even do damage there, like damage on the legs, damage on the hull... to encourage the player to return to base").
// A small silhouette of the mech seen from behind (as the game camera sees it: its left on the left), one shape per
// part. The HUD doll (bottom right, every lab that calls it) colours each part by its health share and flashes it on a
// hit, with the cargo bar under it; the inventory (src/ui/inventory.ts) draws the same silhouette tinted by what's
// fitted. Plain DOM and SVG; owns nothing in the game.
//
// Damage per part is a hook for later: there is one hull pool today, so `partsFromHull` gives every part the hull's
// share. When parts take their own damage (and a broken sensor cuts the radar, broken legs slow the walk: Keith
// 2026-11-01, a to-do in docs/decisions.md), the sim fills a PartHealth per part and the doll shows it as it is.
import type { Param } from "../core/tweaks";

export const DOLL_PARTS = ["sensor", "pack", "hull", "armL", "armR", "legL", "legR"] as const;
export type DollPart = (typeof DOLL_PARTS)[number];
/** Health share per part, 0..1; null: nothing fitted there (drawn as an empty outline). */
export type PartHealth = Record<DollPart, number | null>;

/** Every part at the hull's share (one health pool for now); `fitted` says which parts have something on them. */
export function partsFromHull(share: number, fitted: Partial<Record<DollPart, boolean>> = {}): PartHealth {
  const s = Math.max(0, Math.min(1, share));
  const out = {} as PartHealth;
  for (const p of DOLL_PARTS) out[p] = fitted[p] === false ? null : s;
  return out;
}

export const DOLL_DEFAULTS = {
  dollSize: 110,
  dollWarn: 0.6,
  dollCritical: 0.3,
  dollFlash: 0.35,
};
export type DollValues = typeof DOLL_DEFAULTS;
const G = "Mech doll";
export const DOLL_PARAMS: Param[] = [
  { key: "dollSize", label: "Doll width (px)", min: 50, max: 220, step: 2, group: G, tip: "The mech doll at the bottom right (I or a click opens the inventory)" },
  { key: "dollWarn", label: "Part damaged below (share)", min: 0.1, max: 1, step: 0.01, group: G, tip: "A part turns amber below this share of its health" },
  { key: "dollCritical", label: "Part critical below (share)", min: 0, max: 0.9, step: 0.01, group: G, tip: "Red, and blinking, below this" },
  { key: "dollFlash", label: "Hit flash (s)", min: 0, max: 2, step: 0.05, group: G, tip: "A part that just lost health flashes this long" },
];

/** The silhouette's shapes (viewBox 0 0 100 120), by part. */
const SHAPES: Record<DollPart, string[]> = {
  pack: ['<rect x="37" y="12" width="26" height="16" rx="3"/>'],
  sensor: ['<rect x="43" y="3" width="14" height="9" rx="2"/>'],
  hull: ['<path d="M27 24 H73 L69 56 H31 Z"/>'],
  armL: ['<rect x="9" y="26" width="15" height="30" rx="3"/>'],
  armR: ['<rect x="76" y="26" width="15" height="30" rx="3"/>'],
  legL: ['<path class="leg" d="M40 58 L31 80 L38 98 L29 115"/>', '<path class="foot" d="M23 116 H35"/>'],
  legR: ['<path class="leg" d="M60 58 L69 80 L62 98 L71 115"/>', '<path class="foot" d="M65 116 H77"/>'],
};

/** The silhouette as an SVG element; colour parts with `paint`. */
export function dollSvg(): { svg: SVGSVGElement; parts: Record<DollPart, SVGGElement> } {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 120");
  const parts = {} as Record<DollPart, SVGGElement>;
  for (const p of DOLL_PARTS) {
    const g = document.createElementNS(NS, "g");
    g.dataset.part = p;
    g.innerHTML = SHAPES[p].join("");
    svg.appendChild(g);
    parts[p] = g;
  }
  return { svg, parts };
}

/** Colour one part: a fill and outline; legs are strokes. empty: a dashed outline only. */
export function paintPart(g: SVGGElement, color: string, empty = false) {
  for (const el of Array.from(g.children) as SVGElement[]) {
    const line = el.classList.contains("leg") || el.classList.contains("foot");
    el.setAttribute("fill", line || empty ? "none" : color + "cc");
    el.setAttribute("stroke", empty ? "#ffffff40" : line ? color : "#0009");
    el.setAttribute("stroke-width", line ? (el.classList.contains("foot") ? "4" : "6") : "1.2");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("stroke-dasharray", empty ? "3 2" : "");
  }
}

const OK = "#9fc7b4", WARN = "#e8a33a", BAD = "#e0482c", DEAD = "#5a1a12", FLASH = "#ffffff";

export interface DollView {
  parts: PartHealth;
  /** The cargo: tonnes carried and the capacity (Infinity: no limit); null hides the bar. */
  cargo: { load: number; capacity: number; scrap: number; items: number; warn: number } | null;
  /** On foot: the doll dims (it's the mech, standing over there). */
  onFoot?: boolean;
}

/** The HUD doll at the bottom right. Click it (or press I) for the inventory. */
export function mechDollHud(v: DollValues, onClick: () => void, parent: HTMLElement = document.body) {
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "fixed", right: "14px", bottom: "14px", zIndex: "20", cursor: "pointer", userSelect: "none",
    font: "600 11px system-ui, sans-serif", color: "#f3e6d0", textShadow: "0 1px 2px #000", textAlign: "center",
  } as CSSStyleDeclaration);
  root.title = "Your mech · I or click: inventory";
  const { svg, parts } = dollSvg();
  svg.style.display = "block";
  svg.style.filter = "drop-shadow(0 1px 2px #000a)";
  root.appendChild(svg);
  const label = document.createElement("div");
  label.style.whiteSpace = "nowrap";
  label.style.fontSize = "10px";
  const bar = document.createElement("div"), fill = document.createElement("div");
  Object.assign(bar.style, { height: "5px", background: "#0007", border: "1px solid #ffffff30", borderRadius: "3px", overflow: "hidden", marginTop: "3px" } as CSSStyleDeclaration);
  Object.assign(fill.style, { height: "100%", width: "0%" } as CSSStyleDeclaration);
  bar.appendChild(fill);
  root.append(label, bar);
  const hint = document.createElement("div");
  hint.textContent = "I · inventory";
  Object.assign(hint.style, { color: "#ffffff70", fontWeight: "500", marginTop: "2px" } as CSSStyleDeclaration);
  root.appendChild(hint);
  root.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  parent.appendChild(root);

  const last = {} as Record<DollPart, number | null>;
  const flash = {} as Record<DollPart, number>;
  for (const p of DOLL_PARTS) { last[p] = null; flash[p] = 0; }
  let t = 0, key = "";

  return {
    root,
    update(dt: number, view: DollView) {
      t += dt;
      const w = Math.round(v.dollSize);
      root.style.width = `${w}px`;
      svg.style.width = `${w}px`; svg.style.height = `${Math.round(w * 1.2)}px`;
      root.style.opacity = view.onFoot ? "0.55" : "1";
      let k = "";
      for (const p of DOLL_PARTS) {
        const h = view.parts[p];
        if (h !== null && last[p] !== null && h < last[p]! - 1e-4) flash[p] = v.dollFlash;
        last[p] = h;
        flash[p] = Math.max(0, flash[p] - dt);
        let col: string;
        if (h === null) col = "#ffffff";
        else if (flash[p] > 0) col = FLASH;
        else if (h <= 0) col = DEAD;
        else if (h < v.dollCritical) col = Math.sin(t * 9) > -0.3 ? BAD : DEAD;
        else if (h < v.dollWarn) col = WARN;
        else col = OK;
        k += col + (h === null ? "e" : "") + "|";
        if (k.length && key.split("|")[DOLL_PARTS.indexOf(p)] === col + (h === null ? "e" : "")) continue;
        paintPart(parts[p], col, h === null);
      }
      key = k;
      const c = view.cargo;
      bar.style.display = label.style.display = c ? "block" : "none";
      if (c) {
        const lim = Number.isFinite(c.capacity) && c.capacity > 0, share = lim ? c.load / c.capacity : 0;
        const col = share > 1 + 1e-6 ? BAD : share >= c.warn ? WARN : OK;
        fill.style.width = `${Math.min(100, share * 100)}%`;
        fill.style.background = col;
        label.style.color = col;
        label.textContent = lim ? `CARGO ${c.load} / ${c.capacity} cells` : `CARGO ${c.load} cells`;
      }
    },
  };
}
