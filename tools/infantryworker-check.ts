// The infantry swarm in the sim worker (stage 7b, docs/proposal-stage7.md; src/sim/infantryRemote.ts): a bandit camp
// fight round a moving convoy run two ways. The reference is a plain InfantrySwarm driven as the convoy lab drives it
// without the worker: each frame outside calls (spawns, freezes and sleeps, posts and targets, hits, shoves, stomps,
// tramples, dodges, chill, removals), the step, and more calls after it. The other is the worker path: an InfantryView
// whose calls and steps are recorded in the ground's stream, through a structured clone (as postMessage does) into a
// GroundMirror holding the worker's swarm, its answers written back into the view, some held back a few frames (a slow
// worker) so the view replays its own calls on a late snapshot. Checked bit for bit, every frame: the worker's swarm
// equals the reference, every outside call's result on the view (a hit's "killed", a spawn's slots) equals the
// reference's, the shots handed out are the reference's, a frame late, and each death is raised once. Also: a stream
// missing one call is caught. Run: npm test (or npx tsx tools/infantryworker-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS } from "../src/convoy/platform";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";
import { SafeZone, SAFE_DEFAULTS } from "../src/convoy/safeZone";
import { InfantrySwarm, INFANTRY_DEFAULTS, DOWN, type InfantryTarget } from "../src/combat/infantry";
import { TRAMPLE_DEFAULTS, type GroundThreat } from "../src/combat/trample";
import { GroundRecorder, type GroundEvent } from "../src/sim/groundEvents";
import { GroundMirror } from "../src/sim/groundMirror";
import { InfantryView, packInfantry, type InfantryFrame, type InfantrySnapshot } from "../src/sim/infantryRemote";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };

function same(a: InfantrySnapshot, b: InfantrySnapshot): string {
  if (a.hi !== b.hi) return `hi ${a.hi} vs ${b.hi}`;
  for (const k in a.block.comps) {
    const x = new Uint8Array(a.block.comps[k]), y = b.block.comps[k] ? new Uint8Array(b.block.comps[k]) : null;
    if (!y || x.length !== y.length) return `block ${k}: length`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `block ${k} byte ${i}`;
  }
  for (const k in a.arrays) {
    const x = a.arrays[k] as unknown as ArrayLike<number>, y = b.arrays[k] as unknown as ArrayLike<number>;
    if (!y || x.length !== y.length) return `${k}: length`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !(Number.isNaN(x[i]) && Number.isNaN(y[i]))) return `${k}[${i}] ${x[i]} vs ${y[i]}`;
  }
  for (const k in a.scalars) if (a.scalars[k] !== b.scalars[k] && !(Number.isNaN(a.scalars[k]) && Number.isNaN(b.scalars[k]))) return `${k} ${a.scalars[k]} vs ${b.scalars[k]}`;
  return "";
}

interface Run { frames: number; differ: number; first: string; results: number; resultDiffer: number; shots: number; shotDiffer: number; deaths: number; doubleDeaths: number; replayed: number; ops: number; dives: number; ms: number; bytes: number; snap: number }

