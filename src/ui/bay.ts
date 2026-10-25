// The bay screen (docs/proposal-loadout.md): plain DOM over the canvas in the lab's house style. The slots down the
// left (with what's fitted, in its rarity colour); the selected slot's item card with its Protocol sockets; the
// stash and cargo items that fit that slot, where hovering one shows what changes against what's fitted and a click
// fits it (what comes off goes to the stash); cargo and stash lists with their weights; loot rolls to fill the stash.
// Lists for now (Keith 2026-10-25: a grid inventory is the long-term goal). B or the Bay button opens and closes it.
import "./bay.css";
import { BASE_BY_ID, STATS } from "../items/bases";
import { PROTOCOL_BY_ID } from "../items/protocols";
import { RARITY, RARITIES, tierOf, type Rarity } from "../items/rarity";
import { itemWeight, type Item } from "../items/item";
import { rollItem, rollLoot, rollProtocol, type LootValues } from "../items/generate";
import {
  SLOTS, SLOT_NAMES, fit, fitProblem, unfit, settle, resolve, summary, copyLoadout, effectiveStats, socket, socketProblem, unsocket, defaultLoadout,
  type Loadout, type SlotId, type LoadoutValues, type SummaryLine,
} from "../items/loadout";
import { bagWeight, loseCargo, moveItem, takeFrom, type Bag } from "../items/cargo";

export interface BayState {
  loadout: Loadout;
  stash: Bag;
  cargo: Bag;
  /** Next loot seed. */
  seed: number;
}

export interface BayOptions {
  state: BayState;
  tuning: LootValues & LoadoutValues;
  /** After anything changes (refit the mech, save). */
  onChange: () => void;
}

const KIND_FOR: Record<SlotId, string> = { legs: "legs", hull: "hull", armL: "arm or Medium weapon", armR: "arm or Medium weapon", handL: "Light or Heavy weapon", handR: "Light or Heavy weapon", pack: "power pack", back: "back item" };

export function itemName(it: Item) {
  if (it.kind === "protocol") return PROTOCOL_BY_ID[it.base]?.name ?? it.base;
  return BASE_BY_ID[it.base]?.name ?? it.base;
}

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

