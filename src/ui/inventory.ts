// The inventory (Keith 2026-11-01: "start working towards an inventory doll like what other ARPGs have... always press
// I to view your inventory... and that should also bring up your doll"). I (or a click on the HUD doll) opens it
// anywhere; I or Esc closes it; the game keeps running under it. Left: the mech doll, seen from behind, each slot a
// tile round the silhouette (hover: the item's card; click: pick the slot, and the lists light up what fits it).
// Right: the cargo with its weight against the mech's capacity, and the stash.
//
// Where things come from and go depends on where the mech is:
// - Out in the field the cargo is the expedition's at-risk list (src/expedition/expedition.ts). Items can be fitted
//   from it, what comes off goes into it (if it fits), and Drop lays an item on the sand as a crate (grabbed again by
//   walking back over it after leaving it); scrap can be dumped (gone). The stash is on the convoy, out of reach.
// - Aboard (or with no expedition: the loadout lab) the cargo is the bay's cargo list, which goes out with the mech at
//   the next launch; fitting takes from the stash and the cargo and puts what comes off in the stash, as the bay does.
// The bay screen (B) still does sockets, loot rolls and the side-by-side stat changes.
import "./inventory.css";
import { STATS } from "../items/bases";
import { PROTOCOL_BY_ID } from "../items/protocols";
import { RARITY, tierOf } from "../items/rarity";
import { levelOf } from "../items/level";
import { itemPower, dpsText, itemDps, versusFitted } from "../items/power";
import { itemWeight, type Item } from "../items/item";
import {
  SLOTS, SLOT_NAMES, copyLoadout, effectiveStats, fitProblem, isArm, isHullWeapon, isTwoHander, resolve, unfit,
  type LoadoutValues, type SlotId,
} from "../items/loadout";
import { fitWithHeld } from "../items/fitting";
import { bagWeight, moveItem, takeFrom } from "../items/cargo";
import { itemName, type BayState } from "../items/bayState";
import type { LootValues } from "../items/generate";
import type { Expedition } from "../expedition/expedition";
import { dollSvg, paintPart, DOLL_PARTS, type DollPart } from "./mechDoll";

export interface InventoryOptions {
  state: BayState;
  tuning: LootValues & LoadoutValues & { cargoWarn?: number };
  /** The expedition, where there is one: out in the field its at-risk list is the cargo. */
  exp?: Expedition | null;
  /** After anything changes (refit the mech, save). */
  onChange: () => void;
  /** Open the bay screen (sockets, loot rolls), where there is one. */
  openBay?: () => void;
  /** Called on opening (close the bay so they don't stack). */
  onOpen?: () => void;
}

