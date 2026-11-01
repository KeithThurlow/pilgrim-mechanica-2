// Probe: how well a rival's aim keeps on a moving foe (no sims: the rival stands, the foe moves on a script). Mean
// bearing error (deg) at close range and the miss (m) at range, per level and kit; and after a foe runs past it (a
// lunge's overshoot), how long until its aim is back within 20°.
// Run: npx tsx tools/rival-track-probe.ts
import { RivalAi, RIVAL_AI_DEFAULTS, RIVAL_LEVELS, RIVAL_LEVEL_IDS, type DuelView } from "../src/combat/rivalAi";
import type { KitWeapon, KitKind } from "../src/combat/rivalKit";

const W = (kind: KitKind, side: 0 | 1, o: Partial<KitWeapon> = {}): KitWeapon => ({ ctl: { trigger: side }, kind, range: 60, minRange: 0, speed: Infinity, blast: 0, damage: 10, rate: 10, count: 1, cooldown: 0.6, charge: 0, spinUp: 0.3, spread: 1, flight: 0, ideal: 30, ...o });
const KITS: Record<string, KitWeapon[]> = {
  "sword+minigun": [W("sword", 0, { range: 7, ideal: 4 }), W("minigun", 1)],
  "sword+autocannon": [W("sword", 0, { range: 7, ideal: 4 }), W("autocannon", 1, { speed: 250, range: 70 })],
  "minigun x2": [W("minigun", 0), W("minigun", 1)],
};
type Path = (t: number) => { x: number; z: number; vx: number; vz: number };
const circle = (r: number, sp: number): Path => (t) => { const a = (sp / r) * t; return { x: Math.sin(a) * r, z: Math.cos(a) * r, vx: Math.cos(a) * sp, vz: -Math.sin(a) * sp }; };
const strafe = (d: number, sp: number): Path => (t) => { const s = Math.sin(t * 0.6) >= 0 ? 1 : -1; const x = (2 / 0.6) * sp * Math.asin(Math.sin(t * 0.6)) / Math.PI; return { x, z: d, vx: s * sp, vz: 0 }; };
const pass = (sp: number): Path => (t) => ({ x: 3, z: 10 - sp * t, vx: 0, vz: -sp });

function run(level: string, kit: KitWeapon[], path: Path, T: number) {
  const ai = new RivalAi({ ...RIVAL_AI_DEFAULTS, ...RIVAL_LEVELS[level as "recruit"], aiCover: 0, aiDodgeChance: 0 }, 3);
  const dt = 1 / 60, errs: number[] = [], miss: number[] = [];
  let back = -1;
  for (let t = 0; t < T; t += dt) {
    const p = path(t);
    const view: DuelView = { t, self: { x: 0, z: 0, vx: 0, vz: 0, heading: 0, health: 1, dashCharges: 0, canDash: false, dashing: false, walkSpeed: 6, kit, weapons: kit.map((_, i) => ({ i, ready: true, charge: 0 })) },
      foe: { x: p.x, y: 3, z: p.z, vx: p.vx, vz: p.vz, health: 1, dashCharges: 2, alive: true, gunsOff: false, airborne: false, staggered: false, r: 2.5 },
      threats: [], cover: [], sees: () => true, arena: { x: 0, z: 0, r: 500 } };
    const c = ai.decide(view, dt);
    const a = c.aim!;
    let e = Math.atan2(a.x, a.z) - Math.atan2(p.x, p.z); e -= Math.round(e / (2 * Math.PI)) * 2 * Math.PI;
    if (t > 2) { errs.push(Math.abs(e) * 180 / Math.PI); miss.push(Math.hypot(a.x - p.x, a.z - p.z)); }
    if (back < 0 && p.z < -3 && Math.abs(e) < 20 * Math.PI / 180) back = t - 10 / 6; // seconds after the foe drew level
  }
  const mean = (x: number[]) => x.reduce((s, y) => s + y, 0) / Math.max(1, x.length);
  return { deg: mean(errs), miss: mean(miss), back };
}
for (const lvl of RIVAL_LEVEL_IDS) {
  const out: string[] = [];
  for (const [name, kit] of Object.entries(KITS)) {
    if (name.startsWith("sword")) {
      const c = run(lvl, kit, circle(6, 6), 12), p = run(lvl, kit, pass(6), 8);
      out.push(`${name}: circle@6m ${c.deg.toFixed(0)}°, run-past back on in ${p.back < 0 ? "never" : p.back.toFixed(2) + " s"}`);
    } else {
      const s = run(lvl, kit, strafe(30, 6), 14);
      out.push(`${name}: strafe@30m miss ${s.miss.toFixed(1)} m`);
    }
  }
  console.log(lvl.padEnd(8), out.join(" · "));
}
