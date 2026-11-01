// Headless check of the convoy's safe zone (src/convoy/safeZone.ts, Keith 2026-11-01): distance to a car's footprint
// and the outward direction are right (inside, beside, off a corner), the weight is 0 outside and never above
// zoneAvoid, and switched off it is 0. Then robots and bandits hunting a mech that stands just beside a car: with full
// avoid none of them gets past halfway into the zone; switched off, they reach the mech; the default (semi) is
// reported. Run: npm test (or npx tsx tools/safezone-check.ts).
import { SafeZone, SAFE_DEFAULTS } from "../src/convoy/safeZone";
import { RobotSwarm, ROBOT_DEFAULTS, LEAP, LATCHED, FLUNG, DEAD, DOWN } from "../src/combat/robots";
import { InfantrySwarm, INFANTRY_DEFAULTS, DOWN as I_DOWN } from "../src/combat/infantry";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;

// ---- Geometry: one 40 x 16 car at (100, 50), heading 0.4 rad ----
const h = 0.4, car = { x: 100, z: 50, heading: h, spec: { length: 40, width: 16 } };
const fx = Math.sin(h), fz = Math.cos(h), lx = fz, lz = -fx; // forward, left (+X is left at heading 0)
const at = (a: number, s: number) => ({ x: car.x + fx * a + lx * s, z: car.z + fz * a + lz * s });
const zone = new SafeZone({ ...SAFE_DEFAULTS });
zone.update([car]);
const o = { x: 0, z: 0 };
{
  const p = at(5, 3);
  if (zone.dist(p.x, p.z, o) !== 0) fail("a point on the car isn't at distance 0");
  if (!(o.x * lx + o.z * lz > 0.99)) fail("inside, the way out isn't straight out the nearer side");
  const q = at(0, -8 - 12);
  if (!near(zone.dist(q.x, q.z, o), 12)) fail(`12 m off the right side reads ${zone.dist(q.x, q.z).toFixed(3)} m`);
  if (!(o.x * -lx + o.z * -lz > 0.99)) fail("off the right side, the way out doesn't point right");
  const c = at(20 + 3, 8 + 4);
  if (!near(zone.dist(c.x, c.z, o), 5)) fail(`off the front left corner reads ${zone.dist(c.x, c.z).toFixed(3)} m, not 5`);
  if (!near(o.x * fx + o.z * fz, 0.6, 1e-3) || !near(o.x * lx + o.z * lz, 0.8, 1e-3)) fail("off a corner, the way out doesn't point away from the corner");
  // Weights.
  const R = SAFE_DEFAULTS.zoneRadius;
  const far = at(0, 8 + R + 1);
  if (zone.weight(far.x, far.z, o) !== 0) fail("weight outside the zone isn't 0");
  let max = 0;
  for (let s = 0; s < R + 10; s += 0.5) { const p = at(0, 8 + s); max = Math.max(max, zone.weight(p.x, p.z, o)); }
  if (max > SAFE_DEFAULTS.zoneAvoid + 1e-6) fail(`weight ${max} above the avoid strength`);
  if (!near(max, SAFE_DEFAULTS.zoneAvoid)) fail("weight never reaches the avoid strength");
  const off = new SafeZone({ ...SAFE_DEFAULTS, zoneOn: 0 });
  off.update([car]);
  const pin = at(0, 10);
  if (off.weight(pin.x, pin.z, o) !== 0) fail("switched off, the weight isn't 0");
}

// ---- Hunters: robots and bandits go for a mech standing 6 m off a car's left side ----
const field = new DuneField({ ...TERRAIN_DEFAULTS, height: 0 } as typeof TERRAIN_DEFAULTS);
const flat = { x: 0, z: 0, heading: 0, spec: { length: 40, width: 16 } };
const mech = { x: 8 + 6, z: 0 };
const dt = 1 / 120, seconds = 35;

/** Closest any ground hunter came to the car (m), robots. */
function robots(v: typeof SAFE_DEFAULTS): number {
  const z = new SafeZone(v);
  z.update([flat]);
  const sw = new RobotSwarm({ ...ROBOT_DEFAULTS }, field, 5);
  sw.keepOut = z;
  sw.spawn(60, 130, 20, 10, { mid: 0.15, big: 0.03, bigMin: 1 });
  const target = { x: mech.x, y: field.height(mech.x, mech.z) + 3, z: mech.z, radius: 2 };
  let min = Infinity;
  for (let k = 0; k < seconds * 120; k++) {
    sw.update(dt, target, () => {}, () => {}, () => {});
    for (let i = 0; i < sw.hi; i++) {
      const s = sw.state[i];
      if (s >= DEAD || s === LEAP || s === LATCHED || s === FLUNG || s === DOWN) continue;
      min = Math.min(min, z.dist(sw.px[i], sw.pz[i]));
    }
  }
  return min;
}
function bandits(v: typeof SAFE_DEFAULTS): number {
  const z = new SafeZone(v);
  z.update([flat]);
  const sw = new InfantrySwarm({ ...INFANTRY_DEFAULTS }, field, 9);
  sw.keepOut = z;
  sw.spawn(40, 120, -30, 10);
  const target = { x: mech.x, y: field.height(mech.x, mech.z) + 3, z: mech.z, radius: 2 };
  let min = Infinity;
  for (let k = 0; k < seconds * 120; k++) {
    sw.update(dt, target, () => {});
    for (let i = 0; i < sw.hi; i++) if (sw.state[i] < I_DOWN) min = Math.min(min, z.dist(sw.px[i], sw.pz[i]));
  }
  return min;
}

const R = SAFE_DEFAULTS.zoneRadius;
const full = { ...SAFE_DEFAULTS, zoneAvoid: 1 }, off = { ...SAFE_DEFAULTS, zoneOn: 0 };
const rFull = robots(full), rOff = robots(off), rDef = robots({ ...SAFE_DEFAULTS });
const bFull = bandits(full), bOff = bandits(off), bDef = bandits({ ...SAFE_DEFAULTS });
console.log(`robots nearest the car: full avoid ${rFull.toFixed(1)} m, default (${SAFE_DEFAULTS.zoneAvoid}) ${rDef.toFixed(1)} m, off ${rOff.toFixed(1)} m (zone ${R} m, mech 6 m off the side)`);
console.log(`bandits nearest the car: full avoid ${bFull.toFixed(1)} m, default ${bDef.toFixed(1)} m, off ${bOff.toFixed(1)} m`);
// Full avoid: kept outside the inner half (a couple of metres for the pack's shoving).
if (rFull < R * 0.5 - 3) fail(`robots got ${rFull.toFixed(1)} m from the car with full avoid (inner half starts at ${R * 0.5} m)`);
if (bFull < R * 0.5 - 3) fail(`bandits got ${bFull.toFixed(1)} m from the car with full avoid`);
// Off: they come for the mech as before.
if (rOff > 12) fail(`with the zone off, robots never got near the mech (${rOff.toFixed(1)} m from the car)`);
if (bOff > 40) fail(`with the zone off, bandits never closed in (${bOff.toFixed(1)} m from the car)`);
// Default sits between.
if (!(rDef > rOff)) fail("the default zone doesn't hold robots off at all");

if (failed) process.exit(1);
console.log("safe zone check passed");
