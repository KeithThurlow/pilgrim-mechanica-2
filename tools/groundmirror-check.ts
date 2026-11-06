// Ground mirror check (the sim worker's copy of the ground, docs/proposal-simworker.md step 1): a convoy-lab ground
// (dunes, the convoy's road cut by the plough, craters, POI pads, fortress walls with gates going down) driven for a
// while with blasts, slider changes, a replan, a jump and a rebuild; every frame its recorded events go through a
// structured clone (as postMessage does) into a GroundMirror, and the two must give exactly the same height at every
// sampled point (near the convoy, the blasts, the fortress). Also: the same with ?flat's own field values; a mirror that
// misses one crater is caught (the check can fail); the events stay few per frame.
// Run: npm test (or npx tsx tools/groundmirror-check.ts).
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { Convoy, PLATFORM_DEFAULTS } from "../src/convoy/platform";
import { TRAIN_DEFAULTS } from "../src/convoy/train";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";
import { SITES_DEFAULTS } from "../src/expedition/sites";
import { SitesGround, roadBlocks } from "../src/expedition/sitesGround";
import { isSiege, siegeLayout } from "../src/pois/fortressGround";
import { GroundRecorder, type GroundEvent } from "../src/sim/groundEvents";
import { GroundMirror } from "../src/sim/groundMirror";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

interface Run { frames: number; mism: number; worst: number; at: string; samples: number; events: number; maxFrame: number; bytes: number; skips: number }

function run(opts: { flat?: boolean; dropCrater?: number; frames?: number }): Run {
  const V = {
    ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROUTE_DEFAULTS, ...PLATFORM_DEFAULTS,
    ...TRAIN_DEFAULTS, ...CRATER_DEFAULTS, ...SITES_DEFAULTS,
  };
  // The convoy lab's order: field, ?flat, road, craters, then the convoy and the sites.
  const field = new DuneField(V);
  if (opts.flat) { field.v = { ...V, height: 0, swell: 0, bumps: 0 }; field.update(); }
  const route = new ConvoyRoute(V, 0, 0);
  field.modifier = route;
  const craters = new CraterLayer(V, field);
  route.onChange = (x0, z0, x1, z1) => { craters.invalidate(x0, z0, x1, z1); };
  field.dents = craters;
  const rec = new GroundRecorder({ V, field, route, craters, routeAt: [0, 0] });
  const convoy = new Convoy(route, V, field);
  convoy.reset(0, 0);
  const sites = new SitesGround(V, field, roadBlocks(route));
  sites.keepClear(0, 0, 190);
  sites.rebuild();

  const mirror = new GroundMirror(structuredClone(rec.init));
  // The fortress or hub nearest the road ahead (+Z).
  const forts = sites.pois.poisIn(-1500, 0, 1500, 3000).filter(isSiege).sort((a, b) => Math.abs(a.x) + a.z * 0.3 - (Math.abs(b.x) + b.z * 0.3));
  const fort = forts[0];
  if (!fort) fail("no fortress or hub within 3 km to test the walls on");
  const gates = fort ? siegeLayout(fort, V).rings.flatMap((r) => r.gates) : [];

  const r: Run = { frames: 0, mism: 0, worst: 0, at: "", samples: 0, events: 0, maxFrame: 0, bytes: 0, skips: 0 };
  const frames = opts.frames ?? 1200, dt = 1 / 60, xz = new Float64Array(2 * 96);
  let roadSeen = -1, dropped = 0;
  const p = { x: 0, z: 0, heading: 0 };
  for (let f = 0; f < frames; f++) {
    // Slider changes between frames, the way the panel makes them.
    if (f === 200) { V.convoyHeading = 25; }
    if (f === 330) { V.craterMaxStack = 1.8; V.hardRockySand = 0.4; craters.invalidate(); }
    if (f === 460) { V.bermSpread = 3; route.wake.clear(); }
    if (f === 600) { V.height *= 1.1; field.update(); route.wake.clear(); sites.rebuild(); }
    if (f === 700 && fort) { route.pointAt(route.s, p); convoy.jump(route.s + Math.max(0, fort.z - p.z - 150)); }
    if (f === 800) for (const g of gates.slice(0, 2)) sites.walls.down.add(g.id);
    if (f === 1000) { sites.walls.down.clear(); craters.clear(); }
    if (f === 1100) { V.convoySpeed = 4; }
    // One frame: the convoy at 120 Hz, blasts now and then, craters slump.
    for (let i = 0; i < 2; i++) convoy.update(dt / 2);
    if (route.count !== roadSeen) { roadSeen = route.count; sites.roadGrew(); }
    if (f % 9 === 0) {
      route.pointAt(route.s + 40 * rnd(), p);
      const near = fort && f > 700 && rnd() < 0.5;
      const bx = near ? fort.x + (rnd() - 0.5) * 160 : p.x + (rnd() - 0.5) * 120, bz = near ? fort.z + (rnd() - 0.5) * 160 : p.z + (rnd() - 0.5) * 120;
      if (opts.dropCrater !== undefined && f === opts.dropCrater) {
        // A mirror that misses this blast: the main thread digs it with recording off.
        const add = Object.getPrototypeOf(craters).add as CraterLayer["add"];
        add.call(craters, bx, bz, 4, 1.2);
        dropped++;
      } else craters.blast(bx, bz, 3 + 5 * rnd());
    }
    craters.update(dt);

    const ev: GroundEvent[] = rec.take();
    r.events += ev.length;
    r.maxFrame = Math.max(r.maxFrame, ev.length);
    r.skips += ev.filter((e) => e.m === "setSkip").length;
    const sent = structuredClone(ev);
    r.bytes += JSON.stringify(sent).length;
    mirror.apply(sent);

    // Sample: round the head, across the road at the blade, round the last blasts, round the fortress.
    let n = 0;
    const put = (x: number, z: number) => { xz[2 * n] = x; xz[2 * n + 1] = z; n++; };
    route.pointAt(route.s, p);
    for (let k = 0; k < 24; k++) put(p.x + (rnd() - 0.5) * 300, p.z + (rnd() - 0.5) * 300);
    for (let k = 0; k < 24; k++) { route.offsetAt(route.blade - 60 * rnd(), (rnd() - 0.5) * 70, p); put(p.x, p.z); }
    const spots = rec.spots;
    for (let k = 0; k < 24; k++) { const s = spots[Math.floor(rnd() * spots.length)] ?? [0, 0]; put(s[0] + (rnd() - 0.5) * 16, s[1] + (rnd() - 0.5) * 16); }
    for (let k = 0; k < 24; k++) put((fort?.x ?? 0) + (rnd() - 0.5) * 220, (fort?.z ?? 0) + (rnd() - 0.5) * 220);
    const mine = new Float64Array(n);
    for (let i = 0; i < n; i++) mine[i] = field.height(xz[2 * i], xz[2 * i + 1]);
    const theirs = mirror.heights(xz.subarray(0, 2 * n));
    for (let i = 0; i < n; i++) {
      const d = Math.abs(mine[i] - theirs[i]);
      if (mine[i] !== theirs[i]) { r.mism++; if (d > r.worst || !r.at) { r.worst = d; r.at = `frame ${f} (${xz[2 * i].toFixed(1)}, ${xz[2 * i + 1].toFixed(1)})`; } }
    }
    r.samples += n;
    r.frames++;
  }
  if (opts.dropCrater !== undefined && !dropped) fail("the dropped blast never happened");
  return r;
}

