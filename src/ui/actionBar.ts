// The action bar (Keith 2026-11-01: "weapon abilities on buttons down the bottom, so we can see cooldowns a little
// better"): a row of square buttons at the bottom centre, one per key: the shoulder and back weapons (1-3), the hull's
// and pack's abilities (3, 4) and the repair kit (Q). Each shows its key, a short name, a dark sweep that unwinds as
// it cools with the seconds left, an amber bar draining while its effect lasts, and a white flash the moment it's
// ready again. Plain DOM, styles written only when they change. Reads ActionSlots; owns nothing in the game.

export interface ActionSlot {
  key: string;
  name: string;
  /** Seconds of cooldown left (0: ready). */
  cool: number;
  /** The full cooldown (s), when known; else the bar takes the largest it saw since the last ready. */
  coolMax?: number;
  /** 0..1 of an effect left (overdrive, a zone, a kit at work); null or absent: none. */
  active?: number | null;
  /** Can be used now (bright border). */
  ready: boolean;
  /** A small line under the name (rounds, kits). */
  sub?: string;
  /** Greyed out (on foot, sprinting with the weapons off). */
  dim?: boolean;
  /** The colour family: weapons amber, abilities teal, the kit green. */
  tone?: "weapon" | "ability" | "kit";
}

const TONE = { weapon: "#ffb347", ability: "#7fd6c8", kit: "#8fd18a" } as const;
const BACK = "rgba(14, 12, 9, 0.72)";
const LINE = "rgba(255, 220, 160, 0.3)";

function el(tag: string, style: Partial<CSSStyleDeclaration>, parent?: HTMLElement) {
  const e = document.createElement(tag) as HTMLDivElement;
  Object.assign(e.style, style);
  parent?.appendChild(e);
  return e;
}
function st(e: HTMLElement, k: string, v: string) {
  const c = ((e as unknown as { _st?: Record<string, string> })._st ??= {});
  if (c[k] === v) return;
  c[k] = v;
  (e.style as unknown as Record<string, string>)[k] = v;
}
function txt(e: HTMLElement, t: string) { if (e.textContent !== t) e.textContent = t; }

interface Button { box: HTMLDivElement; sweep: HTMLDivElement; secs: HTMLDivElement; key: HTMLDivElement; name: HTMLDivElement; sub: HTMLDivElement; bar: HTMLDivElement; max: number; was: number; flash: number }

export class ActionBar {
  readonly root: HTMLDivElement;
  private row: HTMLDivElement;
  readonly noteEl: HTMLDivElement;
  private buttons: Button[] = [];

  constructor(parent: HTMLElement = document.body) {
    this.root = el("div", { position: "fixed", left: "50%", bottom: "34px", transform: "translateX(-50%)", pointerEvents: "none", zIndex: "20", font: "600 11px system-ui, sans-serif", color: "#f3e6d0", textShadow: "0 1px 2px #000", textAlign: "center" }, parent);
    this.root.className = "action-bar"; // phones in portrait: lifted above the touch pad (lab.css)
    this.noteEl = el("div", { marginBottom: "4px", color: "rgba(243, 230, 208, 0.85)", minHeight: "14px" }, this.root);
    this.row = el("div", { display: "flex", gap: "6px", alignItems: "flex-end", justifyContent: "center" }, this.root);
  }

  private make(): Button {
    const box = el("div", { position: "relative", borderRadius: "6px", background: BACK, overflow: "hidden", boxSizing: "border-box" }, this.row);
    const sweep = el("div", { position: "absolute", inset: "0" }, box);
    const key = el("div", { position: "absolute", left: "4px", top: "2px", font: "700 12px system-ui, sans-serif" }, box);
    const secs = el("div", { position: "absolute", left: "0", right: "0", top: "50%", transform: "translateY(-58%)", font: "700 17px system-ui, sans-serif", color: "#fff" }, box);
    const name = el("div", { position: "absolute", left: "1px", right: "1px", bottom: "9px", fontSize: "10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip" }, box);
    const sub = el("div", { position: "absolute", right: "4px", top: "3px", fontSize: "10px", opacity: "0.85" }, box);
    const bar = el("div", { position: "absolute", left: "0", bottom: "0", height: "4px" }, box);
    return { box, sweep, secs, key, name, sub, bar, max: 0, was: 0, flash: 0 };
  }

  update(dt: number, slots: ActionSlot[], size: number, note: string, show = true) {
    st(this.root, "display", show && slots.length ? "" : "none");
    txt(this.noteEl, note);
    if (!show) return;
    while (this.buttons.length < slots.length) this.buttons.push(this.make());
    this.buttons.forEach((b, i) => {
      const s = slots[i];
      st(b.box, "display", s ? "" : "none");
      if (!s) return;
      st(b.box, "width", `${size}px`); st(b.box, "height", `${size}px`);
      // A gap before the kit, so the weapon keys read as one group.
      st(b.box, "marginLeft", s.tone === "kit" && i > 0 ? "10px" : "0");
      const col = TONE[s.tone ?? "weapon"];
      // The cooldown's share: from coolMax, else the largest cooldown seen since it was last ready.
      if (s.cool <= 0) b.max = 0;
      else if (s.cool > b.max) b.max = s.cool;
      const max = s.coolMax && s.coolMax > 0 ? s.coolMax : b.max;
      const share = s.cool > 0 && max > 0 ? Math.min(1, s.cool / max) : 0;
      if (b.was > 0 && s.cool <= 0) b.flash = 1;
      b.was = s.cool;
      b.flash = Math.max(0, b.flash - dt * 3);
      // The sweep: a dark wedge clockwise from the top, the share still to cool.
      st(b.sweep, "background", share > 0 ? `conic-gradient(rgba(0,0,0,0.68) ${(share * 360).toFixed(1)}deg, transparent 0)` : s.ready || s.active ? "transparent" : "rgba(0,0,0,0.35)");
      txt(b.secs, s.cool > 0 ? (s.cool < 10 ? s.cool.toFixed(1) : String(Math.ceil(s.cool))) : "");
      txt(b.key, s.key); st(b.key, "color", col);
      txt(b.name, s.name);
      txt(b.sub, s.sub ?? "");
      const act = s.active ?? null;
      st(b.bar, "width", act !== null ? `${(Math.max(0, Math.min(1, act)) * 100).toFixed(1)}%` : "0");
      st(b.bar, "background", col);
      const lit = act !== null && act > 0;
      const border = b.flash > 0 ? `rgba(255,255,255,${(0.5 + 0.5 * b.flash).toFixed(2)})` : lit ? col : s.ready && s.cool <= 0 ? col : LINE;
      st(b.box, "border", `${lit || b.flash > 0 ? 2 : 1}px solid ${border}`);
      st(b.box, "boxShadow", lit ? `0 0 10px 1px ${col}` : b.flash > 0 ? `0 0 ${Math.round(14 * b.flash)}px 2px rgba(255,255,255,0.7)` : "none");
      st(b.box, "opacity", s.dim ? "0.45" : "1");
    });
  }
}
