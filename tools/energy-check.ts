// Energy weapons' rules (Keith 2026-11-02, src/weapons/energy/): they draw on the reactor (src/mech/reactor.ts), never
// the dash's kinetic bars (busy regen, cap, a capacitor's passive and discharge; hulls carry reactors);
// a pulse laser fires at
// its rate and stops dry; a beam drains per second and ticks its damage at its rate; a nova lance pays as it charges,
// holds when dry, fires by its charge, fizzles under the least charge and drops its charge in a dash; the bases fit
// and resolve to their classes on no magazine; and on a stand-in battlefield the pulse laser, beam and lance hurt a
// cutout on their line, miss one off it, stop at a dune, and the lance's burst goes off where it lands.
// Run: npm test (or npx tsx tools/energy-check.ts).
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { EnergySim, energyNeed, energyStats, isEnergy, type EnergyPool } from "../src/weapons/energy/energySim";
import { EnergyGuns } from "../src/weapons/energy/energyGuns";
import { Dash, DASH_DEFAULTS } from "../src/mech/dash";
import { Reactor, REACTOR_DEFAULTS } from "../src/mech/reactor";
import { BASE_BY_ID } from "../src/items/bases";
import { DummyRange, DUMMY_DEFAULTS } from "../src/game/dummies";
import { defaultLoadout, energyNeedOf, fit, fitProblem, resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";
import { loadoutFor } from "../src/items/weaponPick";
import { itemDps } from "../src/items/power";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const V = { ...WEAPON_DEFAULTS };
const dt = 1 / 120;
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;
const taken = (d: { health: number; maxHealth: number }) => d.maxHealth - d.health;

// ---- The reactor (Keith 2026-11-02: apart from the dash's kinetic bars) ----
{
  const R = { ...REACTOR_DEFAULTS }, r = new Reactor(R);
  must(near(r.energy, R.reactorCap), "a fresh reactor isn't full");
  must(r.use(1.5) && near(r.energy, R.reactorCap - 1.5), "the reactor didn't spend");
  must(!r.use(99) && near(r.energy, R.reactorCap - 1.5), "the reactor spent energy it didn't have");
  // Busy (drawn on within the delay): regen at the busy share; idle: full regen.
  r.charge = 1; r.use(0.5); r.update(0.1);
  must(near(r.energy, 0.5 + R.reactorRegen * R.reactorBusy * 0.1, 1e-6), `the reactor's regen while firing isn't the busy share (${r.energy.toFixed(4)})`);
  r.charge = 1; r.idle = 99; r.update(0.1);
  must(near(r.energy, 1 + R.reactorRegen * 0.1, 1e-6), "the reactor's idle regen isn't its full rate");
  for (let t = 0; t < 60; t += 0.1) r.update(0.1);
  must(near(r.energy, R.reactorCap), "the reactor didn't refill to its cap (or went past it)");
  r.charge = 0; r.refillMul = 2; r.idle = 99; r.update(0.1);
  must(near(r.energy, 2 * R.reactorRegen * 0.1, 1e-6), "a capacitor's passive didn't speed the reactor's regen");
  r.charge = R.reactorCap - 0.5;
  must(near(r.refillNow(2), 0.5) && near(r.energy, R.reactorCap), "a discharge filled the reactor past its cap");
  // Hulls carry their own reactors, and they resolve onto the mech.
  for (const id of ["hull-rampart", "hull-siege", "hull-salvager", "hull-cuirass"]) must(!!BASE_BY_ID[id]?.stats.reactorCap && !!BASE_BY_ID[id]?.stats.reactorRegen, `${id} has no reactor`);
  const lo = defaultLoadout(); fit(lo, "hull", makeItem("hull-siege", "common", "reactor-siege"));
  const rv = resolve(lo).values;
  must(rv.reactorCap > REACTOR_DEFAULTS.reactorCap && rv.reactorRegen < REACTOR_DEFAULTS.reactorRegen, "the siege hull's big slow reactor didn't come through");
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

// ---- The sunder beam: a press commits it, it charges, blasts for its channel time, cools down ----
{
  const st = energyStats("sunder", null, V), p = pool(100), sim = new EnergySim();
  sim.step(dt, true, st, p);
  must(near(100 - p.left, V.sunderEnergy, 1e-6) && sim.phase === 1, `the sunder beam didn't pay its whole cost at the press (${(100 - p.left).toFixed(2)})`);
  let shots = 0, onAt = -1, offAt = -1;
  // One tap: let go at once; it carries on by itself.
  for (let t = dt; t < V.sunderCharge + V.sunderChannel + 1; t += dt) {
    shots += sim.step(dt, false, st, p).shots;
    if (sim.on && onAt < 0) onAt = t;
    if (!sim.on && onAt >= 0 && offAt < 0) offAt = t;
  }
  must(Math.abs(onAt - V.sunderCharge) < 0.02, `the sunder beam blasted ${onAt.toFixed(2)} s after the press (want ${V.sunderCharge})`);
  must(Math.abs(offAt - onAt - V.sunderChannel) < 0.02, `the sunder blast lasted ${(offAt - onAt).toFixed(2)} s (want ${V.sunderChannel})`);
  must(Math.abs(shots - V.sunderTicks * V.sunderChannel) <= 1, `the sunder blast ticked ${shots} times (want ${V.sunderTicks * V.sunderChannel})`);
  must(near(100 - p.left, V.sunderEnergy, 1e-6), "the sunder beam spent more energy after the press");
  must(sim.cool > 0 && sim.step(dt, true, st, p).shots === 0 && sim.phase === 0, "the sunder beam started again during its cooldown");
  // Not enough in the reactor: it doesn't start (and takes nothing).
  const low = pool(V.sunderEnergy * 0.5), s2 = new EnergySim();
  s2.step(dt, true, st, low);
  must(s2.phase === 0 && s2.dry && near(low.left, V.sunderEnergy * 0.5), "a sunder beam started without the energy for it");
  // A dash cuts it off mid-blast.
  const s3 = new EnergySim();
  for (let t = 0; t < V.sunderCharge + 0.5; t += dt) s3.step(dt, true, st, pool(100));
  must(s3.on, "the sunder beam wasn't blasting half a second in");
  s3.drop();
  must(!s3.on && s3.phase === 0 && s3.step(dt, false, st, pool(100)).shots === 0, "a dash didn't cut the sunder beam off");
}

// ---- Capacitor gating (Keith 2026-11-14, soft limits): a shot bigger than the reactor holds ----
{
  const capped = (n: number, cap: number) => Object.assign(pool(n), { cap });
  // A sunder beam on a reactor too small for its press: never starts, however long it's held, takes nothing.
  const st = energyStats("sunder", null, V), small = capped(V.sunderEnergy * 0.9, V.sunderEnergy * 0.9), s1 = new EnergySim();
  for (let t = 0; t < 3; t += dt) s1.step(dt, true, st, small);
  must(s1.phase === 0 && s1.under && s1.dry && near(small.left, V.sunderEnergy * 0.9), "an underpowered sunder beam started or spent energy");
  // Big enough: it fires (and isn't flagged). Energy free: never gated.
  const big = capped(V.sunderEnergy, V.sunderEnergy), s2 = new EnergySim();
  s2.step(dt, true, st, big);
  must(s2.phase === 1 && !s2.under, "a sunder beam with a reactor just big enough didn't start");
  const s3 = new EnergySim(); s3.step(dt, true, st, capped(0, 0.5), true);
  must(s3.phase === 1 && !s3.under, "a free sunder beam (Energy 0) was gated");
  // A lance on a reactor holding half its full charge: charges to half, however long, and fires at that power.
  const ls = energyStats("lance", null, V), half = capped(100, V.lanceEnergy * 0.5), s4 = new EnergySim();
  for (let t = 0; t < V.lanceCharge * 3; t += dt) s4.step(dt, true, ls, half);
  must(Math.abs(s4.charge - 0.5) < 1e-6 && s4.under, `an underpowered lance charged to ${s4.charge.toFixed(3)} (want 0.5)`);
  const power = s4.step(dt, false, ls, half).power;
  must(Math.abs(power - 0.5) < 1e-6, `the underpowered lance fired at ${power.toFixed(3)}`);
  // Per-shot weapons aren't gated.
  must(energyNeed("laser", 0.05) === 0 && energyNeed("beam", 0.4) === 0 && energyNeed("arc", 0.06) === 0, "a per-shot weapon has a gated need");
  // Items: the Rampart's reactor holds a sunder shot, a 3-bar Salvager's doesn't, a capacitor bank tops it up.
  const lo = defaultLoadout();
  fit(lo, "mountL", makeItem("sunder-medium"));
  const ramp = resolve(lo), need = energyNeedOf(ramp)!;
  must(need > 0 && need <= ramp.values.reactorCap, `a sunder beam on the Rampart is underpowered (${need} / ${ramp.values.reactorCap})`);
  lo.hull = makeItem("hull-salvager");
  const salv = resolve(lo);
  must(need > salv.values.reactorCap, `a sunder beam on the Salvager isn't underpowered (${need} / ${salv.values.reactorCap})`);
  fit(lo, "shoulderR", makeItem("sh-capacitor"));
  const bank = resolve(lo);
  must(bank.values.reactorCap > salv.values.reactorCap + 1 && need <= bank.values.reactorCap, `a capacitor bank didn't bring the Salvager up to a sunder shot (${bank.values.reactorCap})`);
  console.log(`capacitor gating: sunder needs ${need.toFixed(1)} bars · Rampart ${ramp.values.reactorCap} · Salvager ${salv.values.reactorCap} · Salvager + bank ${bank.values.reactorCap.toFixed(1)}`);
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
    gunFx: { sparksAt() {}, onFleshHit: null }, dust: { hit() {}, smoke() {} }, inWater: () => false, marks: { crater() {} }, register: { stamp: 0, count: 0 },
    blast: (_team: number, at: P, r: number, dmg: number) => { blasts.push({ at: { x: at.x, y: at.y, z: at.z }, r, dmg }); },
  });
  const mkUnit = () => ({ team: 0, dash: new Dash({ ...DASH_DEFAULTS }), reactor: new Reactor({ ...REACTOR_DEFAULTS }), lock: null, upper: { guns: [{ kick: 0 }, { kick: 0 }], shake: 0 } });
  const muzzle = new THREE.Vector3(0, 3.5, 0), flatDir = new THREE.Vector3(0, 0, 1);
  const fire = (cls: "laser" | "beam" | "lance" | "plasma" | "orb" | "arc" | "sunder", ground: (x: number, z: number) => number, aimZ: number, secs: number, spots: { x: number; z: number }[], after = 0, aimX = 0, proto?: { ricochet?: number; split?: number }) => {
    const range = new DummyRange({ ...DUMMY_DEFAULTS }, spots);
    const unit = mkUnit();
    // Candidates (the register is empty on this stand-in): each live dummy's middle.
    const cands = () => range.dummies.filter((d) => d.alive).map((d) => ({ x: d.x, y: d.y + 1, z: d.z, r: 0.6, key: d }));
    const guns = new EnergyGuns(mkBf(range, ground) as never, unit as never, V, cands);
    guns.configure(1, cls, null, proto);
    const aim = { x: aimX, y: ground(aimX, aimZ), z: aimZ };
    for (let t = 0; t < secs; t += dt) { guns.step(1, dt, true, false, muzzle, flatDir, aim); guns.age(dt); }
    guns.step(1, dt, false, false, muzzle, flatDir, aim);
    for (let t = 0; t < after; t += dt) guns.age(dt);
    return { range, unit, guns };
  };
  // The arc caster's spool (Keith 2026-11-14): no zap until the capacitors are full; full, it zaps at its rate; let
  // go, the spool drains, and a quick re-press fires sooner than a cold one; a dash empties it.
  {
    const st = energyStats("arc", null, V), sim = new EnergySim(), pool: EnergyPool = { energy: 99, use: () => true };
    let shots = 0, first = -1;
    for (let t = 0; t < V.arcSpool + 1 + dt / 2; t += dt) { const o = sim.step(dt, true, st, pool); if (o.shots && first < 0) first = t; shots += o.shots; }
    must(first >= V.arcSpool - 2 * dt && first <= V.arcSpool + 2 * dt, `the arc's first zap came at ${first.toFixed(3)} s, not after its ${V.arcSpool} s spool`);
    must(Math.abs(shots - (1 + V.arcRate * 1)) <= 1, `the arc zapped ${shots} times in its first second at full spool (want about ${1 + V.arcRate})`);
    const off = 0.2;
    for (let t = 0; t < off; t += dt) sim.step(dt, false, st, pool);
    must(near(sim.spin, 1 - off / V.arcSpinDown, 0.02), `the arc's spool didn't drain at its rate (${sim.spin.toFixed(3)})`);
    let again = 0;
    for (let t = 0; t < V.arcSpool; t += dt) { if (sim.step(dt, true, st, pool).shots) break; again += dt; }
    must(again < V.arcSpool * 0.6, `a quick re-press took ${again.toFixed(2)} s to zap (a warm spool should be quicker)`);
    sim.drop();
    must(sim.spin === 0, "a dash didn't empty the arc's spool");
    const st0 = { ...st, spool: 0 }, cold = new EnergySim();
    must(cold.step(dt, true, st0, pool).shots === 1, "an arc with no spool didn't zap at once");
  }
  const flat = () => 0;
  const spots = [{ x: 0, z: 25 }, { x: 6, z: 25 }];
  {
    const { range, unit } = fire("laser", flat, 25, 1, spots);
    const on = taken(range.dummies[0]), off = taken(range.dummies[1]);
    must(on > V.pulseDamage * 2 && off === 0, `the pulse laser didn't hurt the cutout on its line only (on ${on.toFixed(0)}, off ${off.toFixed(0)})`);
    must(unit.reactor.energy < REACTOR_DEFAULTS.reactorCap - V.pulseEnergy * 3, "the pulse laser didn't draw on the reactor");
    must(near(unit.dash.energy, DASH_DEFAULTS.dashCharges), "the pulse laser spent the dash's kinetic bars");
  }
  {
    // Prism (Keith 2026-11-04): the bolt reflects on to the cutout 6 m off its line, at the ricochet keep.
    const { range } = fire("laser", flat, 25, 1, spots, 0, 0, { ricochet: 1 });
    const on = taken(range.dummies[0]), off = taken(range.dummies[1]);
    must(on > V.pulseDamage * 2 && off > on * 0.3 && off < on * 0.7, `a Prism laser didn't reflect half on to the next cutout (on ${on.toFixed(0)}, off ${off.toFixed(0)})`);
    const b = fire("beam", flat, 25, 1, spots, 0, 0, { ricochet: 1 }).range;
    must(taken(b.dummies[1]) > 0, "a Prism beam didn't reflect on to the next cutout");
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
  // ---- Batch 2 on the stand-in field ----
  {
    // Plasma: flies at its speed (not there at once), bursts on the cutout on its line, splashes one beside it.
    const range0 = fire("plasma", flat, 25, dt * 2, [{ x: 0, z: 25 }]);
    must(taken(range0.range.dummies[0]) === 0 && range0.guns.orbs.length === 1, "a plasma bolt hit at once (it should fly)");
    const { range, guns } = fire("plasma", flat, 25, dt * 2, [{ x: 0, z: 25 }, { x: 1.2, z: 25.5 }, { x: 9, z: 25 }], 25 / V.plasmaSpeed + 0.3);
    must(taken(range.dummies[0]) >= V.plasmaDamage * 0.5, `the plasma bolt didn't burst on the cutout on its line (${taken(range.dummies[0]).toFixed(0)})`);
    must(taken(range.dummies[1]) > 0, "the plasma splash missed a cutout beside the burst");
    must(taken(range.dummies[2]) === 0, "the plasma splash reached a cutout 9 m off");
    must(guns.orbs.length === 0, "the plasma bolt didn't end at its burst");
  }
  {
    // Orb: passes through cutouts on its line, burning each, and runs out at its range.
    const life = V.orbRange / V.orbSpeed;
    const { range, guns } = fire("orb", flat, 30, dt * 2, [{ x: 0, z: 12 }, { x: 0.5, z: 20 }, { x: 9, z: 16 }], life + 0.5);
    must(taken(range.dummies[0]) > 0 && taken(range.dummies[1]) > 0, `the orb didn't burn both cutouts on its path (${taken(range.dummies[0]).toFixed(0)}, ${taken(range.dummies[1]).toFixed(0)})`);
    must(taken(range.dummies[2]) === 0, "the orb burnt a cutout 9 m off its path");
    must(guns.orbs.length === 0, "the orb outlived its range");
  }
  {
    // Arc: the cutout nearest the aim, then jumps along a line of cutouts 6 m apart, damage falling by the keep.
    const line = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ x: k * 6, z: 20 }));
    const { range, guns } = fire("arc", flat, 20, V.arcSpool + 2 * dt, line);
    const hits = guns.last.arcHits ?? 0;
    must(hits === Math.min(line.length, V.arcHops + 1), `the arc struck ${hits} cutouts (want ${Math.min(line.length, V.arcHops + 1)})`);
    must(taken(range.dummies[0]) > 0 && taken(range.dummies[V.arcHops]) > 0 && taken(range.dummies[V.arcHops + 1]) === 0, "the arc's jumps didn't run down the line in order and stop");
    const lone = fire("arc", flat, 20, V.arcSpool + 2 * dt, [{ x: 0, z: 20 }, { x: 0, z: 20 + V.arcHopRange + 3 }]);
    must(lone.guns.last.arcHits === 1 && taken(lone.range.dummies[1]) === 0, "the arc jumped further than its reach");
    const none = fire("arc", flat, 20, V.arcSpool + 2 * dt, [{ x: 0, z: 60 }]);
    must(none.guns.arcs.length === 1 && none.guns.last.arcHits === 1 && taken(none.range.dummies[0]) === 0, "an arc with nothing in range didn't ground at the aim");
  }
  {
    // Sunder: one press, it charges, then burns every cutout under its line (it isn't stopped by the first), none off it.
    const line = [{ x: 0, z: 12 }, { x: 0, z: 20 }, { x: 0, z: 28 }, { x: 7, z: 20 }];
    const charged = fire("sunder", flat, 40, V.sunderCharge * 0.9, line);
    must(line.every((_, k) => taken(charged.range.dummies[k]) === 0), "the sunder beam hurt something while still charging");
    must(charged.guns.sides[1].tele.on && !charged.guns.sides[1].beam.on, "the sunder beam's aim line didn't show while charging");
    must(charged.guns.slowed(), "the walk didn't slow while the sunder beam charged");
    const { range, guns, unit } = fire("sunder", flat, 40, V.sunderCharge + 1, line);
    const hit = [0, 1, 2].map((k) => taken(range.dummies[k]));
    must(hit.every((h) => h > 0), `the sunder beam didn't cut through every cutout on its line (${hit.map((h) => h.toFixed(0)).join(", ")})`);
    must(taken(range.dummies[3]) === 0, "the sunder beam burnt a cutout 7 m off its line");
    must(guns.sides[1].beam.on, "the sunder blast stopped when the trigger let go (it should run its channel time)");
    must(near(unit.reactor.energy, REACTOR_DEFAULTS.reactorCap - V.sunderEnergy, 0.3) && near(unit.dash.energy, DASH_DEFAULTS.dashCharges), "the sunder beam didn't draw its cost from the reactor alone");
    // A dune in the way: the blast ends in it.
    const dune = (_x: number, z: number) => 6 * Math.exp(-(((z - 16) / 3) ** 2));
    const blocked = fire("sunder", dune, 40, V.sunderCharge + 1, [{ x: 0, z: 25 }]);
    must(taken(blocked.range.dummies[0]) === 0, "the sunder beam went through a dune");
  }
  for (const [base, cls] of [["plasma-medium", "plasma"], ["orb-medium", "orb"], ["arc-medium", "arc"], ["sunder-medium", "sunder"]] as const) {
    const lo = defaultLoadout(), it = makeItem(base, "common", `energy-${base}`);
    fit(lo, "mountL", it);
    must(resolve(lo).guns.left?.cls === cls && (itemDps(it) ?? 0) > 50, `${base} didn't resolve to an energy ${cls} with DPS`);
  }
}

if (problems.length) {
  console.error(`energy-check: ${problems.length} problem(s)`);
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log("energy-check: ok (reactor, laser, beam, lance, plasma, orb, arc, sunder: timing and energy, items, hits on a stand-in field)");
