// Escorts in the sim worker (docs/proposal-simworker.md step 3): a convoy-lab convoy with its escorts driven two ways
// for ninety seconds, the mech weaving through them (and aboard now and then), a guardian mech beside the train, blasts
// near the escorts, slider changes and a restart. One group runs here as the convoy lab's ?noworker does; the other is
// the lab's worker path: its calls recorded as commands in the ground's stream, through a structured clone (as
// postMessage does) into a GroundMirror that runs its own convoy and escorts, whose snapshot is written back into the
// view's list. The worker's convoy poses must equal this one's, and every escort's pose and wheels in the view must
// equal the reference's, bit for bit, every frame. Also: a stream missing one step is caught (the check can fail).
// Run: npm test (or npx tsx tools/escortworker-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS } from "../src/convoy/platform";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { EscortGroup, ESCORT_DEFAULTS } from "../src/convoy/escort";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";
import { GroundRecorder, type GroundEvent } from "../src/sim/groundEvents";
import { GroundMirror } from "../src/sim/groundMirror";
import { applyEscorts, convoyPoses, escortsRemote } from "../src/sim/escortsRemote";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };

interface Run { frames: number; checked: number; differ: number; first: string; convoyDiffer: number; refMs: number; workerMs: number; bytes: number }

function run(opts: { frames: number; dropStep?: number }): Run {
  let seed = 777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const V = {
    ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS,
    ...TRAIN_DEFAULTS, ...CRATER_DEFAULTS, ...ESCORT_DEFAULTS,
  };
  // The convoy lab's order: field, road, craters, recorder, convoy (recorded before its first reset), escorts.
  const field = new DuneField(V);
  const route = new ConvoyRoute(V, 0, 0);
  field.modifier = route;
  const craters = new CraterLayer(V, field);
  field.dents = craters;
  const rec = new GroundRecorder({ V, field, route, craters, routeAt: [0, 0] });
  const convoy = new Convoy(route, V, field);
  rec.convoy(convoy);
  const ref = new EscortGroup(V, convoy, field), view = new EscortGroup(V, convoy, field);
  view.remote = escortsRemote(rec);
  const changed = (x0: number, z0: number, x1: number, z1: number) => { ref.invalidate(x0, z0, x1, z1); view.invalidate(x0, z0, x1, z1); };
  route.onChange = (x0, z0, x1, z1) => { craters.invalidate(x0, z0, x1, z1); changed(x0, z0, x1, z1); };
  convoy.reset(0, 0);
  ref.reset(); view.reset();
  const mirror = new GroundMirror(structuredClone(rec.init));
  // A guardian walking beside the lead (the lab's guardians.spots), shared by both groups as the lab shares it.
  const guard = [{ x: 0, z: 0 }];
  ref.mechs = guard; view.mechs = guard;

  const r: Run = { frames: 0, checked: 0, differ: 0, first: "", convoyDiffer: 0, refMs: 0, workerMs: 0, bytes: 0 };
  const dt = 1 / 60, p = { x: 0, z: 0, heading: 0 }, mech = { x: 0, z: 0 };
  let steps = 0;
  for (let f = 0; f < opts.frames; f++) {
    if (f === 1500) V.escortCount = 9;
    if (f === 2400) { V.escortCount = 14; V.escortMechClear = 14; }
    if (f === 3600) { convoy.jump(route.s + 120); ref.reset(); view.reset(); }
    if (f === 4800) V.convoySpeed = 4;
    // The mech weaves through the escorts' lanes on one side, then the other; aboard (null) for a stretch.
    const t = f * dt, side = Math.floor(t / 25) % 2 ? 1 : -1;
    route.offsetAt(route.s - 30 + 40 * Math.sin(t * 0.21), side * (24 + 12 * Math.sin(t * 0.9)), p);
    mech.x = p.x; mech.z = p.z;
    const aboard = (f % 2000) > 1700;
    route.offsetAt(route.s + 5, -16, p);
    guard[0].x = p.x; guard[0].z = p.z;
    // One frame: the convoy and the escorts at 120 Hz.
    for (let i = 0; i < 2; i++) {
      convoy.update(dt / 2);
      const t0 = performance.now();
      ref.update(dt / 2, aboard ? null : mech);
      r.refMs += performance.now() - t0;
      if (opts.dropStep === ++steps) {
        const keep: typeof view.remote = view.remote; view.remote = { ...keep!, update: () => {} }; view.update(dt / 2, mech); view.remote = keep;
      } else view.update(dt / 2, aboard ? null : mech);
    }
    // Blasts round the escorts now and then (their planning copy forgets the ground there).
    if (f % 40 === 0 && ref.list.length) {
      const e = ref.list[Math.floor(rnd() * ref.list.length)];
      craters.blast(e.sim.pos.x + (rnd() - 0.5) * 30, e.sim.pos.z + (rnd() - 0.5) * 30, 3 + 4 * rnd());
    }
    craters.update(dt, changed);

    const ev: GroundEvent[] = structuredClone(rec.take());
    r.bytes += JSON.stringify(ev).length;
    const t1 = performance.now();
    mirror.apply(ev);
    const snap = mirror.escorts?.snapshot();
    r.workerMs += performance.now() - t1;
    if (snap) applyEscorts(view, structuredClone(snap));

    const a = convoyPoses(convoy), b = convoyPoses(mirror.convoy!);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) r.convoyDiffer++;
    if (ref.list.length !== view.list.length) { r.differ++; r.first ||= `frame ${f}: ${ref.list.length} escorts here, ${view.list.length} from the worker`; continue; }
    for (let i = 0; i < ref.list.length; i++) {
      const x = ref.list[i].sim, y = view.list[i].sim;
      const same = x.pos.equals(y.pos) && x.heading === y.heading && x.quat.equals(y.quat) && x.speed === y.speed && x.wheels.length === y.wheels.length
        && x.wheels.every((w, k) => w.pos.equals(y.wheels[k].pos) && w.spin === y.wheels[k].spin && w.steer === y.wheels[k].steer && w.compress === y.wheels[k].compress && w.grounded === y.wheels[k].grounded);
      r.checked++;
      if (!same) { r.differ++; r.first ||= `frame ${f} escort ${i}: (${x.pos.x.toFixed(3)}, ${x.pos.z.toFixed(3)}) here, (${y.pos.x.toFixed(3)}, ${y.pos.z.toFixed(3)}) from the worker`; }
    }
    r.frames++;
  }
  return r;
}

