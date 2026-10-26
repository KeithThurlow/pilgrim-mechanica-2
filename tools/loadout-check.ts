// Headless loadout check (src/items): the mount rules (Keith 2026-10-26: each hull mount a hull weapon or an arm with a
// held weapon and a shoulder weapon; a two-hander needs both arms; the hull says which mounts it offers), the cascades
// both ways, a mixed build, waist drums feeding their own side, a back weapon in place of the pack, the sensor's radar
// range reaching the expedition radar and its seekers, sensor styles (a head needs a front socket, a cluster a top one;
// a head's aim help reaches the lock cone and the guns' tracking), migrating a save from before the mounts without losing items,
// sockets by rarity and Protocols only by tags, stats that add up and are the same for the same seed, rarity widening
// rolls both ways, the cargo weight limit, losing cargo leaving what's fitted, every base drawn by a known model look,
// the per-gun hooks in the upper-body sim, and the default loadout giving exactly today's mech values (so nothing
// changes until something else is fitted). Run: npm test.
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { UPPER_DEFAULTS, UpperSim } from "../src/mech/upper";
import { DASH_DEFAULTS } from "../src/mech/dash";
import { MECH_DEFAULTS, type MechUnit } from "../src/game/mechUnit";
import { applyLoadout } from "../src/game/loadoutApply";
import { BASES, BASE_BY_ID, STATS } from "../src/items/bases";
import { PROTOCOLS } from "../src/items/protocols";
import { RARITIES, RARITY } from "../src/items/rarity";
import { LOOKS, lookFor, itemWeight, type Item } from "../src/items/item";
import { LOOT_DEFAULTS, rollItem, rollLoot, rollProtocol, makeItem, statRange } from "../src/items/generate";
import {
  defaultLoadout, emptyLoadout, fit, fitProblem, unfit, problems, resolve, socket, socketProblem, unsocket, bestHeld, SLOTS, LOADOUT_DEFAULTS,
  type Loadout,
} from "../src/items/loadout";
import { readBay, bayToJson } from "../src/items/bayState";
import { loadoutFor } from "../src/items/weaponPick";
import { newBag, addTo, bagWeight, moveItem, loseCargo, hasRoom } from "../src/items/cargo";
import { RADAR_DEFAULTS, radarPicture, RadarZoom, type RadarWorld } from "../src/expedition/radar";
import { Seeker, SEEKER_DEFAULTS, seekNearest } from "../src/expedition/seekers";
import { SALVAGE_DEFAULTS, SalvageSim } from "../src/pois/salvage";
import { HeadDriver, HEAD_DEFAULTS } from "../src/mech/head";

const fails: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) fails.push(what); };
const L = LOOT_DEFAULTS;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const mk = (base: string, id = base + Math.random().toString(36).slice(2, 6)) => makeItem(base, "common", id);

// ---- The default loadout is today's mech ----
{
  const lo = defaultLoadout();
  must(problems(lo).length === 0, `default loadout has problems: ${problems(lo).join("; ")}`);
  const r = resolve(lo);
  const today: Record<string, number> = {
    ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...UPPER_DEFAULTS, ...DASH_DEFAULTS,
    hull: MECH_DEFAULTS.hull, roundDamage: MECH_DEFAULTS.roundDamage, roundPierce: MECH_DEFAULTS.roundPierce,
    mechRadar: RADAR_DEFAULTS.mechRadar, gearSalvage: 1,
    // The default visor head's small lock help (Keith 2026-10-26: hulls have heads; the one value that's new).
    sensorLock: makeItem("sensor-visor").stats.lockAssist,
  } as Record<string, number>;
  for (const [k, val] of Object.entries(r.values)) must(today[k] === val, `default loadout ${k} = ${val}, today ${today[k]}`);
  for (const [name, g] of [["left", r.guns.left], ["right", r.guns.right]] as const) {
    must(!!g, `default loadout has no ${name} gun`);
    if (!g) continue;
    const want = { fireRate: today.fireRate, spinUp: today.spinUp, ammo: today.ammoPerGun, arc: today.podYawMax, track: today.podTrack, damage: today.roundDamage, spread: today.spread, range: today.range, pierce: today.roundPierce };
    for (const [k, val] of Object.entries(want)) must((g as unknown as Record<string, number>)[k] === val, `default ${name} gun ${k} = ${(g as unknown as Record<string, number>)[k]}, today ${val}`);
  }
  must(r.parts.drumsL && r.parts.drumsR && r.parts.pack && r.parts.sensor && r.parts.mountL === "gun" && r.parts.mountR === "gun", `default parts wrong: ${JSON.stringify(r.parts)}`);
  must(r.seekers.join() === "scrap", `the default head's seekers are ${r.seekers.join()}, want scrap`);
  must(r.parts.sensorId === "sensor-visor" && r.parts.sensorStyle === "head", `the default sensor isn't the visor head: ${r.parts.sensorId} ${r.parts.sensorStyle}`);
}

