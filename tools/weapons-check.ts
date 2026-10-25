// The new weapons' rules (docs/proposal-weapons.md): a line rocket salvo's impacts cover its strip and land in order
// up it, the snap turns the strip onto a line of targets, cooldowns hold; a rail beam hits every target on its line
// and none off it, in order, losing damage per body, and stops at a dune; a rail released early fizzles; mortar shells
// land inside their ring and their arc clears a dune; autocannon lead hits a crossing target at constant speed (and
// no lead misses it); the new bases fit where the size rules say and resolve to the right gun classes.
// Run: npm test (or npx tsx tools/weapons-check.ts).
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { planStrip, impactPoints, SalvoSim, stripGap, onStrip } from "../src/weapons/salvo";
import { inStrip, stripLength } from "../src/weapons/painter";
import { RailSim, railPath, railFire } from "../src/weapons/rail";
import { mortarPoints, mortarAim, lobArc, MortarSim } from "../src/weapons/mortar";
import { CannonShells, leadPoint } from "../src/weapons/autocannon";
import { Shells } from "../src/game/shells";
import { DummyRange, DUMMY_DEFAULTS } from "../src/game/dummies";
import { rayCapsule } from "../src/game/mechUnit";
import type { Hittable } from "../src/game/battlefield";
import { UpperSim, UPPER_DEFAULTS } from "../src/mech/upper";
import { defaultLoadout, fit, fitProblem, resolve } from "../src/items/loadout";
import { makeItem, rollItem, LOOT_DEFAULTS } from "../src/items/generate";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const V = { ...WEAPON_DEFAULTS };
const flat = { height: () => 0 };
const ridge = (z0: number, h: number) => ({ height: (_x: number, z: number) => h * Math.exp(-(((z - z0) / 4) ** 2)) });
const dt = 1 / 120;

// ---- Salvo: the strip, its impacts in order, coverage, the snap, the cooldown ----
{
  const from = { x: 0, z: 0 };
  const s = planStrip(from, { x: 10, z: 30 }, V.salvoLength, V);
  must(Math.abs(stripLength(s) - V.salvoLength) < 1e-6, "strip isn't its length");
  const mid = { x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2 };
  must(Math.hypot(mid.x - 10, mid.z - 30) < 1e-6, "strip isn't centred on the cursor");
  must(Math.hypot(s.ax, s.az) < Math.hypot(s.bx, s.bz), "near end isn't the nearer");
  const close = planStrip(from, { x: 0, z: 3 }, V.salvoLength, V);
  must(Math.hypot(close.ax, close.az) >= V.salvoMinRange - 1e-6, "strip's near end came closer than its minimum");

  const sim = new SalvoSim(V);
  const st = { rockets: V.salvoRockets, damage: 100, cooldown: V.salvoCooldown, length: V.salvoLength, blast: V.salvoBlast };
  must(sim.fire(s, st, flat), "a ready salvo didn't fire");
  must(!sim.fire(s, st, flat), "fired again during the cooldown");
  const landed: { t: number; x: number; z: number; u: number }[] = [];
  let t = 0;
  const launch = (_i: number, out: { x: number; y: number; z: number }) => { out.x = 0; out.y = 5; out.z = -1; };
  while (t < 8) { t += dt; sim.update(dt, launch, (r) => landed.push({ t, x: r.pos.x, z: r.pos.z, u: onStrip(s, r.pos.x, r.pos.z).u })); }
  must(landed.length === V.salvoRockets, `${landed.length} rockets landed of ${V.salvoRockets}`);
  must(landed.every((l) => inStrip(s, l.x, l.z, 1e-6)), "a rocket landed outside its strip");
  must(landed.every((l, i) => i === 0 || (l.u > landed[i - 1].u && l.t > landed[i - 1].t)), "impacts didn't walk up the strip in order");
  const gap = stripGap(s, landed.map((l) => ({ x: l.x, z: l.z, r: V.salvoBlast })));
  must(gap <= 0, `a ${gap.toFixed(2)} m gap in the blasts along the strip`);
  // The cooldown: not ready just before it ends, ready just after.
  const cd = new SalvoSim(V);
  cd.fire(s, st, flat);
  let tc = 0;
  while (tc < st.cooldown - 0.05) { tc += dt; cd.update(dt, launch, () => {}); }
  must(!cd.ready && !cd.fire(s, st, flat), "fired before its cooldown was over");
  while (tc < st.cooldown + 0.05) { tc += dt; cd.update(dt, launch, () => {}); }
  must(cd.ready && cd.fire(s, st, flat), "didn't fire again after its cooldown");
  // Seeded scatter: the same seed lands the same points.
  must(JSON.stringify(impactPoints(s, 10, V, 7)) === JSON.stringify(impactPoints(s, 10, V, 7)), "impact scatter isn't seeded");
  // Snap: a broadside line of targets near the strip turns it onto them.
  const line = Array.from({ length: 7 }, (_, i) => ({ x: -9 + i * 3, z: 28 }));
  const sn = planStrip(from, { x: 0, z: 26 }, V.salvoLength, { ...V, salvoSnap: 1 }, line);
  const dirZ = Math.abs((sn.bz - sn.az) / stripLength(sn));
  must(dirZ < 0.1, `snap didn't turn the strip onto a broadside line (along-z share ${dirZ.toFixed(2)})`);
  must(line.every((p) => inStrip(sn, p.x, p.z, 0.5)), "snapped strip doesn't cover the line");
  const none = planStrip(from, { x: 0, z: 26 }, V.salvoLength, { ...V, salvoSnap: 0 }, line);
  must(Math.abs((none.bz - none.az) / stripLength(none)) > 0.99, "snap 0 still turned the strip");
}

