// Extraction pads (docs/proposal-extraction.md; Keith 2026-10-27/29): paid ways home out in the sand. Pure.
//   PadField   seeded pads on a grid, a function of position and the road like the camps (none in the Near ring)
//   padQuote   the fee (padBase + padPerKm x km from the convoy now), the wait (longer further out) and who pays:
//              carried (at-risk) scrap first; with padBankTopUp the bank covers the rest at padBankMarkup
//   PadCaller  hold E on a pad -> fee charged -> beacon and wait (leaving cancels, part of the fee refunded) ->
//              the quadcopter lifts you -> everything at risk is banked. Destroyed while waiting: all lost, fee too.
// Pads do nothing until the "pickup" unlock is bought (unlocks.ts).
// Ownership: host (fee, wait, banking, the beacon's effects); the quadcopter's flight is drawing (padDraw.ts).
// Randomness: seeded (cell hashes), none at run time.
import type { Param } from "../core/tweaks";
import { hash4, rng } from "../world/pois";
import { ringOf, type DepthValues, type Ring } from "./depth";
import type { Expedition } from "./expedition";

export const PAD_GROUP = "Extraction pads";
export const PAD_PLACE_GROUP = "Extraction pads: placement";
export const PAD_DEFAULTS = {
  padSeed: 5,
  padCell: 700,
  padChanceNear: 0, padChanceOut: 0.25, padChanceDeep: 0.45, padChanceFar: 0.6,
  padRadius: 8,
  padLeave: 13,
  padBase: 60,
  padPerKm: 80,
  padWaitBase: 30,
  padWaitPerKm: 15,
  padWaitMax: 150,
  padRefund: 0.5,
  padBankTopUp: 1,
  padBankMarkup: 1.5,
  padHold: 1.2,
  padFlight: 14,
  padLift: 7,
  padWake: 250,
  padPull: 500,
  padRaid: 1,
  padBeacon: 4,
};
export type PadValues = typeof PAD_DEFAULTS;
const G = PAD_GROUP, P = PAD_PLACE_GROUP;
export const PAD_PARAMS: Param[] = [
  { key: "padSeed", label: "Pad seed", min: 0, max: 99, step: 1, group: P },
  { key: "padCell", label: "Pad grid cell (m)", min: 300, max: 2000, step: 10, group: P },
  { key: "padChanceNear", label: "Chance in a Near cell", min: 0, max: 1, step: 0.05, group: P, tip: "0: none near the road (keep it 0)" },
  { key: "padChanceOut", label: "Chance in an Out cell", min: 0, max: 1, step: 0.05, group: P },
  { key: "padChanceDeep", label: "Chance in a Deep cell", min: 0, max: 1, step: 0.05, group: P },
  { key: "padChanceFar", label: "Chance in a Far cell", min: 0, max: 1, step: 0.05, group: P },
  { key: "padRadius", label: "Pad radius (m)", min: 3, max: 20, step: 0.5, group: G, tip: "Stand this close to the middle to call" },
  { key: "padLeave", label: "Leaving the pad past (m)", min: 4, max: 30, step: 0.5, group: G, tip: "Further than this cancels the call" },
  { key: "padBase", label: "Fee: base (scrap)", min: 0, max: 500, step: 5, group: G },
  { key: "padPerKm", label: "Fee: per km from the convoy (scrap)", min: 0, max: 500, step: 5, group: G },
  { key: "padWaitBase", label: "Wait: base (s)", min: 0, max: 120, step: 1, group: G },
  { key: "padWaitPerKm", label: "Wait: per km from the convoy (s)", min: 0, max: 60, step: 1, group: G, tip: "Further out, longer to hold the pad" },
  { key: "padWaitMax", label: "Wait: at most (s)", min: 10, max: 400, step: 5, group: G },
  { key: "padRefund", label: "Refund on cancel (share)", min: 0, max: 1, step: 0.05, group: G, tip: "Leave the pad while waiting: this share of what you paid comes back, to where it came from" },
  { key: "padBankTopUp", label: "Bank may top up the fee (0/1)", min: 0, max: 1, step: 1, group: G, tip: "0: only scrap you carry pays. 1: the convoy's bank covers what you lack, at the markup (Keith: undecided)" },
  { key: "padBankMarkup", label: "Bank top-up costs (×)", min: 1, max: 4, step: 0.05, group: G, tip: "Each scrap the bank covers costs this many from the bank" },
  { key: "padHold", label: "Hold E to call (s)", min: 0.2, max: 5, step: 0.1, group: G },
  { key: "padFlight", label: "Quadcopter in sight (s)", min: 2, max: 60, step: 1, group: G, tip: "It shows this long before the wait ends" },
  { key: "padLift", label: "Lift-off takes (s)", min: 2, max: 20, step: 0.5, group: G, tip: "Cradle lowers, clamps, the fade starts at 60%" },
  { key: "padWake", label: "Beacon wakes camps within (m)", min: 50, max: 800, step: 10, group: G },
  { key: "padPull", label: "Beacon pulls packs and war bands within (m)", min: 100, max: 1500, step: 10, group: G },
  { key: "padRaid", label: "A raid at half the wait (0/1)", min: 0, max: 1, step: 1, group: G },
  { key: "padBeacon", label: "Beacon shouts every (s)", min: 1, max: 20, step: 0.5, group: G },
];

