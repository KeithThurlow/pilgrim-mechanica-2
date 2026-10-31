// Headless trample, ram and dive roll check (Keith 2026-10-31; src/combat/trample.ts, infantry.ts, robots.ts).
// Must never happen: a walk hurting more than a run or a run more than a sprint; a sprint through a crowd leaving those
// in its path standing; a walk killing; the dodge share far off the slider; a bandit that dived still in the path or
// still under the ring when it lands; a ram that hurts one side only; legs that don't set the reach.
// Run: npm test (or npx tsx tools/trample-check.ts).
import { InfantrySwarm, INFANTRY_DEFAULTS, DOWN, DEAD } from "../src/combat/infantry";
import { RobotSwarm, ROBOT_DEFAULTS, SMALL } from "../src/combat/robots";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { TRAMPLE_DEFAULTS, trampleHurt, ram, chargeThreat, threatOut, VEHICLE_MASS, type MechBody, type GroundThreat } from "../src/combat/trample";
import { defaultLoadout, fit, resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";

const field = new DuneField({ ...TERRAIN_DEFAULTS, height: 0 } as typeof TERRAIN_DEFAULTS);
const T = { ...TRAMPLE_DEFAULTS };
const dt = 1 / 120;
const fails: string[] = [];
const must = (ok: boolean, m: string) => { if (!ok) fails.push(m); };

// --- Damage by speed: walk < run < dash/sprint; a walk never kills a bandit, a sprint or a dash always does.
const hp = INFANTRY_DEFAULTS.hp;
const at = { walk: 6, run: 8.5, sprint: 14, dash: 20 };
const dmg = Object.fromEntries(Object.entries(at).map(([k, s]) => [k, trampleHurt(s, T)])) as Record<keyof typeof at, number>;
console.log(`damage by speed (bandit hp ${hp}): walk ${dmg.walk.toFixed(1)}, run ${dmg.run.toFixed(1)}, sprint ${dmg.sprint.toFixed(1)}, dash ${dmg.dash.toFixed(1)}`);
must(dmg.walk < dmg.run && dmg.run < dmg.sprint && dmg.sprint <= dmg.dash, "damage doesn't rise walk < run < sprint <= dash");
must(dmg.walk < hp, "a walk kills a bandit outright");
must(dmg.sprint >= hp, "a sprint doesn't kill a bandit");

// --- Through a crowd at each speed: the mech body on a straight line through 60 bandits standing in its way.
interface Pass { touched: number; killed: number; down: number; inPath: number; pathKilled: number; dives: number; diverOut: number; diverIn: number }
// standing: the crowd holds still (asleep: no running, backing off or fleeing), so "in its path" stays true.
function pass(speed: number, chance: number, seed: number, reach = T.trampleReach, standing = false): Pass {
  const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS, diveChance: chance }, field, seed);
  // A band of bandits 30 m long and 10 m wide ahead of the mech, facing it (firing, still).
  const made = sw.spawn(60, 0, 25, 9);
  if (standing) for (const i of made) sw.frozen[i] = 1;
  const b: MechBody = { x: 0, z: -2, vx: 0, vz: speed, reach, crush: 1 };
  const half = reach + INFANTRY_DEFAULTS.banditRadius;
  const inPath = new Set(made.filter((i) => Math.abs(sw.px[i]) < half - 0.3 && sw.pz[i] > 2));
  let touched = 0, killed = 0;
  let id = 1;
  for (let t = 0; t < 50 / speed; t += dt) {
    b.z += speed * dt;
    const charge = chargeThreat(b, id, T);
    sw.dodge(charge ? [charge] : []);
    // Their target is the mech (as in the labs: held off its body only, so it can reach them).
    sw.update(dt, { x: b.x, y: 3, z: b.z, radius: reach }, () => {});
    touched += sw.trample(b, T, (i, d, dx, dz, s) => { const k = sw.damage(i, d, dx, dz, s); if (k) killed++; return k; });
  }
  let down = 0, pathKilled = 0, diverOut = 0, diverIn = 0;
  for (const i of made) if (sw.state[i] === DOWN) down++;
  for (const i of inPath) if (sw.state[i] === DEAD) pathKilled++;
  for (const i of inPath) if (sw.rolledFor[i] !== 0) { if (sw.state[i] === DEAD || sw.state[i] === DOWN) diverIn++; else diverOut++; }
  return { touched, killed, down, inPath: inPath.size, pathKilled, dives: sw.dives, diverOut, diverIn };
}
const walk = pass(at.walk, 0, 3), run = pass(at.run, 0, 3), sprint = pass(at.sprint, 0, 3), standing = pass(at.sprint, 0, 3, T.trampleReach, true);
for (const [n, p] of [["walk", walk], ["run", run], ["sprint", sprint], ["sprint, a standing crowd", standing]] as const)
  console.log(`${n.padEnd(6)} through 60: touched ${p.touched}, killed ${p.killed}, down ${p.down}; in its path ${p.inPath}, ${p.pathKilled} killed`);
must(walk.killed === 0 && walk.touched > 0, `a walk through a crowd should knock down, not kill (killed ${walk.killed}, touched ${walk.touched})`);
must(run.killed < sprint.killed, "a run kills as many as a sprint");
must(standing.inPath > 5 && standing.pathKilled >= standing.inPath * 0.95, `a sprint left ${standing.inPath - standing.pathKilled} of ${standing.inPath} standing in its path alive`);