const a = run({ frames: 5400 });
console.log(`  escorts: ${a.frames} frames (90 s), ${a.checked} escort poses checked, ${a.differ} differ${a.first ? ` (first ${a.first})` : ""}; convoy poses ${a.convoyDiffer ? `differ ${a.convoyDiffer} times` : "equal"}; escorts here ${(a.refMs / a.frames).toFixed(3)} ms a frame, the worker's side ${(a.workerMs / a.frames).toFixed(3)} ms; stream ${(a.bytes / a.frames).toFixed(0)} bytes a frame`);
if (a.differ) fail(`the worker's escorts differ from the main thread's at ${a.differ} of ${a.checked} poses (first ${a.first})`);
if (a.convoyDiffer) fail(`the worker's convoy differs from the main thread's ${a.convoyDiffer} times`);
if (a.bytes / a.frames > 3000) fail(`the stream is too big (${(a.bytes / a.frames).toFixed(0)} bytes a frame)`);

const b = run({ frames: 600, dropStep: 400 });
console.log(`  a missed step: ${b.differ} of ${b.checked} poses differ (must be some)`);
if (!b.differ) fail("a worker that missed an escort step wasn't caught");

if (problems.length) { console.log(`escortworker-check: ${problems.length} problem(s)`); process.exit(1); }
console.log("escortworker-check: ok");
