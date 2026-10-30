// The loot panel (DOM, drawing only; the rules are expedition.ts): it sits in the expedition HUD's column and shows
// - out: AT RISK with the scrap as a rolling number that ticks up as the clumps land, and a line per item (rarity
//   colour, name, level, power, DPS), each flashing in as it's picked up;
// - banked (the crane has the mech): the list counted into the convoy's bank one line at a time: the scrap rolls over
//   into the bank total with ticks, each item thunks across in its colour, a payday chord, BANKED;
// - lost (a forced recovery, a destroyed mech, the pilot killed): every line struck through and fading, LOST, a low
//   sound; then the list is visibly empty;
// - always: the convoy's bank (scrap and items).
// Plus a short pickup card at the bottom centre: name, rarity, level, power, DPS and +/- against what's fitted.
import type { Param } from "../core/tweaks";
import type { Expedition, ExpEvent, Loot } from "./expedition";
import type { LootSound } from "../audio/lootSound";
import type { Item } from "../items/item";
import { RARITY, tierOf } from "../items/rarity";
import { levelOf } from "../items/level";
import { itemPower, itemDps, dpsText, versusFitted } from "../items/power";
import { itemName } from "./drops";
import { LOCK } from "./expeditionHud";

export const LOOT_HUD_DEFAULTS = { rollMin: 25, rollK: 8, bankScrapTime: 1.4, bankItemGap: 0.5, lostLineGap: 0.15, lostFade: 1.4, cardShow: 3.5, riskLines: 6 };
export type LootHudValues = typeof LOOT_HUD_DEFAULTS & { bankShow: number };
const G = "Loot";
export const LOOT_HUD_PARAMS: Param[] = [
  { key: "rollMin", label: "Scrap count rolls at least (/s)", min: 1, max: 200, step: 1, group: G },
  { key: "rollK", label: "Scrap count catch-up (per s)", min: 0.5, max: 30, step: 0.5, group: G, tip: "The rolling number closes this share of the gap each second (or rollMin, whichever is faster)" },
  { key: "bankScrapTime", label: "Banking: scrap rolls over in (s)", min: 0.2, max: 5, step: 0.1, group: G },
  { key: "bankItemGap", label: "Banking: per item (s)", min: 0.1, max: 2, step: 0.05, group: G },
  { key: "lostLineGap", label: "Lost: lines go every (s)", min: 0, max: 1, step: 0.01, group: G },
  { key: "lostFade", label: "Lost: a line fades in (s)", min: 0.2, max: 4, step: 0.1, group: G },
  { key: "cardShow", label: "Pickup card shown (s)", min: 0.5, max: 10, step: 0.5, group: G },
  { key: "riskLines", label: "Item lines shown", min: 1, max: 20, step: 1, group: G },
];

const AMBER = "#ffb347", OK = "#cfe9df", DIM = "#9a958c", RED = "#ff6a4a", GREEN = "#bdf0c8";
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** "Name · Lv 7 · P 112 · 340 dps" for an item. */
export function itemLine(it: Item): string {
  const dps = dpsText(it);
  return `${esc(itemName(it))} · Lv ${levelOf(it)} · P ${itemPower(it)}${dps ? ` · ${dps}` : ""}`;
}

interface Line { loot: Loot; age: number }
type Mode = "idle" | "risk" | "bank" | "lost";

export class LootHud {
  readonly el = document.createElement("div");
  private card = document.createElement("div");
  private mode: Mode = "idle";
  private lines: Line[] = [];
  private shown = 0;
  private bump = 0;
  private t = 0;
  // Banking.
  private bankBefore = 0;
  private bankScrap = 0;
  private bankItems: Loot[] = [];
  private bankShown = 0;
  private ticks = 0;
  private thunked = 0;
  private paid = false;
  private cardT = 0;
  /** What's fitted, for the pickup card's +/- (the lab sets it). */
  fitted: () => readonly (Item | null)[] = () => [];

  constructor(public v: LootHudValues, private sound: LootSound | null, slot: HTMLElement) {
    Object.assign(this.el.style, { marginTop: "6px", fontVariantNumeric: "tabular-nums" } as CSSStyleDeclaration);
    slot.appendChild(this.el);
    Object.assign(this.card.style, {
      position: "fixed", left: "50%", bottom: "150px", transform: "translateX(-50%)", pointerEvents: "none", zIndex: "5",
      background: "rgba(10, 14, 14, 0.82)", padding: "8px 14px", borderRadius: "6px", minWidth: "220px", textAlign: "center",
      font: "600 13px/1.4 system-ui, 'Segoe UI', sans-serif", color: OK, textShadow: "0 1px 3px #000d", opacity: "0", transition: "opacity 0.2s",
    } as CSSStyleDeclaration);
    document.body.appendChild(this.card);
  }

