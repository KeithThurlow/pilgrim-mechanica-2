// Headless replicas check (src/summon/replicas.ts, replicaBody.ts; Keith 2026-11-02: wire-frame mech replicas built
// with miniguns or rockets at random, small hitboxes, never blocking you). Real mech units on the real wire body, over
// flat ground, with a stand-in battlefield (a real register and solids; rounds and rockets counted).
// 1. roll: over many builds, the rocket share comes out near repRocketShare, and the same seed rolls the same.
// 2. follow: the owner walks 6 m/s: the replicas keep up (inside the leash), never fire with nothing near.
// 3. fight: a frozen pack 22 m ahead: minigun replicas fire rounds, rocket replicas lob volleys.
// 4. size: their hit and body sizes are the replica sliders; marked soft (src/game/solids.ts lets you walk through).
// 5. reach: a pack 52 m off (past the shared 45 m minigun reach) still draws fire (Keith 2026-11-06: "really short range").
// 6. armour: a minigun round keeps a real share on a crusher's and an excavator's armour (they did ~1 a round).
// Fails on NaN, the wrong roll, falling behind, firing at nothing, no fire on foes. Run: npm test.
import * as THREE from "three/webgpu";
import { Replicas, REPLICA_DEFAULTS } from "../src/summon/replicas";
import { MECH_DEFAULTS, type MechUnit, type MechUnitValues } from "../src/game/mechUnit";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { UPPER_DEFAULTS } from "../src/mech/upper";
import { DUST_DEFAULTS } from "../src/fx/dust";
import { ToonLook, TOON_DEFAULTS } from "../src/look/toon";
import { RobotSwarm, ROBOT_DEFAULTS } from "../src/combat/robots";
import { RobotTarget } from "../src/combat/robotTarget";
import { Register } from "../src/game/register";
import { Solids } from "../src/game/solids";
import { enemiesOf } from "../src/game/targeting";
import { armourHit } from "../src/game/armour";
import { CRUSHER_DEFAULTS } from "../src/combat/crusher";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import type { Battlefield, Hittable } from "../src/game/battlefield";

const field = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const dt = 1 / 60;
const noop: unknown = new Proxy(function () {}, { get: () => noop, apply: () => undefined });

function stage(over: Partial<typeof REPLICA_DEFAULTS> = {}, seed = 1) {
  const V = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...UPPER_DEFAULTS, ...DUST_DEFAULTS, ...MECH_DEFAULTS, ...REPLICA_DEFAULTS, repBuild: 0, ...over } as unknown as MechUnitValues & typeof REPLICA_DEFAULTS;
  const register = new Register(), solids = new Solids(), targets: Hittable[] = [];
  const counts = { fire: 0, lob: 0 };
  const bf = new Proxy({ register, targets, solids, field, v: V, lookGround: null, water: null, deaths: null, sinkSurface: null, nightLights: null,
    canSee: () => true, inWater: () => false, sinkDepth: () => 0,
    fire: () => { counts.fire++; return 0; }, lob: () => { counts.lob++; return null; } }, {
    get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop),
  }) as unknown as Battlefield;
  const owner = { team: 1, alive: true, lock: null, cursor: null, bound: { on: false },
    sim: { pos: new THREE.Vector3(0, 0, 0), pelvis: new THREE.Vector3(0, 3, 0), vel: new THREE.Vector3(), heading: 0 } };
  // Robots that stand still (as the summoner lab's ?still).
  const enemy = new RobotSwarm({ ...ROBOT_DEFAULTS, robotRunSpeed: 0, robotMidSpeed: 0, robotQuadSpeed: 0, robotBigSpeed: 0, robotLeapRange: 0 }, field, 4);
  const et = new RobotTarget(enemy, 3);
  targets.push(et); register.add(et);
  const reps = new Replicas(bf, new THREE.Group(), V, new ToonLook({ ...TOON_DEFAULTS }), owner as unknown as MechUnit, enemiesOf(1), seed);
  const place = (x: number, z: number) => { owner.sim.pos.set(x, 0, z); owner.sim.pelvis.set(x, 3, z); };
  const tick = () => { register.rebuild(); reps.update(dt); solids.tick(dt); };
  return { V, counts, owner, enemy, reps, place, tick };
}

