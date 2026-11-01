// Cargo limit and the inventory's rules (Keith 2026-11-01), headless: the at-risk cargo never takes more than the
// mech's capacity by a pick-up (items or a strip), a dropped item lies on the sand and isn't grabbed straight back,
// dumped scrap is gone, the bay's cargo rides out at the launch, an arm fitted from the inventory takes a held weapon.
import { Expedition, EXPEDITION_DEFAULTS } from "../src/expedition/expedition";
import { DropField, DROP_DEFAULTS } from "../src/expedition/drops";
import { LOOT_DEFAULTS, makeItem, rollItem } from "../src/items/generate";
import { SALVAGE_DEFAULTS, SalvageSim } from "../src/pois/salvage";
import { defaultLoadout, emptyLoadout, fit, resolve, fitProblem, LOADOUT_DEFAULTS } from "../src/items/loadout";
import { fitWithHeld } from "../src/items/fitting";
import { itemWeight } from "../src/items/item";
import { partsFromHull } from "../src/ui/mechDoll";

const fails: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) fails.push(what); };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// ---- Weight, room, fits ----
const e = new Expedition(EXPEDITION_DEFAULTS);
e.capacity = 10; e.scrapWeight = 0.02;
const carried = makeItem("legs-rampart", "common", "carried");
e.carryOut = [{ kind: "item", item: carried, label: "legs" }];
e.launch();
must(e.atRisk.length === 1 && e.atRisk[0].kind === "item" && e.atRisk[0].item === carried, "the bay's cargo didn't ride out at the launch");
must(e.carryOut.length === 0, "carryOut not emptied by the launch");
must(e.events.length === 0, "carrying out made pick-up events");
e.add({ kind: "scrap", amount: 100, label: "x" });
must(near(e.load, 6 + 2), `load wrong: ${e.load}`);
must(near(e.room, 2), `room wrong: ${e.room}`);
must(e.scrapRoom === 100, `scrap room wrong: ${e.scrapRoom}`);
const big = makeItem("hull-rampart", "common", "big"), small = makeItem("sensor-visor", "common", "small");
must(!e.fits({ kind: "item", item: big, label: "" }) && e.fits({ kind: "item", item: small, label: "" }), "fits() wrong");
must(!e.stow(big, "big") && e.stow(small, "small"), "stow() let an item over capacity or refused one that fits");

// ---- Drop and dump ----
e.events.length = 0;
must(e.dropItem("small") && !e.atRisk.some((l) => l.kind === "item" && l.item.id === "small"), "dropItem didn't take it out");
must(e.events.some((ev) => ev.type === "dropped" && ev.loot.kind === "item" && ev.loot.item.id === "small"), "no dropped event");
must(e.dumpScrap(40) === 40 && e.scrapAtRisk === 60, `dumpScrap wrong: ${e.scrapAtRisk}`);
must(e.dumpScrap(1000) === 60 && e.scrapAtRisk === 0, "dump all wrong");
const aboard = new Expedition(EXPEDITION_DEFAULTS);
must(!aboard.dropItem("x") && aboard.dumpScrap(5) === 0 && !aboard.stow(small, "s"), "aboard, the cargo changed");

// ---- Pick-ups refused by a full cargo; a laid drop isn't grabbed straight back ----
{
  const df = new DropField({ ...DROP_DEFAULTS, ...LOOT_DEFAULTS }, 7);
  const it = rollItem(5, LOOT_DEFAULTS, { base: "hull-siege" });
  df.place(it, 0, 0);
  const c = [{ x: 0, z: 0, by: "mech" as const }];
  must(df.update(c, true).length === 0, "a laid drop was picked straight back up");
  df.update([{ x: 50, z: 0, by: "mech" }], true);
  must(df.update(c, true, () => false).length === 0 && df.events.some((ev) => ev.type === "refused"), "a full cargo didn't refuse the drop");
  must(df.drops.length === 1, "a refused drop left the sand");
  must(df.update(c, true, () => true).length === 1, "walking back over a laid drop didn't pick it up");
}

// ---- A strip that doesn't fit is blocked ----
{
  const sim = new SalvageSim({ ...SALVAGE_DEFAULTS, stripSizeSlow: 0 });
  sim.add({ place: { id: "p" }, sections: [{ name: "a", value: 50, spots: [{ id: "s", section: 0, x: 0, z: 0, h: 1, time: 1, value: 50, label: "x" }] }] } as never);
  const ex = new Expedition(EXPEDITION_DEFAULTS);
  ex.capacity = 0.5; ex.scrapWeight = 0.02; ex.launch();
  sim.canStrip = (s) => ex.fits({ kind: "scrap", amount: sim.pay(s), label: "" });
  let paid = 0;
  sim.onDone = (s) => { paid += sim.pay(s); };
  for (let i = 0; i < 300; i++) sim.update(1 / 60, 0, 0, true);
  must(paid === 0 && sim.blocked !== null && sim.spots[0].progress === 0, "stripped a spot whose scrap doesn't fit");
  ex.capacity = 5;
  for (let i = 0; i < 300; i++) sim.update(1 / 60, 0, 0, true);
  must(paid > 0 && sim.blocked === null, "a spot that fits didn't strip");
}

// ---- Fitting from the inventory: an arm takes a held weapon from the pool; nothing is lost or doubled ----
{
  const lo = defaultLoadout();
  const arm = makeItem("arm-rampart", "common", "arm1"), gun = makeItem("mg-light", "rare", "gun1");
  must(!fitProblem(lo, "mountL", arm), "the arm doesn't fit the left mount");
  const before = Object.values(lo).filter(Boolean).length;
  const r = fitWithHeld(lo, "mountL", arm, [arm, gun]);
  must(lo.mountL === arm && lo.heldL === gun, "the arm didn't take the held weapon");
  must(r.used.includes(arm) && r.used.includes(gun), "used doesn't list the arm and its weapon");
  const after = Object.values(lo).filter(Boolean).length;
  must(after + r.off.length === before + r.used.length, `items lost or doubled (${before} + ${r.used.length} → ${after} + ${r.off.length} off)`);
  const lo2 = emptyLoadout();
  fit(lo2, "hull", makeItem("hull-rampart", "common", "h"));
  const r2 = fitWithHeld(lo2, "mountL", makeItem("arm-rampart", "common", "a2"), []);
  must(r2.emptyHeld === "heldL", "an arm with nothing to hold didn't point at its hand");
  // Capacity: the Rampart carries legs' carry plus racks (what the cargo limit uses).
  const cap = resolve(defaultLoadout(), LOADOUT_DEFAULTS).cargoCapacity;
  must(cap > 8 && cap < 40, `default cargo capacity odd: ${cap}`);
  console.log(`default cargo ${cap.toFixed(1)} t · Rampart legs ${itemWeight(makeItem("legs-rampart", "common", "q")).toFixed(1)} t · 100 scrap ${(100 * 0.02).toFixed(1)} t`);
}

// ---- The doll ----
{
  const p = partsFromHull(0.4, { pack: false });
  must(p.hull === 0.4 && p.legL === 0.4 && p.pack === null, "partsFromHull wrong");
  must(partsFromHull(-1).sensor === 0 && partsFromHull(3).sensor === 1, "partsFromHull not clamped");
}

if (fails.length) { console.error("cargo-check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("cargo-check ok");
