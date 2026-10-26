// Soft lock rules: the enemy under the cursor ray wins (a tall walker also by the sand among its feet); else the one
// nearest the line of fire; never behind, out of range or far off the line. And the guns reach a tall one's body.
// The register (src/game/register.ts) under it: near, nearest, ray (in order, with chords) and cone agree with brute
// force on random scenes; the soft lock over the register picks what the old list scan picked; ids stay put while
// robots and bandits move, and a slot reused after a death gets a new id.
import { Targeting, TARGET_DEFAULTS, enemiesOf, type TargetCandidate, type LockQuery, type TargetValues } from "../src/game/targeting";
import { Register, RayHits, KIND, FLAG, kindBit, type Filter } from "../src/game/register";
import { listOwner } from "../src/game/registerOwners";
import { UpperSim, UPPER_DEFAULTS } from "../src/mech/upper";
import { RobotSwarm, ROBOT_DEFAULTS, DOWN as R_DOWN } from "../src/combat/robots";
import { InfantrySwarm, INFANTRY_DEFAULTS } from "../src/combat/infantry";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log("FAIL", what); } };
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// ---- A little world of named candidates in a register (one object per name, kept while it's listed) ----
type Item = TargetCandidate & { alive: boolean; name: string };
class World {
  reg = new Register();
  items: Item[] = [];
  byName = new Map<string, Item>();
  constructor() {
    this.reg.add(listOwner("t", () => this.items, (r, c, k, s) => r.put(k, s, KIND.Unit, 3, FLAG.Hittable, c.x, c.y, c.z, c.r, c.foot ?? 0, c.vx ?? 0, c.vz ?? 0)));
  }
  set(cands: readonly TargetCandidate[]) {
    for (const it of this.items) it.alive = false;
    for (const c of cands) {
      const name = String(c.key);
      let it = this.byName.get(name);
      if (!it) { it = { ...c, alive: true, name }; this.byName.set(name, it); this.items.push(it); }
      Object.assign(it, c, { alive: true, name });
    }
    this.reg.rebuild();
  }
  name(id: unknown) { const e = this.reg.find(id as number); return e < 0 ? null : this.items[this.reg.index[e]].name; }
}
const world = new World();
const ENEMY = enemiesOf(1);
function pick(t: Targeting, cands: readonly TargetCandidate[], q: LockQuery, v: TargetValues) {
  world.set(cands);
  const l = t.pick(world.reg, ENEMY, q, v);
  return l ? { ...l, target: { ...l.target, key: world.name(l.target.key) } } : null;
}

const v = { ...TARGET_DEFAULTS, lockSticky: 0 };
const from = { x: 0, y: 0, z: 0 };
// Camera high behind and above the mech, looking down 50° toward +z.
const cam = { x: 0, y: 30, z: -26 };
function q(cx: number, cz: number) {
  const dx = cx - cam.x, dy = 0 - cam.y, dz = cz - cam.z, l = Math.hypot(dx, dy, dz);
  return { rayO: cam, rayD: { x: dx / l, y: dy / l, z: dz / l }, from, cursor: { x: cx, y: 0, z: cz }, range: 60 };
}
const c = (x: number, y: number, z: number, r: number, key: string): TargetCandidate => ({ x, y, z, r, key });