export interface Pad { id: string; x: number; z: number; ring: Ring; depth: number }

export class PadField {
  private cache = new Map<string, Pad | null>();
  /** Distance from the road (depth.ts); null: no pads anywhere. */
  depth: ((x: number, z: number) => number) | null = null;
  /** True where nothing may stand (the road's corridor). */
  blocked: ((x: number, z: number) => boolean) | null = null;
  constructor(public v: PadValues & DepthValues) {}

  reset() { this.cache.clear(); }

  pad(i: number, j: number): Pad | null {
    const k = i + ":" + j;
    let p = this.cache.get(k);
    if (p === undefined) { p = this.place(i, j); this.cache.set(k, p); }
    return p;
  }

  private place(i: number, j: number): Pad | null {
    const v = this.v, C = v.padCell, r = rng(hash4(v.padSeed, 71, i, j));
    const roll = r(), inset = C * 0.18;
    const x = i * C + inset + r() * (C - 2 * inset), z = j * C + inset + r() * (C - 2 * inset);
    if (!this.depth) return null;
    const d = this.depth(x, z), ring = ringOf(v, d);
    const chance = ring === "Near" ? v.padChanceNear : ring === "Out" ? v.padChanceOut : ring === "Deep" ? v.padChanceDeep : v.padChanceFar;
    if (roll >= chance || this.blocked?.(x, z)) return null;
    return { id: `pad:${i}:${j}`, x, z, ring, depth: d };
  }

  /** Pads within r of (x, z). */
  near(x: number, z: number, r: number, out: Pad[] = []): Pad[] {
    out.length = 0;
    const C = this.v.padCell;
    for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++)
      for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) {
        const p = this.pad(i, j);
        if (p && Math.hypot(p.x - x, p.z - z) <= r) out.push(p);
      }
    return out;
  }

  /** The nearest pad within r, or null. */
  nearest(x: number, z: number, r: number): Pad | null {
    let best: Pad | null = null, bd = Infinity;
    for (const p of this.near(x, z, r)) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
}

export interface Quote {
  fee: number;
  /** Seconds to hold the pad after calling. */
  wait: number;
  km: number;
  ok: boolean;
  reason: "" | "locked" | "short";
  /** Scrap taken from the carried (at-risk) list. */
  fromCarried: number;
  /** Fee covered by the bank, and what that costs the bank (the markup). */
  fromBank: number;
  bankCost: number;
}

