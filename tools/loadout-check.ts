// Headless loadout check (src/items): the fit rules (no hand weapon without an arm, a two-hander takes both hands,
// Medium only on hull mounts), sockets by rarity and Protocols only by tags, stats that add up and are the same for
// the same seed, rarity widening rolls both ways, the cargo weight limit, losing cargo leaving what's fitted, every
// base drawn by a known model look, the per-gun hooks in the upper-body sim, and the default loadout giving exactly
// today's mech values (so nothing changes until something else is fitted). Run: npm test.
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { UPPER_DEFAULTS, UpperSim } from "../src/mech/upper";
import { DASH_DEFAULTS } from "../src/mech/dash";
import { MECH_DEFAULTS } from "../src/game/mechUnit";
import { BASES, BASE_BY_ID, STATS } from "../src/items/bases";
import { PROTOCOLS } from "../src/items/protocols";
import { RARITIES, RARITY } from "../src/items/rarity";
import { LOOKS, lookFor, itemWeight } from "../src/items/item";
import { LOOT_DEFAULTS, rollItem, rollLoot, rollProtocol, makeItem, statRange } from "../src/items/generate";
import { defaultLoadout, emptyLoadout, fit, fitProblem, unfit, problems, resolve, socket, socketProblem, unsocket, SLOTS, LOADOUT_DEFAULTS } from "../src/items/loadout";
import { newBag, addTo, bagWeight, moveItem, loseCargo, hasRoom } from "../src/items/cargo";

const fails: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) fails.push(what); };
const L = LOOT_DEFAULTS;

// ---- The default loadout is today's mech ----
{
  const lo = defaultLoadout();
  must(problems(lo).length === 0, `default loadout has problems: ${problems(lo).join("; ")}`);
  const r = resolve(lo);
  const today: Record<string, number> = {
    ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...UPPER_DEFAULTS, ...DASH_DEFAULTS,
    hull: MECH_DEFAULTS.hull, roundDamage: MECH_DEFAULTS.roundDamage, roundPierce: MECH_DEFAULTS.roundPierce,
  } as Record<string, number>;
  for (const [k, val] of Object.entries(r.values)) must(today[k] === val, `default loadout ${k} = ${val}, today ${today[k]}`);
  for (const [name, g] of [["left", r.guns.left], ["right", r.guns.right]] as const) {
    must(!!g, `default loadout has no ${name} gun`);
    if (!g) continue;
    const want = { fireRate: today.fireRate, spinUp: today.spinUp, ammo: today.ammoPerGun, arc: today.podYawMax, track: today.podTrack, damage: today.roundDamage, spread: today.spread, range: today.range, pierce: today.roundPierce };
    for (const [k, val] of Object.entries(want)) must((g as unknown as Record<string, number>)[k] === val, `default ${name} gun ${k} = ${(g as unknown as Record<string, number>)[k]}, today ${val}`);
  }
  must(r.parts.drums && r.parts.pack, "default loadout hides the drums or the pack");
}