// ---- Rail: every target on its line, none off it; in order; falling damage; a dune stops it; charge and fizzle ----
{
  const range = new DummyRange({ ...DUMMY_DEFAULTS }, [
    { x: 0, z: 10, light: true }, { x: 0.3, z: 16, light: true }, { x: -0.3, z: 24 }, { x: 0, z: 40, light: true },
    { x: 3, z: 14, light: true }, { x: -4, z: 30 }, { x: 0, z: -8, light: true },
  ]);
  range.update(0, flat);
  const targets: Hittable[] = range.dummies;
  const path = railPath(flat, { x: 0, z: 0 }, { x: 0, z: 1 }, 60, V);
  const hits = railFire(path, targets, 1, 1000, V);
  const hitSet = new Set(hits.map((h) => h.target));
  const onLine = [0, 1, 2, 3].map((i) => range.dummies[i]), off = [4, 5, 6].map((i) => range.dummies[i]);
  must(onLine.every((d) => hitSet.has(d)), `rail missed a target on its line (${hits.length} hits)`);
  must(off.every((d) => !hitSet.has(d)), "rail hit a target off its line");
  must(hits.length === 4, `rail hit ${hits.length} times for 4 bodies (one hit twice?)`);
  must(hits.every((h, i) => i === 0 || (h.along > hits[i - 1].along && h.damage < hits[i - 1].damage)), "rail hits not in order or damage not falling");
  must(Math.abs(hits[1].damage - 1000 * V.railPierceKeep) < 1e-6, "damage kept per body isn't the slider");
  must(range.dummies[0].kvz > 0, "a cutout on the line wasn't thrown back");
  // A dune: the beam stops short of it.
  const dune = ridge(30, V.railClimb + 3);
  const p2 = railPath(dune, { x: 0, z: 0 }, { x: 0, z: 1 }, 60, V);
  must(p2[p2.length - 1].z < 30, `the beam ran through a dune (ended at ${p2[p2.length - 1].z.toFixed(1)} m)`);
  // Charge: released early it fizzles (no cooldown); held, it fires full; the cooldown holds.
  const rs = new RailSim(V), st = { damage: 1, charge: 1, cooldown: 1.2, range: 60 };
  for (let i = 0; i < 12; i++) rs.update(dt, true, st);
  must(rs.update(dt, false, st) === null && rs.cooldown === 0, "a short tap fired (or cooled) the rail");
  let fired: number | null = null;
  for (let i = 0; i < 130; i++) rs.update(dt, true, st);
  fired = rs.update(dt, false, st);
  must(fired === 1, `a full charge fired at ${fired}`);
  for (let i = 0; i < 130; i++) rs.update(dt, true, st);
  must(rs.update(dt, false, st) === null, "fired again inside its cooldown");
}