{ // Under the cursor beats nearer the line.
  const t = new Targeting();
  const l = pick(t, [c(0.3, 1, 15, 0.6, "onLine"), c(4, 1, 30, 0.6, "atCursor")], q(4, 30), v);
  ok(l?.target.key === "atCursor" && l.how === "cursor", "enemy under the cursor wins");
}
{ // A tall walker: cursor on the ground just short of its feet still lines up with its high body along the camera ray.
  const t = new Targeting();
  // The camera ray to (0, 0, 20) passes y = 10 at z = 20 - 10 * 46/30.
  const zBody = 20 - (10 * 46) / 30;
  const l = pick(t, [c(0, 10, zBody, 1.5, "tall")], q(0, 20), v);
  ok(l?.target.key === "tall" && l.how === "cursor", "tall walker taken by its body on the cursor ray");
}
{ // Line of fire: nearest the line, not nearest the mech.
  const t = new Targeting();
  const l = pick(t, [c(2.5, 1, 10, 0.6, "near"), c(0.4, 1, 40, 0.6, "onLine")], q(0, 25), v);
  ok(l?.target.key === "onLine" && l.how === "line", "nearest the line wins");
}
{ // Never behind, never out of range, never far off the line.
  const t = new Targeting();
  ok(pick(t, [c(0, 1, -10, 0.6, "behind")], q(0, 20), v) === null, "nothing behind the mech");
  ok(pick(t, [c(0, 1, 80, 0.6, "far")], q(0, 20), v) === null, "nothing out of range");
  ok(pick(t, [c(15, 1, 20, 0.6, "wide")], q(0, 20), v) === null, "nothing far off the line");
  ok(pick(t, [c(0, 1, 20, 0.6, "x")], q(0, 20), { ...v, autoLock: 0 }) === null, "off means off");
}
{ // Sticky: the last target is kept against a slightly better one.
  const t = new Targeting();
  const sv = { ...v, lockSticky: 0.6 };
  pick(t, [c(0.5, 1, 30, 0.6, "a")], q(0, 30), sv);
  const l = pick(t, [c(1.5, 1, 30, 0.6, "a"), c(1.2, 1, 30, 0.6, "b")], q(0, 50), sv);
  ok(l?.target.key === "a", "keeps the last target against a slightly better one");
}
{ // A tall walker's footprint: the cursor on the sand among its feet locks its body, not nothing (Keith 2026-10-26).
  const t = new Targeting();
  const big = { ...c(3, 10.5, 30, 2, "excavator"), foot: 8 };
  const l = pick(t, [big], q(9, 34), v);
  ok(l?.target.key === "excavator" && l.target.y === 10.5, "cursor among a tall walker's feet locks its body");
  // A small one right under the cursor among those feet still wins.
  const l2 = pick(t, [big, c(9, 0.5, 34, 0.5, "small")], q(9, 34), v);
  ok(l2?.target.key === "small", "a small one under the cursor beats the big one whose feet it's among");
}
{ // Guns that reach up: a big one's chassis 10.5 m up, 7 m away, from the Rampart's shoulders about 4.2 m up. The
  // guns raise (plus the torso's lean), come on target and fire; with the old 20° limit they couldn't.
  const run = (vals: typeof UPPER_DEFAULTS) => {
    const up = new UpperSim(vals);
    up.reset(0);
    let fired = 0, on = 0;
    for (let i = 0; i < 240; i++) {
      fired += up.update(1 / 120, 0, { x: 0, y: 4.2, z: 0 }, { x: 0.5, y: 10.5, z: 7 }, true).length;
      if (up.onTarget) on++;
    }
    return { fired, on, lean: up.lean, pitch: Math.min(up.guns[0].pitch, up.guns[1].pitch) };
  };
  const now = run({ ...UPPER_DEFAULTS }), old = run({ ...UPPER_DEFAULTS, podPitchUp: 20, torsoLeanMax: 0 });
  console.log(`reach up: chassis 7 m off, 6.3 m over the shoulders: ${now.fired} rounds, gun raised ${(-now.pitch * 180 / Math.PI).toFixed(0)}° + lean ${(now.lean * 180 / Math.PI).toFixed(0)}° (at 20° and no lean: ${old.fired} rounds)`);
  ok(now.fired > 20, "a tall robot's chassis is reachable from 7 m");
  ok(old.fired === 0, "a target past the raise limit isn't fired on");
}

