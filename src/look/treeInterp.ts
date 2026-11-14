// Drawing a model between sim ticks (docs/architecture-review.md stage 6b; Keith 2026-11-07: sim at 30-60 Hz, drawn at
// 144-200+). For the few heavy things posed as a tree of parts (the mechs, vehicles): after each tick, capture() keeps
// every part's local position, rotation and scale (this tick's and the last); each drawn frame apply(alpha) poses the
// tree between them; restore() after the render puts this tick's pose back, so anything reading the model during a tick
// (muzzles, sockets) sees the sim's pose, not a blended one. At alpha 1 apply changes nothing. A part something
// else moved since the capture (posed in a drawn frame, not a tick) is left as it is by apply and by restore.
// Stage 6c: drawBetweenTicks(root) puts a model on the app's list (InterpSet, run by createApp under ?tick=N).
// Ownership: cosmetic, local.
import type * as THREE from "three/webgpu";


const F = 10; // floats per part: position 3, quaternion 4, scale 3
const QUIET = 30; // ticks still before a part is only looked at now and then

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
  private list: THREE.Object3D[] = [];
  // The tree is walked again only after a part was added or taken out (every node tells us: three's childadded and
  // childremoved). Walking 2,800 parts every tick to find the same list was half of this file's cost (convoy profile,
  // 2026-11-13).
  /** Ticks in a row each part has held still (up to QUIET). */
  private quiet = new Uint8Array(0);
  private tickNo = 0;
  private dirty = true;
  private heard = new Set<THREE.Object3D>();
  private onTree = () => { this.dirty = true; };
  capture() {
    this.restore();
    if (this.dirty) {
      this.dirty = false;
      // One list reused (a fresh one each time was garbage for every model).
      const list = this.list;
      list.length = 0;
      this.root.traverse((o) => { list.push(o); });
      for (const o of list) if (!this.heard.has(o)) { this.heard.add(o); o.addEventListener("childadded", this.onTree); o.addEventListener("childremoved", this.onTree); }
      const same = list.length === this.parts.length && list.every((o, i) => o === this.parts[i]);
      if (!same) {
        const n = list.length * F;
        this.parts = list.slice(); this.prev = new Float64Array(n); this.cur = new Float64Array(n); this.shown = new Float64Array(n);
        this.on = new Uint8Array(list.length); this.quiet = new Uint8Array(list.length); this.captured = 0;
      }
    }
    // The last tick's pose and this one's swap places (no copy), then this tick's is read.
    const t = this.prev; this.prev = this.cur; this.cur = t;
    const c = this.cur, p = this.prev, parts = this.parts, q = this.quiet, tick = this.tickNo++;
    for (let i = 0; i < parts.length; i++) {
      const k = i * F;
      // Most parts of a model never move on their joint. One that has held still for a second is looked at every
      // 8th tick only (its two poses are the same, so there is nothing to keep); when it does move it shows the
      // tick's pose unblended until it's seen, then blends again.
      if (q[i] >= QUIET) {
        if ((tick + i) & 7) continue;
        read(parts[i], c, k);
        if (!still(p, c, k)) { q[i] = 0; for (let j = 0; j < F; j++) p[k + j] = c[k + j]; }
        continue;
      }
      read(parts[i], c, k);
      if (still(p, c, k)) q[i]++; else q[i] = 0;
    }
    // A new tree (or the first tick, or the first after sleep()) has no last pose: hold this one.
    if (this.captured++ === 0) this.prev.set(c);
  }

  /** Not captured for a while (hidden, off the screen): the next capture starts over, holding its pose for a tick. */
  sleep() { this.restore(); this.captured = 0; }

  /** Stop listening to the tree (the model left the list). */
  dispose() {
    this.restore();
    for (const o of this.heard) { o.removeEventListener("childadded", this.onTree); o.removeEventListener("childremoved", this.onTree); }
    this.heard.clear();
  }

  /** Forget the last pose (a teleport, a respawn): the next frames show this tick's pose until the next capture. */
  snap() { this.prev.set(this.cur); }

  /** Pose the tree alpha of the way from the last tick's pose to this tick's (0..1). */
  apply(alpha: number) {
    if (this.captured < 2 || alpha >= 1 || this.applied) return;
    const p = this.prev, c = this.cur, w = this.shown, a = Math.max(0, alpha);
    for (let i = 0; i < this.parts.length; i++) {
      const o = this.parts[i], k = i * F;
      // Moved since the capture by something outside the tick: not ours to pose. Still between the two ticks (most
      // parts of a model: fixed on their joint): nothing to blend, so nothing to write or put back.
      if (still(p, c, k) || !same(o, c, k)) { this.on[i] = 0; continue; }
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
/** Writes the quaternion's fields without its change callback: through set() every write re-derived the part's Euler
 *  rotation (a matrix and its decomposition), the biggest share of this file's cost (phone profile, Keith 2026-11-08).
 *  The Euler keeps the tick's value, which is right again once restore() puts the tick's pose back. */
function write(o: THREE.Object3D, a: Float64Array, k: number) {
  o.position.set(a[k], a[k + 1], a[k + 2]);
  const q = o.quaternion as unknown as { _x: number; _y: number; _z: number; _w: number };
  q._x = a[k + 3]; q._y = a[k + 4]; q._z = a[k + 5]; q._w = a[k + 6];
  o.scale.set(a[k + 7], a[k + 8], a[k + 9]);
}
function still(p: Float64Array, c: Float64Array, k: number) {
  for (let j = 0; j < F; j++) if (p[k + j] !== c[k + j]) return false;
  return true;
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

  /** Says whether a model can be on the screen (the app's camera test); unset: every model is captured. */
  inView: ((root: THREE.Object3D) => boolean) | null = null;
  /** Models skipped at the last tick: hidden, or off the screen. */
  asleep = 0;

  capture() {
    for (const [r, ti] of this.map) if (!tracked.has(r)) { ti.dispose(); this.map.delete(r); }
    let m = 0, n = 0, z = 0;
    for (const r of tracked) {
      const state = shownInScene(r);
      if (state === 0) continue;
      let ti = this.map.get(r);
      // Hidden (a parked body, a culled car) or off the screen: nothing to draw between ticks, so nothing to keep.
      // Back in view it holds its pose for one tick, then blends again.
      if (state === 1 || (this.inView && !this.inView(r))) { ti?.sleep(); z++; continue; }
      if (!ti) { ti = new TreeInterp(r); this.map.set(r, ti); }
      ti.capture();
      m++; n += ti.size;
    }
    this.models = m; this.parts = n; this.asleep = z;
  }
  apply(alpha: number) { for (const [r, ti] of this.map) if (r.visible) ti.apply(alpha); }
  restore() { for (const ti of this.map.values()) ti.restore(); }
  /** Forget the last pose of one model (a teleport). */
  snap(root: THREE.Object3D) { this.map.get(root)?.snap(); }
}

/** 0: not in a scene; 1: in one but hidden (itself or a parent); 2: in one and shown. */
function shownInScene(o: THREE.Object3D): 0 | 1 | 2 {
  let shown = true;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) shown = false;
    if ((p as THREE.Scene).isScene) return shown ? 2 : 1;
  }
  return 0;
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
  private saved: Float32Array[];
  private appliedN = 0;

  constructor(private channels: Channel[], private keys: Num[]) {
    this.prev = channels.map((c) => new Float32Array(c.a.length));
    this.cur = channels.map((c) => new Float32Array(c.a.length));
    this.saved = channels.map((c) => new Float32Array(c.a.length));
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
      // What the arrays hold now, put back by restore(): not this tick's capture, since a write since then (the sim
      // worker's snapshot onto a view, src/sim/robotsRemote.ts) must survive the drawn frame (2026-11-14: robots in
      // the convoy lab only moved about once a second while every frame put the last tick's capture back).
      this.saved[j].set(out.subarray(0, n * s));
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
    this.appliedN = n;
    this.applied = true;
  }

  /** Back to the values the arrays held before apply(). */
  restore() {
    if (!this.applied) return;
    this.applied = false;
    for (let j = 0; j < this.channels.length; j++) { const s = this.channels[j].stride ?? 1; this.channels[j].a.set(this.saved[j].subarray(0, this.appliedN * s)); }
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
export function swarmBetweenTicks(group: THREE.Object3D, hi: () => number, channels: Channel[], keys: Num[], draw: (dt: number) => void, stamp?: () => number | null) {
  const interp = new SlotInterp(channels, keys);
  interp.capture(hi());
  let seen = false;
  // A swarm stepped in the sim worker (stamp: its snapshot count; null while it steps here) changes when a snapshot
  // lands, a little after its tick, not at the tick: the blend runs from the last snapshot to the newest, captured as
  // it lands, and its alpha is the time since then over the time between snapshots (2026-11-14).
  let last = -1, at = 0, period = 1000 / 30;
  const remote = () => { const s = stamp?.(); return s === undefined || s === null ? -1 : s; };
  drawEachFrame({
    afterTick: () => { if (remote() < 0) interp.capture(hi()); },
    frame: (dt, alpha) => {
      const s = remote();
      if (s >= 0) {
        const now = performance.now();
        if (s !== last) {
          if (last >= 0) period += (Math.min(200, Math.max(8, now - at)) - period) * 0.2;
          last = s; at = now;
          interp.capture(hi());
        }
        alpha = Math.min(1, (now - at) / period);
      }
      if (!group.parent) return;
      interp.apply(alpha);
      try { draw(dt); } finally { interp.restore(); }
    },
    live: () => { if (group.parent) seen = true; return !(seen && !group.parent); },
  });
}
