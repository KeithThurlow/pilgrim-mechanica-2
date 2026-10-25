// Soft lock rules: the enemy under the cursor ray wins (a tall walker also by the sand among its feet); else the one
// nearest the line of fire; never behind, out of range or far off the line. And the guns reach a tall one's body.
import { Targeting, TARGET_DEFAULTS, type TargetCandidate } from "../src/game/targeting";
import { UpperSim, UPPER_DEFAULTS } from "../src/mech/upper";

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log("FAIL", what); } };
const v = { ...TARGET_DEFAULTS, lockSticky: 0 };
const from = { x: 0, y: 0, z: 0 };
// Camera high behind and above the mech, looking down 50° toward +z.
const cam = { x: 0, y: 30, z: -26 };
function q(cx: number, cz: number) {
  const dx = cx - cam.x, dy = 0 - cam.y, dz = cz - cam.z, l = Math.hypot(dx, dy, dz);
  return { rayO: cam, rayD: { x: dx / l, y: dy / l, z: dz / l }, from, cursor: { x: cx, y: 0, z: cz }, range: 60 };
}
const c = (x: number, y: number, z: number, r: number, key: string): TargetCandidate => ({ x, y, z, r, key });

{ // Under the cursor beats nearer the line.
  const t = new Targeting();
  const l = t.pick([c(0.3, 1, 15, 0.6, "onLine"), c(4, 1, 30, 0.6, "atCursor")], q(4, 30), v);
  ok(l?.target.key === "atCursor" && l.how === "cursor", "enemy under the cursor wins");
}
{ // A tall walker: cursor on the ground just short of its feet still lines up with its high body along the camera ray.
  const t = new Targeting();
  // The camera ray to (0, 0, 20) passes y = 10 at z = 20 - 10 * 46/30.
  const zBody = 20 - (10 * 46) / 30;
  const l = t.pick([c(0, 10, zBody, 1.5, "tall")], q(0, 20), v);
  ok(l?.target.key === "tall" && l.how === "cursor", "tall walker taken by its body on the cursor ray");
}
{ // Line of fire: nearest the line, not nearest the mech.
  const t = new Targeting();
  const l = t.pick([c(2.5, 1, 10, 0.6, "near"), c(0.4, 1, 40, 0.6, "onLine")], q(0, 25), v);
  ok(l?.target.key === "onLine" && l.how === "line", "nearest the line wins");
}
{ // Never behind, never out of range, never far off the line.
  const t = new Targeting();
  ok(t.pick([c(0, 1, -10, 0.6, "behind")], q(0, 20), v) === null, "nothing behind the mech");
  ok(t.pick([c(0, 1, 80, 0.6, "far")], q(0, 20), v) === null, "nothing out of range");
  ok(t.pick([c(15, 1, 20, 0.6, "wide")], q(0, 20), v) === null, "nothing far off the line");
  ok(t.pick([c(0, 1, 20, 0.6, "x")], q(0, 20), { ...v, autoLock: 0 }) === null, "off means off");
}
{ // Sticky: the last target is kept against a slightly better one.
  const t = new Targeting();
  const sv = { ...v, lockSticky: 0.6 };
  t.pick([c(0.5, 1, 30, 0.6, "a")], q(0, 30), sv);
  const l = t.pick([c(1.5, 1, 30, 0.6, "a"), c(1.2, 1, 30, 0.6, "b")], q(0, 50), sv);
  ok(l?.target.key === "a", "keeps the last target against a slightly better one");
}
{ // A tall walker's footprint: the cursor on the sand among its feet locks its body, not nothing (Keith 2026-10-26).
  const t = new Targeting();
  const big = { ...c(3, 10.5, 30, 2, "excavator"), foot: 8 };
  const l = t.pick([big], q(9, 34), v);
  ok(l?.target.key === "excavator" && l.target.y === 10.5, "cursor among a tall walker's feet locks its body");
  // A small one right under the cursor among those feet still wins.
  const l2 = t.pick([big, c(9, 0.5, 34, 0.5, "small")], q(9, 34), v);
  ok(l2?.target.key === "small", "a small one under the cursor beats the big one whose feet it's among");
}
{ // Guns that reach up: a big one's chassis 10.5 m up, 7 m away, from the Rampart's shoulders about 4.2 m up. The
  // guns raise (plus the torso's lean), come on target and fire; with the old 20° limit they couldn't.
  const run = (vals: typeof UPPER_DEFAULTS) => {
    const up = new UpperSim(vals);
    up.reset(0);
    let fired = 0, on = 0;
    for (let i = 0; i < 240; i++) {
      fired += up.update(1 / 120, 0, { x: 0, y: 4.2, z: 0 }, { x: 0.5, y: 10.5, z: 7 }, true).length;
      if (up.onTarget) on++;
    }
    return { fired, on, lean: up.lean, pitch: Math.min(up.guns[0].pitch, up.guns[1].pitch) };
  };
  const now = run({ ...UPPER_DEFAULTS }), old = run({ ...UPPER_DEFAULTS, podPitchUp: 20, torsoLeanMax: 0 });
  console.log(`reach up: chassis 7 m off, 6.3 m over the shoulders: ${now.fired} rounds, gun raised ${(-now.pitch * 180 / Math.PI).toFixed(0)}° + lean ${(now.lean * 180 / Math.PI).toFixed(0)}° (at 20° and no lean: ${old.fired} rounds)`);
  ok(now.fired > 20, "a tall robot's chassis is reachable from 7 m");
  ok(old.fired === 0, "a target past the raise limit isn't fired on");
}
console.log(fails ? `targeting-check: ${fails} failed` : "targeting-check: ok");
if (fails) throw new Error("targeting check failed");
