// The expedition loop (pure, docs/proposal-expedition.md, Keith 2026-10-25): the states, the loot at risk, banking
// and losing it. No rendering, no convoy: the lab tells it what happened (launched, picked up, destroyed) and moves the
// mech when it says so.
//
//   aboard --launch()--> out --pickedUp()--> aboard (the at-risk list banked)
//   out --recall held / out of fuel--> recovering (fade; the at-risk list lost) --> aboard
//   out --destroyed()--> lost (a wait, then the fade; everything carried lost) --> aboard
//   out --pilotKilled()--> lost the same way (Keith 2026-10-26: the pilot dying on foot is the expedition over)
//
// The at-risk list is everything picked up since the launch (scrap and items). Only a pick-up by the crane banks it.
// Fitted gear is never touched here: losing a run loses what was carried, not what the mech wears. Recovery is
// instant for now (Claude's default): a fade, and the mech is back on the deck.
import type { Param } from "../core/tweaks";
import { itemWeight, type Item } from "../items/item";

export const EXPEDITION_DEFAULTS = {
  recallHold: 1.5,
  recoverFade: 1.2,
  lostWait: 2.5,
  bankShow: 4,
};
export type ExpeditionValues = typeof EXPEDITION_DEFAULTS;

const G = "Expedition";
export const EXPEDITION_PARAMS: Param[] = [
  { key: "recallHold", label: "Hold to call recovery (s)", min: 0.2, max: 5, step: 0.1, group: G, tip: "Hold X this long out in the field (Keith 2026-10-31: Q is the repair kit): recovered, at-risk loot lost" },
  { key: "recoverFade", label: "Recovery fade (s)", min: 0.2, max: 5, step: 0.1, group: G, tip: "Fade out, back aboard, fade in (instant recovery for now)" },
  { key: "lostWait", label: "Wreck shown for (s)", min: 0, max: 10, step: 0.5, group: G, tip: "A destroyed mech lies there this long before the fade" },
  { key: "bankShow", label: "Banked shown for (s)", min: 0.5, max: 15, step: 0.5, group: G },
];

export type Loot =
  | { kind: "scrap"; amount: number; label: string }
  | { kind: "item"; item: Item; label: string };

/**
 * What happened, as plain data (rule 12): something joined the at-risk list, the list was banked (the lines as they
 * were and the bank's scrap before, for the HUD's count-in), or lost (the lines, for the HUD's strike-through). The
 * rules apply at once; the ceremony is only drawing. Whoever shows them drains the list each frame.
 */
export type ExpEvent =
  | { type: "added"; loot: Loot }
  /** Left on the sand from the inventory (an item: the glue lays it down as a crate; scrap: dumped, gone). */
  | { type: "dropped"; loot: Loot }
  | { type: "banked"; lines: Loot[]; scrapBefore: number }
  | { type: "lost"; lines: Loot[]; reason: EndReason };

/** The crane's states (CraneCarry.state) with the mech out on the sand. */
export const ON_SAND = new Set(["walking", "inRange", "pickup", "falling", "landing"]);

export type ExpeditionState = "aboard" | "out" | "recovering" | "lost";
export type EndReason = "banked" | "recalled" | "fuel" | "destroyed" | "pilot" | "extracted";

export interface RunResult {
  reason: EndReason;
  scrap: number;
  items: number;
  /** Seconds out. */
  duration: number;
  /** Expedition clock when it ended. */
  at: number;
}

/** What the convoy holds: banked scrap (the one currency) and items. */
export interface Bank { scrap: number; items: Item[] }

export class Expedition {
  state: ExpeditionState = "aboard";
  readonly atRisk: Loot[] = [];
  readonly bank: Bank = { scrap: 0, items: [] };
  /** Seconds since the launch (while out), seconds into the fade or the wreck wait otherwise. */
  outFor = 0;
  /** Held recall: 0..1 of recallHold. */
  recall = 0;
  /** Seconds into a recovery or a loss (fade timing). */
  private t = 0;
  private teleported = false;
  /** The last run's end, for the HUD. */
  last: RunResult | null = null;
  /** Expedition clock (s), for "banked n s ago". */
  clock = 0;
  /** Runs ended per reason. */
  readonly counts: Record<EndReason, number> = { banked: 0, recalled: 0, fuel: 0, destroyed: 0, pilot: 0, extracted: 0 };
  /** Fade over the screen 0..1 (recovering, lost). */
  fade = 0;
  /** What happened since the last drain (see ExpEvent). */
  readonly events: ExpEvent[] = [];

