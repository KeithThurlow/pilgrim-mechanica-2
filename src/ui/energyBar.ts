// The energy bars (Keith 2026-10-27): one bar per dash charge, stacked at the left edge of the screen, each filling from
// the bottom. Full: a dash in hand (bright). Part full: refilling, or being drained by the sprint (dim; it pulses while
// the sprint drains it). Reads a Dash (src/mech/dash.ts); draws nothing else.
import type { Dash } from "../mech/dash";

const FULL = "#ffb43a";
const PART = "rgba(255, 180, 58, 0.55)";
const BACK = "rgba(20, 16, 10, 0.55)";

let shared: EnergyBar | null = null;
/** The one set of bars on the page (made on first use). */
export function energyHud() { return (shared ??= new EnergyBar()); }

export class EnergyBar {
  private root: HTMLDivElement;
  private bars: { box: HTMLDivElement; fill: HTMLDivElement }[] = [];

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed", left: "14px", top: "50%", transform: "translateY(-50%)", display: "flex",
      flexDirection: "column-reverse", gap: "6px", pointerEvents: "none", zIndex: "20",
    } as Partial<CSSStyleDeclaration>);
    parent.appendChild(this.root);
  }

  update(dash: Dash, show = true) {
    this.root.style.display = show ? "flex" : "none";
    if (!show) return;
    while (this.bars.length < dash.bars.length) {
      const box = document.createElement("div"), fill = document.createElement("div");
      Object.assign(box.style, {
        width: "14px", height: "96px", background: BACK, border: "1px solid rgba(255, 220, 160, 0.35)",
        borderRadius: "3px", position: "relative", overflow: "hidden",
      } as Partial<CSSStyleDeclaration>);
      Object.assign(fill.style, { position: "absolute", left: "0", right: "0", bottom: "0" } as Partial<CSSStyleDeclaration>);
      box.appendChild(fill);
      this.root.appendChild(box);
      this.bars.push({ box, fill });
    }
    while (this.bars.length > dash.bars.length) this.bars.pop()!.box.remove();
    const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.02);
    dash.bars.forEach((e, i) => {
      const { fill } = this.bars[i];
      const full = e >= 0.999;
      fill.style.height = `${(e * 100).toFixed(1)}%`;
      fill.style.background = full ? FULL : PART;
      fill.style.opacity = !full && e > 0 && dash.idle < 0.05 ? pulse.toFixed(2) : "1";
    });
  }
}