  /** The events since last frame (drained by the caller). */
  events(evs: readonly ExpEvent[], e: Expedition) {
    for (const ev of evs) {
      if (ev.type === "added") {
        if (this.mode !== "risk") this.startRisk();
        if (ev.loot.kind === "item") { this.lines.push({ loot: ev.loot, age: 0 }); this.showCard(ev.loot.item); }
      } else if (ev.type === "banked") {
        this.mode = "bank"; this.t = 0; this.paid = false; this.ticks = 0; this.thunked = 0;
        this.bankBefore = ev.scrapBefore; this.bankShown = ev.scrapBefore;
        this.bankScrap = ev.lines.reduce((n, l) => n + (l.kind === "scrap" ? l.amount : 0), 0);
        this.bankItems = ev.lines.filter((l) => l.kind === "item");
      } else if (ev.type === "lost") {
        this.mode = "lost"; this.t = 0;
        this.lines = ev.lines.map((loot) => ({ loot, age: 0 }));
        this.sound?.lost();
      }
    }
    if (e.state === "out" && this.mode === "idle") this.startRisk();
  }

  private startRisk() { this.mode = "risk"; this.lines = []; this.shown = 0; this.t = 0; }

  private showCard(it: Item) {
    const col = RARITY[it.rarity].color, p = itemPower(it), dps = itemDps(it), vs = versusFitted(it, this.fitted());
    const diff = (a: number, b: number, unit: string) => {
      const d = Math.round(a - b);
      return `<span style="color:${d > 0 ? GREEN : d < 0 ? RED : DIM}">${d > 0 ? "+" : ""}${d}${unit}</span>`;
    };
    const cmp = !vs ? `<span style="color:${DIM}">nothing of this kind fitted</span>`
      : dps !== null && vs.dps !== null ? `${diff(dps, vs.dps, " dps")} · ${diff(p, vs.power, " power")} vs fitted` : `${diff(p, vs.power, " power")} vs fitted`;
    this.card.style.border = `1px solid ${col}`;
    this.card.style.boxShadow = `0 0 ${6 + 4 * tierOf(it.rarity)}px ${col}88`;
    this.card.innerHTML = `<div style="color:${col};font-size:15px">${esc(itemName(it))}</div>`
      + `<div style="color:${col};font-size:11px;letter-spacing:0.08em">${RARITY[it.rarity].name.toUpperCase()} · LEVEL ${levelOf(it)}</div>`
      + `<div>Power ${p}${dps !== null ? ` · ${dpsText(it)}` : ""}</div><div style="font-size:12px">${cmp}</div>`;
    this.cardT = this.v.cardShow;
  }