export function bayScreen(o: BayOptions) {
  const st = o.state;
  const root = el("div", "bay");
  root.hidden = true;
  document.body.appendChild(root);
  let slot: SlotId = "armR";
  let hover: Item | null = null;

  const changed = () => { st.cargo.capacity = resolve(st.loadout, o.tuning).cargoCapacity; o.onChange(); render(); };
  const bagOf = (it: Item) => (st.cargo.items.includes(it) ? st.cargo : st.stash);
  const toStash = (items: Item[]) => { for (const i of items) st.stash.items.push(i); };

  function fitItem(it: Item) {
    if (fitProblem(st.loadout, slot, it)) return;
    takeFrom(bagOf(it), it.id);
    toStash(fit(st.loadout, slot, it));
    hover = null;
    // An arm on its own holds nothing (Keith 2026-10-25: swapping the minigun for an arm left an empty mount): put the
    // best hand weapon from stash or cargo in that hand, or go to the hand slot so the next pick is obvious.
    if ((slot === "armL" || slot === "armR") && it.kind === "arm") {
      const hand: SlotId = slot === "armL" ? "handL" : "handR";
      if (!st.loadout[hand]) {
        const order = ["legendary", "epic", "rare", "uncommon", "common"];
        const cands = [...st.cargo.items, ...st.stash.items].filter((c) => !fitProblem(st.loadout, hand, c))
          .sort((p, q) => order.indexOf(p.rarity) - order.indexOf(q.rarity));
        if (cands[0]) { takeFrom(bagOf(cands[0]), cands[0].id); toStash(fit(st.loadout, hand, cands[0])); }
        else slot = hand;
      }
    }
    changed();
  }

  function refitDefault() {
    const lo = st.loadout;
    for (const s of SLOTS) { if (lo[s]) st.stash.items.push(lo[s]!); lo[s] = null; }
    const want = defaultLoadout();
    for (const s of SLOTS) {
      const d = want[s];
      if (!d) continue;
      // Take the default part back out of the stash if it's there (one of each, by id).
      const have = takeFrom(st.stash, d.id) ?? takeFrom(st.cargo, d.id) ?? d;
      lo[s] = have;
    }
    changed();
  }

  function roll(rarity?: Rarity, n = 1) {
    for (let i = 0; i < n; i++) st.stash.items.push(rarity ? rollItem(st.seed++, o.tuning, { rarity }) : rollLoot(st.seed++, o.tuning));
    changed();
  }

  // ---- pieces ----

  function nameEl(it: Item | null, empty = "empty") {
    const s = el("span", "bay-name", it ? itemName(it) : empty);
    if (it) s.style.color = RARITY[it.rarity].color; else s.classList.add("dim");
    return s;
  }

  function slotsColumn() {
    const col = el("div", "bay-col bay-slots");
    col.append(el("h3", "", "Slots"));
    for (const s of SLOTS) {
      const it = st.loadout[s];
      const held = s === "handL" && st.loadout.handR?.size === "H";
      const row = el("div", "bay-slot" + (s === slot ? " on" : ""));
      row.append(el("span", "bay-slotname", SLOT_NAMES[s]), held ? nameEl(null, "held by the two-hander") : nameEl(it));
      row.addEventListener("click", () => { slot = s; hover = null; render(); });
      col.append(row);
    }
    const r = resolve(st.loadout, o.tuning);
    col.append(el("p", "bay-note", `Fitted ${fmt(r.weight, 1)} t · cargo up to ${fmt(r.cargoCapacity, 1)} t`));
    return col;
  }

  function statLines(it: Item, into: HTMLElement) {
    const eff = effectiveStats(it);
    for (const k in it.stats) {
      const info = STATS[k];
      const row = el("div", "bay-stat");
      row.append(el("span", "", info?.label ?? k));
      const base = it.stats[k], now = eff[k];
      const val = el("span", "bay-val", fmt(base, info?.decimals ?? 2));
      if (Math.abs(now - base) > 1e-9) {
        const up = (now > base) === ((info?.better ?? 1) > 0);
        val.append(el("b", up ? "good" : "bad", ` → ${fmt(now, info?.decimals ?? 2)}`));
      }
      row.append(val);
      into.append(row);
    }
  }

  function card(it: Item) {
    const c = el("div", "bay-card");
    c.style.borderColor = RARITY[it.rarity].color;
    const head = el("div", "bay-cardhead");
    head.append(nameEl(it), el("span", "dim", `${RARITY[it.rarity].name}${it.size ? ` · size ${it.size}` : ""} · ${it.maker} · ${fmt(itemWeight(it), 1)} t`));
    c.append(head);
    statLines(it, c);
    // Protocol sockets: a socketed one with a Remove button, an empty one with a pick-a-Protocol control.
    if (it.sockets > 0) {
      const sockets = el("div", "bay-sockets");
      sockets.append(el("div", "bay-sub", `Protocol sockets (${it.socketed.length}/${it.sockets})`));
      for (let i = 0; i < it.sockets; i++) {
        const row = el("div", "bay-socket");
        const p = it.socketed[i];
        if (p) {
          const def = PROTOCOL_BY_ID[p.base];
          row.append(el("span", "bay-proto", "◆ " + (def?.name ?? p.base)), el("span", "dim", def?.text ?? ""));
          row.append(btn("Remove", () => { const q = unsocket(it, i); if (q) st.stash.items.push(q); changed(); }));
        } else {
          const sel = el("select");
          sel.append(new Option("◇ Empty socket: pick a Protocol", ""));
          const protos = [...st.stash.items, ...st.cargo.items].filter((x) => x.kind === "protocol");
          for (const q of protos) {
            const why = socketProblem(it, q);
            const def = PROTOCOL_BY_ID[q.base];
            const opt = new Option(`${def?.name ?? q.base}: ${def?.text ?? ""}${why ? ` (${why})` : ""}`, q.id);
            opt.disabled = !!why;
            sel.append(opt);
          }
          if (!protos.length) sel.disabled = true;
          sel.addEventListener("change", () => {
            const q = protos.find((x) => x.id === sel.value);
            if (!q || socketProblem(it, q)) return;
            takeFrom(bagOf(q), q.id);
            socket(it, q);
            changed();
          });
          row.append(sel);
        }
        sockets.append(row);
      }
      c.append(sockets);
    } else c.append(el("p", "bay-note", "No Protocol sockets (Common)."));
    return c;
  }

  function deltas(): HTMLElement {
    const box = el("div", "bay-deltas");
    if (!hover) { box.append(el("p", "bay-note", "Hover an item to see what it changes; click to fit it.")); return box; }
    const now = summary(resolve(st.loadout, o.tuning));
    const lo = copyLoadout(st.loadout);
    try { fit(lo, slot, hover); } catch { return box; }
    const then = summary(resolve(lo, o.tuning));
    box.append(el("div", "bay-sub", `Fitting ${itemName(hover)}`));
    let any = false;
    then.forEach((t: SummaryLine, i) => {
      const n = now[i];
      if (n.value === t.value || (n.value !== null && t.value !== null && Math.abs(n.value - t.value) < 10 ** -(t.decimals + 1))) return;
      any = true;
      const row = el("div", "bay-stat");
      row.append(el("span", "", t.label));
      let cls = "", text: string;
      if (t.value === null) { text = "gone"; cls = "bad"; }
      else if (n.value === null) { text = `new ${fmt(t.value, t.decimals)}`; cls = "good"; }
      else {
        const d = t.value - n.value;
        cls = (d > 0) === (t.better > 0) ? "good" : "bad";
        text = `${fmt(n.value, t.decimals)} → ${fmt(t.value, t.decimals)} (${d > 0 ? "+" : ""}${fmt(d, t.decimals)})`;
      }
      row.append(el("b", "bay-val " + cls, text));
      box.append(row);
    });
    if (!any) box.append(el("p", "bay-note", "No change."));
    return box;
  }

  function middleColumn() {
    const col = el("div", "bay-col bay-mid");
    col.append(el("h3", "", SLOT_NAMES[slot]));
    const it = slot === "handL" && st.loadout.handR?.size === "H" ? st.loadout.handR : st.loadout[slot];
    if (it) {
      col.append(card(it));
      if (slot !== "legs" && slot !== "hull") col.append(btn("Take off (to stash)", () => { toStash(unfit(st.loadout, slot)); changed(); }));
    } else col.append(el("p", "bay-note", `Empty. Takes: ${KIND_FOR[slot]}.`));

    col.append(el("h3", "", "Fits here (stash and cargo)"));
    const pool = [...st.stash.items, ...st.cargo.items].filter((x) => x.kind !== "protocol").sort(sortItems);
    const fits = pool.filter((x) => !fitProblem(st.loadout, slot, x));
    const near = pool.filter((x) => fitProblem(st.loadout, slot, x) && kindMatches(slot, x));
    const list = el("div", "bay-list");
    if (!fits.length && !near.length) list.append(el("p", "bay-note", "Nothing in stash or cargo fits. Roll some loot."));
    for (const x of fits) {
      const row = itemRow(x);
      row.classList.add("fit");
      row.addEventListener("mouseenter", () => { hover = x; refreshDeltas(); });
      row.addEventListener("mouseleave", () => { if (hover === x) { hover = null; refreshDeltas(); } });
      row.addEventListener("click", () => fitItem(x));
      list.append(row);
    }
    for (const x of near) {
      const row = itemRow(x);
      row.classList.add("nofit");
      row.title = fitProblem(st.loadout, slot, x) ?? "";
      row.append(el("span", "dim", row.title));
      list.append(row);
    }
    col.append(list);
    return col;
  }

  function kindMatches(s: SlotId, x: Item) {
    if (s === "armL" || s === "armR") return x.kind === "arm" || x.kind === "weapon";
    if (s === "handL" || s === "handR") return x.kind === "weapon";
    return x.kind === s;
  }

  function itemRow(x: Item) {
    const row = el("div", "bay-item");
    row.append(nameEl(x));
    const where = st.cargo.items.includes(x) ? "cargo" : "stash";
    const def = x.kind === "protocol" ? PROTOCOL_BY_ID[x.base] : null;
    row.append(el("span", "dim", `${def ? "Protocol · " + def.text : x.kind + (x.size ? " " + x.size : "")}${x.socketed.length ? ` · ${x.socketed.length}◆` : ""} · ${fmt(itemWeight(x), 1)} t · ${where}`));
    return row;
  }

  function bagColumn() {
    const col = el("div", "bay-col bay-bags");
    col.append(el("div", "bay-deltawrap"));
    for (const [name, bag, other] of [["Cargo", st.cargo, st.stash], ["Stash", st.stash, st.cargo]] as const) {
      const w = bagWeight(bag);
      const h = el("h3", "", `${name} · ${bag.items.length} · ${fmt(w, 1)}${Number.isFinite(bag.capacity) ? ` / ${fmt(bag.capacity, 1)}` : ""} t`);
      if (w > bag.capacity + 1e-9) h.classList.add("bad");
      col.append(h);
      const list = el("div", "bay-list bay-bag");
      if (!bag.items.length) list.append(el("p", "bay-note", name === "Cargo" ? "Empty. Cargo rides on the mech and is lost if it's destroyed." : "Empty."));
      for (const x of [...bag.items].sort(sortItems)) {
        const row = itemRow(x);
        row.append(btn(name === "Cargo" ? "→ stash" : "→ cargo", () => { if (moveItem(bag, other, x.id)) changed(); else flash(row); }, "small"));
        list.append(row);
      }
      col.append(list);
    }
    return col;
  }

  function flash(row: HTMLElement) { row.classList.add("refused"); setTimeout(() => row.classList.remove("refused"), 400); }

  function refreshDeltas() {
    const wrap = root.querySelector(".bay-deltawrap");
    if (!wrap) return;
    wrap.replaceChildren(el("h3", "", "Changes"), deltas());
  }

  function render() {
    if (root.hidden) return;
    const head = el("div", "bay-head");
    head.append(el("strong", "", "Bay"));
    const rolls = el("div", "row");
    rolls.append(el("span", "dim", "Roll loot:"));
    for (const r of RARITIES) { const b = btn(RARITY[r].name, () => roll(r), "small"); b.style.color = RARITY[r].color; rolls.append(b); }
    rolls.append(
      btn("Roll 10 random", () => roll(undefined, 10), "small"),
      btn("Roll a Protocol", () => { st.stash.items.push(rollProtocol(st.seed++)); changed(); }, "small"),
      btn("Lose cargo", () => { loseCargo(st.cargo); changed(); }, "small"),
      btn("Default mech", refitDefault, "small"),
      btn("Clear stash", () => { st.stash.items = []; changed(); }, "small"),
      btn("Close (B)", () => close(), "small"),
    );
    head.append(rolls);
    const body = el("div", "bay-body");
    body.append(slotsColumn(), middleColumn(), bagColumn());
    root.replaceChildren(head, body);
    refreshDeltas();
  }

  function open() { root.hidden = false; render(); }
  function close() { root.hidden = true; hover = null; }

  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "KeyB" && !e.repeat) { if (root.hidden) open(); else close(); }
    if (e.code === "Escape" && !root.hidden) close();
  });

  return {
    root,
    open, close,
    get isOpen() { return !root.hidden; },
    /** Pick a slot (and optionally preview an item from the fitting list by its index, for headless shots). */
    select(s: SlotId, previewIndex = -1) {
      slot = s;
      const pool = [...st.stash.items, ...st.cargo.items].filter((x) => x.kind !== "protocol").sort(sortItems).filter((x) => !fitProblem(st.loadout, s, x));
      hover = previewIndex >= 0 ? pool[previewIndex] ?? null : null;
      render();
    },
    render,
  };
}

