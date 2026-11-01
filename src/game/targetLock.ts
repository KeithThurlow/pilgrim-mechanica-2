// The target lock (Keith 2026-11-01): press Tab with an enemy under the cursor (the soft lock's pick, src/game/
// targeting.ts) and the lock holds on it. While it holds, every weapon and the sword act as if the cursor were on it:
// the aim, the shots, the ground point the rockets and launchers use, and the sword's close or far cut by its distance.
// Tab again lets go; so does the target dying, going down, leaving the register or getting `lockHold` m away.
// Pure and input-free: the lab turns a key press into a toggle command, so a controller button or a touch button can
// send the same command later (one player's own aim: player-owned state, by register id).
import { viewOf, type EntryView, type Filter, type Register } from "./register";

export type LockChange = "on" | "off" | "lost" | null;

export class TargetLock {
  /** The locked entry's register id, or null. */
  id: number | null = null;

  /** The lock command: locked, it lets go; else it locks `candidate` (the soft lock's id this tick), if any. */
  toggle(candidate: number | null): LockChange {
    if (this.id !== null) { this.id = null; return "off"; }
    if (candidate === null) return null;
    this.id = candidate;
    return "on";
  }

  release(): LockChange {
    if (this.id === null) return null;
    this.id = null;
    return "off";
  }

  /**
   * This tick's view of the locked target (after the register's rebuild), or null. A target that's gone (dead,
   * removed), no longer passes the filter (down, or switched sides) or is past `hold` m from `from` lets the lock go
   * ("lost").
   */
  resolve(reg: Register, f: Filter, from: { x: number; z: number }, hold: number, out?: EntryView): { view: EntryView | null; change: LockChange } {
    if (this.id === null) return { view: null, change: null };
    const e = reg.find(this.id);
    if (e < 0 || !reg.passes(e, f) || Math.hypot(reg.x[e] - from.x, reg.z[e] - from.z) > hold) {
      this.id = null;
      return { view: null, change: "lost" };
    }
    return { view: viewOf(reg, e, out), change: null };
  }
}
