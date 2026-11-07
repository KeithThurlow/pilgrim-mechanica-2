// The robot swarm as ECS entities (src/combat/robotEntities.ts; docs/architecture-review.md stage 4.1). A camp fight
// with spawns, kills and removals, synced every tick. Checks: one entity per live robot and none for dead or empty
// slots; the same robot keeps its entity while it lives, a dead one's id goes stale, a reused slot gets a new entity;
// Transform, Health, Team and Collider equal the swarm's own arrays (and the register's sizes); PrevTransform is last
// tick's Transform. Also the sync's cost. Run: npm test (or npx tsx tools/robotentities-check.ts).
import { World, entityIndex, type Entity } from "../src/ecs/world";
import { Transform, PrevTransform, Health, Team, Collider } from "../src/ecs/components";
import { RobotEntities } from "../src/combat/robotEntities";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { RobotSwarm, ROBOT_DEFAULTS, DEAD, type RobotTarget } from "../src/combat/robots";
import { TRAMPLE_DEFAULTS } from "../src/combat/trample";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 15) console.log("  FAIL " + s); problems.push(s); };

const V = { ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROBOT_DEFAULTS, ...TRAMPLE_DEFAULTS };
const field = new DuneField(V);
const sw = new RobotSwarm(V, field, 3);
const world = new World();
const ents = new RobotEntities(world, sw, 3);
let seed = 77;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const byUid = new Map<number, Entity>();
const stale: Entity[] = [];
let ms = 0, syncs = 0, most = 0;
let prev = new Map<Entity, [number, number, number, number]>();
const dt = 1 / 60;
for (let f = 0; f < 1800; f++) {
  const time = f * dt;
  const base: RobotTarget = { x: 30 * Math.sin(time * 0.2), y: 0, z: 30 * Math.cos(time * 0.2), radius: 2 };
  base.y = field.height(base.x, base.z) + 2.5;
  if (f === 2) sw.spawn(120, 25, 20, 14, { mid: 0.15, big: 0.05, bigMin: 1 });
  if (f === 700) sw.spawn(60, -20, 10, 10);
  if (f % 4 === 0 && sw.hi) sw.damage(Math.floor(rnd() * sw.hi), 25, 1, 0);
  if (f === 1200) for (let i = 0; i < 15; i++) sw.remove(i);
  sw.update(dt, base, () => {});
  const t0 = performance.now();
  ents.sync();
  ms += performance.now() - t0; syncs++;
  // Check every tick.
  const T = world.columns(Transform), P = world.columns(PrevTransform), H = world.columns(Health), M = world.columns(Team), C = world.columns(Collider);
  let live = 0;
  const now = new Map<Entity, [number, number, number, number]>();
  for (let i = 0; i < sw.hi; i++) {
    const e = ents.slots.get(i);
    if (sw.state[i] >= DEAD) { if (e !== -1) fail(`frame ${f}: dead slot ${i} still has an entity`); continue; }
    live++;
    if (e === -1 || !world.exists(e)) { fail(`frame ${f}: live robot ${i} has no entity`); continue; }
    const u = sw.uid[i], had = byUid.get(u);
    if (had !== undefined && had !== e) fail(`frame ${f}: robot uid ${u} changed entity`);
    byUid.set(u, e);
    const j = entityIndex(e);
    if (T.x[j] !== sw.px[i] || T.y[j] !== sw.hubY[i] || T.z[j] !== sw.pz[i] || T.heading[j] !== sw.heading[i]) fail(`frame ${f}: Transform of robot ${i}`);
    if (H.hp[j] !== sw.hp[i] || H.max[j] !== sw.maxHp[i]) fail(`frame ${f}: Health of robot ${i}`);
    if (M.team[j] !== 3) fail(`frame ${f}: Team of robot ${i}`);
    if (C.radius[j] !== Math.fround(sw.bodyRadius(i)) || C.reach[j] !== Math.fround(sw.hitReach(i))) fail(`frame ${f}: Collider of robot ${i}`);
    const p = prev.get(e);
    if (p && (P.x[j] !== p[0] || P.y[j] !== p[1] || P.z[j] !== p[2] || P.heading[j] !== p[3])) fail(`frame ${f}: PrevTransform of robot ${i}`);
    now.set(e, [T.x[j], T.y[j], T.z[j], T.heading[j]]);
  }
  for (const [u, e] of byUid) {
    const alive = [...Array(sw.hi).keys()].some((i) => sw.state[i] < DEAD && sw.uid[i] === u);
    if (!alive) { if (world.exists(e)) fail(`frame ${f}: dead robot uid ${u}'s entity lives on`); stale.push(e); byUid.delete(u); }
  }
  if (world.alive !== live || ents.slots.count !== live) fail(`frame ${f}: ${world.alive} entities, ${ents.slots.count} held, ${live} robots`);
  most = Math.max(most, live);
  prev = now;
}
for (const e of stale) if (world.exists(e)) fail(`stale id ${e} exists`);
console.log(`  1800 ticks, up to ${most} robots, ${stale.length} died or removed (ids stale); sync ${(ms / syncs * 1000).toFixed(1)} µs a tick`);
if (problems.length) { console.log(`robotentities: ${problems.length} problem(s)`); process.exit(1); }
console.log("robotentities: ok");