// 1. The roll.
{
  let rockets = 0, n = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const s = stage({ repCount: 4 }, seed);
    for (let k = 0; k < 6; k++) s.tick();
    for (const r of s.reps.list) { n++; if (r.body.weapon === "rockets") rockets++; }
  }
  const again = (seed: number) => { const s = stage({ repCount: 4 }, seed); for (let k = 0; k < 6; k++) s.tick(); return s.reps.list.map((r) => r.body.weapon).join(","); };
  console.log(`roll: ${rockets}/${n} built with rockets (share ${REPLICA_DEFAULTS.repRocketShare}), seed 7: ${again(7)}`);
  if (Math.abs(rockets / n - REPLICA_DEFAULTS.repRocketShare) > 0.15) fail("roll: rocket share off");
  if (again(7) !== again(7)) fail("roll: not seeded");
  const all = stage({ repCount: 4, repRocketShare: 0 }); for (let k = 0; k < 6; k++) all.tick();
  if (all.reps.list.some((r) => r.body.weapon !== "minigun")) fail("roll: share 0 built rockets");
}

// 2. Follow, 3. fight, 4. size.
{
  const s = stage({ repCount: 2 }, 3);
  s.tick(); s.tick();
  // One of each.
  s.reps.list[0].body.setWeapon("minigun"); s.reps.list[1].body.setWeapon("rockets");
  let worst = 0, nan = 0;
  for (let t = 0; t < 20; t += dt) {
    if (t > 4) { s.place(0, (t - 4) * 6); s.owner.sim.vel.set(0, 0, 6); }
    s.tick();
    if (t > 8) for (const u of s.reps.units()) {
      const p = u.sim.pos;
      if (!Number.isFinite(p.x + p.z + u.sim.pelvis.y)) nan++;
      worst = Math.max(worst, Math.hypot(p.x - s.owner.sim.pos.x, p.z - s.owner.sim.pos.z));
    }
  }
  console.log(`follow: worst ${worst.toFixed(1)} m from the owner (leash ${s.V.repLeash}), rounds ${s.counts.fire}, rockets ${s.counts.lob}`);
  if (nan) fail("follow: NaN");
  if (s.reps.units().length !== 2) fail("follow: replicas missing");
  if (worst > s.V.repLeash) fail("follow: fell past the leash");
  if (s.counts.fire || s.counts.lob) fail("follow: firing at nothing");

  s.owner.sim.vel.set(0, 0, 0);
  const P = s.owner.sim.pos;
  const made = s.enemy.spawn(12, P.x, P.z + 22, 4, { mid: 0, big: 0, quad: 0 });
  for (const i of made) s.enemy.hp[i] = 1e6;
  for (let t = 0; t < 12; t += dt) { s.tick(); s.enemy.update(dt, { x: P.x, y: 3, z: P.z, radius: 2 }, () => {}, () => {}); }
  console.log(`fight: rounds ${s.counts.fire}, rockets ${s.counts.lob}`);
  if (s.counts.fire < 20) fail("fight: the minigun replica barely fired");
  if (s.counts.lob < 4) fail("fight: the rocket replica never fired a volley");

  const u = s.reps.units()[0];
  console.log(`size: hit ${u.v.hitRadius} m, body ${u.v.bodyRadius} m, soft ${u.softSolid}`);
  if (u.v.hitRadius !== s.V.repHitSize || u.v.bodyRadius !== s.V.repBodySize || !u.softSolid) fail("size: replica sizes not applied");
}

// 5. Reach.
{
  const s = stage({ repCount: 2 }, 3);
  s.tick(); s.tick();
  s.reps.list[0].body.setWeapon("minigun"); s.reps.list[1].body.setWeapon("rockets");
  for (let t = 0; t < 2; t += dt) s.tick();
  const made = s.enemy.spawn(8, 0, 52, 3, { mid: 0, big: 0, quad: 0 });
  for (const i of made) s.enemy.hp[i] = 1e6;
  for (let t = 0; t < 8; t += dt) { s.tick(); s.enemy.update(dt, { x: 0, y: 3, z: 0, radius: 2 }, () => {}, () => {}); }
  console.log(`reach: a pack 52 m off: rounds ${s.counts.fire}, rockets ${s.counts.lob}`);
  if (s.counts.fire < 20) fail("reach: the minigun replica ignored a pack 52 m off");
  if (s.counts.lob < 4) fail("reach: the rocket replica ignored a pack 52 m off");
}

// 6. Armour.
{
  const V = { ...MECH_DEFAULTS, ...REPLICA_DEFAULTS };
  const d = V.roundDamage * V.repDamage;
  const onCrusher = armourHit(d, CRUSHER_DEFAULTS.crusherArmour, V.repPierce), onBig = armourHit(d, ROBOT_DEFAULTS.robotBigArmour, V.repPierce);
  console.log(`armour: a round ${d.toFixed(1)}, on a crusher ${onCrusher.toFixed(1)}, on an excavator ${onBig.toFixed(1)}`);
  if (onCrusher < d * 0.3 || onBig < d * 0.5) fail("armour: replica rounds barely scratch armour");
}

if (failed) { console.log("replicas check FAILED"); process.exit(1); }
console.log("replicas check passed");