// ---- Sensor styles: a head on a front socket, a cluster on a top socket ----
{
  const head = mk("sensor-visor"), optic = mk("sensor-optic"), mast = mk("sensor-mast"), dish = mk("sensor-dish");
  for (const b of BASES.filter((x) => x.kind === "sensor")) must(!!b.sensor?.style, `${b.id}: a sensor with no style`);
  for (const b of BASES.filter((x) => x.kind === "hull")) must(!!b.mounts && Array.isArray(b.mounts.sensor), `${b.id}: no sensor sockets listed`);
  must(BASES.some((b) => b.kind === "sensor" && b.sensor?.style === "head") && BASES.some((b) => b.kind === "sensor" && b.sensor?.style === "cluster"), "no head or no cluster among the sensors");
  const on = (hullBase: string) => { const lo = defaultLoadout(); lo.sensor = null; lo.hull = mk(hullBase); return lo; };
  // Rampart: front and top; Siege: top only; Salvager: front only.
  must(!fitProblem(on("hull-rampart"), "sensor", head) && !fitProblem(on("hull-rampart"), "sensor", mast), "the Rampart hull (front and top) refused a head or a cluster");
  must(!fitProblem(on("hull-salvager"), "sensor", head) && !fitProblem(on("hull-salvager"), "sensor", optic), "a head refused on a hull with a front socket");
  must(!!fitProblem(on("hull-siege"), "sensor", head), "a head fitted on a top-only hull");
  must(!fitProblem(on("hull-siege"), "sensor", dish), "a cluster refused on a hull with a top socket");
  must(!!fitProblem(on("hull-salvager"), "sensor", mast), "a cluster fitted on a front-only hull");
  // Swapping to a top-only hull bounces a fitted head to the stash, not lost.
  const lo = defaultLoadout();
  const off = fit(lo, "hull", mk("hull-siege"));
  must(!lo.sensor && off.some((i) => i.base === "sensor-visor"), "a head stayed on (or was lost) after swapping to a top-only hull");
  must(problems(lo).length === 0, `the Siege swap left problems: ${problems(lo).join("; ")}`);
  // A head's aim help: the lock cone and the guns' tracking; a cluster gives none.
  const a = defaultLoadout(); fit(a, "sensor", optic);
  const ra = resolve(a), r0 = resolve(defaultLoadout());
  must(ra.values.sensorLock === optic.stats.lockAssist && close(ra.guns.right!.track, r0.guns.right!.track * (1 + optic.stats.trackAssist)), "a head's lock and tracking help didn't reach the values");
  const c = defaultLoadout(); fit(c, "sensor", mast);
  const rc = resolve(c);
  must(rc.values.sensorLock === 0 && rc.guns.right!.track === r0.guns.right!.track && rc.parts.sensorStyle === "cluster", "a cluster helped the aim");
  must(rc.values.mechRadar > r0.values.mechRadar, "the mast doesn't reach further than the default head");
}