  /**
   * Cargo limit (Keith 2026-11-01: "you have to manage what's in your cargo and potentially drop things"): the mech's
   * cargo capacity in tonnes (the loadout's cargoCapacity; Infinity: no limit) and what one scrap weighs. The at-risk
   * list is the cargo while out. The glue sets both; pick-ups ask `fits` first, `add` itself never refuses (refunds and
   * lab starts may go over, which the HUD shows in red).
   */
  capacity = Infinity;
  scrapWeight = 0;
  /** Loot the mech takes out with it (the bay's cargo list): joins the at-risk list at the launch, without events. */
  carryOut: Loot[] = [];

  constructor(public v: ExpeditionValues) {}

  /** What a line weighs (t). */
  weightOf(l: Loot) { return l.kind === "item" ? itemWeight(l.item) : l.amount * this.scrapWeight; }
  /** The cargo's weight now (t). */
  get load() { let w = 0; for (const l of this.atRisk) w += this.weightOf(l); return w; }
  /** Tonnes left before the cargo is full (negative when over). */
  get room() { return this.capacity - this.load; }
  /** Whether this would fit in the cargo now. */
  fits(l: Loot) { return this.weightOf(l) <= this.room + 1e-9; }
  /** How much scrap still fits (Infinity with no limit or weightless scrap). */
  get scrapRoom() { return this.scrapWeight > 0 ? Math.max(0, Math.floor((this.room + 1e-9) / this.scrapWeight)) : Infinity; }

  /** Take an item out of the cargo (to fit it, or to drop it); null if it isn't carried. */
  takeItem(id: string): Item | null {
    const i = this.atRisk.findIndex((l) => l.kind === "item" && l.item.id === id);
    if (i < 0) return null;
    const l = this.atRisk.splice(i, 1)[0];
    return l.kind === "item" ? l.item : null;
  }

  /** Put an item in the cargo quietly (taken off the mech in the field); refuses if it doesn't fit or not out. */
  stow(item: Item, label: string) {
    const l: Loot = { kind: "item", item, label };
    if (this.state !== "out" || !this.fits(l)) return false;
    this.atRisk.push(l);
    return true;
  }

  /** Drop a carried item on the sand (the glue lays it down as a crate). */
  dropItem(id: string) {
    const l = this.atRisk.find((q) => q.kind === "item" && q.item.id === id);
    if (!l || this.state !== "out") return false;
    this.takeItem(id);
    this.events.push({ type: "dropped", loot: { ...l } });
    return true;
  }

  /** Dump this much carried scrap (gone: scrap is the cheap thing to leave behind). Returns what was dumped. */
  dumpScrap(n: number) {
    if (this.state !== "out") return 0;
    const k = Math.min(Math.max(0, Math.floor(n)), this.scrapAtRisk);
    if (k <= 0) return 0;
    this.spendScrap(k);
    this.events.push({ type: "dropped", loot: { kind: "scrap", amount: k, label: "Dumped scrap" } });
    return k;
  }

  get out() { return this.state === "out"; }
  /** Scrap at risk now. */
  get scrapAtRisk() { let n = 0; for (const l of this.atRisk) if (l.kind === "scrap") n += l.amount; return n; }
  get itemsAtRisk() { let n = 0; for (const l of this.atRisk) if (l.kind === "item") n++; return n; }

  /** Left the convoy (dropped by the crane, or a lab start on the sand). */
  launch() {
    if (this.state !== "aboard") return false;
    this.state = "out";
    this.outFor = 0;
    this.atRisk.length = 0;
    for (const l of this.carryOut.splice(0)) this.atRisk.push(l);
    this.recall = 0;
    return true;
  }

  /** Picked something up. Only counts while out (aboard, nothing is at risk). */
  add(l: Loot) {
    if (this.state !== "out") return false;
    this.events.push({ type: "added", loot: { ...l } });
    // Scrap from the same source merges into one line.
    if (l.kind === "scrap") {
      const same = this.atRisk.find((q) => q.kind === "scrap" && q.label === l.label);
      if (same && same.kind === "scrap") { same.amount += l.amount; return true; }
    }
    this.atRisk.push(l);
    return true;
  }

  /** The crane has the mech: the at-risk list goes into the bank. The only way anything is banked. */
  pickedUp() {
    if (this.state !== "out") return false;
    const scrap = this.scrapAtRisk, items = this.itemsAtRisk;
    this.events.push({ type: "banked", lines: this.atRisk.map((l) => ({ ...l })), scrapBefore: this.bank.scrap });
    this.bank.scrap += scrap;
    for (const l of this.atRisk) if (l.kind === "item") this.bank.items.push(l.item);
    this.atRisk.length = 0;
    this.end("banked", scrap, items);
    this.state = "aboard";
    return true;
  }

