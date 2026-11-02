// Energy weapons' rules (Keith 2026-11-02, src/weapons/energy/): they spend the energy bars (the emptiest bar first, so
// full bars stay for dashes; nothing spent when there isn't enough; spending pauses the refill); a pulse laser fires at
// its rate and stops dry; a beam drains per second and ticks its damage at its rate; a nova lance pays as it charges,
// holds when dry, fires by its charge, fizzles under the least charge and drops its charge in a dash; the bases fit
// and resolve to their classes on no magazine; and on a stand-in battlefield the pulse laser, beam and lance hurt a
// cutout on their line, miss one off it, stop at a dune, and the lance's burst goes off where it lands.
// Run: npm test (or npx tsx tools/energy-check.ts).
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { EnergySim, energyStats, isEnergy, type EnergyPool } from "../src/weapons/energy/energySim";
import { EnergyGuns } from "../src/weapons/energy/energyGuns";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { DummyRange, DUMMY_DEFAULTS } from "../src/game/dummies";
import { defaultLoadout, fit, fitProblem, resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";
import { loadoutFor } from "../src/items/weaponPick";
import { itemDps } from "../src/items/power";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const V = { ...WEAPON_DEFAULTS };
const dt = 1 / 120;
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;
const taken = (d: { health: number; maxHealth: number }) => d.maxHealth - d.health;

// ---- The energy bars ----
{
  const d = new Dash({ ...DASH_DEFAULTS });
  must(d.charges === 4 && near(d.energy, 4), "a fresh mech doesn't start on 4 full bars");
  must(d.use(0.3) && near(d.energy, 3.7) && d.charges === 3 && near(d.bars[3], 0.7), `use() didn't take from the top bar first (${d.bars.map((b) => b.toFixed(2))})`);
  d.use(0.5);
  must(near(d.bars[3], 0.2) && d.charges === 3, "use() spent a full bar while a part bar had energy");
  d.use(0.5);
  must(near(d.bars[3], 0) && near(d.bars[2], 0.7) && d.charges === 2, `use() didn't carry over into the next bar (${d.bars.map((b) => b.toFixed(2))})`);
  const before = d.energy;
  must(!d.use(9) && near(d.energy, before), "use() spent energy it didn't have");
  must(d.use(0), "use(0) refused");
  // Spending pauses the refill like the sprint.
  d.use(0.1);
  d.update(DASH_DEFAULTS.dashRegenDelay * 0.5);
  const held = d.energy;
  d.use(0.01);
  d.update(DASH_DEFAULTS.dashRegenDelay * 0.9);
  must(d.energy <= held - 0.01 + 1e-6, "the bars refilled while energy was being spent");
  for (let t = 0; t < 30; t += 0.1) d.update(0.1);
  must(near(d.energy, 4, 1e-3), "the bars didn't refill after the weapons stopped");
}

// ---- The timing sims on a counting pool ----
const pool = (n: number): EnergyPool & { left: number } => ({ left: n, get energy() { return this.left; }, use(x: number) { if (x <= 0) return true; if (this.left < x - 1e-9) return false; this.left -= x; return true; } });
{
  const st = energyStats("laser", null, V), p = pool(100), sim = new EnergySim();
  let shots = 0;
  for (let t = 0; t < 2; t += dt) shots += sim.step(dt, true, st, p).shots;
  must(Math.abs(shots - 2 * V.pulseRate) <= 1, `the pulse laser fired ${shots} bolts in 2 s (want ${2 * V.pulseRate})`);
  must(near(100 - p.left, shots * V.pulseEnergy, 1e-6), "the pulse laser's bolts didn't each pay their energy");
  const dry = pool(V.pulseEnergy * 3.5), s2 = new EnergySim();
  let n = 0;
  for (let t = 0; t < 3; t += dt) n += s2.step(dt, true, st, dry).shots;
  must(n === 3 && s2.dry, `a pulse laser with 3.5 bolts of energy fired ${n} (want 3, then dry)`);
  const free = new EnergySim(), fp = pool(0);
  let fn = 0;
  for (let t = 0; t < 1; t += dt) fn += free.step(dt, true, st, fp, true).shots;
  must(fn >= V.pulseRate - 1, "energy off (free) didn't let the laser fire without energy");
}
{
  const st = energyStats("beam", null, V), p = pool(100), sim = new EnergySim();
  let ticks = 0;
  for (let t = 0; t < 2; t += dt) ticks += sim.step(dt, true, st, p).shots;
  must(Math.abs(ticks - 2 * V.beamTicks) <= 1, `the beam ticked ${ticks} times in 2 s (want ${2 * V.beamTicks})`);
  must(near(100 - p.left, 2 * V.beamDrain, 0.02), `the beam drained ${(100 - p.left).toFixed(3)} bars in 2 s (want ${2 * V.beamDrain})`);
  must(near(ticks * st.damage, 2 * V.beamDps, st.damage + 1e-6), "the beam's ticks don't add up to its damage per second");
  const dry = pool(V.beamDrain * 0.5), s2 = new EnergySim();
  let on = 0;
  for (let t = 0; t < 2; t += dt) { s2.step(dt, true, st, dry); if (s2.on) on += dt; }
  must(Math.abs(on - 0.5) < 0.05 && !s2.on && s2.dry, `a beam with half a second of energy burned ${on.toFixed(2)} s`);
}
{
  const st = energyStats("lance", null, V), p = pool(100), sim = new EnergySim();
  let power = 0;
  for (let t = 0; t < V.lanceCharge * 2; t += dt) sim.step(dt, true, st, p);
  must(near(sim.charge, 1), "the lance didn't charge to full");
  must(near(100 - p.left, V.lanceEnergy, 1e-6), `a full lance charge cost ${(100 - p.left).toFixed(3)} bars (want ${V.lanceEnergy})`);
  power = sim.step(dt, false, st, p).power;
  must(near(power, 1), "the lance didn't fire at full power on release");
  must(sim.step(dt, true, st, p).power === 0 && sim.charge === 0, "the lance charged during its cooldown");
  // Half a charge's energy: the charge holds at half.
  const half = pool(V.lanceEnergy * 0.5), s2 = new EnergySim();
  for (let t = 0; t < V.lanceCharge * 3; t += dt) s2.step(dt, true, st, half);
  must(Math.abs(s2.charge - 0.5) < 0.02 && s2.dry, `a lance with half a charge of energy charged to ${s2.charge.toFixed(2)}`);
  must(Math.abs(s2.step(dt, false, st, half).power - 0.5) < 0.02, "a half-charged lance didn't fire at half power");
  // Released early: a fizzle.
  const s3 = new EnergySim(), p3 = pool(100);
  for (let t = 0; t < V.lanceCharge * V.lanceMin * 0.5; t += dt) s3.step(dt, true, st, p3);
  const o3 = s3.step(dt, false, st, p3);
  must(o3.power === 0 && o3.fizzled && s3.charge === 0, "a lance released under the least charge fired or kept its charge");
  // A dash drops the charge.
  const s4 = new EnergySim();
  for (let t = 0; t < V.lanceCharge * 0.8; t += dt) s4.step(dt, true, st, pool(100));
  s4.drop();
  must(s4.charge === 0 && s4.step(dt, false, st, pool(100)).power === 0, "a dash didn't drop the lance's charge");
}

// ---- Items ----
{
  for (const [base, cls] of [["laser-medium", "laser"], ["beam-medium", "beam"], ["lance-medium", "lance"]] as const) {
    const lo = defaultLoadout();
    const it = makeItem(base, "common", `energy-${base}`);
    must(!fitProblem(lo, "mountR", it), `${base} doesn't fit a hull mount`);
    fit(lo, "mountR", it);
    const g = resolve(lo).guns.right;
    must(g?.cls === cls && isEnergy(g.cls) && g.ammo === 1 && (g.energy ?? 0) > 0, `${base} didn't resolve to an energy ${cls} with an energy cost`);
    must((itemDps(it) ?? 0) > 50, `${base} shows no DPS (${itemDps(it)})`);
  }
  const r = resolve(loadoutFor({ left: "laser", right: "lance", k1: "none", k2: "none", k3: "pack" }));
  must(r.guns.left?.cls === "laser" && r.guns.right?.cls === "lance" && r.guns.left.own === null, "?left=laser&right=lance didn't fit the energy weapons on the sliders");
}

// ---- On a stand-in battlefield ----
{
  type P = { x: number; y: number; z: number };
  const blasts: { at: P; r: number; dmg: number }[] = [];
  const mkBf = (range: DummyRange, ground: (x: number, z: number) => number) => ({
    targets: range.dummies, field: { height: ground }, wrecks: null, heat: null,
    sfx: { addSound() {}, playSound() {}, startSoundLoop: () => null, setSoundLoop() {}, stopLoop() {}, rate: 8000 },
    gunFx: { sparksAt() {}, onFleshHit: null }, dust: { hit() {}, smoke() {} }, inWater: () => false,
    blast: (_team: number, at: P, r: number, dmg: number) => { blasts.push({ at: { x: at.x, y: at.y, z: at.z }, r, dmg }); },
  });
  const mkUnit = () => ({ team: 0, dash: new Dash({ ...DASH_DEFAULTS }), lock: null, upper: { guns: [{ kick: 0 }, { kick: 0 }], shake: 0 } });
  const muzzle = new THREE.Vector3(0, 3.5, 0), flatDir = new THREE.Vector3(0, 0, 1);
  const fire = (cls: "laser" | "beam" | "lance", ground: (x: number, z: number) => number, aimZ: number, secs: number, spots: { x: number; z: number }[]) => {
    const range = new DummyRange({ ...DUMMY_DEFAULTS }, spots);
    const unit = mkUnit();
    const guns = new EnergyGuns(mkBf(range, ground) as never, unit as never, V);
    guns.configure(1, cls, null);
    const aim = { x: 0, y: ground(0, aimZ), z: aimZ };
    for (let t = 0; t < secs; t += dt) { guns.step(1, dt, true, false, muzzle, flatDir, aim); guns.age(dt); }
    guns.step(1, dt, false, false, muzzle, flatDir, aim);
    return { range, unit, guns };
  };
  const flat = () => 0;
  const spots = [{ x: 0, z: 25 }, { x: 6, z: 25 }];
  {
    const { range, unit } = fire("laser", flat, 25, 1, spots);
    const on = taken(range.dummies[0]), off = taken(range.dummies[1]);
    must(on > V.pulseDamage * 2 && off === 0, `the pulse laser didn't hurt the cutout on its line only (on ${on.toFixed(0)}, off ${off.toFixed(0)})`);
    must(unit.dash.energy < 4 - V.pulseEnergy * 3, "the pulse laser didn't spend the bars");
  }
  {
    const { range, guns } = fire("beam", flat, 25, 1, spots);
    const on = taken(range.dummies[0]);
    must(on > V.beamDps * 0.3 && taken(range.dummies[1]) === 0, `the beam didn't burn the cutout on its line (${on.toFixed(0)} in 1 s)`);
    must(!guns.sides[1].beam.on, "the beam stayed on after the trigger let go");
  }
  {
    blasts.length = 0;
    const { range } = fire("lance", flat, 25, V.lanceCharge + 0.1, spots);
    must(taken(range.dummies[0]) > V.lanceDamage * 0.2, `the full lance didn't hurt the cutout it hit (${taken(range.dummies[0]).toFixed(0)})`);
    must(blasts.length === 1 && Math.abs(blasts[0].at.z - 25) < 2 && near(blasts[0].dmg, V.lanceBlastDamage, 1), `the lance's burst didn't go off at the cutout (${JSON.stringify(blasts)})`);
  }
  {
    // A dune between: the bolt stops in it.
    const dune = (_x: number, z: number) => 6 * Math.exp(-(((z - 14) / 3) ** 2));
    const { range } = fire("laser", dune, 25, 1, [{ x: 0, z: 25 }]);
    must(taken(range.dummies[0]) === 0, "a pulse laser went through a dune");
  }
}

if (problems.length) {
  console.error(`energy-check: ${problems.length} problem(s)`);
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log("energy-check: ok (bars, laser, beam, lance timing and energy, items, rays on a stand-in field)");