// ---- The head's motion (cosmetic, src/mech/head.ts): turns toward the aim, never past its limits, scans with none ----
{
  const v = { ...HEAD_DEFAULTS }, R = Math.PI / 180, h = new HeadDriver();
  let maxYaw = 0, maxRate = 0, prev = 0;
  for (let i = 0; i < 120; i++) { h.step(1 / 60, { aim: { x: 10, y: -3, z: 6 }, torsoBehind: 0 }, v); maxRate = Math.max(maxRate, Math.abs(h.yaw - prev) * 60); prev = h.yaw; }
  must(Math.abs(h.yaw - Math.atan2(10, 6)) < 0.03, `the head didn't settle on an aim to its left (${(h.yaw / R).toFixed(1)}°)`);
  must(h.pitch < 0 && h.pitch >= -v.headPitchDown * R - 1e-6, "the head didn't look down at a point below it");
  must(maxRate <= v.headTurnRate * R * 1.01, `the head turned faster than its rate (${(maxRate / R).toFixed(0)}°/s)`);
  for (let i = 0; i < 240; i++) { h.step(1 / 60, { aim: { x: -5, y: 8, z: -9 }, torsoBehind: 0 }, v); maxYaw = Math.max(maxYaw, Math.abs(h.yaw)); }
  must(maxYaw <= v.headYawMax * R + 1e-6 && h.pitch <= v.headPitchUp * R + 1e-6, "the head went past its yaw or pitch limit for an aim behind it");
  // Leading: with the torso still turning toward an aim, the head looks further round than the aim itself.
  const lead = new HeadDriver();
  for (let i = 0; i < 120; i++) lead.step(1 / 60, { aim: { x: 2, y: 0, z: 10 }, torsoBehind: 0.6 }, v);
  must(lead.yaw > Math.atan2(2, 10) + 0.05, "the head doesn't lead a turning torso");
  let scanMax = 0;
  for (let i = 0; i < 60 * 20; i++) { h.step(1 / 60, { aim: null, torsoBehind: 0 }, v); if (i > 60 * 4) scanMax = Math.max(scanMax, Math.abs(h.yaw)); }
  must(scanMax > v.headScanWidth * R * 0.6 && scanMax <= v.headScanWidth * R * 1.15, `the idle scan doesn't sweep its width (${(scanMax / R).toFixed(1)}°)`);
}

