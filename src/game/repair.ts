// Repair kits (Keith 2026-10-31: "the equivalent of a health potion... press Q", "doesn't naturally replenish"). Pure:
// a count, a kit at work (its share of the hull spread over kitTime) and a short lockout between kits. Nothing here
// refills by itself: kits come back only by restock (bought at a bay, found in salvage, the lab's rebuild).
// Ownership: host (hull and kit counts are host state; a kit use is a command, start and finish are events).
import type { Param } from "../core/tweaks";

export const REPAIR_DEFAULTS = {
  /** Kits carried at most. */
  kitMax: 3,
  /** Share of the max hull one kit repairs. */
  kitShare: 0.35,
  /** Seconds a kit's repair is spread over. */
  kitTime: 2,
  /** Seconds after a kit finishes before the next can start. */
  kitLockout: 1,
  /** On foot: seconds of holding Q beside the mech to patch it by hand with a kit. */
  kitHandTime: 4,
  /** Metres from the mech's hips (on the ground) the pilot can patch it from. */
  kitHandReach: 4,
  /** Scrap one kit costs at a bay terminal. */
  kitPrice: 40,
  /** Chance a stripped wreck gives a kit (scrap piles half that). */
  kitSalvage: 0.12,
  /** Loudness of the kit's ratchet and hiss, its clank and the low hull warning. */
  kitSound: 0.8,
};
export type RepairValues = typeof REPAIR_DEFAULTS;

const G = "Repair kits";
export const REPAIR_PARAMS: Param[] = [
  { key: "kitMax", label: "Kits carried", min: 0, max: 10, step: 1, group: G, tip: "Most kits the mech carries; Q uses one" },
  { key: "kitShare", label: "Kit repair (share of hull)", min: 0.05, max: 1, step: 0.01, group: G },
  { key: "kitTime", label: "Kit repair time (s)", min: 0, max: 8, step: 0.1, group: G, tip: "The repair is spread over this: it reads, and heavy fire can still out-damage it" },
  { key: "kitLockout", label: "Between kits (s)", min: 0, max: 10, step: 0.1, group: G, tip: "After a kit finishes, the next can't start for this long" },
  { key: "kitHandTime", label: "Patch by hand: hold (s)", min: 0.2, max: 10, step: 0.1, group: G, tip: "On foot, hold Q beside the mech this long to use a kit on it" },
  { key: "kitHandReach", label: "Patch by hand: reach (m)", min: 1, max: 8, step: 0.1, group: G },
  { key: "kitPrice", label: "Kit price (scrap)", min: 0, max: 500, step: 5, group: G, tip: "At a bay terminal (B on the deck)" },
  { key: "kitSound", label: "Kit and warning sound", min: 0, max: 2, step: 0.05, group: G },
  { key: "kitSalvage", label: "Kit from a wreck (chance)", min: 0, max: 1, step: 0.01, group: G, tip: "Each stripped wreck; scrap piles half this" },
];

/** Why Q did nothing (for the HUD line), or null when the kit started. */
export type KitRefusal = "none" | "full" | "working" | "lockout" | "dead";

export type RepairEvent = { kind: "kitStarted"; left: number } | { kind: "kitDone" } | { kind: "kitCut" };

export class RepairKits {
  count: number;
  /** Seconds of the kit at work left (0: none). */
  working = 0;
  /** Hull per second the kit at work repairs. */
  private rate = 0;
  /** Seconds before another kit can start. */
  lockout = 0;
  /** Events since the last drain (plain data). */
  readonly events: RepairEvent[] = [];

  constructor(private v: RepairValues, count = v.kitMax) { this.count = Math.min(count, v.kitMax); }

  /** 0..1 of the kit at work done (null: none at work). */
  get progress() { return this.working > 0 ? 1 - this.working / Math.max(1e-6, this.v.kitTime) : null; }

  /** Why a kit can't start now, or null if it can. */
  refusal(health: number, max: number, alive: boolean): KitRefusal | null {
    if (!alive) return "dead";
    if (this.count <= 0) return "none";
    if (this.working > 0) return "working";
    if (this.lockout > 0) return "lockout";
    if (health >= max - 0.5) return "full";
    return null;
  }

  /** The useKit command: start a kit if one can start. */
  use(health: number, max: number, alive: boolean): KitRefusal | null {
    const why = this.refusal(health, max, alive);
    if (why) return why;
    this.count--;
    const amount = this.v.kitShare * max;
    if (this.v.kitTime <= 0) { this.working = 1e-6; this.rate = amount / 1e-6; }
    else { this.working = this.v.kitTime; this.rate = amount / this.v.kitTime; }
    this.events.push({ kind: "kitStarted", left: this.count });
    return null;
  }

  /** Advance: the hull to add this step (the caller caps it at the max). */
  step(dt: number): number {
    if (this.working <= 0) { this.lockout = Math.max(0, this.lockout - dt); return 0; }
    const t = Math.min(dt, this.working);
    this.working -= t;
    if (this.working <= 1e-9) {
      this.working = 0;
      this.lockout = this.v.kitLockout;
      this.events.push({ kind: "kitDone" });
    }
    return this.rate * t;
  }

  /** The mech was destroyed: the kit at work is lost with it. */
  cut() {
    if (this.working > 0) this.events.push({ kind: "kitCut" });
    this.working = 0;
    this.lockout = 0;
  }

  /** Add kits (bought, found), up to the most carried; returns how many fitted. */
  restock(n: number) {
    const add = Math.max(0, Math.min(n, this.v.kitMax - this.count));
    this.count += add;
    return add;
  }
}
