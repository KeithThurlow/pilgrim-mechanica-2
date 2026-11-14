// Drawing a model between ticks (src/look/treeInterp.ts; docs/architecture-review.md stage 6b). A small tree of parts
// moved and turned each tick: apply(alpha) poses every part between its last two ticks (position, scale lerped,
// rotation the short way and unit length), restore() puts the tick's pose back exactly, alpha 1 changes nothing, the
// first tick holds still, snap() drops the last pose, and a changed tree starts over. A part posed outside the tick
// (in a drawn frame) is left alone by apply and restore. The app's list (stage 6c): models on drawBetweenTicks are
// captured while in a scene, dropped when removed, back when added again. Swarms (stage 6d, SlotInterp): slot arrays
// blended in place and put back exactly, angles the short way, a slot whose key changed or a value that jumped not
// blended, strided arrays (feet). Run: npm test.
import * as THREE from "three/webgpu";
import { TreeInterp, InterpSet, drawBetweenTicks, SlotInterp } from "../src/look/treeInterp";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };
const near = (a: number, b: number, e = 1e-5) => Math.abs(a - b) < e;

const root = new THREE.Group(), arm = new THREE.Object3D(), hand = new THREE.Object3D();
root.add(arm); arm.add(hand);
const ti = new TreeInterp(root);
const pose = (k: number) => {
  root.position.set(k, 0, 2 * k);
  arm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 0.5);
  hand.scale.setScalar(1 + k);
};
pose(0); ti.capture();
ti.apply(0.5);
if (root.position.x !== 0) fail("the first tick should hold still");
ti.restore();
pose(1); ti.capture();
ti.apply(1);
if (root.position.x !== 1) fail("alpha 1 should leave the tick's pose");
ti.apply(0.25);
if (!near(root.position.x, 0.25) || !near(root.position.z, 0.5) || !near(hand.scale.x, 1.25)) fail(`blend: ${root.position.x}, ${root.position.z}, ${hand.scale.x}`);
const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.125);
if (arm.quaternion.angleTo(want) > 1e-3 || !near(arm.quaternion.length(), 1)) fail(`rotation blend off by ${arm.quaternion.angleTo(want)}`);
ti.restore();
if (root.position.x !== 1 || hand.scale.x !== 2) fail("restore should put the tick's pose back");
// The short way: a quaternion and its negative are the same rotation.
pose(1);
{ const q = arm.quaternion; q.set(-q.x, -q.y, -q.z, -q.w); }
ti.capture(); ti.apply(0.5);
if (arm.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)) > 1e-3) fail("rotation should blend the short way");
ti.restore();
pose(3); ti.capture(); ti.snap(); ti.apply(0.5);
if (root.position.x !== 3) fail("snap should drop the last pose");
ti.restore();
// A part added: start over (hold this pose, no blend from a different tree).
arm.add(new THREE.Object3D());
pose(4); ti.capture(); ti.apply(0.5);
if (root.position.x !== 4) fail("a changed tree should hold its first pose");
ti.restore();
pose(5); ti.capture(); ti.apply(0.5);
if (!near(root.position.x, 4.5)) fail(`after the change it blends again: ${root.position.x}`);

