// Cargo limit and the inventory's rules (Keith 2026-11-01), headless: the at-risk cargo never takes more than the
// mech's capacity by a pick-up (items or a strip), a dropped item lies on the sand and isn't grabbed straight back,
// dumped scrap is gone, the bay's cargo rides out at the launch, an arm fitted from the inventory takes a held weapon.
import { Expedition, EXPEDITION_DEFAULTS } from "../src/expedition/expedition";
import { DropField, DROP_DEFAULTS } from "../src/expedition/drops";
import { LOOT_DEFAULTS, makeItem, rollItem } from "../src/items/generate";
import { SALVAGE_DEFAULTS, SalvageSim } from "../src/pois/salvage";
import { defaultLoadout, emptyLoadout, fit, resolve, fitProblem, LOADOUT_DEFAULTS } from "../src/items/loadout";
import { fitWithHeld } from "../src/items/fitting";
import { cargoCapacity, cargoSizing, scrapCells } from "../src/items/cargoSpace";
import { itemCells } from "../src/items/gridSize";
import { partsFromHull } from "../src/ui/mechDoll";
import { sortItems, sortValue, SORT_KEYS } from "../src/items/sort";
import { itemValue } from "../src/items/value";
import { itemCadence, dpsOf } from "../src/items/dps";

const fails: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) fails.push(what); };

// ---- Cells, room, fits (cargo space, not weight: Keith 2026-11-06) ----
const e = new Expedition(EXPEDITION_DEFAULTS);
e.sizing = cargoSizing(); const cellsOf = (b: string) => { const k = itemCells({ kind: makeItem(b, "common", "q").kind, base: b }); return k.w * k.h; };
e.capacity = cellsOf("legs-rampart") + 4 * e.sizing.blockCells + cellsOf("sensor-visor");
const carried = makeItem("legs-rampart", "common", "carried");
e.carryOut = [{ kind: "item", item: carried, label: "legs" }];
e.launch();
must(e.atRisk.length === 1 && e.atRisk[0].kind === "item" && e.atRisk[0].item === carried, "the bay's cargo didn't ride out at the launch");
must(e.carryOut.length === 0, "carryOut not emptied by the launch");
must(e.events.length === 0, "carrying out made pick-up events");
e.add({ kind: "scrap", amount: 100, label: "x" });
must(e.load === cellsOf("legs-rampart") + 4 * e.sizing.blockCells, `load wrong: ${e.load}`);
must(e.room === cellsOf("sensor-visor"), `room wrong: ${e.room}`);
must(e.scrapRoom === 0 && !e.fits({ kind: "scrap", amount: 1, label: "" }), `scrap room wrong: ${e.scrapRoom}`);
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

// ---- Pick-ups are a choice (Keith 2026-11-06): nothing is taken by walking over; a grab takes the nearest in reach ----
{
  const df = new DropField({ ...DROP_DEFAULTS, ...LOOT_DEFAULTS }, 7);
  const a = rollItem(5, LOOT_DEFAULTS, { base: "hull-siege" }), b = rollItem(6, LOOT_DEFAULTS, { base: "hull-siege" });
  df.place(a, 1, 0); df.place(b, 3, 0);
  for (const d of df.drops) d.laid = false;
  const at = (grab: boolean) => [{ x: 0, z: 0, by: "mech" as const, grab }];
  for (let i = 0; i < 60; i++) must(df.update(at(false), true).length === 0, "a drop was picked up without a grab");
  must(df.update(at(true), false).length === 0, "a grab took a drop while not out");
  must(df.update(at(true), true, () => false).length === 0 && df.events.some((ev) => ev.type === "refused"), "a full cargo didn't refuse the grab");
  must(df.drops.length === 2, "a refused drop left the sand");
  const got = df.update(at(true), true);
  must(got.length === 1 && got[0].item === a, "a grab didn't take exactly the nearest drop");
  must(df.update([{ x: 20, z: 0, by: "mech", grab: true }], true).length === 0, "a grab took a drop out of reach");
  must(df.update([{ x: 0, z: 0, by: "pilot", grab: true }], true).length === 0, "the pilot grabbed past his reach");
  const laid = df.place(rollItem(7, LOOT_DEFAULTS, { base: "hull-siege" }), 0, 0);
  must(df.update(at(true), true)[0] === laid, "a grab didn't take a drop just laid down (a deliberate grab may)");
}

