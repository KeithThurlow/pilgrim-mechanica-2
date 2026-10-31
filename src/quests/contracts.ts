// Contracts (docs/proposal-quests.md, Keith 2026-10-31): jobs the convoy's dispatch offers over the radio. Pure: no
// drawing, no world. The glue (questLoop.ts) finds the places (POIs, camps, lairs, open sand) through OfferSources and
// tells the board what happened (kills, stripping, a hook, pods, banking, a lost run); the board answers with events.
//
//   offered --J--> active --goal met--> done (salvage, cull, bounty: the bonus joins the at-risk list)
//   offered --offerTime--> lapsed          active --carried home by the crane--> done (tow, pods: banked at once)
//   active --hold J--> dropped             active --run lost while carrying--> failed (tow, pods)
//
// Host owned (rule 12): offers are seeded (ids c<n>), commands are accept and drop, everything else is events.
import type { Param } from "../core/tweaks";
import { rng, hash4 } from "../world/pois";

export const CONTRACT_DEFAULTS = {
  contractSeed: 11,
  contractEvery: 100,
  contractFirst: 8,
  offerTime: 30,
  contractsMax: 2,
  dropHold: 1.2,
  salvageShare: 0.6,
  cullScrapper: 24,
  cullCutter: 6,
  cullBandit: 15,
  wSalvage: 1, wCull: 1, wBounty: 1, wTow: 1, wPods: 1,
  rewardSalvage: 80, rewardCull: 60, rewardBounty: 160, rewardTow: 140, rewardPod: 40,
  rewardSalvageM: 0.15, rewardCullM: 0.12, rewardBountyM: 0.2, rewardTowM: 0.2, rewardPodsM: 0.15,
  podCount: 3,
  podSpread: 40,
};
export type ContractValues = typeof CONTRACT_DEFAULTS;

export const CONTRACT_GROUP = "Contracts", REWARD_GROUP = "Contract rewards";
const G = CONTRACT_GROUP, R = REWARD_GROUP;
export const CONTRACT_PARAMS: Param[] = [
  { key: "contractEvery", label: "New offer every (s, out)", min: 10, max: 600, step: 5, group: G, tip: "While out in the field, dispatch offers a new contract this often" },
  { key: "contractFirst", label: "First offer after (s)", min: 0, max: 120, step: 1, group: G, tip: "After the launch, when nothing is active or offered" },
  { key: "offerTime", label: "Offer lapses after (s)", min: 5, max: 120, step: 1, group: G, tip: "Press J to take the newest offer before then" },
  { key: "contractsMax", label: "Active at once", min: 1, max: 5, step: 1, group: G },
  { key: "dropHold", label: "Hold J to drop (s)", min: 0.3, max: 4, step: 0.1, group: G },
  { key: "salvageShare", label: "Salvage run: share of spots", min: 0.2, max: 1, step: 0.05, group: G, tip: "Strip this share of the POI's spots" },
  { key: "cullScrapper", label: "Cull: scrappers", min: 1, max: 80, step: 1, group: G },
  { key: "cullCutter", label: "Cull: cutters", min: 1, max: 30, step: 1, group: G },
  { key: "cullBandit", label: "Cull: bandits", min: 1, max: 60, step: 1, group: G },
  { key: "podCount", label: "Escape pods per site", min: 1, max: 8, step: 1, group: G },
  { key: "podSpread", label: "Pods spread (m)", min: 5, max: 120, step: 1, group: G },
  { key: "wSalvage", label: "Odds: salvage run", min: 0, max: 5, step: 0.1, group: G },
  { key: "wCull", label: "Odds: cull", min: 0, max: 5, step: 0.1, group: G },
  { key: "wBounty", label: "Odds: bounty", min: 0, max: 5, step: 0.1, group: G },
  { key: "wTow", label: "Odds: tow", min: 0, max: 5, step: 0.1, group: G },
  { key: "wPods", label: "Odds: escape pods", min: 0, max: 5, step: 0.1, group: G },
  { key: "rewardSalvage", label: "Salvage run (scrap)", min: 0, max: 1000, step: 5, group: R },
  { key: "rewardSalvageM", label: "Salvage run per metre out", min: 0, max: 1, step: 0.01, group: R },
  { key: "rewardCull", label: "Cull (scrap)", min: 0, max: 1000, step: 5, group: R },
  { key: "rewardCullM", label: "Cull per metre out", min: 0, max: 1, step: 0.01, group: R },
  { key: "rewardBounty", label: "Bounty (scrap)", min: 0, max: 1000, step: 5, group: R },
  { key: "rewardBountyM", label: "Bounty per metre out", min: 0, max: 1, step: 0.01, group: R },
  { key: "rewardTow", label: "Tow (scrap)", min: 0, max: 1000, step: 5, group: R },
  { key: "rewardTowM", label: "Tow per metre out", min: 0, max: 1, step: 0.01, group: R },
  { key: "rewardPod", label: "Escape pods (scrap a pod)", min: 0, max: 400, step: 5, group: R },
  { key: "rewardPodsM", label: "Escape pods per metre out", min: 0, max: 1, step: 0.01, group: R },
];