// ---- The register against brute force ----
interface Thing { x: number; y: number; z: number; r: number; foot: number; kind: number; team: number; flags: number; alive: boolean }
function randomScene(n: number, spread: number): Thing[] {
  const out: Thing[] = [];
  for (let i = 0; i < n; i++) {
    const big = rnd() < 0.05, walker = rnd() < 0.08;
    // Some packed tight (swarms on top of each other), some on cell edges, some far out.
    const cx = rnd() < 0.3 ? Math.round((rnd() - 0.5) * spread / 4) * 4 : (rnd() - 0.5) * spread;
    const cz = rnd() < 0.3 ? Math.round((rnd() - 0.5) * spread / 4) * 4 : (rnd() - 0.5) * spread;
    out.push({
      x: cx, y: 0.3 + rnd() * (walker ? 11 : 2), z: cz, r: big ? 2 + rnd() * 3 : 0.3 + rnd() * 1.6, foot: walker ? 3 + rnd() * 6 : 0,
      kind: Math.floor(rnd() * 4), team: 1 + Math.floor(rnd() * 3), flags: (rnd() < 0.9 ? FLAG.Hittable : 0) | (rnd() < 0.5 ? FLAG.Light : 0) | (rnd() < 0.2 ? FLAG.Asleep : 0),
      alive: true,
    });
  }
  return out;
}
const filters: Filter[] = [{}, { all: FLAG.Hittable, notTeam: 1 }, { team: 2 }, { kinds: kindBit(KIND.Unit) | kindBit(KIND.Mech) }, { all: FLAG.Hittable, none: FLAG.Asleep }];
const passes = (t: Thing, f: Filter) => (f.kinds === undefined || ((f.kinds >> t.kind) & 1) === 1) && (f.all === undefined || (t.flags & f.all) === f.all)
  && (f.none === undefined || (t.flags & f.none) === 0) && (f.team === undefined || t.team === f.team) && (f.notTeam === undefined || t.team !== f.notTeam);
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
{
  let scenes = 0, queries = 0, bad = 0, gridMs = 0, bruteMs = 0;
  const out: number[] = [], hits = new RayHits();
  for (let s = 0; s < 40; s++) {
    const n = s < 5 ? s * 3 : 50 + Math.floor(rnd() * 2500), spread = 20 + rnd() * 400;
    const things = randomScene(n, spread);
    const reg = new Register(4, s % 2 ? 16 : 4096); // small capacity: grows
    reg.add(listOwner("things", () => things, (r, t, k, ser) => r.put(k, ser, t.kind, t.team, t.flags, t.x, t.y, t.z, t.r, t.foot)));
    reg.rebuild();
    scenes++;
    ok(reg.count === n, "every thing published");
    const T = (e: number) => things[reg.index[e]];
    for (let k = 0; k < 60; k++) {
      const f = filters[k % filters.length];
      const x = (rnd() - 0.5) * spread * 1.2, z = (rnd() - 0.5) * spread * 1.2;
      // near (body, then footprint)
      const R = rnd() < 0.1 ? 0 : rnd() * (rnd() < 0.2 ? 200 : 12), useFoot = k % 3 === 0;
      let t0 = performance.now();
      reg.near(x, z, R, f, out, useFoot);
      const got = out.map((e) => reg.index[e]).sort((a, b) => a - b);
      gridMs += performance.now() - t0; t0 = performance.now();
      const want: number[] = [];
      things.forEach((t, i) => {
        if (!passes(t, f)) return;
        const reach = useFoot ? t.foot : t.r;
        if (useFoot && reach <= 0) return;
        if (Math.hypot(t.x - x, t.z - z) <= R + reach) want.push(i);
      });
      bruteMs += performance.now() - t0;
      if (!same(got, want)) { bad++; if (bad < 4) console.log(`near mismatch n=${n} R=${R.toFixed(1)} foot=${useFoot}: got ${got.length} want ${want.length}`); }
      // nearest
      const maxR = rnd() < 0.3 ? Infinity : rnd() * 60;
      const e = reg.nearest(x, z, maxR, f);
      let bi = -1, bd = Infinity;
      things.forEach((t, i) => { if (!passes(t, f)) return; const d = Math.hypot(t.x - x, t.z - z); if (d <= maxR && d < bd) { bd = d; bi = i; } });
      if ((e < 0 ? -1 : reg.index[e]) !== bi && !(e >= 0 && Math.abs(Math.hypot(T(e).x - x, T(e).z - z) - bd) < 1e-9)) { bad++; if (bad < 4) console.log(`nearest mismatch: got ${e < 0 ? -1 : reg.index[e]} want ${bi}`); }
      // ray: a flat line, swept by a width, in order, with chords
      const a = rnd() * Math.PI * 2, len = rnd() * (rnd() < 0.2 ? 400 : 80), w = rnd() < 0.3 ? 0 : rnd() * 3;
      const dx = Math.sin(a), dz = Math.cos(a);
      reg.ray(x, z, dx * 3, dz * 3, len, w, f, hits);
      const rw: { i: number; a: number; b: number }[] = [];
      things.forEach((t, i) => {
        if (!passes(t, f)) return;
        const px = t.x - x, pz = t.z - z, tt = px * dx + pz * dz, d = px * dz - pz * dx, RR = t.r + w;
        if (d * d > RR * RR) return;
        const ch = Math.sqrt(RR * RR - d * d), lo = Math.max(0, tt - ch), hi = Math.min(len, tt + ch);
        if (lo <= hi) rw.push({ i, a: lo, b: hi });
      });
      rw.sort((p, q2) => p.a - q2.a || p.i - q2.i);
      let rayOk = hits.n === rw.length;
      for (let h = 0; rayOk && h < hits.n; h++) {
        if (h > 0 && hits.t0[h] < hits.t0[h - 1]) rayOk = false;
        if (Math.abs(hits.t0[h] - rw[h].a) > 1e-3 || Math.abs(hits.chord(h) - (rw[h].b - rw[h].a)) > 1e-3) rayOk = false;
        if (reg.index[hits.e[h]] !== rw[h].i && Math.abs(hits.t0[h] - rw[h].a) > 1e-9) rayOk = false;
      }
      if (!rayOk) { bad++; if (bad < 4) console.log(`ray mismatch n=${n} len=${len.toFixed(0)}: got ${hits.n} want ${rw.length}`); }
      // cone
      const range = rnd() * 80, width = rnd() * 3, half = rnd() * 0.5;
      reg.cone(x, z, dx, dz, range, width, half, f, out);
      const gc = out.map((e2) => reg.index[e2]).sort((p, q2) => p - q2), wc: number[] = [];
      things.forEach((t, i) => {
        if (!passes(t, f)) return;
        const px = t.x - x, pz = t.z - z, tt = px * dx + pz * dz;
        if (tt <= 0 || tt > range) return;
        if (Math.abs(px * dz - pz * dx) <= t.r + width + tt * Math.tan(half)) wc.push(i);
      });
      if (!same(gc, wc)) { bad++; if (bad < 4) console.log(`cone mismatch: got ${gc.length} want ${wc.length}`); }
      queries += 4;
    }
  }
  console.log(`register: ${scenes} random scenes, ${queries} queries (near, nearest, ray, cone) against brute force: ${bad} disagree · near ${(gridMs * 1000 / (scenes * 60)).toFixed(1)} µs vs brute ${(bruteMs * 1000 / (scenes * 60)).toFixed(1)} µs`);
  ok(bad === 0, "register queries agree with brute force");
}

