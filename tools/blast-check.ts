// Headless blast check (2026-11-01, Keith: "things within the blast wave are not guaranteed to receive damage").
// Fails on: a robot or bandit in a blast's reach (through the register's culling, on dunes, while the swarms move)
// taking nothing; a raider vehicle beside a blast taking nothing (they had no splash); a knocked-down bandit in a
// blast taking nothing; cover not working (a wall of ground or a steel wreck between the blast and a unit must shield
// it; the same unit in the open must not be); a unit right at the blast shielded by the ground it stands on.
// Run: npm test (or npx tsx tools/blast-check.ts).
import * as THREE from "three/webgpu";
import { RobotSwarm, ROBOT_DEFAULTS, DEAD } from "../src/combat/robots";
import { RobotTarget } from "../src/combat/robotTarget";
import { InfantrySwarm, INFANTRY_DEFAULTS, DOWN } from "../src/combat/infantry";
import { InfantryTarget } from "../src/combat/infantryTarget";
import { Raider, WARBAND_DEFAULTS } from "../src/combat/warband";
import { Register } from "../src/game/register";
import { splashBlast, blastCover } from "../src/game/splash";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import type { Hittable } from "../src/game/battlefield";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const down = new THREE.Vector3(0, -1, 0);
const flat = { height: () => 0, normal: (_x: number, _z: number, out = [0, 1, 0]) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; } };

// 1. Every robot and bandit in reach of a blast takes it, culled by the register, on dunes, while they move.
{
  const field = new DuneField({ ...TERRAIN_DEFAULTS });
  const robots = new RobotSwarm({ ...ROBOT_DEFAULTS, robotHp: 1e9, robotMidHp: 1e9, robotBigHp: 1e9 }, field, 3);
  const bandits = new InfantrySwarm({ ...INFANTRY_DEFAULTS, hp: 1e9 }, field, 5);
  const rt = new RobotTarget(robots, 3), it = new InfantryTarget(bandits, 2);
  const reg = new Register();
  reg.add(rt); reg.add(it);
  robots.spawn(60, 30, 0, 14, { mid: 0.3, big: 0.15 });
  bandits.spawn(60, -30, 0, 12);
  const targets: Hittable[] = [rt, it];
  const tgt = { x: 0, y: 0, z: 0, radius: 2 };
  const at = new THREE.Vector3();
  let rIn = 0, rMiss = 0, bIn = 0, bMiss = 0;
  const R = 4.5;
  for (let f = 0; f < 300; f++) {
    reg.rebuild();
    for (let s = 0; s < 4; s++) { robots.update(1 / 120, { ...tgt, vx: 0, vz: 0 }, () => {}); bandits.update(1 / 120, tgt, () => {}); }
    for (let q = 0; q < 4; q++) {
      const sw = q % 2 ? bandits : robots, n = sw.hi;
      const i = Math.floor(Math.random() * n);
      if (sw.state[i] >= (q % 2 ? DOWN : DEAD)) continue;
      const a = Math.random() * 6.28, d = Math.random() * (R + 2);
      at.set(sw.px[i] + Math.cos(a) * d, 0, sw.pz[i] + Math.sin(a) * d); at.y = field.height(at.x, at.z);
      // A bandit's reach as splash measures it: to the vertical line from its feet to its head (a flat-only test
      // flaked: a bandit on a slope just inside flat but outside in 3D).
      const H = bandits.v.banditHeight;
      const bReach = (j: number) => { const dy = Math.max(bandits.py[j] - at.y, 0, at.y - (bandits.py[j] + H)); return Math.hypot(bandits.px[j] - at.x, bandits.pz[j] - at.z, dy) < R - 0.05; };
      const reach = (j: number) => (q % 2 ? bReach(j) : rt.splashShare(j, at.x, at.y, at.z, R) > 0.01);
      const before: number[] = [], inside: number[] = [];
      for (let j = 0; j < n; j++) if (sw.state[j] < (q % 2 ? DOWN : DEAD) && reach(j)) { inside.push(j); before.push(sw.hp[j]); }
      splashBlast(targets, 1, at, R, 300, down);
      inside.forEach((j, k) => { const hurt = sw.hp[j] < before[k]; if (q % 2) { bIn++; if (!hurt) bMiss++; } else { rIn++; if (!hurt) rMiss++; } });
    }
  }
  ok(rIn > 200 && rMiss === 0, `robots in a blast's reach all take it (${rIn - rMiss} of ${rIn}, culled, moving, on dunes)`);
  ok(bIn > 200 && bMiss === 0, `bandits in a blast's reach all take it (${bIn - bMiss} of ${bIn})`);
}

