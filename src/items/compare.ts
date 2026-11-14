// Comparing gear by what it does to the whole mech (Keith 2026-11-14: "you can't actually tell whether you're faster
// with the heavy legs or with the stilt legs"). Pure: fit the candidate into a copy of the loadout the way a click
// would (fitWithHeld: an arm takes its held weapon, a hull weapon bounces that side's hand), resolve both loadouts and
// list what changes, after every soft limit: leg load (walk, sprint, speed-up and turn), the reactor against the
// biggest energy shot, cargo, the whole loadout's sustained DPS. The inventory card and the bay's hover both read it.
import type { Item } from "./item";
import { SLOTS, fitProblem, copyLoadout, isArm, resolve, summary, energyNeedOf, LOADOUT_DEFAULTS,
  type Loadout, type LoadoutValues, type Resolved, type SlotId } from "./loadout";
import { fitWithHeld } from "./fitting";
import { itemDps, itemPower } from "./power";

export interface CompareLine {
  key: string; label: string;
  before: number | null; after: number | null;
  /** 1: more is better; -1: less is. */
  better: 1 | -1; decimals: number;
  /** Shown first and always (speed, DPS, survival, power); the rest are details. */
  major: boolean;
}

export interface Comparison {
  slot: SlotId;
  /** What the fit takes off the mech (the slot's item, a bounced hand or two-hander). */
  off: Item[];
  /** A held weapon an arm brings along from the pool. */
  held: Item | null;
  /** Lines whose value changes, majors first. */
  lines: CompareLine[];
  /** Soft limits crossed or cleared: "Over the legs' best load", "Underpowered"... */
  warnings: { text: string; good: boolean }[];
}

/** Keys shown first, in this order (the summary's keys plus the loadout's own). */
const MAJOR = ["dps", "walkSpeed", "sprintSpeed", "accel", "turnRate", "load", "loadBest", "hull", "armour", "reactorCap", "energyNeed", "cargoCells", "mechRadar", "power"];

/** Every fitted item once (a two-hander sits in one hand). */
const fittedItems = (lo: Loadout) => [...new Set(SLOTS.map((s) => lo[s]).filter((x): x is Item => !!x))];

/** The loadout's own figures the summary doesn't carry: sustained DPS of every fitted weapon, total power, speed-up. */
function extras(lo: Loadout, r: Resolved, cells?: (r: Resolved) => number) {
  const items = fittedItems(lo);
  const dps = items.reduce((n, x) => n + (itemDps(x) ?? 0), 0);
  const line = (key: string, label: string, value: number, better: 1 | -1, decimals: number) => ({ key, label, value, better, decimals });
  const out = [line("dps", "Sustained DPS (all weapons)", dps, 1, 0), line("power", "Power (all items)", items.reduce((n, x) => n + itemPower(x), 0), 1, 0),
    line("accel", "Speed-up (m/s²)", r.values.accel, 1, 1)];
  if (cells) out.push(line("cargoCells", "Cargo (cells)", cells(r), 1, 0));
  return out;
}

const close = (a: number, b: number, decimals: number) => Math.abs(a - b) < 10 ** -(decimals + 1) * 5;

/** The figures of a loadout, keyed (for diffing two). */
function figures(lo: Loadout, v: LoadoutValues, cells?: (r: Resolved) => number) {
  const r = resolve(lo, v);
  const all = [...extras(lo, r, cells), ...summary(r)];
  return { r, all };
}

