// The expedition HUD (DOM): bottom left, the radar scope with a column beside it: where you are in the loop (aboard,
// out m:ss), "Home m:ss" (the predicted return time) and "Fuel m:ss" with a bar (amber, then red, when fuel isn't
// comfortably above the way home), the at-risk list in amber while out (a lock once banked), the convoy's scrap, and
// the recall prompt with its hold bar. Top centre: the salvage prompt and the big notes (banked, recovered, lost).
// A full-screen fade for the recovery.
import type { Expedition } from "./expedition";
import { clock } from "./returnPoint";

const LOCK = `<svg width="12" height="13" viewBox="0 0 12 13" style="vertical-align:-1px"><rect x="1" y="5.5" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M3.3 5.5V4a2.7 2.7 0 0 1 5.4 0v1.5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>`;
const COL = { ok: "#cfe9df", amber: "#ffb347", red: "#ff6a4a", dim: "#9a958c" };

export interface HudFrame {
  exp: Expedition;
  fuelLeft: number;
  fuelShare: number;
  /** Home estimate (s), Infinity if unreachable; null aboard. */
  eta: number | null;
  warn: 0 | 1 | 2;
  /** The salvage prompt (or ""). */
  prompt: string;
  /** Show the recall hint (out, alive). */
  canRecall: boolean;
  bankShow: number;
}

export class ExpeditionHud {
  readonly root = document.createElement("div");
  private col = document.createElement("div");
  private top = document.createElement("div");
  private promptEl = document.createElement("div");
  private noteEl = document.createElement("div");
  private fadeEl = document.createElement("div");
  private fadeText = document.createElement("div");
  private noteT = 0;
  private lastEnd: unknown = null;
  private time = 0;

  constructor(radar: HTMLCanvasElement) {
    Object.assign(this.root.style, {
      position: "fixed", left: "10px", bottom: "84px", display: "flex", alignItems: "flex-end", gap: "10px",
      pointerEvents: "none", zIndex: "4", font: "600 13px/1.35 system-ui, 'Segoe UI', sans-serif", color: COL.ok,
      textShadow: "0 1px 3px #000d",
    } as CSSStyleDeclaration);
    Object.assign(this.col.style, {
      background: "rgba(10, 14, 14, 0.62)", padding: "8px 10px", borderRadius: "6px", minWidth: "190px", fontVariantNumeric: "tabular-nums",
    } as CSSStyleDeclaration);
    this.root.append(radar, this.col);
    document.body.appendChild(this.root);

    Object.assign(this.top.style, {
      position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none",
      font: "600 15px/1.3 system-ui, 'Segoe UI', sans-serif", color: "#f3e6cc", textShadow: "0 1px 3px #000c", zIndex: "5",
    } as CSSStyleDeclaration);
    Object.assign(this.noteEl.style, { font: "700 24px/1.2 system-ui, 'Segoe UI', sans-serif", opacity: "0", marginTop: "4px" });
    this.top.append(this.promptEl, this.noteEl);
    document.body.appendChild(this.top);

    Object.assign(this.fadeEl.style, {
      position: "fixed", inset: "0", background: "#000", opacity: "0", pointerEvents: "none", zIndex: "8",
      display: "flex", alignItems: "center", justifyContent: "center",
    } as CSSStyleDeclaration);
    Object.assign(this.fadeText.style, { font: "600 18px system-ui, sans-serif", letterSpacing: "0.12em", color: "#cfe9df", textTransform: "uppercase" });
    this.fadeEl.append(this.fadeText);
    document.body.appendChild(this.fadeEl);
  }