// ---- Mortar: shells in their ring; the arc clears a dune; lead on a walking target ----
{
  for (let seed = 1; seed < 30; seed++) {
    const pts = mortarPoints(40, 20, 3 + (seed % 4), V.mortarRing, seed);
    must(pts.every((p) => Math.hypot(p.x - 40, p.z - 20) <= V.mortarRing + 1e-9), `seed ${seed}: a shell aimed outside the ring`);
  }
  const ms = new MortarSim(V);
  const shells = new Shells();
  const dune = ridge(25, 9);
  const from = new THREE.Vector3(0, 6, 0);
  must(ms.fire(0, 45, { shells: 3, damage: 1, cooldown: 4, blast: 3 }), "mortar didn't fire");
  must(!ms.fire(0, 45, { shells: 3, damage: 1, cooldown: 4, blast: 3 }), "mortar fired in its cooldown");
  let minClear = Infinity;
  const landed: THREE.Vector3[] = [];
  for (let i = 0; i < 120 * 5; i++) {
    ms.update(dt, (x, z) => { const to = new THREE.Vector3(x, dune.height(x, z), z); shells.lob(1, from, to, V.mortarFlight, lobArc(dune, from, to, V.mortarArc, V.mortarClear), 3, 1); });
    shells.update(dt, (s) => landed.push(s.pos.clone()));
    for (const s of shells.list) if (s.live && Math.abs(s.pos.z - 25) < 6) minClear = Math.min(minClear, s.pos.y - dune.height(s.pos.x, s.pos.z));
  }
  must(landed.length === 3, `${landed.length} mortar shells landed of 3`);
  must(landed.every((p) => Math.hypot(p.x, p.z - 45) <= V.mortarRing + 1e-6), "a mortar shell landed outside its ring");
  must(minClear > V.mortarClear * 0.8, `a shell skimmed the dune (cleared it by ${minClear.toFixed(2)} m)`);
  const led = mortarAim({ x: 0, z: 0 }, { x: 30, z: 30 }, { x: 30, z: 30, vx: 3, vz: 0 }, V);
  must(Math.abs(led.x - (30 + 3 * V.mortarFlight * V.mortarLead)) < 1e-6, "the ring doesn't lead a locked target's walk");
}

// ---- Autocannon: lead hits a crossing target at constant speed; no lead misses ----
{
  const shoot = (k: number) => {
    let x = -20, z = 40;
    const vx = 8;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let hit = false;
    const target: Hittable = {
      team: 2, alive: true, surface: "metal",
      hitRay: (o, d, max) => { a.set(x - 2, 1, z); b.set(x + 2, 1, z); return rayCapsule(o, d, a, b, 1.2, max); },
      damage: () => {},
    };
    const sh = new CannonShells();
    const from = { x: 0, y: 4, z: 0 };
    const lp = leadPoint(from, { x, y: 1, z }, { x: vx, y: 0, z: 0 }, V.acSpeed, V.acGravity, k);
    const d = new THREE.Vector3(lp.x - from.x, lp.y - from.y, lp.z - from.z).normalize();
    sh.fire(1, from, d, { damage: 1, speed: V.acSpeed, splash: 0, range: 100, spread: 0 });
    for (let i = 0; i < 240 && !hit; i++) { x += vx * dt; sh.update(dt, V.acGravity, { height: () => -50 }, [target], (_s, _at, t) => { if (t === target) hit = true; }); }
    return hit;
  };
  must(shoot(1), "a led autocannon shell missed a crossing truck");
  must(!shoot(0), "an autocannon shell with no lead still hit a crossing truck (lead isn't being tested)");
}

