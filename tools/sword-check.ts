// The sword's rules (src/weapons/sword.ts): a click cuts once (rest, cut, then back to rest past the waist), the cut
// lasts its time and turns the blade through the whole arc from outboard across; clicked again it cuts back the
// other way, and on (A, B, A); a bite stalls the blade; the hand stays in the arm's reach and the blade stays clear of
// the Rampart's torso and pelvis in every move; the edge leads each cut; at rest the blade points back and up over the
// shoulder; the arm's bones keep their lengths; the blade's sheets cut every body in the arc and reach once per cut
// (none behind or out of reach), nearest first, until the cleave budget is spent; the item fits an arm's hand and
// resolves to a melee gun with the reach as its range.
// Run: npm test (or npx tsx tools/sword-check.ts).
import { SwordSim, SWORD_DEFAULTS, swordCuts, clipPose, armIk, moveWarp, twistTarget, springStep, clipLength, clipCut, lungeIntent, type SwordStats, type SwordClip } from "../src/weapons/sword";
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
  const win = clipCut("A", st, V, 1)!;
  must(Math.abs(cutT - (win[1] - win[0])) < 2 * dt, `the cut lasted ${cutT.toFixed(3)} s, not ${(win[1] - win[0]).toFixed(3)}`);
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
  for (const span of [0, 0.5, 1])
  for (const side of [1, -1] as const) {
    const lens = Object.fromEntries((["A", "B", "R", "S", "P", "guard"] as SwordClip[]).map((c) => [c, clipLength(c, st, V, span)])) as Record<SwordClip, number>;
    const sh = SH(side);
    for (const c of ["guard", "A", "B", "R", "S", "P"] as SwordClip[]) {
      let worst = 0, clash = "", lead = 0, lag = 0;
      let prevTip: number[] | null = null;
      for (let i = 0; i <= 60; i++) {
        const p = clipPose(c, (lens[c] * i) / 60, side, sh, 0, st, V, span);
        worst = Math.max(worst, Math.hypot(p.hand.x - sh.x, p.hand.y - sh.y, p.hand.z - sh.z));
        for (let a = 0; a <= st.reach && !clash; a += 0.2) {
          const q = [p.hand.x + p.fwd.x * a, p.hand.y + p.fwd.y * a, p.hand.z + p.fwd.z * a];
          for (const b of BOXES) if (q.every((x, k) => x > b.lo[k] && x < b.hi[k])) clash = `${b.n} at ${(i / 60).toFixed(2)} of ${c}, ${a.toFixed(1)} m along the blade`;
        }
        const tip = [p.fwd.x, p.fwd.z];
        const tt = (lens[c] * i) / 60, cw = clipCut(c, st, V, span);
        if (prevTip && cw && tt > cw[0] && tt <= cw[1]) {
          const mx = tip[0] - prevTip[0], mz = tip[1] - prevTip[1];
          if (Math.hypot(mx, mz) > 0.05) { if (p.up.x * mx + p.up.z * mz < 0) lead++; else lag++; }
        }
        prevTip = tip;
      }
      must(worst <= V.swordUpperArm + V.swordForearm, `span ${span} side ${side} ${c}: the hand went ${worst.toFixed(2)} m from the shoulder, past the arm's reach`);
      must(!clash, `span ${span} side ${side}: the blade went through the ${clash}`);
      if (c === "A" || c === "B") must(lead > lag * 3, `span ${span} side ${side} ${c}: the edge didn't lead the cut (${lead} leading, ${lag} trailing)`);
    }
    const rest = clipPose("guard", 0, side, sh, 0, st, V);
    must(rest.fwd.z < -0.8 && rest.fwd.y > 0.25 && Math.abs(rest.fwd.x) < 0.2, `side ${side}: at rest the blade doesn't lie back over the shoulder, in line with the torso`);
    const re = armIk(sh, rest.hand, V.swordUpperArm, V.swordForearm, rest.pole);
    // Keith's rest triangle: the elbow low but forward, near a right angle there, the fist up ahead of it.
    const ua = [re.elbow.x - sh.x, re.elbow.y - sh.y, re.elbow.z - sh.z], fa = [re.hand.x - re.elbow.x, re.hand.y - re.elbow.y, re.hand.z - re.elbow.z];
    const bend = Math.acos(-(ua[0] * fa[0] + ua[1] * fa[1] + ua[2] * fa[2]) / (Math.hypot(...ua) * Math.hypot(...fa))) / D2R;
    must(ua[1] < -0.6 && ua[2] > 0.5, `side ${side}: at rest the elbow isn't low and forward (${ua.map((q) => q.toFixed(2)).join(",")})`);
    must(fa[1] > 0.6, `side ${side}: at rest the forearm doesn't angle up to the fist`);
    must(bend > 70 && bend < 110, `side ${side}: at rest the elbow is bent to ${bend.toFixed(0)}°, not near a right angle`);
    const under = clipPose("A", lens.A, side, sh, 0, st, V, span);
    must((under.hand.x - sh.x) * side < -0.8 && under.hand.y < sh.y, `side ${side}: the first cut doesn't finish low on the far side`);
    const cA = clipCut("A", st, V, span)!;
    const mid = clipPose("A", (cA[0] + cA[1]) / 2, side, sh, 0, st, V, span);
    const ik = armIk(sh, mid.hand, V.swordUpperArm, V.swordForearm, mid.pole);
    const a = Math.hypot(ik.elbow.x - sh.x, ik.elbow.y - sh.y, ik.elbow.z - sh.z), b = Math.hypot(ik.hand.x - ik.elbow.x, ik.hand.y - ik.elbow.y, ik.hand.z - ik.elbow.z);
    must(Math.abs(a - V.swordUpperArm) < 1e-6 && Math.abs(b - V.swordForearm) < 1e-6, "the arm's bones stretched");
  }
}
// ---- Weight: each move eases out of a stop and into one, fastest mid-cut, never backwards ----
{
  const cut: [number, number] = [0.38, 0.62], d = 1e-4;
  const speed = (x: number) => (moveWarp(x + d, cut, V.swordEaseIn, V.swordEaseOut, V.swordSnap) - moveWarp(x - d, cut, V.swordEaseIn, V.swordEaseOut, V.swordSnap)) / (2 * d);
  must(speed(0.002) < 0.05 && speed(0.998) < 0.05, `a move doesn't start and end at a stop (${speed(0.002).toFixed(2)}, ${speed(0.998).toFixed(2)})`);
  must(speed(0.5) > speed(0.38) && speed(0.38) > speed(0.2), "the swing doesn't build to its fastest mid-cut");
  must(Math.abs(moveWarp(0.38, cut, V.swordEaseIn, V.swordEaseOut, V.swordSnap) - 0.38) < 1e-9 && Math.abs(moveWarp(0.62, cut, V.swordEaseIn, V.swordEaseOut, V.swordSnap) - 0.62) < 1e-9, "the warp moved the cut's ends");
  let back = false, prev = 0;
  for (let i = 1; i <= 1000; i++) { const w = moveWarp(i / 1000, cut, V.swordEaseIn, V.swordEaseOut, V.swordSnap); if (w < prev - 1e-9) back = true; prev = w; }
  must(!back, "the swing ran backwards in time somewhere");
}
// ---- Close or far: a close cut is quicker and shorter, the elbow bent and the hand in close the whole way ----
{
  const sh = SH(1), near = clipCut("A", st, V, 0)!, far = clipCut("A", st, V, 1)!;
  must(near[1] - near[0] < (far[1] - far[0]) * 0.7 && clipLength("A", st, V, 0) < clipLength("A", st, V, 1) * 0.7, "a close cut isn't much quicker than the full sweep");
  for (const c of ["A", "B"] as SwordClip[]) {
    const cw = clipCut(c, st, V, 0)!;
    let most = 0, straightest = 0, yaw0 = 0, yaw1 = 0;
    for (let i = 0; i <= 20; i++) {
      const p = clipPose(c, cw[0] + ((cw[1] - cw[0]) * i) / 20, 1, sh, 0, st, V, 0);
      const e = armIk(sh, p.hand, V.swordUpperArm, V.swordForearm, p.pole);
      const ua = [e.elbow.x - sh.x, e.elbow.y - sh.y, e.elbow.z - sh.z], fa = [e.hand.x - e.elbow.x, e.hand.y - e.elbow.y, e.hand.z - e.elbow.z];
      straightest = Math.max(straightest, 180 - Math.acos((ua[0] * fa[0] + ua[1] * fa[1] + ua[2] * fa[2]) / (Math.hypot(...ua) * Math.hypot(...fa))) / D2R);
      most = Math.max(most, Math.hypot(p.hand.x - sh.x, p.hand.y - sh.y, p.hand.z - sh.z));
      const y = Math.atan2(p.fwd.x, p.fwd.z); if (i === 0) yaw0 = y; if (i === 20) yaw1 = y;
    }
    must(straightest < 120 && most < 2.3, `close ${c}: the arm straightened to ${straightest.toFixed(0)}° (hand ${most.toFixed(2)} m out), not kept bent in close`);
    must(Math.abs(yaw0 - yaw1) / D2R < st.arc * 0.6, `close ${c}: the blade turned ${(Math.abs(yaw0 - yaw1) / D2R).toFixed(0)}°, not a short cut`);
  }
}
// ---- The draw cut (Keith 2026-11-01, round 9): close, the blade lies across the front and is pulled along its length,
// turning only at the end; the blade sweeps much less ground than the full cut ----
{
  const sh = SH(1);
  const swept = (c: SwordClip, span: number) => {
    // Ground the blade's line covers through the cut: cells of 0.25 m touched by the hand-to-tip line, hull frame.
    const cw = clipCut(c, st, V, span)!, cells = new Set<string>();
    for (let i = 0; i <= 200; i++) {
      const p = clipPose(c, cw[0] + ((cw[1] - cw[0]) * i) / 200, 1, sh, 0, st, V, span), l = Math.hypot(p.fwd.x, p.fwd.z) || 1;
      for (let a = 0; a <= st.reach; a += 0.1) cells.add(`${Math.round((p.hand.x + (p.fwd.x / l) * a) * 4)},${Math.round((p.hand.z + (p.fwd.z / l) * a) * 4)}`);
    }
    return cells.size / 16;
  };
  for (const c of ["A", "B"] as SwordClip[]) {
    const cw = clipCut(c, st, V, 0)!, at = (u: number) => clipPose(c, cw[0] + (cw[1] - cw[0]) * u, 1, sh, 0, st, V, 0);
    const p0 = at(0), p1 = at(0.6), p2 = at(1);
    const yaw = (p: { fwd: { x: number; z: number } }) => Math.atan2(p.fwd.x, p.fwd.z) / D2R;
    const pulled = Math.hypot(p1.hand.x - p0.hand.x, p1.hand.z - p0.hand.z), turned = Math.abs(yaw(p1) - yaw(p0)), flick = Math.abs(yaw(p2) - yaw(p1));
    const across = Math.min(Math.abs(yaw(p0)), Math.abs(yaw(p1)));
    // The hand's way along the blade: the pull runs along the blade's own line, not square across it.
    const mx = p1.hand.x - p0.hand.x, mz = p1.hand.z - p0.hand.z, l0 = Math.hypot(p0.fwd.x, p0.fwd.z);
    const along = Math.abs((mx * p0.fwd.x + mz * p0.fwd.z) / (l0 * Math.hypot(mx, mz)));
    const near = swept(c, 0), far = swept(c, 1);
    console.log(`  draw ${c}: pulled ${pulled.toFixed(2)} m, blade turned ${turned.toFixed(0)}° in the draw, ${flick.toFixed(0)}° flick, across ${across.toFixed(0)}° off the aim, pull along the blade ${(along * 100).toFixed(0)}%, ground swept ${near.toFixed(1)} m² (full ${far.toFixed(1)})`);
    must(pulled > 1.2 && turned < 20, `close ${c}: not a draw (hand pulled ${pulled.toFixed(2)} m, blade turned ${turned.toFixed(0)}°)`);
    must(across > 45, `close ${c}: the blade isn't across the front (${across.toFixed(0)}° off the aim)`);
    must(along > 0.6, `close ${c}: the hand doesn't pull along the blade (${(along * 100).toFixed(0)}%)`);
    must(flick > 25, `close ${c}: no flick at the end (${flick.toFixed(0)}°)`);
    must(near < far * 0.5, `close ${c}: the draw sweeps ${near.toFixed(1)} m², not much less than the full cut's ${far.toFixed(1)}`);
  }
}
// ---- The lunge and the legs (Keith 2026-11-01, round 9): smooth, full still or walking in, none or back backing off ----
{
  const at = (mx: number, mz: number) => lungeIntent({ x: mx, z: mz }, 0, 1, V);
  must(lungeIntent(undefined, 0, 1, V) === V.swordLungeStill && at(0, 0) === V.swordLungeStill, "standing still doesn't take the still lunge");
  must(Math.abs(at(0, 1) - V.swordLungeToward) < 1e-9 && Math.abs(at(1, 0) - V.swordLungeSide) < 1e-9 && Math.abs(at(0, -1) - V.swordLungeAway) < 1e-9, "the lunge's ways are off");
  let jump = 0, prev = at(Math.sin(0), Math.cos(0));
  for (let i = 1; i <= 360; i++) { const a = i * D2R, q = at(Math.sin(a), Math.cos(a)); jump = Math.max(jump, Math.abs(q - prev)); prev = q; }
  let pj = 0, pp = at(0, 0);
  for (let i = 1; i <= 100; i++) { const q = at(0, -i / 100); pj = Math.max(pj, Math.abs(q - pp)); pp = q; }
  must(jump < 0.02 && pj < 0.05, `the lunge snaps with the walk's way (${jump.toFixed(3)} a degree, ${pj.toFixed(3)} a 1% push)`);
  must(at(0.7, -0.7) > 0 && at(0.7, -0.7) < V.swordLungeSide, "backing off with a side click doesn't keep a partial lunge");
}
// ---- The block (Keith 2026-11-01): a free sword swings up and blocks; one mid-cut can't; it goes back to rest ----
{
  const sw = new SwordSim(1);
  sw.update(dt, false, st, V);
  must(sw.free && sw.block(V) && sw.clip === "P" && sw.blocking, "a sword at rest didn't block");
  for (let i = 0; i < 20; i++) sw.update(dt, false, st, V);
  must(sw.block(V) && sw.clip === "P", "a block that's up didn't block again");
  let n = 0; while (sw.clip !== "guard" && n++ < 600) sw.update(dt, false, st, V);
  must(sw.clip === "guard" && Math.abs(n * dt - (V.swordBlockTime - 20 * dt)) < 0.05, `the block didn't go back to rest after its time (${(n * dt).toFixed(2)} s)`);
  sw.update(dt, true, st, V);
  for (let i = 0; i < 30; i++) sw.update(dt, true, st, V);
  must(sw.clip === "A" && !sw.free && !sw.block(V) && sw.clip === "A", "a sword mid-cut blocked");
  const up = clipPose("P", V.swordBlockTime * 0.45, 1, SH(1), 0, st, V);
  must(up.fwd.y > 0.7 && up.hand.z > 1.4, `the block doesn't stand the blade up ahead of the chest (${up.fwd.y.toFixed(2)} up, hand ${up.hand.z.toFixed(2)} ahead)`);
}
// ---- The waist: coils back in the drive, turns after the blade, swings on past and settles ----
{
  const wA = st.windup, sA = st.slash;
  must(twistTarget("A", wA * 0.9, st, V) > 0, "the waist doesn't coil back in the drive");
  must(Math.abs(twistTarget("A", wA + sA + V.swordFollow, st, V) + 1) < 1e-6, "the waist doesn't end the first cut turned to the far side");
  must(twistTarget("B", 9, st, V) > 0, "the back-cut doesn't bring the waist back to its own side");
  must(Math.abs(twistTarget("R", 9, st, V)) < 1e-6 && twistTarget("guard", 0, st, V) === 0, "the waist doesn't settle at rest");
  // A step to the far side: the spring overshoots (weight carrying on), then settles, and never blows up at 30 fps.
  let x = 0, vel = 0, peak = 0;
  for (let i = 0; i < 240; i++) { [x, vel] = springStep(x, vel, -1, V.swordTwistHz, V.swordTwistDamp, 1 / 120); peak = Math.min(peak, x); }
  must(peak < -1.02 && Math.abs(x + 1) < 0.02, `the waist spring doesn't swing on past and settle (peak ${peak.toFixed(2)}, end ${x.toFixed(2)})`);
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
