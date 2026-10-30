// The magazines by the reticle (Keith 2026-10-31: reload shown on the HUD by the weapon): two thin arcs round the mouse
// cursor, the left gun's on the left and the right gun's on the right. Each shows the magazine left (pale), and while
// it reloads it refills in amber from the bottom. Rails (no magazine) and empty sides show nothing. Cosmetic, local.
import type { UpperSim } from "../mech/upper";
import { magShare } from "../weapons/magazine";

const R = 26, W = 3;
const NS = "http://www.w3.org/2000/svg";

/** An arc on the left (side -1) or right (+1) of the circle from the bottom up, filled `k` (0..1) of its half. */
function arc(side: 1 | -1, k: number): string {
  // Angle t from the bottom (0) up to the top (π), a small gap at each pole: x = side · sin t, y = cos t (screen y down).
  const pt = (t: number) => `${(side * Math.sin(t) * R).toFixed(1)} ${(Math.cos(t) * R).toFixed(1)}`;
  const t0 = 0.25, t1 = t0 + (Math.PI - 0.5) * Math.max(0, Math.min(1, k));
  if (t1 - t0 < 1e-3) return "";
  return `M ${pt(t0)} A ${R} ${R} 0 0 ${side > 0 ? 0 : 1} ${pt(t1)}`;
}

export class ReloadHud {
  private svg: SVGSVGElement;
  private back: SVGPathElement[] = [];
  private fill: SVGPathElement[] = [];

  constructor(parent: HTMLElement = document.body) {
    this.svg = document.createElementNS(NS, "svg");
    const s = this.svg.style;
    s.position = "fixed"; s.left = "0"; s.top = "0"; s.width = `${2 * R + 8}px`; s.height = `${2 * R + 8}px`;
    s.pointerEvents = "none"; s.zIndex = "20"; s.overflow = "visible"; s.display = "none";
    this.svg.setAttribute("viewBox", `${-R - 4} ${-R - 4} ${2 * R + 8} ${2 * R + 8}`);
    for (let i = 0; i < 2; i++) {
      const b = document.createElementNS(NS, "path"), f = document.createElementNS(NS, "path");
      for (const [p, c, o] of [[b, "#000", "0.35"], [f, "#e8e2d4", "0.85"]] as const) {
        p.setAttribute("fill", "none"); p.setAttribute("stroke", c); p.setAttribute("stroke-width", String(W)); p.setAttribute("stroke-linecap", "round"); p.setAttribute("opacity", o);
        this.svg.append(p);
      }
      b.setAttribute("d", arc(i === 0 ? -1 : 1, 1));
      this.back.push(b); this.fill.push(f);
    }
    parent.append(this.svg);
  }

  /** Each frame: where the mouse is (screen px; null hides it) and the guns. */
  update(mouse: { x: number; y: number } | null, upper: UpperSim, show = true) {
    if (!mouse || !show) { this.svg.style.display = "none"; return; }
    this.svg.style.display = "block";
    this.svg.style.transform = `translate(${mouse.x - R - 4}px, ${mouse.y - R - 4}px)`;
    // The mech's left gun (side +1, upper gun 0) is on the screen's left side of the ring.
    upper.guns.forEach((g, i) => {
      const has = g.enabled && g.stats?.cls !== "rail";
      this.back[i].style.display = this.fill[i].style.display = has ? "" : "none";
      if (!has) return;
      const reloading = g.mag.reloading > 0;
      this.fill[i].setAttribute("d", arc(i === 0 ? -1 : 1, magShare(g.mag)));
      this.fill[i].setAttribute("stroke", reloading ? "#ffb347" : "#e8e2d4");
      this.fill[i].setAttribute("opacity", reloading ? "1" : g.mag.left / Math.max(1, g.mag.size) < 0.25 ? "1" : "0.75");
    });
  }

  dispose() { this.svg.remove(); }
}
