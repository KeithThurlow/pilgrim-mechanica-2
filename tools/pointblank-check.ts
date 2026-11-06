// Nothing a weapon kills is thrown back at the mech (Keith 2026-11-06: "the handheld minigun has negative knockback").
// Must hold:
// - A shot's line (src/weapons/shotLine.ts) never points back against its barrel in plan, wherever the aim is: in
//   front, beside, behind the muzzle (an enemy closer than a held gun's muzzle) or under it; a point-blank aim moves the
//   start back along the barrel, at most pullBack, so the aim is in front of it; an ordinary aim (in front, within 75°
//   of the barrel) is untouched.
// - Damage over time (burning, hot metal, chill and its thermal shock) hands the target the way the round came, level,
//   never a bare "up" that the swarms would turn into a throw along the victim's heading (at the mech it was charging).
// Run: npm test (or npx tsx tools/pointblank-check.ts).
import * as THREE from "three";
import { shotLine } from "../src/weapons/shotLine";
import { Burns } from "../src/game/burn";
import { Chills } from "../src/game/chill";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };

// ---- Shot lines ----
{
  const muzzle = { x: 1.2, y: 3.4, z: 3.8 }, from = new THREE.Vector3(), dir = new THREE.Vector3();
  let worst = 1, cases = 0, moved = 0;
  for (let yawDeg = -100; yawDeg <= 100; yawDeg += 10) {
    const yw = (yawDeg * Math.PI) / 180, barrel = { x: Math.sin(yw) * 0.97, y: -0.24, z: Math.cos(yw) * 0.97 };
    for (let ax = -12; ax <= 12; ax += 1.5) for (let az = -6; az <= 20; az += 1.5) {
      const at = { x: muzzle.x + ax, y: 1, z: muzzle.z + az };
      const back = shotLine(muzzle, barrel, at, 4, from, dir);
      const bl = Math.hypot(barrel.x, barrel.z), dot = (dir.x * barrel.x + dir.z * barrel.z) / bl / (Math.hypot(dir.x, dir.z) || 1);
      worst = Math.min(worst, dot); cases++;
      must(dot > 0, `aim (${ax}, ${az}) off the muzzle, barrel ${yawDeg}°: the round flies back against the barrel (${dot.toFixed(2)})`);
      must(back <= 4 + 1e-9 && Math.abs(from.distanceTo(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z)) - back) < 1e-6, `start moved ${back.toFixed(2)} m (cap 4)`);
      const along = (ax * barrel.x + az * barrel.z) / bl;
      // Ordinary: in front of the muzzle and within 75° of the barrel (the fire cone keeps the barrel on the aim).
      const flatD = Math.hypot(ax, az);
      if (along >= 1 && along > 0.26 * flatD && flatD > 1) must(back === 0 && Math.abs(dir.distanceTo(new THREE.Vector3(at.x - muzzle.x, at.y - muzzle.y, at.z - muzzle.z).normalize())) < 1e-9, `an ordinary aim (${along.toFixed(1)} m ahead) was changed`);
      if (back > 0) moved++;
    }
  }
  // A robot at the mech's feet, 2 m in front of the pelvis, with the held gun's muzzle 3.8 m out: outward now.
  const back = shotLine(muzzle, { x: 0, y: -0.3, z: 0.95 }, { x: 0.5, y: 0.6, z: 2 }, 4, from, dir);
  must(back > 1 && dir.z > 0, `point blank at the feet: start moved ${back.toFixed(2)} m, dir z ${dir.z.toFixed(2)} (want back > 1, outward)`);
  must(shotLine(muzzle, { x: 0, y: 0, z: 1 }, null, 4, from, dir) === 0 && dir.z === 1, "no aim: not along the barrel");
  console.log(`shot lines: ${cases} aims, worst along the barrel ${worst.toFixed(2)} (never back), ${moved} point blank moved back`);
}

// ---- Damage over time: the way the round came ----
{
  const seen: THREE.Vector3[] = [];
  const target = { team: 2, alive: true, surface: "metal", matter: "metal", hitRay: () => -1, pick: () => {}, damage: (_d: number, _at: THREE.Vector3, dir: THREE.Vector3) => { seen.push(dir.clone()); } };
  const burns = new Burns();
  burns.ignite(target as never, 0, 2, 50, 0, 1, 10, 0.6, 0.8);
  for (let i = 0; i < 240; i++) burns.step(1 / 120);
  const chills = new Chills();
  chills.heatAt = () => 1; // hot metal: the first cold hit is a thermal shock
  chills.hit(target as never, 0, 0.5, 40, 0, 1, 10, -0.8, 0.6);
  for (let i = 0; i < 240; i++) chills.step(1 / 120);
  const flat = seen.filter((d) => Math.abs(d.y) < 1e-9 && Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-6);
  must(seen.length > 4, `damage over time ticked ${seen.length} times`);
  must(flat.length === seen.length, `${seen.length - flat.length} of ${seen.length} burn and cold ticks carried no way in plan (a kill would be thrown along the victim's heading)`);
  must(seen.some((d) => Math.abs(d.x - 0.6) < 1e-6) && seen.some((d) => Math.abs(d.x + 0.8) < 1e-6), "burn and cold ticks don't carry their rounds' ways");
  console.log(`damage over time: ${seen.length} ticks, each along the round's way in plan`);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n  ${problems.slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
console.log("pointblank-check: ok");
