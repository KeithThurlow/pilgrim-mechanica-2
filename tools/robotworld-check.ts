// The robot swarm's state in the ECS world (src/combat/robotWorld.ts; docs/architecture-review.md stage 4.3). Two
// swarms share one fixed world (as a battlefield's front and summoned allies do). A camp fight with spawns, kills and
// removals. Checks: the swarm's arrays are the world's columns (a write to one is the other); one entity per live
// robot, none for dead or empty slots; the same robot keeps its entity while it lives, a dead one's id goes stale, a
// reused slot gets a new one; Transform, Health, Team and Collider are the robot's (and the register's sizes);
// PrevTransform is last tick's Transform; the two swarms' blocks don't overlap; a snapshot into a view (the sim worker's
// way) relinks its entities to match. Run: npm test (or npx tsx tools/robotworld-check.ts).
import { World, entityIndex, type Entity } from "../src/ecs/world";
import { Transform, PrevTransform, Health, Team, Collider } from "../src/ecs/components";
import { Robot } from "../src/combat/robotWorld";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { RobotSwarm, ROBOT_DEFAULTS, ROBOT_MAX, DEAD, type RobotTarget } from "../src/combat/robots";
import { TRAMPLE_DEFAULTS } from "../src/combat/trample";
import { Register } from "../src/game/register";
import { gatherBars } from "../src/game/entityBars";
import type { BarEntry } from "../src/ui/healthBars";
import { SMALL, BIG } from "../src/combat/robots";
import { packRobots, applyRobots } from "../src/sim/robotsRemote";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 15) console.log("  FAIL " + s); problems.push(s); };

