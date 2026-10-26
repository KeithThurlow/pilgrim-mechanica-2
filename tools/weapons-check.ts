// The new weapons' rules (docs/proposal-weapons.md): a line rocket salvo's impacts cover its strip and land in order
// up it, the snap turns the strip onto a line of targets, cooldowns hold; sheet hits and penetration (a rail slug hits
// every cutout and every robot on its line, an excavator by its body and by a leg when the line misses the body, none
// off it, in order, damage falling with the budget; minigun rounds reach a scrapper on a slope above and below; a light
// minigun stops in the first bandit, the hull minigun passes a scrapper; the rail punches through a dune lip but not a
// dune, and a crest under the sheet costs nothing); a rail released early fizzles, inside the grace window fires full; an RPG rocket
// lands where aimed or goes off early on a body, steel or a dune; a missile swarm makes 8-12 blasts all near its
// target, shared among enemies in reach; the big mortar lands in its area; per-side triggers; mortar shells
// land inside their ring and their arc clears a dune; autocannon lead hits a crossing target at constant speed (and
// no lead misses it); the new bases fit where the size rules say and resolve to the right gun classes.
// Run: npm test (or npx tsx tools/weapons-check.ts).
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { planStrip, impactPoints, SalvoSim, stripGap, onStrip } from "../src/weapons/salvo";
import { inStrip, stripLength } from "../src/weapons/painter";
import { RailSim, railSheet } from "../src/weapons/rail";
import { makeSheet, resolveSheet, type SheetFire } from "../src/game/sheetFire";
import { RobotSwarm, ROBOT_DEFAULTS } from "../src/combat/robots";
import { RobotTarget } from "../src/combat/robotTarget";
import { InfantrySwarm, INFANTRY_DEFAULTS } from "../src/combat/infantry";
import { InfantryTarget } from "../src/combat/infantryTarget";
import { mortarPoints, mortarAim, lobArc, MortarSim } from "../src/weapons/mortar";
import { CannonShells, leadPoint } from "../src/weapons/autocannon";
import { Rockets } from "../src/weapons/rocket";
import { SwarmSim, swarmAims } from "../src/weapons/swarm";
import { Shells } from "../src/game/shells";
import { DummyRange, DUMMY_DEFAULTS } from "../src/game/dummies";
import { rayCapsule, roundPenFor, MECH_DEFAULTS } from "../src/game/mechUnit";
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

