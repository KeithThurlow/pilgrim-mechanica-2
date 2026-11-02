// Headless drones check (src/summon/drones.ts): the summoner's attack drones over the tall dunes.
// 1. idle: the owner walks a loop with no foes: the drones hold the orbit (within the ring's band, over the sand).
// 2. hunt: foes stand 20-30 m off: every drone picks one, circles it and fires; none strays past the leash.
// 3. lock: the owner's lock on a far foe (inside the leash): every drone goes for it.
// 4. down and rebuild: a drone shot down comes back after the rebuild time, with a new id.
// Fails on NaN, a drone under the sand, past the leash, idle drones off the ring, no shots, the lock ignored, no
// rebuild, or two runs with the same seed differing. Prints the numbers. Run: npm test (or npx tsx tools/drones-check.ts).
import { Drones, DRONE_DEFAULTS, type DroneFoe, type DroneOwner } from "../src/summon/drones";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const field = new DuneField({ ...TERRAIN_DEFAULTS });
let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const dt = 1 / 120;
const v = { ...DRONE_DEFAULTS };

function owner(t: number, walk: boolean): DroneOwner {
  const a = walk ? t * 0.12 : 0, R = 40;
  const x = Math.sin(a) * R, z = Math.cos(a) * R - R;
  const vx = walk ? Math.cos(a) * R * 0.12 : 0, vz = walk ? -Math.sin(a) * R * 0.12 : 0;
  return { x, y: field.height(x, z) + 3, z, vx, vz, alive: true };
}

interface Stats { nan: number; under: number; leash: number; offRing: number; samples: number; worstLeash: number }
function watch(d: Drones, o: DroneOwner, s: Stats, idle: boolean) {
  for (let i = 0; i < d.n; i++) {
    if (!d.up[i]) continue;
    if (!Number.isFinite(d.x[i] + d.y[i] + d.z[i])) { s.nan++; continue; }
    s.samples++;
    if (d.y[i] < field.height(d.x[i], d.z[i]) + 0.5) s.under++;
    const r = Math.hypot(d.x[i] - o.x, d.z[i] - o.z);
    s.worstLeash = Math.max(s.worstLeash, r);
    if (r > v.droneLeash + 4) s.leash++;
    if (idle && Math.abs(r - v.droneOrbitR) > 3.5) s.offRing++;
  }
}
const fresh = (): Stats => ({ nan: 0, under: 0, leash: 0, offRing: 0, samples: 0, worstLeash: 0 });

// 1. Idle.
{
  const d = new Drones(v, field, 3), s = fresh();
  for (let t = 0; t < 30; t += dt) { const o = owner(t, true); d.step(dt, o, [], null); if (t > 4) watch(d, o, s, true); }
  console.log(`idle: ${d.flying}/${d.n} up, samples ${s.samples}, off the ring ${s.offRing}, under the sand ${s.under}, NaN ${s.nan}`);
  if (d.flying !== v.droneCount) fail("idle: not every drone launched");
  if (s.nan) fail("idle: NaN");
  if (s.under) fail("idle: a drone under the sand");
  if (s.offRing > s.samples * 0.03) fail(`idle: drones off the orbit ring (${s.offRing}/${s.samples})`);
}

// 2. Hunt, and 3. lock.
function hunt(seed: number, withLock: boolean) {
  const d = new Drones(v, field, seed), s = fresh();
  const foes: DroneFoe[] = [];
  for (let k = 0; k < 5; k++) {
    const a = 0.5 + k * 0.4, r = 20 + k * 2.5, x = Math.sin(a) * r, z = Math.cos(a) * r;
    foes.push({ key: 100 + k, x, y: field.height(x, z) + 1, z, r: 0.8, vx: 0, vz: 0 });
  }
  const far = { key: 999, x: -30, y: field.height(-30, 10) + 1, z: 10, r: 1.5, vx: 0, vz: 0 };
  let onLock = 0, busy = 0, lockSamples = 0;
  const hitsOn = new Map<number, number>();
  for (let t = 0; t < 20; t += dt) {
    const o = owner(t, false);
    d.step(dt, o, foes, withLock ? far : null);
    for (const e of d.events) if (e.kind === "shot") hitsOn.set(e.shot.foe, (hitsOn.get(e.shot.foe) ?? 0) + 1);
    if (t > 6) {
      watch(d, o, s, false);
      for (let i = 0; i < d.n; i++) { if (!d.up[i]) continue; lockSamples++; if (d.foe[i] >= 0) busy++; if (d.foe[i] === 999) onLock++; }
    }
  }
  return { d, s, onLock, busy, lockSamples, hitsOn, trace: `${d.x[0].toFixed(4)},${d.y[0].toFixed(4)},${d.z[0].toFixed(4)},${d.shots}` };
}
{
  const a = hunt(5, false), b = hunt(5, false);
  const spread = [...a.hitsOn.keys()].length;
  console.log(`hunt: rounds ${a.d.shots}, foes shot at ${spread}, busy ${(100 * a.busy / Math.max(1, a.lockSamples)).toFixed(0)}%, worst from the mech ${a.s.worstLeash.toFixed(1)} m (leash ${v.droneLeash}), under ${a.s.under}, NaN ${a.s.nan}`);
  if (a.s.nan) fail("hunt: NaN");
  if (a.s.under) fail("hunt: a drone under the sand");
  if (a.s.leash) fail("hunt: a drone past the leash");
  if (a.d.shots < 50) fail("hunt: too few rounds fired");
  if (a.busy < a.lockSamples * 0.95) fail("hunt: drones idle with foes in reach");
  if (spread < 2) fail("hunt: every drone on the same foe (no spread)");
  if (a.trace !== b.trace) fail(`hunt: same seed, different runs (${a.trace} vs ${b.trace})`);
  const l = hunt(5, true);
  console.log(`lock: ${(100 * l.onLock / Math.max(1, l.lockSamples)).toFixed(0)}% of drone time on the locked foe, rounds at it ${l.hitsOn.get(999) ?? 0}`);
  if (l.onLock < l.lockSamples * 0.99) fail("lock: drones not on the owner's lock");
  if ((l.hitsOn.get(999) ?? 0) < 30) fail("lock: too few rounds at the locked foe");
  if (l.s.leash) fail("lock: a drone past the leash");
}

// 4. Down and rebuild.
{
  const d = new Drones(v, field, 9);
  let t = 0;
  for (; t < 3; t += dt) d.step(dt, owner(t, false), [], null);
  const id0 = d.id[0];
  d.hurt(0, v.droneHp + 1);
  const downAt = t;
  let back = -1;
  for (; t < downAt + v.droneRebuild + 2; t += dt) { d.step(dt, owner(t, false), [], null); if (back < 0 && d.up[0]) back = t - downAt; }
  console.log(`rebuild: down, back after ${back.toFixed(2)} s (rebuild ${v.droneRebuild} s), id ${id0} -> ${d.id[0]}, lost ${d.lost}`);
  if (back < 0) fail("rebuild: the drone never came back");
  else if (Math.abs(back - v.droneRebuild) > 0.1) fail("rebuild: came back at the wrong time");
  if (d.id[0] === id0) fail("rebuild: same id after a rebuild");
}

if (failed) { console.log("drones check FAILED"); process.exit(1); }
console.log("drones check passed");
