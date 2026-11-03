// Balance sheet (docs/proposal-balance.md): reads the live item, weapon, Protocol and enemy tables and prints, for every
// weapon and shoulder launcher at level 1 Common (middle rolls): its effective DPS against five reference target sets,
// the share of its slot's budget that is, time to kill per enemy, what each Protocol is worth against each set (its
// niche is the best one), magazines, level growth, and how long the player mech lasts under fire. A model, not the sim:
// hit chance and area are expected values from simple geometry (seeded Monte Carlo).
//   npx tsx tools/balance-sheet.ts           the live values
//   npx tsx tools/balance-sheet.ts --check   exit 1 if a weapon is over 130% of its budget against its best set, or a
//                                            behaviour Protocol's niche multiplier is outside ×1.1-1.5 (npm test)
// Cadence (damage, rounds per shot, sustained shots/s over the magazine and reload) comes from src/items/dps.ts, the
// The model itself lives in src/items/balanceModel.ts (shared with the weapon review lab, labs/weaponreview/).
import { BASE_BY_ID } from "../src/items/bases";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { INFANTRY_DEFAULTS } from "../src/combat/infantry";
import { PEN_DEFAULTS } from "../src/game/sheet";
import { PROTOCOLS, protocolFits } from "../src/items/protocols";
import { LOOT_DEFAULTS, makeItem } from "../src/items/generate";
import { levelPower } from "../src/items/level";
import { dpsOf, itemDpsPair } from "../src/items/dps";
import { REF, armourFloor, thru, wOf, withProtos, WEAPON_IDS, targets, OTHERS, eDps, ttk, HULL, RB, WB, type T } from "../src/items/balanceModel";

const proc = (globalThis as unknown as { process: { argv: string[]; exit(c: number): never } }).process;
const args = proc.argv.slice(2);
const CHECK = args.includes("--check");
if (args.includes("--proposed")) console.log("(--proposed is gone: the proposal's values are live since 2026-10-31)");

const WD = { ...WEAPON_DEFAULTS };

// ---------------------------------------------------------------- printing
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lp = (s: string | number, n: number) => String(s).padStart(n);
const f0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toString() : "-");
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const problems: string[] = [];

const W_ = WEAPON_IDS.map((id) => wOf(makeItem(id))), T_ = targets();
console.log(`=== Balance sheet (live values), level 1 Common, middle rolls; budget ${REF.budget} eDPS per mount; armour floor ${armourFloor} ===`);
console.log(`targets: ${T_.map((t) => `${t.name} hp ${t.hp}${t.armour ? ` arm ${t.armour}` : ""}`).join(" | ")}`);
console.log(`(budget % uses set weights ${JSON.stringify(REF.setWeight)})\n`);

// 1. Items: cadence (the cards' numbers) and the rest of what the model reads.
console.log("-- Items (cadence from src/items/dps.ts: the card's DPS is damage × rounds × sustained shots/s) --");
console.log(pad("item", 20) + lp("slot", 5) + lp("dmg", 7) + lp("/vol", 5) + lp("shots/s", 8) + lp("sust", 6) + lp("mag", 5) + lp("reload", 7) + lp("card", 6) + lp("area", 6) + lp("pen", 6) + lp("ap", 5) + lp("speed", 7) + lp("range", 6));
for (const w of W_) {
  const c = w.cad;
  console.log(pad(w.name, 20) + lp(w.slot, 5) + lp(f1(w.dmg), 7) + lp(c.rounds, 5) + lp(c.rate.toFixed(2), 8) + lp(c.sustained.toFixed(2), 6) + lp(c.magazine || "-", 5) + lp(c.reload ? c.reload.toFixed(1) : "-", 7)
    + lp(f0(dpsOf(c)), 6) + lp(f1(w.radius), 6) + lp(f1(w.pen), 6) + lp(w.ap.toFixed(2), 5) + lp(Number.isFinite(w.speed) ? f0(w.speed) : w.flight ? `${w.flight}s` : "inst", 7) + lp(w.range, 6));
}

// 2. Effective DPS matrix and budget share.
console.log("\n-- Effective DPS (sustained) by target set; [% of slot budget]; role = best set --");
console.log(pad("item", 20) + T_.map((t) => lp(t.id, 14)).join("") + "   best   off-role mean");
for (const w of W_) {
  const budget = REF.budget * REF.slotShare[w.slot];
  const e = T_.map((t) => eDps(w, t));
  const pct = e.map((x, i) => (100 * x) / (budget * (REF.setWeight[T_[i].id] ?? 1)));
  const best = Math.max(...pct), bi = pct.indexOf(best);
  const off = pct.filter((_, i) => i !== bi), offMean = off.reduce((a, b) => a + b, 0) / off.length;
  if (best > (REF.bandOver[w.id]?.[T_[bi].id] ?? 130)) problems.push(`${w.name} ${f0(best)}% of budget vs ${T_[bi].id}`);
  console.log(pad(w.name, 20) + e.map((x, i) => lp(`${f0(x)} [${f0(pct[i])}]`, 14)).join("") + `   ${pad(T_[bi].id, 9)} ${f0(offMean)}%`);
}

