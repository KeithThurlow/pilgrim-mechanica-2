// The posed keys' rules (src/weapons/swordPoses.ts, the pose lab): posing a key with its own values changes nothing
// anywhere in any move (hand, blade and spine through every clip, close and far, every sword's stance), so reading a
// key back and storing it is lossless; a moved hand and a turned blade land exactly on their key; a posed cut key
// still turns through the cut (its yaw is read back, not a straight blade); a sword without poses is untouched by
// another's; every committed pose names a real key.
// Run: npm test (or npx tsx tools/pose-check.ts).
import { SWORD_DEFAULTS, clipPose, clipLength, keyTime, type SwordStats, type SwordClip, type SwordPose } from "../src/weapons/sword";
import { SWORD_KEYS, SWORD_POSES, poseKey, setLivePose, setLivePoses, type KeyPose } from "../src/weapons/swordPoses";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const V = SWORD_DEFAULTS, ZERO = { x: 0, y: 0, z: 0 };
const base: SwordStats = { damage: V.swordDamage, ap: V.swordAp, reach: V.swordReach, arc: V.swordArc, windup: V.swordWindup, slash: V.swordSlash, recover: V.swordRecover, cleave: V.swordCleave };
const CLIPS: SwordClip[] = ["guard", "A", "B", "R", "S", "P", "K"];
const d3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const poseDiff = (a: SwordPose, b: SwordPose) => Math.max(d3(a.hand, b.hand), d3(a.fwd, b.fwd), d3(a.up, b.up));
/** Every clip sampled, at a reach. */
const samples = (st: SwordStats, span: number) => CLIPS.flatMap((c) => { const L = clipLength(c, st, V, span); return Array.from({ length: 41 }, (_, i) => clipPose(c, (L * i) / 40, 1, ZERO, 0, st, V, span)); });
/** The key as it reads at its time (the left arm's frame), the way the lab stores it. */
function readKey(name: string, clip: SwordClip, st: SwordStats, span: number): KeyPose | null {
  const t = keyTime(clip, name, st, V, span);
  if (t === null) return null;
  const p = clipPose(clip, t, 1, ZERO, 0, st, V, span);
  return { hand: [p.hand.x, p.hand.y - (name === "rest" ? V.swordGuardUp : 0), p.hand.z], fwd: [p.fwd.x, p.fwd.y, p.fwd.z], up: [p.up.x, p.up.y, p.up.z], pole: [p.pole.x, p.pole.y, p.pole.z] };
}

// ---- Posing every key with its own values: nothing moves ----
let posed = 0, worst = 0;
for (const stance of [0, 1, 2, 3]) {
  const st: SwordStats = { ...base, stance, pose: "check" };
  for (const span of [0, 1]) {
    setLivePoses({});
    const before = samples(st, span);
    // Read every key first, then pose them all (a posed rest drops the coded last key before it unless that's posed too).
    const read = SWORD_KEYS.map((k) => [k, readKey(k.name, k.clip, st, span)] as const);
    for (const [k, p] of read) {
      if (!p) continue;
      setLivePose("check", poseKey(k.name, k.span && span < 0.5), p);
      posed++;
    }
    const after = samples(st, span);
    for (let i = 0; i < before.length; i++) worst = Math.max(worst, poseDiff(before[i], after[i]));
  }
}
must(worst < 2e-3, `posing every key with its own values moved a pose by ${worst.toFixed(4)}`);
console.log(`  ${posed} keys read back and posed as they stood: largest change anywhere ${worst.toExponential(1)}`);

// ---- A moved hand and a turned blade land on their key; the cut still turns ----
{
  const st: SwordStats = { ...base, stance: 1, pose: "check" };
  setLivePoses({});
  const k = readKey("aMid", "A", st, 1)!;
  const tilt = 20 * Math.PI / 180, f = k.fwd!;
  // Pitch the blade 20° down, keep it square to the spine's lift.
  const fwd: [number, number, number] = [f[0] * Math.cos(tilt), f[1] * Math.cos(tilt) - Math.sin(tilt), f[2] * Math.cos(tilt)];
  const l = Math.hypot(...fwd); fwd[0] /= l; fwd[1] /= l; fwd[2] /= l;
  setLivePose("check", "aMid", { ...k, hand: [k.hand![0], k.hand![1] + 0.3, k.hand![2]], fwd });
  const t = keyTime("A", "aMid", st, V, 1)!, p = clipPose("A", t, 1, ZERO, 0, st, V, 1);
  must(Math.abs(p.hand.y - (k.hand![1] + 0.3)) < 1e-3, `a hand moved 0.3 m up landed at ${(p.hand.y - k.hand![1]).toFixed(3)}`);
  must(d3(p.fwd, { x: fwd[0], y: fwd[1], z: fwd[2] }) < 1e-3, "a turned blade didn't land on its key");
  // The cut still sweeps: halfway from its start to its middle the blade's yaw is between theirs (not cut straight).
  const t0 = keyTime("A", "aStart", st, V, 1)!, a = clipPose("A", t0, 1, ZERO, 0, st, V, 1), m = clipPose("A", (t0 + t) / 2, 1, ZERO, 0, st, V, 1);
  const yaw = (q: SwordPose) => Math.atan2(q.fwd.x, q.fwd.z), lo = Math.min(yaw(a), yaw(p)), hi = Math.max(yaw(a), yaw(p));
  must(yaw(m) > lo - 1e-3 && yaw(m) < hi + 1e-3 && Math.hypot(m.fwd.x, m.fwd.z) > 0.5, "a posed cut key no longer turns the blade through the cut");
  // Another sword is untouched.
  const other = { ...st, pose: "other" };
  const pt = clipPose("A", t, 1, ZERO, 0, other, V, 1);
  must(Math.abs(pt.hand.y - k.hand![1]) < 1e-6, "posing one sword moved another");
  console.log(`  aMid posed: hand +0.30 m → +${(p.hand.y - k.hand![1]).toFixed(3)}, blade pitched 20° lands; the cut still turns`);
}
setLivePoses({});

// ---- Committed poses name real keys ----
const names = new Set(SWORD_KEYS.flatMap((k) => [k.name, ...(k.span ? [poseKey(k.name, true)] : [])]));
for (const [id, set] of Object.entries(SWORD_POSES)) for (const k of Object.keys(set)) must(names.has(k), `${id}: "${k}" is not a posable key`);

if (problems.length) { console.error("pose-check FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
console.log("pose-check ok");
