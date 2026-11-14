// Headless check of the run's threat level (src/expedition/runThreat.ts, Keith 2026-11-14):
// - out on an expedition the threat climbs to the deepest point reached and never falls while out, even walking home;
// - it falls only at home (aboard, or by the convoy), to zero, at threatDecay m/s;
// - effective depth is the deeper of the place's own and the threat, so a drop rolled on the way back rolls at the
//   deepest point's level, not level 1; with the threat off, the place's depth alone.
// Prints a round trip: depth, threat, threat level and a drop's level at the turn and on the way back.
// Run: npm test (or npx tsx tools/runthreat-check.ts).
import { RunThreat, RUN_THREAT_DEFAULTS } from "../src/expedition/runThreat";
import { DROP_DEFAULTS } from "../src/expedition/drops";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };
const LM = DROP_DEFAULTS.levelMetres;
const dropLevel = (depth: number) => 1 + depth / LM;

const t = new RunThreat({ ...RUN_THREAT_DEFAULTS });
const dt = 1 / 30, walk = 7;
let depth = 0, maxDrop = 0, prev = 0, time = 0;
// Out to 1500 m at walking pace.
while (depth < 1500) {
  depth += walk * dt; time += dt;
  t.update(dt, depth, true, depth < t.v.threatHome);
  if (t.m + 1e-9 < prev && depth >= t.v.threatHome) fail(`threat fell on the way out at ${depth.toFixed(0)} m`);
  prev = t.m;
}
for (let i = 0; i < 90; i++) t.update(dt, depth, true, false); // a fight at the turn: threat catches up
const atTurn = t.m, turnLevel = t.level(LM);
if (Math.abs(atTurn - 1500) > 1) fail(`threat at the turn ${atTurn.toFixed(0)}, expected 1500`);
// And back: never falls while out.
let backLevel = Infinity;
while (depth > t.v.threatHome + 1) {
  depth -= walk * dt;
  t.update(dt, depth, true, false);
  if (t.m < atTurn - 1e-6) { fail(`threat fell on the way back at ${depth.toFixed(0)} m`); break; }
  backLevel = Math.min(backLevel, dropLevel(t.effective(depth)));
  maxDrop = Math.max(maxDrop, dropLevel(t.effective(depth)));
}
if (backLevel < dropLevel(1500) - 1e-6) fail(`a drop near home rolled at level ${backLevel.toFixed(1)}, below the turn's ${dropLevel(1500).toFixed(1)}`);
const placeOnly = dropLevel(depth);
// Home: falls at threatDecay to zero.
let secs = 0;
while (t.m > 0 && secs < 600) { t.update(dt, 20, true, true); secs += dt; }
const expect = 1500 / t.v.threatDecay;
if (t.m > 0) fail("threat never reached zero at home");
if (Math.abs(secs - expect) > 1) fail(`threat took ${secs.toFixed(1)} s to fall, expected ${expect.toFixed(1)}`);
if (!t.falling) fail("not marked falling at home");
// Aboard (not out) falls too.
t.set(600); t.update(1, 0, false, false);
if (Math.abs(t.m - (600 - t.v.threatDecay)) > 1e-6) fail("threat did not fall aboard");
// By the convoy (home), a place plays at its own depth even with the threat high: no farming lured packs.
t.set(1500);
if (t.effective(30, true) !== 30) fail("a place by the convoy still counts the threat");
if (t.effective(30, false) !== 1500) fail("a place out there ignores the threat");
// Off: place depth only.
const off = new RunThreat({ ...RUN_THREAT_DEFAULTS, threatOn: 0 });
off.update(1, 1000, true, false);
if (off.effective(200) !== 200 || off.m !== 0) fail("threat off still counts");
// Time creep: standing still out there, the threat climbs.
const creep = new RunThreat({ ...RUN_THREAT_DEFAULTS, threatTimeRise: 60 });
for (let i = 0; i < 60 * 30; i++) creep.update(dt, 100, true, false);
if (Math.abs(creep.m - 160) > 2) fail(`time creep: ${creep.m.toFixed(0)} m after a minute at 100 m, expected 160`);

console.log(`round trip at ${walk} m/s: out ${time.toFixed(0)} s to 1500 m, threat ${atTurn.toFixed(0)} m (threat level ${turnLevel.toFixed(1)});`
  + ` a drop by the convoy on the way back rolls level ${backLevel.toFixed(1)} (place alone: ${placeOnly.toFixed(1)}); home: back to 0 in ${secs.toFixed(0)} s`);
if (problems.length) { console.log(`runthreat check FAILED (${problems.length})`); throw new Error("runthreat check failed"); }
console.log("runthreat check passed");
