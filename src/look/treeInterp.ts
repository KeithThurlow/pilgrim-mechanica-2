// Drawing a model between sim ticks (docs/architecture-review.md stage 6b; Keith 2026-11-07: sim at 30-60 Hz, drawn at
// 144-200+). For the few heavy things posed as a tree of parts (the mechs, vehicles): after each tick, capture() keeps
// every part's local position, rotation and scale (this tick's and the last); each drawn frame apply(alpha) poses the
// tree between them; restore() after the render puts this tick's pose back, so anything reading the model during a tick
// (muzzles, sockets) sees the sim's pose, not a blended one. Frame-locked (alpha 1) apply changes nothing. A part something
// else moved since the capture (posed in a drawn frame, not a tick) is left as it is by apply and by restore.
// Stage 6c: drawBetweenTicks(root) puts a model on the app's list (InterpSet, run by createApp under ?tick=N).
// Ownership: cosmetic, local.
import type * as THREE from "three/webgpu";


const F = 10; // floats per part: position 3, quaternion 4, scale 3

export class TreeInterp {
  private parts: THREE.Object3D[] = [];
  private prev = new Float64Array(0);
  private cur = new Float64Array(0);
  /** What apply set (to tell, at restore, whether something else moved a part since). */
  private shown = new Float64Array(0);
  private on = new Uint8Array(0);
  private applied = false;
  private captured = 0;

  constructor(readonly root: THREE.Object3D) {}

  /** Parts in the tree at the last capture. */
  get size() { return this.parts.length; }

  /** End of a tick: this tick's pose becomes the last, the tree's pose now becomes this tick's. */
  capture() {
    this.restore();
    const list: THREE.Object3D[] = [];
    this.root.traverse((o) => { list.push(o); });
    const same = list.length === this.parts.length && list.every((o, i) => o === this.parts[i]);
    if (!same) {
      const n = list.length * F;
      this.parts = list; this.prev = new Float64Array(n); this.cur = new Float64Array(n); this.shown = new Float64Array(n);
      this.on = new Uint8Array(list.length); this.captured = 0;
    } else this.prev.set(this.cur);
    const c = this.cur;
    for (let i = 0; i < list.length; i++) read(list[i], c, i * F);
    // A new tree (or the first tick) has no last pose: hold this one.
    if (this.captured++ === 0) this.prev.set(c);
  }

  /** Forget the last pose (a teleport, a respawn): the next frames show this tick's pose until the next capture. */
  snap() { this.prev.set(this.cur); }

  /** Pose the tree alpha of the way from the last tick's pose to this tick's (0..1). */
  apply(alpha: number) {
    if (this.captured < 2 || alpha >= 1 || this.applied) return;
    const p = this.prev, c = this.cur, w = this.shown, a = Math.max(0, alpha);
    for (let i = 0; i < this.parts.length; i++) {
      const o = this.parts[i], k = i * F;
      // Moved since the capture by something outside the tick: not ours to pose.
      if (!same(o, c, k)) { this.on[i] = 0; continue; }
      this.on[i] = 1;
      for (let j = 0; j < 3; j++) w[k + j] = p[k + j] + (c[k + j] - p[k + j]) * a;
      for (let j = 7; j < 10; j++) w[k + j] = p[k + j] + (c[k + j] - p[k + j]) * a;
      // Quaternion lerp the short way, then normalised (a tick apart the rotations are close).
      const dot = p[k + 3] * c[k + 3] + p[k + 4] * c[k + 4] + p[k + 5] * c[k + 5] + p[k + 6] * c[k + 6], s = dot < 0 ? -1 : 1;
      let len = 0;
      for (let j = 3; j < 7; j++) { w[k + j] = p[k + j] + (s * c[k + j] - p[k + j]) * a; len += w[k + j] * w[k + j]; }
      len = 1 / Math.sqrt(len || 1);
      for (let j = 3; j < 7; j++) w[k + j] *= len;
      write(o, w, k);
    }
    this.applied = true;
  }

  /** After the render: back to this tick's pose (parts something else moved since apply are left alone). */
  restore() {
    if (!this.applied) return;
    this.applied = false;
    for (let i = 0; i < this.parts.length; i++) {
      if (!this.on[i]) continue;
      const o = this.parts[i], k = i * F;
      if (same(o, this.shown, k)) write(o, this.cur, k);
    }
  }
}