export type ContractKind = "salvage" | "cull" | "bounty" | "tow" | "pods";
export const CONTRACT_KINDS: ContractKind[] = ["salvage", "cull", "bounty", "tow", "pods"];
export type KillKind = "scrapper" | "cutter" | "excavator" | "bandit";
export type ContractState = "offered" | "active" | "done" | "failed" | "lapsed" | "dropped";

export const KIND_NAME: Record<ContractKind, string> = { salvage: "Salvage run", cull: "Cull", bounty: "Bounty", tow: "Tow", pods: "Escape pods" };
export const KILL_NAME: Record<KillKind, string> = { scrapper: "scrappers", cutter: "cutters", excavator: "excavators", bandit: "bandits" };

export interface Contract {
  id: string;
  kind: ContractKind;
  state: ContractState;
  /** Where to go (the POI, the camp, the lair, the hulk, the crash site). */
  x: number; z: number;
  /** What's there ("Derelict hauler", "Rustjaw", "Downed Rampart"). */
  label: string;
  /** Bonus scrap. */
  reward: number;
  /** Goal count and progress (spots, kills, pods; 1 for bounty and tow). */
  need: number; have: number;
  /** Salvage run: the POI. Cull and bounty: the camp or lair (and its circle). */
  site?: string;
  radius?: number;
  cull?: KillKind;
  /** Pods: where each still lies (null once picked up). */
  pods?: ({ x: number; z: number } | null)[];
  /** Tow and pods: something of this contract rides with the mech (at risk). */
  carrying: boolean;
  /** Clock when offered (for the lapse) or accepted. */
  t: number;
  /** Metres from the convoy when offered. */
  dist: number;
}

export type ContractEvent =
  | { type: "offered"; c: Contract }
  | { type: "accepted"; c: Contract }
  | { type: "lapsed"; c: Contract }
  | { type: "dropped"; c: Contract }
  | { type: "progress"; c: Contract }
  /** Paid: onto the at-risk list (salvage, cull, bounty) or straight into the bank (tow, pods, delivered). */
  | { type: "done"; c: Contract; to: "atRisk" | "bank" }
  | { type: "failed"; c: Contract; why: string };

/** Where an offer can go, found by the glue (null: nothing fits; the board tries another kind). */
export interface OfferSources {
  /** Where distance is measured from (the convoy's lead car). */
  from: { x: number; z: number };
  poi(r: () => number, min: number, max: number): { id: string; x: number; z: number; label: string; spots: number } | null;
  camp(r: () => number, min: number, max: number): { id: string; x: number; z: number; radius: number; cull: KillKind } | null;
  lair(r: () => number, min: number, max: number): { id: string; x: number; z: number; radius: number; name: string } | null;
  open(r: () => number, min: number, max: number): { x: number; z: number } | null;
}

/** Distance bands per kind (m from the convoy). */
const BAND: Record<ContractKind, [number, number]> = { salvage: [300, 900], cull: [300, 1100], bounty: [400, 1400], tow: [400, 900], pods: [300, 800] };

export class ContractBoard {
  readonly list: Contract[] = [];
  readonly events: ContractEvent[] = [];
  clock = 0;
  private seq = 0;
  /** Seconds to the next offer. */
  next = 0;
  /** Held J (seconds), for the drop. */
  private held = 0;
  private wasHeld = false;

  constructor(public v: ContractValues) { this.next = v.contractFirst; }

  reset() { this.list.length = 0; this.events.length = 0; this.seq = 0; this.clock = 0; this.next = this.v.contractFirst; this.held = 0; this.wasHeld = false; }

  get active() { return this.list.filter((c) => c.state === "active"); }
  get offers() { return this.list.filter((c) => c.state === "offered"); }
  /** Seconds left on an offer. */
  left(c: Contract) { return Math.max(0, this.v.offerTime - (this.clock - c.t)); }