export const padFee = (v: PadValues, km: number) => Math.round(v.padBase + v.padPerKm * Math.max(0, km));
export const padWait = (v: PadValues, km: number) => Math.min(v.padWaitMax, v.padWaitBase + v.padWaitPerKm * Math.max(0, km));

/** What a call costs from `km` away from the convoy, and who pays (see the header). */
export function padQuote(v: PadValues, unlocked: boolean, km: number, carried: number, bankScrap: number): Quote {
  const fee = padFee(v, km), wait = padWait(v, km);
  const fromCarried = Math.min(fee, Math.floor(carried)), rest = fee - fromCarried;
  const q: Quote = { fee, wait, km, ok: true, reason: "", fromCarried, fromBank: 0, bankCost: 0 };
  if (!unlocked) { q.ok = false; q.reason = "locked"; return q; }
  if (rest > 0) {
    if (v.padBankTopUp >= 0.5) {
      q.fromBank = rest; q.bankCost = Math.ceil(rest * v.padBankMarkup);
      if (bankScrap < q.bankCost) { q.ok = false; q.reason = "short"; }
    } else { q.ok = false; q.reason = "short"; }
  }
  return q;
}

/** "140 scrap: 90 carried + 50 from the bank (costs 75)" for the HUD. */
export function quoteText(q: Quote): string {
  const src = q.fromBank > 0 ? `${q.fromCarried} carried + ${q.fromBank} from the bank (costs ${q.bankCost})` : q.fromCarried > 0 ? "all carried" : "free";
  return `${q.fee} scrap · ${src}`;
}

export type PadEvent =
  | { type: "called"; pad: Pad; quote: Quote }
  | { type: "refused"; reason: "locked" | "short" }
  | { type: "cancelled"; pad: Pad; refundCarried: number; refundBank: number }
  | { type: "beacon"; pad: Pad; first: boolean }
  | { type: "raid"; pad: Pad }
  | { type: "extracted"; pad: Pad; scrap: number; items: number };

export interface PadNow {
  x: number; z: number;
  /** Mech (or pilot) alive. */
  alive: boolean;
  eHeld: boolean;
  unlocked: boolean;
  /** Distance from the convoy as it is now (m). */
  convoyM: number;
}

export type CallState = "idle" | "waiting" | "lifting";

export class PadCaller {
  state: CallState = "idle";
  pad: Pad | null = null;
  /** Hold progress 0..1. */
  hold = 0;
  /** Seconds waited, the wait asked, seconds into the lift. */
  t = 0; wait = 0; lt = 0;
  /** Seconds since the pickup took off (the copter flying away, for drawing); 0 when none. */
  gone = 0;
  /** The pad the pickup left from (for drawing the departure). */
  lastPad: Pad | null = null;
  paid: Quote | null = null;
  /** Why the last call was refused ("" none). */
  refusal: "" | "locked" | "short" = "";
  readonly events: PadEvent[] = [];
  private needRelease = false;
  private beaconT = 0;
  private raided = false;
  private extractedDone = false;

  constructor(public v: PadValues, private exp: Expedition) {}

  /** The pickup has the mech: no driving. */
  get clamped() { return this.state === "lifting"; }
  /** The quadcopter is in sight (last padFlight seconds of the wait, and the lift). */
  get inSight() { return this.state === "lifting" || (this.state === "waiting" && this.t >= this.wait - this.v.padFlight); }
  /** 0..1 how far the approach has got (while waiting). */
  get approach() { return this.state === "idle" ? 0 : this.state === "lifting" ? 1 : Math.max(0, Math.min(1, (this.t - (this.wait - this.v.padFlight)) / Math.max(0.1, this.v.padFlight))); }
  get remaining() { return this.state === "waiting" ? Math.max(0, this.wait - this.t) : 0; }

  reset() {
    this.state = "idle"; this.pad = null; this.lastPad = null; this.hold = 0; this.t = 0; this.lt = 0; this.gone = 0; this.paid = null;
    this.events.length = 0; this.needRelease = false; this.refusal = ""; this.extractedDone = false;
  }