// ---- Fit rules ----
{
  const lo = defaultLoadout();
  const light = makeItem("mg-light", "common", "l1"), heavy = makeItem("mg-heavy", "common", "h1"), med = makeItem("mg-medium", "common", "m1");
  const armA = makeItem("arm-rampart", "common", "a1"), armB = makeItem("arm-rampart", "common", "a2");
  must(!!fitProblem(lo, "handL", light), "a hand weapon fitted with no arm on that side");
  must(!!fitProblem(lo, "handR", heavy), "a two-hander fitted with hull weapons on both mounts");
  must(!!fitProblem(lo, "handL", med), "a Medium weapon fitted in a hand");
  must(!!fitProblem(lo, "armL", light), "a Light weapon fitted as a hull weapon");
  must(!!fitProblem(lo, "armL", heavy), "a Heavy weapon fitted as a hull weapon");
  must(!fitProblem(lo, "armL", med), "a Medium weapon refused on a hull mount");
  must(!!fitProblem(lo, "legs", med) && !!fitProblem(lo, "pack", armA), "wrong kinds accepted");
  // An arm on the left: the hull weapon there comes off; then a hand weapon fits.
  const off = fit(lo, "armL", armA);
  must(off.length === 1 && off[0].id === "default-mg-medium-L", "replacing a hull weapon with an arm didn't hand back the hull weapon");
  must(!fitProblem(lo, "handL", light), "a hand weapon refused with an arm on that side");
  fit(lo, "handL", light);
  must(resolve(lo).guns.left?.damage === light.stats.damage, "the left gun isn't the hand weapon");
  must(resolve(lo).guns.left?.arc === armA.stats.arc, "the hand gun doesn't take its arm's arc");
  // One arm only: no two-hander.
  must(!!fitProblem(lo, "handR", heavy), "a two-hander fitted with one arm");
  fit(lo, "armR", armB);
  must(!fitProblem(lo, "handL", heavy) && !fitProblem(lo, "handR", heavy), "a two-hander refused with both arms");
  const off2 = fit(lo, "handL", heavy);
  must(lo.handR === heavy && lo.handL === null, "the two-hander doesn't take both hands");
  must(off2.some((i) => i.id === "l1"), "fitting a two-hander didn't hand back the left-hand weapon");
  must(problems(lo).length === 0, `two-hander loadout has problems: ${problems(lo).join("; ")}`);
  const r2 = resolve(lo);
  must(!r2.guns.left && !!r2.guns.right && r2.guns.right.damage === heavy.stats.damage, "a two-hander should fire as one gun on the right");
  // A one-hander back in the left hand drops the two-hander.
  const off3 = fit(lo, "handL", light);
  must(off3.some((i) => i.id === "h1") && lo.handR === null && lo.handL === light, "a one-hander in a hand didn't drop the two-hander");
  // A hull weapon in place of the left arm drops the left hand's weapon.
  const off4 = fit(lo, "armL", med);
  must(off4.some((i) => i.id === "a1") && off4.some((i) => i.id === "l1") && lo.handL === null, "a hull weapon in place of an arm didn't drop the arm's hand weapon");
  // Taking the pack off drops the back mount; legs and hull can't be taken off.
  const off5 = unfit(lo, "pack");
  must(off5.length === 2 && lo.back === null, "taking the pack off didn't drop the back item");
  must(unfit(lo, "legs").length === 0 && !!lo.legs, "legs came off");
  must(problems(lo).length === 0, `problems after unfits: ${problems(lo).join("; ")}`);
  const bare = resolve(lo);
  must(bare.values.ammoPerGun === LOADOUT_DEFAULTS.bareAmmo && bare.values.dashCharges === LOADOUT_DEFAULTS.bareDashCharges, "a bare mech doesn't fall back to the bare values");
  must(!!fitProblem(emptyLoadout(), "armL", med), "a hull weapon fitted with no hull");
}

