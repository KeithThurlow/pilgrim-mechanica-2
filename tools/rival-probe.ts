// Probe: damage the rival deals to a player who stands / strafes / dashes about, and the time to kill it, per level.
// Run: npx tsx tools/rival-probe.ts
import { runDuel } from "../src/combat/duelSim";
import { RIVAL_LEVELS, RIVAL_LEVEL_IDS, type MechCommand, type DuelView } from "../src/combat/rivalAi";
import { loadoutFor } from "../src/items/weaponPick";

const idle = (): MechCommand => ({ move: { x: 0, z: 0, sprint: false }, aim: null, shotAt: null, cursor: null, lock: null, trigger: [false, false], keys: [false, false, false, false], dash: null, dashHold: false });
const mode = (m: string) => (i: number, v: DuelView, t: number): MechCommand | null => {
  if (i !== 0) return null;
  const c = idle();
  if (m === "strafe") { const s = Math.sin(t * 0.5) >= 0 ? 1 : -1; c.move = { x: s, z: 0, sprint: false }; }
  if (m === "dodgy") { const s = Math.sin(t * 1.3) >= 0 ? 1 : -1; c.move = { x: s, z: 0.3, sprint: false }; if (Math.floor(t * 10) % 25 === 0 && v.self.canDash) c.dash = { x: -s, z: 0 }; }
  return c;
};
const KITS = [
  { left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "pack" },
  { left: "rail", right: "minigun", k1: "none", k2: "none", k3: "pack" },
  { left: "autocannon", right: "rail", k1: "missiles", k2: "none", k3: "mortar" },
] as const;
// Time to kill with the default pick, the player proxied by a Veteran-level AI (a human is better at standing out of lines).
const DEFAULT_PICK = { left: "minigun", right: "rpg", k1: "missiles", k2: "none", k3: "mortar" } as const;
for (const lvl of RIVAL_LEVEL_IDS) {
  let wins = 0, tt = 0, left = 0;
  const N = 14;
  for (let seed = 1; seed <= N; seed++) {
    const r = runDuel({ seedA: 1, seedB: 100 + seed, maxTime: 90, cover: 0, aiSeed: seed, loadouts: [loadoutFor(DEFAULT_PICK), null], aiEach: [RIVAL_LEVELS.veteran, RIVAL_LEVELS[lvl]], hullMul: [1, RIVAL_LEVELS[lvl].rivalHull] });
    if (r.winner === 0) { wins++; tt += r.time; }
    left += Object.values(r.score.rounds[0].taken).reduce((a, b) => a + b, 0);
  }
  console.log(lvl, `player wins ${wins}/${N}, mean kill time ${(tt / Math.max(1, wins)).toFixed(1)} s, mean damage taken ${Math.round(left / N)} of 3000`);
}
for (const lvl of RIVAL_LEVEL_IDS) {
  const out: string[] = [];
  for (const m of ["stand", "strafe", "dodgy"]) {
    let dmg = 0, n = 0; const kinds: Record<string, number> = {};
    for (const kit of KITS.slice(0, 1)) for (let seed = 1; seed <= 14; seed++) {
      const r = runDuel({ seedA: 1, seedB: 100 + seed, maxTime: 30, hull: 1e6, cover: 0, aiSeed: seed, loadouts: [loadoutFor(kit), null], aiEach: [undefined, RIVAL_LEVELS[lvl]], script: mode(m) });
      dmg += Object.values(r.score.rounds[0].taken).reduce((a, b) => a + b, 0); n++; for (const [k, x] of Object.entries(r.score.rounds[0].taken)) kinds[k] = (kinds[k] ?? 0) + x;
    }
    out.push(`${m} ${Math.round(dmg / n)} [${Object.entries(kinds).map(([k, x]) => k + " " + Math.round(x / n)).join(", ")}]`);
  }
  console.log(lvl, "player damage taken per 30 s:", out.join(" · "));
}
