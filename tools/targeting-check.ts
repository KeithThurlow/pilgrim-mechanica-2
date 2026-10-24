// Soft lock rules: the enemy under the cursor ray wins; else the one nearest the line of fire; never behind the
// mech, never out of range, never something far off the line.
import { Targeting, TARGET_DEFAULTS, type TargetCandidate } from "../src/game/targeting";

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
console.log(fails ? `targeting-check: ${fails} failed` : "targeting-check: ok");
if (fails) throw new Error("targeting check failed");
