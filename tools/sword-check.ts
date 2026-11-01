// The sword's rules (src/weapons/sword.ts): a click swings once (wind-up, slash, recover, then still), the slash
// sweeps the whole arc from outboard across, held it swings again the other way, the blade stalls for its hitch on a
// bite, it hits only in the slash; the blade's sheets cut every body in the arc and reach once per swing (none behind
// or out of reach), nearest first, until the cleave budget is spent; the item fits an arm's hand and resolves to a
// melee gun with the reach as its range.
// Run: npm test (or npx tsx tools/sword-check.ts).
import { SwordSim, SWORD_DEFAULTS, sweepAngles, swordCuts, type SwordStats } from "../src/weapons/sword";
import { sheetCircle, type PenMaterial, type Sheet, type SheetHit } from "../src/game/sheet";
import { defaultLoadout, fit, fitProblem, resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";
import { loadoutFor } from "../src/items/weaponPick";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const V = SWORD_DEFAULTS, D2R = Math.PI / 180, dt = 1 / 120;
const st: SwordStats = { damage: V.swordDamage, ap: V.swordAp, reach: V.swordReach, arc: V.swordArc, windup: V.swordWindup, slash: V.swordSlash, recover: V.swordRecover, cleave: V.swordCleave };

// ---- Timing: one click, one swing ----
{
  const sw = new SwordSim(1, () => V.swordRest);
  let t = 0, slashT = 0, lo = Infinity, hi = -Infinity, first: number | null = null, last = 0;
  let pressed = true;
  while (t < 2) {
    const sweep = sw.update(dt, pressed, st, V.swordComboAt);
    pressed = false;
    t += dt;
    if (sweep) { slashT += dt; first ??= sweep.from; last = sweep.to; lo = Math.min(lo, sweep.to); hi = Math.max(hi, sweep.from); }
  }
  must(sw.swings === 1, `a click swung ${sw.swings} times`);
  must(sw.phase === "idle", "a single swing didn't come back to rest");
  must(Math.abs(slashT - st.slash) < 2 * dt, `slash lasted ${slashT.toFixed(3)} s, not ${st.slash}`);
  must(first !== null && first > 0 && last < 0, "the left arm's first swing didn't cut from its left across to its right");
  must(hi - lo >= st.arc * D2R * 0.98, `the slash swept ${((hi - lo) / D2R).toFixed(0)}°, not the ${st.arc}° arc`);
}
// ---- Held: alternating swings; a bite stalls the blade ----
{
  const sw = new SwordSim(-1, () => V.swordRest);
  const dirs: number[] = [];
  let seen = 0, t = 0;
  while (t < 2.5) { sw.update(dt, true, st, V.swordComboAt); t += dt; if (sw.swings !== seen) { seen = sw.swings; dirs.push(sw.dir); } }
  must(dirs.length >= 3, `held for 2.5 s it swung only ${dirs.length} times`);
  must(dirs[0] === -1, "the right arm's first swing didn't start from its right");
  must(dirs.every((d, i) => i === 0 || d === -dirs[i - 1]), "held swings didn't alternate");
  const b = new SwordSim(1, () => V.swordRest);
  let n = 0;
  while (b.phase !== "slash" && n++ < 200) b.update(dt, true, st, V.swordComboAt);
  const a0 = b.angle;
  b.bite(0.05);
  for (let i = 0; i < 5; i++) b.update(dt, true, st, V.swordComboAt);
  must(Math.abs(b.angle - a0) < 1e-9, "the blade moved while stalled in a body");
}
// ---- Cuts: bodies in the arc and reach, once per swing, budget ----
{
  type T = { id: number; x: number; z: number; r: number; m: PenMaterial };
  const bodies: T[] = [];
  // A ring of bandits round the hand at 4 m (in front from −60° to +60°), one behind, one past the reach.
  for (let a = -60; a <= 60; a += 20) bodies.push({ id: bodies.length, x: Math.sin(a * D2R) * 4, z: Math.cos(a * D2R) * 4, r: 0.5, m: "flesh" });
  const behind = bodies.push({ id: bodies.length, x: 0, z: -4, r: 0.5, m: "flesh" }) - 1;
  const far = bodies.push({ id: bodies.length, x: 0, z: st.reach + 2, r: 0.5, m: "flesh" }) - 1;
  const sheetAt = (yaw: number): Sheet => ({ ox: 0, oz: 0, dx: Math.sin(yaw), dz: Math.cos(yaw), from: 0, len: st.reach, half: V.swordHalf, under: 0.6, top: () => V.swordHeight, ground: () => 0 });
  const swing = (budget: number, from: number, to: number) => {
    const seen = new Map<T, Set<number>>(), b = { left: budget }, cut: T[] = [];
    // The slash in steps of a frame's sweep, as the arsenal tests it.
    const steps = Math.ceil(st.slash / dt);
    for (let i = 0; i < steps; i++) {
      const a0 = from + ((to - from) * i) / steps, a1 = from + ((to - from) * (i + 1)) / steps;
      for (const a of sweepAngles({ from: a0, to: a1 })) {
        const s = sheetAt(a), hits: SheetHit<T>[] = [];
        for (const t of bodies) { const c = sheetCircle(s, t.x, t.z, t.r); if (c) hits.push({ target: t, key: 0, along: c.along, chord: c.chord, material: t.m, x: t.x, y: 1, z: t.z }); }
        for (const h of swordCuts(hits, seen, b, () => 0.45)) cut.push(h.target);
      }
    }
    return cut;
  };
  const half = (st.arc * D2R) / 2;
  const cut = swing(99, half, -half);
  must(cut.length === 7, `a full swing cut ${cut.length} bodies, not the 7 in its arc`);
  must(new Set(cut).size === cut.length, "a body was cut twice in one swing");
  must(!cut.some((t) => t.id === behind || t.id === far), "the swing cut a body behind it or out of reach");
  must(cut[0].x > 0, "a forehand from the left didn't cut the left-most body first");
  const short = swing(0.45 * 1.0 * 2.5, half, -half);
  must(short.length >= 1 && short.length < 7, `a small cleave budget still cut ${short.length} of 7`);
}
// ---- The item: in an arm's hand, a melee gun ----
{
  const lo = defaultLoadout();
  const sword = makeItem("sword-light");
  must(fitProblem(lo, "mountL", sword) !== null, "the sword fitted a hull mount");
  fit(lo, "mountL", makeItem("arm-rampart"));
  must(fitProblem(lo, "heldL", sword) === null, "the sword didn't fit an arm's hand");
  fit(lo, "heldL", sword);
  const g = resolve(lo).guns.left;
  must(g?.cls === "melee", "a held sword didn't resolve to a melee gun");
  must(!!g && Math.abs(g.range - V.swordReach) < 1e-6, "the sword's range isn't its reach");
  const pick = resolve(loadoutFor({ left: "sword", right: "minigun", k1: "none", k2: "none", k3: "pack" }));
  must(pick.guns.left?.cls === "melee" && pick.guns.right?.cls !== "melee", "?left=sword didn't put the sword in the left hand only");
}

if (problems.length) { console.error("sword-check FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
console.log("sword-check ok");
