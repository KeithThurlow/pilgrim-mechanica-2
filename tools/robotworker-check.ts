// The robot swarm in the sim worker (docs/proposal-simworker.md step 4c): a camp fight round a moving convoy run two
// ways. The reference is a plain RobotSwarm driven the way the worker drives its copy: each frame the outside calls
// (spawns, hits, stomps, tramples, freezes, targets, removals), then the frame's step. The other is the convoy lab's
// worker path: a RobotsView whose calls are recorded in the ground's stream, through a structured clone (as postMessage
// does) into a GroundMirror that holds the worker's swarm, its answers written back into the view, some held back a few
// frames (a slow worker) so the view replays its own calls on a late snapshot. Checked bit for bit, every frame: the
// worker's swarm equals the reference, every outside call's result on the view (a hit's "killed", a spawn's slots)
// equals the reference's, the events handed out equal the reference's, one frame late, and each death goes out once.
// Also: a stream missing one call is caught. Run: npm test (or npx tsx tools/robotworker-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS } from "../src/convoy/platform";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";
import { SafeZone, SAFE_DEFAULTS } from "../src/convoy/safeZone";
import { RobotSwarm, ROBOT_DEFAULTS, DEAD, type RobotEvent, type RobotTarget } from "../src/combat/robots";
import { TRAMPLE_DEFAULTS } from "../src/combat/trample";
import { GroundRecorder, type GroundEvent } from "../src/sim/groundEvents";
import { GroundMirror } from "../src/sim/groundMirror";
import { RobotsView, packRobots, type RobotSnapshot } from "../src/sim/robotsRemote";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };

function same(a: RobotSnapshot, b: RobotSnapshot): string {
  if (a.hi !== b.hi) return `hi ${a.hi} vs ${b.hi}`;
  for (const k in a.arrays) {
    const x = a.arrays[k] as unknown as ArrayLike<number>, y = b.arrays[k] as unknown as ArrayLike<number>;
    if (!y || x.length !== y.length) return `${k}: length`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !(Number.isNaN(x[i]) && Number.isNaN(y[i]))) return `${k}[${i}] ${x[i]} vs ${y[i]}`;
  }
  for (const k in a.scalars) if (a.scalars[k] !== b.scalars[k] && !(Number.isNaN(a.scalars[k]) && Number.isNaN(b.scalars[k]))) return `${k} ${a.scalars[k]} vs ${b.scalars[k]}`;
  if (JSON.stringify(a.cores) !== JSON.stringify(b.cores)) return "cores";
  return "";
}


interface Run { frames: number; differ: number; first: string; results: number; resultDiffer: number; events: number; eventDiffer: number; deaths: number; doubleDeaths: number; replayed: number; shots: number; kills: number; ms: number; bytes: number }