function read(o: THREE.Object3D, a: Float64Array, k: number) {
  a[k] = o.position.x; a[k + 1] = o.position.y; a[k + 2] = o.position.z;
  a[k + 3] = o.quaternion.x; a[k + 4] = o.quaternion.y; a[k + 5] = o.quaternion.z; a[k + 6] = o.quaternion.w;
  a[k + 7] = o.scale.x; a[k + 8] = o.scale.y; a[k + 9] = o.scale.z;
}
function write(o: THREE.Object3D, a: Float64Array, k: number) {
  o.position.set(a[k], a[k + 1], a[k + 2]);
  o.quaternion.set(a[k + 3], a[k + 4], a[k + 5], a[k + 6]);
  o.scale.set(a[k + 7], a[k + 8], a[k + 9]);
}
function same(o: THREE.Object3D, a: Float64Array, k: number) {
  const p = o.position, q = o.quaternion, s = o.scale;
  return p.x === a[k] && p.y === a[k + 1] && p.z === a[k + 2] && q.x === a[k + 3] && q.y === a[k + 4] && q.z === a[k + 5] && q.w === a[k + 6]
    && s.x === a[k + 7] && s.y === a[k + 8] && s.z === a[k + 9];
}

// The models drawn between ticks (stage 6c). Mechs and vehicles call drawBetweenTicks(root) when built; the app's
// InterpSet captures them all after every tick, poses them before the drawn frame and puts them back after the render.
const tracked = new Set<THREE.Object3D>();

/** Draw this model between ticks (when the clock is fixed). Taken off when it's removed from its parent. */
export function drawBetweenTicks<T extends THREE.Object3D>(root: T): T {
  if (root.userData.drawBetween) return root;
  root.userData.drawBetween = true;
  tracked.add(root);
  root.addEventListener("added", () => tracked.add(root));
  root.addEventListener("removed", () => tracked.delete(root));
  return root;
}

export class InterpSet {
  private map = new Map<THREE.Object3D, TreeInterp>();
  /** Models and parts captured at the last tick (the HUD's clock line). */
  models = 0;
  parts = 0;

  capture() {
    for (const [r, ti] of this.map) if (!tracked.has(r)) { ti.restore(); this.map.delete(r); }
    let m = 0, n = 0;
    for (const r of tracked) {
      if (!inScene(r)) continue;
      let ti = this.map.get(r);
      if (!ti) { ti = new TreeInterp(r); this.map.set(r, ti); }
      ti.capture();
      m++; n += ti.size;
    }
    this.models = m; this.parts = n;
  }
  apply(alpha: number) { for (const [r, ti] of this.map) if (r.visible) ti.apply(alpha); }
  restore() { for (const ti of this.map.values()) ti.restore(); }
  /** Forget the last pose of one model (a teleport). */
  snap(root: THREE.Object3D) { this.map.get(root)?.snap(); }
}

function inScene(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if ((p as THREE.Scene).isScene) return true;
  return false;
}

// Swarms drawn between ticks (stage 6d). A swarm's sim keeps its units in slot arrays (x, z, heading, feet...) and
// its drawer poses instances from them. SlotInterp keeps the last two ticks of the arrays the drawer reads; for the
// drawn frame apply(alpha) writes the blend into the sim's own arrays, the drawer runs, and restore() puts the tick's
// values back at once, so nothing but the drawer sees a blend. A slot whose key (generation, state) changed between
// the ticks, or a value that jumped (a phase wrapped), shows this tick's value.
type Num = Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int32Array;
export interface Channel {
  a: Float32Array;
  /** Floats per slot (4 feet × 1: stride 4). */
  stride?: number;
  /** An angle: blended the short way round. */
  angle?: boolean;
  /** A step bigger than this isn't blended (a wrapped phase). */
  jump?: number;
}

export class SlotInterp {
  private prev: Float32Array[];
  private cur: Float32Array[];
  private kPrev: Num[];
  private kCur: Num[];
  private hiPrev = 0;
  private hi = 0;
  private captured = 0;
  private applied = false;