// ---- Mount rules and cascades ----
{
  const lo = defaultLoadout();
  const light = mk("mg-light", "l1"), heavy = mk("mg-heavy", "h1"), med = mk("mg-medium", "m1");
  const armA = mk("arm-rampart", "a1"), armB = mk("arm-rampart", "a2"), missiles = mk("sh-missiles", "s1");
  must(!!fitProblem(lo, "heldL", light), "a held weapon fitted with a hull weapon on that mount");
  must(!!fitProblem(lo, "shoulderL", missiles), "a shoulder weapon fitted with a hull weapon on that mount");
  must(!!fitProblem(lo, "heldR", heavy), "a two-hander fitted with hull weapons on both mounts");
  must(!!fitProblem(lo, "heldL", med), "a hull weapon was held");
  must(!!fitProblem(lo, "mountL", light), "a Light weapon fitted as a hull weapon");
  must(!!fitProblem(lo, "mountL", heavy), "a Heavy weapon fitted as a hull weapon");
  must(!fitProblem(lo, "mountL", med), "a Medium weapon refused on a hull mount");
  must(!!fitProblem(lo, "legs", med) && !!fitProblem(lo, "pack", armA) && !!fitProblem(lo, "waistL", missiles) && !!fitProblem(lo, "sensor", light), "wrong kinds accepted");
  // An arm on the left: the hull weapon comes off; then a held weapon and a shoulder weapon fit on that side only.
  const off = fit(lo, "mountL", armA);
  must(off.length === 1 && off[0].id === "default-mg-medium-L", "an arm in place of a hull weapon didn't hand back the hull weapon");
  must(!fitProblem(lo, "heldL", light) && !fitProblem(lo, "shoulderL", missiles), "a held or shoulder weapon refused with an arm on that mount");
  must(!!fitProblem(lo, "shoulderR", missiles), "a shoulder weapon fitted on the right with a hull weapon there");
  fit(lo, "heldL", light);
  fit(lo, "shoulderL", missiles);
  const g = resolve(lo).guns.left!;
  must(g?.damage === light.stats.damage, "the left gun isn't the held weapon");
  must(close(g.arc, armA.stats.arc + light.stats.arcBonus), "the held gun's arc isn't its arm's plus its own");
  must(close(g.track, armA.stats.track * light.stats.handling), "the held gun's tracking isn't its arm's times its handling");
  must(close(resolve(lo).values.gearSalvage, 1 + armA.stats.salvage), "the arm's salvage speed didn't count");
  // The mixed build (Keith's example): a hull weapon on the right, an arm with a held weapon and a shoulder weapon on
  // the left; and its mirror.
  must(problems(lo).length === 0, `mixed build has problems: ${problems(lo).join("; ")}`);
  const mix = resolve(lo);
  must(!!mix.guns.left && !!mix.guns.right && mix.parts.mountL === "arm" && mix.parts.mountR === "gun", "the mixed build doesn't fire from both sides or shows the wrong mounts");
  must(JSON.stringify(mix.shoulders.map((x) => [x.key, x.weapon, x.mount])) === JSON.stringify([[1, "missiles", "shoulderL"]]), "the left shoulder weapon isn't on key 1");
  const mirror = loadoutFor({ left: "rpg", right: "minigun", k1: "none", k2: "missiles", k3: "pack" });
  const mr = resolve(mirror);
  must(problems(mirror).length === 0 && mr.guns.left?.cls === "rpg" && mirror.mountR?.kind === "arm" && mirror.heldR?.base === "mg-light" && mr.shoulders[0]?.key === 2,
    `the quick pick's mixed build (hull rocket left, arm + light minigun + missiles right) came out wrong: ${problems(mirror).join("; ")}`);
  // Cascade the other way: a hull weapon back on the left bounces the arm, the held weapon and the shoulder weapon.
  const off2 = fit(lo, "mountL", med);
  must(["a1", "l1", "s1"].every((id) => off2.some((i) => i.id === id)) && !lo.heldL && !lo.shoulderL, "a hull weapon in place of an arm didn't bounce the arm, held and shoulder weapons");
  // Two-handed: one arm isn't enough; both arms take it in both hands.
  fit(lo, "mountL", armA);
  must(!!fitProblem(lo, "heldR", heavy) && !!fitProblem(lo, "heldL", heavy), "a two-hander fitted with one arm");
  fit(lo, "mountR", armB);
  must(!fitProblem(lo, "heldL", heavy) && !fitProblem(lo, "heldR", heavy), "a two-hander refused with both arms");
  fit(lo, "heldL", light);
  const off3 = fit(lo, "heldL", heavy);
  must(lo.heldR === heavy && lo.heldL === null && off3.some((i) => i.id === "l1"), "the two-hander doesn't take both hands or didn't hand back the left held weapon");
  must(problems(lo).length === 0, `two-hander loadout has problems: ${problems(lo).join("; ")}`);
  const r2 = resolve(lo);
  must(!r2.guns.left && !!r2.guns.right && r2.guns.right.damage === heavy.stats.damage, "a two-hander should fire as one gun on the right");
  // A hull weapon on either side bounces the two-hander (it needs both arms).
  const lo2 = { ...lo } as Loadout;
  const off4 = fit(lo2, "mountL", mk("mg-medium", "m2"));
  must(off4.some((i) => i.id === "h1") && !lo2.heldR, "a hull weapon on one side didn't bounce the two-hander");
  // A one-hander back in a hand drops the two-hander.
  const off5 = fit(lo, "heldL", light);
  must(off5.some((i) => i.id === "h1") && lo.heldR === null && lo.heldL === light, "a one-hander in a hand didn't drop the two-hander");
  // Unfit an arm: its held and shoulder weapons come off with it.
  fit(lo, "shoulderL", missiles);
  const off6 = unfit(lo, "mountL");
  must(off6.length === 3 && !lo.heldL && !lo.shoulderL, "taking an arm off didn't take its held and shoulder weapons");
  must(unfit(lo, "legs").length === 0 && !!lo.legs, "legs came off");
  // Auto-fit: a new arm gets the rarest one-handed weapon on offer.
  const pool: Item[] = [rollItem(5, L, { base: "mg-light", rarity: "common" }), rollItem(6, L, { base: "rail-light", rarity: "epic" }), rollItem(7, L, { base: "mg-heavy", rarity: "legendary" })];
  fit(lo, "mountL", armA);
  must(bestHeld(lo, "L", pool)?.base === "rail-light", "the auto-fit didn't pick the rarest one-handed weapon");
  // The hull decides the mounts: the Salvager's right mount takes only an arm.
  const sv = defaultLoadout();
  const offH = fit(sv, "hull", mk("hull-salvager"));
  must(offH.some((i) => i.id === "default-mg-medium-R") && !sv.mountR && !!sv.mountL, "a hull without a hull weapon mount on the right didn't bounce the right hull weapon");
  must(!!fitProblem(sv, "mountR", med) && !fitProblem(sv, "mountR", armB), "the Salvager's right mount should take an arm and no hull weapon");
  must(!!fitProblem(emptyLoadout(), "mountL", med), "a hull weapon fitted with no hull");
}

