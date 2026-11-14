// The inventory (Keith 2026-11-01: "start working towards an inventory doll like what other ARPGs have... always press
// I to view your inventory... and that should also bring up your doll"). I (or a click on the HUD doll) opens it
// anywhere; I or Esc closes it; the game keeps running under it. Left: the mech doll, seen from behind, each slot a
// tile round the silhouette (hover: the item's card; click: pick the slot, and the lists light up what fits it).
// Right: the cargo with its cells against the cargo grid's size, and the stash.
//
// Where things come from and go depends on where the mech is:
// - Out in the field the cargo is the expedition's at-risk list (src/expedition/expedition.ts). Items can be fitted
//   from it, what comes off goes into it (if it fits), and Drop lays an item on the sand as a crate (grabbed again by
//   walking back over it after leaving it); scrap can be dumped (gone). The stash is on the convoy, out of reach.
// - Aboard (or with no expedition: the loadout lab) the cargo is the bay's cargo list, which goes out with the mech at
//   the next launch; fitting takes from the stash and the cargo and puts what comes off in the stash, as the bay does.
// The grids (Keith 2026-11-02): the cargo and the stash are grid inventories, each item a block of cells by its size
// (src/items/gridSize.ts) with a placeholder image (src/ui/itemIcon.ts). Drag an item to move it (R or right click
// while held turns it), onto a doll slot to fit it, from a doll slot onto a grid to take it off, between the cargo and
// the stash, onto the bin to scrap it (twice) or, in the field, onto the sand to drop it. A click still fits it; a
// right click sends it across (stash and cargo). The cargo grid's size is the only limit on what the mech carries (cells,
// src/items/cargoSpace.ts; Keith 2026-11-06: no weight). In the field a pick-up is refused when its cells don't fit;
// anything already over (a refund, a lab start) shows under the grid as "no room".
// The bay screen (B) still does sockets, loot rolls and the side-by-side stat changes.
import "./inventory.css";
import { STATS } from "../items/bases";
import { PROTOCOL_BY_ID } from "../items/protocols";
import { RARITY } from "../items/rarity";
import { levelOf } from "../items/level";
import { itemPower, dpsText, itemDps, versusFitted } from "../items/power";
import type { Item } from "../items/item";
import { cargoCapacity, cargoSizing, scrapCells } from "../items/cargoSpace";
import {
  SLOTS, SLOT_NAMES, armable, copyLoadout, isBuiltinArm, effectiveStats, fitProblem, isArm, isHullWeapon, isTwoHander, resolve, unfit,
  type LoadoutValues, type SlotId,
} from "../items/loadout";
import { fitWithHeld } from "../items/fitting";
import { bagCells, moveItem, takeFrom } from "../items/cargo";
import { itemName, type BayState } from "../items/bayState";
import { itemValue, VALUE_DEFAULTS, type ValueValues } from "../items/value";
import { sortItems as sortBy, SORT_KEYS, SORT_NAMES, type SortKey } from "../items/sort";
import { itemCadence } from "../items/dps";
import type { LootValues } from "../items/generate";
import type { Expedition } from "../expedition/expedition";
import { dollSvg, paintPart, DOLL_PARTS, type DollPart } from "./mechDoll";
import { GRID_SIZE_DEFAULTS, gridClassOf, isSalvage, itemCells, salvageBlocks, type GridSizeValues } from "../items/gridSize";
import { GRID_DEFAULTS, autoPlace, fitsAt, footprint, placeAt, syncGrid, type Grid, type GridValues } from "../items/grid";
import { itemIcon } from "./itemIcon";
import { TALL } from "./iconShape";

export interface InventoryOptions {
  state: BayState;
  tuning: LootValues & LoadoutValues & Partial<ValueValues> & Partial<GridValues> & Partial<GridSizeValues> & { cargoWarn?: number };
  /** The expedition, where there is one: out in the field its at-risk list is the cargo. */
  exp?: Expedition | null;
  /** After anything changes (refit the mech, save). */
  onChange: () => void;
  /** Open the bay screen (sockets, loot rolls), where there is one. */
  openBay?: () => void;
  /** Scrap an item for its value into the convoy's bank (Keith 2026-11-01: only at the convoy, never in the field, or
   *  everything gets scrapped into junk). Without it (no bank, e.g. the loadout lab) there's no Scrap button. */
  bankScrap?: (n: number) => void;
  /** The salvage compactor's level (the convoy's unlock); without it, the Salvage blocks slider. */
  compactLevel?: () => number;
  /** What one scrap at risk banks for at that level (shown on the blocks). */
  scrapValueMul?: () => number;
  /** Called on opening (close the bay so they don't stack). */
  onOpen?: () => void;
}

/** Where each slot's tile sits on the doll (a 3 × 4 grid, the mech seen from behind: its left side on the left, the
 *  spine down the middle; 2026-11-13, was loose positions that overlapped) and its short label. */