const V = { ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROBOT_DEFAULTS, ...TRAMPLE_DEFAULTS };
const field = new DuneField(V);
const world = new World({ capacity: ROBOT_MAX * 3 + 1 });
const other = world.create(); // something else in the world first: the blocks must not start at 0 by luck
const sw = new RobotSwarm(V, field, 3, world);
const sw2 = new RobotSwarm(V, field, 9, world);
if (sw.block.world !== world || sw2.block.world !== world) fail("a swarm didn't take the world it was given");
if (sw.block.base < 1 || sw2.block.base < sw.block.base + ROBOT_MAX) fail(`blocks overlap: ${sw.block.base}, ${sw2.block.base}`);
// Views: a write through the swarm is the column, and the other way.
{
  const T = world.columns(Transform), H = world.columns(Health), b = sw.block.base;
  sw.px[5] = 12.5; H.hp[b + 7] = 33;
  if (T.x[b + 5] !== 12.5 || sw.hp[7] !== 33) fail("the swarm's arrays aren't the world's columns");
  sw.px[5] = 0; sw.hp[7] = 0;
  if (sw.state[0] !== 255 || sw.pace[0] !== 1) fail("a fresh block doesn't start empty at full pace");
}
const reg = new Register();
reg.add({ name: "robots", publish: (r) => sw.publish(r, 3) });
reg.add({ name: "robots2", publish: (r) => sw2.publish(r, 5) });
const bars: BarEntry[] = [];
let barsSeen = 0;
let seed = 77;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const byUid = new Map<number, Entity>();
const stale: Entity[] = [];
let most = 0;
let prev = new Map<Entity, [number, number, number, number]>();
const dt = 1 / 60;
for (let f = 0; f < 1800; f++) {
  const time = f * dt;
  const base: RobotTarget = { x: 30 * Math.sin(time * 0.2), y: 0, z: 30 * Math.cos(time * 0.2), radius: 2 };
  base.y = field.height(base.x, base.z) + 2.5;
  if (f === 2) { sw.spawn(120, 25, 20, 14, { mid: 0.15, big: 0.05, bigMin: 1 }); sw2.spawn(30, -30, -20, 8); }
  if (f === 700) sw.spawn(60, -20, 10, 10);
  if (f % 4 === 0 && sw.hi) sw.damage(Math.floor(rnd() * sw.hi), 25, 1, 0);
  if (f === 1200) for (let i = 0; i < 15; i++) sw.remove(i);
  sw.update(dt, base, () => {});
  sw2.update(dt, base, () => {});
  reg.rebuild();
  const T = world.columns(Transform), P = world.columns(PrevTransform), H = world.columns(Health), M = world.columns(Team), C = world.columns(Collider), R = world.columns(Robot);
  let live = 0;
  const now = new Map<Entity, [number, number, number, number]>();
  for (let i = 0; i < sw.hi; i++) {
    const e = sw.block.entity(i);
    if (sw.state[i] >= DEAD) { if (e !== -1) fail(`frame ${f}: dead slot ${i} still has an entity`); continue; }
    live++;
    if (e === -1 || !world.exists(e)) { fail(`frame ${f}: live robot ${i} has no entity`); continue; }
    const u = sw.uid[i], had = byUid.get(u);
    if (had !== undefined && had !== e) fail(`frame ${f}: robot uid ${u} changed entity`);
    byUid.set(u, e);
    const j = entityIndex(e);
    if (j !== sw.block.base + i) fail(`frame ${f}: robot ${i}'s entity index ${j}`);
    if (T.x[j] !== sw.px[i] || T.y[j] !== sw.hubY[i] || T.z[j] !== sw.pz[i] || T.heading[j] !== sw.heading[i]) fail(`frame ${f}: Transform of robot ${i}`);
    if (H.hp[j] !== sw.hp[i] || H.max[j] !== sw.maxHp[i] || R.uid[j] !== u || R.kind[j] !== sw.kind[i]) fail(`frame ${f}: Health or Robot of robot ${i}`);
    if (M.team[j] !== 3) fail(`frame ${f}: Team of robot ${i}`);
    if (C.radius[j] !== Math.fround(sw.bodyRadius(i)) || C.reach[j] !== Math.fround(sw.hitReach(i))) fail(`frame ${f}: Collider of robot ${i}`);
    const p = prev.get(e);
    if (p && (P.x[j] !== p[0] || P.y[j] !== p[1] || P.z[j] !== p[2] || P.heading[j] !== p[3])) fail(`frame ${f}: PrevTransform of robot ${i}`);
    now.set(e, [T.x[j], T.y[j], T.z[j], T.heading[j]]);
  }
  for (const [u, e] of byUid) {
    let alive = false;
    for (let i = 0; i < sw.hi && !alive; i++) alive = sw.state[i] < DEAD && sw.uid[i] === u;
    if (!alive) { if (world.exists(e)) fail(`frame ${f}: dead robot uid ${u}'s entity lives on`); stale.push(e); byUid.delete(u); }
  }
  if (world.alive !== live + sw2.count + 1) fail(`frame ${f}: ${world.alive} entities, ${live} + ${sw2.count} robots + 1`);
  if (world.query(Robot).count !== live + sw2.count) fail(`frame ${f}: the Robot query holds ${world.query(Robot).count}`);
  // Health bars from the world (stage 4.3b): as RobotTarget.bars pushed them, cutters and excavators only, seen from
  // team 5 (so only sw's).
  bars.length = 0;
  gatherBars(world, 5, bars);
  let want = 0;
  for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DEAD && sw.kind[i] !== SMALL) want++;
  if (bars.length !== want) fail(`frame ${f}: ${bars.length} bars, ${want} cutters and excavators`);
  for (const b of bars) {
    const i = entityIndex(b.key as number) - sw.block.base, big = sw.kind[i] === BIG, f32 = Math.fround;
    const y = sw.hubY[i] + f32(sw.size[i] * (big ? 0.9 : 0.75) + 0.6); // lift kept as f32: within 1e-7 m of the old bar
    if (i < 0 || i >= sw.hi || b.key !== sw.block.entity(i) || b.x !== sw.px[i] || b.z !== sw.pz[i] || b.y !== y || b.hp !== sw.hp[i] || b.max !== sw.maxHp[i]
      || b.armour !== f32(sw.armourOf(i)) || b.width !== (big ? 5 : f32(2.4)) || b.always !== big) { fail(`frame ${f}: bar of robot ${i}`); break; }
  }
  barsSeen += bars.length;
  most = Math.max(most, live);
  prev = now;
}
for (const e of stale) if (world.exists(e)) fail(`stale id ${e} exists`);
if (!world.exists(other)) fail("the other entity went");

// A view (the sim worker's main side) takes snapshots: its entities follow, and a slot reused between snapshots gets a
// new entity.
{
  const view = new RobotSwarm(V, field, 3, world);
  applyRobots(view, packRobots(sw));
  let bad = 0;
  for (let i = 0; i < ROBOT_MAX; i++) if ((view.block.entity(i) !== -1) !== (i < view.hi && view.state[i] < DEAD)) bad++;
  const e0 = (() => { for (let i = 0; i < view.hi; i++) if (view.state[i] < DEAD) return i; return -1; })();
  const before = view.block.entity(e0);
  view.uid[e0] += 100000;
  view.block.relinkRobots(view.hi, DEAD);
  if (bad) fail(`a snapshot left ${bad} slots' entities wrong`);
  if (e0 < 0 || view.block.entity(e0) === before || world.exists(before as Entity)) fail("a reused slot kept its old entity");
}
console.log(`  1800 ticks, up to ${most} robots, ${barsSeen} bars checked, ${stale.length} died or removed (ids stale), two swarms and a view in one world`);
if (problems.length) { console.log(`robotworld: ${problems.length} problem(s)`); process.exit(1); }
console.log("robotworld: ok");