// ---- Waist, pack and sensor ----
{
  const lo = defaultLoadout();
  // Each drum feeds its own side.
  const full = rollItem(21, L, { base: "waist-fulldrums" });
  fit(lo, "waistR", full);
  let r = resolve(lo);
  must(r.guns.right!.ammo === full.stats.ammoPerGun && r.guns.left!.ammo === UPPER_DEFAULTS.ammoPerGun, "a waist drum didn't feed only its own side's gun");
  unfit(lo, "waistL");
  r = resolve(lo);
  must(r.guns.left!.ammo === LOADOUT_DEFAULTS.bareAmmo && r.parts.drumsR && !r.parts.drumsL, "a gun with no drum on its side doesn't fall back to the bare feed");
  // A cargo rack on the waist adds to the cargo.
  const rack = rollItem(22, L, { base: "waist-rack" });
  const cap0 = r.cargoCapacity;
  fit(lo, "waistL", rack);
  must(close(resolve(lo).cargoCapacity, cap0 + rack.stats.carryBonus), "a cargo rack didn't add to the cargo");
  // A back weapon in place of the pack: key 3, and the dash falls back to the bare values.
  const off = fit(lo, "pack", mk("sh-mortar"));
  r = resolve(lo);
  must(off.some((i) => i.base === "pack-standin") && r.shoulders.some((s) => s.key === 3 && s.weapon === "mortar" && s.mount === "back") && !r.parts.pack, "a back weapon didn't replace the pack on key 3");
  must(r.values.dashCharges === LOADOUT_DEFAULTS.bareDashCharges && r.values.dashRecharge === LOADOUT_DEFAULTS.bareDashRecharge, "no pack doesn't fall back to the bare dash");
  // No sensor: the bare scope, no seekers.
  unfit(lo, "sensor");
  r = resolve(lo);
  must(r.values.mechRadar === LOADOUT_DEFAULTS.bareRadar && r.seekers.length === 0 && !r.parts.sensor, "no sensor doesn't fall back to the bare radar");
  // Rarer sensors: one more seeker mode per tier, longer range.
  const counts = RARITIES.map((q) => rollItem(30, L, { base: "sensor-dish", rarity: q }).seekers!.length);
  must(counts.join() === "1,2,3,4,4", `seeker modes by rarity are ${counts.join()}, want 1,2,3,4,4`);
  const mean = (q: (typeof RARITIES)[number]) => Array.from({ length: 200 }, (_, s) => rollItem(500 + s, L, { base: "sensor-dish", rarity: q }).stats.radarRange).reduce((a, b) => a + b) / 200;
  must(mean("legendary") > mean("common") * 1.25, "legendary sensors don't reach further on average");
}