// ---- The old walk-over (autoPickup 1): refused by a full cargo; a laid drop isn't grabbed straight back ----
{
  const df = new DropField({ ...DROP_DEFAULTS, ...LOOT_DEFAULTS, autoPickup: 1 }, 7);
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
  ex.capacity = 1; ex.launch();
  sim.canStrip = (s) => ex.fits({ kind: "scrap", amount: sim.pay(s), label: "" });
  let paid = 0;
  sim.onDone = (s) => { paid += sim.pay(s); };
  for (let i = 0; i < 300; i++) sim.update(1 / 60, 0, 0, true);
  must(paid === 0 && sim.blocked !== null && sim.spots[0].progress === 0, "stripped a spot whose scrap doesn't fit");
  ex.capacity = 100;
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
  // Capacity: the cargo grid's cells plus the racks' rows (what the cargo limit uses).
  const cap = cargoCapacity({}, resolve(defaultLoadout(), LOADOUT_DEFAULTS).cargoRackRows);
  must(cap >= 40 && cap <= 200, `default cargo capacity odd: ${cap}`);
  console.log(`default cargo ${cap} cells · Rampart legs ${itemCells({ kind: "legs", base: "legs-rampart" }).w}×${itemCells({ kind: "legs", base: "legs-rampart" }).h} · 100 scrap ${scrapCells(cargoSizing(), 100)} cells`);
}

// ---- The doll ----
{
  const p = partsFromHull(0.4, { pack: false });
  must(p.hull === 0.4 && p.legL === 0.4 && p.pack === null, "partsFromHull wrong");
  must(partsFromHull(-1).sensor === 0 && partsFromHull(3).sensor === 1, "partsFromHull not clamped");
}

// ---- Sorting and scrap value ----
{
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => rollItem(k * 37, LOOT_DEFAULTS, k % 3 ? { kind: "weapon" } : {}));
  for (const key of SORT_KEYS) {
    for (const up of [false, true]) {
      const out = sortItems(items, key, up);
      must(out.length === items.length && new Set(out).size === items.length, `sort ${key} lost or doubled items`);
      const ks = out.map((it) => sortValue(it, key)).filter((x): x is number => x !== null);
      must(ks.every((x, i) => !i || (up ? x >= ks[i - 1] : x <= ks[i - 1])), `sort ${key} ${up ? "up" : "down"} out of order`);
      const firstNull = out.findIndex((it) => sortValue(it, key) === null);
      must(firstNull < 0 || out.slice(firstNull).every((it) => sortValue(it, key) === null), `sort ${key}: items without a value not last`);
    }
  }
  const c = makeItem("mg-medium", "common", "v1"), l = makeItem("mg-medium", "legendary", "v2");
  must(itemValue(l) > itemValue(c) * 10 && itemValue({ ...c, level: 10 }) > itemValue(c), "scrap value doesn't grow with rarity and level");
  // DPS is sustained: with a magazine and reload it's below the burst.
  const cad = itemCadence(c)!;
  must(cad.magazine > 0 && dpsOf(cad) < cad.damage * cad.rounds * cad.rate, "minigun DPS isn't counting the reload");
  console.log(`minigun: ${Math.round(dpsOf(cad))} dps sustained, ${Math.round(cad.damage * cad.rounds * cad.rate)} burst · value common ${itemValue(c)}, legendary ${itemValue(l)}`);
}

if (fails.length) { console.error("cargo-check FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("cargo-check ok");