const TILES: Record<SlotId, { col: number; row: number; label: string }> = {
  shoulderL: { col: 1, row: 1, label: "Shoulder 1" },
  mountL: { col: 1, row: 2, label: "Mount L" },
  heldL: { col: 1, row: 3, label: "Left hand" },
  waistL: { col: 1, row: 4, label: "Waist L" },
  sensor: { col: 2, row: 1, label: "Sensor" },
  pack: { col: 2, row: 2, label: "Back 3" },
  hull: { col: 2, row: 3, label: "Hull" },
  legs: { col: 2, row: 4, label: "Legs" },
  shoulderR: { col: 3, row: 1, label: "Shoulder 2" },
  mountR: { col: 3, row: 2, label: "Mount R" },
  heldR: { col: 3, row: 3, label: "Right hand" },
  waistR: { col: 3, row: 4, label: "Waist R" },
};
/** The picture's box on a doll tile (px). */
const TILE_PIC = { w: 98, h: 50 };
/** Which doll shape lights for a slot. */
const PART_OF: Record<SlotId, DollPart> = {
  sensor: "sensor", pack: "pack", shoulderL: "armL", shoulderR: "armR", mountL: "armL", mountR: "armR", heldL: "armL", heldR: "armR",
  hull: "hull", waistL: "hull", waistR: "hull", legs: "legL",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function btn(label: string, onClick: () => void, cls = "") {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}
const fmt = (x: number, d: number) => x.toFixed(d);
const SORT_STORE = "pm2:inventory:sort";

export function inventoryScreen(o: InventoryOptions) {
  const st = o.state;
  const root = el("div", "inv");
  root.hidden = true;
  document.body.appendChild(root);
  const tip = el("div", "inv-tip");
  tip.hidden = true;
  document.body.appendChild(tip);
  let slot: SlotId | null = null;
  let message = "", messageT = 0;
  let sig = "";
  /** The stash item whose Scrap button was clicked once (the next click scraps it). */
  let scrapArmed: string | null = null;
  // Sorting (Keith 2026-11-01): one order for every list, kept between visits.
  let sortKey: SortKey = "rarity", sortUp = false;
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_STORE) || "null");
    if (saved && (SORT_KEYS as readonly string[]).includes(saved.key)) { sortKey = saved.key; sortUp = !!saved.up; }
  } catch { /* storage blocked */ }
  const vv = (): ValueValues => ({ ...VALUE_DEFAULTS, ...Object.fromEntries(Object.keys(VALUE_DEFAULTS).flatMap((k) => (o.tuning as Record<string, unknown>)[k] === undefined ? [] : [[k, (o.tuning as Record<string, number>)[k]]])) });
  const sorted = (xs: readonly Item[]) => sortBy(xs, sortKey, sortUp, vv());
  function setSort(k: SortKey) {
    if (k === sortKey) sortUp = !sortUp; else { sortKey = k; sortUp = false; }
    try { localStorage.setItem(SORT_STORE, JSON.stringify({ key: sortKey, up: sortUp })); } catch { /* storage blocked */ }
    render();
  }

  const field = () => !!o.exp && o.exp.state === "out";
  /** Items on offer to fit: the at-risk items in the field, the stash and the bay's cargo aboard. */
  const pool = (): Item[] => (field() ? o.exp!.atRisk.flatMap((l) => (l.kind === "item" ? [l.item] : [])) : [...st.cargo.items, ...st.stash.items]);
  /** How the cargo counts cells (item classes from the Grid sliders, scrap blocks by the compactor). */
  const sizing = () => cargoSizing(gv(), o.compactLevel ? o.compactLevel() : gv().salvageLevel);
  /** The cargo grid's size in cells for a loadout (its racks add rows). */
  const capacityOf = (lo: typeof st.loadout) => cargoCapacity(gv(), resolve(lo, o.tuning).cargoRackRows);
  const capacity = () => capacityOf(st.loadout);
  const sum = (xs: readonly Item[]) => xs.reduce((w, i) => w + sizing().itemCells(i), 0);
  const say = (t: string) => { message = t; messageT = 4; render(); };

  function changed() {
    st.cargo.capacity = capacity();
    if (o.exp) o.exp.sizing = sizing();
    o.onChange();
    render();
  }

  /** Fit an item into a slot, moving items between the lists; refused with a reason if the cargo can't take it. */
  function fitInto(s: SlotId, it: Item) {
    const why = fitProblem(st.loadout, s, it);
    if (why) { say(why); return; }
    if (field()) {
      const e = o.exp!;
      // A dry run first: what comes off has to fit the cargo, under the capacity of the mech as it will be.
      const lo = copyLoadout(st.loadout);
      const r = fitWithHeld(lo, s, it, pool());
      const cap = e.capacity === Infinity ? Infinity : capacityOf(lo);
      const after = e.load - sum(r.used) + sum(r.off);
      if (after > cap + 1e-9) { say(`No room in the cargo for what comes off (${after} / ${cap} cells). Drop something first.`); return; }
      const real = fitWithHeld(st.loadout, s, it, pool());
      for (const u of real.used) e.takeItem(u.id);
      e.capacity = cap;
      for (const x of real.off) e.stow(x, itemName(x));
      if (real.emptyHeld) slot = real.emptyHeld;
    } else {
      const r = fitWithHeld(st.loadout, s, it, pool());
      for (const u of r.used) takeFrom(st.cargo.items.includes(u) ? st.cargo : st.stash, u.id);
      for (const x of r.off) st.stash.items.push(x);
      if (r.emptyHeld) slot = r.emptyHeld;
    }
    hideTip();
    changed();
  }

  function takeOff(s: SlotId) {
    if (s === "legs" || s === "hull") { say("Legs and hull can only be swapped, not taken off."); return; }
    if (isBuiltinArm(st.loadout[s])) { say("Arms come with the hull: fit a hull weapon here to replace this one."); return; }
    if (field()) {
      const e = o.exp!, lo = copyLoadout(st.loadout), off = unfit(lo, s);
      const cap = e.capacity === Infinity ? Infinity : capacityOf(lo);
      if (e.load + sum(off) > cap + 1e-9) { say(`No room in the cargo for it (${e.load + sum(off)} / ${cap} cells).`); return; }
      e.capacity = cap;
      for (const x of unfit(st.loadout, s)) e.stow(x, itemName(x));
    } else for (const x of unfit(st.loadout, s)) st.stash.items.push(x);
    hideTip();
    changed();
  }

  /** Click on an item in a list: into the picked slot if it fits there, else the first slot it fits. */
  function equip(it: Item) {
    if (slot && !fitProblem(st.loadout, slot, it)) { fitInto(slot, it); return; }
    // An empty slot first, a hand that already has its arm before one that would take a hull weapon off.
    const free = (q: SlotId) => !st.loadout[q] && !fitProblem(st.loadout, q, it);
    const s = SLOTS.find((q) => free(q) && !((q === "heldL" && !isArm(st.loadout.mountL)) || (q === "heldR" && !isArm(st.loadout.mountR))))
      ?? SLOTS.find(free) ?? SLOTS.find((q) => !fitProblem(st.loadout, q, it));
    if (s) fitInto(s, it); else say(it.kind === "protocol" ? "Protocols go in sockets: open the bay (B)." : `${itemName(it)} doesn't fit anywhere on this mech.`);
  }

  // ---- the item card (hover) ----

  function cardHtml(it: Item, compare: boolean): string {
    const col = RARITY[it.rarity].color;
    const size = it.kind !== "weapon" ? it.kind : it.size === "M" ? "hull weapon" : it.size === "H" ? "held, two-handed" : "held weapon";
    const dps = dpsText(it);
    let h = `<div class="inv-tipname" style="color:${col}">${itemName(it)}</div>`
      + `<div class="inv-tipsub" style="color:${col}">${RARITY[it.rarity].name.toUpperCase()} · LEVEL ${levelOf(it)}</div>`
      + `<div class="dim">${size} · ${it.maker}</div>`
      + `<div>Power ${itemPower(it)}${dps ? ` · ${dps}` : ""} · ◆ ${itemValue(it, vv())} scrap</div>`;
    // DPS is sustained: the magazine and its reload counted (src/items/dps.ts). The burst is while the magazine lasts.
    const cad = itemCadence(it);
    if (cad && cad.magazine > 0) h += `<div class="dim">Sustained, reload counted · burst ${Math.round(cad.damage * cad.rounds * cad.rate)} dps · magazine ${cad.magazine}, reload ${fmt(cad.reload, 1)} s</div>`;
    else if (cad) h += `<div class="dim">Sustained over its cooldown</div>`;
    if (it.kind === "protocol") h += `<div class="dim">${PROTOCOL_BY_ID[it.base]?.text ?? ""}</div>`;
    const eff = effectiveStats(it);
    for (const k in it.stats) {
      const info = STATS[k];
      if (info?.hidden) continue;
      h += `<div class="inv-stat"><span>${info?.label ?? k}</span><span>${fmt(eff[k], info?.decimals ?? 2)}</span></div>`;
    }
    if (it.sockets) h += `<div class="dim">Sockets ${it.socketed.length}/${it.sockets}${it.socketed.length ? ": " + it.socketed.map((p) => PROTOCOL_BY_ID[p.base]?.name ?? p.base).join(", ") : ""}</div>`;
    if (compare) {
      const vs = versusFitted(it, Object.values(st.loadout)), p = itemPower(it), d = itemDps(it);
      const diff = (a: number, b: number, u: string) => { const x = Math.round(a - b); return `<b class="${x > 0 ? "good" : x < 0 ? "bad" : "dim"}">${x > 0 ? "+" : ""}${x}${u}</b>`; };
      h += `<div class="inv-cmp">${!vs ? "nothing of this kind fitted" : `${d !== null && vs.dps !== null ? diff(d, vs.dps, " dps") + " · " : ""}${diff(p, vs.power, " power")} vs fitted`}</div>`;
    }
    return h;
  }
  function showTip(it: Item, e: MouseEvent, compare: boolean) {
    tip.innerHTML = cardHtml(it, compare);
    tip.style.borderColor = RARITY[it.rarity].color;
    tip.hidden = false;
    moveTip(e);
  }
  function moveTip(e: MouseEvent) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(innerWidth - w - 8, e.clientX + 16)}px`;
    tip.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, e.clientY + 12))}px`;
  }
  function hideTip() { tip.hidden = true; }
  function hoverable(row: HTMLElement, it: Item, compare: boolean) {
    row.addEventListener("mouseenter", (e) => showTip(it, e, compare));
    row.addEventListener("mousemove", moveTip);
    row.addEventListener("mouseleave", hideTip);
  }

  // ---- the grids ----

  type GridId = "cargo" | "stash";
  const GRID_LAYOUT_V = 2;
  // Filter chips (Keith 2026-11-03): items outside the filter are dimmed in the grids.
  type Filter = "all" | "hullWeapon" | "held" | "parts" | "gear" | "protocol";
  const FILTERS: [Filter, string][] = [["all", "All"], ["hullWeapon", "Hull weapons"], ["held", "Held"], ["parts", "Legs, hulls, sensors"], ["gear", "Shoulder, back, waist"], ["protocol", "Protocols"]];
  let filter: Filter = "all";
  const passes = (x: Item) => filter === "all" || isSalvage(x) || (filter === "hullWeapon" ? isHullWeapon(x) : filter === "held" ? x.kind === "weapon" && !isHullWeapon(x)
    : filter === "parts" ? x.kind === "legs" || x.kind === "hull" || x.kind === "sensor" : filter === "gear" ? x.kind === "shoulder" || x.kind === "pack" || x.kind === "waist" : x.kind === "protocol");
  const gv = (): GridValues & GridSizeValues => {
    const t = o.tuning as Record<string, number | undefined>, out: Record<string, number> = { ...GRID_DEFAULTS, ...GRID_SIZE_DEFAULTS };
    for (const k in out) if (typeof t[k] === "number") out[k] = t[k]!;
    return out as GridValues & GridSizeValues;
  };
  const turnable = () => gv().gridTurn >= 0.5;
  /** The items in a grid: the cargo is the at-risk list in the field, the bay's cargo aboard. */
  const gridItems = (g: GridId): Item[] => (g === "stash" ? st.stash.items : field() ? [...pool(), ...salvage()] : st.cargo.items);
  /** The scrap at risk as salvage blocks in the cargo grid (field only). */
  const salvage = (): Item[] => (field() ? salvageBlocks(o.exp!.scrapAtRisk, gv().salvagePerBlock, o.compactLevel ? o.compactLevel() : gv().salvageLevel) : []);
  /** A grid in step with its items (saved positions kept); `over`: the items with no room. */
  function gridOf(g: GridId): { grid: Grid; over: Item[] } {
    const v = gv();
    // Layout version 2 (2026-11-03): layouts saved before were auto-placed turned; lay them out upright once.
    if (!st.grids || st.grids.v !== GRID_LAYOUT_V) st.grids = { cargo: [], stash: [], v: GRID_LAYOUT_V };
    const grid: Grid = g === "cargo" ? { cols: v.cargoCols, rows: v.cargoRows + resolve(st.loadout, o.tuning).cargoRackRows, placed: st.grids.cargo } : { cols: v.stashCols, rows: v.stashRows, placed: st.grids.stash };
    if (g === "stash") grid.rows = Math.max(grid.rows, ...grid.placed.map((p) => p.y + footprint(p, p.rot).h));
    const items = gridItems(g);
    const left = new Set(syncGrid(grid, items.map((it) => ({ id: it.id, cells: itemCells(it, v) })), turnable(), g === "stash"));
    st.grids[g] = grid.placed;
    // The stash shows one free row at the bottom so there's always somewhere to drop.
    if (g === "stash") grid.rows = Math.max(v.stashRows, ...grid.placed.map((p) => p.y + footprint(p, p.rot).h + 1));
    return { grid, over: items.filter((it) => left.has(it.id)) };
  }
  const findItem = (id: string) => [...gridItems("cargo"), ...st.stash.items].find((x) => x.id === id) ?? null;

  /** What is being dragged: an item from a grid or off a doll slot, how it's turned and where it was grabbed. */
  interface Drag { item: Item; from: GridId | SlotId; rot: boolean; gx: number; gy: number; ghost: HTMLElement; armed?: boolean }
  let drag: Drag | null = null;
  let press: { item: Item; from: GridId | SlotId; x: number; y: number; rot: boolean; gx: number; gy: number } | null = null;

  function ghostOf(it: Item, rot: boolean): HTMLElement {
    const px = gv().gridCellPx, c = footprint(itemCells(it, gv()), rot);
    const g = el("div", "inv-ghost");
    g.style.width = `${c.w * px}px`; g.style.height = `${c.h * px}px`;
    const col = isSalvage(it) ? "#e6c86a" : RARITY[it.rarity].color;
    g.style.borderColor = col;
    g.append(itemIcon(it, col, rot, gv()));
    document.body.append(g);
    return g;
  }
  /** Where the drag would land: a grid cell, a doll slot, the bin or the sand. */
  function target(e: PointerEvent): { grid: GridId; x: number; y: number } | { slot: SlotId } | { zone: "bin" | "sand" } | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const gEl = hit?.closest<HTMLElement>("[data-grid]");
    if (gEl && drag) {
      const r = gEl.getBoundingClientRect(), px = gv().gridCellPx;
      return { grid: gEl.dataset.grid as GridId, x: Math.floor((e.clientX - r.left) / px) - drag.gx, y: Math.floor((e.clientY - r.top) / px) - drag.gy };
    }
    const sEl = hit?.closest<HTMLElement>("[data-slot]");
    if (sEl) return { slot: sEl.dataset.slot as SlotId };
    const zEl = hit?.closest<HTMLElement>("[data-zone]");
    if (zEl) return { zone: zEl.dataset.zone as "bin" | "sand" };
    return null;
  }
  /** Whether the dragged item can land there (for the ghost's colour). */
  function canLand(t: ReturnType<typeof target>): boolean {
    if (!drag || !t) return false;
    const it = drag.item;
    if ("slot" in t) return !isSalvage(it) && typeof drag.from === "string" && (drag.from === "cargo" || drag.from === "stash") && !fitProblem(st.loadout, t.slot, it);
    if ("zone" in t) return t.zone === "bin" ? drag.from === "stash" && !!o.bankScrap : drag.from === "cargo" && field();
    if (field() && t.grid === "stash") return false;
    const { grid } = gridOf(t.grid);
    return fitsAt(grid, itemCells(it, gv()), t.x, t.y, drag.rot, it.id);
  }
  function moveGhost(e: PointerEvent) {
    if (!drag) return;
    const px = gv().gridCellPx;
    drag.ghost.style.left = `${e.clientX - (drag.gx + 0.5) * px}px`;
    drag.ghost.style.top = `${e.clientY - (drag.gy + 0.5) * px}px`;
    drag.ghost.classList.toggle("bad", !canLand(target(e)));
  }
  function startDrag(e: PointerEvent) {
    if (!press) return;
    hideTip();
    drag = { item: press.item, from: press.from, rot: press.rot, gx: press.gx, gy: press.gy, ghost: ghostOf(press.item, press.rot) };
    press = null;
    root.classList.add("dragging");
    for (const t of root.querySelectorAll<HTMLElement>("[data-slot]")) t.classList.toggle("fits", !fitProblem(st.loadout, t.dataset.slot as SlotId, drag.item));
    moveGhost(e);
  }
  function turnDrag(e?: PointerEvent) {
    if (!drag || !turnable()) return;
    drag.rot = !drag.rot;
    [drag.gx, drag.gy] = [0, 0];
    const c = footprint(itemCells(drag.item, gv()), drag.rot);
    drag.gx = Math.floor(c.w / 2); drag.gy = Math.floor(c.h / 2);
    drag.ghost.remove();
    drag.ghost = ghostOf(drag.item, drag.rot);
    if (e) moveGhost(e); else drag.ghost.style.left = "-999px";
  }
  function endDrag() {
    drag?.ghost.remove();
    drag = null;
    root.classList.remove("dragging");
  }
  /** Put an item into a grid at a spot if it's free there (else wherever it was auto-placed). */
  function setAt(g: GridId, it: Item, x: number, y: number, rot: boolean) {
    const { grid } = gridOf(g);
    placeAt(grid, it.id, itemCells(it, gv()), x, y, rot);
    st.grids![g] = grid.placed;
  }
  function drop(e: PointerEvent) {
    if (!drag) return;
    const d = drag, t = target(e), it = d.item;
    endDrag();
    if (!t || !canLandFor(d, t)) { render(); return; }
    if ("slot" in t) { fitInto(t.slot, it); return; }
    if ("zone" in t) {
      if (t.zone === "sand") {
        if (isSalvage(it)) { o.exp!.dumpScrap(it.stats.scrap); say(`Dumped ${it.stats.scrap} scrap.`); return; }
        if (o.exp!.dropItem(it.id)) render();
        return;
      }
      // The bin: twice to scrap (the first drop arms it).
      const val = itemValue(it, vv());
      if (scrapArmed !== it.id) { scrapArmed = it.id; say(`Drop ${itemName(it)} on the bin again to scrap it for ◆ ${val}.`); return; }
      scrapArmed = null;
      if (!takeFrom(st.stash, it.id)) return;
      o.bankScrap!(val);
      say(`Scrapped ${itemName(it)} for ${val} scrap (banked).`);
      changed();
      return;
    }
    if (d.from === t.grid) { setAt(t.grid, it, t.x, t.y, d.rot); changed(); return; }
    if (d.from === "cargo" || d.from === "stash") {
      // Across: stash and the bay's cargo (aboard only; the field's stash is out of reach).
      const from = d.from === "stash" ? st.stash : st.cargo, to = t.grid === "stash" ? st.stash : st.cargo;
      if (!moveItem(from, to, it.id, sizing())) { say(`No room in the cargo for ${itemName(it)}.`); return; }
      setAt(t.grid, it, t.x, t.y, d.rot);
      changed();
      return;
    }
    // Off a doll slot onto a grid: take it off, then put it where it was dropped.
    const slotFrom = d.from;
    takeOff(slotFrom);
    if (st.loadout[slotFrom]?.id === it.id) return;
    const home: GridId = field() ? "cargo" : "stash";
    if (t.grid !== home && !field() && !moveItem(st.stash, st.cargo, it.id, sizing())) { say(`No room in the cargo for ${itemName(it)}; it went to the stash.`); return; }
    setAt(t.grid, it, t.x, t.y, d.rot);
    changed();
  }
  const canLandFor = (d: Drag, t: NonNullable<ReturnType<typeof target>>) => { const keep = drag; drag = d; const ok = canLand(t) || ("grid" in t && typeof d.from === "string" && d.from !== "cargo" && d.from !== "stash" && !(field() && t.grid === "stash")); drag = keep; return ok; };

  addEventListener("pointermove", (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) startDrag(e);
    else if (drag) moveGhost(e);
  });
  addEventListener("pointerup", (e) => {
    if (drag) { drop(e); return; }
    if (press) {
      const p = press;
      press = null;
      if (isSalvage(p.item)) say(`Salvage: ${p.item.stats.scrap} scrap, banks for ${Math.floor(p.item.stats.scrap * (o.scrapValueMul?.() ?? 1))} when the mech is picked up (the Salvage compactor packs it smaller and banks it for more). Drag it onto the sand to dump it.`);
      else if (p.from === "cargo" || p.from === "stash") equip(p.item);
      else { slot = slot === p.from ? null : p.from; render(); }
    }
  });
  // R or a right click turns the held item; Esc lets go of it. Capture, so the lab's R (reload) doesn't see it.
  addEventListener("keydown", (e) => {
    if (!drag) return;
    if (e.code === "KeyR") { e.preventDefault(); e.stopImmediatePropagation(); turnDrag(); }
    if (e.code === "Escape") { e.stopImmediatePropagation(); endDrag(); render(); }
  }, { capture: true });
  addEventListener("contextmenu", (e) => { if (drag) { e.preventDefault(); turnDrag(e as PointerEvent); } }, { capture: true });

  /** Right click on a grid item: across to the other list (aboard). */
  function sendAcross(it: Item, from: GridId) {
    if (field()) return;
    if (from === "stash") { if (moveItem(st.stash, st.cargo, it.id, sizing())) changed(); else say(`No room in the cargo for ${itemName(it)}.`); }
    else { moveItem(st.cargo, st.stash, it.id); changed(); }
  }

  function gridBox(g: GridId) {
    const { grid, over } = gridOf(g);
    const px = gv().gridCellPx;
    const box = el("div", "inv-grid");
    box.dataset.grid = g;
    box.style.width = `${grid.cols * px}px`; box.style.height = `${grid.rows * px}px`;
    box.style.backgroundSize = `${px}px ${px}px`;
    for (const p of grid.placed) {
      const it = findItem(p.id);
      if (!it) continue;
      const f = footprint(p, p.rot), col = isSalvage(it) ? "#e6c86a" : RARITY[it.rarity].color;
      const cell = el("div", "inv-gitem" + (slot && !fitProblem(st.loadout, slot, it) ? " fits" : "") + (scrapArmed === it.id ? " armed" : "") + (passes(it) ? "" : " dim"));
      cell.style.left = `${p.x * px}px`; cell.style.top = `${p.y * px}px`;
      cell.style.width = `${f.w * px}px`; cell.style.height = `${f.h * px}px`;
      cell.style.borderColor = col;
      cell.append(itemIcon(it, col, p.rot, gv()));
      const mul = o.scrapValueMul?.() ?? 1;
      const label = isSalvage(it) ? `◆ ${it.stats.scrap}${mul > 1.001 ? ` → ${Math.floor(it.stats.scrap * mul)}` : ""}` : itemName(it);
      if (f.w * f.h >= 2 || isSalvage(it)) { const n = el("span", "inv-gname", label); n.style.color = isSalvage(it) ? "#e6c86a" : col; cell.append(n); }
      if (isSalvage(it)) cell.classList.add("salvage");
      cell.addEventListener("pointerdown", (e) => {
        const r = cell.getBoundingClientRect();
        e.preventDefault();
        if (e.button === 0) press = { item: it, from: g, x: e.clientX, y: e.clientY, rot: p.rot, gx: Math.floor((e.clientX - r.left) / px), gy: Math.floor((e.clientY - r.top) / px) };
      });
      cell.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!drag) sendAcross(it, g); });
      if (!isSalvage(it)) hoverable(cell, it, true);
      box.append(cell);
    }
    const wrap = el("div", "inv-gridwrap");
    wrap.append(box);
    const overSalvage = over.filter(isSalvage), overItems = over.filter((x) => !isSalvage(x));
    if (overSalvage.length) wrap.append(el("p", "inv-note bad", `No room in the grid for ${overSalvage.length} salvage block${overSalvage.length > 1 ? "s" : ""} (◆ ${overSalvage.reduce((n, x) => n + x.stats.scrap, 0)}).`));
    if (overItems.length) {
      wrap.append(el("p", "inv-note bad", `No room in the grid for ${overItems.length} (drop or move something):`));
      const list = el("div", "inv-list");
      for (const x of overItems) list.append(itemRow(x, g === "stash" ? "stash" : field() ? "cargo" : "bayCargo"));
      wrap.append(list);
    }
    return wrap;
  }
  /** Lay a grid out afresh, biggest first. */
  /** Lay a grid out afresh in the sort order (Keith 2026-11-03: the sort chips sort the grids too). If the cargo
   *  can't take everything that way, biggest first instead. */
  function tidy(g: GridId) {
    const v = gv(), { grid } = gridOf(g);
    const items = sorted(gridItems(g)).filter((x) => !isSalvage(x)).concat(gridItems(g).filter(isSalvage));
    const fresh = { ...grid, rows: g === "stash" ? v.stashRows : grid.rows, placed: [] as typeof grid.placed };
    let left = 0;
    for (const it of items) {
      const c = itemCells(it, v);
      while (!autoPlace(fresh, it.id, c, false) && g === "stash" && fresh.rows < 400) fresh.rows++;
      if (!fresh.placed.some((p) => p.id === it.id)) left++;
    }
    st.grids![g] = left ? [] : fresh.placed;
    changed();
  }
  const zone = (z: "bin" | "sand", text: string) => { const b = el("div", "inv-zone", text); b.dataset.zone = z; return b; };

  // ---- pieces ----

  function dollBox() {
    const box = el("div", "inv-doll");
    const tiles = el("div", "inv-tiles");
    const { svg, parts } = dollSvg();
    svg.classList.add("inv-sil");
    const lo = st.loadout;
    const partItem: Record<DollPart, Item | null> = {
      sensor: lo.sensor, pack: lo.pack, hull: lo.hull, legL: lo.legs, legR: lo.legs,
      armL: lo.mountL, armR: lo.mountR,
    };
    for (const p of DOLL_PARTS) {
      const it = partItem[p];
      const on = slot !== null && (PART_OF[slot] === p || (slot === "legs" && p === "legR"));
      paintPart(parts[p], on ? "#e8892b" : it ? RARITY[it.rarity].color : "#ffffff", !it);
    }
    box.append(svg);
    for (const s of SLOTS) {
      const t = TILES[s], it = lo[s];
      const heldBy2 = s === "heldL" && isTwoHander(lo.heldR);
      // A hand only exists with an arm on that mount (or the two-hander's other hand).
      const noHand = (s === "heldL" && !armable(lo, "L")) || (s === "heldR" && !armable(lo, "R"));
      const tile = el("div", "inv-tile" + (s === slot ? " on" : "") + (it ? "" : " empty") + (noHand && !it ? " off" : ""));
      tile.style.gridColumn = `${t.col}`; tile.style.gridRow = `${t.row}`;
      if (it) tile.style.borderColor = RARITY[it.rarity].color;
      const top = el("div", "inv-tiletop");
      top.append(el("span", "inv-tilelabel", t.label));
      tile.append(top);
      const pic = el("div", "inv-tilepic");
      tile.append(pic);
      const shown = heldBy2 ? lo.heldR : it;
      if (shown) {
        // The item's own picture, as big as the tile takes (guns and swords laid flat), and its grid size beside the
        // label (Keith 2026-11-03: "once I move an item onto the mech doll, I can't see how many grid spaces that
        // item needs").
        const c = itemCells(shown, gv()), flat = c.h >= 2 * c.w && TALL.includes(gridClassOf(shown));
        const fw = flat ? c.h : c.w, fh = flat ? c.w : c.h, px = Math.min(TILE_PIC.w / fw, TILE_PIC.h / fh, 30);
        const svg = itemIcon(shown, RARITY[shown.rarity].color, flat, gv());
        svg.style.width = `${fw * px}px`; svg.style.height = `${fh * px}px`;
        if (heldBy2) pic.classList.add("ghosted");
        pic.append(svg);
        if (!isBuiltinArm(shown) && !heldBy2) top.append(el("span", "inv-tilemeta", `${c.w}×${c.h} L${levelOf(shown)}`));
      } else pic.append(el("span", "inv-tilenone", noHand ? "no arm" : "empty"));
      const name = el("span", "inv-tilename", heldBy2 ? "(two-hander)" : it ? (isBuiltinArm(it) ? "Arm (with the hull)" : itemName(it)) : noHand ? "no arm on this hull" : "");
      if (it) name.style.color = RARITY[it.rarity].color;
      tile.append(name);
      tile.dataset.slot = s;
      // Press: a click picks the slot; dragging it off onto a grid takes it off (legs and hull only swap).
      tile.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const off = it && s !== "legs" && s !== "hull" && !heldBy2 && !isBuiltinArm(it);
        press = { item: it ?? ({} as Item), from: s, x: e.clientX, y: e.clientY, rot: false, gx: 0, gy: 0 };
        if (!off) press.x = press.y = Number.NaN; // no drag: only the click
      });
      if (it) hoverable(tile, it, false);
      tiles.append(tile);
    }
    box.append(tiles, statStrip());
    return box;
  }

  /** The mech as fitted, in a line of figures under the doll. */
  function statStrip() {
    const rr = resolve(st.loadout, o.tuning), r = rr.values, fitted = Object.values(st.loadout).filter((x): x is Item => !!x);
    const power = fitted.reduce((n, x) => n + itemPower(x), 0), dps = fitted.reduce((n, x) => n + (itemDps(x) ?? 0), 0);
    const box = el("div", "inv-stats");
    const cell = (k: string, v: string) => { const c = el("div", "inv-statcell"); c.append(el("span", "", k), el("b", "", v)); box.append(c); };
    cell("Power", `${Math.round(power)}`); cell("DPS", `${Math.round(dps)}`); cell("Hull", `${Math.round(r.hull)}`); cell("Armour", `${Math.round(r.armour)}`);
    cell("Walk", `${fmt(r.walkSpeed, 1)} m/s`);
    // Leg load (Keith 2026-11-14): the weight on the legs against their best load, and the speed it costs over it.
    const ld = rr.load;
    cell("Load", `${fmt(ld.tonnes, 1)}/${fmt(ld.best, 0)} t${ld.speed < 0.995 ? ` −${Math.round((1 - ld.speed) * 100)}%` : ""}`);
    cell("Radar", `${Math.round(r.mechRadar)} m`); cell("Cargo", `${capacity()} cells`);
    return box;
  }

  function slotPanel() {
    const col = el("div", "inv-slotpanel");
    if (!slot) { col.append(el("p", "inv-note", "Click a slot on the doll to see what fits it. Click an item in the lists to fit it; hover for its card.")); return col; }
    const it = slot === "heldL" && isTwoHander(st.loadout.heldR) ? st.loadout.heldR : st.loadout[slot];
    const head = el("div", "inv-row");
    head.append(el("b", "", SLOT_NAMES[slot]), el("span", "dim", it ? itemName(it) : "empty"));
    if (it && slot !== "legs" && slot !== "hull") head.append(btn(field() ? "Take off (to cargo)" : "Take off (to stash)", () => takeOff(slot!), "small"));
    col.append(head);
    const fits = pool().filter((x) => x.kind !== "protocol" && !fitProblem(st.loadout, slot!, x)); 
    if (!fits.length) col.append(el("p", "inv-note", field() ? "Nothing in the cargo fits here." : "Nothing in the stash or cargo fits here."));
    const list = el("div", "inv-list");
    for (const x of sorted(fits)) list.append(itemRow(x, "fit"));
    col.append(list);
    return col;
  }

  function itemRow(x: Item, mode: "fit" | "cargo" | "stash" | "bayCargo") {
    const row = el("div", "inv-item" + (slot && !fitProblem(st.loadout, slot, x) ? " fits" : ""));
    row.style.borderLeftColor = RARITY[x.rarity].color;
    const name = el("span", "inv-name", itemName(x));
    name.style.color = RARITY[x.rarity].color;
    const d = itemDps(x), val = itemValue(x, vv());
    // Each figure, tagged with the sort it answers; the one the list is sorted by stands out.
    const meta: [SortKey | null, string][] = [["level", `Lv ${levelOf(x)}`], ["power", `P ${itemPower(x)}`], ["dps", d !== null ? `${Math.round(d)} dps` : ""],
      ["value", `◆ ${val}`]];
    const metaEl = el("span", "dim");
    meta.filter(([, t]) => t).forEach(([k, t], i) => metaEl.append(i ? " · " : "", k === sortKey ? el("b", "inv-hot", t) : t));
    row.append(name, metaEl);
    row.addEventListener("click", () => equip(x));
    if (mode === "cargo") row.append(btn("Drop", () => { hideTip(); if (o.exp!.dropItem(x.id)) render(); }, "small"));
    if (mode === "stash" && o.bankScrap) {
      // Two clicks: the first arms it ("Sure?"), the second scraps it. Protocols socketed in it go with it (counted).
      const val = itemValue(x, vv()), armed = scrapArmed === x.id;
      row.append(btn(armed ? `Sure? +◆${val}` : `Scrap ◆${val}`, () => {
        if (!armed) { scrapArmed = x.id; render(); return; }
        scrapArmed = null;
        if (!takeFrom(st.stash, x.id)) return;
        o.bankScrap!(val);
        hideTip();
        say(`Scrapped ${itemName(x)} for ${val} scrap (banked).`);
        changed();
      }, "small" + (armed ? " danger" : "")));
    }
    if (mode === "stash") row.append(btn("→ cargo", () => { if (moveItem(st.stash, st.cargo, x.id, sizing())) changed(); else say(`No room in the cargo for ${itemName(x)}.`); }, "small"));
    if (mode === "bayCargo") row.append(btn("→ stash", () => { moveItem(st.cargo, st.stash, x.id); changed(); }, "small"));
    hoverable(row, x, true);
    return row;
  }

  function spaceBar(load: number, cap: number) {
    const lim = Number.isFinite(cap) && cap > 0, share = lim ? load / cap : 0;
    const warn = o.tuning.cargoWarn ?? 0.85;
    const box = el("div", "inv-space");
    const fill = el("div", "inv-spacefill " + (share > 1 + 1e-6 ? "over" : share >= warn ? "warn" : ""));
    fill.style.width = `${Math.min(100, share * 100)}%`;
    box.append(fill);
    const t = el("div", "inv-spacetext " + (share > 1 + 1e-6 ? "bad" : ""), lim ? `${load} / ${cap} cells${share > 1 + 1e-6 ? " · over capacity" : ""}` : `${load} cells · no limit`);
    return [box, t];
  }

  function cargoColumn() {
    const col = el("div", "inv-col");
    const cargo = el("section", "inv-sec"), stash = el("section", "inv-sec");
    col.append(cargo, stash);
    if (field()) {
      const e = o.exp!;
      cargo.append(el("h3", "", "Cargo · at risk"));
      cargo.append(...spaceBar(e.load, e.capacity));
      const scrap = e.scrapAtRisk;
      if (scrap > 0) {
        const row = el("div", "inv-item inv-scrap");
        row.append(el("span", "inv-name", `◆ ${Math.floor(scrap)} scrap`), el("span", "dim", `${scrapCells(e.sizing, scrap)} cells`));
        const n = Math.max(1, Math.round(scrap / 4));
        row.append(btn(`Dump ${n}`, () => { e.dumpScrap(n); render(); }, "small"), btn("Dump all", () => { e.dumpScrap(scrap); render(); }, "small"));
        cargo.append(row);
      }
      cargo.append(gridBox("cargo"), zone("sand", "Drop here to leave it on the sand"));
      cargo.append(el("p", "inv-note", "Lost if the mech is destroyed; banked when the crane or a pickup has you."));
      stash.append(el("h3", "", "Stash"), el("p", "inv-note", `On the convoy: ${st.stash.items.length} items. Bank the cargo to reach it.`));
    } else {
      const cap = capacity();
      const ch = el("div", "inv-row");
      ch.append(el("h3", "", "Cargo · goes out with the mech"), btn("Tidy", () => tidy("cargo"), "small"));
      cargo.append(ch);
      cargo.append(...spaceBar(bagCells(st.cargo, sizing()), cap));
      cargo.append(gridBox("cargo"));
      cargo.append(el("p", "inv-note", "Spare parts here ride out at the next launch, at risk. Right click an item to send it across."));
      const sh = el("div", "inv-row");
      sh.append(el("h3", "", `Stash · ${st.stash.items.length} items`), btn("Tidy", () => tidy("stash"), "small"));
      stash.append(sh, gridBox("stash"));
      if (o.bankScrap) stash.append(zone("bin", "Scrap bin: drop a stash item here twice to scrap it"));
    }
    // Wide enough for the two grids side by side: the cells' width tells the sheet (else the stash goes under the cargo).
    const v = gv();
    cargo.style.width = `${v.cargoCols * v.gridCellPx + 2}px`;
    stash.style.width = `${(field() ? Math.min(v.stashCols, 8) : v.stashCols) * v.gridCellPx + 2}px`;
    return col;
  }

  function render() {
    if (root.hidden) return;
    if (o.exp) o.exp.sizing = sizing();
    sig = signature();
    const head = el("div", "inv-head");
    head.append(el("strong", "", "Inventory"));
    const r = resolve(st.loadout, o.tuning);
    head.append(el("span", "dim", `${field() ? "In the field" : "On the convoy"} · cargo ${capacity()} cells · radar ${Math.round(r.values.mechRadar)} m`));
    const btns = el("div", "inv-row");
    if (o.openBay) btns.append(btn("Bay (B): sockets, loot", () => { close(); o.openBay!(); }, "small"));
    btns.append(btn("Close (I)", () => close(), "small"));
    head.append(btns);
    const bar = el("div", "inv-sort");
    const sortLabel = el("span", "dim", "Sort");
    sortLabel.title = "Tidy lays the grids out in this order; it also orders the list of what fits a slot";
    bar.append(sortLabel);
    for (const k of SORT_KEYS) bar.append(btn(SORT_NAMES[k] + (k === sortKey ? (sortUp ? " ▲" : " ▼") : ""), () => setSort(k), "small chip" + (k === sortKey ? " on" : "")));
    bar.append(btn("Tidy both", () => { tidy("cargo"); if (!field()) tidy("stash"); }, "small"));
    bar.append(el("span", "inv-gap"), el("span", "dim", "Show"));
    for (const [f, label] of FILTERS) bar.append(btn(label, () => { filter = f; render(); }, "small chip" + (f === filter ? " on" : "")));
    const kids: HTMLElement[] = [head, bar];
    if (message && messageT > 0) kids.push(el("div", "inv-msg", message));
    const body = el("div", "inv-body");
    const left = el("div", "inv-left");
    left.append(dollBox(), slotPanel());
    body.append(left, cargoColumn());
    kids.push(body);
    root.replaceChildren(...kids);
  }

  /** What the screen shows, cheaply, so a pick-up or a bank while it's open redraws it. */
  function signature() {
    const e = o.exp;
    const g = gv();
    return `${Object.values(g).join(",")}|${field()}|${e ? e.load.toFixed(2) + ":" + e.atRisk.length + ":" + Math.floor(e.scrapAtRisk) + ":" + e.capacity : ""}|${st.stash.items.length}|${st.cargo.items.length}|${SLOTS.map((s) => st.loadout[s]?.id ?? "").join()}`;
  }

  function open() { scrapArmed = null; o.onOpen?.(); root.hidden = false; render(); }
  function close() { root.hidden = true; hideTip(); }
  function toggle() { if (root.hidden) open(); else close(); }

  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "KeyI" && !e.repeat) toggle();
    if (e.code === "Escape" && !root.hidden) close();
  });

  return {
    root, open, close, toggle,
    get isOpen() { return !root.hidden; },
    /** Pick a slot (for headless shots and lab flags). */
    select(s: SlotId | null) { slot = s; render(); },
    /** Once a frame: redraw if what it shows changed underneath it; fades the message. */
    update(dt: number) {
      if (root.hidden) return;
      if (messageT > 0 && (messageT -= dt) <= 0) render();
      else if (signature() !== sig) render();
    },
    render,
  };
}
