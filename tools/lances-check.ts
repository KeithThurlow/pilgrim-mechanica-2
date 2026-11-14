// Headless check of the bandit mech lances and the encounter mix (src/expedition/lances.ts, threats.ts; Keith 2026-11-14):
// - lances are kept round the mech (more deep out), turn up in their ring, hunt a loud mech and come onto the field
//   within the engage range; none hunt while the mech is aboard;
// - a mech raid share of 1 turns every timed raid into a mech raid (no robot raid packs), 0 keeps them all robots;
//   the first fight is a lance when its share is 1;
// - camp guard mechs are seeded (the same camp always has the same), rise with depth, two from campMechTwoAt;
// - mechGrade: items and brains get harder with danger, never easier;
// - over 20 simulated minutes out at mid depth with the defaults, mech encounters are at least a quarter of all
//   (packs, raids and lances that engage), and robot raids come no more often than every couple of minutes.
// Run: npm test (or npx tsx tools/lances-check.ts).
import { LanceField, LANCE_DEFAULTS, campMechs, mechGrade } from "../src/expedition/lances";
import { ThreatField, THREAT_DEFAULTS } from "../src/expedition/threats";

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log("FAIL " + m); } else if (process.argv.includes("--verbose")) console.log("ok   " + m); };

const V = { ...LANCE_DEFAULTS };
// Topping up and hunting.
{
  const f = new LanceField(V, 3);
  const me = { x: 0, z: 0, out: true, loud: false, danger: 0 };
  f.update(0.1, me);
  const n0 = f.lances.filter((l) => l.kind === "lance").length;
  ok(n0 === V.lancePacks, `lances at the road: ${n0} (want ${V.lancePacks})`);
  ok(f.lances.every((l) => { const d = Math.hypot(l.x, l.z); return d >= V.lanceFrom - 1 && d <= V.lanceTo + 1; }), "lances turn up in their ring");
  const deep = new LanceField(V, 3);
  deep.update(0.1, { ...me, danger: 1 });
  ok(deep.lances.length > n0, `more lances deep out (${deep.lances.length} > ${n0})`);
  ok(deep.lances.every((l) => l.n >= 1 && l.n <= Math.round(V.lanceMax * V.lanceSizeFar)), "lance sizes in range");
  // Loud: they hear from far; within the engage range they come on.
  const l = f.lances[0];
  l.x = V.lanceHear; l.z = 0;
  let engaged = false;
  for (let t = 0; t < 200 && !engaged; t += 0.1) engaged = f.update(0.1, { ...me, loud: true }).some((e) => e.lance === l);
  ok(engaged && Math.hypot(l.x, l.z) < V.lanceEngage, "a loud mech draws a lance in and it engages within range");
  // Aboard: nothing hunts.
  const g = new LanceField(V, 4);
  g.update(0.1, me);
  const q = g.lances[0];
  q.x = 100; q.z = 0;
  let any = false;
  for (let t = 0; t < 30; t += 0.1) any = any || g.update(0.1, { ...me, out: false, loud: true }).length > 0;
  ok(!any && q.state === "roam", "no lance hunts while aboard");
}
// Raid and first-fight shares.
{
  const run = (share: number, first: number) => {
    const tf = new ThreatField({ ...THREAT_DEFAULTS, lanceRaidShare: share, lanceFirstShare: first, roamPacks: 0 } as never, 9);
    let mech = 0, robot = 0, firstMech = false;
    for (let t = 0; t < 1200; t += 0.25) for (const e of tf.update(0.25, { x: 0, z: 0, out: true, loud: false, danger: 0.3 })) {
      if (e.type === "mechRaid") { if (e.first) firstMech = true; else mech++; }
      if (e.type === "raid") robot++;
    }
    return { mech, robot, firstMech };
  };
  const all = run(1, 1), none = run(0, 0);
  ok(all.mech > 0 && all.robot === 0, `mech raid share 1: ${all.mech} mech raids, ${all.robot} robot raids`);
  ok(none.mech === 0 && none.robot > 0, `mech raid share 0: ${none.robot} robot raids, ${none.mech} mech raids`);
  ok(all.firstMech && !none.firstMech, "the first fight is a lance at share 1, never at 0");
}
// Camp guards.
{
  let n0 = 0, n1 = 0, two = 0;
  for (let s = 1; s <= 2000; s++) {
    const a = campMechs(V, s * 7717, 0), b = campMechs(V, s * 7717, 1);
    ok(a === campMechs(V, s * 7717, 0), "camp guards are seeded");
    if (a) n0++;
    if (b) n1++;
    if (b === 2) two++;
    if (a === 2) ok(false, "two guards at the road");
  }
  ok(Math.abs(n0 / 2000 - V.campMechChance) < 0.04, `camps with a guard at the road: ${(n0 / 20).toFixed(1)}%`);
  ok(n1 > n0 && two === n1, `more guards deep out (${n1} > ${n0}), two each from danger ${V.campMechTwoAt}`);
}
// Grades.
{
  const lv = ["recruit", "veteran", "ace"];
  let prev = mechGrade(V, 0);
  for (let d = 0.1; d <= 1.5; d += 0.1) {
    const g = mechGrade(V, d);
    ok(g.up >= prev.up && lv.indexOf(g.ai) >= lv.indexOf(prev.ai), `grade never easier deeper (danger ${d.toFixed(1)})`);
    prev = g;
  }
  ok(mechGrade(V, 0).ai === "recruit" && mechGrade(V, 1.5).ai === "ace", "recruits at the road, aces far out");
}
// The mix over a long trip at mid depth: packs and raids from the threat field, lances from the lance field.
{
  const T = { ...THREAT_DEFAULTS, ...LANCE_DEFAULTS };
  const tf = new ThreatField(T as never, 11), lf = new LanceField(V, 12);
  let robots = 0, mechs = 0, robotRaids = 0;
  let x = 0;
  const dt = 0.25;
  for (let t = 0; t < 1200; t += dt) {
    x += 1.5 * dt;   // walking about slowly, firing now and then (loud a third of the time)
    const me = { x, z: 0, out: true, loud: Math.floor(t / 10) % 3 === 0, danger: 0.4 };
    for (const e of tf.update(dt, me)) {
      if (e.type === "engage") { robots++; e.pack.n = 0; }
      if (e.type === "raid") robotRaids++;
      if (e.type === "mechRaid") lf.hunt(e.first ? "scout" : "raid", me, 160, 190);
    }
    for (const e of lf.update(dt, me)) { mechs++; e.lance.n = 0; }
  }
  const share = mechs / Math.max(1, mechs + robots);
  ok(share >= 0.25, `mech encounters ${mechs} of ${mechs + robots} (${Math.round(share * 100)}%, want a quarter or more)`);
  ok(robotRaids <= 1200 / 120, `robot raids in 20 min: ${robotRaids}`);
  if (process.argv.includes("--verbose")) console.log(`mix: ${robots} robot groups, ${mechs} mech lances, ${robotRaids} robot raids`);
}
if (fails) { console.log(`lances-check: ${fails} failed`); process.exit(1); }
console.log("lances-check ok");