// ---- Sheet hits and penetration (Keith 2026-10-26): rail, minigun rounds, the SMG-class light gun, dunes ----
{
  const team = 1;
  const plane = (k: number) => ({ height: (_x: number, z: number) => k * z, normal: (_x: number, _z: number, out = [0, 1, 0]) => { const l = Math.hypot(k, 1); out[0] = 0; out[1] = 1 / l; out[2] = -k / l; return out; } });
  const flatN = { ...flat, normal: (_x: number, _z: number, out = [0, 1, 0]) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; } };
  /** Fire a sheet from a muzzle 4.5 m over the ground at (0, 0) toward an aim, resolving it on the targets. */
  const shoot = (ground: { height(x: number, z: number): number }, targets: Hittable[], aim: { x: number; y: number; z: number }, f: SheetFire, damage = 1000, aimAtBody = false) => {
    const muzzle = new THREE.Vector3(0, ground.height(0, 0) + 4.5, 0);
    const d = new THREE.Vector3(aim.x, (aimAtBody ? aim.y : ground.height(aim.x, aim.z)) - muzzle.y, aim.z).normalize();
    const sheet = makeSheet(ground, muzzle, f.flat ? new THREE.Vector3(d.x, 0, d.z).normalize() : d, f.flat ? 60 : 60, f, V);
    return resolveSheet(ground, targets, null, team, sheet, damage, f, d, V);
  };
  const railF = (aim: { x: number; y: number; z: number }) => railSheet(V, { damage: 1000, charge: 1, cooldown: 1, range: 60, pen: V.railPen }, aim);

  // The rail through a line of cutouts and posts: every one on its line, none off it, in order, damage not rising.
  {
    const range = new DummyRange({ ...DUMMY_DEFAULTS }, [
      { x: 0, z: 10, light: true }, { x: 0.3, z: 16, light: true }, { x: -0.3, z: 24 }, { x: 0, z: 40, light: true },
      { x: 3, z: 14, light: true }, { x: -4, z: 30 }, { x: 0, z: -8, light: true },
    ]);
    range.update(0, flat);
    const shot = shoot(flat, range.dummies, { x: 0, y: 0, z: 30 }, railF({ x: 0, y: 0, z: 30 }));
    const hitSet = new Set(shot.result.steps.map((s) => s.hit.target));
    const onLine = [0, 1, 2, 3].map((i) => range.dummies[i]), off = [4, 5, 6].map((i) => range.dummies[i]);
    must(onLine.every((d) => hitSet.has(d)), `rail missed a cutout on its line (${shot.result.steps.length} hits)`);
    must(off.every((d) => !hitSet.has(d)), "rail hit a cutout off its line");
    must(shot.result.steps.length === 4, `rail hit ${shot.result.steps.length} times for 4 bodies`);
    must(shot.result.steps.every((s, i) => i === 0 || (s.hit.along > shot.result.steps[i - 1].hit.along && s.share <= shot.result.steps[i - 1].share)), "rail hits not in order or damage rising");
    must(shot.result.steps[0].share === 1 && shot.result.steps[3].share < 1, "the first body didn't take full damage, or the last took full");
    must(range.dummies[0].kvz > 0, "a cutout on the line wasn't thrown back");
  }

  // The rail through a line of mixed robots: small scrappers, a cutter and an excavator (its body 10 m up) all hit,
  // the excavator by its body; a line past its body but through its legs hits a leg.
  {
    const sw = new RobotSwarm({ ...ROBOT_DEFAULTS }, flatN, 3);
    const put = (x: number, z: number, kind: "small" | "mid" | "big") => sw.spawn(1, x, z, 0, kind === "small" ? { mid: 0, big: 0 } : kind === "mid" ? { mid: 1, big: 0 } : { mid: 0, big: 1 })[0];
    const ids = [put(0, 10, "small"), put(0, 14, "small"), put(0, 21, "mid"), put(0, 33, "big"), put(0, 45, "small"), put(0, 50, "small")];
    const hitIdx = new Set<number>();
    const dmg = sw.damage.bind(sw);
    sw.damage = (i: number, a: number, dx: number, dz: number) => { hitIdx.add(i); return dmg(i, a, dx, dz); };
    const rt = new RobotTarget(sw, 2);
    const shot = shoot(flat, [rt], { x: 0, y: 0, z: 30 }, railF({ x: 0, y: 0, z: 30 }));
    must(ids.every((i) => hitIdx.has(i)), `rail missed robots on its line: hit ${[...hitIdx].join(",")} of ${ids.join(",")} (budget left ${shot.result.left.toFixed(2)})`);
    must(rt.partHits[0] === ids.length && rt.partHits[1] === 0, `robots on the line weren't all hit by the body (parts ${rt.partHits.join("/")})`);
    const big = ids[3];
    must(sw.hubY[big] > 8, `the excavator's body isn't high (${sw.hubY[big].toFixed(1)} m)`);
    // Past the body but through the legs.
    const sw2 = new RobotSwarm({ ...ROBOT_DEFAULTS }, flatN, 3);
    sw2.spawn(1, 0, 30, 0, { mid: 0, big: 1 });
    const rt2 = new RobotTarget(sw2, 2);
    let legHit = false;
    for (const x of [3.4, 4, 5, 6, -3.4, -4, -5, -6]) {
      const muzzle = new THREE.Vector3(x, 4.5, 0), d = new THREE.Vector3(0, 0, 1);
      const sheet = makeSheet(flat, muzzle, d, 60, railF({ x, y: 0, z: 30 }), V);
      const s = resolveSheet(flat, [rt2], null, team, sheet, 1, railF({ x, y: 0, z: 30 }), d, V);
      if (s.result.steps.length && rt2.partHits[0] === 0) legHit = true;
    }
    must(legHit && rt2.partHits[0] === 0, `a line past an excavator's body didn't hit a leg (parts ${rt2.partHits.join("/")})`);
  }

  // Minigun rounds aimed at the sand under a scrapper on a slope above and below the mech hit it (the sheet reaches).
  for (const k of [0.35, -0.35]) {
    const g = plane(k);
    const sw = new RobotSwarm({ ...ROBOT_DEFAULTS }, g, 5);
    const i = sw.spawn(1, 0, 25, 0, { mid: 0, big: 0 })[0];
    const rt = new RobotTarget(sw, 2);
    const f: SheetFire = { half: MECH_DEFAULTS.roundSheetHalf, height: MECH_DEFAULTS.roundSheetHeight, pen: MECH_DEFAULTS.roundPen, aim: { x: 0, y: g.height(0, 25), z: 25 } };
    // Aimed at the sand at its feet, and at the sand 1.5 m behind it (where the high camera puts a cursor on its image).
    for (const z of [25, 26.5]) {
      const aim = { x: 0, y: g.height(0, z), z };
      const shot = shoot(g, [rt], aim, { ...f, aim }, 0.01);
      must(shot.result.steps.some((s) => s.hit.target === rt && s.hit.key >> 2 === i), `a minigun round aimed at the sand ${z - 25} m behind a scrapper ${k > 0 ? "above" : "below"} the mech missed it`);
    }
  }

  // Penetration: the light (hand) minigun stops in the first bandit; the hull minigun passes a scrapper and stops in the
  // second; the rail goes through a dune lip but not a whole dune.
  {
    const iv = { ...INFANTRY_DEFAULTS };
    const bandits = new InfantrySwarm(iv, flatN, 2);
    for (const z of [10, 12, 14]) bandits.spawn(1, 0, z, 0);
    const it = new InfantryTarget(bandits, 2);
    const light = roundPenFor(MECH_DEFAULTS, 1);
    const f: SheetFire = { half: MECH_DEFAULTS.roundSheetHalf, height: MECH_DEFAULTS.roundSheetHeight, pen: light, aim: { x: 0, y: 0, z: 20 } };
    const s1 = shoot(flat, [it], { x: 0, y: 0, z: 20 }, f, 6);
    must(s1.result.steps.length === 1 && s1.result.steps[0].stopped, `a light minigun round (${light.toFixed(2)} m) didn't stop in the first bandit (${s1.result.steps.length} hits)`);
    const sw = new RobotSwarm({ ...ROBOT_DEFAULTS }, flatN, 9);
    for (const z of [10, 13, 16, 19]) sw.spawn(1, 0, z, 0, { mid: 0, big: 0 });
    const rt = new RobotTarget(sw, 2);
    const s2 = shoot(flat, [rt], { x: 0, y: 0, z: 25 }, { ...f, pen: MECH_DEFAULTS.roundPen, aim: { x: 0, y: 0, z: 25 } }, 9);
    must(s2.result.steps.length >= 2 && s2.result.steps.length <= 3, `a hull minigun round went through ${s2.result.steps.length} scrappers (want 2-3)`);
    // Dunes: a cutout at 50 m behind a ridge at 30 m. A lip poking ~1 m over the sheet's top: the rail punches
    // through (a minigun round doesn't); a whole dune 30 m tall stops it.
    const behind = () => { const r = new DummyRange({ ...DUMMY_DEFAULTS }, [{ x: 0, z: 50, light: true }]); return r; };
    const lip = ridge(30, V.railSheetHeight + 1), dune = ridge(30, 30);
    const r1 = behind(); r1.update(0, lip);
    const sLip = shoot(lip, r1.dummies, { x: 0, y: 0, z: 50 }, railF({ x: 0, y: 0, z: 50 }));
    must(sLip.result.steps.length === 1 && !sLip.result.inGround, `the rail didn't punch through a dune lip (ended at ${sLip.result.end.toFixed(1)} m)`);
    const r2 = behind(); r2.update(0, lip);
    const sLipM = shoot(lip, r2.dummies, { x: 0, y: 0, z: 50 }, { ...f, pen: MECH_DEFAULTS.roundPen, aim: { x: 0, y: 0, z: 50 } });
    must(sLipM.result.inGround && sLipM.result.steps.length === 0, "a minigun round went through a dune lip");
    const r3 = behind(); r3.update(0, dune);
    const sDune = shoot(dune, r3.dummies, { x: 0, y: 0, z: 50 }, railF({ x: 0, y: 0, z: 50 }));
    must(sDune.result.inGround && sDune.result.end < 32 && sDune.result.steps.length === 0, `the rail went through a whole dune (ended at ${sDune.result.end.toFixed(1)} m)`);
    // A dune lower than the sheet's top doesn't stop it at all (firing over a crest).
    const low = ridge(30, V.railSheetHeight - 2), r4 = behind(); r4.update(0, low);
    const sLow = shoot(low, r4.dummies, { x: 0, y: 0, z: 50 }, railF({ x: 0, y: 0, z: 50 }));
    must(sLow.result.steps.length === 1 && sLow.result.left === V.railPen - sLow.result.steps[0].hit.chord * V.penFlesh, "a crest under the sheet's top cost the rail something");
  }

  // Charge: released early it fizzles (no cooldown); within the grace window it fires full; partial fires partial.
  const rs = new RailSim(V), st = { damage: 1, charge: 1, cooldown: 1.2, range: 60, pen: 10 };
  for (let i = 0; i < 12; i++) rs.update(dt, true, st);
  must(rs.update(dt, false, st) === null && rs.cooldown === 0, "a short tap fired (or cooled) the rail");
  for (let i = 0; i < 130; i++) rs.update(dt, true, st);
  const full = rs.update(dt, false, st);
  must(full === 1, `a full charge fired at ${full}`);
  for (let i = 0; i < 130; i++) rs.update(dt, true, st);
  must(rs.update(dt, false, st) === null, "fired again inside its cooldown");
  const rg = new RailSim(V);
  for (let i = 0; i < Math.round(120 * (1 - V.railGrace * 0.5)); i++) rg.update(dt, true, st);
  must(rg.update(dt, false, st) === 1, "a release inside the grace window didn't fire at full power");
  const rp = new RailSim(V);
  for (let i = 0; i < 60; i++) rp.update(dt, true, st);
  const part = rp.update(dt, false, st);
  must(part !== null && part > 0.4 && part < 0.6, `a half charge fired at ${part}`);
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

