// The bay screen (docs/proposal-loadout.md): plain DOM over the canvas in the lab's house style. The slots down the
// left, grouped by mount (Keith 2026-10-26): the frame (legs, hull, sensor); each hull mount as a choice, a hull
// weapon or an arm, and with an arm its held weapon and shoulder weapon under it; the pack mount; the waist mounts.
// The selected slot's item card with its Protocol sockets; the stash and cargo items that fit that slot, where
// hovering one shows what changes against what's fitted and a click fits it (what comes off goes to the stash); cargo
// and stash lists with their weights; loot rolls to fill the stash. Lists for now (Keith 2026-10-25: a grid inventory
// is the long-term goal). B or the Bay button opens and closes it.
import "./bay.css";
import { STATS, type MountSide } from "../items/bases";
import { PROTOCOL_BY_ID } from "../items/protocols";
import { RARITY, RARITIES, tierOf, type Rarity } from "../items/rarity";
import { itemWeight, type Item } from "../items/item";
import { rollItem, rollLoot, rollProtocol, type LootValues } from "../items/generate";
import {
  SLOTS, SLOT_NAMES, MOUNTS, SIDES, fit, fitProblem, unfit, resolve, summary, copyLoadout, effectiveStats, socket, socketProblem,
  unsocket, defaultLoadout, bestHeld, hullMount, isTwoHander, isArm, isHullWeapon,
  type SlotId, type LoadoutValues, type SummaryLine,
} from "../items/loadout";
import { bagWeight, loseCargo, moveItem, takeFrom } from "../items/cargo";
import { bayToJson, itemName, readBay, type BayState } from "../items/bayState";
export { itemName, type BayState };

export interface BayOptions {
  state: BayState;
  tuning: LootValues & LoadoutValues;
  /** After anything changes (refit the mech, save). */
  onChange: () => void;
}

/** On a hull mount slot, which of its two choices the list shows. */
type MountChoice = "hullWeapon" | "arm";

const KIND_FOR: Record<SlotId, string> = {
  legs: "legs", hull: "hull", sensor: "a sensor (radar range, seekers)",
  mountL: "a hull weapon or an arm", mountR: "a hull weapon or an arm",
  heldL: "a held weapon (Light; a Heavy two-hander takes both arms)", heldR: "a held weapon (Light; a Heavy two-hander takes both arms)",
  shoulderL: "a shoulder weapon", shoulderR: "a shoulder weapon",
  pack: "a power pack, or a shoulder weapon as a back weapon", waistL: "ammo drum, cargo rack or kit", waistR: "ammo drum, cargo rack or kit",
};
const SEEKER_NAMES: Record<string, string> = { scrap: "Scrap", wreck: "Wrecks", rare: "Rare", legendary: "Legendary" };

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
const isMountSlot = (s: SlotId) => s === "mountL" || s === "mountR";
const choiceOf = (x: Item): MountChoice | null => (isArm(x) ? "arm" : isHullWeapon(x) ? "hullWeapon" : null);