function run(opts: { frames: number; lagEvery?: number; dropOp?: number }): Run {
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const V = {
    ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS,
    ...TRAIN_DEFAULTS, ...CRATER_DEFAULTS, ...SAFE_DEFAULTS, ...ROBOT_DEFAULTS, ...TRAMPLE_DEFAULTS,
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

  const SEED = 11;
  const ref = new RobotSwarm(V, field, SEED), view = new RobotSwarm(V, field, SEED);
  const zone = new SafeZone(V);
  ref.keepOut = zone;
  const rv = new RobotsView(view, rec, () => null, SEED);

  const r: Run = { frames: 0, differ: 0, first: "", results: 0, resultDiffer: 0, events: 0, eventDiffer: 0, deaths: 0, doubleDeaths: 0, replayed: 0, shots: 0, kills: 0, ms: 0, bytes: 0 };
  // Events the reference handed out per frame, and the view's, to compare a frame late.
  const refEvents = new Map<number, string[]>();
  let viewEvents: string[] = [];
  const dead = new Set<number>();
  const hook = (sw: RobotSwarm, out: () => string[], isView: boolean) => {
    sw.onDeath = (i) => {
      if (isView) { r.deaths++; if (dead.has(sw.uid[i])) r.doubleDeaths++; dead.add(sw.uid[i]); }
    };
    sw.onFootfall = (i, x, y, z, leg) => out().push(`f${i},${x},${y},${z},${leg}`);
    sw.onLob = (i, fx, fy, fz, x, z, fl) => out().push(`l${i},${fx},${fy},${fz},${x},${z},${fl}`);
    sw.onBeam = (e) => out().push("b" + JSON.stringify(e));
    sw.onPulse = (e) => out().push("p" + JSON.stringify(e));
    sw.onDeathBlast = (e) => out().push("d" + JSON.stringify(e));
  };
  let refNow: string[] = [];
  hook(ref, () => refNow, false);
  hook(view, () => viewEvents, true);
  const shot = (out: () => string[]) => (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, kind: number, i: number) => out().push(`s${i},${fx},${fy},${fz},${tx},${ty},${tz},${kind}`);
  const bite = (out: () => string[]) => (i: number, d: number) => out().push(`B${i},${d}`);
  const cut = (out: () => string[]) => (i: number, d: number, x: number, y: number, z: number) => out().push(`c${i},${d},${x},${y},${z}`);

  let id = 0;
  const held: { id: number; m: { events: RobotEvent[]; snap: RobotSnapshot; ms: number } }[] = [];
  const dt = 1 / 60, p = { x: 0, z: 0, heading: 0 };
  let ops = 0;
  // An outside call on both, results compared.
  const both = <T>(f: (sw: RobotSwarm) => T) => {
    const a = f(ref);
    if (opts.dropOp === ++ops) { const keep = view.remote; rec.command = (() => {}) as typeof rec.command; const b = f(view); delete (rec as Partial<GroundRecorder>).command; view.remote = keep; void b; return a; }
    const b = f(view);
    r.results++;
    if (JSON.stringify(a) !== JSON.stringify(b)) { r.resultDiffer++; r.first ||= `frame ${r.frames}: a call gave ${JSON.stringify(a)} here, ${JSON.stringify(b)} on the view`; }
    return a;
  };
  for (let f = 0; f < opts.frames; f++) {
    convoy.update(dt);
    zone.update(convoy.platforms);
    // The mech circles out beside the train.
    const t = f * dt;
    route.offsetAt(route.s + 20 * Math.sin(t * 0.13), 40 + 25 * Math.sin(t * 0.31), p);
    const base: RobotTarget = { x: p.x, y: field.height(p.x, p.z) + 2.5, z: p.z, radius: 2 };
    // Outside calls.
    if (f === 5) both((sw) => sw.spawn(80, p.x + 25, p.z + 20, 14, { mid: 0.15, big: 0.05, bigMin: 1 }));
    if (f === 900) both((sw) => sw.spawn(40, p.x - 30, p.z + 10, 10));
    if (f % 7 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi), a = rnd() * 40; both((sw) => sw.damage(i, a, 1, 0)); r.kills += ref.state[i] === DEAD ? 1 : 0; }
    if (f % 23 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi), lg = Math.floor(rnd() * 4); both((sw) => sw.hitAt(i, 1, lg, 60, 60, 0, 1)); }
    if (f % 31 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi), lg = Math.floor(rnd() * 4); both((sw) => sw.hurtLeg(i, lg, 200, 0, 1)); }
    if (f % 13 === 0) { const x = p.x + (rnd() - 0.5) * 3, z = p.z + (rnd() - 0.5) * 3; both((sw) => sw.stomp(x, z, 2.6)); }
    if (f % 5 === 0) { const b = { x: p.x, z: p.z, vx: 8 * Math.cos(t), vz: 8 * Math.sin(t), reach: 3, crush: 1 }; both((sw) => sw.trample(b, V, (i, d, dx, dz) => sw.damage(i, d, dx, dz))); }
    if (f % 97 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi); both((sw) => sw.setTarget(i, p.x + 30, 0, p.z, 4)); }
    if (f % 131 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi); both((sw) => sw.clearTarget(i)); }
    if (f >= 1500 && f < 1800 && f % 10 === 0) for (let i = 0; i < ref.hi; i++) both((sw) => sw.setFrozen(i, 1));
    if (f === 1800) for (let i = 0; i < ref.hi; i++) both((sw) => sw.setFrozen(i, 0));
    if (f % 41 === 0 && ref.hi) { const i = Math.floor(rnd() * ref.hi), k = rnd(); both((sw) => sw.setPace(i, k)); }
    if (f === 2100) for (let i = 0; i < 20; i++) both((sw) => sw.remove(i));
    if (f % 60 === 0) craters.blast(p.x + (rnd() - 0.5) * 40, p.z + (rnd() - 0.5) * 40, 3);
    craters.update(dt, () => {});
    if (f === 1200) V.robotRunSpeed *= 1.2;
    // The view's step (events it hands out are last frame's), the reference's after the frame's calls.
    view.update(dt, base, shot(() => viewEvents), bite(() => viewEvents), cut(() => viewEvents));
    refNow = [];
    ref.update(dt, base, shot(() => refNow), bite(() => refNow), cut(() => refNow));
    refEvents.set(id + 1, refNow);
    // The frame to the worker.
    const ev: GroundEvent[] = structuredClone(rec.take());
    r.bytes += JSON.stringify(ev).length;
    id++;
    const t1 = performance.now();
    mirror.apply(ev);
    const ans = mirror.robots!.frame()!;
    r.ms += performance.now() - t1;
    rv.frameId = id + 1;
    const d = same(packRobots(ref), ans.snap);
    if (d) { r.differ++; r.first ||= `frame ${f}: the worker's swarm differs (${d})`; }
    // Late answers now and then: held a few frames, then all taken in order.
    held.push({ id, m: structuredClone({ ...ans, ms: 0 }) });
    const late = opts.lagEvery && f % opts.lagEvery < 3;
    if (!late) { for (const h of held) rv.take(h.id, h.m.events, h.m.snap, h.m.ms); held.length = 0; }
    // What the view handed out this frame should be what the reference did at the frames it got answers for.
    r.frames++;
  }
  r.replayed = rv.stats.replayed;
  // Every event the view handed out is the reference's, in order, a frame or more late (the last answers not yet out).
  const want: string[] = [];
  for (let k = 1; k <= id; k++) want.push(...(refEvents.get(k) ?? []));
  r.events = viewEvents.length;
  for (let k = 0; k < viewEvents.length; k++) if (viewEvents[k] !== want[k]) { r.eventDiffer++; r.first ||= `event ${k}: ${viewEvents[k].slice(0, 60)} on the view, ${want[k]?.slice(0, 60)} here`; break; }
  if (want.length - viewEvents.length > 400) { r.eventDiffer++; r.first ||= `the view handed out ${viewEvents.length} events, the reference ${want.length}`; }
  return r;
}