  /**
   * Paid pickup (src/expedition/pads.ts): the quadcopter has the mech. Everything at risk is banked like a crane
   * pick-up, then the fade carries the mech home (recovering; the lab puts it aboard at the bottom of the fade).
   */
  extracted() {
    if (this.state !== "out") return false;
    const scrap = this.scrapAtRisk, items = this.itemsAtRisk;
    this.events.push({ type: "banked", lines: this.atRisk.map((l) => ({ ...l })), scrapBefore: this.bank.scrap });
    this.bank.scrap += scrap;
    for (const l of this.atRisk) if (l.kind === "item") this.bank.items.push(l.item);
    this.atRisk.length = 0;
    this.end("extracted", scrap, items);
    this.state = "recovering";
    this.t = 0; this.teleported = false;
    return true;
  }

  /** Pay a fee out of the carried scrap (lines in order; emptied lines go). The caller checked there is enough. */
  spendScrap(n: number) {
    for (let i = 0; i < this.atRisk.length && n > 0; i++) {
      const l = this.atRisk[i];
      if (l.kind !== "scrap") continue;
      const take = Math.min(l.amount, n);
      l.amount -= take; n -= take;
    }
    for (let i = this.atRisk.length - 1; i >= 0; i--) { const l = this.atRisk[i]; if (l.kind === "scrap" && l.amount <= 0) this.atRisk.splice(i, 1); }
  }

  /** The mech was destroyed out there: everything carried is lost; after lostWait, the fade home. */
  destroyed() {
    if (this.state !== "out") return false;
    this.end("destroyed", this.scrapAtRisk, this.itemsAtRisk);
    this.atRisk.length = 0;
    this.state = "lost";
    this.t = 0; this.teleported = false;
    return true;
  }

  /**
   * The pilot was killed on foot out there: the expedition is over, everything carried is lost (fitted gear and the
   * bank kept, as for a destroyed mech); after lostWait, the fade home with the mech recovered.
   */
  pilotKilled() {
    if (this.state !== "out") return false;
    this.end("pilot", this.scrapAtRisk, this.itemsAtRisk);
    this.atRisk.length = 0;
    this.state = "lost";
    this.t = 0; this.teleported = false;
    return true;
  }

  /** A forced recovery: called (quit) or out of fuel. The at-risk list is lost; the mech comes home. */
  recover(reason: "recalled" | "fuel") {
    if (this.state !== "out") return false;
    this.end(reason, this.scrapAtRisk, this.itemsAtRisk);
    this.atRisk.length = 0;
    this.state = "recovering";
    this.t = 0; this.teleported = false;
    return true;
  }

  /**
   * One frame. recallHeld: the recall key is down; fuelEmpty: the pack is dry. Returns "home" once, at the bottom of
   * the fade, when the lab should put the mech back aboard (repaired, refuelled).
   */
  update(dt: number, recallHeld: boolean, fuelEmpty: boolean): "home" | null {
    this.clock += dt;
    if (this.state === "out") {
      this.outFor += dt;
      this.recall = recallHeld ? Math.min(1, this.recall + dt / Math.max(0.05, this.v.recallHold)) : 0;
      if (fuelEmpty) this.recover("fuel");
      else if (this.recall >= 1) this.recover("recalled");
      this.fade = 0;
      if (this.state === "out") return null;
    }
    if (this.state === "recovering" || this.state === "lost") {
      this.t += dt;
      const wait = this.state === "lost" ? this.v.lostWait : 0, F = Math.max(0.05, this.v.recoverFade);
      const k = (this.t - wait) / F; // 0..1 fade out, 1..2 fade in
      this.fade = k <= 0 ? 0 : k < 1 ? k : Math.max(0, 2 - k);
      if (!this.teleported && k >= 1) { this.teleported = true; return "home"; }
      if (k >= 2) { this.state = "aboard"; this.fade = 0; this.recall = 0; }
      return null;
    }
    this.fade = 0;
    this.recall = 0;
    return null;
  }

  /**
   * Follow the crane (src/convoy/carry.ts) and the mech: on the sand while aboard is a launch; gripped by the crane
   * while out is the pick-up (banked); a dead mech while out is lost. Returns what happened this frame.
   */
  follow(carryState: string, attached: boolean, alive: boolean): "launched" | "banked" | "lost" | null {
    if (this.state === "aboard" && ON_SAND.has(carryState)) return this.launch() ? "launched" : null;
    if (this.state === "out" && !alive) return this.destroyed() ? "lost" : null;
    if (this.state === "out" && attached && carryState === "lifting") return this.pickedUp() ? "banked" : null;
    return null;
  }

  private end(reason: EndReason, scrap: number, items: number) {
    if (reason !== "banked" && reason !== "extracted") this.events.push({ type: "lost", lines: this.atRisk.map((l) => ({ ...l })), reason });
    this.last = { reason, scrap, items, duration: this.outFor, at: this.clock };
    this.counts[reason]++;
  }
}
