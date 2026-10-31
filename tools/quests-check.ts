// Headless contracts and high value targets check (docs/proposal-quests.md):
// - the same seed offers the same contracts in the same places; lairs are seeded by the camp and only past the depth;
// - only kills of the lair's kind inside its radius count; the summon fires once at the count, after the warning, on
//   the far side from the player; walking past the leash resets it; a dead HVT never summons again; one at a time;
// - a contract finishes once and pays once (salvage, cull, bounty onto the at-risk list; tow and pods into the bank
//   only when the crane picks the mech up carrying them); a lost run fails what was being carried; offers lapse;
//   J taps accept, a hold drops;
// - the towed hulk never gets further than the cable from the mech and never under the ground; pods only in reach.
// Run: npm test (or npx tsx tools/quests-check.ts).
import { ContractBoard, CONTRACT_DEFAULTS, type OfferSources, type ContractEvent } from "../src/quests/contracts";
import { Lairs, HVT_DEFAULTS, type CampRef } from "../src/quests/hvt";
import { TowCable, TOW_DEFAULTS, podsInReach } from "../src/quests/tow";

const problems: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) problems.push(what); };

// ---- Offers: seeded ----
const src: OfferSources = {
  from: { x: 0, z: 0 },
  poi: (r, lo, hi) => { const d = lo + r() * (hi - lo), a = r() * 6.28; return { id: `poi${Math.round(d)}`, x: Math.sin(a) * d, z: Math.cos(a) * d, label: "Derelict hauler", spots: 5 }; },
  camp: (r, lo, hi) => { const d = lo + r() * (hi - lo); return { id: "camp1", x: d, z: 0, radius: 120, cull: "scrapper" }; },
  lair: (r, lo, hi) => { const d = lo + r() * (hi - lo); return { id: "hvt:camp1", x: 0, z: d, radius: 180, name: "Rustjaw" }; },
  open: (r, lo, hi) => { const d = lo + r() * (hi - lo); return { x: -d, z: 0 }; },
};
const offers = (seed: number) => {
  const b = new ContractBoard({ ...CONTRACT_DEFAULTS, contractSeed: seed, contractsMax: 99 });
  for (let k = 0; k < 12; k++) b.offer(src);
  return b.list.map((c) => `${c.kind}@${Math.round(c.x)},${Math.round(c.z)}:${c.reward}`).join(" ");
};
must(offers(11) === offers(11), "the same seed offered different contracts");
must(offers(11) !== offers(12), "a different seed offered the same contracts");
{
  const b = new ContractBoard({ ...CONTRACT_DEFAULTS, contractsMax: 99 });
  for (let k = 0; k < 40; k++) b.offer(src);
  const kinds = new Set(b.list.map((c) => c.kind));
  must(kinds.size === 5, `40 offers covered only ${[...kinds].join(", ")}`);
  for (const c of b.list) must(c.reward > 0 && c.dist >= 300, `${c.kind} offer with reward ${c.reward} at ${Math.round(c.dist)} m`);
  // Never two tows at once (one cable).
  const b3 = new ContractBoard({ ...CONTRACT_DEFAULTS, contractsMax: 99 });
  b3.offer(src, "tow");
  for (let k = 0; k < 20; k++) { const c = b3.offer(src); must(!c || c.kind !== "tow", "a second tow was offered while one was open"); }
  // A kind with no place to go falls back to another.
  const none: OfferSources = { ...src, poi: () => null, camp: () => null, lair: () => null };
  const b2 = new ContractBoard(CONTRACT_DEFAULTS);
  for (let k = 0; k < 10; k++) { const c = b2.offer(none); must(!!c && (c.kind === "tow" || c.kind === "pods"), "an offer with nowhere to go wasn't swapped for one that fits"); b2.list.length = 0; }
}

// ---- The board: offers come only out, lapse, J accepts and drops ----
{
  const v = { ...CONTRACT_DEFAULTS, contractFirst: 5, contractEvery: 20, offerTime: 10, contractsMax: 2 };
  const b = new ContractBoard(v);
  for (let t = 0; t < 60; t += 0.1) b.step(0.1, false, false, src);
  must(b.list.length === 0, "an offer came while aboard");
  for (let t = 0; t < 5.05; t += 0.1) b.step(0.1, true, false, src);
  must(b.offers.length === 1, `expected one offer 5 s out, got ${b.offers.length}`);
  for (let t = 0; t < 10.2; t += 0.1) b.step(0.1, true, false, src);
  must(b.events.some((e) => e.type === "lapsed"), "an offer didn't lapse after offerTime");
  b.events.length = 0;
  // Next offer, tap J: accepted.
  for (let t = 0; t < 21 && !b.offers.length; t += 0.1) b.step(0.1, true, false, src);
  must(b.offers.length === 1, "no second offer");
  b.step(0.1, true, true, src); b.step(0.1, true, false, src);
  must(b.active.length === 1, "a tap of J didn't accept the offer");
  // Hold J: dropped.
  for (let t = 0; t < v.dropHold + 0.2; t += 0.05) b.step(0.05, true, true, src);
  b.step(0.05, true, false, src);
  must(b.active.length === 0 && b.events.some((e) => e.type === "dropped"), "holding J didn't drop the contract");
  must(!b.events.some((e) => e.type === "accepted" && b.events.indexOf(e) > b.events.findIndex((q) => q.type === "dropped")), "letting go of a held J accepted an offer");
}

