// Headless repair check (Keith 2026-10-31: repair kits on Q that never refill by themselves; abilities that put down
// heal zones). Kits: never past the max, none used at full hull or on a wreck, the count only falls by use and only
// rises by restock, the repair is the kit's share spread over its time, a destroyed mech loses the kit at work.
// Zones: nothing heals with no kit or zone, nobody outside a zone or after it ends is healed, the owner heals at the
// self share and allies at full, the stack cap holds, the weld heals only its owner and cuts damage while braced,
// cooldowns hold. The same commands give the same hull twice.
// Run: npm test (or npx tsx tools/repair-check.ts).
import { RepairKits, REPAIR_DEFAULTS } from "../src/game/repair";
import { HealZones, type HealTarget } from "../src/abilities/zones";
import { Abilities, ABILITY_DEFAULTS } from "../src/abilities/abilities";
import { defaultLoadout, resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";

const problems: string[] = [];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const dt = 1 / 120;

// A target with health, for both kits and zones.
function unit(id: string, team: number, x: number, z: number, max = 1000, hp = max) {
  const u = { id, team, x, z, alive: true, max, hp, heal(n: number) { if (!u.alive) return 0; const add = Math.max(0, Math.min(n, u.max - u.hp)); u.hp += add; return add; } };
  return u as HealTarget & { hp: number };
}

// --- Kits ---
{
  const v = { ...REPAIR_DEFAULTS };
  const k = new RepairKits(v);
  const u = unit("m", 1, 0, 0, 3000, 3000);
  if (k.count !== v.kitMax) problems.push(`kits start ${k.count}, want ${v.kitMax}`);
  if (k.use(u.hp, u.max, true) !== "full") problems.push("a kit started at full hull");
  if (k.count !== v.kitMax) problems.push("a refused kit was spent");
  u.hp = 1000;
  if (k.use(u.hp, u.max, false) !== "dead") problems.push("a kit started on a wreck");
  if (k.use(u.hp, u.max, true) !== null) problems.push("a kit didn't start on a hurt mech");
  if (k.use(u.hp, u.max, true) !== "working") problems.push("a second kit started over the first");
  let t = 0;
  while (k.progress !== null) { u.heal(k.step(dt)); t += dt; if (t > 30) break; }
  if (!near(t, v.kitTime, 2 * dt)) problems.push(`kit took ${t.toFixed(2)} s, want ${v.kitTime}`);
  if (!near(u.hp, 1000 + v.kitShare * 3000, 1)) problems.push(`kit repaired to ${u.hp.toFixed(1)}, want ${1000 + v.kitShare * 3000}`);
  if (k.use(u.hp, u.max, true) !== "lockout") problems.push("no lockout after a kit");
  // Nothing refills by itself: a minute of steps with no use.
  const before = k.count;
  for (let i = 0; i < 120 * 60; i++) u.heal(k.step(dt));
  if (k.count !== before) problems.push(`kits went ${before} → ${k.count} with no use or restock`);
  // Near the max: never past it.
  u.hp = u.max - 50;
  k.use(u.hp, u.max, true);
  for (let i = 0; i < 120 * 5; i++) u.heal(k.step(dt));
  if (u.hp > u.max + 1e-6) problems.push(`kit healed past the max: ${u.hp}`);
  // Restock caps at the most carried.
  k.restock(99);
  if (k.count !== v.kitMax) problems.push(`restock went to ${k.count}, max ${v.kitMax}`);
  // Destroyed mid-kit: the kit at work is lost.
  u.hp = 500;
  k.use(u.hp, u.max, true);
  for (let i = 0; i < 30; i++) u.heal(k.step(dt));
  k.cut();
  if (k.step(dt) !== 0 || k.progress !== null) problems.push("a cut kit kept repairing");
  // Out of kits.
  const e = new RepairKits({ ...v, kitMax: 1 }, 1);
  e.use(10, 100, true);
  for (let i = 0; i < 1200; i++) e.step(dt);
  if (e.use(10, 100, true) !== "none") problems.push("a kit started with none left");
}

// --- Zones and abilities ---
const av = { ...ABILITY_DEFAULTS };
function run(seedHp: number) {
  const zones = new HealZones(av);
  const me = unit("me", 1, 0, 0, 3000, seedHp), friend = unit("friend", 1, 4, 0, 3000, seedHp);
  const far = unit("far", 1, 40, 0, 3000, seedHp), foe = unit("foe", 2, 1, 0, 3000, seedHp);
  const ab = new Abilities(av);
  ab.fit([{ key: 3, id: "beacon" }, { key: 4, id: "nanite" }]);
  const all = [me, friend, far, foe];
  // Nothing heals with no zone.
  for (let i = 0; i < 600; i++) zones.step(dt, all);
  for (const u of all) if (u.hp !== seedHp) problems.push(`${u.id} healed with no zone`);
  if (ab.use(3, { id: "me", team: 1, x: 0, z: 0, alive: true }, 2, 0, zones) !== null) problems.push("beacon refused when ready");
  if (ab.use(3, { id: "me", team: 1, x: 0, z: 0, alive: true }, 2, 0, zones) !== "cooling") problems.push("beacon used twice inside its cooldown");
  let t = 0;
  while (zones.zones.length && t < 60) { zones.step(dt, all); ab.step(dt); t += dt; }
  if (!near(t, av.beaconTime, 2 * dt)) problems.push(`beacon lasted ${t.toFixed(2)} s, want ${av.beaconTime}`);
  const want = av.beaconRate * 3000 * av.beaconTime;
  if (!near(friend.hp - seedHp, want, 2)) problems.push(`ally healed ${(friend.hp - seedHp).toFixed(1)}, want ${want}`);
  if (!near(me.hp - seedHp, want * av.healSelf, 2)) problems.push(`owner healed ${(me.hp - seedHp).toFixed(1)}, want ${want * av.healSelf} (self share)`);
  if (far.hp !== seedHp) problems.push("a target outside the zone was healed");
  if (foe.hp !== seedHp) problems.push("an enemy in the zone was healed");
  const after = friend.hp;
  for (let i = 0; i < 600; i++) zones.step(dt, all);
  if (friend.hp !== after) problems.push("healed after the zone ended");
  return { me: me.hp, friend: friend.hp, ab };
}
const a = run(500), b = run(500);
if (a.me !== b.me || a.friend !== b.friend) problems.push("the same commands gave different hull");
// Cooldown: ready again only after beaconCooldown.
{
  const ab = new Abilities(av), zones = new HealZones(av);
  ab.fit([{ key: 3, id: "beacon" }]);
  const u = { id: "me", team: 1, x: 0, z: 0, alive: true };
  ab.use(3, u, 0, 0, zones);
  let t = 0;
  while (ab.use(3, u, 0, 0, zones) === "cooling" && t < 200) { ab.step(dt); t += dt; }
  if (!near(t, av.beaconCooldown, 2 * dt)) problems.push(`beacon ready after ${t.toFixed(2)} s, want ${av.beaconCooldown}`);
  // Thrown no further than its range.
  zones.clear();
  ab.step(av.beaconCooldown + 1);
  ab.use(3, u, 500, 0, zones);
  if (!near(Math.hypot(zones.zones[0].x, zones.zones[0].z), av.beaconRange, 1e-6)) problems.push("beacon thrown past its range");
}
// Stack cap: five overlapping zones heal like zoneStack of them.
{
  const zones = new HealZones(av), t1 = unit("t", 1, 0, 0, 1000, 0);
  for (let i = 0; i < 5; i++) zones.add({ owner: `o${i}`, team: 1, x: 0, z: 0, radius: 5, rate: 0.01, left: 1, follow: false, selfOnly: false, kind: "beacon" });
  for (let i = 0; i < 120; i++) zones.step(dt, [t1]);
  const want = 0.01 * av.zoneStack * 1000;
  if (!near(t1.hp, want, 0.5)) problems.push(`stacked zones healed ${t1.hp.toFixed(1)}, want ${want} (cap ${av.zoneStack})`);
}
// Weld: only its owner, at full rate; braced cuts damage, ends on time.
{
  const zones = new HealZones(av), ab = new Abilities(av);
  ab.fit([{ key: 4, id: "weld" }]);
  const me = unit("me", 1, 0, 0, 1000, 0), mate = unit("mate", 1, 0.5, 0, 1000, 0);
  ab.use(4, { id: "me", team: 1, x: 0, z: 0, alive: true }, 0, 0, zones);
  if (!near(ab.damageScale, 1 - av.weldCut, 1e-9)) problems.push("weld didn't cut damage");
  let t = 0;
  while (zones.zones.length && t < 60) { zones.step(dt, [me, mate]); ab.step(dt); t += dt; }
  if (mate.hp !== 0) problems.push("the weld healed someone else");
  if (!near(me.hp, av.weldRate * 1000 * av.weldTime, 1)) problems.push(`weld healed ${me.hp.toFixed(1)}, want ${av.weldRate * 1000 * av.weldTime}`);
  if (ab.braced > 0 || ab.damageScale !== 1) problems.push("still braced after the weld");
}
// Items: the Medic pack brings the beacon on 3, the Salvager the nanite field on 4, the Siege the weld on 4.
{
  const lo = defaultLoadout();
  if (resolve(lo).abilities.length) problems.push("today's mech has an ability it shouldn't");
  lo.pack = makeItem("pack-medic"); lo.hull = makeItem("hull-salvager");
  const r = resolve(lo).abilities.map((x) => `${x.key}:${x.id}`).join(",");
  if (r !== "3:beacon,4:nanite") problems.push(`Medic pack + Salvager gave ${r}`);
  lo.hull = makeItem("hull-siege");
  if (!resolve(lo).abilities.some((x) => x.key === 4 && x.id === "weld")) problems.push("Siege hull has no weld");
}

if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("repair check failed"); }
console.log(`repair check ok: kits (share, time, lockout, cap, no refill, cut), zones (radius, team, self share ${av.healSelf}, stack ${av.zoneStack}, end), weld, cooldowns, items`);
