// Drawing a model between ticks (src/look/treeInterp.ts; docs/architecture-review.md stage 6b). A small tree of parts
// moved and turned each tick: apply(alpha) poses every part between its last two ticks (position, scale lerped,
// rotation the short way and unit length), restore() puts the tick's pose back exactly, alpha 1 changes nothing, the
// first tick holds still, snap() drops the last pose, and a changed tree starts over. Run: npm test.
import * as THREE from "three/webgpu";
import { TreeInterp } from "../src/look/treeInterp";

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
if (problems.length) { console.log(`treeinterp: ${problems.length} problem(s)`); process.exit(1); }
console.log("treeinterp: ok");