// --- Dodge share: over many seeds, the share of bandits in the charge's path that dive is near the slider.
let inside = 0, dived = 0, out = 0, caught = 0;
for (let s = 1; s <= 40; s++) {
  const p = pass(at.sprint, INFANTRY_DEFAULTS.diveChance, 100 + s);
  inside += p.inPath; dived += p.diverOut + p.diverIn; out += p.diverOut; caught += p.diverIn;
}
const share = dived / Math.max(1, inside);
console.log(`charge dodge: ${dived} of ${inside} in the path dived (${(share * 100).toFixed(1)}%, slider ${(INFANTRY_DEFAULTS.diveChance * 100).toFixed(0)}%); ${out} got clear, ${caught} caught anyway`);
must(Math.abs(share - INFANTRY_DEFAULTS.diveChance) < 0.06, `dive share ${share.toFixed(3)} far from the slider ${INFANTRY_DEFAULTS.diveChance}`);
must(out >= dived * 0.85, `only ${out} of ${dived} divers got out of the charge's path`);

// --- A ring landing (a mortar shell, 1.6 s out): divers are outside it when it lands; the rest didn't move out.
{
  let divers = 0, clear = 0, stayers = 0, stayersIn = 0;
  for (let s = 1; s <= 20; s++) {
    const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, field, 500 + s);
    const made = sw.spawn(30, 40, 0, 5);
    const ring: GroundThreat = { id: 7000 + s, kind: "ring", x: 40, z: 0, r: 5, t: INFANTRY_DEFAULTS.diveNotice };
    const start = made.filter((i) => threatOut(ring, sw.px[i], sw.pz[i], 0).inside);
    for (let t = 0; t < INFANTRY_DEFAULTS.diveNotice; t += dt) {
      ring.t = INFANTRY_DEFAULTS.diveNotice - t;
      sw.dodge([ring]);
      // Their target far off (out of the band), so only the dodge moves them out.
      sw.update(dt, { x: 40, y: 3, z: 25, radius: 3 }, () => {});
    }
    for (const i of start) {
      const o = threatOut(ring, sw.px[i], sw.pz[i], 0);
      if (sw.rolledFor[i] === ring.id) { divers++; if (!o.inside) clear++; } else { stayers++; if (o.inside) stayersIn++; }
    }
  }
  console.log(`ring dodge: ${divers} dived, ${clear} clear when it landed; ${stayersIn} of ${stayers} who didn't notice still under it`);
  must(clear >= divers * 0.95, `only ${clear} of ${divers} divers were clear of the ring when it landed`);
}

// --- Scrappers are trampled too (a sprint through a pack); cutters and excavators aren't.
{
  const rs = new RobotSwarm({ ...ROBOT_DEFAULTS }, field, 9);
  const made = rs.spawn(40, 0, 20, 6, { mid: 0.2, big: 0 });
  const b: MechBody = { x: 0, z: -2, vx: 0, vz: at.sprint, reach: T.trampleReach, crush: 1 };
  let killed = 0, mids = 0;
  for (let t = 0; t < 40 / at.sprint; t += dt) {
    b.z += at.sprint * dt;
    rs.trample(b, T, (i, d, dx, dz) => { if (rs.kind[i] !== SMALL) mids++; const k = rs.damage(i, d, dx, dz); if (k) killed++; return k; });
  }
  console.log(`scrappers: a sprint through ${made.length} (${made.filter((i) => rs.kind[i] !== SMALL).length} cutters) killed ${killed}`);
  must(killed > 0, "a sprint through scrappers killed none");
  must(mids === 0, "a cutter was trampled");
}

// --- Rams: a sprint into a technical shoves it far more than the mech and hurts both the same.
{
  const r = ram(at.sprint, VEHICLE_MASS.technical, T), bus = ram(at.sprint, VEHICLE_MASS.partyBus, T);
  console.log(`ram at ${at.sprint} m/s: technical +${r.dvOther.toFixed(1)} m/s (mech -${r.dvMech.toFixed(1)}), party bus +${bus.dvOther.toFixed(1)} (mech -${bus.dvMech.toFixed(1)}); damage ${r.damage.toFixed(0)} each`);
  must(r.dvOther > r.dvMech && bus.dvOther < r.dvOther, "a ram doesn't shove light vehicles more than heavy ones");
  must(Math.abs(r.damage - r.mechDamage) < 1e-6 && r.damage > 0, "a ram doesn't hurt both the same");
  must(ram(1, 3, T).damage === 0, "a bump hurts");
}

// --- Legs set the reach: Stilt < Rampart < Siege, and a rolled item carries the stats.
{
  const reach = (base: string) => { const lo = defaultLoadout(); fit(lo, "legs", makeItem(base)); const v = resolve(lo).values; return [v.trample, v.crush]; };
  const [st, ra, si] = [reach("legs-stilt"), reach("legs-rampart"), reach("legs-siege")];
  console.log(`legs trample reach × / damage ×: stilt ${st[0]} / ${st[1]}, rampart ${ra[0]} / ${ra[1]}, siege ${si[0]} / ${si[1]}`);
  must(st[0] < ra[0] && ra[0] < si[0] && st[1] < ra[1] && ra[1] < si[1], "the legs don't order the trample Stilt < Rampart < Siege");
  const small = pass(at.sprint, 0, 3, T.trampleReach * st[0]), big = pass(at.sprint, 0, 3, T.trampleReach * si[0]);
  console.log(`a sprint through 60 on Stilt legs kills ${small.killed}, on Siege legs ${big.killed}`);
  must(small.killed < big.killed, "bigger legs don't trample more");
}

if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); throw new Error("trample check failed"); }
console.log("trample-check: OK");
