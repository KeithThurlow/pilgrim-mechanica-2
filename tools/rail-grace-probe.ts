// Numbers for the rival's track-then-snapshot rule (Keith 2026-10-31): per level, the share of the rival's rail slugs that
// hit a player who (a) stands, (b) strafes in a straight line, (c) reverses or (d) dashes a beat after the snapshot
// starts, plus the player's rail damage taken per 45 s. Run: npx tsx tools/rail-grace-probe.ts
import { RIVAL_LEVELS, RIVAL_LEVEL_IDS, type DuelView, type MechCommand } from "../src/combat/rivalAi";
import { runDuel } from "../src/combat/duelSim";
import { loadoutFor } from "../src/items/weaponPick";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";

const idle = (): MechCommand => ({ move: { x: 0, z: 0, sprint: false }, aim: null, shotAt: null, cursor: null, lock: null, trigger: [false, false], keys: [false, false, false, false], dash: null, dashHold: false });
export type PlayerMode = "stand" | "strafe" | "reverse" | "dash";
/** A scripted player: reacts `react` s after the rival's snapshot begins (its rail has `snap` s of charge left). */
export const player = (m: PlayerMode, snap: number, react = 0.1) => {
  let side = 1, snapT = -1, done = false;
  const frac = 1 - snap / WEAPON_DEFAULTS.railCharge;
  return (i: number, v: DuelView, t: number): MechCommand | null => {
    if (i !== 0) return null;
    const c = idle();
    if (m === "stand") return c;
    c.move.x = side;
    if (m === "strafe") return c;
    const th = v.threats.find((x) => x.rail);
    if (!th) { snapT = -1; done = false; }
    else if ((th.charge ?? 0) >= frac && snapT < 0) snapT = t;
    if (snapT >= 0 && t - snapT >= react && !done) {
      done = true;
      if (m === "reverse") { side = -side; c.move.x = side; } else c.dash = { x: -side, z: 0 };
    }
    return c;
  };
};
const MINI = { left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "pack" } as const;
const RAIL = { left: "rail", right: "minigun", k1: "none", k2: "none", k3: "pack" } as const;
export function railRates(lvl: (typeof RIVAL_LEVEL_IDS)[number], m: PlayerMode, seeds = 6, react = 0.1, over: Record<string, number> = {}) {
  const L = { ...RIVAL_LEVELS[lvl], ...over };
  let shots = 0, hits = 0, dmg = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = runDuel({ seedA: 1, seedB: 100 + seed, maxTime: 45, hull: 1e6, cover: 0, aiSeed: seed, loadouts: [loadoutFor(MINI), loadoutFor(RAIL)], aiEach: [undefined, L], script: player(m, L.aiSnapshot!, react), freeDash: [true, false] });
    shots += r.rail[1][0]; hits += r.rail[1][1]; dmg += r.score.rounds[0].taken.rail ?? 0;
  }
  return { shots, hits, rate: hits / Math.max(1, shots), dmg: dmg / seeds };
}
declare const process: { argv: string[] };
if (process.argv[1]?.includes("rail-grace-probe")) {
  for (const lvl of RIVAL_LEVEL_IDS) for (const m of ["stand", "strafe", "reverse", "dash"] as const) {
    const a = railRates(lvl, m, 6, Number(process.argv[2] ?? 0.15));
    console.log(lvl.padEnd(8), m.padEnd(8), `shots ${a.shots} hits ${a.hits} (${Math.round(100 * a.rate)}%) rail dmg per 45 s ${Math.round(a.dmg)}`);
  }
}
