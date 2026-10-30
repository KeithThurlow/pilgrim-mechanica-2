// Burning (Keith 2026-10-30: the incendiary feed's ignited rounds, src/weapons/gear.ts). A round carrying a burn
// (ShotProtocols.burn) sets what it hits alight: for a few seconds the target takes damage over time, through the same
// Hittable adapter the round hit (pick the part, then damage), so it works on robots, infantry, vehicles and a rival
// mech alike. A new ignited hit on the same target and part renews the time (and keeps the stronger burn); a target that
// dies stops burning. Pure of drawing: the battlefield draws flames and smoke at the burning points.
// Ownership: host state (damage). Randomness: none here (the flames are cosmetic).
import * as THREE from "three/webgpu";
import type { Hittable } from "./battlefield";

export interface BurnValues { burnTick: number; burnMax: number }
export const BURN_FALLBACK: BurnValues = { burnTick: 0.25, burnMax: 192 };

/** One target on fire. */
export interface Burning {
  target: Hittable;
  /** The part or unit the hit struck (the adapter's key; -1 none). */
  key: number;
  /** Seconds of burning left, damage per second, time since the last tick. */
  left: number;
  dps: number;
  acc: number;
  /** Where it burns (the last ignited hit; the flames are drawn here). */
  x: number; y: number; z: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Burns {
  readonly list: Burning[] = [];
  /** Damage applied, ignitions and renewals (per run; the checks read them). */
  total = 0;
  ignitions = 0;
  private at = new THREE.Vector3();

  constructor(private v: Partial<BurnValues> = BURN_FALLBACK) {}

  private get tick() { return Math.max(0.02, this.v.burnTick ?? BURN_FALLBACK.burnTick); }
  private get max() { return Math.max(1, Math.floor(this.v.burnMax ?? BURN_FALLBACK.burnMax)); }

  /** Set a target alight at a point (renews it if it already burns there). */
  ignite(target: Hittable, key: number, time: number, dps: number, x: number, y: number, z: number) {
    if (!(time > 0) || !(dps > 0)) return;
    this.ignitions++;
    for (const b of this.list) {
      if (b.target === target && b.key === key) { b.left = Math.max(b.left, time); b.dps = Math.max(b.dps, dps); b.x = x; b.y = y; b.z = z; return; }
    }
    const b: Burning = { target, key, left: time, dps, acc: 0, x, y, z };
    if (this.list.length < this.max) { this.list.push(b); return; }
    // Full: the one with least time left makes room (unless it's the longer).
    let k = 0;
    for (let i = 1; i < this.list.length; i++) if (this.list[i].left < this.list[k].left) k = i;
    if (this.list[k].left < time) this.list[k] = b;
  }

  /** Burn for dt: damage on each tick, drop the burnt out and the dead. */
  step(dt: number) {
    const tick = this.tick;
    let keep = 0;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (!b.target.alive) continue;
      b.left -= dt; b.acc += dt;
      while (b.acc >= tick && b.target.alive) {
        b.acc -= tick;
        b.target.pick?.(b.key);
        const dmg = b.dps * tick;
        b.target.damage(dmg, this.at.set(b.x, b.y, b.z), UP);
        this.total += dmg;
      }
      if (b.left > 0 && b.target.alive) this.list[keep++] = b;
    }
    this.list.length = keep;
  }

  /** Is this target burning (any part)? */
  burning(target: Hittable) { return this.list.some((b) => b.target === target); }
}
