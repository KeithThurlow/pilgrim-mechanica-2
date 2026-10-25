// Loadout lab (proposal step 1, Keith 2026-10-25): the walker with whatever is fitted, against a range of target
// dummies so a change is felt. B opens the bay screen: slots, the items that fit, what each changes, Protocol
// sockets, loot rolls. Legs change the walk, the hull its hull points and torso turn, the pack the dash, weapons the
// guns (an empty side doesn't fire). The loadout, stash and cargo are saved in this browser.
// URL flags for shots: ?bay[=slot] opens the bay on a slot (rolls a few items into an empty stash), ?hover=N previews
// the Nth fitting item, ?fit=slot:base:rarity,... fits rolled items first (e.g. ?fit=armL:arm-rampart:rare,armR:arm-rampart,handR:mg-heavy:epic),
// ?fresh ignores the saved bay.
import "../../src/core/lab.css";
import { combatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { applyLoadout } from "../../src/game/loadoutApply";
import { DummyRange, DUMMY_DEFAULTS, DUMMY_PARAMS } from "../../src/game/dummies";
import { DummiesDraw } from "../../src/game/dummiesDraw";
import { LOOT_DEFAULTS, LOOT_PARAMS, rollItem, rollLoot, rollProtocol } from "../../src/items/generate";
import { LOADOUT_DEFAULTS, LOADOUT_PARAMS, SLOTS, defaultLoadout, fit, fitProblem, resolve, type SlotId } from "../../src/items/loadout";
import { RARITIES, type Rarity } from "../../src/items/rarity";
import { newBag } from "../../src/items/cargo";
import { bayScreen, loadBay, saveBay, itemName, type BayState } from "../../src/ui/bay";

const KEY = "pm2:loadout-lab:bay";
let range: DummyRange | null = null;
let draw: DummiesDraw | null = null;
let bay: ReturnType<typeof bayScreen> | null = null;

const lab = await combatLab({
  id: "loadout-lab",
  title: "Loadout",
  defaults: { ...LOOT_DEFAULTS, ...LOADOUT_DEFAULTS, ...DUMMY_DEFAULTS },
  params: [...LOOT_PARAMS, ...LOADOUT_PARAMS, ...DUMMY_PARAMS],
  topics: [
    { id: "loadout", label: "Loadout", groups: ["Loot rolls", "Bare mech"] },
    { id: "dummies", label: "Targets", groups: ["Target dummies"] },
  ],
  selectables: [{ topic: "dummies", label: "Target dummies", objects: () => draw?.meshes() ?? [] }],
  actions: [{ label: "Bay (B)", onClick: () => (bay?.isOpen ? bay.close() : bay?.open()), active: () => !!bay?.isOpen }],
  report: () => ({ loadout: Object.fromEntries(SLOTS.map((s) => [s, st.loadout[s] ? `${itemName(st.loadout[s]!)} (${st.loadout[s]!.rarity})` : null])), stash: st.stash.items.length, cargo: st.cargo.items.length }),
  onChange: (k) => {
    if (k in DUMMY_DEFAULTS && k !== "dpsWindow") { range?.build(); draw?.rebuild(); }
    if (k in LOADOUT_DEFAULTS) refit();
  },
});
const { V, player } = lab;
const params = lab.app.params;

// ---- The bay: the saved loadout, stash and cargo, or today's mech with nothing stored ----
const st: BayState = (!params.has("fresh") && loadBay(KEY)) || { loadout: defaultLoadout(), stash: newBag(), cargo: newBag(), seed: (Date.now() % 1e9) | 1 };

const emptyStash = !st.stash.items.length;
// ?fit=slot:base[:rarity],...: fit rolled items (in order) for shots.
for (const part of (params.get("fit") ?? "").split(",").filter(Boolean)) {
  const [slot, base, rarity] = part.split(":") as [SlotId, string, Rarity | undefined];
  try {
    const it = rollItem(st.seed++, V, { base, rarity: RARITIES.includes(rarity as Rarity) ? rarity : "common" });
    if (!fitProblem(st.loadout, slot, it)) st.stash.items.push(...fit(st.loadout, slot, it));
  } catch (e) { console.warn("?fit", part, e); }
}

function refit() {
  const r = resolve(st.loadout, V);
  st.cargo.capacity = r.cargoCapacity;
  applyLoadout(player, r);
  lab.refresh();
  saveBay(KEY, st);
}
refit();

bay = bayScreen({ state: st, tuning: V, onChange: refit });
const openBtn = document.createElement("button");
openBtn.type = "button";
openBtn.className = "bay-open-btn";
openBtn.textContent = "Bay (B)";
openBtn.addEventListener("click", () => (bay!.isOpen ? bay!.close() : bay!.open()));
document.body.appendChild(openBtn);

// ?bay[=slot]: open on a slot, with a few seeded items if the stash is empty.
if (params.has("bay")) {
  if (emptyStash) {
    for (let i = 1; i <= 10; i++) st.stash.items.push(rollLoot(i * 101, V));
    for (const r of RARITIES) st.stash.items.push(rollItem(7000 + RARITIES.indexOf(r), V, { kind: "weapon", rarity: r }));
    st.stash.items.push(rollItem(7100, V, { base: "mg-light", rarity: "rare" }), rollItem(7101, V, { base: "arm-wildcat", rarity: "uncommon" }));
    st.stash.items.push(rollProtocol(31, "overpressure"), rollProtocol(32, "shredder"));
    st.cargo.items.push(rollItem(4242, V, { base: "legs-stilt", rarity: "epic" }));
  }
  bay.open();
  const slot = (params.get("bay") || "armR") as SlotId;
  bay.select(SLOTS.includes(slot) ? slot : "armR", params.has("hover") ? Number(params.get("hover")) : -1);
}

// ---- Target dummies ----
const rng = new DummyRange(V);
range = rng;
const dd = new DummiesDraw(rng, lab.toon);
draw = dd;
lab.app.scene.add(dd.group);
let registered: unknown[] = [];
const syncTargets = () => {
  // Rounds hit the dummies on the battlefield (re-registered after a rebuild).
  lab.bf.targets.splice(0, lab.bf.targets.length, ...lab.bf.targets.filter((t) => !registered.includes(t)));
  lab.bf.targets.push(...rng.dummies);
  registered = [...rng.dummies];
};
syncTargets();

lab.targets = () => {
  const out: TargetCandidate[] = [];
  for (const d of rng.dummies) if (d.alive) out.push({ x: d.x, y: d.y + V.dummyHeight * 0.6, z: d.z, r: V.dummyRadius + 0.4, key: d });
  return out;
};

lab.onFrame((dt) => {
  if (registered.length !== rng.dummies.length || registered.some((d, i) => d !== rng.dummies[i])) syncTargets();
  rng.update(dt, lab.field);
  dd.update();
  const r = resolve(st.loadout, V);
  const g = player.upper.guns;
  lab.hud("loadout", `damage/s ${Math.round(rng.dps())} · dummies down ${rng.kills} · guns ${g[0].enabled ? "L" : "-"}${g[1].enabled ? "R" : "-"} · fitted ${r.weight.toFixed(1)} t · cargo ${st.cargo.items.length} · B: bay`);
});
