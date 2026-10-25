// Where a frame's milliseconds go: a lab marks the end of each stage of its tick and the HUD shows the averages
// (Keith 2026-10-25: the convoy lab dropped to 28 FPS far from the convoy, and the frame time alone couldn't say why).
// CPU time only: the GPU's share shows in the app's "render" stage, which is the time to submit the frame.

export class Costs {
  private sums = new Map<string, number>();
  private frames = 0;
  private t = 0;
  private shown = "";
  private windowStart = performance.now();
  /** This frame's stages so far (ms), cleared by begin(): for a lab that keeps its own per-frame records (stress lab). */
  readonly frame = new Map<string, number>();

  /** Start timing this frame's stages. */
  begin() { this.t = performance.now(); this.frame.clear(); }

  /** The stage that just finished: everything since begin() or the last mark. */
  mark(stage: string) {
    const now = performance.now();
    this.sums.set(stage, (this.sums.get(stage) ?? 0) + (now - this.t));
    this.frame.set(stage, (this.frame.get(stage) ?? 0) + (now - this.t));
    this.t = now;
  }

  /** Close the frame. Returns the averaged line, refreshed every half second. */
  end(): string {
    this.frames++;
    const now = performance.now();
    if (now - this.windowStart >= 500) {
      const parts = [...this.sums].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / this.frames).toFixed(1)}`);
      this.shown = parts.length ? `cpu ms: ${parts.join(" · ")}` : "";
      this.sums.clear();
      this.frames = 0;
      this.windowStart = now;
    }
    return this.shown;
  }
}
