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
import type { Item } from "../items/item";

export const EXPEDITION_DEFAULTS = {
  recallHold: 1.5,
  recoverFade: 1.2,
  lostWait: 2.5,
  bankShow: 4,
};
export type ExpeditionValues = typeof EXPEDITION_DEFAULTS;

const G = "Expedition";
export const EXPEDITION_PARAMS: Param[] = [
  { key: "recallHold", label: "Hold to call recovery (s)", min: 0.2, max: 5, step: 0.1, group: G, tip: "Hold Q this long out in the field: recovered, at-risk loot lost" },
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
  | { type: "banked"; lines: Loot[]; scrapBefore: number }
  | { type: "lost"; lines: Loot[]; reason: EndReason };

/** The crane's states (CraneCarry.state) with the mech out on the sand. */
export const ON_SAND = new Set(["walking", "inRange", "pickup", "falling", "landing"]);

export type ExpeditionState = "aboard" | "out" | "recovering" | "lost";
export type EndReason = "banked" | "recalled" | "fuel" | "destroyed" | "pilot";

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
  readonly counts: Record<EndReason, number> = { banked: 0, recalled: 0, fuel: 0, destroyed: 0, pilot: 0 };
  /** Fade over the screen 0..1 (recovering, lost). */
  fade = 0;
  /** What happened since the last drain (see ExpEvent). */
  readonly events: ExpEvent[] = [];

  constructor(public v: ExpeditionValues) {}

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
    if (reason !== "banked") this.events.push({ type: "lost", lines: this.atRisk.map((l) => ({ ...l })), reason });
    this.last = { reason, scrap, items, duration: this.outFor, at: this.clock };
    this.counts[reason]++;
  }
}