function run(opts: { frames: number; lagEvery?: number; dropOp?: number }): Run {
  let seed = 777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const V = {
    ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS,
    ...TRAIN_DEFAULTS, ...CRATER_DEFAULTS, ...SAFE_DEFAULTS, ...INFANTRY_DEFAULTS, ...TRAMPLE_DEFAULTS,
  };
  const field = new DuneField(V);
  const route = new ConvoyRoute(V, 0, 0);
  field.modifier = route;
  const craters = new CraterLayer(V, field);
  field.dents = craters;
  const rec = new GroundRecorder({ V, field, route, craters, routeAt: [0, 0] });
  const convoy = new Convoy(route, V, field);
  rec.convoy(convoy);
  route.onChange = (x0, z0, x1, z1) => craters.invalidate(x0, z0, x1, z1);
  convoy.reset(0, 0);
  const mirror = new GroundMirror(structuredClone(rec.init));

  const SEED = 23;
  const ref = new InfantrySwarm(V, field, SEED), view = new InfantrySwarm(V, field, SEED);
  const zone = new SafeZone(V);
  ref.keepOut = zone;
  const iv = new InfantryView(view, 0, rec, SEED);

  const r: Run = { frames: 0, differ: 0, first: "", results: 0, resultDiffer: 0, shots: 0, shotDiffer: 0, deaths: 0, doubleDeaths: 0, replayed: 0, ops: 0, dives: 0, ms: 0, bytes: 0, snap: 0 };
  const dead = new Set<number>();
  view.onDeath = (i) => { r.deaths++; if (dead.has(view.uid[i])) r.doubleDeaths++; dead.add(view.uid[i]); };
  // Shots the reference fired per frame, and the view's, compared in order at the end.
  const refShots: string[] = [], viewShots: string[] = [];
  const shot = (out: string[]) => (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, i: number) => out.push(`${i},${fx},${fy},${fz},${tx},${ty},${tz}`);

  let id = 0, ops = 0;
  const held: { id: number; f: InfantryFrame }[] = [];
  const dt = 1 / 60, p = { x: 0, z: 0, heading: 0 };
  const both = <T>(f: (sw: InfantrySwarm) => T) => {
    const a = f(ref);
    if (opts.dropOp === ++ops) { const keep = rec.command; rec.command = (() => {}) as typeof rec.command; f(view); rec.command = keep; return a; }
    const b = f(view);
    r.results++;
    if (JSON.stringify(a) !== JSON.stringify(b)) { r.resultDiffer++; r.first ||= `frame ${r.frames}: a call gave ${JSON.stringify(a)} here, ${JSON.stringify(b)} on the view`; }
    return a;
  };
  const camp = { x: 0, z: 0, heading: 0 };
  let tid = 1;
  for (let f = 0; f < opts.frames; f++) {
    // A slider moved between frames (the panel's way: it goes out before the frame's first call).
    if (f === 1300) V.runSpeed *= 1.15;
    convoy.update(dt);
    zone.update(convoy.platforms);
    const t = f * dt;
    route.offsetAt(route.s + 15 * Math.sin(t * 0.11), 80 + 10 * Math.sin(t * 0.27), p);
    const base: InfantryTarget = { x: p.x, y: field.height(p.x, p.z) + 2.5, z: p.z, radius: 2.5 };
    // A camp comes in asleep, a few hurt; it wakes at 3 s; another group (a bus's drop) later.
    if (f === 3) {
      route.offsetAt(route.s + 25, 100, camp);
      const slots = both((sw) => sw.spawn(120, camp.x, camp.z, 14));
      for (const i of slots) { both((sw) => sw.setFrozen(i, 1)); if (i % 3 === 0) both((sw) => sw.scaleHp(i, 0.6)); }
    }
    if (f === 1100) { const slots = both((sw) => sw.spawn(60, p.x - 25, p.z + 15, 5)); for (const i of slots) both((sw) => sw.setHeading(i, 1.2)); }
    const asleep = f < 180 || (f >= 1500 && f < 1700);
    for (let i = 0; i < ref.hi; i++) {
      if (asleep) { both((sw) => sw.sleep(i)); continue; }
      both((sw) => sw.setFrozen(i, 0));
      if (ref.state[i] >= DOWN) continue;
      // Some stand at posts (the same calm target every frame), some fight another faction's moving point, the rest the mech.
      if (i % 4 === 0) both((sw) => sw.setTarget(i, camp.x + (i % 7), 0, camp.z - (i % 5), 0, true));
      else if (i % 4 === 1 && f > 600) both((sw) => sw.setTarget(i, p.x + 10 * Math.sin(t), 1, p.z + 30, 2));
      else both((sw) => sw.clearTarget(i));
    }
    if (f % 23 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi), a = rnd() * 16; both((sw) => sw.damage(i, a, 1, 0)); }
    if (f % 17 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi), k = rnd(); both((sw) => sw.setPace(i, k)); }
    if (f % 53 === 0) { const x = p.x + (rnd() - 0.5) * 6, z = p.z + (rnd() - 0.5) * 6; both((sw) => sw.stomp(x, z, 2.6)); }
    if (f % 29 === 0) { const b = { x: p.x, z: p.z, vx: 9 * Math.cos(t), vz: 9 * Math.sin(t), reach: 3, crush: 1 }; both((sw) => sw.trample(b, V, (i, d, dx, dz, s) => sw.damage(i, d, dx, dz, s))); }
    if (f % 71 === 0) { const x = p.x, z = p.z; both((sw) => sw.shove(x, z, 4, 1, 0, 6, 30)); }
    if (f % 40 === 0) {
      const th: GroundThreat[] = [{ id: tid++, kind: "ring", x: p.x + (rnd() - 0.5) * 20, z: p.z + 20 + (rnd() - 0.5) * 20, r: 6, t: 0.5 } as GroundThreat];
      both((sw) => sw.dodge(th));
    }
    if (f === 2000) for (let i = 0; i < 15; i++) both((sw) => sw.remove(i));
    if (f % 60 === 0) craters.blast(p.x + (rnd() - 0.5) * 40, p.z + (rnd() - 0.5) * 40, 3);
    craters.update(dt, () => {});
    // The step, then a hit after it (in the stream's order on both).
    view.update(dt, base, shot(viewShots));
    ref.update(dt, base, shot(refShots));
    if (f % 11 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi); both((sw) => sw.damage(i, 5, 0, 1)); }
    // The frame to the worker.
    const ev: GroundEvent[] = structuredClone(rec.take());
    r.bytes += JSON.stringify(ev).length;
    id++;
    const t1 = performance.now();
    mirror.apply(ev);
    const ans = mirror.infantry!.frame()[0];
    r.ms += performance.now() - t1;
    iv.frameId = id + 1;
    const d = same(packInfantry(ref), ans.snap);
    if (d) { r.differ++; r.first ||= `frame ${f}: the worker's swarm differs (${d})`; }
    r.snap += Object.values(ans.snap.block.comps).reduce((n, b) => n + b.byteLength, 0) + Object.values(ans.snap.arrays).reduce((n, b) => n + b.byteLength, 0);
    held.push({ id, f: structuredClone(ans) });
    const late = opts.lagEvery && f % opts.lagEvery < 3;
    if (!late) { for (const h of held) iv.take(h.id, h.f.shots, h.f.snap, 0); held.length = 0; }
    r.frames++;
    if (process.env.DBG && f % 300 === 0) console.log(f, ref.count, ref.hi, ref.shots, [...ref.hp.slice(0, 5)], [...ref.state.slice(0, 8)], p, camp);
  }
  r.replayed = iv.stats.replayed;
  r.ops = iv.stats.ops;
  r.dives = ref.dives;
  r.shots = viewShots.length;
  for (let k = 0; k < viewShots.length; k++) if (viewShots[k] !== refShots[k]) { r.shotDiffer++; r.first ||= `shot ${k}: ${viewShots[k]} on the view, ${refShots[k]} here`; break; }
  if (refShots.length - viewShots.length > 200) { r.shotDiffer++; r.first ||= `the view handed out ${viewShots.length} shots, the reference fired ${refShots.length}`; }
  return r;
}