// ---- Loadout: the new bases fit where the mount rules say; resolve gives their classes ----
{
  const lo = defaultLoadout();
  must(!fitProblem(lo, "mountR", makeItem("rail-medium")), "a Medium rail cannon doesn't fit a hull mount");
  must(!!fitProblem(lo, "heldR", makeItem("rail-medium")), "a Medium rail cannon was held");
  must(!!fitProblem(lo, "mountR", makeItem("rail-light")), "a Light rail cannon fit a hull mount");
  must(!!fitProblem(lo, "heldR", makeItem("rail-light")), "a Light rail cannon was held with no arm");
  must(!fitProblem(lo, "mountL", makeItem("ac-medium")), "an autocannon doesn't fit a hull mount");
  must(!fitProblem(lo, "mountL", makeItem("rpg-medium")), "a rocket launcher doesn't fit a hull mount");
  const arms = defaultLoadout();
  fit(arms, "mountL", makeItem("arm-rampart", "common", "aL")); fit(arms, "mountR", makeItem("arm-rampart", "common", "aR"));
  for (const id of ["sh-rpg", "sh-missiles", "sh-mortar", "sh-linemortar"]) {
    must(!!fitProblem(lo, "shoulderL", makeItem(id)), `${id} fit a shoulder on a side with a hull weapon (no arm)`);
    must(!fitProblem(arms, "shoulderL", makeItem(id)) && !fitProblem(arms, "shoulderR", makeItem(id)) && !fitProblem(lo, "pack", makeItem(id)), `${id} doesn't fit an arm's shoulder or the pack mount`);
    must(!!fitProblem(lo, "mountL", makeItem(id)) && !!fitProblem(arms, "heldL", makeItem(id)), `${id} fit a hull mount or a hand`);
  }
  must(!!fitProblem(arms, "shoulderL", makeItem("waist-drums")), "ammo drums fit a shoulder");
  fit(lo, "mountR", makeItem("rail-medium"));
  fit(lo, "mountL", makeItem("arm-rampart"));
  fit(lo, "heldL", makeItem("rail-light"));
  fit(lo, "shoulderL", makeItem("sh-missiles"));
  fit(lo, "pack", makeItem("sh-linemortar"));
  const r = resolve(lo);
  must(r.guns.right?.cls === "rail" && !r.guns.right.light && r.guns.right.own === null, "hull rail cannon didn't resolve as a Medium rail on the sliders");
  must(r.guns.left?.cls === "rail" && !!r.guns.left.light, "held rail cannon didn't resolve as a Light rail");
  must(JSON.stringify(r.shoulders.map((x) => [x.key, x.weapon])) === JSON.stringify([[1, "missiles"], [3, "linemortar"]]) && r.parts.drums && !r.parts.pack,
    `shoulder weapons didn't resolve to keys 1 and 3 (${JSON.stringify(r.shoulders.map((x) => [x.key, x.weapon]))}), the drums went or the pack still shows`);
  // An arm on the right too (the hull rail bounces), then its shoulder on key 2.
  const off = fit(lo, "mountR", makeItem("arm-rampart", "common", "aR2"));
  must(off.some((i) => i.base === "rail-medium"), "an arm didn't bounce the hull weapon");
  fit(lo, "shoulderR", makeItem("sh-mortar"));
  must(JSON.stringify(resolve(lo).shoulders.map((x) => [x.key, x.weapon])) === JSON.stringify([[1, "missiles"], [2, "mortar"], [3, "linemortar"]]), "shoulder weapons didn't resolve to keys 1-3");
  const rolled = rollItem(77, LOOT_DEFAULTS, { base: "ac-medium", rarity: "epic" });
  const off2 = fit(lo, "mountR", rolled);
  must(off2.some((i) => i.base === "sh-mortar") && !lo.shoulderR, "a hull weapon didn't bounce that side's shoulder weapon");
  const r2 = resolve(lo);
  must(r2.guns.right?.cls === "autocannon" && r2.guns.right.own?.shellSpeed === rolled.stats.shellSpeed, "a rolled autocannon's own stats didn't come through");
  // The default mech still has no new weapons.
  const d = resolve(defaultLoadout());
  must(!d.guns.left?.cls && !d.guns.right?.cls && d.shoulders.length === 0 && d.parts.drums, "the default loadout changed");
  // A rail-class gun only aims in the upper-body sim: it never spins or fires rounds.
  const up = new UpperSim({ ...UPPER_DEFAULTS });
  up.reset(0);
  up.guns[1].stats = { ...r.guns.right! };
  up.resupply();
  let rounds = 0;
  for (let i = 0; i < 120 * 3; i++) for (const s of up.update(dt, 0, { x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 20 }, true)) if (s === -1) rounds++;
  must(rounds === 0 && up.guns[1].spin === 0, "a rail cannon fired minigun rounds");
  // Per-side triggers: only the left gun's trigger held, only the left gun fires.
  const up2 = new UpperSim({ ...UPPER_DEFAULTS });
  up2.reset(0); up2.resupply();
  const side: Record<number, number> = { 1: 0, [-1]: 0 };
  for (let i = 0; i < 120 * 3; i++) for (const s of up2.update(dt, 0, { x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 20 }, [true, false])) side[s]++;
  must(side[1] > 0 && side[-1] === 0, `left trigger fired L ${side[1]} R ${side[-1]}`);
}