function warnings(a: Resolved, b: Resolved): Comparison["warnings"] {
  const out: Comparison["warnings"] = [];
  const pct = (k: number) => `${Math.round((1 - k) * 100)}%`;
  const la = a.load, lb = b.load;
  if (lb.over > 0 && la.over <= 0) out.push({ text: `Over the legs' best load (${lb.tonnes.toFixed(1)} / ${lb.best.toFixed(0)} t): −${pct(lb.speed)} speed`, good: false });
  else if (lb.over <= 0 && la.over > 0) out.push({ text: `Back under the legs' best load (was −${pct(la.speed)} speed)`, good: true });
  else if (lb.over > 0 && !close(la.speed, lb.speed, 2)) out.push({ text: `Leg load: −${pct(la.speed)} → −${pct(lb.speed)} speed (${lb.tonnes.toFixed(1)} / ${lb.best.toFixed(0)} t)`, good: lb.speed > la.speed });
  const na = energyNeedOf(a), nb = energyNeedOf(b);
  const under = (r: Resolved, n: number | null) => n !== null && n > r.values.reactorCap + 1e-9;
  if (under(b, nb) && !under(a, na)) out.push({ text: `Underpowered: the reactor holds ${b.values.reactorCap.toFixed(1)} bars, the biggest shot needs ${nb!.toFixed(1)}`, good: false });
  else if (!under(b, nb) && under(a, na)) out.push({ text: `No longer underpowered (reactor ${b.values.reactorCap.toFixed(1)} bars${nb !== null ? `, needs ${nb.toFixed(1)}` : ""})`, good: true });
  else if (under(b, nb)) out.push({ text: `Still underpowered: reactor ${b.values.reactorCap.toFixed(1)} bars, needs ${nb!.toFixed(1)}`, good: false });
  return out;
}

/**
 * What fitting `item` into `slot` does to the mech: null if it doesn't fit there. `pool`: what's on offer for an arm's
 * hand (as fitWithHeld). `cells`: the cargo grid's size for a resolved loadout, when the caller has one.
 */
export function compareFit(lo: Loadout, slot: SlotId, item: Item, pool: readonly Item[], v: LoadoutValues = LOADOUT_DEFAULTS,
  cells?: (r: Resolved) => number): Comparison | null {
  if (fitProblem(lo, slot, item)) return null;
  const now = figures(lo, v, cells);
  const next = copyLoadout(lo);
  let res;
  try { res = fitWithHeld(next, slot, item, pool); } catch { return null; }
  const then = figures(next, v, cells);
  const before = new Map(now.all.map((l) => [l.key, l]));
  const lines: CompareLine[] = [];
  for (const t of then.all) {
    const n = before.get(t.key);
    const bv = n?.value ?? null, av = t.value;
    if (bv === av || (bv !== null && av !== null && close(bv, av, t.decimals))) continue;
    lines.push({ key: t.key, label: t.label, before: bv, after: av, better: t.better, decimals: t.decimals, major: MAJOR.includes(t.key) });
  }
  const rank = (l: CompareLine) => (l.major ? MAJOR.indexOf(l.key) : MAJOR.length);
  lines.sort((p, q) => rank(p) - rank(q));
  const held = res.used.find((x) => x !== item) ?? null;
  return { slot, off: res.off, held, lines, warnings: warnings(now.r, then.r) };
}

/**
 * The slot a click would fit `item` into (as the inventory's equip): the picked slot if it fits there, else an empty
 * slot it fits (a hand that already has its arm before one that would take a hull weapon off), else any it fits.
 */
export function slotFor(lo: Loadout, item: Item, picked: SlotId | null): SlotId | null {
  if (item.kind === "protocol") return null;
  if (picked && !fitProblem(lo, picked, item)) return picked;
  const free = (q: SlotId) => !lo[q] && !fitProblem(lo, q, item);
  return SLOTS.find((q) => free(q) && !((q === "heldL" && !isArm(lo.mountL)) || (q === "heldR" && !isArm(lo.mountR))))
    ?? SLOTS.find(free) ?? SLOTS.find((q) => !fitProblem(lo, q, item)) ?? null;
}

/** A line's change as text and whether it's for the better (null: neither, e.g. a gun gone on one side). */
export function lineText(l: CompareLine, fmt: (x: number, d: number) => string): { text: string; good: boolean | null } {
  if (l.after === null) return { text: `${fmt(l.before!, l.decimals)} → gone`, good: false };
  if (l.before === null) return { text: `new ${fmt(l.after, l.decimals)}`, good: true };
  const d = l.after - l.before;
  return { text: `${fmt(l.before, l.decimals)} → ${fmt(l.after, l.decimals)} (${d > 0 ? "+" : ""}${fmt(d, l.decimals)})`, good: (d > 0) === (l.better > 0) };
}
