// Heavy things as ECS entities (src/ecs/heavy.ts; docs/architecture-review.md stage 5). A stand-in mech walks, takes
// hits, dies, comes back and leaves the targets; the host rules sync it each tick. Checks: one entity while alive and a
// target, none dead or gone (ids go stale, a respawn is a new entity); Transform, PrevTransform, Health, Team, Armour
// and the Sim object are the mech's; its health bar from the world (src/game/entityBars.ts) is the one MechUnit.bars
// used to push (always on, 3.4 m over the pelvis, 3.6 m wide), and the viewer's own team gets none.
// Run: npm test (or npx tsx tools/heavy-check.ts).
import * as THREE from "three";
import { entityIndex, type Entity } from "../src/ecs/world";
import { Transform, PrevTransform, Health, Team } from "../src/ecs/components";
import { Sim } from "../src/ecs/heavy";
import { gatherBars } from "../src/game/entityBars";
import type { BarEntry } from "../src/ui/healthBars";
import { CombatRules } from "../src/game/combatRules";
import { Battlefield } from "../src/game/battlefield";
import { MechUnit, MECH_DEFAULTS, type MechBody, type MechUnitValues } from "../src/game/mechUnit";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { UPPER_DEFAULTS } from "../src/mech/upper";
import { DUST_DEFAULTS } from "../src/fx/dust";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 15) console.log("  FAIL " + s); problems.push(s); };

const field = new DuneField({ ...TERRAIN_DEFAULTS });
const rules = new CombatRules(field, {});
const world = rules.world;
const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...UPPER_DEFAULTS, ...DUST_DEFAULTS, ...MECH_DEFAULTS } as unknown as MechUnitValues;
const noop = () => {};
const bf = {
  field, inWater: () => false, water: null, rules,
  dust: { stomp: noop, kick: noop, slide: () => 0, smoke: noop },
  marks: { print: noop, furrow: noop, skid: noop, dig: noop },
  sfx: { play: noop, playSound: noop }, gunAudio: { update: noop, release: noop }, fire: noop,
  v, sinkSurface: null,
  sinkDepth(x: number, z: number) { return Battlefield.prototype.sinkDepth.call(this as unknown as Battlefield, x, z); },
} as unknown as Battlefield;
const at = (o: THREE.Vector3) => o.set(mech.sim.pelvis.x, mech.sim.pelvis.y + 1.5, mech.sim.pelvis.z);
const body = {
  root: new THREE.Object3D(), armed: true, update: noop, paint: noop,
  shoulderLine: (o = new THREE.Vector3()) => at(o), muzzle: (_s: number, o = new THREE.Vector3()) => at(o),
  barrel: (_s: number, o = new THREE.Vector3()) => o.set(0, 0, 1), eject: (_s: number, o = new THREE.Vector3()) => o,
} as unknown as MechBody;
const mech: MechUnit = new MechUnit(bf, v, body, {} as never, 2, 0, false);
mech.reset(0, 0, 0);
rules.targets.push(mech);

const bars: BarEntry[] = [];
const seen = new Set<Entity>();
let prev: [number, number, number, number] | null = null, ticks = 0, checked = 0;
const hit = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0);
for (let f = 0; f < 900; f++) {
  mech.step(1 / 60, { x: 0.3, z: 1, sprint: false }, { x: 10, y: 1, z: 30 }, true);
  if (f === 200) mech.damage(mech.maxHealth * 0.4, hit, dir);
  if (f === 400) mech.damage(mech.maxHealth * 5, hit, dir); // destroyed
  if (f === 500) mech.reset(5, 0, 5); // rebuilt
  if (f === 700) rules.targets.splice(rules.targets.indexOf(mech), 1); // off the field
  if (f === 800) rules.targets.push(mech);
  rules.syncWorld();
  ticks++;
  const e = mech.link.entity, should = mech.alive && rules.targets.includes(mech);
  if (should !== (e !== -1)) { fail(`tick ${f}: alive ${mech.alive}, target ${rules.targets.includes(mech)}, entity ${e}`); continue; }
  const q = world.query(Transform, Sim);
  if (q.count !== (should ? 1 : 0) || world.alive !== q.count) fail(`tick ${f}: ${q.count} heavies, ${world.alive} entities`);
  if (e === -1) { prev = null; continue; }
  if (!seen.has(e)) { if (seen.size && f !== 0 && f !== 500 && f !== 800) fail(`tick ${f}: a new entity mid-life`); seen.add(e); }
  const j = entityIndex(e), T = world.columns(Transform), P = world.columns(PrevTransform), H = world.columns(Health), M = world.columns(Team);
  const p = mech.sim.pelvis, f32 = Math.fround;
  if (T.x[j] !== f32(p.x) || T.y[j] !== f32(p.y) || T.z[j] !== f32(p.z) || T.heading[j] !== f32(mech.sim.heading)) fail(`tick ${f}: Transform`);
  if (prev && (P.x[j] !== prev[0] || P.z[j] !== prev[2])) fail(`tick ${f}: PrevTransform`);
  prev = [T.x[j], T.y[j], T.z[j], T.heading[j]];
  if (H.hp[j] !== f32(mech.health) || H.max[j] !== f32(mech.maxHealth) || M.team[j] !== 2) fail(`tick ${f}: Health or Team`);
  if (world.objects(Sim)[j] !== mech) fail(`tick ${f}: the Sim object isn't the mech`);
  // The bar, as MechUnit.bars pushed it.
  bars.length = 0;
  gatherBars(world, 1, bars);
  const b = bars[0];
  if (bars.length !== 1 || b.key !== e || b.x !== T.x[j] || Math.abs(b.y - (p.y + 3.4)) > 1e-4 || b.z !== T.z[j] || b.hp !== H.hp[j]
    || b.max !== H.max[j] || b.armour !== f32(mech.armourOf()) || b.width !== f32(3.6) || !b.always) fail(`tick ${f}: the bar`);
  bars.length = 0;
  gatherBars(world, 2, bars);
  if (bars.length) fail(`tick ${f}: the mech's own team sees its bar`);
  checked++;
}
for (const e of seen) if (e !== mech.link.entity && world.exists(e)) fail(`old entity ${e} still exists`);
if (seen.size !== 3) fail(`${seen.size} entities over its lives (want 3: first, rebuilt, back on the field)`);
console.log(`  ${ticks} ticks, ${checked} checked, ${seen.size} entities over its lives`);
if (problems.length) { console.log(`heavy: ${problems.length} problem(s)`); process.exit(1); }
console.log("heavy: ok");
