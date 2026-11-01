// Probe: a rival's sprints to reposition, on a kinematic stand-in (walks 6 m/s, sprints 14 m/s with the drift left to
// the real walker): how often it sprints, how long, how far round the foe it swings, and that it answers a foe's sprint.
// Run: npx tsx tools/rival-sprint-probe.ts
import { RivalAi, RIVAL_AI_DEFAULTS, RIVAL_LEVELS, RIVAL_LEVEL_IDS, type DuelView } from "../src/combat/rivalAi";
import type { KitWeapon, KitKind } from "../src/combat/rivalKit";

const W = (kind: KitKind, side: 0 | 1, o: Partial<KitWeapon> = {}): KitWeapon => ({ ctl: { trigger: side }, kind, range: 60, minRange: 0, speed: Infinity, blast: 0, damage: 10, rate: 10, count: 1, cooldown: 0.6, charge: 0, spinUp: 0.3, spread: 1, flight: 0, ideal: 30, ...o });
const KITS: Record<string, KitWeapon[]> = { guns: [W("minigun", 0), W("minigun", 1)], sword: [W("sword", 0, { range: 7, ideal: 4 }), W("minigun", 1)] };

function run(level: string, kit: KitWeapon[], seed: number, foeSprintAt: number[]) {
  const ai = new RivalAi({ ...RIVAL_AI_DEFAULTS, ...RIVAL_LEVELS[level as "recruit"], aiCover: 0, aiDodgeChance: 0 }, seed);
  const dt = 1 / 60;
  let x = 0, z = -60, vx = 0, vz = 0, bars = 4, dashT = -1, hold = false;
  let sprints = 0, runT = 0, swing = 0, startB = 0, was = false, mirrored = 0;
  for (let t = 0; t < 40; t += dt) {
    const fs = foeSprintAt.some((a) => t >= a && t < a + 1.5);
    const fx = Math.sin(t * 0.3) * 10, fz = 0;
    const dashing = dashT >= 0 && t - dashT < 0.4;
    const view: DuelView = { t, self: { x, z, vx, vz, heading: 0, health: 1, dashCharges: Math.floor(bars), canDash: bars >= 1, dashing, walkSpeed: 6, kit, weapons: kit.map((_, i) => ({ i, ready: true, charge: 0 })) },
      foe: { x: fx, y: 3, z: fz, vx: 0, vz: 0, health: 1, dashCharges: 2, alive: true, gunsOff: fs, airborne: false, staggered: false, r: 2.5 },
      threats: [], cover: [], sees: () => true, arena: { x: 0, z: 0, r: 500 } };
    const c = ai.decide(view, dt);
    if (c.dash && bars >= 1) { bars -= 1; dashT = t; }
    hold = c.dashHold && (hold || dashT === t);
    const running = hold && bars > 0;
    if (running) bars = Math.max(0, bars - dt * 0.8); else bars = Math.min(4, bars + dt * 0.35);
    const sp = dashing ? 18 : running ? 14 : 6;
    const ml = Math.hypot(c.move.x, c.move.z);
    const k = 1 - Math.exp(-dt / (running ? 0.35 : 0.15)); // a sprint turns wide (the drift)
    vx += ((ml > 1e-3 ? c.move.x / ml : 0) * sp * Math.min(1, ml) - vx) * k; vz += ((ml > 1e-3 ? c.move.z / ml : 0) * sp * Math.min(1, ml) - vz) * k;
    x += vx * dt; z += vz * dt;
    const b = Math.atan2(x - fx, z - fz);
    if (ai.sprinting && !was) { sprints++; startB = b; if (fs) mirrored++; }
    if (!ai.sprinting && was) { let d = b - startB; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; swing += Math.abs(d); }
    if (ai.sprinting) runT += dt;
    was = ai.sprinting;
  }
  return { sprints, runT, swing: sprints ? swing / sprints * 180 / Math.PI : 0, mirrored };
}
for (const lvl of RIVAL_LEVEL_IDS) {
  const out: string[] = [];
  for (const [name, kit] of Object.entries(KITS)) {
    let n = 0, rt = 0, sw = 0, m = 0;
    const N = 6;
    for (let seed = 1; seed <= N; seed++) { const r = run(lvl, kit, seed, [12, 22, 32]); n += r.sprints; rt += r.runT; sw += r.swing; m += r.mirrored; }
    out.push(`${name}: ${(n / N).toFixed(1)} sprints/40 s, ${(rt / Math.max(1, n)).toFixed(1)} s each, ${(sw / N).toFixed(0)}° round you, answered ${m}/${N * 3} of your sprints`);
  }
  console.log(lvl.padEnd(8), out.join(" · "));
}
