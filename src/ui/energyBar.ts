// The energy bars (Keith 2026-10-27): one bar per dash charge, stacked at the left edge of the screen (from 120 px down,
// the upright hull bar beside them; Keith 2026-11-01), each filling from
// the bottom. Full: a dash in hand (bright). Part full: refilling, or being drained by the sprint (dim; it pulses while
// the sprint drains it). Reads a Dash (src/mech/dash.ts); draws nothing else.
// The reactor (Keith 2026-11-02): one taller cyan bar beside them, what energy weapons draw on (ReactorBar), shown only
// when an energy weapon is fitted.
import type { Dash } from "../mech/dash";
import type { Reactor } from "../mech/reactor";

const FULL = "#ffb43a";
const PART = "rgba(255, 180, 58, 0.55)";
const BACK = "rgba(20, 16, 10, 0.55)";

let stack: HTMLDivElement | null = null;
/**
 * The left edge's stack (Keith 2026-11-01): the energy bars, then the upright hull bar (src/ui/vitalsHud.ts) beside
 * them, stretched to the bars' height.
 */
export function leftStack() {
  if (stack) return stack;
  stack = document.createElement("div");
  Object.assign(stack.style, {
    position: "fixed", left: "14px", top: "120px", display: "flex", alignItems: "stretch", gap: "8px", pointerEvents: "none", zIndex: "20",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(stack);
  return stack;
}

let sharedReactor: ReactorBar | null = null;
/** The one reactor bar on the page (made on first use). */
export function reactorHud() { return (sharedReactor ??= new ReactorBar()); }

const CYAN = "#5fd8ff", CYAN_DIM = "rgba(95, 216, 255, 0.5)";

/** The reactor: one bar as tall as the kinetic stack, its capacity in tick marks (one per bar of energy). */
export class ReactorBar {
  private root: HTMLDivElement;
  private fill: HTMLDivElement;
  private ticks: HTMLDivElement[] = [];

  constructor(parent: HTMLElement = leftStack()) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      width: "18px", background: BACK, border: "1px solid rgba(160, 230, 255, 0.45)", borderRadius: "3px",
      position: "relative", overflow: "hidden", order: "0", minHeight: "120px",
    } as Partial<CSSStyleDeclaration>);
    this.root.title = "Reactor: energy weapons";
    this.fill = document.createElement("div");
    Object.assign(this.fill.style, { position: "absolute", left: "0", right: "0", bottom: "0", background: CYAN } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.fill);
    parent.appendChild(this.root);
  }

  update(r: Reactor, show = true) {
    this.root.style.display = show ? "block" : "none";
    if (!show) return;
    const cap = r.cap, k = Math.max(0, Math.min(1, r.charge / cap));
    this.fill.style.height = `${(k * 100).toFixed(1)}%`;
    this.fill.style.background = k >= 0.999 ? CYAN : CYAN_DIM;
    this.fill.style.opacity = r.idle < 0.05 ? (0.7 + 0.3 * Math.sin(performance.now() * 0.03)).toFixed(2) : "1";
    const n = Math.max(0, Math.ceil(cap) - 1);
    while (this.ticks.length < n) {
      const t = document.createElement("div");
      Object.assign(t.style, { position: "absolute", left: "0", right: "0", height: "1px", background: "rgba(10, 20, 26, 0.8)" } as Partial<CSSStyleDeclaration>);
      this.root.appendChild(t); this.ticks.push(t);
    }
    this.ticks.forEach((t, i) => { t.style.display = i < n ? "block" : "none"; t.style.bottom = `${(((i + 1) / cap) * 100).toFixed(1)}%`; });
  }
}

let shared: EnergyBar | null = null;
/** The one set of bars on the page (made on first use). */
export function energyHud() { return (shared ??= new EnergyBar()); }

export class EnergyBar {
  private root: HTMLDivElement;
  private bars: { box: HTMLDivElement; fill: HTMLDivElement }[] = [];

  constructor(parent: HTMLElement = leftStack()) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, { display: "flex", flexDirection: "column-reverse", gap: "6px", order: "0" } as Partial<CSSStyleDeclaration>);
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