// ---- Completion: once, paid once, where ----
const take = (b: ContractBoard, kind: Parameters<ContractBoard["offer"]>[1]) => { const c = b.offer(src, kind)!; b.accept(c.id); b.events.length = 0; return c; };
const dones = (evs: ContractEvent[]) => evs.filter((e) => e.type === "done");
{
  const b = new ContractBoard({ ...CONTRACT_DEFAULTS, contractsMax: 9 });
  const s = take(b, "salvage");
  must(s.need === Math.ceil(5 * CONTRACT_DEFAULTS.salvageShare), `salvage need ${s.need}`);
  for (let k = 0; k < 10; k++) b.stripped(s.site!);
  b.stripped("someOtherPoi");
  const d = dones(b.events);
  must(d.length === 1 && d[0].type === "done" && d[0].to === "atRisk", "a salvage run didn't finish exactly once onto the at-risk list");
  b.events.length = 0;
  const cu = take(b, "cull");
  for (let k = 0; k < 100; k++) b.kill("cutter", cu.x, cu.z);
  for (let k = 0; k < 100; k++) b.kill("scrapper", cu.x + 500, cu.z);
  must(cu.have === 0, "kills of the wrong kind or outside the circle counted for a cull");
  for (let k = 0; k < 100; k++) b.kill("scrapper", cu.x + 10, cu.z);
  must(dones(b.events).length === 1 && cu.state === "done", "a cull didn't finish exactly once");
  b.events.length = 0;
  const bo = take(b, "bounty");
  b.hvtKilled("hvt:elsewhere");
  must(bo.state === "active", "another lair's kill finished a bounty");
  b.hvtKilled(bo.site!); b.hvtKilled(bo.site!);
  must(dones(b.events).length === 1, "a bounty paid more than once");
  b.events.length = 0;
  // Tow: paid only when banked while on the cable; lost while on it: failed.
  const tw = take(b, "tow");
  b.banked();
  must(tw.state === "active", "a tow finished without the hulk on the cable");
  b.towing(tw.id, true); b.banked();
  const td = dones(b.events);
  must(td.length === 1 && td[0].type === "done" && td[0].to === "bank", "a towed hulk brought home wasn't paid into the bank");
  b.events.length = 0;
  const tw2 = take(b, "tow");
  b.towing(tw2.id, true); b.lost();
  must(tw2.state === "failed", "losing the run while towing didn't fail the tow");
  // Pods: in reach only; all home = paid; a partial bank keeps the job; a loss while carrying fails it.
  b.events.length = 0;
  const pd = take(b, "pods");
  const p0 = pd.pods![0]!;
  must(podsInReach(pd.pods!, p0.x + TOW_DEFAULTS.podReach + 0.5, p0.z, TOW_DEFAULTS.podReach).indexOf(0) < 0, "a pod out of reach was in reach");
  must(podsInReach(pd.pods!, p0.x + 1, p0.z, TOW_DEFAULTS.podReach).indexOf(0) >= 0, "a pod 1 m away wasn't in reach");
  b.pod(pd.id, 0); b.pod(pd.id, 0);
  must(pd.have === 1, "a pod was picked up twice");
  b.banked();
  must(pd.state === "active" && !pd.carrying, "a partial pod bank didn't keep the job with nothing at risk");
  for (let k = 1; k < pd.need; k++) b.pod(pd.id, k);
  b.banked();
  must(pd.state === "done" && dones(b.events).length === 1, "all pods home didn't pay once");
  const pd2 = take(b, "pods");
  b.pod(pd2.id, 0); b.lost();
  must(pd2.state === "failed", "losing the run carrying pods didn't fail the job");
}