export function bayScreen(o: BayOptions) {
  const st = o.state;
  const root = el("div", "bay");
  root.hidden = true;
  document.body.appendChild(root);
  let slot: SlotId = "mountR";
  let choice: MountChoice | null = null;
  let hover: Item | null = null;

  const changed = () => { st.cargo.capacity = resolve(st.loadout, o.tuning).cargoCapacity; o.onChange(); render(); };
  const bagOf = (it: Item) => (st.cargo.items.includes(it) ? st.cargo : st.stash);
  const toStash = (items: Item[]) => { for (const i of items) st.stash.items.push(i); };
  const pool = () => [...st.cargo.items, ...st.stash.items];

  function pickSlot(s: SlotId, c: MountChoice | null = null) {
    slot = s; hover = null;
    choice = isMountSlot(s) ? c ?? choiceOf(st.loadout[s]!) ?? "hullWeapon" : null;
    render();
  }

  function fitItem(it: Item) {
    if (fitProblem(st.loadout, slot, it)) return;
    takeFrom(bagOf(it), it.id);
    toStash(fit(st.loadout, slot, it));
    hover = null;
    // An arm on its own holds nothing (Keith 2026-10-25: swapping the minigun for an arm left an empty mount): put the
    // best held weapon from stash or cargo in its hand, or go to the held slot so the next pick is obvious.
    if (isMountSlot(slot) && it.kind === "arm") {
      const side: MountSide = slot === "mountL" ? "L" : "R";
      const best = bestHeld(st.loadout, side, pool());
      if (best) { takeFrom(bagOf(best), best.id); toStash(fit(st.loadout, MOUNTS[side].held, best)); }
      else if (!st.loadout[MOUNTS[side].held]) { slot = MOUNTS[side].held; choice = null; }
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
      lo[s] = takeFrom(st.stash, d.id) ?? takeFrom(st.cargo, d.id) ?? d;
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

  function slotRow(s: SlotId, sub = false, label = SLOT_NAMES[s]) {
    const it = st.loadout[s];
    const held = s === "heldL" && isTwoHander(st.loadout.heldR);
    const row = el("div", "bay-slot" + (s === slot ? " on" : "") + (sub ? " sub" : ""));
    row.append(el("span", "bay-slotname", label), held ? nameEl(null, "held by the two-hander") : nameEl(it));
    row.addEventListener("click", () => pickSlot(s));
    return row;
  }

  /** A hull mount as a choice: hull weapon (military) or arm (held weapon + shoulder weapon), then its slots. */
  function mountBlock(side: MountSide) {
    const m = MOUNTS[side], lo = st.loadout, it = lo[m.mount];
    const box = el("div", "bay-mount");
    const hm = hullMount(lo, side);
    const head = el("div", "bay-mounthead");
    head.append(el("span", "bay-slotname", side === "L" ? "Left hull mount · LMB" : "Right hull mount · RMB"));
    if (!hm) { box.append(head, el("p", "bay-note", "The hull has no mount here.")); return box; }
    const chips = el("div", "bay-chips");
    for (const [c, label] of [["hullWeapon", "Hull weapon"], ["arm", "Arm"]] as const) {
      const on = choiceOf(it!) === c, picking = slot === m.mount && choice === c;
      const b = btn(label, () => pickSlot(m.mount, c), "chip" + (on ? " on" : "") + (picking ? " picking" : ""));
      if (!hm.takes.includes(c)) { b.disabled = true; b.title = "this hull mount doesn't take one"; }
      chips.append(b);
    }
    head.append(chips);
    box.append(head);
    const row = slotRow(m.mount, false, isArm(it) ? "Arm" : isHullWeapon(it) ? "Hull weapon (the whole mount)" : "Empty mount");
    box.append(row);
    if (isArm(it)) box.append(slotRow(m.held, true, "Held weapon"), slotRow(m.shoulder, true, `Shoulder weapon · key ${m.key}`));
    return box;
  }

  function slotsColumn() {
    const col = el("div", "bay-col bay-slots");
    col.append(el("h3", "", "Frame"), slotRow("legs"), slotRow("hull"), slotRow("sensor"));
    col.append(el("h3", "", "Hull mounts"));
    for (const s of SIDES) col.append(mountBlock(s));
    col.append(el("h3", "", "Back and waist"), slotRow("pack"), slotRow("waistL"), slotRow("waistR"));
    const r = resolve(st.loadout, o.tuning);
    col.append(el("p", "bay-note", `Fitted ${fmt(r.weight, 1)} t · cargo up to ${fmt(r.cargoCapacity, 1)} t · radar ${Math.round(r.values.mechRadar)} m · salvage ×${fmt(r.values.gearSalvage, 2)}`));
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
    if (it.seekers) {
      const row = el("div", "bay-stat");
      row.append(el("span", "", "Seekers"), el("span", "bay-val", it.seekers.map((s) => SEEKER_NAMES[s] ?? s).join(", ") || "none"));
      into.append(row);
    }
  }

  const sizeLabel = (it: Item) => (it.kind !== "weapon" ? "" : it.size === "M" ? " · hull weapon" : it.size === "H" ? " · held, two-handed" : " · held");

  function card(it: Item) {
    const c = el("div", "bay-card");
    c.style.borderColor = RARITY[it.rarity].color;
    const head = el("div", "bay-cardhead");
    head.append(nameEl(it), el("span", "dim", `${RARITY[it.rarity].name}${sizeLabel(it)} · ${it.maker} · ${fmt(itemWeight(it), 1)} t`));
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
    let off: Item[] = [];
    try { off = fit(lo, slot, hover); } catch { return box; }
    // An arm brings its auto-fitted held weapon (as fitItem does).
    let held: Item | null = null;
    if (isMountSlot(slot) && hover.kind === "arm") {
      const side: MountSide = slot === "mountL" ? "L" : "R";
      held = bestHeld(lo, side, pool().filter((x) => x !== hover));
      if (held) off.push(...fit(lo, MOUNTS[side].held, held));
    }
    const then = summary(resolve(lo, o.tuning));
    box.append(el("div", "bay-sub", `Fitting ${itemName(hover)}${held ? ` (holding ${itemName(held)})` : ""}`));
    // What the fit bounces to the stash (the slot's item, and a side's held and shoulder weapons under a hull weapon).
    if (off.length) box.append(el("p", "bay-note bad", `Comes off to the stash: ${off.map(itemName).join(", ")}`));
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

  /** The items the list offers for the selected slot (on a hull mount, only the chosen kind). */
  function offered(s: SlotId, c: MountChoice | null) {
    const all = [...st.stash.items, ...st.cargo.items].filter((x) => x.kind !== "protocol").sort(sortItems);
    const want = (x: Item) => kindMatches(s, x) && (!c || !isMountSlot(s) || choiceOf(x) === c);
    return { fits: all.filter((x) => want(x) && !fitProblem(st.loadout, s, x)), near: all.filter((x) => want(x) && fitProblem(st.loadout, s, x)) };
  }

  function middleColumn() {
    const col = el("div", "bay-col bay-mid");
    col.append(el("h3", "", SLOT_NAMES[slot]));
    const it = slot === "heldL" && isTwoHander(st.loadout.heldR) ? st.loadout.heldR : st.loadout[slot];
    if (it) {
      col.append(card(it));
      if (slot !== "legs" && slot !== "hull") col.append(btn("Take off (to stash)", () => { toStash(unfit(st.loadout, slot)); changed(); }));
    } else col.append(el("p", "bay-note", `Empty. Takes ${KIND_FOR[slot]}.`));

    if (isMountSlot(slot)) {
      const note = choice === "arm"
        ? "Arms: hold a weapon (smaller than a hull weapon, but it swings quicker and wider) and carry a shoulder weapon; hands strip salvage faster. Fitting one takes the hull weapon off."
        : "Hull weapons: one big military gun on the whole mount. Fitting one takes this side's arm, held weapon and shoulder weapon off.";
      col.append(el("p", "bay-note", note));
    }
    col.append(el("h3", "", choice === "arm" ? "Arms that fit (stash and cargo)" : choice === "hullWeapon" ? "Hull weapons that fit (stash and cargo)" : "Fits here (stash and cargo)"));
    const { fits, near } = offered(slot, choice);
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
    if (isMountSlot(s)) return x.kind === "arm" || (x.kind === "weapon" && x.size === "M");
    if (s === "heldL" || s === "heldR") return x.kind === "weapon" && x.size !== "M";
    if (s === "shoulderL" || s === "shoulderR") return x.kind === "shoulder";
    if (s === "pack") return x.kind === "pack" || x.kind === "shoulder";
    if (s === "waistL" || s === "waistR") return x.kind === "waist";
    return x.kind === s;
  }

  function itemRow(x: Item) {
    const row = el("div", "bay-item");
    row.append(nameEl(x));
    const where = st.cargo.items.includes(x) ? "cargo" : "stash";
    const def = x.kind === "protocol" ? PROTOCOL_BY_ID[x.base] : null;
    const what = def ? "Protocol · " + def.text : x.kind === "weapon" ? sizeLabel(x).slice(3) : x.kind;
    row.append(el("span", "dim", `${what}${x.socketed.length ? ` · ${x.socketed.length}◆` : ""} · ${fmt(itemWeight(x), 1)} t · ${where}`));
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
    const kids: HTMLElement[] = [head];
    if (st.notes?.length) {
      const n = el("div", "bay-notes");
      for (const t of st.notes) n.append(el("div", "", t));
      n.append(btn("OK", () => { st.notes = []; render(); }, "small"));
      kids.push(n);
    }
    const body = el("div", "bay-body");
    body.append(slotsColumn(), middleColumn(), bagColumn());
    kids.push(body);
    root.replaceChildren(...kids);
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
    /** Pick a slot (on a hull mount, optionally its choice) and optionally preview an item from the fitting list by
     *  its index, for headless shots. */
    select(s: SlotId, previewIndex = -1, c: MountChoice | null = null) {
      slot = s;
      choice = isMountSlot(s) ? c ?? choiceOf(st.loadout[s]!) ?? "hullWeapon" : null;
      hover = previewIndex >= 0 ? offered(s, choice).fits[previewIndex] ?? null : null;
      render();
    },
    render,
  };
}

/** Save the bay in localStorage (src/items/bayState.ts has the format). */
export function saveBay(key: string, st: BayState) {
  try { localStorage.setItem(key, JSON.stringify(bayToJson(st))); } catch { /* storage blocked */ }
}

/** The saved bay (an older save migrated, with notes), or null if there's none or it doesn't read back. */
export function loadBay(key: string): BayState | null {
  try { return readBay(JSON.parse(localStorage.getItem(key) || "null")); } catch { return null; }
}