const a = run({ frames: 2400, lagEvery: 37 });
console.log(`  bandits: ${a.frames} frames (40 s), the worker's swarm differs at ${a.differ}${a.first ? ` (first ${a.first})` : ""}; ${a.results} calls on the view, ${a.resultDiffer} gave another result, ${a.ops} sent; ${a.shots} shots handed out, ${a.shotDiffer ? "NOT" : "all"} the reference's; ${a.deaths} deaths raised, ${a.doubleDeaths} twice; ${a.dives} dives; ${a.replayed} calls replayed on late snapshots; worker side ${(a.ms / a.frames).toFixed(3)} ms a frame; stream ${(a.bytes / a.frames).toFixed(0)} bytes a frame, snapshot ${(a.snap / a.frames / 1024).toFixed(1)} KB`);
if (a.differ) fail(`the worker's swarm differs from the reference at ${a.differ} frames (first ${a.first})`);
if (a.resultDiffer) fail(`${a.resultDiffer} calls on the view gave another result than the reference's`);
if (a.shotDiffer) fail(`the view's shots aren't the reference's (${a.first})`);
if (a.shots < 300) fail(`only ${a.shots} shots handed out (the fight didn't happen)`);
if (a.deaths < 20) fail(`only ${a.deaths} deaths raised (the fight didn't happen)`);
if (a.doubleDeaths) fail(`${a.doubleDeaths} deaths raised twice`);
if (!a.replayed) fail("no late snapshot was replayed onto (the lag test didn't run)");
if (!a.dives) fail("nobody dived (dodge didn't run)");

const b = run({ frames: 400, dropOp: 40 });
console.log(`  a missed call: the worker's swarm differs at ${b.differ} frames (must be some)`);
if (!b.differ) fail("a worker that missed a call wasn't caught");

if (problems.length) { console.log(`infantryworker-check: ${problems.length} problem(s)`); process.exit(1); }
console.log("infantryworker-check: ok");
