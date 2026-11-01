// The sword's rules (src/weapons/sword.ts): a click cuts once (rest, cut, then back to rest past the waist), the cut
// lasts its time and turns the blade through the whole arc from outboard across; clicked again it cuts back the
// other way, and on (A, B, A); a bite stalls the blade; the hand stays in the arm's reach and the blade stays clear of
// the Rampart's torso and pelvis in every move; the edge leads each cut; at rest the blade points back and up over the
// shoulder; the arm's bones keep their lengths; the blade's sheets cut every body in the arc and reach once per cut
// (none behind or out of reach), nearest first, until the cleave budget is spent; the item fits an arm's hand and
// resolves to a melee gun with the reach as its range.
// Run: npm test (or npx tsx tools/sword-check.ts).
import { SwordSim, SWORD_DEFAULTS, swordCuts, clipPose, armIk, moveWarp, type SwordStats, type SwordClip } from "../src/weapons/sword";
import { sheetCircle, type PenMaterial, type Sheet, type SheetHit } from "../src/game/sheet";
import { defaultLoadout, fit, fitProblem, resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";
import { loadoutFor } from "../src/items/weaponPick";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const V = SWORD_DEFAULTS, D2R = Math.PI / 180, dt = 1 / 120;
const st: SwordStats = { damage: V.swordDamage, ap: V.swordAp, reach: V.swordReach, arc: V.swordArc, windup: V.swordWindup, slash: V.swordSlash, recover: V.swordRecover, cleave: V.swordCleave };
// The Rampart's shoulders and its torso and pelvis boxes in the hull's frame (from public/models/rampart.glb).
// A sword arm's shoulder sits swordShoulderOut further out.
const SH = (side: 1 | -1) => ({ x: side * (1.02 + V.swordShoulderOut), y: 0.89, z: 0 });
const BOXES = [{ n: "torso", lo: [-1.2, -0.33, -1.27], hi: [1.2, 2.3, 1.37] }, { n: "pelvis", lo: [-0.68, -1.25, -0.4], hi: [0.68, 0.24, 0.62] }];

// ---- A click: one cut, back to rest ----
{
  const sw = new SwordSim(1);
  let t = 0, cutT = 0, first: number | null = null, last = 0, pressed = true;
  const clips: SwordClip[] = [];
  while (t < 2) {
    const sweep = sw.update(dt, pressed, st, V);
    pressed = false; t += dt;
    if (clips[clips.length - 1] !== sw.clip) clips.push(sw.clip);
    if (sweep) {
      cutT += sweep.to - sweep.from;
      const a = clipPose(sweep.clip, sweep.from, 1, SH(1), 0, st, V), b = clipPose(sweep.clip, sweep.to, 1, SH(1), 0, st, V);
      first ??= Math.atan2(a.fwd.x, a.fwd.z); last = Math.atan2(b.fwd.x, b.fwd.z);
    }
  }
  must(sw.swings === 1, `a click cut ${sw.swings} times`);
  must(clips.join(",") === "A,R,guard", `a click went through ${clips.join(",")}, not A,R,guard`);
  must(Math.abs(cutT - st.slash) < 2 * dt, `the cut lasted ${cutT.toFixed(3)} s, not ${st.slash}`);
  must(first !== null && first > 0 && last < 0, "the left arm's first cut didn't run from its left across to its right");
  must(first !== null && (first - last) >= st.arc * D2R * 0.9, `the cut turned ${first !== null ? ((first - last) / D2R).toFixed(0) : "?"}°, not the ${st.arc}° arc`);
}
// ---- Clicked again: back-cut, and on; a bite stalls the blade ----
{
  const sw = new SwordSim(-1);
  const order: SwordClip[] = [];
  let t = 0, seen = 0;
  while (t < 2.5) { sw.update(dt, true, st, V); t += dt; if (sw.swings !== seen) { seen = sw.swings; order.push(sw.clip); } }
  must(order.length >= 4, `held for 2.5 s it cut only ${order.length} times`);
  must(order.every((c, i) => c === (i % 2 === 0 ? "A" : "B")), `held cuts didn't alternate cut and back-cut: ${order.join(",")}`);
  const b = new SwordSim(1);
  let n = 0;
  while (!b.cutting && n++ < 200) b.update(dt, true, st, V);
  const t0 = b.t;
  b.bite(0.05);
  for (let i = 0; i < 5; i++) b.update(dt, true, st, V);
  must(Math.abs(b.t - t0) < 1e-9, "the blade moved while stalled in a body");
}
// ---- Poses: in reach, clear of the hull, edge leading, rest over the shoulder ----
{
  const lens: Record<SwordClip, number> = { A: st.windup + st.slash + V.swordFollow, B: st.windup * 0.45 + st.slash + V.swordFollow * 0.8, R: st.recover * 1.6, S: st.recover, guard: 1 };
  for (const side of [1, -1] as const) {
    const sh = SH(side);
    for (const c of ["guard", "A", "B", "R", "S"] as SwordClip[]) {
      let worst = 0, clash = "", lead = 0, lag = 0;
      let prevTip: number[] | null = null;
      for (let i = 0; i <= 60; i++) {
        const p = clipPose(c, (lens[c] * i) / 60, side, sh, 0, st, V);
        worst = Math.max(worst, Math.hypot(p.hand.x - sh.x, p.hand.y - sh.y, p.hand.z - sh.z));
        for (let a = 0; a <= st.reach && !clash; a += 0.2) {
          const q = [p.hand.x + p.fwd.x * a, p.hand.y + p.fwd.y * a, p.hand.z + p.fwd.z * a];
          for (const b of BOXES) if (q.every((x, k) => x > b.lo[k] && x < b.hi[k])) clash = `${b.n} at ${(i / 60).toFixed(2)} of ${c}, ${a.toFixed(1)} m along the blade`;
        }
        const tip = [p.fwd.x, p.fwd.z];
        const tt = (lens[c] * i) / 60, w0 = c === "A" ? st.windup : st.windup * 0.45;
        if (prevTip && (c === "A" || c === "B") && tt > w0 && tt <= w0 + st.slash) {
          const mx = tip[0] - prevTip[0], mz = tip[1] - prevTip[1];
          if (Math.hypot(mx, mz) > 0.05) { if (p.up.x * mx + p.up.z * mz < 0) lead++; else lag++; }
        }
        prevTip = tip;
      }
      must(worst <= V.swordUpperArm + V.swordForearm, `side ${side} ${c}: the hand went ${worst.toFixed(2)} m from the shoulder, past the arm's reach`);
      must(!clash, `side ${side}: the blade went through the ${clash}`);
      if (c === "A" || c === "B") must(lead > lag * 3, `side ${side} ${c}: the edge didn't lead the cut (${lead} leading, ${lag} trailing)`);
    }
    const rest = clipPose("guard", 0, side, sh, 0, st, V);
    must(rest.fwd.z < -0.8 && rest.fwd.y > 0.25 && Math.abs(rest.fwd.x) < 0.2, `side ${side}: at rest the blade doesn't lie back over the shoulder, in line with the torso`);
    const re = armIk(sh, rest.hand, V.swordUpperArm, V.swordForearm, rest.pole);
    must(re.elbow.z - sh.z > 1, `side ${side}: at rest the elbow is only ${(re.elbow.z - sh.z).toFixed(2)} m ahead of the shoulder, not pointing forward`);
    const under = clipPose("A", lens.A, side, sh, 0, st, V);
    must(under.hand.x * side < 0 && under.hand.y < sh.y, `side ${side}: the first cut doesn't finish low on the far side`);
    const mid = clipPose("A", st.windup + st.slash / 2, side, sh, 0, st, V);
    const ik = armIk(sh, mid.hand, V.swordUpperArm, V.swordForearm, mid.pole);
    const a = Math.hypot(ik.elbow.x - sh.x, ik.elbow.y - sh.y, ik.elbow.z - sh.z), b = Math.hypot(ik.hand.x - ik.elbow.x, ik.hand.y - ik.elbow.y, ik.hand.z - ik.elbow.z);
    must(Math.abs(a - V.swordUpperArm) < 1e-6 && Math.abs(b - V.swordForearm) < 1e-6, "the arm's bones stretched");
  }
}
// ---- Weight: each move eases out of a stop and into one, fastest mid-cut, never backwards ----
{
  const cut: [number, number] = [0.38, 0.62], d = 1e-4;
  const speed = (x: number) => (moveWarp(x + d, cut, V.swordEase, V.swordSnap) - moveWarp(x - d, cut, V.swordEase, V.swordSnap)) / (2 * d);
  must(speed(0.002) < 0.05 && speed(0.998) < 0.05, `a move doesn't start and end at a stop (${speed(0.002).toFixed(2)}, ${speed(0.998).toFixed(2)})`);
  must(speed(0.5) > speed(0.38) && speed(0.38) > speed(0.2), "the swing doesn't build to its fastest mid-cut");
  must(Math.abs(moveWarp(0.38, cut, V.swordEase, V.swordSnap) - 0.38) < 1e-9 && Math.abs(moveWarp(0.62, cut, V.swordEase, V.swordSnap) - 0.62) < 1e-9, "the warp moved the cut's ends");
  let back = false, prev = 0;
  for (let i = 1; i <= 1000; i++) { const w = moveWarp(i / 1000, cut, V.swordEase, V.swordSnap); if (w < prev - 1e-9) back = true; prev = w; }
  must(!back, "the swing ran backwards in time somewhere");
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
      for (const a of [a0 + (a1 - a0) / 2, a1]) {
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