  /** One frame. inFlight: scrap still flying in (held back from the count). */
  update(dt: number, e: Expedition, inFlight: number) {
    const v = this.v;
    this.t += dt;
    this.cardT -= dt;
    this.card.style.opacity = this.cardT > 0 ? String(Math.min(1, this.cardT * 3)) : "0";
    for (const l of this.lines) l.age += dt;
    const out: string[] = [];
    const itemHtml = (l: Line, style = "") => {
      const it = (l.loot as Extract<Loot, { kind: "item" }>).item, col = RARITY[it.rarity].color;
      const flash = Math.max(0, 1 - l.age / 0.8);
      return `<div style="font-weight:500;padding-left:6px;border-left:3px solid ${col};margin-top:2px;background:${col}${Math.round(flash * 90).toString(16).padStart(2, "0")};${style}"><span style="color:${col}">${itemLine(it)}</span></div>`;
    };

    if (this.mode === "risk" && e.state !== "out") this.mode = "idle";
    if (this.mode === "risk") {
      const target = Math.max(0, e.scrapAtRisk - inFlight);
      if (target < this.shown) this.shown = target;
      else if (target > this.shown) {
        const before = Math.floor(this.shown);
        this.shown = Math.min(target, this.shown + Math.max(v.rollMin * dt, (target - this.shown) * v.rollK * dt));
        if (Math.floor(this.shown) !== before) this.bump = 0.15;
      }
      this.bump = Math.max(0, this.bump - dt);
      const s = 1 + this.bump * 1.2;
      out.push(`<div style="color:${AMBER};letter-spacing:0.06em">AT RISK</div>`);
      out.push(`<div style="color:${AMBER};font-size:20px;display:inline-block;transform:scale(${s.toFixed(3)});transform-origin:left center">◆ ${Math.floor(this.shown)} <span style="font-size:13px">scrap</span></div>`);
      const items = this.lines.filter((l) => l.loot.kind === "item");
      for (const l of items.slice(-Math.max(1, v.riskLines))) out.push(itemHtml(l));
      if (items.length > v.riskLines) out.push(`<div style="color:${DIM};font-size:11px">+${items.length - v.riskLines} more</div>`);
    } else if (this.mode === "bank") {
      const T = Math.max(0.05, v.bankScrapTime), k = Math.min(1, this.t / T);
      const tickN = Math.floor(k * Math.min(24, Math.max(1, this.bankScrap)));
      while (this.ticks < tickN) this.sound?.tick(this.ticks++);
      const left = Math.round(this.bankScrap * (1 - k));
      this.bankShown = this.bankBefore + (this.bankScrap - left);
      const itemsT = Math.max(0, this.t - T), due = Math.min(this.bankItems.length, Math.floor(itemsT / Math.max(0.05, v.bankItemGap)) + (itemsT > 0 ? 1 : 0));
      while (this.thunked < due) { const l = this.bankItems[this.thunked++]; if (l.kind === "item") this.sound?.thunk(tierOf(l.item.rarity)); }
      const done = k >= 1 && this.thunked >= this.bankItems.length;
      const doneAt = T + this.bankItems.length * v.bankItemGap + 0.15;
      if (done && !this.paid && this.t >= doneAt) { this.paid = true; if (this.bankScrap > 0 || this.bankItems.length) this.sound?.payday(); }
      if (this.paid) {
        out.push(`<div style="color:${GREEN};letter-spacing:0.06em">${LOCK} BANKED</div>`);
        out.push(`<div style="color:${GREEN};font-size:18px">◆ ${this.bankScrap} scrap${this.bankItems.length ? ` · ${this.bankItems.length} item${this.bankItems.length > 1 ? "s" : ""}` : ""}</div>`);
        if (this.t > doneAt + v.bankShow) this.mode = e.state === "out" ? "risk" : "idle";
      } else {
        out.push(`<div style="color:${GREEN};letter-spacing:0.06em">BANKING…</div>`);
        out.push(`<div style="color:${left > 0 ? AMBER : DIM};font-size:20px">◆ ${left} <span style="font-size:13px">scrap</span></div>`);
        this.bankItems.forEach((l, i) => {
          const gone = i < this.thunked ? Math.min(1, (itemsT - i * v.bankItemGap) / 0.35) : 0;
          out.push(itemHtml({ loot: l, age: 1 }, `opacity:${(1 - gone).toFixed(2)};transform:translateX(${(gone * 40).toFixed(0)}px)`));
        });
      }
    } else if (this.mode === "lost") {
      const n = this.lines.length, end = (n - 1) * v.lostLineGap + v.lostFade;
      out.push(`<div style="color:${RED};letter-spacing:0.1em;opacity:${Math.sin(this.t * 9) < 0 && this.t < 1.5 ? 0.6 : 1}">LOST</div>`);
      this.lines.forEach((l, i) => {
        const k = Math.max(0, Math.min(1, (this.t - i * v.lostLineGap) / Math.max(0.05, v.lostFade)));
        const style = `text-decoration:line-through;text-decoration-color:${RED};opacity:${(1 - k).toFixed(2)};filter:grayscale(${k.toFixed(2)})`;
        if (l.loot.kind === "scrap") out.push(`<div style="color:${AMBER};${style}">◆ ${l.loot.amount} scrap · ${esc(l.loot.label)}</div>`);
        else out.push(itemHtml({ loot: l.loot, age: 1 }, style));
      });
      if (!n) out.push(`<div style="color:${DIM}">nothing was at risk</div>`);
      if (this.t > Math.max(end, 1) + 1) this.mode = e.state === "out" ? "risk" : "idle";
    }
    const bankScrap = this.mode === "bank" ? this.bankShown : e.bank.scrap;
    const bankItems = e.bank.items.length - (this.mode === "bank" ? this.bankItems.length - this.thunked : 0);
    out.push(`<div style="color:${OK};margin-top:6px">Convoy ${LOCK} ◆ ${bankScrap}${bankItems ? ` · ${bankItems} item${bankItems > 1 ? "s" : ""}` : ""}</div>`);
    this.el.innerHTML = out.join("");
  }
}