// ---- The soft lock over the register picks what the old scan over a list picked ----
/** The soft lock as it was (a scan over a candidate list): the reference. */
function bruteLock(cands: readonly TargetCandidate[], qq: LockQuery, vv: TargetValues, last: unknown): TargetCandidate | null {
  const sticky = 1 - vv.lockSticky * 0.6;
  let best: TargetCandidate | null = null, bestS = Infinity;
  for (const cc of cands) {
    const ox = cc.x - qq.rayO.x, oy = cc.y - qq.rayO.y, oz = cc.z - qq.rayO.z;
    const t = ox * qq.rayD.x + oy * qq.rayD.y + oz * qq.rayD.z;
    if (t <= 0) continue;
    const dx = ox - qq.rayD.x * t, dy = oy - qq.rayD.y * t, dz = oz - qq.rayD.z * t;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let s = d <= cc.r + vv.lockCursor ? d / (cc.r + vv.lockCursor + 1e-3) : Infinity;
    if (cc.foot) { const reach = cc.foot + vv.lockCursor, fd = Math.hypot(qq.cursor.x - cc.x, qq.cursor.z - cc.z); if (fd <= reach) s = Math.min(s, 0.5 + 0.5 * (fd / reach)); }
    if (s === Infinity) continue;
    if (Math.hypot(cc.x - qq.from.x, cc.z - qq.from.z) > qq.range) continue;
    s *= cc.key === last ? sticky : 1;
    if (s < bestS) { bestS = s; best = cc; }
  }
  if (best) return best;
  let ux = qq.cursor.x - qq.from.x, uz = qq.cursor.z - qq.from.z;
  const ul = Math.hypot(ux, uz);
  if (ul < 1e-3) return null;
  ux /= ul; uz /= ul;
  const tanCone = Math.tan((vv.lockCone * Math.PI) / 180);
  for (const cc of cands) {
    const ox = cc.x - qq.from.x, oz = cc.z - qq.from.z, t = ox * ux + oz * uz;
    if (t <= 0 || t > qq.range) continue;
    const d = Math.abs(ox * uz - oz * ux), allow = cc.r + vv.lockWidth + t * tanCone;
    if (d > allow) continue;
    const s = (d / allow + t / qq.range * 0.15) * (cc.key === last ? sticky : 1);
    if (s < bestS) { bestS = s; best = cc; }
  }
  return best;
}
{
  let picks = 0, bad = 0, locked = 0;
  for (let s = 0; s < 30; s++) {
    const n = 20 + Math.floor(rnd() * 600), spread = 40 + rnd() * 120;
    const fx = (rnd() - 0.5) * 20, fz = (rnd() - 0.5) * 20;
    const things = randomScene(n, spread).map((t, i): TargetCandidate => ({ x: t.x + fx, y: t.y, z: t.z + fz, r: t.r, key: `u${s}-${i}`, foot: t.foot || undefined }));
    const t = new Targeting();
    let last: unknown = null;
    const vv = { ...TARGET_DEFAULTS, lockSticky: rnd() * 0.8, lockCursor: rnd() * 3, lockCone: rnd() * 15 };
    const yaw = rnd() * Math.PI * 2;
    for (let k = 0; k < 25; k++) {
      // Everyone shuffles a little between picks (the sticky lock follows its target by id).
      for (const th of things) { th.x += (rnd() - 0.5) * 0.8; th.z += (rnd() - 0.5) * 0.8; }
      const mech = { x: fx, y: 0, z: fz };
      const camP = { x: mech.x - Math.sin(yaw) * 26, y: 30, z: mech.z - Math.cos(yaw) * 26 };
      const cur = { x: mech.x + (rnd() - 0.5) * 80, y: 0, z: mech.z + (rnd() - 0.5) * 80 };
      const dx = cur.x - camP.x, dy = -camP.y, dz = cur.z - camP.z, l = Math.hypot(dx, dy, dz);
      const qq: LockQuery = { rayO: camP, rayD: { x: dx / l, y: dy / l, z: dz / l }, from: mech, cursor: cur, range: 60 };
      const want = bruteLock(things, qq, vv, last);
      last = want?.key ?? null;
      const got = pick(t, things, qq, vv);
      picks++;
      if (want) locked++;
      if ((got?.target.key ?? null) !== (want?.key ?? null)) { bad++; if (bad < 4) console.log(`lock mismatch: got ${got?.target.key} want ${want?.key}`); }
    }
  }
  console.log(`soft lock over the register: ${picks} picks on random scenes (${locked} locked), ${bad} differ from the old list scan`);
  ok(bad === 0, "soft lock over the register picks what the list scan picked");
}

