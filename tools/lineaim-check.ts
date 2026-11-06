// Click-and-drag aim for the line weapons (src/weapons/lineAim.ts): the rules that must hold.
// - Hold and release (long) fires the default strip; AIs (not enabled) always do, even on a tap.
// - A tap arms; click, drag, let go fires a strip from the click along the drag; the left button is claimed meanwhile.
// - A double tap fires the default strip; a short drag runs away from the mech; armed too long disarms.
// - A left gun already firing when the key goes down keeps its button.
import { LineAim, LINE_AIM_DEFAULTS as V, type LineAimOut } from "../src/weapons/lineAim";

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log("FAIL", m); } };
const dt = 1 / 60;
type F = { key?: boolean; click?: boolean; cur?: { x: number; z: number } | null };
function run(a: LineAim, frames: F[], enabled = true): LineAimOut[] {
  return frames.map((f) => a.step(dt, { key: !!f.key, click: !!f.click, cursor: f.cur === undefined ? { x: 0, z: 20 } : f.cur, enabled }, V));
}
const n = (k: number, f: F) => Array.from({ length: k }, () => f);

// Long hold: paint, then fire on release.
{ const a = new LineAim(); const o = run(a, [...n(30, { key: true }), {}]); ok(o[0] === "paint" && o[30] === "fireDefault" && a.state === "idle", "hold and release fires the default"); }
// AI tap: fires at once (no arming).
{ const a = new LineAim(); const o = run(a, [...n(3, { key: true }), {}], false); ok(o[3] === "fireDefault", "an AI's tap fires"); }
// Tap arms; click, drag, release fires the drag.
{
  const a = new LineAim();
  const o = run(a, [...n(5, { key: true }), {}, {}]);
  ok(a.state === "armed" && o[6] === "paint" && a.claimsClick(), "a tap arms and claims the left button");
  const d = run(a, [{ click: true, cur: { x: 5, z: 30 } }, ...n(10, { click: true, cur: { x: 25, z: 30 } }), { cur: { x: 25, z: 30 } }]);
  ok(d[0] === "drag" && a.anchor.x === 5 && a.anchor.z === 30, "the press anchors the line where it clicked");
  ok(d[11] === "fireDrag" && a.state === "idle" && !a.claimsClick(), "letting go fires the drag");
  const s = a.strip({ x: 0, z: 0 }, { x: 25, z: 30 }, 40, 8, 8, 70, V.lineDragMin);
  ok(Math.abs(s.ax - 5) < 1e-6 && Math.abs(s.az - 30) < 1e-6 && Math.abs(s.bx - 45) < 1e-6 && Math.abs(s.bz - 30) < 1e-6, "the strip runs from the click along the drag, its length");
}
// Short drag: straight away from the mech.
{
  const a = new LineAim(); a.anchor = { x: 0, z: 20 };
  const s = a.strip({ x: 0, z: 0 }, { x: 0.5, z: 20.5 }, 30, 8, 8, 70, V.lineDragMin);
  ok(Math.abs(s.bx) < 1e-6 && Math.abs(s.bz - 50) < 1e-6, "a short drag runs away from the mech");
  a.anchor = { x: 0, z: 2 };
  const t = a.strip({ x: 0, z: 0 }, null, 30, 8, 8, 70, V.lineDragMin);
  ok(Math.abs(t.az - 8) < 1e-6, "an anchor too near the mech is pushed out to the nearest end");
}
// Double tap: fires the default; the key held after it doesn't paint again.
{
  const a = new LineAim();
  const o = run(a, [...n(4, { key: true }), {}, {}, ...n(20, { key: true }), {}]);
  ok(o[6] === "fireDefault" && o.slice(7, 26).every((x) => x === "none") && a.state === "idle", "a double tap fires the default once");
}
// Armed too long: disarms.
{
  const a = new LineAim();
  run(a, [...n(4, { key: true }), {}, ...n(Math.ceil(V.lineArmTime / dt) + 5, {})]);
  ok(a.state === "idle" && !a.claimsClick(), "armed and left alone, it disarms");
}
// A left gun already firing keeps its button while the key paints.
{
  const a = new LineAim();
  run(a, [{ click: true }, ...n(20, { click: true, key: true })]);
  ok(a.state === "held" && !a.claimsClick(), "a gun already firing keeps the left button");
  const o = run(a, [{ key: true }, { key: true, click: true }]);
  ok(o[1] === "drag" && a.claimsClick(), "a fresh press while the key is held starts a drag");
}

console.log(fails ? `lineaim-check: ${fails} failed` : "lineaim-check: ok");
if (fails) throw new Error("lineaim-check failed");