// ---- RPG rocket: lands where aimed, or goes off early on a body, steel or a dune in the way ----
{
  const st = { damage: 1, blast: 4, speed: V.rpgSpeed, cooldown: 1 };
  const run = (ground: { height(x: number, z: number): number }, targets: Hittable[], blocker: ((o: THREE.Vector3, d: THREE.Vector3, m: number) => number) | null) => {
    const rk = new Rockets();
    rk.fire(1, { x: 0, y: 4, z: 0 }, { x: 0, y: ground.height(0, 40), z: 40 }, st);
    let end: { at: THREE.Vector3; why: string } | null = null;
    for (let i = 0; i < 600 && !end; i++) rk.update(dt, ground, targets, blocker, (_r, at, why) => { end = { at: at.clone(), why }; });
    return end as { at: THREE.Vector3; why: string } | null;
  };
  const clear = run(flat, [], null);
  must(!!clear && clear.why === "target" && Math.hypot(clear.at.x, clear.at.z - 40) < 0.05, `a rocket didn't land on its point (${clear?.why} at ${clear?.at.toArray().map((n) => n.toFixed(2))})`);
  const range = new DummyRange({ ...DUMMY_DEFAULTS }, [{ x: 0, z: 20 }]);
  range.update(0, flat);
  const body = run(flat, range.dummies, null);
  must(!!body && body.why === "body" && body.at.z < 20 && body.at.z > 18, `a rocket didn't go off on a body in its way (${body?.why} at z ${body?.at.z.toFixed(2)})`);
  const wall = run(flat, [], (o, d, max) => { const t = (25 - o.z) / (d.z || 1e-9); return t >= 0 && t <= max ? t : -1; });
  must(!!wall && wall.why === "steel" && Math.abs(wall.at.z - 25) < 0.05, `a rocket didn't go off on steel in its way (${wall?.why} at z ${wall?.at.z.toFixed(2)})`);
  const dune = run(ridge(20, 8), [], null);
  must(!!dune && dune.why === "ground" && dune.at.z < 20, `a rocket went through a dune (${dune?.why} at z ${dune?.at.z.toFixed(2)})`);
}