  /**
   * Time passes: offers lapse; while out a new offer comes every contractEvery (sooner when the board is empty), when
   * there's room for one. J: a tap takes the newest offer, a hold drops the newest active contract.
   */
  step(dt: number, out: boolean, jHeld: boolean, src: OfferSources | null) {
    const v = this.v;
    this.clock += dt;
    for (const c of this.list) if (c.state === "offered" && this.clock - c.t > v.offerTime) { c.state = "lapsed"; this.events.push({ type: "lapsed", c }); }
    // Finished lines leave the list after a while (the panel shows them briefly).
    for (let k = this.list.length - 1; k >= 0; k--) { const c = this.list[k]; if (c.state !== "offered" && c.state !== "active" && this.clock - c.t > 6) this.list.splice(k, 1); }
    // J: a tap accepts, a hold drops.
    if (jHeld) {
      this.held += dt;
      if (this.held >= v.dropHold && this.held - dt < v.dropHold) { const a = this.active; if (a.length) this.drop(a[a.length - 1].id); }
    } else if (this.wasHeld) {
      if (this.held < Math.min(0.35, v.dropHold)) { const o = this.offers; if (o.length) this.accept(o[o.length - 1].id); }
      this.held = 0;
    }
    this.wasHeld = jHeld;
    if (!out || !src) return;
    const room = this.active.length + this.offers.length < Math.max(1, Math.round(v.contractsMax));
    if (!room) return;
    this.next -= dt;
    if (this.next <= 0) { this.next = v.contractEvery; this.offer(src); }
  }

  /** Hold-progress of the drop 0..1 (for the HUD). */
  get dropping() { return this.held > 0.35 ? Math.min(1, this.held / this.v.dropHold) : 0; }

  /** Make an offer: a seeded kind by the odds, then a place for it (another kind if none fits). */
  offer(src: OfferSources, kind?: ContractKind): Contract | null {
    const v = this.v, n = this.seq++;
    const r = rng(hash4(v.contractSeed, 503, n, 0));
    const w: Record<ContractKind, number> = { salvage: v.wSalvage, cull: v.wCull, bounty: v.wBounty, tow: v.wTow, pods: v.wPods };
    const order: ContractKind[] = [];
    if (kind) order.push(kind);
    else {
      const pool = CONTRACT_KINDS.filter((k) => w[k] > 0);
      while (pool.length) {
        const sum = pool.reduce((s, k) => s + w[k], 0);
        let x = r() * sum, k = 0;
        while (k < pool.length - 1 && (x -= w[pool[k]]) > 0) k++;
        order.push(pool.splice(k, 1)[0]);
      }
    }
    for (const k of order) {
      const c = this.build(k, `c${n}`, r, src);
      if (c) { this.list.push(c); this.events.push({ type: "offered", c }); return c; }
    }
    return null;
  }

  private build(kind: ContractKind, id: string, r: () => number, src: OfferSources): Contract | null {
    const v = this.v, [lo, hi] = BAND[kind];
    const base = { id, kind, state: "offered" as ContractState, have: 0, carrying: false, t: this.clock };
    const dist = (x: number, z: number) => Math.hypot(x - src.from.x, z - src.from.z);
    const pay = (flat: number, perM: number, d: number) => Math.round(flat + perM * d);
    if (kind === "salvage") {
      const p = src.poi(r, lo, hi);
      if (!p || p.spots < 1) return null;
      const d = dist(p.x, p.z);
      return { ...base, x: p.x, z: p.z, label: p.label, site: p.id, need: Math.max(1, Math.ceil(p.spots * v.salvageShare)), reward: pay(v.rewardSalvage, v.rewardSalvageM, d), dist: d };
    }
    if (kind === "cull") {
      const c = src.camp(r, lo, hi);
      if (!c) return null;
      const d = dist(c.x, c.z), need = c.cull === "cutter" ? v.cullCutter : c.cull === "bandit" ? v.cullBandit : v.cullScrapper;
      return { ...base, x: c.x, z: c.z, label: c.cull === "bandit" ? "Bandit camp" : "Swarm camp", site: c.id, radius: c.radius, cull: c.cull, need: Math.max(1, Math.round(need)), reward: pay(v.rewardCull, v.rewardCullM, d), dist: d };
    }
    if (kind === "bounty") {
      const l = src.lair(r, lo, hi);
      if (!l) return null;
      const d = dist(l.x, l.z);
      return { ...base, x: l.x, z: l.z, label: l.name, site: l.id, radius: l.radius, need: 1, reward: pay(v.rewardBounty, v.rewardBountyM, d), dist: d };
    }
    // One hulk on the sand at a time (the cable has one end).
    if (kind === "tow" && this.list.some((c) => c.kind === "tow" && (c.state === "offered" || c.state === "active"))) return null;
    const o = src.open(r, lo, hi);
    if (!o) return null;
    const d = dist(o.x, o.z);
    if (kind === "tow") return { ...base, x: o.x, z: o.z, label: "Downed Rampart", need: 1, reward: pay(v.rewardTow, v.rewardTowM, d), dist: d };
    const n = Math.max(1, Math.round(v.podCount)), pods: { x: number; z: number }[] = [];
    for (let k = 0; k < n; k++) { const a = r() * Math.PI * 2, s = v.podSpread * Math.sqrt(0.15 + 0.85 * r()); pods.push({ x: o.x + Math.sin(a) * s, z: o.z + Math.cos(a) * s }); }
    return { ...base, x: o.x, z: o.z, label: "Crash site", need: n, pods, reward: pay(v.rewardPod * n, v.rewardPodsM, d), dist: d };
  }