/** A loadout, stash and cargo as JSON for localStorage (items are plain data). */
export function saveBay(key: string, st: BayState) {
  try { localStorage.setItem(key, JSON.stringify({ v: 1, loadout: st.loadout, stash: st.stash.items, cargo: st.cargo.items, seed: st.seed })); } catch { /* storage blocked */ }
}

/** The saved bay, or null if there's none or it doesn't read back (unknown bases are dropped). */
export function loadBay(key: string): BayState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (!raw || raw.v !== 1) return null;
    const known = (i: Item) => !!i && (i.kind === "protocol" ? !!PROTOCOL_BY_ID[i.base] : !!BASE_BY_ID[i.base]) && Array.isArray(i.socketed);
    const lo = defaultLoadout();
    for (const s of SLOTS) lo[s] = raw.loadout?.[s] && known(raw.loadout[s]) ? raw.loadout[s] : s === "legs" || s === "hull" ? lo[s] : null;
    const stash = { items: (raw.stash ?? []).filter(known), capacity: Infinity };
    const cargo = { items: (raw.cargo ?? []).filter(known), capacity: Infinity };
    // Anything saved that no longer fits (rules changed since) goes to the stash.
    stash.items.push(...settle(lo));
    return { loadout: lo, stash, cargo, seed: Number(raw.seed) || 1 };
  } catch { return null; }
}