  update(dt: number, f: HudFrame) {
    this.time += dt;
    const e = f.exp;
    const warnCol = f.warn === 2 ? COL.red : f.warn === 1 ? COL.amber : COL.ok;
    const blink = f.warn === 2 && Math.sin(this.time * 10) < 0 ? 0.78 : 1;
    // The column's edge takes the warning colour too, so a glance at the corner says it.
    this.col.style.boxShadow = f.warn && e.state === "out" ? `inset 3px 0 0 ${warnCol}` : "none";
    this.col.style.background = f.warn === 2 && e.state === "out" ? "rgba(48, 10, 6, 0.72)" : "rgba(10, 14, 14, 0.62)";
    const lines: string[] = [];
    const state = e.state === "out" ? `OUT ${clock(e.outFor)}` : e.state === "aboard" ? "ABOARD" : e.state === "lost" ? "MECH DESTROYED" : "RECOVERY";
    lines.push(`<div style="letter-spacing:0.08em;color:${e.state === "out" ? COL.amber : COL.ok}">${state}</div>`);
    if (e.state === "out") {
      const home = f.eta === null ? "--:--" : clock(f.eta);
      lines.push(`<div style="font-size:17px;color:${warnCol};opacity:${blink}">Home ${home} · Fuel ${clock(f.fuelLeft)}</div>`);
      if (f.warn === 2) lines.push(`<div style="color:${COL.red};font-size:11px;letter-spacing:0.08em">HEAD BACK NOW</div>`);
      else if (f.warn === 1) lines.push(`<div style="color:${COL.amber};font-size:11px;letter-spacing:0.08em">FUEL GETTING SHORT</div>`);
    } else lines.push(`<div style="font-size:17px;color:${COL.dim}">Fuel ${clock(f.fuelLeft)}</div>`);
    const w = Math.round(Math.max(0, Math.min(1, f.fuelShare)) * 100);
    lines.push(`<div style="height:5px;background:#ffffff1c;border-radius:3px;margin:3px 0 6px"><div style="height:100%;width:${w}%;background:${e.state === "out" ? warnCol : COL.ok};border-radius:3px"></div></div>`);
    // At risk while out; banked with a lock just after a pick-up.
    const banked = e.last && e.last.reason === "banked" && e.clock - e.last.at < f.bankShow;
    if (e.state === "out") {
      lines.push(`<div style="color:${COL.amber}">At risk ◆ ${e.scrapAtRisk} scrap${e.itemsAtRisk ? ` · ${e.itemsAtRisk} item${e.itemsAtRisk > 1 ? "s" : ""}` : ""}</div>`);
      for (const l of e.atRisk.slice(-4)) lines.push(`<div style="color:${COL.amber};opacity:0.8;font-weight:500;padding-left:10px">${l.label} ${l.kind === "scrap" ? `+${l.amount}` : `${l.item.rarity} ${l.item.base}`}</div>`);
    } else if (banked && e.last) {
      lines.push(`<div style="color:${COL.ok}">${LOCK} Banked ◆ ${e.last.scrap} scrap${e.last.items ? ` · ${e.last.items} items` : ""}</div>`);
    }
    lines.push(`<div style="color:${COL.ok};margin-top:4px">Convoy ${LOCK} ◆ ${e.bank.scrap}</div>`);
    if (f.canRecall) {
      const k = Math.round(e.recall * 100);
      lines.push(`<div style="color:${COL.dim};font-weight:500;margin-top:4px">Hold Q: call recovery (loot lost)</div>`);
      if (k > 0) lines.push(`<div style="height:4px;background:#ffffff1c;border-radius:2px;margin-top:2px"><div style="height:100%;width:${k}%;background:${COL.red};border-radius:2px"></div></div>`);
    }
    this.col.innerHTML = lines.join("");

    // Top: the salvage prompt, and a note when a run ends.
    this.promptEl.textContent = f.prompt;
    if (e.last && e.last !== this.lastEnd) {
      this.lastEnd = e.last;
      const r = e.last, what = `${r.scrap} scrap${r.items ? ` and ${r.items} item${r.items > 1 ? "s" : ""}` : ""}`;
      const text = r.reason === "banked" ? `Banked ${what}` : r.reason === "destroyed" ? `Mech destroyed: ${what} lost` : r.reason === "pilot" ? `Pilot killed: ${what} lost`
        : r.reason === "fuel" ? `Out of fuel: recovered, ${what} lost` : `Recovered: ${what} lost`;
      this.noteEl.textContent = `${text} · ${clock(r.duration)} out`;
      this.noteEl.style.color = r.reason === "banked" ? "#bdf0c8" : "#ffb09a";
      this.noteT = 4;
      this.fadeText.textContent = r.reason === "destroyed" ? "Mech lost · recovering the pilot" : r.reason === "pilot" ? "Pilot killed · the convoy recovers the mech" : r.reason === "fuel" ? "Out of fuel · recovery" : "Recovery";
    }
    this.noteT = Math.max(0, this.noteT - dt);
    this.noteEl.style.opacity = String(Math.min(1, this.noteT));
    this.fadeEl.style.opacity = String(e.fade);
  }
}