// ---- Sockets and Protocols ----
{
  for (const r of RARITIES) must(rollItem(7, L, { base: "mg-medium", rarity: r }).sockets === RARITY[r].sockets, `${r} item has the wrong number of sockets`);
  must(RARITIES.map((r) => RARITY[r].sockets).join() === "0,1,2,3,4", "sockets aren't 0-4 by rarity");
  const over = rollProtocol(1, "overpressure"), coolant = rollProtocol(2, "coolant"), shred = rollProtocol(3, "shredder"), choke = rollProtocol(4, "choke");
  const common = makeItem("mg-medium");
  must(!!socketProblem(common, over), "a Protocol socketed into a Common item (no sockets)");
  const gun = rollItem(11, L, { base: "mg-medium", rarity: "rare" });
  const legs = rollItem(12, L, { base: "legs-rampart", rarity: "legendary" });
  must(!!socketProblem(legs, over), "a weapon Protocol fit legs");
  must(!socketProblem(gun, over), "Overpressure refused by a minigun");
  socket(gun, over);
  must(!!socketProblem(gun, over), "the same Protocol socketed twice");
  socket(gun, shred);
  must(!!socketProblem(gun, choke), "a third Protocol into two sockets");
  must(!!socketProblem(gun, coolant), "a power Protocol fit a gun");
  for (const p of PROTOCOLS) must(BASES.some((b) => p.fits.some((t) => b.tags.includes(t))), `Protocol ${p.id} fits nothing`);
  // Stats add up: Overpressure x1.35 and Shredder x0.85 on damage, Shredder +2 pierce, Overpressure x1.4 spin-up.
  const lo = defaultLoadout();
  fit(lo, "armL", gun);
  const g = resolve(lo).guns.left!;
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  must(close(g.damage, gun.stats.damage * 1.35 * 0.85), `Protocol damage doesn't add up (${g.damage})`);
  must(g.pierce === Math.round(gun.stats.pierce + 2), "Shredder's pierce doesn't add up");
  must(close(g.spinUp, gun.stats.spinUp * 1.4), "Overpressure's spin-up doesn't add up");
  const back = unsocket(gun, 0);
  must(back?.id === over.id && gun.socketed.length === 1, "unsocket didn't hand back the Protocol");
  // A mech-scope Protocol: Coolant loop on the pack cuts the hull and speeds the dash.
  const pack = rollItem(13, L, { base: "pack-standin", rarity: "uncommon" });
  socket(pack, coolant);
  fit(lo, "pack", pack);
  const r = resolve(lo);
  must(close(r.values.hull, lo.hull!.stats.hull * 0.9), "Coolant loop's hull cut doesn't add up");
  must(close(r.values.dashRecharge, pack.stats.dashRecharge * 0.7), "Coolant loop's recharge doesn't add up");
  // Cargo capacity: legs' carry plus the hull's racks; weight: everything fitted, Protocols included.
  const salv = rollItem(14, L, { base: "hull-salvager" });
  fit(lo, "hull", salv);
  const r3 = resolve(lo);
  must(close(r3.cargoCapacity, lo.legs!.stats.carry + salv.stats.carryBonus), "cargo capacity isn't carry plus racks");
  must(close(r3.weight, SLOTS.reduce((w, s) => w + (lo[s] ? itemWeight(lo[s]!) : 0), 0)) && r3.weight > 0, "loadout weight doesn't add up");
}

// ---- Rolls: deterministic, inside their ranges, rarity widens both ways ----
{
  for (let s = 1; s < 200; s++) {
    const a = JSON.stringify(rollLoot(s * 7919, L)), b = JSON.stringify(rollLoot(s * 7919, L));
    if (a !== b) { must(false, `seed ${s} rolled two different items`); break; }
  }
  must(JSON.stringify(resolve(defaultLoadout())) === JSON.stringify(resolve(defaultLoadout())), "resolve isn't deterministic");
  const distinct = new Set(Array.from({ length: 50 }, (_, s) => JSON.stringify(rollItem(s + 1, L).stats))).size;
  must(distinct > 40, `only ${distinct} different rolls from 50 seeds`);
  for (const b of BASES) for (const k in b.stats) {
    must(k in STATS, `${b.id}: stat ${k} has no STATS entry`);
    const c = statRange(b, k, "common", L), lg = statRange(b, k, "legendary", L);
    if (b.stats[k].spread > 0) must(lg[0] < c[0] && lg[1] > c[1], `${b.id} ${k}: legendary range ${lg.map((x) => x.toFixed(2))} doesn't widen common ${c.map((x) => x.toFixed(2))} both ways`);
  }
  // Sampled: legendary miniguns roll both weaker and stronger than any common one.
  const dmg = (r: (typeof RARITIES)[number]) => Array.from({ length: 600 }, (_, s) => rollItem(1000 + s, L, { base: "mg-medium", rarity: r }).stats.damage);
  const c = dmg("common"), lg = dmg("legendary");
  must(Math.min(...lg) < Math.min(...c) && Math.max(...lg) > Math.max(...c), "legendary damage rolls don't reach past common both ways");
  const [lo, hi] = statRange(BASE_BY_ID["mg-medium"], "damage", "legendary", L);
  must(lg.every((x) => x >= lo - 1e-9 && x <= hi + 1e-9), "a roll fell outside its range");
  // Rarity weights: a rarity weighted 0 never rolls.
  const none = Array.from({ length: 300 }, (_, s) => rollItem(s + 5, { ...L, weightLegendary: 0 }).rarity).filter((r) => r === "legendary").length;
  must(none === 0, "a rarity weighted 0 rolled");
}

