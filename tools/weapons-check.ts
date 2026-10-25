// The new weapons' rules (docs/proposal-weapons.md): a line rocket salvo's impacts cover its strip and land in order
// up it, the snap turns the strip onto a line of targets, cooldowns hold; a rail beam hits every target on its line
// and none off it, in order, losing damage per body, and stops at a dune; a rail released early fizzles; an RPG rocket
// lands where aimed or goes off early on a body, steel or a dune; a missile swarm makes 8-12 blasts all near its
// target, shared among enemies in reach; the big mortar lands in its area; per-side triggers; mortar shells
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
import { Rockets } from "../src/weapons/rocket";
import { SwarmSim, swarmAims } from "../src/weapons/swarm";
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

console.log(`weapons: salvo ${V.salvoRockets} rockets over ${V.salvoLength} m, rail ${V.railDamage} keeping ${V.railPierceKeep}/body, mortar ring ${V.mortarRing} m, autocannon ${V.acSpeed} m/s`);
if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); throw new Error("weapons check failed"); }
console.log("weapons check passed");