/** Where each slot's tile sits on the doll (px in a 340 × 410 box) and its short label. */
const TILES: Record<SlotId, { x: number; y: number; label: string }> = {
  sensor: { x: 130, y: 0, label: "Sensor" },
  pack: { x: 252, y: 8, label: "Back · 3" },
  shoulderL: { x: 8, y: 8, label: "Shoulder · 1" },
  shoulderR: { x: 252, y: 70, label: "Shoulder · 2" },
  mountL: { x: 8, y: 128, label: "L mount · LMB" },
  mountR: { x: 252, y: 128, label: "R mount · RMB" },
  heldL: { x: 8, y: 204, label: "Left hand" },
  heldR: { x: 252, y: 204, label: "Right hand" },
  hull: { x: 130, y: 150, label: "Hull" },
  waistL: { x: 8, y: 280, label: "Waist L" },
  waistR: { x: 252, y: 280, label: "Waist R" },
  legs: { x: 130, y: 352, label: "Legs" },
};
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
const sortItems = (a: Item, b: Item) => tierOf(b.rarity) - tierOf(a.rarity) || a.kind.localeCompare(b.kind) || itemName(a).localeCompare(itemName(b));
const sum = (xs: readonly Item[]) => xs.reduce((w, i) => w + itemWeight(i), 0);

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

  const field = () => !!o.exp && o.exp.state === "out";
  /** Items on offer to fit: the at-risk items in the field, the stash and the bay's cargo aboard. */
  const pool = (): Item[] => (field() ? o.exp!.atRisk.flatMap((l) => (l.kind === "item" ? [l.item] : [])) : [...st.cargo.items, ...st.stash.items]);
  const capacity = () => resolve(st.loadout, o.tuning).cargoCapacity;
  const say = (t: string) => { message = t; messageT = 4; render(); };

  function changed() {
    st.cargo.capacity = capacity();
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
      const cap = e.capacity === Infinity ? Infinity : resolve(lo, o.tuning).cargoCapacity;
      const after = e.load - sum(r.used) + sum(r.off);
      if (after > cap + 1e-9) { say(`No room in the cargo for what comes off (${fmt(after, 1)} / ${fmt(cap, 1)} t). Drop something first.`); return; }
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
    if (field()) {
      const e = o.exp!, lo = copyLoadout(st.loadout), off = unfit(lo, s);
      const cap = e.capacity === Infinity ? Infinity : resolve(lo, o.tuning).cargoCapacity;
      if (e.load + sum(off) > cap + 1e-9) { say(`No room in the cargo for it (${fmt(e.load + sum(off), 1)} / ${fmt(cap, 1)} t).`); return; }
      e.capacity = cap;
      for (const x of unfit(st.loadout, s)) e.stow(x, itemName(x));
    } else for (const x of unfit(st.loadout, s)) st.stash.items.push(x);
    hideTip();
    changed();
  }

  /** Click on an item in a list: into the picked slot if it fits there, else the first slot it fits. */
  function equip(it: Item) {
    if (slot && !fitProblem(st.loadout, slot, it)) { fitInto(slot, it); return; }
    const s = SLOTS.find((q) => !st.loadout[q] && !fitProblem(st.loadout, q, it)) ?? SLOTS.find((q) => !fitProblem(st.loadout, q, it));
    if (s) fitInto(s, it); else say(it.kind === "protocol" ? "Protocols go in sockets: open the bay (B)." : `${itemName(it)} doesn't fit anywhere on this mech.`);
  }

  // ---- the item card (hover) ----

  function cardHtml(it: Item, compare: boolean): string {
    const col = RARITY[it.rarity].color;
    const size = it.kind !== "weapon" ? it.kind : it.size === "M" ? "hull weapon" : it.size === "H" ? "held, two-handed" : "held weapon";
    const dps = dpsText(it);
    let h = `<div class="inv-tipname" style="color:${col}">${itemName(it)}</div>`
      + `<div class="inv-tipsub" style="color:${col}">${RARITY[it.rarity].name.toUpperCase()} · LEVEL ${levelOf(it)}</div>`
      + `<div class="dim">${size} · ${it.maker} · ${fmt(itemWeight(it), 1)} t</div>`
      + `<div>Power ${itemPower(it)}${dps ? ` · ${dps}` : ""}</div>`;
    if (it.kind === "protocol") h += `<div class="dim">${PROTOCOL_BY_ID[it.base]?.text ?? ""}</div>`;
    const eff = effectiveStats(it);
    for (const k in it.stats) {
      const info = STATS[k];
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

  // ---- pieces ----

  function dollBox() {
    const box = el("div", "inv-doll");
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
      const noHand = (s === "heldL" && !isArm(lo.mountL)) || (s === "heldR" && !isArm(lo.mountR));
      const tile = el("div", "inv-tile" + (s === slot ? " on" : "") + (it ? "" : " empty") + (noHand && !it ? " off" : ""));
      tile.style.left = `${t.x}px`; tile.style.top = `${t.y}px`;
      if (it) tile.style.borderColor = RARITY[it.rarity].color;
      const kind = s === "mountL" || s === "mountR" ? (isArm(it) ? "Arm" : isHullWeapon(it) ? "Hull weapon" : "") : "";
      tile.append(el("span", "inv-tilelabel", t.label));
      const name = el("span", "inv-tilename", heldBy2 ? "(two-hander)" : it ? itemName(it) : noHand ? "needs an arm" : "empty");
      if (it) name.style.color = RARITY[it.rarity].color;
      tile.append(name);
      if (it) tile.append(el("span", "inv-tilemeta", `${kind ? kind + " · " : ""}Lv ${levelOf(it)} · P ${itemPower(it)}`));
      tile.addEventListener("click", () => { slot = slot === s ? null : s; render(); });
      if (it) hoverable(tile, it, false);
      box.append(tile);
    }
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
    const fits = pool().filter((x) => x.kind !== "protocol" && !fitProblem(st.loadout, slot!, x)).sort(sortItems);
    if (!fits.length) col.append(el("p", "inv-note", field() ? "Nothing in the cargo fits here." : "Nothing in the stash or cargo fits here."));
    const list = el("div", "inv-list");
    for (const x of fits) list.append(itemRow(x, "fit"));
    col.append(list);
    return col;
  }

  function itemRow(x: Item, mode: "fit" | "cargo" | "stash" | "bayCargo") {
    const row = el("div", "inv-item" + (slot && !fitProblem(st.loadout, slot, x) ? " fits" : ""));
    row.style.borderLeftColor = RARITY[x.rarity].color;
    const name = el("span", "inv-name", itemName(x));
    name.style.color = RARITY[x.rarity].color;
    row.append(name, el("span", "dim", `Lv ${levelOf(x)} · ${fmt(itemWeight(x), 1)} t`));
    row.addEventListener("click", () => equip(x));
    if (mode === "cargo") row.append(btn("Drop", () => { hideTip(); if (o.exp!.dropItem(x.id)) render(); }, "small"));
    if (mode === "stash") row.append(btn("→ cargo", () => { if (moveItem(st.stash, st.cargo, x.id)) changed(); else say(`No room in the cargo for ${itemName(x)}.`); }, "small"));
    if (mode === "bayCargo") row.append(btn("→ stash", () => { moveItem(st.cargo, st.stash, x.id); changed(); }, "small"));
    hoverable(row, x, true);
    return row;
  }

  function weightBar(load: number, cap: number) {
    const lim = Number.isFinite(cap) && cap > 0, share = lim ? load / cap : 0;
    const warn = o.tuning.cargoWarn ?? 0.85;
    const box = el("div", "inv-weight");
    const fill = el("div", "inv-weightfill " + (share > 1 + 1e-6 ? "over" : share >= warn ? "warn" : ""));
    fill.style.width = `${Math.min(100, share * 100)}%`;
    box.append(fill);
    const t = el("div", "inv-weighttext " + (share > 1 + 1e-6 ? "bad" : ""), lim ? `${fmt(load, 1)} / ${fmt(cap, 1)} t${share > 1 + 1e-6 ? " · over capacity" : ""}` : `${fmt(load, 1)} t · no limit`);
    return [box, t];
  }

  function cargoColumn() {
    const col = el("div", "inv-col");
    if (field()) {
      const e = o.exp!;
      col.append(el("h3", "", "Cargo · at risk"));
      col.append(...weightBar(e.load, e.capacity));
      col.append(el("p", "inv-note", "Lost if the mech is destroyed; banked when the crane or a pickup has you."));
      const scrap = e.scrapAtRisk;
      if (scrap > 0) {
        const row = el("div", "inv-item inv-scrap");
        row.append(el("span", "inv-name", `◆ ${Math.floor(scrap)} scrap`), el("span", "dim", `${fmt(scrap * e.scrapWeight, 1)} t`));
        const n = Math.max(1, Math.round(scrap / 4));
        row.append(btn(`Dump ${n}`, () => { e.dumpScrap(n); render(); }, "small"), btn("Dump all", () => { e.dumpScrap(scrap); render(); }, "small"));
        col.append(row);
      }
      const items = pool().sort(sortItems);
      if (!items.length && scrap <= 0) col.append(el("p", "inv-note", "Empty."));
      const list = el("div", "inv-list");
      for (const x of items) list.append(itemRow(x, "cargo"));
      col.append(list);
      col.append(el("h3", "", "Stash"), el("p", "inv-note", `On the convoy: ${st.stash.items.length} items. Bank the cargo to reach it.`));
    } else {
      const cap = capacity();
      col.append(el("h3", "", "Cargo · goes out with the mech"));
      col.append(...weightBar(bagWeight(st.cargo), cap));
      const list = el("div", "inv-list");
      if (!st.cargo.items.length) list.append(el("p", "inv-note", "Empty. Spare parts sent here ride out at the next launch (at risk)."));
      for (const x of [...st.cargo.items].sort(sortItems)) list.append(itemRow(x, "bayCargo"));
      col.append(list);
      col.append(el("h3", "", `Stash · ${st.stash.items.length}`));
      const sl = el("div", "inv-list");
      if (!st.stash.items.length) sl.append(el("p", "inv-note", "Empty."));
      for (const x of [...st.stash.items].sort(sortItems)) sl.append(itemRow(x, "stash"));
      col.append(sl);
    }
    return col;
  }

  function render() {
    if (root.hidden) return;
    sig = signature();
    const head = el("div", "inv-head");
    head.append(el("strong", "", "Inventory"));
    const r = resolve(st.loadout, o.tuning);
    head.append(el("span", "dim", `${field() ? "In the field" : "On the convoy"} · fitted ${fmt(r.weight, 1)} t · cargo up to ${fmt(r.cargoCapacity, 1)} t · radar ${Math.round(r.values.mechRadar)} m`));
    const btns = el("div", "inv-row");
    if (o.openBay) btns.append(btn("Bay (B): sockets, loot", () => { close(); o.openBay!(); }, "small"));
    btns.append(btn("Close (I)", () => close(), "small"));
    head.append(btns);
    const kids: HTMLElement[] = [head];
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
    return `${field()}|${e ? e.load.toFixed(2) + ":" + e.atRisk.length + ":" + Math.floor(e.scrapAtRisk) + ":" + e.capacity : ""}|${st.stash.items.length}|${st.cargo.items.length}|${SLOTS.map((s) => st.loadout[s]?.id ?? "").join()}`;
  }

  function open() { o.onOpen?.(); root.hidden = false; render(); }
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