// ---- Cargo ----
{
  const lo = defaultLoadout();
  const cargo = newBag(resolve(lo).cargoCapacity), stash = newBag();
  let refused = 0;
  for (let s = 1; s < 60; s++) { const it = rollItem(s, L, { kind: "legs" }); if (!addTo(cargo, it)) { refused++; addTo(stash, it); } }
  must(refused > 0, "cargo never filled");
  must(bagWeight(cargo) <= cargo.capacity + 1e-9, `cargo over capacity (${bagWeight(cargo)} / ${cargo.capacity})`);
  const big = stash.items[0];
  must(!hasRoom(cargo, big) && !moveItem(stash, cargo, big.id) && stash.items.includes(big), "moved an item into a full cargo");
  must(moveItem(cargo, stash, cargo.items[0].id), "couldn't move from cargo to stash");
  const fitted = SLOTS.map((s) => lo[s]?.id ?? "").join();
  const n = cargo.items.length;
  const lost = loseCargo(cargo);
  must(lost.length === n && cargo.items.length === 0, "losing cargo didn't empty it");
  must(SLOTS.map((s) => lo[s]?.id ?? "").join() === fitted, "losing cargo touched what's fitted");
  must(stash.items.length > 0, "losing cargo touched the stash");
}

// ---- Looks ----
for (const b of BASES) {
  must((LOOKS as readonly string[]).includes(b.look), `${b.id}: unknown look ${b.look}`);
  must(lookFor(makeItem(b.id)) === "rampart", `${b.id}: no model for its look and no Rampart fallback`);
}

// ---- Gun hooks in the upper-body sim ----
{
  const v = { ...UPPER_DEFAULTS };
  const sim = new UpperSim(v);
  sim.reset(0);
  sim.guns[0].enabled = false;
  sim.guns[1].stats = { fireRate: 30, spinUp: 0.3, ammo: 5000, arc: 30, track: 12, damage: 9, spread: 3, range: 45, pierce: 2 };
  sim.resupply();
  const n: Record<number, number> = { 1: 0, [-1]: 0 };
  for (let i = 0; i < 120 * 6; i++) for (const s of sim.update(1 / 120, 0, { x: 0, y: 4.3, z: 0 }, { x: 0, y: 0, z: 20 }, true)) n[s]++;
  must(n[1] === 0 && sim.guns[0].spin === 0, "a gun switched off still spun or fired");
  must(sim.guns[1].ammo === 5000 - n[-1], "a gun's own drum size wasn't used");
  must(n[-1] > 30 * 5 * 0.9, `a gun's own fire rate wasn't used (${n[-1]} rounds in 6 s at 30/s)`);
}

const lo = defaultLoadout(), r = resolve(lo);
console.log(`bases ${BASES.length} · protocols ${PROTOCOLS.length} · default: walk ${r.values.walkSpeed}, hull ${r.values.hull}, guns L ${r.guns.left?.fireRate}/s R ${r.guns.right?.fireRate}/s, cargo ${r.cargoCapacity} t, fitted ${r.weight.toFixed(1)} t`);
if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); throw new Error("loadout check failed"); }
console.log("loadout check passed");