// ---- The sensor's range reaches the expedition radar; seekers point at the nearest match ----
{
  const lo = defaultLoadout();
  const dish = rollItem(41, L, { base: "sensor-dish", rarity: "epic" });
  fit(lo, "sensor", dish);
  // A stand-in mech unit: applyLoadout writes the values into its tuning, which is the lab's V the loop reads.
  const unit = { v: { ...RADAR_DEFAULTS }, upper: { guns: [{}, {}], resupply() {} }, body: {}, alive: false, dash: {} } as unknown as MechUnit;
  applyLoadout(unit, resolve(lo));
  const V = unit.v as unknown as typeof RADAR_DEFAULTS & typeof SEEKER_DEFAULTS;
  Object.assign(V, SEEKER_DEFAULTS);
  must(V.mechRadar === dish.stats.radarRange, `the sensor's range didn't reach the radar values (${V.mechRadar} vs ${dish.stats.radarRange})`);
  const at = (d: number) => ({ id: `p${d}`, x: d, z: 0, tier: 1, kind: "outcrop" });
  const w: RadarWorld = { mech: { x: 0, z: 0 }, convoy: [], route: [], home: null, pois: [at(dish.stats.radarRange - 10)], blobs: [], unknown: [], contacts: [] };
  must(radarPicture(V, w, "mech").range === dish.stats.radarRange && radarPicture(V, w, "mech").blips.length === 1, "the mech radar doesn't use the sensor's range");
  const z = new RadarZoom(V, "mech");
  must(close(z.range, dish.stats.radarRange), "the radar zoom doesn't sit at the sensor's range");
  applyLoadout(unit, resolve(defaultLoadout()));
  must(radarPicture(V, w, "mech").blips.length === 0, "a POI past the mast's range still showed on the mech radar");
  // Seekers.
  const pois: RadarWorld["pois"] = [
    { id: "near-rock", x: 50, z: 0, tier: 1, kind: "outcrop" },
    { id: "stripped-wreck", x: 60, z: 0, tier: 1, kind: "wreckPart", stripped: true },
    { id: "fogged-convoy", x: 0, z: 90, tier: 2, kind: "deadConvoy" },
    { id: "far-wreck", x: -300, z: 0, tier: 1, kind: "wreckPart" },
    { id: "field", x: 0, z: -400, tier: 2, kind: "debrisField" },
  ];
  const sw: RadarWorld = { ...w, pois, unknown: [{ id: "u", x: 0, z: 90, r: 30 }] };
  must(seekNearest("scrap", V, sw)?.id === "near-rock", "the scrap seeker didn't pick the nearest POI");
  must(seekNearest("wreck", V, sw)?.id === "far-wreck", "the wreck seeker didn't skip a stripped wreck or picked a non-wreck");
  must(seekNearest("rare", V, sw)?.id === "field", "the rare seeker didn't skip a POI in an unknown area");
  must(seekNearest("legendary", V, sw) === null, "the legendary seeker found something with no tier 3+ POIs");
  const sk = new Seeker();
  sk.setModes(dish.seekers!);
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) { seen.add(sk.mode!); sk.cycle(); }
  must(seen.size === dish.seekers!.length, "cycling didn't reach every seeker mode");
  sk.setModes(["wreck"]);
  must(sk.mode === "wreck" && sk.label(seekNearest("wreck", V, sw)).includes("Wrecks"), "the seeker label is wrong");
  // Salvage: the gear speeds the mech's stripping, not the pilot's by hand.
  const sim = new SalvageSim({ ...SALVAGE_DEFAULTS, gearSalvage: 2 });
  const spot = { id: "s", x: 0, z: 0, time: 10, value: 5, label: "x" };
  sim.add({ place: { id: "p" }, sections: [{ name: "a", value: 5, spots: [spot] }] } as never);
  sim.update(1, 0, 0, true);
  const mech = sim.spots[0].progress;
  sim.spots[0].progress = 0;
  sim.update(1, 0, 0, true, 7, 1, 1, false);
  must(close(mech, 0.2) && close(sim.spots[0].progress, 0.1), `gear salvage speed wrong (mech ${mech}, by hand ${sim.spots[0].progress})`);
}