// ---- Lairs ----
{
  const camps: CampRef[] = [];
  for (let k = 0; k < 400; k++) camps.push({ id: `c${k}`, x: 1000 + k * 37, z: (k % 7) * 50, faction: k % 3 ? "robot" : "bandit" });
  const a = new Lairs(HVT_DEFAULTS), b = new Lairs(HVT_DEFAULTS);
  const sig = (l: Lairs) => camps.map((c) => { const q = l.at(c); return q ? `${q.id}:${q.name}:${q.cull}:${q.need}` : "-"; }).join("|");
  must(sig(a) === sig(b), "lairs weren't the same for the same camps");
  const share = camps.filter((c) => a.at(c)).length / camps.length;
  must(Math.abs(share - HVT_DEFAULTS.hvtShare) < 0.08, `lair share ${share.toFixed(2)} vs ${HVT_DEFAULTS.hvtShare}`);
  must(camps.every((c) => { const q = a.at(c); return !q || (c.faction === "bandit") === (q.cull === "bandit"); }), "a bandit camp's lair wants robots culled or the other way");
  const shallow = new Lairs(HVT_DEFAULTS);
  shallow.depth = () => 100;
  must(camps.every((c) => !shallow.at(c)), "a lair sat closer to the road than hvtMinDepth");

  // Summon rules.
  const v = { ...HVT_DEFAULTS, hvtShare: 1 };
  const L = new Lairs(v);
  const lair = L.at({ id: "camp", x: 0, z: 0, faction: "robot" })!;
  const other = L.at({ id: "camp2", x: 2000, z: 0, faction: "robot" })!;
  const wrong = lair.cull === "scrapper" ? "cutter" : "scrapper";
  for (let k = 0; k < 200; k++) L.kill(wrong, 0, 0);
  for (let k = 0; k < 200; k++) L.kill(lair.cull, v.hvtRadius + 5, 0);
  must(lair.kills === 0, "wrong-kind or out-of-circle kills counted for a lair");
  for (let k = 0; k < lair.need - 1; k++) L.kill(lair.cull, 10, 10);
  must(lair.state === "dormant", "a lair stirred before its count");
  L.kill(lair.cull, 10, 10);
  must(lair.state === "stirring", "a lair didn't stir at its count");
  L.events.length = 0;
  let summons = 0, at = { x: 0, z: 0 };
  for (let t = 0; t < v.hvtDelay + 5; t += 0.1) { L.step(0.1, -60, 0); for (const e of L.events) if (e.type === "summon") { summons++; at = e; } L.events.length = 0; }
  must(summons === 1, `the summon fired ${summons} times`);
  must(at.x > 0, "the HVT walked in on the player's side of the lair");
  // A second lair stirring waits while one is on the field.
  for (let k = 0; k < other.need; k++) L.kill(other.cull, 2000, 0);
  for (let t = 0; t < v.hvtDelay + 5; t += 0.1) { L.step(0.1, 1900, 0); for (const e of L.events) if (e.type === "summon") summons++; L.events.length = 0; }
  // (the player at 1900 is past the first's leash: it escapes, so the second may come.)
  must(lair.state === "dormant" && lair.kills === 0, "walking past the leash didn't send the HVT back to ground with the count reset");
  must(summons === 2 && other.state === "summoned", "the second lair didn't summon once the first had gone");
  must(L.killed(other.id) && other.state === "dead", "killing the HVT didn't spend the lair");
  for (let k = 0; k < 100; k++) L.kill(other.cull, 2000, 0);
  for (let t = 0; t < 20; t += 0.1) L.step(0.1, 1950, 0);
  must(other.state === "dead", "a dead lair stirred again");
  must(!L.killed(other.id), "a dead HVT was killed twice");
}

// ---- The cable ----
{
  const tow = new TowCable(TOW_DEFAULTS);
  const h = (x: number, z: number) => 3 * Math.sin(x * 0.05) + 2 * Math.cos(z * 0.07);
  tow.place(0, 0, h(0, 0));
  must(tow.reach(3, 3) && !tow.reach(20, 0), "hook reach is wrong");
  let r: string | null = null;
  for (let t = 0; t < TOW_DEFAULTS.towHook + 0.1 && !r; t += 0.05) r = tow.holdE(0.05, true, "c1");
  must(r === "hooked" && tow.on, "holding E didn't hook");
  let worst = 0, under = 0, mx = 0, mz = 0, a = 0;
  for (let t = 0; t < 60; t += 1 / 120) {
    a += (Math.sin(t * 0.7) * 1.5) / 120;
    mx += Math.sin(a) * 6 * TOW_DEFAULTS.towSlow / 120; mz += Math.cos(a) * 6 * TOW_DEFAULTS.towSlow / 120;
    if (t > 30 && t < 33) { mx -= Math.sin(a) * 12 / 120; mz -= Math.cos(a) * 12 / 120; } // backs up: slack
    tow.step(1 / 120, mx, mz, h);
    worst = Math.max(worst, Math.hypot(mx - tow.x, mz - tow.z));
    if (tow.y < h(tow.x, tow.z) - 1e-6) under++;
  }
  must(worst <= TOW_DEFAULTS.towRope + 1e-6, `the hulk got ${worst.toFixed(2)} m from the mech (cable ${TOW_DEFAULTS.towRope})`);
  must(under === 0, `the hulk sank under the sand ${under} times`);
  must(Math.hypot(mx, mz) > 40 && Math.hypot(tow.x, tow.z) > Math.hypot(mx, mz) - TOW_DEFAULTS.towRope - 1, "the hulk wasn't dragged along");
  must(tow.slow === TOW_DEFAULTS.towSlow, "towing doesn't slow the mech");
  r = null;
  for (let t = 0; t < TOW_DEFAULTS.towHook + 0.1 && !r; t += 0.05) r = tow.holdE(0.05, true, "c1");
  must(r === "dropped" && !tow.on && tow.slow === 1, "holding E again didn't drop the hulk");
}

if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); throw new Error("quests check failed"); }
console.log("quests check passed");