// ---- Loadout: the new bases fit where the size rules say; resolve gives their classes ----
{
  const lo = defaultLoadout();
  must(!fitProblem(lo, "armR", makeItem("rail-medium")), "a Medium rail cannon doesn't fit a hull mount");
  must(!!fitProblem(lo, "handR", makeItem("rail-medium")), "a Medium rail cannon fit a hand");
  must(!!fitProblem(lo, "armR", makeItem("rail-light")), "a Light rail cannon fit a hull mount");
  must(!!fitProblem(lo, "handR", makeItem("rail-light")), "a Light rail cannon fit a hand with no arm");
  must(!fitProblem(lo, "armL", makeItem("ac-medium")), "an autocannon doesn't fit a hull mount");
  must(!fitProblem(lo, "back", makeItem("back-salvo")) && !fitProblem(lo, "back", makeItem("back-mortar")), "back weapons don't fit the back mount");
  must(!!fitProblem(lo, "armL", makeItem("back-salvo")), "a rocket pod fit an arm mount");
  const bare = defaultLoadout(); bare.pack = null; bare.back = null;
  must(!!fitProblem(bare, "back", makeItem("back-salvo")), "a rocket pod fit without a power pack");
  fit(lo, "armR", makeItem("rail-medium"));
  fit(lo, "armL", makeItem("arm-rampart"));
  fit(lo, "handL", makeItem("rail-light"));
  fit(lo, "back", makeItem("back-salvo"));
  const r = resolve(lo);
  must(r.guns.right?.cls === "rail" && !r.guns.right.light && r.guns.right.own === null, "hull rail cannon didn't resolve as a Medium rail on the sliders");
  must(r.guns.left?.cls === "rail" && !!r.guns.left.light, "hand rail cannon didn't resolve as a Light rail");
  must(r.back?.weapon === "salvo" && !r.parts.drums, "rocket pod didn't resolve as the back weapon (or drums still shown)");
  const rolled = rollItem(77, LOOT_DEFAULTS, { base: "ac-medium", rarity: "epic" });
  fit(lo, "armR", rolled);
  const r2 = resolve(lo);
  must(r2.guns.right?.cls === "autocannon" && r2.guns.right.own?.shellSpeed === rolled.stats.shellSpeed, "a rolled autocannon's own stats didn't come through");
  // The default mech still has no new weapons.
  const d = resolve(defaultLoadout());
  must(!d.guns.left?.cls && !d.guns.right?.cls && d.back === null && d.parts.drums, "the default loadout changed");
  // A rail-class gun only aims in the upper-body sim: it never spins or fires rounds.
  const up = new UpperSim({ ...UPPER_DEFAULTS });
  up.reset(0);
  up.guns[1].stats = { ...r.guns.right! };
  up.resupply();
  let rounds = 0;
  for (let i = 0; i < 120 * 3; i++) for (const s of up.update(dt, 0, { x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 20 }, true)) if (s === -1) rounds++;
  must(rounds === 0 && up.guns[1].spin === 0, "a rail cannon fired minigun rounds");
}

console.log(`weapons: salvo ${V.salvoRockets} rockets over ${V.salvoLength} m, rail ${V.railDamage} keeping ${V.railPierceKeep}/body, mortar ring ${V.mortarRing} m, autocannon ${V.acSpeed} m/s`);
if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); throw new Error("weapons check failed"); }
console.log("weapons check passed");