// ---- Saved bays: v1 (before the mounts) migrates without losing items; v2 round-trips ----
{
  const old = (base: string, oldBase: string, kind: string, id: string): Item => ({ ...makeItem(base, "common", id), base: oldBase, kind: kind as Item["kind"] });
  const armR = rollItem(61, L, { base: "arm-wildcat", rarity: "rare" }), handR = rollItem(62, L, { base: "mg-light", rarity: "epic" });
  const shL = rollItem(63, L, { base: "sh-missiles", rarity: "rare" }), shR = rollItem(64, L, { base: "sh-mortar" });
  const fullBack = { ...rollItem(65, L, { base: "waist-fulldrums", rarity: "epic" }), base: "back-fulldrums", kind: "back" as Item["kind"] };
  const v1 = {
    v: 1, seed: 99,
    loadout: {
      legs: makeItem("legs-rampart"), hull: makeItem("hull-rampart"), armL: makeItem("mg-medium", "common", "default-mg-medium-L"), armR, handL: null, handR,
      shoulderL: shL, shoulderR: shR, pack: makeItem("pack-standin"), back: old("waist-drums", "back-drums", "back", "default-back-drums"),
    },
    stash: [fullBack, { ...makeItem("legs-stilt"), base: "legs-gone" }, rollProtocol(66, "overpressure")],
    cargo: [rollItem(67, L, { base: "rail-light" })],
  };
  const count = (j: typeof v1) => Object.values(j.loadout).filter(Boolean).length + j.stash.length + j.cargo.length;
  const before = count(v1);
  const st = readBay(JSON.parse(JSON.stringify(v1)))!;
  must(!!st, "a v1 save didn't read back");
  if (st) {
    const lo = st.loadout;
    const after = SLOTS.filter((s) => lo[s]).length + st.stash.items.length + st.cargo.items.length;
    // One unknown base dropped; the default drums gained a right-hand twin; the default mast added.
    must(after === before - 1 + 1 + 1, `items lost or made up in the migration (${before} before, ${after} after)`);
    must(lo.mountL?.base === "mg-medium" && lo.mountR?.id === armR.id && lo.heldR?.id === handR.id && lo.shoulderR?.id === shR.id, "the v1 arm mounts, hands and shoulders didn't land on the new slots");
    must(!lo.shoulderL && st.stash.items.some((i) => i.id === shL.id), "a v1 shoulder weapon on a side with a hull weapon didn't go to the stash");
    must(lo.waistL?.base === "waist-drums" && lo.waistR?.base === "waist-drums" && lo.waistL.kind === "waist", "the v1 back drums didn't become waist drums on both sides");
    must(st.stash.items.some((i) => i.id === fullBack.id && i.base === "waist-fulldrums" && i.kind === "waist"), "a stashed v1 drum wasn't renamed to a waist item");
    must(!!lo.sensor && problems(lo).length === 0, `the migrated loadout has problems: ${problems(lo).join("; ")}`);
    must((st.notes?.length ?? 0) >= 2, "the migration left no notes");
    must(st.seed === 99, "the loot seed was lost");
    const again = readBay(JSON.parse(JSON.stringify(bayToJson(st))))!;
    must(JSON.stringify(bayToJson(again)) === JSON.stringify(bayToJson(st)) && !again.notes, "a v2 save doesn't round-trip");
  }
  // A v1 back weapon with a pack fitted goes to the stash; without one it takes the pack mount.
  const withPack = readBay({ v: 1, loadout: { legs: makeItem("legs-rampart"), hull: makeItem("hull-rampart"), pack: makeItem("pack-standin"), back: makeItem("sh-linemortar", "common", "lm") }, stash: [], cargo: [] })!;
  must(withPack.stash.items.some((i) => i.id === "lm") && withPack.loadout.pack?.base === "pack-standin", "a v1 back weapon with a pack didn't go to the stash");
  const noPack = readBay({ v: 1, loadout: { legs: makeItem("legs-rampart"), hull: makeItem("hull-rampart"), back: makeItem("sh-linemortar", "common", "lm") }, stash: [], cargo: [] })!;
  must(noPack.loadout.pack?.id === "lm", "a v1 back weapon without a pack didn't take the pack mount");
  must(readBay({ v: 7 }) === null && readBay(null) === null, "an unknown save version read back");
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
  fit(lo, "mountL", gun);
  const g = resolve(lo).guns.left!;
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
  // Extended feed (ammo) fits a waist drum.
  must(!socketProblem(rollItem(14, L, { base: "waist-drums", rarity: "rare" }), rollProtocol(5, "extendedFeed")), "Extended feed refused by a waist drum");
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
  // Every hull offers mounts; every kind of base can be fitted somewhere on the default mech (or with arms).
  for (const b of BASES) if (b.kind === "hull") must(!!b.mounts && b.mounts.hull.length >= 2, `${b.id}: a hull with no hull mounts`);
  const armed = defaultLoadout();
  fit(armed, "mountL", mk("arm-rampart")); fit(armed, "mountR", mk("arm-rampart"));
  for (const b of BASES) must(SLOTS.some((s) => !fitProblem(armed, s, makeItem(b.id)) || !fitProblem(defaultLoadout(), s, makeItem(b.id))), `${b.id} fits no slot`);
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
console.log(`bases ${BASES.length} · protocols ${PROTOCOLS.length} · default: walk ${r.values.walkSpeed}, hull ${r.values.hull}, guns L ${r.guns.left?.fireRate}/s R ${r.guns.right?.fireRate}/s, radar ${r.values.mechRadar} m, cargo ${r.cargoCapacity} t, fitted ${r.weight.toFixed(1)} t`);
if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); throw new Error("loadout check failed"); }
console.log("loadout check passed");