// ---- Missile swarm: its count, every blast near the target point; shared among enemies in reach ----
{
  const st = { missiles: V.swarmMissiles, damage: 1, blast: 2, cooldown: 5, radius: V.swarmRadius };
  for (const enemies of [[], [{ x: 32, z: 41, key: "a" }, { x: 27, z: 38, key: "b" }, { x: 60, z: 60, key: "far" }]]) {
    const sw = new SwarmSim(V);
    must(sw.fire(30, 40, st, enemies, flat), "a ready missile pod didn't fire");
    must(!sw.fire(30, 40, st, enemies, flat), "a missile pod fired in its cooldown");
    const hits: { x: number; z: number; key: unknown }[] = [];
    for (let i = 0; i < 120 * 6; i++) sw.update(dt, flat, (_i, out) => { out.x = 0; out.y = 5; out.z = 0; }, () => null, (m) => hits.push({ x: m.pos.x, z: m.pos.z, key: m.key }));
    must(hits.length >= 8 && hits.length <= 12, `${hits.length} missile blasts (want 8-12)`);
    must(hits.every((h) => Math.hypot(h.x - 30, h.z - 40) <= st.radius + 0.01), "a missile came down outside the swarm's reach");
    if (enemies.length) must(hits.every((h) => h.key === "a" || h.key === "b"), "a missile went for an enemy out of reach (or none)");
  }
  const aims = swarmAims(0, 0, 10, 8, [], 3);
  must(new Set(aims.map((a) => `${a.x.toFixed(2)},${a.z.toFixed(2)}`)).size === 10, "with no enemies, the swarm didn't scatter");
}