// 3. Time to kill.
console.log("\n-- Time to kill, one weapon alone (s; '-' out of range or no damage) --");
const ttkRows: [string, number, T][] = T_.filter((t) => t.id !== "swarm").map((t) => [t.name, t.hp, t]);
ttkRows.unshift(["Scrapper (one)", T_[0].hp, { ...T_[0], swarm: undefined, dist: 20 }]);
ttkRows.unshift(["Scrapper pack (36)", T_[0].hp * T_[0].swarm!.n, T_[0]]);
for (const [name, hp, arm, like] of OTHERS) {
  const b = T_.find((t) => t.id === like)!;
  ttkRows.push([name, hp, { ...b, swarm: undefined, armour: arm, hp, r: like === "swarm" ? INFANTRY_DEFAULTS.banditRadius : b.r, penDensity: like === "swarm" ? PEN_DEFAULTS.penFlesh : b.penDensity }]);
}
console.log(pad("enemy", 20) + lp("hp", 6) + lp("arm", 4) + W_.map((w) => lp(w.id.replace("sh-", "").slice(0, 9), 10)).join(""));
for (const [name, hp, t] of ttkRows) console.log(pad(name, 20) + lp(hp, 6) + lp(t.armour, 4) + W_.map((w) => lp(f1(ttk(w, t, hp)), 10)).join(""));
const PAIRS: [string, string][] = [["mg-medium", "mg-medium"], ["mg-medium", "rail-medium"], ["ac-medium", "rpg-medium"], ["rail-medium", "ac-medium"], ["mg-medium", "rpg-medium"]];
console.log("\n-- Time to kill with a pair on the two mounts (both firing: 1/(1/a + 1/b) of the single times; s) --");
console.log(pad("enemy", 20) + PAIRS.map(([a, b]) => lp(`${a.split("-")[0]}+${b.split("-")[0]}`, 11)).join(""));
for (const [name, hp, t] of ttkRows) {
  console.log(pad(name, 20) + PAIRS.map(([a, b]) => {
    const wa = W_.find((x) => x.id === a)!, wb = W_.find((x) => x.id === b)!;
    return lp(f1(1 / (1 / ttk(wa, t, hp) + 1 / ttk(wb, t, hp))), 11);
  }).join(""));
}

// 4. Protocols: × each one gives its weapon against every set; its niche is the best. Cards show base → with.
console.log("\n-- Protocols (multiply; Keith 2026-10-31): × the plain weapon's eDPS per target set within a magazine; niche = best set;");
console.log("   sust = the niche × over magazines and reloads (the cost of extra rounds); card = the item card's DPS, base → with --");
const HOSTS = ["mg-medium", "ac-medium", "rpg-light", "rpg-medium", "sh-rpg"];
console.log(pad("host + Protocol", 34) + T_.map((t) => lp(t.id, 10)).join("") + lp("niche", 9) + lp("", 10) + lp("sust", 7) + "   card");
for (const host of HOSTS) {
  const plain = W_.find((x) => x.id === host)!, base = T_.map((t) => eDps(plain, t, true)), baseS = T_.map((t) => eDps(plain, t));
  for (const p of PROTOCOLS) {
    if (!protocolFits(p, BASE_BY_ID[host].tags)) continue;
    const item = withProtos(host, [p.id]), w = wOf(item);
    const mul = T_.map((t, i) => (base[i] > 0 ? eDps(w, t, true) / base[i] : 0));
    const best = Math.max(...mul), bi = mul.indexOf(best);
    const sust = baseS[bi] > 0 ? eDps(w, T_[bi]) / baseS[bi] : 0;
    const card = itemDpsPair(item)!;
    console.log(pad(`${BASE_BY_ID[host].name} + ${p.name}`, 34) + mul.map((x) => lp(`×${x.toFixed(2)}`, 10)).join("") + lp(`×${best.toFixed(2)}`, 9) + ` ${T_[bi].id.padEnd(9)} ×${sust.toFixed(2)}   ${f0(card.base)} → ${f0(card.withProtocols)}`);
    // Behaviour Protocols (split, rate, area, chain, ricochet) and the damage one are held to Keith's ×1.2-1.3 band.
    if ((p.shot || p.id === "overpressure") && (best < REF.nicheLo || best > REF.nicheHi)) problems.push(`${p.name} on the ${BASE_BY_ID[host].name}: niche ×${best.toFixed(2)} (want ×${REF.nicheLo}-${REF.nicheHi})`);
  }
}
// Stacking multiplies: two Protocols on one gun against their shared niche set (no cap, Keith 2026-10-31).
{
  const host = "mg-medium", ids = ["splitter", "overclock"], sw = T_[0];
  const plain = eDps(W_.find((x) => x.id === host)!, sw, true);
  const a = eDps(wOf(withProtos(host, [ids[0]])), sw, true) / plain, b = eDps(wOf(withProtos(host, [ids[1]])), sw, true) / plain;
  const both = eDps(wOf(withProtos(host, ids)), sw, true) / plain;
  console.log(`Stack on the ${BASE_BY_ID[host].name} vs the swarm (within a magazine): ${ids.join(" × ")} = ×${a.toFixed(2)} × ×${b.toFixed(2)} → ×${both.toFixed(2)} measured (product ×${(a * b).toFixed(2)})`);
  const four = ["splitter", "overclock", "arcLink", "wideBore"], w4 = wOf(withProtos(host, four)), p0 = W_.find((x) => x.id === host)!;
  console.log(`Legendary stack (${four.join(", ")}) vs swarm: ×${(eDps(w4, sw, true) / plain).toFixed(2)} within a magazine, ×${(eDps(w4, sw) / eDps(p0, sw)).toFixed(2)} sustained; vs rival ×${(eDps(w4, T_[4], true) / eDps(p0, T_[4], true)).toFixed(2)}`);
}

