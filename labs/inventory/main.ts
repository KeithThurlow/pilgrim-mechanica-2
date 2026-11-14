// Inventory lab (Keith 2026-11-02: "every item to have a grid size, a placeholder grid image, and... being able to play
// with the equipment doll"). The inventory screen on its own: the mech doll, the cargo and stash grids, the size table
// as sliders (Grid topic). No mech, no field: the cargo is the bay's cargo, as in the loadout lab. Saved in this browser.
// URL flags: ?fresh (ignore the save), ?roll=N (N items rolled into the stash at the start, 24 on an empty stash),
// ?inv=slot (open with that slot picked), ?out[=scrap] (start out in the field with that much salvage, 120 by default).
// Go out / Come home stand in for the launch and the crane: out there the cargo is at risk and the scrap shows as
// salvage blocks in the cargo grid (Salvage blocks topic: per block, compaction).
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import { createApp } from "../../src/core/app";
import { tweakPanel } from "../../src/core/tweaks";
import { LOOT_DEFAULTS, LOOT_PARAMS, rollItem, rollProtocol } from "../../src/items/generate";
import { LOADOUT_DEFAULTS, LOADOUT_PARAMS, SLOTS, defaultLoadout, resolve, type SlotId } from "../../src/items/loadout";
import { VALUE_DEFAULTS, VALUE_PARAMS } from "../../src/items/value";
import { GRID_DEFAULTS, GRID_PARAMS } from "../../src/items/grid";
import { cargoCapacity, cargoSizing } from "../../src/items/cargoSpace";
import { GRID_SIZE_DEFAULTS, GRID_SIZE_PARAMS } from "../../src/items/gridSize";
import { newBag } from "../../src/items/cargo";
import { inventoryScreen } from "../../src/ui/inventory";
import { loadBay, saveBay, type BayState } from "../../src/ui/bay";
import { Expedition, EXPEDITION_DEFAULTS } from "../../src/expedition/expedition";
import { Unlocks, UNLOCK_DEFAULTS, UNLOCK_PARAMS } from "../../src/expedition/unlocks";

const KEY = "pm2:inventory-lab:bay";
const app = await createApp(document.getElementById("view")!);
app.scene.background = new THREE.Color(0x2a2620);
const params = app.params;

const V = { ...UNLOCK_DEFAULTS, ...LOOT_DEFAULTS, ...LOADOUT_DEFAULTS, ...VALUE_DEFAULTS, ...GRID_DEFAULTS, ...GRID_SIZE_DEFAULTS };
const DEFAULTS = { ...V };
const st: BayState = (!params.has("fresh") && loadBay(KEY)) || { loadout: defaultLoadout(), stash: newBag(), cargo: newBag(), seed: (Date.now() % 1e9) | 1, scrap: 0 };

function roll(n: number, into: "stash" | "cargo" = "stash") {
  for (let i = 0; i < n; i++) {
    const s = st.seed++;
    // About one in six a Protocol, the rest parts and weapons of every kind.
    st[into].items.push(s % 6 === 0 ? rollProtocol(s) : rollItem(s, V));
  }
  changed();
}
// A stand-in expedition: out, the cargo is the at-risk list and the scrap salvage blocks.
const exp = new Expedition(EXPEDITION_DEFAULTS);
function goOut(scrap: number) {
  if (exp.state !== "aboard") return;
  exp.carryOut = st.cargo.items.splice(0).map((item) => ({ kind: "item" as const, item, label: "cargo" }));
  exp.launch();
  exp.capacity = cargoCapacity(V, resolve(st.loadout, V).cargoRackRows);
  if (scrap > 0) exp.add({ kind: "scrap", amount: scrap, label: "Wreck" });
  changed();
}
function comeHome() {
  if (!exp.pickedUp()) return;
  st.stash.items.push(...exp.bank.items.splice(0));
  st.scrap = (st.scrap ?? 0) + exp.bank.scrap;
  exp.bank.scrap = 0;
  changed();
}
function changed() {
  st.cargo.capacity = cargoCapacity(V, resolve(st.loadout, V).cargoRackRows);
  exp.sizing = cargoSizing(V, V.salvageLevel);
  if (exp.state === "out") exp.capacity = st.cargo.capacity;
  // The Compactor level slider stands in for the convoy's Salvage compactor unlock.
  exp.scrapValueMul = Unlocks.mulAt(V, "compactor", V.salvageLevel);
  saveBay(KEY, st);
  inv.render();
}

const inv = inventoryScreen({ state: st, tuning: V, exp, scrapValueMul: () => exp.scrapValueMul, onChange: changed, bankScrap: (n) => { st.scrap = (st.scrap ?? 0) + n; } });
const rollN = Number(params.get("roll"));
if (rollN > 0 || !st.stash.items.length) roll(rollN > 0 ? rollN : 24);

const panel = tweakPanel({
  id: "inventory-lab",
  title: "Inventory lab",
  params: [...GRID_PARAMS, ...GRID_SIZE_PARAMS, ...UNLOCK_PARAMS.filter((p) => p.key.startsWith("unlCompact")), ...LOOT_PARAMS, ...VALUE_PARAMS, ...LOADOUT_PARAMS],
  values: V,
  defaults: DEFAULTS,
  actions: [
    { label: "Inventory (I)", onClick: () => inv.toggle(), active: () => inv.isOpen },
    { label: "Go out (field)", onClick: () => (exp.state === "out" ? comeHome() : goOut(120)), active: () => exp.state === "out" },
    { label: "Find 30 salvage", onClick: () => { exp.add({ kind: "scrap", amount: 30, label: "Wreck" }); changed(); } },
    { label: "Roll 8 into the stash", onClick: () => roll(8) },
    { label: "Roll 3 into the cargo", onClick: () => { if (exp.state === "out") { for (let i = 0; i < 3; i++) exp.add({ kind: "item", item: rollItem(st.seed++, V), label: "find" }); changed(); } else roll(3, "cargo"); } },
    { label: "Tidy both grids", onClick: () => { st.grids = { cargo: [], stash: [] }; changed(); } },
    { label: "Empty the stash", onClick: () => { st.stash.items = []; changed(); } },
    { label: "Reset the mech", onClick: () => { st.loadout = defaultLoadout(); changed(); } },
  ],
  topics: [
    { id: "grid", label: "Grid", groups: ["Grid", "Item sizes", "Hull weapon sizes", "Salvage blocks", "Convoy unlocks"] },
    { id: "loot", label: "Loot", groups: ["Loot rolls", "Loot slot mix", "Item value", "Bare mech", "Leg load"] },
  ],
  onChange: () => changed(),
});
void panel;

if (params.has("out")) goOut(Number(params.get("out")) || 120);
inv.open();
const at = params.get("inv") as SlotId | null;
if (at && SLOTS.includes(at)) inv.select(at);
app.onTick((dt) => inv.update(dt));
