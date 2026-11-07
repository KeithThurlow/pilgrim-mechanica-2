// The infantry swarm's state in the ECS world (src/combat/infantryWorld.ts, src/ecs/swarmBlock.ts; docs/architecture-
// review.md stage 4.4). A bandit fight with spawns, kills, stomps, shoves and removals, beside a robot swarm in the same
// world. Checks: the swarm's arrays are the world's columns; one entity per live bandit (downed ones too), none for dead
// or empty slots; the same bandit keeps its entity while it lives, a dead one's id goes stale; Transform, Health (max =
// spawn health), Team, Collider and Infantry are the bandit's; PrevTransform is last tick's Transform; the blocks don't
// overlap. Run: npm test (or npx tsx tools/infantryworld-check.ts).
import { World, entityIndex, type Entity } from "../src/ecs/world";
import { Transform, PrevTransform, Health, Team, Collider } from "../src/ecs/components";
import { Infantry } from "../src/combat/infantryWorld";
import { Robot } from "../src/combat/robotWorld";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { InfantrySwarm, INFANTRY_DEFAULTS, INFANTRY_MAX, DEAD, type InfantryTarget } from "../src/combat/infantry";
import { RobotSwarm, ROBOT_DEFAULTS, ROBOT_MAX } from "../src/combat/robots";
import { TRAMPLE_DEFAULTS } from "../src/combat/trample";
import { Register } from "../src/game/register";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 15) console.log("  FAIL " + s); problems.push(s); };

const V = { ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...ROBOT_DEFAULTS, ...TRAMPLE_DEFAULTS, ...INFANTRY_DEFAULTS };
const field = new DuneField(V);
const world = new World({ capacity: ROBOT_MAX + INFANTRY_MAX + 1 });
const other = world.create();
const robots = new RobotSwarm(V, field, 3, world);
const sw = new InfantrySwarm(V, field, 7, world);
if (sw.block.world !== world || sw.block.own) fail("the infantry didn't take the world it was given");
if (sw.block.base < robots.block.base + ROBOT_MAX) fail(`blocks overlap: robots ${robots.block.base}, infantry ${sw.block.base}`);
{
  const T = world.columns(Transform), b = sw.block.base;
  sw.px[4] = 9.5; T.z[b + 6] = -3;
  if (T.x[b + 4] !== 9.5 || sw.pz[6] !== -3) fail("the swarm's arrays aren't the world's columns");
  sw.px[4] = 0; sw.pz[6] = 0;
  if (sw.state[0] !== 255 || sw.pace[0] !== 1) fail("a fresh block doesn't start empty at full pace");
}
const reg = new Register();
reg.add({ name: "bandits", publish: (r) => sw.publish(r, 2) });
let seed = 91;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const byUid = new Map<number, Entity>();
let stale = 0, most = 0;
let prev = new Map<Entity, [number, number, number, number]>();
for (let f = 0; f < 1800; f++) {
  const t = f / 60, base: InfantryTarget = { x: 25 * Math.sin(t * 0.3), y: 0, z: 25 * Math.cos(t * 0.3), radius: 2 };
  base.y = field.height(base.x, base.z) + 2.5;
  if (f === 2) { sw.spawn(150, -20, 15, 12); robots.spawn(40, 30, 20, 10); }
  if (f === 600) sw.spawn(80, 15, -25, 9);
  if (f % 4 === 0 && sw.hi) sw.damage(Math.floor(rnd() * sw.hi), 12, 1, 0);
  if (f % 90 === 0) { sw.stomp(base.x, base.z, 3); sw.shove(base.x, base.z, 4, 0, 1, 6, 8); }
  if (f === 1100) for (let i = 0; i < 20; i++) sw.remove(i);
  robots.update(1 / 60, base, () => {});
  sw.update(1 / 60, base, () => {});
  reg.rebuild();
  const T = world.columns(Transform), P = world.columns(PrevTransform), H = world.columns(Health), M = world.columns(Team), C = world.columns(Collider), I = world.columns(Infantry);
  let live = 0;
  const now = new Map<Entity, [number, number, number, number]>();
  for (let i = 0; i < sw.hi; i++) {
    const e = sw.block.entity(i);
    if (sw.state[i] >= DEAD) { if (e !== -1) fail(`frame ${f}: dead slot ${i} still has an entity`); continue; }
    live++;
    if (e === -1) { fail(`frame ${f}: live bandit ${i} has no entity`); continue; }
    const u = sw.uid[i], had = byUid.get(u);
    if (had !== undefined && had !== e) fail(`frame ${f}: bandit uid ${u} changed entity`);
    byUid.set(u, e);
    const j = entityIndex(e);
    if (j !== sw.block.base + i) fail(`frame ${f}: bandit ${i}'s entity index ${j}`);
    if (T.x[j] !== sw.px[i] || T.y[j] !== sw.py[i] || T.z[j] !== sw.pz[i] || T.heading[j] !== sw.heading[i]) fail(`frame ${f}: Transform of bandit ${i}`);
    if (H.hp[j] !== sw.hp[i] || H.max[j] !== Math.fround(V.hp) || I.uid[j] !== u || I.state[j] !== sw.state[i]) fail(`frame ${f}: Health or Infantry of bandit ${i}`);
    if (sw.state[i] < 3 && (M.team[j] !== 2 || C.radius[j] !== Math.fround(Math.max(0.6, V.banditRadius)))) fail(`frame ${f}: Team or Collider of bandit ${i}`);
    const p = prev.get(e);
    if (p && (P.x[j] !== p[0] || P.y[j] !== p[1] || P.z[j] !== p[2] || P.heading[j] !== p[3])) fail(`frame ${f}: PrevTransform of bandit ${i}`);
    now.set(e, [T.x[j], T.y[j], T.z[j], T.heading[j]]);
  }
  for (const [u, e] of byUid) {
    let alive = false;
    for (let i = 0; i < sw.hi && !alive; i++) alive = sw.state[i] < DEAD && sw.uid[i] === u;
    if (!alive) { if (world.exists(e)) fail(`frame ${f}: dead bandit uid ${u}'s entity lives on`); stale++; byUid.delete(u); }
  }
  if (world.query(Infantry).count !== live) fail(`frame ${f}: the Infantry query holds ${world.query(Infantry).count}, ${live} bandits`);
  if (world.query(Robot).count !== robots.count) fail(`frame ${f}: the Robot query holds ${world.query(Robot).count}`);
  if (world.alive !== live + robots.count + 1) fail(`frame ${f}: ${world.alive} entities`);
  most = Math.max(most, live);
  prev = now;
}
if (!world.exists(other)) fail("the other entity went");
// The relink after a snapshot-like overwrite: kill the state behind the swarm's back, relink, entities follow.
{
  const i = (() => { for (let k = 0; k < sw.hi; k++) if (sw.state[k] < DEAD) return k; return -1; })();
  const e = sw.block.entity(i);
  sw.state[i] = DEAD;
  sw.block.relinkBandits(sw.hi, DEAD);
  if (i < 0 || sw.block.entity(i) !== -1 || world.exists(e as Entity)) fail("relink left a dead bandit's entity");
}
console.log(`  1800 ticks, up to ${most} bandits beside ${robots.hi} robot slots, ${stale} died or removed (ids stale)`);
if (problems.length) { console.log(`infantryworld: ${problems.length} problem(s)`); process.exit(1); }
console.log("infantryworld: ok");