// 5. Armour: what each weapon keeps per hit against each armour value.
console.log("\n-- Armour: damage kept per hit at armour 0 / 3 / 8 / 10 / 12 (floor " + armourFloor + ") --");
console.log(pad("item", 20) + lp("ap", 6) + [0, 3, 8, 10, 12].map((a) => lp(`arm ${a}`, 9)).join(""));
for (const w of W_) console.log(pad(w.name, 20) + lp(w.ap.toFixed(2), 6) + [0, 3, 8, 10, 12].map((a) => lp(`${f0((100 * thru(w.dmg, a, w.ap)) / w.dmg)}%`, 9)).join(""));

// 6. Level: one curve for items and enemies (src/items/level.ts).
console.log(`\n-- Level: P(n) = 1 + ${LOOT_DEFAULTS.levelGrowth} × (n − 1) on item damage and hull, and enemies on their own curve (${LOOT_DEFAULTS.enemyGrowth}) at the area's level (1 + depth / 150 m) --`);
console.log([1, 6, 11, 21, 41, 60].map((n) => `L${n} ×${levelPower(n, LOOT_DEFAULTS.levelGrowth).toFixed(2)}`).join("  ") + "   (time to kill holds at level; deeper camps are bigger, not tougher per robot)");

// 7. The player mech under fire.
const hull = HULL.hull.base, arm = HULL.armour.base;
console.log(`\n-- The player mech (hull ${hull}, armour ${arm}) under fire: incoming DPS (expected), seconds to live --`);
const MG = BASE_BY_ID["mg-medium"].stats;
const mg = (n: number, k: number) => n * MG.fireRate.base * thru(MG.damage.base * k, arm, MG.ap.base) * 0.4;
const rows: [string, number][] = [
  ["24 scrappers (20% shooters, biters latched)", 24 * 0.8 * (RB.robotBiteDamage / RB.robotBiteInterval) + 24 * RB.robotShooterShare * (RB.robotShotDamage / RB.robotShotInterval) * 0.6],
  ["3 cutters (half shoot, half cut)", 1.5 * (RB.robotMidShotDamage / RB.robotMidShotInterval) * 0.6 + 1.5 * RB.robotMidCutDamage / (RB.robotMidCutWindup + RB.robotMidLungeTime + RB.robotMidCutRecover)],
  ["1 excavator (lobs)", (RB.robotBigBurst * RB.robotBigShotDamage) / (RB.robotBigBurst * RB.robotBigRoundInterval + RB.robotBigPause) * 0.5],
  // The charging beam (2026-10-31): through armour by its pierce; half of them dodged (a side step after the lock).
  ["1 excavator (beam, half dodged)", thru(RB.robotBeamDamage, arm, RB.robotBeamPierce) / (RB.robotBeamCooldown + RB.robotBeamCharge + RB.robotBeamSweep + RB.robotBeamBurn) * 0.5],
  ["War band (5 tech, 2 truck, 1 six, 1 turret)", (5 * WB.techRate * WB.techDamage + 2 * WB.truckRate * WB.truckDamage + WB.sixRate * WB.sixDamage + WB.turretRate * WB.turretDamage) * 0.5],
  ["Bandit mech (2 miniguns, through armour)", mg(2, WB.banditMechDamage)],
  ["Rival mech (2 miniguns, through armour)", mg(2, 1)],
  ["Rival mech (minigun + rail)", mg(1, 1) + (REF.aimSkill * 0.8 * thru(WD.railDamage, arm, WD.railAp)) / (WD.railCharge + WD.railCooldown)],
];
for (const [n, d] of rows) console.log(pad(n, 50) + lp(f0(d), 6) + " dps" + lp(f1(hull / d), 8) + " s");
console.log("(bites, saws, raider guns and burns name no pierce: they ignore armour; mech guns pay it)");

if (problems.length) console.log(`\nOut of band: ${problems.join("; ")}`);
if (CHECK && problems.length) proc.exit(1);
if (CHECK) console.log("\nbalance sheet check passed");
