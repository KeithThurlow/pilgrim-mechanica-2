// Overhead map of the POIs a few km around the mech, from the pure placement: the dunes as a hill-shaded image, the
// placement cells, every POI as an icon by tier (circle 1, square 2, triangle 3, diamond 4, star 5) coloured by
// kind, the mech as an arrow. A 2D canvas over the lab; M toggles it, `?view=map` opens on it.
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";
import { POI_KINDS, POI_KIND_LIST, POI_LEVELS, type PoiField, type PoiKind, type Tier } from "../world/pois";

export const MAP_DEFAULTS = { mapSize: 4000 };
export const MAP_PARAMS: Param[] = [
  { key: "mapSize", label: "Map size (m)", min: 1000, max: 12000, step: 100, group: "POI map", tip: "Width of the overhead map (M)" },
];

export const KIND_COLOUR: Record<PoiKind, string> = {
  outcrop: "#b9a184", wreckPart: "#e0dccf", supplyPod: "#ffb347", debrisField: "#7fc3c9", deadConvoy: "#e2694a",
  fortress: "#ff3b30", hub: "#5ac8fa",
};

const RES = 240;

export class MapView {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private shade: HTMLCanvasElement | null = null;
  private key = "";
  open = false;

  constructor(private pois: PoiField, private ground: Ground, private v: { mapSize: number }) {
    Object.assign(this.canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "6", display: "none", background: "#15171a" } as CSSStyleDeclaration);
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  toggle(on = !this.open) { this.open = on; this.canvas.style.display = on ? "block" : "none"; }
  /** Drop the cached dune image (after the dunes or the POIs change). */
  invalidate() { this.key = ""; }

  private shadeImage(cx: number, cz: number, size: number) {
    const c = document.createElement("canvas");
    c.width = c.height = RES;
    const g = c.getContext("2d")!, img = g.createImageData(RES, RES), step = size / RES;
    const h = new Float32Array((RES + 1) * (RES + 1));
    for (let j = 0; j <= RES; j++) for (let i = 0; i <= RES; i++) h[j * (RES + 1) + i] = this.ground.height(cx - size / 2 + i * step, cz - size / 2 + j * step);
    let lo = Infinity, hi = -Infinity;
    for (const x of h) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const a = h[j * (RES + 1) + i], dx = h[j * (RES + 1) + i + 1] - a, dz = h[(j + 1) * (RES + 1) + i] - a;
      // Light from the upper left of the map; height lifts the tone a little.
      const lit = Math.max(0, Math.min(1, 0.62 - (dx + dz) * 0.5 / step * 1.2 + (a - lo) / Math.max(1, hi - lo) * 0.18));
      const k = (j * RES + i) * 4;
      img.data[k] = 120 + lit * 110; img.data[k + 1] = 98 + lit * 92; img.data[k + 2] = 70 + lit * 66; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** Draw centred on (cx, cz) with the mech at (mx, mz) heading `heading`. */
  draw(cx: number, cz: number, mx: number, mz: number, heading: number) {
    if (!this.open) return;
    const cv = this.canvas, W = (cv.width = innerWidth), H = (cv.height = innerHeight), g = this.ctx;
    const size = this.v.mapSize;
    const ccx = Math.round(cx / 200) * 200, ccz = Math.round(cz / 200) * 200;
    const key = `${ccx},${ccz},${size}`;
    if (key !== this.key || !this.shade) { this.shade = this.shadeImage(ccx, ccz, size); this.key = key; }
    const S = Math.min(W, H) - 40, ox = (W - S) / 2, oy = (H - S) / 2, px = S / size;
    // World x to screen: +X is to the left when looking up +Z (the game camera's view), so flip x.
    const sx = (x: number) => ox + S / 2 - (x - ccx) * px, sy = (z: number) => oy + S / 2 - (z - ccz) * px;
    g.save();
    g.imageSmoothingEnabled = true;
    // The image rows run with +z, columns with +x: flip both to match sx, sy.
    g.translate(ox + S, oy + S); g.scale(-1, -1);
    g.drawImage(this.shade, 0, 0, S, S);
    g.restore();
    // Cells of the finest level.
    const C = this.pois.cellSize(POI_LEVELS.length - 1);
    g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 1;
    const x0 = ccx - size / 2, x1 = ccx + size / 2, z0 = ccz - size / 2, z1 = ccz + size / 2;
    for (let x = Math.ceil(x0 / C) * C; x <= x1; x += C) { g.beginPath(); g.moveTo(sx(x), oy); g.lineTo(sx(x), oy + S); g.stroke(); }
    for (let z = Math.ceil(z0 / C) * C; z <= z1; z += C) { g.beginPath(); g.moveTo(ox, sy(z)); g.lineTo(ox + S, sy(z)); g.stroke(); }
    // POIs.
    const list = this.pois.poisIn(x0, z0, x1, z1);
    const counts = new Map<PoiKind, number>();
    for (const p of list) {
      counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
      icon(g, sx(p.x), sy(p.z), p.tier, KIND_COLOUR[p.kind], Math.max(5, Math.min(11, S / 110)));
    }
    // The mech.
    const hx = sx(mx), hy = sy(mz);
    g.save(); g.translate(hx, hy); g.rotate(-heading); g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 7); g.lineTo(0, 4); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
    // Legend and scale.
    g.fillStyle = "rgba(21,23,26,0.82)"; g.fillRect(ox + 10, oy + 10, 230, 30 + POI_KIND_LIST.length * 22 + 26);
    g.font = "600 14px system-ui, sans-serif"; g.fillStyle = "#f3e6cc";
    g.fillText(`POIs within ${(size / 1000).toFixed(1)} km: ${list.length}`, ox + 20, oy + 30);
    POI_KIND_LIST.forEach((k, i) => {
      const y = oy + 52 + i * 22;
      icon(g, ox + 28, y - 5, POI_KINDS[k].tier, KIND_COLOUR[k], 7);
      g.fillStyle = "#e8e4dc"; g.font = "13px system-ui, sans-serif";
      g.fillText(`${POI_KINDS[k].label} (tier ${POI_KINDS[k].tier}): ${counts.get(k) ?? 0}`, ox + 44, y);
    });
    g.fillStyle = "#9a958c"; g.fillText("M closes the map · cells " + C + " m", ox + 20, oy + 52 + POI_KIND_LIST.length * 22);
    const bar = 500 * px;
    g.fillStyle = "#f3e6cc"; g.fillRect(ox + S - 20 - bar, oy + S - 24, bar, 4);
    g.fillText("500 m", ox + S - 20 - bar, oy + S - 30);
  }
}

function icon(g: CanvasRenderingContext2D, x: number, y: number, tier: Tier, colour: string, r: number) {
  g.fillStyle = colour; g.strokeStyle = "#1a1714"; g.lineWidth = 1.5;
  g.beginPath();
  if (tier === 1) g.arc(x, y, r * 0.8, 0, Math.PI * 2);
  else if (tier === 2) g.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  else if (tier === 3) { g.moveTo(x, y - r); g.lineTo(x + r, y + r * 0.8); g.lineTo(x - r, y + r * 0.8); g.closePath(); }
  else if (tier === 4) { g.moveTo(x, y - r * 1.2); g.lineTo(x + r, y); g.lineTo(x, y + r * 1.2); g.lineTo(x - r, y); g.closePath(); }
  else for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.5 : r * 1.3; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fill(); g.stroke();
}