  constructor(private channels: Channel[], private keys: Num[]) {
    this.prev = channels.map((c) => new Float32Array(c.a.length));
    this.cur = channels.map((c) => new Float32Array(c.a.length));
    this.kPrev = keys.map((k) => new (k.constructor as new (n: number) => Num)(k.length));
    this.kCur = keys.map((k) => new (k.constructor as new (n: number) => Num)(k.length));
  }

  /** End of a tick: slots below hi are live (the sim's high-water mark). */
  capture(hi: number) {
    this.restore();
    const swap = (a: Num[], b: Num[]) => { for (let j = 0; j < a.length; j++) { const t = a[j]; a[j] = b[j]; b[j] = t; } };
    swap(this.prev, this.cur); swap(this.kPrev, this.kCur);
    this.hiPrev = this.hi; this.hi = hi;
    for (let j = 0; j < this.channels.length; j++) { const s = this.channels[j].stride ?? 1; this.cur[j].set(this.channels[j].a.subarray(0, hi * s)); }
    for (let j = 0; j < this.keys.length; j++) this.kCur[j].set(this.keys[j].subarray(0, hi));
    this.captured++;
  }

  /** Blend into the sim's arrays alpha of the way from the last tick to this one. Call restore() right after drawing. */
  apply(alpha: number) {
    if (this.captured < 2 || alpha >= 1 || this.applied) return;
    const a = Math.max(0, alpha), n = Math.min(this.hi, this.hiPrev);
    for (let j = 0; j < this.channels.length; j++) {
      const ch = this.channels[j], s = ch.stride ?? 1, p = this.prev[j], c = this.cur[j], out = ch.a, jump = ch.jump ?? Infinity;
      for (let i = 0; i < n; i++) {
        if (!this.same(i)) continue;
        for (let k = i * s, e = k + s; k < e; k++) {
          let d = c[k] - p[k];
          if (ch.angle) d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d) > jump) continue;
          out[k] = c[k] - d * (1 - a);
        }
      }
    }
    this.applied = true;
  }

  /** Back to this tick's values. */
  restore() {
    if (!this.applied) return;
    this.applied = false;
    for (let j = 0; j < this.channels.length; j++) { const s = this.channels[j].stride ?? 1; this.channels[j].a.set(this.cur[j].subarray(0, this.hi * s)); }
  }

  private same(i: number) {
    for (let j = 0; j < this.keys.length; j++) if (this.kPrev[j][i] !== this.kCur[j][i]) return false;
    return true;
  }
}

// What draws once per drawn frame instead of each tick, when the clock is fixed (createApp sets betweenTicks and runs
// the list: afterTick after every tick, frame before the app's onFrame callbacks).
export interface FrameDrawer { afterTick(): void; frame(dt: number, alpha: number): void; live(): boolean }
const drawers = new Set<FrameDrawer>();
let fixedClock = false;
/** True when the app runs a fixed tick: drawers that interpolate draw in frames, not ticks. */
export function betweenTicks() { return fixedClock; }
export function setBetweenTicks(on: boolean) { fixedClock = on; }
/** Put a drawer on the app's per-frame list (dropped once live() says false). */
export function drawEachFrame(d: FrameDrawer) { drawers.add(d); }
export function runAfterTick() { for (const d of drawers) { if (!d.live()) { drawers.delete(d); continue; } d.afterTick(); } }
export function runFrameDrawers(dt: number, alpha: number) { for (const d of drawers) d.frame(dt, alpha); }

/**
 * Set a swarm drawer up to draw between ticks: a SlotInterp over the given arrays, captured after every tick, and the
 * draw run once per drawn frame with them blended (put back straight after). Dropped once its group, having been in
 * the scene, is taken out. Call once, from the drawer's update when betweenTicks() is true.
 */
export function swarmBetweenTicks(group: THREE.Object3D, hi: () => number, channels: Channel[], keys: Num[], draw: (dt: number) => void) {
  const interp = new SlotInterp(channels, keys);
  interp.capture(hi());
  let seen = false;
  drawEachFrame({
    afterTick: () => interp.capture(hi()),
    frame: (dt, alpha) => { if (!group.parent) return; interp.apply(alpha); try { draw(dt); } finally { interp.restore(); } },
    live: () => { if (group.parent) seen = true; return !(seen && !group.parent); },
  });
}