const a = run({ frames: 2700, lagEvery: 37 });
console.log(`  robots: ${a.frames} frames (45 s), the worker's swarm differs at ${a.differ}${a.first ? ` (first ${a.first})` : ""}; ${a.results} calls on the view, ${a.resultDiffer} gave another result; ${a.events} events handed out, ${a.eventDiffer ? "NOT" : "all"} the reference's; ${a.deaths} deaths handed out, ${a.doubleDeaths} twice; ${a.replayed} calls replayed on late snapshots; worker side ${(a.ms / a.frames).toFixed(3)} ms a frame; stream ${(a.bytes / a.frames).toFixed(0)} bytes a frame`);
if (a.differ) fail(`the worker's swarm differs from the reference at ${a.differ} frames (first ${a.first})`);
if (a.resultDiffer) fail(`${a.resultDiffer} calls on the view gave another result than the reference's`);
if (a.eventDiffer) fail(`the view's events aren't the reference's (${a.first})`);
if (a.events < 1000) fail(`only ${a.events} events handed out (the fight didn't happen)`);
if (a.doubleDeaths) fail(`${a.doubleDeaths} deaths handed out twice`);
if (!a.replayed) fail("no late snapshot was replayed onto (the lag test didn't run)");

const b = run({ frames: 400, dropOp: 12 });
console.log(`  a missed call: the worker's swarm differs at ${b.differ} frames (must be some)`);
if (!b.differ) fail("a worker that missed a call wasn't caught");

if (problems.length) { console.log(`robotworker-check: ${problems.length} problem(s)`); process.exit(1); }
console.log("robotworker-check: ok");
