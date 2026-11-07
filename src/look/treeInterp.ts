// Drawing a model between sim ticks (docs/architecture-review.md stage 6b; Keith 2026-11-07: sim at 30-60 Hz, drawn at
// 144-200+). For the few heavy things posed as a tree of parts (the mechs, vehicles): after each tick, capture() keeps
// every part's local position, rotation and scale (this tick's and the last); each drawn frame apply(alpha) poses the
// tree between them; restore() after the render puts this tick's pose back, so anything reading the model during a tick
// (muzzles, sockets) sees the sim's pose, not a blended one. Frame-locked (alpha 1) apply changes nothing.
// Ownership: cosmetic, local.
import type * as THREE from "three/webgpu";

const F = 10; // floats per part: position 3, quaternion 4, scale 3

export class TreeInterp {
  private parts: THREE.Object3D[] = [];
  private prev = new Float32Array(0);
  private cur = new Float32Array(0);
  private applied = false;
  private captured = 0;

  constructor(readonly root: THREE.Object3D) {}

  /** End of a tick: this tick's pose becomes the last, the tree's pose now becomes this tick's. */
  capture() {
    this.restore();
    const list: THREE.Object3D[] = [];
    this.root.traverse((o) => { list.push(o); });
    const same = list.length === this.parts.length && list.every((o, i) => o === this.parts[i]);
    if (!same) { this.parts = list; this.prev = new Float32Array(list.length * F); this.cur = new Float32Array(list.length * F); this.captured = 0; }
    else this.prev.set(this.cur);
    const c = this.cur;
    for (let i = 0; i < list.length; i++) {
      const o = list[i], k = i * F;
      c[k] = o.position.x; c[k + 1] = o.position.y; c[k + 2] = o.position.z;
      c[k + 3] = o.quaternion.x; c[k + 4] = o.quaternion.y; c[k + 5] = o.quaternion.z; c[k + 6] = o.quaternion.w;
      c[k + 7] = o.scale.x; c[k + 8] = o.scale.y; c[k + 9] = o.scale.z;
    }
    // A new tree (or the first tick) has no last pose: hold this one.
    if (this.captured++ === 0) this.prev.set(c);
  }

  /** Forget the last pose (a teleport, a respawn): the next frames show this tick's pose until the next capture. */
  snap() { this.prev.set(this.cur); }

  /** Pose the tree alpha of the way from the last tick's pose to this tick's (0..1). */
  apply(alpha: number) {
    if (this.captured < 2 || alpha >= 1) return;
    const p = this.prev, c = this.cur, a = Math.max(0, alpha);
    for (let i = 0; i < this.parts.length; i++) {
      const o = this.parts[i], k = i * F;
      o.position.set(p[k] + (c[k] - p[k]) * a, p[k + 1] + (c[k + 1] - p[k + 1]) * a, p[k + 2] + (c[k + 2] - p[k + 2]) * a);
      // Quaternion lerp the short way, then normalised (a tick apart the rotations are close).
      const dot = p[k + 3] * c[k + 3] + p[k + 4] * c[k + 4] + p[k + 5] * c[k + 5] + p[k + 6] * c[k + 6], s = dot < 0 ? -1 : 1;
      o.quaternion.set(p[k + 3] + (s * c[k + 3] - p[k + 3]) * a, p[k + 4] + (s * c[k + 4] - p[k + 4]) * a, p[k + 5] + (s * c[k + 5] - p[k + 5]) * a, p[k + 6] + (s * c[k + 6] - p[k + 6]) * a).normalize();
      o.scale.set(p[k + 7] + (c[k + 7] - p[k + 7]) * a, p[k + 8] + (c[k + 8] - p[k + 8]) * a, p[k + 9] + (c[k + 9] - p[k + 9]) * a);
    }
    this.applied = true;
  }

  /** After the render: back to this tick's pose. */
  restore() {
    if (!this.applied) return;
    this.applied = false;
    const c = this.cur;
    for (let i = 0; i < this.parts.length; i++) {
      const o = this.parts[i], k = i * F;
      o.position.set(c[k], c[k + 1], c[k + 2]);
      o.quaternion.set(c[k + 3], c[k + 4], c[k + 5], c[k + 6]);
      o.scale.set(c[k + 7], c[k + 8], c[k + 9]);
    }
  }
}