  /** Take an offer (a command). */
  accept(id: string) {
    const c = this.list.find((q) => q.id === id);
    if (!c || c.state !== "offered" || this.active.length >= Math.max(1, Math.round(this.v.contractsMax))) return false;
    c.state = "active"; c.t = this.clock;
    this.events.push({ type: "accepted", c });
    return true;
  }

  /** Give one up (a command): whatever it was carrying is left where it is. */
  drop(id: string) {
    const c = this.list.find((q) => q.id === id);
    if (!c || c.state !== "active") return false;
    c.state = "dropped"; c.carrying = false; c.t = this.clock;
    this.events.push({ type: "dropped", c });
    return true;
  }

  private finish(c: Contract, to: "atRisk" | "bank") { c.state = "done"; c.t = this.clock; c.carrying = false; this.events.push({ type: "done", c, to }); }
  private fail(c: Contract, why: string) { c.state = "failed"; c.t = this.clock; c.carrying = false; this.events.push({ type: "failed", c, why }); }
  private bump(c: Contract, by = 1) {
    c.have = Math.min(c.need, c.have + by);
    this.events.push({ type: "progress", c });
    if (c.have >= c.need && (c.kind === "salvage" || c.kind === "cull" || c.kind === "bounty")) this.finish(c, "atRisk");
  }

  /** Something died: counts for a cull whose circle it fell in. */
  kill(kind: KillKind, x: number, z: number) {
    for (const c of this.list) if (c.state === "active" && c.kind === "cull" && c.cull === kind && Math.hypot(x - c.x, z - c.z) <= (c.radius ?? 0)) this.bump(c);
  }
  /** A salvage spot at a POI was stripped. */
  stripped(poi: string) { for (const c of this.list) if (c.state === "active" && c.kind === "salvage" && c.site === poi) this.bump(c); }
  /** A high value target died. */
  hvtKilled(lair: string) { for (const c of this.list) if (c.state === "active" && c.kind === "bounty" && c.site === lair) this.bump(c); }
  /** The tow cable went on (true) or came off (false) the contract's hulk. */
  towing(id: string, on: boolean) { const c = this.list.find((q) => q.id === id); if (c && c.state === "active" && c.kind === "tow") c.carrying = on; }
  /** A pod was picked up. */
  pod(id: string, k: number) {
    const c = this.list.find((q) => q.id === id);
    if (!c || c.state !== "active" || c.kind !== "pods" || !c.pods?.[k]) return false;
    c.pods[k] = null; c.carrying = true;
    this.bump(c);
    return true;
  }
  /** The crane has the mech: carried jobs are delivered (tow on the cable; every pod picked up). */
  banked() {
    for (const c of this.list) {
      if (c.state !== "active" || !c.carrying) continue;
      if (c.kind === "tow" || (c.kind === "pods" && c.have >= c.need)) this.finish(c, "bank");
      // Some of the pods home: those are safe; the rest still lie out there.
      else c.carrying = false;
    }
  }
  /** The run was lost (recalled, destroyed, pilot killed): what was being carried is gone. */
  lost() { for (const c of this.list) if (c.state === "active" && c.carrying) this.fail(c, c.kind === "tow" ? "the hulk was lost" : "the pods were lost"); }
}