// A part posed outside the tick: apply leaves it, and so does restore when it's moved after apply.
{
  const r = new THREE.Group(), a = new THREE.Object3D(), b = new THREE.Object3D();
  r.add(a, b);
  const t = new TreeInterp(r);
  a.position.x = 0; b.position.x = 0; t.capture();
  a.position.x = 1; b.position.x = 1; t.capture();
  b.position.x = 7; // a drawn frame moved b after the tick
  t.apply(0.5);
  if (!near(a.position.x, 0.5) || b.position.x !== 7) fail(`apply over a part posed outside the tick: a ${a.position.x}, b ${b.position.x}`);
  a.position.y = 3; // and a after apply
  t.restore();
  if (a.position.y !== 3 || a.position.x !== 0.5 || b.position.x !== 7) fail(`restore over a part moved after apply: ${a.position.x},${a.position.y}`);
}
// The app's list.
{
  const scene = new THREE.Scene(), set = new InterpSet();
  const m = drawBetweenTicks(new THREE.Group()), loose = drawBetweenTicks(new THREE.Group());
  m.add(new THREE.Object3D());
  scene.add(m);
  m.position.x = 0; set.capture(); m.position.x = 2; set.capture();
  if (set.models !== 1 || set.parts !== 2) fail(`list: ${set.models} models, ${set.parts} parts (loose one out of the scene)`);
  set.apply(0.5);
  if (!near(m.position.x, 1)) fail(`list apply ${m.position.x}`);
  set.restore();
  if (m.position.x !== 2) fail("list restore");
  scene.remove(m); set.capture();
  if (set.models !== 0) fail("a removed model should leave the list");
  scene.add(m, loose); set.capture();
  if (set.models !== 2) fail(`added back: ${set.models} models`);
  // A part added to a model after its first capture is picked up (the tree is only walked again when told).
  const late = new THREE.Group(); m.add(late); set.capture();
  if (set.parts !== 4) fail(`a part added later: ${set.parts} parts (4)`);
  late.position.x = 0; set.capture(); late.position.x = 4; set.capture(); set.apply(0.5);
  if (!near(late.position.x, 2)) fail(`a part added later should blend: ${late.position.x}`);
  set.restore();
  m.remove(late); set.capture();
  if (set.parts !== 3) fail(`a part taken out: ${set.parts} parts (3)`);
  // Hidden or off the screen: not captured; back, it holds its pose one tick and then blends.
  m.position.x = 0; set.capture(); m.position.x = 2; set.capture();
  m.visible = false; set.capture();
  if (set.models !== 1 || set.asleep !== 1) fail(`hidden: ${set.models} models, ${set.asleep} asleep`);
  m.visible = true; m.position.x = 10; set.capture(); set.apply(0.5);
  if (m.position.x !== 10) fail(`back from hidden should hold its pose: ${m.position.x}`);
  set.restore(); m.position.x = 12; set.capture(); set.apply(0.5);
  if (!near(m.position.x, 11)) fail(`a tick after coming back it should blend: ${m.position.x}`);
  set.restore();
  set.inView = (r) => r !== m; set.capture();
  if (set.asleep !== 1) fail(`off the screen: ${set.asleep} asleep`);
  set.inView = null;
}

// Swarm slot arrays.
{
  const x = new Float32Array(8), h = new Float32Array(8), g = new Float32Array(8), f = new Float32Array(16), gen = new Uint32Array(8);
  const si = new SlotInterp([{ a: x }, { a: h, angle: true }, { a: g, jump: 10 }, { a: f, stride: 2 }], [gen]);
  x.set([0, 0, 0]); h.set([3, 0, 0]); g.set([0, 999, 0]); f.set([0, 0, 0, 0]);
  si.capture(3);
  x.set([2, 4, 6]); h.set([-3, 1, 0]); g.set([1, 999 - 300 * Math.PI, 0]); f.set([2, 4, 6, 8]); gen[2] = 1;
  si.capture(3);
  si.apply(0.5);
  if (!near(x[0], 1) || !near(x[1], 2)) fail(`slot blend ${x[0]}, ${x[1]}`);
  if (x[2] !== 6) fail("a slot whose generation changed should show this tick");
  if (!near(Math.abs(h[0]), Math.PI, 1e-3)) fail(`slot angle should blend the short way: ${h[0]}`);
  if (!near(g[0], 0.5) || g[1] !== Math.fround(999 - 300 * Math.PI)) fail(`jump: ${g[0]}, ${g[1]}`);
  if (!near(f[1], 2) || !near(f[3], 4)) fail(`strided: ${f[1]}, ${f[3]}`);
  si.restore();
  if (x[0] !== 2 || h[0] !== Math.fround(-3) || f[3] !== 8) fail("slot restore should be exact");
}
if (problems.length) { console.log(`treeinterp: ${problems.length} problem(s)`); process.exit(1); }
console.log("treeinterp: ok");