// 2. A raider vehicle beside a blast takes it (not only a direct hit).
{
  const w = { ...WARBAND_DEFAULTS };
  const r = new Raider("gunTruck", flat as never, () => 2, w);
  r.sim.pos.set(0, 0, 0);
  const hp0 = r.hp;
  splashBlast([r], 1, new THREE.Vector3(3, 0, 0), 4.5, 300, down, null, 0.6);
  ok(r.hp < hp0, `a gun truck 3 m from a rocket's blast takes it (${(hp0 - r.hp).toFixed(0)} of ${hp0})`);
  const hp1 = r.hp;
  splashBlast([r], 1, new THREE.Vector3(12, 0, 0), 4.5, 300, down, null, 0.6);
  ok(r.hp === hp1, "a gun truck 12 m off a 4.5 m blast doesn't");
}

// 3. A knocked-down bandit in a blast takes it.
{
  const bandits = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, flat, 7);
  bandits.spawn(1, 0, 0, 0.1);
  const i = 0;
  bandits.px[i] = 0; bandits.pz[i] = 0; bandits.py[i] = 0;
  bandits.stomp(0.6 / INFANTRY_DEFAULTS.stompKill + 0.01, 0, 1); // a near stomp: knocked down, not killed
  if (bandits.state[i] !== DOWN) { bandits.state[i] = DOWN; }
  const hp0 = bandits.hp[i];
  const it = new InfantryTarget(bandits, 2);
  splashBlast([it], 1, new THREE.Vector3(2, 0, 0), 4.5, 30, down);
  ok(bandits.hp[i] < hp0 || bandits.state[i] === DEAD, `a knocked-down bandit 2 m from a blast takes it (hp ${hp0} -> ${bandits.hp[i]})`);
}

// 4. Cover: a wall of ground between the blast and a robot shields it; the same robot in the open doesn't.
{
  const wall = { height: (x: number) => (x > 2 && x < 2.8 ? 4 : 0), normal: flat.normal };
  const run = (ground: { height(x: number, z: number): number }, steel: Parameters<typeof blastCover>[1] = null) => {
    const sw = new RobotSwarm({ ...ROBOT_DEFAULTS, robotHp: 1e6 }, flat, 9);
    const i = sw.spawn(1, 4, 0, 0, { mid: 0, big: 0 })[0];
    sw.px[i] = 4; sw.pz[i] = 0;
    const rt = new RobotTarget(sw, 3), hp0 = sw.hp[i], at = new THREE.Vector3(0, 0, 0);
    splashBlast([rt], 1, at, 4.5, 100, down, null, undefined, blastCover(ground, steel, at));
    return hp0 - sw.hp[i];
  };
  ok(run(flat) > 0, `in the open a robot 4 m from a blast takes it (${run(flat).toFixed(0)})`);
  ok(run(wall) === 0, "behind a 4 m wall of ground it takes none");
  const plate = (o: THREE.Vector3, d: THREE.Vector3, max: number) => { const t = (2.4 - o.x) / (d.x || 1e-9); return t > 0 && t < max ? t : -1; };
  ok(run(flat, plate) === 0, "behind a steel wreck it takes none");
  const low = { height: (x: number) => (x > 2 && x < 2.8 ? 0.3 : 0), normal: flat.normal };
  ok(run(low) > 0, "a 0.3 m lip of sand isn't cover");
  // On a slope (the blast on the sand, the unit up the dune) the ground under them doesn't shield anything.
  const slope = { height: (x: number) => x * 0.35, normal: flat.normal };
  const c = blastCover(slope, null, new THREE.Vector3(0, 0, 0));
  ok(!c(4, 4 * 0.35 + 0.5, 0) && !c(-4, -4 * 0.35 + 0.5, 0), "a straight slope shields nobody, up or down it");
  ok(!c(1, 5, 0), "a unit right at the blast is never covered");
}

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log("blast check passed");