const a = run({});
console.log(`  convoy ground: ${a.frames} frames, ${a.samples} samples, ${a.mism} differ${a.mism ? ` (worst ${a.worst.toExponential(2)} m at ${a.at})` : ""}; events ${(a.events / a.frames).toFixed(1)} a frame (most ${a.maxFrame}), ${(a.bytes / a.frames).toFixed(0)} bytes a frame, ${a.skips} wall skips taken`);
if (a.mism) fail(`the mirror's ground differs from the main thread's at ${a.mism} of ${a.samples} points (worst ${a.worst} m at ${a.at})`);
if (a.events / a.frames > 12) fail(`too many ground events a frame (${(a.events / a.frames).toFixed(1)}; expected a handful)`);
if (a.bytes / a.frames > 2000) fail(`ground events too big (${(a.bytes / a.frames).toFixed(0)} bytes a frame)`);

const b = run({ flat: true, frames: 400 });
console.log(`  ?flat ground: ${b.samples} samples, ${b.mism} differ`);
if (b.mism) fail(`with ?flat's field values the mirror differs at ${b.mism} points (worst ${b.worst} m at ${b.at})`);

const c = run({ dropCrater: 180, frames: 300 });
console.log(`  a missed blast: ${c.mism} of ${c.samples} samples differ (must be some)`);
if (!c.mism) fail("a mirror that missed a crater wasn't caught: the sampling can't see a difference");

if (problems.length) { console.log(`groundmirror-check: ${problems.length} problem(s)`); process.exit(1); }
console.log("groundmirror-check: ok");