// ---- Ids: stable while units move; a reused slot is a new id ----
{
  const field = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
  const robots = new RobotSwarm({ ...ROBOT_DEFAULTS }, field, 3);
  const bandits = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, field, 5);
  const reg = new Register();
  const rOwner = reg.add({ name: "robots", publish: (r) => robots.publish(r, 3) });
  reg.add({ name: "bandits", publish: (r) => bandits.publish(r, 2) });
  robots.spawn(120, 40, 0, 12);
  bandits.spawn(120, -40, 0, 12);
  reg.rebuild();
  const idsAt = () => { const m = new Map<string, number>(); for (let e = 0; e < reg.count; e++) m.set(`${reg.owner[e]}:${reg.index[e]}`, reg.id[e]); return m; };
  const before = idsAt(), x0 = new Map<number, number>();
  for (let e = 0; e < reg.count; e++) x0.set(reg.id[e], reg.x[e]);
  ok(new Set(before.values()).size === reg.count, "every id distinct across owners");
  const tgt = { x: 0, y: 0, z: 0, radius: 2 };
  for (let s = 0; s < 240; s++) { robots.update(1 / 120, { ...tgt, vx: 0, vz: 0 }, () => {}); bandits.update(1 / 120, tgt, () => {}); }
  reg.rebuild();
  let kept = 0, changed = 0, moved = 0;
  for (let e = 0; e < reg.count; e++) {
    const was = before.get(`${reg.owner[e]}:${reg.index[e]}`);
    if (was === reg.id[e]) kept++; else changed++;
    if (Math.abs((x0.get(reg.id[e]) ?? reg.x[e]) - reg.x[e]) > 0.5) moved++;
  }
  ok(changed === 0 && kept > 200, `ids stay put while units move (${kept} kept, ${changed} changed)`);
  ok(moved > 100, `they did move (${moved} moved over half a metre)`);
  // A robot dies and its slot is taken by a new one: a new id, and the old id finds nothing.
  const i = 7, oldId = Register.idOf(rOwner, robots.uid[i]);
  ok(reg.find(oldId) >= 0, "a live robot is found by id");
  robots.damage(i, 1e6, 1, 0);
  robots.remove(i);
  const made = robots.spawn(1, 60, 60, 1);
  reg.rebuild();
  ok(made[0] === i, "the freed slot is reused");
  const newE = reg.find(Register.idOf(rOwner, robots.uid[i]));
  ok(newE >= 0 && reg.index[newE] === i && reg.id[newE] !== oldId, "the reused slot has a new id");
  ok(reg.find(oldId) < 0, "the dead robot's id finds nothing");
  // A downed robot leaves the register at once (nothing to lock or track).
  robots.damage(3, 1e6, 1, 0);
  reg.rebuild();
  ok(robots.state[3] >= R_DOWN && reg.find(Register.idOf(rOwner, robots.uid[3])) < 0, "a dead robot leaves the register");
  // Objects (raiders, dummies): a new id per life.
  const box = [{ alive: true }];
  const oreg = new Register();
  oreg.add(listOwner("box", () => box, (r, _b, k, s) => r.put(k, s, KIND.Prop, 2, FLAG.Hittable, 0, 1, 0, 1)));
  oreg.rebuild(); const id1 = oreg.id[0];
  oreg.rebuild(); const id2 = oreg.id[0];
  box[0].alive = false; oreg.rebuild();
  box[0].alive = true; oreg.rebuild(); const id3 = oreg.id[0];
  ok(id1 === id2 && id3 !== id1, "an object keeps its id while it lives and gets a new one when it comes back");
  // Cost at the stress counts: 1,000 robots + 1,000 bandits.
  robots.spawn(900, 100, 100, 60); bandits.spawn(900, -100, -100, 60);
  const N = 200;
  let t0 = performance.now();
  for (let k = 0; k < N; k++) reg.rebuild();
  const rebuildUs = ((performance.now() - t0) * 1000) / N;
  const hits = new RayHits(), out: number[] = [];
  t0 = performance.now();
  for (let k = 0; k < N; k++) reg.near(100 + (k % 20), 100, 3, ENEMY, out);
  const nearUs = ((performance.now() - t0) * 1000) / N;
  t0 = performance.now();
  for (let k = 0; k < N; k++) reg.ray(0, 0, 1, 1, 200, 0.5, ENEMY, hits);
  const rayUs = ((performance.now() - t0) * 1000) / N;
  console.log(`register cost, ${reg.count} entries: rebuild ${rebuildUs.toFixed(0)} µs · near r=3 ${nearUs.toFixed(1)} µs · ray 200 m through the swarm ${rayUs.toFixed(1)} µs (${hits.n} crossed)`);
}

console.log(fails ? `targeting-check: ${fails} failed` : "targeting-check: ok");
if (fails) throw new Error("targeting check failed");
