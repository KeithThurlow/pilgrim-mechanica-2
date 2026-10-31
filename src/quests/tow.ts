// Towing and pods (docs/proposal-quests.md): a downed mech's hulk dragged on a cable behind the mech, and escape pods
// picked up by walking over them. Pure: the cable is inextensible (the hulk is pulled to the rope's length and slides
// over the height function, never further than the rope, never under the sand). The glue hooks it (hold E by the
// hulk), slows the mech's move command by towSlow and blocks sprint and dash while it's on.
import type { Param } from "../core/tweaks";

export const TOW_DEFAULTS = {
  towRope: 9,
  towSlow: 0.6,
  towReach: 7,
  towHook: 1.5,
  podReach: 4,
  towDrag: 3,
};
export type TowValues = typeof TOW_DEFAULTS;

export const TOW_GROUP = "Tow and pods";
const G = TOW_GROUP;
export const TOW_PARAMS: Param[] = [
  { key: "towRope", label: "Cable length (m)", min: 3, max: 30, step: 0.5, group: G },
  { key: "towSlow", label: "Walk speed towing (×)", min: 0.2, max: 1, step: 0.05, group: G, tip: "No sprint or dash while towing" },
  { key: "towReach", label: "Hook from within (m)", min: 2, max: 20, step: 0.5, group: G },
  { key: "towHook", label: "Hold E to hook or drop (s)", min: 0.2, max: 5, step: 0.1, group: G },
  { key: "towDrag", label: "Hulk settles (1/s)", min: 0, max: 20, step: 0.5, group: G, tip: "How fast a slack cable lets the hulk come to rest" },
  { key: "podReach", label: "Pick up pods within (m)", min: 1, max: 12, step: 0.5, group: G },
];

export class TowCable {
  /** Hooked to a hulk (whose contract id this is), or null. */
  job: string | null = null;
  /** The hulk: where it lies and the way it faces (toward the mech when pulled). */
  x = 0; y = 0; z = 0; heading = 0;
  /** How it's moving (m/s, for dust and the drag). */
  vx = 0; vz = 0;
  /** Hold-E progress 0..1 (hooking or dropping). */
  hold = 0;

  constructor(public v: TowValues) {}

  get on() { return this.job !== null; }

  /** Put a hulk at a place (unhooked). */
  place(x: number, z: number, y: number) { this.x = x; this.z = z; this.y = y; this.vx = 0; this.vz = 0; }

  hook(job: string) { this.job = job; this.hold = 0; }
  drop() { this.job = null; this.hold = 0; this.vx = 0; this.vz = 0; }

  /** Within reach of the hulk to hook it? */
  reach(mx: number, mz: number) { return Math.hypot(mx - this.x, mz - this.z) <= this.v.towReach; }

  /**
   * Hold E: fills to towHook seconds then flips the hook (returns "hooked" or "dropped" on that frame). The glue only
   * calls it when the mech is within reach (to hook) or towing (to drop).
   */
  holdE(dt: number, held: boolean, job: string): "hooked" | "dropped" | null {
    if (!held) { this.hold = 0; return null; }
    this.hold += dt / Math.max(0.05, this.v.towHook);
    if (this.hold < 1) return null;
    if (this.on) { this.drop(); return "dropped"; }
    this.hook(job);
    return "hooked";
  }

  /** The cable pulls the hulk after the mech at (mx, mz); a slack cable lets it settle. */
  step(dt: number, mx: number, mz: number, height: (x: number, z: number) => number) {
    if (!this.on) { this.y = height(this.x, this.z); return; }
    const L = this.v.towRope, dx = mx - this.x, dz = mz - this.z, d = Math.hypot(dx, dz);
    const ox = this.x, oz = this.z;
    if (d > L) {
      const k = (d - L) / d;
      this.x += dx * k; this.z += dz * k;
    } else {
      // Slack: what speed it had dies away.
      const f = Math.exp(-this.v.towDrag * dt);
      this.x += this.vx * dt * f; this.z += this.vz * dt * f;
      // ...but never past the rope (or into the mech).
      const ex = mx - this.x, ez = mz - this.z, e = Math.hypot(ex, ez);
      if (e > L) { const k = (e - L) / e; this.x += ex * k; this.z += ez * k; }
    }
    if (dt > 0) { this.vx = (this.x - ox) / dt; this.vz = (this.z - oz) / dt; }
    if (d > 0.5) this.heading = Math.atan2(dx, dz);
    this.y = height(this.x, this.z);
  }

  /** What the mech's move command is scaled by (and whether sprint and dash are blocked). */
  get slow() { return this.on ? this.v.towSlow : 1; }
}

/** Pods within reach of someone at (x, z): their indices (null entries are already picked up). */
export function podsInReach(pods: readonly ({ x: number; z: number } | null)[], x: number, z: number, reach: number): number[] {
  const out: number[] = [];
  pods.forEach((p, k) => { if (p && Math.hypot(p.x - x, p.z - z) <= reach) out.push(k); });
  return out;
}