// ---- Big mortar: one shell into its point (over a dune) ----
{
  const ms = new MortarSim(V), shells = new Shells(), dune = ridge(25, 9), from = new THREE.Vector3(0, 6, 0);
  must(ms.fire(0, 50, { shells: V.mortarShells, damage: 1, cooldown: 8, blast: V.mortarBlast }), "big mortar didn't fire");
  const landed: THREE.Vector3[] = [];
  for (let i = 0; i < 120 * 6; i++) {
    ms.update(dt, (x, z) => { const to = new THREE.Vector3(x, dune.height(x, z), z); shells.lob(1, from, to, V.mortarFlight, lobArc(dune, from, to, V.mortarArc, V.mortarClear), V.mortarBlast, 1); });
    shells.update(dt, (s) => landed.push(s.pos.clone()));
  }
  must(landed.length === V.mortarShells, `${landed.length} big mortar shells landed (want ${V.mortarShells})`);
  must(landed.every((p) => Math.hypot(p.x, p.z - 50) <= V.mortarRing + 1e-6), "a big mortar shell landed outside its area");
}

console.log(`weapons: salvo ${V.salvoRockets} rockets over ${V.salvoLength} m, rail ${V.railDamage} with ${V.railPen} m penetration, mortar ring ${V.mortarRing} m, autocannon ${V.acSpeed} m/s`);
if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); throw new Error("weapons check failed"); }
console.log("weapons check passed");
