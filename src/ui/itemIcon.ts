// Placeholder grid images (Keith 2026-11-02: "every item to have a grid size, a placeholder grid image"): a line
// drawing per size class, stretched to the item's cells and drawn in its rarity colour. Swap for real icons later
// (an image per base would go here, by base id, falling back to these).
import { gridClassOf, itemCells, type GridClass, type GridSizeValues } from "../items/gridSize";
import type { Item } from "../items/item";

const NS = "http://www.w3.org/2000/svg";

/** The drawing for a class in a box W × H (10 units a cell), long side down. */
function shapes(c: GridClass, W: number, H: number): string {
  const cx = W / 2, m = 2;
  const r = (x: number, y: number, w: number, h: number, rx = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
  const ci = (x: number, y: number, rr: number) => `<circle cx="${x}" cy="${y}" r="${rr}"/>`;
  switch (c) {
    case "hullGun": case "hullGunLong": {
      const bw = Math.min(W * 0.22, 4);
      return r(cx - bw / 2, m, bw, H * 0.62) + r(m + 1, H * 0.55, W - 2 * m - 2, H * 0.38, 2) + ci(cx, H * 0.74, Math.min(W, H) * 0.12);
    }
    case "held": case "heldLong":
      return r(cx - 1.5, m, 3, H * 0.5) + r(m + 2, H * 0.42, W - 2 * m - 4, H * 0.3, 1.5) + r(cx - 2, H * 0.68, 4, H * 0.28, 1);
    case "sword": case "swordBig": case "swordShort": {
      const bw = Math.max(2.5, W * 0.45);
      return `<path d="M${cx - bw / 2} ${H * 0.78} L${cx - bw / 2} ${m + 3} L${cx} ${m} L${cx + bw / 2} ${m + 3} L${cx + bw / 2} ${H * 0.78} Z"/>`
        + r(m, H * 0.78, W - 2 * m, 1.6, 0.5) + r(cx - 1, H * 0.8, 2, H * 0.17, 0.5);
    }
    case "hull":
    case "hullBig":
      return `<path d="M${m + 3} ${m} L${W - m - 3} ${m} L${W - m} ${H * 0.45} L${W - m - 4} ${H - m} L${m + 4} ${H - m} L${m} ${H * 0.45} Z"/>`
        + ci(m + 5, H * 0.45, 2) + ci(W - m - 5, H * 0.45, 2) + r(cx - 3, m + 2, 6, 3);
    case "legs": {
      const leg = (x: number) => `<path d="M${x} ${m} L${x + 2} ${H * 0.45} L${x - 2} ${H * 0.7} L${x + 1} ${H - m}" fill="none" stroke-width="2.2"/>`;
      return r(m + 2, m, W - 2 * m - 4, 3) + leg(W * 0.3) + leg(W * 0.7);
    }
    case "arm":
      return `<path d="M${m + 2} ${m + 2} L${W * 0.55} ${m + 2} L${W * 0.55} ${H - m - 4}" fill="none" stroke-width="3"/>` + r(W * 0.45, H - m - 5, W * 0.35, 4, 1);
    case "shoulder": {
      let s = r(m, m, W - 2 * m, H - 2 * m, 2);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) s += ci(W * (0.32 + x * 0.36), H * (0.32 + y * 0.36), Math.min(W, H) * 0.11);
      return s;
    }
    case "pack":
      return r(m + 1, m, W - 2 * m - 2, H - 2 * m, 3) + r(cx - 3, H * 0.3, 6, H * 0.35, 1) + r(m + 3, m - 1, 2, 3, 0.5) + r(W - m - 5, m - 1, 2, 3, 0.5);
    case "waist":
      return r(m, m, W - 2 * m, H - 2 * m, (H - 2 * m) / 2) + `<line x1="${W * 0.35}" y1="${m}" x2="${W * 0.35}" y2="${H - m}"/><line x1="${W * 0.65}" y1="${m}" x2="${W * 0.65}" y2="${H - m}"/>`;
    case "sensor":
      return r(m, m + 1, W - 2 * m, H - 2 * m - 2, 2) + ci(W * 0.68, H / 2, Math.min(W, H) * 0.22);
    case "summon":
      return ci(cx, H / 2, Math.min(W, H) * 0.16) + [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([x, y]) => ci(W * x, H * y, Math.min(W, H) * 0.13)).join("");
    case "protocol": {
      let s = r(2.5, 2.5, W - 5, H - 5, 1);
      for (let i = 0; i < 3; i++) s += `<line x1="${2.5 + (W - 5) * (i + 1) / 4}" y1="0.5" x2="${2.5 + (W - 5) * (i + 1) / 4}" y2="2.5"/><line x1="${2.5 + (W - 5) * (i + 1) / 4}" y1="${H - 2.5}" x2="${2.5 + (W - 5) * (i + 1) / 4}" y2="${H - 0.5}"/>`;
      return s;
    }
    case "repairKit":
      return r(m, m, W - 2 * m, H - 2 * m, 2) + r(cx - 1, H / 2 - 3.5, 2, 7, 0.3) + r(cx - 3.5, H / 2 - 1, 7, 2, 0.3);
    case "salvage0": case "salvage1": case "salvage2": case "salvage3": {
      if (c !== "salvage0") return r(m, m, W - 2 * m, H - 2 * m, 1) + `<line x1="${m}" y1="${H / 3}" x2="${W - m}" y2="${H / 3}"/><line x1="${m}" y1="${2 * H / 3}" x2="${W - m}" y2="${2 * H / 3}"/><line x1="${W / 2}" y1="${m}" x2="${W / 2}" y2="${H - m}"/>`;
      return `<path d="M${m} ${H - m} L${W * 0.2} ${H * 0.45} L${W * 0.38} ${H * 0.55} L${W * 0.5} ${H * 0.2} L${W * 0.66} ${H * 0.5} L${W * 0.8} ${H * 0.35} L${W - m} ${H - m} Z"/>`
        + `<path d="M${W * 0.3} ${H * 0.8} L${W * 0.45} ${H * 0.62} L${W * 0.6} ${H * 0.78}" fill="none"/>` + ci(W * 0.7, H * 0.75, Math.min(W, H) * 0.08);
    }
    case "consumable": case "material":
      return `<path d="M${cx} ${m} L${W - m} ${H * 0.3} L${W - m} ${H * 0.7} L${cx} ${H - m} L${m} ${H * 0.7} L${m} ${H * 0.3} Z"/>` + ci(cx, H / 2, Math.min(W, H) * 0.15);
  }
}

/** The item's grid image as an SVG element sized to its cells (turned 90° when `rot`). */
/** Classes drawn long side down: when their cells lie flat (hull weapons, Keith 2026-11-03), the drawing is turned. */
const TALL: GridClass[] = ["hullGun", "hullGunLong", "held", "heldLong", "sword", "swordBig", "swordShort", "legs", "arm"];

export function itemIcon(item: Item, color: string, turned = false, v?: Partial<GridSizeValues>): SVGSVGElement {
  const cells = itemCells(item, v);
  const flat = TALL.includes(gridClassOf(item)) && cells.w > cells.h;
  // Draw it tall, then turn it to lie flat (and once more if the player turned it).
  const w = flat ? cells.h : cells.w, h = flat ? cells.w : cells.h;
  const rot = flat !== turned;
  const W = w * 10, H = h * 10;
  const svg = document.createElementNS(NS, "svg");
  const VW = rot ? H : W, VH = rot ? W : H;
  svg.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const turn = rot ? ` transform="translate(${H} 0) rotate(90)"` : "";
  svg.innerHTML = `<g${turn} fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${shapes(gridClassOf(item), W, H)}</g>`;
  return svg;
}
