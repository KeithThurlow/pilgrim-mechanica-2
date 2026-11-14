// Shoulder strikes (src/weapons/strikes.ts, Keith 2026-11-14): the rules that must hold. Each strike fires once and
// then cools for its cooldown; self strikes put out their rings in order out to their reach; the orbital lance and the
// singularity tick for their time and end in one final blast; the artillery barrage drops its shells inside its ring,
// the same spots for the same seed; the items resolve as strikes on the shoulders, never on the back, and rivals never
// roll them.
import { StrikeSim, strikeStats, STRIKE_DEFAULTS, STRIKE_KINDS, type StrikeEvent, type StrikeKind } from "../src/weapons/strikes";
import { BASES, BASE_BY_ID } from "../src/items/bases";
import { makeItem, LOOT_DEFAULTS } from "../src/items/generate";
import { defaultLoadout, resolve, fitProblem } from "../src/items/loadout";
import { rollRivalLoadout } from "../src/combat/rivalKit";

const V = { ...STRIKE_DEFAULTS };
const problems: string[] = [];
const must = (ok: boolean, why: string) => { if (!ok) problems.push(why); };
const DT = 1 / 30;

function run(kind: StrikeKind, seed = 7, seconds = 12) {
  const st = strikeStats(kind, null, V);
  const sim = new StrikeSim(kind, st, seed);
  const ev: (StrikeEvent & { t: number })[] = [];
  let t = 0;
  const emit = (e: StrikeEvent) => ev.push({ ...e, t });
  must(sim.fire(10, 20, 0, 0, st, emit), `${kind}: a ready strike didn't fire`);
  must(!sim.fire(10, 20, 0, 0, st, emit), `${kind}: fired again while running`);
  for (; t < seconds; t += DT) sim.update(DT, V, emit);
  return { sim, st, ev };
}

for (const kind of STRIKE_KINDS) {
  const { sim, st, ev } = run(kind);
  const types = ev.map((e) => e.type);
  must(types[0] === "start", `${kind}: didn't start with its warning`);
  must(types.includes("live") && types.includes("end"), `${kind}: never went live or never ended`);
  must(!sim.busy, `${kind}: still running after 12 s`);
  const end = ev.find((e) => e.type === "end")!.t;
  // Cooldown runs from the press: ready again at the cooldown (or as it ends, if it runs longer).
  const s2 = new StrikeSim(kind, st, 7);
  s2.fire(0, 0, 0, 0, st, () => {});
  let ready = -1;
  for (let t = 0; t < 120; t += DT) { s2.update(DT, V, () => {}); if (s2.ready && ready < 0) ready = t; }
  must(Math.abs(ready - Math.max(st.cooldown, end)) < 0.2, `${kind}: ready again after ${ready.toFixed(2)} s (cooldown ${st.cooldown}, ran ${end.toFixed(2)} s)`);
  console.log(`${kind}: ${ev.length} events, ran ${end.toFixed(2)} s, ready after ${ready.toFixed(1)} s`);
}

// Self strikes: rings in order out to the reach, one final.
for (const kind of ["quake", "stasis"] as const) {
  const { st, ev } = run(kind);
  const rings = ev.filter((e) => e.type === "ring") as (StrikeEvent & { type: "ring"; t: number })[];
  must(rings.length === st.count, `${kind}: ${rings.length} rings, want ${st.count}`);
  must(rings.every((r, i) => i === 0 || (r.r > rings[i - 1].r && r.t >= rings[i - 1].t)), `${kind}: rings out of order`);
  must(Math.abs(rings[rings.length - 1].r - st.radius) < 1e-9, `${kind}: last ring doesn't reach its radius`);
  must(ev.filter((e) => e.type === "final").length === 1, `${kind}: not one final`);
}

// Orbital and gravity: ticks for their time, then one final blast.
for (const kind of ["orbital", "gravity"] as const) {
  const { st, ev } = run(kind);
  const ticks = ev.filter((e) => e.type === "tick").length, tick = kind === "orbital" ? V.orbitalTick : V.gravityTick;
  must(Math.abs(ticks - st.time / tick) <= 1.5, `${kind}: ${ticks} ticks over ${st.time} s (want about ${(st.time / tick).toFixed(0)})`);
  must(ev.filter((e) => e.type === "final").length === 1, `${kind}: not one final blast`);
  console.log(`${kind}: ${ticks} ticks`);
}

// The lance drifts toward where it's steered, no faster than its speed.
{
  const st = strikeStats("orbital", null, V), sim = new StrikeSim("orbital", st, 1);
  sim.fire(0, 0, 0, 0, st, () => {});
  sim.steer(100, 0, V.orbitalTrack, 1);
  must(Math.abs(sim.x - V.orbitalTrack) < 1e-9 && sim.z === 0, `orbital: drifted to ${sim.x.toFixed(2)} in 1 s at ${V.orbitalTrack} m/s`);
}

// Artillery: every shell inside the ring, seeded.
{
  const a = run("artillery", 11), b = run("artillery", 11), c = run("artillery", 12);
  const shells = (r: typeof a) => r.ev.filter((e) => e.type === "shell") as { x: number; z: number }[];
  must(shells(a).length === a.st.count, `artillery: ${shells(a).length} shells, want ${a.st.count}`);
  must(shells(a).every((s) => Math.hypot(s.x - 10, s.z - 20) <= a.st.radius + 1e-9), "artillery: a shell outside its ring");
  must(JSON.stringify(shells(a)) === JSON.stringify(shells(b)), "artillery: the same seed dropped different spots");
  must(JSON.stringify(shells(a)) !== JSON.stringify(shells(c)), "artillery: another seed dropped the same spots");
}

// Items: each strike base is a shoulder strike; it resolves on a shoulder key, not on the back; rivals never roll one.
const ids = BASES.filter((b) => b.family === "strike").map((b) => b.id);
must(ids.length === STRIKE_KINDS.length, `${ids.length} strike items, want ${STRIKE_KINDS.length}`);
for (const id of ids) {
  const lo = defaultLoadout();
  lo.shoulderL = makeItem(id);
  const r = resolve(lo);
  const sh = r.shoulders.find((s) => s.key === 1);
  must(sh?.family === "strike" && sh.weapon === BASE_BY_ID[id].shoulder, `${id}: didn't resolve as a strike on key 1`);
  must(!!fitProblem(lo, "pack", makeItem(id)), `${id}: fits on the back`);
  must((BASE_BY_ID[id].drop ?? 0) > 0, `${id}: never drops`);
}
let rivalStrikes = 0;
for (let s = 1; s <= 300; s++) {
  const lo = rollRivalLoadout(s, { ...LOOT_DEFAULTS });
  for (const slot of ["shoulderL", "shoulderR", "pack"] as const) if (lo[slot] && BASE_BY_ID[lo[slot]!.base]?.family === "strike") rivalStrikes++;
}
must(rivalStrikes === 0, `${rivalStrikes} rivals rolled a strike (their AI can't use one yet)`);

if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); throw new Error("strikes check failed"); }
console.log("strikes check ok");
