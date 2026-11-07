// Hit stop (Keith 2026-11-01, the sword): a heavy melee hit slows the whole fight for a few hundredths of a second, so
// it lands with weight. The lab's tick asks for its time scale (dtScale) and runs the frame's sims that much slower.
// Only the local player's own hits ask for it (src/weapons/arsenal.ts).
// Ownership: cosmetic, local. In co-op the host can't slow everyone's sims for one player's hit: then this should only
// slow what's drawn (camera, FX), not the sims (docs/multiplayer.md; open question in docs/decisions.md).

export class HitStop {
  private left = 0;
  private k = 1;
  /** Slow time to `scale` (0 frozen .. 1 normal) for `seconds` of real time; a stronger or longer one wins. */
  add(seconds: number, scale: number) {
    if (seconds <= 0 || scale >= 1) return;
    this.left = Math.max(this.left, seconds);
    this.k = Math.min(this.left > 0 && this.k < 1 ? this.k : 1, Math.max(0, scale));
  }
  /** The time scale now, without spending any of the stop (for a second reader in the same frame). */
  now(): number { return this.left > 0 ? this.k : 1; }
  /** This frame's time scale; spends the stop's real time. */
  dtScale(rawDt: number): number {
    if (this.left <= 0) { this.k = 1; return 1; }
    this.left -= rawDt;
    return this.k;
  }
}

/** The one the labs' ticks read. */
export const hitStop = new HitStop();