  /** The quote for a call from here, against what is carried and banked now. */
  quote(unlocked: boolean, convoyM: number): Quote {
    return padQuote(this.v, unlocked, convoyM / 1000, this.exp.scrapAtRisk, this.exp.bank.scrap);
  }

  /** One frame. `on`: the pad within padRadius of the mech (or pilot), if any. */
  update(dt: number, on: Pad | null, n: PadNow) {
    const v = this.v, e = this.exp;
    if (this.state === "idle") {
      if (this.gone > 0) this.gone += dt;
      if (!n.eHeld) this.needRelease = false;
      if (!on || e.state !== "out" || !n.alive || !n.eHeld || this.needRelease) {
        this.hold = Math.max(0, this.hold - dt * 2);
        if (!on) this.refusal = "";
        return;
      }
      this.hold = Math.min(1, this.hold + dt / Math.max(0.05, v.padHold));
      if (this.hold < 1) return;
      this.hold = 0;
      const q = this.quote(n.unlocked, n.convoyM);
      if (!q.ok) {
        this.refusal = q.reason as "locked" | "short";
        this.needRelease = true;
        this.events.push({ type: "refused", reason: this.refusal });
        return;
      }
      // Charge: carried scrap first, then the bank's share at its markup.
      e.spendScrap(q.fromCarried);
      e.bank.scrap -= q.bankCost;
      this.paid = q; this.pad = on; this.lastPad = on; this.wait = q.wait; this.t = 0; this.lt = 0; this.gone = 0;
      this.state = "waiting"; this.refusal = ""; this.beaconT = 0; this.raided = false; this.extractedDone = false;
      this.events.push({ type: "called", pad: on, quote: q });
      this.events.push({ type: "beacon", pad: on, first: true });
      return;
    }
    // Waiting or lifting. Anything that ended the run out here (destroyed, recalled) loses the lot, the fee too.
    if (e.state !== "out" && !this.extractedDone) { this.state = "idle"; this.pad = null; this.paid = null; return; }
    const pad = this.pad!;
    if (this.state === "waiting") {
      if (Math.hypot(n.x - pad.x, n.z - pad.z) > v.padLeave) { this.cancel(); return; }
      this.t += dt;
      this.beaconT += dt;
      if (this.beaconT >= v.padBeacon) { this.beaconT = 0; this.events.push({ type: "beacon", pad, first: false }); }
      if (!this.raided && v.padRaid >= 0.5 && this.t >= this.wait * 0.5) { this.raided = true; this.events.push({ type: "raid", pad }); }
      if (this.t >= this.wait) { this.state = "lifting"; this.lt = 0; }
      return;
    }
    // Lifting: committed. The fade starts at 60%; the pickup flies off after.
    this.lt += dt;
    this.beaconT += dt;
    if (this.beaconT >= v.padBeacon) { this.beaconT = 0; this.events.push({ type: "beacon", pad, first: false }); }
    if (!this.extractedDone && this.lt >= v.padLift * 0.6) {
      const scrap = e.scrapAtRisk, items = e.itemsAtRisk;
      if (e.extracted()) { this.extractedDone = true; this.events.push({ type: "extracted", pad, scrap, items }); }
    }
    if (this.lt >= v.padLift + 5) { this.state = "idle"; this.gone = 0.001; this.pad = null; this.paid = null; this.extractedDone = false; }
  }

  private cancel() {
    const p = this.paid!, e = this.exp, v = this.v;
    const rc = Math.round(p.fromCarried * v.padRefund), rb = Math.round(p.bankCost * v.padRefund);
    if (rc > 0) e.add({ kind: "scrap", amount: rc, label: "Fee refund" });
    e.bank.scrap += rb;
    this.events.push({ type: "cancelled", pad: this.pad!, refundCarried: rc, refundBank: rb });
    this.state = "idle"; this.pad = null; this.paid = null; this.t = 0;
    this.needRelease = true;
  }
}
